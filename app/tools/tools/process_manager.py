"""Process management tools — list, launch, kill, and focus applications."""

from __future__ import annotations

import asyncio
import logging
import os
import platform
import re
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
        ports = _list_ports_psutil(filter, limit)
        if ports is not None:
            return _format_ports_result(ports)
    except ImportError:
        pass

    # psutil unavailable or returned None (AccessDenied on macOS) — use OS commands
    return _list_ports_os_fallback(filter, limit)


def _list_ports_psutil(filter: str | None, limit: int) -> list[dict] | None:
    """Try to collect ports via psutil. Returns None if AccessDenied (macOS unprivileged)."""
    import psutil

    try:
        connections = psutil.net_connections(kind='all')
    except psutil.AccessDenied:
        return None
    except Exception:
        return None

    try:
        procs = {p.pid: p.info for p in psutil.process_iter(['pid', 'name', 'username'])}
    except Exception:
        procs = {}

    ports: list[dict] = []
    for conn in connections:
        # Keep TCP LISTEN and UDP (status == 'NONE' for UDP sockets)
        if conn.type == socket.SOCK_STREAM and conn.status != 'LISTEN':
            continue

        try:
            if not conn.laddr:
                continue
            pid = conn.pid or 0
            name = procs.get(pid, {}).get('name', 'unknown') if pid else 'System'
            user = procs.get(pid, {}).get('username', '') if pid else ''

            if filter:
                f = str(filter).lower()
                if f not in name.lower() and f not in str(conn.laddr.port):
                    continue

            protocol = (
                'TCP' if conn.type == socket.SOCK_STREAM
                else 'UDP' if conn.type == socket.SOCK_DGRAM
                else str(conn.type)
            )
            ports.append({
                'pid': pid,
                'name': name,
                'port': conn.laddr.port,
                'address': conn.laddr.ip,
                'protocol': protocol,
                'user': user,
            })
        except Exception:
            continue

    ports.sort(key=lambda p: p['port'])
    return ports[:limit]


def _list_ports_os_fallback(filter: str | None, limit: int) -> ToolResult:
    """Collect ports using OS-native commands when psutil is unavailable or access-denied."""
    try:
        if IS_WINDOWS:
            return _list_ports_windows(filter, limit)
        elif IS_MACOS:
            return _list_ports_lsof(filter, limit)
        else:
            # Linux: try ss first (always available), fall back to lsof
            result = _list_ports_ss(filter, limit)
            if result is not None:
                return _format_ports_result(result)
            return _list_ports_lsof(filter, limit)
    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Failed to list ports: {e}")


def _list_ports_lsof(filter: str | None, limit: int) -> ToolResult:
    """macOS / Linux: parse lsof -F (field-based, unambiguous output)."""
    # Use absolute path so it works even when /usr/sbin is not in Tauri sidecar's PATH
    lsof_bin = '/usr/sbin/lsof' if IS_MACOS else 'lsof'
    try:
        result = subprocess.run(
            [lsof_bin, '-iTCP', '-iUDP', '-sTCP:LISTEN', '-P', '-n', '-F', 'pcPun'],
            capture_output=True, text=True, timeout=15,
        )
    except FileNotFoundError:
        # Try plain lsof in PATH as a last resort
        try:
            result = subprocess.run(
                ['lsof', '-iTCP', '-iUDP', '-sTCP:LISTEN', '-P', '-n', '-F', 'pcPun'],
                capture_output=True, text=True, timeout=15,
            )
        except FileNotFoundError:
            return ToolResult(
                type=ToolResultType.ERROR,
                output='lsof not found. Cannot list ports without psutil or lsof.',
            )

    # -F output fields: p=PID, c=command, P=protocol, u=UID, n=name(address)
    # Records are separated by process (p-line) and file (f-line).
    # Each process block: p<pid>\nc<cmd>\nu<uid>\nf<fd>\nP<proto>\nn<addr>\n...
    ports: list[dict] = []
    cur_pid = 0
    cur_name = 'unknown'
    cur_user = ''
    cur_proto = ''

    for line in result.stdout.splitlines():
        if not line:
            continue
        field, value = line[0], line[1:]
        if field == 'p':
            try:
                cur_pid = int(value)
            except ValueError:
                cur_pid = 0
        elif field == 'c':
            cur_name = value
        elif field == 'u':
            cur_user = value
        elif field == 'P':
            cur_proto = value  # TCP or UDP
        elif field == 'n':
            # value is the address, e.g. "*:8080", "127.0.0.1:22140", "*:*"
            # Skip wildcard-port UDP entries (*:*)
            if value == '*:*':
                continue
            # Skip connection entries (contain "->")
            if '->' in value:
                continue
            try:
                port_str = value.rsplit(':', 1)[-1]
                if port_str == '*':
                    continue
                port = int(port_str)
                ip = value.rsplit(':', 1)[0]
                # Strip brackets from IPv6 address display
                if ip.startswith('[') and ip.endswith(']'):
                    ip = ip[1:-1]
                elif ip == '*':
                    ip = '0.0.0.0'

                if filter:
                    f = str(filter).lower()
                    if f not in cur_name.lower() and f not in str(port):
                        continue

                ports.append({
                    'pid': cur_pid,
                    'name': cur_name,
                    'port': port,
                    'address': ip,
                    'protocol': cur_proto or 'TCP',
                    'user': cur_user,
                })
            except (ValueError, IndexError):
                continue

    # Deduplicate on (port, protocol, pid) — lsof lists IPv4+IPv6 separately
    seen: set[tuple] = set()
    unique: list[dict] = []
    for p in ports:
        key = (p['port'], p['protocol'], p['pid'])
        if key not in seen:
            seen.add(key)
            unique.append(p)

    unique.sort(key=lambda p: p['port'])
    return _format_ports_result(unique[:limit])


