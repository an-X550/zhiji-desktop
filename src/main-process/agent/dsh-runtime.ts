import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { readFile, readdir } from 'node:fs/promises';
import { AgentRegistry, type Agent, type AgentHandle } from '@deepseek-ai/dsh-agent';
import { AgentLoop } from '@deepseek-ai/dsh-agent-loop';
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';
import { ToolResultPruner } from '@deepseek-ai/dsh-compaction-tool-result-pruner';
import { LlmRuntime, LlmAdapter, type GenerateOptions, type StreamChunk, createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session';
import { SessionStore } from '@deepseek-ai/dsh-session';
import { JsonlSessionPersistence } from '@deepseek-ai/dsh-session-persistence-jsonl';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { TokenMeter } from '@deepseek-ai/dsh-token-meter';
import { ToolRuntime, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import { AgentUtilityCommandSchema, type AgentModelRequest, type AgentModelResponse, type AgentRuntimeModelConfig, type AgentUtilityEvent } from '../../shared/schemas/agent-protocol';
import type { AgentMessage, AgentSession } from '../../shared/schemas/agent';
import type { AgentToolResult } from '../../shared/schemas/agent-tools';

export interface UtilityMessagePort {
  postMessage(message: AgentUtilityEvent): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown;
  start?(): void;
}

export interface DshRuntimeOptions {
  /** The data-root-owned directory for durable DSH session logs. */
  sessionRoot?: string;
  /** Safe model metadata used by the official token-meter/compaction plugins. */
  modelConfig?: AgentRuntimeModelConfig;
}

const ToolOutputSchema = { type: 'object' as const, additionalProperties: true };
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;
const DEFAULT_MODEL_CONFIG: AgentRuntimeModelConfig = { providerId: 'deepseek', model: 'deepseek-v4-flash' };
const DEEPSEEK_V4_CONTEXT_WINDOW = 1_048_576;

type SearchTurnState = {
  result?: AgentToolResult;
  timeoutRetries: number;
};

function normalizedSearchQuery(input: unknown): string | null {
  if (typeof input !== 'object' || input === null || !('query' in input)) return null;
  const query = (input as { query?: unknown }).query;
  return typeof query === 'string' && query.trim() ? query.trim().replace(/\s+/g, ' ').toLocaleLowerCase() : null;
}
const AGENT_PERSONA = [
  '你是知己的对话助手。通过已注册的知己能力帮助用户完成目标；可读取经脱敏的日志、复盘、项目和验证模式，也可在用户明确要求时保存或更新日志、生成每日反馈。',
  '周/月/项目复盘和洞察复盘必须先预览材料，再等待用户点击知己 Agent 页面中的确认按钮；不要把自己的判断或普通聊天中的“确认”当成用户确认。不要声称已写入或生成正式内容，除非对应工具返回成功；正式内容始终由知己既有校验、证据降级和保存服务负责。',
  '自主执行：用户明确提出任务后，继续调用已注册工具完成必要检索、准备和已授权操作，不仅给出计划或询问是否开始。先利用当前消息、会话与工具可读信息；只有缺少会实质改变目标、日期范围、内容或授权的信息时才提问。普通可逆选择自行判断，不捏造日志事实。',
  '确认衔接：需要页面确认的任务，先完成材料预览并提示使用已有确认按钮，不额外要求聊天确认。宿主提供有效批准后直接使用对应 previewToken 和 approvalId 继续生成；除非材料、范围发生变化或批准失效，不重新预览或要求再次批准。不得自行构造批准标识或绕过工具校验。',
  '完成判断：预览、导航、结果卡片和工具调用已发出都不等于正式生成成功。以对应生成或保存工具的成功结果为准，再说明完成并提供结果入口。某一步失败时按工具错误处理可恢复问题，继续不依赖该步骤的工作；确实需要用户补证、配置或批准时明确缺口与已完成部分，不把失败或等待说成整个任务完成。',
  '输出格式要求：普通回复使用自然语言或 Markdown，不要默认输出 JSON。标题、列表、引用、表格和代码块必须使用真实换行；块级结构之间留空行；Markdown 标记与正文不能挤在同一行。短答也要保留清晰的段落边界；只有确实适合时才使用表格。',
  '能力自述必须以当前宿主事实为准，不要把模型 API 的理论能力说成知己已经具备：上下文压缩已由 DSH 官方 TokenMeter、ToolResultPruner 和 BasicCompactionEngine 提供；Function Calling、有限多步工具规划和工具结果结构化校验已具备；本地长期记忆可通过 zhiji.memory.search 做关键词/短语检索，但不是向量记忆。',
  '能力边界：知己没有标准 MCP Client、图片/音频/视频输入、通用 Computer Use 或递归自我修改能力；内部 MessagePort 工具桥不是 MCP。Structured Output 只用于工具和明确的工作流，普通回复保持 Markdown。涉及日志、复盘和验证模式时，优先使用本地记忆检索；没有命中时明确说未检索到，不要编造“记得”。',
  '受控联网规则：zhiji.web.search 只搜索公开来源并返回本次会话的 sourceId、标题、域名、摘要和时间；需要依据时再用 zhiji.web.read-source 读取同一会话中的来源。搜索错误会返回结构化 code、message、retryable 和可选 retryAfterSeconds：同一 query 每轮最多自动重试一次，retryable 为 false 或已经重试失败后不要重复相同 query；搜索无结果时改写关键词，来源不可读时改用本次会话中的其他来源。最终回答必须列出实际使用来源的标题和域名，不要编造引用。',
  '证据冲突规则：当 memory.search 返回相互矛盾的日志、复盘或已验证模式时，必须明确列出冲突双方。涉及事实是否发生、时间和用户原始表述时，以日志原文为最高依据。复盘和已验证模式只能作为归纳，不能静默覆盖冲突日志。若日志本身不足以裁决，明确说明无法确认，不得编造结论。',
].join('\n\n');
const TOOL_DEFINITIONS: Array<{ name: string; action: string; label: string; description: string; parameters: Record<string, unknown> }> = [
  { name: 'zhiji.journals.list', action: 'journals.list', label: '读取日志摘要', description: '读取经过脱敏的日志摘要，可按日期或项目筛选。', parameters: { type: 'object', properties: { start: { type: 'string' }, end: { type: 'string' }, projectId: { type: 'string' } }, additionalProperties: false } },
  { name: 'zhiji.journals.get', action: 'journals.get', label: '读取日志摘要', description: '按日志 ID 读取经过脱敏的摘要。', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
  { name: 'zhiji.reviews.list', action: 'reviews.list', label: '读取复盘摘要', description: '读取已有复盘的摘要列表。', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'zhiji.reviews.get', action: 'reviews.get', label: '读取复盘摘要', description: '按复盘 ID 读取经过脱敏的摘要。', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
  { name: 'zhiji.projects.list', action: 'projects.list', label: '读取项目列表', description: '读取项目名称、状态和 ID。', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'zhiji.patterns.list', action: 'patterns.list', label: '读取已验证模式', description: '读取用户已确认的验证模式。', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'zhiji.memory.search', action: 'memory.search', label: '检索长期记忆', description: '只读检索知己本地日志、复盘和已确认验证模式的词法证据；query 保留用户原始问题，只有存在有限词汇差异时才提供最多 3 个 alternates。alternates 只能是检索表达，不得填入未经证实的事实、结论或日期；空结果最多重试一次，不会写入记忆。', parameters: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 200 }, alternates: { type: 'array', maxItems: 3, items: { type: 'string', minLength: 1, maxLength: 80 } }, limit: { type: 'integer', minimum: 1, maximum: 8 } }, required: ['query'], additionalProperties: false } },
  { name: 'zhiji.web.search', action: 'web.search', label: '搜索公开来源', description: '通过受控搜索查找公开来源；结果只提供本次会话的 sourceId、标题、域名、摘要和时间，不提供任意 URL。相同 query 每轮最多自动重试一次。', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } },
  { name: 'zhiji.web.read-source', action: 'web.read-source', label: '读取搜索来源', description: '只读取同一搜索会话返回的 sourceId 对应来源；返回标题、域名、时间和有限正文，不接受任意 URL。', parameters: { type: 'object', properties: { searchSessionId: { type: 'string' }, sourceId: { type: 'string' } }, required: ['searchSessionId', 'sourceId'], additionalProperties: false } },
  { name: 'zhiji.journals.create', action: 'journals.create', label: '保存日志', description: '在用户明确要求记录时，通过知己正式日志服务保存一条日志。', parameters: { type: 'object', properties: { date: { type: 'string' }, body: { type: 'string' }, projectIds: { type: 'array', items: { type: 'string' } } }, required: ['date', 'body'], additionalProperties: false } },
  { name: 'zhiji.journals.update', action: 'journals.update', label: '更新日志', description: '在用户明确要求修改时，通过知己正式日志服务按乐观并发更新日志。', parameters: { type: 'object', properties: { id: { type: 'string' }, date: { type: 'string' }, body: { type: 'string' }, projectIds: { type: 'array', items: { type: 'string' } }, expectedUpdatedAt: { type: 'string' } }, required: ['id', 'date', 'body', 'expectedUpdatedAt'], additionalProperties: false } },
  { name: 'zhiji.reviews.generate-daily', action: 'reviews.generate-daily', label: '生成每日反馈', description: '调用知己既有每日反馈服务；必须尽量绑定具体 journalId；证据不足时只返回补证问题，不写入残缺反馈。', parameters: { type: 'object', properties: { date: { type: 'string' }, journalId: { type: 'string' }, regenerate: { type: 'boolean' } }, required: ['date'], additionalProperties: false } },
  { name: 'zhiji.reviews.preview-periodic', action: 'reviews.preview-periodic', label: '预览周期复盘材料', description: '预览周/月/项目复盘材料；必须等待用户在知己 Agent 页面确认后才能生成。', parameters: { type: 'object', properties: { type: { type: 'string', enum: ['weekly', 'monthly', 'project'] }, start: { type: 'string' }, end: { type: 'string' }, projectId: { type: 'string' } }, required: ['type', 'start', 'end'], additionalProperties: false } },
  { name: 'zhiji.reviews.generate-periodic', action: 'reviews.generate-periodic', label: '生成周期复盘', description: '仅使用预览返回的 previewToken 和用户确认返回的 approvalId 生成正式周/月/项目复盘。', parameters: { type: 'object', properties: { type: { type: 'string', enum: ['weekly', 'monthly', 'project'] }, start: { type: 'string' }, end: { type: 'string' }, projectId: { type: 'string' }, previewToken: { type: 'string' }, approvalId: { type: 'string' } }, required: ['type', 'start', 'end', 'previewToken', 'approvalId'], additionalProperties: false } },
  { name: 'zhiji.reviews.preview-insight', action: 'reviews.preview-insight', label: '预览洞察材料', description: '预览日志质量检查、年度回顾或方向校准材料；必须等待用户在知己 Agent 页面确认后才能生成。', parameters: { type: 'object', properties: { type: { type: 'string', enum: ['coach', 'yearly', 'life-design'] }, start: { type: 'string' }, end: { type: 'string' }, topic: { type: 'string' } }, required: ['type', 'start', 'end'], additionalProperties: false } },
  { name: 'zhiji.reviews.generate-insight', action: 'reviews.generate-insight', label: '生成洞察复盘', description: '仅使用预览返回的 previewToken 和用户确认返回的 approvalId 生成正式洞察复盘。', parameters: { type: 'object', properties: { type: { type: 'string', enum: ['coach', 'yearly', 'life-design'] }, start: { type: 'string' }, end: { type: 'string' }, topic: { type: 'string' }, previewToken: { type: 'string' }, approvalId: { type: 'string' } }, required: ['type', 'start', 'end', 'previewToken', 'approvalId'], additionalProperties: false } },
  { name: 'zhiji.ui.navigate', action: 'ui.navigate', label: '打开产品页面', description: '请求打开一个经过验证的知己产品页面。', parameters: { type: 'object', properties: { target: { type: 'object' } }, required: ['target'], additionalProperties: false } },
  { name: 'zhiji.ui.present', action: 'ui.present', label: '展示结果卡片', description: '请求展示含受控产品页链接的结果卡片。', parameters: { type: 'object', properties: { title: { type: 'string' }, summary: { type: 'string' }, links: { type: 'array' } }, required: ['title', 'summary', 'links'], additionalProperties: false } },
];

