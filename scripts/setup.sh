#!/usr/bin/env bash
# setup.sh — First-time setup for Matrx Local
# Run from the project root: bash scripts/setup.sh

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

ok()   { echo -e "${GREEN}  ✓${RESET}  $*"; }
info() { echo -e "${BLUE}  →${RESET}  $*"; }
warn() { echo -e "${YELLOW}  ⚠${RESET}  $*"; }
fail() { echo -e "${RED}  ✗${RESET}  $*"; }
step() { echo -e "\n${BOLD}${BLUE}━━  $*${RESET}"; }

# ── Resolve project root (script lives in scripts/) ───────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

echo -e "\n${BOLD}Matrx Local — Setup${RESET}"
echo "  Project root: $ROOT"

ERRORS=0
WARNINGS=0

# ── OS detection ──────────────────────────────────────────────────────────────
IS_MAC=false; IS_LINUX=false; IS_WSL=false
case "$(uname -s)" in
    Darwin) IS_MAC=true ;;
    Linux)
        IS_LINUX=true
        grep -qi microsoft /proc/version 2>/dev/null && IS_WSL=true
        ;;
esac

# ── 1. Check uv ───────────────────────────────────────────────────────────────
step "1 / 8  Python toolchain (uv)"

if command -v uv &>/dev/null; then
    UV_VERSION=$(uv --version 2>&1 | head -1)
    ok "uv found: $UV_VERSION"
else
    fail "uv is not installed."
    echo "     Install it with:"
    echo "       curl -LsSf https://astral.sh/uv/install.sh | sh"
    echo "     Then re-run this script."
    exit 1
fi

# ── 2. Root .env ──────────────────────────────────────────────────────────────
step "2 / 8  Environment files"

if [[ -f "$ROOT/.env" ]]; then
    ok ".env already exists — skipping copy"
else
    cp "$ROOT/.env.example" "$ROOT/.env"
    ok ".env created from .env.example"
    warn "Open .env and set API_KEY (and any optional keys you want)."
    WARNINGS=$((WARNINGS + 1))
fi

if [[ -f "$ROOT/desktop/.env" ]]; then
    ok "desktop/.env already exists — skipping copy"
else
    cp "$ROOT/desktop/.env.example" "$ROOT/desktop/.env"
    ok "desktop/.env created from desktop/.env.example"
    warn "Open desktop/.env and fill in VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY."
    WARNINGS=$((WARNINGS + 1))
fi

# ── 3. Python dependencies ────────────────────────────────────────────────────
step "3 / 8  Python dependencies (uv sync --all-extras)"

info "Installing all Python dependencies (this may take a minute)..."
if uv sync --extra monitoring --extra discovery --extra audio --extra transcription --extra browser; then
    ok "Python dependencies installed"
else
    fail "uv sync failed — check the output above."
    ERRORS=$((ERRORS + 1))
fi

# ── 4. Playwright browsers ────────────────────────────────────────────────────
step "4 / 8  Playwright Chromium"

# Use 'python -m playwright' instead of the 'playwright' wrapper script.
# The wrapper at .venv/bin/playwright contains a hardcoded shebang that can
# point to a stale venv path (e.g. matrx_local vs matrx-local), causing
# "Permission denied (os error 13)" on WSL. The -m form always uses the
# correct interpreter that uv resolves.
if uv run python -m playwright install chromium 2>&1 | tail -3; then
    ok "Chromium installed"
else
    warn "Playwright Chromium install failed (browser automation tools will be unavailable)."
    WARNINGS=$((WARNINGS + 1))
fi

# ── 5. Desktop app (Node / pnpm) ──────────────────────────────────────────────
step "5 / 8  Desktop app dependencies (pnpm)"

if ! command -v pnpm &>/dev/null; then
    warn "pnpm not found — skipping desktop setup."
    echo "     Install pnpm with:  npm install -g pnpm"
    echo "     Then run:  cd desktop && pnpm install"
    WARNINGS=$((WARNINGS + 1))
elif ! command -v node &>/dev/null; then
    warn "node not found — skipping desktop setup."
    WARNINGS=$((WARNINGS + 1))
else
    info "Running pnpm install in desktop/..."
    if (cd "$ROOT/desktop" && pnpm install --frozen-lockfile 2>&1 | tail -5); then
        ok "Desktop JS dependencies installed"
    else
        warn "pnpm install failed. Run 'cd desktop && pnpm install' manually."
        WARNINGS=$((WARNINGS + 1))
    fi
fi

# ── 6. Linux system libraries (Tauri build dependencies) ─────────────────────
step "6 / 8  System libraries (required to compile Tauri on Linux/WSL)"

