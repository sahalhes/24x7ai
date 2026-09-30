#!/usr/bin/env bash
set -Eeuo pipefail
SELF_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${PROJECTS_ROOT:-$SELF_DIR}"
CONFIG="$ROOT/.agent-orchestrator.env"
ORCH="$ROOT/.agent-orchestrator"
STATE="$ORCH/state.json"
LOG="$ORCH/logs/master.log"
LOCK="$ORCH/master.lock"
[[ -f "$CONFIG" ]] || { echo "Missing $CONFIG. Run npx 24x7ai init." >&2; exit 1; }
source "$CONFIG"
read -r -a AGENT_ARGS_ARRAY <<< "${AGENT_ARGS:-}"
mkdir -p "$ORCH/logs"
exec 9>"$LOCK"
if ! flock -n 9; then echo "$(date -Is) Previous master run is active; skipping." >> "$LOG"; exit 0; fi
log() { echo "$(date -Is) $*" | tee -a "$LOG"; }
fail() { log "ERROR: $*"; exit 1; }
trap 'fail "Unexpected failure at line $LINENO (exit $?)."' ERR
if [[ ! -f "$STATE" ]]; then printf '{"current_sl_no":1,"active_mvp":null,"last_completed_mvp":null,"last_run":null,"projects":{}}\n' > "$STATE"; fi
IDEA_FILE="$ORCH/ideas.csv"
case "${IDEA_SOURCE_TYPE:-}" in
  csv-url) curl -fsSL "$IDEA_SOURCE" -o "$IDEA_FILE" || fail "Could not download idea CSV." ;;
  local-csv) cp -- "$IDEA_SOURCE" "$IDEA_FILE" || fail "Could not read local idea CSV." ;;
  *) fail "IDEA_SOURCE_TYPE must be csv-url or local-csv." ;;
esac
PROJECT_JSON="$(python3 "$ORCH/next_project.py" "$IDEA_FILE" "$STATE")" || fail "Could not select project."
if [[ "$PROJECT_JSON" == NO_PROJECT ]]; then log "No eligible project found."; exit 0; fi
readarray -t FIELDS < <(python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["sl_no"]); print(d["idea"]); print(d["automatable"])' <<<"$PROJECT_JSON")
SL="${FIELDS[0]}"; IDEA="${FIELDS[1]}"; AUTOMATABLE="${FIELDS[2]}"
SLUG="$(python3 - "$IDEA" <<'PY'
import re,sys,unicodedata
s=unicodedata.normalize('NFKD', sys.argv[1]).encode('ascii', 'ignore').decode().lower()
s=re.sub(r'[^a-z0-9]+','-',s).strip('-')[:70].strip('-')
print(s or 'project')
PY
)"
PROJECT="$ROOT/$SLUG"
log "Selected Sl No $SL: $IDEA (automation: $AUTOMATABLE)"
mkdir -p "$PROJECT"
cd "$PROJECT"
if [[ ! -d .git ]]; then git init -b main >>"$LOG" 2>&1; git config user.name "${GIT_USER_NAME:-Autonomous Agent}"; git config user.email "${GIT_USER_EMAIL:-agent@localhost}"; fi
if [[ ! -f AGENTS.md ]]; then cat > AGENTS.md <<EOF
# Autonomous Development Instructions

Project: $IDEA
Idea serial number: $SL

Work only in this repository and on the dev branch. Never force push or modify main after initial setup. Preserve unrelated user work. Build small working increments, document setup and usage, and do not claim external validation or manual work. Maintain .agent-status.json. MVP completion and ongoing development completion are separate states.
EOF
fi
if [[ ! -f AUTODEVELOP.md ]]; then cat > AUTODEVELOP.md <<'EOF'
# Continuous Development

Inspect the code, README, tests and recent history. Choose one useful improvement, implement it, run relevant checks, update documentation and .agent-status.json. Commit and push only to dev if the configured outer workflow allows it. Never claim unperformed tests, deployments, customer feedback or external work.
EOF
fi
if git show-ref --verify --quiet refs/heads/dev; then git checkout dev >>"$LOG" 2>&1; else git checkout -b dev >>"$LOG" 2>&1; fi
printf '%s\n' "$PROJECT_JSON" > .project-source.json
cat > run-sub-agent.sh <<'CHILD'
#!/usr/bin/env bash
set -Eeuo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname -- "$HERE")"
source "$ROOT/.agent-orchestrator.env"
read -r -a AGENT_ARGS_ARRAY <<< "${AGENT_ARGS:-}"
mkdir -p "$ROOT/.agent-orchestrator/logs"
WORKER_ID="$(python3 -c 'import hashlib,sys; print(hashlib.sha256(sys.argv[1].encode()).hexdigest()[:20])' "$HERE")"
mkdir -p "$ROOT/.agent-orchestrator/locks"
exec 9>"$ROOT/.agent-orchestrator/locks/$WORKER_ID.lock"
flock -n 9 || exit 0
cd "$HERE"
LOG="$HERE/agent.log"
if [[ "$(git branch --show-current)" != dev ]]; then echo "Worker requires dev branch; refusing to run." | tee -a "$LOG"; exit 2; fi
PROMPT='Read AGENTS.md, AUTODEVELOP.md, .project-source.json and .agent-status.json. Inspect this repository and implement one useful, coherent improvement toward its MVP or ongoing development. Make actual code changes, update README and status, and run relevant local checks. Stay on dev. Do not claim external work or tests that were not performed. Do not run git push or modify main.'
case "${AGENT_PROVIDER:-custom}" in
  codex) "$AGENT_COMMAND" "${AGENT_ARGS_ARRAY[@]}" -a never --sandbox workspace-write -C "$HERE" exec "$PROMPT" >>"$LOG" 2>&1 ;;
  opencode) "$AGENT_COMMAND" "${AGENT_ARGS_ARRAY[@]}" run "$PROMPT" >>"$LOG" 2>&1 ;;
  claude) "$AGENT_COMMAND" "${AGENT_ARGS_ARRAY[@]}" -p "$PROMPT" >>"$LOG" 2>&1 ;;
  custom) "$AGENT_COMMAND" "${AGENT_ARGS_ARRAY[@]}" "$PROMPT" >>"$LOG" 2>&1 ;;
  *) echo "Unsupported AGENT_PROVIDER: $AGENT_PROVIDER" >>"$LOG"; exit 2 ;;
