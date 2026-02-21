"""Process management tools — list, launch, kill, and focus applications."""

from __future__ import annotations

import asyncio
import logging
import os
import platform
import signal
import socket
import subprocess
from pathlib import Path

from app.tools.session import ToolSession
from app.tools.types import ToolResult, ToolResultType

logger = logging.getLogger(__name__)

IS_WINDOWS = platform.system() == "Windows"
IS_MACOS = platform.system() == "Darwin"


async def tool_list_processes(
    session: ToolSession,
    filter: str | None = None,
    sort_by: str = "cpu",
    limit: int = 50,
) -> ToolResult:
    """List running processes with PID, name, CPU%, memory usage."""
    try:
        import psutil
    except ImportError:
        return _list_processes_fallback(filter, sort_by, limit)

    processes = []
    for proc in psutil.process_iter(["pid", "name", "cpu_percent", "memory_info", "status", "username"]):
        try:
            info = proc.info
            name = info.get("name", "")
            if filter is not None and str(filter).lower() not in str(name).lower():
                continue
            mem = info.get("memory_info")
            processes.append({
                "pid": info["pid"],
                "name": name,
                "cpu_percent": info.get("cpu_percent", 0.0) or 0.0,
                "memory_mb": round(mem.rss / (1024 * 1024), 1) if mem else 0,
                "status": info.get("status", "unknown"),
                "user": info.get("username", ""),
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    sort_key = "memory_mb" if sort_by == "memory" else "cpu_percent"
    processes.sort(key=lambda p: p.get(sort_key, 0), reverse=True)
    processes = processes[:limit]  # type: ignore

    lines: list[str] = [f"{'PID':>8}  {'CPU%':>6}  {'MEM MB':>8}  {'STATUS':>10}  NAME"]
    lines.append("-" * 70)
    for p in processes:
        lines.append(
            f"{p['pid']:>8}  {p['cpu_percent']:>6.1f}  {p['memory_mb']:>8.1f}  {p['status']:>10}  {p['name']}"
        )

    return ToolResult(
        output=f"Running processes ({len(processes)} shown):\n" + "\n".join(lines),
        metadata={"processes": processes, "count": len(processes)},
    )


def _list_processes_fallback(filter: str | None, sort_by: str, limit: int) -> ToolResult:
    """Fallback using subprocess when psutil is not available."""
    try:
        if IS_WINDOWS:
            result = subprocess.run(
                ["tasklist", "/FO", "CSV", "/NH"],
                capture_output=True, text=True, timeout=10,
            )
        else:
            result = subprocess.run(
                ["ps", "aux", "--sort", f"-{'%mem' if sort_by == 'memory' else '%cpu'}"],
                capture_output=True, text=True, timeout=10,
            )
        output = result.stdout
        if filter:
            lines = output.split("\n")
            header = lines[0] if not IS_WINDOWS else ""
            filtered = [l for l in lines if filter.lower() in l.lower()]
            output = (header + "\n" if header else "") + "\n".join(filtered[:limit])  # type: ignore
        return ToolResult(output=output.strip())
    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Failed to list processes: {e}")


async def tool_list_ports(
    session: ToolSession,
    filter: str | None = None,
    limit: int = 100,
) -> ToolResult:
    """List listening ports and their associated processes.
    
    Provides PID, process name, local address (IP:Port), and protocol.
    Filters by process name or port number if requested.
    """
    try:
        import psutil
    except ImportError:
        return _list_ports_fallback(filter, limit)

    ports = []
    try:
        # Require root/admin for full listing on some OSes, but get what we can
        connections = psutil.net_connections(kind='all')
    except psutil.AccessDenied:
        # net_connections requires privileges on macOS, fallback to lsof
        return _list_ports_fallback(filter, limit)
    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Failed to get connections: {e}")

    # Process dict for quick lookup
    try:
        procs = {p.pid: p.info for p in psutil.process_iter(['pid', 'name', 'username'])}
    except Exception:
        procs = {}

    for conn in connections:
        if conn.status != 'LISTEN' and conn.status != 'NONE':
            # Keep LISTEN for TCP, NONE for UDP
            if conn.type == socket.SOCK_STREAM and conn.status != 'LISTEN':
                continue

        try:
            pid = conn.pid
            name = procs.get(pid, {}).get('name', 'unknown') if pid else "System"
            user = procs.get(pid, {}).get('username', '') if pid else ""
            
            # Format local address
            laddr = f"{conn.laddr.ip}:{conn.laddr.port}" if conn.laddr else ""
            if not laddr:
                continue

            if filter:
                if str(filter).lower() not in str(name).lower() and str(filter) not in str(conn.laddr.port):
                    continue

            protocol = "TCP" if conn.type == socket.SOCK_STREAM else "UDP" if conn.type == socket.SOCK_DGRAM else str(conn.type)

            ports.append({
                "pid": pid or 0,
                "name": name,
                "port": conn.laddr.port,
                "address": conn.laddr.ip,
                "protocol": protocol,
                "user": user,
            })
        except Exception:
            continue

    # Sort by port number
    ports.sort(key=lambda p: p['port'])
    ports = ports[:limit]  # type: ignore

    lines = [f"{'PORT':>6}  {'PROTO':<5}  {'PID':>8}  NAME"]
    lines.append("-" * 50)
    for p in ports:
        lines.append(f"{p['port']:>6}  {p['protocol']:<5}  {p['pid']:>8}  {p['name']}")

    return ToolResult(
        output=f"Listening ports ({len(ports)} shown):\n" + "\n".join(lines),
        metadata={"ports": ports, "count": len(ports)},
    )


def _list_ports_fallback(filter: str | None, limit: int) -> ToolResult:
    """Fallback using netstat (Windows) or lsof (macOS/Linux) when psutil is not available or lacks permissions."""
    ports = []
    try:
        if IS_WINDOWS:
            result = subprocess.run(
                ["netstat", "-ano"],
                capture_output=True, text=True, timeout=10,
            )
            # Find tasklist to map PID to name
            tasks = subprocess.run(
                ["tasklist", "/FO", "CSV", "/NH"],
                capture_output=True, text=True, timeout=10,
            )
            pid_to_name = {}
            for line in tasks.stdout.strip().split('\n'):
                if line:
                    parts = line.split('","')
                    if len(parts) >= 2:
                        name = parts[0].strip('"')
                        pid = parts[1].strip('"')
                        pid_to_name[pid] = name

            for line in result.stdout.split("\n"):
                if "LISTENING" in line or ("UDP" in line and "*:*" in line):
                    parts = line.split()
                    if len(parts) >= 4:
                        proto = parts[0]
                        laddr = parts[1]
                        pid_str = parts[-1]
                        
                        try:
                            port = int(laddr.split(':')[-1])
                            pid = int(pid_str)
                            name = pid_to_name.get(pid_str, "unknown")
                            
                            if filter and str(filter).lower() not in str(name).lower() and str(filter) not in str(port):
                                continue

                            ports.append({
                                "pid": pid,
                                "name": name,
                                "port": port,
                                "address": laddr.rsplit(':', 1)[0],
                                "protocol": proto,
                                "user": "",
                            })
                        except ValueError:
                            continue

        else:
            # macOS / Linux
            result = subprocess.run(
                ["lsof", "-i", "-P", "-n"],
                capture_output=True, text=True, timeout=10,
            )
            # lsof output: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
            # e.g.: python3 1234 armani 3u IPv4 0x123 0t0 TCP *:8080 (LISTEN)
            lines = result.stdout.split("\n")[1:]  # skip header
            for line in lines:
                if not line.strip(): continue
                if "LISTEN" not in line and "UDP" not in line: continue
                
                parts = line.split()
                if len(parts) >= 9:
                    name = parts[0]
                    try:
                        pid = int(parts[1])
                    except ValueError:
                        pid = 0
                    user = parts[2]
                    proto = parts[7]
                    addr_str = parts[8]  # e.g. *:8080 or 127.0.0.1:8080
                    
                    try:
                        port_str = addr_str.split(':')[-1]
                        if port_str == '*':
                            continue
                        port = int(port_str)
                        ip = addr_str.rsplit(':', 1)[0]
                        
                        if filter and str(filter).lower() not in str(name).lower() and str(filter) not in str(port):
                            continue
                            
                        ports.append({
                            "pid": pid,
                            "name": name,
                            "port": port,
                            "address": ip,
                            "protocol": proto,
                            "user": user,
                        })
                    except ValueError:
                        continue

        # Deduplicate based on port + protocol + pid
        seen = set()
        unique_ports = []
        for p in ports:
            key = (p['port'], p['protocol'], p['pid'])
            if key not in seen:
                seen.add(key)
                unique_ports.append(p)

        unique_ports.sort(key=lambda p: p['port'])
        unique_ports = unique_ports[:limit]  # type: ignore

        lines = [f"{'PORT':>6}  {'PROTO':<5}  {'PID':>8}  NAME"]
        lines.append("-" * 50)
        for p in unique_ports:
            lines.append(f"{p['port']:>6}  {p['protocol']:<5}  {p['pid']:>8}  {p['name']}")

        return ToolResult(
            output=f"Listening ports ({len(unique_ports)} shown):\n" + "\n".join(lines),
            metadata={"ports": unique_ports, "count": len(unique_ports)},
        )
    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Failed to list ports fallback: {e}")


async def tool_launch_app(
    session: ToolSession,
    application: str,
    args: list[str] | None = None,
    wait: bool = False,
    timeout: int = 30,
) -> ToolResult:
    """Launch an application by name or path.

    On macOS: can use app name (e.g., 'Safari') or full path.
    On Windows: can use executable name or full path.
    On Linux: uses the command name.
    """
    args = args or []

    try:
        if IS_MACOS:
            if not application.startswith("/") and not application.endswith(".app"):
                # Try to open by app name via `open -a`
                cmd = ["open", "-a", application] + (["--args"] + args if args else [])
            elif application.endswith(".app"):
                cmd = ["open", "-a", application] + (["--args"] + args if args else [])
            else:
                cmd = [application] + args
        elif IS_WINDOWS:
            cmd = ["start", "", application] + args
        else:
            cmd = [application] + args

        if wait:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
                output = stdout.decode("utf-8", errors="replace")
                if proc.returncode != 0:
                    err = stderr.decode("utf-8", errors="replace")
                    return ToolResult(
                        type=ToolResultType.ERROR,
                        output=f"App exited with code {proc.returncode}: {err or output}",
                    )
                return ToolResult(output=f"App completed: {output}" if output.strip() else "App completed.")
            except asyncio.TimeoutError:
                proc.kill()
                return ToolResult(output=f"App launched but timed out after {timeout}s.")
        else:
            if IS_MACOS and cmd[0] == "open":
                subprocess.Popen(cmd)
            elif IS_WINDOWS:
                subprocess.Popen(cmd, shell=True)
            else:
                subprocess.Popen(cmd, start_new_session=True)
            return ToolResult(output=f"Launched: {application}")

    except FileNotFoundError:
        return ToolResult(
            type=ToolResultType.ERROR,
            output=f"Application not found: {application}",
        )
    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Failed to launch app: {e}")


async def tool_kill_process(
    session: ToolSession,
    pid: int | None = None,
    name: str | None = None,
    force: bool = False,
) -> ToolResult:
    """Kill a process by PID or name."""
    if pid is None and name is None:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="Must provide either 'pid' or 'name'.",
        )

    killed = []
    errors = []

    if pid is not None:
        try:
            sig = signal.SIGKILL if force else signal.SIGTERM
            if IS_WINDOWS:
                subprocess.run(
                    ["taskkill", "/PID", str(pid)] + (["/F"] if force else []),
                    capture_output=True, timeout=10,
                )
            else:
                os.kill(pid, sig)
            killed.append(f"PID {pid}")
        except ProcessLookupError:
            errors.append(f"PID {pid}: process not found")
        except PermissionError:
            errors.append(f"PID {pid}: permission denied")
        except Exception as e:
            errors.append(f"PID {pid}: {e}")

    if name is not None:
        try:
            import psutil
            for proc in psutil.process_iter(["pid", "name"]):
                try:
                    if proc.info["name"] and name.lower() in proc.info["name"].lower():
                        if force:
                            proc.kill()
                        else:
                            proc.terminate()
                        killed.append(f"{proc.info['name']} (PID {proc.info['pid']})")
                except (psutil.NoSuchProcess, psutil.AccessDenied) as e:
                    errors.append(f"{name}: {e}")
        except ImportError:
            # Fallback without psutil
            try:
                if IS_WINDOWS:
                    subprocess.run(
                        ["taskkill", "/IM", name] + (["/F"] if force else []),
                        capture_output=True, timeout=10,
                    )
                else:
                    subprocess.run(
                        ["pkill"] + (["-9"] if force else []) + [name],
                        capture_output=True, timeout=10,
                    )
                killed.append(name)
            except Exception as e:
                errors.append(f"Kill by name failed: {e}")

    parts = []
    if killed:
        parts.append(f"Killed: {', '.join(killed)}")
    if errors:
        parts.append(f"Errors: {'; '.join(errors)}")

    if not killed and errors:
        return ToolResult(type=ToolResultType.ERROR, output="\n".join(parts))

    return ToolResult(output="\n".join(parts))


async def tool_focus_app(
    session: ToolSession,
    application: str,
) -> ToolResult:
    """Bring an application window to the foreground.

    On macOS uses AppleScript, on Windows uses PowerShell.
    """
    try:
        if IS_MACOS:
            script = f'tell application "{application}" to activate'
            proc = await asyncio.create_subprocess_exec(
                "osascript", "-e", script,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
            if proc.returncode != 0:
                return ToolResult(
                    type=ToolResultType.ERROR,
                    output=f"Failed to focus {application}: {stderr.decode()}",
                )
            return ToolResult(output=f"Focused: {application}")

        elif IS_WINDOWS:
            ps_script = f"""
$proc = Get-Process -Name '{application}' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($proc) {{
    $sig = Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);' -Name Win32 -Namespace Native -PassThru
    $sig::SetForegroundWindow($proc.MainWindowHandle)
    "Focused: {application}"
}} else {{
    "Process not found: {application}"
}}
"""
            proc = await asyncio.create_subprocess_exec(
                "powershell.exe", "-Command", ps_script,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
            output = stdout.decode().strip()
            if "not found" in output:
                return ToolResult(type=ToolResultType.ERROR, output=output)
            return ToolResult(output=output)

        else:
            # Linux: try wmctrl
            proc = await asyncio.create_subprocess_exec(
                "wmctrl", "-a", application,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
            if proc.returncode != 0:
                return ToolResult(
                    type=ToolResultType.ERROR,
                    output=f"Failed to focus (wmctrl required on Linux): {stderr.decode()}",
                )
            return ToolResult(output=f"Focused: {application}")

    except FileNotFoundError as e:
        return ToolResult(
            type=ToolResultType.ERROR,
            output=f"Required tool not found: {e}",
        )
    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Failed to focus app: {e}")
