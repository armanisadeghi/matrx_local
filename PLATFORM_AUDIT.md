# Platform Context Enforcement — Phase 1 Audit

> **⚠️ Stale sections inside (2026-03-24):** The “`initPlatformCtx()` is never called” finding is **incorrect**. **`use-engine.ts`** calls `engine.getPlatformContext()` then `initPlatformCtx(ctx)` after connect. Treat the rest of this file as a **best-effort 2026-03-18 inventory** — re-run grep if used for Phase 2.
>
> **Generated:** 2026-03-18  
> **Purpose:** Inventory platform/OS detection and hardcoded paths outside canonical modules (Phase 2 checklist).
>
> **Canonical modules:**
> - Python: `app/common/platform_ctx.py`
> - TypeScript: `desktop/src/lib/platformCtx.ts` + `initPlatformCtx()` (called from `use-engine.ts`)

---

## 1. Resolved: platform context wiring

`initPlatformCtx` **is** called from `desktop/src/hooks/use-engine.ts` during engine initialization (post-`getPlatformContext`). Remove this section from any runbooks — kept only as archive marker.

### ~~`initPlatformCtx()` is never called~~ (obsolete)

~~The following paragraphs were true at draft time and are retained struck-through for history: the frontend did not call `initPlatformCtx`.~~ **Fixed:** `use-engine.ts` now wires engine → `initPlatformCtx`.

---

## 2. Pattern A — Local `IS_*` Constants (24 files)

Every file below does `import platform` at the top and defines its own `IS_MACOS = platform.system() == "Darwin"` (and/or `IS_WINDOWS`, `IS_LINUX`) instead of importing from `platform_ctx`.

**What needs to change:** Replace local definitions with `from app.common.platform_ctx import PLATFORM` and use `PLATFORM["is_mac"]`, `PLATFORM["is_windows"]`, `PLATFORM["is_linux"]`.

### `app/tools/tools/__init__.py`
- **Lines 6, 11–13:** `import platform` + `IS_WINDOWS`, `IS_MACOS`, `IS_LINUX` defined locally
- **Line 44:** Additional `platform.system()` call in `open_path_cross_platform()`
- **Code:**
  ```python
  IS_WINDOWS = platform.system() == "Windows"
  IS_MACOS = platform.system() == "Darwin"
  IS_LINUX = platform.system() == "Linux"
  ```

### `app/tools/tools/app_integration.py`
- **Lines 9, 18–19:** `import platform` + `IS_WINDOWS`, `IS_MACOS` defined locally
- **Code:**
  ```python
  IS_WINDOWS = platform.system() == "Windows"
  IS_MACOS = platform.system() == "Darwin"
  ```

### `app/tools/tools/input_automation.py`
- **Lines 7, 15–16:** `import platform` + `IS_WINDOWS`, `IS_MACOS` defined locally

### `app/tools/tools/messages.py`
- **Lines 15, 25:** `import platform` + `IS_MACOS` defined locally

### `app/tools/tools/scheduler.py`
- **Lines 9, 22–23:** `import platform` + `IS_WINDOWS`, `IS_MACOS` defined locally

### `app/tools/tools/system.py`
- **Lines 8, 33:** `import platform` + `platform.system()` inline (no local constant, but direct calls)

### `app/tools/tools/audio.py`
- **Lines 9, 20–21:** `import platform` + `IS_WINDOWS`, `IS_MACOS` defined locally

### `app/tools/tools/process_manager.py`
- **Lines 8, 20–22:** `import platform` + `IS_WINDOWS`, `IS_MACOS`, `IS_LINUX` defined locally

### `app/tools/tools/system_monitor.py`
- **Lines 8, 16–17:** `import platform` + `IS_WINDOWS`, `IS_MACOS` defined locally
- **Code:**
  ```python
  IS_WINDOWS = platform.system() == "Windows"
  IS_MACOS = platform.system() == "Darwin"
  ```

### `app/tools/tools/window_manager.py`
- **Lines 8, 16–17:** `import platform` + `IS_WINDOWS`, `IS_MACOS` defined locally

