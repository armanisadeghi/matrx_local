from fastapi import APIRouter, Response
from fastapi.responses import FileResponse
from pathlib import Path
from app.common.system_logger import get_logger

logger = get_logger()
router = APIRouter()

@router.get("/download/small-file")
async def download_small_file():
    """
    Send a small, dynamically generated file to the client.
    """
    logger.info("Small file download requested")
    content = "This is the file content"
    return Response(
        content=content,
        media_type="text/plain",
        headers={
            "Content-Disposition": 'attachment; filename="example.txt"'
        }
    )

@router.get("/download/large-file")
async def download_large_file():
    """
    Send a large file from disk to the client.
    """
    file_path = Path("files/large_file.zip")  # Replace with your actual file path
    if not file_path.exists():
        logger.error(f"File not found: {file_path}")
        return Response(status_code=404, content="File not found")
    logger.info(f"Large file download requested: {file_path}")
    return FileResponse(
        path=file_path,
        filename=file_path.name,
        media_type="application/octet-stream"
    )

@router.get("/download/generated-file")
async def download_generated_file():
    """
    Send a dynamically generated file to the client.
    """
    logger.info("Generated file download requested")
    # Replace this with your dynamic content generation logic
    content = '{"key": "value", "another_key": "another_value"}'
    return Response(
        content=content,
        media_type="application/json",
        headers={
            "Content-Disposition": 'attachment; filename="generated_file.json"'
        }
    )
