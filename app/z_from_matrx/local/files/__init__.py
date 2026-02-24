"""
Local file utilities for handling file operations across platforms.

This module provides utilities for opening files from local paths or URLs,
with automatic path resolution across different platforms (including WSL).
"""

from .local_files import open_any_file

__all__ = ["open_any_file"]
