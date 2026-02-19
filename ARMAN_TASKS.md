# Arman Tasks — Scraper Service Setup

Things that need to be done manually or require your credentials/decisions.

---

## Completed

- [x] Install Docker Engine in WSL2
- [x] Start PostgreSQL via docker compose
- [x] Run Alembic migrations (all 7 tables created)
- [x] Verify live scrape pipeline (fetch + parse + cache working)

---

## Before First Deploy (Coolify)

### 1. Generate a production API key

Pick a strong random key for the production `API_KEY` environment variable. This protects all scraper endpoints.

```bash
openssl rand -hex 32
```

### 2. Set up Coolify project

In Coolify, create a new project for the scraper service:

1. **Source**: Point to this repo, path `scraper-service/`
2. **Build**: Docker (it will use the `Dockerfile`)
3. **Environment Variables**: Set all variables from `.env.example` with production values:
   - `API_KEY` — the key you generated above
   - `DATABASE_URL` — Coolify will provide this if you add a PostgreSQL resource, or set manually
   - `BRAVE_API_KEY` / `BRAVE_API_KEY_AI` — your Brave API keys
   - `DATACENTER_PROXIES` / `RESIDENTIAL_PROXIES` — your proxy lists
   - `AWS_*` and `BACKUP_*` — for automated backups (see below)
4. **Ports**: Expose port `8001`
5. **Health check**: `GET /api/v1/health`

The `Dockerfile` entrypoint automatically runs `alembic upgrade head` before starting the server, so migrations apply on every deploy.

### 3. Set up PostgreSQL in Coolify

Two options:

**Option A (recommended for now):** Add a PostgreSQL 17 resource in the same Coolify project. Coolify generates the connection string — use it as `DATABASE_URL`. The `docker-compose.yml` app service is configured for this (connects to `postgres:5432` on the internal Docker network).

**Option B (later — dedicated VPS):** When you move the scraper to its own VPS, deploy both the app and PostgreSQL on that VPS via Coolify. Same setup, just a different server.

### 4. Install `aws` CLI on production server (for backups)

The backup script needs the AWS CLI. On the production server:

```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip && sudo ./aws/install && rm -rf awscliv2.zip aws/
```

Or install via Docker — the backup script runs outside the container against the PostgreSQL directly.

### 5. Set up daily backup cron

On the production VPS (or in a Coolify cron job):

```bash
# Daily at 3 AM UTC
0 3 * * * cd /path/to/scraper-service && ./scripts/backup.sh >> /var/log/scraper-backup.log 2>&1
```

The script:
- Dumps PostgreSQL with `pg_dump`
- Compresses with gzip
- Uploads to `s3://matrix-models/backups/scraper-service/`
- Uses `STANDARD_IA` storage class (cheaper for backups)
- Keeps 3 most recent local copies

Useful commands:
```bash
./scripts/backup.sh                     # Run backup now
./scripts/backup.sh --list              # List backups in S3
./scripts/backup.sh --restore latest    # Restore most recent
./scripts/backup.sh --restore <file>    # Restore specific backup
```

### 6. Install Playwright on the server

The Dockerfile handles this automatically during build. No manual step needed.

### 7. (Optional) Install `pg_dump` locally for manual backups

If you want to run backups from your WSL machine:

```bash
sudo apt install -y postgresql-client-17
```

---

## After Deploy — Verify

```bash
# Health check
curl https://your-scraper-domain/api/v1/health

# Scrape a page
curl -X POST https://your-scraper-domain/api/v1/scrape \
  -H "Authorization: Bearer YOUR_PROD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"urls": ["https://example.com"]}'
```

---

## Notes

- **Docker daemon in WSL**: `sudo service docker start` after each WSL restart. Docker doesn't auto-start in WSL2.
- **PostgreSQL data**: Stored in a Docker volume (`scraper-service_pgdata`). Survives container restarts. Lost only if you explicitly `docker volume rm`.
- **Monorepo .env conflict**: The scraper service `.env` uses `override=True` in dotenv loading to prevent the monorepo's `DATABASE_URL` from leaking in. This is handled in both `app/config.py` and `alembic/env.py`.
