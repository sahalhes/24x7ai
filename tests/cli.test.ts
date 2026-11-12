import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const cliPath = path.resolve(__dirname, '../dist/cli.js');

describe('CLI Integration Tests', () => {
  it('displays help menu', () => {
    const res = spawnSync('node', [cliPath, '--help'], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Universal Agent Fleet Controller');
    expect(res.stdout).toContain('init [dir]');
    expect(res.stdout).toContain('doctor');
  });

  it('displays version matching 2.0.0', () => {
    const res = spawnSync('node', [cliPath, '--version'], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe('2.0.0');
  });

  it('lists agent adapters', () => {
    const res = spawnSync('node', [cliPath, 'adapter', 'list'], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('codex');
    expect(res.stdout).toContain('claude-code');
    expect(res.stdout).toContain('opencode');
  });

  it('lists configured runtime agents and empty task runs', () => {
    const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), '24x7ai-cli-agents-'));
    try {
      const agents = spawnSync('node', [cliPath, 'agents', 'list', '--json', '--dir', projectsDir], { encoding: 'utf8', cwd: projectsDir });
      expect(agents.status).toBe(0);
      expect(JSON.parse(agents.stdout)).toHaveLength(3);

      const runs = spawnSync('node', [cliPath, 'runs', 'list', '--dir', projectsDir], { encoding: 'utf8' });
      expect(runs.status).toBe(0);
      expect(runs.stdout).toContain('No agent task runs found');
    } finally {
      fs.rmSync(projectsDir, { recursive: true, force: true });
    }
  });

  it('reports an unknown task run without invoking the pipeline', () => {
    const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), '24x7ai-cli-run-'));
    try {
      const res = spawnSync('node', [cliPath, 'run', 'status', 'missing', '--dir', projectsDir], { encoding: 'utf8' });
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('Run "missing" not found');
    } finally {
      fs.rmSync(projectsDir, { recursive: true, force: true });
    }
  });

  it('runs doctor diagnostics', () => {
    const res = spawnSync('node', [cliPath, 'doctor'], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('24x7ai Fleet Diagnostics');
    expect(res.stdout).toContain('Node.js:');
  });
});
