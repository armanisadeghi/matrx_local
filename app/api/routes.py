import os
from typing import Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from starlette.responses import StreamingResponse
from fastapi.responses import JSONResponse
from app.api.browser_events import handle_browser_event
from app.api.system_control import get_system_info
from app.database import get_connection
from app.services.screenshots.capture import take_screenshot
from app.utils.directory_utils.generate_directory_structure import get_structure_with_common_configs
from app.common.system_logger import get_logger
import zipfile
import io
from app.config import BASE_DIR, TEMP_DIR
import uuid

# Initialize the APIRouter
router = APIRouter()
logger = get_logger()

# Root endpoint
@router.get("/")
async def root():
    logger.info("Root endpoint accessed")
    return {"message": "API is working"}

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
        raise HTTPException(status_code=500, detail=f"Error fetching system info: {str(e)}")

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
        raise HTTPException(status_code=500, detail=f"Error capturing screenshot: {str(e)}")

# Fetch data from database
@router.get("/db-data")
async def get_data():
    logger.info("Fetching data from database")
    try:
        conn = await get_connection()
        data = await conn.fetch("SELECT * FROM local_data_sample")
        await conn.close()
        logger.info("Data fetched successfully from the database")
        return {"data": data}
    except Exception as e:
        logger.error(f"Error fetching data from database: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error fetching data from database: {str(e)}")

# Retrieve logs
@router.get("/logs")
async def get_logs():
    log_file = os.path.join("logs", "system.log")
    logger.info("Logs endpoint accessed")
    try:
        with open(log_file, "r") as file:
            logs = file.readlines()[-50:]
        return {"logs": logs}
    except FileNotFoundError:
        logger.warning("Log file not found")
        raise HTTPException(status_code=404, detail="Log file not found")
    except Exception as e:
        logger.error(f"Error reading log file: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error reading log file: {str(e)}")

# Generate directory structure and serve files
@router.post("/generate-directory-structure/text")
async def generate_directory_structure(
    root_directory: str,
    project_root: str,
    common_configs: Optional[dict] = None,
):
    logger.info(f"Generate directory structure called with root: {root_directory}, project: {project_root}")
    try:
        directory_structure, output_file, text_output_file = get_structure_with_common_configs(
            root_directory, project_root, common_configs
        )
        logger.info(f"Files generated: {output_file}, {text_output_file}")
        return FileResponse(
            path=text_output_file,
            media_type="text/plain",
            filename="directory_structure.txt"
        )
    except Exception as e:
        logger.error(f"Error generating directory structure: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error generating directory structure: {str(e)}")

@router.post("/generate-directory-structure/json")
async def generate_directory_structure_json(
    root_directory: str,
    project_root: str,
    common_configs: Optional[dict] = None,
):
    logger.info(f"Generate directory structure called with root: {root_directory}, project: {project_root}")
    try:
        directory_structure, output_file, text_output_file = get_structure_with_common_configs(
            root_directory, project_root, common_configs
        )
        logger.info(f"Files generated: {output_file}, {text_output_file}")

        return JSONResponse(
            content=directory_structure,
            media_type="application/json",
        )
    except Exception as e:
        logger.error(f"Error generating directory structure: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error generating directory structure: {str(e)}")


@router.post("/generate-directory-structure/zip")
async def generate_directory_structure(
        root_directory: str,
        project_root: str,
        common_configs: Optional[dict] = None,
):
    try:
        directory_structure, output_file, text_output_file = get_structure_with_common_configs(
            root_directory, project_root, common_configs
        )

        # Create a zip file in memory
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
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
            }
        )
    except Exception as e:
        logger.error(f"Error generating directory structure: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error generating directory structure: {str(e)}")

