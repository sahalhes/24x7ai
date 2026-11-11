import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chat, OtariProviderError } from '../src/providers/otari.js';

const messages = [
  { role: 'system' as const, content: 'Be concise.' },
  { role: 'user' as const, content: 'Hello' },
];

function successResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    id: 'chat-123',
    model: 'together:moonshotai/kimi-k3.1-pro',
    choices: [{
      message: { role: 'assistant', content: 'Hello from Kimi' },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
    ...overrides,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('Otari chat provider', () => {
  const originalApiKey = process.env.OTARI_API_KEY;

  beforeEach(() => {
    process.env.OTARI_API_KEY = 'test-secret-key';
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.OTARI_API_KEY;
    else process.env.OTARI_API_KEY = originalApiKey;
    vi.restoreAllMocks();
  });

  it('routes logical roles to Kimi and sends system and user messages', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse({ usage: undefined }));
    const logger = { info: vi.fn() };

    const result = await chat(
      { role: 'architect', messages },
      { fetch: fetchMock, logger },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://otari.ai/api/v1/chat/completions');
    expect(request.method).toBe('POST');
    expect(request.headers).toEqual({
      'Content-Type': 'application/json',
      'Otari-Key': 'test-secret-key',
    });
    expect(JSON.parse(request.body)).toEqual({
      model: 'together:moonshotai/kimi-k3.1-pro',
      messages,
    });
    expect(result.content).toBe('Hello from Kimi');
    expect(result.finishReason).toBe('stop');
  });

  it.each(['architect', 'builder', 'tester'] as const)('resolves the %s role', async (role) => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse());
    await chat({ role, messages }, { fetch: fetchMock, logger: { info: vi.fn() } });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('together:moonshotai/kimi-k3.1-pro');
  });

  it('parses and logs token usage without logging credentials', async () => {
    const logger = { info: vi.fn() };
    const result = await chat(
      { role: 'builder', messages },
      { fetch: vi.fn().mockResolvedValue(successResponse()), logger },
    );

    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 4, totalTokens: 16 });
    expect(logger.info).toHaveBeenCalledWith('Otari token usage', {
      role: 'builder',
      model: 'together:moonshotai/kimi-k3.1-pro',
      promptTokens: 12,
      completionTokens: 4,
      totalTokens: 16,
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('test-secret-key');
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('Otari-Key');
  });

  it('requires credentials from the environment', async () => {
    delete process.env.OTARI_API_KEY;
    const fetchMock = vi.fn();

    await expect(chat({ role: 'tester', messages }, { fetch: fetchMock }))
      .rejects.toThrow('OTARI_API_KEY environment variable is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported configured models', async () => {
    await expect(chat(
      { role: 'triage' as never, messages },
      { fetch: vi.fn() },
    )).rejects.toThrow('Model "llama-3.1-8b" is not supported');
  });

  it('does not retry non-transient HTTP errors or expose response bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('sensitive body', {
      status: 401,
      statusText: 'Unauthorized',
    }));

    const request = chat(
      { role: 'architect', messages },
      { fetch: fetchMock, maxRetries: 2 },
    );
    await expect(request).rejects.toMatchObject({ status: 401, retryable: false });
    await expect(request).rejects.toThrow('HTTP 401 Unauthorized');
    await expect(request).rejects.not.toThrow('sensitive body');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('retries transient failures and honors Retry-After', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(successResponse());

    const result = await chat(
      { role: 'tester', messages },
      { fetch: fetchMock, maxRetries: 1, logger: { info: vi.fn() } },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.content).toBe('Hello from Kimi');
  });

  it('fails after exhausting retries on server errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 503,
      headers: { 'Retry-After': '0' },
    }));

    await expect(chat(
      { role: 'builder', messages },
      { fetch: fetchMock, maxRetries: 1 },
    )).rejects.toMatchObject({ status: 503, retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('times out an unresponsive request', async () => {
    const fetchMock = vi.fn().mockImplementation((_url, request) => new Promise((_resolve, reject) => {
      request.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));

    await expect(chat(
      { role: 'architect', messages },
      { fetch: fetchMock, timeoutMs: 5, maxRetries: 0 },
    )).rejects.toThrow('Otari request timed out after 5ms');
  });

  it('rejects malformed successful responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse({ choices: [] }));
    await expect(chat(
      { role: 'architect', messages },
      { fetch: fetchMock },
    )).rejects.toBeInstanceOf(OtariProviderError);
  });
});
