"""Auto-update module using tufup (The Update Framework).

On startup, checks a remote metadata server for new versions.
If a new version is available, downloads and applies it, then signals
the caller to restart.

Configuration:
  Set MATRX_UPDATE_URL env var to the base URL of your TUF repository.
  Default: https://updates.aimatrx.com/matrx-local/

The update repository structure (hosted on S3, GitHub Releases, or CDN):
  <base_url>/
    metadata/
      root.json
      timestamp.json
      snapshot.json
      targets.json
    targets/
      MatrxLocal-0.2.0.tar.gz
      MatrxLocal-0.3.0.patch

This module is designed to be called before the server starts.
If no update server is configured or reachable, it silently skips.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

CURRENT_VERSION = "0.2.0"
DEFAULT_UPDATE_URL = "https://updates.aimatrx.com/matrx-local/"


def _get_app_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parent.parent


def check_for_updates() -> bool:
    update_url = os.getenv("MATRX_UPDATE_URL", DEFAULT_UPDATE_URL)

    if update_url == DEFAULT_UPDATE_URL:
        logger.debug("Update URL is default placeholder — skipping update check")
        return False

    try:
        from tufup.client import Client
    except ImportError:
        logger.debug("tufup not available — skipping update check")
        return False

    app_dir = _get_app_dir()
    metadata_dir = app_dir / "update_cache" / "metadata"
    target_dir = app_dir / "update_cache" / "targets"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    target_dir.mkdir(parents=True, exist_ok=True)

    try:
        client = Client(
            app_name="MatrxLocal",
            app_install_dir=app_dir,
            current_version=CURRENT_VERSION,
            metadata_dir=metadata_dir,
            metadata_base_url=f"{update_url.rstrip('/')}/metadata/",
            target_dir=target_dir,
            target_base_url=f"{update_url.rstrip('/')}/targets/",
        )
    except Exception as e:
        logger.warning("Failed to initialize update client: %s", e)
        return False

    try:
        new_update = client.check_for_updates()
    except Exception as e:
        logger.info("Update check failed (network issue or no server): %s", e)
        return False

    if not new_update:
        logger.info("No updates available (current: %s)", CURRENT_VERSION)
        return False

    logger.info("Update available — downloading...")
    try:
        client.download_and_apply_update()
        logger.info("Update applied successfully — restart required")
        return True
    except Exception as e:
        logger.warning("Failed to apply update: %s", e)
        return False
