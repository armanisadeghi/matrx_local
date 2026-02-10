"""File transfer tools — download files from URLs, upload files to URLs."""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path

from app.tools.session import ToolSession
from app.tools.types import ToolResult, ToolResultType

logger = logging.getLogger(__name__)


async def tool_download_file(
    session: ToolSession,
    url: str,
    save_path: str | None = None,
    timeout: int = 120,
) -> ToolResult:
    try:
        import httpx
    except ImportError:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="File download requires httpx. Install it with: uv add httpx",
        )

    if save_path:
        dest = Path(session.resolve_path(save_path))
    else:
        filename = url.rstrip("/").split("/")[-1].split("?")[0] or "download"
        dest = Path(session.cwd) / filename

    dest.parent.mkdir(parents=True, exist_ok=True)

    start = time.monotonic()
    total_bytes = 0

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=httpx.Timeout(timeout)) as client:
            async with client.stream("GET", url) as response:
                response.raise_for_status()
                with open(dest, "wb") as f:
                    async for chunk in response.aiter_bytes(chunk_size=65536):
                        f.write(chunk)
                        total_bytes += len(chunk)
    except httpx.TimeoutException:
        return ToolResult(type=ToolResultType.ERROR, output=f"Download timed out after {timeout}s")
    except httpx.HTTPStatusError as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Download failed: HTTP {e.response.status_code}")
    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Download failed: {type(e).__name__}: {e}")

    elapsed_ms = int((time.monotonic() - start) * 1000)

    return ToolResult(
        output=f"Downloaded {total_bytes:,} bytes to {dest} ({elapsed_ms}ms)",
        metadata={
            "path": str(dest),
            "size_bytes": total_bytes,
            "elapsed_ms": elapsed_ms,
        },
    )


async def tool_upload_file(
    session: ToolSession,
    file_path: str,
    upload_url: str,
    field_name: str = "file",
    timeout: int = 120,
) -> ToolResult:
    try:
        import httpx
    except ImportError:
        return ToolResult(
            type=ToolResultType.ERROR,
            output="File upload requires httpx. Install it with: uv add httpx",
        )

    resolved = session.resolve_path(file_path)

    if not os.path.isfile(resolved):
        return ToolResult(type=ToolResultType.ERROR, output=f"File not found: {resolved}")

    file_size = os.path.getsize(resolved)
    filename = os.path.basename(resolved)

    start = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout)) as client:
            with open(resolved, "rb") as f:
                files = {field_name: (filename, f)}
                response = await client.post(upload_url, files=files)
    except httpx.TimeoutException:
        return ToolResult(type=ToolResultType.ERROR, output=f"Upload timed out after {timeout}s")
    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Upload failed: {type(e).__name__}: {e}")

    elapsed_ms = int((time.monotonic() - start) * 1000)

    return ToolResult(
        output=f"Uploaded {filename} ({file_size:,} bytes) → HTTP {response.status_code} ({elapsed_ms}ms)",
        metadata={
            "status_code": response.status_code,
            "response_body": response.text[:5000],
            "file": resolved,
            "size_bytes": file_size,
            "elapsed_ms": elapsed_ms,
        },
    )
