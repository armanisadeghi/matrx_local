"""Network discovery tools — scan networks, find devices, discover services."""

from __future__ import annotations

import asyncio
import json
import logging
import platform
import re
import socket
import struct
import subprocess

from app.tools.session import ToolSession
from app.tools.types import ToolResult, ToolResultType

logger = logging.getLogger(__name__)

IS_WINDOWS = platform.system() == "Windows"
IS_MACOS = platform.system() == "Darwin"


async def tool_network_info(
    session: ToolSession,
) -> ToolResult:
    """Get network interface information: IPs, gateway, DNS, MAC addresses."""
    info: dict = {
        "hostname": socket.gethostname(),
        "interfaces": [],
    }

    try:
        import psutil
        addrs = psutil.net_if_addrs()
        stats = psutil.net_if_stats()

        for iface, addr_list in addrs.items():
            stat = stats.get(iface)
            iface_info = {
                "name": iface,
                "is_up": stat.isup if stat else False,
                "speed_mbps": stat.speed if stat else 0,
                "addresses": [],
            }
            for addr in addr_list:
                if addr.family == socket.AF_INET:
                    iface_info["addresses"].append({
                        "type": "IPv4",
                        "address": addr.address,
                        "netmask": addr.netmask,
                        "broadcast": addr.broadcast,
                    })
                elif addr.family == socket.AF_INET6:
                    iface_info["addresses"].append({
                        "type": "IPv6",
                        "address": addr.address,
                    })
                elif hasattr(socket, "AF_LINK") and addr.family == socket.AF_LINK:
                    iface_info["mac"] = addr.address
                elif addr.family == -1 or (hasattr(psutil, "AF_LINK") and addr.family == psutil.AF_LINK):
                    iface_info["mac"] = addr.address

            if iface_info["is_up"] or iface_info["addresses"]:
                info["interfaces"].append(iface_info)

    except ImportError:
        # Fallback without psutil
        try:
            if IS_WINDOWS:
                result = subprocess.run(
                    ["ipconfig", "/all"], capture_output=True, text=True, timeout=10
                )
                info["raw"] = result.stdout[:5000]
            else:
                result = subprocess.run(
                    ["ifconfig" if IS_MACOS else "ip", "addr"],
                    capture_output=True, text=True, timeout=10,
                )
                info["raw"] = result.stdout[:5000]
        except Exception:
            pass

    # Get default gateway
    try:
        if IS_WINDOWS:
            result = subprocess.run(
                ["ipconfig"], capture_output=True, text=True, timeout=10
            )
            for line in result.stdout.split("\n"):
                if "Default Gateway" in line:
                    match = re.search(r"(\d+\.\d+\.\d+\.\d+)", line)
                    if match:
                        info["gateway"] = match.group(1)
                        break
        elif IS_MACOS:
            result = subprocess.run(
                ["route", "get", "default"], capture_output=True, text=True, timeout=10
            )
            for line in result.stdout.split("\n"):
                if "gateway:" in line:
                    info["gateway"] = line.split("gateway:")[-1].strip()
                    break
        else:
            result = subprocess.run(
                ["ip", "route", "show", "default"], capture_output=True, text=True, timeout=10
            )
            parts = result.stdout.split()
            if "via" in parts:
                idx = parts.index("via")
                info["gateway"] = parts[idx + 1]
    except Exception:
        pass

    # Get DNS servers
    try:
        if not IS_WINDOWS:
            with open("/etc/resolv.conf") as f:
                dns_servers = []
                for line in f:
                    if line.strip().startswith("nameserver"):
                        dns_servers.append(line.split()[1])
                info["dns_servers"] = dns_servers
        else:
            result = subprocess.run(
                ["powershell", "-Command",
                 "Get-DnsClientServerAddress | Select-Object -ExpandProperty ServerAddresses | Select-Object -Unique"],
                capture_output=True, text=True, timeout=10,
            )
            info["dns_servers"] = [s.strip() for s in result.stdout.strip().split("\n") if s.strip()]
    except Exception:
        pass

    # Format output
    lines = [f"Hostname: {info['hostname']}"]
    if "gateway" in info:
        lines.append(f"Gateway: {info['gateway']}")
    if "dns_servers" in info:
        lines.append(f"DNS: {', '.join(info['dns_servers'])}")
    lines.append("")

    for iface in info.get("interfaces", []):
        status = "UP" if iface.get("is_up") else "DOWN"
        speed = f" ({iface['speed_mbps']}Mbps)" if iface.get("speed_mbps") else ""
        mac = f" MAC: {iface['mac']}" if iface.get("mac") else ""
        lines.append(f"{iface['name']}: {status}{speed}{mac}")
        for addr in iface.get("addresses", []):
            if addr["type"] == "IPv4":
                lines.append(f"  IPv4: {addr['address']}/{addr.get('netmask', '')}")
            elif addr["type"] == "IPv6":
                lines.append(f"  IPv6: {addr['address']}")

    if "raw" in info:
        lines.append("\n" + info["raw"])

    return ToolResult(output="\n".join(lines), metadata=info)


