import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
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

  it('displays version matching 2.0.0-alpha.1', () => {
    const res = spawnSync('node', [cliPath, '--version'], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe('2.0.0-alpha.1');
  });

  it('lists agent adapters', () => {
    const res = spawnSync('node', [cliPath, 'adapter', 'list'], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('codex');
    expect(res.stdout).toContain('claude-code');
    expect(res.stdout).toContain('opencode');
  });

  it('runs doctor diagnostics', () => {
    const res = spawnSync('node', [cliPath, 'doctor'], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('24x7ai Fleet Diagnostics');
    expect(res.stdout).toContain('Node.js:');
  });
});
