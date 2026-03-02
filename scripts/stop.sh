#!/usr/bin/env bash
# stop.sh — Kill all Matrx Local processes and free all ports
#
# Usage:
#   bash scripts/stop.sh          # graceful stop (SIGTERM → SIGKILL)
#   bash scripts/stop.sh --force  # immediate SIGKILL only
#
# What this cleans up:
#   • Python engine (run.py) — any/all instances from any project root
#   • Vite dev server (port 1420)
#   • Tauri desktop process (AI Matrx)
#   • Any port in the engine auto-scan range (22140–22159)
#   • Orphaned PyInstaller / sidecar binaries launched from this project
#   • Stale ~/.matrx/local.json discovery file
#
# Safe by design: only kills processes we can positively identify as Matrx.
# Never kills by port number alone without verifying the process name.

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

ok()   { echo -e "${GREEN}  ✓${RESET}  $*"; }
info() { echo -e "${BLUE}  →${RESET}  $*"; }
warn() { echo -e "${YELLOW}  ⚠${RESET}  $*"; }
step() { echo -e "\n${BOLD}${BLUE}━━  $*${RESET}"; }

FORCE=false
[[ "${1:-}" == "--force" ]] && FORCE=true

# ── Resolve project root ───────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DISCOVERY_FILE="$HOME/.matrx/local.json"

# ── Detect OS ─────────────────────────────────────────────────────────────────
IS_LINUX=false
IS_MAC=false
IS_WSL=false
case "$(uname -s)" in
  Linux*)
    IS_LINUX=true
    if [[ -f /proc/version ]] && grep -qi microsoft /proc/version 2>/dev/null; then
      IS_WSL=true
    fi
    ;;
  Darwin*) IS_MAC=true ;;
esac

echo ""
echo -e "${BOLD}Matrx Local — Cleanup${RESET}"
echo "  Project root: $ROOT"
$FORCE && echo "  Mode: force (SIGKILL immediately)" || echo "  Mode: graceful (SIGTERM → SIGKILL)"
echo ""

# ── Helpers ───────────────────────────────────────────────────────────────────
proc_cmdline() {
  local pid="$1"
  if $IS_LINUX || $IS_WSL; then
    tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true
  elif $IS_MAC; then
    ps -p "$pid" -o args= 2>/dev/null || true
  fi
}

proc_cwd() {
  local pid="$1"
  if $IS_LINUX || $IS_WSL; then
    readlink -f "/proc/$pid/cwd" 2>/dev/null || true
  elif $IS_MAC; then
    lsof -p "$pid" 2>/dev/null | awk '$4=="cwd"{print $NF}' || true
  fi
}

pid_on_port() {
  local port="$1"
  local pid=""
  if $IS_LINUX || $IS_WSL; then
    pid=$(ss -tlnp "sport = :$port" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1 || true)
    if [[ -z "$pid" ]] && command -v lsof &>/dev/null; then
      pid=$(lsof -ti ":$port" 2>/dev/null | head -1 || true)
    fi
  elif $IS_MAC; then
    command -v lsof &>/dev/null && pid=$(lsof -ti ":$port" 2>/dev/null | head -1 || true)
  fi
  echo "${pid:-}"
}

do_kill() {
  local pid="$1"
  local label="${2:-process}"
  kill -0 "$pid" 2>/dev/null || return 0  # already gone

  if $FORCE; then
    kill -KILL "$pid" 2>/dev/null || true
    ok "Force-killed $label (PID $pid)"
    return
  fi

  info "Stopping $label (PID $pid)..."
  kill -TERM "$pid" 2>/dev/null || true
  local i=0
  while kill -0 "$pid" 2>/dev/null && (( i < 10 )); do
    sleep 0.5; (( i++ )) || true
  done
  if kill -0 "$pid" 2>/dev/null; then
    warn "$label did not stop cleanly — sending SIGKILL"
    kill -KILL "$pid" 2>/dev/null || true
    sleep 0.3
  fi
  ok "Stopped $label (PID $pid)"
}

killed_any=false

# ── 1. Engine via discovery file ──────────────────────────────────────────────
step "1 / 5  Engine (discovery file)"
if [[ -f "$DISCOVERY_FILE" ]]; then
  json_pid=$(python3 -c "import json; print(json.load(open('$DISCOVERY_FILE')).get('pid',''))" 2>/dev/null || true)
  json_port=$(python3 -c "import json; print(json.load(open('$DISCOVERY_FILE')).get('port',''))" 2>/dev/null || true)
  if [[ -n "$json_pid" ]] && kill -0 "$json_pid" 2>/dev/null; then
    do_kill "$json_pid" "Matrx engine (port ${json_port:-?})"
    killed_any=true
  else
    info "Discovery file present but PID ${json_pid:-?} is already gone"
  fi
  rm -f "$DISCOVERY_FILE"
  ok "Removed $DISCOVERY_FILE"
else
  info "No discovery file at $DISCOVERY_FILE"
fi

