#!/usr/bin/env node

// src/cli/index.ts
import { Command } from "commander";

// src/cli/commands/init.ts
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import path5 from "path";
import pc2 from "picocolors";

// src/config/loader.ts
import fs from "fs";
import path from "path";

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

// src/csv/sources.ts
import fs2 from "fs";
import path2 from "path";

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
  const localPath = baseDir ? path2.resolve(baseDir, source) : path2.resolve(source);
  if (!fs2.existsSync(localPath)) {
    throw new Error(`Local CSV file not found: ${localPath}`);
  }
  return fs2.readFileSync(localPath, "utf8");
}
async function loadIdeas(sourceType, source, baseDir) {
  const content = await fetchIdeaSource(sourceType, source, baseDir);
  return parseIdeasCsv(content);
}

// src/adapters/codex.ts
import { spawn as spawn2 } from "child_process";

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
      let output2 = "";
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
        output2 += text;
        opts.onStdout?.(text);
      });
      proc.stderr.on("data", (d) => {
        const text = d.toString();
        output2 += text;
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
          rawOutput: output2,
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
      let output2 = "";
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
        output2 += text;
        opts.onStdout?.(text);
      });
      proc.stderr.on("data", (d) => {
        const text = d.toString();
        output2 += text;
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
          rawOutput: output2,
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
      let output2 = "";
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
        output2 += text;
        opts.onStdout?.(text);
      });
      proc.stderr.on("data", (d) => {
        const text = d.toString();
        output2 += text;
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
          rawOutput: output2,
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
      let output2 = "";
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
        output2 += text;
        opts.onStdout?.(text);
      });
      proc.stderr.on("data", (d) => {
        const text = d.toString();
        output2 += text;
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
          rawOutput: output2,
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
      let output2 = "";
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
        output2 += text;
        opts.onStdout?.(text);
      });
      proc.stderr.on("data", (d) => {
        const text = d.toString();
        output2 += text;
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
          rawOutput: output2,
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
      let output2 = "";
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
        output2 += text;
        opts.onStdout?.(text);
      });
      proc.stderr.on("data", (d) => {
        const text = d.toString();
        output2 += text;
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
          rawOutput: output2,
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

// src/cli/commands/cron.ts
import { spawnSync } from "child_process";
import path4 from "path";
import pc from "picocolors";
var CRON_TAG = "# 24x7ai-fleet";
function installFleetCron(projectsDir, pipelineSchedule = "0 * * * *", superviseSchedule = "*/15 * * * *") {
  const root = resolveProjectsRoot(projectsDir);
  const pipelineCmd = `${pipelineSchedule} npx 24x7ai run ${root} >> ${path4.join(root, ".24x7ai", "logs", "pipeline-cron.log")} 2>&1 ${CRON_TAG} pipeline`;
  const superviseCmd = `${superviseSchedule} npx 24x7ai daemon supervise ${root} >> ${path4.join(root, ".24x7ai", "logs", "daemon-cron.log")} 2>&1 ${CRON_TAG} supervise`;
  const existing = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  const lines = (existing.stdout || "").split(/\r?\n/).filter((line) => !line.includes(CRON_TAG) && !line.includes("# agent-orchestrator") && line.trim());
  lines.push(pipelineCmd, superviseCmd);
  const res = spawnSync("crontab", ["-"], {
    input: `${lines.join("\n")}
`,
    stdio: ["pipe", "inherit", "inherit"]
  });
  if (res.status === 0) {
    console.log(pc.green(`\u2713 Installed cron entries for 24x7ai in ${root}`));
    console.log(`  Pipeline schedule:   ${pipelineSchedule}`);
    console.log(`  Supervisor schedule: ${superviseSchedule}`);
  } else {
    console.error(pc.red("Failed to install crontab entries. Ensure crontab is available."));
  }
}

// src/cli/commands/init.ts
async function runInit(targetDir) {
  const rl = readline.createInterface({ input, output });
  async function prompt(question, defaultValue = "") {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    return answer || defaultValue;
  }
  try {
    console.log(pc2.cyan("\n24x7ai v2 \u2014 Universal Agent Fleet Controller Setup"));
    console.log(pc2.gray("Configure your autonomous idea-to-MVP factory and fleet daemons.\n"));
    const rootInput = await prompt("Projects directory", targetDir || DEFAULT_CONFIG.projectsRoot);
    const projectsRoot = resolveProjectsRoot(rootInput);
    const existingConfig = loadConfig(projectsRoot);
    const sourceTypeInput = await prompt("Idea source type (local-csv, csv-url, google-sheets)", existingConfig.ideaSourceType);
    let sourceType = "local-csv";
    if (sourceTypeInput === "csv-url" || sourceTypeInput === "google-sheets") {
      sourceType = sourceTypeInput;
    }
    let source = await prompt(
      sourceType === "local-csv" ? "CSV file path" : "CSV or Google Sheets URL",
      existingConfig.ideaSource
    );
    if (sourceType === "google-sheets" || sourceType === "csv-url") {
      source = convertGoogleSheetsUrl(source);
    }
    const detected = await defaultRegistry.detectAvailable();
    const availableNames = detected.filter((d) => d.available).map((d) => d.adapter.name);
    console.log(pc2.gray(`Detected adapters on host: ${availableNames.join(", ") || "none"}`));
    const defaultAdapter = await prompt("Default agent adapter", existingConfig.defaultAdapter);
    const adapterCommand = await prompt("Custom agent command (optional, press enter to skip)", existingConfig.adapterCommand || "");
    const githubOwner = await prompt("GitHub owner / org (blank disables automatic remote pushes)", existingConfig.github.owner || "");
    let privateRepos = true;
    if (githubOwner) {
      const privInput = await prompt("Create GitHub repositories as private? (yes/no)", "yes");
      privateRepos = privInput.toLowerCase().startsWith("y");
    }
    const enableOtari = (await prompt("Enable Otari model gateway proxy? (yes/no)", existingConfig.otari.enabled ? "yes" : "no")).toLowerCase().startsWith("y");
    let otariEndpoint = existingConfig.otari.endpoint;
    if (enableOtari) {
      otariEndpoint = await prompt("Otari gateway endpoint", otariEndpoint);
    }
    const updated = saveConfig(projectsRoot, {
      projectsRoot,
      ideaSourceType: sourceType,
      ideaSource: source,
      defaultAdapter,
      adapterCommand: adapterCommand || void 0,
      github: {
        owner: githubOwner || void 0,
        privateRepos,
        autoPush: Boolean(githubOwner)
      },
      otari: {
        enabled: enableOtari,
        endpoint: otariEndpoint
      }
    });
    console.log(pc2.green("\n\u2713 Configuration saved to: ") + path5.join(projectsRoot, ".24x7ai.config.json"));
    if (process.platform !== "win32") {
      const installCron = (await prompt("Install scheduled cron jobs for fleet? (yes/no)", "no")).toLowerCase().startsWith("y");
      if (installCron) {
        installFleetCron(projectsRoot);
      }
    }
    console.log(pc2.cyan("\nReady! Try running:"));
    console.log(`  npx 24x7ai run ${projectsRoot}      ${pc2.gray("# Run serial MVP pipeline")}`);
    console.log(`  npx 24x7ai fleet ${projectsRoot}    ${pc2.gray("# Launch TUI fleet controller")}`);
    console.log(`  npx 24x7ai status ${projectsRoot}   ${pc2.gray("# Check fleet status table")}
`);
  } finally {
    rl.close();
  }
}

// src/cli/commands/run.ts
import pc4 from "picocolors";

// src/state/db.ts
import fs4 from "fs";
import path6 from "path";
import Database from "better-sqlite3";
var activeDb = null;
var activeDbPath = null;
function getDbPath(projectsRoot) {
  const root = resolveProjectsRoot(projectsRoot);
  const stateDir = path6.join(root, ".24x7ai");
  fs4.mkdirSync(stateDir, { recursive: true });
  return path6.join(stateDir, "fleet.db");
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

// src/core/pipeline.ts
import fs8 from "fs";
import path10 from "path";
import handlebars from "handlebars";

// src/github/repo.ts
import fs5 from "fs";
import path7 from "path";
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
async function ensureGitRepo(projectDir, defaultBranch = "main") {
  const gitDir = path7.join(projectDir, ".git");
  if (!fs5.existsSync(gitDir)) {
    await execGit(["init", "-b", defaultBranch], projectDir);
    await execGit(["config", "user.name", process.env.GIT_USER_NAME || "Autonomous Agent"], projectDir);
    await execGit(["config", "user.email", process.env.GIT_USER_EMAIL || "agent@localhost"], projectDir);
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
import path8 from "path";
import pc3 from "picocolors";
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
    if (level === "info") coloredLevel = pc3.cyan(coloredLevel);
    else if (level === "warn") coloredLevel = pc3.yellow(coloredLevel);
    else if (level === "error") coloredLevel = pc3.red(coloredLevel);
    else coloredLevel = pc3.gray(coloredLevel);
    const consoleOutput = `${pc3.gray(timestamp)} ${coloredLevel.padEnd(5)} ${formattedPrefix}${message}`;
    if (level === "error") {
      console.error(consoleOutput, ...meta);
    } else {
      console.log(consoleOutput, ...meta);
    }
    if (this.logFilePath) {
      try {
        fs6.mkdirSync(path8.dirname(this.logFilePath), { recursive: true });
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
import path9 from "path";
var FileLock = class {
  constructor(lockPath) {
    this.lockPath = lockPath;
  }
  lockPath;
  fd = null;
  locked = false;
  acquire() {
    try {
      const dir = path9.dirname(this.lockPath);
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
      path10.join(this.config.projectsRoot, ".24x7ai", "logs", "pipeline.log"),
      "pipeline"
    );
    this.otari = new OtariGateway(this.config.otari);
  }
  async run() {
    const lockFile = path10.join(this.config.projectsRoot, ".24x7ai", "master.lock");
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
    const projectDir = path10.join(this.config.projectsRoot, selected.slug);
    fs8.mkdirSync(projectDir, { recursive: true });
    await ensureGitRepo(projectDir);
    await ensureDevBranch(projectDir);
    this.renderTemplates(projectDir, selected);
    fs8.writeFileSync(
      path10.join(projectDir, ".project-source.json"),
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
    const pkgRoot = path10.resolve(path10.dirname(new URL(import.meta.url).pathname), "../..");
    const templatesDir = path10.join(pkgRoot, "templates");
    const agentsHbs = path10.join(templatesDir, "AGENTS.md.hbs");
    const autoHbs = path10.join(templatesDir, "AUTODEVELOP.md.hbs");
    const agentsDest = path10.join(projectDir, "AGENTS.md");
    const autoDest = path10.join(projectDir, "AUTODEVELOP.md");
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
    return [
      `Read AGENTS.md, AUTODEVELOP.md and .project-source.json.`,
      `Build or continue the smallest genuinely useful working MVP for idea Sl No ${project.sl_no}: "${project.idea}".`,
      `Inspect and preserve existing work. Work only in this repository on dev.`,
      `Implement actual code, write a clear README documenting setup and usage, and run relevant local checks.`,
      `Maintain valid .agent-status.json with sl_no, project, status, mvp_complete, development_complete, branch, last_run, next_action and blocked.`,
      `Set mvp_complete true only when the core working software is implemented and local tests/checks pass.`,
      `Never set development_complete merely because the MVP works.`,
      `Leave implementation changes in the working tree.`
    ].join(" ");
  }
};

// src/cli/commands/run.ts
async function runMvpPipeline(projectsDir, options) {
  const root = resolveProjectsRoot(projectsDir);
  const config = loadConfig(root);
  if (options?.maxParallel) config.maxParallel = options.maxParallel;
  const db = getDb(root);
  const store = new FleetStore(db);
  const pipeline = new MvpPipeline({ config, store });
  console.log(pc4.cyan(`
Starting 24x7ai MVP Pipeline in ${root}...`));
  const outcome = await pipeline.run();
  if (outcome) {
    console.log(pc4.green(`
\u2713 Successfully processed Sl No ${outcome.project.sl_no}: ${outcome.project.slug}`));
    console.log(`  Duration: ${(outcome.run.duration_ms || 0) / 1e3}s`);
    console.log(`  Commits produced: ${outcome.commitsProduced}`);
    console.log(`  MVP Complete: ${outcome.mvpCompleted ? pc4.green("YES") : pc4.yellow("In Progress")}
`);
  } else {
    console.log(pc4.gray("\nPipeline step completed. No eligible uncompleted projects or lock held.\n"));
  }
}

// src/cli/commands/fleet.ts
import React2 from "react";
import { render } from "ink";

// src/core/daemon-manager.ts
import fs9 from "fs";
import path11 from "path";

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
      opts.head || "dev"
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
      path11.join(this.config.projectsRoot, ".24x7ai", "logs", "daemon.log"),
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
    const projectDir = path11.join(this.config.projectsRoot, project.slug);
    const lockDir = path11.join(this.config.projectsRoot, ".24x7ai", "locks");
    fs9.mkdirSync(lockDir, { recursive: true });
    const lockFile = path11.join(lockDir, `${project.slug}.lock`);
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

// src/tui/app.tsx
import { useState, useEffect } from "react";
import { useInput, useApp, Box as Box4 } from "ink";

// src/tui/views/fleet-overview.tsx
import { Box, Text } from "ink";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var FleetOverview = ({
  projects,
  selectedIndex,
  maxParallel,
  pipelineStatus
}) => {
  const activeCount = projects.filter((p) => p.daemon_active).length;
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", padding: 1, borderStyle: "round", borderColor: "cyan", children: [
    /* @__PURE__ */ jsxs(Box, { justifyContent: "space-between", marginBottom: 1, children: [
      /* @__PURE__ */ jsx(Text, { bold: true, color: "cyan", children: "24x7ai Fleet Controller" }),
      /* @__PURE__ */ jsxs(Text, { color: "gray", children: [
        "max-parallel: ",
        maxParallel,
        " | daemons: ",
        activeCount,
        "/",
        projects.length
      ] })
    ] }),
    /* @__PURE__ */ jsx(Box, { flexDirection: "column", marginY: 1, paddingX: 1, borderStyle: "single", borderColor: "blue", children: pipelineStatus?.activeProject ? /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsxs(Text, { children: [
        /* @__PURE__ */ jsx(Text, { bold: true, color: "yellow", children: "Pipeline:" }),
        " Building #",
        pipelineStatus.slNo,
        "/",
        pipelineStatus.total,
        " \u2014 \u201C",
        pipelineStatus.activeProject,
        "\u201D"
      ] }),
      /* @__PURE__ */ jsxs(Text, { color: "gray", children: [
        "Agent: ",
        pipelineStatus.agent || "codex",
        " | ",
        pipelineStatus.duration || "Active"
      ] })
    ] }) : /* @__PURE__ */ jsx(Text, { color: "green", children: "Pipeline: All scheduled MVPs complete or idle" }) }),
    /* @__PURE__ */ jsxs(Box, { flexDirection: "column", marginY: 1, children: [
      /* @__PURE__ */ jsxs(Box, { borderStyle: "single", borderColor: "gray", paddingX: 1, children: [
        /* @__PURE__ */ jsx(Box, { width: "6%", children: /* @__PURE__ */ jsx(Text, { bold: true, children: "#" }) }),
        /* @__PURE__ */ jsx(Box, { width: "30%", children: /* @__PURE__ */ jsx(Text, { bold: true, children: "Project" }) }),
        /* @__PURE__ */ jsx(Box, { width: "15%", children: /* @__PURE__ */ jsx(Text, { bold: true, children: "Status" }) }),
        /* @__PURE__ */ jsx(Box, { width: "15%", children: /* @__PURE__ */ jsx(Text, { bold: true, children: "MVP" }) }),
        /* @__PURE__ */ jsx(Box, { width: "18%", children: /* @__PURE__ */ jsx(Text, { bold: true, children: "Last Run" }) }),
        /* @__PURE__ */ jsx(Box, { width: "16%", children: /* @__PURE__ */ jsx(Text, { bold: true, children: "Commits" }) })
      ] }),
      projects.length === 0 ? /* @__PURE__ */ jsx(Box, { padding: 1, children: /* @__PURE__ */ jsx(Text, { color: "gray", children: "No projects in fleet. Run `npx 24x7ai run` to ingest ideas." }) }) : projects.map((p, idx) => {
        const isSelected = idx === selectedIndex;
        let statusColor = "green";
        let statusText = p.daemon_status || "idle";
        if (statusText === "running") {
          statusColor = "yellow";
          statusText = "\u25CF running";
        } else if (statusText === "stuck") {
          statusColor = "red";
          statusText = "\u25CF stuck";
        } else if (statusText === "paused") {
          statusColor = "gray";
          statusText = "\u25CF paused";
        } else if (statusText === "error") {
          statusColor = "red";
          statusText = "\u25CF error";
        } else {
          statusColor = "green";
          statusText = "\u25CF idle";
        }
        return /* @__PURE__ */ jsxs(
          Box,
          {
            paddingX: 1,
            backgroundColor: isSelected ? "gray" : void 0,
            children: [
              /* @__PURE__ */ jsx(Box, { width: "6%", children: /* @__PURE__ */ jsx(Text, { color: isSelected ? "black" : "white", children: p.sl_no }) }),
              /* @__PURE__ */ jsx(Box, { width: "30%", children: /* @__PURE__ */ jsx(Text, { bold: true, color: isSelected ? "black" : "white", children: p.slug.slice(0, 24) }) }),
              /* @__PURE__ */ jsx(Box, { width: "15%", children: /* @__PURE__ */ jsx(Text, { color: statusColor, children: statusText }) }),
              /* @__PURE__ */ jsx(Box, { width: "15%", children: /* @__PURE__ */ jsx(Text, { color: p.mvp_complete ? "green" : "yellow", children: p.mvp_complete ? "Done" : "Pending" }) }),
              /* @__PURE__ */ jsx(Box, { width: "18%", children: /* @__PURE__ */ jsx(Text, { color: isSelected ? "black" : "gray", children: p.last_run_started_at ? p.last_run_started_at.slice(11, 16) : "\u2014" }) }),
              /* @__PURE__ */ jsx(Box, { width: "16%", children: /* @__PURE__ */ jsx(Text, { color: isSelected ? "black" : "white", children: p.last_run_commits || 0 }) })
            ]
          },
          p.id
        );
      })
    ] }),
    /* @__PURE__ */ jsx(Box, { marginTop: 1, justifyContent: "space-between", children: /* @__PURE__ */ jsx(Text, { color: "gray", children: "[\u2191/\u2193] Select  [s]tart  [p]ause  [r]un now  [l]ogs  [q]uit" }) })
  ] });
};

// src/tui/views/daemon-detail.tsx
import { Box as Box2, Text as Text2 } from "ink";
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var DaemonDetail = ({ project, recentRuns }) => {
  return /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", padding: 1, borderStyle: "round", borderColor: "cyan", children: [
    /* @__PURE__ */ jsxs2(Box2, { justifyContent: "space-between", marginBottom: 1, children: [
      /* @__PURE__ */ jsxs2(Text2, { bold: true, color: "cyan", children: [
        "Daemon Details: ",
        project.slug,
        " (#",
        project.sl_no,
        ")"
      ] }),
      /* @__PURE__ */ jsx2(Text2, { color: "gray", children: "[Esc / b] Back" })
    ] }),
    /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", marginY: 1, children: [
      /* @__PURE__ */ jsxs2(Text2, { children: [
        /* @__PURE__ */ jsx2(Text2, { bold: true, children: "Idea:" }),
        " ",
        project.idea
      ] }),
      /* @__PURE__ */ jsxs2(Text2, { children: [
        /* @__PURE__ */ jsx2(Text2, { bold: true, children: "Status:" }),
        " ",
        project.daemon_status,
        " | ",
        /* @__PURE__ */ jsx2(Text2, { bold: true, children: "MVP Complete:" }),
        " ",
        project.mvp_complete ? "Yes" : "No"
      ] }),
      /* @__PURE__ */ jsxs2(Text2, { children: [
        /* @__PURE__ */ jsx2(Text2, { bold: true, children: "Schedule:" }),
        " ",
        project.daemon_schedule,
        " | ",
        /* @__PURE__ */ jsx2(Text2, { bold: true, children: "Next Run:" }),
        " ",
        project.next_run_at || "Due"
      ] }),
      /* @__PURE__ */ jsxs2(Text2, { children: [
        /* @__PURE__ */ jsx2(Text2, { bold: true, children: "Consecutive Errors:" }),
        " ",
        project.consecutive_errors || 0
      ] })
    ] }),
    /* @__PURE__ */ jsxs2(Box2, { flexDirection: "column", marginTop: 1, children: [
      /* @__PURE__ */ jsxs2(Text2, { bold: true, color: "yellow", children: [
        "Recent Runs (",
        recentRuns.length,
        "):"
      ] }),
      recentRuns.length === 0 ? /* @__PURE__ */ jsx2(Text2, { color: "gray", children: "No recorded runs yet." }) : recentRuns.map((r) => /* @__PURE__ */ jsx2(Box2, { marginY: 0, children: /* @__PURE__ */ jsxs2(Text2, { children: [
        "#",
        r.id,
        " [",
        r.run_type.toUpperCase(),
        "] ",
        r.started_at.slice(0, 19),
        " | Exit: ",
        r.exit_code ?? "running",
        " | Commits: ",
        r.commits_produced,
        " | Files: ",
        r.files_changed,
        " | Duration: ",
        Math.round((r.duration_ms || 0) / 1e3),
        "s"
      ] }) }, r.id))
    ] })
  ] });
};

