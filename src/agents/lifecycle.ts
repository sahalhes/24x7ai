import { InvalidStateTransitionError } from './errors.js';
import type { RunStatus } from './types.js';

const TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  idle: ['queued', 'cancelled'],
  queued: ['running', 'cancelled'],
  running: ['completed', 'failed', 'cancelled', 'timed_out'],
  completed: [],
  failed: ['queued'],
  cancelled: [],
  timed_out: ['queued'],
};

export class RunLifecycle {
  constructor(
    public status: RunStatus = 'idle',
    public createdAt = new Date().toISOString(),
    public updatedAt = createdAt,
    public queuedAt?: string,
    public startedAt?: string,
    public finishedAt?: string,
  ) {}

  transition(next: RunStatus): void {
    if (!TRANSITIONS[this.status].includes(next)) {
      throw new InvalidStateTransitionError(this.status, next);
    }

    const now = new Date().toISOString();
    this.status = next;
    this.updatedAt = now;
    if (next === 'queued') {
      this.queuedAt = now;
      this.finishedAt = undefined;
    } else if (next === 'running') {
      this.startedAt ??= now;
    } else {
      this.finishedAt = now;
    }
  }

  static isTerminal(status: RunStatus): boolean {
    return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'timed_out';
  }
}
