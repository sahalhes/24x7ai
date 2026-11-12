import type { AgentRole } from '../providers/otari.js';
import { RoleAgent } from './agent.js';
import { ModelResolver } from './model-resolver.js';
import type { Agent, AgentProvider } from './types.js';

export const INITIAL_AGENT_ROLES: readonly AgentRole[] = ['architect', 'builder', 'tester'];

export interface AgentFactoryOptions {
  modelResolver?: ModelResolver;
  provider?: AgentProvider;
  timeoutMs?: number;
  systemInstructions?: Partial<Record<AgentRole, string>>;
}

export class AgentFactory {
  constructor(private readonly options: AgentFactoryOptions = {}) {}

  create(role: AgentRole, id = role): Agent {
    const { model, providerModel } = (this.options.modelResolver ?? new ModelResolver()).resolve(role);
    return new RoleAgent({
      id,
      role,
      model,
      providerModel,
      provider: this.options.provider,
      timeoutMs: this.options.timeoutMs,
      systemInstructions: this.options.systemInstructions?.[role],
    });
  }

  createInitialAgents(): Agent[] {
    return INITIAL_AGENT_ROLES.map((role) => this.create(role));
  }
}
