"""WiFi and Bluetooth discovery tools — scan networks, find devices."""

from __future__ import annotations

import asyncio
import json
import logging
import platform
import re
import subprocess

from app.tools.session import ToolSession
from app.tools.types import ToolResult, ToolResultType

logger = logging.getLogger(__name__)

IS_WINDOWS = platform.system() == "Windows"
IS_MACOS = platform.system() == "Darwin"


async def tool_wifi_networks(
    session: ToolSession,
    rescan: bool = False,
) -> ToolResult:
    """List available WiFi networks with signal strength, security, and channel."""
    try:
        if IS_MACOS:
            return await _wifi_macos(rescan)
        elif IS_WINDOWS:
            return await _wifi_windows(rescan)
        else:
            return await _wifi_linux(rescan)
    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"WiFi scan failed: {e}")


async def _wifi_macos(rescan: bool) -> ToolResult:
    # Try airport binary (works on macOS ≤ 12, may need root on 13+)
    airport = "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport"

    try:
        proc = await asyncio.create_subprocess_exec(
            airport, "-s",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=15)

        if proc.returncode == 0:
            output = stdout.decode()
            lines = output.strip().split("\n")
            if len(lines) >= 2:
                bssid_pattern = re.compile(r'([0-9a-f]{2}:){5}[0-9a-f]{2}', re.IGNORECASE)
                networks = []
                for line in lines[1:]:
                    match = bssid_pattern.search(line)
                    if match:
                        bssid_start = match.start()
                        ssid = line[:bssid_start].strip()
                        rest = line[match.end():].strip().split()
                        if len(rest) >= 4:
                            networks.append({
                                "ssid": ssid,
                                "bssid": match.group(0),
                                "rssi": int(rest[0]) if rest[0].lstrip("-").isdigit() else 0,
                                "channel": rest[1],
                                "security": " ".join(rest[3:]),
                            })

                if networks:
                    networks.sort(key=lambda n: n.get("rssi", -100), reverse=True)
                    result_lines = [f"WiFi networks ({len(networks)} found):"]
                    result_lines.append(f"{'SSID':<30} {'RSSI':>5} {'CH':>4}  SECURITY")
                    result_lines.append("-" * 70)
                    for n in networks:
                        signal = _rssi_to_bars(n["rssi"])
                        result_lines.append(
                            f"{n['ssid']:<30} {n['rssi']:>4}dBm {n['channel']:>4}  {n['security']} {signal}"
                        )
                    return ToolResult(
                        output="\n".join(result_lines),
                        metadata={"networks": networks, "count": len(networks)},
                    )

    except (FileNotFoundError, asyncio.TimeoutError):
        pass

    # Fallback: system_profiler (always available, parses JSON)
    try:
        proc = await asyncio.create_subprocess_exec(
            "system_profiler", "SPAirPortDataType", "-json",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=20)
        data = json.loads(stdout.decode())

        networks = []
        seen_current = None

        for iface_group in data.get("SPAirPortDataType", []):
            for iface in iface_group.get("spairport_airport_interfaces", []):
                # Current network
                cur = iface.get("spairport_current_network_information")
                if cur:
                    seen_current = cur.get("_name", "")
                    rssi_raw = cur.get("spairport_signal_noise", "")
                    cur_rssi = 0
                    if rssi_raw:
                        try:
                            cur_rssi = int(str(rssi_raw).split()[0])
                        except (ValueError, IndexError):
                            pass
                    networks.append({
                        "ssid": seen_current,
                        "rssi": cur_rssi,
                        "channel": str(cur.get("spairport_network_channel", "")),
                        "security": cur.get("spairport_security_mode", ""),
                        "connected": True,
                    })

                # Other nearby networks
                for net in iface.get("spairport_other_local_wireless_networks", []):
                    ssid = net.get("_name", "")
                    if ssid == seen_current:
                        continue
                    rssi_raw = net.get("spairport_signal_noise", "")
                    rssi = 0
                    if rssi_raw:
                        try:
                            rssi = int(str(rssi_raw).split()[0])
                        except (ValueError, IndexError):
                            pass
                    networks.append({
                        "ssid": ssid,
                        "rssi": rssi,
                        "channel": str(net.get("spairport_network_channel", "")),
                        "security": net.get("spairport_security_mode", ""),
                        "connected": False,
                    })

        if not networks:
            return ToolResult(output="No WiFi data available. Check that WiFi is enabled.")

        # Clean up security names
        _sec_labels = {
            "spairport_security_mode_wpa3_transition": "WPA3/WPA2",
            "spairport_security_mode_wpa3_personal": "WPA3",
            "spairport_security_mode_wpa2_personal": "WPA2",
            "spairport_security_mode_wpa_personal": "WPA",
            "spairport_security_mode_none": "Open",
            "spairport_security_mode_wpa2_enterprise": "WPA2-Ent",
        }
        for n in networks:
            raw_sec = n.get("security", "")
            n["security"] = _sec_labels.get(raw_sec, raw_sec.replace("spairport_security_mode_", "").replace("_", "-"))
            if not n["ssid"]:
                n["ssid"] = "(hidden network)"

        networks.sort(key=lambda n: (not n.get("connected", False), -(n.get("rssi") or 0)))
        result_lines = [f"WiFi networks ({len(networks)} found, via system_profiler):"]
        result_lines.append(f"{'SSID':<32} {'RSSI':>7}  {'CH':<6} SECURITY")
        result_lines.append("-" * 70)
        for n in networks:
            connected_mark = " ◀ connected" if n.get("connected") else ""
            signal = _rssi_to_bars(n.get("rssi") or 0)
            result_lines.append(
                f"{n['ssid']:<32} {str(n.get('rssi','?')):>7}  {n.get('channel','?'):<6} {n.get('security','')}{connected_mark} {signal}"
            )
        return ToolResult(
            output="\n".join(result_lines),
            metadata={"networks": networks, "count": len(networks)},
        )

    except Exception as e:
        return ToolResult(
            type=ToolResultType.ERROR,
            output=f"WiFi scan failed: {e}\nTip: WiFi must be enabled and the system_profiler command must be accessible.",
        )