// src/tui/views/logs.tsx
import { Box as Box3, Text as Text3 } from "ink";
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
var LogsViewer = ({ title, lines }) => {
  const visibleLines = lines.slice(-20);
  return /* @__PURE__ */ jsxs3(Box3, { flexDirection: "column", padding: 1, borderStyle: "round", borderColor: "yellow", children: [
    /* @__PURE__ */ jsxs3(Box3, { justifyContent: "space-between", marginBottom: 1, children: [
      /* @__PURE__ */ jsxs3(Text3, { bold: true, color: "yellow", children: [
        "Log Stream: ",
        title
      ] }),
      /* @__PURE__ */ jsx3(Text3, { color: "gray", children: "[Esc / b] Back" })
    ] }),
    /* @__PURE__ */ jsx3(Box3, { flexDirection: "column", children: visibleLines.length === 0 ? /* @__PURE__ */ jsx3(Text3, { color: "gray", children: "No log output yet." }) : visibleLines.map((line, idx) => /* @__PURE__ */ jsx3(Text3, { color: line.includes("ERROR") ? "red" : line.includes("WARN") ? "yellow" : "white", children: line }, idx)) })
  ] });
};

// src/tui/app.tsx
import fs10 from "fs";
import path12 from "path";
import { jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
var App = ({ store, config, daemonManager }) => {
  const { exit } = useApp();
  const [projects, setProjects] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewMode, setViewMode] = useState("overview");
  const [recentRuns, setRecentRuns] = useState([]);
  const [logLines, setLogLines] = useState([]);
  const refresh = () => {
    const list = store.listProjects();
    setProjects(list);
    if (selectedIndex >= list.length && list.length > 0) {
      setSelectedIndex(list.length - 1);
    }
  };
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 2e3);
    return () => clearInterval(interval);
  }, []);
  const selectedProject = projects[selectedIndex];
  useInput((input2, key) => {
    if (input2 === "q" || key.ctrl && input2 === "c") {
      exit();
      return;
    }
    if (viewMode === "detail" || viewMode === "logs") {
      if (key.escape || input2 === "b") {
        setViewMode("overview");
        return;
      }
    }
    if (viewMode === "overview") {
      if (key.upArrow) {
        setSelectedIndex((prev) => prev > 0 ? prev - 1 : prev);
      } else if (key.downArrow) {
        setSelectedIndex((prev) => prev < projects.length - 1 ? prev + 1 : prev);
      } else if (input2 === "s" && selectedProject) {
        daemonManager.start(selectedProject.id);
        refresh();
      } else if (input2 === "p" && selectedProject) {
        daemonManager.pause(selectedProject.id);
        refresh();
      } else if (input2 === "r" && selectedProject) {
        daemonManager.runSingleDaemon(selectedProject).then(refresh);
      } else if (key.return && selectedProject) {
        setRecentRuns(store.getRecentRuns(selectedProject.id, 5));
        setViewMode("detail");
      } else if (input2 === "l") {
        const logPath = path12.join(config.projectsRoot, ".24x7ai", "logs", "pipeline.log");
        if (fs10.existsSync(logPath)) {
          const lines = fs10.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
          setLogLines(lines);
        } else {
          setLogLines(["No log file found yet."]);
        }
        setViewMode("logs");
      }
    }
  });
  return /* @__PURE__ */ jsxs4(Box4, { flexDirection: "column", children: [
    viewMode === "overview" && /* @__PURE__ */ jsx4(
      FleetOverview,
      {
        projects,
        selectedIndex,
        maxParallel: config.maxParallel
      }
    ),
    viewMode === "detail" && selectedProject && /* @__PURE__ */ jsx4(
      DaemonDetail,
      {
        project: selectedProject,
        recentRuns,
        onBack: () => setViewMode("overview")
      }
    ),
    viewMode === "logs" && /* @__PURE__ */ jsx4(
      LogsViewer,
      {
        title: selectedProject ? selectedProject.slug : "Fleet",
        lines: logLines,
        onBack: () => setViewMode("overview")
      }
    )
  ] });
};

