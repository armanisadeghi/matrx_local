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

# llama.cpp release version — update when upgrading.
# PIN to a known-good release whose assets are fully uploaded and verified.
# Using "latest" is racy: llama.cpp publishes releases before asset uploads
# complete, so CI can 404 if it resolves `latest` during that window.
LLAMA_VERSION="b8519"
LLAMA_BASE=""
LLAMA_REPO="ggml-org/llama.cpp"

ensure_llama_version() {
    LLAMA_BASE="https://github.com/${LLAMA_REPO}/releases/download/${LLAMA_VERSION}"
    echo "  llama.cpp version: ${LLAMA_VERSION}" >&2
}

# Returns the release asset filename for a given Tauri target triple.
# IMPORTANT: Call ensure_llama_version BEFORE calling this in a $() subshell.
#
# Windows binary selection:
#   We ship the Vulkan build instead of the CPU-only build.
#   Vulkan works on NVIDIA, AMD, and Intel GPUs via a single binary — it is
#   effectively the universal GPU backend on Windows. The Vulkan runtime is
#   pre-installed with all modern GPU drivers (NVIDIA 2019+, AMD 2019+, Intel).
#   For CPU-only machines the Vulkan binary falls back to CPU inference, so it
#   is strictly better than the CPU-only build for all users.
llama_asset_for_triple() {
    local ver="$LLAMA_VERSION"
    case "$1" in
        aarch64-apple-darwin)       echo "llama-${ver}-bin-macos-arm64.tar.gz" ;;
        x86_64-apple-darwin)        echo "llama-${ver}-bin-macos-x64.tar.gz" ;;
        x86_64-unknown-linux-gnu)   echo "llama-${ver}-bin-ubuntu-x64.tar.gz" ;;
        aarch64-unknown-linux-gnu)  echo "llama-${ver}-bin-ubuntu-x64.tar.gz" ;;  # fallback — no ARM Linux build
        x86_64-pc-windows-msvc)     echo "llama-${ver}-bin-win-vulkan-x64.zip" ;;
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

    # On macOS, check if dylibs also need to be downloaded (they live in the same archive).
    # Check for the soname variant (.0.dylib) — this is what the binary's @rpath looks for.
    local dylibs_needed=false
    if [[ "$triple" == *"apple-darwin"* ]]; then
        if ! ls "$BINARIES_DIR"/libggml.0.dylib &>/dev/null; then
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
        curl -fsSL --progress-bar --connect-timeout 15 --max-time 300 --retry 3 --retry-delay 15 --retry-all-errors -o "$tmp_dir/archive.tar.gz" "$url"
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

        # On macOS: copy all .dylib files so the server can find them at runtime.
        # Use -type f -o -type l to capture both real files AND symlinks — the
        # llama.cpp archive ships versioned files (e.g. libmtmd.0.0.8281.dylib)
        # plus soname symlinks (libmtmd.0.dylib) and unversioned symlinks
        # (libmtmd.dylib). The binary's @rpath entries reference the soname
        # variant (libmtmd.0.dylib), so all three variants must be present.
        if [[ "$triple" == *"apple-darwin"* ]]; then
            local dylib_count=0
            while IFS= read -r -d '' lib; do
                local libname
                libname="$(basename "$lib")"
                if [[ -L "$lib" ]]; then
                    # Resolve symlink target and copy as a plain file so the
                    # bundle contains real files (not dangling symlinks).
                    local resolved
                    resolved="$(readlink -f "$lib" 2>/dev/null)" || resolved=""
                    if [[ -n "$resolved" && -f "$resolved" ]]; then
                        cp "$resolved" "$BINARIES_DIR/$libname"
                        (( dylib_count++ )) || true
                    fi
                else
                    cp "$lib" "$BINARIES_DIR/$libname"
                    (( dylib_count++ )) || true
                fi
            done < <(find "$extracted_dir" \( -name "*.dylib" -type f -o -name "*.dylib" -type l \) -print0)
            if (( dylib_count > 0 )); then
                echo "  ✓ Copied ${dylib_count} dylib file(s)/symlink(s) to binaries/"
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
        curl -fsSL --progress-bar --connect-timeout 15 --max-time 300 --retry 3 --retry-delay 15 --retry-all-errors -o "$tmp_dir/archive.zip" "$url"
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

        # Copy all DLLs from the Windows zip alongside llama-server.exe.
        # llama.cpp on Windows requires ggml-base.dll, ggml.dll, llama.dll,
        # mtmd.dll, libomp140.x86_64.dll, and several ggml-cpu-*.dll files.
        # At runtime, Windows searches for DLLs in the directory containing
        # the executable first. We store them in binaries/windows-dlls/ here
        # and inject that path into PATH when spawning llama-server (server.rs).
        local dll_dir="$BINARIES_DIR/windows-dlls"
        mkdir -p "$dll_dir"
        local dll_count=0
        while IFS= read -r dll; do
            cp "$dll" "$dll_dir/"
            (( dll_count++ )) || true
        done < <(find "$tmp_dir/extracted" -name "*.dll" -type f)
        if (( dll_count > 0 )); then
            echo "  ✓ Copied ${dll_count} DLL(s) to binaries/windows-dlls/"
        fi
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