### `app/tools/tools/execution.py`
- **Lines 11, 24:** `import platform` + `IS_WINDOWS` defined locally
- **Code:**
  ```python
  IS_WINDOWS = platform.system() == "Windows"
  ```

### `app/tools/tools/notify.py`
- **Lines 7, 15–17:** `import platform` + `IS_MACOS`, `IS_WINDOWS`, `IS_LINUX` defined locally

### `app/tools/tools/network_discovery.py`
- **Lines 8, 19–20:** `import platform` + `IS_WINDOWS`, `IS_MACOS` defined locally

### `app/tools/tools/mail.py`
- **Lines 15, 23:** `import platform` + `IS_MACOS` defined locally

### `app/tools/tools/powershell_tools.py`
- **Lines 12, 20:** `import platform` + `IS_WINDOWS` defined locally

### `app/tools/tools/browser_automation.py`
- **Lines 14, 43, 53, 115:** `import platform` + direct `platform.system()` and `platform.uname()` calls

### `app/tools/tools/contacts.py`
- **Lines 13, 21:** `import platform` + `IS_MACOS` defined locally

### `app/tools/tools/location.py`
- **Lines 18, 27:** `import platform` + `IS_MACOS` defined locally

### `app/tools/tools/speech_recognition_tools.py`
- **Lines 17, 27:** `import platform` + `IS_MACOS` defined locally

### `app/tools/tools/wifi_bluetooth.py`
- **Lines 8, 17–18:** `import platform` + `IS_WINDOWS`, `IS_MACOS` defined locally

### `app/tools/tools/calendar_tools.py`
- **Lines 17, 27:** `import platform` + `IS_MACOS` defined locally

### `app/tools/tools/photos.py`
- **Lines 15, 24:** `import platform` + `IS_MACOS` defined locally

### `app/services/permissions/checker.py`
- **Lines 13, 22–24:** `import platform` + `IS_MACOS`, `IS_WINDOWS`, `IS_LINUX` defined locally

### `app/api/permissions_routes.py`
- **Lines 13, 68–70:** `import platform` + `IS_MACOS`, `IS_WINDOWS`, `IS_LINUX` defined locally
- **Line 152:** `platform.system()` in response body

---

## 3. Pattern B — Direct `platform.*()` Calls (need new PLATFORM fields)

These files use `platform.node()`, `platform.processor()`, `platform.platform()`, `platform.mac_ver()`, etc. that are **not yet exposed** in the `PLATFORM` dict and need new fields added.

### `app/services/cloud_sync/instance_manager.py`
- **Line 13:** `import platform`
- **Lines 32–34:** `platform.node()`, `platform.machine()`, `platform.system()` in `_stable_machine_id()`
- **Lines 37, 48:** `platform.system()` for Darwin/Linux branch in hardware UUID detection
- **Lines 165–168:** `platform.system().lower()`, `platform.platform()`, `platform.machine()`, `platform.node()` in `_build_instance_info()`
- **Line 176:** `platform.processor()` for CPU model
- **What needs to change:** Add `hostname`, `os_version`, `processor` to `PLATFORM` dict; use those fields

### `app/services/documents/sync_engine.py`
- **Line 23:** `import platform`
- **Lines 457–458:** `platform.node()`, `platform.system()` for sync metadata
- **What needs to change:** Use `PLATFORM["hostname"]` and `PLATFORM["system"]`

### `app/tools/tools/system.py`
- **Lines 133–137:** `platform.system()`, `platform.release()`, `platform.version()`, `platform.machine()`, `platform.node()` in system info tool
- **Line 291:** `platform.mac_ver()[0]` for screenshot path
- **Line 311:** `platform.system() == "Darwin"` for screenshot
- **What needs to change:** Use `PLATFORM` fields; add `mac_version` to `PLATFORM` dict

### `app/api/setup_routes.py`
- **Line 16:** `import platform`
- **Line 199:** `platform.system()` in setup logic
- **Line 204:** `platform.machine() == "arm64"` for ARM detection
- **Lines 269–270:** `platform.system()`, `platform.machine()` for binary info
- **Lines 524–525:** `platform.system()`, `platform.machine()` in response
- **What needs to change:** Use `PLATFORM["system"]`, `PLATFORM["machine"]`, `PLATFORM["is_mac_silicon"]`

