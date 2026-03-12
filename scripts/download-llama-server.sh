#!/usr/bin/env bash
#
# Download pre-built llama-server binaries from llama.cpp GitHub releases
# and place them in desktop/src-tauri/binaries/ with the naming Tauri expects:
#   llama-server-<rust-target-triple>[.exe]
#
# Run once before building, or in CI before `tauri build`.
#
# Usage:
#   ./scripts/download-llama-server.sh                        # download all platforms
#   ./scripts/download-llama-server.sh --current              # download only current platform
#   ./scripts/download-llama-server.sh --target <triple>      # download one specific target
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BINARIES_DIR="$SCRIPT_DIR/../desktop/src-tauri/binaries"
mkdir -p "$BINARIES_DIR"

# llama.cpp release version — update when upgrading
LLAMA_FALLBACK_VERSION="b8281"
LLAMA_VERSION=""
LLAMA_BASE=""
LLAMA_REPO="ggml-org/llama.cpp"

ensure_llama_version() {
    [[ -n "$LLAMA_VERSION" ]] && return
    local curl_args=(-fsSL --connect-timeout 5 --max-time 8)
    if [[ -n "${GITHUB_TOKEN:-}" ]]; then
        curl_args+=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
    fi
    local response
    response="$(curl "${curl_args[@]}" "https://api.github.com/repos/${LLAMA_REPO}/releases/latest" 2>/dev/null)" || true
    if [[ -z "$response" ]]; then
        echo "Warning: GitHub API unreachable, using fallback version ${LLAMA_FALLBACK_VERSION}" >&2
        LLAMA_VERSION="$LLAMA_FALLBACK_VERSION"
    else
        local parsed
        parsed="$(echo "$response" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['tag_name'])" 2>/dev/null)" || true
        if [[ -z "$parsed" ]]; then
            echo "Warning: Could not parse GitHub API response, using fallback version ${LLAMA_FALLBACK_VERSION}" >&2
            LLAMA_VERSION="$LLAMA_FALLBACK_VERSION"
        else
            LLAMA_VERSION="$parsed"
        fi
    fi
    LLAMA_BASE="https://github.com/${LLAMA_REPO}/releases/download/${LLAMA_VERSION}"
    echo "  llama.cpp version: ${LLAMA_VERSION}" >&2
}

# Returns the release asset filename for a given Tauri target triple.
# IMPORTANT: Call ensure_llama_version BEFORE calling this in a $() subshell.
llama_asset_for_triple() {
    local ver="$LLAMA_VERSION"
    case "$1" in
        aarch64-apple-darwin)       echo "llama-${ver}-bin-macos-arm64.tar.gz" ;;
        x86_64-apple-darwin)        echo "llama-${ver}-bin-macos-x64.tar.gz" ;;
        x86_64-unknown-linux-gnu)   echo "llama-${ver}-bin-ubuntu-x64.tar.gz" ;;
        aarch64-unknown-linux-gnu)  echo "llama-${ver}-bin-ubuntu-x64.tar.gz" ;;  # fallback — no ARM Linux build
        x86_64-pc-windows-msvc)     echo "llama-${ver}-bin-win-cpu-x64.zip" ;;
        *)                          echo "" ;;
    esac
}

