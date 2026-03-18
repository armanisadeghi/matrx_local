; AI Matrx NSIS installer pre-install hook.
;
; ROOT CAUSE: aimatrx-engine.exe is a PyInstaller --onefile binary. On Windows,
; --onefile extracts all bundled Python files into a temp directory at launch.
; Windows Restart Manager registers these extracted files as "in use" by the
; installer package. Even after the process fully exits, the Restart Manager
; registry entry and the extraction directory itself can hold stale file handles,
; causing NSIS to report "Error opening file for writing: aimatrx-engine.exe"
; even when no process is running in Task Manager.
;
; FIX STRATEGY (defense-in-depth — all three steps run regardless):
;   1. Kill any surviving processes (in case the app is still running).
;   2. Delete the fixed PyInstaller extraction directory, which is where the
;      actual stale handles live. The Windows spec uses:
;        runtime_tmpdir = '%LOCALAPPDATA%\AI Matrx\engine-runtime'
;      Deleting this dir releases all Restart Manager registrations for those
;      extracted files before the installer tries to write anything.
;   3. Wait for the OS to fully flush handle tables before proceeding.

!macro NSIS_HOOK_PREINSTALL
    ; Step 1: Kill any surviving processes (graceful first, then force).
    ; /F = force, /T = include child processes.
    ; Errors are ignored — if the process isn't running, taskkill exits non-zero
    ; and we don't want that to abort the installer.
    ExecWait 'taskkill /F /T /IM "aimatrx-engine-x86_64-pc-windows-msvc.exe"'
    ExecWait 'taskkill /F /T /IM "aimatrx-engine.exe"'
    ExecWait 'taskkill /F /T /IM "AI Matrx.exe"'

    ; Step 2: Delete the fixed PyInstaller extraction directory.
    ; This is the directory where --onefile extracts Python at runtime, and
    ; the actual source of stale Restart Manager file locks after process exit.
    ; /S = recursive, /Q = quiet (no prompts), /F = force read-only files.
    ExecWait 'cmd /C "rmdir /S /Q "%LOCALAPPDATA%\AI Matrx\engine-runtime" 2>nul & exit 0"'

    ; Step 3: Brief pause so Windows fully releases all file handles and flushes
    ; the Restart Manager registry before we begin writing new files.
    Sleep 1500
!macroend