### `app/services/screenshots/capture.py`
- **Line 1:** `import platform`
- **Line 5:** `platform.system() == "Darwin"` for macOS screenshot
- **What needs to change:** Use `PLATFORM["is_mac"]`

---

## 4. Pattern C — Direct `sys.platform` / `os.name`

### `run.py`
- **Line 38:** `if sys.platform == "win32":` — UTF-8 stdout/stderr on Windows
- **Line 166:** `if sys.platform == "darwin":` — lsof vs ss for port PIDs
- **Line 180:** `if sys.platform != "darwin" and Path(f"/proc/{pid}/cmdline").exists():` — Linux `/proc` check
- **Line 442:** `if sys.platform == "win32" or sys.platform == "darwin":` — system tray availability
- **What needs to change:** Import `PLATFORM` from `platform_ctx`; use `PLATFORM["is_windows"]`, `PLATFORM["is_mac"]`
- **Note:** `run.py` imports happen very early — `platform_ctx` must be importable without side effects at module level (it currently is).

### `app/z_from_matrx/local/files/local_files.py`
- **Lines 6–7:** `import platform`, `import sys`
- **Line 11:** `if sys.platform.startswith("linux"):` — WSL detection
- **Line 12:** `platform.uname().release.lower()` — WSL kernel check
- **Line 15:** `open("/proc/version", "r")` — WSL fallback
- **What needs to change:** Use `PLATFORM["is_linux"]` and a centralized `is_wsl` capability

### `app/api/system_control.py`
- **Line 5:** `"os": os.name` — returns `"posix"` or `"nt"`
- **What needs to change:** Use `PLATFORM["os"]` (which returns `"darwin"`, `"win32"`, `"linux"` — more specific)

### `app/z_from_matrx/local/audio/package_local/audio.py`
- **Line 5:** `import platform`
- **Line 126:** `if os.name == "nt":` — Windows subprocess startup flags
- **Lines 153–177:** `platform.system()`, `platform.machine()` — FLAC binary selection per OS/arch
- **Line 187:** `if "Linux" in platform.system():` — Linux `os.sync()` workaround
- **What needs to change:** Import `PLATFORM`; use `PLATFORM["is_windows"]`, `PLATFORM["is_mac"]`, etc.

### `app/z_from_matrx/local/audio/package_local/package_local.py`
- **Line 228:** `if os.name == "nt":` — Windows subprocess startup flags
- **What needs to change:** Use `PLATFORM["is_windows"]`

---

## 5. Pattern D — `shutil.which()` Outside Capability Registry

These perform ad-hoc binary availability checks at runtime instead of reading from `CAPABILITIES`.

### `app/tools/tools/__init__.py`
- **Lines 66, 68:** `shutil.which("xdg-open")`, `shutil.which("nautilus")` in `open_path_cross_platform()`
- **What needs to change:** Add `has_xdg_open`, `has_nautilus` to `CAPABILITIES`

### `app/tools/tools/app_integration.py`
- **Line 93:** `shutil.which("pwsh")` / `"powershell.exe"` — PowerShell binary selection
- **What needs to change:** Add `has_powershell` / `powershell_path` to `CAPABILITIES`

### `app/tools/tools/scheduler.py`
- **Line 474:** `shutil.which("systemd-inhibit")` — Linux systemd check
- **What needs to change:** Add `has_systemd_inhibit` to `CAPABILITIES`

### `app/tools/tools/file_ops.py`
- **Line 144:** `shutil.which("fd")` — fd (file finder) binary
- **Line 189:** `shutil.which("rg")` — ripgrep binary
- **What needs to change:** Add `has_fd`, `has_rg` to `CAPABILITIES`

### `app/tools/tools/powershell_tools.py`
- **Lines 27–33:** `shutil.which("pwsh")`, `shutil.which("powershell.exe")` — PowerShell selection
- **What needs to change:** Use shared `has_powershell` / `powershell_path` from `CAPABILITIES`

