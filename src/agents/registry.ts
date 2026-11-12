import type { AgentRole } from '../providers/otari.js';
import type { Agent } from './types.js';

export class AgentRegistry {
  private readonly agents = new Map<string, Agent>();

  register(agent: Agent): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent "${agent.id}" is already registered`);
    }
    this.agents.set(agent.id, agent);
  }

  get(id: string): Agent {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`Agent "${id}" is not registered`);
    return agent;
  }

  find(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  list(role?: AgentRole): Agent[] {
    const agents = [...this.agents.values()];
    return role ? agents.filter((agent) => agent.role === role) : agents;
  }

  clear(): void {
    this.agents.clear();
  }
}
