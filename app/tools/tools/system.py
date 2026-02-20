"""System tools — platform info, screenshot capture, directory listing."""

from __future__ import annotations

import base64
import logging
import os
import platform
import uuid
from pathlib import Path

from app.config import TEMP_DIR
from app.tools.session import ToolSession
from app.tools.types import ImageData, ToolResult, ToolResultType

logger = logging.getLogger(__name__)


def _detect_chrome() -> tuple[bool, str | None, str | None]:
    """Return (playwright_available, chrome_path, chrome_version)."""
    try:
        import playwright  # noqa: F401
        pw_available = True
    except ImportError:
        return False, None, None

    # Look for real Chrome first (user-visible, has cookies/profiles)
    chrome_locations = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    ]
    chrome_path: str | None = None
    for loc in chrome_locations:
        if Path(loc).exists():
            chrome_path = loc
            break

    # Fall back to playwright's bundled headless shell
    if chrome_path is None:
        headless_base = Path.home() / "Library" / "Caches" / "ms-playwright"
        if headless_base.exists():
            shells = sorted(headless_base.glob("chromium_headless_shell-*/chrome-mac/headless_shell"))
            if shells:
                chrome_path = str(shells[-1])

    # Try to read Chrome version
    chrome_version: str | None = None
    if chrome_path:
        # Info.plist is at <App>.app/Contents/Info.plist
        ver_file = Path(chrome_path).parent.parent / "Info.plist"
        if ver_file.exists():
            try:
                import plistlib
                with open(ver_file, "rb") as f:
                    plist = plistlib.load(f)
                chrome_version = plist.get("CFBundleShortVersionString")
            except Exception:
                pass

    return pw_available, chrome_path, chrome_version


async def tool_system_info(
    session: ToolSession,
) -> ToolResult:
    info = {
        "platform": platform.system(),
        "platform_release": platform.release(),
        "platform_version": platform.version(),
        "architecture": platform.machine(),
        "hostname": platform.node(),
        "python_version": platform.python_version(),
        "cwd": session.cwd,
        "home": str(Path.home()),
        "user": os.getenv("USER", os.getenv("USERNAME", "unknown")),
    }
    pw_available, chrome_path, chrome_version = _detect_chrome()
    info["playwright_available"] = pw_available
    info["chrome_path"] = chrome_path
    info["chrome_version"] = chrome_version
    lines = [f"{k}: {v}" for k, v in info.items()]
    return ToolResult(output="\n".join(lines), metadata=info)


async def tool_screenshot(
    session: ToolSession,
) -> ToolResult:
    try:
        from PIL import ImageGrab
    except ImportError:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="Screenshot requires Pillow with ImageGrab support.",
        )

    try:
        screenshot = ImageGrab.grab()
    except OSError as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Screenshot failed: {e}")

    screenshot_dir = TEMP_DIR / "screenshots"
    screenshot_dir.mkdir(parents=True, exist_ok=True)
    filename = f"screenshot_{uuid.uuid4().hex[:8]}.png"
    filepath = screenshot_dir / filename
    screenshot.save(str(filepath))

    image_bytes = filepath.read_bytes()
    b64 = base64.b64encode(image_bytes).decode()

    return ToolResult(
        output=f"Screenshot captured: {filepath} ({len(image_bytes)} bytes)",
        image=ImageData(media_type="image/png", base64_data=b64),
        metadata={"path": str(filepath)},
    )


async def tool_list_directory(
    session: ToolSession,
    path: str | None = None,
    show_hidden: bool = False,
) -> ToolResult:
    target = session.resolve_path(path or ".")

    if not os.path.isdir(target):
        return ToolResult(type=ToolResultType.ERROR, output=f"Not a directory: {target}")

    try:
        entries = sorted(os.listdir(target))
    except OSError as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Cannot list directory: {e}")

    if not show_hidden:
        entries = [e for e in entries if not e.startswith(".")]

    items: list[str] = []
    for entry in entries:
        full = os.path.join(target, entry)
        suffix = "/" if os.path.isdir(full) else ""
        items.append(f"  {entry}{suffix}")

    header = f"{target}/ ({len(items)} items)"
    return ToolResult(output=header + "\n" + "\n".join(items), metadata={"path": target, "count": len(items)})


async def tool_open_url(
    session: ToolSession,
    url: str,
) -> ToolResult:
    """Open a URL in the user's default browser."""
    import webbrowser

    try:
        webbrowser.open(url)
    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Failed to open URL: {e}")

    return ToolResult(output=f"Opened {url} in default browser")


async def tool_open_path(
    session: ToolSession,
    path: str,
) -> ToolResult:
    """Open a file or directory using the OS default handler (Finder, Explorer, etc.)."""
    import subprocess

    resolved = session.resolve_path(path)

    if not os.path.exists(resolved):
        return ToolResult(type=ToolResultType.ERROR, output=f"Path not found: {resolved}")

    system = platform.system()
    try:
        if system == "Darwin":
            subprocess.Popen(["open", resolved])
        elif system == "Windows":
            os.startfile(resolved)
        else:
            subprocess.Popen(["xdg-open", resolved])
    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Failed to open path: {e}")

    return ToolResult(output=f"Opened {resolved}")
