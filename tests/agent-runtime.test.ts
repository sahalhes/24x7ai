import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoleAgent } from '../src/agents/agent.js';
import { AgentCancelledError, AgentTimeoutError, InvalidStateTransitionError } from '../src/agents/errors.js';
import { TaskDispatcher } from '../src/agents/dispatcher.js';
import { AgentFactory } from '../src/agents/factory.js';
import { RunLifecycle } from '../src/agents/lifecycle.js';
import { ExecutionManager } from '../src/agents/manager.js';
import { AgentRegistry } from '../src/agents/registry.js';
import { AgentRuntimeStore } from '../src/agents/store.js';
import type { Agent, AgentExecutionResult, AgentRun, AgentRunContext, RuntimeLogger } from '../src/agents/types.js';
import type { AgentRole } from '../src/providers/otari.js';
import { initDb } from '../src/state/db.js';

const silentLogger: RuntimeLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function result(agent: Agent, context: AgentRunContext, content = 'done'): AgentExecutionResult {
  const now = new Date().toISOString();
  return {
    runId: context.runId,
    correlationId: context.correlationId,
    agentId: agent.id,
    role: agent.role,
    model: agent.model,
    output: { kind: agent.role === 'architect' ? 'plan' : agent.role === 'builder' ? 'implementation' : 'test_report', content },
    startedAt: now,
    finishedAt: now,
  };
}

function stubAgent(
  run: Agent['run'],
  id = 'builder',
  role: AgentRole = 'builder',
): Agent {
  return {
    id,
    role,
    model: 'kimi-k3.1-pro',
    providerModel: 'together:moonshotai/kimi-k3.1-pro',
    systemInstructions: 'Test instructions',
    timeoutMs: 50,
    run,
  };
}

function persistedRun(overrides: Partial<AgentRun> = {}): AgentRun {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? 'recovered-run',
    agentId: 'builder',
    role: 'builder',
    model: 'kimi-k3.1-pro',
    correlationId: 'correlation-recovery',
    status: 'queued',
    task: { prompt: 'Resume this task' },
    attempt: 0,
    maxRetries: 0,
    timeoutMs: 100,
    createdAt: now,
    queuedAt: now,
    updatedAt: now,
    metadata: { attempts: [] },
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Condition was not reached');
}

