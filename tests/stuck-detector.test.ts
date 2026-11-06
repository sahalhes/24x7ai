import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDb } from '../src/state/db.js';
import { FleetStore } from '../src/state/queries.js';
import { StuckDetector } from '../src/core/stuck-detector.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Stuck Detector', () => {
  let tmpDir: string;
  let db: Database.Database;
  let store: FleetStore;
  let detector: StuckDetector;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), '24x7ai-stuck-test-'));
    db = initDb(path.join(tmpDir, 'test.db'));
    store = new FleetStore(db);
    detector = new StuckDetector(store, 3, 30000);
  });

  afterEach(() => {
    try {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('detects stuck daemon after 3 consecutive no-change runs', () => {
    const project = store.upsertProject({ slug: 'test-p', idea: 'Test Idea', sl_no: 1 });

    // Run 1: 0 commits, 0 files
    const r1 = store.startAgentRun({ project_id: project.id, adapter: 'test', run_type: 'daemon' });
    store.finishAgentRun(r1.id, { exit_code: 0, duration_ms: 100, commits_produced: 0, files_changed: 0 });

    // Run 2: 0 commits, 0 files
    const r2 = store.startAgentRun({ project_id: project.id, adapter: 'test', run_type: 'daemon' });
    store.finishAgentRun(r2.id, { exit_code: 0, duration_ms: 100, commits_produced: 0, files_changed: 0 });

    expect(detector.checkProject(project.id).isStuck).toBe(false);

    // Run 3: 0 commits, 0 files -> trips threshold!
    const r3 = store.startAgentRun({ project_id: project.id, adapter: 'test', run_type: 'daemon' });
    store.finishAgentRun(r3.id, { exit_code: 0, duration_ms: 100, commits_produced: 0, files_changed: 0 });

    const check = detector.checkProject(project.id);
    expect(check.isStuck).toBe(true);
    expect(check.reason).toContain('0 commits and 0 file changes');

    // Applied to DB
    const applied = detector.evaluateAndApply(project.id);
    expect(applied).toBe(true);
    expect(store.getDaemonState(project.id)?.status).toBe('stuck');
  });

  it('detects stuck daemon after repeated consecutive errors', () => {
    const project = store.upsertProject({ slug: 'err-p', idea: 'Error Idea', sl_no: 2 });

    for (let i = 0; i < 3; i++) {
      const r = store.startAgentRun({ project_id: project.id, adapter: 'test', run_type: 'daemon' });
      store.finishAgentRun(r.id, { exit_code: 1, duration_ms: 100, commits_produced: 0, files_changed: 0, error: 'Crash: connection refused' });
    }

    const check = detector.checkProject(project.id);
    expect(check.isStuck).toBe(true);
  });
});