### `app/services/tunnel/manager.py`
- **Line 149:** `shutil.which("cloudflared")` — binary lookup (note: `has_cloudflared` already exists in `CAPABILITIES` but is not used here)
- **What needs to change:** Use `CAPABILITIES["has_cloudflared"]` instead

### `app/services/permissions/checker.py`
- **Line 413:** `shutil.which("xdotool")` — Linux X11 tool
- **Line 414:** `shutil.which("wmctrl")` — Linux window manager control
- **Line 530:** `shutil.which("bluetoothctl")` — Linux Bluetooth
- **Line 627:** `shutil.which("nmcli")` — Linux NetworkManager
- **What needs to change:** Add `has_xdotool`, `has_wmctrl`, `has_bluetoothctl`, `has_nmcli` to `CAPABILITIES`

### `app/api/permissions_routes.py`
- **Line 355:** `shutil.which("whereami")` — macOS location
- **Line 407:** `shutil.which("geoclue-where-am-i")` — Linux location
- **Line 477:** `shutil.which("imagesnap")` — macOS camera
- **Line 595:** `shutil.which("ffmpeg")` — FFmpeg (note: `has_ffmpeg` already in `CAPABILITIES`)
- **What needs to change:** Add `has_whereami`, `has_geoclue`, `has_imagesnap` to `CAPABILITIES`; use existing `has_ffmpeg`

### `app/tools/tools/wifi_bluetooth.py`
- **Line 740:** `shutil.which("xrandr")` — Linux display config
- **What needs to change:** Add `has_xrandr` to `CAPABILITIES`

### `app/tools/tools/system.py`
- **Line 91:** `shutil.which(binary)` — Chrome binary lookup
- **What needs to change:** Add `has_chrome` / `chrome_path` to `CAPABILITIES`

---

## 6. Pattern E — `app/config.py` Special Case

### `app/config.py`
- **Line 2:** `import platform`
- **Line 140:** `_system = platform.system()` — module-level platform detection
- **Lines 143–174:** `_platform_data_dir()`, `_platform_cache_dir()`, `_platform_log_dir()` all branch on `_system == "Windows"` / `_system == "Darwin"` / Linux fallback
- **Code:**
  ```python
  _system = platform.system()
  
  def _platform_data_dir() -> Path:
      if _system == "Windows":
          base = Path(os.getenv("APPDATA", Path.home() / "AppData" / "Roaming"))
          return base / APP_NAME
      if _system == "Darwin":
          return Path.home() / "Library" / "Application Support" / APP_NAME
      xdg = os.getenv("XDG_DATA_HOME", str(Path.home() / ".local" / "share"))
      return Path(xdg) / APP_NAME_SLUG
  ```
- **Why it's special:** `config.py` is imported before `platform_ctx.py` in some paths (both are core modules). The detection is functionally identical to what `platform_ctx.py` does.
- **What needs to change:** Either (a) make `config.py` import from `platform_ctx` (preferred — `platform_ctx` has no dependencies on `config`), or (b) have both modules use a shared ultra-minimal detection that runs at import time with no dependencies.

---

## 7. Pattern F — Hardcoded Paths

### HIGH risk

| File | Line(s) | Hardcoded Path | Issue |
|------|---------|----------------|-------|
| `app/utils/directory_utils/generate_directory_structure.py` | 192–193 | `/Users/armanisadeghi/code/matrx-local` | Dev machine path in `__main__` block |
| `app/z_from_matrx/local/utils/get_dir_structure.py` | 14–15, 51 | `/home/arman/projects/aidream/ai` | Dev machine path |

### MEDIUM risk

