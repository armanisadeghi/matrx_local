#!/usr/bin/env bash
# stop.sh — Kill all Matrx Local processes and free all ports
#
# Usage:
#   bash scripts/stop.sh          # graceful stop (SIGTERM → SIGKILL)
#   bash scripts/stop.sh --force  # immediate SIGKILL only
#   bash scripts/stop.sh --audit  # report only — no killing (forensic mode)
#
# What this cleans up:
#   • Python engine (run.py) — any/all instances from any project root
#   • Vite dev server (port 1420)
#   • Tauri desktop process (AI Matrx / ai-matrx)
#   • Any port in the engine auto-scan range (22140–22159)
#   • Orphaned PyInstaller / sidecar binaries launched from this project
#   • Orphaned llama-server processes (local LLM inference)
#   • Orphaned openwakeword / OWW processes
#   • Zombie (defunct) children of any Matrx process
#   • Stale ~/.matrx/local.json discovery file
#
# IMPORTANT: If any process requires SIGKILL (did not respond to SIGTERM),
# that is reported as a BUG — it means the process has broken signal handling.

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

ok()    { echo -e "${GREEN}  ✓${RESET}  $*"; }
info()  { echo -e "${BLUE}  →${RESET}  $*"; }
warn()  { echo -e "${YELLOW}  ⚠${RESET}  $*"; }
err()   { echo -e "${RED}  ✗${RESET}  $*"; }
bug()   { echo -e "${RED}${BOLD}  !! BUG !!${RESET}  $*"; }
step()  { echo -e "\n${BOLD}${BLUE}━━  $*${RESET}"; }
detail(){ echo -e "${DIM}        $*${RESET}"; }
header(){ echo -e "${BOLD}${CYAN}        $*${RESET}"; }

FORCE=false
AUDIT=false
[[ "${1:-}" == "--force" ]] && FORCE=true
[[ "${1:-}" == "--audit" ]] && AUDIT=true

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
echo -e "${BOLD}Matrx Local — Process Cleanup & Forensic Report${RESET}"
echo "  Project root : $ROOT"
echo "  Timestamp    : $(date '+%Y-%m-%d %H:%M:%S %Z')"
if $AUDIT; then
  echo -e "  Mode         : ${CYAN}AUDIT ONLY — no processes will be killed${RESET}"
elif $FORCE; then
  echo -e "  Mode         : ${RED}force (SIGKILL immediately)${RESET}"
else
  echo -e "  Mode         : graceful (SIGTERM → SIGKILL after 5s)"
fi
echo ""

# ── Tracking arrays ───────────────────────────────────────────────────────────
# Each entry: "PID|label|cmdline|status"
declare -a KILLED_PROCS=()
declare -a SIGKILL_REQUIRED=()
declare -a ALREADY_GONE=()
declare -a NOT_OURS=()

