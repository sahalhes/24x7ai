import { randomUUID } from 'node:crypto';
import { Logger } from '../utils/logger.js';
import { TaskDispatcher } from './dispatcher.js';
import { AgentCancelledError, AgentTimeoutError } from './errors.js';
import { RunLifecycle } from './lifecycle.js';
import { AgentRegistry } from './registry.js';
import { AgentRuntimeStore } from './store.js';
import type {
  Agent,
  AgentExecutionResult,
  AgentRun,
  AgentTask,
  DispatchOptions,
  ExecutionHandle,
  RunAttempt,
  RunError,
  RuntimeLogger,
} from './types.js';

interface ManagedRun {
  record: AgentRun;
  lifecycle: RunLifecycle;
  attempts: RunAttempt[];
}

export interface ExecutionManagerOptions {
  maxConcurrent?: number;
  maxRetries?: number;
  timeoutMs?: number;
  logger?: RuntimeLogger;
}

export interface RecoveryResult {
  resumed: string[];
  interrupted: string[];
}

function errorDetails(error: unknown, attempt: number): RunError {
  return {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
    attempt,
    at: new Date().toISOString(),
  };
}

function validateOptions(timeoutMs: number, maxRetries: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Execution timeout must be positive');
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new Error('maxRetries must be a non-negative integer');
  }
}

export class ExecutionManager {
  private readonly dispatcher: TaskDispatcher;
  private readonly logger: RuntimeLogger;
  private readonly defaultMaxRetries: number;
  private readonly defaultTimeoutMs: number | undefined;
  private readonly managedRuns = new Map<string, ManagedRun>();
  private readonly activeResults = new Map<string, Promise<AgentExecutionResult>>();
  private shuttingDown = false;
  private shutdownPromise?: Promise<void>;

  constructor(
    private readonly registry: AgentRegistry,
    private readonly store: AgentRuntimeStore,
    options: ExecutionManagerOptions = {},
  ) {
    this.defaultMaxRetries = options.maxRetries ?? 0;
    this.defaultTimeoutMs = options.timeoutMs;
    validateOptions(this.defaultTimeoutMs ?? 1, this.defaultMaxRetries);
    this.logger = options.logger ?? new Logger(undefined, 'AgentRuntime');
    this.dispatcher = new TaskDispatcher(options.maxConcurrent ?? 4);
    for (const agent of registry.list()) store.upsertAgent(agent);
  }

  dispatch(agentId: string, task: AgentTask, options: DispatchOptions = {}): ExecutionHandle {
    if (this.shuttingDown) throw new Error('Execution manager is shutting down');
    const agent = this.registry.get(agentId);
    const runId = options.runId ?? randomUUID();
    if (this.managedRuns.has(runId) || this.store.getRun(runId)) {
      throw new Error(`Run "${runId}" already exists`);
    }

    const timeoutMs = options.timeoutMs ?? task.timeoutMs ?? this.defaultTimeoutMs ?? agent.timeoutMs;
    const maxRetries = options.maxRetries ?? this.defaultMaxRetries;
    validateOptions(timeoutMs, maxRetries);
    if (!task.prompt.trim()) throw new Error('Agent task prompt must not be empty');

    const correlationId = options.correlationId ?? task.correlationId ?? randomUUID();
    const lifecycle = new RunLifecycle();
    const managed: ManagedRun = {
      lifecycle,
      attempts: [],
      record: {
        id: runId,
        agentId,
        role: agent.role,
        model: agent.model,
        correlationId,
        status: lifecycle.status,
        task,
        attempt: 0,
        maxRetries,
        timeoutMs,
        createdAt: lifecycle.createdAt,
        updatedAt: lifecycle.updatedAt,
        metadata: { ...task.metadata, ...options.metadata, attempts: [] },
      },
    };
    this.store.upsertAgent(agent);
    this.store.createRun(managed.record);
    this.managedRuns.set(runId, managed);
    this.transition(managed, 'queued');
    return this.enqueue(managed, agent);
  }

