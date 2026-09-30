# Agent Orchestrator Kit

An npm package for turning a user-provided ideas CSV into project folders, running an MVP coding agent, and periodically discovering and starting ongoing project workers.

## Guided install

On a Linux or macOS host with Node.js 18+, bash, Python 3, Git, curl, `flock`, and a cron service:

```sh
npx agent-orchestrator init
```

The guided setup asks for the projects folder, CSV URL or local CSV, coding agent executable and mode, optional GitHub owner, and both schedules. It creates `run-agent.sh`, `run-sub-agents.sh`, configuration and state, then offers to install both cron entries. No credentials or idea source are embedded in the package.

CSV needs a header row. Common columns include `Sl No`, `Idea`, and `Agent Automatable`. Rows marked `NO` are skipped. `PARTIAL` projects can be worked on, with the agent instructed not to claim external or manual work.

## Commands

```sh
npx agent-orchestrator init
npx agent-orchestrator run ~/projects
npx agent-orchestrator supervise ~/projects
npx agent-orchestrator status ~/projects
npx agent-orchestrator logs ~/projects master.log
npx agent-orchestrator cron ~/projects '0 * * * *' '*/15 * * * *'
```

The master worker creates or continues one MVP at a time. Existing active MVPs stay selected until `.agent-status.json` says `mvp_complete: true`. The supervisor discovers `run-sub-agent.sh` files under project folders; each child takes its own `flock` lock. A child marked `development_complete: true` is skipped.

## Configuration and agent support

Setup writes `.agent-orchestrator.env` under the projects directory. Supported modes are Codex, OpenCode, Claude Code, and custom command. Adjust `AGENT_COMMAND`, `AGENT_ARGS`, and `AGENT_PROVIDER` there if your CLI invocation differs. The scripts call GitHub CLI only if a GitHub owner is configured; leave it blank to disable automatic remote creation and pushes.

Cron schedules default to hourly idea processing and supervision every 15 minutes. Re-running `init` or `cron` replaces only this package's tagged cron entries.

## Platform note

The shell runners and cron integration target Linux/macOS. Windows users can run the npm CLI under WSL or another Linux environment. Docker is not required.
