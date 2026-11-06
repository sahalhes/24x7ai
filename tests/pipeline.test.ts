import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { initDb } from '../src/state/db.js';
import { FleetStore } from '../src/state/queries.js';
import { MvpPipeline } from '../src/core/pipeline.js';
import { AdapterRegistry } from '../src/adapters/registry.js';
import { AgentAdapter, InvokeOptions, AgentResult, ProjectStatus } from '../src/adapters/base.js';
import { DEFAULT_CONFIG, AppConfig } from '../src/config/schema.js';

class MockAgentAdapter implements AgentAdapter {
  readonly name = 'mock-agent';
  readonly description = 'Mock agent for pipeline tests';

  async detect(): Promise<boolean> {
    return true;
  }

  async invoke(opts: InvokeOptions): Promise<AgentResult> {
    // Simulate agent writing code and status file
    fs.writeFileSync(path.join(opts.projectDir, 'index.js'), 'console.log("Hello from MVP");\n');
    fs.writeFileSync(
      path.join(opts.projectDir, '.agent-status.json'),
      JSON.stringify({
        sl_no: 1,
        project: 'mock-project',
        mvp_complete: true,
        status: 'MVP functional',
      })
    );

    return {
      exitCode: 0,
      duration: 250,
      commits: [],
      filesChanged: ['index.js', '.agent-status.json'],
    };
  }

  async parseStatus(projectDir: string): Promise<ProjectStatus | null> {
    const p = path.join(projectDir, '.agent-status.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
}

describe('MvpPipeline End-to-End', () => {
  let tmpDir: string;
  let db: Database.Database;
  let store: FleetStore;
  let registry: AdapterRegistry;
  let config: AppConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), '24x7ai-pipeline-test-'));
    const csvPath = path.join(tmpDir, 'ideas.csv');
    fs.writeFileSync(
      csvPath,
      `Sl No,Idea,Agent Automatable\n1,Automated Bookkeeper,YES\n2,Fitness Tracker,YES\n`
    );

    db = initDb(path.join(tmpDir, 'test.db'));
    store = new FleetStore(db);

    registry = new AdapterRegistry();
    registry.register(new MockAgentAdapter());

    config = {
      ...DEFAULT_CONFIG,
      projectsRoot: tmpDir,
      ideaSourceType: 'local-csv',
      ideaSource: csvPath,
      defaultAdapter: 'mock-agent',
      github: { owner: undefined },
    };
  });

  afterEach(() => {
    try {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('runs MVP pipeline and marks project mvp_complete', async () => {
    const pipeline = new MvpPipeline({ config, store, registry });
    const outcome = await pipeline.run();

    expect(outcome).not.toBeNull();
    expect(outcome?.project.sl_no).toBe(1);
    expect(outcome?.project.slug).toBe('automated-bookkeeper');
    expect(outcome?.mvpCompleted).toBe(true);

    // Verify git repo and files
    const projectDir = path.join(tmpDir, 'automated-bookkeeper');
    expect(fs.existsSync(path.join(projectDir, '.git'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'AGENTS.md'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'AUTODEVELOP.md'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'index.js'))).toBe(true);

    // Verify DB state
    const savedProject = store.getProjectBySlug('automated-bookkeeper');
    expect(savedProject?.mvp_complete).toBe(true);
    expect(savedProject?.daemon_active).toBe(true);
  });
});
