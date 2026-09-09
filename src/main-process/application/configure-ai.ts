import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { SaveProviderConfigInput } from '../../shared/schemas/ipc';
import { appError } from '../../shared/errors/app-error';
import { atomicWriteUtf8 } from '../infrastructure/markdown/atomic-write';
import { normalizeProviderConfig, PROVIDER_PRESETS, ProviderConfigSchema, type ProviderConfig, type PublicProviderConfig } from '../infrastructure/ai/provider-config';
import { OpenAiCompatibleProvider } from '../infrastructure/ai/openai-compatible-provider';
import type { AiConnectionTestResult } from '../../shared/schemas/domain';
import type { AgentStreamDelta, AgentToolSpec, ChatMessage, CollectOptions, StructuredCollectOptions, StructuredCompletion } from '../infrastructure/ai/openai-compatible-provider';
import type { CredentialStore } from '../infrastructure/credentials/credential-store';

const defaults: ProviderConfig = { providerId: 'openai', baseUrl: PROVIDER_PRESETS.openai.baseUrl, model: PROVIDER_PRESETS.openai.defaultModel, agentThinking: 'disabled' };

function migrateProviderConfig(config: ProviderConfig): ProviderConfig {
  if (config.providerId === 'deepseek' && (config.model === 'deepseek-chat' || config.model === 'deepseek-reasoner')) {
    return { ...config, model: PROVIDER_PRESETS.deepseek.defaultModel };
  }
  return config;
}

export class ConfigureAi {
  private readonly target: string;
  constructor(root: string, private readonly credentials: CredentialStore, private readonly allowLoopbackHttp = false) {
    this.target = path.join(root, 'settings.json');
  }

  private async readConfig(): Promise<ProviderConfig> {
    try { return migrateProviderConfig(ProviderConfigSchema.parse(JSON.parse(await readFile(this.target, 'utf8')))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaults; throw error; }
  }

  async getPublicConfig(): Promise<PublicProviderConfig> {
    const config = await this.readConfig();
    return { ...config, hasApiKey: Boolean(await this.credentials.read(config.providerId)) };
  }

  async save(input: SaveProviderConfigInput): Promise<PublicProviderConfig> {
    const { apiKey, ...rawConfig } = input;
    const config = normalizeProviderConfig(rawConfig, this.allowLoopbackHttp);
    if (apiKey) await this.credentials.save(config.providerId, apiKey);
    await atomicWriteUtf8(this.target, JSON.stringify(config, null, 2), (value) => ProviderConfigSchema.parse(JSON.parse(value)));
    return { ...config, hasApiKey: Boolean(await this.credentials.read(config.providerId)) };
  }

  async testConnection(input: SaveProviderConfigInput): Promise<AiConnectionTestResult> {
    const { apiKey, ...rawConfig } = input;
    const config = normalizeProviderConfig(rawConfig, this.allowLoopbackHttp);
    const key = apiKey || await this.credentials.read(config.providerId);
    if (!key) throw appError({ code: 'INVALID_INPUT', message: '请先填写 API Key。' });
    return new OpenAiCompatibleProvider({ ...config, apiKey: key }).testConnection();
  }

  async clearApiKey(): Promise<PublicProviderConfig> {
    const config = await this.readConfig();
    await this.credentials.delete(config.providerId);
    return { ...config, hasApiKey: false };
  }

  async collect(messages: ChatMessage[], signal?: AbortSignal, options?: CollectOptions): Promise<string> {
    const config = await this.readConfig();
    const apiKey = await this.credentials.read(config.providerId);
    if (!apiKey) throw appError({ code: 'INVALID_INPUT', message: '请先在设置中保存 API Key。' });
    return new OpenAiCompatibleProvider({ ...config, apiKey }).collect(messages, signal, options);
  }

  async collectStructured(messages: ChatMessage[], signal: AbortSignal | undefined, options: StructuredCollectOptions): Promise<StructuredCompletion> {
    const config = await this.readConfig();
    const apiKey = await this.credentials.read(config.providerId);
    if (!apiKey) throw appError({ code: 'INVALID_INPUT', message: '请先在设置中保存 API Key。' });
    return new OpenAiCompatibleProvider({ ...config, apiKey }).collectStructured(messages, signal, options);
  }

  async *stream(messages: ChatMessage[], signal?: AbortSignal, options?: CollectOptions): AsyncGenerator<string> {
    const config = await this.readConfig();
    const apiKey = await this.credentials.read(config.providerId);
    if (!apiKey) throw appError({ code: 'INVALID_INPUT', message: '请先在设置中保存 API Key。' });
    yield* new OpenAiCompatibleProvider({ ...config, apiKey }).stream(messages, signal, options);
  }

  /** Agent 专用流保留工具调用块；密钥仍只在 Main Process 读取。 */
  async *streamAgent(messages: ChatMessage[], tools: AgentToolSpec[], signal?: AbortSignal): AsyncGenerator<AgentStreamDelta> {
    const config = await this.readConfig();
    const apiKey = await this.credentials.read(config.providerId);
    if (!apiKey) throw appError({ code: 'INVALID_INPUT', message: '请先在设置中保存 API Key。' });
    yield* new OpenAiCompatibleProvider({ ...config, apiKey }).streamAgent(messages, tools, signal);
  }
}