# ── Helper: print forensic detail for a PID ───────────────────────────────────
proc_detail() {
  local pid="$1"
  local indent="${2:-        }"

  if $IS_MAC; then
    local name ppid start cpu mem rss
    name=$(ps -p "$pid" -o comm= 2>/dev/null | xargs basename 2>/dev/null || echo "?")
    ppid=$(ps -p "$pid" -o ppid= 2>/dev/null | tr -d ' ' || echo "?")
    start=$(ps -p "$pid" -o lstart= 2>/dev/null || echo "?")
    cpu=$(ps -p "$pid" -o %cpu= 2>/dev/null | tr -d ' ' || echo "?")
    mem=$(ps -p "$pid" -o %mem= 2>/dev/null | tr -d ' ' || echo "?")
    rss=$(ps -p "$pid" -o rss= 2>/dev/null | awk '{printf "%.1f MB", $1/1024}' || echo "?")
    local cmdline
    cmdline=$(ps -p "$pid" -o args= 2>/dev/null || echo "?")
    local cwd
    cwd=$(lsof -p "$pid" 2>/dev/null | awk '$4=="cwd"{print $NF}' | head -1 || echo "?")
    local open_files
    open_files=$(lsof -p "$pid" 2>/dev/null | wc -l | tr -d ' ' || echo "?")
    local open_sockets
    open_sockets=$(lsof -p "$pid" -i 2>/dev/null | grep -c ESTABLISHED 2>/dev/null || echo "0")

    echo -e "${indent}${BOLD}PID${RESET}           : $pid"
    echo -e "${indent}${BOLD}Process name${RESET}  : $name"
    echo -e "${indent}${BOLD}PPID${RESET}          : $ppid"
    echo -e "${indent}${BOLD}Started${RESET}       : $start"
    echo -e "${indent}${BOLD}CPU%${RESET}          : ${cpu}%"
    echo -e "${indent}${BOLD}MEM%${RESET}          : ${mem}%  (RSS: $rss)"
    echo -e "${indent}${BOLD}Open FDs${RESET}      : $open_files"
    echo -e "${indent}${BOLD}ESTABLISHED${RESET}   : $open_sockets active network connections"
    echo -e "${indent}${BOLD}CWD${RESET}           : $cwd"
    echo -e "${indent}${BOLD}Full cmdline${RESET}  : $cmdline"

    # Show any open network connections for this PID
    local net_lines
    net_lines=$(lsof -p "$pid" -i -n -P 2>/dev/null | grep -E "TCP|UDP" | head -10 || true)
    if [[ -n "$net_lines" ]]; then
      echo -e "${indent}${BOLD}Network${RESET}       :"
      while IFS= read -r line; do
        echo -e "${indent}  ${DIM}$line${RESET}"
      done <<< "$net_lines"
    fi

  elif $IS_LINUX || $IS_WSL; then
    local name ppid start cpu mem rss
    name=$(cat "/proc/$pid/comm" 2>/dev/null || echo "?")
    ppid=$(awk '/PPid/{print $2}' "/proc/$pid/status" 2>/dev/null || echo "?")
    start=$(ps -p "$pid" -o lstart= 2>/dev/null || echo "?")
    cpu=$(ps -p "$pid" -o %cpu= 2>/dev/null | tr -d ' ' || echo "?")
    mem=$(ps -p "$pid" -o %mem= 2>/dev/null | tr -d ' ' || echo "?")
    rss=$(awk '/VmRSS/{printf "%.1f MB", $2/1024}' "/proc/$pid/status" 2>/dev/null || echo "?")
    local cmdline
    cmdline=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || echo "?")
    local cwd
    cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || echo "?")
    local open_files
    open_files=$(ls /proc/"$pid"/fd 2>/dev/null | wc -l || echo "?")
    local open_sockets
    open_sockets=$(ss -p 2>/dev/null | grep -c "pid=$pid," 2>/dev/null || echo "0")

    echo -e "${indent}${BOLD}PID${RESET}           : $pid"
    echo -e "${indent}${BOLD}Process name${RESET}  : $name"
    echo -e "${indent}${BOLD}PPID${RESET}          : $ppid"
    echo -e "${indent}${BOLD}Started${RESET}       : $start"
    echo -e "${indent}${BOLD}CPU%${RESET}          : ${cpu}%"
    echo -e "${indent}${BOLD}MEM%${RESET}          : ${mem}%  (RSS: $rss)"
    echo -e "${indent}${BOLD}Open FDs${RESET}      : $open_files"
    echo -e "${indent}${BOLD}ESTABLISHED${RESET}   : $open_sockets active network connections"
    echo -e "${indent}${BOLD}CWD${RESET}           : $cwd"
    echo -e "${indent}${BOLD}Full cmdline${RESET}  : $cmdline"
  fi
}

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

port_tcp_states() {
  local port="$1"
  if $IS_MAC; then
    lsof -i ":$port" -n -P 2>/dev/null | grep -E "TCP|UDP" || true
  elif $IS_LINUX || $IS_WSL; then
    ss -tnp "sport = :$port or dport = :$port" 2>/dev/null || true
  fi
}

