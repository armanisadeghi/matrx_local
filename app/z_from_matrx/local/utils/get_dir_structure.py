import os
import sys
from config import BASE_DIR
from matrx_utils import (
    clear_terminal,
    generate_and_save_directory_structure,
    print_link,
    vcprint,
)


if __name__ == "__main__":
    clear_terminal()
    config = {
        "root_directory": r"/home/arman/projects/aidream/ai",
        "project_root": r"/home/arman/projects/aidream",
        "ignore_directories": [
            ".",
            "_dev",
            ".history",
            "notes",
            "templates",
            "venv",
            "external libraries",
            "scratches",
            "consoles",
            ".git",
            "node_modules",
            "__pycache__",
            ".github",
            ".idea",
            "frontend",
            ".next",
            "__tests__",
            "temp",
            "static",
            "templates",
            "migrations",
            "coreui-icons-pro",
            "staticfiles",
        ],
        "include_directories": [],
        "ignore_filenames": ["__init__.py"],
        "include_filenames": [],
        "ignore_extensions": ["txt"],
        "include_extensions": [],
        "include_files_override": True,
        "ignore_dir_with_no_files": True,
        "root_save_path": os.path.join(BASE_DIR, "temp", "dir_structure"),
        "include_text_output": True,
        "alias_map": {
            "@": r"D:\app_dev\ai-matrx-admin",
        },
    }

    directory_structure, output_file, text_output_file = (
        generate_and_save_directory_structure(config)
    )
    vcprint(directory_structure, title="Directory Structure", color="blue")
    print()
    print_link(output_file)
    if text_output_file:
        print_link(text_output_file)
