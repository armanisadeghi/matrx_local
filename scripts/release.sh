#!/usr/bin/env bash
# release.sh — Bump version, commit, tag, and push.
# GitHub Actions builds multi-platform desktop binaries on tag push.
#
# Source of truth: pyproject.toml
# Files kept in sync:
#   pyproject.toml
#   desktop/src-tauri/tauri.conf.json
#   desktop/src-tauri/Cargo.toml
#   desktop/package.json  (via npm — also updates package-lock.json)
#
# Dynamic (no update needed):
#   run.py, app/api/routes.py — read via importlib.metadata
#   desktop/src/pages/Login.tsx — reads __APP_VERSION__ injected by Vite from package.json
#   desktop/src/pages/Settings.tsx — reads __APP_VERSION__ injected by Vite from package.json
#
# Usage:
#   ./scripts/release.sh              # patch bump  (default)
#   ./scripts/release.sh --patch      # patch bump
#   ./scripts/release.sh --minor      # minor bump
#   ./scripts/release.sh --major      # major bump
#   ./scripts/release.sh --message "feat: something"   # custom commit message
#   ./scripts/release.sh --dry-run    # preview without changes
#   ./scripts/release.sh X.Y.Z       # set exact version
set -euo pipefail

# ── Resolve repo root ────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PROJECT_NAME="matrx-local"
GITHUB_REPO="armanisadeghi/matrx-local"
VERSION_FILE="pyproject.toml"
REMOTE="origin"
BRANCH="main"

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()      { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()    { echo -e "${RED}[FAIL]${NC}  $*" >&2; exit 1; }
preview() { echo -e "${YELLOW}[DRY]${NC}   $*"; }

# ── Portable in-place sed ────────────────────────────────────────────────────
sedi() {
    if sed --version 2>/dev/null | grep -q GNU; then
        sed -i "$@"
    else
        sed -i '' "$@"
    fi
}

# ── Parse flags ──────────────────────────────────────────────────────────────
BUMP_TYPE="patch"
CUSTOM_MESSAGE=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --patch)   BUMP_TYPE="patch"; shift ;;
        --minor)   BUMP_TYPE="minor"; shift ;;
        --major)   BUMP_TYPE="major"; shift ;;
        --message|-m)
            [[ -n "${2:-}" ]] || fail "--message requires an argument."
            CUSTOM_MESSAGE="$2"; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        -h|--help)
            grep '^#' "$0" | head -20 | sed 's/^# \?//'
            exit 0 ;;
        [0-9]*)    BUMP_TYPE="exact"; EXACT_VERSION="$1"; shift ;;
        *) fail "Unknown flag: $1. Use --patch, --minor, --major, --message, --dry-run, or X.Y.Z." ;;
    esac
done

# ── Pre-flight checks ────────────────────────────────────────────────────────
[[ -f "$VERSION_FILE" ]] || fail "$VERSION_FILE not found."

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
[[ "$CURRENT_BRANCH" == "$BRANCH" ]] \
    || fail "Not on '$BRANCH' branch (currently on '$CURRENT_BRANCH'). Switch first."

if [[ -n "$(git diff --cached --name-only)" ]]; then
    fail "Staged but uncommitted changes detected. Commit or unstage them first."
fi

if ! git diff --quiet; then
    fail "Uncommitted changes detected. Commit them first."
fi

# ── Ensure cloudflared sidecar binary exists for current platform ─────────────
info "Ensuring cloudflared sidecar binary is present..."
if [[ -f "scripts/download-cloudflared.sh" ]]; then
    chmod +x scripts/download-cloudflared.sh
    ./scripts/download-cloudflared.sh --current
    ok "cloudflared sidecar ready."
else
    warn "scripts/download-cloudflared.sh not found — skipping cloudflared download."
fi

# ── TypeScript type-check ────────────────────────────────────────────────────
info "Running TypeScript type-check (pnpm tsc --noEmit)..."
if ! command -v pnpm &>/dev/null; then
    warn "pnpm not found — skipping TypeScript check. Install pnpm to enable this guard."
else
    if ! (cd desktop && pnpm tsc --noEmit 2>&1); then
        echo ""
        fail "TypeScript errors detected. Fix them before releasing (shown above)."
    fi
    ok "TypeScript check passed."
fi

# ── Read current version ─────────────────────────────────────────────────────
CURRENT_VERSION=$(grep -m1 '^version' "$VERSION_FILE" | sed 's/.*"\(.*\)".*/\1/')
[[ -n "$CURRENT_VERSION" ]] || fail "Could not read version from $VERSION_FILE."

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

# ── Calculate new version ────────────────────────────────────────────────────
case "$BUMP_TYPE" in
    patch) NEW_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
    minor) NEW_VERSION="${MAJOR}.$((MINOR + 1)).0" ;;
    major) NEW_VERSION="$((MAJOR + 1)).0.0" ;;
    exact) NEW_VERSION="$EXACT_VERSION" ;;
