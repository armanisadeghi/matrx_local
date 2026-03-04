#!/usr/bin/env bash
#
# Fully automated release script for matrx-local.
#
# Usage:
#   ./scripts/release.sh              # auto-bump patch (1.0.25 → 1.0.26)
#   ./scripts/release.sh --major      # bump minor      (1.0.25 → 1.1.0)
#   ./scripts/release.sh X.Y.Z        # set exact version
#
# Flags:
#   --major   Bumps the middle number (1.0.x → 1.1.0).
#             Bumping 1.x.y → 2.0.0 is intentionally manual-only.
#
# What it does:
#   1. Reads current version from pyproject.toml (single source of truth)
#   2. Bumps patch by default, or minor with --major flag
#   3. Updates ALL version files:
#        - pyproject.toml
#        - desktop/src-tauri/tauri.conf.json
#        - desktop/src-tauri/Cargo.toml
#        - desktop/package.json
#        - run.py
#   4. Commits the version bump
#   5. Tags vX.Y.Z
#   6. Pushes commit + tag to origin (triggers GitHub Actions CI / PyPI publish)
#
# Workflow:
#   git add . && git commit -m "your changes"
#   ./scripts/release.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Portable in-place sed: BSD (macOS) requires -i '', GNU requires -i alone.
sedi() {
    if sed --version 2>/dev/null | grep -q GNU; then
        sed -i "$@"
    else
        sed -i '' "$@"
    fi
}

# ---- Read current version from pyproject.toml (single source of truth) ----
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
        echo "  NOTE: bumping the major version ($((MAJOR + 1)).0.0) is intentionally manual only."
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

# 1. pyproject.toml  (top-level: version = "X.Y.Z")
sedi "s/^version = \".*\"/version = \"$VERSION\"/" pyproject.toml

# 2. tauri.conf.json  (top-level "version" field — no indentation)
sedi "s/^  \"version\": \"[^\"]*\"/  \"version\": \"$VERSION\"/" desktop/src-tauri/tauri.conf.json

# 3. Cargo.toml  ([package] section: version = "X.Y.Z")
sedi "s/^version = \".*\"/version = \"$VERSION\"/" desktop/src-tauri/Cargo.toml

# 4. desktop/package.json — npm handles JSON correctly
cd desktop
npm version "$VERSION" --no-git-tag-version --allow-same-version 2>/dev/null
cd "$PROJECT_ROOT"

# 5. run.py — the "version" key inside write_discovery_file's payload
#    Targets lines like:  "version": "1.0.25",
sedi 's/"version": "[0-9]*\.[0-9]*\.[0-9]*"/"version": "'"$VERSION"'"/' run.py

echo "  ✓ Versions synced:"
echo "       pyproject.toml                    → $VERSION"
echo "       desktop/src-tauri/tauri.conf.json → $VERSION"
echo "       desktop/src-tauri/Cargo.toml      → $VERSION"
echo "       desktop/package.json              → $VERSION"
echo "       run.py                            → $VERSION"

# ---- Commit the version bump ----
git add \
    pyproject.toml \
    desktop/src-tauri/tauri.conf.json \
    desktop/src-tauri/Cargo.toml \
    desktop/package.json \
    desktop/package-lock.json \
    run.py

git commit -m "release: $TAG"

# ---- Tag ----
if git tag --list "$TAG" | grep -q "$TAG"; then
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
