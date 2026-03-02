"""Local tool manifest — the single source of truth for all local tools.

Every tool that should be available to AI models is defined here with:
  - canonical name (the identifier sent to the AI and stored in the DB)
  - description
  - arg_model: Pydantic BaseModel whose .model_json_schema() drives the DB
    schema. When set, the hand-written `parameters` dict is ignored and the
    bridge uses the model for both validation AND schema generation.
  - category, tags
  - the Python handler function (for the bridge)

ADDING A TOOL:
  1. Implement tool_xxx() in app/tools/tools/<module>.py
  2. Write an arg model in app/tools/arg_models/<category>_args.py
  3. Add an entry to LOCAL_TOOL_MANIFEST below (set arg_model=YourArgs)
  4. Run: uv run python -m app.tools.tool_sync status
  5. Run: uv run python -m app.tools.tool_sync push  (to write to DB)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# ── Arg models ────────────────────────────────────────────────────────────────
from app.tools.arg_models.execution_args import BashArgs, BashOutputArgs, TaskStopArgs
from app.tools.arg_models.file_ops_args import (
    EditArgs,
    GlobArgs,
    GrepArgs,
    ListDirectoryArgs,
    ReadArgs,
    WriteArgs,
)
from app.tools.arg_models.system_args import (
    BatteryStatusArgs,
    ClipboardReadArgs,
    ClipboardWriteArgs,
    DiskUsageArgs,
    NotifyArgs,
    OpenPathArgs,
    OpenUrlArgs,
    ScreenshotArgs,
    SystemInfoArgs,
    SystemResourcesArgs,
    TopProcessesArgs,
)
from app.tools.arg_models.process_args import (
    FocusAppArgs,
    KillProcessArgs,
    LaunchAppArgs,
    ListPortsArgs,
    ListProcessesArgs,
)
from app.tools.arg_models.browser_args import (
    BrowserClickArgs,
    BrowserEvalArgs,
    BrowserExtractArgs,
    BrowserNavigateArgs,
    BrowserScreenshotArgs,
    BrowserTabsArgs,
    BrowserTypeArgs,
    FetchUrlArgs,
    FetchWithBrowserArgs,
    ResearchArgs,
    ScrapeArgs,
    SearchArgs,
)
from app.tools.arg_models.network_args import (
    MdnsDiscoverArgs,
    NetworkInfoArgs,
    NetworkScanArgs,
    PortScanArgs,
)
from app.tools.arg_models.input_args import (
    FocusWindowArgs,
    HotkeyArgs,
    ListWindowsArgs,
    MinimizeWindowArgs,
    MouseClickArgs,
    MouseMoveArgs,
    MoveWindowArgs,
    TypeTextArgs,
)
from app.tools.arg_models.media_args import (
    ArchiveCreateArgs,
    ArchiveExtractArgs,
    ImageOcrArgs,
    ImageResizeArgs,
    PdfExtractArgs,
)
from app.tools.arg_models.app_args import (
    AppleScriptArgs,
    GetInstalledAppsArgs,
    ListDocumentFoldersArgs,
    ListDocumentsArgs,
    PowerShellScriptArgs,
    ReadDocumentArgs,
    SearchDocumentsArgs,
    WriteDocumentArgs,
)


# ---------------------------------------------------------------------------
# Manifest entry
# ---------------------------------------------------------------------------

@dataclass
class LocalToolEntry:
    """Defines a single local tool for registration in matrx-ai's tool registry."""

    name: str
    description: str
    category: str

    # Pydantic model for arg validation + schema generation (preferred).
    # When set, the bridge validates args through this model and generates
    # the JSON Schema from it — `parameters` below is ignored.
    arg_model: type | None = None

    # Fallback hand-written JSON Schema — only used when arg_model is None.
    parameters: dict[str, Any] = field(default_factory=dict)

    tags: list[str] = field(default_factory=list)
    version: str = "1.0.0"

    # Dotted import path to the handler function
    function_path: str = ""

    # Per-tool timeout in seconds (used by the bridge, NOT stored in DB)
    timeout_seconds: float = 120.0

    # Identifies which application provides this tool.
    # "matrx_local" = only available when the desktop sidecar is running.
    # "matrx_ai"    = built-in sandboxed tools in the matrx-ai engine.
    # Agent builders use this to filter tools to those available in the target environment.
    source_app: str = "matrx_local"


