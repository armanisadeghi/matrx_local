"""
Tool count parity test.

Verifies that the number of tool_ functions across all tool files
stays at or above the known floor (79 as of v1.3.7).

Why this matters:
  - AI agents sometimes delete or rename tool functions without realising
    the impact on the registered tool count.
  - The engine's /tools/list endpoint must expose all tools.
  - This test catches disappearing tools before release.

Two sub-tests:
  1. Static: counts tool_ functions by scanning source files (no engine needed).
  2. Live: hits /tools/list and checks the count (requires engine).

The static count is authoritative for the pre-release script's parity phase.
The live count is run as a smoke test in the engine phase.
"""

from __future__ import annotations

import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).parent.parent.parent
TOOLS_DIR = PROJECT_ROOT / "app" / "tools" / "tools"

# Floor: the minimum number of tool_ functions that must exist.
# Raise this number whenever new tools are intentionally added;
# never lower it (lowering would let tools silently disappear).
TOOL_COUNT_FLOOR = 79


# ---------------------------------------------------------------------------
# Static counter
# ---------------------------------------------------------------------------


def count_tool_functions_in_source() -> dict[str, int]:
    """
    Scan all .py files in app/tools/tools/ and count functions whose names
    start with 'tool_'.

    Returns a dict mapping filename → count.
    """
    counts: dict[str, int] = {}
    for py_file in sorted(TOOLS_DIR.glob("*.py")):
        if py_file.name == "__init__.py":
            continue
        source = py_file.read_text(encoding="utf-8")
        # Match both sync and async def tool_*
        matches = re.findall(r"^(?:async\s+)?def\s+(tool_\w+)\s*\(", source, re.MULTILINE)
        if matches:
            counts[py_file.name] = len(matches)
    return counts


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_tools_dir_exists() -> None:
    """app/tools/tools/ directory exists."""
    assert TOOLS_DIR.exists(), f"Tools directory not found: {TOOLS_DIR}"


def test_tool_files_exist() -> None:
    """At least 20 tool files exist in app/tools/tools/."""
    py_files = [f for f in TOOLS_DIR.glob("*.py") if f.name != "__init__.py"]
    assert len(py_files) >= 20, (
        f"Expected at least 20 tool files, found {len(py_files)}: {[f.name for f in py_files]}"
    )


def test_static_tool_count_meets_floor() -> None:
    """Total tool_ functions across all source files >= TOOL_COUNT_FLOOR."""
    counts = count_tool_functions_in_source()
    total = sum(counts.values())
    assert total >= TOOL_COUNT_FLOOR, (
        f"Tool count {total} is below floor {TOOL_COUNT_FLOOR}.\n"
        f"Per-file counts:\n"
        + "\n".join(f"  {name}: {n}" for name, n in sorted(counts.items()))
        + "\n\nA tool file may have been deleted or functions renamed. "
        "If tools were intentionally removed, update TOOL_COUNT_FLOOR."
    )


def test_no_empty_tool_files() -> None:
    """Every tool file defines at least one tool_ function."""
    missing: list[str] = []
    for py_file in sorted(TOOLS_DIR.glob("*.py")):
        if py_file.name in ("__init__.py", "scraper.py"):
            # scraper.py may use a different pattern (wrapper functions)
            continue
        source = py_file.read_text(encoding="utf-8")
        matches = re.findall(r"^(?:async\s+)?def\s+(tool_\w+)\s*\(", source, re.MULTILINE)
        if not matches:
            missing.append(py_file.name)
    assert not missing, (
        f"Tool files with no tool_ functions (possibly broken imports or renamed functions):\n  "
        + "\n  ".join(missing)
    )


def test_tool_functions_have_docstrings() -> None:
    """Spot-check: at least 30% of tool_ functions have a docstring.

    Tools use multi-line signatures (session, params on separate lines) followed
    by the function body, so we search for any triple-quoted string within 10
    lines of a tool_ definition rather than requiring it directly on the next line.
    """
    counts = count_tool_functions_in_source()
    total = sum(counts.values())

    if total == 0:
        return  # no tools found — other tests handle this

    documented = 0
    for py_file in sorted(TOOLS_DIR.glob("*.py")):
        if py_file.name == "__init__.py":
            continue
        source = py_file.read_text(encoding="utf-8")
        lines = source.splitlines()

        for i, line in enumerate(lines):
            if re.match(r"\s*(?:async\s+)?def\s+tool_\w+", line):
                # Look for a triple-quote string in the next 10 lines (body/docstring)
                window = "\n".join(lines[i : i + 10])
                if '"""' in window or "'''" in window:
                    documented += 1

    ratio = documented / total
    assert ratio >= 0.3, (
        f"Only {documented}/{total} tool functions ({ratio:.0%}) have docstrings. "
        "Good documentation helps the AI understand available tools."
    )