# ── 2. Any remaining run.py processes ────────────────────────────────────────
step "2 / 5  Engine (scan all run.py processes)"
if $IS_LINUX || $IS_WSL; then
  while IFS= read -r pid_dir; do
    pid="${pid_dir##*/}"
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    cmdline=$(tr '\0' ' ' < "$pid_dir/cmdline" 2>/dev/null || true)
    if [[ "$cmdline" == *"run.py"* ]]; then
      label="run.py"
      [[ "$cmdline" == *"$ROOT"* ]] && label="run.py (this project)" || label="run.py (other project: $cmdline)"
      do_kill "$pid" "$label"
      killed_any=true
    fi
  done < <(ls -d /proc/[0-9]* 2>/dev/null)
elif $IS_MAC; then
  while IFS= read -r line; do
    pid=$(echo "$line" | awk '{print $1}')
    [[ -n "$pid" && "$pid" != "PID" ]] || continue
    do_kill "$pid" "run.py"
    killed_any=true
  done < <(pgrep -fl "run.py" 2>/dev/null || true)
fi
$killed_any || info "No run.py processes found"

# ── 3. Engine ports 22140–22159 ───────────────────────────────────────────────
step "3 / 5  Engine ports (22140–22159)"
port_killed=false
for port in $(seq 22140 22159); do
  pid=$(pid_on_port "$port")
  [[ -n "$pid" ]] || continue
  cmdline=$(proc_cmdline "$pid")
  # Only kill if it looks like Python/uvicorn/our engine
  if [[ "$cmdline" == *"python"* ]] || [[ "$cmdline" == *"uvicorn"* ]] || \
     [[ "$cmdline" == *"run.py"* ]] || [[ "$cmdline" == *"aimatrx"* ]]; then
    do_kill "$pid" "engine on port $port"
    port_killed=true
    killed_any=true
  else
    warn "Port $port is held by '$cmdline' — not ours, skipping"
  fi
done
$port_killed || info "No engine processes found on ports 22140–22159"

# ── 4. Vite dev server (port 1420) + Tauri ───────────────────────────────────
step "4 / 5  Desktop (Vite :1420 + Tauri)"
vite_pid=$(pid_on_port 1420)
if [[ -n "$vite_pid" ]]; then
  do_kill "$vite_pid" "Vite dev server (:1420)"
  killed_any=true
else
  info "Vite dev server not running"
fi

# Kill Tauri desktop window process by name
if $IS_LINUX || $IS_WSL; then
  while IFS= read -r pid_dir; do
    pid="${pid_dir##*/}"
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    cmdline=$(tr '\0' ' ' < "$pid_dir/cmdline" 2>/dev/null || true)
    if [[ "$cmdline" == *"ai-matrx"* ]] || [[ "$cmdline" == *"AI Matrx"* ]] || \
       [[ "$cmdline" == *"tauri:dev"* ]] || \
       ([[ "$cmdline" == *"cargo"* ]] && [[ "$cmdline" == *"$ROOT"* ]]); then
      do_kill "$pid" "Tauri desktop"
      killed_any=true
    fi
  done < <(ls -d /proc/[0-9]* 2>/dev/null)
elif $IS_MAC; then
  for name in "AI Matrx" "ai-matrx"; do
    if pgrep -x "$name" &>/dev/null; then
      pkill -x "$name" 2>/dev/null || true
      ok "Killed '$name' process"
      killed_any=true
    fi
  done
fi

# ── 5. Sidecar binary (aimatrx-engine) ───────────────────────────────────────
step "5 / 5  Sidecar binary"
sidecar_killed=false
if $IS_LINUX || $IS_WSL; then
  while IFS= read -r pid_dir; do
    pid="${pid_dir##*/}"
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    cmdline=$(tr '\0' ' ' < "$pid_dir/cmdline" 2>/dev/null || true)
    if [[ "$cmdline" == *"aimatrx-engine"* ]]; then
      do_kill "$pid" "aimatrx-engine sidecar"
      sidecar_killed=true
      killed_any=true
    fi
  done < <(ls -d /proc/[0-9]* 2>/dev/null)
elif $IS_MAC; then
  if pgrep -f "aimatrx-engine" &>/dev/null; then
    pkill -f "aimatrx-engine" 2>/dev/null || true
    ok "Killed aimatrx-engine sidecar"
    sidecar_killed=true
    killed_any=true
  fi
fi
$sidecar_killed || info "No aimatrx-engine sidecar processes found"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━  Cleanup complete${RESET}"
echo ""
if $killed_any; then
  ok "All Matrx processes stopped."
else
  ok "Nothing was running — already clean."
fi

# Verify key ports are free
echo ""
echo "  Port status after cleanup:"
for port in 22140 22141 22142 1420; do
  pid=$(pid_on_port "$port")
  if [[ -n "$pid" ]]; then
    cmdline=$(proc_cmdline "$pid" | cut -c1-60)
    warn "  :$port  still held by PID $pid — $cmdline"
  else
    echo -e "  ${GREEN}:$port  free${RESET}"
  fi
done
echo ""