class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(value: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else if (!this.closed) this.values.push(value);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (;;) {
      const value = this.values.shift();
      if (value !== undefined) { yield value; continue; }
      if (this.closed) return;
      const next = await new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      if (next.done) return;
      yield next.value;
    }
  }
}

class MainProcessModelAdapter extends LlmAdapter {
  constructor(private readonly runtime: DshRuntime) { super(); }
  stream(options: GenerateOptions): AsyncIterable<StreamChunk> { return this.runtime.streamModel(options); }
  resolveModel(provider: string, model: string): Promise<{ provider: string; id: string; name: string; context?: { contextWindow: number } }> {
    const configured = this.runtime.getModelConfig();
    const contextWindow = knownContextWindow(configured.providerId, configured.model);
    return Promise.resolve({ provider, id: model, name: configured.model, ...(contextWindow ? { context: { contextWindow } } : {}) });
  }
}

/**
 * The DSH composition used in Electron's Utility Process.
 * Domain tools are added only when they reuse an existing validated product service.
 */
export class DshRuntime {
  private readonly ctx = new Context();
  private modelConfig: AgentRuntimeModelConfig;
  private readonly agents = new Map<string, AgentHandle>();
  private readonly modelRequests = new Map<string, { queue: AsyncQueue<StreamChunk>; text: string; abort: () => void }>();
  private readonly toolRequests = new Map<string, { resolve: (result: AgentToolResult) => void; reject: (error: Error) => void }>();
  private readonly assistantMessageIds = new Map<string, string>();
  private readonly searchTurnStates = new Map<string, Map<string, SearchTurnState>>();
  private started = false;

