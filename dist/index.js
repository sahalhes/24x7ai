// src/config/schema.ts
var DEFAULT_CONFIG = {
  projectsRoot: process.env.PROJECTS_ROOT || `${process.env.HOME || "/root"}/projects`,
  ideaSourceType: "local-csv",
  ideaSource: "ideas.example.csv",
  defaultAdapter: "opencode",
  maxParallel: 4,
  daemonSchedule: "*/30 * * * *",
  stuckTimeoutMs: 30 * 60 * 1e3,
  // 30 minutes
  stuckConsecutiveNoChanges: 3,
  maxConsecutiveErrors: 5,
  github: {
    privateRepos: true,
    autoPush: true,
    autoPr: false,
    issueFilterLabel: "agent-task"
  },
  otari: {
    enabled: false,
    endpoint: "http://localhost:8000/v1"
  }
};

// src/config/loader.ts
import fs from "fs";
import path from "path";
var CONFIG_FILE_NAME = ".24x7ai.config.json";
var LEGACY_ENV_FILE_NAME = ".agent-orchestrator.env";
function resolveProjectsRoot(explicitPath) {
  if (explicitPath) return path.resolve(explicitPath);
  if (process.env.PROJECTS_ROOT) return path.resolve(process.env.PROJECTS_ROOT);
  return path.resolve(DEFAULT_CONFIG.projectsRoot);
}
function getConfigFilePath(projectsRoot) {
  return path.join(projectsRoot, CONFIG_FILE_NAME);
}
function parseLegacyEnv(envContent) {
  const result = {};
  for (const line of envContent.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match) {
      result[match[1]] = match[2].replace(/^'|'$/g, "").replaceAll("'\\''", "'");
    }
  }
  const partial = {};
  if (result.PROJECTS_ROOT) partial.projectsRoot = result.PROJECTS_ROOT;
  if (result.IDEA_SOURCE_TYPE) {
    const t = result.IDEA_SOURCE_TYPE;
    if (t === "csv-url" || t === "local-csv" || t === "google-sheets") {
      partial.ideaSourceType = t;
    }
  }
  if (result.IDEA_SOURCE) partial.ideaSource = result.IDEA_SOURCE;
  if (result.AGENT_PROVIDER) {
    partial.defaultAdapter = result.AGENT_PROVIDER === "claude" ? "claude-code" : result.AGENT_PROVIDER;
  }
  if (result.AGENT_COMMAND) partial.adapterCommand = result.AGENT_COMMAND;
  if (result.AGENT_ARGS) partial.adapterArgs = result.AGENT_ARGS.split(/\s+/).filter(Boolean);
  if (result.GITHUB_OWNER) {
    partial.github = {
      owner: result.GITHUB_OWNER,
      privateRepos: result.GITHUB_PRIVATE !== "false"
    };
  }
  return partial;
}
function loadConfig(projectsRoot) {
  const root = resolveProjectsRoot(projectsRoot);
  const jsonPath = getConfigFilePath(root);
  const legacyPath = path.join(root, LEGACY_ENV_FILE_NAME);
  let loaded = {};
  if (fs.existsSync(jsonPath)) {
    try {
      const content = fs.readFileSync(jsonPath, "utf8");
      loaded = JSON.parse(content);
    } catch (err) {
      throw new Error(`Failed to parse ${jsonPath}: ${err.message}`);
    }
  } else if (fs.existsSync(legacyPath)) {
    const content = fs.readFileSync(legacyPath, "utf8");
    loaded = parseLegacyEnv(content);
  }
  const merged = {
    ...DEFAULT_CONFIG,
    ...loaded,
    projectsRoot: root,
    github: {
      ...DEFAULT_CONFIG.github,
      ...loaded.github || {}
    },
    otari: {
      ...DEFAULT_CONFIG.otari,
      ...loaded.otari || {}
    }
  };
  if (process.env.AGENT_COMMAND) merged.adapterCommand = process.env.AGENT_COMMAND;
  if (process.env.AGENT_PROVIDER) {
    merged.defaultAdapter = process.env.AGENT_PROVIDER === "claude" ? "claude-code" : process.env.AGENT_PROVIDER;
  }
  if (process.env.GITHUB_OWNER) merged.github.owner = process.env.GITHUB_OWNER;
  return merged;
}
function saveConfig(projectsRoot, config) {
  const root = resolveProjectsRoot(projectsRoot);
  const existing = fs.existsSync(getConfigFilePath(root)) ? loadConfig(root) : DEFAULT_CONFIG;
  const updated = {
    ...existing,
    ...config,
    projectsRoot: root,
    github: {
      ...existing.github,
      ...config.github || {}
    },
    otari: {
      ...existing.otari,
      ...config.otari || {}
    }
  };
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(getConfigFilePath(root), JSON.stringify(updated, null, 2) + "\n", {
    mode: 384
  });
  return updated;
}

