import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDb } from '../src/state/db.js';
import { FleetStore } from '../src/state/queries.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('SQLite FleetStore', () => {
  let tmpDir: string;
  let db: Database.Database;
  let store: FleetStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), '24x7ai-test-'));
    const dbPath = path.join(tmpDir, 'test.db');
    db = initDb(dbPath);
    store = new FleetStore(db);
  });

  afterEach(() => {
    try {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('upserts and retrieves projects', () => {
    const project = store.upsertProject({
      slug: 'task-board',
      idea: 'Collaborative Kanban Task Board',
      sl_no: 1,
    });

    expect(project.id).toBeDefined();
    expect(project.slug).toBe('task-board');
    expect(project.mvp_complete).toBe(false);

    const fetched = store.getProjectBySlug('task-board');
    expect(fetched?.idea).toBe('Collaborative Kanban Task Board');
    expect(fetched?.sl_no).toBe(1);
  });

  it('tracks agent runs and updates daemon state', () => {
    const project = store.upsertProject({
      slug: 'notes-app',
      idea: 'Minimalist Notes App',
      sl_no: 2,
    });

    const run = store.startAgentRun({
      project_id: project.id,
      adapter: 'codex',
      prompt: 'Build MVP',
      run_type: 'mvp',
    });

    expect(run.id).toBeDefined();
    expect(run.run_type).toBe('mvp');

    const finished = store.finishAgentRun(run.id, {
      exit_code: 0,
      duration_ms: 1500,
      commits_produced: 2,
      files_changed: 5,
    });

    expect(finished.exit_code).toBe(0);
    expect(finished.commits_produced).toBe(2);

    const daemonState = store.getDaemonState(project.id);
    expect(daemonState?.status).toBe('idle');
    expect(daemonState?.consecutive_errors).toBe(0);
  });

  it('calculates fleet summary metrics accurately', () => {
    store.upsertProject({ slug: 'p1', idea: 'Idea 1', sl_no: 1, mvp_complete: true, daemon_active: true });
    store.upsertProject({ slug: 'p2', idea: 'Idea 2', sl_no: 2, mvp_complete: false, daemon_active: false });

    const summary = store.getFleetSummary();
    expect(summary.totalProjects).toBe(2);
    expect(summary.mvpCompleted).toBe(1);
    expect(summary.activeDaemons).toBe(1);
  });
});
