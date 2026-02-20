"""Scheduler & heartbeat tools — background task scheduling and system wake management."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import platform
import subprocess
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.tools.session import ToolSession
from app.tools.types import ToolResult, ToolResultType

logger = logging.getLogger(__name__)

IS_WINDOWS = platform.system() == "Windows"
IS_MACOS = platform.system() == "Darwin"

# Persistence file — same directory as local.json discovery file
_TASKS_FILE = Path.home() / ".matrx" / "scheduled_tasks.json"

# Global scheduler state
_scheduled_tasks: dict[str, ScheduledTask] = {}
_heartbeat_active = False
_heartbeat_task: asyncio.Task | None = None
_prevent_sleep_process: asyncio.subprocess.Process | None = None


def _save_tasks() -> None:
    """Persist active task configs to disk so they survive restarts."""
    try:
        _TASKS_FILE.parent.mkdir(parents=True, exist_ok=True)
        active = [
            {
                "task_id": t.task_id,
                "name": t.name,
                "tool_name": t.tool_name,
                "tool_input": t.tool_input,
                "interval_seconds": t.interval_seconds,
                "max_runs": t.max_runs,
            }
            for t in _scheduled_tasks.values()
            if t.is_active
        ]
        _TASKS_FILE.write_text(json.dumps(active, indent=2))
    except Exception as e:
        logger.warning("Failed to persist scheduled tasks: %s", e)


async def restore_scheduled_tasks() -> int:
    """Load and re-schedule tasks saved from a previous session.

    Called once at startup from app lifespan. Returns count of restored tasks.
    """
    if not _TASKS_FILE.exists():
        return 0

    try:
        saved = json.loads(_TASKS_FILE.read_text())
    except Exception as e:
        logger.warning("Could not read scheduled_tasks.json: %s", e)
        return 0

    restored = 0
    dummy_session = ToolSession()
    for cfg in saved:
        try:
            await tool_schedule_task(
                session=dummy_session,
                name=cfg["name"],
                tool_name=cfg["tool_name"],
                tool_input=cfg.get("tool_input", {}),
                interval_seconds=cfg["interval_seconds"],
                max_runs=cfg.get("max_runs"),
                _task_id=cfg.get("task_id"),
            )
            restored += 1
        except Exception as e:
            logger.warning("Could not restore task %s: %s", cfg.get("name"), e)

    if restored:
        logger.info("Restored %d scheduled task(s) from previous session", restored)
    return restored


@dataclass
class TaskExecution:
    timestamp: float
    success: bool
    output: str

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp,
            "success": self.success,
            "output": self.output[:500],
        }


@dataclass
class ScheduledTask:
    task_id: str
    name: str
    tool_name: str
    tool_input: dict[str, Any]
    interval_seconds: int
    is_active: bool = True
    last_run: float | None = None
    next_run: float = 0
    run_count: int = 0
    max_runs: int | None = None
    history: list[TaskExecution] = field(default_factory=list)
    _task: asyncio.Task | None = field(default=None, repr=False)
    _stop_event: asyncio.Event = field(default_factory=asyncio.Event, repr=False)

    def add_execution(self, success: bool, output: str) -> None:
        self.history.append(TaskExecution(
            timestamp=time.time(),
            success=success,
            output=output,
        ))
        # Keep last 50 executions
        if len(self.history) > 50:
            self.history = self.history[-50:]


async def tool_schedule_task(
    session: ToolSession,
    name: str,
    tool_name: str,
    tool_input: dict[str, Any],
    interval_seconds: int = 60,
    max_runs: int | None = None,
    _task_id: str | None = None,
) -> ToolResult:
    """Schedule a tool to run repeatedly at a given interval.

    This enables the heartbeat/background task system. The tool will be
    invoked with the given input on each interval. Scheduled tasks survive
    restarts — they are persisted to ~/.matrx/scheduled_tasks.json.

    Examples:
    - Check disk space every 5 minutes: tool_name='DiskUsage', interval=300
    - Monitor a directory: tool_name='ListDirectory', interval=60
    - System health check: tool_name='SystemResources', interval=120
    """
    if interval_seconds < 10:
        return ToolResult(type=ToolResultType.ERROR, output="Minimum interval is 10 seconds.")

    # Validate that we know about this tool
    from app.tools.dispatcher import TOOL_HANDLERS
    if tool_name not in TOOL_HANDLERS:
        return ToolResult(
            type=ToolResultType.ERROR,
            output=f"Unknown tool: {tool_name}",
        )

    task_id = _task_id or f"sched_{uuid.uuid4().hex[:8]}"

    scheduled = ScheduledTask(
        task_id=task_id,
        name=name,
        tool_name=tool_name,
        tool_input=tool_input,
        interval_seconds=interval_seconds,
        max_runs=max_runs,
        next_run=time.time() + interval_seconds,
    )

    async def _run_scheduled():
        from app.tools.dispatcher import dispatch
        from app.tools.session import ToolSession as TS

        task_session = TS()

        while not scheduled._stop_event.is_set():
            try:
                # Wait until next run time
                now = time.time()
                wait_time = max(0, scheduled.next_run - now)
                try:
                    await asyncio.wait_for(
                        scheduled._stop_event.wait(),
                        timeout=wait_time,
                    )
                    break  # Stop event was set
                except asyncio.TimeoutError:
                    pass  # Time to run

                # Execute the tool
                try:
                    result = await dispatch(scheduled.tool_name, scheduled.tool_input, task_session)
                    scheduled.add_execution(
                        success=result.type.value == "success",
                        output=result.output,
                    )
                    scheduled.run_count += 1
                    scheduled.last_run = time.time()
                except Exception as e:
                    scheduled.add_execution(success=False, output=str(e))
                    scheduled.run_count += 1
                    scheduled.last_run = time.time()

                # Check max runs
                if scheduled.max_runs and scheduled.run_count >= scheduled.max_runs:
                    scheduled.is_active = False
                    break

                # Schedule next run
                scheduled.next_run = time.time() + scheduled.interval_seconds

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.exception("Scheduled task %s error: %s", task_id, e)
                await asyncio.sleep(scheduled.interval_seconds)

        scheduled.is_active = False

    scheduled._task = asyncio.create_task(_run_scheduled())
    _scheduled_tasks[task_id] = scheduled
    _save_tasks()

    return ToolResult(
        output=(
            f"Scheduled: {name} (id: {task_id})\n"
            f"  Tool: {tool_name}\n"
            f"  Interval: {interval_seconds}s\n"
            f"  Max runs: {max_runs or 'unlimited'}\n"
            f"  First run in: {interval_seconds}s"
        ),
        metadata={"task_id": task_id, "name": name},
    )


async def tool_list_scheduled(
    session: ToolSession,
) -> ToolResult:
    """List all active and recent scheduled tasks."""
    if not _scheduled_tasks:
        return ToolResult(output="No scheduled tasks.")

    lines = [f"Scheduled tasks ({len(_scheduled_tasks)}):"]
    for task in _scheduled_tasks.values():
        status = "ACTIVE" if task.is_active else "STOPPED"
        last = time.strftime("%H:%M:%S", time.localtime(task.last_run)) if task.last_run else "never"
        next_in = max(0, task.next_run - time.time()) if task.is_active else 0

        lines.append(f"\n  [{task.task_id}] {task.name} — {status}")
        lines.append(f"    Tool: {task.tool_name}")
        lines.append(f"    Interval: {task.interval_seconds}s | Runs: {task.run_count}")
        lines.append(f"    Last run: {last} | Next in: {next_in:.0f}s")

        # Show last execution result
        if task.history:
            last_exec = task.history[-1]
            status_str = "OK" if last_exec.success else "FAIL"
            lines.append(f"    Last result: [{status_str}] {last_exec.output[:100]}")

    return ToolResult(
        output="\n".join(lines),
        metadata={
            "tasks": [
                {
                    "task_id": t.task_id,
                    "name": t.name,
                    "tool_name": t.tool_name,
                    "interval": t.interval_seconds,
                    "is_active": t.is_active,
                    "run_count": t.run_count,
                }
                for t in _scheduled_tasks.values()
            ]
        },
    )


async def tool_cancel_scheduled(
    session: ToolSession,
    task_id: str,
) -> ToolResult:
    """Cancel a scheduled task."""
    task = _scheduled_tasks.get(task_id)
    if task is None:
        return ToolResult(type=ToolResultType.ERROR, output=f"Task not found: {task_id}")

    task._stop_event.set()
    if task._task and not task._task.done():
        task._task.cancel()
        try:
            await task._task
        except asyncio.CancelledError:
            pass

    task.is_active = False
    run_count = task.run_count
    _save_tasks()

    return ToolResult(
        output=f"Cancelled: {task.name} ({task_id}). Ran {run_count} times.",
    )


async def tool_heartbeat_status(
    session: ToolSession,
) -> ToolResult:
    """Get the status of the heartbeat/scheduler system including all scheduled tasks,
    sleep prevention status, and system uptime."""
    global _heartbeat_active

    active_tasks = [t for t in _scheduled_tasks.values() if t.is_active]
    stopped_tasks = [t for t in _scheduled_tasks.values() if not t.is_active]

    sleep_prevented = _prevent_sleep_process is not None and _prevent_sleep_process.returncode is None

    info = {
        "active_tasks": len(active_tasks),
        "stopped_tasks": len(stopped_tasks),
        "sleep_prevented": sleep_prevented,
        "total_executions": sum(t.run_count for t in _scheduled_tasks.values()),
    }

    lines = [
        "Heartbeat System Status:",
        f"  Active scheduled tasks: {info['active_tasks']}",
        f"  Stopped tasks: {info['stopped_tasks']}",
        f"  Total executions: {info['total_executions']}",
        f"  Sleep prevention: {'ACTIVE' if sleep_prevented else 'OFF'}",
    ]

    if active_tasks:
        lines.append("\nActive tasks:")
        for t in active_tasks:
            next_in = max(0, t.next_run - time.time())
            lines.append(f"  - {t.name} (every {t.interval_seconds}s, next in {next_in:.0f}s)")

    return ToolResult(output="\n".join(lines), metadata=info)


async def tool_prevent_sleep(
    session: ToolSession,
    enable: bool = True,
    reason: str = "Matrx Local background tasks",
    duration_minutes: int | None = None,
) -> ToolResult:
    """Prevent or allow the system to go to sleep.

    On macOS: uses caffeinate
    On Windows: uses SetThreadExecutionState
    On Linux: uses systemd-inhibit or xdg-screensaver

    Keeps the system awake for background agent tasks. The prevention is
    automatically lifted when the engine shuts down.
    """
    global _prevent_sleep_process

    if not enable:
        # Disable sleep prevention
        if _prevent_sleep_process is not None:
            try:
                _prevent_sleep_process.kill()
                await _prevent_sleep_process.wait()
            except (ProcessLookupError, OSError):
                pass
            _prevent_sleep_process = None
            return ToolResult(output="Sleep prevention disabled. System can now sleep normally.")
        return ToolResult(output="Sleep prevention was not active.")

    # Kill existing prevention if any
    if _prevent_sleep_process is not None:
        try:
            _prevent_sleep_process.kill()
            await _prevent_sleep_process.wait()
        except (ProcessLookupError, OSError):
            pass

    try:
        if IS_MACOS:
            cmd = ["caffeinate", "-d", "-i", "-s"]
            if duration_minutes:
                cmd = ["caffeinate", "-d", "-i", "-s", "-t", str(duration_minutes * 60)]

            _prevent_sleep_process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            dur_str = f" for {duration_minutes} minutes" if duration_minutes else " (indefinite)"
            return ToolResult(
                output=f"Sleep prevention enabled{dur_str}. System will stay awake.\nReason: {reason}",
                metadata={"pid": _prevent_sleep_process.pid},
            )

        elif IS_WINDOWS:
            # Use PowerShell to set execution state
            ps_script = """
