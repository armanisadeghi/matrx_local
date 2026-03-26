"""
Transcription system parity tests.

Verifies structural consistency across the Rust, Python, and TypeScript layers
of the transcription/voice system without running any engine or compiling Rust.

Tests:
  1. TranscriptionContext exists and provides the singleton hook
  2. All Tauri IPC command names in TS match the Rust command function names
  3. Sessions persistence layer exports all required functions
  4. Wake word settings defaults match between Python and TypeScript
  5. useTranscription actions are wrapped in useMemo
  6. useWakeWord state + actions are wrapped in useMemo
  7. useTranscriptionSessions actions are wrapped in useMemo
"""

from __future__ import annotations

import re
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.parent
DESKTOP_SRC = PROJECT_ROOT / "desktop" / "src"
RUST_SRC = PROJECT_ROOT / "desktop" / "src-tauri" / "src" / "transcription"
PYTHON_SRC = PROJECT_ROOT / "app"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# 1. TranscriptionContext singleton
# ---------------------------------------------------------------------------


def test_transcription_context_exists():
    """TranscriptionContext.tsx exists, wraps useTranscription, and exports useTranscriptionApp."""
    path = DESKTOP_SRC / "contexts" / "TranscriptionContext.tsx"
    assert path.exists(), f"Missing {path}"
    source = _read(path)
    assert "useTranscription" in source, "TranscriptionContext must import useTranscription"
    assert "TranscriptionProvider" in source, "Must export TranscriptionProvider"
    assert "useTranscriptionApp" in source, "Must export useTranscriptionApp"


def test_transcription_provider_in_app():
    """App.tsx wraps the router with TranscriptionProvider."""
    source = _read(DESKTOP_SRC / "App.tsx")
    assert "<TranscriptionProvider>" in source, "App.tsx must render <TranscriptionProvider>"
    assert "useTranscriptionApp" in source, "App.tsx must use useTranscriptionApp instead of useTranscription"
    assert "useTranscription()" not in source, (
        "App.tsx should not call useTranscription() directly — use useTranscriptionApp()"
    )


# ---------------------------------------------------------------------------
# 2. Tauri IPC command name parity
# ---------------------------------------------------------------------------


def _extract_rust_commands() -> set[str]:
    """Extract #[tauri::command] function names from Rust transcription commands."""
    source = _read(RUST_SRC / "commands.rs")
    return set(re.findall(r"#\[tauri::command\]\s*pub\s+(?:async\s+)?fn\s+(\w+)", source))


def _extract_ts_invoke_calls() -> set[str]:
    """Extract tauriInvoke("...") call targets from the transcription hook."""
    source = _read(DESKTOP_SRC / "hooks" / "use-transcription.ts")
    return set(re.findall(r'tauriInvoke\w*\(\s*["\'](\w+)["\']', source))


def test_ts_invoke_targets_exist_in_rust():
    """Every Tauri invoke target in use-transcription.ts must exist as a Rust command."""
    rust_cmds = _extract_rust_commands()
    ts_invokes = _extract_ts_invoke_calls()
    missing = ts_invokes - rust_cmds
    assert not missing, (
        f"TS invokes commands not found in Rust: {missing}. "
        "Either the command was renamed or the TS invoke target is wrong."
    )


# ---------------------------------------------------------------------------
# 3. Sessions persistence API
# ---------------------------------------------------------------------------


def test_sessions_exports():
    """sessions.ts exports all required CRUD + debounce functions."""
    source = _read(DESKTOP_SRC / "lib" / "transcription" / "sessions.ts")
    required_exports = [
        "loadSessions",
        "createSession",
        "appendSegments",
        "finalizeSession",
        "renameSession",
        "updateSessionText",
        "polishSession",
        "deleteSession",
        "getSession",
        "flushNow",
        "setFlushCallback",
    ]
    for name in required_exports:
        assert f"export function {name}" in source or f"export {name}" in source, (
            f"sessions.ts must export {name}"
        )


# ---------------------------------------------------------------------------
# 4. Wake word settings defaults match
# ---------------------------------------------------------------------------


