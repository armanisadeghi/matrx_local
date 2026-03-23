# stop.ps1 — Kill all Matrx Local processes and free all ports (Windows)
#
# Usage:
#   .\scripts\stop.ps1            # graceful stop
#   .\scripts\stop.ps1 -Force     # immediate kill
#   .\scripts\stop.ps1 -Audit     # report only — no killing
#
# What this cleans up:
#   - Python engine (run.py) — any/all instances
#   - aimatrx-engine sidecar binary (PyInstaller)
#   - AI Matrx desktop (Tauri) process
#   - Vite dev server (port 1420)
#   - Any port in the engine range (22140-22159)
#   - Orphaned llama-server processes
#   - Orphaned cloudflared tunnel processes
#   - PyInstaller extraction directory (stale file locks)
#   - Stale discovery file (~/.matrx/local.json)

param(
    [switch]$Force,
    [switch]$Audit
)

$ErrorActionPreference = "Continue"

# ── Resolve paths ────────────────────────────────────────────────────────
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
$DiscoveryFile = Join-Path $env:USERPROFILE ".matrx\local.json"
$EngineRuntimeDir = Join-Path $env:LOCALAPPDATA "AI Matrx\engine-runtime"

$KilledProcs = @()
$SigkillRequired = @()

Write-Host ""
Write-Host "Matrx Local — Process Cleanup (Windows)" -ForegroundColor Cyan
Write-Host "  Project root : $Root"
Write-Host "  Timestamp    : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
if ($Audit) {
    Write-Host "  Mode         : AUDIT ONLY — no processes will be killed" -ForegroundColor Cyan
} elseif ($Force) {
    Write-Host "  Mode         : force (immediate kill)" -ForegroundColor Red
} else {
    Write-Host "  Mode         : graceful"
}
Write-Host ""

function Stop-ProcessSafe {
    param(
        [int]$Pid,
        [string]$Label
    )

    $proc = $null
    try {
        $proc = Get-Process -Id $Pid -ErrorAction SilentlyContinue
    } catch {}

    if (-not $proc) {
        Write-Host "  [INFO] $Label (PID $Pid) — already gone" -ForegroundColor Gray
        return
    }

    if ($Audit) {
        Write-Host "  [AUDIT] Would kill: $Label (PID $Pid)" -ForegroundColor Yellow
        Write-Host "    Name: $($proc.ProcessName)  Started: $($proc.StartTime)  Memory: $([math]::Round($proc.WorkingSet64/1MB, 1)) MB"
        return
    }

    Write-Host "  [STOP] Stopping $Label (PID $Pid)..." -ForegroundColor Blue

    # Use taskkill /T to kill the entire process tree (critical for PyInstaller
    # and Playwright child processes)
    $result = & taskkill /F /T /PID $Pid 2>&1
    Start-Sleep -Milliseconds 300

    try {
        $still = Get-Process -Id $Pid -ErrorAction SilentlyContinue
    } catch { $still = $null }

    if ($still) {
        Write-Host "  [WARN] $Label (PID $Pid) survived taskkill — retrying..." -ForegroundColor Yellow
        Stop-Process -Id $Pid -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
    }

    try {
        $final = Get-Process -Id $Pid -ErrorAction SilentlyContinue
    } catch { $final = $null }

    if ($final) {
        Write-Host "  [ERROR] $Label (PID $Pid) could NOT be killed!" -ForegroundColor Red
        $script:SigkillRequired += "$Pid|$Label"
    } else {
        Write-Host "  [OK] Killed $Label (PID $Pid)" -ForegroundColor Green
        $script:KilledProcs += "$Pid|$Label"
    }
}

# ── 1. Engine via discovery file ────────────────────────────────────────
Write-Host "`n━━ 1 / 8  Engine (discovery file)" -ForegroundColor Blue
if (Test-Path $DiscoveryFile) {
    $discovery = Get-Content $DiscoveryFile -Raw | ConvertFrom-Json
    Write-Host "  Discovery file found: PID=$($discovery.pid) Port=$($discovery.port) Version=$($discovery.version)"

    if ($discovery.pid) {
        try {
            $engineProc = Get-Process -Id $discovery.pid -ErrorAction SilentlyContinue
        } catch { $engineProc = $null }

        if ($engineProc) {
            Stop-ProcessSafe -Pid $discovery.pid -Label "Matrx engine (port $($discovery.port))"
        } else {
            Write-Host "  [WARN] PID $($discovery.pid) is already gone — stale discovery file" -ForegroundColor Yellow
        }
    }
    if (-not $Audit) {
        Remove-Item $DiscoveryFile -Force -ErrorAction SilentlyContinue
        Write-Host "  [OK] Removed discovery file" -ForegroundColor Green
    }
} else {
    Write-Host "  [OK] No discovery file — engine was not running" -ForegroundColor Green
}

