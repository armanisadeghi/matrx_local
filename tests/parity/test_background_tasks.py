"""
Background task orchestrator parity test.

Verifies that:
1. The background tasks index.ts registers tasks with unique IDs.
2. Every task ID registered in index.ts is exported from its source file.
3. The orchestrator.ts exports startBackgroundTasks / stopBackgroundTasks
   (the functions that replaced direct syncAllSettings calls in use-engine.ts).
4. use-engine.ts imports from background-tasks (not the old syncAllSettings path).

Why this matters:
  - The refactor replaced a direct syncAllSettings() call with a
    BackgroundOrchestrator that runs tasks in priority order.
  - If a task is registered but the export is missing, the app silently
    fails to run that startup task (settings won't sync, token won't push, etc.).
  - If use-engine.ts still imports syncAllSettings, double-execution occurs.

This test runs without the engine (pure file parsing).
"""

from __future__ import annotations

import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).parent.parent.parent
BG_TASKS_DIR = PROJECT_ROOT / "desktop" / "src" / "lib" / "background-tasks"
INDEX_FILE = BG_TASKS_DIR / "index.ts"
ORCHESTRATOR_FILE = BG_TASKS_DIR / "orchestrator.ts"
USE_ENGINE_FILE = PROJECT_ROOT / "desktop" / "src" / "hooks" / "use-engine.ts"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def parse_registered_imports(source: str) -> list[tuple[str, str]]:
    """
    Parse lines like:
        import { pushTokenToPython } from "./tasks/token-sync";
    Returns list of (export_name, relative_module) tuples.
    """
    results: list[tuple[str, str]] = []
    for m in re.finditer(
        r'import\s*\{([^}]+)\}\s*from\s*"(\./tasks/[^"]+)"',
        source,
    ):
        names_raw, module = m.group(1), m.group(2)
        for name in re.findall(r"\b(\w+)\b", names_raw):
            results.append((name, module))
    return results


def parse_registered_ids(source: str) -> list[str]:
    """
    Parse orchestrator.register(taskName) calls in index.ts.
    Returns list of task variable names being registered.
    """
    return re.findall(r"orchestrator\.register\((\w+)\)", source)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_index_file_exists() -> None:
    assert INDEX_FILE.exists(), f"background-tasks/index.ts not found at {INDEX_FILE}"


def test_orchestrator_file_exists() -> None:
    assert ORCHESTRATOR_FILE.exists(), (
        f"background-tasks/orchestrator.ts not found at {ORCHESTRATOR_FILE}"
    )


def test_task_ids_are_unique() -> None:
    """
    Each task registered in index.ts should appear with a unique variable name.
    Duplicate registrations would cause the orchestrator to skip the second one
    (same-id guard), silently dropping a task.
    """
    source = INDEX_FILE.read_text(encoding="utf-8")
    ids = parse_registered_ids(source)

    assert ids, "No orchestrator.register() calls found in index.ts"

    seen: set[str] = set()
    duplicates: list[str] = []
    for task_id in ids:
        if task_id in seen:
            duplicates.append(task_id)
        seen.add(task_id)

    assert not duplicates, (
        f"Duplicate task registrations in index.ts: {duplicates}\n"
        "Duplicates are silently dropped by the orchestrator's same-id guard."
    )


def test_all_registered_tasks_are_imported() -> None:
    """Every variable passed to orchestrator.register() is imported in index.ts."""
    source = INDEX_FILE.read_text(encoding="utf-8")

    registered = set(parse_registered_ids(source))
    imported_names = {name for name, _ in parse_registered_imports(source)}

    missing = registered - imported_names
    assert not missing, (
        f"Task variable(s) registered but not imported in index.ts: {missing}\n"
        "These will cause a ReferenceError at runtime."
    )


def test_imported_task_files_exist() -> None:
    """Every task module imported in index.ts actually exists on disk."""
    source = INDEX_FILE.read_text(encoding="utf-8")
    imports = parse_registered_imports(source)

    missing: list[str] = []
    for _name, module_path in imports:
        # module_path is like "./tasks/token-sync" (no extension)
        resolved = BG_TASKS_DIR / (module_path.lstrip("./") + ".ts")
        if not resolved.exists():
            missing.append(f"  {module_path} → {resolved}")

    assert not missing, (
        f"{len(missing)} imported task file(s) not found:\n" + "\n".join(missing)
    )


def test_orchestrator_exports_start_stop() -> None:
    """orchestrator.ts (or index.ts re-export) exposes startBackgroundTasks and stopBackgroundTasks."""
    index_source = INDEX_FILE.read_text(encoding="utf-8")

    assert "startBackgroundTasks" in index_source, (
        "startBackgroundTasks not exported from background-tasks/index.ts.\n"
        "use-engine.ts needs this to start the startup task queue."
    )
    assert "stopBackgroundTasks" in index_source, (
        "stopBackgroundTasks not exported from background-tasks/index.ts.\n"
        "use-engine.ts needs this to clean up on disconnect."
    )


def test_use_engine_imports_background_tasks() -> None:
    """use-engine.ts imports from background-tasks (not the old syncAllSettings)."""
    source = USE_ENGINE_FILE.read_text(encoding="utf-8")

    assert "background-tasks" in source, (
        "use-engine.ts does not import from background-tasks.\n"
        "Engine startup tasks (settings sync, token push, etc.) won't run."
    )

    # Ensure the old direct call was removed — double-execution guard
    # Strip single-line comments before searching to avoid false positives
    source_no_comments = re.sub(r"//[^\n]*", "", source)
    direct_sync_calls = re.findall(r"\bsyncAllSettings\s*\(", source_no_comments)
    assert not direct_sync_calls, (
        "use-engine.ts still calls syncAllSettings() directly.\n"
        "This duplicates the background task that already handles it. "
        "Remove the direct call."
    )


def test_at_least_five_tasks_registered() -> None:
    """Guard against accidental deletion — at least 5 tasks registered."""
    source = INDEX_FILE.read_text(encoding="utf-8")
    ids = parse_registered_ids(source)
    assert len(ids) >= 5, (
        f"Only {len(ids)} background task(s) registered in index.ts. "
        f"Expected at least 5. Got: {ids}"
    )