# do_kill: kill a process, tracking whether SIGKILL was required
# Sets global SIGKILL_WAS_REQUIRED=true if SIGKILL was needed
SIGKILL_WAS_REQUIRED=false
do_kill() {
  local pid="$1"
  local label="${2:-process}"
  SIGKILL_WAS_REQUIRED=false

  if ! kill -0 "$pid" 2>/dev/null; then
    ALREADY_GONE+=("$pid|$label|already-gone")
    info "$label (PID $pid) — already gone before we could kill it"
    return 0
  fi

  if $AUDIT; then
    warn "[AUDIT] Would kill: $label (PID $pid)"
    proc_detail "$pid"
    return 0
  fi

  if $FORCE; then
    kill -KILL "$pid" 2>/dev/null || true
    sleep 0.3
    if kill -0 "$pid" 2>/dev/null; then
      err "Force-kill FAILED for $label (PID $pid) — process survived SIGKILL!"
    else
      ok "Force-killed $label (PID $pid)"
      KILLED_PROCS+=("$pid|$label|SIGKILL")
      SIGKILL_WAS_REQUIRED=true
    fi
    return
  fi

  info "Stopping $label (PID $pid) with SIGTERM..."
  kill -TERM "$pid" 2>/dev/null || true
  local i=0
  while kill -0 "$pid" 2>/dev/null && (( i < 10 )); do
    sleep 0.5; (( i++ )) || true
  done

  if kill -0 "$pid" 2>/dev/null; then
    echo ""
    bug "$label (PID $pid) DID NOT RESPOND TO SIGTERM — this is a shutdown bug!"
    echo -e "     ${RED}The process ignored SIGTERM and must be force-killed (SIGKILL).${RESET}"
    echo -e "     ${RED}This means the app has broken signal handling or a stuck thread.${RESET}"
    echo -e "     ${YELLOW}Full process details at time of SIGKILL:${RESET}"
    proc_detail "$pid" "     "
    echo ""
    kill -KILL "$pid" 2>/dev/null || true
    sleep 0.3
    if kill -0 "$pid" 2>/dev/null; then
      err "SIGKILL also failed for $label (PID $pid) — process is UNKILLABLE. Kernel-level issue."
      SIGKILL_REQUIRED+=("$pid|$label|unkillable")
    else
      warn "Force-killed $label (PID $pid) — SIGTERM was ignored (BUG)"
      KILLED_PROCS+=("$pid|$label|SIGKILL-required")
      SIGKILL_REQUIRED+=("$pid|$label|required-SIGKILL")
      SIGKILL_WAS_REQUIRED=true
    fi
  else
    ok "Stopped $label (PID $pid) cleanly via SIGTERM"
    KILLED_PROCS+=("$pid|$label|SIGTERM")
  fi
}

killed_any=false

# ── 1. Engine via discovery file ──────────────────────────────────────────────
step "1 / 9  Engine (discovery file: $DISCOVERY_FILE)"
if [[ -f "$DISCOVERY_FILE" ]]; then
  echo -e "  ${CYAN}Discovery file contents:${RESET}"
  cat "$DISCOVERY_FILE" | python3 -m json.tool 2>/dev/null | sed 's/^/    /' || cat "$DISCOVERY_FILE" | sed 's/^/    /'
  echo ""
  json_pid=$(python3 -c "import json; print(json.load(open('$DISCOVERY_FILE')).get('pid',''))" 2>/dev/null || true)
  json_port=$(python3 -c "import json; print(json.load(open('$DISCOVERY_FILE')).get('port',''))" 2>/dev/null || true)
  json_url=$(python3 -c "import json; print(json.load(open('$DISCOVERY_FILE')).get('url',''))" 2>/dev/null || true)

  if [[ -n "$json_pid" ]] && kill -0 "$json_pid" 2>/dev/null; then
    echo -e "  ${YELLOW}Engine is RUNNING:${RESET}"
    proc_detail "$json_pid" "  "
    echo ""
    do_kill "$json_pid" "Matrx engine (port ${json_port:-?}, url ${json_url:-?})"
    killed_any=true
  else
    warn "Discovery file present but PID ${json_pid:-?} is already gone — engine crashed or was killed externally"
  fi
  if ! $AUDIT; then
    rm -f "$DISCOVERY_FILE"
    ok "Removed stale discovery file: $DISCOVERY_FILE"
  fi
else
  ok "No discovery file — engine was not running (clean state)"
fi

