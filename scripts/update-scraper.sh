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

LOCAL_AI_DREAM="/home/arman/projects/aidream"
REMOTE_URL="https://github.com/AI-Matrix-Engine/aidream-current.git"

if [[ "${1:-}" == "--local" ]]; then
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

    echo "Step 1: Re-splitting scraper-service branch in aidream..."
    (cd "$LOCAL_AI_DREAM" && git subtree split --prefix=scraper-service -b scraper-service-split --rejoin 2>/dev/null || \
     cd "$LOCAL_AI_DREAM" && git subtree split --prefix=scraper-service -b scraper-service-split)

    echo "Step 2: Pushing split branch to GitHub..."
    (cd "$LOCAL_AI_DREAM" && git push origin scraper-service-split)

    echo "Step 3: Setting remote to GitHub..."
    git remote set-url aidream "$REMOTE_URL"

    echo "Step 4: Pulling subtree updates..."
    git subtree pull --prefix=scraper-service aidream scraper-service-split --squash -m "Update scraper-service from aidream"
fi

echo ""
echo "Done! scraper-service/ is up to date."
echo "Run 'uv sync --extra browser' to update dependencies if pyproject.toml changed."