async def _wifi_windows(rescan: bool) -> ToolResult:
    if rescan:
        # Trigger a new scan
        proc = await asyncio.create_subprocess_exec(
            "netsh", "wlan", "scan",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await asyncio.wait_for(proc.communicate(), timeout=10)
        await asyncio.sleep(3)  # Wait for scan

    proc = await asyncio.create_subprocess_exec(
        "netsh", "wlan", "show", "networks", "mode=bssid",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
    output = stdout.decode()

    networks = []
    current: dict = {}

    for line in output.split("\n"):
        line = line.strip()
        if line.startswith("SSID") and "BSSID" not in line:
            if current:
                networks.append(current)
            ssid = line.split(":", 1)[1].strip() if ":" in line else ""
            current = {"ssid": ssid}
        elif "Signal" in line:
            val = line.split(":", 1)[1].strip().replace("%", "")
            current["signal_percent"] = int(val) if val.isdigit() else 0
        elif "Authentication" in line:
            current["security"] = line.split(":", 1)[1].strip()
        elif "Channel" in line:
            current["channel"] = line.split(":", 1)[1].strip()
        elif "BSSID" in line:
            current["bssid"] = line.split(":", 1)[1].strip()

    if current and "ssid" in current:
        networks.append(current)

    networks.sort(key=lambda n: n.get("signal_percent", 0), reverse=True)

    result_lines = [f"WiFi networks ({len(networks)} found):"]
    result_lines.append(f"{'SSID':<30} {'SIGNAL':>7} {'CH':>4}  SECURITY")
    result_lines.append("-" * 65)
    for n in networks:
        sig = n.get("signal_percent", 0)
        result_lines.append(
            f"{n['ssid']:<30} {sig:>5}% {n.get('channel', '?'):>4}  {n.get('security', '?')}"
        )

    return ToolResult(
        output="\n".join(result_lines),
        metadata={"networks": networks, "count": len(networks)},
    )


async def _wifi_linux(rescan: bool) -> ToolResult:
    if rescan:
        proc = await asyncio.create_subprocess_exec(
            "nmcli", "device", "wifi", "rescan",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await asyncio.wait_for(proc.communicate(), timeout=10)
        await asyncio.sleep(2)

    proc = await asyncio.create_subprocess_exec(
        "nmcli", "-t", "-f", "SSID,BSSID,SIGNAL,CHAN,SECURITY", "device", "wifi", "list",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)

    if proc.returncode != 0:
        # Fallback to iwlist
        try:
            proc2 = await asyncio.create_subprocess_exec(
                "iwlist", "scanning",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout2, _ = await asyncio.wait_for(proc2.communicate(), timeout=10)
            return ToolResult(output=f"WiFi scan:\n{stdout2.decode()[:5000]}")
        except FileNotFoundError:
            return ToolResult(
                type=ToolResultType.ERROR,
                output=f"nmcli error: {stderr.decode()}. Install NetworkManager or wireless-tools.",
            )

    networks = []
    for line in stdout.decode().strip().split("\n"):
        parts = line.split(":")
        if len(parts) >= 5:
            networks.append({
                "ssid": parts[0],
                "bssid": parts[1],
                "signal_percent": int(parts[2]) if parts[2].isdigit() else 0,
                "channel": parts[3],
                "security": parts[4],
            })

    networks.sort(key=lambda n: n.get("signal_percent", 0), reverse=True)

    result_lines = [f"WiFi networks ({len(networks)} found):"]
    result_lines.append(f"{'SSID':<30} {'SIGNAL':>7} {'CH':>4}  SECURITY")
    result_lines.append("-" * 65)
    for n in networks:
        result_lines.append(
            f"{n['ssid']:<30} {n['signal_percent']:>5}% {n['channel']:>4}  {n['security']}"
        )

    return ToolResult(
        output="\n".join(result_lines),
        metadata={"networks": networks, "count": len(networks)},
    )


def _rssi_to_bars(rssi: int) -> str:
    """Convert RSSI to signal bars."""
    if rssi >= -50:
        return "||||"
    elif rssi >= -60:
        return "|||."
    elif rssi >= -70:
        return "||.."
    elif rssi >= -80:
        return "|..."
    else:
        return "...."


async def tool_bluetooth_devices(
    session: ToolSession,
    scan_duration: int = 5,
) -> ToolResult:
    """List paired and nearby Bluetooth devices."""
    try:
        if IS_MACOS:
            return await _bluetooth_macos()
        elif IS_WINDOWS:
            return await _bluetooth_windows()
        else:
            return await _bluetooth_linux(scan_duration)
    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Bluetooth scan failed: {e}")


async def _bluetooth_macos() -> ToolResult:
    """List Bluetooth devices on macOS using system_profiler."""
    proc = await asyncio.create_subprocess_exec(
        "system_profiler", "SPBluetoothDataType", "-json",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=15)

    try:
        data = json.loads(stdout.decode())
        bt_data = data.get("SPBluetoothDataType", [{}])[0]

        devices = []

        # Connected devices
        for section_key in ["device_connected", "device_not_connected"]:
            section = bt_data.get(section_key, [])
            if isinstance(section, list):
                for item in section:
                    if isinstance(item, dict):
                        for name, info in item.items():
                            devices.append({
                                "name": name,
                                "address": info.get("device_address", ""),
                                "type": info.get("device_minorType", ""),
                                "connected": section_key == "device_connected",
                                "battery": info.get("device_batteryLevelMain", ""),
                            })

        lines = [f"Bluetooth devices ({len(devices)} found):"]
        lines.append(f"{'NAME':<30} {'TYPE':<15} {'STATUS':<12} BATTERY")
        lines.append("-" * 70)
        for d in devices:
            status = "Connected" if d["connected"] else "Paired"
            battery = f"{d['battery']}%" if d["battery"] else ""
            lines.append(f"{d['name']:<30} {d['type']:<15} {status:<12} {battery}")

        return ToolResult(
            output="\n".join(lines),
            metadata={"devices": devices, "count": len(devices)},
        )

    except (json.JSONDecodeError, KeyError) as e:
        return ToolResult(output=f"Bluetooth info:\n{stdout.decode()[:3000]}")


async def _bluetooth_windows() -> ToolResult:
    ps_script = """
Get-PnpDevice -Class Bluetooth | Where-Object { $_.FriendlyName -ne $null } |
Select-Object FriendlyName, Status, InstanceId |
ForEach-Object {
    "$($_.FriendlyName)|||$($_.Status)|||$($_.InstanceId)"
}
"""
    proc = await asyncio.create_subprocess_exec(
        "powershell.exe", "-NoProfile", "-Command", ps_script,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=15)

    devices = []
    for line in stdout.decode().strip().split("\n"):
        parts = line.split("|||")
        if len(parts) >= 2:
            devices.append({
                "name": parts[0].strip(),
                "status": parts[1].strip(),
                "id": parts[2].strip() if len(parts) > 2 else "",
            })

    lines = [f"Bluetooth devices ({len(devices)} found):"]
    for d in devices:
        lines.append(f"  {d['name']} — {d['status']}")

    return ToolResult(
        output="\n".join(lines),
        metadata={"devices": devices, "count": len(devices)},
    )


async def _bluetooth_linux(scan_duration: int) -> ToolResult:
    """List Bluetooth devices on Linux using bluetoothctl."""
    devices = []

    # Get paired devices
    try:
        proc = await asyncio.create_subprocess_exec(
            "bluetoothctl", "devices",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
        for line in stdout.decode().strip().split("\n"):
            # Format: Device XX:XX:XX:XX:XX:XX Name
            match = re.match(r"Device\s+([\dA-Fa-f:]+)\s+(.+)", line)
            if match:
                devices.append({
                    "name": match.group(2),
                    "address": match.group(1),
                    "paired": True,
                })
    except FileNotFoundError:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="bluetoothctl not found. Install: apt install bluez",
        )

    lines = [f"Bluetooth devices ({len(devices)} found):"]
    for d in devices:
        lines.append(f"  {d['name']} ({d['address']}) — {'Paired' if d.get('paired') else 'Discovered'}")

    return ToolResult(
        output="\n".join(lines),
        metadata={"devices": devices, "count": len(devices)},
    )


async def tool_connected_devices(
    session: ToolSession,
) -> ToolResult:
    """List all connected peripheral devices (USB, Bluetooth, etc.)."""
    try:
        if IS_MACOS:
            return await _connected_macos()
        elif IS_WINDOWS:
            return await _connected_windows()
        else:
            return await _connected_linux()
    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Device listing failed: {e}")


async def _connected_macos() -> ToolResult:
    """List connected devices on macOS."""
    proc = await asyncio.create_subprocess_exec(
        "system_profiler", "SPUSBDataType", "SPBluetoothDataType", "-json",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=15)

    try:
        data = json.loads(stdout.decode())
        devices = []

        # Parse USB devices
        def _parse_usb_items(items, parent=""):
            if not isinstance(items, list):
                return
            for item in items:
                if isinstance(item, dict):
                    name = item.get("_name", "")
                    if name:
                        devices.append({
                            "name": name,
                            "type": "USB",
                            "vendor": item.get("manufacturer", ""),
                            "serial": item.get("serial_num", ""),
                            "bus_power": item.get("bus_power", ""),
                        })
                    # Recurse into sub-items
                    for key in item:
                        if isinstance(item[key], list):
                            _parse_usb_items(item[key], name)

        usb_data = data.get("SPUSBDataType", [])
        _parse_usb_items(usb_data)

        lines = [f"Connected devices ({len(devices)}):", ""]
        for d in devices:
            vendor = f" ({d['vendor']})" if d['vendor'] else ""
            lines.append(f"  [{d['type']}] {d['name']}{vendor}")

        return ToolResult(
            output="\n".join(lines),
            metadata={"devices": devices, "count": len(devices)},
        )

    except (json.JSONDecodeError, KeyError):
        return ToolResult(output=f"Devices:\n{stdout.decode()[:5000]}")


async def _connected_windows() -> ToolResult:
    ps_script = """
Get-PnpDevice -PresentOnly | Where-Object {
    $_.Class -in @('USB', 'Bluetooth', 'HIDClass', 'Monitor', 'DiskDrive') -and $_.Status -eq 'OK'
} | Select-Object FriendlyName, Class, Status | Sort-Object Class, FriendlyName |
ForEach-Object { "$($_.Class)|||$($_.FriendlyName)|||$($_.Status)" }
"""
    proc = await asyncio.create_subprocess_exec(
        "powershell.exe", "-NoProfile", "-Command", ps_script,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=15)

    devices = []
    for line in stdout.decode().strip().split("\n"):
        parts = line.split("|||")
        if len(parts) >= 2:
            devices.append({
                "type": parts[0].strip(),
                "name": parts[1].strip(),
                "status": parts[2].strip() if len(parts) > 2 else "",
            })

    lines = [f"Connected devices ({len(devices)}):", ""]
    current_type = ""
    for d in devices:
        if d["type"] != current_type:
            current_type = d["type"]
            lines.append(f"  {current_type}:")
        lines.append(f"    {d['name']}")

    return ToolResult(
        output="\n".join(lines),
        metadata={"devices": devices, "count": len(devices)},
    )


async def _connected_linux() -> ToolResult:
    proc = await asyncio.create_subprocess_exec(
        "lsusb",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)

    if proc.returncode != 0:
        return ToolResult(
            type=ToolResultType.ERROR,
            output=f"lsusb not found. Install: apt install usbutils",
        )

    devices = []
    for line in stdout.decode().strip().split("\n"):
        # Format: Bus 001 Device 001: ID 1d6b:0002 Linux Foundation 2.0 root hub
        match = re.match(r"Bus\s+(\d+)\s+Device\s+(\d+):\s+ID\s+([\da-f:]+)\s+(.*)", line, re.I)
        if match:
            devices.append({
                "type": "USB",
                "bus": match.group(1),
                "device": match.group(2),
                "id": match.group(3),
                "name": match.group(4),
            })

    lines = [f"Connected USB devices ({len(devices)}):", ""]
    for d in devices:
        lines.append(f"  Bus {d['bus']} Dev {d['device']}: {d['name']}")

    return ToolResult(
        output="\n".join(lines),
        metadata={"devices": devices, "count": len(devices)},
    )
