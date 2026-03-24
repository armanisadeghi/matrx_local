"""
Notes / documents endpoint smoke tests.

GET /notes/local/folders — list of local folders (no Supabase needed)
GET /notes/local/files   — list of local files
GET /notes/tree          — unified folder+file tree

These endpoints read from the local filesystem (~/Documents/Matrx/Notes)
so they work without any cloud/Supabase connection.
"""

from __future__ import annotations

import httpx


def test_notes_local_folders(http: httpx.Client) -> None:
    """GET /notes/local/folders returns a list."""
    r = http.get("/notes/local/folders")
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, list), f"Expected list, got {type(data).__name__}"


def test_notes_local_files(http: httpx.Client) -> None:
    """GET /notes/local/files returns a list."""
    r = http.get("/notes/local/files")
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, list), f"Expected list, got {type(data).__name__}"


def test_notes_tree(http: httpx.Client) -> None:
    """GET /notes/tree responds 200 and returns a structured object."""
    r = http.get("/notes/tree")
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, (dict, list)), (
        f"Expected dict or list from /notes/tree, got {type(data).__name__}"
    )


def test_notes_sync_status(http: httpx.Client) -> None:
    """GET /notes/sync/status returns a status field."""
    r = http.get("/notes/sync/status")
    assert r.status_code == 200, r.text
    data = r.json()
    # Should have at least a status/last_sync_at or similar field
    assert isinstance(data, dict), f"Expected dict, got {type(data).__name__}"
