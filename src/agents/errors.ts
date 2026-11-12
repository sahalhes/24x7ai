export class AgentRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentRuntimeError';
  }
}

export class InvalidStateTransitionError extends AgentRuntimeError {
  constructor(from: string, to: string) {
    super(`Invalid run state transition from "${from}" to "${to}"`);
    this.name = 'InvalidStateTransitionError';
  }
}

export class AgentTimeoutError extends AgentRuntimeError {
  constructor(timeoutMs: number) {
    super(`Agent execution timed out after ${timeoutMs}ms`);
    this.name = 'AgentTimeoutError';
  }
}

export class AgentCancelledError extends AgentRuntimeError {
  constructor(message = 'Agent execution was cancelled') {
    super(message);
    this.name = 'AgentCancelledError';
  }
}