  async execute(agentId: string, task: AgentTask, options: DispatchOptions = {}): Promise<AgentExecutionResult> {
    return this.dispatch(agentId, task, options).result;
  }

  cancel(runId: string): boolean {
    const managed = this.managedRuns.get(runId);
    if (!managed || !this.activeResults.has(runId)) return false;

    if (managed.record.status === 'queued') {
      managed.record.error = errorDetails(new AgentCancelledError('Queued agent execution was cancelled'), managed.record.attempt);
      this.transition(managed, 'cancelled');
      return this.dispatcher.cancel(runId);
    }

    if (managed.record.status === 'running') {
      this.logger.info('Cancellation requested', this.logContext(managed));
      return this.dispatcher.cancel(runId);
    }
    return false;
  }

  getRun(runId: string): AgentRun | null {
    return this.managedRuns.get(runId)?.record ?? this.store.getRun(runId);
  }

  listRuns(options: { limit?: number; status?: AgentRun['status'] } = {}): AgentRun[] {
    return this.store.listRuns(options);
  }

  get activeCount(): number {
    return this.dispatcher.activeCount;
  }

  get queuedCount(): number {
    return this.dispatcher.queuedCount;
  }

  /**
   * Resume work that had not started and mark interrupted running work failed.
   * Interrupted requests are not replayed automatically to avoid duplicate effects.
   */
  recover(): RecoveryResult {
    if (this.shuttingDown) throw new Error('Execution manager is shutting down');
    const result: RecoveryResult = { resumed: [], interrupted: [] };

    for (const record of this.store.listRuns({ limit: 10_000 })) {
      if (this.activeResults.has(record.id)) continue;
      if (record.status !== 'queued' && record.status !== 'running') continue;

      const lifecycle = new RunLifecycle(
        record.status,
        record.createdAt,
        record.updatedAt,
        record.queuedAt,
        record.startedAt,
        record.finishedAt,
      );
      const attempts = Array.isArray(record.metadata.attempts) ? record.metadata.attempts as RunAttempt[] : [];
      const managed: ManagedRun = { record, lifecycle, attempts };
      this.managedRuns.set(record.id, managed);

      if (record.status === 'running') {
        record.error = errorDetails(new Error('Execution interrupted before runtime recovery'), record.attempt);
        this.transition(managed, 'failed');
        this.managedRuns.delete(record.id);
        result.interrupted.push(record.id);
      } else {
        const agent = this.registry.get(record.agentId);
        this.enqueue(managed, agent);
        result.resumed.push(record.id);
      }
    }
    return result;
  }

  shutdown(options: { cancelRunning?: boolean } = {}): Promise<void> {
    if (this.shutdownPromise) {
      if (options.cancelRunning) {
        for (const runId of this.activeResults.keys()) this.cancel(runId);
      }
      return this.shutdownPromise;
    }
    this.shuttingDown = true;
    this.dispatcher.stopAccepting();

    const pending = [...this.activeResults.entries()];
    for (const [runId] of pending) {
      const status = this.managedRuns.get(runId)?.record.status;
      if (status === 'queued' || (status === 'running' && options.cancelRunning)) {
        this.cancel(runId);
      }
    }
    this.shutdownPromise = Promise.allSettled(pending.map(([, result]) => result)).then(() => {
      this.logger.info('Execution manager shut down', { pendingRuns: pending.length });
    });
    return this.shutdownPromise;
  }

  private enqueue(managed: ManagedRun, agent: Agent): ExecutionHandle {
    const result = this.dispatcher.dispatch(managed.record.id, (signal) => this.executeManaged(managed, agent, signal));
    this.activeResults.set(managed.record.id, result);
    const cleanup = () => {
      this.activeResults.delete(managed.record.id);
      this.managedRuns.delete(managed.record.id);
    };
    void result.then(cleanup, cleanup);
    return { runId: managed.record.id, correlationId: managed.record.correlationId, result };
  }

