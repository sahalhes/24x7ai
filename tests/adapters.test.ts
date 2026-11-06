import { describe, it, expect } from 'vitest';
import { AdapterRegistry } from '../src/adapters/registry.js';
import { CustomAdapter } from '../src/adapters/custom.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Adapter Registry & Execution', () => {
  it('registers all default adapters', () => {
    const registry = new AdapterRegistry();
    const names = registry.listNames();

    expect(names).toContain('codex');
    expect(names).toContain('claude-code');
    expect(names).toContain('opencode');
    expect(names).toContain('aider');
    expect(names).toContain('openhands');
    expect(names).toContain('custom');
  });

  it('executes custom adapter successfully', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), '24x7ai-adapter-test-'));
    try {
      const adapter = new CustomAdapter();
      const res = await adapter.invoke({
        projectDir: tmpDir,
        prompt: 'test-prompt',
        commandOverride: 'echo',
      });

      expect(res.exitCode).toBe(0);
      expect(res.rawOutput?.trim()).toBe('test-prompt');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('reads .agent-status.json correctly', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), '24x7ai-status-test-'));
    try {
      fs.writeFileSync(
        path.join(tmpDir, '.agent-status.json'),
        JSON.stringify({
          sl_no: 1,
          project: 'demo',
          mvp_complete: true,
          status: 'Ready',
        })
      );

      const adapter = new CustomAdapter();
      const status = await adapter.parseStatus(tmpDir);
      expect(status?.mvp_complete).toBe(true);
      expect(status?.project).toBe('demo');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