describe('agent runtime', () => {
  let tmpDir: string;
  let db: Database.Database;
  let store: AgentRuntimeStore;
  let registry: AgentRegistry;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), '24x7ai-agents-'));
    db = initDb(path.join(tmpDir, 'runtime.db'));
    store = new AgentRuntimeStore(db);
    registry = new AgentRegistry();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function manager(agent: Agent, options: { maxConcurrent?: number; maxRetries?: number } = {}): ExecutionManager {
    registry.register(agent);
    return new ExecutionManager(registry, store, { logger: silentLogger, ...options });
  }

  it('creates all three initial agents with role-based Kimi model resolution', () => {
    const provider = { chat: vi.fn() };
    const agents = new AgentFactory({ provider }).createInitialAgents();

    expect(agents.map((agent) => agent.role)).toEqual(['architect', 'builder', 'tester']);
    expect(agents.map((agent) => agent.id)).toEqual(['architect', 'builder', 'tester']);
    for (const agent of agents) {
      expect(agent.model).toBe('kimi-k3.1-pro');
      expect(agent.providerModel).toBe('together:moonshotai/kimi-k3.1-pro');
      expect(agent.systemInstructions.length).toBeGreaterThan(20);
    }
  });

  it('executes through Otari with instructions, context, and a structured role result', async () => {
    const chat = vi.fn().mockResolvedValue({
      id: 'otari-response',
      model: 'together:moonshotai/kimi-k3.1-pro',
      content: '1. Inspect\n2. Implement',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    const agent = new AgentFactory({ provider: { chat } }).create('architect');

    const output = await agent.run(
      { prompt: 'Design a runtime', context: { milestone: 2 }, correlationId: 'task-correlation' },
      { runId: 'run-direct', correlationId: 'task-correlation', attempt: 1, timeoutMs: 1000 },
    );

    expect(output.output).toEqual({ kind: 'plan', content: '1. Inspect\n2. Implement' });
    expect(output.providerResponseId).toBe('otari-response');
    expect(output.usage?.totalTokens).toBe(15);
    const request = chat.mock.calls[0][0];
    expect(request.model).toBe('together:moonshotai/kimi-k3.1-pro');
    expect(request.messages[0]).toEqual({ role: 'system', content: agent.systemInstructions });
    expect(request.messages[1].content).toContain('"milestone": 2');
    expect(chat.mock.calls[0][1]).toMatchObject({ timeoutMs: 1000, maxRetries: 0 });
  });

  it('persists a successful run, timestamps, IDs, result, and execution metadata', async () => {
    const agent = stubAgent(vi.fn());
    vi.spyOn(agent, 'run').mockImplementation(async (_task, context) => result(agent, context!));
    const runtime = manager(agent);

    const handle = runtime.dispatch('builder', { prompt: 'Build it' }, {
      runId: 'run-success',
      correlationId: 'correlation-success',
      metadata: { source: 'unit-test' },
    });
    await expect(handle.result).resolves.toMatchObject({ runId: 'run-success' });

    const run = store.getRun('run-success')!;
    expect(run.status).toBe('completed');
    expect(run.correlationId).toBe('correlation-success');
    expect(run.startedAt).toBeDefined();
    expect(run.finishedAt).toBeDefined();
    expect(run.result?.output.kind).toBe('implementation');
    expect(run.metadata.source).toBe('unit-test');
    expect(run.metadata.attempts).toHaveLength(1);
    expect(store.getAgent('builder')?.providerModel).toContain('kimi-k3.1-pro');
  });

  it('captures failures and stops at the configured retry limit', async () => {
    const runMock = vi.fn().mockRejectedValue(new Error('provider unavailable'));
    const runtime = manager(stubAgent(runMock), { maxRetries: 2 });
    const handle = runtime.dispatch('builder', { prompt: 'Build it' }, { runId: 'run-failed' });

    await expect(handle.result).rejects.toThrow('provider unavailable');
    expect(runMock).toHaveBeenCalledTimes(3);
    const run = store.getRun('run-failed')!;
    expect(run.status).toBe('failed');
    expect(run.attempt).toBe(3);
    expect(run.error).toMatchObject({ message: 'provider unavailable', attempt: 3 });
    expect(run.metadata.attempts).toHaveLength(3);
    expect(run.finishedAt).toBeDefined();
  });

  it('retries a failed attempt and persists a successful final result', async () => {
    const agent = stubAgent(vi.fn());
    registry.register(agent);
    const runtime = new ExecutionManager(registry, store, { logger: silentLogger, maxRetries: 1 });
    vi.spyOn(agent, 'run')
      .mockRejectedValueOnce(new Error('temporary'))
      .mockImplementationOnce(async (_task, context) => result(agent, context!));

    await expect(runtime.execute('builder', { prompt: 'Retry' }, { runId: 'run-retry' })).resolves.toBeDefined();
    const run = store.getRun('run-retry')!;
    expect(run.status).toBe('completed');
    expect(run.attempt).toBe(2);
    expect(run.error).toBeUndefined();
    expect(run.metadata.attempts).toMatchObject([
      { attempt: 1, status: 'failed' },
      { attempt: 2, status: 'completed' },
    ]);
  });

  it('times out an unresponsive attempt without waiting for the agent promise', async () => {
    const runMock = vi.fn().mockReturnValue(new Promise<AgentExecutionResult>(() => {}));
    const runtime = manager(stubAgent(runMock));
    const handle = runtime.dispatch('builder', { prompt: 'Hang' }, { runId: 'run-timeout', timeoutMs: 10 });

    await expect(handle.result).rejects.toBeInstanceOf(AgentTimeoutError);
    const run = store.getRun('run-timeout')!;
    expect(run.status).toBe('timed_out');
    expect(run.error?.name).toBe('AgentTimeoutError');
    await waitFor(() => runtime.activeCount === 0);
  });

  it('cancels a running attempt, aborts its signal, and does not retry', async () => {
    let started = false;
    const runMock = vi.fn().mockImplementation((_task, context: AgentRunContext) => {
      started = true;
      return new Promise<AgentExecutionResult>((_resolve, reject) => {
        context.signal?.addEventListener('abort', () => reject(context.signal?.reason), { once: true });
      });
    });
    const runtime = manager(stubAgent(runMock), { maxRetries: 5 });
    const handle = runtime.dispatch('builder', { prompt: 'Cancel' }, { runId: 'run-cancelled' });
    await waitFor(() => started);

    expect(runtime.cancel('run-cancelled')).toBe(true);
    await expect(handle.result).rejects.toBeInstanceOf(AgentCancelledError);
    expect(runMock).toHaveBeenCalledOnce();
    expect(store.getRun('run-cancelled')?.status).toBe('cancelled');
    expect(runtime.cancel('run-cancelled')).toBe(false);
  });

  it('cancels queued work during graceful shutdown while allowing running work to finish', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const agent = stubAgent(vi.fn());
    registry.register(agent);
    vi.spyOn(agent, 'run').mockImplementation(async (_task, context) => {
      await gate;
      return result(agent, context!);
    });
    const runtime = new ExecutionManager(registry, store, { logger: silentLogger, maxConcurrent: 1 });
    const running = runtime.dispatch('builder', { prompt: 'First' }, { runId: 'run-running' });
    const queued = runtime.dispatch('builder', { prompt: 'Second' }, { runId: 'run-queued' });
    await waitFor(() => runtime.activeCount === 1);

    const shutdown = runtime.shutdown();
    release();
    await expect(running.result).resolves.toBeDefined();
    await expect(queued.result).rejects.toBeInstanceOf(AgentCancelledError);
    await shutdown;
    expect(store.getRun('run-running')?.status).toBe('completed');
    expect(store.getRun('run-queued')?.status).toBe('cancelled');
    expect(store.getRun('run-queued')?.finishedAt).toBeDefined();
    expect(() => runtime.dispatch('builder', { prompt: 'Rejected' })).toThrow('shutting down');
  });

  it('enforces lifecycle transitions', () => {
    const lifecycle = new RunLifecycle();
    expect(() => lifecycle.transition('running')).toThrow(InvalidStateTransitionError);
    lifecycle.transition('queued');
    lifecycle.transition('running');
    lifecycle.transition('completed');
    expect(() => lifecycle.transition('queued')).toThrow(InvalidStateTransitionError);
  });

  it('never exceeds the configured concurrent execution limit', async () => {
    let active = 0;
    let maximum = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const agent = stubAgent(vi.fn());
    registry.register(agent);
    vi.spyOn(agent, 'run').mockImplementation(async (_task, context) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await gate;
      active -= 1;
      return result(agent, context!);
    });
    const runtime = new ExecutionManager(registry, store, { logger: silentLogger, maxConcurrent: 2 });
    const handles = Array.from({ length: 5 }, (_, index) => runtime.dispatch('builder', { prompt: `Task ${index}` }));
    await waitFor(() => active === 2);

    expect(runtime.activeCount).toBe(2);
    expect(runtime.queuedCount).toBe(3);
    release();
    await Promise.all(handles.map((handle) => handle.result));
    expect(maximum).toBe(2);
    expect(agent.run).toHaveBeenCalledTimes(5);
  });

  it('rejects duplicate run IDs without executing the task twice', async () => {
    const agent = stubAgent(vi.fn());
    registry.register(agent);
    vi.spyOn(agent, 'run').mockImplementation(async (_task, context) => result(agent, context!));
    const runtime = new ExecutionManager(registry, store, { logger: silentLogger });
    const handle = runtime.dispatch('builder', { prompt: 'Once' }, { runId: 'duplicate-run' });
    await handle.result;

    expect(() => runtime.dispatch('builder', { prompt: 'Twice' }, { runId: 'duplicate-run' })).toThrow('already exists');
    expect(agent.run).toHaveBeenCalledOnce();
  });

  it('persists an agent registered after manager construction', async () => {
    const runtime = new ExecutionManager(registry, store, { logger: silentLogger });
    const agent = stubAgent(vi.fn());
    vi.spyOn(agent, 'run').mockImplementation(async (_task, context) => result(agent, context!));
    registry.register(agent);

    await runtime.execute('builder', { prompt: 'Late registration' }, { runId: 'late-agent-run' });
    expect(store.getRun('late-agent-run')?.status).toBe('completed');
  });

  it('releases dispatcher capacity when an operation throws synchronously', async () => {
    const dispatcher = new TaskDispatcher(1);
    await expect(dispatcher.dispatch('sync-failure', () => { throw new Error('sync failure'); })).rejects.toThrow('sync failure');
    await expect(dispatcher.dispatch('next-task', async () => 'ok')).resolves.toBe('ok');
    expect(dispatcher.activeCount).toBe(0);
  });

  it('persists runs across store instances and recovers queued and interrupted runs', async () => {
    const agent = stubAgent(vi.fn());
    registry.register(agent);
    vi.spyOn(agent, 'run').mockImplementation(async (_task, context) => result(agent, context!));
    const definition = new ExecutionManager(registry, store, { logger: silentLogger });
    void definition;
    const now = new Date().toISOString();
    store.createRun(persistedRun({ id: 'queued-before-restart' }));
    store.createRun(persistedRun({
      id: 'running-before-restart',
      status: 'running',
      attempt: 1,
      startedAt: now,
      queuedAt: now,
    }));

    const reloadedStore = new AgentRuntimeStore(db);
    const runtime = new ExecutionManager(registry, reloadedStore, { logger: silentLogger });
    const recovery = runtime.recover();
    expect(recovery).toEqual({ resumed: ['queued-before-restart'], interrupted: ['running-before-restart'] });
    await waitFor(() => reloadedStore.getRun('queued-before-restart')?.status === 'completed');
    expect(reloadedStore.getRun('running-before-restart')).toMatchObject({
      status: 'failed',
      error: { message: 'Execution interrupted before runtime recovery' },
    });
    expect(reloadedStore.getRun('running-before-restart')?.finishedAt).toBeDefined();
    expect(agent.run).toHaveBeenCalledOnce();
  });
});