async def tool_network_scan(
    session: ToolSession,
    subnet: str | None = None,
    timeout: int = 10,
) -> ToolResult:
    """Scan local network for devices using ARP. Returns IP, MAC, and hostname when available.

    If subnet is not specified, auto-detects from the default interface.
    """
    # Auto-detect subnet
    if not subnet:
        try:
            if IS_MACOS:
                result = subprocess.run(
                    ["ifconfig"], capture_output=True, text=True, timeout=5,
                )
                # Find first non-loopback IPv4
                for match in re.finditer(r"inet (\d+\.\d+\.\d+\.\d+)", result.stdout):
                    ip = match.group(1)
                    if not ip.startswith("127."):
                        parts = ip.split(".")
                        subnet = f"{parts[0]}.{parts[1]}.{parts[2]}.0/24"
                        break
            elif IS_WINDOWS:
                result = subprocess.run(
                    ["ipconfig"], capture_output=True, text=True, timeout=5,
                )
                for match in re.finditer(r"IPv4.*?:\s*(\d+\.\d+\.\d+\.\d+)", result.stdout):
                    ip = match.group(1)
                    if not ip.startswith("127."):
                        parts = ip.split(".")
                        subnet = f"{parts[0]}.{parts[1]}.{parts[2]}.0/24"
                        break
            else:
                result = subprocess.run(
                    ["ip", "addr"], capture_output=True, text=True, timeout=5,
                )
                for match in re.finditer(r"inet (\d+\.\d+\.\d+\.\d+)/(\d+)", result.stdout):
                    ip = match.group(1)
                    if not ip.startswith("127."):
                        parts = ip.split(".")
                        subnet = f"{parts[0]}.{parts[1]}.{parts[2]}.0/24"
                        break
        except Exception:
            pass

    if not subnet:
        subnet = "192.168.1.0/24"

    devices = []

    # Method 1: ARP table scan
    try:
        if IS_WINDOWS:
            # Ping sweep then check ARP
            base = subnet.rsplit(".", 1)[0]
            # Quick parallel ping (Windows)
            proc = await asyncio.create_subprocess_shell(
                f'for /L %i in (1,1,254) do @start /b ping -n 1 -w 500 {base}.%i >nul 2>&1',
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                executable="cmd.exe",
            )
            try:
                await asyncio.wait_for(proc.communicate(), timeout=timeout)
            except asyncio.TimeoutError:
                proc.kill()

            result = subprocess.run(
                ["arp", "-a"], capture_output=True, text=True, timeout=10,
            )
        else:
            # Ping sweep (Unix)
            base = subnet.rsplit(".", 1)[0]
            ping_cmd = f"for i in $(seq 1 254); do ping -c 1 -W 1 {base}.$i >/dev/null 2>&1 & done; wait"
            proc = await asyncio.create_subprocess_shell(
                ping_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                await asyncio.wait_for(proc.communicate(), timeout=timeout)
            except asyncio.TimeoutError:
                proc.kill()

            result = subprocess.run(
                ["arp", "-a"], capture_output=True, text=True, timeout=10,
            )

        # Parse ARP output
        for line in result.stdout.split("\n"):
            # macOS/Linux: hostname (ip) at mac on iface
            match = re.search(r"[(\s](\d+\.\d+\.\d+\.\d+)[)\s].*?([\da-fA-F:.-]{11,17})", line)
            if match:
                ip = match.group(1)
                mac = match.group(2)
                if mac != "ff:ff:ff:ff:ff:ff" and mac != "(incomplete)":
                    hostname = _resolve_hostname(ip)
                    devices.append({
                        "ip": ip,
                        "mac": mac,
                        "hostname": hostname,
                    })

    except Exception as e:
        logger.warning("ARP scan error: %s", e)

    # Deduplicate by IP
    seen = set()
    unique_devices = []
    for d in devices:
        if d["ip"] not in seen:
            seen.add(d["ip"])
            unique_devices.append(d)

    lines = [f"Network scan of {subnet}: {len(unique_devices)} devices found"]
    lines.append(f"{'IP':<18} {'MAC':<20} {'HOSTNAME'}")
    lines.append("-" * 60)
    for d in sorted(unique_devices, key=lambda x: [int(p) for p in x["ip"].split(".")]):
        lines.append(f"{d['ip']:<18} {d['mac']:<20} {d['hostname']}")

    return ToolResult(
        output="\n".join(lines),
        metadata={"devices": unique_devices, "subnet": subnet},
    )


def _resolve_hostname(ip: str) -> str:
    """Try to resolve an IP to a hostname."""
    try:
        hostname, _, _ = socket.gethostbyaddr(ip)
        return hostname
    except (socket.herror, socket.gaierror, OSError):
        return ""


async def tool_port_scan(
    session: ToolSession,
    host: str,
    ports: str = "common",
    timeout_ms: int = 1000,
) -> ToolResult:
    """Scan ports on a host. Ports can be 'common', a range '1-1024', or comma-separated '80,443,8080'.

    This is for authorized security testing and network diagnostics only.
    """
    # Parse port list
    if ports == "common":
        port_list = [
            21, 22, 23, 25, 53, 80, 110, 135, 139, 143, 443, 445,
            993, 995, 1433, 1521, 3306, 3389, 5432, 5900, 6379,
            8000, 8080, 8443, 8888, 9090, 9200, 27017,
        ]
    elif "-" in ports:
        start, end = ports.split("-", 1)
        port_list = list(range(int(start), int(end) + 1))
        if len(port_list) > 10000:
            return ToolResult(type=ToolResultType.ERROR, output="Port range too large. Max 10000 ports.")
    else:
        port_list = [int(p.strip()) for p in ports.split(",")]

    timeout_s = timeout_ms / 1000.0
    open_ports = []

    async def _check_port(port: int) -> dict | None:
        try:
            _, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port),
                timeout=timeout_s,
            )
            writer.close()
            await writer.wait_closed()
            # Try to identify service
            service = _get_service_name(port)
            return {"port": port, "state": "open", "service": service}
        except (asyncio.TimeoutError, ConnectionRefusedError, OSError):
            return None

    # Scan in batches of 100 to avoid overwhelming
    batch_size = 100
    for i in range(0, len(port_list), batch_size):
        batch = port_list[i:i + batch_size]
        results = await asyncio.gather(*[_check_port(p) for p in batch])
        for result in results:
            if result:
                open_ports.append(result)

    lines = [f"Port scan of {host}: {len(open_ports)} open ports"]
    lines.append(f"{'PORT':>6}  {'STATE':<8}  SERVICE")
    lines.append("-" * 40)
    for p in sorted(open_ports, key=lambda x: x["port"]):
        lines.append(f"{p['port']:>6}  {p['state']:<8}  {p['service']}")

    return ToolResult(
        output="\n".join(lines),
        metadata={"host": host, "open_ports": open_ports},
    )