# ── 2. Any remaining run.py processes ────────────────────────────────────────
step "2 / 9  Engine (scan all run.py processes system-wide)"
found_run_py=false
if $IS_LINUX || $IS_WSL; then
  while IFS= read -r pid_dir; do
    pid="${pid_dir##*/}"
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    [[ -r "$pid_dir/cmdline" ]] || continue
    cmdline=$(tr '\0' ' ' < "$pid_dir/cmdline" 2>/dev/null) || continue
    if [[ "$cmdline" == *"run.py"* ]]; then
      found_run_py=true
      if [[ "$cmdline" == *"$ROOT"* ]]; then
        label="run.py (THIS project — $ROOT)"
      else
        cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || echo "unknown")
        label="run.py (OTHER project — cwd: $cwd)"
      fi
      echo -e "  ${YELLOW}Found run.py process:${RESET}"
      proc_detail "$pid" "  "
      echo ""
      do_kill "$pid" "$label"
      killed_any=true
    fi
  done < <(ls -d /proc/[0-9]* 2>/dev/null)
elif $IS_MAC; then
  while IFS= read -r line; do
    pid=$(echo "$line" | awk '{print $1}')
    [[ -n "$pid" && "$pid" != "PID" ]] || continue
    found_run_py=true
    cmdline=$(ps -p "$pid" -o args= 2>/dev/null || echo "?")
    if [[ "$cmdline" == *"$ROOT"* ]]; then
      label="run.py (THIS project)"
    else
      label="run.py (OTHER project)"
    fi
    echo -e "  ${YELLOW}Found run.py process:${RESET}"
    proc_detail "$pid" "  "
    echo ""
    do_kill "$pid" "$label"
    killed_any=true
  done < <(pgrep -fl "run.py" 2>/dev/null || true)
fi
$found_run_py || ok "No run.py processes found — engine is not running"

# ── 3. Engine ports 22140–22159 ───────────────────────────────────────────────
step "3 / 9  Engine ports (22140–22159)"
port_killed=false
for port in $(seq 22140 22159); do
  pid=$(pid_on_port "$port")
  [[ -n "$pid" ]] || continue
  cmdline=$(proc_cmdline "$pid")

  if [[ "$cmdline" == *"python"* ]] || [[ "$cmdline" == *"uvicorn"* ]] || \
     [[ "$cmdline" == *"run.py"* ]] || [[ "$cmdline" == *"aimatrx"* ]]; then

    echo -e "  ${YELLOW}Engine process holding port $port:${RESET}"
    proc_detail "$pid" "  "
    echo ""
    # Show TCP states on this port
    tcp_state=$(port_tcp_states "$port")
    if [[ -n "$tcp_state" ]]; then
      echo -e "  ${CYAN}TCP connections on port $port:${RESET}"
      while IFS= read -r line; do
        echo -e "    ${DIM}$line${RESET}"
      done <<< "$tcp_state"
      echo ""
    fi

    do_kill "$pid" "engine on port $port"
    port_killed=true
    killed_any=true
  else
    warn "Port $port is held by a NON-MATRX process (not killing):"
    echo -e "  PID $pid — $cmdline"
    NOT_OURS+=("$port|$pid|$cmdline")
  fi
done
$port_killed || ok "No engine processes on ports 22140–22159"

# ── 4. Vite dev server (port 1420) + Tauri ───────────────────────────────────
step "4 / 9  Desktop (Vite :1420 + Tauri)"
vite_pid=$(pid_on_port 1420)
if [[ -n "$vite_pid" ]]; then
  echo -e "  ${YELLOW}Vite dev server still running on :1420:${RESET}"
  proc_detail "$vite_pid" "  "
  echo ""
  do_kill "$vite_pid" "Vite dev server (:1420)"
  killed_any=true
else
  ok "Vite dev server not running"
fi

# Kill Tauri desktop window process by name
tauri_killed=false
if $IS_LINUX || $IS_WSL; then
  while IFS= read -r pid_dir; do
    pid="${pid_dir##*/}"
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    [[ -r "$pid_dir/cmdline" ]] || continue
    cmdline=$(tr '\0' ' ' < "$pid_dir/cmdline" 2>/dev/null) || continue
    if [[ "$cmdline" == *"ai-matrx"* ]] || [[ "$cmdline" == *"AI Matrx"* ]] || \
       [[ "$cmdline" == *"tauri:dev"* ]] || \
       ([[ "$cmdline" == *"cargo"* ]] && [[ "$cmdline" == *"$ROOT"* ]]); then
      echo -e "  ${YELLOW}Tauri desktop process found:${RESET}"
      proc_detail "$pid" "  "
      echo ""
      do_kill "$pid" "Tauri desktop"
      killed_any=true
      tauri_killed=true
    fi
  done < <(ls -d /proc/[0-9]* 2>/dev/null)
