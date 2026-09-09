import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { appError } from '../../src/shared/errors/app-error';
import { collectValidated } from '../../src/main-process/skill-runtime/collect-validated';
import type { ProviderPort } from '../../src/main-process/infrastructure/ai/provider-port';
import type { StructuredCompletion } from '../../src/main-process/infrastructure/ai/openai-compatible-provider';

const completion = (content: string, finishReason: string | null = 'stop'): StructuredCompletion => ({ content, finishReason, usage: null });
const parse = (content: string) => z.object({ ok: z.literal(true) }).parse(JSON.parse(content));

describe('collectValidated', () => {
  it.each([
    ['empty content', completion('')],
    ['truncated output', completion('{"ok":true}', 'length')],
    ['invalid JSON', completion('not-json')],
    ['schema mismatch', completion('{"ok":false}')],
  ] as const)('retries one %s failure and returns the validated second response', async (_label, first) => {
    const collectStructured = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(completion('{"ok":true}'));
    const result = await collectValidated({
      provider: { collect: vi.fn(), collectStructured } as unknown as ProviderPort,
      messages: [{ role: 'user', content: 'return json' }],
      maxTokens: 2400,
      parse,
    });
    expect(result).toMatchObject({ value: { ok: true }, attempts: 2, completion: completion('{"ok":true}') });
    expect(collectStructured).toHaveBeenCalledTimes(2);
  });

  it('classifies empty content with a length finish reason as truncation and raises the retry budget once', async () => {
    const collectStructured = vi.fn()
      .mockResolvedValueOnce(completion('', 'length'))
      .mockResolvedValueOnce(completion('{"ok":true}'));
    const result = await collectValidated({
      provider: { collect: vi.fn(), collectStructured } as unknown as ProviderPort,
      messages: [{ role: 'user', content: 'return json' }],
      maxTokens: 1200,
      retryMaxTokens: 2400,
      parse,
    });
    expect(result.value).toEqual({ ok: true });
    expect(collectStructured.mock.calls[0][2]).toEqual({ maxTokens: 1200 });
    expect(collectStructured.mock.calls[1][2]).toEqual({ maxTokens: 2400 });
  });

  it('does not retry a second structured failure or expose model output', async () => {
    const collectStructured = vi.fn()
      .mockResolvedValueOnce(completion('{"ok":false}'))
      .mockResolvedValueOnce(completion('MODEL_SECRET'));
    await expect(collectValidated({
      provider: { collect: vi.fn(), collectStructured } as unknown as ProviderPort,
      messages: [{ role: 'user', content: 'return json' }],
      maxTokens: 1200,
      parse,
    })).rejects.toMatchObject({ code: 'INVALID_MODEL_OUTPUT', diagnostics: { kind: 'invalid_json', outputLength: 12 } });
    expect(collectStructured).toHaveBeenCalledTimes(2);
  });

  it('keeps the same budget for a non-length format retry', async () => {
    const collectStructured = vi.fn()
      .mockResolvedValueOnce(completion('not-json'))
      .mockResolvedValueOnce(completion('still-not-json'));
    await expect(collectValidated({
      provider: { collect: vi.fn(), collectStructured } as unknown as ProviderPort,
      messages: [{ role: 'user', content: 'return json' }],
      maxTokens: 1200,
      retryMaxTokens: 2400,
      parse,
    })).rejects.toMatchObject({ code: 'INVALID_MODEL_OUTPUT', diagnostics: { kind: 'invalid_json', maxTokens: 1200, retryOf: 'invalid_json', attempt: 2 } });
    expect(collectStructured.mock.calls[1][2]).toEqual({ maxTokens: 1200 });
  });

  it('does not retry non-structured provider errors', async () => {
    const error = appError({ code: 'NETWORK_TIMEOUT' });
    const collectStructured = vi.fn().mockRejectedValue(error);
    await expect(collectValidated({
      provider: { collect: vi.fn(), collectStructured } as unknown as ProviderPort,
      messages: [{ role: 'user', content: 'return json' }],
      maxTokens: 1200,
      parse,
    })).rejects.toBe(error);
    expect(collectStructured).toHaveBeenCalledOnce();
  });

  it('does not start the retry when cancellation happens between attempts', async () => {
    const controller = new AbortController();
    const collectStructured = vi.fn().mockResolvedValueOnce(completion('{"ok":false}'));
    await expect(collectValidated({
      provider: { collect: vi.fn(), collectStructured } as unknown as ProviderPort,
      messages: [{ role: 'user', content: 'return json' }],
      maxTokens: 1200,
      signal: controller.signal,
      onRetry: () => controller.abort(),
      parse,
    })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(collectStructured).toHaveBeenCalledOnce();
  });
});
