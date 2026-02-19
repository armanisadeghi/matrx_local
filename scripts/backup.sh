#!/bin/bash
set -euo pipefail

# ============================================================
# Scraper Service — PostgreSQL Backup to S3
# ============================================================
#
# Usage:
#   ./scripts/backup.sh                    # Run backup now
#   ./scripts/backup.sh --restore latest   # Restore most recent backup
#   ./scripts/backup.sh --restore <file>   # Restore a specific backup file from S3
#   ./scripts/backup.sh --list             # List available backups in S3
#
# Required environment variables (from .env or exported):
#   DATABASE_URL          — PostgreSQL connection string
#   AWS_ACCESS_KEY_ID     — AWS credentials
#   AWS_SECRET_ACCESS_KEY — AWS credentials
#   AWS_REGION            — AWS region (default: us-east-2)
#   BACKUP_S3_BUCKET      — S3 bucket name (default: matrix-models)
#   BACKUP_S3_PREFIX      — S3 key prefix (default: backups/scraper-service)
#
# Cron example (daily at 3 AM):
#   0 3 * * * cd /path/to/scraper-service && ./scripts/backup.sh >> /var/log/scraper-backup.log 2>&1
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -f "$PROJECT_DIR/.env" ]; then
    set -a
    source "$PROJECT_DIR/.env"
    set +a
fi

REGION="${AWS_REGION:-us-east-2}"
BUCKET="${BACKUP_S3_BUCKET:-matrix-models}"
PREFIX="${BACKUP_S3_PREFIX:-backups/scraper-service}"
TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
BACKUP_FILE="scraper_service_${TIMESTAMP}.sql.gz"
LOCAL_DIR="/tmp/scraper-backups"
KEEP_LOCAL=3

mkdir -p "$LOCAL_DIR"

parse_db_url() {
    local url="$DATABASE_URL"
    url="${url#postgresql://}"
    DB_USER="${url%%:*}"
    url="${url#*:}"
    DB_PASS="${url%%@*}"
    url="${url#*@}"
    DB_HOST="${url%%:*}"
    url="${url#*:}"
    DB_PORT="${url%%/*}"
    DB_NAME="${url#*/}"
}

do_backup() {
    parse_db_url

    echo "[$(date -u +%FT%TZ)] Starting backup of $DB_NAME@$DB_HOST:$DB_PORT"

    PGPASSWORD="$DB_PASS" pg_dump \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --no-owner \
        --no-privileges \
        --clean \
        --if-exists \
        | gzip > "$LOCAL_DIR/$BACKUP_FILE"

    local size
    size="$(du -h "$LOCAL_DIR/$BACKUP_FILE" | cut -f1)"
    echo "[$(date -u +%FT%TZ)] Backup created: $BACKUP_FILE ($size)"

    echo "[$(date -u +%FT%TZ)] Uploading to s3://$BUCKET/$PREFIX/$BACKUP_FILE"
    aws s3 cp "$LOCAL_DIR/$BACKUP_FILE" "s3://$BUCKET/$PREFIX/$BACKUP_FILE" \
        --region "$REGION" \
        --storage-class STANDARD_IA \
        --quiet

    echo "[$(date -u +%FT%TZ)] Upload complete"

    # Clean up old local backups, keep the most recent N
    ls -t "$LOCAL_DIR"/scraper_service_*.sql.gz 2>/dev/null | tail -n +$((KEEP_LOCAL + 1)) | xargs -r rm -f
    echo "[$(date -u +%FT%TZ)] Cleaned old local backups (keeping $KEEP_LOCAL)"

    echo "[$(date -u +%FT%TZ)] Backup complete: s3://$BUCKET/$PREFIX/$BACKUP_FILE"
}

do_list() {
    echo "Available backups in s3://$BUCKET/$PREFIX/:"
    echo ""
    aws s3 ls "s3://$BUCKET/$PREFIX/" --region "$REGION" | sort -r | head -30
}

do_restore() {
    local target="$1"
    parse_db_url

    if [ "$target" = "latest" ]; then
        echo "[$(date -u +%FT%TZ)] Finding latest backup..."
        target="$(aws s3 ls "s3://$BUCKET/$PREFIX/" --region "$REGION" | sort -r | head -1 | awk '{print $4}')"
        if [ -z "$target" ]; then
            echo "ERROR: No backups found in s3://$BUCKET/$PREFIX/"
            exit 1
        fi
        echo "[$(date -u +%FT%TZ)] Latest backup: $target"
    fi

    local local_file="$LOCAL_DIR/$target"

    if [ ! -f "$local_file" ]; then
        echo "[$(date -u +%FT%TZ)] Downloading s3://$BUCKET/$PREFIX/$target"
        aws s3 cp "s3://$BUCKET/$PREFIX/$target" "$local_file" --region "$REGION" --quiet
    fi

    echo "[$(date -u +%FT%TZ)] Restoring $target to $DB_NAME@$DB_HOST:$DB_PORT"
    echo "WARNING: This will overwrite existing data. Press Ctrl+C within 5 seconds to cancel."
    sleep 5

    gunzip -c "$local_file" | PGPASSWORD="$DB_PASS" psql \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --quiet

    echo "[$(date -u +%FT%TZ)] Restore complete"
}

case "${1:-}" in
    --list)
        do_list
        ;;
    --restore)
        if [ -z "${2:-}" ]; then
            echo "Usage: $0 --restore <latest|filename>"
            exit 1
        fi
        do_restore "$2"
        ;;
    *)
        do_backup
        ;;
esac
