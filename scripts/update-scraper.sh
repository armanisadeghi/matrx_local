#!/usr/bin/env bash
# Update the scraper-service subtree from the aidream repo.
#
# Usage:
#   ./scripts/update-scraper.sh          # pull from remote GitHub
#   ./scripts/update-scraper.sh --local  # pull from local aidream repo
#
# This re-splits the scraper-service subdirectory from aidream/main,
# then merges it into this repo's scraper-service/ directory.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Path to your local clone of the aidream repo (only needed for --local mode).
# Override by setting the LOCAL_AI_DREAM environment variable before running.
LOCAL_AI_DREAM="${LOCAL_AI_DREAM:-$HOME/projects/aidream}"
REMOTE_URL="https://github.com/AI-Matrix-Engine/aidream-current.git"

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
    git remote set-url aidream "$LOCAL_AI_DREAM"

    echo "Step 3: Pulling subtree updates..."
    git subtree pull --prefix=scraper-service aidream scraper-service-split --squash -m "Update scraper-service from aidream (local)"

    echo "Step 4: Restoring remote URL..."
    git remote set-url aidream "$REMOTE_URL"
else
    echo "Using remote GitHub repo"

    echo "Step 1: Pulling subtree updates from GitHub..."
    git remote set-url aidream "$REMOTE_URL"

    echo "Step 2: Pulling subtree updates..."
    git subtree pull --prefix=scraper-service aidream main --squash -m "Update scraper-service from aidream"
fi

echo ""
echo "Done! scraper-service/ is up to date."
echo "Run 'uv sync --extra browser' to update dependencies if pyproject.toml changed."
