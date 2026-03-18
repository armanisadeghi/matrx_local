#!/usr/bin/env bash
# Update the scraper-service subtree from the aidream repo.
#
# Usage:
#   ./scripts/update-scraper.sh          # pull from remote GitHub
#   ./scripts/update-scraper.sh --local  # pull from local aidream repo
#
# How this works:
#   The original subtree was added with --squash, which baked in a split hash
#   that the remote no longer advertises. Rather than fight the broken subtree
#   history, this script uses `git fetch` + `git diff-tree` to find changed files
#   and writes them directly — then commits the result as a clean update commit.
#   This is equivalent to what git subtree pull would do, just without the
#   bookkeeping metadata that was already corrupted.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ── Preflight checks ─────────────────────────────────────────────────────────
if ! command -v git &>/dev/null; then
    echo "ERROR: git is not installed." >&2
    exit 1
fi

if ! git rev-parse --is-inside-work-tree &>/dev/null; then
    echo "ERROR: Not inside a git repository." >&2
    exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "ERROR: You have uncommitted changes." >&2
    echo "       Commit or stash them before updating the scraper subtree." >&2
    exit 1
fi

# Path to your local clone of the aidream repo (only needed for --local mode).
# Override by setting the LOCAL_AI_DREAM environment variable before running.
LOCAL_AI_DREAM="${LOCAL_AI_DREAM:-$HOME/projects/aidream}"
REMOTE_URL="https://github.com/AI-Matrix-Engine/aidream-current.git"

# Ensure the 'aidream' remote exists, creating it if needed.
ensure_remote() {
    local url="$1"
    if git remote get-url aidream &>/dev/null; then
        git remote set-url aidream "$url"
    else
        git remote add aidream "$url"
    fi
}

# Apply changed files from a given git tree into scraper-service/.
apply_subtree_changes() {
    local remote_ref="$1"   # e.g. FETCH_HEAD:scraper-service or aidream/scraper-service-split

    local changed_files
    changed_files="$(git diff-tree --name-only -r "HEAD:scraper-service" "${remote_ref}" 2>/dev/null || true)"

    if [[ -z "$changed_files" ]]; then
        echo "scraper-service/ is already up to date."
        return 0
    fi

    echo "$changed_files" | while IFS= read -r f; do
        local src="${remote_ref%:*}:scraper-service/$f"    # remote tree path
        local dst="scraper-service/$f"
        mkdir -p "$(dirname "$dst")"
        if git cat-file -e "${remote_ref%:*}:scraper-service/$f" 2>/dev/null; then
            git show "${remote_ref%:*}:scraper-service/$f" > "$dst"
            echo "  updated: $f"
        else
            echo "  skipped (not in remote): $f"
        fi
    done

    # Stage and commit
    git add scraper-service/
    git commit -m "${2:-Update scraper-service from aidream}"
}

if [[ "${1:-}" == "--local" ]]; then
    if [[ ! -d "$LOCAL_AI_DREAM" ]]; then
        echo "ERROR: Local aidream repo not found at '$LOCAL_AI_DREAM'."
        echo "Set the LOCAL_AI_DREAM environment variable to your local clone path and try again."
        exit 1
    fi

    echo "Using local aidream repo at $LOCAL_AI_DREAM"

    echo "Step 1: Re-splitting scraper-service branch in aidream..."
    (cd "$LOCAL_AI_DREAM" && git subtree split --prefix=scraper-service -b scraper-service-split --rejoin 2>/dev/null || \
     cd "$LOCAL_AI_DREAM" && git subtree split --prefix=scraper-service -b scraper-service-split)

    echo "Step 2: Setting remote to local path..."
    ensure_remote "$LOCAL_AI_DREAM"

    echo "Step 3: Fetching and applying changes..."
    git fetch aidream scraper-service-split
    apply_subtree_changes "FETCH_HEAD:." "Update scraper-service from aidream (local)"

    echo "Step 4: Restoring remote URL..."
    ensure_remote "$REMOTE_URL"
else
    echo "Using remote GitHub repo"

    echo "Step 1: Fetching from GitHub..."
    ensure_remote "$REMOTE_URL"
    git fetch aidream main

    echo "Step 2: Applying changes from scraper-service/..."
    # Uses diff-tree to find only files that changed under scraper-service/
    # then writes them directly — avoids the broken --squash split-hash issue.

    local_tree="$(git rev-parse HEAD:scraper-service 2>/dev/null || true)"
    remote_tree="$(git rev-parse FETCH_HEAD:scraper-service 2>/dev/null || true)"

    if [[ "$local_tree" == "$remote_tree" ]]; then
        echo "scraper-service/ is already up to date."
    else
        # --diff-filter=d excludes files deleted from remote (local-only files like .cursorignore won't appear)
        changed_files="$(git diff-tree --name-only --diff-filter=d -r HEAD:scraper-service FETCH_HEAD:scraper-service)"

        if [[ -z "$changed_files" ]]; then
            echo "scraper-service/ is already up to date."
        else
            echo "Files to update:"
            echo "$changed_files" | sed 's/^/  /'

            echo "$changed_files" | while IFS= read -r f; do
                dst="scraper-service/$f"
                mkdir -p "$(dirname "$dst")"
                git show "FETCH_HEAD:scraper-service/$f" > "$dst"
            done

            git add scraper-service/
            if ! git diff --cached --quiet; then
                git commit -m "Update scraper-service from aidream ($(git rev-parse --short FETCH_HEAD))"
            else
                echo "No changes to commit."
            fi
        fi
    fi
fi

echo ""
echo "Done! scraper-service/ is up to date."
echo "Run 'uv sync' to update dependencies if pyproject.toml changed."
