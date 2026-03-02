import asyncio
import io
import os
import uuid
import zipfile
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.responses import StreamingResponse

from app.api.browser_events import handle_browser_event
from app.api.system_control import get_system_info
from app.common.system_logger import get_logger
import app.common.access_log as access_log
from app.config import BASE_DIR, LOG_DIR, TEMP_DIR
from app.services.screenshots.capture import take_screenshot
from app.utils.directory_utils.generate_directory_structure import (
    get_structure_with_common_configs,
)

from pathlib import Path

from app.config import DATA_DIR

# Initialize the APIRouter
router = APIRouter()
logger = get_logger()


# Root endpoint
@router.get("/")
async def root():
    logger.info("Root endpoint accessed")
    return {"status": "ok", "service": "matrx-local", "version": "1.0.9"}


# ── Public discovery / health endpoints ─────────────────────────────────


@router.get("/health")
async def health():
    """Simple health check — returns OK if the engine is running."""
    return {"status": "ok", "service": "matrx-local"}


@router.get("/version")
async def version():
    """Return the engine version."""
    return {"version": "1.0.9", "service": "matrx-local"}


@router.get("/ports")
async def ports(request: Request):
    """Return the ports the engine and proxy are listening on."""
    from app.services.proxy.server import get_proxy_server

    proxy = get_proxy_server()
    return {
        "engine": request.url.port,
        "proxy": proxy.port if proxy.running else None,
    }


# Trigger event
@router.post("/trigger")
async def trigger_event(data: dict):
    logger.info(f"Trigger event called with data: {data}")
    try:
        response = await handle_browser_event(data)
        return response
    except Exception as e:
        logger.error(f"Error in trigger_event: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error triggering event: {str(e)}")


# System info endpoint
@router.get("/system/info")
async def system_info():
    logger.info("System info endpoint accessed")
    try:
        return get_system_info()
    except Exception as e:
        logger.error(f"Error fetching system info: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Error fetching system info: {str(e)}"
        )


@router.post("/system/open-folder")
async def open_system_folder(data: dict):
    """Open the logs or data folder in the OS file manager."""
    from app.tools.tools import open_path_cross_platform

    folder = data.get("folder", "logs")
    if folder == "logs":
        target = Path(LOG_DIR)
    elif folder == "data":
        target = Path(DATA_DIR)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown folder: {folder}")

    target.mkdir(parents=True, exist_ok=True)
    target_str = str(target.resolve())

    success, message = open_path_cross_platform(target_str)
    if not success:
        logger.error("Failed to open folder '%s': %s", target_str, message)
        raise HTTPException(status_code=500, detail=message)
    return {"opened": target_str}


# List files
@router.get("/files")
async def list_files(directory: str = "."):
    logger.info(f"Listing files in directory: {directory}")
    try:
        return {"files": os.listdir(directory)}
    except Exception as e:
        logger.error(f"Error listing files: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error listing files: {str(e)}")


# Capture screenshot
@router.post("/screenshot")
async def capture_screenshot():
    logger.info("Capture screenshot endpoint accessed")
    try:
        screenshot_dir = os.path.join(TEMP_DIR, "screenshots")
        os.makedirs(screenshot_dir, exist_ok=True)

        unique_id = uuid.uuid4().hex
        screenshot_filename = f"screenshot_{unique_id}.png"
        screenshot_path = os.path.join(screenshot_dir, screenshot_filename)

        saved_path = take_screenshot(screenshot_path)
        logger.info(f"Screenshot saved at: {saved_path}")

        return {"screenshot_path": saved_path}
    except Exception as e:
        logger.error(f"Error capturing screenshot: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Error capturing screenshot: {str(e)}"
        )


# ── Logging endpoints ────────────────────────────────────────────────────────