Add-Type @"
using System; using System.Runtime.InteropServices;
public class SleepPrevention {
    [DllImport("kernel32.dll")]
    public static extern uint SetThreadExecutionState(uint esFlags);
    public const uint ES_CONTINUOUS = 0x80000000;
    public const uint ES_SYSTEM_REQUIRED = 0x00000001;
    public const uint ES_DISPLAY_REQUIRED = 0x00000002;
}
"@
[SleepPrevention]::SetThreadExecutionState(
    [SleepPrevention]::ES_CONTINUOUS -bor
    [SleepPrevention]::ES_SYSTEM_REQUIRED -bor
    [SleepPrevention]::ES_DISPLAY_REQUIRED
)
# Keep running
while ($true) { Start-Sleep -Seconds 60 }
"""
            _prevent_sleep_process = await asyncio.create_subprocess_exec(
                "powershell.exe", "-NoProfile", "-Command", ps_script,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            return ToolResult(
                output=f"Sleep prevention enabled. System will stay awake.\nReason: {reason}",
                metadata={"pid": _prevent_sleep_process.pid},
            )

        else:
            # Linux: systemd-inhibit
            cmd = ["systemd-inhibit", "--what=idle:sleep", f"--why={reason}", "sleep", "infinity"]

            _prevent_sleep_process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            return ToolResult(
                output=f"Sleep prevention enabled via systemd-inhibit.\nReason: {reason}",
                metadata={"pid": _prevent_sleep_process.pid},
            )

    except FileNotFoundError as e:
        return ToolResult(
            type=ToolResultType.ERROR,
            output=f"Sleep prevention tool not found: {e}",
        )
    except Exception as e:
        return ToolResult(type=ToolResultType.ERROR, output=f"Failed to prevent sleep: {e}")