// src/cli/commands/fleet.ts
async function runFleetTui(projectsDir) {
  const root = resolveProjectsRoot(projectsDir);
  const config = loadConfig(root);
  const db = getDb(root);
  const store = new FleetStore(db);
  const daemonManager = new DaemonManager({ config, store });
  const { waitUntilExit } = render(
    React2.createElement(App, {
      store,
      config,
      daemonManager
    })
  );
  await waitUntilExit();
}

// src/cli/commands/status.ts
import pc5 from "picocolors";
function runStatus(projectsDir, options) {
  if (options?.json) {
    const root2 = resolveProjectsRoot(projectsDir);
    const db2 = getDb(root2);
    const store2 = new FleetStore(db2);
    const summary2 = store2.getFleetSummary();
    const projects2 = store2.listProjects();
    console.log(JSON.stringify({ summary: summary2, projects: projects2 }, null, 2));
    return;
  }
  const root = resolveProjectsRoot(projectsDir);
  const db = getDb(root);
  const store = new FleetStore(db);
  const summary = store.getFleetSummary();
  const projects = store.listProjects();
  console.log(pc5.cyan(`
24x7ai Fleet Status: ${root}`));
  console.log(
    `Total: ${summary.totalProjects} | MVP Complete: ${summary.mvpCompleted} | Active Daemons: ${summary.activeDaemons} | Running: ${summary.runningCount} | Stuck: ${summary.stuckCount}
`
  );
  if (projects.length === 0) {
    console.log(pc5.gray("No projects found in fleet database."));
    return;
  }
  const pad = (s, len) => String(s ?? "").padEnd(len).slice(0, len);
  console.log(
    pc5.bold(
      `${pad("#", 4)} ${pad("Slug", 28)} ${pad("MVP", 10)} ${pad("Daemon", 10)} ${pad("Next Run", 16)} ${pad("Commits", 8)}`
    )
  );
  console.log(pc5.gray("-".repeat(80)));
  for (const p of projects) {
    const mvpStr = p.mvp_complete ? pc5.green("DONE") : pc5.yellow("PENDING");
    let daemonStr = pc5.gray("OFF");
    if (p.daemon_active) {
      if (p.daemon_status === "running") daemonStr = pc5.yellow("RUNNING");
      else if (p.daemon_status === "stuck") daemonStr = pc5.red("STUCK");
      else if (p.daemon_status === "paused") daemonStr = pc5.gray("PAUSED");
      else daemonStr = pc5.green("IDLE");
    }
    const nextRun = p.next_run_at ? new Date(p.next_run_at).toLocaleTimeString() : "\u2014";
    console.log(
      `${pad(p.sl_no, 4)} ${pad(p.slug, 28)} ${pad(mvpStr, 19)} ${pad(daemonStr, 19)} ${pad(nextRun, 16)} ${pad(p.last_run_commits, 8)}`
    );
  }
  console.log("");
}