# ── 2. All Python engine processes (run.py) ─────────────────────────────
Write-Host "`n━━ 2 / 8  Engine (scan all Python processes)" -ForegroundColor Blue
$pythonProcs = Get-Process -Name "python*" -ErrorAction SilentlyContinue |
    Where-Object {
        try {
            $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine
            $cmd -match "run\.py"
        } catch { $false }
    }

if ($pythonProcs) {
    foreach ($p in $pythonProcs) {
        Stop-ProcessSafe -Pid $p.Id -Label "run.py engine"
    }
} else {
    Write-Host "  [OK] No run.py processes found" -ForegroundColor Green
}

# ── 3. aimatrx-engine sidecar processes ─────────────────────────────────
Write-Host "`n━━ 3 / 8  Sidecar binary (aimatrx-engine)" -ForegroundColor Blue
$sidecarNames = @("aimatrx-engine*")
$sidecarFound = $false
foreach ($pattern in $sidecarNames) {
    $procs = Get-Process -Name $pattern -ErrorAction SilentlyContinue
    foreach ($p in $procs) {
        $sidecarFound = $true
        Write-Host "  Found: $($p.ProcessName) PID=$($p.Id) Memory=$([math]::Round($p.WorkingSet64/1MB, 1))MB Started=$($p.StartTime)"
        Stop-ProcessSafe -Pid $p.Id -Label "aimatrx-engine sidecar"
    }
}
if (-not $sidecarFound) {
    Write-Host "  [OK] No aimatrx-engine sidecar processes found" -ForegroundColor Green
}

# ── 4. Tauri desktop process (AI Matrx) ─────────────────────────────────
Write-Host "`n━━ 4 / 8  Desktop (AI Matrx + Vite)" -ForegroundColor Blue
$desktopNames = @("AI Matrx", "ai-matrx", "AI_Matrx", "aimatrx")
$desktopFound = $false
foreach ($name in $desktopNames) {
    $procs = Get-Process -Name $name -ErrorAction SilentlyContinue
    foreach ($p in $procs) {
        $desktopFound = $true
        Stop-ProcessSafe -Pid $p.Id -Label "Tauri desktop ($name)"
    }
}
if (-not $desktopFound) {
    Write-Host "  [OK] No Tauri desktop processes found" -ForegroundColor Green
}