def _get_service_name(port: int) -> str:
    """Get common service name for a port."""
    services = {
        21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS",
        80: "HTTP", 110: "POP3", 135: "MSRPC", 139: "NetBIOS", 143: "IMAP",
        443: "HTTPS", 445: "SMB", 993: "IMAPS", 995: "POP3S",
        1433: "MSSQL", 1521: "Oracle", 3306: "MySQL", 3389: "RDP",
        5432: "PostgreSQL", 5900: "VNC", 6379: "Redis",
        8000: "HTTP-Alt", 8080: "HTTP-Proxy", 8443: "HTTPS-Alt",
        8888: "HTTP-Alt", 9090: "HTTP-Alt", 9200: "Elasticsearch",
        27017: "MongoDB",
    }
    return services.get(port, "unknown")


async def tool_mdns_discover(
    session: ToolSession,
    service_type: str | None = None,
    timeout: int = 5,
) -> ToolResult:
    """Discover mDNS/Bonjour services on the local network (smart devices, printers, etc.).

    Common service types: _http._tcp, _ipp._tcp (printers), _airplay._tcp,
    _googlecast._tcp, _hap._tcp (HomeKit), _smb._tcp, _ssh._tcp
    """
    try:
        from zeroconf import ServiceBrowser, Zeroconf, ServiceStateChange
        from zeroconf import ZeroconfServiceTypes

        zc = Zeroconf()
        found_services: list[dict] = []

        if service_type is None:
            # Discover all service types first
            service_types = list(await asyncio.get_event_loop().run_in_executor(
                None, lambda: ZeroconfServiceTypes.find(zc, timeout=timeout)
            ))

            for stype in service_types:
                found_services.append({"type": stype, "instances": []})

            zc.close()

            lines = [f"Discovered {len(service_types)} service types:"]
            for stype in sorted(service_types):
                lines.append(f"  {stype}")
            return ToolResult(
                output="\n".join(lines),
                metadata={"service_types": service_types},
            )
        else:
            # Discover instances of a specific service type
            if not service_type.endswith(".local."):
                if not service_type.endswith("."):
                    service_type += "."
                service_type += "local."

            discovered = []

            class Listener:
                def add_service(self, zc, type_, name):
                    info = zc.get_service_info(type_, name)
                    if info:
                        addresses = [socket.inet_ntoa(addr) for addr in info.addresses]
                        discovered.append({
                            "name": info.name,
                            "server": info.server,
                            "addresses": addresses,
                            "port": info.port,
                            "properties": {
                                k.decode() if isinstance(k, bytes) else k:
                                v.decode() if isinstance(v, bytes) else str(v)
                                for k, v in info.properties.items()
                            } if info.properties else {},
                        })

            browser = ServiceBrowser(zc, service_type, Listener())
            await asyncio.sleep(timeout)
            zc.close()

            lines = [f"Services of type {service_type}: {len(discovered)} found"]
            for svc in discovered:
                lines.append(f"\n  {svc['name']}")
                lines.append(f"    Server: {svc['server']}")
                lines.append(f"    Address: {', '.join(svc['addresses'])}:{svc['port']}")
                if svc['properties']:
                    for k, v in svc['properties'].items():
                        lines.append(f"    {k}: {v}")

            return ToolResult(
                output="\n".join(lines),
                metadata={"services": discovered},
            )

    except ImportError:
        # Fallback: use dns-sd or avahi-browse
        return await _mdns_fallback(service_type, timeout)

    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"mDNS discovery failed: {e}")


async def _mdns_fallback(service_type: str | None, timeout: int) -> ToolResult:
    """Fallback mDNS discovery using system tools."""
    try:
        if IS_MACOS:
            stype = service_type or "_http._tcp"
            if stype.endswith(".local."):
                stype = stype[:-7]
            if stype.endswith("."):
                stype = stype[:-1]

            proc = await asyncio.create_subprocess_exec(
                "dns-sd", "-B", stype, "local",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout + 2)
            except asyncio.TimeoutError:
                proc.kill()
                stdout, _ = await proc.communicate()

            return ToolResult(output=f"mDNS browse ({stype}):\n{stdout.decode()[:5000]}")

        else:
            proc = await asyncio.create_subprocess_exec(
                "avahi-browse", "-art",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout + 2)
            except asyncio.TimeoutError:
                proc.kill()
                stdout, _ = await proc.communicate()

            return ToolResult(output=f"mDNS browse:\n{stdout.decode()[:5000]}")

    except FileNotFoundError:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="Install 'zeroconf' for mDNS discovery: pip install zeroconf",
        )
