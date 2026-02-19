# AI Matrx Desktop Application — Local Scraping Architecture

## Executive Summary

The desktop application serves as a **Tier 2/3 fallback** for our scraping pipeline. When our server-side scraper fails (blocked by Cloudflare, DataDome, aggressive WAFs), we route those URLs to the user's desktop app, which scrapes using their **real browser, real IP, and real cookies**. This is effectively undetectable because it *is* a real browser on a real residential connection.

This document covers:

1. Recommended desktop UI framework and why
2. How the Python/FastAPI sidecar integrates with the UI
3. Local browser scraping via the user's actual Chrome
4. Automated site warm-up for stubborn failures
5. Communication with the AI Matrx cloud platform
6. Full implementation guidance

---

## Architecture Decision: Tauri v2 + React + Python Sidecar

### Why Tauri v2 Over Electron

**Recommendation: Use [Tauri v2](https://v2.tauri.app/) for the desktop shell.**

| Factor | Electron | Tauri v2 |
|---|---|---|
| Bundle size | ~150-200 MB (ships Chromium) | ~5-10 MB (uses system WebView) |
| RAM usage | 150-300 MB baseline | 30-80 MB baseline |
| Startup time | 2-5 seconds | < 1 second |
| Backend language | Node.js | Rust (with sidecar support for any language) |
| System WebView | Ships its own Chromium | Uses OS WebView (WebView2 on Windows, WebKit on macOS) |
| Auto-updater | electron-updater (works) | Built-in, smaller deltas |
| Security | Full Node.js access from renderer | Sandboxed by default, explicit permissions |
| Maturity | Very mature, huge ecosystem | v2 is stable (released late 2024), growing fast |
| Python sidecar | Spawn process manually | First-class sidecar support via `tauri-plugin-shell` |

**The critical advantage for us:** Tauri v2 does NOT ship its own browser engine. This matters because we're going to use the user's actual Chrome installation for scraping — we don't want a second Chromium instance eating RAM. Electron would mean two Chromium processes running (Electron's + the one we launch for scraping), while Tauri uses the lightweight system WebView for UI and leaves Chrome available for scraping.

Tauri v2 also has first-class **sidecar** support, which is exactly what we need to run the Python/FastAPI server as a managed child process.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Tauri v2 Desktop App                      │
│                                                              │
│  ┌──────────────────────────────┐                           │
│  │     React/TypeScript UI      │ ◄── System WebView        │
│  │     (same codebase as web)   │                           │
│  └──────────┬───────────────────┘                           │
│             │  HTTP (localhost:18181)                        │
│             │  + Tauri IPC for native ops                    │
│             ▼                                                │
│  ┌──────────────────────────────┐                           │
│  │     Rust Core (Tauri)        │                           │
│  │                              │                           │
│  │  • Window management         │                           │
│  │  • Sidecar lifecycle         │                           │
│  │  • System tray               │                           │
│  │  • Auto-updater              │                           │
│  │  • File system access        │                           │
│  │  • Native notifications      │                           │
│  └──────────┬───────────────────┘                           │
│             │  Spawns & manages                              │
│             ▼                                                │
│  ┌──────────────────────────────┐   ┌────────────────────┐  │
│  │   Python/FastAPI Sidecar     │   │  User's Chrome     │  │
│  │                              │   │  (via Playwright)   │  │
│  │  • Scraping engine           │◄─►│                    │  │
│  │  • Local model inference     │   │  Real cookies      │  │
│  │  • Browser automation        │   │  Real TLS          │  │
│  │  • Cookie management         │   │  Real IP           │  │
│  │  • Warm-up orchestration     │   └────────────────────┘  │
│  └──────────┬───────────────────┘                           │
│             │                                                │
│             │  HTTPS (WebSocket + REST)                      │
│             ▼                                                │
│  ┌──────────────────────────────┐                           │
│  │   AI Matrx Cloud Platform    │                           │
│  │                              │                           │
│  │  • Scrape job queue          │                           │
│  │  • Failed URL routing        │                           │
│  │  • Result aggregation        │                           │
│  └──────────────────────────────┘                           │
└─────────────────────────────────────────────────────────────┘
```

### Tech Stack Summary

| Layer | Technology | Purpose |
|---|---|---|
| Desktop shell | Tauri v2 (Rust) | Window, tray, lifecycle, IPC, updater |
| UI | React + TypeScript + Vite | Same component library as the web app |
| Local server | Python 3.12+ / FastAPI | Scraping, browser automation, local AI |
| Browser automation | Playwright (Python) | Controls user's actual Chrome |
| Build/package | `tauri-cli` + `PyInstaller` or `PyApp` | Bundle Python as a standalone sidecar |
| IPC | HTTP on `localhost:18181` | UI ↔ Python communication |

---

## Part 1: Project Setup

### Tauri v2 + React

```bash
# Create the Tauri v2 project with React + TypeScript
npm create tauri-app@latest aimatrx-desktop -- \
  --template react-ts \
  --manager npm

cd aimatrx-desktop

# Install Tauri v2 plugins we'll need
npm install @tauri-apps/plugin-shell      # Sidecar management
npm install @tauri-apps/plugin-notification # Native notifications
npm install @tauri-apps/plugin-autostart   # Launch on startup (optional)
npm install @tauri-apps/plugin-store       # Local key-value storage
```

### Tauri Configuration

```json
// src-tauri/tauri.conf.json
{
  "$schema": "https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-cli/config.schema.json",
  "productName": "AI Matrx",
  "identifier": "com.aimatrx.desktop",
  "version": "1.0.0",
  "build": {
    "frontendDist": "../dist"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "title": "AI Matrx",
        "width": 1200,
        "height": 800,
        "minWidth": 900,
        "minHeight": 600,
        "resizable": true,
        "decorations": true
      }
    ],
    "trayIcon": {
      "iconPath": "icons/tray-icon.png",
      "tooltip": "AI Matrx Desktop"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "resources": [
      "sidecar/*"
    ],
    "externalBin": [
      "sidecar/aimatrx-engine"
    ]
  },
  "plugins": {
    "shell": {
      "sidecar": true
    }
  }
}
```

### Capability Permissions

```json
// src-tauri/capabilities/default.json
{
  "identifier": "default",
  "description": "Default permissions for AI Matrx Desktop",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "shell:allow-spawn",
    "shell:allow-execute",
    "notification:default",
    "store:default"
  ]
}
```

---

## Part 2: Python Sidecar — Packaging & Lifecycle

### Packaging Python as a Sidecar

The Python/FastAPI server needs to be bundled as a standalone executable so users don't need Python installed. Use **PyInstaller** or **PyApp** to create a single binary.

```bash
# In your Python project directory
pip install pyinstaller

