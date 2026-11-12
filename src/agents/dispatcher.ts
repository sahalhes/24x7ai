import { AgentCancelledError } from './errors.js';

interface DispatchJob {
  id: string;
  operation: (signal: AbortSignal) => Promise<unknown>;
  controller: AbortController;
  state: 'queued' | 'running';
  resolve: (value: any) => void;
  reject: (error: unknown) => void;
}

export class TaskDispatcher {
  private readonly jobs = new Map<string, DispatchJob>();
  private readonly queue: DispatchJob[] = [];
  private active = 0;
  private accepting = true;

  constructor(private readonly maxConcurrent: number) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new Error('maxConcurrent must be a positive integer');
    }
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  dispatch<T>(id: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!this.accepting) return Promise.reject(new Error('Task dispatcher is shutting down'));
    if (this.jobs.has(id)) return Promise.reject(new Error(`Run "${id}" has already been dispatched`));

    return new Promise<T>((resolve, reject) => {
      const job: DispatchJob = {
        id,
        operation,
        controller: new AbortController(),
        state: 'queued',
        resolve,
        reject,
      };
      this.jobs.set(id, job);
      this.queue.push(job);
      this.pump();
    });
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;

    if (job.state === 'queued') {
      this.queue.splice(this.queue.indexOf(job), 1);
      this.jobs.delete(id);
      job.reject(new AgentCancelledError('Queued agent execution was cancelled'));
    } else {
      job.controller.abort(new AgentCancelledError());
    }
    return true;
  }

  isQueued(id: string): boolean {
    return this.jobs.get(id)?.state === 'queued';
  }

  stopAccepting(): void {
    this.accepting = false;
  }

  private pump(): void {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift()!;
      job.state = 'running';
      this.active += 1;

      void Promise.resolve()
        .then(() => job.operation(job.controller.signal))
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active -= 1;
          this.jobs.delete(job.id);
          this.pump();
        });
    }
  }
}