// src/state/db.ts
import fs2 from "fs";
import path2 from "path";
import Database from "better-sqlite3";
var activeDb = null;
var activeDbPath = null;
function getDbPath(projectsRoot) {
  const root = resolveProjectsRoot(projectsRoot);
  const stateDir = path2.join(root, ".24x7ai");
  fs2.mkdirSync(stateDir, { recursive: true });
  return path2.join(stateDir, "fleet.db");
}
function initDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      idea TEXT NOT NULL,
      sl_no INTEGER NOT NULL,
      source_csv TEXT,
      mvp_complete INTEGER DEFAULT 0,
      daemon_active INTEGER DEFAULT 0,
      daemon_schedule TEXT DEFAULT '*/30 * * * *',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      adapter TEXT NOT NULL,
      prompt TEXT,
      exit_code INTEGER,
      duration_ms INTEGER,
      commits_produced INTEGER DEFAULT 0,
      files_changed INTEGER DEFAULT 0,
      error TEXT,
      run_type TEXT CHECK(run_type IN ('mvp', 'daemon', 'manual')),
      started_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS daemon_state (
      project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      status TEXT CHECK(status IN ('idle','scheduled','running','error','stuck','paused')) DEFAULT 'idle',
      last_run_id INTEGER REFERENCES agent_runs(id),
      next_run_at TEXT,
      consecutive_errors INTEGER DEFAULT 0,
      consecutive_no_changes INTEGER DEFAULT 0,
      backoff_until TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS fleet_meta (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_projects_sl_no ON projects(sl_no);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_project_id ON agent_runs(project_id);
    CREATE INDEX IF NOT EXISTS idx_daemon_state_status ON daemon_state(status);
  `);
  return db;
}
function getDb(projectsRoot) {
  const dbPath = getDbPath(projectsRoot);
  if (activeDb && activeDbPath === dbPath) {
    return activeDb;
  }
  if (activeDb) {
    try {
      activeDb.close();
    } catch {
    }
  }
  activeDb = initDb(dbPath);
  activeDbPath = dbPath;
  return activeDb;
}
function closeDb() {
  if (activeDb) {
    try {
      activeDb.close();
    } catch {
    }
    activeDb = null;
    activeDbPath = null;
  }
}

// src/state/queries.ts
var FleetStore = class {
  constructor(db) {
    this.db = db;
  }
  db;
  // Projects
  upsertProject(project) {
    const stmt = this.db.prepare(`
      INSERT INTO projects (slug, idea, sl_no, source_csv, mvp_complete, daemon_active, daemon_schedule, updated_at)
      VALUES (@slug, @idea, @sl_no, @source_csv, @mvp_complete, @daemon_active, @daemon_schedule, datetime('now'))
      ON CONFLICT(slug) DO UPDATE SET
        idea = excluded.idea,
        sl_no = excluded.sl_no,
        source_csv = COALESCE(excluded.source_csv, projects.source_csv),
        updated_at = datetime('now')
      RETURNING *
    `);
    const row = stmt.get({
      slug: project.slug,
      idea: project.idea,
      sl_no: project.sl_no,
      source_csv: project.source_csv || null,
      mvp_complete: project.mvp_complete ? 1 : 0,
      daemon_active: project.daemon_active ? 1 : 0,
      daemon_schedule: project.daemon_schedule || "*/30 * * * *"
    });
    this.db.prepare(`
      INSERT OR IGNORE INTO daemon_state (project_id, status, updated_at)
      VALUES (?, 'idle', datetime('now'))
    `).run(row.id);
    return this.mapProject(row);
  }
  getProjectBySlug(slug) {
    const row = this.db.prepare("SELECT * FROM projects WHERE slug = ?").get(slug);
    return row ? this.mapProject(row) : null;
  }
  getProjectById(id) {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    return row ? this.mapProject(row) : null;
  }
  searchProjects(keyword) {
    const pattern = `%${keyword}%`;
    const rows = this.db.prepare(`
      SELECT 
        p.*,
        d.status as daemon_status,
        d.next_run_at,
        d.consecutive_errors,
        r.started_at as last_run_started_at,
        r.duration_ms as last_run_duration_ms,
        r.commits_produced as last_run_commits
      FROM projects p
      LEFT JOIN daemon_state d ON d.project_id = p.id
      LEFT JOIN agent_runs r ON r.id = d.last_run_id
      WHERE p.slug LIKE ? OR p.idea LIKE ?
      ORDER BY p.sl_no ASC
    `).all(pattern, pattern);
    return rows.map((r) => ({
      ...this.mapProject(r),
      daemon_status: r.daemon_status || "idle",
      next_run_at: r.next_run_at || void 0,
      consecutive_errors: r.consecutive_errors || 0,
      last_run_started_at: r.last_run_started_at || void 0,
      last_run_duration_ms: r.last_run_duration_ms || void 0,
      last_run_commits: r.last_run_commits || 0
    }));
  }
  getProjectBySlNo(slNo) {
    const row = this.db.prepare("SELECT * FROM projects WHERE sl_no = ?").get(slNo);
    return row ? this.mapProject(row) : null;
  }
  setMvpComplete(projectId, complete = true) {
    this.db.prepare(`
      UPDATE projects
      SET mvp_complete = ?, daemon_active = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(complete ? 1 : 0, complete ? 1 : 0, projectId);
    if (complete) {
      this.db.prepare(`
        UPDATE daemon_state
        SET status = 'idle', updated_at = datetime('now')
        WHERE project_id = ? AND status = 'paused'
      `).run(projectId);
    }
  }
  setDaemonActive(projectId, active) {
    this.db.prepare(`
      UPDATE projects
      SET daemon_active = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(active ? 1 : 0, projectId);
    const newStatus = active ? "idle" : "paused";
    this.db.prepare(`
      UPDATE daemon_state
      SET status = ?, updated_at = datetime('now')
      WHERE project_id = ?
    `).run(newStatus, projectId);
  }
  listProjects() {
    const rows = this.db.prepare(`
      SELECT 
        p.*,
        d.status as daemon_status,
        d.next_run_at,
        d.consecutive_errors,
        r.started_at as last_run_started_at,
        r.duration_ms as last_run_duration_ms,
        r.commits_produced as last_run_commits
      FROM projects p
      LEFT JOIN daemon_state d ON d.project_id = p.id
      LEFT JOIN agent_runs r ON r.id = d.last_run_id
      ORDER BY p.sl_no ASC
    `).all();
    return rows.map((r) => ({
      ...this.mapProject(r),
      daemon_status: r.daemon_status || "idle",
      next_run_at: r.next_run_at || void 0,
      consecutive_errors: r.consecutive_errors || 0,
      last_run_started_at: r.last_run_started_at || void 0,
      last_run_duration_ms: r.last_run_duration_ms || void 0,
      last_run_commits: r.last_run_commits || 0
    }));
  }
  // Agent Runs
  startAgentRun(opts) {
    const stmt = this.db.prepare(`
      INSERT INTO agent_runs (project_id, adapter, prompt, run_type, started_at)
      VALUES (@project_id, @adapter, @prompt, @run_type, datetime('now'))
      RETURNING *
    `);
    const row = stmt.get({
      project_id: opts.project_id,
      adapter: opts.adapter,
      prompt: opts.prompt || null,
      run_type: opts.run_type
    });
    this.db.prepare(`
      UPDATE daemon_state
      SET status = 'running', last_run_id = ?, updated_at = datetime('now')
      WHERE project_id = ?
    `).run(row.id, opts.project_id);
    return this.mapRun(row);
  }
  finishAgentRun(runId, opts) {
    const stmt = this.db.prepare(`
      UPDATE agent_runs
      SET exit_code = @exit_code,
          duration_ms = @duration_ms,
          commits_produced = @commits_produced,
          files_changed = @files_changed,
          error = @error,
          finished_at = datetime('now')
      WHERE id = @run_id
      RETURNING *
    `);
    const row = stmt.get({
      run_id: runId,
      exit_code: opts.exit_code,
      duration_ms: opts.duration_ms,
      commits_produced: opts.commits_produced,
      files_changed: opts.files_changed,
      error: opts.error || null
    });
    if (!row) throw new Error(`Agent run ${runId} not found`);
    const isError = opts.exit_code !== 0;
    const noChanges = opts.commits_produced === 0 && opts.files_changed === 0;
    this.db.prepare(`
      UPDATE daemon_state
      SET status = CASE WHEN ? = 1 THEN 'error' ELSE 'idle' END,
          consecutive_errors = CASE WHEN ? = 1 THEN consecutive_errors + 1 ELSE 0 END,
          consecutive_no_changes = CASE WHEN ? = 1 THEN consecutive_no_changes + 1 ELSE 0 END,
          updated_at = datetime('now')
      WHERE project_id = ?
    `).run(
      isError ? 1 : 0,
      isError ? 1 : 0,
      noChanges ? 1 : 0,
      row.project_id
    );
    return this.mapRun(row);
  }
  getRecentRuns(projectId, limit = 10) {
    const rows = this.db.prepare(`
      SELECT * FROM agent_runs
      WHERE project_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(projectId, limit);
    return rows.map((r) => this.mapRun(r));
  }
  // Daemon state management
  updateDaemonStatus(projectId, status, extra) {
    this.db.prepare(`
      UPDATE daemon_state
      SET status = @status,
          next_run_at = COALESCE(@next_run_at, next_run_at),
          backoff_until = COALESCE(@backoff_until, backoff_until),
          updated_at = datetime('now')
      WHERE project_id = @project_id
    `).run({
      project_id: projectId,
      status,
      next_run_at: extra?.nextRunAt || null,
      backoff_until: extra?.backoffUntil || null
    });
  }
  getDaemonState(projectId) {
    const row = this.db.prepare("SELECT * FROM daemon_state WHERE project_id = ?").get(projectId);
    if (!row) return null;
    return {
      project_id: row.project_id,
      status: row.status,
      last_run_id: row.last_run_id || void 0,
      next_run_at: row.next_run_at || void 0,
      consecutive_errors: row.consecutive_errors || 0,
      consecutive_no_changes: row.consecutive_no_changes || 0,
      backoff_until: row.backoff_until || void 0,
      updated_at: row.updated_at
    };
  }
  getFleetSummary() {
    const res = this.db.prepare(`
      SELECT
        COUNT(p.id) as total,
        SUM(p.mvp_complete) as mvp_done,
        SUM(p.daemon_active) as active_daemons,
        SUM(CASE WHEN d.status = 'running' THEN 1 ELSE 0 END) as running_count,
        SUM(CASE WHEN d.status = 'stuck' THEN 1 ELSE 0 END) as stuck_count,
        SUM(CASE WHEN d.status = 'error' THEN 1 ELSE 0 END) as error_count
      FROM projects p
      LEFT JOIN daemon_state d ON d.project_id = p.id
    `).get();
    return {
      totalProjects: res.total || 0,
      mvpCompleted: res.mvp_done || 0,
      activeDaemons: res.active_daemons || 0,
      runningCount: res.running_count || 0,
      stuckCount: res.stuck_count || 0,
      errorCount: res.error_count || 0
    };
  }
  // Helper mappings
  mapProject(row) {
    return {
      id: row.id,
      slug: row.slug,
      idea: row.idea,
      sl_no: row.sl_no,
      source_csv: row.source_csv || void 0,
      mvp_complete: Boolean(row.mvp_complete),
      daemon_active: Boolean(row.daemon_active),
      daemon_schedule: row.daemon_schedule || "*/30 * * * *",
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
  mapRun(row) {
    return {
      id: row.id,
      project_id: row.project_id,
      adapter: row.adapter,
      prompt: row.prompt || void 0,
      exit_code: row.exit_code != null ? row.exit_code : void 0,
      duration_ms: row.duration_ms != null ? row.duration_ms : void 0,
      commits_produced: row.commits_produced || 0,
      files_changed: row.files_changed || 0,
      error: row.error || void 0,
      run_type: row.run_type,
      started_at: row.started_at,
      finished_at: row.finished_at || void 0
    };
  }
};

// src/adapters/base.ts
import fs3 from "fs";
import path3 from "path";
import { spawn } from "child_process";
async function commandExists(command) {
  return new Promise((resolve) => {
    const proc = spawn("which", [command], { stdio: "ignore" });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}
async function getHeadCommit(cwd) {
  return new Promise((resolve) => {
    const proc = spawn("git", ["rev-parse", "HEAD"], { cwd });
    let stdout = "";
    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.on("close", (code) => {
      resolve(code === 0 ? stdout.trim() : null);
    });
    proc.on("error", () => resolve(null));
  });
}
async function getCommitsSince(cwd, beforeSha) {
  return new Promise((resolve) => {
    const range = beforeSha ? `${beforeSha}..HEAD` : "HEAD";
    const proc = spawn("git", ["rev-list", range], { cwd });
    let stdout = "";
    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.on("close", (code) => {
      if (code !== 0) return resolve([]);
      const lines = stdout.split("\n").map((s) => s.trim()).filter(Boolean);
      resolve(lines);
    });
    proc.on("error", () => resolve([]));
  });
}
async function getFilesChanged(cwd) {
  return new Promise((resolve) => {
    const proc = spawn("git", ["status", "--porcelain"], { cwd });
    let stdout = "";
    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.on("close", (code) => {
      if (code !== 0) return resolve([]);
      const lines = stdout.split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
      resolve(lines);
    });
    proc.on("error", () => resolve([]));
  });
}
function readAgentStatusJson(projectDir) {
  const filePath = path3.join(projectDir, ".agent-status.json");
  if (!fs3.existsSync(filePath)) return null;
  try {
    const raw = fs3.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// src/adapters/codex.ts
import { spawn as spawn2 } from "child_process";
var CodexAdapter = class {
  name = "codex";
  description = "OpenAI Codex CLI adapter";
  async detect() {
    return commandExists("codex");
  }
  async invoke(opts) {
    const cmd = opts.commandOverride || "codex";
    const beforeHead = await getHeadCommit(opts.projectDir);
    const startTime = Date.now();
    const args = [
      ...opts.args || [],
      "-a",
      "never",
      "--sandbox",
      "workspace-write",
      "-C",
      opts.projectDir,
      "exec",
      opts.prompt
    ];
    return new Promise((resolve) => {
      let output = "";
      let timedOut = false;
      const proc = spawn2(cmd, args, {
        cwd: opts.projectDir,
        env: { ...process.env, ...opts.env || {} },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let timeoutTimer;
      if (opts.timeout && opts.timeout > 0) {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          proc.kill("SIGTERM");
        }, opts.timeout);
      }
      proc.stdout.on("data", (d) => {
        const text = d.toString();
        output += text;
        opts.onStdout?.(text);
      });
      proc.stderr.on("data", (d) => {
        const text = d.toString();
        output += text;
        opts.onStderr?.(text);
      });
      proc.on("close", async (code) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        const duration = Date.now() - startTime;
        const commits = await getCommitsSince(opts.projectDir, beforeHead);
        const filesChanged = await getFilesChanged(opts.projectDir);
        resolve({
          exitCode: timedOut ? 124 : code ?? 1,
          duration,
          commits,
          filesChanged,
          rawOutput: output,
          error: timedOut ? "Execution timed out" : code !== 0 ? `Process exited with code ${code}` : void 0
        });
      });
      proc.on("error", (err) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        resolve({
          exitCode: 1,
          duration: Date.now() - startTime,
          commits: [],
          filesChanged: [],
          error: `Failed to spawn ${cmd}: ${err.message}`
        });
      });
    });
  }
  async parseStatus(projectDir) {
    return readAgentStatusJson(projectDir);
  }
};

// src/adapters/claude-code.ts
import { spawn as spawn3 } from "child_process";
var ClaudeCodeAdapter = class {
  name = "claude-code";
  description = "Anthropic Claude Code CLI adapter";
  async detect() {
    return await commandExists("claude") || await commandExists("claude-code");
  }
  async invoke(opts) {
    const cmd = opts.commandOverride || (await commandExists("claude") ? "claude" : "claude-code");
    const beforeHead = await getHeadCommit(opts.projectDir);
    const startTime = Date.now();
    const args = [
      ...opts.args || [],
      "-p",
      opts.prompt
    ];
    return new Promise((resolve) => {
      let output = "";
      let timedOut = false;
      const proc = spawn3(cmd, args, {
        cwd: opts.projectDir,
        env: { ...process.env, ...opts.env || {} },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let timeoutTimer;
      if (opts.timeout && opts.timeout > 0) {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          proc.kill("SIGTERM");
        }, opts.timeout);
      }
      proc.stdout.on("data", (d) => {
        const text = d.toString();
        output += text;
        opts.onStdout?.(text);
      });
      proc.stderr.on("data", (d) => {
        const text = d.toString();
        output += text;
        opts.onStderr?.(text);
      });
      proc.on("close", async (code) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        const duration = Date.now() - startTime;
        const commits = await getCommitsSince(opts.projectDir, beforeHead);
        const filesChanged = await getFilesChanged(opts.projectDir);
        resolve({
          exitCode: timedOut ? 124 : code ?? 1,
          duration,
          commits,
          filesChanged,
          rawOutput: output,
          error: timedOut ? "Execution timed out" : code !== 0 ? `Process exited with code ${code}` : void 0
        });
      });
      proc.on("error", (err) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        resolve({
          exitCode: 1,
          duration: Date.now() - startTime,
          commits: [],
          filesChanged: [],
          error: `Failed to spawn ${cmd}: ${err.message}`
        });
      });
    });
  }
  async parseStatus(projectDir) {
    return readAgentStatusJson(projectDir);
  }
};

// src/adapters/opencode.ts
import { spawn as spawn4 } from "child_process";
var OpenCodeAdapter = class {
  name = "opencode";
  description = "OpenCode CLI adapter";
  async detect() {
    return commandExists("opencode");
  }
  async invoke(opts) {
    const cmd = opts.commandOverride || "opencode";
    const beforeHead = await getHeadCommit(opts.projectDir);
    const startTime = Date.now();
    const args = [
      ...opts.args || [],
      "run",
      opts.prompt
    ];
    return new Promise((resolve) => {
      let output = "";
      let timedOut = false;
      const proc = spawn4(cmd, args, {
        cwd: opts.projectDir,
        env: { ...process.env, ...opts.env || {} },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let timeoutTimer;
      if (opts.timeout && opts.timeout > 0) {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          proc.kill("SIGTERM");
        }, opts.timeout);
      }
      proc.stdout.on("data", (d) => {
        const text = d.toString();
        output += text;
        opts.onStdout?.(text);
      });
      proc.stderr.on("data", (d) => {
        const text = d.toString();
        output += text;
        opts.onStderr?.(text);
      });
      proc.on("close", async (code) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        const duration = Date.now() - startTime;
        const commits = await getCommitsSince(opts.projectDir, beforeHead);
        const filesChanged = await getFilesChanged(opts.projectDir);
        resolve({
          exitCode: timedOut ? 124 : code ?? 1,
          duration,
          commits,
          filesChanged,
          rawOutput: output,
          error: timedOut ? "Execution timed out" : code !== 0 ? `Process exited with code ${code}` : void 0
        });
      });
      proc.on("error", (err) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        resolve({
          exitCode: 1,
          duration: Date.now() - startTime,
          commits: [],
          filesChanged: [],
          error: `Failed to spawn ${cmd}: ${err.message}`
        });
      });
    });
  }
  async parseStatus(projectDir) {
    return readAgentStatusJson(projectDir);
  }
};

// src/adapters/aider.ts
import { spawn as spawn5 } from "child_process";
var AiderAdapter = class {
  name = "aider";
  description = "Aider AI pair programmer CLI adapter";
  async detect() {
    return commandExists("aider");
  }
  async invoke(opts) {
    const cmd = opts.commandOverride || "aider";
    const beforeHead = await getHeadCommit(opts.projectDir);
    const startTime = Date.now();
    const args = [
      ...opts.args || [],
      "--message",
      opts.prompt,
      "--yes-always"
    ];
    return new Promise((resolve) => {
      let output = "";
      let timedOut = false;
      const proc = spawn5(cmd, args, {
        cwd: opts.projectDir,
        env: { ...process.env, ...opts.env || {} },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let timeoutTimer;
      if (opts.timeout && opts.timeout > 0) {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          proc.kill("SIGTERM");
        }, opts.timeout);
      }
      proc.stdout.on("data", (d) => {
        const text = d.toString();
        output += text;
        opts.onStdout?.(text);
      });
      proc.stderr.on("data", (d) => {
        const text = d.toString();
        output += text;
        opts.onStderr?.(text);
      });
      proc.on("close", async (code) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        const duration = Date.now() - startTime;
        const commits = await getCommitsSince(opts.projectDir, beforeHead);
        const filesChanged = await getFilesChanged(opts.projectDir);
        resolve({
          exitCode: timedOut ? 124 : code ?? 1,
          duration,
          commits,
          filesChanged,
          rawOutput: output,
          error: timedOut ? "Execution timed out" : code !== 0 ? `Process exited with code ${code}` : void 0
        });
      });
      proc.on("error", (err) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        resolve({
          exitCode: 1,
          duration: Date.now() - startTime,
          commits: [],
          filesChanged: [],
          error: `Failed to spawn ${cmd}: ${err.message}`
        });
      });
    });
  }
  async parseStatus(projectDir) {
    return readAgentStatusJson(projectDir);
  }
};