if $IS_LINUX || $IS_WSL; then
    # Tauri v2 requires these GTK/WebKit dev libraries to compile on Linux.
    # They are not installed by default on a base Ubuntu/Debian WSL image.
    TAURI_PKGS=(
        build-essential
        pkg-config
        libglib2.0-dev
        libgtk-3-dev
        libwebkit2gtk-4.1-dev
        libsoup-3.0-dev
        libssl-dev
        libayatana-appindicator3-dev
        librsvg2-dev
        libgdk-pixbuf2.0-dev
        libpango1.0-dev
        libatk1.0-dev
        libcairo2-dev
    )

    # Quick check: if glib-2.0 and webkit2gtk-4.1 are pkg-config visible, assume all good
    if pkg-config --exists glib-2.0 webkit2gtk-4.1 2>/dev/null; then
        ok "Tauri system libraries already installed"
    else
        info "Installing Tauri system libraries (you may be prompted for your sudo password)..."
        # Try passwordless first; otherwise sudo will prompt interactively as normal.
        if sudo apt-get install -y "${TAURI_PKGS[@]}"; then
            ok "System libraries installed"
        else
            fail "apt-get install failed. Try running manually:"
            echo ""
            echo "     sudo apt-get install -y \\"
            printf "       %s \\\\\n" "${TAURI_PKGS[@]}" | sed '$ s/ \\$//'
            echo ""
            ERRORS=$((ERRORS + 1))
        fi
    fi
else
    info "Not Linux/WSL — skipping apt step"
fi

# ── 7. Rust / Tauri (optional, only for native build) ────────────────────────
step "7 / 8  Rust toolchain (needed for 'pnpm tauri:dev' / 'pnpm tauri build')"

# Helper: find a native Linux ELF cargo, regardless of PATH.
# Checks ~/.cargo/bin/cargo first (standard rustup install location),
# then falls back to whatever PATH resolves. Returns the path or empty string.
_find_native_cargo() {
    local candidates=("$HOME/.cargo/bin/cargo" "$HOME/.cargo/bin/rustc")
    local bin=""
    # Prefer the well-known rustup install path — works even if PATH isn't updated yet
    if [[ -f "$HOME/.cargo/bin/cargo" ]]; then
        bin="$HOME/.cargo/bin/cargo"
    else
        bin=$(command -v cargo 2>/dev/null || true)
    fi
    [[ -z "$bin" ]] && return 1
    # Verify it's a native Linux ELF (magic 7f 45 4c 46) or a symlink to one
    local resolved
    resolved=$(readlink -f "$bin" 2>/dev/null || echo "$bin")
    local magic
    magic=$(od -A n -t x1 -N 4 "$resolved" 2>/dev/null | tr -d ' ')
    if [[ "$magic" == "7f454c46" ]]; then
        echo "$bin"
        return 0
    fi
    return 1
}