# Check Vite dev server on port 1420
$vitePid = (Get-NetTCPConnection -LocalPort 1420 -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
if ($vitePid -and $vitePid -ne 0) {
    Stop-ProcessSafe -Pid $vitePid -Label "Vite dev server (:1420)"
} else {
    Write-Host "  [OK] Vite dev server not running" -ForegroundColor Green
}

# ── 5. Engine port range (22140-22159) ──────────────────────────────────
Write-Host "`n━━ 5 / 8  Engine ports (22140-22159)" -ForegroundColor Blue
$portKilled = $false
foreach ($port in 22140..22159) {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
            Where-Object { $_.State -eq "Listen" } |
            Select-Object -First 1
    if ($conn -and $conn.OwningProcess -ne 0) {
        $pid = $conn.OwningProcess
        try {
            $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
            $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$pid" -ErrorAction SilentlyContinue).CommandLine
        } catch { $proc = $null; $cmd = "" }

        if ($cmd -match "python|uvicorn|run\.py|aimatrx") {
            Write-Host "  Port $port held by PID $pid ($($proc.ProcessName))" -ForegroundColor Yellow
            Stop-ProcessSafe -Pid $pid -Label "engine on port $port"
            $portKilled = $true
        } else {
            Write-Host "  [WARN] Port $port held by non-Matrx process: PID $pid ($($proc.ProcessName))" -ForegroundColor Yellow
        }
    }
}
if (-not $portKilled) {
    Write-Host "  [OK] No engine processes on ports 22140-22159" -ForegroundColor Green
}

# ── 6. Orphaned llama-server ────────────────────────────────────────────
Write-Host "`n━━ 6 / 8  Orphaned llama-server" -ForegroundColor Blue
$llamaProcs = Get-Process -Name "llama-server*" -ErrorAction SilentlyContinue
if ($llamaProcs) {
    foreach ($p in $llamaProcs) {
        Stop-ProcessSafe -Pid $p.Id -Label "llama-server (orphaned)"
    }
} else {
    Write-Host "  [OK] No orphaned llama-server processes found" -ForegroundColor Green
}

# ── 7. Orphaned cloudflared ─────────────────────────────────────────────
Write-Host "`n━━ 7 / 8  Orphaned cloudflared tunnel" -ForegroundColor Blue
$cfProcs = Get-Process -Name "cloudflared*" -ErrorAction SilentlyContinue
$cfKilled = $false
foreach ($p in $cfProcs) {
    try {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)" -ErrorAction SilentlyContinue).CommandLine
        if ($cmd -match "22140|matrx|trycloudflare") {
            Stop-ProcessSafe -Pid $p.Id -Label "cloudflared tunnel"
            $cfKilled = $true
        }
    } catch {}
}
if (-not $cfKilled) {
    Write-Host "  [OK] No orphaned cloudflared tunnel processes found" -ForegroundColor Green
}

# ── 8. PyInstaller extraction directory cleanup ─────────────────────────
Write-Host "`n━━ 8 / 8  PyInstaller runtime cleanup" -ForegroundColor Blue
if (Test-Path $EngineRuntimeDir) {
    if (-not $Audit) {
        Remove-Item -Recurse -Force $EngineRuntimeDir -ErrorAction SilentlyContinue
        Write-Host "  [OK] Removed stale PyInstaller extraction dir: $EngineRuntimeDir" -ForegroundColor Green
    } else {
        Write-Host "  [AUDIT] Would remove: $EngineRuntimeDir" -ForegroundColor Yellow
    }
} else {
    Write-Host "  [OK] No stale PyInstaller extraction directory" -ForegroundColor Green
}

# ── Port audit ──────────────────────────────────────────────────────────
Write-Host "`n━━ Port audit" -ForegroundColor Blue
$allClean = $true
foreach ($port in @(22140, 22141, 22142, 22143, 22144, 22145, 1420, 22180)) {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
            Where-Object { $_.State -eq "Listen" } |
            Select-Object -First 1
    if ($conn -and $conn.OwningProcess -ne 0) {
        $pid = $conn.OwningProcess
        try { $name = (Get-Process -Id $pid -ErrorAction SilentlyContinue).ProcessName } catch { $name = "?" }
        Write-Host "  :$port  STILL HELD by PID $pid ($name)" -ForegroundColor Red
        $allClean = $false
    } else {
        Write-Host "  :$port  free" -ForegroundColor Green
    }
}
if ($allClean) {
    Write-Host "  All Matrx ports are free" -ForegroundColor Green
}

# ── Summary ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Blue
Write-Host "  CLEANUP SUMMARY" -ForegroundColor White
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Blue
Write-Host ""

if ($KilledProcs.Count -eq 0) {
    if ($Audit) {
        Write-Host "  AUDIT COMPLETE — check output above." -ForegroundColor Green
    } else {
        Write-Host "  Nothing was running — system was already clean." -ForegroundColor Green
    }
} else {
    Write-Host "  Processes handled ($($KilledProcs.Count) total):"
    foreach ($entry in $KilledProcs) {
        $parts = $entry -split '\|', 2
        Write-Host "    [OK] PID $($parts[0]) — $($parts[1])" -ForegroundColor Green
    }
}

if ($SigkillRequired.Count -gt 0) {
    Write-Host ""
    Write-Host "  SHUTDOWN BUGS DETECTED:" -ForegroundColor Red
    foreach ($entry in $SigkillRequired) {
        $parts = $entry -split '\|', 2
        Write-Host "    [BUG] PID $($parts[0]) — $($parts[1]) could not be killed!" -ForegroundColor Red
    }
}

Write-Host ""