esac
[[ -f .agent-status.json ]] || { echo "Worker did not create .agent-status.json" | tee -a "$LOG"; exit 1; }
python3 -m json.tool .agent-status.json >/dev/null || { echo "Worker created invalid .agent-status.json" | tee -a "$LOG"; exit 1; }
if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  git commit -m "chore: continuous development update" >>"$LOG" 2>&1
  if [[ -n "${GITHUB_OWNER:-}" ]] && git remote get-url origin >/dev/null 2>&1; then
    git push origin dev >>"$LOG" 2>&1
  fi
fi
CHILD
chmod +x run-sub-agent.sh
PROMPT="Read AGENTS.md, AUTODEVELOP.md and .project-source.json. Build or continue the smallest genuinely useful working MVP for idea Sl No $SL: $IDEA. Inspect and preserve existing work. Work only in this repository on dev. Implement actual code, document setup and usage, and run relevant local checks. If automation is partial, do not claim manual, hardware, deployment, customer or business validation. Maintain valid .agent-status.json with sl_no, project, status, mvp_complete, development_complete, branch, last_run, next_action and blocked. Set mvp_complete true only when the coding-agent portion is implemented and appropriate local checks pass. Never set development_complete merely because the MVP works. Create/update run-sub-agent.sh for future continuous development. Do not git add, commit, push, create a remote or modify main; the outer orchestrator handles GitHub. Leave implementation changes in the working tree."
log "Starting ${AGENT_PROVIDER:-custom} MVP worker."
case "${AGENT_PROVIDER:-custom}" in
  codex) "$AGENT_COMMAND" "${AGENT_ARGS_ARRAY[@]}" -a never --sandbox workspace-write -C "$PROJECT" exec "$PROMPT" >>"$LOG" 2>&1 ;;
  opencode) "$AGENT_COMMAND" "${AGENT_ARGS_ARRAY[@]}" run "$PROMPT" >>"$LOG" 2>&1 ;;
  claude) "$AGENT_COMMAND" "${AGENT_ARGS_ARRAY[@]}" -p "$PROMPT" >>"$LOG" 2>&1 ;;
  custom) "$AGENT_COMMAND" "${AGENT_ARGS_ARRAY[@]}" "$PROMPT" >>"$LOG" 2>&1 ;;
  *) fail "Unsupported AGENT_PROVIDER: $AGENT_PROVIDER" ;;
esac
[[ -f .agent-status.json ]] || fail "Agent did not create .agent-status.json."
python3 -m json.tool .agent-status.json >/dev/null || fail ".agent-status.json is invalid JSON."
MVP_COMPLETE="$(python3 -c 'import json; print("true" if json.load(open(".agent-status.json",encoding="utf-8")).get("mvp_complete") is True else "false")')"
if [[ -n "$(git status --porcelain)" ]]; then git add -A; git commit -m "feat: autonomous MVP progress for idea $SL" >>"$LOG" 2>&1 || fail "Commit failed."; fi
if [[ -n "${GITHUB_OWNER:-}" ]]; then
  if ! git remote get-url origin >/dev/null 2>&1; then
    if gh repo view "$GITHUB_OWNER/$SLUG" >/dev/null 2>&1; then git remote add origin "git@github.com:$GITHUB_OWNER/$SLUG.git";
    else PRIVATE_FLAG=(); [[ "${GITHUB_PRIVATE:-true}" == true ]] && PRIVATE_FLAG+=(--private); gh repo create "$GITHUB_OWNER/$SLUG" "${PRIVATE_FLAG[@]}" --source=. --remote=origin >>"$LOG" 2>&1 || fail "GitHub repository creation failed."; fi
  fi
  if ! git ls-remote --exit-code --heads origin main >/dev/null 2>&1; then git branch -f main HEAD; git push -u origin main >>"$LOG" 2>&1; git checkout dev >>"$LOG" 2>&1; fi
  git push -u origin dev >>"$LOG" 2>&1 || fail "Push to origin/dev failed."
fi
python3 - "$STATE" "$SL" "$SLUG" "$MVP_COMPLETE" <<'PY'
import json,sys
from datetime import datetime,timezone
p,sl,slug,complete=sys.argv[1:]
with open(p,encoding='utf-8') as f: d=json.load(f)
sl=int(sl); now=datetime.now(timezone.utc).isoformat(); d['last_run']=now; d.setdefault('projects',{})[str(sl)]={'folder':slug,'mvp_complete':complete=='true','development_complete':False}
if complete=='true': d['last_completed_mvp']=sl; d['current_sl_no']=max(int(d.get('current_sl_no',1)),sl+1); d['active_mvp']=None
else: d['active_mvp']=sl
with open(p,'w',encoding='utf-8') as f: json.dump(d,f,indent=2); f.write('\n')
PY
log "Idea $SL MVP $([[ "$MVP_COMPLETE" == true ]] && echo complete || echo still active)."