| File | Line(s) | Hardcoded Path | Issue |
|------|---------|----------------|-------|
| `app/main.py` | 63 | `~/.matrx/playwright-browsers` (ad-hoc `os.path.expanduser`) | Should use `MATRX_HOME_DIR / "playwright-browsers"` |
| `app/api/setup_routes.py` | 73 | Same playwright path ad-hoc | Should use `MATRX_HOME_DIR` |
| `hooks/runtime_hook.py` | 29 | Same playwright path ad-hoc | Should use `MATRX_HOME_DIR` |
| `app/tools/tools/system_monitor.py` | 39 | `"C:\\"` for Windows disk usage | Assumes C: drive; should detect system drive |
| `app/tools/tools/messages.py` | 27 | `Path.home() / "Library" / "Messages" / "chat.db"` | macOS-only path, no cross-platform branch |
| `test_llm.py` | 33 | `Path.home() / "Library/Application Support/com.aimatrx.desktop/models"` | macOS-only path in test file |

### LOW risk (well-known system paths, correct per-OS branching, but should be centralized)

| File | Line(s) | Hardcoded Path | Context |
|------|---------|----------------|---------|
| `app/services/tunnel/manager.py` | 137–140 | `/opt/homebrew/bin/cloudflared`, `/usr/local/bin/cloudflared`, `/usr/bin/cloudflared`, `C:\Program Files\cloudflared\cloudflared.exe` | System install search paths |
| `app/tools/tools/system.py` | 38–40 | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` etc. | Chrome detection on macOS |
| `app/tools/tools/execution.py` | 30–32 | `/bin/zsh`, `/bin/bash` | Shell selection on Unix |
| `app/services/cloud_sync/instance_manager.py` | 49, 53 | `/etc/machine-id`, `/sys/class/dmi/id/product_uuid` | Linux machine ID (standard paths) |
| `app/tools/tools/process_manager.py` | 193 | `/usr/sbin/lsof` | macOS lsof path |
| `app/tools/tools/process_manager.py` | 826 | `/proc/{pid}/fd/1` | Linux process stdout |
| `app/services/permissions/checker.py` | 323 | `/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices` | macOS accessibility fallback |
| `app/services/permissions/checker.py` | 748 | `/System/Library/PrivateFrameworks/Apple80211.framework/.../airport` | macOS WiFi scan |
| `app/tools/tools/wifi_bluetooth.py` | 39 | Same airport path | macOS WiFi scan |

---

## 8. Frontend — TypeScript/React Violations (3 files)

### `desktop/src/lib/sidecar.ts`
- **Lines 35–36:** `isWindows()` function uses `navigator.userAgent.includes("Windows")`
- **Lines 145, 182:** `isTauri() && isWindows()` gates Rust IPC vs JS fetch
- **Purpose:** Windows WebView2 blocks JS `fetch()` to 127.0.0.1 due to loopback isolation
- **What needs to change:** Replace `isWindows()` with `PLATFORM.is_windows` from `platformCtx`
- **Note:** This is used before the engine is available, so the browser fallback in `platformCtx` must handle this case correctly (it does — `_browserFallbackPlatform()` checks `navigator.userAgent` for Windows).

### `desktop/src/components/EngineRecoveryModal.tsx`
- **Line 363:** `` `User Agent: ${navigator.userAgent}` `` in diagnostic report
- **What needs to change:** Replace with `getPlatformSnapshot()` from `platformCtx`

### `desktop/src/components/PermissionsModal.tsx`
- **Line 336:** `"AI Matrx needs these permissions to run automation and AI tools on your Mac."` — hardcoded "Mac"
- **What needs to change:** Make platform-aware: "on your Mac" / "on your PC" / "on your system" based on `PLATFORM.is_mac`, `PLATFORM.is_windows`

---

## 9. Documented (No Change Required)

### Rust Compile-Time Conditionals

All Rust platform detection uses `#[cfg(target_os = ...)]` or `cfg!(...)` — compile-time conditional compilation. These are correct and appropriate for Rust.

| File | Lines | What |
|------|-------|------|
| `desktop/src-tauri/src/main.rs` | 1–2 | `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` |
| `desktop/src-tauri/src/lib.rs` | 155–181 | `#[cfg(unix)]` SIGTERM/SIGKILL vs Windows `kill()` |
| `desktop/src-tauri/src/lib.rs` | 744–749 | `#[cfg(target_os = "macos")]` Dock reopen handler |
| `desktop/src-tauri/build.rs` | 3–6 | `#[cfg(target_os = "linux")]` link libgomp |
| `desktop/src-tauri/src/transcription/hardware.rs` | 27, 41–78 | Metal support, Apple Silicon detection, GPU probing |
| `desktop/src-tauri/src/transcription/commands.rs` | 226–234 | macOS TCC microphone permission check |

