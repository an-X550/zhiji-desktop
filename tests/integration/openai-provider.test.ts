import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { OpenAiCompatibleProvider } from '../../src/main-process/infrastructure/ai/openai-compatible-provider';

const servers: ReturnType<typeof createServer>[] = [];
afterEach(() => servers.splice(0).forEach((server) => server.close()));

async function endpoint(status: number, body: string, contentType = 'application/json') {
  const server = createServer((_request, response) => {
    response.writeHead(status, { 'content-type': contentType });
    response.end(body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server port');
  return `http://127.0.0.1:${address.port}/v1`;
}

async function inspectingEndpoint(onBody: (body: unknown) => void, responseBody: string) {
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => { onBody(JSON.parse(raw)); response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end(responseBody); });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server port');
  return `http://127.0.0.1:${address.port}/v1`;
}

async function sequencingEndpoint(onBody: (body: unknown) => void, responseBodies: string[]) {
  let requestIndex = 0;
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      onBody(JSON.parse(raw));
      const responseBody = responseBodies[Math.min(requestIndex, responseBodies.length - 1)];
      requestIndex += 1;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(responseBody);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server port');
  return `http://127.0.0.1:${address.port}/v1`;
}

async function inspectingJsonEndpoint(onBody: (body: unknown) => void) {
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => { onBody(JSON.parse(raw)); response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })); });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server port');
  return `http://127.0.0.1:${address.port}/v1`;
}

async function inspectingStructuredEndpoint(onBody: (body: unknown) => void, payload: unknown = { choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] }) {
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => { onBody(JSON.parse(raw)); response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(payload)); });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server port');
  return `http://127.0.0.1:${address.port}/v1`;
}

