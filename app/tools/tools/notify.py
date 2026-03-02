"""Notification tool — send native OS notifications. Cross-platform."""

from __future__ import annotations

import asyncio
import logging
import platform
import subprocess

from app.tools.session import ToolSession
from app.tools.types import ToolResult, ToolResultType

logger = logging.getLogger(__name__)

IS_MACOS = platform.system() == "Darwin"
IS_WINDOWS = platform.system() == "Windows"
IS_LINUX = platform.system() == "Linux"


async def tool_notify(
    session: ToolSession,
    title: str,
    message: str,
    timeout: int = 10,
) -> ToolResult:
    """Send a native OS notification."""
    # Try plyer first (cross-platform, works on macOS/Windows with desktop)
    try:
        from plyer import notification
        notification.notify(
            title=title,
            message=message,
            app_name="Matrx Local",
            timeout=timeout,
        )
        return ToolResult(output=f"Notification sent: {title}")
    except ImportError:
        pass
    except Exception as e:
        logger.debug("plyer notification failed: %s", e)

    # Platform-specific fallbacks
    try:
        if IS_MACOS:
            script = (
                f'display notification {_osa_str(message)} '
                f'with title {_osa_str(title)}'
            )
            proc = await asyncio.create_subprocess_exec(
                "osascript", "-e", script,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await asyncio.wait_for(proc.communicate(), timeout=10)
            if proc.returncode == 0:
                return ToolResult(output=f"Notification sent: {title}")

        elif IS_WINDOWS:
            # PowerShell toast notification
            ps_script = (
                f"[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; "
                f"$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); "
                f"$template.SelectSingleNode('//text[@id=1]').InnerText = '{_ps_escape(title)}'; "
                f"$template.SelectSingleNode('//text[@id=2]').InnerText = '{_ps_escape(message)}'; "
                f"$toast = [Windows.UI.Notifications.ToastNotification]::new($template); "
                f"[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Matrx Local').Show($toast)"
            )
            proc = await asyncio.create_subprocess_exec(
                "powershell.exe", "-NonInteractive", "-Command", ps_script,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await asyncio.wait_for(proc.communicate(), timeout=10)
            if proc.returncode == 0:
                return ToolResult(output=f"Notification sent: {title}")

        elif IS_LINUX:
            # notify-send (libnotify) — available in most desktop Linux distros
            proc = await asyncio.create_subprocess_exec(
                "notify-send", "-t", str(timeout * 1000), title, message,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await asyncio.wait_for(proc.communicate(), timeout=10)
            if proc.returncode == 0:
                return ToolResult(output=f"Notification sent: {title}")
            # WSL / headless fallback — just log
            logger.info("NOTIFY [%s]: %s", title, message)
            return ToolResult(
                output=f"Notification logged (no display detected): {title} — {message}",
            )

    except FileNotFoundError as e:
        logger.debug("Notification binary not found: %s", e)
    except Exception as e:
        logger.debug("Notification fallback failed: %s", e)

    # Last resort: log it
    logger.info("NOTIFY [%s]: %s", title, message)
    return ToolResult(
        output=f"Notification sent (logged only — no notification daemon available): {title}",
    )


def _osa_str(s: str) -> str:
    """Escape a string for AppleScript."""
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _ps_escape(s: str) -> str:
    """Escape a string for PowerShell single-quote context."""
    return s.replace("'", "''")