### Shell Scripts

Shell scripts use `uname -s` / `uname -m` for build-time detection. These run on the host machine and do not need the platform context system.

| File | What |
|------|------|
| `scripts/stop.sh` | OS detection for process management commands |
| `scripts/launch.sh` | Terminal launchers per platform |
| `scripts/setup.sh` | Platform-specific dependency installation |
| `scripts/release.sh` | GNU vs BSD sed, CI platform labels |
| `scripts/build-sidecar.sh` | Target triple detection, PyInstaller config |
| `scripts/download-llama-server.sh` | Asset selection per target triple |
| `scripts/download-cloudflared.sh` | Asset selection per target triple |

**Note:** `download-llama-server.sh` and `download-cloudflared.sh` `--current` mode does not handle Windows (CYGWIN/MINGW/MSYS) — exits with "Unknown platform". This is a gap but is outside the runtime platform context scope.

### Build Configs

| File | What |
|------|------|
| `pyproject.toml` | PEP 508 env markers: `sys_platform == 'darwin'` for macOS-only deps |
| `desktop/src-tauri/tauri.conf.json` | Platform-specific bundle sections (windows, macOS, linux) |
| `desktop/src-tauri/Cargo.toml` | `cfg(unix)` dependencies, cuda/metal feature flags |
| `.github/workflows/release.yml` | CI build matrix across macOS, Ubuntu, Windows |

### CI/CD

The `.github/workflows/release.yml` uses a standard platform matrix (`macos-15`, `ubuntu-22.04`, `windows-latest`) with platform-conditional steps for signing, deps, and binary downloads. This is standard CI practice and does not need to go through the context system.

---

## 10. WSL Detection (Cross-Cutting Concern)

WSL (Windows Subsystem for Linux) is detected independently in **4+ files**, each with slightly different logic:

| File | Method |
|------|--------|
| `app/tools/tools/__init__.py` (lines 17–24) | `Path("/proc/version").read_text()` checking for "microsoft" |
| `app/z_from_matrx/local/files/local_files.py` (lines 11–15) | `sys.platform.startswith("linux")` + `platform.uname().release.lower()` + `/proc/version` |
| `app/tools/tools/browser_automation.py` (line 43) | `platform.uname().release.lower()` checking for "microsoft" or "wsl" |
| `run.py` (lines 447–449) | `Path("/proc/version").exists()` + read text for "microsoft" |

**What needs to change:** Add `is_wsl` to `PLATFORM` dict (or `CAPABILITIES`), detected once at startup. All files use the centralized value.

---

## 11. Hardcoded OS-Specific Commands (Cross-Cutting Concern)

The `"powershell.exe"` command string appears in **10+ files** across the codebase. Other OS-specific commands (`"open"`, `"explorer.exe"`, `"xdg-open"`, `"cmd.exe"`) also appear in multiple places.

| Command | Files |
|---------|-------|
| `"powershell.exe"` | `execution.py`, `app_integration.py`, `input_automation.py`, `scheduler.py`, `audio.py`, `process_manager.py`, `window_manager.py`, `notify.py`, `network_discovery.py`, `wifi_bluetooth.py`, `permissions_routes.py`, `checker.py` |
| `"open"` (macOS) | `__init__.py`, `process_manager.py` |
| `"explorer.exe"` (Windows) | `__init__.py` |
| `"xdg-open"` (Linux) | `__init__.py` |
| `"cmd.exe"` (Windows) | `network_discovery.py` |

**What needs to change:** These are runtime command invocations that legitimately differ per OS. The pattern here is not to centralize the subprocess calls themselves, but to ensure the OS branching uses `PLATFORM` instead of local `IS_*` constants, and that binary availability is checked via `CAPABILITIES`.

---

## 12. New Fields Needed in `platform_ctx.py` (Phase 2 Prep)