@router.get("/logs")
async def get_logs(n: int = Query(default=100, ge=1, le=2000)):
    """Return the last *n* lines of system.log as plain strings."""
    log_file = Path(LOG_DIR) / "system.log"
    logger.info("Logs endpoint accessed")
    try:
        with open(log_file, "r", encoding="utf-8") as fh:
            lines = fh.readlines()[-n:]
        return {"logs": [l.rstrip("\n") for l in lines]}
    except FileNotFoundError:
        logger.warning("Log file not found: %s", log_file)
        raise HTTPException(status_code=404, detail="Log file not found")
    except Exception as e:
        logger.error(f"Error reading log file: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/logs/access")
async def get_access_logs(n: int = Query(default=100, ge=1, le=500)):
    """Return the last *n* structured access-log entries as JSON."""
    return {"entries": access_log.recent(n)}


@router.get("/logs/stream")
async def stream_system_log():
    """SSE stream that tails system.log in real time (text/event-stream)."""
    log_file = Path(LOG_DIR) / "system.log"

    async def _tail():
        try:
            with open(log_file, "r", encoding="utf-8") as fh:
                fh.seek(0, 2)  # jump to end
                while True:
                    line = fh.readline()
                    if line:
                        yield f"data: {line.rstrip()}\n\n"
                    else:
                        await asyncio.sleep(0.25)
        except FileNotFoundError:
            yield "data: [log file not found]\n\n"
        except asyncio.CancelledError:
            pass

    return StreamingResponse(
        _tail(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/logs/access/stream")
async def stream_access_log():
    """SSE stream that pushes new structured access-log entries as JSON."""
    q = access_log.subscribe()

    async def _push():
        import json

        try:
            while True:
                try:
                    entry = await asyncio.wait_for(q.get(), timeout=15.0)
                    yield f"data: {json.dumps(entry)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"  # prevent proxy timeouts
        except asyncio.CancelledError:
            pass
        finally:
            access_log.unsubscribe(q)

    return StreamingResponse(
        _push(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# Generate directory structure and serve files
@router.post("/generate-directory-structure/text")
async def generate_directory_structure(
    root_directory: str,
    project_root: str,
    common_configs: Optional[dict] = None,
):
    logger.info(
        f"Generate directory structure called with root: {root_directory}, project: {project_root}"
    )
    try:
        directory_structure, output_file, text_output_file = (
            get_structure_with_common_configs(
                root_directory, project_root, common_configs
            )
        )
        logger.info(f"Files generated: {output_file}, {text_output_file}")
        return FileResponse(
            path=text_output_file,
            media_type="text/plain",
            filename="directory_structure.txt",
        )
    except Exception as e:
        logger.error(f"Error generating directory structure: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Error generating directory structure: {str(e)}"
        )


@router.post("/generate-directory-structure/json")
async def generate_directory_structure_json(
    root_directory: str,
    project_root: str,
    common_configs: Optional[dict] = None,
):
    logger.info(
        f"Generate directory structure called with root: {root_directory}, project: {project_root}"
    )
    try:
        directory_structure, output_file, text_output_file = (
            get_structure_with_common_configs(
                root_directory, project_root, common_configs
            )
        )
        logger.info(f"Files generated: {output_file}, {text_output_file}")

        return JSONResponse(
            content=directory_structure,
            media_type="application/json",
        )
    except Exception as e:
        logger.error(f"Error generating directory structure: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Error generating directory structure: {str(e)}"
        )


@router.post("/generate-directory-structure/zip")
async def generate_directory_structure(
    root_directory: str,
    project_root: str,
    common_configs: Optional[dict] = None,
):
    try:
        directory_structure, output_file, text_output_file = (
            get_structure_with_common_configs(
                root_directory, project_root, common_configs
            )
        )

        # Create a zip file in memory
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
            # Add both files to the zip
            zip_file.write(output_file, "directory_structure.json")
            zip_file.write(text_output_file, "directory_structure.txt")

        # Seek to start of the buffer
        zip_buffer.seek(0)

        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename=directory_structure.zip"
            },
        )
    except Exception as e:
        logger.error(f"Error generating directory structure: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Error generating directory structure: {str(e)}"
        )
