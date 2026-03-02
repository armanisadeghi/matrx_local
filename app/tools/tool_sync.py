"""Tool sync utility — code manifest ↔ matrx-ai tools table.

Usage (run from project root with uv):

    uv run python -m app.tools.tool_sync status     # show diff between code and DB
    uv run python -m app.tools.tool_sync push        # insert/update DB rows to match code
    uv run python -m app.tools.tool_sync push --dry-run   # preview what would change
    uv run python -m app.tools.tool_sync list        # list all local tools in the manifest
    uv run python -m app.tools.tool_sync show <name> # show full definition for one tool

How it works
------------
1. Load the LOCAL_TOOL_MANIFEST (source of truth in code).
2. Load the tools table rows from Supabase via matrx-ai's DB manager.
3. Compute a diff:
     - NEW:     in manifest, not in DB  → INSERT on push
     - CHANGED: in both, but schema/description/version differs → UPDATE on push
     - REMOVED: in DB with function_path starting "app.tools.", not in manifest → report only
     - OK:      identical → no action
4. Display the diff in a human-readable format (like `git diff --stat`).
5. On `push`, apply the changes.

The `version` field in LocalToolEntry acts as a migration guard:
if the version in the manifest matches the version in the DB, no update is made
even if minor whitespace differs. Bump the version when you want to force an update.
"""

from __future__ import annotations

import asyncio
import json
import sys
from typing import Any

from app.tools.local_tool_manifest import LOCAL_TOOL_MANIFEST, LocalToolEntry


# ---------------------------------------------------------------------------
# Diff logic
# ---------------------------------------------------------------------------

class ToolDiff:
    def __init__(
        self,
        new: list[LocalToolEntry],
        changed: list[tuple[LocalToolEntry, dict[str, Any]]],  # (manifest_entry, db_row)
        removed: list[dict[str, Any]],
        ok: list[str],
    ):
        self.new = new
        self.changed = changed
        self.removed = removed
        self.ok = ok

    @property
    def has_changes(self) -> bool:
        return bool(self.new or self.changed or self.removed)

    def print_summary(self) -> None:
        total = len(self.new) + len(self.changed) + len(self.removed) + len(self.ok)
        print(f"\n{'─' * 60}")
        print(f"  Tool sync status  ({total} tools in manifest)")
        print(f"{'─' * 60}")

        if not self.has_changes:
            print(f"  ✓ All {len(self.ok)} local tools are in sync with the DB.")
            print()
            return

        if self.new:
            print(f"\n  + {len(self.new)} new  (in manifest, not in DB)")
            for e in self.new:
                print(f"      + {e.name}  [{e.category}]  v{e.version}")

        if self.changed:
            print(f"\n  ~ {len(self.changed)} changed  (manifest differs from DB)")
            for e, db_row in self.changed:
                changes = _diff_fields(e, db_row)
                print(f"      ~ {e.name}  [{', '.join(changes)}]")

        if self.removed:
            print(f"\n  - {len(self.removed)} removed  (in DB, not in manifest)")
            print("    NOTE: removed tools are NOT auto-deleted — do it manually if intended.")
            for row in self.removed:
                print(f"      - {row.get('name')}  (function_path: {row.get('function_path')})")

        if self.ok:
            print(f"\n  ✓ {len(self.ok)} already in sync")

        print()


def _entry_parameters(entry: LocalToolEntry) -> dict[str, Any]:
    """Return the effective JSON Schema for a manifest entry.

    Prefers arg_model.model_json_schema() when an arg_model is set,
    falling back to the hand-written `parameters` dict.
    """
    if entry.arg_model is not None:
        schema = entry.arg_model.model_json_schema()
        return {
            "type": "object",
            "properties": schema.get("properties", {}),
            "required": schema.get("required", []),
        }
    return entry.parameters


def _diff_fields(entry: LocalToolEntry, db_row: dict[str, Any]) -> list[str]:
    """Return list of field names that differ between manifest entry and DB row."""
    changes: list[str] = []

    if entry.description != (db_row.get("description") or ""):
        changes.append("description")

    manifest_params = json.dumps(_entry_parameters(entry), sort_keys=True)
    raw_db_params = db_row.get("parameters") or {}
    # raw_sql can return JSONB as a pre-serialized string depending on the asyncpg codec
    if isinstance(raw_db_params, str):
        raw_db_params = json.loads(raw_db_params)
    db_params = json.dumps(raw_db_params, sort_keys=True)
    if manifest_params != db_params:
        changes.append("parameters")

    if entry.category != (db_row.get("category") or ""):
        changes.append("category")

    manifest_tags = sorted(entry.tags)
    db_tags = sorted(db_row.get("tags") or [])
    if manifest_tags != db_tags:
        changes.append("tags")

    if entry.version != (db_row.get("version") or ""):
        changes.append("version")

    if entry.function_path != (db_row.get("function_path") or ""):
        changes.append("function_path")

    if entry.source_app != (db_row.get("source_app") or "matrx_ai"):
        changes.append("source_app")

    return changes