// src/adapters/openhands.ts
import { spawn as spawn6 } from "child_process";
var OpenHandsAdapter = class {
  name = "openhands";
  description = "OpenHands CLI / headless adapter";
  async detect() {
    return commandExists("openhands");
  }
  async invoke(opts) {
    const cmd = opts.commandOverride || "openhands";
    const beforeHead = await getHeadCommit(opts.projectDir);
    const startTime = Date.now();
    const args = [
      ...opts.args || [],
      "--prompt",
      opts.prompt
    ];
    return new Promise((resolve) => {
      let output = "";
      let timedOut = false;
      const proc = spawn6(cmd, args, {
        cwd: opts.projectDir,
        env: { ...process.env, ...opts.env || {} },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let timeoutTimer;
      if (opts.timeout && opts.timeout > 0) {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          proc.kill("SIGTERM");
        }, opts.timeout);
      }
      proc.stdout.on("data", (d) => {
        const text = d.toString();
        output += text;
        opts.onStdout?.(text);
      });
      proc.stderr.on("data", (d) => {
        const text = d.toString();
        output += text;
        opts.onStderr?.(text);
      });
      proc.on("close", async (code) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        const duration = Date.now() - startTime;
        const commits = await getCommitsSince(opts.projectDir, beforeHead);
        const filesChanged = await getFilesChanged(opts.projectDir);
        resolve({
          exitCode: timedOut ? 124 : code ?? 1,
          duration,
          commits,
          filesChanged,
          rawOutput: output,
          error: timedOut ? "Execution timed out" : code !== 0 ? `Process exited with code ${code}` : void 0
        });
      });
      proc.on("error", (err) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        resolve({
          exitCode: 1,
          duration: Date.now() - startTime,
          commits: [],
          filesChanged: [],
          error: `Failed to spawn ${cmd}: ${err.message}`
        });
      });
    });
  }
  async parseStatus(projectDir) {
    return readAgentStatusJson(projectDir);
  }
};

