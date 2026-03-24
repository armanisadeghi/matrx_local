"""
pytest configuration for the Matrx Local test suite.

Engine fixture strategy:
  - Uses MATRX_PORT=22199 so the test engine never conflicts with a dev instance
    running on the default port 22140.
  - Spawns the real engine via `uv run python run.py` with TEST_MODE=1.
  - Waits up to 40 seconds for /health to respond before failing.
  - Tears down (SIGTERM → SIGKILL) after all tests in the session complete.
  - Session-scoped: the engine starts once and is reused across all smoke tests.

Auth strategy:
  - /health, /version, /tools/list, /settings, /platform/context, /hardware,
    /devices/*, /proxy/status, /cloud/debug, /remote-scraper/status are all
    public per the AuthMiddleware _PUBLIC_PATHS definition, or are device/*
    paths which are unconditionally public. Tests use these public endpoints
    directly without a Bearer token.
  - Tests that need a token (tool invocations, notes, etc.) pass a dummy local
    API_KEY. In TEST_MODE the engine accepts it.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Generator

import httpx
import pytest

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).parent.parent
REPO_ROOT = PROJECT_ROOT  # same thing

# ---------------------------------------------------------------------------
# Platform markers — registered here so pytest knows them
# ---------------------------------------------------------------------------

def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "slow: marks tests as slow (use --full to include)")
    config.addinivalue_line("markers", "macos_only: test only runs on macOS")
    config.addinivalue_line("markers", "windows_only: test only runs on Windows")
    config.addinivalue_line("markers", "linux_only: test only runs on Linux")


def pytest_collection_modifyitems(
    config: pytest.Config, items: list[pytest.Item]
) -> None:
    """Auto-skip platform-specific tests on non-matching OSes."""
    is_mac = sys.platform == "darwin"
    is_win = sys.platform == "win32"
    is_linux = sys.platform.startswith("linux")

    skip_macos = pytest.mark.skip(reason="macOS only")
    skip_windows = pytest.mark.skip(reason="Windows only")
    skip_linux = pytest.mark.skip(reason="Linux only")

    for item in items:
        if "macos_only" in item.keywords and not is_mac:
            item.add_marker(skip_macos)
        if "windows_only" in item.keywords and not is_win:
            item.add_marker(skip_windows)
        if "linux_only" in item.keywords and not is_linux:
            item.add_marker(skip_linux)


# ---------------------------------------------------------------------------
# Engine fixture
# ---------------------------------------------------------------------------

TEST_PORT = 22199
TEST_BASE_URL = f"http://127.0.0.1:{TEST_PORT}"

# A placeholder API key used for authenticated endpoints in test mode.
# The engine accepts any non-empty token string when TEST_MODE=1.
TEST_TOKEN = "test-token-matrx-local"


def _wait_for_engine(base_url: str, timeout: float = 40.0) -> bool:
    """Poll /health until the engine responds or timeout elapses."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            r = httpx.get(f"{base_url}/health", timeout=2.0)
            if r.status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(0.5)
    return False


@pytest.fixture(scope="session")
def engine_process() -> Generator[subprocess.Popen, None, None]:
    """Spawn the real Matrx engine on TEST_PORT and yield the Popen object."""
    env = {
        **os.environ,
        "MATRX_PORT": str(TEST_PORT),
        "TEST_MODE": "1",
        "DEBUG": "1",
        # Disable features that require external services or long startup
        "TUNNEL_ENABLED": "0",
        # Suppress pystray tray icon in test environment
        "TAURI_SIDECAR": "1",
    }

    proc = subprocess.Popen(
        ["uv", "run", "--frozen", "python", "run.py"],
        cwd=str(PROJECT_ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    ready = _wait_for_engine(TEST_BASE_URL, timeout=40.0)

    if not ready:
        proc.terminate()
        try:
            stdout, stderr = proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            stdout, stderr = proc.communicate()
        pytest.fail(
            f"Engine did not start within 40 seconds on port {TEST_PORT}.\n"
            f"STDOUT:\n{stdout[-2000:]}\nSTDERR:\n{stderr[-2000:]}"
        )

    yield proc

    # Teardown — graceful first, then force-kill
    proc.send_signal(signal.SIGTERM)
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()


@pytest.fixture(scope="session")
def engine_url(engine_process: subprocess.Popen) -> str:
    """Return the base URL of the running test engine."""
    return TEST_BASE_URL


@pytest.fixture(scope="session")
def http(engine_url: str) -> Generator[httpx.Client, None, None]:
    """
    Session-scoped httpx client with the test token pre-set.
    Used for endpoints that require authentication.
    """
    with httpx.Client(
        base_url=engine_url,
        headers={"Authorization": f"Bearer {TEST_TOKEN}"},
        timeout=15.0,
    ) as client:
        yield client


@pytest.fixture(scope="session")
def http_public(engine_url: str) -> Generator[httpx.Client, None, None]:
    """Session-scoped httpx client without auth (for public endpoints)."""
    with httpx.Client(base_url=engine_url, timeout=15.0) as client:
        yield client
