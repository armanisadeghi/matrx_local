"""OS application integration tools — AppleScript, PowerShell, installed apps discovery."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import platform
import re
import subprocess

from app.tools.session import ToolSession
from app.tools.types import ToolResult, ToolResultType

logger = logging.getLogger(__name__)

IS_WINDOWS = platform.system() == "Windows"
IS_MACOS = platform.system() == "Darwin"


async def tool_applescript(
    session: ToolSession,
    script: str,
    timeout: int = 30,
) -> ToolResult:
    """Run an AppleScript command (macOS only). Enables deep OS integration:
    controlling apps, getting app data, automating workflows.

    Examples:
    - 'tell application "Safari" to get URL of current tab of window 1'
    - 'tell application "Finder" to get name of every file of desktop'
    - 'tell application "System Events" to get name of every process whose visible is true'
    - 'display dialog "Hello" buttons {"OK"}'
    """
    if not IS_MACOS:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="AppleScript is only available on macOS. Use PowerShellScript on Windows.",
        )

    try:
        proc = await asyncio.create_subprocess_exec(
            "osascript", "-e", script,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)

        output = stdout.decode("utf-8", errors="replace").strip()
        error = stderr.decode("utf-8", errors="replace").strip()

        if proc.returncode != 0:
            return ToolResult(
                type=ToolResultType.ERROR,
                output=f"AppleScript error:\n{error or output}",
            )

        return ToolResult(
            output=output or "(no output)",
            metadata={"exit_code": proc.returncode},
        )

    except asyncio.TimeoutError:
        return ToolResult(type=ToolResultType.ERROR, output=f"AppleScript timed out after {timeout}s")
    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"AppleScript failed: {e}")


async def tool_powershell_script(
    session: ToolSession,
    script: str,
    timeout: int = 30,
) -> ToolResult:
    """Run a PowerShell script (Windows only). Enables deep OS integration:
    controlling apps, registry access, COM automation, WMI queries.

    Examples:
    - 'Get-Process | Sort-Object CPU -Descending | Select-Object -First 10'
    - '(New-Object -ComObject Shell.Application).Windows() | ForEach-Object { $_.LocationURL }'
    - 'Get-ChildItem HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall | Get-ItemProperty | Select-Object DisplayName'
    """
    if not IS_WINDOWS:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="PowerShellScript is only available on Windows. Use AppleScript on macOS.",
        )

    try:
        proc = await asyncio.create_subprocess_exec(
            "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)

        output = stdout.decode("utf-8", errors="replace").strip()
        error = stderr.decode("utf-8", errors="replace").strip()

        if proc.returncode != 0 and not output:
            return ToolResult(
                type=ToolResultType.ERROR,
                output=f"PowerShell error:\n{error or output}",
            )

        # Combine output and error if both present
        combined = output
        if error and proc.returncode != 0:
            combined += f"\n\nWarnings:\n{error}"

        return ToolResult(
            output=combined or "(no output)",
            metadata={"exit_code": proc.returncode},
        )

    except asyncio.TimeoutError:
        return ToolResult(type=ToolResultType.ERROR, output=f"PowerShell timed out after {timeout}s")
    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"PowerShell failed: {e}")


async def tool_get_installed_apps(
    session: ToolSession,
    filter: str | None = None,
) -> ToolResult:
    """List installed applications on the system. Optionally filter by name."""
    try:
        if IS_MACOS:
            return await _get_apps_macos(filter)
        elif IS_WINDOWS:
            return await _get_apps_windows(filter)
        else:
            return await _get_apps_linux(filter)
    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Failed to list apps: {e}")


async def _get_apps_macos(filter: str | None) -> ToolResult:
    """List macOS applications from /Applications and ~/Applications."""
    apps = []

    for app_dir in ["/Applications", os.path.expanduser("~/Applications")]:
        if not os.path.isdir(app_dir):
            continue
        for item in os.listdir(app_dir):
            if item.endswith(".app"):
                name = item[:-4]  # Remove .app
                if filter and filter.lower() not in name.lower():
                    continue
                full_path = os.path.join(app_dir, item)

                # Try to get version from Info.plist
                version = ""
                plist = os.path.join(full_path, "Contents", "Info.plist")
                if os.path.exists(plist):
                    try:
                        result = subprocess.run(
                            ["defaults", "read", plist, "CFBundleShortVersionString"],
                            capture_output=True, text=True, timeout=5,
                        )
                        version = result.stdout.strip()
                    except Exception:
                        pass

                apps.append({
                    "name": name,
                    "path": full_path,
                    "version": version,
                })

    # Also check system_profiler for more apps
    try:
        proc = await asyncio.create_subprocess_exec(
            "system_profiler", "SPApplicationsDataType", "-json",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=30)
        data = json.loads(stdout.decode())
        sp_apps = data.get("SPApplicationsDataType", [])

        existing_paths = {a["path"] for a in apps}
        for app in sp_apps:
            path = app.get("path", "")
            if path in existing_paths:
                continue
            name = app.get("_name", "")
            if filter and filter.lower() not in name.lower():
                continue
            apps.append({
                "name": name,
                "path": path,
                "version": app.get("version", ""),
            })
    except Exception:
        pass

    apps.sort(key=lambda a: a["name"].lower())

    lines = [f"Installed applications ({len(apps)}):", ""]
    for app in apps:
        ver = f" v{app['version']}" if app['version'] else ""
        lines.append(f"  {app['name']}{ver}")
        lines.append(f"    {app['path']}")

    return ToolResult(
        output="\n".join(lines),
        metadata={"apps": apps, "count": len(apps)},
    )


async def _get_apps_windows(filter: str | None) -> ToolResult:
    """List Windows installed applications from registry."""
    ps_script = """