esac

NEW_TAG="v${NEW_VERSION}"

# ── Check tag doesn't already exist ──────────────────────────────────────────
if git rev-parse "$NEW_TAG" &>/dev/null; then
    fail "Tag $NEW_TAG already exists. Resolve manually or choose a different bump type."
fi

# ── Build commit message ─────────────────────────────────────────────────────
if [[ -n "$CUSTOM_MESSAGE" ]]; then
    COMMIT_MSG="$CUSTOM_MESSAGE"
else
    COMMIT_MSG="release: ${NEW_TAG}"
fi

# ── Preview ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}  ${PROJECT_NAME} release${NC}"
echo -e "  ─────────────────────────────────────────────"
echo -e "  Bump type  : ${CYAN}${BUMP_TYPE}${NC}"
echo -e "  Old version: ${YELLOW}${CURRENT_VERSION}${NC}"
echo -e "  New version: ${GREEN}${NEW_VERSION}${NC}"
echo -e "  Tag        : ${GREEN}${NEW_TAG}${NC}"
echo -e "  Commit msg : ${CYAN}${COMMIT_MSG}${NC}"
$DRY_RUN && echo -e "  Mode       : ${YELLOW}DRY RUN — nothing will be changed${NC}"
echo -e "  ─────────────────────────────────────────────"
echo ""

if $DRY_RUN; then
    preview "Would run: pnpm tsc --noEmit (TypeScript check)"
    preview "Would update $VERSION_FILE: $CURRENT_VERSION → $NEW_VERSION"
    preview "Would update desktop/src-tauri/tauri.conf.json"
    preview "Would update desktop/src-tauri/Cargo.toml"
    preview "Would update desktop/package.json + package-lock.json"
    preview "Would commit: '$COMMIT_MSG'"
    preview "Would create tag: $NEW_TAG"
    preview "Would push to $REMOTE/$BRANCH"
    echo ""
    echo -e "  ${CYAN}run.py and app/api/routes.py read the version dynamically${NC}"
    echo -e "  ${CYAN}from importlib.metadata — no update needed.${NC}"
    echo ""
    preview "Dry run complete. No changes made."
    exit 0
fi

# ── Update pyproject.toml ────────────────────────────────────────────────────
info "Bumping version in $VERSION_FILE..."
sedi "s/^version = \"[^\"]*\"/version = \"${NEW_VERSION}\"/" pyproject.toml
ok "pyproject.toml → $NEW_VERSION"

# ── Update tauri.conf.json ───────────────────────────────────────────────────
info "Syncing desktop/src-tauri/tauri.conf.json..."
sedi "s/^  \"version\": \"[^\"]*\"/  \"version\": \"${NEW_VERSION}\"/" \
    desktop/src-tauri/tauri.conf.json
ok "tauri.conf.json → $NEW_VERSION"

# ── Update Cargo.toml ────────────────────────────────────────────────────────
info "Syncing desktop/src-tauri/Cargo.toml..."
sedi "s/^version = \"[^\"]*\"/version = \"${NEW_VERSION}\"/" \
    desktop/src-tauri/Cargo.toml
ok "Cargo.toml → $NEW_VERSION"

# ── Update desktop/package.json (+ package-lock.json) ────────────────────────
info "Syncing desktop/package.json..."
cd desktop
npm version "$NEW_VERSION" --no-git-tag-version --allow-same-version 2>/dev/null
cd "$REPO_ROOT"
ok "package.json + package-lock.json → $NEW_VERSION"

# ── Commit ───────────────────────────────────────────────────────────────────
info "Committing..."
git add \
    pyproject.toml \
    desktop/src-tauri/tauri.conf.json \
    desktop/src-tauri/Cargo.toml \
    desktop/package.json \
    desktop/package-lock.json
git commit -m "$COMMIT_MSG"
ok "Committed: '$COMMIT_MSG'"

# ── Tag ──────────────────────────────────────────────────────────────────────
info "Creating tag $NEW_TAG..."
git tag "$NEW_TAG"
ok "Tag $NEW_TAG created"

# ── Push ─────────────────────────────────────────────────────────────────────
info "Pushing to $REMOTE/$BRANCH..."
git push "$REMOTE" "$BRANCH"
git push "$REMOTE" "$NEW_TAG"
ok "Pushed to $REMOTE/$BRANCH with tag $NEW_TAG"

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Released ${PROJECT_NAME} ${NEW_VERSION}${NC}"
echo -e "${GREEN}  GitHub Actions will build desktop binaries.${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Monitor : ${CYAN}https://github.com/${GITHUB_REPO}/actions${NC}"
echo -e "  Releases: ${CYAN}https://github.com/${GITHUB_REPO}/releases${NC}"
echo -e "  Mac Trick: ${CYAN}Use: xattr -cr '/Applications/AI Matrx.app' after installation and putting it in Applications folder ${NC}"
echo ""
