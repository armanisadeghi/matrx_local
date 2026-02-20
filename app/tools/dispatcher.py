"""Tool dispatcher — routes tool calls to the correct handler function."""

from __future__ import annotations

import logging
from typing import Any, Callable, Coroutine

from app.tools.session import ToolSession
from app.tools.tools.clipboard import tool_clipboard_read, tool_clipboard_write
from app.tools.tools.execution import tool_bash, tool_bash_output, tool_task_stop
from app.tools.tools.file_ops import tool_edit, tool_glob, tool_grep, tool_read, tool_write
from app.tools.tools.network import (
    tool_fetch_url,
    tool_fetch_with_browser,
    tool_research,
    tool_scrape,
    tool_search,
)
from app.tools.tools.notify import tool_notify
from app.tools.tools.system import (
    tool_list_directory,
    tool_open_path,
    tool_open_url,
    tool_screenshot,
    tool_system_info,
)
from app.tools.tools.transfer import tool_download_file, tool_upload_file

# New tool modules
from app.tools.tools.process_manager import (
    tool_focus_app,
    tool_kill_process,
    tool_launch_app,
    tool_list_processes,
    tool_list_ports,
)
from app.tools.tools.window_manager import (
    tool_focus_window,
    tool_list_windows,
    tool_minimize_window,
    tool_move_window,
)
from app.tools.tools.input_automation import (
    tool_hotkey,
    tool_mouse_click,
    tool_mouse_move,
    tool_type_text,
)
from app.tools.tools.audio import (
    tool_list_audio_devices,
    tool_play_audio,
    tool_record_audio,
    tool_transcribe_audio,
)
from app.tools.tools.browser_automation import (
    tool_browser_click,
    tool_browser_eval,
    tool_browser_extract,
    tool_browser_navigate,
    tool_browser_screenshot,
    tool_browser_tabs,
    tool_browser_type,
)
from app.tools.tools.network_discovery import (
    tool_mdns_discover,
    tool_network_info,
    tool_network_scan,
    tool_port_scan,
)
from app.tools.tools.system_monitor import (
    tool_battery_status,
    tool_disk_usage,
    tool_system_resources,
    tool_top_processes,
)
from app.tools.tools.file_watch import (
    tool_stop_watch,
    tool_watch_directory,
    tool_watch_events,
)
from app.tools.tools.app_integration import (
    tool_applescript,
    tool_get_installed_apps,
    tool_powershell_script,
)
from app.tools.tools.scheduler import (
    tool_cancel_scheduled,
    tool_heartbeat_status,
    tool_list_scheduled,
    tool_prevent_sleep,
    tool_schedule_task,
)
from app.tools.tools.media import (
    tool_archive_create,
    tool_archive_extract,
    tool_image_ocr,
    tool_image_resize,
    tool_pdf_extract,
)
from app.tools.tools.wifi_bluetooth import (
    tool_bluetooth_devices,
    tool_connected_devices,
    tool_wifi_networks,
)
from app.tools.types import ToolResult, ToolResultType

logger = logging.getLogger(__name__)

ToolHandler = Callable[..., Coroutine[Any, Any, ToolResult]]

