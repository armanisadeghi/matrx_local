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

## Consumer-Facing Optional Features with Large Dependencies

### Never tell consumers to run terminal commands — install from inside the app

For features that require large optional packages (torch + diffusers = ~500 MB–1 GB), the correct consumer-grade pattern is:

1. **Do NOT bundle them in the PyInstaller binary.** Bundling torch/diffusers would make the installer 10+ GB. Keep them in `excludes` in every `.spec` file and in `build_with_flags` inside `build-sidecar.sh`.

2. **Do NOT print `uv sync --extra image-gen` in the UI.** That message is appropriate for developers, not consumers.

3. **Install into a dedicated user-writable directory on demand:**
   - macOS/Linux: `~/.matrx/image-gen-packages/`
   - Windows: `%LOCALAPPDATA%\AI Matrx\image-gen-packages\`
   - Write a `.install-complete` marker when done.

4. **Inject the directory into `sys.path` in two places:**
   - `hooks/runtime_hook.py` — runs on every frozen-binary startup before any app code
   - `app/main.py` lifespan — covers dev-mode restarts and in-session installs

5. **Expose SSE progress via `/image-gen/install/stream`** so the UI shows a real-time progress bar.

6. **The UI shows a "Install now" button** with a progress bar, not a terminal command.

The installer lives in `app/services/image_gen/installer.py`. The UI is `ImageGenInstaller` in `LocalModels.tsx`.

7. **PyInstaller may not collect stdlib modules unused by the engine itself.** The installed packages run inside the frozen binary's Python interpreter. If they need a stdlib module (e.g. `filecmp`) that PyInstaller didn't bundle — because the engine never imports it — they'll fail with `ModuleNotFoundError` at runtime even though it's a stdlib module that "always exists" in normal Python.

   **Fix in two ways:**
   - Add to `hiddenimports` in all 4 `.spec` files and in `build-sidecar.sh` so the next build includes it.
   - Patch the installed package source at install time (and on every `inject_image_gen_path()` call) to handle the missing module gracefully. This fixes existing installs without a rebuild.

   Known case: `transformers/dynamic_module_utils.py` imports `filecmp` at the top level. The patch in `_patch_transformers_filecmp()` makes it fall back to an always-copy stub.

---

## macOS Code Signing

### Sign every binary in the app bundle, not just the dylibs

The CI step that signs llama.cpp binaries must sign **both** the dylib files and the `llama-server` executable. Signing only the dylibs leaves the executable with an ad-hoc signature, which macOS Gatekeeper rejects on end-user machines (process is killed immediately on launch with no output).

Rule: after downloading any binary that will be bundled in the macOS app, sign it explicitly before `tauri-action` runs.