# ---------------------------------------------------------------------------
# DB operations
# ---------------------------------------------------------------------------

async def _load_db_rows() -> list[dict[str, Any]]:
    """Load all tools from the matrx-ai tools table via raw SQL.

    Using raw SQL instead of the ORM load_items() ensures we pick up all
    columns (including newly added ones like source_app) without waiting
    for ORM model regeneration.
    """
    from matrx_ai.db.models import Tools

    rows = await Tools.raw_sql(
        """
        SELECT id, name, description, parameters, category, tags,
               version, function_path, source_app, is_active
        FROM tools
        ORDER BY name
        """
    )
    return [dict(r) for r in rows]


async def _compute_diff() -> ToolDiff:
    db_rows = await _load_db_rows()
    db_by_name: dict[str, dict[str, Any]] = {r["name"]: r for r in db_rows}

    new: list[LocalToolEntry] = []
    changed: list[tuple[LocalToolEntry, dict[str, Any]]] = []
    ok: list[str] = []

    for entry in LOCAL_TOOL_MANIFEST:
        if entry.name not in db_by_name:
            new.append(entry)
        else:
            db_row = db_by_name[entry.name]
            # Version match = no update needed (unless version itself changed)
            diff_fields = _diff_fields(entry, db_row)
            if diff_fields:
                changed.append((entry, db_row))
            else:
                ok.append(entry.name)

    # Removed = in DB tagged as matrx_local, not in manifest
    manifest_names = {e.name for e in LOCAL_TOOL_MANIFEST}
    removed = [
        r for r in db_rows
        if r["name"] not in manifest_names
        and r.get("source_app") == "matrx_local"
    ]

    return ToolDiff(new=new, changed=changed, removed=removed, ok=ok)


def _entry_to_db_payload(entry: LocalToolEntry) -> dict[str, Any]:
    return {
        "name": entry.name,
        "description": entry.description,
        "parameters": _entry_parameters(entry),  # prefers arg_model schema
        "category": entry.category,
        "tags": entry.tags,
        "version": entry.version,
        "function_path": entry.function_path,
        "source_app": entry.source_app,
        "is_active": True,
        # timeout_seconds is not a column in the tools table; stored in LocalToolEntry only
    }


async def _push_via_raw_sql(payloads: list[dict[str, Any]]) -> list[tuple[str, str | None]]:
    """Upsert tool rows using the ORM's raw_sql, handling array columns correctly.

    Returns list of (name, error_message|None) tuples.
    """
    from matrx_ai.db.models import Tools

    # Actual tools table columns (no timeout_seconds in DB schema)
    UPSERT_SQL = """
        INSERT INTO tools (
            name, description, parameters, category, tags,
            version, function_path, source_app, is_active
        ) VALUES ($1, $2, $3::jsonb, $4, $5::text[], $6, $7, $8, $9)
        ON CONFLICT (name) DO UPDATE SET
            description   = EXCLUDED.description,
            parameters    = EXCLUDED.parameters,
            category      = EXCLUDED.category,
            tags          = EXCLUDED.tags,
            version       = EXCLUDED.version,
            function_path = EXCLUDED.function_path,
            source_app    = EXCLUDED.source_app,
            is_active     = EXCLUDED.is_active,
            updated_at    = now()
    """

    results: list[tuple[str, str | None]] = []
    for p in payloads:
        try:
            await Tools.raw_sql(
                UPSERT_SQL,
                p["name"],
                p["description"],
                json.dumps(p["parameters"]),
                p["category"],
                p["tags"],          # Python list → text[]
                p["version"],
                p["function_path"],
                p["source_app"],
                p["is_active"],
            )
            results.append((p["name"], None))
        except Exception as exc:
            results.append((p["name"], str(exc)[:200]))

    return results


