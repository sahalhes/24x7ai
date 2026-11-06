import { GatewayConfig } from '../config/schema.js';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd?: number;
}

export class OtariGateway {
  constructor(private config: GatewayConfig) {}

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getEndpoint(): string {
    return this.config.endpoint || 'http://localhost:8000/v1';
  }

  getVirtualKey(projectId: number, runType: string): string {
    if (this.config.virtualKey) return this.config.virtualKey;
    // Generate deterministic virtual key for tracing
    return `otari-24x7ai-p${projectId}-${runType}`;
  }

  async checkBudget(): Promise<{ allowed: boolean; remainingBudgetUsd?: number }> {
    if (!this.config.enabled || !this.config.budgetCapUsd) {
      return { allowed: true };
    }

    try {
      // Query Otari budget endpoint if accessible
      const resp = await fetch(`${this.getEndpoint()}/budget/check`, {
        headers: {
          Authorization: `Bearer ${this.getApiKey() || 'otari-default'}`,
        },
      });
      if (resp.ok) {
        const data = await resp.json() as any;
        return {
          allowed: data.remaining > 0,
          remainingBudgetUsd: data.remaining,
        };
      }
    } catch {
      // If Otari is offline or doesn't have budget endpoint, allow run
    }

    return { allowed: true };
  }

  getApiKey(): string | undefined {
    return this.config.apiKey || process.env.OTARI_API_KEY;
  }

  getAdapterEnv(projectId: number, runType: string): Record<string, string> {
    if (!this.config.enabled) return {};

    const endpoint = this.getEndpoint();
    const apiKey = this.getApiKey();
    const virtualKey = this.getVirtualKey(projectId, runType);

    // Use the configured API key for model calls; fall back to virtual key for tracing
    const authKey = apiKey || virtualKey;

    return {
      OPENAI_BASE_URL: endpoint,
      OPENAI_API_BASE: endpoint,
      OPENAI_API_KEY: authKey,
      ANTHROPIC_BASE_URL: endpoint,
      ANTHROPIC_API_KEY: authKey,
      OTARI_API_KEY: authKey,
      OTARI_VIRTUAL_KEY: virtualKey,
      OTARI_PROJECT_ID: String(projectId),
      OTARI_RUN_TYPE: runType,
    };
  }
}
