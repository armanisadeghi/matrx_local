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
#   ./scripts/release.sh --monitor    # push then poll GitHub Actions until done
#   ./scripts/release.sh --monitor-only # just monitor the latest tag (no release)
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

# ── Monitor function ────────────────────────────────────────────────────────
monitor_build() {
    local tag="$1"
    local version="$2"
    local repo="$3"
    local start_epoch
    start_epoch=$(date +%s)

    # Platform keys and labels (parallel arrays for bash 3 compat)
    local PLATFORM_KEYS=("aarch64-apple-darwin" "x86_64-apple-darwin" "ubuntu" "windows")
    local PLATFORM_LABELS=("macOS ARM" "macOS x86" "Linux" "Windows")

    # ── Status icon helper ──────────────────────────────────────────────
    status_icon() {
        local status="$1" conclusion="$2"
        if [[ "$status" == "completed" ]]; then
            case "$conclusion" in
                success)   echo -e "${GREEN}✅${NC}" ;;
                failure)   echo -e "${RED}❌${NC}" ;;
                cancelled) echo -e "⚪" ;;
                skipped)   echo -e "⏭️" ;;
                *)         echo -e "${RED}❌${NC}" ;;
            esac
        elif [[ "$status" == "in_progress" ]]; then
            echo -e "${YELLOW}🔨${NC}"
        else
            echo -e "${CYAN}🔵${NC}"
        fi
    }

    # ── Status color helper ─────────────────────────────────────────────
    status_color() {
        local status="$1" conclusion="$2"
        if [[ "$status" == "completed" ]]; then
            case "$conclusion" in
                success) echo "$GREEN" ;;
                failure) echo "$RED" ;;
                *)       echo "$YELLOW" ;;
            esac
        elif [[ "$status" == "in_progress" ]]; then
            echo "$YELLOW"
        else
            echo "$CYAN"
        fi
    }

    # ── Current step helper ─────────────────────────────────────────────
    current_step() {
        local jobs_json="$1" job_index="$2"
        # Find the last in_progress step, or the last completed step
        local step
        step=$(echo "$jobs_json" | jq -r ".jobs[$job_index].steps[] | select(.status==\"in_progress\") | .name" 2>/dev/null | tail -1)
        if [[ -z "$step" ]]; then
            step=$(echo "$jobs_json" | jq -r ".jobs[$job_index].steps[] | select(.status==\"completed\") | .name" 2>/dev/null | tail -1)
        fi
        echo "${step:-waiting...}"
    }

    # ── Wait for workflow run to appear ─────────────────────────────────
    echo ""
    info "Waiting for GitHub Actions workflow to start for tag ${BOLD}${tag}${NC}..."
    local run_id=""
    for attempt in $(seq 1 24); do  # up to ~2 minutes
        run_id=$(
            gh run list --repo "$repo" --limit 5 \
                --json databaseId,headBranch,name,status \
            | jq -r ".[] | select(.headBranch==\"$tag\" and .name==\"Release\") | .databaseId" \
            | head -1
        )
        [[ -n "$run_id" ]] && break
        sleep 5
    done

    if [[ -z "$run_id" ]]; then
        warn "Could not find a workflow run for tag ${tag} after 2 minutes."
        echo -e "  Check manually: ${CYAN}https://github.com/${repo}/actions${NC}"
        return 1
    fi

    ok "Found workflow run ${BOLD}#${run_id}${NC}"
    echo ""

    # ── Poll loop ───────────────────────────────────────────────────────
    local all_done=false
    while ! $all_done; do
        local now_epoch
        now_epoch=$(date +%s)
        local elapsed=$(( now_epoch - start_epoch ))
        local mins=$(( elapsed / 60 ))
        local secs=$(( elapsed % 60 ))
        local elapsed_str
        elapsed_str=$(printf "%02d:%02d" "$mins" "$secs")

        # Fetch job data
        local jobs_json
        jobs_json=$(gh run view "$run_id" --repo "$repo" --json jobs 2>/dev/null || echo '{"jobs":[]}')
        local job_count
        job_count=$(echo "$jobs_json" | jq '.jobs | length')

        # Clear screen and draw
        printf '\033[2J\033[H'
        echo ""
        echo -e "${BOLD}  📦 ${PROJECT_NAME} ${version} — Build Monitor${NC}"
        echo -e "  ─────────────────────────────────────────────────────────────"
        echo -e "  Tag: ${GREEN}${tag}${NC}    Elapsed: ${CYAN}${elapsed_str}${NC}    Jobs: ${BOLD}${job_count}/4${NC}"
        echo -e "  ─────────────────────────────────────────────────────────────"
        echo ""

        local completed_count=0
        local any_failed=false
        local failed_platforms=()

        if [[ "$job_count" -eq 0 ]]; then
            echo -e "  ${CYAN}🔵 Waiting for jobs to be created...${NC}"
        else
            # Match jobs to platform keys by scanning job names
            local i
            for i in 0 1 2 3; do
                local key="${PLATFORM_KEYS[$i]}"
                local label="${PLATFORM_LABELS[$i]}"
                local padded_label
                padded_label=$(printf '%-12s' "$label")

                # Find this job's index in the JSON
                local job_index
                job_index=$(echo "$jobs_json" | jq -r \
                    "[.jobs[].name] | to_entries[] | select(.value | test(\"$key\")) | .key" 2>/dev/null | head -1)

                if [[ -z "$job_index" ]]; then
                    echo -e "  🔵 ${CYAN}${padded_label}${NC}  waiting..."
                    continue
                fi

                local j_status j_conclusion
                j_status=$(echo "$jobs_json" | jq -r ".jobs[$job_index].status")
                j_conclusion=$(echo "$jobs_json" | jq -r ".jobs[$job_index].conclusion // \"\"")

                local icon color step
                icon=$(status_icon "$j_status" "$j_conclusion")
                color=$(status_color "$j_status" "$j_conclusion")
                step=$(current_step "$jobs_json" "$job_index")

                # Truncate step name if too long
                [[ ${#step} -gt 42 ]] && step="${step:0:39}..."

                echo -e "  ${icon} ${color}${padded_label}${NC}  ${step}"

                if [[ "$j_status" == "completed" ]]; then
                    (( completed_count++ ))
                    if [[ "$j_conclusion" != "success" ]]; then
                        any_failed=true
                        failed_platforms+=("$label")
                    fi
                fi
            done
        fi

        echo ""
        echo -e "  ─────────────────────────────────────────────────────────────"

        # Check overall run status
        local run_status
        run_status=$(gh run view "$run_id" --repo "$repo" --json status --jq '.status' 2>/dev/null || echo "unknown")

        if [[ "$run_status" == "completed" ]] || [[ "$completed_count" -ge 4 && "$job_count" -ge 4 ]]; then
            all_done=true

            # Final elapsed time
            now_epoch=$(date +%s)
            elapsed=$(( now_epoch - start_epoch ))
            mins=$(( elapsed / 60 ))
            secs=$(( elapsed % 60 ))
            elapsed_str=$(printf "%02d:%02d" "$mins" "$secs")

            echo ""
            if $any_failed; then
                echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
                echo -e "${RED}  ❌ BUILD FAILED  (${elapsed_str})${NC}"
                echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
                echo ""
                echo -e "  Failed platforms:"
                for fp in "${failed_platforms[@]}"; do
                    echo -e "    ${RED}✗${NC} ${fp}"
                done
                echo ""
                echo -e "  Debug: ${CYAN}https://github.com/${repo}/actions/runs/${run_id}${NC}"
            else
                local RELEASE_URL="https://github.com/${repo}/releases/tag/${tag}"
                echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
                echo -e "${GREEN}  ✅ ALL BUILDS PASSED  (${elapsed_str})${NC}"
                echo -e "${GREEN}  🚀 Release is LIVE!${NC}"
                echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
                echo ""
                echo -e "  🔗 ${BOLD}${RELEASE_URL}${NC}"
                echo ""
                echo -e "  Mac Trick: ${CYAN}xattr -cr '/Applications/AI Matrx.app'${NC}"
            fi
            echo ""
        else
            echo -e "  ${CYAN}Refreshing in 15s...  Press Ctrl-C to stop monitoring.${NC}"
            echo ""
            sleep 15
        fi
    done
}

# ── Parse flags ──────────────────────────────────────────────────────────────
BUMP_TYPE="patch"
CUSTOM_MESSAGE=""
DRY_RUN=false
MONITOR=false
MONITOR_ONLY=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --patch)   BUMP_TYPE="patch"; shift ;;
        --minor)   BUMP_TYPE="minor"; shift ;;
        --major)   BUMP_TYPE="major"; shift ;;
        --message|-m)
            [[ -n "${2:-}" ]] || fail "--message requires an argument."
            CUSTOM_MESSAGE="$2"; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        --monitor) MONITOR=true; shift ;;
        --monitor-only) MONITOR_ONLY=true; shift ;;
        -h|--help)
            grep '^#' "$0" | head -20 | sed 's/^# \?//'
            exit 0 ;;
        [0-9]*)    BUMP_TYPE="exact"; EXACT_VERSION="$1"; shift ;;
        *) fail "Unknown flag: $1. Use --patch, --minor, --major, --message, --monitor, --monitor-only, --dry-run, or X.Y.Z." ;;
    esac