async def _push_changes(diff: ToolDiff, dry_run: bool = False) -> None:
    """Insert new tools and update changed tools in the DB."""
    if not diff.has_changes:
        print("Nothing to push — already in sync.")
        return

    # ---- INSERT new tools ----
    if diff.new:
        if dry_run:
            for e in diff.new:
                print(f"  [DRY RUN] Would INSERT: {e.name}")
        else:
            payloads = [_entry_to_db_payload(e) for e in diff.new]
            results = await _push_via_raw_sql(payloads)
            for name, err in results:
                if err:
                    print(f"  ✗ Failed to insert {name}: {err}")
                else:
                    print(f"  ✓ Inserted: {name}")

    # ---- UPDATE changed tools ----
    if diff.changed:
        if dry_run:
            for entry, db_row in diff.changed:
                changes = _diff_fields(entry, db_row)
                print(f"  [DRY RUN] Would UPDATE: {entry.name}  fields={changes}")
        else:
            payloads = [_entry_to_db_payload(e) for e, _ in diff.changed]
            results = await _push_via_raw_sql(payloads)
            for name, err in results:
                if err:
                    print(f"  ✗ Failed to update {name}: {err}")
                else:
                    print(f"  ✓ Updated: {name}")


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

async def cmd_status() -> None:
    print("Loading DB tools...")
    diff = await _compute_diff()
    diff.print_summary()


async def cmd_push(dry_run: bool = False) -> None:
    print("Loading DB tools...")
    diff = await _compute_diff()
    diff.print_summary()

    if not diff.has_changes:
        return

    if dry_run:
        print("DRY RUN — no changes will be written.\n")
    else:
        confirm = input("Push these changes to the DB? [y/N] ").strip().lower()
        if confirm != "y":
            print("Aborted.")
            return
        print()

    await _push_changes(diff, dry_run=dry_run)
    if not dry_run:
        print("\nDone.")


def cmd_list() -> None:
    from collections import defaultdict

    # Group by source_app → category
    by_app: dict[str, dict[str, list[LocalToolEntry]]] = defaultdict(lambda: defaultdict(list))
    for entry in LOCAL_TOOL_MANIFEST:
        by_app[entry.source_app][entry.category].append(entry)

    total = len(LOCAL_TOOL_MANIFEST)
    print(f"\n{'─' * 60}")
    print(f"  Local tool manifest  ({total} tools)")
    print(f"{'─' * 60}")
    for app in sorted(by_app):
        app_entries = sum(len(v) for v in by_app[app].values())
        print(f"\n  [{app}]  ({app_entries} tools)")
        for cat in sorted(by_app[app]):
            entries = by_app[app][cat]
            print(f"\n    {cat}  ({len(entries)} tools)")
            for e in entries:
                print(f"      {e.name:<40} v{e.version}")
    print()


def cmd_show(name: str) -> None:
    from app.tools.local_tool_manifest import MANIFEST_BY_NAME

    entry = MANIFEST_BY_NAME.get(name)
    if not entry:
        print(f"Tool '{name}' not found in manifest.")
        sys.exit(1)

    print(f"\n{'─' * 60}")
    print(f"  {entry.name}  (v{entry.version})")
    print(f"{'─' * 60}")
    print(f"  source_app:   {entry.source_app}")
    print(f"  category:     {entry.category}")
    print(f"  tags:         {entry.tags}")
    print(f"  function:     {entry.function_path}")
    print(f"  timeout:      {entry.timeout_seconds}s")
    print(f"\n  description:\n    {entry.description}")
    params = _entry_parameters(entry)
    print(f"\n  parameters:\n{json.dumps(params, indent=4)}")
    print()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    import os

    # Initialize matrx-ai so DB is available
    os.environ.setdefault("PYTHONPATH", ".")
    from app.services.ai.engine import initialize_matrx_ai
    initialize_matrx_ai()

    args = sys.argv[1:]

    if not args or args[0] == "status":
        asyncio.run(cmd_status())

    elif args[0] == "push":
        dry_run = "--dry-run" in args
        asyncio.run(cmd_push(dry_run=dry_run))

    elif args[0] == "list":
        cmd_list()

    elif args[0] == "show":
        if len(args) < 2:
            print("Usage: tool_sync show <tool_name>")
            sys.exit(1)
        cmd_show(args[1])

    else:
        print(f"Unknown command: {args[0]}")
        print("Commands: status | push [--dry-run] | list | show <name>")
        sys.exit(1)


if __name__ == "__main__":
    main()
