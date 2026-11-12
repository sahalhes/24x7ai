import { randomUUID } from 'node:crypto';
import { chat, type AgentRole } from '../providers/otari.js';
import type {
  Agent,
  AgentOutputKind,
  AgentProvider,
  AgentExecutionResult,
  AgentRunContext,
  AgentTask,
} from './types.js';

export const DEFAULT_AGENT_TIMEOUT_MS = 30_000;

export const SYSTEM_INSTRUCTIONS: Record<AgentRole, string> = {
  architect: 'You are the architect agent. Analyze the task and produce a clear, structured implementation plan. Do not make changes or execute commands.',
  builder: 'You are the builder agent. Produce a structured implementation result for the assigned task. Describe concrete code changes and verification without claiming unperformed work.',
  tester: 'You are the tester agent. Produce a structured test report with coverage, observed results, failures, and remaining risks. Do not claim tests ran unless their output is provided.',
};

const OUTPUT_KINDS: Record<AgentRole, AgentOutputKind> = {
  architect: 'plan',
  builder: 'implementation',
  tester: 'test_report',
};

export interface RoleAgentOptions {
  id: string;
  role: AgentRole;
  model: string;
  providerModel: string;
  provider?: AgentProvider;
  timeoutMs?: number;
  systemInstructions?: string;
}

export class RoleAgent implements Agent {
  readonly id: string;
  readonly role: AgentRole;
  readonly model: string;
  readonly providerModel: string;
  readonly systemInstructions: string;
  readonly timeoutMs: number;
  private readonly provider: AgentProvider;

  constructor(options: RoleAgentOptions) {
    if (!Number.isFinite(options.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS) || (options.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS) <= 0) {
      throw new Error('Agent timeout must be positive');
    }
    this.id = options.id;
    this.role = options.role;
    this.model = options.model;
    this.providerModel = options.providerModel;
    this.systemInstructions = options.systemInstructions ?? SYSTEM_INSTRUCTIONS[options.role];
    this.timeoutMs = options.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
    this.provider = options.provider ?? { chat };
  }

  async run(task: AgentTask, context?: AgentRunContext): Promise<AgentExecutionResult> {
    if (!task.prompt.trim()) throw new Error('Agent task prompt must not be empty');

    const startedAt = new Date().toISOString();
    const runId = context?.runId ?? randomUUID();
    const correlationId = context?.correlationId ?? task.correlationId ?? randomUUID();
    const contextText = task.context === undefined ? '' : `\n\nTask context:\n${JSON.stringify(task.context, null, 2)}`;
    const response = await this.provider.chat({
      role: this.role,
      model: this.providerModel,
      messages: [
        { role: 'system', content: this.systemInstructions },
        { role: 'user', content: `${task.prompt}${contextText}` },
      ],
    }, {
      signal: context?.signal,
      timeoutMs: context?.timeoutMs ?? task.timeoutMs ?? this.timeoutMs,
      // Run-level retries are owned by ExecutionManager.
      maxRetries: 0,
    });

    return {
      runId,
      correlationId,
      agentId: this.id,
      role: this.role,
      model: this.model,
      output: { kind: OUTPUT_KINDS[this.role], content: response.content },
      startedAt,
      finishedAt: new Date().toISOString(),
      ...(response.id ? { providerResponseId: response.id } : {}),
      ...(response.usage ? { usage: response.usage } : {}),
    };
  }
}