elif $IS_MAC; then
  for name in "AI Matrx" "ai-matrx" "AI_Matrx" "aimatrx"; do
    while IFS= read -r pid; do
      [[ -n "$pid" ]] || continue
      echo -e "  ${YELLOW}Tauri process '$name' found:${RESET}"
      proc_detail "$pid" "  "
      echo ""
      if ! $AUDIT; then
        kill -TERM "$pid" 2>/dev/null || true
        sleep 1
        if kill -0 "$pid" 2>/dev/null; then
          bug "'$name' (PID $pid) DID NOT RESPOND TO SIGTERM — force-killing"
          proc_detail "$pid" "     "
          kill -KILL "$pid" 2>/dev/null || true
          SIGKILL_REQUIRED+=("$pid|$name|required-SIGKILL")
        else
          ok "Killed '$name' process (PID $pid)"
        fi
        KILLED_PROCS+=("$pid|$name|killed")
      fi
      killed_any=true
      tauri_killed=true
    done < <(pgrep -x "$name" 2>/dev/null || true)
  done
fi
$tauri_killed || ok "No Tauri desktop processes found"

# ── 5. Sidecar binary (aimatrx-engine) ───────────────────────────────────────
step "5 / 9  Sidecar binary (aimatrx-engine)"
sidecar_killed=false
if $IS_LINUX || $IS_WSL; then
  while IFS= read -r pid_dir; do
    pid="${pid_dir##*/}"
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    [[ -r "$pid_dir/cmdline" ]] || continue
    cmdline=$(tr '\0' ' ' < "$pid_dir/cmdline" 2>/dev/null) || continue
    if [[ "$cmdline" == *"aimatrx-engine"* ]]; then
      echo -e "  ${YELLOW}aimatrx-engine sidecar found:${RESET}"
      proc_detail "$pid" "  "
      echo ""
      do_kill "$pid" "aimatrx-engine sidecar"
      sidecar_killed=true
      killed_any=true
    fi
  done < <(ls -d /proc/[0-9]* 2>/dev/null)
elif $IS_MAC; then
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    echo -e "  ${YELLOW}aimatrx-engine sidecar found:${RESET}"
    proc_detail "$pid" "  "
    echo ""
    do_kill "$pid" "aimatrx-engine sidecar (PID $pid)"
    sidecar_killed=true
    killed_any=true
  done < <(pgrep -f "aimatrx-engine" 2>/dev/null || true)
fi
$sidecar_killed || ok "No aimatrx-engine sidecar processes found"

# ── 6. Orphaned llama-server processes ───────────────────────────────────────
step "6 / 9  Orphaned llama-server (local LLM inference)"
llama_killed=false
if $IS_MAC; then
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    echo -e "  ${YELLOW}Orphaned llama-server process found — this should have been killed by Tauri:${RESET}"
    proc_detail "$pid" "  "
    echo ""
    do_kill "$pid" "llama-server (orphaned)"
    llama_killed=true
    killed_any=true
  done < <(pgrep -f "llama-server" 2>/dev/null || true)
elif $IS_LINUX || $IS_WSL; then
  while IFS= read -r pid_dir; do
    pid="${pid_dir##*/}"
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    [[ -r "$pid_dir/cmdline" ]] || continue
    cmdline=$(tr '\0' ' ' < "$pid_dir/cmdline" 2>/dev/null) || continue
    if [[ "$cmdline" == *"llama-server"* ]] || [[ "$cmdline" == *"llama_server"* ]]; then
      echo -e "  ${YELLOW}Orphaned llama-server process found:${RESET}"
      proc_detail "$pid" "  "
      echo ""
      do_kill "$pid" "llama-server (orphaned)"
      llama_killed=true
      killed_any=true
    fi
  done < <(ls -d /proc/[0-9]* 2>/dev/null)
fi
$llama_killed || ok "No orphaned llama-server processes found"

