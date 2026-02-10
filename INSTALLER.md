## Cross-Platform Compatibility Audit

### What works on all three platforms today

The majority of the codebase is already cross-platform. These use standard Python (`os`, `pathlib`, `asyncio`, `platform`) and work everywhere:

- **File operations** — `Read`, `Write`, `Edit`, `Glob` (Python fallback), `Grep` (Python fallback) — all use `os.path` and `pathlib`, fully portable
- **System tools** — `SystemInfo`, `ListDirectory` — pure `os`/`platform` calls
- **OpenPath** — already has explicit `Darwin`/`Windows`/`Linux` branches
- **OpenUrl** — uses `webbrowser` module, cross-platform
- **WebSocket + REST transport** — FastAPI/uvicorn, fully portable
- **Session management** — all `os.path`, `Path.home()`, works everywhere
- **Logger** — standard library + `concurrent-log-handler`, works everywhere
- **System tray** — `pystray` supports macOS, Windows, and Linux (with AppIndicator)

### Issues that will break on Windows

**1. Shell execution is Unix-only (the biggest problem)**

`execution.py` lines 51 and 92:
```python
shell_path = "/bin/zsh" if os.path.exists("/bin/zsh") else "/bin/bash"
```

And the command wrapping uses bash syntax (`cd && { cmd ; }; __exit_code=$?`). On Windows, there is no `/bin/zsh` or `/bin/bash`. The shell is `cmd.exe` or `powershell.exe`, and the command syntax is completely different.

**Fix needed:** Detect `platform.system() == "Windows"` and use `cmd.exe` or `powershell.exe` with Windows-compatible command wrapping. The cwd sentinel pattern needs a Windows equivalent. `shlex.quote` also doesn't work for Windows (use `subprocess.list2cmdline` or `shlex.join` with different escaping).

**2. `ImageGrab.grab()` — Linux doesn't support it**

Pillow's `ImageGrab` works on macOS and Windows. On Linux, it requires `xdotool` + `scrot` or a different backend. The tool already has a try/except for ImportError but the actual failure on Linux is an `OSError`, which is also caught — so it degrades gracefully (returns an error message, doesn't crash).

**3. `pyaudio` — painful to install on all platforms**

`pyaudio` requires the PortAudio C library to be pre-installed. On macOS it's `brew install portaudio`, on Ubuntu it's `apt install portaudio19-dev`, on Windows you need pre-built wheels. This is the single biggest installation friction point across platforms.

**4. `fd` and `rg` are optional optimizations**

The code checks `shutil.which("fd")` and `shutil.which("rg")` and falls back to pure Python if they're not installed. This is already handled correctly — it's just slower without them.

**5. `asyncpg` — requires PostgreSQL client libs**

`database.py` imports `asyncpg` and hardcodes local credentials. This will fail on any machine without PostgreSQL. But this is a legacy module (not used by the tool system), so it's low priority.

### Summary: What needs work for Windows

| Issue | Severity | Effort |
|-------|----------|--------|
| Bash tool assumes Unix shell | **Blocker** | Medium — need Windows shell path + command wrapping |
| `shlex.quote` doesn't escape for Windows | **Blocker** | Small — conditional escaping |
| cwd sentinel parsing assumes Unix `pwd` | **Blocker** | Small — use `cd` on Windows |
| Screenshot on Linux | Graceful degradation (already handled) | Low |
| `pyaudio` install friction | High friction, not a crash | Medium — consider making it optional |

macOS and Linux work today (Linux just misses screenshots). Windows needs the shell execution rewrite.

---

## Packaging & Installation Assessment

### Where we are now

Right now, a user has to:

1. Install Python 3.13
2. Install `uv`
3. Clone the repo
4. Run `uv sync`
5. Run `uv run run.py`

That's a developer workflow, not an end-user installer. Here's what's needed to get to "click a button on our website, download, and run."

### What's already in place

