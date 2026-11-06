import { AgentAdapter, AgentResult } from './base.js';
import { CodexAdapter } from './codex.js';
import { ClaudeCodeAdapter } from './claude-code.js';
import { OpenCodeAdapter } from './opencode.js';
import { AiderAdapter } from './aider.js';
import { OpenHandsAdapter } from './openhands.js';
import { CustomAdapter } from './custom.js';

export class AdapterRegistry {
  private adapters = new Map<string, AgentAdapter>();

  constructor() {
    this.register(new CodexAdapter());
    this.register(new ClaudeCodeAdapter());
    this.register(new OpenCodeAdapter());
    this.register(new AiderAdapter());
    this.register(new OpenHandsAdapter());
    this.register(new CustomAdapter());
  }

  register(adapter: AgentAdapter): void {
    this.adapters.set(adapter.name.toLowerCase(), adapter);
  }

  get(name: string): AgentAdapter {
    const key = name.toLowerCase();
    const adapter = this.adapters.get(key);
    if (!adapter) {
      // If not found, return custom adapter or throw
      if (this.adapters.has('custom')) {
        return this.adapters.get('custom')!;
      }
      throw new Error(`Unknown agent adapter: ${name}. Available: ${this.listNames().join(', ')}`);
    }
    return adapter;
  }

  has(name: string): boolean {
    return this.adapters.has(name.toLowerCase());
  }

  list(): AgentAdapter[] {
    return Array.from(this.adapters.values());
  }

  listNames(): string[] {
    return Array.from(this.adapters.keys());
  }

  async detectAvailable(): Promise<{ adapter: AgentAdapter; available: boolean }[]> {
    const results = await Promise.all(
      this.list().map(async (adapter) => {
        const available = await adapter.detect();
        return { adapter, available };
      })
    );
    return results;
  }

  async testAdapter(name: string, projectDir: string): Promise<{ success: boolean; result: AgentResult }> {
    const adapter = this.get(name);
    const result = await adapter.invoke({
      projectDir,
      prompt: 'Test run — echo "test"',
      timeout: 10000,
    });
    return {
      success: result.exitCode === 0,
      result,
    };
  }
}

export const defaultRegistry = new AdapterRegistry();