# ── 7. Orphaned openwakeword / OWW processes ─────────────────────────────────
step "7 / 9  Orphaned wake-word engine (openwakeword / OWW)"
oww_killed=false
if $IS_MAC; then
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    echo -e "  ${YELLOW}Orphaned OWW/openwakeword process found:${RESET}"
    proc_detail "$pid" "  "
    echo ""
    do_kill "$pid" "openwakeword (orphaned)"
    oww_killed=true
    killed_any=true
  done < <(pgrep -f "openwakeword\|oww\|wake.word\|wake_word" 2>/dev/null || true)
elif $IS_LINUX || $IS_WSL; then
  while IFS= read -r pid_dir; do
    pid="${pid_dir##*/}"
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    [[ -r "$pid_dir/cmdline" ]] || continue
    cmdline=$(tr '\0' ' ' < "$pid_dir/cmdline" 2>/dev/null) || continue
    if [[ "$cmdline" == *"openwakeword"* ]] || [[ "$cmdline" == *"wake_word"* ]]; then
      echo -e "  ${YELLOW}Orphaned OWW process found:${RESET}"
      proc_detail "$pid" "  "
      echo ""
      do_kill "$pid" "openwakeword (orphaned)"
      oww_killed=true
      killed_any=true
    fi
  done < <(ls -d /proc/[0-9]* 2>/dev/null)
fi
$oww_killed || ok "No orphaned wake-word processes found"

# ── 8. Zombie (defunct) children ─────────────────────────────────────────────
step "8 / 9  Zombie (defunct) processes related to Matrx"
echo "  Scanning for zombie processes from any Matrx parent..."
zombie_found=false

if $IS_MAC; then
  # ps -A shows all processes; grep for Z state and any matrx-related name
  while IFS= read -r line; do
    pid=$(echo "$line" | awk '{print $1}')
    ppid=$(echo "$line" | awk '{print $2}')
    stat=$(echo "$line" | awk '{print $3}')
    name=$(echo "$line" | awk '{print $4}')

    if [[ "$stat" == *"Z"* ]]; then
      # Check if parent is a matrx process
      parent_cmd=$(ps -p "$ppid" -o args= 2>/dev/null || echo "")
      if [[ "$parent_cmd" == *"matrx"* ]] || [[ "$parent_cmd" == *"run.py"* ]] || \
         [[ "$parent_cmd" == *"aimatrx"* ]] || [[ "$name" == *"matrx"* ]]; then
        zombie_found=true
        echo -e "  ${RED}ZOMBIE PROCESS FOUND — leaked from Matrx parent:${RESET}"
        echo -e "    PID: $pid  PPID: $ppid  Name: $name  State: $stat"
        echo -e "    Parent cmdline: $parent_cmd"
        echo -e "    ${DIM}(Zombie processes cannot be killed — they are reaped when the parent exits)${RESET}"
      fi
    fi
  done < <(ps -A -o pid,ppid,stat,comm 2>/dev/null | tail -n +2 || true)

elif $IS_LINUX || $IS_WSL; then
  while IFS= read -r pid_dir; do
    pid="${pid_dir##*/}"
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    status_file="/proc/$pid/status"
    [[ -r "$status_file" ]] || continue
    state=$(awk '/^State:/{print $2}' "$status_file" 2>/dev/null || echo "")
    if [[ "$state" == "Z" ]]; then
      ppid=$(awk '/PPid/{print $2}' "$status_file" 2>/dev/null || echo "?")
      name=$(awk '/^Name:/{print $2}' "$status_file" 2>/dev/null || echo "?")
      parent_cmd=""
      [[ -r "/proc/$ppid/cmdline" ]] && parent_cmd=$(tr '\0' ' ' < "/proc/$ppid/cmdline" 2>/dev/null || echo "")
      if [[ "$parent_cmd" == *"matrx"* ]] || [[ "$parent_cmd" == *"run.py"* ]] || \
         [[ "$parent_cmd" == *"aimatrx"* ]] || [[ "$name" == *"matrx"* ]]; then
        zombie_found=true
        echo -e "  ${RED}ZOMBIE PROCESS FOUND — leaked from Matrx parent:${RESET}"
        echo -e "    PID: $pid  PPID: $ppid  Name: $name  State: zombie"
        echo -e "    Parent cmdline: $parent_cmd"
        echo -e "    ${DIM}(Zombie processes cannot be killed — they are reaped when the parent exits)${RESET}"
      fi
    fi
  done < <(ls -d /proc/[0-9]* 2>/dev/null)
