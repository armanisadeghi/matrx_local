#!/usr/bin/env bash
#
# Fully automated release script for matrx-local.
#
# Works on: macOS (BSD sed), Linux (GNU sed), WSL (GNU sed).
# Windows native: run inside Git Bash or WSL — not bare cmd/PowerShell.
#
# Usage:
#   ./scripts/release.sh              # auto-bump patch  (1.0.25 → 1.0.26)
#   ./scripts/release.sh --major      # bump minor       (1.0.25 → 1.1.0)
#   ./scripts/release.sh X.Y.Z        # set exact version
#
# Source of truth: pyproject.toml  `version = "X.Y.Z"`
#
# Files kept in sync by this script:
#   pyproject.toml
#   desktop/src-tauri/tauri.conf.json
#   desktop/src-tauri/Cargo.toml
#   desktop/package.json            (via npm version — also updates package-lock.json)
#
# Files that no longer need updating (dynamic — read from package metadata at runtime):
#   run.py              uses importlib.metadata.version("matrx-local")
#   app/api/routes.py   uses importlib.metadata.version("matrx-local")
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# ---------------------------------------------------------------------------
# Portable in-place sed.
# BSD sed (macOS) requires:  sed -i '' 's/old/new/' file
# GNU sed (Linux / WSL):     sed -i    's/old/new/' file
# ---------------------------------------------------------------------------
sedi() {
    if sed --version 2>/dev/null | grep -q GNU; then
        sed -i "$@"
    else
        sed -i '' "$@"
    fi
}

# ---------------------------------------------------------------------------
# 1. Read current version from pyproject.toml (single source of truth)
# ---------------------------------------------------------------------------
CURRENT=$(grep -m1 '^version' pyproject.toml | sed 's/.*"\(.*\)".*/\1/')
if [[ -z "$CURRENT" ]]; then
    echo "ERROR: Could not read version from pyproject.toml"
    exit 1
fi

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

# ---------------------------------------------------------------------------
# 2. Determine new version
# ---------------------------------------------------------------------------
ARG="${1:-patch}"

case "$ARG" in
    patch)
        PATCH=$((PATCH + 1))
        VERSION="$MAJOR.$MINOR.$PATCH"
        ;;
    --major)
        MINOR=$((MINOR + 1))
        PATCH=0
        VERSION="$MAJOR.$MINOR.$PATCH"
        ;;
    [0-9]*)
        VERSION="$ARG"
        ;;
    *)
        echo "Usage: $0 [--major|X.Y.Z]"
        echo ""
        echo "  (no args)   bump patch: $MAJOR.$MINOR.$PATCH → $MAJOR.$MINOR.$((PATCH + 1))"
        echo "  --major     bump minor: $MAJOR.$MINOR.$PATCH → $MAJOR.$((MINOR + 1)).0"
        echo "  X.Y.Z       set exact version"
        echo ""
        echo "  NOTE: bumping major ($((MAJOR + 1)).0.0) is intentionally manual only."
        exit 1
        ;;
esac

TAG="v$VERSION"
echo "=== Releasing $TAG (was $CURRENT) ==="

# ---------------------------------------------------------------------------
# 3. Require a clean working tree
# ---------------------------------------------------------------------------
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "ERROR: Uncommitted changes detected. Commit them first:"
    echo "  git add . && git commit -m \"your changes\""
    exit 1
fi

# ---------------------------------------------------------------------------
# 4. Sync version across all manifest files
# ---------------------------------------------------------------------------
echo "  → Updating version to $VERSION..."

# pyproject.toml — top-level:  version = "X.Y.Z"
sedi "s/^version = \"[^\"]*\"/version = \"$VERSION\"/" pyproject.toml

# tauri.conf.json — the root-level "version" field (2-space indent)
sedi "s/^  \"version\": \"[^\"]*\"/  \"version\": \"$VERSION\"/" \
    desktop/src-tauri/tauri.conf.json

# Cargo.toml — [package] section:  version = "X.Y.Z"
sedi "s/^version = \"[^\"]*\"/version = \"$VERSION\"/" \
    desktop/src-tauri/Cargo.toml

# package.json + package-lock.json — npm handles JSON correctly and atomically
cd desktop
npm version "$VERSION" --no-git-tag-version --allow-same-version 2>/dev/null
cd "$PROJECT_ROOT"

echo "  ✓ Versions synced:"
echo "       pyproject.toml                    → $VERSION"
echo "       desktop/src-tauri/tauri.conf.json → $VERSION"
echo "       desktop/src-tauri/Cargo.toml      → $VERSION"
echo "       desktop/package.json              → $VERSION"
echo "       desktop/package-lock.json         → $VERSION  (via npm)"
echo ""
echo "  ℹ  run.py and app/api/routes.py read the version dynamically"
echo "     from importlib.metadata — no sed update needed."

# ---------------------------------------------------------------------------
# 5. Commit the version bump (includes package-lock.json from npm above)
# ---------------------------------------------------------------------------
git add \
    pyproject.toml \
    desktop/src-tauri/tauri.conf.json \
    desktop/src-tauri/Cargo.toml \
    desktop/package.json \
    desktop/package-lock.json

git commit -m "release: $TAG"

# ---------------------------------------------------------------------------
# 6. Tag
# ---------------------------------------------------------------------------
if git tag --list "$TAG" | grep -q "$TAG"; then
    echo "  → Tag $TAG already exists, removing and recreating..."
    git tag -d "$TAG"
    git push origin ":refs/tags/$TAG" 2>/dev/null || true
fi

git tag "$TAG"

# ---------------------------------------------------------------------------
# 7. Push commit + tag (triggers GitHub Actions → PyPI publish)
# ---------------------------------------------------------------------------
echo "  → Pushing to origin..."
git push origin main
git push origin "$TAG"

echo ""
echo "=== Released $TAG ==="
echo "  $CURRENT → $VERSION"
echo ""
echo "Monitor CI: https://github.com/armanisadeghi/matrx-local/actions"
echo "Releases:   https://github.com/armanisadeghi/matrx-local/releases"