TOOL_HANDLERS: dict[str, ToolHandler] = {
    # ── File Operations ──────────────────────────────────────────────
    "Read": tool_read,
    "Write": tool_write,
    "Edit": tool_edit,
    "Glob": tool_glob,
    "Grep": tool_grep,
    # ── Execution ────────────────────────────────────────────────────
    "Bash": tool_bash,
    "BashOutput": tool_bash_output,
    "TaskStop": tool_task_stop,
    # ── System ───────────────────────────────────────────────────────
    "SystemInfo": tool_system_info,
    "Screenshot": tool_screenshot,
    "ListDirectory": tool_list_directory,
    "OpenUrl": tool_open_url,
    "OpenPath": tool_open_path,
    # ── Clipboard ────────────────────────────────────────────────────
    "ClipboardRead": tool_clipboard_read,
    "ClipboardWrite": tool_clipboard_write,
    # ── Notifications ────────────────────────────────────────────────
    "Notify": tool_notify,
    # ── Network / Scraping ───────────────────────────────────────────
    "FetchUrl": tool_fetch_url,
    "FetchWithBrowser": tool_fetch_with_browser,
    "Scrape": tool_scrape,
    "Search": tool_search,
    "Research": tool_research,
    # ── File Transfer ────────────────────────────────────────────────
    "DownloadFile": tool_download_file,
    "UploadFile": tool_upload_file,
    # ── Process Management ───────────────────────────────────────────
    "ListProcesses": tool_list_processes,
    "LaunchApp": tool_launch_app,
    "KillProcess": tool_kill_process,
    "FocusApp": tool_focus_app,
    "ListPorts": tool_list_ports,
    # ── Window Management ────────────────────────────────────────────
    "ListWindows": tool_list_windows,
    "FocusWindow": tool_focus_window,
    "MoveWindow": tool_move_window,
    "MinimizeWindow": tool_minimize_window,
    # ── Input Automation ─────────────────────────────────────────────
    "TypeText": tool_type_text,
    "Hotkey": tool_hotkey,
    "MouseClick": tool_mouse_click,
    "MouseMove": tool_mouse_move,
    # ── Audio ────────────────────────────────────────────────────────
    "ListAudioDevices": tool_list_audio_devices,
    "RecordAudio": tool_record_audio,
    "PlayAudio": tool_play_audio,
    "TranscribeAudio": tool_transcribe_audio,
    # ── Browser Automation ───────────────────────────────────────────
    "BrowserNavigate": tool_browser_navigate,
    "BrowserClick": tool_browser_click,
    "BrowserType": tool_browser_type,
    "BrowserExtract": tool_browser_extract,
    "BrowserScreenshot": tool_browser_screenshot,
    "BrowserEval": tool_browser_eval,
    "BrowserTabs": tool_browser_tabs,
    # ── Network Discovery ────────────────────────────────────────────
    "NetworkInfo": tool_network_info,
    "NetworkScan": tool_network_scan,
    "PortScan": tool_port_scan,
    "MDNSDiscover": tool_mdns_discover,
    # ── System Monitoring ────────────────────────────────────────────
    "SystemResources": tool_system_resources,
    "BatteryStatus": tool_battery_status,
    "DiskUsage": tool_disk_usage,
    "TopProcesses": tool_top_processes,
    # ── File Watching ────────────────────────────────────────────────
    "WatchDirectory": tool_watch_directory,
    "WatchEvents": tool_watch_events,
    "StopWatch": tool_stop_watch,
    # ── OS App Integration ───────────────────────────────────────────
    "AppleScript": tool_applescript,
    "PowerShellScript": tool_powershell_script,
    "GetInstalledApps": tool_get_installed_apps,
    # ── Scheduler / Heartbeat ────────────────────────────────────────
    "ScheduleTask": tool_schedule_task,
    "ListScheduled": tool_list_scheduled,
    "CancelScheduled": tool_cancel_scheduled,
    "HeartbeatStatus": tool_heartbeat_status,
    "PreventSleep": tool_prevent_sleep,
    # ── Media Processing ─────────────────────────────────────────────
    "ImageOCR": tool_image_ocr,
    "ImageResize": tool_image_resize,
    "PdfExtract": tool_pdf_extract,
    "ArchiveCreate": tool_archive_create,
    "ArchiveExtract": tool_archive_extract,
    # ── WiFi & Bluetooth ─────────────────────────────────────────────
    "WifiNetworks": tool_wifi_networks,
    "BluetoothDevices": tool_bluetooth_devices,
    "ConnectedDevices": tool_connected_devices,
}

TOOL_NAMES: list[str] = sorted(TOOL_HANDLERS.keys())


async def dispatch(
    tool_name: str,
    tool_input: dict[str, Any],
    session: ToolSession,
) -> ToolResult:
    handler = TOOL_HANDLERS.get(tool_name)
    if handler is None:
        return ToolResult(
            type=ToolResultType.ERROR,
            output=f"Unknown tool: {tool_name}. Available: {', '.join(TOOL_NAMES)}",
        )
    try:
        return await handler(session=session, **tool_input)
    except TypeError as e:
        logger.warning("Invalid parameters for tool %s: %s", tool_name, e)
        return ToolResult(
            type=ToolResultType.ERROR,
            output=f"Invalid parameters for {tool_name}: {e}",
        )
    except Exception as e:
        logger.exception("Tool %s failed", tool_name)
        return ToolResult(
            type=ToolResultType.ERROR,
            output=f"Tool {tool_name} failed: {type(e).__name__}: {e}",
        )
