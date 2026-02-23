"""Permission check API routes.

Exposes endpoints for the frontend to query device/OS permission status
and to trigger live device probes (e.g. list audio devices, scan WiFi).
"""

from __future__ import annotations

from fastapi import APIRouter

from app.services.permissions.checker import (
    check_accessibility,
    check_all_permissions,
    check_bluetooth,
    check_camera,
    check_microphone,
    check_network,
    check_screen_recording,
)
from app.tools.session import ToolSession
from app.tools.tools.audio import tool_list_audio_devices
from app.tools.tools.wifi_bluetooth import (
    tool_bluetooth_devices,
    tool_connected_devices,
    tool_wifi_networks,
)
from app.tools.tools.network_discovery import tool_network_info
from app.tools.tools.system_monitor import tool_system_resources

router = APIRouter(prefix="/devices", tags=["devices"])


@router.get("/permissions")
async def get_permissions():
    """Get all device/OS permission statuses."""
    results = await check_all_permissions()
    return {"permissions": results, "platform": __import__("platform").system()}


@router.get("/permissions/{name}")
async def get_permission(name: str):
    """Get a single permission status by name."""
    checkers = {
        "microphone": check_microphone,
        "camera": check_camera,
        "accessibility": check_accessibility,
        "bluetooth": check_bluetooth,
        "network": check_network,
        "screen_recording": check_screen_recording,
    }
    checker = checkers.get(name)
    if not checker:
        return {"error": f"Unknown permission: {name}", "available": list(checkers.keys())}
    result = await checker()
    return result.to_dict()


@router.get("/audio")
async def get_audio_devices():
    """List audio input/output devices."""
    session = ToolSession()
    try:
        result = await tool_list_audio_devices(session=session)
        return {
            "output": result.output,
            "metadata": result.metadata,
            "type": result.type.value if hasattr(result.type, "value") else str(result.type),
        }
    finally:
        await session.cleanup()


@router.get("/bluetooth")
async def get_bluetooth_devices():
    """List Bluetooth devices."""
    session = ToolSession()
    try:
        result = await tool_bluetooth_devices(session=session)
        return {
            "output": result.output,
            "metadata": result.metadata,
            "type": result.type.value if hasattr(result.type, "value") else str(result.type),
        }
    finally:
        await session.cleanup()


@router.get("/wifi")
async def get_wifi_networks():
    """List WiFi networks."""
    session = ToolSession()
    try:
        result = await tool_wifi_networks(session=session, rescan=False)
        return {
            "output": result.output,
            "metadata": result.metadata,
            "type": result.type.value if hasattr(result.type, "value") else str(result.type),
        }
    finally:
        await session.cleanup()


@router.get("/network")
async def get_network_info():
    """Get network interface information."""
    session = ToolSession()
    try:
        result = await tool_network_info(session=session)
        return {
            "output": result.output,
            "metadata": result.metadata,
            "type": result.type.value if hasattr(result.type, "value") else str(result.type),
        }
    finally:
        await session.cleanup()


@router.get("/connected")
async def get_connected_devices():
    """List all connected peripherals (USB, Bluetooth, etc.)."""
    session = ToolSession()
    try:
        result = await tool_connected_devices(session=session)
        return {
            "output": result.output,
            "metadata": result.metadata,
            "type": result.type.value if hasattr(result.type, "value") else str(result.type),
        }
    finally:
        await session.cleanup()


@router.get("/system")
async def get_system_resources():
    """Get CPU, RAM, disk, battery status."""
    session = ToolSession()
    try:
        result = await tool_system_resources(session=session)
        return {
            "output": result.output,
            "metadata": result.metadata,
            "type": result.type.value if hasattr(result.type, "value") else str(result.type),
        }
    finally:
        await session.cleanup()
