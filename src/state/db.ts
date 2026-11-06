import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { resolveProjectsRoot } from '../config/loader.js';

let activeDb: Database.Database | null = null;
let activeDbPath: string | null = null;

export function getDbPath(projectsRoot?: string): string {
  const root = resolveProjectsRoot(projectsRoot);
  const stateDir = path.join(root, '.24x7ai');
  fs.mkdirSync(stateDir, { recursive: true });
  return path.join(stateDir, 'fleet.db');
}

export function initDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Core schema migrations
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

export function getDb(projectsRoot?: string): Database.Database {
  const dbPath = getDbPath(projectsRoot);
  if (activeDb && activeDbPath === dbPath) {
    return activeDb;
  }
  if (activeDb) {
    try {
      activeDb.close();
    } catch {
      // ignore
    }
  }
  activeDb = initDb(dbPath);
  activeDbPath = dbPath;
  return activeDb;
}

export function closeDb(): void {
  if (activeDb) {
    try {
      activeDb.close();
    } catch {
      // ignore
    }
    activeDb = null;
    activeDbPath = null;
  }
}
