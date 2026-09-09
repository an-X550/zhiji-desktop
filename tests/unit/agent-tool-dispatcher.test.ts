import { describe, expect, it, vi } from 'vitest';
import { AgentToolDispatcher } from '../../src/main-process/agent/agent-tool-dispatcher';

const sessionId = 'agent_tooltest';
const request = (action: string, input: object) => ({ type: 'tool.request' as const, requestId: crypto.randomUUID(), sessionId, action, input });

function makeDispatcher() {
  const journals = { list: vi.fn(async () => [{ schemaVersion: 1 as const, id: 'journal_a1', date: '2026-08-20', createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z', projectIds: ['project_a1'], body: '今天在 /private/journal 写下感受。' }]), get: vi.fn() };
  const reviews = { list: vi.fn(async () => [{ schemaVersion: 1 as const, id: 'review_a1', type: 'weekly' as const, periodStart: '2026-08-10', periodEnd: '2026-08-16', sourceIds: ['journal_a1'], projectId: null, provider: 'openai-compatible' as const, model: 'test', promptVersion: 'periodic-review-v1', createdAt: '2026-08-20T00:00:00.000Z', body: '本周收获明确。' }]), get: vi.fn() };
  const projects = { list: vi.fn(async () => [{ schemaVersion: 1 as const, id: 'project_a1', name: '桌面端', status: 'active' as const, createdAt: '2026-08-20T00:00:00.000Z', archivedAt: null }]) };
  const verifiedPatterns = { list: vi.fn(async () => ({ schemaVersion: 1 as const, updatedAt: '2026-08-20T00:00:00.000Z', patterns: [] })) };
  const memorySearch = { search: vi.fn(async () => ({ hits: [{ id: 'journal_a1', kind: 'journal' as const, date: '2026-08-20', excerpt: '长期记忆命中' }] })) };
  const webSearch = {
    search: vi.fn(async () => ({ searchSessionId: 'search_a1', results: [{ sourceId: 'source_a1', title: '可信来源', url: 'https://example.com/private', domain: 'example.com', snippet: '搜索摘要', publishedAt: null, retrievedAt: '2026-08-20T00:00:00.000Z' }] })),
    readSource: vi.fn(async (input: { searchSessionId: string; sourceId: string }) => {
      if (input.searchSessionId !== 'search_a1' || input.sourceId !== 'source_a1') throw Object.assign(new Error('bad source'), { code: 'INVALID_INPUT' });
      return { title: '可信来源', url: 'https://example.com/private', domain: 'example.com', publishedAt: null, retrievedAt: '2026-08-20T00:00:00.000Z', excerpt: '来源正文' };
    }),
  };
  const createJournal = { execute: vi.fn(async (input: { date: string; body: string; projectIds: string[] }) => ({ schemaVersion: 1 as const, id: 'journal_created', date: input.date, createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z', projectIds: input.projectIds, body: input.body })) };
  const updateJournal = { execute: vi.fn(async (input: { id: string; date: string; body: string; projectIds: string[]; expectedUpdatedAt: string }) => ({ schemaVersion: 1 as const, id: input.id, date: input.date, createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z', projectIds: input.projectIds, body: input.body })) };
  const generateDailyReview = { execute: vi.fn() };
  const generatePeriodicReview = { preview: vi.fn(), execute: vi.fn() };
  const generateInsightReview = { preview: vi.fn(), execute: vi.fn() };
  const configureAi = { getPublicConfig: vi.fn(async () => ({ providerId: 'custom' as const, baseUrl: 'https://example.test', model: 'test', agentThinking: 'disabled' as const, hasApiKey: true })) };
  return { dispatcher: new AgentToolDispatcher({ journals, reviews, projects, verifiedPatterns, memorySearch, webSearch, createJournal, updateJournal, generateDailyReview, generatePeriodicReview, generateInsightReview, configureAi }), journals, reviews, webSearch, memorySearch };
}

describe('AgentToolDispatcher', () => {
  it('combines two read-only domains and returns task-ready summaries without paths', async () => {
    const { dispatcher, journals, reviews } = makeDispatcher();
    const journalResult = await dispatcher.dispatch(request('journals.list', {}));
    const reviewResult = await dispatcher.dispatch(request('reviews.list', {}));

    expect(journals.list).toHaveBeenCalledOnce();
    expect(reviews.list).toHaveBeenCalledOnce();
    expect(journalResult).toEqual({ kind: 'journals.list', journals: [{ id: 'journal_a1', date: '2026-08-20', projectIds: ['project_a1'], updatedAt: '2026-08-20T00:00:00.000Z', excerpt: '内容包含受保护位置，已省略。' }] });
    expect(JSON.stringify(reviewResult)).not.toMatch(/[A-Za-z]:[\\/]|https?:\/\//);
  });

  it('rejects unknown input and arbitrary URL before any service call', async () => {
    const { dispatcher, webSearch } = makeDispatcher();
    const result = await dispatcher.dispatch({ ...request('web.read-source', { searchSessionId: 'search_a1', sourceId: 'source_a1', url: 'https://attacker.example' }) });

    expect(result).toEqual({ kind: 'error', code: 'INVALID_INPUT', message: '工具请求格式不合法，已拒绝执行。', retryable: false });
    expect(webSearch.readSource).not.toHaveBeenCalled();
  });

  it('keeps source reads bound to the search session and never exposes result URLs', async () => {
    const { dispatcher, webSearch } = makeDispatcher();
    const search = await dispatcher.dispatch(request('web.search', { query: '复盘方法' }));
    const rejected = await dispatcher.dispatch(request('web.read-source', { searchSessionId: 'search_other', sourceId: 'source_a1' }));
    const accepted = await dispatcher.dispatch(request('web.read-source', { searchSessionId: 'search_a1', sourceId: 'source_a1' }));

    expect(search).toEqual({ kind: 'web.search', searchSessionId: 'search_a1', results: [{ sourceId: 'source_a1', title: '可信来源', domain: 'example.com', snippet: '搜索摘要', publishedAt: null, retrievedAt: '2026-08-20T00:00:00.000Z' }] });
    expect(rejected).toEqual({ kind: 'error', code: 'INVALID_INPUT', message: '工具输入不合法，已拒绝执行。', retryable: false });
    expect(accepted).toEqual({ kind: 'web.read-source', source: { title: '可信来源', domain: 'example.com', publishedAt: null, retrievedAt: '2026-08-20T00:00:00.000Z', excerpt: '来源正文' } });
    expect(JSON.stringify(accepted)).not.toContain('https://');
    expect(webSearch.readSource).toHaveBeenCalledTimes(2);
  });

  it('searches bounded local memory without exposing paths or URLs', async () => {
    const { dispatcher, memorySearch } = makeDispatcher();
    const result = await dispatcher.dispatch(request('memory.search', { query: '长期记忆', limit: 3 }));

    expect(memorySearch.search).toHaveBeenCalledWith({ query: '长期记忆', limit: 3 });
    expect(result).toEqual({ kind: 'memory.search', hits: [{ id: 'journal_a1', kind: 'journal', date: '2026-08-20', excerpt: '长期记忆命中' }] });
    expect(JSON.stringify(result)).not.toMatch(/[A-Za-z]:[\\/]|https?:\/\//);
  });

  it('accepts at most three bounded alternate memory queries and rejects invalid shapes', async () => {
    const { dispatcher, memorySearch } = makeDispatcher();
    const accepted = await dispatcher.dispatch(request('memory.search', { query: '任务定得太大', alternates: ['行动 拆解 步骤'], limit: 3 }));

    expect(accepted).toEqual({ kind: 'memory.search', hits: [{ id: 'journal_a1', kind: 'journal', date: '2026-08-20', excerpt: '长期记忆命中' }] });
    expect(memorySearch.search).toHaveBeenCalledWith({ query: '任务定得太大', alternates: ['行动 拆解 步骤'], limit: 3 });

    for (const input of [
      { query: '任务', alternates: ['', '行动'] },
      { query: '任务', alternates: ['一', '二', '三', '四'] },
      { query: '任务', alternates: ['x'.repeat(81)] },
      { query: '任务', unexpected: true },
    ]) {
      await expect(dispatcher.dispatch(request('memory.search', input))).resolves.toEqual({ kind: 'error', code: 'INVALID_INPUT', message: '工具请求格式不合法，已拒绝执行。', retryable: false });
    }
    expect(memorySearch.search).toHaveBeenCalledOnce();
  });

  it('allows navigation only to a valid existing product target', async () => {
    const { dispatcher } = makeDispatcher();
    const valid = await dispatcher.dispatch(request('ui.navigate', { target: { view: 'reviews', intent: 'project', projectId: 'project_a1' } }));
    const missing = await dispatcher.dispatch(request('ui.navigate', { target: { view: 'reviews', intent: 'project', projectId: 'project_missing' } }));

    expect(valid).toEqual({ kind: 'ui.navigate', target: { view: 'reviews', intent: 'project', projectId: 'project_a1' } });
    expect(missing).toEqual({ kind: 'error', code: 'UNKNOWN', message: '知己工具暂时无法完成请求，请稍后重试。', retryable: false });
  });

  it('routes journal writes and daily feedback through the existing application services', async () => {
    const { dispatcher } = makeDispatcher();
    const created = await dispatcher.dispatch(request('journals.create', { date: '2026-08-20', body: '记录一件已完成的事。', projectIds: ['project_a1'] }));
    expect(created).toMatchObject({ kind: 'workflow.completed', workflow: 'journals.create', journal: { id: 'journal_created' }, navigation: { view: 'journal', intent: 'records' } });
    const daily = (dispatcher as unknown as { deps: { generateDailyReview: { execute: ReturnType<typeof vi.fn> } } }).deps.generateDailyReview;
    daily.execute.mockResolvedValue({ kind: 'review', review: { schemaVersion: 2, id: 'review_daily1', type: 'daily', periodStart: '2026-08-20', periodEnd: '2026-08-20', sourceIds: ['journal_created'], sourceVersions: { journal_created: 'v1' }, projectId: null, provider: 'openai-compatible', model: 'test', promptVersion: 'daily-review-v3', createdAt: '2026-08-20T00:00:00.000Z', body: '今日反馈' } });
    const feedback = await dispatcher.dispatch(request('reviews.generate-daily', { date: '2026-08-20', journalId: 'journal_a1' }));
    expect(feedback).toMatchObject({ kind: 'workflow.completed', workflow: 'reviews.generate-daily', review: { id: 'review_daily1' }, navigation: { view: 'journal', intent: 'records' } });
    expect(daily.execute).toHaveBeenCalledWith({ date: '2026-08-20', journalId: 'journal_a1', model: 'test' }, undefined);
  });

  it('requires a Main Process approval before a periodic review can be written', async () => {
    const { dispatcher } = makeDispatcher();
    const periodic = (dispatcher as unknown as { deps: { generatePeriodicReview: { preview: ReturnType<typeof vi.fn>; execute: ReturnType<typeof vi.fn> } } }).deps.generatePeriodicReview;
    periodic.preview.mockResolvedValue({ token: '00000000-0000-4000-8000-000000000001', type: 'weekly', start: '2026-08-17', end: '2026-08-20', sources: [{ id: 'journal_a1', date: '2026-08-20', excerpt: '本周记录' }] });
    periodic.execute.mockResolvedValue({ kind: 'review', review: { schemaVersion: 1, id: 'review_new1', type: 'weekly', periodStart: '2026-08-17', periodEnd: '2026-08-20', sourceIds: ['journal_a1'], projectId: null, provider: 'openai-compatible', model: 'test', promptVersion: 'periodic-review-v1', createdAt: '2026-08-20T00:00:00.000Z', body: '正式周复盘' } });
    const preview = await dispatcher.dispatch(request('reviews.preview-periodic', { type: 'weekly', start: '2026-08-17', end: '2026-08-20' }));
    expect(preview.kind).toBe('workflow.approval-required');
    if (preview.kind !== 'workflow.approval-required') return;
    const before = await dispatcher.dispatch(request('reviews.generate-periodic', { type: 'weekly', start: '2026-08-17', end: '2026-08-20', previewToken: preview.approval.preview.token, approvalId: preview.approval.approvalId }));
    expect(before).toEqual({ kind: 'error', code: 'INVALID_INPUT', message: '请先在知己 Agent 页面确认预览材料，再生成正式内容。', retryable: false });
    expect(dispatcher.approve(sessionId, preview.approval.approvalId)).toBe(true);
    const generated = await dispatcher.dispatch(request('reviews.generate-periodic', { type: 'weekly', start: '2026-08-17', end: '2026-08-20', previewToken: preview.approval.preview.token, approvalId: preview.approval.approvalId }));
    expect(generated).toMatchObject({ kind: 'workflow.completed', workflow: 'reviews.generate-periodic', review: { id: 'review_new1' }, navigation: { view: 'reviews', intent: 'weekly' } });
    expect(periodic.execute).toHaveBeenCalledOnce();
    expect(dispatcher.approve(sessionId, preview.approval.approvalId)).toBe(false);
  });

  it('uses the same approval boundary for insight reviews', async () => {
    const { dispatcher } = makeDispatcher();
    const insight = (dispatcher as unknown as { deps: { generateInsightReview: { preview: ReturnType<typeof vi.fn>; execute: ReturnType<typeof vi.fn> } } }).deps.generateInsightReview;
    insight.preview.mockResolvedValue({ token: '00000000-0000-4000-8000-000000000002', type: 'coach', start: '2026-08-01', end: '2026-08-20', sources: [{ id: 'journal_a1', date: '2026-08-20', excerpt: '记录' }] });
    insight.execute.mockResolvedValue({ schemaVersion: 1, id: 'review_coach1', type: 'coach', periodStart: '2026-08-01', periodEnd: '2026-08-20', sourceIds: ['journal_a1'], projectId: null, provider: 'openai-compatible', model: 'test', promptVersion: 'journal-coach-v3', createdAt: '2026-08-20T00:00:00.000Z', body: '洞察结果' });
    const preview = await dispatcher.dispatch(request('reviews.preview-insight', { type: 'coach', start: '2026-08-01', end: '2026-08-20' }));
    expect(preview.kind).toBe('workflow.approval-required');
    if (preview.kind !== 'workflow.approval-required') return;
    expect(dispatcher.approve(sessionId, preview.approval.approvalId)).toBe(true);
    const result = await dispatcher.dispatch(request('reviews.generate-insight', { type: 'coach', start: '2026-08-01', end: '2026-08-20', previewToken: preview.approval.preview.token, approvalId: preview.approval.approvalId }));
    expect(result).toMatchObject({ kind: 'workflow.completed', workflow: 'reviews.generate-insight', review: { id: 'review_coach1' }, navigation: { view: 'reviews', intent: 'coach' } });
  });
});