// src/adapters/custom.ts
import { spawn as spawn7 } from "child_process";
var CustomAdapter = class {
  name = "custom";
  description = "Custom command line agent adapter";
  async detect() {
    return true;
  }
  async invoke(opts) {
    const cmd = opts.commandOverride || "echo";
    const beforeHead = await getHeadCommit(opts.projectDir);
    const startTime = Date.now();
    const args = [
      ...opts.args || [],
      opts.prompt
    ];
    return new Promise((resolve) => {
      let output = "";
      let timedOut = false;
      const proc = spawn7(cmd, args, {
        cwd: opts.projectDir,
        env: { ...process.env, ...opts.env || {} },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let timeoutTimer;
      if (opts.timeout && opts.timeout > 0) {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          proc.kill("SIGTERM");
        }, opts.timeout);
      }
      proc.stdout.on("data", (d) => {
        const text = d.toString();
        output += text;
        opts.onStdout?.(text);
      });
      proc.stderr.on("data", (d) => {
        const text = d.toString();
        output += text;
        opts.onStderr?.(text);
      });
      proc.on("close", async (code) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        const duration = Date.now() - startTime;
        const commits = await getCommitsSince(opts.projectDir, beforeHead);
        const filesChanged = await getFilesChanged(opts.projectDir);
        resolve({
          exitCode: timedOut ? 124 : code ?? 1,
          duration,
          commits,
          filesChanged,
          rawOutput: output,
          error: timedOut ? "Execution timed out" : code !== 0 ? `Process exited with code ${code}` : void 0
        });
      });
      proc.on("error", (err) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        resolve({
          exitCode: 1,
          duration: Date.now() - startTime,
          commits: [],
          filesChanged: [],
          error: `Failed to spawn ${cmd}: ${err.message}`
        });
      });
    });
  }
  async parseStatus(projectDir) {
    return readAgentStatusJson(projectDir);
  }
};

// src/adapters/registry.ts
var AdapterRegistry = class {
  adapters = /* @__PURE__ */ new Map();
  constructor() {
    this.register(new CodexAdapter());
    this.register(new ClaudeCodeAdapter());
    this.register(new OpenCodeAdapter());
    this.register(new AiderAdapter());
    this.register(new OpenHandsAdapter());
    this.register(new CustomAdapter());
  }
  register(adapter) {
    this.adapters.set(adapter.name.toLowerCase(), adapter);
  }
  get(name) {
    const key = name.toLowerCase();
    const adapter = this.adapters.get(key);
    if (!adapter) {
      if (this.adapters.has("custom")) {
        return this.adapters.get("custom");
      }
      throw new Error(`Unknown agent adapter: ${name}. Available: ${this.listNames().join(", ")}`);
    }
    return adapter;
  }
  has(name) {
    return this.adapters.has(name.toLowerCase());
  }
  list() {
    return Array.from(this.adapters.values());
  }
  listNames() {
    return Array.from(this.adapters.keys());
  }
  async detectAvailable() {
    const results = await Promise.all(
      this.list().map(async (adapter) => {
        const available = await adapter.detect();
        return { adapter, available };
      })
    );
    return results;
  }
  async testAdapter(name, projectDir) {
    const adapter = this.get(name);
    const result = await adapter.invoke({
      projectDir,
      prompt: 'Test run \u2014 echo "test"',
      timeout: 1e4
    });
    return {
      success: result.exitCode === 0,
      result
    };
  }
};
var defaultRegistry = new AdapterRegistry();