// src/cli/commands/daemon.ts
import pc6 from "picocolors";
async function handleDaemonCommand(action, identifier, options) {
  const root = resolveProjectsRoot(options?.projectsDir);
  const config = loadConfig(root);
  const db = getDb(root);
  const store = new FleetStore(db);
  const daemonManager = new DaemonManager({ config, store });
  if (action === "supervise") {
    console.log(pc6.cyan(`Running fleet supervision in ${root}...`));
    const res = await daemonManager.supervise();
    console.log(pc6.green(`\u2713 Supervision complete: ${res.executed} executed, ${res.skipped} skipped, ${res.errors} errors.`));
    return;
  }
  if (action === "list") {
    const projects = store.listProjects();
    console.log(pc6.cyan(`
Active Fleet Daemons: ${root}`));
    for (const p of projects) {
      if (p.daemon_active) {
        console.log(`  #${p.sl_no} ${p.slug} [${p.daemon_status}] schedule: ${p.daemon_schedule} next: ${p.next_run_at || "now"}`);
      }
    }
    console.log("");
    return;
  }
  if (!identifier) {
    console.error(pc6.red(`Error: Project identifier (slug or sl_no) is required for 'daemon ${action}'`));
    process.exitCode = 1;
    return;
  }
  try {
    if (action === "start") {
      const p = daemonManager.start(identifier);
      console.log(pc6.green(`\u2713 Started daemon for ${p.slug} (sl_no: ${p.sl_no})`));
    } else if (action === "stop") {
      const p = daemonManager.stop(identifier);
      console.log(pc6.yellow(`\u2713 Stopped daemon for ${p.slug} (sl_no: ${p.sl_no})`));
    } else if (action === "pause") {
      const p = daemonManager.pause(identifier);
      console.log(pc6.gray(`\u2713 Paused daemon for ${p.slug} (sl_no: ${p.sl_no})`));
    } else if (action === "resume") {
      const p = daemonManager.resume(identifier);
      console.log(pc6.green(`\u2713 Resumed daemon for ${p.slug} (sl_no: ${p.sl_no})`));
    } else if (action === "run") {
      const project = store.getProjectBySlug(identifier) || store.getProjectById(Number(identifier));
      if (!project) throw new Error(`Project not found: ${identifier}`);
      console.log(pc6.cyan(`Executing immediate daemon run for ${project.slug}...`));
      const ok = await daemonManager.runSingleDaemon(project);
      if (ok) console.log(pc6.green(`\u2713 Daemon run succeeded for ${project.slug}`));
      else console.log(pc6.red(`\u2717 Daemon run failed or skipped for ${project.slug}`));
    }
  } catch (err) {
    console.error(pc6.red(`Error: ${err.message}`));
    process.exitCode = 1;
  }
}