### New `PLATFORM` dict fields

| Field | Replaces | Used in |
|-------|----------|---------|
| `hostname` | `platform.node()` | `instance_manager.py`, `sync_engine.py`, `system.py` |
| `os_version` | `platform.platform()` | `instance_manager.py` |
| `processor` | `platform.processor()` | `instance_manager.py` |
| `mac_version` | `platform.mac_ver()[0]` | `system.py` |
| `version` | `platform.version()` | `system.py` |
| `is_wsl` | 4 independent implementations | `__init__.py`, `local_files.py`, `browser_automation.py`, `run.py` |
| `path_separator` | `os.sep` | General use |
| `home_dir` | `Path.home()` | General use |

### New `CAPABILITIES` dict fields

| Field | Replaces | Used in |
|-------|----------|---------|
| `has_powershell` / `powershell_path` | `shutil.which("pwsh"/"powershell.exe")` | `app_integration.py`, `powershell_tools.py` |
| `has_fd` | `shutil.which("fd")` | `file_ops.py` |
| `has_rg` | `shutil.which("rg")` | `file_ops.py` |
| `has_xdg_open` | `shutil.which("xdg-open")` | `__init__.py` |
| `has_nautilus` | `shutil.which("nautilus")` | `__init__.py` |
| `has_xdotool` | `shutil.which("xdotool")` | `checker.py` |
| `has_wmctrl` | `shutil.which("wmctrl")` | `checker.py` |
| `has_bluetoothctl` | `shutil.which("bluetoothctl")` | `checker.py` |
| `has_nmcli` | `shutil.which("nmcli")` | `checker.py` |
| `has_xrandr` | `shutil.which("xrandr")` | `wifi_bluetooth.py` |
| `has_imagesnap` | `shutil.which("imagesnap")` | `permissions_routes.py` |
| `has_whereami` | `shutil.which("whereami")` | `permissions_routes.py` |
| `has_geoclue` | `shutil.which("geoclue-where-am-i")` | `permissions_routes.py` |
| `has_systemd_inhibit` | `shutil.which("systemd-inhibit")` | `scheduler.py` |
| `has_chrome` / `chrome_path` | `shutil.which(...)` for Chrome | `system.py` |
| `has_display` | `os.environ.get("DISPLAY"/"WAYLAND_DISPLAY")` | `__init__.py`, `browser_automation.py`, `platform_ctx.py` |
| `is_wsl` | 4 independent implementations | Multiple files (see section 10) |

### New `platformCtx.ts` types

The `CapabilityInfo` interface in `desktop/src/lib/platformCtx.ts` must be updated to include all new capability fields so the frontend can access them.

### New convenience function

- `open_path(path: str) -> tuple[bool, str]` — centralized cross-platform file/URL opener in `platform_ctx.py`, replacing the `open_path_cross_platform()` function currently in `app/tools/tools/__init__.py` that uses local platform detection

---

## Summary Statistics

| Category | File Count | Instance Count | Action |
|----------|-----------|----------------|--------|
| Critical (initPlatformCtx) | 1 | 1 | Wire up at startup |
| Pattern A (local IS_*) | 24 | ~48 constants | Mechanical replacement |
| Pattern B (new PLATFORM fields) | 5 | ~20 calls | Add fields + replace |
| Pattern C (sys.platform/os.name) | 5 | ~12 checks | Replace with PLATFORM |
| Pattern D (shutil.which) | 10 | ~17 calls | Add to CAPABILITIES |
| Pattern E (config.py) | 1 | 4 functions | Import from platform_ctx |
| Pattern F (hardcoded paths) | 10+ | ~15 paths | Centralize / fix |
| Frontend TS/TSX | 3 | 4 instances | Replace with platformCtx |
| WSL detection | 4 | 4 implementations | Centralize to 1 |
| Rust (no change) | 6 | 11 uses | Document only |
| Shell scripts (no change) | 7 | ~20 uses | Document only |
| Build configs (no change) | 4 | ~10 entries | Document only |
| **Total violations requiring change** | **~40 files** | **~120+ instances** | |
