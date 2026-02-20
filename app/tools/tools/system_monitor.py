"""System monitoring tools — CPU, memory, disk, battery, and top processes."""

from __future__ import annotations

import asyncio
import logging
import os
import platform
import subprocess

from app.tools.session import ToolSession
from app.tools.types import ToolResult, ToolResultType

logger = logging.getLogger(__name__)

IS_WINDOWS = platform.system() == "Windows"
IS_MACOS = platform.system() == "Darwin"


async def tool_system_resources(
    session: ToolSession,
) -> ToolResult:
    """Get current system resource usage: CPU, RAM, disk, and network I/O."""
    try:
        import psutil

        # CPU
        cpu_percent = psutil.cpu_percent(interval=1)
        cpu_count = psutil.cpu_count()
        cpu_count_logical = psutil.cpu_count(logical=True)
        cpu_freq = psutil.cpu_freq()
        freq_str = f"{cpu_freq.current:.0f}MHz" if cpu_freq else "N/A"

        # Memory
        mem = psutil.virtual_memory()
        swap = psutil.swap_memory()

        # Disk (root / or C:)
        disk = psutil.disk_usage("/" if not IS_WINDOWS else "C:\\")

        # Network I/O
        net = psutil.net_io_counters()

        # Uptime
        import time
        boot_time = psutil.boot_time()
        uptime_seconds = time.time() - boot_time
        uptime_hours = uptime_seconds / 3600

        info = {
            "cpu_percent": cpu_percent,
            "cpu_cores": cpu_count,
            "cpu_logical": cpu_count_logical,
            "cpu_freq": freq_str,
            "ram_total_gb": round(mem.total / (1024 ** 3), 1),
            "ram_used_gb": round(mem.used / (1024 ** 3), 1),
            "ram_available_gb": round(mem.available / (1024 ** 3), 1),
            "ram_percent": mem.percent,
            "swap_total_gb": round(swap.total / (1024 ** 3), 1),
            "swap_used_gb": round(swap.used / (1024 ** 3), 1),
            "disk_total_gb": round(disk.total / (1024 ** 3), 1),
            "disk_used_gb": round(disk.used / (1024 ** 3), 1),
            "disk_free_gb": round(disk.free / (1024 ** 3), 1),
            "disk_percent": disk.percent,
            "net_sent_gb": round(net.bytes_sent / (1024 ** 3), 2),
            "net_recv_gb": round(net.bytes_recv / (1024 ** 3), 2),
            "uptime_hours": round(uptime_hours, 1),
        }

        lines = [
            "System Resources:",
            f"  CPU:  {cpu_percent}% ({cpu_count} cores / {cpu_count_logical} threads @ {freq_str})",
            f"  RAM:  {info['ram_used_gb']:.1f} / {info['ram_total_gb']:.1f} GB ({mem.percent}%)",
            f"  Swap: {info['swap_used_gb']:.1f} / {info['swap_total_gb']:.1f} GB",
            f"  Disk: {info['disk_used_gb']:.1f} / {info['disk_total_gb']:.1f} GB ({disk.percent}%)",
            f"  Net:  Sent {info['net_sent_gb']:.2f} GB / Recv {info['net_recv_gb']:.2f} GB",
            f"  Uptime: {info['uptime_hours']:.1f} hours",
        ]

        return ToolResult(output="\n".join(lines), metadata=info)

    except ImportError:
        return _system_resources_fallback()


def _system_resources_fallback() -> ToolResult:
    """Fallback using system commands."""
    try:
        if IS_MACOS:
            result = subprocess.run(
                ["top", "-l", "1", "-s", "0"],
                capture_output=True, text=True, timeout=10,
            )
            # Extract key lines
            lines = []
            for line in result.stdout.split("\n")[:12]:
                if any(kw in line for kw in ["CPU", "PhysMem", "Disk", "Networks"]):
                    lines.append(line.strip())
            return ToolResult(output="\n".join(lines) if lines else result.stdout[:2000])
        elif IS_WINDOWS:
            result = subprocess.run(
                ["systeminfo"],
                capture_output=True, text=True, timeout=30,
            )
            return ToolResult(output=result.stdout[:3000])
        else:
            result = subprocess.run(
                ["free", "-h"],
                capture_output=True, text=True, timeout=10,
            )
            result2 = subprocess.run(
                ["df", "-h", "/"],
                capture_output=True, text=True, timeout=10,
            )
            return ToolResult(output=f"Memory:\n{result.stdout}\nDisk:\n{result2.stdout}")
    except Exception as e:
        return ToolResult(
            type=ToolResultType.ERROR,
            output=f"Install 'psutil' for system monitoring: pip install psutil. Error: {e}",
        )


async def tool_battery_status(
    session: ToolSession,
) -> ToolResult:
    """Get battery level, charging status, and time remaining."""
    try:
        import psutil

        battery = psutil.sensors_battery()
        if battery is None:
            return ToolResult(output="No battery detected (desktop system).")

        status = "Charging" if battery.power_plugged else "Discharging"
        time_left = ""
        if battery.secsleft > 0:
            hours = battery.secsleft // 3600
            minutes = (battery.secsleft % 3600) // 60
            time_left = f" ({hours}h {minutes}m remaining)"
        elif battery.secsleft == -1:
            time_left = " (calculating...)"
        elif battery.power_plugged:
            time_left = " (plugged in)"

        info = {
            "percent": battery.percent,
            "plugged_in": battery.power_plugged,
            "status": status,
            "seconds_left": battery.secsleft if battery.secsleft > 0 else None,
        }

        return ToolResult(
            output=f"Battery: {battery.percent}% — {status}{time_left}",
            metadata=info,
        )

    except ImportError:
        # Fallback
        try:
            if IS_MACOS:
                result = subprocess.run(
                    ["pmset", "-g", "batt"],
                    capture_output=True, text=True, timeout=10,
                )
                return ToolResult(output=result.stdout.strip())
            elif IS_WINDOWS:
                result = subprocess.run(
                    ["powershell", "-Command",
                     "(Get-WmiObject Win32_Battery | Select-Object EstimatedChargeRemaining, BatteryStatus | Format-List)"],
                    capture_output=True, text=True, timeout=10,
                )
                return ToolResult(output=result.stdout.strip() or "No battery detected.")
            else:
                try:
                    with open("/sys/class/power_supply/BAT0/capacity") as f:
                        percent = f.read().strip()
                    with open("/sys/class/power_supply/BAT0/status") as f:
                        status = f.read().strip()
                    return ToolResult(output=f"Battery: {percent}% — {status}")
                except FileNotFoundError:
                    return ToolResult(output="No battery detected.")
        except Exception as e:
            return ToolResult(type=ToolResultType.ERROR, output=f"Battery check failed: {e}")