# Create the executable
pyinstaller \
  --name aimatrx-engine \
  --onefile \
  --hidden-import uvicorn \
  --hidden-import playwright \
  --add-data "models:models" \
  main.py
```

The output binary goes into `src-tauri/sidecar/` with platform-specific naming:

```
src-tauri/sidecar/
  aimatrx-engine-x86_64-pc-windows-msvc.exe    # Windows
  aimatrx-engine-x86_64-apple-darwin            # macOS Intel
  aimatrx-engine-aarch64-apple-darwin           # macOS Apple Silicon
  aimatrx-engine-x86_64-unknown-linux-gnu       # Linux
```

> **Note:** Tauri expects sidecar binaries to follow this naming convention for cross-platform builds. The `externalBin` config handles the platform resolution automatically.

### Sidecar Lifecycle Management (Rust Side)

```rust
// src-tauri/src/lib.rs

use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use std::sync::Mutex;

struct SidecarState {
    child: Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
}

#[tauri::command]
async fn start_sidecar(app: tauri::AppHandle, state: tauri::State<'_, SidecarState>) -> Result<(), String> {
    let sidecar = app.shell()
        .sidecar("aimatrx-engine")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?
        .args(["--port", "18181", "--host", "127.0.0.1"]);

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    // Store the child process handle so we can kill it on shutdown
    *state.child.lock().unwrap() = Some(child);

    // Forward sidecar stdout/stderr to Tauri logs
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                    println!("[sidecar] {}", String::from_utf8_lossy(&line));
                }
                tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                    eprintln!("[sidecar] {}", String::from_utf8_lossy(&line));
                }
                tauri_plugin_shell::process::CommandEvent::Terminated(status) => {
                    eprintln!("[sidecar] Process terminated: {:?}", status);
                }
                _ => {}
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn stop_sidecar(state: tauri::State<'_, SidecarState>) -> Result<(), String> {
    if let Some(child) = state.child.lock().unwrap().take() {
        child.kill().map_err(|e| format!("Failed to kill sidecar: {}", e))?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(SidecarState {
            child: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![start_sidecar, stop_sidecar])
        .on_window_event(|window, event| {
            // Gracefully shutdown sidecar when window closes
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<SidecarState>();
                if let Some(child) = state.child.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### Sidecar Management from React

```typescript
// src/lib/sidecar.ts

import { invoke } from '@tauri-apps/api/core';

const SIDECAR_URL = 'http://127.0.0.1:18181';
const HEALTH_CHECK_INTERVAL = 5000;

export async function startSidecar(): Promise<void> {
  await invoke('start_sidecar');
  
  // Wait for the FastAPI server to be ready
  let retries = 0;
  while (retries < 30) {
    try {
      const resp = await fetch(`${SIDECAR_URL}/health`);
      if (resp.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
    retries++;
  }
  
  throw new Error('Sidecar failed to start within 15 seconds');
}

export async function stopSidecar(): Promise<void> {
  await invoke('stop_sidecar');
}

export async function isSidecarRunning(): Promise<boolean> {
  try {
    const resp = await fetch(`${SIDECAR_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}
```

---

## Part 3: Local Browser Scraping via Playwright

This is the core value of the desktop app. We use Playwright to control the user's actual Chrome installation, getting all the benefits of a real browser with zero anti-detection concerns.

### Chrome Discovery and Connection

```python
# chrome_discovery.py

import platform
import subprocess
import shutil
from pathlib import Path
from typing import Optional
import logging

logger = logging.getLogger(__name__)


def find_chrome_executable() -> Optional[str]:
    """
    Locate the user's installed Chrome/Chromium executable.
    Returns the path or None if not found.
    """
    system = platform.system()
    
    if system == "Windows":
        candidates = [
            Path.home() / "AppData" / "Local" / "Google" / "Chrome" / "Application" / "chrome.exe",
            Path("C:/Program Files/Google/Chrome/Application/chrome.exe"),
            Path("C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"),
            # Edge as fallback (Chromium-based, works identically)
            Path("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"),
            Path("C:/Program Files/Microsoft/Edge/Application/msedge.exe"),
        ]
    elif system == "Darwin":  # macOS
        candidates = [
            Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            Path.home() / "Applications" / "Google Chrome.app" / "Contents" / "MacOS" / "Google Chrome",
            Path("/Applications/Chromium.app/Contents/MacOS/Chromium"),
            # Edge as fallback
            Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
        ]
    else:  # Linux
        candidates = [
            Path(p) for p in [
                shutil.which("google-chrome") or "",
                shutil.which("google-chrome-stable") or "",
                shutil.which("chromium-browser") or "",
                shutil.which("chromium") or "",
            ] if p
        ]
    
    for candidate in candidates:
        if candidate.exists():
            logger.info(f"Found Chrome at: {candidate}")
            return str(candidate)
    
    return None


def find_chrome_user_data_dir() -> Optional[str]:
    """
    Locate the user's Chrome profile directory.
    This contains cookies, history, saved passwords, etc.
    """
    system = platform.system()
    
    if system == "Windows":
        path = Path.home() / "AppData" / "Local" / "Google" / "Chrome" / "User Data"
    elif system == "Darwin":
        path = Path.home() / "Library" / "Application Support" / "Google" / "Chrome"
    else:
        path = Path.home() / ".config" / "google-chrome"
    
    if path.exists():
        return str(path)
    return None


def get_chrome_version(executable: str) -> Optional[str]:
    """Get the installed Chrome version."""
    try:
        if platform.system() == "Windows":
            result = subprocess.run(
                [executable, "--version"],
                capture_output=True, text=True, timeout=5
            )
        else:
            result = subprocess.run(
                [executable, "--version"],
                capture_output=True, text=True, timeout=5
            )
        
        # Output is like "Google Chrome 131.0.6778.108"
        version = result.stdout.strip().split()[-1]
        return version
    except Exception:
        return None
```

### Browser Scraping Engine

```python
# local_scraper.py

import asyncio
import json
import logging
import random
import tempfile
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Dict
from playwright.async_api import async_playwright, Browser, BrowserContext, Page

from chrome_discovery import find_chrome_executable, find_chrome_user_data_dir

logger = logging.getLogger(__name__)


@dataclass
class ScrapeResult:
    url: str
    success: bool
    status_code: int
    content: str = ""
    title: str = ""
    content_type: str = ""
    response_url: str = ""
    response_headers: Dict[str, str] = field(default_factory=dict)
    error: Optional[str] = None
    elapsed_ms: int = 0


@dataclass
class ScrapeJob:
    urls: List[str]
    # How long to wait for each page to load (ms)
    page_timeout: int = 30000
    # Delay between requests to the same domain (seconds)
    min_delay: float = 1.0
    max_delay: float = 3.5
    # Whether to run warm-up first for failed sites
    warm_up: bool = False
    warm_up_scroll: bool = True
    warm_up_accept_cookies: bool = True


class LocalBrowserScraper:
    """
    Scrapes URLs using the user's actual Chrome installation.
    
    This provides:
    - Real residential IP address
    - Real TLS fingerprint (JA3/JA4 matches Chrome exactly because it IS Chrome)
    - Real cookies from the user's browsing history
    - Real browser headers, HTTP/2 settings, etc.
    - Passes all JavaScript challenges (Cloudflare Turnstile, etc.)
    
    There are two modes:
    
    1. CONNECTED MODE (preferred): Connects to the user's running Chrome 
       via Chrome DevTools Protocol. Shares cookies, sessions, everything.
       Limitation: Chrome must be launched with --remote-debugging-port.
       
    2. PROFILE COPY MODE (fallback): Copies the user's Chrome profile to 
       a temp directory and launches a separate Chrome instance with it.
       Gets their cookies but doesn't interfere with their active browsing.
       This is the safer default for production.
    """
    
    def __init__(self):
        self.chrome_path = find_chrome_executable()
        self.user_data_dir = find_chrome_user_data_dir()
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._playwright = None
        self._temp_profile_dir: Optional[str] = None
    
    async def initialize(self) -> bool:
        """
        Initialize the browser engine.
        Returns True if Chrome was found and is ready.
        """
        if not self.chrome_path:
            logger.error("Chrome not found on this system")
            return False
        
        logger.info(f"Using Chrome at: {self.chrome_path}")
        logger.info(f"User data dir: {self.user_data_dir}")
        
        return True
    
    async def _create_profile_copy(self) -> str:
        """
        Create a temporary copy of the user's Chrome profile.
        
        We copy only the essential files (cookies, local storage, etc.)
        rather than the entire profile (which can be gigabytes).
        """
        temp_dir = tempfile.mkdtemp(prefix="aimatrx_chrome_")
        default_src = Path(self.user_data_dir) / "Default"
        default_dst = Path(temp_dir) / "Default"
        default_dst.mkdir(parents=True, exist_ok=True)
        
        # Files that contain the data we need
        essential_files = [
            "Cookies",              # Cookie database
            "Cookies-journal",      # Cookie write-ahead log
            "Local State",          # Browser state
            "Preferences",          # User preferences
            "Secure Preferences",   # Secure prefs
        ]
        
        # Copy essential files from Default profile
        for filename in essential_files:
            src = default_src / filename
            if src.exists():
                shutil.copy2(str(src), str(default_dst / filename))
        
        # Copy Local Storage (small, contains site preferences)
        local_storage_src = default_src / "Local Storage"
        if local_storage_src.exists():
            shutil.copytree(
                str(local_storage_src),
                str(default_dst / "Local Storage"),
                dirs_exist_ok=True
            )
        
        # Copy the top-level Local State file
        local_state = Path(self.user_data_dir) / "Local State"
        if local_state.exists():
            shutil.copy2(str(local_state), str(Path(temp_dir) / "Local State"))
        
        self._temp_profile_dir = temp_dir
        logger.info(f"Created profile copy at: {temp_dir}")
        return temp_dir
    
    async def start_browser(self, headless: bool = True) -> None:
        """
        Launch a Chrome instance using a copy of the user's profile.
        
        Args:
            headless: Run without visible window. Set to False for debugging 
                      or if you want the user to see what's happening.
        """
        profile_dir = await self._create_profile_copy()
        
        self._playwright = await async_playwright().start()
        
        self._browser = await self._playwright.chromium.launch_persistent_context(
            user_data_dir=profile_dir,
            executable_path=self.chrome_path,
            headless=headless,
            # Critical: these args make the headless browser look more real
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-features=IsolateOrigins,site-per-process",
                "--disable-infobars",
                "--no-first-run",
                "--no-default-browser-check",
            ],
            # Don't override viewport — use the actual screen size
            no_viewport=True,
            # Accept all SSL certificates (some internal sites use self-signed)
            ignore_https_errors=True,
        )
        
        # Remove the "Chrome is being controlled by automated test software" bar
        # by injecting a script that overrides navigator.webdriver
        await self._browser.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
            
            // Override the permissions API to look normal
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );
            
            // Mimic normal Chrome plugins array
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5]
            });
            
            // Mimic normal Chrome languages
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en']
            });
        """)
        
        logger.info("Browser started with user profile")
    
    async def scrape_url(self, url: str, timeout: int = 30000) -> ScrapeResult:
        """
        Scrape a single URL using the browser.
        """
        import time
        start = time.monotonic()
        
        if not self._browser:
            return ScrapeResult(
                url=url, success=False, status_code=0,
                error="Browser not started"
            )
        
        page: Optional[Page] = None
        try:
            page = await self._browser.new_page()
            
            # Navigate and wait for the page to be fully loaded
            response = await page.goto(url, wait_until="domcontentloaded", timeout=timeout)
            
            # Wait a bit for dynamic content and JS challenges to resolve
            # Cloudflare Turnstile typically resolves within 2-5 seconds
            await page.wait_for_load_state("networkidle", timeout=15000)
            
            # Additional wait if we detect a challenge page
            title = await page.title()
            if any(indicator in title.lower() for indicator in [
                "just a moment", "attention required", "cloudflare", 
                "checking your browser", "please wait"
            ]):
                logger.info(f"Challenge page detected for {url}, waiting...")
                # Wait up to 15 more seconds for the challenge to resolve
                try:
                    await page.wait_for_function(
                        """() => {
                            const title = document.title.toLowerCase();
                            return !title.includes('just a moment') && 
                                   !title.includes('attention required') &&
                                   !title.includes('checking your browser') &&
                                   !title.includes('please wait');
                        }""",
                        timeout=15000
                    )
                    # Re-read after challenge resolved
                    title = await page.title()
                except Exception:
                    logger.warning(f"Challenge did not resolve for {url}")
            
            # Get the page content
            content = await page.content()
            final_url = page.url
            status_code = response.status if response else 0
            headers = await response.all_headers() if response else {}
            content_type = headers.get("content-type", "")
            
            elapsed = int((time.monotonic() - start) * 1000)
            
            return ScrapeResult(
                url=url,
                success=status_code < 400,
                status_code=status_code,
                content=content,
                title=title,
                content_type=content_type,
                response_url=final_url,
                response_headers=headers,
                elapsed_ms=elapsed,
            )
        
        except Exception as e:
            elapsed = int((time.monotonic() - start) * 1000)
            logger.error(f"Failed to scrape {url}: {e}")
            return ScrapeResult(
                url=url,
                success=False,
                status_code=0,
                error=str(e),
                elapsed_ms=elapsed,
            )
        finally:
            if page:
                await page.close()
    
    async def scrape_batch(self, job: ScrapeJob) -> List[ScrapeResult]:
        """
        Scrape a batch of URLs with human-like delays between requests.
        Groups URLs by domain to maintain session continuity.
        """
        from urllib.parse import urlparse
        from collections import defaultdict
        
        # Group URLs by domain for session continuity
        by_domain: Dict[str, List[str]] = defaultdict(list)
        for url in job.urls:
            domain = urlparse(url).netloc
            by_domain[domain].append(url)
        
        results: List[ScrapeResult] = []
        
        for domain, urls in by_domain.items():
            logger.info(f"Scraping {len(urls)} URLs from {domain}")
            
            for i, url in enumerate(urls):
                result = await self.scrape_url(url, timeout=job.page_timeout)
                results.append(result)
                
                # Human-like delay between pages on the same domain
                if i < len(urls) - 1:
                    delay = random.uniform(job.min_delay, job.max_delay)
                    # Occasionally pause longer (simulates reading)
                    if random.random() < 0.2:
                        delay += random.uniform(2.0, 6.0)
                    await asyncio.sleep(delay)
            
            # Longer pause between different domains
            await asyncio.sleep(random.uniform(1.0, 2.5))
        
        return results
    
    async def warm_up_sites(
        self,
        urls: List[str],
        scroll: bool = True,
        accept_cookies: bool = True,
    ) -> List[Dict]:
        """
        Visit sites in the browser to establish cookies and browsing history.
        
        This is Tier 3: for sites that block even real browsers on first visit
        because they require established cookie history.
        
        The warm-up process for each site:
        1. Load the homepage (not necessarily the target URL)
        2. Accept cookie consent banners
        3. Scroll down to trigger lazy-loaded content (proves human behavior)
        4. Maybe click one internal link
        5. Wait for all cookies to be set
        6. Close the tab
        
        After warm-up, the cookies persist in the browser profile and 
        subsequent scrape requests will include them automatically.
        """
        from urllib.parse import urlparse
        
        warm_up_results = []
        
        for url in urls:
            parsed = urlparse(url)
            homepage = f"{parsed.scheme}://{parsed.netloc}"
            
            page = None
            try:
                page = await self._browser.new_page()
                
                # Step 1: Visit the homepage
                logger.info(f"Warming up: {homepage}")
                await page.goto(homepage, wait_until="domcontentloaded", timeout=20000)
                
                # Wait for the page to settle
                try:
                    await page.wait_for_load_state("networkidle", timeout=10000)
                except Exception:
                    pass  # Some sites never reach networkidle
                
                # Step 2: Wait for and handle any Cloudflare/bot challenges
                await asyncio.sleep(3)
                
                # Step 3: Accept cookie consent banners
                if accept_cookies:
                    await self._accept_cookie_banner(page)
                
                # Step 4: Scroll to simulate human reading behavior
                if scroll:
                    await self._human_scroll(page)
                
                # Step 5: Optionally click an internal link to build more history
                await self._click_internal_link(page, parsed.netloc)
                
                # Step 6: Wait a moment for all tracking cookies to be set
                await asyncio.sleep(2)
                
                # Get the cookies that were set
                cookies = await self._browser.cookies(homepage)
                
                warm_up_results.append({
                    "url": homepage,
                    "success": True,
                    "cookies_set": len(cookies),
                    "cookie_names": [c["name"] for c in cookies[:10]],
                })
                
                logger.info(f"Warm-up complete for {homepage}: {len(cookies)} cookies set")
                
            except Exception as e:
                logger.error(f"Warm-up failed for {homepage}: {e}")
                warm_up_results.append({
                    "url": homepage,
                    "success": False,
                    "error": str(e),
                })
            finally:
                if page:
                    await page.close()
                
                # Delay between sites
                await asyncio.sleep(random.uniform(2.0, 4.0))
        
        return warm_up_results
    
    async def _accept_cookie_banner(self, page: Page) -> None:
        """
        Try to find and click common cookie consent buttons.
        This uses a cascade of common selectors and text patterns.
        """
        # Common cookie consent button selectors (ordered by likelihood)
        selectors = [
            # OneTrust (very common)
            '#onetrust-accept-btn-handler',
            # Cookiebot
            '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
            '#CybotCookiebotDialogBodyButtonAccept',
            # Generic patterns
            'button[data-cookiefirst-action="accept"]',
            '[data-testid="cookie-policy-dialog-accept-button"]',
            '.cookie-consent-accept',
            '#cookie-accept',
            '#accept-cookies',
            '#acceptAllCookies',
            '.cc-accept',
            '.cc-btn.cc-allow',
            # GDPR banners
            '.gdpr-accept',
            '#gdpr-cookie-accept',
        ]
        
        for selector in selectors:
            try:
                button = page.locator(selector).first
                if await button.is_visible(timeout=500):
                    await button.click()
                    logger.info(f"Clicked cookie consent: {selector}")
                    await asyncio.sleep(1)
                    return
            except Exception:
                continue
        
        # Fallback: look for buttons by text content
        text_patterns = [
            "Accept all",
            "Accept All",
            "Accept cookies",
            "Accept Cookies",
            "Allow all",
            "Allow All",
            "I agree",
            "Got it",
            "OK",
            "Agree",
            "Consent",
            "I Accept",
        ]
        
        for text in text_patterns:
            try:
                button = page.get_by_role("button", name=text, exact=False).first
                if await button.is_visible(timeout=300):
                    await button.click()
                    logger.info(f"Clicked cookie consent by text: '{text}'")
                    await asyncio.sleep(1)
                    return
            except Exception:
                continue
    
    async def _human_scroll(self, page: Page) -> None:
        """
        Scroll the page like a human would — not instant, not uniform.
        This triggers lazy-loaded content and proves human behavior to
        anti-bot systems that track mouse/scroll events.
        """
        try:
            viewport_height = await page.evaluate("window.innerHeight")
            total_height = await page.evaluate("document.body.scrollHeight")
            
            current = 0
            while current < min(total_height, viewport_height * 4):
                # Scroll by a variable amount (not exactly one viewport)
                scroll_amount = random.randint(
                    int(viewport_height * 0.3),
                    int(viewport_height * 0.8)
                )
                await page.evaluate(f"window.scrollBy(0, {scroll_amount})")
                current += scroll_amount
                
                # Variable pause (humans read at different speeds)
                await asyncio.sleep(random.uniform(0.3, 1.2))
            
            # Scroll back to top (common human behavior)
            await page.evaluate("window.scrollTo(0, 0)")
            await asyncio.sleep(0.5)
            
        except Exception as e:
            logger.debug(f"Scroll failed (non-critical): {e}")
    
    async def _click_internal_link(self, page: Page, domain: str) -> None:
        """
        Click one internal link to build browsing history on the site.
        """
        try:
            # Find all internal links
            links = await page.evaluate(f"""
                () => {{
                    const links = Array.from(document.querySelectorAll('a[href]'));
                    return links
                        .map(a => a.href)
                        .filter(href => {{
                            try {{
                                const url = new URL(href);
                                return url.hostname === '{domain}' && 
                                       url.pathname !== '/' &&
                                       url.pathname.length > 1 &&
                                       !href.includes('#') &&
                                       !href.match(/\.(pdf|zip|png|jpg|gif|svg)$/i);
                            }} catch {{ return false; }}
                        }})
                        .slice(0, 20);
                }}
            """)
            
            if links:
                # Pick a random link from the first 20
                target = random.choice(links[:min(10, len(links))])
                logger.info(f"Clicking internal link: {target}")
                await page.goto(target, wait_until="domcontentloaded", timeout=15000)
                await asyncio.sleep(random.uniform(1.5, 3.0))
                
                # Quick scroll on the second page too
                await self._human_scroll(page)
        except Exception as e:
            logger.debug(f"Internal link click failed (non-critical): {e}")
    
    async def shutdown(self) -> None:
        """Clean up browser and temporary files."""
        if self._browser:
            await self._browser.close()
            self._browser = None
        
        if self._playwright:
            await self._playwright.stop()
            self._playwright = None
        
        if self._temp_profile_dir:
            try:
                shutil.rmtree(self._temp_profile_dir)
                logger.info(f"Cleaned up temp profile: {self._temp_profile_dir}")
            except Exception as e:
                logger.warning(f"Failed to clean temp profile: {e}")
            self._temp_profile_dir = None
```

---

## Part 4: FastAPI Endpoints

### Add These Routes to the Existing FastAPI Server

```python
# routes/local_scrape.py

import asyncio
import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from local_scraper import LocalBrowserScraper, ScrapeJob, ScrapeResult

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/local-scrape", tags=["local-scrape"])

# Singleton scraper instance — reuse across requests
_scraper: Optional[LocalBrowserScraper] = None
_scraper_lock = asyncio.Lock()


async def get_scraper() -> LocalBrowserScraper:
    """Get or create the scraper singleton."""
    global _scraper
    async with _scraper_lock:
        if _scraper is None:
            _scraper = LocalBrowserScraper()
            initialized = await _scraper.initialize()
            if not initialized:
                _scraper = None
                raise HTTPException(
                    status_code=503,
                    detail="Chrome not found. Please install Google Chrome."
                )
            await _scraper.start_browser(headless=True)
        return _scraper


# ── Request/Response Models ──────────────────────────────────

class ScrapeRequest(BaseModel):
    urls: List[str]
    page_timeout: int = Field(default=30000, ge=5000, le=120000)
    min_delay: float = Field(default=1.0, ge=0.5, le=10.0)
    max_delay: float = Field(default=3.5, ge=1.0, le=30.0)

class WarmUpRequest(BaseModel):
    urls: List[str]
    scroll: bool = True
    accept_cookies: bool = True

class ScrapeResultResponse(BaseModel):
    url: str
    success: bool
    status_code: int
    content: str = ""
    title: str = ""
    content_type: str = ""
    response_url: str = ""
    error: Optional[str] = None
    elapsed_ms: int = 0

class WarmUpResultResponse(BaseModel):
    url: str
    success: bool
    cookies_set: int = 0
    cookie_names: List[str] = []
    error: Optional[str] = None

class BrowserStatusResponse(BaseModel):
    chrome_found: bool
    chrome_path: Optional[str]
    chrome_version: Optional[str]
    profile_found: bool
    browser_running: bool


# ── Endpoints ────────────────────────────────────────────────

@router.get("/status", response_model=BrowserStatusResponse)
async def browser_status():
    """
    Check if Chrome is available and the scraper is running.
    The UI should call this on startup to show the browser status indicator.
    """
    from chrome_discovery import find_chrome_executable, find_chrome_user_data_dir, get_chrome_version
    
    chrome_path = find_chrome_executable()
    chrome_version = get_chrome_version(chrome_path) if chrome_path else None
    profile_found = find_chrome_user_data_dir() is not None
    
    return BrowserStatusResponse(
        chrome_found=chrome_path is not None,
        chrome_path=chrome_path,
        chrome_version=chrome_version,
        profile_found=profile_found,
        browser_running=_scraper is not None,
    )


@router.post("/scrape", response_model=List[ScrapeResultResponse])
async def scrape_urls(request: ScrapeRequest):
    """
    Scrape URLs using the user's local Chrome browser.
    
    This is the primary endpoint called when server-side scraping fails.
    The cloud platform sends failed URLs here, and we scrape them using
    the real browser with real cookies and a real IP.
    """
    scraper = await get_scraper()
    
    job = ScrapeJob(
        urls=request.urls,
        page_timeout=request.page_timeout,
        min_delay=request.min_delay,
        max_delay=request.max_delay,
    )
    
    results = await scraper.scrape_batch(job)
    
    return [
        ScrapeResultResponse(
            url=r.url,
            success=r.success,
            status_code=r.status_code,
            content=r.content,
            title=r.title,
            content_type=r.content_type,
            response_url=r.response_url,
            error=r.error,
            elapsed_ms=r.elapsed_ms,
        )
        for r in results
    ]


@router.post("/warm-up", response_model=List[WarmUpResultResponse])
async def warm_up_sites(request: WarmUpRequest):
    """
    Visit sites to establish cookies and browsing history before scraping.
    
    Tier 3 approach: for sites that even block real browsers on first visit.
    After warm-up, call /scrape with the actual target URLs.
    """
    scraper = await get_scraper()
    
    results = await scraper.warm_up_sites(
        urls=request.urls,
        scroll=request.scroll,
        accept_cookies=request.accept_cookies,
    )
    
    return [
        WarmUpResultResponse(**r) for r in results
    ]


@router.post("/warm-up-and-scrape", response_model=List[ScrapeResultResponse])
async def warm_up_then_scrape(request: ScrapeRequest):
    """
    Combined endpoint: warm up sites first, then scrape them.
    Most convenient for the "retry failed URLs" workflow.
    """
    scraper = await get_scraper()
    
    # Step 1: Warm up all domains
    logger.info(f"Warming up {len(request.urls)} URLs before scraping")
    await scraper.warm_up_sites(
        urls=request.urls,
        scroll=True,
        accept_cookies=True,
    )
    
    # Step 2: Now scrape the actual URLs
    logger.info(f"Starting scrape of {len(request.urls)} URLs after warm-up")
    job = ScrapeJob(
        urls=request.urls,
        page_timeout=request.page_timeout,
        min_delay=request.min_delay,
        max_delay=request.max_delay,
    )
    
    results = await scraper.scrape_batch(job)
    
    return [
        ScrapeResultResponse(
            url=r.url,
            success=r.success,
            status_code=r.status_code,
            content=r.content,
            title=r.title,
            content_type=r.content_type,
            response_url=r.response_url,
            error=r.error,
            elapsed_ms=r.elapsed_ms,
        )
        for r in results
    ]


@router.post("/shutdown")
async def shutdown_browser():
    """Gracefully shut down the browser."""
    global _scraper
    if _scraper:
        await _scraper.shutdown()
        _scraper = None
    return {"status": "shutdown"}
```

### Register the Router in Your Main App

```python
# main.py (add to your existing FastAPI app)

from fastapi import FastAPI
from routes.local_scrape import router as local_scrape_router

app = FastAPI(title="AI Matrx Desktop Engine")

# ... your existing routes ...

app.include_router(local_scrape_router)

@app.get("/health")
async def health():
    return {"status": "ok", "service": "aimatrx-desktop-engine"}
```

---

## Part 5: Cloud ↔ Desktop Communication

The AI Matrx cloud platform needs to be able to send failed URLs to the user's desktop app. There are two approaches — use both.

### Approach A: Polling (Simple, Works Always)

The desktop app periodically checks for pending scrape jobs assigned to it.

```python
# cloud_sync.py

import asyncio
import httpx
import logging
from typing import Optional

logger = logging.getLogger(__name__)

CLOUD_API_BASE = "https://api.aimatrx.com"


class CloudSync:
    """
    Handles communication between the desktop app and the AI Matrx cloud.
    
    The cloud platform can assign scrape jobs to the desktop app when 
    server-side scraping fails. This class polls for pending jobs and
    reports results back.
    """
    
    def __init__(self, auth_token: str, device_id: str):
        self.auth_token = auth_token
        self.device_id = device_id
        self._running = False
        self._poll_interval = 5  # seconds
    
    async def register_device(self) -> bool:
        """
        Register this desktop app instance with the cloud platform.
        Called on startup. Lets the cloud know this device is available 
        for local scraping jobs.
        """
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(
                    f"{CLOUD_API_BASE}/api/devices/register",
                    headers={"Authorization": f"Bearer {self.auth_token}"},
                    json={
                        "device_id": self.device_id,
                        "capabilities": ["local_scrape", "warm_up"],
                        "status": "online",
                    },
                )
                return resp.status_code == 200
            except Exception as e:
                logger.error(f"Device registration failed: {e}")
                return False
    
    async def poll_for_jobs(self) -> Optional[dict]:
        """Check if the cloud has any pending scrape jobs for this device."""
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(
                    f"{CLOUD_API_BASE}/api/devices/{self.device_id}/pending-jobs",
                    headers={"Authorization": f"Bearer {self.auth_token}"},
                    timeout=10,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if data.get("jobs"):
                        return data
                return None
            except Exception:
                return None
    
    async def report_results(self, job_id: str, results: list) -> bool:
        """Send scrape results back to the cloud platform."""
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(
                    f"{CLOUD_API_BASE}/api/devices/{self.device_id}/results",
                    headers={"Authorization": f"Bearer {self.auth_token}"},
                    json={
                        "job_id": job_id,
                        "results": results,
                    },
                    timeout=30,
                )
                return resp.status_code == 200
            except Exception as e:
                logger.error(f"Failed to report results: {e}")
                return False
    
    async def start_polling(self, scraper_callback):
        """
        Start the polling loop. 
        scraper_callback receives a job dict and returns results.
        """
        self._running = True
        logger.info("Started polling for cloud scrape jobs")
        
        while self._running:
            try:
                job_data = await self.poll_for_jobs()
                if job_data:
                    for job in job_data["jobs"]:
                        logger.info(f"Received job {job['id']} with {len(job['urls'])} URLs")
                        results = await scraper_callback(job)
                        await self.report_results(job["id"], results)
            except Exception as e:
                logger.error(f"Polling error: {e}")
            
            await asyncio.sleep(self._poll_interval)
    
    def stop_polling(self):
        self._running = False
```

### Approach B: WebSocket (Real-Time, Better UX)

For immediate job delivery without polling delay.

```python
# cloud_websocket.py

import asyncio
import json
import logging
import websockets

logger = logging.getLogger(__name__)

CLOUD_WS_URL = "wss://api.aimatrx.com/ws/desktop"


class CloudWebSocket:
    """
    Real-time connection to the AI Matrx cloud.
    Receives scrape jobs instantly when they're assigned.
    Falls back to polling if the WebSocket disconnects.
    """
    
    def __init__(self, auth_token: str, device_id: str):
        self.auth_token = auth_token
        self.device_id = device_id
        self._ws = None
        self._running = False
    
    async def connect(self, scraper_callback):
        """Establish WebSocket connection and listen for jobs."""
        self._running = True
        
        while self._running:
            try:
                async with websockets.connect(
                    f"{CLOUD_WS_URL}?device_id={self.device_id}",
                    additional_headers={
                        "Authorization": f"Bearer {self.auth_token}"
                    },
                    ping_interval=30,
                    ping_timeout=10,
                ) as ws:
                    self._ws = ws
                    logger.info("WebSocket connected to cloud")
                    
                    # Send initial status
                    await ws.send(json.dumps({
                        "type": "status",
                        "status": "ready",
                    }))
                    
                    async for message in ws:
                        data = json.loads(message)
                        
                        if data["type"] == "scrape_job":
                            # Process the job
                            logger.info(f"Received job via WebSocket: {data['job_id']}")
                            
                            # Acknowledge receipt
                            await ws.send(json.dumps({
                                "type": "job_ack",
                                "job_id": data["job_id"],
                            }))
                            
                            # Run the scrape
                            results = await scraper_callback(data)
                            
                            # Send results back via WebSocket
                            await ws.send(json.dumps({
                                "type": "job_results",
                                "job_id": data["job_id"],
                                "results": results,
                            }))
                        
                        elif data["type"] == "ping":
                            await ws.send(json.dumps({"type": "pong"}))
            
            except Exception as e:
                logger.warning(f"WebSocket disconnected: {e}")
                if self._running:
                    logger.info("Reconnecting in 5 seconds...")
                    await asyncio.sleep(5)
    
    async def disconnect(self):
        self._running = False
        if self._ws:
            await self._ws.close()
```

---

## Part 6: React UI Components

These components go in the Tauri app's React frontend. Since the frontend talks to the Python sidecar over `localhost:18181`, these are standard React components with fetch calls.

### Scrape Status Dashboard

```typescript
// src/components/LocalScrapeStatus.tsx

import { useState, useEffect } from 'react';

interface BrowserStatus {
  chrome_found: boolean;
  chrome_path: string | null;
  chrome_version: string | null;
  profile_found: boolean;
  browser_running: boolean;
}

const SIDECAR_URL = 'http://127.0.0.1:18181';

export function LocalScrapeStatus() {
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);
  
  async function fetchStatus() {
    try {
      const resp = await fetch(`${SIDECAR_URL}/local-scrape/status`);
      setStatus(await resp.json());
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }
  
  if (loading) return <div>Checking browser status...</div>;
  
  if (!status) {
    return (
      <div className="p-4 bg-red-50 rounded-lg border border-red-200">
        <p className="font-medium text-red-800">Desktop engine is not running</p>
        <p className="text-sm text-red-600 mt-1">
          The local scraping engine needs to be started.
        </p>
      </div>
    );
  }
  
  return (
    <div className="p-4 bg-white rounded-lg border space-y-3">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${
          status.browser_running ? 'bg-green-500' : 'bg-yellow-500'
        }`} />
        <span className="font-medium">
          {status.browser_running ? 'Browser Ready' : 'Browser Standby'}
        </span>
      </div>
      
      {status.chrome_found ? (
        <div className="text-sm text-gray-600">
          Chrome {status.chrome_version} detected
        </div>
      ) : (
        <div className="text-sm text-red-600">
          Chrome not found — please install Google Chrome for local scraping
        </div>
      )}
      
      {status.profile_found && (
        <div className="text-sm text-gray-500">
          Browser profile found (cookies available)
        </div>
      )}
    </div>
  );
}
```

### Failed URLs Retry Panel

```typescript
// src/components/RetryFailedUrls.tsx

import { useState } from 'react';

interface RetryProps {
  failedUrls: string[];
  onResults: (results: ScrapeResult[]) => void;
}

interface ScrapeResult {
  url: string;
  success: boolean;
  status_code: number;
  content: string;
  title: string;
  error: string | null;
  elapsed_ms: number;
}

type RetryMode = 'direct' | 'warm-up-first';

const SIDECAR_URL = 'http://127.0.0.1:18181';

export function RetryFailedUrls({ failedUrls, onResults }: RetryProps) {
  const [mode, setMode] = useState<RetryMode>('direct');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  
  async function handleRetry() {
    setRunning(true);
    
    try {
      const endpoint = mode === 'warm-up-first'
        ? '/local-scrape/warm-up-and-scrape'
        : '/local-scrape/scrape';
      
      setProgress(
        mode === 'warm-up-first'
          ? `Warming up and scraping ${failedUrls.length} sites...`
          : `Scraping ${failedUrls.length} sites locally...`
      );
      
      const resp = await fetch(`${SIDECAR_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: failedUrls }),
      });
      
      const results: ScrapeResult[] = await resp.json();
      
      const succeeded = results.filter(r => r.success).length;
      setProgress(`Done: ${succeeded}/${results.length} succeeded`);
      
      onResults(results);
    } catch (error) {
      setProgress(`Error: ${error}`);
    } finally {
      setRunning(false);
    }
  }
  
  return (
    <div className="p-4 bg-white rounded-lg border space-y-4">
      <div>
        <h3 className="font-medium">
          {failedUrls.length} URLs failed server-side scraping
        </h3>
        <p className="text-sm text-gray-600 mt-1">
          Retry these using your local browser for better results.
        </p>
      </div>
      
      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            checked={mode === 'direct'}
            onChange={() => setMode('direct')}
          />
          <div>
            <span className="font-medium">Direct scrape</span>
            <span className="text-sm text-gray-500 ml-2">
              — faster, works for most sites
            </span>
          </div>
        </label>
        
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            checked={mode === 'warm-up-first'}
            onChange={() => setMode('warm-up-first')}
          />
          <div>
            <span className="font-medium">Warm up first, then scrape</span>
            <span className="text-sm text-gray-500 ml-2">
              — slower, but handles aggressive anti-bot sites
            </span>
          </div>
        </label>
      </div>
      
      <button
        onClick={handleRetry}
        disabled={running}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg 
                   hover:bg-blue-700 disabled:opacity-50"
      >
        {running ? 'Scraping...' : `Retry ${failedUrls.length} URLs Locally`}
      </button>
      
      {progress && (
        <div className="text-sm text-gray-600">{progress}</div>
      )}
      
      <div className="max-h-48 overflow-y-auto">
        {failedUrls.map((url, i) => (
          <div key={i} className="text-xs text-gray-500 truncate py-0.5">
            {url}
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Part 7: Playwright Installation

Playwright needs browser binaries for its own Chromium (used as a fallback if we can't find the user's Chrome). This must be handled during app installation, not at runtime.

### First-Run Setup

```python
# setup_playwright.py

import subprocess
import sys
import logging

logger = logging.getLogger(__name__)


async def ensure_playwright_ready() -> bool:
    """
    Ensure Playwright is installed and browser binaries are available.
    
    This should be called:
    1. On first app launch
    2. After an app update
    
    We install just Chromium (not Firefox/WebKit) to save ~400MB.
    """
    try:
        # Check if already installed
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            # Try to get the executable path — if this works, we're good
            p.chromium.executable_path
            logger.info("Playwright Chromium already available")
            return True
    except Exception:
        pass
    
    # Need to install
    logger.info("Installing Playwright Chromium...")
    try:
        result = subprocess.run(
            [sys.executable, "-m", "playwright", "install", "chromium"],
            capture_output=True,
            text=True,
            timeout=300,  # 5 minute timeout for download
        )
        
        if result.returncode == 0:
            logger.info("Playwright Chromium installed successfully")
            return True
        else:
            logger.error(f"Playwright install failed: {result.stderr}")
            return False
    except Exception as e:
        logger.error(f"Playwright install error: {e}")
        return False
```

### Important: Chrome vs Playwright's Chromium

The scraper tries to use the user's installed Chrome first (with their cookies and profile). Playwright's bundled Chromium is a fallback for when:

- The user doesn't have Chrome installed
- Chrome is in use and can't be accessed
- The user explicitly wants a clean browser (no cookies)

The `LocalBrowserScraper` class handles this priority automatically via `find_chrome_executable()`.

---

## Part 8: System Tray Behavior

The desktop app should minimize to the system tray rather than closing entirely, so it's always available to receive cloud scrape jobs.

```rust
// Add to src-tauri/src/lib.rs

use tauri::{
    tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState},
    menu::{MenuBuilder, MenuItemBuilder},
    Manager,
};

fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItemBuilder::with_id("show", "Show AI Matrx").build(app)?;
    let status = MenuItemBuilder::with_id("status", "Status: Ready").enabled(false).build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    
    let menu = MenuBuilder::new(app)
        .item(&show)
        .separator()
        .item(&status)
        .separator()
        .item(&quit)
        .build()?;
    
    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("AI Matrx Desktop — Local scraping ready")
        .on_menu_event(move |app, event| {
            match event.id().as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            // Double-click tray icon to show window
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;
    
    Ok(())
}
```

---

## Dependency Summary

### Python (sidecar)

```txt
# requirements.txt additions
playwright>=1.49.0
websockets>=13.0
```

### Rust (Tauri)

```toml
# src-tauri/Cargo.toml — these are added by the plugin installs
[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-shell = "2"
tauri-plugin-notification = "2"
tauri-plugin-store = "2"
```

### Node (React frontend)

```json
// Standard React + Vite + Tailwind stack
// No special scraping dependencies — all scraping logic is in Python
```

---

## Build & Distribution

### Development

```bash
# Terminal 1: Run the Python sidecar directly (no PyInstaller needed in dev)
cd python-engine
uvicorn main:app --port 18181 --host 127.0.0.1 --reload

# Terminal 2: Run the Tauri dev server
cd aimatrx-desktop
npm run tauri dev
```

### Production Build

```bash
# Step 1: Build the Python sidecar binary
cd python-engine
pyinstaller --name aimatrx-engine --onefile main.py
# Copy to sidecar directory with platform-specific naming
cp dist/aimatrx-engine ../aimatrx-desktop/src-tauri/sidecar/aimatrx-engine-x86_64-apple-darwin

# Step 2: Build the Tauri app (includes the sidecar)
cd ../aimatrx-desktop
npm run tauri build
# Output: .dmg (macOS), .msi (Windows), .AppImage/.deb (Linux)
```

### Auto-Update

Tauri v2 has built-in auto-update support. Configure it to check your update server:

```json
// src-tauri/tauri.conf.json
{
  "plugins": {
    "updater": {
      "endpoints": [
        "https://releases.aimatrx.com/desktop/{{target}}/{{arch}}/{{current_version}}"
      ],
      "pubkey": "YOUR_PUBLIC_KEY_HERE"
    }
  }
}
```

---

## Testing Checklist

### Unit Tests (Python)

- [ ] `find_chrome_executable()` returns a valid path on each OS
- [ ] `find_chrome_user_data_dir()` returns a valid path
- [ ] Profile copy includes Cookies file
- [ ] Cookie consent selectors match common banner frameworks
- [ ] Warm-up flow completes without errors

### Integration Tests

- [ ] Sidecar starts and responds to `/health` within 15 seconds
- [ ] `/local-scrape/status` returns correct Chrome detection
- [ ] `/local-scrape/scrape` successfully scrapes a simple site
- [ ] `/local-scrape/scrape` handles a Cloudflare-protected site
- [ ] `/local-scrape/warm-up` sets cookies on a test site
- [ ] `/local-scrape/warm-up-and-scrape` improves success rate vs direct
- [ ] Cloud job polling receives and processes a test job
- [ ] Results are correctly reported back to the cloud
- [ ] Browser shuts down cleanly on app close
- [ ] Temp profile directory is cleaned up

### Platform Tests

- [ ] Windows: Chrome discovery, profile path, build, installer
- [ ] macOS (Intel): Chrome discovery, profile path, build, .dmg
- [ ] macOS (Apple Silicon): Chrome discovery, profile path, build, .dmg
- [ ] Linux: Chrome discovery, profile path, build, .AppImage