- **`pystray`** — System tray icon so the app runs in the background with a "Quit" menu. Already wired up in `run.py`.
- **`pyinstaller`** — Already in `pyproject.toml` as a dependency. This is the tool that bundles Python + all dependencies into a single executable.
- **`tufup`** — Already in `pyproject.toml`. This handles auto-updates (The Update Framework). User installs once, app updates itself.

So the dependency choices for packaging are already there. What's missing is the actual build configuration and distribution pipeline.

### What needs to be built

**Phase 1: PyInstaller Bundle (gets us to "download and double-click")**

1. **Create a PyInstaller `.spec` file** — Defines how to bundle the app. Needs to include:
   - The `run.py` entry point
   - All `app/` source files
   - The `static/` directory (tray icon)
   - Hidden imports that PyInstaller can't auto-detect (FastAPI, uvicorn, pydantic)
   - Platform-specific settings (`.app` bundle for macOS, `.exe` for Windows)

2. **macOS: Create a `.app` bundle + `.dmg` installer**
   - PyInstaller can output a `.app` directly
   - Wrap in a `.dmg` for the standard "drag to Applications" experience
   - Sign with an Apple Developer certificate (required for macOS 15+ — unsigned apps get blocked by Gatekeeper)
   - Notarize with Apple (otherwise users see "this app is from an unidentified developer")

3. **Windows: Create a `.exe` + installer**
   - PyInstaller outputs a `.exe`
   - Wrap with NSIS or Inno Setup for a proper installer (Start Menu shortcut, uninstaller, etc.)
   - Sign with a code signing certificate (otherwise Windows SmartScreen blocks it)

4. **Linux: Create an AppImage or `.deb`/`.rpm`**
   - AppImage is the most universal (single file, runs on any distro)
   - Optional: `.deb` for Debian/Ubuntu, `.rpm` for Fedora

**Phase 2: Auto-Update Pipeline**

`tufup` is already a dependency. It needs:

1. A server endpoint (or S3 bucket/GitHub Releases) to host update metadata and binaries
2. A startup check in `run.py` that calls `tufup` to see if a newer version exists
3. Download + apply the update, then restart

**Phase 3: CI/CD Build Pipeline**

- GitHub Actions workflow that builds for all three platforms on every release tag
- macOS runner for `.app` + `.dmg` + signing + notarization
- Windows runner for `.exe` + installer + signing
- Linux runner for AppImage
- Upload artifacts to a download server or GitHub Releases

### Estimated effort to get to "download and install"

| Task | Effort | Blocks user installs? |
|------|--------|----------------------|
| Fix Windows shell execution | 1-2 days | Yes (Windows users) |
| PyInstaller `.spec` file + basic build | 1 day | Yes |
| macOS `.app` + `.dmg` | 1 day | No (can distribute raw `.app`) |
| macOS code signing + notarization | 1 day + Apple Developer account ($99/yr) | Soft block (Gatekeeper warning without it) |
| Windows `.exe` + installer | 1 day | No (can distribute raw `.exe`) |
| Windows code signing | 1 day + code signing certificate (~$200-400/yr) | Soft block (SmartScreen warning without it) |
| Linux AppImage | Half day | No |
| Auto-update with `tufup` | 2-3 days | No (manual updates work) |
| CI/CD pipeline | 2-3 days | No (can build manually) |
| Make `pyaudio` optional | Half day | No |
| Download page on website | 1 day | Yes |

### The fastest path to "download and run"

1. Fix the Windows shell execution (if you want Windows support now)
2. Write the PyInstaller `.spec` file
3. Build on each platform manually (`pyinstaller matrx_local.spec`)
4. Host the resulting files anywhere (S3, GitHub Releases, your own CDN)
5. Add a download page to aimatrx.com with platform detection

That gets you to MVP distribution in about **3-4 days of focused work** (macOS + Windows, without code signing). Code signing and auto-updates come after, and CI/CD automates the ongoing releases.