def test_wake_word_default_engine_matches():
    """Python and TS wake word defaults use the same engine."""
    py_source = _read(PYTHON_SRC / "api" / "settings_routes.py")
    ts_source = _read(DESKTOP_SRC / "lib" / "settings.ts")

    py_engine = re.search(r'engine:\s*Literal\[.*?\]\s*=\s*"(\w+)"', py_source)
    assert py_engine, "Python WakeWordSettings must define engine default"

    ts_match = re.search(r'wakeWordEngine:\s*["\'](\w+)["\']', ts_source)
    assert ts_match, "TS settings must define wakeWordEngine default"

    assert py_engine.group(1) == ts_match.group(1), (
        f"Engine default mismatch: Python={py_engine.group(1)}, TS={ts_match.group(1)}"
    )


def test_wake_word_default_keyword_matches():
    """Python, TS, and Rust wake word keyword defaults are consistent."""
    py_source = _read(PYTHON_SRC / "api" / "settings_routes.py")
    rust_source = _read(RUST_SRC / "wake_word.rs")

    py_kw = re.search(r'custom_keyword:\s*str\s*=\s*"([^"]+)"', py_source)
    assert py_kw, "Python WakeWordSettings must define custom_keyword default"

    rust_kw = re.search(r'keyword:\s*Mutex::new\("([^"]+)"', rust_source)
    assert rust_kw, "Rust WakeWordState must define keyword default"

    assert py_kw.group(1) == rust_kw.group(1), (
        f"Keyword default mismatch: Python={py_kw.group(1)}, Rust={rust_kw.group(1)}"
    )


# ---------------------------------------------------------------------------
# 5–7. useMemo wrapping checks
# ---------------------------------------------------------------------------


def _assert_actions_memoized(file: Path, hook_name: str):
    """Verify a hook's actions object is wrapped in useMemo."""
    source = _read(file)
    actions_pattern = re.compile(
        r"const actions\b.*?=\s*useMemo\s*\(", re.DOTALL
    )
    assert actions_pattern.search(source), (
        f"{hook_name} in {file.name} must wrap actions in useMemo (see React Patterns in CLAUDE.md)"
    )


def test_use_transcription_actions_memoized():
    _assert_actions_memoized(
        DESKTOP_SRC / "hooks" / "use-transcription.ts",
        "useTranscription",
    )


def test_use_wake_word_actions_memoized():
    _assert_actions_memoized(
        DESKTOP_SRC / "hooks" / "use-wake-word.ts",
        "useWakeWord",
    )


def test_use_transcription_sessions_actions_memoized():
    _assert_actions_memoized(
        DESKTOP_SRC / "hooks" / "use-transcription-sessions.ts",
        "useTranscriptionSessions",
    )


def test_use_transcription_state_memoized():
    """useTranscription state object must be wrapped in useMemo."""
    source = _read(DESKTOP_SRC / "hooks" / "use-transcription.ts")
    state_pattern = re.compile(
        r"const state\b.*?=\s*useMemo\s*\(", re.DOTALL
    )
    assert state_pattern.search(source), (
        "useTranscription must wrap state in useMemo"
    )


def test_use_wake_word_state_memoized():
    """useWakeWord state object must be wrapped in useMemo."""
    source = _read(DESKTOP_SRC / "hooks" / "use-wake-word.ts")
    state_pattern = re.compile(
        r"const state\b.*?=\s*useMemo\s*\(", re.DOTALL
    )
    assert state_pattern.search(source), (
        "useWakeWord must wrap state in useMemo"
    )


# ---------------------------------------------------------------------------
# 8. Whisper download cancellation
# ---------------------------------------------------------------------------


def test_whisper_cancel_command_exists():
    """cancel_whisper_download must exist in Rust commands and be registered."""
    rust_source = _read(RUST_SRC / "commands.rs")
    assert "fn cancel_whisper_download" in rust_source, (
        "Rust must define cancel_whisper_download command"
    )
    lib_source = _read(PROJECT_ROOT / "desktop" / "src-tauri" / "src" / "lib.rs")
    assert "cancel_whisper_download" in lib_source, (
        "cancel_whisper_download must be registered in lib.rs generate_handler"
    )


# ---------------------------------------------------------------------------
# 9. Wake word keyword persistence in config
# ---------------------------------------------------------------------------


def test_rust_config_persists_wake_keyword():
    """TranscriptionConfig must include wake_keyword field."""
    config_source = _read(RUST_SRC / "config.rs")
    assert "wake_keyword" in config_source, (
        "TranscriptionConfig must include wake_keyword for persistence"
    )
