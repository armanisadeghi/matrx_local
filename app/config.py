import os
import platform
import sys
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(dotenv_path=BASE_DIR / ".env")

APP_NAME = "MatrxLocal"
APP_NAME_SLUG = "matrx-local"  # lowercase-hyphen form for Linux paths
DEBUG = os.getenv("DEBUG", "True").lower() in ("true", "1")
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key")

# ---------------------------------------------------------------------------
# CORS — allowed origins
#
# Exact origins are listed here.  Wildcard subdomains (*.aimatrx.com, etc.)
# are handled by ALLOWED_ORIGIN_REGEX in main.py so Starlette can match them
# against the incoming Origin header at runtime.
#
# To add a new exact origin: append to _DEFAULT_ORIGINS.
# To allow a new subdomain pattern: extend ALLOWED_ORIGIN_REGEX in main.py.
# ---------------------------------------------------------------------------

_DEFAULT_ORIGINS = ",".join([
    # Production domains (exact)
    "https://aimatrx.com",
    "https://www.aimatrx.com",
    "https://appmatrx.com",
    "https://www.appmatrx.com",
    "https://mymatrx.com",
    "https://www.mymatrx.com",
    "https://codematrx.com",
    "https://www.codematrx.com",
    "https://matrxserver.com",
    "https://www.matrxserver.com",
    # Known Vercel deployment
    "https://ai-matrx-admin.vercel.app",
    # Chrome extension OAuth callback
    "https://ccmjgggbdngllppncmidllcjablcdepl.chromiumapp.org",
    # Local development
    "http://localhost:1420",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:5173",
    "http://127.0.0.1:1420",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:3002",
    "http://127.0.0.1:5173",
    # Tauri desktop app
    "tauri://localhost",
])
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", _DEFAULT_ORIGINS).split(",")

# Regex covers wildcard subdomains that can't be listed exhaustively:
#   *.aimatrx.com, *.appmatrx.com, *.mymatrx.com, *.codematrx.com,
#   *.matrxserver.com, *-armani-sadeghis-projects.vercel.app
# This is used by CORSMiddleware's allow_origin_regex parameter.
ALLOWED_ORIGIN_REGEX = (
    r"https://(.*\.)?(aimatrx|appmatrx|mymatrx|codematrx|matrxserver)\.com"
    r"|https://.*-armani-sadeghis-projects\.vercel\.app"
    r"|https://.*\.vercel\.app"  # covers preview deployments
)

# Remote scraper server — all DB access goes through this API, never directly.
# Authenticated users' Supabase JWTs are accepted by the server — no API key needed for users.
# SCRAPER_API_KEY is for server-to-server calls only (your own .env, never shipped to users).
SCRAPER_API_KEY = os.getenv("SCRAPER_API_KEY", "")
SCRAPER_SERVER_URL = os.getenv("SCRAPER_SERVER_URL", "https://scraper.app.matrxserver.com")

# Supabase (for document sync — uses PostgREST API with user JWTs)
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_PUBLISHABLE_KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY", "")

# ---------------------------------------------------------------------------
# Platform-aware storage roots
#
# Development (running from source):
#   All paths fall back to  <project_root>/system/...  so nothing changes for
#   your local workflow — the "system" folder keeps working exactly as before.
#
# Installed / frozen app (PyInstaller, Tauri sidecar):
#   Paths follow OS conventions so the app behaves like a proper desktop app
#   and doesn't write user data next to its binaries.
#
#   Windows  → %APPDATA%\MatrxLocal\          (Roaming — per-user, synced)
#              %LOCALAPPDATA%\MatrxLocal\      (Local  — per-user, not synced, for cache/temp/logs)
#   macOS    → ~/Library/Application Support/MatrxLocal/
#              ~/Library/Logs/MatrxLocal/
#              ~/Library/Caches/MatrxLocal/
#   Linux    → ~/.local/share/matrx-local/
#              ~/.cache/matrx-local/
#
# Every path can be overridden by an env var for power users / CI.
# ---------------------------------------------------------------------------

