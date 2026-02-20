"""Local file manager — reads/writes .md files in the documents directory.

Canonical location: ~/.matrx/documents/<folder>/<note>.md
Additional mapped directories are synced copies of the canonical files.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
from pathlib import Path
from typing import Any

from app.config import DOCUMENTS_BASE_DIR

logger = logging.getLogger(__name__)

# Sync metadata lives inside the documents dir
SYNC_DIR = DOCUMENTS_BASE_DIR / ".sync"
STATE_FILE = SYNC_DIR / "state.json"
MAPPINGS_FILE = SYNC_DIR / "mappings.json"
CONFLICTS_DIR = SYNC_DIR / "conflicts"


def _ensure_dirs() -> None:
    """Create base directory structure if it doesn't exist."""
    DOCUMENTS_BASE_DIR.mkdir(parents=True, exist_ok=True)
    SYNC_DIR.mkdir(parents=True, exist_ok=True)
    CONFLICTS_DIR.mkdir(parents=True, exist_ok=True)


def _safe_filename(name: str) -> str:
    """Convert a note label to a filesystem-safe filename."""
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name)
    safe = safe.strip(". ")
    return safe or "untitled"


def content_hash(content: str) -> str:
    """SHA-256 hash for content comparison."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


class DocumentFileManager:
    """Manages .md files on the local filesystem."""

    def __init__(self, base_dir: Path | None = None) -> None:
        self.base_dir = base_dir or DOCUMENTS_BASE_DIR
        _ensure_dirs()

    # ── Path helpers ─────────────────────────────────────────────────────────

    def folder_path(self, folder_name: str) -> Path:
        return self.base_dir / _safe_filename(folder_name)

    def note_path(self, folder_name: str, label: str) -> Path:
        return self.folder_path(folder_name) / f"{_safe_filename(label)}.md"

    def note_path_from_file_path(self, file_path: str) -> Path:
        """Resolve a stored file_path (e.g. 'React/hooks.md') to absolute."""
        return self.base_dir / file_path

    def relative_path(self, absolute: Path) -> str:
        """Convert an absolute path back to a relative file_path string."""
        return str(absolute.relative_to(self.base_dir))

    # ── Folder operations ────────────────────────────────────────────────────

    def create_folder(self, folder_name: str) -> Path:
        p = self.folder_path(folder_name)
        p.mkdir(parents=True, exist_ok=True)
        return p

    def rename_folder(self, old_name: str, new_name: str) -> Path:
        old_p = self.folder_path(old_name)
        new_p = self.folder_path(new_name)
        if old_p.exists():
            old_p.rename(new_p)
        else:
            new_p.mkdir(parents=True, exist_ok=True)
        return new_p

    def delete_folder(self, folder_name: str) -> bool:
        p = self.folder_path(folder_name)
        if p.exists():
            shutil.rmtree(p)
            return True
        return False

    def list_folders(self) -> list[str]:
        if not self.base_dir.exists():
            return []
        return sorted(
            d.name
            for d in self.base_dir.iterdir()
            if d.is_dir() and not d.name.startswith(".")
        )

    # ── Note file operations ─────────────────────────────────────────────────

    def write_note(
        self,
        folder_name: str,
        label: str,
        content: str,
        file_path: str | None = None,
    ) -> str:
        """Write note content to a .md file.

        Returns the relative file_path for storage in the database.
        """
        if file_path:
            target = self.note_path_from_file_path(file_path)
        else:
            target = self.note_path(folder_name, label)

        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return self.relative_path(target)

    def read_note(self, file_path: str) -> str | None:
        """Read note content from a .md file."""
        target = self.note_path_from_file_path(file_path)
        if target.is_file():
            return target.read_text(encoding="utf-8")
        return None

    def delete_note(self, file_path: str) -> bool:
        target = self.note_path_from_file_path(file_path)
        if target.is_file():
            target.unlink()
            return True
        return False

    def rename_note(self, old_file_path: str, new_folder: str, new_label: str) -> str:
        """Move/rename a note file. Returns the new relative file_path."""
        old_target = self.note_path_from_file_path(old_file_path)
        new_target = self.note_path(new_folder, new_label)
        new_target.parent.mkdir(parents=True, exist_ok=True)
        if old_target.is_file():
            old_target.rename(new_target)
        return self.relative_path(new_target)

    def note_hash(self, file_path: str) -> str | None:
        """Compute content hash for a local file."""
        content = self.read_note(file_path)
        if content is not None:
            return content_hash(content)
        return None

    def list_notes_in_folder(self, folder_name: str) -> list[dict[str, str]]:
        """List all .md files in a folder with their hashes."""
        folder = self.folder_path(folder_name)
        if not folder.is_dir():
            return []
        results = []
        for f in sorted(folder.iterdir()):
            if f.is_file() and f.suffix == ".md":
                text = f.read_text(encoding="utf-8")
                results.append({
                    "label": f.stem,
                    "file_path": self.relative_path(f),
                    "content_hash": content_hash(text),
                    "size": len(text),
                })
        return results

    def scan_all(self) -> list[dict[str, str]]:
        """Scan all .md files under the documents directory."""
        results: list[dict[str, str]] = []
        if not self.base_dir.exists():
            return results
        for root, dirs, files in os.walk(self.base_dir):
            # Skip hidden directories
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for f in sorted(files):
                if f.endswith(".md"):
                    fp = Path(root) / f
                    text = fp.read_text(encoding="utf-8")
                    results.append({
                        "label": fp.stem,
                        "file_path": self.relative_path(fp),
                        "content_hash": content_hash(text),
                        "folder": Path(root).relative_to(self.base_dir).as_posix(),
                    })
        return results

    # ── Conflict handling ────────────────────────────────────────────────────

    def save_conflict(
        self,
        file_path: str,
        local_content: str,
        remote_content: str,
        note_id: str,
    ) -> str:
        """Save conflicting versions for manual resolution.

        Returns the path to the conflict directory.
        """
        conflict_dir = CONFLICTS_DIR / note_id
        conflict_dir.mkdir(parents=True, exist_ok=True)
        (conflict_dir / "local.md").write_text(local_content, encoding="utf-8")
        (conflict_dir / "remote.md").write_text(remote_content, encoding="utf-8")
        return str(conflict_dir)

    def list_conflicts(self) -> list[str]:
        """List note IDs that have unresolved conflicts."""
        if not CONFLICTS_DIR.exists():
            return []
        return [d.name for d in CONFLICTS_DIR.iterdir() if d.is_dir()]

    def resolve_conflict(self, note_id: str) -> bool:
        """Remove a conflict directory after resolution."""
        conflict_dir = CONFLICTS_DIR / note_id
        if conflict_dir.exists():
            shutil.rmtree(conflict_dir)
            return True
        return False

    # ── Directory mappings (additional sync targets) ─────────────────────────

    def sync_to_mapped_dirs(
        self,
        file_path: str,
        mapped_paths: list[str],
    ) -> list[str]:
        """Copy a canonical .md file to all mapped directories.

        Returns list of successfully written paths.
        """
        source = self.note_path_from_file_path(file_path)
        if not source.is_file():
            return []

        content = source.read_text(encoding="utf-8")
        filename = source.name
        written: list[str] = []

        for mapped_dir in mapped_paths:
            target = Path(mapped_dir) / filename
            try:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding="utf-8")
                written.append(str(target))
            except Exception:
                logger.warning("Failed to sync to mapped dir: %s", target, exc_info=True)

        return written

    # ── Sync state persistence ───────────────────────────────────────────────

    def load_sync_state(self) -> dict[str, Any]:
        _ensure_dirs()
        if STATE_FILE.is_file():
            try:
                return json.loads(STATE_FILE.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                logger.warning("Corrupt sync state, resetting")
        return {
            "last_sync_version": 0,
            "last_full_sync": None,
            "device_id": None,
            "note_hashes": {},
        }

    def save_sync_state(self, state: dict[str, Any]) -> None:
        _ensure_dirs()
        STATE_FILE.write_text(
            json.dumps(state, indent=2, default=str), encoding="utf-8"
        )

    def load_local_mappings(self) -> dict[str, list[str]]:
        """Load directory mappings config.

        Returns {folder_id: [local_path, ...]}.
        """
        _ensure_dirs()
        if MAPPINGS_FILE.is_file():
            try:
                return json.loads(MAPPINGS_FILE.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                pass
        return {}

    def save_local_mappings(self, mappings: dict[str, list[str]]) -> None:
        _ensure_dirs()
        MAPPINGS_FILE.write_text(
            json.dumps(mappings, indent=2), encoding="utf-8"
        )


# Module-level singleton
file_manager = DocumentFileManager()
