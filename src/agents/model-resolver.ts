import type { AgentRole } from '../providers/otari.js';
import { resolveModelSelection } from '../providers/otari.js';

export interface ModelSelection {
  model: string;
  providerModel: string;
}

export class ModelResolver {
  constructor(private readonly configPath?: string) {}

  resolve(role: AgentRole): ModelSelection {
    return resolveModelSelection(role, this.configPath);
  }
}
