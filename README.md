# 24x7ai

**Universal Agent Fleet Controller — 1 package, 1 vps, 1 command**

Feed in a CSV of ideas, leave a $20 VPS running, and wake up to an autonomous software factory with an interactive TUI fleet controller. While the main pipeline builds MVP after MVP, persistent background daemons independently watch GitHub issues, write tests, refine code, and ship improvements.

```
┌─ 24x7ai Fleet Controller ─────────────────────────────────┐
│                                                            │
│  Pipeline: Building #11/50 — "recipe-sharing-app"          │
│  Agent: claude-code | Running 4m32s | 2 commits so far     │
│                                                            │
│  ── Active Daemons (10/10) ──────────── max-parallel: 4 ── │
│  #  Project              Status   Last Run    Commits  GH  │
│  1  expense-tracker      ● idle   2m ago      47       3↓  │
│  2  task-board           ● run    now         31       1↓  │
│  3  weather-dashboard    ● idle   8m ago      22       0   │
│  4  markdown-editor      ● stuck  34m ago     15       —   │
│  5  chat-app             ● idle   5m ago      38       2↓  │
│                                                            │
│  [s]tart [p]ause [r]un [l]ogs [q]uit                       │
└────────────────────────────────────────────────────────────┘
```

## Quick Start

On any Linux or macOS machine with Node.js 18+ and Git:

```sh
# Guided interactive setup
npx 24x7ai init

# Run serial MVP pipeline (CSV -> working repos)
npx 24x7ai run

# Launch interactive terminal UI fleet controller
npx 24x7ai fleet

# Check fleet status table
npx 24x7ai status
```

## CLI Commands

| Command | Description |
|---|---|
| `npx 24x7ai init [dir]` | Guided interactive setup (CSV source, adapters, GitHub, Otari gateway) |
| `npx 24x7ai run [dir]` | Run the serial MVP pipeline to process ideas from CSV |
| `npx 24x7ai fleet [dir]` | Launch the live Ink TUI Fleet Controller dashboard |
| `npx 24x7ai status [dir]` | Display fleet overview and project daemon metrics from SQLite |
| `npx 24x7ai daemon start <project>` | Start/enable background improvement daemon for a project |
| `npx 24x7ai daemon pause <project>` | Pause a project daemon |
| `npx 24x7ai daemon resume <project>` | Resume a paused project daemon |
| `npx 24x7ai daemon run <project>` | Immediately run a single daemon cycle for a project |
| `npx 24x7ai daemon supervise [dir]` | Run a supervision pass across all active project daemons |
| `npx 24x7ai adapter list` | Show all detected and installed agent adapters |
| `npx 24x7ai adapter test <name>` | Test an adapter in the target directory |
| `npx 24x7ai logs [target] [-f]` | Stream or inspect fleet or project logs |
| `npx 24x7ai set-ideas <csv-or-url>` | Update idea source to a local CSV, URL or Google Sheets |
| `npx 24x7ai cron [dir]` | Install/update crontab entries for scheduled automation |

## Architecture

- **Clean TypeScript Core:** Zero shell script dependencies in the critical path. All state, orchestration, and process management run in TypeScript.
- **SQLite Fleet Store:** Powered by `better-sqlite3` with WAL mode and foreign keys. Fast concurrent queries, full run history, commit tracking, and metrics.
- **Universal Adapter Pattern:** Out-of-the-box support for:
  - **Codex** CLI
  - **Claude Code** (`claude` / `claude-code`)
  - **OpenCode** CLI
  - **Aider**
  - **OpenHands**
  - **Custom** CLI commands
- **Otari Model Gateway:** Native support for Mozilla's open-source model gateway. Enables unified OpenAI-compatible routing, virtual API keys, budget caps, and multi-provider failover across the entire fleet.
- **Stuck Detection:** Automatically identifies and quarantines agents looping without commits, failing repeatedly with identical errors, or exceeding timeouts.
- **GitHub Integration:** Automatically creates repositories, initializes `main` and `dev` branches, watches for open issues with labels (`agent-task`), and submits pull requests for daemon improvements.

## Ideas CSV Format

Provide a CSV file (local file, public URL, or Google Sheets edit link). Example `ideas.example.csv`:

```csv
Sl No,Idea,Agent Automatable
1,Recipe Sharing Platform,YES
2,Minimalist Markdown Note Editor,YES
3,Autonomous Cloud FinOps Optimizer,YES
```

Rows marked `NO` or `NOT AUTOMATABLE` are automatically skipped.

## License

Apache-2.0
