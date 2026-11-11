import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Logger } from '../utils/logger.js';

const OTARI_CHAT_URL = 'https://otari.ai/api/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 250;

const OTARI_MODEL_IDS: Record<string, string> = {
  'kimi-k3.1-pro': 'together:moonshotai/kimi-k3.1-pro',
};

export type AgentRole = 'architect' | 'builder' | 'tester';
export type ChatMessageRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatMessageRole;
  content: string;
}

export interface ChatRequest {
  role: AgentRole;
  messages: ChatMessage[];
}

export interface OtariProviderOptions {
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  logger?: Pick<Logger, 'info'>;
}

export interface OtariTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface OtariChatResponse {
  id?: string;
  model: string;
  content: string;
  finishReason?: string;
  usage?: OtariTokenUsage;
}

interface ModelsConfig {
  roles?: Record<string, { primary?: unknown } | undefined>;
}

interface OtariApiResponse {
  id?: unknown;
  model?: unknown;
  choices?: Array<{
    message?: { content?: unknown };
    finish_reason?: unknown;
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
}

export class OtariProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'OtariProviderError';
  }
}

function resolveModel(role: AgentRole): string {
  const configPath = path.resolve(process.cwd(), 'config', 'models.json');
  let config: ModelsConfig;

  try {
    config = JSON.parse(readFileSync(configPath, 'utf8')) as ModelsConfig;
  } catch {
    throw new OtariProviderError(`Unable to read model configuration at ${configPath}`);
  }

  const configuredModel = config.roles?.[role]?.primary;
  if (typeof configuredModel !== 'string' || !configuredModel) {
    throw new OtariProviderError(`No primary model configured for role "${role}"`);
  }

  const model = OTARI_MODEL_IDS[configuredModel];
  if (!model) {
    throw new OtariProviderError(`Model "${configuredModel}" is not supported by the Otari provider`);
  }

  return model;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryDelayMs(response: Response | undefined, retryNumber: number): number {
  const retryAfter = response?.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }

  return RETRY_BASE_DELAY_MS * 2 ** retryNumber;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseUsage(usage: OtariApiResponse['usage']): OtariTokenUsage | undefined {
  if (!usage) return undefined;

  const { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens } = usage;
  if (
    typeof promptTokens !== 'number'
    || typeof completionTokens !== 'number'
    || typeof totalTokens !== 'number'
  ) {
    return undefined;
  }

  return { promptTokens, completionTokens, totalTokens };
}

function parseResponse(data: OtariApiResponse, requestedModel: string): OtariChatResponse {
  const choice = data.choices?.[0];
  if (typeof choice?.message?.content !== 'string') {
    throw new OtariProviderError('Otari returned a response without assistant message content');
  }

  const usage = parseUsage(data.usage);

  return {
    ...(typeof data.id === 'string' ? { id: data.id } : {}),
    model: typeof data.model === 'string' ? data.model : requestedModel,
    content: choice.message.content,
    ...(typeof choice.finish_reason === 'string' ? { finishReason: choice.finish_reason } : {}),
    ...(usage ? { usage } : {}),
  };
}

/**
 * Send a role-routed chat request through Otari. The API key is read from
 * OTARI_API_KEY for each request and is never included in logs or errors.
 */
export async function chat(
  { role, messages }: ChatRequest,
  options: OtariProviderOptions = {},
): Promise<OtariChatResponse> {
  if (messages.length === 0) {
    throw new OtariProviderError('At least one chat message is required');
  }

  const apiKey = process.env.OTARI_API_KEY;
  if (!apiKey) {
    throw new OtariProviderError('OTARI_API_KEY environment variable is required');
  }

  const model = resolveModel(role);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const logger = options.logger ?? new Logger(undefined, 'Otari');

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new OtariProviderError('Timeout must be positive and maxRetries must be a non-negative integer');
  }

  let lastError: OtariProviderError | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let retryResponse: Response | undefined;

    try {
      const response = await fetchImpl(OTARI_CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Otari-Key': apiKey,
        },
        body: JSON.stringify({ model, messages }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const retryable = isRetryableStatus(response.status);
        lastError = new OtariProviderError(
          `Otari request failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
          response.status,
          retryable,
        );
        if (retryable) retryResponse = response;
        else throw lastError;
      } else {
        let data: OtariApiResponse;
        try {
          data = await response.json() as OtariApiResponse;
        } catch {
          throw new OtariProviderError('Otari returned invalid JSON');
        }

        const result = parseResponse(data, model);
        if (result.usage) {
          logger.info('Otari token usage', {
            role,
            model: result.model,
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            totalTokens: result.usage.totalTokens,
          });
        }
        return result;
      }
    } catch (error) {
      if (error instanceof OtariProviderError && !error.retryable) throw error;

      if (error instanceof OtariProviderError) {
        lastError = error;
      } else {
        const timedOut = controller.signal.aborted;
        lastError = new OtariProviderError(
          timedOut ? `Otari request timed out after ${timeoutMs}ms` : 'Otari request failed due to a network error',
          undefined,
          true,
        );
      }
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < maxRetries && lastError?.retryable) {
      await sleep(retryDelayMs(retryResponse, attempt));
    }
  }

  throw lastError ?? new OtariProviderError('Otari request failed');
}
