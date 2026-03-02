from __future__ import annotations

from pydantic import BaseModel, Field


class NetworkInfoArgs(BaseModel):
    pass  # no parameters — returns all interface info


class NetworkScanArgs(BaseModel):
    subnet: str | None = Field(
        default=None,
        description=(
            "Subnet to scan in CIDR notation (e.g. '192.168.1.0/24'). "
            "Auto-detected from the default interface if omitted."
        ),
    )
    timeout: int = Field(
        default=10,
        ge=1,
        le=120,
        description="Seconds to wait for ARP replies.",
    )


class PortScanArgs(BaseModel):
    host: str = Field(description="Hostname or IP address to scan.")
    ports: str = Field(
        default="common",
        description=(
            "Ports to scan. 'common' scans the top 1000 well-known ports, "
            "a range like '1-1024', or comma-separated values '80,443,8080'."
        ),
    )
    timeout_ms: int = Field(
        default=1000,
        ge=100,
        le=10000,
        description="Per-port connection timeout in milliseconds.",
    )


class MdnsDiscoverArgs(BaseModel):
    service_type: str | None = Field(
        default=None,
        description=(
            "mDNS service type to discover (e.g. '_http._tcp', '_ipp._tcp', '_ssh._tcp'). "
            "If omitted, discovers all services."
        ),
    )
    timeout: int = Field(
        default=5,
        ge=1,
        le=30,
        description="Seconds to listen for mDNS broadcasts.",
    )