  constructor(private readonly port: UtilityMessagePort, private readonly options: DshRuntimeOptions = {}) {
    this.modelConfig = options.modelConfig ?? DEFAULT_MODEL_CONFIG;
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.ctx.plugin(LlmRuntime);
    await this.ctx.plugin(SessionStore);
    await this.ctx.plugin(TokenMeter);
    await this.ctx.plugin(ToolResultPruner);
    await this.ctx.plugin(BasicCompactionEngine);
    if (this.options.sessionRoot) {
      await this.ctx.plugin(JsonlSessionPersistence, {
        root: this.options.sessionRoot,
        compression: 'none',
        packChunks: false,
      });
    }
    await this.ctx.plugin(SystemPrompt, { persona: AGENT_PERSONA });
    await this.ctx.plugin(ToolRuntime, {});
    for (const definition of TOOL_DEFINITIONS) this.ctx.tools.register(this.createTool(definition));
    await this.ctx.plugin(AgentRegistry);
    this.ctx.llm.registerAdapter(['zhiji'], new MainProcessModelAdapter(this));
    await this.ctx.plugin(AgentLoop, { agents: [] });
    this.ctx.on('session/event', (session, event) => this.handleSessionEvent(String(session.id), event));
    this.ctx.on('agent/status', ({ agent, status }) => this.post({ type: 'session.status', sessionId: String(agent.id), status }));
    this.ctx.on('agent/error', ({ agent, error }) => this.post({ type: 'runtime.error', sessionId: String(agent.id), message: toChineseRuntimeError(error) }));
    this.port.on('message', (event) => { void this.handleCommand(event.data); });
    this.port.start?.();
    this.started = true;
    this.post({ type: 'runtime.ready' });
  }