_is_frozen = getattr(sys, "frozen", False)  # True when running as PyInstaller bundle
_system = platform.system()


def _platform_data_dir() -> Path:
    """Persistent user data — settings, DB, manifests."""
    if _system == "Windows":
        base = Path(os.getenv("APPDATA", Path.home() / "AppData" / "Roaming"))
        return base / APP_NAME
    if _system == "Darwin":
        return Path.home() / "Library" / "Application Support" / APP_NAME
    # Linux / BSD
    xdg = os.getenv("XDG_DATA_HOME", str(Path.home() / ".local" / "share"))
    return Path(xdg) / APP_NAME_SLUG


def _platform_cache_dir() -> Path:
    """Ephemeral cache / temp — screenshots, audio, extracted files, etc."""
    if _system == "Windows":
        base = Path(os.getenv("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        return base / APP_NAME / "cache"
    if _system == "Darwin":
        return Path.home() / "Library" / "Caches" / APP_NAME
    xdg = os.getenv("XDG_CACHE_HOME", str(Path.home() / ".cache"))
    return Path(xdg) / APP_NAME_SLUG


def _platform_log_dir() -> Path:
    """Application log files."""
    if _system == "Windows":
        base = Path(os.getenv("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        return base / APP_NAME / "logs"
    if _system == "Darwin":
        return Path.home() / "Library" / "Logs" / APP_NAME
    xdg = os.getenv("XDG_STATE_HOME", str(Path.home() / ".local" / "state"))
    return Path(xdg) / APP_NAME_SLUG / "logs"


# In development (not frozen) keep everything inside the repo so nothing moves.
# In a frozen/installed build use the OS-appropriate locations.
_dev_system = BASE_DIR / "system"

if _is_frozen:
    _data_root  = _platform_data_dir()
    _cache_root = _platform_cache_dir()
    _log_root   = _platform_log_dir()
else:
    _data_root  = _dev_system / "data"
    _cache_root = _dev_system / "temp"
    _log_root   = _dev_system / "logs"

# Env-var overrides (always respected regardless of frozen/dev)
TEMP_DIR       = Path(os.getenv("MATRX_TEMP_DIR",   str(_cache_root)))
DATA_DIR       = Path(os.getenv("MATRX_DATA_DIR",   str(_data_root)))
CONFIG_DIR     = Path(os.getenv("MATRX_CONFIG_DIR", str(_data_root / "config")))
LOCAL_LOG_DIR  = Path(os.getenv("MATRX_LOG_DIR",    str(_log_root)))
CODE_SAVES_DIR = TEMP_DIR / "code_saves"

# ---------------------------------------------------------------------------
# ~/.matrx  — discovery file, settings, instance ID, scheduled tasks
#
# This is intentionally always in the user's home regardless of platform.
# It is a small, well-known location that lets multiple tools (web, mobile,
# CLI) discover the running engine without platform-specific logic on their end.
# ---------------------------------------------------------------------------
MATRX_HOME_DIR = Path(os.getenv("MATRX_HOME_DIR", str(Path.home() / ".matrx")))

# Documents — user's note store (user-configurable, defaults to ~/.matrx/documents)
DOCUMENTS_BASE_DIR = Path(
    os.getenv("DOCUMENTS_BASE_DIR", str(MATRX_HOME_DIR / "documents"))
)

LOG_VCPRINT = True

LOG_LEVEL = os.getenv("LOG_LEVEL", "DEBUG")
LOG_DIR = Path(os.getenv("LOG_DIR", str(LOCAL_LOG_DIR)))
MAX_LOG_FILE_SIZE = int(os.getenv("MAX_LOG_FILE_SIZE", 10 * 1024 * 1024))
BACKUP_COUNT = int(os.getenv("BACKUP_COUNT", 5))

# When True: console logs omit timestamp and logger name (clean terminal output).
# File logs always include full timestamp for server diagnostics.
# Set LOCAL_DEV=False in production/Coolify to get full timestamps everywhere.
LOCAL_DEV = os.getenv("LOCAL_DEV", "True").lower() in ("true", "1")
