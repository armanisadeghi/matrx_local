"""
Section coverage parity test.

Verifies that SECTION_KEYS in desktop/src/hooks/use-configurations.ts
covers every key defined in the AppSettings interface in settings.ts.

Why this matters:
  - Every setting that exists in AppSettings MUST belong to a section.
  - If a setting is not in any section, it cannot be edited via the
    Configurations page and will never appear in the UI.
  - If a section is defined but references a key that doesn't exist in
    AppSettings, the settings system will silently write undefined values.

This test runs without the engine (pure file parsing).
"""

from __future__ import annotations

import re
from pathlib import Path


PROJECT_ROOT = Path(__file__).parent.parent.parent
TS_SETTINGS_FILE = PROJECT_ROOT / "desktop" / "src" / "lib" / "settings.ts"
CONFIGURATIONS_HOOK = (
    PROJECT_ROOT / "desktop" / "src" / "hooks" / "use-configurations.ts"
)


# ---------------------------------------------------------------------------
# Parsers (reuse logic from test_settings_parity.py)
# ---------------------------------------------------------------------------


def parse_ts_app_settings_camel_keys() -> set[str]:
    """Extract camelCase field names from AppSettings interface."""
    source = TS_SETTINGS_FILE.read_text(encoding="utf-8")
    match = re.search(
        r"export\s+interface\s+AppSettings\s*\{([^}]+)\}",
        source,
        re.DOTALL,
    )
    assert match, f"Could not find AppSettings interface in {TS_SETTINGS_FILE}"
    block = match.group(1)
    keys: set[str] = set()
    for line in block.splitlines():
        line = line.strip()
        if not line or line.startswith("//") or line.startswith("/*") or line.startswith("*"):
            continue
        m = re.match(r"^(\w+)\??\s*:", line)
        if m:
            keys.add(m.group(1))
    return keys


def parse_section_keys_from_hook() -> set[str]:
    """
    Extract all keys listed inside SECTION_KEYS in use-configurations.ts.

    The block looks like:
        const SECTION_KEYS: Record<ConfigSection, (keyof AppSettings)[]> = {
          application: ["launchOnStartup", "minimizeToTray", ...],
          appearance:  ["theme"],
          ...
        };
    """
    source = CONFIGURATIONS_HOOK.read_text(encoding="utf-8")

    # Find the SECTION_KEYS object block — greedily match from { to first };
    match = re.search(
        r"SECTION_KEYS\s*(?::[^=]+)?\s*=\s*\{(.+?)\};",
        source,
        re.DOTALL,
    )
    assert match, (
        f"Could not find SECTION_KEYS = {{...}} in {CONFIGURATIONS_HOOK}"
    )

    block = match.group(1)

    # Extract all quoted string values (the setting key names)
    keys = set(re.findall(r'"(\w+)"', block))
    return keys


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_hook_file_exists() -> None:
    """use-configurations.ts exists."""
    assert CONFIGURATIONS_HOOK.exists(), (
        f"use-configurations.ts not found at {CONFIGURATIONS_HOOK}"
    )


def test_section_keys_not_empty() -> None:
    """SECTION_KEYS contains at least 30 keys."""
    keys = parse_section_keys_from_hook()
    assert len(keys) >= 30, (
        f"Only found {len(keys)} keys in SECTION_KEYS. Parser may be broken."
    )


def test_all_app_settings_keys_are_in_a_section() -> None:
    """Every AppSettings key appears in at least one section of SECTION_KEYS."""
    app_settings_keys = parse_ts_app_settings_camel_keys()
    section_keys = parse_section_keys_from_hook()

    orphaned = app_settings_keys - section_keys
    assert not orphaned, (
        f"{len(orphaned)} AppSettings key(s) not assigned to any section in SECTION_KEYS:\n  "
        + "\n  ".join(sorted(orphaned))
        + "\n\nAdd them to the appropriate section in use-configurations.ts SECTION_KEYS."
    )


def test_no_ghost_keys_in_sections() -> None:
    """No key in SECTION_KEYS references a non-existent AppSettings field."""
    app_settings_keys = parse_ts_app_settings_camel_keys()
    section_keys = parse_section_keys_from_hook()

    ghosts = section_keys - app_settings_keys
    assert not ghosts, (
        f"{len(ghosts)} key(s) in SECTION_KEYS don't exist in AppSettings:\n  "
        + "\n  ".join(sorted(ghosts))
        + "\n\nRemove or rename these in use-configurations.ts SECTION_KEYS."
    )