download_target() {
    local triple="$1"
    local asset="$2"
    local ext=""
    [[ "$triple" == *"windows"* ]] && ext=".exe"
    local dest="$BINARIES_DIR/llama-server-${triple}${ext}"

    # Ensure version is resolved
    ensure_llama_version

    # On macOS, check if dylibs also need to be downloaded (they live in the same archive)
    local dylibs_needed=false
    if [[ "$triple" == *"apple-darwin"* ]]; then
        if ! ls "$BINARIES_DIR"/libggml.dylib &>/dev/null; then
            dylibs_needed=true
        fi
    fi

    if [[ -f "$dest" ]] && [[ "$dylibs_needed" == "false" ]]; then
        echo "  ✓ Already exists: $(basename "$dest")"
        return
    fi

    local url="${LLAMA_BASE}/${asset}"
    echo "  ↓ Downloading llama-server ${LLAMA_VERSION} for ${triple} ..."

    local tmp_dir
    tmp_dir="$(mktemp -d)"

    if [[ "$asset" == *.tar.gz ]]; then
        curl -fsSL --progress-bar --connect-timeout 15 --max-time 300 --retry 5 --retry-delay 10 --retry-all-errors -o "$tmp_dir/archive.tar.gz" "$url"
        tar -xzf "$tmp_dir/archive.tar.gz" -C "$tmp_dir" 2>/dev/null || true
        # Find extracted dir
        local extracted_dir
        extracted_dir="$(find "$tmp_dir" -maxdepth 1 -type d | grep -v "^$tmp_dir$" | head -1)"
        [[ -z "$extracted_dir" ]] && extracted_dir="$tmp_dir"

        # Copy the server binary
        if [[ ! -f "$dest" ]]; then
            local server_bin
            server_bin="$(find "$extracted_dir" -name "llama-server" -type f | head -1)"
            if [[ -z "$server_bin" ]]; then
                rm -rf "$tmp_dir"
                echo "  ✗ ERROR: llama-server not found in archive" >&2
                return 1
            fi
            cp "$server_bin" "$dest"
            chmod +x "$dest"
            echo "  ✓ Saved: $(basename "$dest")"
        fi

        # On macOS: copy all .dylib files so the server can find them at runtime
        if [[ "$triple" == *"apple-darwin"* ]]; then
            local dylib_count=0
            while IFS= read -r -d '' lib; do
                cp "$lib" "$BINARIES_DIR/"
                (( dylib_count++ )) || true
            done < <(find "$extracted_dir" -name "*.dylib" -type f -print0)
            if (( dylib_count > 0 )); then
                echo "  ✓ Copied ${dylib_count} dylib(s) to binaries/"
            fi

            # Rewrite the llama-server binary's rpath so it can locate the dylibs
            # in two locations:
            #   1. @executable_path          — dev mode: dylibs next to the binary
            #   2. @executable_path/../Resources/binaries
            #                                — production app bundle (Tauri resources)
            #
            # The @rpath entries baked in by the llama.cpp build point to an
            # absolute build-machine path and won't work on end-user machines.
            if [[ -f "$dest" ]] && command -v install_name_tool &>/dev/null; then
                # Remove all existing rpaths (the absolute ones from the build machine)
                while IFS= read -r rpath_entry; do
                    install_name_tool -delete_rpath "$rpath_entry" "$dest" 2>/dev/null || true
                done < <(otool -l "$dest" 2>/dev/null | grep -A2 'LC_RPATH' | awk '/path /{print $2}')

                # Add the two paths we actually need
                install_name_tool -add_rpath "@executable_path" "$dest" 2>/dev/null || true
                install_name_tool -add_rpath "@executable_path/../Resources/binaries" "$dest" 2>/dev/null || true
                echo "  ✓ Rewrote rpath: @executable_path + @executable_path/../Resources/binaries"
            fi
        fi

    elif [[ "$asset" == *.zip ]]; then
        curl -fsSL --progress-bar --connect-timeout 15 --max-time 300 --retry 5 --retry-delay 10 --retry-all-errors -o "$tmp_dir/archive.zip" "$url"
        if command -v unzip &>/dev/null; then
            unzip -q "$tmp_dir/archive.zip" -d "$tmp_dir/extracted"
        else
            python3 -c "import zipfile; zipfile.ZipFile('$tmp_dir/archive.zip').extractall('$tmp_dir/extracted')"
        fi
        local server_bin
        server_bin="$(find "$tmp_dir/extracted" -name "llama-server.exe" -type f | head -1)"
        if [[ -z "$server_bin" ]]; then
            rm -rf "$tmp_dir"
            echo "  ✗ ERROR: llama-server.exe not found in archive" >&2
            return 1
        fi
        cp "$server_bin" "$dest"
        echo "  ✓ Saved: $(basename "$dest")"
    fi

    rm -rf "$tmp_dir"
}

MODE="${1:-all}"

case "$MODE" in
    --target)
        triple="${2:-}"
        [[ -n "$triple" ]] || { echo "ERROR: --target requires a target triple."; exit 1; }
        ensure_llama_version
        asset="$(llama_asset_for_triple "$triple")"
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
        ensure_llama_version
        asset="$(llama_asset_for_triple "$triple")"
        download_target "$triple" "$asset"
        ;;
    all|"")
        ensure_llama_version
        for triple in \
            aarch64-apple-darwin \
            x86_64-apple-darwin \
            x86_64-unknown-linux-gnu \
            x86_64-pc-windows-msvc
        do
            asset="$(llama_asset_for_triple "$triple")"
            download_target "$triple" "$asset"
        done
        ;;
    *)
        echo "Usage: $0 [--current | --target <triple> | all]"
        exit 1
        ;;
esac

echo ""
echo "llama-server binaries in $BINARIES_DIR:"
ls -lh "$BINARIES_DIR"/llama-server-* 2>/dev/null || echo "  (none)"
