#!/usr/bin/env bash
#
# Download cloudflared binaries for Tauri target platforms and place them in
# desktop/src-tauri/sidecar/ with the naming Tauri expects:
#   cloudflared-<rust-target-triple>[.exe]
#
# Run once before building, or in CI before `tauri build`.
#
# Usage:
#   ./scripts/download-cloudflared.sh                        # download all platforms
#   ./scripts/download-cloudflared.sh --current              # download only current platform
#   ./scripts/download-cloudflared.sh --target <triple>      # download one specific target
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SIDECAR_DIR="$SCRIPT_DIR/../desktop/src-tauri/sidecar"
mkdir -p "$SIDECAR_DIR"

# Resolve the latest cloudflared version from GitHub API.
# Passes GITHUB_TOKEN if set (avoids 60 req/hr rate limit on shared CI runners).
# Falls back to a known-good version if the API is unreachable or rate-limited.
CF_FALLBACK_VERSION="2026.2.0"
resolve_cf_version() {
    local curl_args=(-fsSL)
    if [[ -n "${GITHUB_TOKEN:-}" ]]; then
        curl_args+=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
    fi
    local response
    response="$(curl "${curl_args[@]}" "https://api.github.com/repos/cloudflare/cloudflared/releases/latest" 2>/dev/null)" || true
    if [[ -z "$response" ]]; then
        echo "Warning: GitHub API unreachable, using fallback version ${CF_FALLBACK_VERSION}" >&2
        echo "${CF_FALLBACK_VERSION}"
        return
    fi
    python3 -c "import json,sys; print(json.load(sys.stdin)['tag_name'])" <<< "$response" 2>/dev/null \
        || { echo "Warning: Could not parse GitHub API response, using fallback version ${CF_FALLBACK_VERSION}" >&2; echo "${CF_FALLBACK_VERSION}"; }
}

CF_VERSION="$(resolve_cf_version)"
CF_BASE="https://github.com/cloudflare/cloudflared/releases/download/${CF_VERSION}"
echo "  cloudflared version: ${CF_VERSION}"

# Returns the release asset filename for a given Tauri target triple.
cf_asset_for_triple() {
    case "$1" in
        aarch64-apple-darwin)       echo "cloudflared-darwin-arm64.tgz" ;;
        x86_64-apple-darwin)        echo "cloudflared-darwin-amd64.tgz" ;;
        x86_64-unknown-linux-gnu)   echo "cloudflared-linux-amd64" ;;
        aarch64-unknown-linux-gnu)  echo "cloudflared-linux-arm64" ;;
        x86_64-pc-windows-msvc)     echo "cloudflared-windows-amd64.exe" ;;
        *)                          echo "" ;;
    esac
}

download_target() {
    local triple="$1"
    local asset="$2"
    local ext=""
    [[ "$asset" == *.exe ]] && ext=".exe"
    local dest="$SIDECAR_DIR/cloudflared-${triple}${ext}"

    if [[ -f "$dest" ]]; then
        echo "  ✓ Already exists: $(basename "$dest")"
        return
    fi

    local url="${CF_BASE}/${asset}"
    echo "  ↓ Downloading cloudflared ${CF_VERSION} for ${triple} ..."

    if [[ "$asset" == *.tgz ]]; then
        # macOS assets are tarballs containing a single `cloudflared` binary
        local tmp_dir
        tmp_dir="$(mktemp -d)"
        curl -fsSL --progress-bar -o "$tmp_dir/cloudflared.tgz" "$url"
        tar -xzf "$tmp_dir/cloudflared.tgz" -C "$tmp_dir"
        # The binary inside is named `cloudflared`
        mv "$tmp_dir/cloudflared" "$dest"
        rm -rf "$tmp_dir"
    else
        curl -fsSL --progress-bar -o "$dest" "$url"
    fi

    [[ "$ext" != ".exe" ]] && chmod +x "$dest"
    echo "  ✓ Saved: $(basename "$dest")"
}

MODE="${1:-all}"

case "$MODE" in
    --target)
        triple="${2:-}"
        [[ -n "$triple" ]] || { echo "ERROR: --target requires a target triple."; exit 1; }
        asset="$(cf_asset_for_triple "$triple")"
        [[ -n "$asset" ]] || { echo "ERROR: Unknown target triple: $triple"; exit 1; }
        download_target "$triple" "$asset"
        ;;
    --current)
        OS="$(uname -s)"
        ARCH="$(uname -m)"
        case "$OS-$ARCH" in
            Darwin-arm64)   triple="aarch64-apple-darwin" ;;
            Darwin-x86_64)  triple="x86_64-apple-darwin" ;;
            Linux-x86_64)   triple="x86_64-unknown-linux-gnu" ;;
            Linux-aarch64)  triple="aarch64-unknown-linux-gnu" ;;
            *) echo "ERROR: Unknown platform $OS-$ARCH"; exit 1 ;;
        esac
        asset="$(cf_asset_for_triple "$triple")"
        download_target "$triple" "$asset"
        ;;
    all|"")
        for triple in \
            aarch64-apple-darwin \
            x86_64-apple-darwin \
            x86_64-unknown-linux-gnu \
            aarch64-unknown-linux-gnu \
            x86_64-pc-windows-msvc
        do
            asset="$(cf_asset_for_triple "$triple")"
            download_target "$triple" "$asset"
        done
        ;;
    *)
        echo "Usage: $0 [--current | --target <triple> | all]"
        exit 1
        ;;
esac

echo ""
echo "cloudflared binaries in $SIDECAR_DIR:"
ls -lh "$SIDECAR_DIR"/cloudflared-* 2>/dev/null || echo "  (none)"