fi
$zombie_found || ok "No zombie processes found related to Matrx"

# ── 9. Post-kill: check TCP connections still active ─────────────────────────
step "9 / 9  TCP connection audit on all Matrx ports"
echo "  Checking for lingering TCP connections after cleanup..."
echo ""

check_port_state() {
  local port="$1"
  local label="${2:-port $port}"
  local pid remaining_pid

  pid=$(pid_on_port "$port")
  if [[ -n "$pid" ]]; then
    cmdline=$(proc_cmdline "$pid" | cut -c1-100)
    err "  :$port  STILL HELD by PID $pid — $cmdline"
    proc_detail "$pid" "    "
    echo ""
    return 1
  fi

  # Check for lingering TCP connections even without a listener
  local conns
  conns=$(port_tcp_states "$port" 2>/dev/null || true)
  if [[ -n "$conns" ]]; then
    warn "  :$port  no listener but lingering TCP connections:"
    while IFS= read -r line; do
      echo -e "    ${DIM}$line${RESET}"
    done <<< "$conns"
    return 1
  fi

  echo -e "  ${GREEN}:$port${RESET}  free — no listener, no lingering connections"
  return 0
}

all_ports_clean=true
for port in 22140 22141 22142 22143 22144 22145 1420 22180; do
  check_port_state "$port" || all_ports_clean=false
done

# Check for any remaining connections to the engine port range
echo ""
echo -e "  ${CYAN}Full port range 22140-22159 quick scan:${RESET}"
for port in $(seq 22143 22159); do
  pid=$(pid_on_port "$port")
  if [[ -n "$pid" ]]; then
    cmdline=$(proc_cmdline "$pid" | cut -c1-80)
    err "  :$port  held by PID $pid — $cmdline"
    all_ports_clean=false
  fi
done
$all_ports_clean && echo -e "  ${GREEN}Ports 22143–22159 all free${RESET}"

# ── Final Summary ─────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}  CLEANUP SUMMARY${RESET}"
echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

if [[ ${#KILLED_PROCS[@]} -eq 0 ]]; then
  if $AUDIT; then
    ok "AUDIT COMPLETE — No running Matrx processes found."
  else
    ok "Nothing was running — system was already clean."
  fi
else
  echo -e "  ${BOLD}Processes handled (${#KILLED_PROCS[@]} total):${RESET}"
  for entry in "${KILLED_PROCS[@]}"; do
    IFS='|' read -r pid label method <<< "$entry"
    if [[ "$method" == "SIGKILL-required" ]] || [[ "$method" == "SIGKILL" ]]; then
      echo -e "  ${RED}✗${RESET}  PID $pid — $label  ${RED}[SIGKILL REQUIRED — BUG]${RESET}"
    else
      echo -e "  ${GREEN}✓${RESET}  PID $pid — $label  ${DIM}[$method]${RESET}"
    fi
  done
fi

echo ""

if [[ ${#SIGKILL_REQUIRED[@]} -gt 0 ]]; then
  echo ""
  echo -e "  ${RED}${BOLD}╔══════════════════════════════════════════════════════════════════╗${RESET}"
  echo -e "  ${RED}${BOLD}║  SHUTDOWN BUGS DETECTED — SIGKILL was required for:              ║${RESET}"
  echo -e "  ${RED}${BOLD}╚══════════════════════════════════════════════════════════════════╝${RESET}"
  echo ""
  for entry in "${SIGKILL_REQUIRED[@]}"; do
    IFS='|' read -r pid label status <<< "$entry"
    echo -e "  ${RED}  •  PID $pid — $label${RESET}"
    echo -e "     This process ignored SIGTERM. It has a broken shutdown path."
    echo -e "     Root cause must be fixed to prevent enterprise machine resource leaks."
  done
  echo ""
fi

if [[ ${#NOT_OURS[@]} -gt 0 ]]; then
  echo -e "  ${YELLOW}Non-Matrx processes on Matrx ports (NOT killed — investigate):${RESET}"
  for entry in "${NOT_OURS[@]}"; do
    IFS='|' read -r port pid cmdline <<< "$entry"
    echo -e "  ${YELLOW}  •  :$port  PID $pid — $cmdline${RESET}"
  done
  echo ""
fi

echo ""