async def tool_disk_usage(
    session: ToolSession,
    path: str | None = None,
) -> ToolResult:
    """Get disk usage for all mounted volumes or a specific path."""
    try:
        import psutil

        if path:
            resolved = session.resolve_path(path)
            usage = psutil.disk_usage(resolved)
            return ToolResult(
                output=f"Disk usage for {resolved}:\n"
                       f"  Total: {usage.total / (1024**3):.1f} GB\n"
                       f"  Used:  {usage.used / (1024**3):.1f} GB ({usage.percent}%)\n"
                       f"  Free:  {usage.free / (1024**3):.1f} GB",
                metadata={
                    "path": resolved,
                    "total_gb": round(usage.total / (1024**3), 1),
                    "used_gb": round(usage.used / (1024**3), 1),
                    "free_gb": round(usage.free / (1024**3), 1),
                    "percent": usage.percent,
                },
            )

        partitions = psutil.disk_partitions()
        volumes = []
        lines = [f"{'MOUNT':<30} {'DEVICE':<25} {'TOTAL':>8} {'USED':>8} {'FREE':>8} {'USE%':>5}"]
        lines.append("-" * 90)

        for part in partitions:
            try:
                usage = psutil.disk_usage(part.mountpoint)
                vol = {
                    "mount": part.mountpoint,
                    "device": part.device,
                    "fstype": part.fstype,
                    "total_gb": round(usage.total / (1024**3), 1),
                    "used_gb": round(usage.used / (1024**3), 1),
                    "free_gb": round(usage.free / (1024**3), 1),
                    "percent": usage.percent,
                }
                volumes.append(vol)
                lines.append(
                    f"{part.mountpoint:<30} {part.device:<25} "
                    f"{vol['total_gb']:>7.1f}G {vol['used_gb']:>7.1f}G "
                    f"{vol['free_gb']:>7.1f}G {usage.percent:>4.0f}%"
                )
            except (PermissionError, OSError):
                continue

        return ToolResult(
            output="\n".join(lines),
            metadata={"volumes": volumes},
        )

    except ImportError:
        try:
            if IS_WINDOWS:
                result = subprocess.run(
                    ["wmic", "logicaldisk", "get", "size,freespace,caption"],
                    capture_output=True, text=True, timeout=10,
                )
            else:
                result = subprocess.run(
                    ["df", "-h"], capture_output=True, text=True, timeout=10,
                )
            return ToolResult(output=result.stdout)
        except Exception as e:
            return ToolResult(type=ToolResultType.ERROR, output=f"Disk usage failed: {e}")


async def tool_top_processes(
    session: ToolSession,
    sort_by: str = "cpu",
    limit: int = 15,
) -> ToolResult:
    """Get top processes by CPU or memory usage."""
    try:
        import psutil

        processes = []
        for proc in psutil.process_iter(["pid", "name", "cpu_percent", "memory_info", "memory_percent"]):
            try:
                info = proc.info
                mem = info.get("memory_info")
                processes.append({
                    "pid": info["pid"],
                    "name": info.get("name", "?"),
                    "cpu_percent": info.get("cpu_percent", 0.0) or 0.0,
                    "memory_mb": round(mem.rss / (1024 * 1024), 1) if mem else 0,
                    "memory_percent": round(info.get("memory_percent", 0.0) or 0.0, 1),
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

        key = "memory_mb" if sort_by == "memory" else "cpu_percent"
        processes.sort(key=lambda p: p.get(key, 0), reverse=True)
        top = processes[:limit]

        lines = [f"Top {limit} processes by {'memory' if sort_by == 'memory' else 'CPU'}:"]
        lines.append(f"{'PID':>8}  {'CPU%':>6}  {'MEM MB':>8}  {'MEM%':>5}  NAME")
        lines.append("-" * 55)
        for p in top:
            lines.append(
                f"{p['pid']:>8}  {p['cpu_percent']:>6.1f}  {p['memory_mb']:>8.1f}  "
                f"{p['memory_percent']:>4.1f}%  {p['name']}"
            )

        return ToolResult(output="\n".join(lines), metadata={"processes": top})

    except ImportError:
        try:
            if IS_WINDOWS:
                result = subprocess.run(
                    ["tasklist", "/FO", "TABLE", "/NH"],
                    capture_output=True, text=True, timeout=10,
                )
            else:
                sort_flag = "-%mem" if sort_by == "memory" else "-%cpu"
                result = subprocess.run(
                    ["ps", "aux", "--sort", sort_flag],
                    capture_output=True, text=True, timeout=10,
                )
            output = "\n".join(result.stdout.split("\n")[:limit + 1])
            return ToolResult(output=output)
        except Exception as e:
            return ToolResult(type=ToolResultType.ERROR, output=f"Top processes failed: {e}")