// src/cli/commands/adapter.ts
import pc7 from "picocolors";
async function handleAdapterCommand(action, name, options) {
  if (action === "list") {
    console.log(pc7.cyan("\n24x7ai Agent Adapters:"));
    const detected = await defaultRegistry.detectAvailable();
    for (const item of detected) {
      const status = item.available ? pc7.green("INSTALLED") : pc7.gray("NOT DETECTED");
      console.log(`  ${pc7.bold(item.adapter.name.padEnd(14))} ${status.padEnd(16)} ${item.adapter.description}`);
    }
    console.log("");
    return;
  }
  if (action === "test") {
    if (!name) {
      console.error(pc7.red("Error: Adapter name is required for 'adapter test <name>'"));
      process.exitCode = 1;
      return;
    }
    const root = resolveProjectsRoot(options?.projectsDir);
    console.log(pc7.cyan(`Testing adapter "${name}" in ${root}...`));
    try {
      const outcome = await defaultRegistry.testAdapter(name, root);
      if (outcome.success) {
        console.log(pc7.green(`\u2713 Adapter "${name}" tested successfully.`));
        console.log(`  Exit code: ${outcome.result.exitCode}`);
        console.log(`  Duration: ${outcome.result.duration}ms`);
      } else {
        console.log(pc7.red(`\u2717 Adapter "${name}" test failed.`));
        console.log(`  Error: ${outcome.result.error || "Non-zero exit"}`);
      }
    } catch (err) {
      console.error(pc7.red(`Error: ${err.message}`));
      process.exitCode = 1;
    }
  }
}