  private async executeManaged(managed: ManagedRun, agent: Agent, signal: AbortSignal): Promise<AgentExecutionResult> {
    while (true) {
      if (signal.aborted) throw new AgentCancelledError();
      if (managed.record.status === 'failed' || managed.record.status === 'timed_out') {
        this.transition(managed, 'queued');
      }
      this.transition(managed, 'running');

      const attempt = managed.record.attempt + 1;
      managed.record.attempt = attempt;
      managed.record.updatedAt = new Date().toISOString();
      const attemptStartedAt = new Date().toISOString();
      this.save(managed, 'Agent attempt started');

      try {
        const result = await this.runAttempt(agent, managed, attempt, signal);
        if (signal.aborted) throw new AgentCancelledError();
        managed.attempts.push({ attempt, status: 'completed', startedAt: attemptStartedAt, finishedAt: new Date().toISOString() });
        managed.record.result = result;
        managed.record.error = undefined;
        this.transition(managed, 'completed');
        return result;
      } catch (error) {
        const cancelled = signal.aborted || error instanceof AgentCancelledError;
        const timedOut = !cancelled && error instanceof AgentTimeoutError;
        const status = cancelled ? 'cancelled' : timedOut ? 'timed_out' : 'failed';
        const runError = errorDetails(
          cancelled && !(error instanceof Error) ? new AgentCancelledError() : error,
          attempt,
        );
        managed.record.error = runError;
        managed.attempts.push({
          attempt,
          status,
          startedAt: attemptStartedAt,
          finishedAt: new Date().toISOString(),
          error: runError,
        });
        this.transition(managed, status);

        if (!cancelled && attempt <= managed.record.maxRetries) {
          this.logger.warn('Agent attempt failed; retrying', {
            ...this.logContext(managed),
            attempt,
            maxRetries: managed.record.maxRetries,
            error: runError.message,
          });
          continue;
        }
        throw error;
      }
    }
  }

  private async runAttempt(agent: Agent, managed: ManagedRun, attempt: number, signal: AbortSignal): Promise<AgentExecutionResult> {
    const { record } = managed;
    const controller = new AbortController();
    let timeout: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;

    const guard = new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        const error = signal.reason instanceof AgentCancelledError
          ? signal.reason
          : new AgentCancelledError();
        controller.abort(error);
        reject(error);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
      timeout = setTimeout(() => {
        const error = new AgentTimeoutError(record.timeoutMs);
        controller.abort(error);
        reject(error);
      }, record.timeoutMs);
    });

    try {
      return await Promise.race([
        agent.run(record.task, {
          runId: record.id,
          correlationId: record.correlationId,
          attempt,
          timeoutMs: record.timeoutMs,
          signal: controller.signal,
        }),
        guard,
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  private transition(managed: ManagedRun, status: AgentRun['status']): void {
    managed.lifecycle.transition(status);
    managed.record.status = status;
    managed.record.queuedAt = managed.lifecycle.queuedAt;
    managed.record.startedAt = managed.lifecycle.startedAt;
    managed.record.finishedAt = managed.lifecycle.finishedAt;
    managed.record.updatedAt = managed.lifecycle.updatedAt;
    this.save(managed, `Run transitioned to ${status}`);
  }

  private save(managed: ManagedRun, message: string): void {
    managed.record.status = managed.lifecycle.status;
    managed.record.metadata.attempts = managed.attempts;
    managed.record.updatedAt = new Date().toISOString();
    this.store.updateRun(managed.record);
    this.logger.debug(message, this.logContext(managed));
  }

  private logContext(managed: ManagedRun): Record<string, unknown> {
    return {
      runId: managed.record.id,
      correlationId: managed.record.correlationId,
      agentId: managed.record.agentId,
      role: managed.record.role,
      status: managed.record.status,
      attempt: managed.record.attempt,
    };
  }
}
