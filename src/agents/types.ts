import type {
  AgentRole,
  ChatMessage,
  ChatRequest,
  OtariChatResponse,
  OtariProviderOptions,
  OtariTokenUsage,
} from '../providers/otari.js';

export type RunStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export type AgentOutputKind = 'plan' | 'implementation' | 'test_report';

export interface AgentTask {
  prompt: string;
  context?: Record<string, unknown>;
  timeoutMs?: number;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRunContext {
  runId: string;
  correlationId: string;
  attempt: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface AgentOutput {
  kind: AgentOutputKind;
  content: string;
}

export interface AgentExecutionResult {
  runId: string;
  correlationId: string;
  agentId: string;
  role: AgentRole;
  model: string;
  output: AgentOutput;
  startedAt: string;
  finishedAt: string;
  providerResponseId?: string;
  usage?: OtariTokenUsage;
}

export interface Agent {
  readonly id: string;
  readonly role: AgentRole;
  readonly model: string;
  readonly providerModel: string;
  readonly systemInstructions: string;
  readonly timeoutMs: number;
  run(task: AgentTask, context?: AgentRunContext): Promise<AgentExecutionResult>;
}

export interface AgentProvider {
  chat(request: ChatRequest, options?: OtariProviderOptions): Promise<OtariChatResponse>;
}

export interface AgentDefinition {
  id: string;
  role: AgentRole;
  model: string;
  providerModel: string;
  systemInstructions: string;
  timeoutMs: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface RunError {
  name: string;
  message: string;
  attempt: number;
  at: string;
}

export interface RunAttempt {
  attempt: number;
  status: 'completed' | 'failed' | 'cancelled' | 'timed_out';
  startedAt: string;
  finishedAt: string;
  error?: RunError;
}

export interface AgentRun {
  id: string;
  agentId: string;
  role: AgentRole;
  model: string;
  correlationId: string;
  status: RunStatus;
  task: AgentTask;
  attempt: number;
  maxRetries: number;
  timeoutMs: number;
  createdAt: string;
  queuedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
  error?: RunError;
  result?: AgentExecutionResult;
  metadata: Record<string, unknown>;
}

export interface DispatchOptions {
  runId?: string;
  correlationId?: string;
  timeoutMs?: number;
  maxRetries?: number;
  metadata?: Record<string, unknown>;
}

export interface ExecutionHandle {
  runId: string;
  correlationId: string;
  result: Promise<AgentExecutionResult>;
}

export interface RuntimeLogger {
  debug(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
}

export type { ChatMessage };
