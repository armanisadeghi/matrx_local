#!/usr/bin/env bash
#
# Fully automated release script for matrx-local.
#
# Usage:
#   ./scripts/release.sh              # auto-bump patch (1.0.1 → 1.0.2)
#   ./scripts/release.sh minor        # bump minor      (1.0.1 → 1.1.0)
#   ./scripts/release.sh major        # bump major      (1.0.1 → 2.0.0)
#   ./scripts/release.sh 2.3.4        # set exact version
#
# What it does:
#   1. Reads current version from pyproject.toml
#   2. Bumps it (patch by default, or as specified)
#   3. Updates pyproject.toml, tauri.conf.json, package.json, run.py
#   4. Commits the version bump
#   5. Tags vX.Y.Z
#   6. Pushes commit + tag to origin (triggers GitHub Actions CI)
#
# Workflow:
#   git add . && git commit -m "your changes"
#   ./scripts/release.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# ---- Read current version from pyproject.toml ----
CURRENT=$(grep -m1 '^version' pyproject.toml | sed 's/.*"\(.*\)".*/\1/')
if [[ -z "$CURRENT" ]]; then
    echo "ERROR: Could not read version from pyproject.toml"
    exit 1
fi

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

# ---- Determine new version ----
ARG="${1:-patch}"

case "$ARG" in
    patch)
        PATCH=$((PATCH + 1))
        VERSION="$MAJOR.$MINOR.$PATCH"
        ;;
    minor)
        MINOR=$((MINOR + 1))
        PATCH=0
        VERSION="$MAJOR.$MINOR.$PATCH"
        ;;
    major)
        MAJOR=$((MAJOR + 1))
        MINOR=0
        PATCH=0
        VERSION="$MAJOR.$MINOR.$PATCH"
        ;;
    [0-9]*)
        # Exact version specified
        VERSION="$ARG"
        ;;
    *)
        echo "Usage: $0 [patch|minor|major|X.Y.Z]"
        exit 1
        ;;
esac

TAG="v$VERSION"
echo "=== Releasing $TAG (was $CURRENT) ==="

# ---- Check for uncommitted changes ----
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "ERROR: You have uncommitted changes. Commit them first:"
    echo "  git add . && git commit -m \"your changes\""
    exit 1
fi

# ---- Sync version across all config files ----
echo "  → Updating version to $VERSION..."

# pyproject.toml
sed -i "s/^version = \".*\"/version = \"$VERSION\"/" pyproject.toml

# tauri.conf.json (top-level "version" field)
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" desktop/src-tauri/tauri.conf.json

# package.json
cd desktop
npm version "$VERSION" --no-git-tag-version --allow-same-version 2>/dev/null
cd "$PROJECT_ROOT"

# run.py (engine root endpoint version)
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" run.py

echo "  ✓ Versions synced across pyproject.toml, tauri.conf.json, package.json, run.py"

# ---- Commit the version bump ----
git add pyproject.toml desktop/src-tauri/tauri.conf.json desktop/package.json run.py
git commit -m "release: $TAG"

# ---- Tag ----
if git tag -l "$TAG" | grep -q "$TAG"; then
    echo "  → Tag $TAG already exists, removing..."
    git tag -d "$TAG"
    git push origin ":refs/tags/$TAG" 2>/dev/null || true
fi

git tag "$TAG"

# ---- Push ----
echo "  → Pushing to origin..."
git push origin main
git push origin "$TAG"

echo ""
echo "=== Released $TAG ==="
echo "  $CURRENT → $VERSION"
echo ""
echo "Monitor CI: https://github.com/armanisadeghi/matrx-local/actions"
echo "Releases:   https://github.com/armanisadeghi/matrx-local/releases"
