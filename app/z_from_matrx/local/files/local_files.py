import os
import io
import requests
from pathlib import Path
from typing import Tuple, BinaryIO
import platform
import sys

def is_wsl() -> bool:
    """Detect if running inside Windows Subsystem for Linux (WSL)."""
    if sys.platform.startswith("linux"):
        if "microsoft" in platform.uname().release.lower():
            return True
        try:
            with open("/proc/version", "r") as f:
                if "microsoft" in f.read().lower():
                    return True
        except IOError:
            pass
    return False


def convert_windows_to_wsl_path(windows_path: str) -> str:
    path_str = str(windows_path)
    if "://" in path_str or not os.path.isabs(path_str) and ":" not in path_str.split(os.sep)[0]:
        return path_str  # Not a Windows drive path

    # Handle drive letter
    drive_part = path_str[0].lower()
    if len(path_str) >= 2 and path_str[1] == ":":
        tail = path_str[2:]
        wsl_path = f"/mnt/{drive_part}{tail}"
        return Path(wsl_path.replace("\\", "/")).as_posix()
    return path_str


def resolve_local_path(input_path: str | os.PathLike) -> Path:
    """
    Resolve a local file path intelligently across platforms.

    - Expands ~ and environment variables
    - Resolves relative paths
    - Converts Windows paths to WSL paths if running in WSL
    - Validates existence

    Raises:
        FileNotFoundError: If the file does not exist
    """
    path = Path(input_path).expanduser()

    # If in WSL and path looks like a Windows drive path (e.g., C:/...), convert it
    if is_wsl():
        path_str = str(path)
        if len(path_str) >= 2 and path_str[1] == ":":
            path = Path(convert_windows_to_wsl_path(path_str))

    resolved = path.resolve()

    if not resolved.exists():
        raise FileNotFoundError(f"File not found: {resolved}")

    if not resolved.is_file():
        raise IsADirectoryError(f"Path is not a file: {resolved}")

    return resolved


def open_any_file(source: str) -> Tuple[str, BinaryIO]:
    """
    Open any file from a local path or URL.

    Args:
        source: A string path.
                - If starts with http:// or https:// → download
                - Otherwise → treat as local file path

    Returns:
        (filename: str, file_object: BinaryIO)
        The file_object is ready to read and should be closed by caller when done.

    Raises:
        ValueError: If source is empty or invalid
        requests.HTTPError: On download failure
        FileNotFoundError: If local file not found
    """
    if not source or not isinstance(source, str):
        raise ValueError("Source must be a non-empty string")

    source = source.strip()

    if source.startswith(("http://", "https://")):
        # Download from URL
        try:
            response = requests.get(source, timeout=30)
            response.raise_for_status()
        except requests.RequestException as e:
            raise ValueError(f"Failed to download from {source}: {e}") from e

        # Extract filename from URL or fallback
        filename = source.split("/")[-1].split("?")[0]
        if not filename or "." not in filename:
            filename = "downloaded_file"

        return filename, io.BytesIO(response.content)

    else:
        # Local file
        resolved_path = resolve_local_path(source)
        filename = resolved_path.name
        return filename, resolved_path.open("rb")


# Optional: Simple test when run directly
if __name__ == "__main__":
    # test_path = r"D:\OneDrive\Downloads Office\Sadeghi settlement agreement - signed by Arman.pdf"
    test_path = "https://ontheline.trincoll.edu/images/bookdown/sample-local-pdf.pdf"

    try:
        filename, file_obj = open_any_file(test_path)
        print(f"Successfully opened: {filename}")
        print(f"Size: {file_obj.seek(0, io.SEEK_END)} bytes")
        file_obj.seek(0)  # Reset for further use
        # Do something with file_obj here...
    except Exception as e:
        print(f"Error: {e}")
    finally:
        if 'file_obj' in locals() and hasattr(file_obj, 'close'):
            file_obj.close()