  async dispose(): Promise<void> {
    for (const request of this.modelRequests.values()) request.abort();
    this.modelRequests.clear();
    for (const request of this.toolRequests.values()) request.reject(new Error('知己工具连接已停止。'));
    this.toolRequests.clear();
    this.searchTurnStates.clear();
    for (const handle of this.agents.values()) await handle.dispose();
    this.agents.clear();
    await this.ctx.fiber.dispose();
    this.started = false;
    this.post({ type: 'runtime.stopped' });
  }

  async *streamModel(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const requestId = randomUUID();
    const queue = new AsyncQueue<StreamChunk>();
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    let output = '';
    let reasoningOutput = '';
    let textStarted = false;
    let reasoningStarted = false;
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    const onAbort = () => {
      this.post({ type: 'model.cancel', requestId });
      queue.push({ type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: '请求已取消。' } } });
      queue.close();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    this.modelRequests.set(requestId, { queue, text: '', abort: () => controller.abort() });
    const messages: AgentModelRequest['messages'] = [];
    for (const message of options.messages) {
      const text = message.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
      const reasoning = message.content.filter((block) => block.type === 'reasoning').map((block) => block.text).join('');
      const calls = message.content.filter((block) => block.type === 'tool-call').map((block) => ({ id: String(block.id), name: block.name, arguments: block.arguments }));
      const result = message.content.find((block) => block.type === 'tool-result');
      if (result?.type === 'tool-result') messages.push({ role: 'tool', toolCallId: String(result.toolCallId), content: result.content.filter((block) => block.type === 'text').map((block) => block.text).join('') });
      else if (message.role === 'assistant' && (text || reasoning || calls.length)) messages.push({ role: 'assistant', content: text, ...(reasoning ? { reasoning } : {}), ...(calls.length ? { toolCalls: calls } : {}) });
      else if ((message.role === 'user' || message.role === 'system') && text) messages.push({ role: message.role, content: text });
    }
    this.post({
      type: 'model.request',
      requestId,
      sessionId: String(options.sessionId ?? ''),
      messages,
      system: [options.system, currentDateInstruction()].filter(Boolean).join('\n'),
      ...(options.tools?.length ? { tools: options.tools.map(({ name, description, parameters }) => ({ name, description, parameters })) } : {}),
    });
    try {
      let terminal: Extract<StreamChunk, { type: 'finish' }> | undefined;
      for await (const chunk of queue) {
        if (chunk.type === 'finish') { terminal = chunk; continue; }
        if (chunk.type === 'text-delta') {
          if (!textStarted) { textStarted = true; yield { type: 'block-start', index: 0, blockType: 'text' }; }
          output += chunk.text;
          yield { ...chunk, index: 0 };
          continue;
        }
        if (chunk.type === 'reasoning-delta') {
          if (!reasoningStarted) { reasoningStarted = true; yield { type: 'block-start', index: 1, blockType: 'reasoning' }; }
          reasoningOutput += chunk.text;
          yield { ...chunk, index: 1 };
          continue;
        }
        if (chunk.type === 'tool-call-delta') {
          const blockIndex = chunk.index + 2;
          const current = toolCalls.get(blockIndex) ?? { id: String(chunk.id), name: '', arguments: '' };
          if (chunk.name) current.name = chunk.name;
          current.arguments += chunk.argumentsDelta;
          toolCalls.set(blockIndex, current);
          if (current.arguments === chunk.argumentsDelta) yield { type: 'block-start', index: blockIndex, blockType: 'tool-call' };
          yield { ...chunk, index: blockIndex };
          continue;
        }
        yield chunk;
      }
      const finish = terminal ?? { type: 'finish' as const, reason: { kind: 'stop' as const } };
      if (finish.reason.kind === 'stop') {
        for (const [index, tool] of toolCalls) yield { type: 'block-end', index, block: { type: 'tool-call', id: tool.id as never, name: tool.name, arguments: tool.arguments } };
      }
      if (reasoningStarted) yield { type: 'block-end', index: 1, block: { type: 'reasoning', text: reasoningOutput } };
      if (textStarted) yield { type: 'block-end', index: 0, block: { type: 'text', text: output } };
      yield finish;
    } finally {
      signal.removeEventListener('abort', onAbort);
      this.modelRequests.delete(requestId);
    }
  }

  private async handleCommand(raw: unknown): Promise<void> {
    const command = AgentUtilityCommandSchema.safeParse(raw);
    if (!command.success) return;
    const value = command.data;
    if (value.type === 'model.delta' || value.type === 'model.reasoning-delta' || value.type === 'model.tool-call' || value.type === 'model.completed' || value.type === 'model.failed' || value.type === 'model.cancelled') {
      this.resolveModel(value);
      return;
    }
    if (value.type === 'tool.result') {
      this.toolRequests.get(value.requestId)?.resolve(value.result);
      this.toolRequests.delete(value.requestId);
      return;
    }
    try {
      if (value.type === 'session.start') {
        const handle = await this.ctx.agents.create({ sessionId: SessionId(value.sessionId), agentOptions: { provider: 'zhiji', model: 'configured-by-main-process' } });
        this.agents.set(value.sessionId, handle);
      } else if (value.type === 'session.list') {
        await this.emitPersistedSessions();
      } else if (value.type === 'session.send') {
        const agent = await this.ensureAgent(value.sessionId);
        this.searchTurnStates.set(value.sessionId, new Map());
        agent.followup(createUserMessage({ content: [{ type: 'text', text: value.message }], source: { kind: 'user' } }));
      } else if (value.type === 'session.cancel') {
        this.getAgent(value.sessionId).cancel({ kind: 'user' });
      } else if (value.type === 'session.delete') {
        const handle = this.agents.get(value.sessionId);
        if (handle) {
          await handle.dispose();
          this.agents.delete(value.sessionId);
        }
        this.searchTurnStates.delete(value.sessionId);
      } else if (value.type === 'runtime.configure') {
        this.modelConfig = value.config;
      } else if (value.type === 'runtime.shutdown') {
        await this.dispose();
      }
      this.post({ type: 'command.completed', requestId: value.requestId });
    } catch (error) {
      this.post({ type: 'command.failed', requestId: value.requestId, message: toChineseRuntimeError(error) });
    }
  }

  private resolveModel(command: AgentModelResponse): void {
    const request = this.modelRequests.get(command.requestId);
    if (!request) return;
    if (command.type === 'model.delta') request.queue.push({ type: 'text-delta', index: 0, text: command.delta });
    if (command.type === 'model.reasoning-delta') request.queue.push({ type: 'reasoning-delta', index: 1, text: command.delta });
    if (command.type === 'model.tool-call') request.queue.push({ type: 'tool-call-delta', index: command.index, id: command.callId as never, ...(command.name ? { name: command.name } : {}), argumentsDelta: command.argumentsDelta });
    if (command.type === 'model.completed') { request.queue.push({ type: 'finish', reason: { kind: 'stop' } }); request.queue.close(); }
    if (command.type === 'model.cancelled') { request.queue.push({ type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: '请求已取消。' } } }); request.queue.close(); }
    if (command.type === 'model.failed') { request.queue.push({ type: 'finish', reason: { kind: 'error', failure: { code: 'HOST_MODEL_FAILED', message: command.message } } }); request.queue.close(); }
  }

  private handleSessionEvent(sessionId: string, event: SessionEvent): void {
    if (event.type === 'assistant/chunk' && event.data.chunk.type === 'text-delta') {
      const key = `${sessionId}:${event.data.turn}`;
      const messageId = this.assistantMessageIds.get(key) ?? randomUUID();
      this.assistantMessageIds.set(key, messageId);
      this.post({ type: 'message.delta', sessionId, messageId, delta: event.data.chunk.text });
      return;
    }
    if (event.type === 'assistant/message') {
      const content = event.data.message.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
      if (!content) return;
      const key = `${sessionId}:${event.data.turn}`;
      const messageId = this.assistantMessageIds.get(key) ?? randomUUID();
      this.assistantMessageIds.delete(key);
      this.post({ type: 'message.completed', sessionId, message: { id: messageId, role: 'assistant', content, at: new Date().toISOString() } });
    }
  }

  private getAgent(sessionId: string): Agent {
    const handle = this.agents.get(sessionId);
    if (!handle) throw new Error('Agent 会话不存在。');
    return handle.agent;
  }

  private async ensureAgent(sessionId: string): Promise<Agent> {
    const live = this.agents.get(sessionId);
    if (live) return live.agent;
    if (!this.options.sessionRoot) throw new Error('Agent 会话不存在。');
    const handle = await this.ctx.agents.resume({ resumeSessionId: SessionId(sessionId), agentOptions: { provider: 'zhiji', model: 'configured-by-main-process' } });
    this.agents.set(sessionId, handle);
    return handle.agent;
  }

  private async emitPersistedSessions(): Promise<void> {
    if (!this.options.sessionRoot) return;
    const persistence = this.ctx.get('sessionPersistence');
    if (!persistence) return;
    await this.assertPersistedSessionsReadable(persistence);
    for (const header of await persistence.list()) {
      const inspection = await persistence.inspect(header.id);
      this.post({ type: 'session.snapshot', session: sessionSummary(inspection.meta, inspection.events) });
    }
  }

  /**
   * The official list() intentionally omits files whose first line is not a
   * valid header so a picker can stay cheap. For a user-facing recovery list,
   * silently omitting such a file would look like data loss; inspect the
   * expected artifact slots and surface a runtime error instead.
   */
  private async assertPersistedSessionsReadable(persistence: { inspect(id: SessionId): Promise<{ meta: SessionHeader; events: readonly SessionEvent[] }> }): Promise<void> {
    const root = this.options.sessionRoot;
    if (!root) return;
    for (const project of await readdir(root, { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    })) {
      if (!project.isDirectory()) continue;
      const projectPath = path.join(root, project.name);
      for (const sessionDirectory of await readdir(projectPath, { withFileTypes: true })) {
        if (!sessionDirectory.isDirectory()) continue;
        const sessionPath = path.join(projectPath, sessionDirectory.name);
        const artifacts = await readdir(sessionPath, { withFileTypes: true });
        for (const artifact of artifacts) {
          if (!artifact.isFile() || !artifact.name.startsWith('session.jsonl')) continue;
          if (artifact.name !== 'session.jsonl') throw new Error('corrupt session log: compressed artifacts are not enabled');
          const filePath = path.join(sessionPath, artifact.name);
          const firstLine = (await readFile(filePath, 'utf8')).split(/\r?\n/, 1)[0];
          let header: unknown;
          try { header = JSON.parse(firstLine); }
          catch { throw new Error(`corrupt session log: header line is not valid JSON (${filePath})`); }
          if (!header || typeof header !== 'object' || (header as { type?: unknown }).type !== 'session') throw new Error(`corrupt session log: first line is not a session header (${filePath})`);
          const id = (header as { id?: unknown }).id;
          if (typeof id !== 'string' || !/^agent_[a-z0-9]+$/.test(id)) throw new Error(`corrupt session log: invalid session id (${filePath})`);
          if (sessionDirectory.name !== id) throw new Error(`corrupt session log: path does not match session id (${filePath})`);
          await persistence.inspect(SessionId(id));
        }
      }
    }
  }

  private post(event: AgentUtilityEvent): void { this.port.postMessage(event); }

  getModelConfig(): AgentRuntimeModelConfig { return this.modelConfig; }

  private createTool(definition: typeof TOOL_DEFINITIONS[number]): ToolDefinition {
    return {
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      output: { schema: ToolOutputSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: (args, exec) => this.callTool(String(exec.agent?.id ?? ''), definition.action, args, exec, definition.label),
    };
  }

  private async callTool(sessionId: string, action: string, input: unknown, exec: ToolRunContext, label: string): Promise<AgentToolResult> {
    if (!sessionId) throw new Error('知己工具未关联到有效会话。');
    if (exec.signal.aborted) throw new Error('已停止本次工具调用。');
    const query = action === 'web.search' ? normalizedSearchQuery(input) : null;
    const turnStates = query ? this.searchTurnStates.get(sessionId) ?? new Map<string, SearchTurnState>() : undefined;
    if (query && turnStates && !this.searchTurnStates.has(sessionId)) this.searchTurnStates.set(sessionId, turnStates);
    const previous = query ? turnStates?.get(query) : undefined;
    if (previous?.result) return previous.result;

    const activityId = randomUUID();
    this.post({ type: 'tool.activity', sessionId, callId: activityId, phase: 'started', label });
    let result: AgentToolResult | undefined;
    let timeoutRetries = 0;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      result = await this.requestTool(sessionId, action, input, exec);
      if (result.kind === 'error' && action === 'web.search' && result.code === 'SEARCH_TIMEOUT' && result.retryable && timeoutRetries === 0) {
        timeoutRetries += 1;
        continue;
      }
      break;
    }
    if (!result) throw new Error('知己工具未返回结果。');
    if (result.kind === 'error') {
      this.post({ type: 'tool.activity', sessionId, callId: activityId, phase: 'failed', label });
      if (query && turnStates) turnStates.set(query, { result, timeoutRetries });
      return result;
    }
    if (query && turnStates) turnStates.set(query, { result, timeoutRetries });
    this.post({ type: 'tool.activity', sessionId, callId: activityId, phase: 'completed', label });
    if (result.kind === 'ui.navigate') this.post({ type: 'ui.navigate', sessionId, target: result.target });
    if (result.kind === 'ui.present') this.post({ type: 'ui.present', sessionId, card: result.card });
    return result;
  }

  private requestTool(sessionId: string, action: string, input: unknown, exec: ToolRunContext): Promise<AgentToolResult> {
    const requestId = randomUUID();
    return new Promise<AgentToolResult>((resolve, reject) => {
      const abort = () => { this.post({ type: 'tool.cancel', sessionId, requestId }); this.toolRequests.delete(requestId); reject(new Error('已停止本次工具调用。')); };
      exec.signal.addEventListener('abort', abort, { once: true });
      this.toolRequests.set(requestId, {
        resolve: (value) => { exec.signal.removeEventListener('abort', abort); resolve(value); },
        reject: (error) => { exec.signal.removeEventListener('abort', abort); reject(error); },
      });
      this.post({ type: 'tool.request', requestId, sessionId, action: action as never, input: input as never });
    });
  }
}