// src/cli/commands/logs.ts
import fs11 from "fs";
import path13 from "path";
import { spawn as spawn11 } from "child_process";
import pc8 from "picocolors";
function runLogs(identifier, options) {
  const root = resolveProjectsRoot(options?.projectsDir);
  let logFile;
  if (!identifier || identifier === "pipeline" || identifier === "master") {
    logFile = path13.join(root, ".24x7ai", "logs", "pipeline.log");
  } else if (identifier === "daemon" || identifier === "supervisor") {
    logFile = path13.join(root, ".24x7ai", "logs", "daemon.log");
  } else {
    logFile = path13.join(root, identifier, "agent.log");
    if (!fs11.existsSync(logFile)) {
      logFile = path13.join(root, ".24x7ai", "logs", `${identifier}.log`);
    }
  }
  if (!fs11.existsSync(logFile)) {
    console.error(pc8.red(`Log file not found: ${logFile}`));
    process.exitCode = 1;
    return;
  }
  const args = ["-n", "100"];
  if (options?.follow) {
    args.push("-f");
  }
  args.push(logFile);
  const proc = spawn11("tail", args, { stdio: "inherit" });
  proc.on("close", (code) => {
    process.exitCode = code ?? 0;
  });
}

// src/cli/commands/set-ideas.ts
import fs12 from "fs";
import path14 from "path";
import pc9 from "picocolors";
function runSetIdeas(source, projectsDir) {
  const root = resolveProjectsRoot(projectsDir);
  const config = loadConfig(root);
  let sourceType = config.ideaSourceType;
  let finalSource = source;
  if (source.startsWith("http://") || source.startsWith("https://")) {
    if (source.includes("docs.google.com/spreadsheets")) {
      sourceType = "google-sheets";
      finalSource = convertGoogleSheetsUrl(source);
    } else {
      sourceType = "csv-url";
    }
  } else {
    sourceType = "local-csv";
    finalSource = path14.resolve(source);
    if (!fs12.existsSync(finalSource)) {
      console.error(pc9.red(`CSV file not found: ${finalSource}`));
      process.exitCode = 1;
      return;
    }
  }
  saveConfig(root, {
    ideaSourceType: sourceType,
    ideaSource: finalSource
  });
  console.log(pc9.green(`\u2713 Idea source updated to ${sourceType}: ${finalSource}`));
}

