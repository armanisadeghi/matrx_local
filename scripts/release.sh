#!/usr/bin/env bash
#
# Release a new version of matrx-local.
#
# Usage:
#   ./scripts/release.sh [version]
#
# If version is omitted, it reads from pyproject.toml.
# This script:
#   1. Reads (or accepts) the version
#   2. Syncs version across pyproject.toml, tauri.conf.json, package.json
#   3. Commits all changes
#   4. Creates a git tag (vX.Y.Z)
#   5. Pushes commit + tag to origin (triggers GitHub Actions CI)
#
# Examples:
#   ./scripts/release.sh          # use version from pyproject.toml
#   ./scripts/release.sh 1.2.3    # set and release version 1.2.3
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# ---- Determine version ----
if [[ -n "${1:-}" ]]; then
    VERSION="$1"
else
    VERSION=$(grep -m1 '^version' pyproject.toml | sed 's/.*"\(.*\)".*/\1/')
fi

if [[ -z "$VERSION" ]]; then
    echo "ERROR: Could not determine version. Pass it as an argument or set it in pyproject.toml."
    exit 1
fi

TAG="v$VERSION"
echo "=== Releasing $TAG ==="

# ---- Sync version across all config files ----
echo "  → Syncing version to $VERSION..."

# pyproject.toml
sed -i "s/^version = \".*\"/version = \"$VERSION\"/" pyproject.toml

# tauri.conf.json
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" desktop/src-tauri/tauri.conf.json

# package.json (only the top-level version field)
cd desktop
npm version "$VERSION" --no-git-tag-version --allow-same-version 2>/dev/null
cd "$PROJECT_ROOT"

echo "  ✓ Versions synced"

# ---- Stage, commit, tag, push ----
echo "  → Staging changes..."
git add -A

if git diff --cached --quiet; then
    echo "  (no changes to commit — version files already up to date)"
else
    echo "  → Committing..."
    git commit -m "release: $TAG"
fi

# Delete existing tag locally and remotely if it exists
if git tag -l "$TAG" | grep -q "$TAG"; then
    echo "  → Removing existing tag $TAG..."
    git tag -d "$TAG"
    git push origin ":refs/tags/$TAG" 2>/dev/null || true
fi

echo "  → Tagging $TAG..."
git tag "$TAG"

echo "  → Pushing to origin..."
git push
git push origin "$TAG"

echo ""
echo "=== Release $TAG triggered ==="
echo "Monitor CI: https://github.com/armanisadeghi/matrx-local/actions"
echo "Releases:   https://github.com/armanisadeghi/matrx-local/releases"