// src/csv/parser.ts
import { parse } from "csv-parse/sync";
function generateSlug(idea) {
  let s = idea.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70).replace(/-+$/, "");
  return s || "project";
}
function getField(row, ...candidateNames) {
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    if (key) {
      const cleanKey = key.trim().toLowerCase().replace(/[\s-]+/g, "_");
      normalized[cleanKey] = (value || "").trim();
    }
  }
  for (const name of candidateNames) {
    if (normalized[name]) {
      return normalized[name];
    }
  }
  return "";
}
function parseIdeasCsv(csvContent) {
  if (!csvContent || !csvContent.trim()) {
    throw new Error("CSV source is empty.");
  }
  if (csvContent.trim().toLowerCase().startsWith("<!doctype") || csvContent.trim().toLowerCase().startsWith("<html")) {
    throw new Error("CSV source returned HTML. Use a direct CSV or Google Sheets export URL.");
  }
  const records = parse(csvContent, {
    columns: true,
    delimiter: (() => {
      const firstLine = csvContent.split("\n")[0] || "";
      if (firstLine.includes("	") && !firstLine.includes(",")) return "	";
      if (firstLine.includes(";") && !firstLine.includes(",")) return ";";
      return ",";
    })(),
    skip_empty_lines: true,
    trim: true,
    bom: true
  });
  if (records.length === 0) {
    return [];
  }
  const first = records[0];
  const keys = Object.keys(first).map((k) => k.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const hasSl = keys.some((k) => ["sl_no", "sl", "serial_no", "serial_number", "s_no", "no"].includes(k));
  if (!hasSl) {
    throw new Error(`CSV is missing a serial-number column. Found headers: ${Object.keys(first).join(", ")}`);
  }
  const hasIdea = keys.some((k) => ["idea", "project", "project_idea", "name", "title"].includes(k));
  if (!hasIdea) {
    throw new Error(`CSV is missing an idea/project column. Found headers: ${Object.keys(first).join(", ")}`);
  }
  const items = [];
  for (const row of records) {
    const rawSl = getField(row, "sl_no", "sl", "serial_no", "serial_number", "s_no", "no");
    const slNo = parseInt(rawSl, 10);
    if (isNaN(slNo)) continue;
    const idea = getField(row, "idea", "project", "project_idea", "name", "title");
    if (!idea) continue;
    const automatable = getField(row, "agent_automatable", "automatable", "automation") || "YES";
    const upper = automatable.toUpperCase();
    if (["NO", "FALSE", "N", "NOT AUTOMATABLE"].includes(upper)) {
      continue;
    }
    const slug = generateSlug(idea);
    items.push({
      sl_no: slNo,
      idea,
      slug,
      automatable,
      sourceRow: row
    });
  }
  return items.sort((a, b) => a.sl_no - b.sl_no);
}

// src/csv/sources.ts
import fs4 from "fs";
import path4 from "path";
function convertGoogleSheetsUrl(url) {
  if (/docs\.google\.com\/spreadsheets\/d\//.test(url) && /\/edit(?:\?|$)/.test(url)) {
    try {
      const u = new URL(url);
      const gid = u.searchParams.get("gid") || "0";
      const base = url.split("/edit")[0];
      return `${base}/export?format=csv&gid=${encodeURIComponent(gid)}`;
    } catch {
      return url;
    }
  }
  return url;
}
async function fetchIdeaSource(sourceType, source, baseDir) {
  if (sourceType === "google-sheets") {
    const exportUrl = convertGoogleSheetsUrl(source);
    const resp = await fetch(exportUrl);
    if (!resp.ok) {
      throw new Error(`Failed to fetch Google Sheets CSV (${resp.status} ${resp.statusText})`);
    }
    return resp.text();
  }
  if (sourceType === "csv-url" || source.startsWith("http://") || source.startsWith("https://")) {
    const exportUrl = convertGoogleSheetsUrl(source);
    const resp = await fetch(exportUrl);
    if (!resp.ok) {
      throw new Error(`Failed to fetch CSV from ${source} (${resp.status} ${resp.statusText})`);
    }
    return resp.text();
  }
  const localPath = baseDir ? path4.resolve(baseDir, source) : path4.resolve(source);
  if (!fs4.existsSync(localPath)) {
    throw new Error(`Local CSV file not found: ${localPath}`);
  }
  return fs4.readFileSync(localPath, "utf8");
}
async function loadIdeas(sourceType, source, baseDir) {
  const content = await fetchIdeaSource(sourceType, source, baseDir);
  return parseIdeasCsv(content);
}

// src/core/pipeline.ts
import fs8 from "fs";
import path8 from "path";
import handlebars from "handlebars";

// src/github/repo.ts
import fs5 from "fs";
import path5 from "path";
import { spawn as spawn8 } from "child_process";
function execGit(args, cwd) {
  return new Promise((resolve) => {
    const proc = spawn8("git", args, { cwd });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    proc.on("error", (err) => resolve({ code: 1, stdout: "", stderr: err.message }));
  });
}
function execGh(args, cwd) {
  return new Promise((resolve) => {
    const proc = spawn8("gh", args, { cwd });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    proc.on("error", (err) => resolve({ code: 1, stdout: "", stderr: err.message }));
  });
}
async function ensureGitRepo(projectDir, defaultBranch = "main", author) {
  const name = author?.name || process.env.GIT_USER_NAME || "Autonomous Agent";
  const email = author?.email || process.env.GIT_USER_EMAIL || "agent@localhost";
  const gitDir = path5.join(projectDir, ".git");
  if (!fs5.existsSync(gitDir)) {
    await execGit(["init", "-b", defaultBranch], projectDir);
    await execGit(["config", "user.name", name], projectDir);
    await execGit(["config", "user.email", email], projectDir);
  }
}
async function ensureDevBranch(projectDir) {
  const check = await execGit(["show-ref", "--verify", "--quiet", "refs/heads/dev"], projectDir);
  if (check.code === 0) {
    await execGit(["checkout", "dev"], projectDir);
  } else {
    await execGit(["checkout", "-b", "dev"], projectDir);
  }
}
async function commitWorkingTree(projectDir, message) {
  const status = await execGit(["status", "--porcelain"], projectDir);
  if (!status.stdout.trim()) {
    return null;
  }
  await execGit(["add", "-A"], projectDir);
  const commit = await execGit(["commit", "-m", message], projectDir);
  if (commit.code !== 0) return null;
  const rev = await execGit(["rev-parse", "HEAD"], projectDir);
  return rev.code === 0 ? rev.stdout.trim() : null;
}
async function syncGitHubRepo(projectDir, slug, config, logger) {
  if (!config.owner) return false;
  const repoName = `${config.owner}/${slug}`;
  const remoteCheck = await execGit(["remote", "get-url", "origin"], projectDir);
  if (remoteCheck.code !== 0) {
    const view = await execGh(["repo", "view", repoName], projectDir);
    if (view.code === 0) {
      await execGit(["remote", "add", "origin", `git@github.com:${repoName}.git`], projectDir);
    } else {
      logger?.info(`Creating GitHub repository ${repoName}...`);
      const createArgs = ["repo", "create", repoName, "--source=.", "--remote=origin"];
      if (config.privateRepos !== false) {
        createArgs.push("--private");
      } else {
        createArgs.push("--public");
      }
      const createRes = await execGh(createArgs, projectDir);
      if (createRes.code !== 0) {
        logger?.warn(`Could not create GitHub repo ${repoName}: ${createRes.stderr}`);
        return false;
      }
    }
  }
  if (config.autoPush !== false) {
    logger?.info(`Pushing to ${repoName}...`);
    const lsMain = await execGit(["ls-remote", "--exit-code", "--heads", "origin", "main"], projectDir);
    if (lsMain.code !== 0) {
      await execGit(["branch", "-f", "main", "HEAD"], projectDir);
      await execGit(["push", "-u", "origin", "main"], projectDir);
      await execGit(["checkout", "dev"], projectDir);
    }
    await execGit(["push", "-u", "origin", "dev"], projectDir);
  }
  return true;
}

// src/gateway/otari.ts
var OtariGateway = class {
  constructor(config) {
    this.config = config;
  }
  config;
  isEnabled() {
    return this.config.enabled;
  }
  getEndpoint() {
    return this.config.endpoint || "http://localhost:8000/v1";
  }
  getVirtualKey(projectId, runType) {
    if (this.config.virtualKey) return this.config.virtualKey;
    return `otari-24x7ai-p${projectId}-${runType}`;
  }
  async checkBudget() {
    if (!this.config.enabled || !this.config.budgetCapUsd) {
      return { allowed: true };
    }
    try {
      const resp = await fetch(`${this.getEndpoint()}/budget/check`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey || "otari-default"}`
        }
      });
      if (resp.ok) {
        const data = await resp.json();
        return {
          allowed: data.remaining > 0,
          remainingBudgetUsd: data.remaining
        };
      }
    } catch {
    }
    return { allowed: true };
  }
  getAdapterEnv(projectId, runType) {
    if (!this.config.enabled) return {};
    const endpoint = this.getEndpoint();
    const virtualKey = this.getVirtualKey(projectId, runType);
    return {
      OPENAI_BASE_URL: endpoint,
      OPENAI_API_BASE: endpoint,
      OPENAI_API_KEY: virtualKey,
      ANTHROPIC_BASE_URL: endpoint,
      ANTHROPIC_API_KEY: virtualKey,
      OTARI_PROJECT_ID: String(projectId),
      OTARI_RUN_TYPE: runType
    };
  }
};

// src/utils/logger.ts
import fs6 from "fs";
import path6 from "path";
import pc from "picocolors";
var Logger = class {
  constructor(logFilePath, prefix = "") {
    this.logFilePath = logFilePath;
    this.prefix = prefix;
  }
  logFilePath;
  prefix;
  info(message, ...meta) {
    this.log("info", message, meta);
  }
  warn(message, ...meta) {
    this.log("warn", message, meta);
  }
  error(message, ...meta) {
    this.log("error", message, meta);
  }
  debug(message, ...meta) {
    this.log("debug", message, meta);
  }
  log(level, message, meta) {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const formattedPrefix = this.prefix ? `[${this.prefix}] ` : "";
    const plain = `${timestamp} ${level.toUpperCase().padEnd(5)} ${formattedPrefix}${message}`;
    let coloredLevel = level.toUpperCase();
    if (level === "info") coloredLevel = pc.cyan(coloredLevel);
    else if (level === "warn") coloredLevel = pc.yellow(coloredLevel);
    else if (level === "error") coloredLevel = pc.red(coloredLevel);
    else coloredLevel = pc.gray(coloredLevel);
    const consoleOutput = `${pc.gray(timestamp)} ${coloredLevel.padEnd(5)} ${formattedPrefix}${message}`;
    if (level === "error") {
      console.error(consoleOutput, ...meta);
    } else {
      console.log(consoleOutput, ...meta);
    }
    if (this.logFilePath) {
      try {
        fs6.mkdirSync(path6.dirname(this.logFilePath), { recursive: true });
        const metaStr = meta.length > 0 ? ` ${JSON.stringify(meta)}` : "";
        fs6.appendFileSync(this.logFilePath, `${plain}${metaStr}
`, "utf8");
      } catch {
      }
    }
  }
};

// src/utils/lock.ts
import fs7 from "fs";
import path7 from "path";
var FileLock = class {
  constructor(lockPath) {
    this.lockPath = lockPath;
  }
  lockPath;
  fd = null;
  locked = false;
  acquire() {
    try {
      const dir = path7.dirname(this.lockPath);
      fs7.mkdirSync(dir, { recursive: true });
      if (fs7.existsSync(this.lockPath)) {
        try {
          const content = fs7.readFileSync(this.lockPath, "utf8");
          const [pidStr] = content.split("\n");
          const pid = parseInt(pidStr, 10);
          if (!isNaN(pid)) {
            try {
              process.kill(pid, 0);
              return false;
            } catch {
              try {
                fs7.unlinkSync(this.lockPath);
              } catch {
              }
            }
          }
        } catch {
        }
      }
      this.fd = fs7.openSync(this.lockPath, "wx");
      fs7.writeSync(this.fd, `${process.pid}
${(/* @__PURE__ */ new Date()).toISOString()}
`);
      this.locked = true;
      return true;
    } catch {
      return false;
    }
  }
  release() {
    if (!this.locked) return;
    try {
      if (this.fd !== null) {
        fs7.closeSync(this.fd);
        this.fd = null;
      }
      if (fs7.existsSync(this.lockPath)) {
        fs7.unlinkSync(this.lockPath);
      }
    } catch {
    } finally {
      this.locked = false;
    }
  }
  isLocked() {
    return this.locked;
  }
};
async function withLock(lockPath, fn) {
  const lock = new FileLock(lockPath);
  if (!lock.acquire()) {
    return { acquired: false };
  }
  try {
    const result = await fn();
    return { acquired: true, result };
  } finally {
    lock.release();
  }
}

// src/core/pipeline.ts
var MvpPipeline = class {
  config;
  store;
  registry;
  logger;
  otari;
  constructor(opts) {
    this.config = opts.config;
    this.store = opts.store;
    this.registry = opts.registry || defaultRegistry;
    this.logger = opts.logger || new Logger(
      path8.join(this.config.projectsRoot, ".24x7ai", "logs", "pipeline.log"),
      "pipeline"
    );
    this.otari = new OtariGateway(this.config.otari);
  }
  async run() {
    const lockFile = path8.join(this.config.projectsRoot, ".24x7ai", "master.lock");
    const lockResult = await withLock(lockFile, async () => {
      return this.executePipelineStep();
    });
    if (!lockResult.acquired) {
      this.logger.warn("Another pipeline process is currently running (master lock held). Skipping.");
      return null;
    }
    return lockResult.result || null;
  }
  async executePipelineStep() {
    this.logger.info(`Loading ideas from ${this.config.ideaSourceType}: ${this.config.ideaSource}`);
    const ideas = await loadIdeas(
      this.config.ideaSourceType,
      this.config.ideaSource,
      this.config.projectsRoot
    );
    if (ideas.length === 0) {
      this.logger.warn("No ideas found in CSV source.");
      return null;
    }
    for (const item of ideas) {
      this.store.upsertProject({
        slug: item.slug,
        idea: item.idea,
        sl_no: item.sl_no,
        source_csv: this.config.ideaSource
      });
    }
    const allProjects = this.store.listProjects();
    const incomplete = allProjects.filter((p) => !p.mvp_complete);
    if (incomplete.length === 0) {
      this.logger.info("All projects have completed MVP! Fleet is fully initialized.");
      return null;
    }
    const selected = incomplete[0];
    this.logger.info(`Selected project Sl No ${selected.sl_no}: "${selected.idea}" (${selected.slug})`);
    if (this.config.dryRun || this.dryRun) {
      this.logger.info(`[DRY RUN] Would execute MVP for Sl No ${selected.sl_no} (${selected.slug}) using adapter "${this.config.defaultAdapter}"`);
      return null;
    }
    const projectDir = path8.join(this.config.projectsRoot, selected.slug);
    fs8.mkdirSync(projectDir, { recursive: true });
    await ensureGitRepo(projectDir);
    await ensureDevBranch(projectDir);
    this.renderTemplates(projectDir, selected);
    fs8.writeFileSync(
      path8.join(projectDir, ".project-source.json"),
      JSON.stringify(selected, null, 2) + "\n"
    );
    const budgetCheck = await this.otari.checkBudget();
    if (!budgetCheck.allowed) {
      this.logger.error(`Otari budget cap reached. Halting MVP pipeline.`);
      throw new Error("Otari budget cap exceeded");
    }
    const prompt = this.buildMvpPrompt(selected);
    const adapterName = this.config.defaultAdapter || "opencode";
    const adapter = this.registry.get(adapterName);
    this.logger.info(`Invoking adapter "${adapter.name}" in ${projectDir}`);
    const runRecord = this.store.startAgentRun({
      project_id: selected.id,
      adapter: adapter.name,
      prompt,
      run_type: "mvp"
    });
    const gatewayEnv = this.otari.getAdapterEnv(selected.id, "mvp");
    const result = await adapter.invoke({
      projectDir,
      prompt,
      timeout: this.config.stuckTimeoutMs,
      args: this.config.adapterArgs,
      commandOverride: this.config.adapterCommand,
      env: gatewayEnv,
      onStdout: (chunk) => this.logger.debug(chunk.trim()),
      onStderr: (chunk) => this.logger.warn(chunk.trim())
    });
    const status = await adapter.parseStatus(projectDir);
    const mvpComplete = status?.mvp_complete === true;
    const finishedRun = this.store.finishAgentRun(runRecord.id, {
      exit_code: result.exitCode,
      duration_ms: result.duration,
      commits_produced: result.commits.length,
      files_changed: result.filesChanged.length,
      error: result.error
    });
    const newSha = await commitWorkingTree(
      projectDir,
      `feat: autonomous MVP progress for idea ${selected.sl_no} (${selected.slug})`
    );
    if (newSha) {
      this.logger.info(`Committed changes: ${newSha}`);
    }
    if (this.config.github.owner) {
      await syncGitHubRepo(projectDir, selected.slug, this.config.github, this.logger);
    }
    if (mvpComplete) {
      this.logger.info(`MVP Complete for idea ${selected.sl_no}: ${selected.slug}! Activating daemon.`);
      this.store.setMvpComplete(selected.id, true);
    } else {
      this.logger.info(`MVP progress recorded for idea ${selected.sl_no} (mvp_complete: false).`);
    }
    return {
      project: selected,
      run: finishedRun,
      mvpCompleted: mvpComplete,
      commitsProduced: result.commits.length + (newSha ? 1 : 0)
    };
  }
  renderTemplates(projectDir, project) {
    const pkgRoot = path8.resolve(path8.dirname(new URL(import.meta.url).pathname), "../..");
    const templatesDir = path8.join(pkgRoot, "templates");
    const agentsHbs = path8.join(templatesDir, "AGENTS.md.hbs");
    const autoHbs = path8.join(templatesDir, "AUTODEVELOP.md.hbs");
    const agentsDest = path8.join(projectDir, "AGENTS.md");
    const autoDest = path8.join(projectDir, "AUTODEVELOP.md");
    if (!fs8.existsSync(agentsDest) && fs8.existsSync(agentsHbs)) {
      const template = handlebars.compile(fs8.readFileSync(agentsHbs, "utf8"));
      fs8.writeFileSync(agentsDest, template(project));
    }
    if (!fs8.existsSync(autoDest) && fs8.existsSync(autoHbs)) {
      const template = handlebars.compile(fs8.readFileSync(autoHbs, "utf8"));
      fs8.writeFileSync(autoDest, template(project));
    }
  }
  buildMvpPrompt(project) {
    const parts = [];
    if (this.config.promptPrefix) parts.push(this.config.promptPrefix);
    parts.push(
      `Read AGENTS.md, AUTODEVELOP.md and .project-source.json.`,
      `Build or continue the smallest genuinely useful working MVP for idea Sl No ${project.sl_no}: "${project.idea}".`,
      `Inspect and preserve existing work. Work only in this repository on dev.`,
      `Implement actual code, write a clear README documenting setup and usage, and run relevant local checks.`,
      `Maintain valid .agent-status.json with sl_no, project, status, mvp_complete, development_complete, branch, last_run, next_action and blocked.`,
      `Set mvp_complete true only when the core working software is implemented and local tests/checks pass.`,
      `Never set development_complete merely because the MVP works.`,
      `Leave implementation changes in the working tree.`
    );
    if (this.config.promptSuffix) parts.push(this.config.promptSuffix);
    return parts.join(" ");
  }
};

// src/core/daemon-manager.ts
import fs9 from "fs";
import path9 from "path";

// src/github/issues.ts
import { spawn as spawn9 } from "child_process";
async function fetchProjectIssues(projectDir, filterLabel) {
  return new Promise((resolve) => {
    const args = ["issue", "list", "--json", "number,title,body,labels", "--state", "open"];
    if (filterLabel) {
      args.push("--label", filterLabel);
    }
    const proc = spawn9("gh", args, { cwd: projectDir });
    let stdout = "";
    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.on("close", (code) => {
      if (code !== 0) return resolve([]);
      try {
        const issues = JSON.parse(stdout);
        resolve(issues);
      } catch {
        resolve([]);
      }
    });
    proc.on("error", () => resolve([]));
  });
}

// src/github/pr.ts
import { spawn as spawn10 } from "child_process";
async function createPullRequest(projectDir, opts) {
  return new Promise((resolve) => {
    const args = [
      "pr",
      "create",
      "--title",
      opts.title,
      "--body",
      opts.body,
      "--base",
      opts.base || "main",
      "--head",
      opts.head || "dev",
      ...opts.draft ? ["--draft"] : []
    ];
    const proc = spawn10("gh", args, { cwd: projectDir });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true, url: stdout.trim() });
      } else {
        resolve({ success: false, error: stderr.trim() || `Exit code ${code}` });
      }
    });
    proc.on("error", (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

// src/core/stuck-detector.ts
var StuckDetector = class {
  constructor(store, maxConsecutiveNoChanges = 3, stuckTimeoutMs = 30 * 60 * 1e3) {
    this.store = store;
    this.maxConsecutiveNoChanges = maxConsecutiveNoChanges;
    this.stuckTimeoutMs = stuckTimeoutMs;
  }
  store;
  maxConsecutiveNoChanges;
  stuckTimeoutMs;
  checkProject(projectId) {
    const daemonState = this.store.getDaemonState(projectId);
    if (!daemonState) return { isStuck: false };
    if (daemonState.consecutive_no_changes >= this.maxConsecutiveNoChanges) {
      return {
        isStuck: true,
        reason: `Last ${daemonState.consecutive_no_changes} runs produced 0 commits and 0 file changes`
      };
    }
    if (daemonState.consecutive_errors >= 3) {
      return {
        isStuck: true,
        reason: `Failed with consecutive errors (${daemonState.consecutive_errors} times)`
      };
    }
    const recentRuns = this.store.getRecentRuns(projectId, 3);
    if (recentRuns.length >= 3) {
      const allFailed = recentRuns.every((r) => (r.exit_code ?? 0) !== 0 && r.error);
      if (allFailed) {
        const firstError = recentRuns[0].error;
        const allSame = recentRuns.every((r) => r.error === firstError);
        if (allSame) {
          return {
            isStuck: true,
            reason: `Repeated error 3 times: ${firstError?.slice(0, 100)}`
          };
        }
      }
    }
    return { isStuck: false };
  }
  evaluateAndApply(projectId) {
    const check = this.checkProject(projectId);
    if (check.isStuck) {
      this.store.updateDaemonStatus(projectId, "stuck");
      return true;
    }
    return false;
  }
};

// src/core/scheduler.ts
function parseIntervalMs(schedule) {
  const trimmed = schedule.trim();
  const minuteMatch = trimmed.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (minuteMatch) {
    const mins = parseInt(minuteMatch[1], 10);
    return mins * 60 * 1e3;
  }
  if (trimmed === "0 * * * *") {
    return 60 * 60 * 1e3;
  }
  if (trimmed === "0 0 * * *") {
    return 24 * 60 * 60 * 1e3;
  }
  return 30 * 60 * 1e3;
}
function computeNextRun(schedule, baseDate = /* @__PURE__ */ new Date()) {
  const intervalMs = parseIntervalMs(schedule);
  return new Date(baseDate.getTime() + intervalMs);
}
function isRunDue(nextRunAt, backoffUntil) {
  const now = Date.now();
  if (backoffUntil) {
    const backoffTime = new Date(backoffUntil).getTime();
    if (now < backoffTime) return false;
  }
  if (!nextRunAt) return true;
  const dueTime = new Date(nextRunAt).getTime();
  return now >= dueTime;
}
function computeBackoffUntil(consecutiveErrors, baseMs = 60 * 1e3) {
  const factor = Math.min(Math.pow(2, consecutiveErrors - 1), 60);
  const backoffMs = factor * baseMs;
  return new Date(Date.now() + backoffMs).toISOString();
}

// src/core/daemon-manager.ts
var DaemonManager = class {
  config;
  store;
  registry;
  logger;
  otari;
  stuckDetector;
  constructor(opts) {
    this.config = opts.config;
    this.store = opts.store;
    this.registry = opts.registry || defaultRegistry;
    this.logger = opts.logger || new Logger(
      path9.join(this.config.projectsRoot, ".24x7ai", "logs", "daemon.log"),
      "daemon"
    );
    this.otari = new OtariGateway(this.config.otari);
    this.stuckDetector = new StuckDetector(
      this.store,
      this.config.stuckConsecutiveNoChanges,
      this.config.stuckTimeoutMs
    );
  }
  start(identifier) {
    const project = this.resolveProject(identifier);
    this.store.setDaemonActive(project.id, true);
    this.logger.info(`Started daemon for ${project.slug} (sl_no: ${project.sl_no})`);
    return project;
  }
  stop(identifier) {
    const project = this.resolveProject(identifier);
    this.store.setDaemonActive(project.id, false);
    this.logger.info(`Stopped daemon for ${project.slug} (sl_no: ${project.sl_no})`);
    return project;
  }
  pause(identifier) {
    const project = this.resolveProject(identifier);
    this.store.updateDaemonStatus(project.id, "paused");
    this.logger.info(`Paused daemon for ${project.slug} (sl_no: ${project.sl_no})`);
    return project;
  }
  restart(identifier) {
    const project = this.resolveProject(identifier);
    this.store.updateDaemonStatus(project.id, "idle", { backoffUntil: "" });
    this.logger.info(`Restarted daemon for ${project.slug} (cleared backoff/errors)`);
    return project;
  }
  resume(identifier) {
    const project = this.resolveProject(identifier);
    this.store.updateDaemonStatus(project.id, "idle");
    this.logger.info(`Resumed daemon for ${project.slug} (sl_no: ${project.sl_no})`);
    return project;
  }
  async supervise() {
    this.logger.info("Starting fleet supervision pass...");
    const allProjects = this.store.listProjects();
    const activeDaemons = allProjects.filter((p) => p.daemon_active && p.daemon_status !== "paused");
    if (activeDaemons.length === 0) {
      this.logger.info("No active daemons in fleet.");
      return { executed: 0, skipped: 0, errors: 0 };
    }
    const dueProjects = [];
    for (const p of activeDaemons) {
      const isStuck = this.stuckDetector.evaluateAndApply(p.id);
      if (isStuck) {
        this.logger.warn(`Project ${p.slug} is STUCK. Skipping until manually resumed.`);
        continue;
      }
      const daemonState = this.store.getDaemonState(p.id);
      const due = isRunDue(daemonState?.next_run_at, daemonState?.backoff_until);
      if (due) {
        dueProjects.push(p);
      }
    }
    const maxParallel = this.config.maxParallel || 4;
    const batch = dueProjects.slice(0, maxParallel);
    this.logger.info(`Supervising ${dueProjects.length} due daemons (running batch of ${batch.length}, max parallel: ${maxParallel})`);
    let executed = 0;
    let errors = 0;
    await Promise.all(
      batch.map(async (project) => {
        try {
          const success = await this.runSingleDaemon(project);
          if (success) executed++;
          else errors++;
        } catch (err) {
          errors++;
          this.logger.error(`Error in daemon for ${project.slug}: ${err.message}`);
        }
      })
    );
    return {
      executed,
      skipped: dueProjects.length - batch.length,
      errors
    };
  }
  async runSingleDaemon(project) {
    const projectDir = path9.join(this.config.projectsRoot, project.slug);
    const lockDir = path9.join(this.config.projectsRoot, ".24x7ai", "locks");
    fs9.mkdirSync(lockDir, { recursive: true });
    const lockFile = path9.join(lockDir, `${project.slug}.lock`);
    const result = await withLock(lockFile, async () => {
      return this.executeDaemonCycle(project, projectDir);
    });
    if (!result.acquired) {
      this.logger.warn(`Daemon lock already held for ${project.slug}. Skipping this cycle.`);
      return false;
    }
    return result.result ?? false;
  }
  async executeDaemonCycle(project, projectDir) {
    this.logger.info(`Daemon waking up for ${project.slug}...`);
    await ensureGitRepo(projectDir);
    await ensureDevBranch(projectDir);
    let issuePrompt = "";
    const issues = await fetchProjectIssues(projectDir, this.config.github.issueFilterLabel);
    if (issues.length > 0) {
      const topIssue = issues[0];
      this.logger.info(`Found open GitHub issue #${topIssue.number}: "${topIssue.title}" for ${project.slug}`);
      issuePrompt = ` Focus on addressing GitHub issue #${topIssue.number}: "${topIssue.title}". Issue description: ${topIssue.body || "No description provided."}`;
    }
    const prompt = [
      `Read AGENTS.md, AUTODEVELOP.md, .project-source.json and .agent-status.json.`,
      `Inspect this repository and implement one useful, coherent improvement toward its ongoing development.`,
      issuePrompt,
      `Make actual code changes, update tests and README, and update .agent-status.json.`,
      `Stay on dev. Do not claim external work or tests that were not performed.`,
      `Do not run git push or modify main.`
    ].join(" ");
    const adapterName = this.config.defaultAdapter || "opencode";
    const adapter = this.registry.get(adapterName);
    const runRecord = this.store.startAgentRun({
      project_id: project.id,
      adapter: adapter.name,
      prompt,
      run_type: "daemon"
    });
    const gatewayEnv = this.otari.getAdapterEnv(project.id, "daemon");
    const agentResult = await adapter.invoke({
      projectDir,
      prompt,
      timeout: this.config.stuckTimeoutMs,
      args: this.config.adapterArgs,
      commandOverride: this.config.adapterCommand,
      env: gatewayEnv,
      onStdout: (c) => this.logger.debug(`[${project.slug}] ${c.trim()}`),
      onStderr: (c) => this.logger.warn(`[${project.slug}] ${c.trim()}`)
    });
    const finishedRun = this.store.finishAgentRun(runRecord.id, {
      exit_code: agentResult.exitCode,
      duration_ms: agentResult.duration,
      commits_produced: agentResult.commits.length,
      files_changed: agentResult.filesChanged.length,
      error: agentResult.error
    });
    const isSuccess = agentResult.exitCode === 0;
    let committedSha = null;
    if (isSuccess) {
      committedSha = await commitWorkingTree(
        projectDir,
        `chore: daemon improvement for ${project.slug}`
      );
    }
    if (isSuccess) {
      const nextRun = computeNextRun(project.daemon_schedule);
      this.store.updateDaemonStatus(project.id, "idle", {
        nextRunAt: nextRun.toISOString()
      });
      this.logger.info(`Daemon cycle succeeded for ${project.slug}. Next run at ${nextRun.toLocaleTimeString()}.`);
      if (this.config.github.owner && (agentResult.commits.length > 0 || committedSha)) {
        await syncGitHubRepo(projectDir, project.slug, this.config.github, this.logger);
        if (this.config.github.autoPr) {
          await createPullRequest(projectDir, {
            title: `Continuous Improvement for ${project.slug}`,
            body: `Automated improvement generated by 24x7ai daemon.

${issuePrompt || "General ongoing enhancement and test coverage."}`
          });
        }
      }
    } else {
      const daemonState = this.store.getDaemonState(project.id);
      const backoff = computeBackoffUntil(daemonState?.consecutive_errors || 1);
      this.store.updateDaemonStatus(project.id, "error", {
        backoffUntil: backoff
      });
      this.logger.warn(`Daemon cycle failed for ${project.slug}. Backing off until ${new Date(backoff).toLocaleTimeString()}.`);
    }
    return isSuccess;
  }
  resolveProject(identifier) {
    let project = null;
    if (typeof identifier === "number" || /^\d+$/.test(String(identifier))) {
      project = this.store.getProjectById(Number(identifier)) || this.store.getProjectBySlNo(Number(identifier));
    } else {
      project = this.store.getProjectBySlug(String(identifier));
    }
    if (!project) {
      throw new Error(`Project not found: ${identifier}`);
    }
    return project;
  }
};

// src/utils/worktree.ts
import { spawn as spawn11 } from "child_process";
import fs10 from "fs";
async function createWorktree(repoDir, worktreeDir, branch = "dev") {
  return new Promise((resolve) => {
    fs10.mkdirSync(worktreeDir, { recursive: true });
    const proc = spawn11("git", ["worktree", "add", "-B", branch, worktreeDir, branch], {
      cwd: repoDir,
      stdio: "ignore"
    });
    proc.on("close", (code) => {
      if (code === 0) return resolve(true);
      const fallback = spawn11("git", ["worktree", "add", "-b", branch, worktreeDir, "HEAD"], {
        cwd: repoDir,
        stdio: "ignore"
      });
      fallback.on("close", (c) => resolve(c === 0));
      fallback.on("error", () => resolve(false));
    });
    proc.on("error", () => resolve(false));
  });
}
async function removeWorktree(repoDir, worktreeDir) {
  return new Promise((resolve) => {
    const proc = spawn11("git", ["worktree", "remove", "--force", worktreeDir], {
      cwd: repoDir,
      stdio: "ignore"
    });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}
async function pruneWorktrees(repoDir) {
  return new Promise((resolve) => {
    const proc = spawn11("git", ["worktree", "prune"], { cwd: repoDir, stdio: "ignore" });
    proc.on("close", () => resolve());
    proc.on("error", () => resolve());
  });
}
export {
  AdapterRegistry,
  AiderAdapter,
  CONFIG_FILE_NAME,
  ClaudeCodeAdapter,
  CodexAdapter,
  CustomAdapter,
  DEFAULT_CONFIG,
  DaemonManager,
  FileLock,
  FleetStore,
  LEGACY_ENV_FILE_NAME,
  Logger,
  MvpPipeline,
  OpenCodeAdapter,
  OpenHandsAdapter,
  OtariGateway,
  StuckDetector,
  closeDb,
  commandExists,
  commitWorkingTree,
  computeBackoffUntil,
  computeNextRun,
  convertGoogleSheetsUrl,
  createPullRequest,
  createWorktree,
  defaultRegistry,
  ensureDevBranch,
  ensureGitRepo,
  fetchIdeaSource,
  fetchProjectIssues,
  generateSlug,
  getCommitsSince,
  getConfigFilePath,
  getDb,
  getDbPath,
  getFilesChanged,
  getHeadCommit,
  initDb,
  isRunDue,
  loadConfig,
  loadIdeas,
  parseIdeasCsv,
  parseIntervalMs,
  parseLegacyEnv,
  pruneWorktrees,
  readAgentStatusJson,
  removeWorktree,
  resolveProjectsRoot,
  saveConfig,
  syncGitHubRepo,
  withLock
};
//# sourceMappingURL=index.js.map