// src/cli/commands/doctor.ts
import { spawnSync as spawnSync2 } from "child_process";
import pc10 from "picocolors";
async function runDoctor() {
  console.log(pc10.cyan("\n24x7ai Fleet Diagnostics\n"));
  const nodeVer = process.version;
  const major = parseInt(nodeVer.slice(1).split(".")[0], 10);
  if (major >= 18) {
    console.log(pc10.green("  \u2713 Node.js: ") + nodeVer + pc10.gray(" (supported)"));
  } else {
    console.log(pc10.red("  \u2717 Node.js: ") + nodeVer + pc10.yellow(" (requires Node.js 18+)"));
  }
  const git = spawnSync2("git", ["--version"], { encoding: "utf8" });
  if (git.status === 0) {
    console.log(pc10.green("  \u2713 Git: ") + git.stdout.trim());
  } else {
    console.log(pc10.red("  \u2717 Git: not found in PATH"));
  }
  const gh = spawnSync2("gh", ["--version"], { encoding: "utf8" });
  if (gh.status === 0) {
    const auth = spawnSync2("gh", ["auth", "status"], { encoding: "utf8" });
    const authOk = auth.status === 0;
    console.log(pc10.green("  \u2713 GitHub CLI: ") + gh.stdout.split("\n")[0] + (authOk ? pc10.green(" (authenticated)") : pc10.yellow(" (unauthenticated)")));
  } else {
    console.log(pc10.yellow("  ! GitHub CLI: not installed (optional for remote pushes)"));
  }
  const cron = spawnSync2("crontab", ["-l"], { encoding: "utf8" });
  if (cron.status === 0 || !cron.stderr?.includes("not found")) {
    console.log(pc10.green("  \u2713 Crontab: available for fleet scheduling"));
  } else {
    console.log(pc10.yellow("  ! Crontab: unavailable or restricted"));
  }
  console.log(pc10.cyan("\nAgent Adapters:"));
  const detected = await defaultRegistry.detectAvailable();
  for (const item of detected) {
    if (item.available) {
      console.log(pc10.green("  \u2713 ") + pc10.bold(item.adapter.name.padEnd(14)) + pc10.gray(item.adapter.description));
    } else {
      console.log(pc10.gray("  - " + item.adapter.name.padEnd(14) + item.adapter.description));
    }
  }
  console.log("\n" + pc10.green("System check complete.\n"));
}

