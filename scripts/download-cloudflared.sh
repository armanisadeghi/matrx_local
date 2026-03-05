#!/usr/bin/env bash
#
# Download cloudflared binaries for all supported Tauri target platforms
# and place them in desktop/src-tauri/sidecar/ following Tauri's naming
# convention: cloudflared-<rust-target-triple>
#
# Run this once before building a release, or in CI before `tauri build`.
#
# Usage:
#   ./scripts/download-cloudflared.sh           # download all platforms
#   ./scripts/download-cloudflared.sh --current # download only current platform
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SIDECAR_DIR="$SCRIPT_DIR/../desktop/src-tauri/sidecar"
mkdir -p "$SIDECAR_DIR"

# Pin to a known-good release. Update when Cloudflare releases security fixes.
CF_VERSION="2026.2.0"
CF_BASE="https://github.com/cloudflare/cloudflared/releases/download/${CF_VERSION}"

# Maps Tauri target triple → cloudflared release filename
declare -A TARGETS=(
  ["aarch64-apple-darwin"]="cloudflared-darwin-arm64"
  ["x86_64-apple-darwin"]="cloudflared-darwin-amd64"
  ["x86_64-unknown-linux-gnu"]="cloudflared-linux-amd64"
  ["aarch64-unknown-linux-gnu"]="cloudflared-linux-arm64"
  ["x86_64-pc-windows-msvc"]="cloudflared-windows-amd64.exe"
)

download_target() {
  local triple="$1"
  local filename="$2"
  local ext=""
  [[ "$filename" == *.exe ]] && ext=".exe"
  local dest="$SIDECAR_DIR/cloudflared-${triple}${ext}"

  if [[ -f "$dest" ]]; then
    echo "✓ Already exists: $(basename "$dest")"
    return
  fi

  local url="${CF_BASE}/${filename}"
  echo "↓ Downloading cloudflared ${CF_VERSION} for ${triple} ..."
  curl -fsSL --progress-bar -o "$dest" "$url"

  if [[ "$ext" != ".exe" ]]; then
    chmod +x "$dest"
  fi
  echo "✓ Saved: $(basename "$dest")"
}

MODE="${1:-}"
TARGET_OVERRIDE="${2:-}"

if [[ "$MODE" == "--target" ]]; then
  # Download a single explicit target triple (used by CI per-platform)
  triple="$TARGET_OVERRIDE"
  [[ -n "$triple" ]] || { echo "ERROR: --target requires a target triple argument"; exit 1; }
  filename="${TARGETS[$triple]:-}"
  [[ -n "$filename" ]] || { echo "ERROR: Unknown target triple: $triple"; exit 1; }
  download_target "$triple" "$filename"
elif [[ "$MODE" == "--current" ]]; then
  # Detect current platform
  OS="$(uname -s)"
  ARCH="$(uname -m)"
  case "$OS-$ARCH" in
    Darwin-arm64)   download_target "aarch64-apple-darwin"        "cloudflared-darwin-arm64" ;;
    Darwin-x86_64)  download_target "x86_64-apple-darwin"         "cloudflared-darwin-amd64" ;;
    Linux-x86_64)   download_target "x86_64-unknown-linux-gnu"    "cloudflared-linux-amd64" ;;
    Linux-aarch64)  download_target "aarch64-unknown-linux-gnu"   "cloudflared-linux-arm64" ;;
    *)              echo "Unknown platform $OS-$ARCH" ; exit 1 ;;
  esac
else
  # Download all platforms (default — for local dev setup)
  for triple in "${!TARGETS[@]}"; do
    download_target "$triple" "${TARGETS[$triple]}"
  done
fi

echo ""
echo "All cloudflared binaries ready in $SIDECAR_DIR"
ls -lh "$SIDECAR_DIR"/cloudflared-*
