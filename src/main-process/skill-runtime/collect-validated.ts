import { z } from 'zod';
import { appError, isStructuredOutputError, type StructuredOutputDiagnostics } from '../../shared/errors/app-error';
import type { ProviderPort } from '../infrastructure/ai/provider-port';
import type { ChatMessage, StructuredCompletion } from '../infrastructure/ai/openai-compatible-provider';

export interface CollectValidatedOptions<T> {
  provider: ProviderPort;
  messages: ChatMessage[];
  signal?: AbortSignal;
  maxTokens: number;
  /** 仅用于第一次遇到 length 截断时的一次恢复；非截断错误不改变预算。 */
  retryMaxTokens?: number;
  /** 仅由需要显式控制思考模式的工作流传入；默认保持服务商原语义。 */
  thinking?: 'disabled' | 'enabled';
  parse(content: string): T;
  onRetry?(): void;
  retryInstruction?: string;
}

export interface ValidatedCollection<T> {
  value: T;
  completion: StructuredCompletion;
  attempts: number;
}

function diagnostics(kind: StructuredOutputDiagnostics['kind'], completion: StructuredCompletion, maxTokens: number, attempt: number, schemaPaths: string[] = [], retryOf?: StructuredOutputDiagnostics['kind']): StructuredOutputDiagnostics {
  const usage = completion.usage;
  return {
    kind,
    finishReason: completion.finishReason,
    outputLength: completion.content.length,
    schemaPaths,
    at: new Date().toISOString(),
    maxTokens,
    attempt,
    ...(retryOf ? { retryOf } : {}),
    ...(completion.metadata?.providerId ? { providerId: completion.metadata.providerId } : {}),
    ...(completion.metadata?.model ? { model: completion.metadata.model } : {}),
    ...(usage ? {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
    } : {}),
    ...(completion.metadata?.reasoningPresent !== undefined ? { reasoningPresent: completion.metadata.reasoningPresent } : {}),
    ...(completion.metadata?.refusalPresent !== undefined ? { refusalPresent: completion.metadata.refusalPresent } : {}),
  };
}

function parseCompletion<T>(completion: StructuredCompletion, parse: (content: string) => T, maxTokens: number, attempt: number, retryOf?: StructuredOutputDiagnostics['kind']): T {
  // 结束原因为 length 时优先保留截断证据，即使服务商没有返回任何可见 content。
  if (completion.finishReason === 'length' || completion.finishReason === 'max_tokens') throw appError({ code: 'INVALID_MODEL_OUTPUT', diagnostics: diagnostics('truncated', completion, maxTokens, attempt, [], retryOf) });
  if (!completion.content.trim()) throw appError({ code: 'INVALID_MODEL_OUTPUT', diagnostics: diagnostics('empty_content', completion, maxTokens, attempt, [], retryOf) });
  try { return parse(completion.content); }
  catch (error) {
    if (error instanceof z.ZodError) {
      const paths = [...new Set(error.issues.map((issue) => issue.path.length ? issue.path.join('.') : '<root>'))].slice(0, 12);
      throw appError({ code: 'INVALID_MODEL_OUTPUT', diagnostics: diagnostics('schema_mismatch', completion, maxTokens, attempt, paths, retryOf) });
    }
    throw appError({ code: 'INVALID_MODEL_OUTPUT', diagnostics: diagnostics('invalid_json', completion, maxTokens, attempt, [], retryOf) });
  }
}

async function collect(options: CollectValidatedOptions<unknown>, messages: ChatMessage[], maxTokens: number): Promise<StructuredCompletion> {
  if (options.provider.collectStructured) return options.provider.collectStructured(messages, options.signal, { maxTokens, ...(options.thinking ? { thinking: options.thinking } : {}) });
  return { content: await options.provider.collect(messages, options.signal, { jsonObject: true, maxTokens }), finishReason: null, usage: null };
}

export async function collectValidated<T>(options: CollectValidatedOptions<T>): Promise<ValidatedCollection<T>> {
  let attempts = 1;
  let completion = await collect(options as CollectValidatedOptions<unknown>, options.messages, options.maxTokens);
  try {
    return { value: parseCompletion(completion, options.parse, options.maxTokens, attempts), completion, attempts };
  } catch (error) {
    if (!isStructuredOutputError(error)) throw error;
    if (options.signal?.aborted) throw appError({ code: 'CANCELLED' });
    options.onRetry?.();
    if (options.signal?.aborted) throw appError({ code: 'CANCELLED' });
    attempts += 1;
    const instruction = options.retryInstruction ?? '上一次结构化输出未通过校验。请只返回符合既有字段和类型的单个 JSON 对象，不要 Markdown、代码围栏或额外说明。';
    const retryMessages = options.messages.map((message, index) => index === 0 ? { ...message, content: `${message.content}\n\n${instruction}` } : message);
    const retryMaxTokens = error.diagnostics.kind === 'truncated'
      ? Math.max(options.maxTokens + 1, options.retryMaxTokens ?? options.maxTokens * 2)
      : options.maxTokens;
    completion = await collect(options as CollectValidatedOptions<unknown>, retryMessages, retryMaxTokens);
    try {
      return { value: parseCompletion(completion, options.parse, retryMaxTokens, attempts, error.diagnostics.kind), completion, attempts };
    } catch (retryError) {
      if (isStructuredOutputError(retryError)) {
        throw appError({ code: 'INVALID_MODEL_OUTPUT', message: retryError.message, diagnostics: { ...retryError.diagnostics, retryOf: error.diagnostics.kind } });
      }
      throw retryError;
    }
  }
}