// src/cli/index.ts
var program = new Command();
program.name("24x7ai").description("Universal Agent Fleet Controller \u2014 1 package, 1 vps, 1 command").version("2.0.0-alpha.1");
program.command("init [dir]").description("Interactive guided setup for projects, ideas, adapters and schedules").action(async (dir) => {
  await runInit(dir);
});
program.command("run [dir]").description("Run the serial MVP pipeline to process ideas from CSV").option("-p, --max-parallel <n>", "Maximum parallel executions", parseInt).action(async (dir, opts) => {
  await runMvpPipeline(dir, opts);
});
program.command("fleet [dir]").description("Launch the live Ink TUI Fleet Controller dashboard").action(async (dir) => {
  await runFleetTui(dir);
});
program.command("status [dir]").description("Display fleet status table and recent runs").option("--json", "Output fleet status in JSON format").action((dir, opts) => {
  runStatus(dir, opts);
});
program.command("daemon <action> [target]").description("Manage per-project daemons (start, stop, pause, resume, run, supervise, list)").option("-d, --dir <dir>", "Projects directory").action(async (action, target, opts) => {
  await handleDaemonCommand(action, target, { projectsDir: opts.dir });
});
program.command("supervise [dir]").description("Run a supervision pass across all active project daemons").action(async (dir) => {
  await handleDaemonCommand("supervise", void 0, { projectsDir: dir });
});
program.command("adapter <action> [name]").description("Inspect or test agent adapters (list, test)").option("-d, --dir <dir>", "Projects directory").action(async (action, name, opts) => {
  await handleAdapterCommand(action, name, { projectsDir: opts.dir });
});
program.command("logs [target]").description("Follow or view fleet or project agent logs").option("-f, --follow", "Follow log stream").option("-d, --dir <dir>", "Projects directory").action((target, opts) => {
  runLogs(target, { follow: opts.follow, projectsDir: opts.dir });
});
program.command("set-ideas <source> [dir]").description("Update idea source to a local CSV, URL or Google Sheets").action((source, dir) => {
  runSetIdeas(source, dir);
});
program.command("cron [dir] [pipelineSchedule] [superviseSchedule]").description("Install or update system cron entries for automated fleet execution").action((dir, pSched, sSched) => {
  installFleetCron(dir, pSched, sSched);
});
program.command("doctor").description("Run system diagnostic check for host dependencies").action(async () => {
  await runDoctor();
});
program.parseAsync(process.argv).catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
//# sourceMappingURL=cli.js.map