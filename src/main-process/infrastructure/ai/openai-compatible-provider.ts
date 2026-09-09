import { appError } from '../../../shared/errors/app-error';
import type { AiConnectionTestResult, AiUsage } from '../../../shared/schemas/domain';

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; reasoning?: string; toolCalls?: Array<{ id: string; name: string; arguments: string }> }
  | { role: 'tool'; content: string; toolCallId: string };
export interface CollectOptions { jsonObject?: boolean; maxTokens?: number }
export type ProviderUsage = AiUsage;
export interface StructuredCompletionMetadata {
  providerId?: string;
  model?: string;
  reasoningPresent?: boolean;
  refusalPresent?: boolean;
}
export interface StructuredCompletion { content: string; finishReason: string | null; usage?: ProviderUsage | null; metadata?: StructuredCompletionMetadata }
export interface StructuredCollectOptions { maxTokens: number; thinking?: 'disabled' | 'enabled' }
export interface AgentToolSpec { name: string; description: string; parameters: Record<string, unknown> }
export type AgentStreamDelta = { kind: 'text'; text: string } | { kind: 'reasoning'; text: string } | { kind: 'tool-call'; index: number; callId: string; name?: string; argumentsDelta: string };

function normalizeAgentToolName(name: string, used: Set<string>): string {
  const base = (name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'tool').slice(0, 64);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    const suffixText = `_${suffix}`;
    candidate = `${base.slice(0, 64 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

/** AI 请求 60 秒未返回视为超时；与调用方传入的取消信号合并。 */
const AI_REQUEST_TIMEOUT_MS = 60_000;

function mapNetworkError(signal?: AbortSignal): Error {
  if (signal?.aborted) return appError({ code: 'CANCELLED' });
  return appError({ code: 'NETWORK_TIMEOUT' });
}

function ensureSuccessfulResponse(response: Response, model: string): void {
  if (response.ok) return;
  if (response.status === 401 || response.status === 403) throw appError({ code: 'INVALID_API_KEY' });
  if (response.status === 404) throw appError({ code: 'MODEL_NOT_FOUND', model });
  if (response.status === 429) throw appError({ code: 'RATE_LIMITED' });
  throw appError({ code: 'UNKNOWN', message: `接口返回 ${response.status}` });
}

export class OpenAiCompatibleProvider {
  constructor(private readonly config: { providerId?: string; baseUrl: string; model: string; apiKey: string; agentThinking?: 'disabled' | 'enabled' }) {}

  async *stream(messages: ChatMessage[], signal?: AbortSignal, options?: CollectOptions): AsyncGenerator<string> {
    for await (const delta of this.streamFrames(messages, signal, options)) if (delta.kind === 'text') yield delta.text;
  }

  async *streamAgent(messages: ChatMessage[], tools: AgentToolSpec[], signal?: AbortSignal): AsyncGenerator<AgentStreamDelta> {
    const deepSeek = this.config.providerId === 'deepseek';
    const thinkingEnabled = deepSeek && this.config.agentThinking === 'enabled';
    yield* this.streamFrames(messages, signal, undefined, tools, deepSeek, thinkingEnabled);
  }

  private async *streamFrames(messages: ChatMessage[], signal?: AbortSignal, options?: CollectOptions, tools?: AgentToolSpec[], deepSeek = false, thinkingEnabled = false): AsyncGenerator<AgentStreamDelta> {
    const combined = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS);
    const apiToolNames = new Map<string, string>();
    const internalToolNames = new Map<string, string>();
    const usedApiToolNames = new Set<string>();
    const apiTools = tools?.map((tool) => {
      const apiName = normalizeAgentToolName(tool.name, usedApiToolNames);
      apiToolNames.set(apiName, tool.name);
      internalToolNames.set(tool.name, apiName);
      return { ...tool, name: apiName };
    });
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST', signal: combined,
        headers: { authorization: `Bearer ${this.config.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.config.model, messages: messages.map((message) => message.role === 'tool'
          ? { role: 'tool', content: message.content, tool_call_id: message.toolCallId }
          : message.role === 'assistant' && message.toolCalls?.length
            ? { role: 'assistant', content: message.content, ...(message.reasoning ? { reasoning_content: message.reasoning } : {}), tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: internalToolNames.get(call.name) ?? call.name, arguments: call.arguments } })) }
            : { role: message.role, content: message.content }), stream: true, ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}), ...(deepSeek ? { thinking: { type: thinkingEnabled ? 'enabled' : 'disabled' } } : {}), ...(options?.jsonObject ? { response_format: { type: 'json_object' } } : {}), ...(apiTools?.length ? { tools: apiTools.map((tool) => ({ type: 'function', function: tool })) } : {}) }),
      });
    } catch {
      throw mapNetworkError(signal);
    }
    ensureSuccessfulResponse(response, this.config.model);
    if (!response.body) throw appError({ code: 'UNKNOWN', message: '接口没有返回内容。' });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    const toolCallIds = new Map<number, string>();
    for (;;) {
      let done: boolean;
      let value: Uint8Array | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch {
        throw mapNetworkError(signal);
      }
      pending += decoder.decode(value, { stream: !done });
      const frames = pending.split(/\r?\n\r?\n/);
      pending = frames.pop() ?? '';
      for (const frame of frames) {
        for (const line of frame.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return;
          let payload: unknown;
          try { payload = JSON.parse(data); }
          catch { continue; }
          const delta = (payload as { choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown; tool_calls?: Array<{ index?: unknown; id?: unknown; function?: { name?: unknown; arguments?: unknown } }> } }> } | null)?.choices?.[0]?.delta;
          const text = delta?.content;
          if (typeof text === 'string') yield { kind: 'text', text };
          const reasoning = delta?.reasoning_content;
          if (typeof reasoning === 'string') yield { kind: 'reasoning', text: reasoning };
          for (const call of delta?.tool_calls ?? []) {
            if (typeof call.index !== 'number' || !Number.isInteger(call.index)) continue;
            const callId = typeof call.id === 'string' ? call.id : toolCallIds.get(call.index);
            if (!callId) continue;
            toolCallIds.set(call.index, callId);
            const name = typeof call.function?.name === 'string' ? (apiToolNames.get(call.function.name) ?? call.function.name) : undefined;
            const argumentsDelta = typeof call.function?.arguments === 'string' ? call.function.arguments : '';
            yield { kind: 'tool-call', index: call.index, callId, ...(name ? { name } : {}), argumentsDelta };
          }
        }
      }
      if (done) return;
    }
  }

  async collect(messages: ChatMessage[], signal?: AbortSignal, options?: CollectOptions): Promise<string> {
    let output = '';
    for await (const delta of this.stream(messages, signal, options)) output += delta;
    return output;
  }

  /**
   * 结构化内容专用的非流式收集路径：保留服务商的 finish_reason，
   * 让日反馈可以区分空内容、截断、JSON 错误和 Schema 错误。
   */
  async collectStructured(messages: ChatMessage[], signal?: AbortSignal, options: StructuredCollectOptions = { maxTokens: 1200 }): Promise<StructuredCompletion> {
    const combined = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST', signal: combined,
        headers: { authorization: `Bearer ${this.config.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          messages: messages.map((message) => ({ role: message.role, content: message.content })),
          stream: false,
          max_tokens: options.maxTokens,
          ...(this.config.providerId === 'deepseek' && options.thinking ? { thinking: { type: options.thinking } } : {}),
          response_format: { type: 'json_object' },
        }),
      });
    } catch {
      throw mapNetworkError(signal);
    }
    ensureSuccessfulResponse(response, this.config.model);
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw appError({ code: 'UNKNOWN', message: '接口返回内容无法读取。' }); }
    const choice = (payload as { choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown; refusal?: unknown }; finish_reason?: unknown }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } } } | null)?.choices?.[0];
    const message = choice?.message;
    const content = typeof message?.content === 'string' ? message.content : '';
    const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;
    const reasoningPresent = typeof message?.reasoning_content === 'string' ? message.reasoning_content.length > 0 : Boolean(message?.reasoning_content);
    const refusalPresent = typeof message?.refusal === 'string' ? message.refusal.length > 0 : Boolean(message?.refusal);
    const usage = (payload as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } } } | null)?.usage;
    const metadata = this.config.providerId
      ? { providerId: this.config.providerId, model: this.config.model, reasoningPresent, refusalPresent }
      : reasoningPresent || refusalPresent ? { reasoningPresent, refusalPresent } : undefined;
    return {
      content,
      finishReason,
      ...(usage ? {
        usage: {
          inputTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null,
          outputTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null,
          cachedInputTokens: typeof usage.prompt_tokens_details?.cached_tokens === 'number' ? usage.prompt_tokens_details.cached_tokens : null,
        },
      } : {}),
      ...(metadata ? { metadata } : {}),
    };
  }

  async testConnection(signal?: AbortSignal): Promise<AiConnectionTestResult> {
    const combined = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS);
    const maxTokens = 32;
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST', signal: combined,
        headers: { authorization: `Bearer ${this.config.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'user', content: 'Return exactly one JSON object: {"ok":true}. Do not include Markdown or any extra text.' }],
          stream: false,
          max_tokens: maxTokens,
          ...(this.config.providerId === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
          response_format: { type: 'json_object' },
        }),
      });
    } catch {
      throw mapNetworkError(signal);
    }
    ensureSuccessfulResponse(response, this.config.model);
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw appError({ code: 'UNKNOWN', message: '连接已建立，但接口返回内容无法读取。' }); }
    const choice = (payload as { choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown; refusal?: unknown }; finish_reason?: unknown }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } } } | null)?.choices?.[0];
    const message = choice?.message;
    const content = typeof message?.content === 'string' ? message.content : '';
    const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : null;
    const reasoningPresent = typeof message?.reasoning_content === 'string' ? message.reasoning_content.length > 0 : Boolean(message?.reasoning_content);
    const refusalPresent = typeof message?.refusal === 'string' ? message.refusal.length > 0 : Boolean(message?.refusal);
    const rawUsage = (payload as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } } } | null)?.usage;
    const usage: ProviderUsage | null = rawUsage ? {
      inputTokens: typeof rawUsage.prompt_tokens === 'number' ? rawUsage.prompt_tokens : null,
      outputTokens: typeof rawUsage.completion_tokens === 'number' ? rawUsage.completion_tokens : null,
      cachedInputTokens: typeof rawUsage.prompt_tokens_details?.cached_tokens === 'number' ? rawUsage.prompt_tokens_details.cached_tokens : null,
    } : null;
    const metadata = { providerId: this.config.providerId ?? 'unknown', model: this.config.model, reasoningPresent, refusalPresent };
    const failure = (kind: 'empty_content' | 'truncated' | 'invalid_json' | 'schema_mismatch', schemaPaths: string[] = []) => appError({
      code: 'INVALID_MODEL_OUTPUT',
      message: '连接已建立，但结构化响应未通过校验。',
      diagnostics: {
        kind,
        finishReason,
        outputLength: content.length,
        schemaPaths,
        at: new Date().toISOString(),
        maxTokens,
        attempt: 1,
        providerId: metadata.providerId,
        model: metadata.model,
        ...(usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cachedInputTokens: usage.cachedInputTokens } : {}),
        reasoningPresent,
        refusalPresent,
      },
    });
    if (finishReason === 'length' || finishReason === 'max_tokens') throw failure('truncated');
    if (!content.trim()) throw failure('empty_content');
    let parsed: unknown;
    try { parsed = JSON.parse(content); }
    catch { throw failure('invalid_json'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed as { ok?: unknown }).ok !== true) throw failure('schema_mismatch', ['ok']);
    return {
      providerId: metadata.providerId,
      model: metadata.model,
      finishReason,
      outputLength: content.length,
      jsonValid: true,
      usage,
      reasoningPresent,
      refusalPresent,
    };
  }
}