# ===========================================================================
# MANIFEST
# ===========================================================================

LOCAL_TOOL_MANIFEST: list[LocalToolEntry] = [

    # ── Execution ─────────────────────────────────────────────────────────────

    LocalToolEntry(
        name="local_bash",
        description=(
            "Run a shell command on the local system with full OS access. "
            "Tracks working directory across calls via session state."
        ),
        arg_model=BashArgs,
        category="local_execution",
        tags=["shell", "local", "os", "command"],
        function_path="app.tools.tools.execution.tool_bash",
    ),

    LocalToolEntry(
        name="local_bash_output",
        description=(
            "Read accumulated output from a background shell command started "
            "with local_bash (run_in_background=true)."
        ),
        arg_model=BashOutputArgs,
        category="local_execution",
        tags=["shell", "local", "background"],
        function_path="app.tools.tools.execution.tool_bash_output",
    ),

    LocalToolEntry(
        name="local_task_stop",
        description="Stop a background shell task started with local_bash.",
        arg_model=TaskStopArgs,
        category="local_execution",
        tags=["shell", "local", "background", "stop"],
        function_path="app.tools.tools.execution.tool_task_stop",
    ),

    # ── File Operations ───────────────────────────────────────────────────────

    LocalToolEntry(
        name="local_read_file",
        description=(
            "Read a file from the local filesystem. Returns line-numbered content. "
            "Supports offset and limit for large files."
        ),
        arg_model=ReadArgs,
        category="local_file_ops",
        tags=["file", "read", "local", "filesystem"],
        function_path="app.tools.tools.file_ops.tool_read",
    ),

    LocalToolEntry(
        name="local_write_file",
        description=(
            "Write content to a file on the local filesystem. "
            "Creates parent directories as needed."
        ),
        arg_model=WriteArgs,
        category="local_file_ops",
        tags=["file", "write", "local", "filesystem"],
        function_path="app.tools.tools.file_ops.tool_write",
    ),

    LocalToolEntry(
        name="local_edit_file",
        description=(
            "Apply a precise string replacement to a file. "
            "old_string must match exactly (including whitespace) and be unique in the file."
        ),
        arg_model=EditArgs,
        category="local_file_ops",
        tags=["file", "edit", "local", "filesystem"],
        function_path="app.tools.tools.file_ops.tool_edit",
    ),

    LocalToolEntry(
        name="local_glob",
        description="Find files matching a glob pattern on the local filesystem.",
        arg_model=GlobArgs,
        category="local_file_ops",
        tags=["file", "search", "glob", "local"],
        function_path="app.tools.tools.file_ops.tool_glob",
    ),

    LocalToolEntry(
        name="local_grep",
        description="Search file contents for a regex pattern on the local filesystem.",
        arg_model=GrepArgs,
        category="local_file_ops",
        tags=["file", "search", "grep", "local"],
        function_path="app.tools.tools.file_ops.tool_grep",
    ),

    LocalToolEntry(
        name="local_list_directory",
        description="List the contents of a directory on the local filesystem.",
        arg_model=ListDirectoryArgs,
        category="local_file_ops",
        tags=["file", "directory", "list", "local"],
        function_path="app.tools.tools.system.tool_list_directory",
    ),

    # ── System ────────────────────────────────────────────────────────────────

    LocalToolEntry(
        name="local_system_info",
        description="Get detailed information about the local system: OS, CPU, RAM, disk, hostname.",
        arg_model=SystemInfoArgs,
        category="local_system",
        tags=["system", "info", "local"],
        function_path="app.tools.tools.system.tool_system_info",
    ),

    LocalToolEntry(
        name="local_screenshot",
        description="Take a screenshot of the local screen and return it as a base64-encoded image.",
        arg_model=ScreenshotArgs,
        category="local_system",
        tags=["screenshot", "screen", "local"],
        function_path="app.tools.tools.system.tool_screenshot",
        timeout_seconds=15.0,
    ),

    LocalToolEntry(
        name="local_open_url",
        description="Open a URL in the default web browser on the local system.",
        arg_model=OpenUrlArgs,
        category="local_system",
        tags=["browser", "url", "open", "local"],
        function_path="app.tools.tools.system.tool_open_url",
    ),

    LocalToolEntry(
        name="local_open_path",
        description=(
            "Open a file or directory in the system's default application "
            "(Finder on macOS, Explorer on Windows)."
        ),
        arg_model=OpenPathArgs,
        category="local_system",
        tags=["file", "open", "local"],
        function_path="app.tools.tools.system.tool_open_path",
    ),

    # ── System Monitor ────────────────────────────────────────────────────────

    LocalToolEntry(
        name="local_system_resources",
        description="Get real-time CPU, memory, disk, and network usage statistics.",
        arg_model=SystemResourcesArgs,
        category="local_system",
        tags=["monitor", "cpu", "memory", "local"],
        function_path="app.tools.tools.system_monitor.tool_system_resources",
    ),

    LocalToolEntry(
        name="local_battery_status",
        description="Get battery level, charging status, and estimated time remaining.",
        arg_model=BatteryStatusArgs,
        category="local_system",
        tags=["battery", "power", "local"],
        function_path="app.tools.tools.system_monitor.tool_battery_status",
    ),

    LocalToolEntry(
        name="local_disk_usage",
        description="Get disk usage statistics for all mounted volumes or a specific path.",
        arg_model=DiskUsageArgs,
        category="local_system",
        tags=["disk", "storage", "local"],
        function_path="app.tools.tools.system_monitor.tool_disk_usage",
    ),

    LocalToolEntry(
        name="local_top_processes",
        description="Get top N processes by CPU or memory usage.",
        arg_model=TopProcessesArgs,
        category="local_system",
        tags=["process", "monitor", "local"],
        function_path="app.tools.tools.system_monitor.tool_top_processes",
    ),

    # ── Clipboard ─────────────────────────────────────────────────────────────

    LocalToolEntry(
        name="local_clipboard_read",
        description="Read the current contents of the system clipboard.",
        arg_model=ClipboardReadArgs,
        category="local_system",
        tags=["clipboard", "local"],
        function_path="app.tools.tools.clipboard.tool_clipboard_read",
    ),

    LocalToolEntry(
        name="local_clipboard_write",
        description="Write text to the system clipboard.",
        arg_model=ClipboardWriteArgs,
        category="local_system",
        tags=["clipboard", "local"],
        function_path="app.tools.tools.clipboard.tool_clipboard_write",
    ),

    # ── Notifications ─────────────────────────────────────────────────────────

    LocalToolEntry(
        name="local_notify",
        description="Show a desktop notification on the local system.",
        arg_model=NotifyArgs,
        category="local_system",
        tags=["notification", "local"],
        function_path="app.tools.tools.notify.tool_notify",
    ),

    # ── Process Management ────────────────────────────────────────────────────

    LocalToolEntry(
        name="local_list_processes",
        description="List running processes with PID, name, CPU%, and memory usage.",
        arg_model=ListProcessesArgs,
        category="local_process",
        tags=["process", "system", "local"],
        function_path="app.tools.tools.process_manager.tool_list_processes",
    ),

    LocalToolEntry(
        name="local_list_ports",
        description="List listening TCP/UDP ports and the processes bound to them.",
        arg_model=ListPortsArgs,
        category="local_process",
        tags=["network", "ports", "local"],
        function_path="app.tools.tools.process_manager.tool_list_ports",
    ),

    LocalToolEntry(
        name="local_launch_app",
        description="Launch an application on the local system by name or path.",
        arg_model=LaunchAppArgs,
        category="local_process",
        tags=["app", "launch", "local"],
        function_path="app.tools.tools.process_manager.tool_launch_app",
        timeout_seconds=60.0,
    ),

    LocalToolEntry(
        name="local_kill_process",
        description="Kill a running process by PID or name.",
        arg_model=KillProcessArgs,
        category="local_process",
        tags=["process", "kill", "local"],
        function_path="app.tools.tools.process_manager.tool_kill_process",
    ),

    LocalToolEntry(
        name="local_focus_app",
        description=(
            "Bring an application window to the foreground. "
            "Uses AppleScript on macOS, PowerShell on Windows."
        ),
        arg_model=FocusAppArgs,
        category="local_process",
        tags=["app", "focus", "window", "local"],
        function_path="app.tools.tools.process_manager.tool_focus_app",
    ),

    # ── Browser Automation ────────────────────────────────────────────────────

    LocalToolEntry(
        name="local_browser_navigate",
        description="Navigate the local Playwright-controlled browser to a URL.",
        arg_model=BrowserNavigateArgs,
        category="local_browser",
        tags=["browser", "navigate", "playwright", "local"],
        function_path="app.tools.tools.browser_automation.tool_browser_navigate",
        timeout_seconds=30.0,
    ),

    LocalToolEntry(
        name="local_browser_click",
        description="Click an element on the current browser page by CSS selector.",
        arg_model=BrowserClickArgs,
        category="local_browser",
        tags=["browser", "click", "playwright", "local"],
        function_path="app.tools.tools.browser_automation.tool_browser_click",
        timeout_seconds=15.0,
    ),

    LocalToolEntry(
        name="local_browser_type",
        description="Type text into an input element on the current browser page.",
        arg_model=BrowserTypeArgs,
        category="local_browser",
        tags=["browser", "type", "playwright", "local"],
        function_path="app.tools.tools.browser_automation.tool_browser_type",
        timeout_seconds=15.0,
    ),

    LocalToolEntry(
        name="local_browser_extract",
        description=(
            "Extract text, HTML, attributes, or form values from the current browser page."
        ),
        arg_model=BrowserExtractArgs,
        category="local_browser",
        tags=["browser", "extract", "scrape", "local"],
        function_path="app.tools.tools.browser_automation.tool_browser_extract",
        timeout_seconds=15.0,
    ),

    LocalToolEntry(
        name="local_browser_screenshot",
        description="Take a screenshot of the current browser page or a specific element.",
        arg_model=BrowserScreenshotArgs,
        category="local_browser",
        tags=["browser", "screenshot", "playwright", "local"],
        function_path="app.tools.tools.browser_automation.tool_browser_screenshot",
        timeout_seconds=15.0,
    ),

    LocalToolEntry(
        name="local_browser_eval",
        description="Execute JavaScript in the current browser page context.",
        arg_model=BrowserEvalArgs,
        category="local_browser",
        tags=["browser", "javascript", "playwright", "local"],
        function_path="app.tools.tools.browser_automation.tool_browser_eval",
        timeout_seconds=15.0,
    ),

    LocalToolEntry(
        name="local_browser_tabs",
        description="Manage browser tabs: list, open new, close, or switch to a tab.",
        arg_model=BrowserTabsArgs,
        category="local_browser",
        tags=["browser", "tabs", "playwright", "local"],
        function_path="app.tools.tools.browser_automation.tool_browser_tabs",
        timeout_seconds=15.0,
    ),

    # ── Network / HTTP ────────────────────────────────────────────────────────

    LocalToolEntry(
        name="local_fetch_url",
        description="Fetch content from a URL using HTTP (curl-cffi). Returns status, headers, and body.",
        arg_model=FetchUrlArgs,
        category="local_network",
        tags=["http", "fetch", "network", "local"],
        function_path="app.tools.tools.network.tool_fetch_url",
        timeout_seconds=60.0,
    ),

    LocalToolEntry(
        name="local_fetch_with_browser",
        description=(
            "Fetch a URL using a headless browser (Playwright). Use when the page "
            "requires JavaScript rendering."
        ),
        arg_model=FetchWithBrowserArgs,
        category="local_network",
        tags=["http", "fetch", "browser", "playwright", "local"],
        function_path="app.tools.tools.network.tool_fetch_with_browser",
        timeout_seconds=60.0,
    ),

    LocalToolEntry(
        name="local_scrape",
        description=(
            "Scrape one or more URLs with the full scraper pipeline "
            "(JS rendering, content extraction, optional caching)."
        ),
        arg_model=ScrapeArgs,
        category="local_network",
        tags=["scrape", "web", "local"],
        function_path="app.tools.tools.network.tool_scrape",
        timeout_seconds=120.0,
    ),

    LocalToolEntry(
        name="local_search",
        description="Search the web using Brave Search API and return results.",
        arg_model=SearchArgs,
        category="local_network",
        tags=["search", "web", "brave", "local"],
        function_path="app.tools.tools.network.tool_search",
        timeout_seconds=30.0,
    ),

    LocalToolEntry(
        name="local_research",
        description=(
            "Deep web research: search + scrape all results + compile findings "
            "into a structured report."
        ),
        arg_model=ResearchArgs,
        category="local_network",
        tags=["research", "search", "scrape", "web", "local"],
        function_path="app.tools.tools.network.tool_research",
        timeout_seconds=300.0,
    ),

    # ── Network Discovery ─────────────────────────────────────────────────────

    LocalToolEntry(
        name="local_network_info",
        description="Get local network information: IPs, interfaces, gateway, DNS, MAC addresses.",
        arg_model=NetworkInfoArgs,
        category="local_network",
        tags=["network", "info", "local"],
        function_path="app.tools.tools.network_discovery.tool_network_info",
    ),

    LocalToolEntry(
        name="local_network_scan",
        description="Scan the local network for active hosts using ARP.",
        arg_model=NetworkScanArgs,
        category="local_network",
        tags=["network", "scan", "arp", "local"],
        function_path="app.tools.tools.network_discovery.tool_network_scan",
        timeout_seconds=60.0,
    ),

    LocalToolEntry(
        name="local_port_scan",
        description="Scan a host for open TCP ports.",
        arg_model=PortScanArgs,
        category="local_network",
        tags=["network", "ports", "scan", "local"],
        function_path="app.tools.tools.network_discovery.tool_port_scan",
        timeout_seconds=120.0,
    ),

    LocalToolEntry(
        name="local_mdns_discover",
        description=(
            "Discover mDNS/Bonjour services on the local network "
            "(smart devices, printers, AirPlay, HomeKit, etc.)."
        ),
        arg_model=MdnsDiscoverArgs,
        category="local_network",
        tags=["network", "mdns", "bonjour", "discovery", "local"],
        function_path="app.tools.tools.network_discovery.tool_mdns_discover",
        timeout_seconds=30.0,
    ),

    # ── Input Automation ──────────────────────────────────────────────────────

    LocalToolEntry(
        name="local_type_text",
        description="Type text using the system keyboard (simulates keystrokes).",
        arg_model=TypeTextArgs,
        category="local_input",
        tags=["keyboard", "type", "automation", "local"],
        function_path="app.tools.tools.input_automation.tool_type_text",
    ),

    LocalToolEntry(
        name="local_hotkey",
        description=(
            "Send a keyboard shortcut (e.g. 'cmd+c', 'ctrl+shift+s', 'alt+tab'). "
            "Modifiers: cmd/command, ctrl/control, alt/option, shift."
        ),
        arg_model=HotkeyArgs,
        category="local_input",
        tags=["keyboard", "hotkey", "automation", "local"],
        function_path="app.tools.tools.input_automation.tool_hotkey",
    ),

    LocalToolEntry(
        name="local_mouse_click",
        description="Click the mouse at specific screen coordinates.",
        arg_model=MouseClickArgs,
        category="local_input",
        tags=["mouse", "click", "automation", "local"],
        function_path="app.tools.tools.input_automation.tool_mouse_click",
    ),

    LocalToolEntry(
        name="local_mouse_move",
        description="Move the mouse cursor to specific screen coordinates.",
        arg_model=MouseMoveArgs,
        category="local_input",
        tags=["mouse", "move", "automation", "local"],
        function_path="app.tools.tools.input_automation.tool_mouse_move",
    ),

    # ── Window Management ─────────────────────────────────────────────────────

    LocalToolEntry(
        name="local_list_windows",
        description="List all visible windows with title, app name, position, and size.",
        arg_model=ListWindowsArgs,
        category="local_window",
        tags=["window", "list", "local"],
        function_path="app.tools.tools.window_manager.tool_list_windows",
    ),

    LocalToolEntry(
        name="local_focus_window",
        description="Bring a window to the foreground by app name and optional title.",
        arg_model=FocusWindowArgs,
        category="local_window",
        tags=["window", "focus", "local"],
        function_path="app.tools.tools.window_manager.tool_focus_window",
    ),

    LocalToolEntry(
        name="local_move_window",
        description="Move and/or resize a window by app name.",
        arg_model=MoveWindowArgs,
        category="local_window",
        tags=["window", "move", "resize", "local"],
        function_path="app.tools.tools.window_manager.tool_move_window",
    ),

    LocalToolEntry(
        name="local_minimize_window",
        description="Minimize, maximize, or restore a window.",
        arg_model=MinimizeWindowArgs,
        category="local_window",
        tags=["window", "minimize", "maximize", "local"],
        function_path="app.tools.tools.window_manager.tool_minimize_window",
    ),

    # ── OS Integration ────────────────────────────────────────────────────────

    LocalToolEntry(
        name="local_applescript",
        description=(
            "Execute AppleScript on macOS. Controls Finder, Mail, Calendar, "
            "Safari, and any scriptable application."
        ),
        arg_model=AppleScriptArgs,
        category="local_os",
        tags=["applescript", "macos", "automation", "local"],
        function_path="app.tools.tools.app_integration.tool_applescript",
        timeout_seconds=60.0,
    ),

    LocalToolEntry(
        name="local_powershell",
        description=(
            "Execute a PowerShell script on Windows. Has access to COM, WMI, "
            ".NET APIs, and the registry."
        ),
        arg_model=PowerShellScriptArgs,
        category="local_os",
        tags=["powershell", "windows", "automation", "local"],
        function_path="app.tools.tools.app_integration.tool_powershell_script",
        timeout_seconds=60.0,
    ),

    LocalToolEntry(
        name="local_get_installed_apps",
        description="List installed applications on the system, optionally filtered by name.",
        arg_model=GetInstalledAppsArgs,
        category="local_os",
        tags=["apps", "installed", "local"],
        function_path="app.tools.tools.app_integration.tool_get_installed_apps",
    ),

    # ── Media Processing ──────────────────────────────────────────────────────

    LocalToolEntry(
        name="local_image_ocr",
        description="Extract text from an image file using OCR (Tesseract).",
        arg_model=ImageOcrArgs,
        category="local_media",
        tags=["ocr", "image", "text", "local"],
        function_path="app.tools.tools.media.tool_image_ocr",
        timeout_seconds=60.0,
    ),

    LocalToolEntry(
        name="local_image_resize",
        description="Resize or convert an image file.",
        arg_model=ImageResizeArgs,
        category="local_media",
        tags=["image", "resize", "convert", "local"],
        function_path="app.tools.tools.media.tool_image_resize",
        timeout_seconds=30.0,
    ),

    LocalToolEntry(
        name="local_pdf_extract",
        description="Extract text (and optionally images) from a PDF file.",
        arg_model=PdfExtractArgs,
        category="local_media",
        tags=["pdf", "extract", "text", "local"],
        function_path="app.tools.tools.media.tool_pdf_extract",
        timeout_seconds=60.0,
    ),

    LocalToolEntry(
        name="local_archive_create",
        description="Create a zip or tar archive from files and directories.",
        arg_model=ArchiveCreateArgs,
        category="local_media",
        tags=["archive", "zip", "tar", "local"],
        function_path="app.tools.tools.media.tool_archive_create",
        timeout_seconds=120.0,
    ),

    LocalToolEntry(
        name="local_archive_extract",
        description="Extract a zip, tar, or 7z archive.",
        arg_model=ArchiveExtractArgs,
        category="local_media",
        tags=["archive", "extract", "zip", "tar", "local"],
        function_path="app.tools.tools.media.tool_archive_extract",
        timeout_seconds=120.0,
    ),

    # ── Documents ─────────────────────────────────────────────────────────────

    LocalToolEntry(
        name="local_list_documents",
        description="List documents in the local document store (~/.matrx/documents/).",
        arg_model=ListDocumentsArgs,
        category="local_documents",
        tags=["documents", "notes", "local"],
        function_path="app.tools.tools.documents.tool_list_documents",
    ),

    LocalToolEntry(
        name="local_read_document",
        description="Read the full content of a document from the local document store.",
        arg_model=ReadDocumentArgs,
        category="local_documents",
        tags=["documents", "notes", "read", "local"],
        function_path="app.tools.tools.documents.tool_read_document",
    ),

    LocalToolEntry(
        name="local_write_document",
        description="Create or update a Markdown document in the local document store.",
        arg_model=WriteDocumentArgs,
        category="local_documents",
        tags=["documents", "notes", "write", "local"],
        function_path="app.tools.tools.documents.tool_write_document",
    ),

    LocalToolEntry(
        name="local_search_documents",
        description="Search document content in the local store by keyword.",
        arg_model=SearchDocumentsArgs,
        category="local_documents",
        tags=["documents", "search", "notes", "local"],
        function_path="app.tools.tools.documents.tool_search_documents",
    ),

    LocalToolEntry(
        name="local_list_document_folders",
        description="List all folders in the local document store.",
        arg_model=ListDocumentFoldersArgs,
        category="local_documents",
        tags=["documents", "folders", "local"],
        function_path="app.tools.tools.documents.tool_list_document_folders",
    ),
]


# ── Fast lookup by name ────────────────────────────────────────────────────────

MANIFEST_BY_NAME: dict[str, LocalToolEntry] = {t.name: t for t in LOCAL_TOOL_MANIFEST}