done

# ── Monitor-only shortcut ────────────────────────────────────────────────────
if $MONITOR_ONLY; then
    [[ -f "$VERSION_FILE" ]] || fail "$VERSION_FILE not found."
    CURRENT_VERSION=$(grep -m1 '^version' "$VERSION_FILE" | sed 's/.*"\(.*\)".*/\1/')
    [[ -n "$CURRENT_VERSION" ]] || fail "Could not read version from $VERSION_FILE."
    LATEST_TAG="v${CURRENT_VERSION}"
    info "Monitor-only mode — watching builds for ${BOLD}${LATEST_TAG}${NC}"
    monitor_build "$LATEST_TAG" "$CURRENT_VERSION" "$GITHUB_REPO"
    exit $?
fi

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

# ── Ensure llama-server sidecar binary exists for current platform ────────────
info "Ensuring llama-server sidecar binary is present..."
if [[ -f "scripts/download-llama-server.sh" ]]; then
    chmod +x scripts/download-llama-server.sh
    ./scripts/download-llama-server.sh --current
    ok "llama-server sidecar ready."
else
    warn "scripts/download-llama-server.sh not found — skipping llama-server download."
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
$MONITOR  && echo -e "  Monitor    : ${CYAN}Will poll GitHub Actions every 15s${NC}"
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
    $MONITOR && preview "Would monitor GitHub Actions builds until completion"
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

# ── Start monitor if requested ───────────────────────────────────────────────
if $MONITOR; then
    monitor_build "$NEW_TAG" "$NEW_VERSION" "$GITHUB_REPO"
fi