# Find a Windows cargo.exe on any /mnt/* PATH entry (WSL interop).
_find_windows_cargo() {
    local found
    found=$(command -v cargo.exe 2>/dev/null || true)
    if [[ -z "$found" ]]; then
        while IFS= read -r dir; do
            if [[ "$dir" == /mnt/* && -f "$dir/cargo.exe" ]]; then
                found="$dir/cargo.exe"
                break
            fi
        done < <(echo "$PATH" | tr ':' '\n')
    fi
    echo "$found"
}

RUST_OK=false
NATIVE_CARGO=$(_find_native_cargo || true)

if [[ -n "$NATIVE_CARGO" ]]; then
    # Source cargo env so PATH is correct for the rest of this script
    # shellcheck source=/dev/null
    source "$HOME/.cargo/env" 2>/dev/null || export PATH="$HOME/.cargo/bin:$PATH"
    RUST_VERSION=$(rustc --version 2>&1 || "$HOME/.cargo/bin/rustc" --version 2>&1 || echo "unknown")
    ok "Native Linux Rust found: $RUST_VERSION"
    RUST_OK=true
else
    WINDOWS_CARGO=$(_find_windows_cargo)
    if [[ -n "$WINDOWS_CARGO" ]]; then
        warn "Only a Windows cargo.exe was found (${WINDOWS_CARGO})."
        echo ""
        echo "     Running Windows cargo.exe from WSL causes 'Permission denied'"
        echo "     errors when Tauri tries to invoke it. You need a native Linux"
        echo "     Rust installation inside WSL."
        echo ""
        printf "     Install native Linux Rust now? [Y/n] "
        read -r _rust_answer
        if [[ ! "$_rust_answer" =~ ^[Nn]$ ]]; then
            info "Installing Rust via rustup..."
            curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
            # shellcheck source=/dev/null
            source "$HOME/.cargo/env" 2>/dev/null || export PATH="$HOME/.cargo/bin:$PATH"
            if [[ -f "$HOME/.cargo/bin/cargo" ]]; then
                ok "Rust installed: $("$HOME/.cargo/bin/rustc" --version 2>&1)"
                RUST_OK=true
            else
                warn "Rust installed but cargo not found at ~/.cargo/bin — open a new terminal and re-run."
                WARNINGS=$((WARNINGS + 1))
            fi
        else
            warn "Skipped. You will need to install native Linux Rust before running the desktop app."
            echo "     curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
            WARNINGS=$((WARNINGS + 1))
        fi
    else
        warn "Rust is not installed. The Python engine works without it."
        echo "     To build the full Tauri desktop app, install Rust:"
        echo "       curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
        WARNINGS=$((WARNINGS + 1))
    fi
fi

if $RUST_OK; then
    if ! cargo --version &>/dev/null && ! "$HOME/.cargo/bin/cargo" --version &>/dev/null; then
        warn "cargo found but failed to run — Rust install may be broken."
        WARNINGS=$((WARNINGS + 1))
    fi

    # Ensure ~/.cargo/env is sourced in ~/.bashrc so every new terminal has cargo on PATH.
    # Without this, interactive shells pick up Windows cargo.exe via WSL interop instead.
    BASHRC="$HOME/.bashrc"
    CARGO_ENV_LINE='[[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"'
    if ! grep -qF '.cargo/env' "$BASHRC" 2>/dev/null; then
        echo "" >> "$BASHRC"
        echo "# Rust / Cargo (Linux native — added by matrx-local setup)" >> "$BASHRC"
        echo "$CARGO_ENV_LINE" >> "$BASHRC"
        ok "Added ~/.cargo/env to ~/.bashrc — new terminals will have cargo on PATH"
    else
        ok "~/.cargo/env already referenced in ~/.bashrc"
    fi

    # Also source it now so the rest of this script and any immediately following
    # commands in the same session have the correct PATH.
    # shellcheck source=/dev/null
    source "$HOME/.cargo/env" 2>/dev/null || true
fi

# ── 8. Dev-mode sidecar stub ─────────────────────────────────────────────────
# Tauri requires the sidecar binary to exist at compile time even in dev mode,
# because it's declared in tauri.conf.json externalBin. In production this is
# replaced by the real PyInstaller binary (bash scripts/build-sidecar.sh).
# In dev mode, the engine is started separately by launch.sh, so a stub is fine.
step "8 / 8  Dev-mode sidecar stub"

SIDECAR_DIR="$ROOT/desktop/src-tauri/sidecar"
# Determine the target triple for this machine
_sidecar_triple() {
    local os arch
    os="$(uname -s)"; arch="$(uname -m)"
    case "$os" in
        Linux)  case "$arch" in x86_64) echo "x86_64-unknown-linux-gnu" ;; aarch64) echo "aarch64-unknown-linux-gnu" ;; *) echo "unknown-linux" ;; esac ;;
        Darwin) case "$arch" in x86_64) echo "x86_64-apple-darwin" ;; arm64) echo "aarch64-apple-darwin" ;; *) echo "unknown-darwin" ;; esac ;;
        *)      echo "unknown-platform" ;;
    esac
}
SIDECAR_TRIPLE=$(_sidecar_triple)
SIDECAR_BIN="$SIDECAR_DIR/aimatrx-engine-$SIDECAR_TRIPLE"

if [[ -f "$SIDECAR_BIN" ]]; then
    # Check if it's the real binary (>1 MB) or just our stub
    SIDECAR_SIZE=$(wc -c < "$SIDECAR_BIN" 2>/dev/null || echo 0)
    if [[ "$SIDECAR_SIZE" -gt 1048576 ]]; then
        ok "Real PyInstaller sidecar binary present ($SIDECAR_TRIPLE)"
    else
        ok "Dev-mode stub already in place ($SIDECAR_TRIPLE)"
    fi
else
    mkdir -p "$SIDECAR_DIR"
    cat > "$SIDECAR_BIN" << 'STUBEOF'
#!/usr/bin/env bash
# DEV-MODE STUB — satisfies Tauri's externalBin requirement at compile time.
# In development the engine is started separately by launch.sh.
# Build the real binary with: bash scripts/build-sidecar.sh
echo "This is a dev-mode stub. Run 'bash scripts/build-sidecar.sh' for production." >&2
exit 1
STUBEOF
    chmod +x "$SIDECAR_BIN"
    ok "Dev-mode sidecar stub created for $SIDECAR_TRIPLE"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}━━  Setup complete${RESET}\n"

if [[ $ERRORS -gt 0 ]]; then
    fail "$ERRORS error(s) occurred. Fix them before starting the engine."
elif [[ $WARNINGS -gt 0 ]]; then
    warn "$WARNINGS warning(s) — see above. Core setup is done."
else
    ok "Everything looks good."
fi

echo -e "\n${BOLD}Next steps:${RESET}"

# Check if .env still has placeholder API_KEY
if grep -q '^API_KEY=local-dev' "$ROOT/.env" 2>/dev/null; then
    echo "  1. (Optional) Edit .env — set API_KEY to something custom"
else
    echo "  1. .env is configured"
fi

if grep -q 'your-project-ref' "$ROOT/desktop/.env" 2>/dev/null; then
    echo "  2. Edit desktop/.env — fill in your Supabase URL and publishable key"
else
    echo "  2. desktop/.env is configured"
fi

echo ""
echo "  Start the Python engine:"
echo "    uv run python run.py"
echo ""
echo "  Start the desktop app (separate terminal, after engine is running):"
echo "    cd desktop && pnpm tauri:dev"
echo ""
echo "  Engine health check (once running):"
echo "    curl http://127.0.0.1:22140/"
echo ""