def _list_ports_ss(filter: str | None, limit: int) -> list[dict] | None:
    """Linux: parse `ss -tlnup` for listening sockets with PID info."""
    try:
        result = subprocess.run(
            ['ss', '-tlnup'],
            capture_output=True, text=True, timeout=10,
        )
    except FileNotFoundError:
        return None

    ports: list[dict] = []
    for line in result.stdout.splitlines()[1:]:  # skip header
        if not line.strip():
            continue
        parts = line.split()
        # ss -tlnup columns: Netid State Recv-Q Send-Q Local-Address:Port Peer-Address:Port Process
        # e.g.: tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=1234,fd=3))
        if len(parts) < 5:
            continue
        netid = parts[0].upper()  # tcp/udp
        local_addr = parts[4]

        try:
            # Handle IPv6 like [::]:8080 and plain 0.0.0.0:8080
            if local_addr.startswith('['):
                bracket_end = local_addr.index(']')
                ip = local_addr[1:bracket_end]
                port = int(local_addr[bracket_end + 2:])
            else:
                ip, port_str = local_addr.rsplit(':', 1)
                port = int(port_str)
        except (ValueError, IndexError):
            continue

        pid = 0
        name = 'unknown'
        user = ''
        # Parse process info: users:(("name",pid=NNN,fd=N))
        if len(parts) >= 7:
            proc_field = parts[6] if len(parts) > 6 else parts[-1]
            try:
                m = re.search(r'"([^"]+)",pid=(\d+)', proc_field)
                if m:
                    name = m.group(1)
                    pid = int(m.group(2))
            except Exception:
                pass

        if filter:
            f = str(filter).lower()
            if f not in name.lower() and f not in str(port):
                continue

        ports.append({
            'pid': pid,
            'name': name,
            'port': port,
            'address': ip,
            'protocol': netid,
            'user': user,
        })

    ports.sort(key=lambda p: p['port'])
    return ports[:limit]


def _list_ports_windows(filter: str | None, limit: int) -> ToolResult:
    """Windows: parse netstat -ano + tasklist for PID→name mapping."""
    try:
        netstat = subprocess.run(
            ['netstat', '-ano'],
            capture_output=True, text=True, timeout=15,
        )
        tasks = subprocess.run(
            ['tasklist', '/FO', 'CSV', '/NH'],
            capture_output=True, text=True, timeout=15,
        )
    except FileNotFoundError as e:
        return ToolResult(type=ToolResultType.ERROR, output=f'Windows command not found: {e}')

    pid_to_name: dict[str, str] = {}
    for line in tasks.stdout.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        # CSV: "name.exe","PID","session","session#","mem"
        parts = line.split('","')
        if len(parts) >= 2:
            pname = parts[0].strip('"')
            ppid = parts[1].strip('"')
            pid_to_name[ppid] = pname

    ports: list[dict] = []
    for line in netstat.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        upper = line.upper()
        if 'LISTENING' not in upper and not (upper.startswith('UDP') and '*:*' not in line):
            continue

        parts = line.split()
        if len(parts) < 4:
            continue

        proto = parts[0].upper()
        laddr = parts[1]
        pid_str = parts[-1]

        try:
            # Handle IPv6 addresses like [::1]:8080
            if laddr.startswith('['):
                bracket_end = laddr.index(']')
                ip = laddr[1:bracket_end]
                port = int(laddr[bracket_end + 2:])
            else:
                ip, port_str = laddr.rsplit(':', 1)
                port = int(port_str)
            pid = int(pid_str)
            name = pid_to_name.get(pid_str, 'unknown')

            if filter:
                f = str(filter).lower()
                if f not in name.lower() and f not in str(port):
                    continue

            ports.append({
                'pid': pid,
                'name': name,
                'port': port,
                'address': ip,
                'protocol': proto,
                'user': '',
            })
        except (ValueError, IndexError):
            continue

    # Deduplicate
    seen: set[tuple] = set()
    unique: list[dict] = []
    for p in ports:
        key = (p['port'], p['protocol'], p['pid'])
        if key not in seen:
            seen.add(key)
            unique.append(p)

    unique.sort(key=lambda p: p['port'])
    return _format_ports_result(unique[:limit])


def _format_ports_result(ports: list[dict]) -> ToolResult:
    lines = [f"{'PORT':>6}  {'PROTO':<5}  {'PID':>8}  NAME"]
    lines.append('-' * 50)
    for p in ports:
        lines.append(f"{p['port']:>6}  {p['protocol']:<5}  {p['pid']:>8}  {p['name']}")

    return ToolResult(
        output=f'Listening ports ({len(ports)} shown):\n' + '\n'.join(lines),
        metadata={'ports': ports, 'count': len(ports)},
    )


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