function currentDateInstruction(now = new Date()): string {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `知己桌面端当前本地日期是 ${date}，今天是星期${WEEKDAYS[now.getDay()]}。涉及“今天、昨天、明天、本周、星期几”等日期问题时，必须以此为准直接回答，不要声称需要联网，也不要猜测其他日期。`;
}

function knownContextWindow(providerId: AgentRuntimeModelConfig['providerId'], model: string): number | undefined {
  return providerId === 'deepseek' && /^deepseek-v4-(flash|pro)$/i.test(model.trim()) ? DEEPSEEK_V4_CONTEXT_WINDOW : undefined;
}

function sessionSummary(meta: SessionHeader, events: readonly SessionEvent[]): AgentSession {
  const id = String(meta.id);
  if (!/^agent_[a-z0-9]+$/.test(id)) throw new Error('Agent 会话数据损坏：会话 ID 无效。');
  const messages: AgentMessage[] = [];
  let latestAt = meta.createdAt;
  for (const event of events) {
    latestAt = Math.max(latestAt, event.time);
    const message = event.type === 'user/message' ? event.data : event.type === 'assistant/message' ? event.data.message : undefined;
    if (!message) continue;
    const content = message.content.filter((block) => block.type === 'text').map((block) => block.text).join('').trim();
    if (!content) continue;
    const messageId = String(message.id);
    messages.push({
      id: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(messageId) ? messageId : randomUUID(),
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: content.slice(0, 20_000),
      at: new Date(event.time).toISOString(),
    });
  }
  const firstUser = messages.find((message) => message.role === 'user');
  return {
    id,
    title: firstUser?.content.slice(0, 80) || '已恢复对话',
    status: 'idle',
    messages: messages.slice(-200),
    createdAt: new Date(meta.createdAt).toISOString(),
    updatedAt: new Date(latestAt).toISOString(),
  };
}

function toChineseRuntimeError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('会话数据损坏') || message.includes('corrupt session') || message.includes('corrupt Zstandard')) return 'Agent 会话数据损坏，未清理；请从备份恢复或新建会话。';
  if (message.includes('不存在')) return message;
  if (message.includes('取消')) return '已停止本次 Agent 请求。';
  return '知己 Agent 运行失败；请重试，其他页面不受影响。';
}
