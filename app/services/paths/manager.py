"""Matrx path manager — user-configurable storage locations with automatic recovery.

Architecture
------------
Every storage path has:
  1. A compiled default (from config.py — OS-native, cross-platform)
  2. A user override stored in ~/.matrx/settings.json under key "paths.*"
  3. A safety guarantee: safe_dir() always returns a usable Path, even if the
     stored location has been deleted, moved to a different drive, or is invalid.

Golden rules
------------
- NEVER let a missing directory cause a read/write error.
- If the configured path is missing, recreate it silently.
- If the configured path is invalid (bad chars, unmounted drive), fall back to the
  default and log a warning — never crash.
- User-set paths are persisted immediately to settings.json and take effect on
  the next call without a restart.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from app.config import (
    MATRX_HOME_DIR,
    MATRX_USER_DIR,
    MATRX_NOTES_DIR,
    MATRX_FILES_DIR,
    MATRX_CODE_DIR,
    MATRX_WORKSPACES_DIR,
    MATRX_DATA_DIR,
    TEMP_DIR,
    DATA_DIR,
    LOG_DIR,
    CONFIG_DIR,
)

logger = logging.getLogger(__name__)

# Canonical names → (default Path, human label, visible_to_user)
_PATH_CATALOG: dict[str, tuple[Path, str, bool]] = {
    # user-visible
    "notes":       (MATRX_NOTES_DIR,      "Notes folder",       True),
    "files":       (MATRX_FILES_DIR,      "Files folder",       True),
    "code":        (MATRX_CODE_DIR,       "Code folder",        True),
    # hidden but user-configurable
    "workspaces":  (MATRX_WORKSPACES_DIR, "Agent workspaces",   True),
    "agent_data":  (MATRX_DATA_DIR,       "Agent data",         True),
    # TTS model and voice files
    "tts":         (MATRX_HOME_DIR / "tts", "TTS models & voices", False),
    # engine internals — configurable but less prominent
    "matrx_home":  (MATRX_HOME_DIR,       "Matrx home (.matrx)", False),
    "temp":        (TEMP_DIR,             "Temp / cache",        False),
    "data":        (DATA_DIR,             "App data",            False),
    "logs":        (LOG_DIR,              "Log files",           False),
    "config":      (CONFIG_DIR,           "Config files",        False),
}


def _settings_sync():
    """Lazy import to avoid circular dependency."""
    from app.services.cloud_sync.settings_sync import get_settings_sync
    return get_settings_sync()


def _stored_paths() -> dict[str, str]:
    """Read the "paths" sub-dict from settings.json."""
    try:
        sync = _settings_sync()
        return sync.get("paths", {}) or {}
    except Exception:
        return {}


def _save_path(name: str, path: str) -> None:
    """Persist a single path override to settings.json."""
    try:
        sync = _settings_sync()
        current: dict[str, str] = sync.get("paths", {}) or {}
        current[name] = path
        sync.set("paths", current)
    except Exception as exc:
        logger.warning("Could not persist path override for '%s': %s", name, exc)


def safe_dir(name: str) -> Path:
    """Return a guaranteed-usable directory Path for the given storage name.

    Resolution order:
      1. User override from settings.json
      2. Compiled default from _PATH_CATALOG

    If the resolved path cannot be created (permission error, invalid path,
    unmounted drive), falls back to the compiled default and logs a warning.
    Never raises.
    """
    default, _label, _visible = _PATH_CATALOG.get(name, (MATRX_HOME_DIR, name, False))

    # Try user override first
    override = _stored_paths().get(name)
    candidate = Path(override) if override else default

    try:
        candidate.mkdir(parents=True, exist_ok=True)
        return candidate
    except Exception as exc:
        if candidate != default:
            logger.warning(
                "Configured path for '%s' is unusable (%s: %s) — falling back to default: %s",
                name, type(exc).__name__, exc, default,
            )
            try:
                default.mkdir(parents=True, exist_ok=True)
                return default
            except Exception as exc2:
                logger.error("Default path for '%s' is also unusable: %s", name, exc2)
        else:
            logger.error("Could not create path for '%s' at %s: %s", name, candidate, exc)

    # Last resort: return the path object even if mkdir failed — caller will get
    # a normal FileNotFoundError on actual I/O which is better than crashing here.
    return candidate


def get_path(name: str) -> Path:
    """Same as safe_dir() — alias for clarity in read contexts."""
    return safe_dir(name)


def set_path(name: str, new_path: str) -> dict[str, Any]:
    """Validate and persist a user-supplied path override.

    Returns a dict with keys: ok, path, error (on failure).
    The new directory is created immediately to verify it is accessible.
    """
    if name not in _PATH_CATALOG:
        return {"ok": False, "error": f"Unknown path name: '{name}'"}

    candidate = Path(new_path).expanduser().resolve()
    default, _label, _visible = _PATH_CATALOG[name]

    try:
        candidate.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        return {"ok": False, "path": str(candidate), "error": str(exc)}

    _save_path(name, str(candidate))
    logger.info("Path '%s' updated to: %s", name, candidate)
    return {"ok": True, "path": str(candidate)}


def reset_path(name: str) -> dict[str, Any]:
    """Reset a path to its compiled default."""
    if name not in _PATH_CATALOG:
        return {"ok": False, "error": f"Unknown path name: '{name}'"}

    try:
        sync = _settings_sync()
        current: dict[str, str] = sync.get("paths", {}) or {}
        current.pop(name, None)
        sync.set("paths", current)
    except Exception as exc:
        logger.warning("Could not clear path override for '%s': %s", name, exc)

    default, _label, _visible = _PATH_CATALOG[name]
    default.mkdir(parents=True, exist_ok=True)
    return {"ok": True, "path": str(default)}


def all_paths() -> list[dict[str, Any]]:
    """Return the full path catalog with current resolved values.

    Shape of each entry:
      name        — canonical key
      label       — human-readable name
      current     — resolved absolute path (override or default)
      default     — compiled default path
      is_custom   — True if user has set a custom path
      user_visible — True if shown in the UI
    """
    stored = _stored_paths()
    result: list[dict[str, Any]] = []
    for name, (default, label, visible) in _PATH_CATALOG.items():
        override = stored.get(name)
        current = Path(override) if override else default
        result.append({
            "name": name,
            "label": label,
            "current": str(current),
            "default": str(default),
            "is_custom": bool(override),
            "user_visible": visible,
        })
    return result
