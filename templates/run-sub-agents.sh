#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$ROOT/.agent-orchestrator.env"
[[ -f "$CONFIG" ]] || { echo "Missing $CONFIG. Run npx agent-orchestrator init." >&2; exit 1; }
source "$CONFIG"
ORCH="$ROOT/.agent-orchestrator"
mkdir -p "$ORCH/logs"
LOG="$ORCH/logs/supervisor.log"
exec 9>"$ORCH/supervisor.lock"
flock -n 9 || { echo "$(date -Is) Supervisor already active; skipping." >>"$LOG"; exit 0; }
echo "$(date -Is) Scanning project workers under $ROOT" >>"$LOG"
while IFS= read -r -d '' worker; do
  project="$(dirname -- "$worker")"
  [[ "$project" == "$ROOT" ]] && continue
  status="$project/.agent-status.json"
  if [[ ! -f "$status" ]] || python3 - "$status" <<'PY'
import json,sys
try:
 d=json.load(open(sys.argv[1],encoding='utf-8'))
 raise SystemExit(1 if d.get('development_complete') is True else 0)
except Exception: raise SystemExit(0)
PY
  then
    echo "$(date -Is) Starting worker: $project" >>"$LOG"
    (cd "$project" && nohup ./run-sub-agent.sh >>"$project/agent.log" 2>&1 </dev/null &)
  else
    echo "$(date -Is) Skipping completed project: $project" >>"$LOG"
  fi
done < <(find "$ROOT" -mindepth 2 \
  \( -path "$ORCH" -o -path '*/.git' -o -path '*/node_modules' \) -prune -o \
  -type f -name run-sub-agent.sh -print0)