describe('OpenAiCompatibleProvider', () => {
  it.each([[401, 'INVALID_API_KEY'], [404, 'MODEL_NOT_FOUND'], [429, 'RATE_LIMITED']] as const)('maps HTTP %s to %s', async (status, code) => {
    const baseUrl = await endpoint(status, '{}');
    const provider = new OpenAiCompatibleProvider({ baseUrl, model: 'fake', apiKey: 'x' });
    await expect(provider.collect([{ role: 'user', content: 'hello' }])).rejects.toMatchObject({ code });
  });

  it('parses compatible SSE deltas', async () => {
    const body = 'data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n';
    const baseUrl = await endpoint(200, body, 'text/event-stream');
    const provider = new OpenAiCompatibleProvider({ baseUrl, model: 'fake', apiKey: 'x' });
    await expect(provider.collect([{ role: 'user', content: 'hello' }])).resolves.toBe('你好');
  });

  it('skips malformed SSE frames instead of failing the whole generation', async () => {
    const body = 'data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: {broken-json!!\n\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n';
    const baseUrl = await endpoint(200, body, 'text/event-stream');
    const provider = new OpenAiCompatibleProvider({ baseUrl, model: 'fake', apiKey: 'x' });
    await expect(provider.collect([{ role: 'user', content: 'hello' }])).resolves.toBe('你好');
  });

  it('preserves streamed tool-call arguments when later frames omit the call id', async () => {
    const body = 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"zhiji_journals_get","arguments":"{\\"id\\":\\"journal_"}}]}}]}\n\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"a1\\"}"}}]}}]}\n\ndata: [DONE]\n\n';
    let requestBody: unknown;
    const baseUrl = await inspectingEndpoint((value) => { requestBody = value; }, body);
    const provider = new OpenAiCompatibleProvider({ providerId: 'deepseek', baseUrl, model: 'fake', apiKey: 'x' });
    const frames = [];
    for await (const frame of provider.streamAgent([{ role: 'user', content: '读取日志' }], [{ name: 'zhiji.journals.get', description: '读取日志', parameters: { type: 'object' } }])) frames.push(frame);
    expect(requestBody).toMatchObject({ thinking: { type: 'disabled' }, tools: [{ type: 'function', function: { name: 'zhiji_journals_get' } }] });
    expect(frames).toEqual([
      { kind: 'tool-call', index: 0, callId: 'call_1', name: 'zhiji.journals.get', argumentsDelta: '{"id":"journal_' },
      { kind: 'tool-call', index: 0, callId: 'call_1', argumentsDelta: 'a1"}' },
    ]);
  });

  it('streams DeepSeek reasoning when Agent thinking is enabled and replays it with tool calls', async () => {
    const requestBodies: unknown[] = [];
    const baseUrl = await sequencingEndpoint((body) => requestBodies.push(body), [
      'data: {"choices":[{"delta":{"reasoning_content":"先分析"}}]}\n\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"zhiji_journals_get","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n',
      'data: [DONE]\n\n',
    ]);
    const provider = new OpenAiCompatibleProvider({ providerId: 'deepseek', agentThinking: 'enabled', baseUrl, model: 'fake', apiKey: 'x' });
    const tools = [{ name: 'zhiji.journals.get', description: '读取日志', parameters: { type: 'object' } }];
    const firstFrames = [];
    for await (const frame of provider.streamAgent([{ role: 'user', content: '读取日志' }], tools)) firstFrames.push(frame);
    const secondFrames = [];
    for await (const frame of provider.streamAgent([
      { role: 'user', content: '读取日志' },
      { role: 'assistant', content: '', reasoning: '先分析', toolCalls: [{ id: 'call_1', name: 'zhiji.journals.get', arguments: '{}' }] },
      { role: 'tool', content: '{"items":[]}', toolCallId: 'call_1' },
    ], tools)) secondFrames.push(frame);

    expect(firstFrames).toEqual([
      { kind: 'reasoning', text: '先分析' },
      { kind: 'tool-call', index: 0, callId: 'call_1', name: 'zhiji.journals.get', argumentsDelta: '{}' },
    ]);
    expect(secondFrames).toEqual([]);
    expect(requestBodies[0]).toMatchObject({ thinking: { type: 'enabled' } });
    expect(requestBodies[1]).toMatchObject({ messages: [
      { role: 'user' },
      { role: 'assistant', reasoning_content: '先分析', tool_calls: [{ function: { name: 'zhiji_journals_get' } }] },
      { role: 'tool' },
    ] });
  });

  it('uses API-safe names when replaying assistant tool calls', async () => {
    const requestBodies: unknown[] = [];
    const baseUrl = await sequencingEndpoint((body) => requestBodies.push(body), [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"zhiji_journals_get","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n',
      'data: [DONE]\n\n',
    ]);
    const provider = new OpenAiCompatibleProvider({ providerId: 'deepseek', baseUrl, model: 'fake', apiKey: 'x' });
    const tools = [{ name: 'zhiji.journals.get', description: '读取日志', parameters: { type: 'object' } }];
    const firstFrames = [];
    for await (const frame of provider.streamAgent([{ role: 'user', content: '读取日志' }], tools)) firstFrames.push(frame);
    const secondFrames = [];
    for await (const frame of provider.streamAgent([
      { role: 'user', content: '读取日志' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'zhiji.journals.get', arguments: '{}' }] },
      { role: 'tool', content: '{"items":[]}', toolCallId: 'call_1' },
    ], tools)) secondFrames.push(frame);
    expect(firstFrames).toHaveLength(1);
    expect(secondFrames).toEqual([]);
    expect(requestBodies[1]).toMatchObject({ messages: [
      { role: 'user' },
      { role: 'assistant', tool_calls: [{ function: { name: 'zhiji_journals_get' } }] },
      { role: 'tool' },
    ] });
  });

  it('requests JSON object mode only for structured generations', async () => {
    let requestBody: unknown;
    const body = 'data: {"choices":[{"delta":{"content":"{}"}}]}\n\ndata: [DONE]\n\n';
    const baseUrl = await inspectingEndpoint((value) => { requestBody = value; }, body);
    const provider = new OpenAiCompatibleProvider({ baseUrl, model: 'deepseek-chat', apiKey: 'x' });
    await provider.collect([{ role: 'user', content: 'Return JSON.' }], undefined, { jsonObject: true });
    expect(requestBody).toMatchObject({ response_format: { type: 'json_object' } });
  });

  it('tests connectivity with a bounded non-stream request', async () => {
    let requestBody: unknown;
    const baseUrl = await inspectingJsonEndpoint((value) => { requestBody = value; });
    const provider = new OpenAiCompatibleProvider({ baseUrl, model: 'deepseek-v4-flash', apiKey: 'x' });
    await expect(provider.testConnection()).resolves.toMatchObject({ model: 'deepseek-v4-flash', finishReason: null, outputLength: 11, jsonValid: true, usage: null, reasoningPresent: false, refusalPresent: false });
    expect(requestBody).toMatchObject({ model: 'deepseek-v4-flash', stream: false, max_tokens: 32, response_format: { type: 'json_object' } });
  });

  it('rejects a successful HTTP response when the structured probe is unusable', async () => {
    const baseUrl = await inspectingStructuredEndpoint(() => undefined, { choices: [{ message: { content: '' }, finish_reason: 'length' }] });
    const provider = new OpenAiCompatibleProvider({ providerId: 'deepseek', baseUrl, model: 'deepseek-v4-flash', apiKey: 'x' });
    await expect(provider.testConnection()).rejects.toMatchObject({ code: 'INVALID_MODEL_OUTPUT', diagnostics: { kind: 'truncated', providerId: 'deepseek', model: 'deepseek-v4-flash', maxTokens: 32, outputLength: 0 } });
  });

  it('returns safe usage and JSON diagnostics for a valid connectivity probe', async () => {
    const baseUrl = await inspectingStructuredEndpoint(() => undefined, {
      choices: [{ message: { content: '{"ok":true}', reasoning_content: 'hidden' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 21, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 3 } },
    });
    const provider = new OpenAiCompatibleProvider({ providerId: 'deepseek', baseUrl, model: 'deepseek-v4-flash', apiKey: 'x' });
    await expect(provider.testConnection()).resolves.toEqual({ providerId: 'deepseek', model: 'deepseek-v4-flash', finishReason: 'stop', outputLength: 11, jsonValid: true, usage: { inputTokens: 21, outputTokens: 5, cachedInputTokens: 3 }, reasoningPresent: true, refusalPresent: false });
  });

  it('uses a bounded non-stream JSON request and preserves finish_reason', async () => {
    let requestBody: unknown;
    const baseUrl = await inspectingStructuredEndpoint((value) => { requestBody = value; });
    const provider = new OpenAiCompatibleProvider({ baseUrl, model: 'deepseek-v4-flash', apiKey: 'x' });
    await expect(provider.collectStructured([{ role: 'user', content: 'Return JSON.' }], undefined, { maxTokens: 1200 })).resolves.toEqual({ content: '{"ok":true}', finishReason: 'stop' });
    expect(requestBody).toMatchObject({ model: 'deepseek-v4-flash', stream: false, max_tokens: 1200, response_format: { type: 'json_object' } });
  });

  it('disables DeepSeek thinking only when the structured workflow requests it', async () => {
    let requestBody: unknown;
    const baseUrl = await inspectingStructuredEndpoint((value) => { requestBody = value; });
    const provider = new OpenAiCompatibleProvider({ providerId: 'deepseek', baseUrl, model: 'deepseek-v4-flash', apiKey: 'x' });
    await provider.collectStructured([{ role: 'user', content: 'Return JSON.' }], undefined, { maxTokens: 1200, thinking: 'disabled' });
    expect(requestBody).toMatchObject({ thinking: { type: 'disabled' } });
  });

  it('preserves provider usage when the compatible endpoint returns it', async () => {
    const baseUrl = await inspectingStructuredEndpoint(() => undefined, {
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 17, completion_tokens: 9, prompt_tokens_details: { cached_tokens: 4 } },
    });
    const provider = new OpenAiCompatibleProvider({ baseUrl, model: 'deepseek-v4-flash', apiKey: 'x' });
    await expect(provider.collectStructured([{ role: 'user', content: 'Return JSON.' }])).resolves.toEqual({
      content: '{"ok":true}',
      finishReason: 'stop',
      usage: { inputTokens: 17, outputTokens: 9, cachedInputTokens: 4 },
    });
  });

  it('preserves safe reasoning/refusal metadata without returning their content as output', async () => {
    const baseUrl = await inspectingStructuredEndpoint(() => undefined, {
      choices: [{ message: { content: '', reasoning_content: 'internal reasoning' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 31, completion_tokens: 1200 },
    });
    const provider = new OpenAiCompatibleProvider({ providerId: 'deepseek', baseUrl, model: 'deepseek-v4-flash', apiKey: 'x' });
    await expect(provider.collectStructured([{ role: 'user', content: 'Return JSON.' }], undefined, { maxTokens: 1200 })).resolves.toMatchObject({
      content: '', finishReason: 'length', metadata: { providerId: 'deepseek', model: 'deepseek-v4-flash', reasoningPresent: true, refusalPresent: false },
    });
  });
});
