# Lessons — Hard-Won CI/Build Knowledge

> Patterns that have caused repeated failures. Read before touching CI, build scripts, or spec files.

---

## Cross-Platform CI Shell Scripts

### Never use `$RUNNER_TEMP` with Unix tools on Windows

`$RUNNER_TEMP` on Windows runners is a Windows path (`D:\a\_temp`). When passed to Unix tools running under Git Bash / MSYS2 (`shell: bash`), the `D:` prefix is parsed as a remote hostname, breaking `tar`, `find`, and other tools silently or with cryptic errors like `tar (child): Cannot connect to D: resolve failed`.

**Use instead:**
- `$GITHUB_WORKSPACE` — always a path that Unix tools under MSYS2 can handle
- Python (`shell: python`) for anything involving path manipulation, file extraction, or downloads — Python's `pathlib` and `tarfile` are natively cross-platform
- Pure PowerShell (`shell: pwsh`) for Windows-only steps

**Example:** The `Pre-download whisper.cpp source` step uses `shell: python` so `tarfile.extractall()` and `pathlib.Path` handle the extraction with correct native paths on every platform.

---

### Steps that run on all platforms must be cross-platform

A step without an `if:` condition runs on every matrix platform. If the step uses `shell: bash` with Unix-specific path assumptions, it will fail on Windows. Options:
- Use `shell: python` for cross-platform logic
- Use `shell: pwsh` and gate the step with `if: matrix.platform == 'windows-latest'`
- Split into platform-specific steps

---

## PyInstaller Spec Files

### Relative paths in spec files resolve from the spec file's directory, not the working directory

PyInstaller resolves all relative paths (`'run.py'`, `'app'`, etc.) relative to the spec file's location — not `cwd` where you invoke PyInstaller. Moving a spec file to a subdirectory breaks all relative paths silently (error: `script 'subdir/run.py' not found`).

**Always use `SPECPATH`** (PyInstaller-injected variable = directory of the spec file):
```python
_ROOT = os.path.abspath(os.path.join(SPECPATH, '..'))
# Then: os.path.join(_ROOT, 'run.py'), os.path.join(_ROOT, 'app'), etc.
```

This makes spec files location-independent. Never use bare relative strings.

---

## Rust Crates That Download at Build Time

### `build.rs` network calls have no retry — pre-download in CI

Some crates (`whisper-cpp-plus-sys`, and potentially others) download source archives from GitHub during `cargo build` using a single HTTP call with no retry logic. Any transient CDN 502/503 fails the entire build.

**Pattern:** Add a dedicated CI step before the Rust build that:
1. Downloads the archive with `curl --retry 5` or Python's `urllib` with a retry loop
2. Unpacks it
3. Sets the crate's source-override env var (e.g., `WHISPER_CPP_SOURCE_DIR`) via `$GITHUB_ENV`

The build script checks this env var first and skips the download entirely.

**When upgrading such a crate:** update the pinned commit/version hash in the CI pre-download step to match the new `build.rs` constant.

---

## macOS Code Signing

### Sign every binary in the app bundle, not just the dylibs

The CI step that signs llama.cpp binaries must sign **both** the dylib files and the `llama-server` executable. Signing only the dylibs leaves the executable with an ad-hoc signature, which macOS Gatekeeper rejects on end-user machines (process is killed immediately on launch with no output).

Rule: after downloading any binary that will be bundled in the macOS app, sign it explicitly before `tauri-action` runs.
