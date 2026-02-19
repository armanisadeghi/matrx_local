#!/usr/bin/env bash
# Update the scraper-service subtree from the ai-dream repo.
#
# Usage:
#   ./scripts/update-scraper.sh          # pull from remote GitHub
#   ./scripts/update-scraper.sh --local  # pull from local ai-dream repo
#
# This re-splits the scraper-service subdirectory from ai-dream/main,
# then merges it into this repo's scraper-service/ directory.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

LOCAL_AI_DREAM="/home/arman/projects/ai-dream"
REMOTE_URL="https://github.com/AI-Matrix-Engine/aidream-current.git"

if [[ "${1:-}" == "--local" ]]; then
    echo "Using local ai-dream repo at $LOCAL_AI_DREAM"

    echo "Step 1: Re-splitting scraper-service branch in ai-dream..."
    (cd "$LOCAL_AI_DREAM" && git subtree split --prefix=scraper-service -b scraper-service-split --rejoin 2>/dev/null || \
     cd "$LOCAL_AI_DREAM" && git subtree split --prefix=scraper-service -b scraper-service-split)

    echo "Step 2: Setting remote to local path..."
    git remote set-url ai-dream "$LOCAL_AI_DREAM"

    echo "Step 3: Pulling subtree updates..."
    git subtree pull --prefix=scraper-service ai-dream scraper-service-split --squash -m "Update scraper-service from ai-dream (local)"

    echo "Step 4: Restoring remote URL..."
    git remote set-url ai-dream "$REMOTE_URL"
else
    echo "Using remote GitHub repo"

    echo "Step 1: Re-splitting scraper-service branch in ai-dream..."
    (cd "$LOCAL_AI_DREAM" && git subtree split --prefix=scraper-service -b scraper-service-split --rejoin 2>/dev/null || \
     cd "$LOCAL_AI_DREAM" && git subtree split --prefix=scraper-service -b scraper-service-split)

    echo "Step 2: Pushing split branch to GitHub..."
    (cd "$LOCAL_AI_DREAM" && git push origin scraper-service-split)

    echo "Step 3: Setting remote to GitHub..."
    git remote set-url ai-dream "$REMOTE_URL"

    echo "Step 4: Pulling subtree updates..."
    git subtree pull --prefix=scraper-service ai-dream scraper-service-split --squash -m "Update scraper-service from ai-dream"
fi

echo ""
echo "Done! scraper-service/ is up to date."
echo "Run 'uv sync --extra browser' to update dependencies if pyproject.toml changed."