$apps = @()
$regPaths = @(
    'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
foreach ($path in $regPaths) {
    $items = Get-ItemProperty $path -ErrorAction SilentlyContinue
    foreach ($item in $items) {
        if ($item.DisplayName) {
            $apps += [PSCustomObject]@{
                Name = $item.DisplayName
                Version = $item.DisplayVersion
                Publisher = $item.Publisher
                InstallLocation = $item.InstallLocation
            }
        }
    }
}
$apps | Sort-Object Name -Unique | ConvertTo-Json -Depth 2
"""
    proc = await asyncio.create_subprocess_exec(
        "powershell.exe", "-NoProfile", "-Command", ps_script,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=30)

    try:
        apps_data = json.loads(stdout.decode())
        if isinstance(apps_data, dict):
            apps_data = [apps_data]
    except json.JSONDecodeError:
        return ToolResult(output=stdout.decode()[:5000])

    apps = []
    for app in apps_data:
        name = app.get("Name", "")
        if filter and filter.lower() not in name.lower():
            continue
        apps.append({
            "name": name,
            "version": app.get("Version", ""),
            "publisher": app.get("Publisher", ""),
            "path": app.get("InstallLocation", ""),
        })

    lines = [f"Installed applications ({len(apps)}):", ""]
    for app in apps:
        ver = f" v{app['version']}" if app['version'] else ""
        pub = f" ({app['publisher']})" if app['publisher'] else ""
        lines.append(f"  {app['name']}{ver}{pub}")

    return ToolResult(
        output="\n".join(lines),
        metadata={"apps": apps, "count": len(apps)},
    )


async def _get_apps_linux(filter: str | None) -> ToolResult:
    """List Linux applications from desktop entries and package managers."""
    apps = []

    # Check desktop entries
    desktop_dirs = [
        "/usr/share/applications",
        "/usr/local/share/applications",
        os.path.expanduser("~/.local/share/applications"),
    ]

    for desktop_dir in desktop_dirs:
        if not os.path.isdir(desktop_dir):
            continue
        for item in os.listdir(desktop_dir):
            if not item.endswith(".desktop"):
                continue
            filepath = os.path.join(desktop_dir, item)
            try:
                name = ""
                exec_path = ""
                with open(filepath) as f:
                    for line in f:
                        if line.startswith("Name="):
                            name = line.split("=", 1)[1].strip()
                        elif line.startswith("Exec="):
                            exec_path = line.split("=", 1)[1].strip()

                if name:
                    if filter and filter.lower() not in name.lower():
                        continue
                    apps.append({
                        "name": name,
                        "path": exec_path,
                        "version": "",
                    })
            except Exception:
                continue

    apps.sort(key=lambda a: a["name"].lower())

    # Deduplicate by name
    seen = set()
    unique = []
    for app in apps:
        if app["name"] not in seen:
            seen.add(app["name"])
            unique.append(app)

    lines = [f"Installed applications ({len(unique)}):", ""]
    for app in unique:
        lines.append(f"  {app['name']}")
        if app['path']:
            lines.append(f"    {app['path']}")

    return ToolResult(
        output="\n".join(lines),
        metadata={"apps": unique, "count": len(unique)},
    )
