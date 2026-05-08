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

---

## macOS Process Identity — Helper-App Bundles

### Sidecars in `Contents/MacOS/` inherit the parent's name in Activity Monitor

A flat sidecar binary dropped into `<App>.app/Contents/MacOS/` shows up in
Activity Monitor with the **parent bundle's `CFBundleName`** — there is no
way to override this from the binary itself. Two binaries in the same
`Contents/MacOS/` therefore appear as two identically-named processes with
the same icon (we shipped this for months: both `aimatrx-desktop` and
`aimatrx-engine` showed as "AI Matrx", confusing users who couldn't tell
the UI from the engine).

**Fix:** package the sidecar as a nested *Helper-app bundle* under
`Contents/Frameworks/<Name>.app/`. macOS treats it as a separate application
with its own `Info.plist`, `CFBundleName`, icon, and TCC permission strings.
Set `LSUIElement: True` + `LSBackgroundOnly: True` in the helper's plist so
it stays out of the Dock and app switcher.

### Don't post-process the bundle after `tauri-action` — let Tauri build it

Doing the helper-app restructure in an `afterBundleCommand` (or any custom
script that runs after Tauri signs) **breaks notarization**: the notarization
ticket is stapled to the bundle's exact byte layout at sign time, so any
later modification — even just moving files — invalidates it.

Two patterns work; pick one based on what your build tool supports:

1. **Build the helper bundle in PyInstaller**, then ship it to Tauri as a
   pre-built artifact. Add a `BUNDLE()` block to the macOS spec files so
   PyInstaller emits `<Helper>.app` directly, then declare it in
   `tauri.macos.conf.json` under `bundle.macOS.files`:
   ```json
   "macOS": { "files": { "Frameworks/Matrx Engine.app": "sidecar/Matrx Engine.app" } }
   ```
   Tauri v2's bundler (PR #8259) auto-codesigns nested code under
   `Contents/Frameworks/`, and the helper inherits the main bundle's
   notarization ticket. Zero post-build steps; CI stays simple.

2. Use Tauri's first-party hooks **before** signing if your bundler supports
   it. Avoid `afterBundleCommand` for anything that mutates the bundle.

We use pattern 1 for the Matrx Engine. See
`specs/matrx-engine-aarch64-apple-darwin.spec` and
`desktop/src-tauri/tauri.macos.conf.json`.

### Tauri platform-overlay arrays are *replaced*, not merged

When you add `tauri.<platform>.conf.json`, Tauri merges it into
`tauri.conf.json` — but **arrays are replaced wholesale**. If
`tauri.conf.json` has `bundle.externalBin: ["a", "b", "c"]` and the macOS
overlay only specifies `["c"]` (because you want to drop `a` and `b` on
macOS), the resulting macOS config is `["c"]` exactly — *not* a union or
diff. To keep platform-shared entries, you must re-list them in the overlay.

We hit this when moving the engine into a Helper-app bundle on macOS while
keeping `cloudflared` and `llama-server` shared across all platforms — the
macOS overlay re-lists those two, omits `matrx-engine`, and uses
`bundle.macOS.files` to inject the helper instead.

### Spawning a Helper-app from Rust uses `command()`, not `sidecar()`

Tauri's `app.shell().sidecar("name")` looks for `<name>(.exe)` in
`Contents/MacOS/` (or alongside the binary on Linux/Windows). It will
**not** find an executable inside `Contents/Frameworks/<Helper>.app/`.

For a Helper-app sidecar, compute the absolute path with `current_exe()`
and spawn via `app.shell().command(path)`:
```rust
fn macos_helper_engine_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let app_root = exe.parent()?.parent()?; // Contents/MacOS → Contents
    let helper = app_root.join("Frameworks/Matrx Engine.app/Contents/MacOS/Matrx Engine");
    helper.exists().then_some(helper)
}
```
Fall back to `app.shell().sidecar()` for non-macOS targets and dev mode
(where the helper bundle hasn't been built yet — the engine is launched
manually via `uv run python run.py`).

### Sweep legacy process names on every restart and uninstall

Renaming the sidecar binary (`aimatrx-engine` → `matrx-engine`, plus the
new "Matrx Engine" Helper-app process name) means upgrade installs from
older versions can leave orphaned legacy processes bound to ports. The
startup sweep in `lib.rs` and the `stop.sh` / `stop.ps1` / NSIS installer
hooks must match **all** historical names — we use a regex like
`Matrx Engine|matrx-engine|aimatrx-engine` for `pkill -f`, and explicit
`taskkill /IM` calls for each known `.exe` name on Windows.

Rule of thumb: any time you rename a long-running binary, audit every
`pkill`, `pgrep`, `taskkill`, and `Get-Process` call in the repo and make
the pattern accept both the old and new names for at least one major
release cycle.
