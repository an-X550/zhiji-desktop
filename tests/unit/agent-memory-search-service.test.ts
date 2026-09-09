import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AgentMemorySearchService } from '../../src/main-process/agent/agent-memory-search-service';
import { MarkdownJournalRepository } from '../../src/main-process/infrastructure/markdown/journal-repository';
import { agentEvidenceDemo } from '../fixtures/agent-evidence-demo';

type SearchInput = { query: string; limit?: number; alternates?: string[] };

function searchWithAlternates(service: AgentMemorySearchService, input: SearchInput) {
  return service.search(input);
}

function makeService() {
  const journals = {
    list: vi.fn(async () => [{
      schemaVersion: 1 as const,
      id: 'journal_a1',
      date: '2026-08-20',
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
      projectIds: [],
      body: '今天验证了把行动拆成更小步骤，结果更容易完成。',
    }]),
  };
  const reviews = {
    list: vi.fn(async () => [{
      schemaVersion: 1 as const,
      id: 'review_a1',
      type: 'weekly' as const,
      periodStart: '2026-08-17',
      periodEnd: '2026-08-23',
      sourceIds: ['journal_a1'],
      projectId: null,
      provider: 'openai-compatible' as const,
      model: 'test',
      promptVersion: 'periodic-review-v1',
      createdAt: '2026-08-23T00:00:00.000Z',
      body: '本周项目方向更清晰，下一步继续验证行动拆解。',
    }]),
  };
  const verifiedPatterns = {
    list: vi.fn(async () => ({
      schemaVersion: 1 as const,
      updatedAt: '2026-08-23T00:00:00.000Z',
      patterns: [{
        schemaVersion: 1 as const,
        id: 'pattern_a1',
        statement: '拆小行动有助于持续执行。',
        evidenceSummary: '来自多个周期复盘的已确认证据。',
        sourceReviewIds: ['review_a1'],
        createdAt: '2026-08-23T00:00:00.000Z',
      }],
    })),
  };
  return { service: new AgentMemorySearchService(journals, reviews, verifiedPatterns), journals, reviews, verifiedPatterns };
}

function makeRankingService(bodies: Array<{ id: string; date: string; body: string }>) {
  return new AgentMemorySearchService(
    { list: vi.fn(async () => bodies.map((item) => ({ schemaVersion: 1 as const, ...item, createdAt: `${item.date}T00:00:00.000Z`, updatedAt: `${item.date}T00:00:00.000Z`, projectIds: [] }))) },
    { list: vi.fn(async () => []) },
    { list: vi.fn(async () => ({ schemaVersion: 1 as const, updatedAt: '2026-08-23T00:00:00.000Z', patterns: [] })) },
  );
}

function makeDemoService() {
  return new AgentMemorySearchService(
    { list: vi.fn(async () => agentEvidenceDemo.journals) },
    { list: vi.fn(async () => agentEvidenceDemo.reviews) },
    { list: vi.fn(async () => agentEvidenceDemo.patterns) },
  );
}

describe('AgentMemorySearchService', () => {
  it('recalls matching journals, reviews and verified patterns from one read-only search', async () => {
    const { service, journals, reviews, verifiedPatterns } = makeService();
    const result = await service.search({ query: '行动', limit: 8 });

    expect(result.hits.map((hit) => hit.id)).toEqual(expect.arrayContaining(['review_a1', 'journal_a1', 'pattern_a1']));
    expect(result.hits[0].excerpt).toContain('行动');
    expect(journals.list).toHaveBeenCalledOnce();
    expect(reviews.list).toHaveBeenCalledOnce();
    expect(verifiedPatterns.list).toHaveBeenCalledOnce();
  });

  it('returns stable date-descending results when scores tie and respects the limit', async () => {
    const service = makeRankingService([
      { id: 'journal_old', date: '2026-08-20', body: '行动记录。' },
      { id: 'journal_new', date: '2026-08-23', body: '行动记录。' },
    ]);
    const result = await service.search({ query: '行动', limit: 1 });

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].date).toBe('2026-08-23');
  });

  it('uses a stable ID after score and date are tied', async () => {
    const service = makeRankingService([
      { id: 'journal_b', date: '2026-08-20', body: '行动记录。' },
      { id: 'journal_a', date: '2026-08-20', body: '行动记录。' },
    ]);

    const result = await service.search({ query: '行动', limit: 2 });

    expect(result.hits.map((hit) => hit.id)).toEqual(['journal_a', 'journal_b']);
  });

  it('recalls a natural Chinese compound query instead of treating the whole sentence as one term', async () => {
    const { service } = makeService();
    const result = await service.search({ query: '我以前是不是经常把行动拆成更小步骤？' });

    expect(result.hits.map((hit) => hit.id)).toContain('journal_a1');
    expect(result.hits.find((hit) => hit.id === 'journal_a1')?.excerpt).toContain('行动拆成更小步骤');
  });

  it('uses a bounded alternate query for a limited vocabulary difference', async () => {
    const { service } = makeService();
    const result = await searchWithAlternates(service, { query: '任务定得太大', alternates: ['行动 拆解 步骤'] });

    expect(result.hits.map((hit) => hit.id)).toContain('journal_a1');
    expect(result.hits.find((hit) => hit.id === 'journal_a1')?.excerpt).toContain('行动拆成更小步骤');
    expect(result.hits.find((hit) => hit.id === 'journal_a1')?.excerpt).not.toContain('行动 拆解 步骤');
  });

  it('does not invent a semantic match when no alternate query is supplied', async () => {
    const { service } = makeService();

    await expect(service.search({ query: '任务定得太大' })).resolves.toEqual({ hits: [] });
  });

  it('does not return a broad set of unrelated records for generic question words', async () => {
    const { service } = makeService();

    const result = await service.search({ query: '以前是不是经常' });

    expect(result.hits).toEqual([]);
  });

  it('returns no result for a phrase absent from the local sources', async () => {
    const { service } = makeService();

    await expect(service.search({ query: '完全不存在的内容' })).resolves.toEqual({ hits: [] });
  });

  it('returns a dated fact from the independent public demo fixture', async () => {
    const result = await makeDemoService().search({ query: '证据卡片验收' });

    expect(result.hits[0]).toMatchObject({ id: 'journal_fact_20260818', kind: 'journal', date: '2026-08-18' });
    expect(result.hits[0].excerpt).toContain('已完成证据卡片验收');
  });

  it('returns related evidence from more than one date for a pattern query', async () => {
    const result = await makeDemoService().search({ query: '小步骤' });
    const dates = new Set(result.hits.filter((hit) => hit.kind === 'journal').map((hit) => hit.date));

    expect(dates).toEqual(new Set(['2026-08-19', '2026-08-21']));
  });

  it('keeps journal and review evidence visible when the sources conflict', async () => {
    const result = await makeDemoService().search({ query: '接口完成' });

    expect(result.hits.map((hit) => hit.id)).toEqual(expect.arrayContaining(['journal_conflict_20260822', 'review_conflict_20260822']));
    expect(result.hits.find((hit) => hit.id === 'journal_conflict_20260822')?.excerpt).toContain('已经完成');
    expect(result.hits.find((hit) => hit.id === 'review_conflict_20260822')?.excerpt).toContain('尚未完成');
  });

  it('returns an empty result for an absent demo query', async () => {
    await expect(makeDemoService().search({ query: '火星探测器' })).resolves.toEqual({ hits: [] });
  });

  it('reuses an unchanged parsed file and does not rebuild all records', async () => {
    const journal = { schemaVersion: 1 as const, id: 'journal_cached', date: '2026-08-20', createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z', projectIds: [], body: '缓存命中内容' };
    const metadata = { size: 10, mtimeMs: 1, ctimeMs: 1 };
    const searchEntries = vi.fn()
      .mockResolvedValueOnce([{ key: 'journals/2026/cached.md', metadata, value: journal }])
      .mockResolvedValueOnce([{ key: 'journals/2026/cached.md', metadata }]);
    const service = new AgentMemorySearchService(
      { list: vi.fn(async () => [journal]), searchEntries },
      { list: vi.fn(async () => []) },
      { list: vi.fn(async () => ({ schemaVersion: 1 as const, updatedAt: '2026-08-23T00:00:00.000Z', patterns: [] })) },
    );

    await expect(service.search({ query: '缓存' })).resolves.toMatchObject({ hits: [{ id: 'journal_cached' }] });
    await expect(service.search({ query: '缓存' })).resolves.toMatchObject({ hits: [{ id: 'journal_cached' }] });
    expect(searchEntries).toHaveBeenCalledTimes(2);
    expect(searchEntries.mock.calls[1][0]).toEqual(new Map([['journals/2026/cached.md', metadata]]));
  });

  it('replaces changed files, removes deleted files and coalesces concurrent builds', async () => {
    const first = { schemaVersion: 1 as const, id: 'journal_incremental', date: '2026-08-20', createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z', projectIds: [], body: '旧内容' };
    const second = { ...first, body: '新内容' };
    let phase = 0;
    const searchEntries = vi.fn(async () => phase === 0
      ? [{ key: 'journals/2026/incremental.md', metadata: { size: 1, mtimeMs: 1, ctimeMs: 1 }, value: first }]
      : phase === 1
        ? [{ key: 'journals/2026/incremental.md', metadata: { size: 2, mtimeMs: 2, ctimeMs: 2 }, value: second }]
        : []);
    const listPatterns = vi.fn(async () => ({ schemaVersion: 1 as const, updatedAt: '2026-08-23T00:00:00.000Z', patterns: [] }));
    const service = new AgentMemorySearchService({ list: vi.fn(async () => [first]), searchEntries }, { list: vi.fn(async () => []) }, { list: listPatterns });

    const concurrent = await Promise.all([service.search({ query: '旧内容' }), service.search({ query: '旧内容' })]);
    expect(concurrent[0]).toEqual(concurrent[1]);
    expect(searchEntries).toHaveBeenCalledOnce();
    phase = 1;
    await expect(service.search({ query: '新内容' })).resolves.toMatchObject({ hits: [{ id: 'journal_incremental' }] });
    phase = 2;
    await expect(service.search({ query: '新内容' })).resolves.toEqual({ hits: [] });
  });

  it.each([
    ['journal source', () => [{ schemaVersion: 1 as const, id: 'journal_duplicate', date: '2026-08-20', createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z', projectIds: [], body: '第一份' }, { schemaVersion: 1 as const, id: 'journal_duplicate', date: '2026-08-21', createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z', projectIds: [], body: '第二份' }]],
    ['review source', () => [
      { schemaVersion: 1 as const, id: 'review_duplicate', type: 'weekly' as const, periodStart: '2026-08-17', periodEnd: '2026-08-23', sourceIds: ['journal_a1'], projectId: null, provider: 'openai-compatible' as const, model: 'test', promptVersion: 'weekly-v1', createdAt: '2026-08-23T00:00:00.000Z', body: '第一份' },
      { schemaVersion: 1 as const, id: 'review_duplicate', type: 'monthly' as const, periodStart: '2026-08-01', periodEnd: '2026-08-31', sourceIds: ['journal_a1'], projectId: null, provider: 'openai-compatible' as const, model: 'test', promptVersion: 'monthly-v1', createdAt: '2026-08-31T00:00:00.000Z', body: '第二份' },
    ]],
    ['pattern source', () => ({ schemaVersion: 1 as const, updatedAt: '2026-08-23T00:00:00.000Z', patterns: [
      { schemaVersion: 1 as const, id: 'pattern_duplicate', statement: '第一份', evidenceSummary: '证据一', sourceReviewIds: ['review_a1'], createdAt: '2026-08-23T00:00:00.000Z' },
      { schemaVersion: 1 as const, id: 'pattern_duplicate', statement: '第二份', evidenceSummary: '证据二', sourceReviewIds: ['review_a1'], createdAt: '2026-08-23T00:00:00.000Z' },
      ] })],
  ])('rejects duplicate ids from the %s', async (_source, makeDuplicate) => {
    const duplicate = makeDuplicate();
    const journals = { list: vi.fn(async () => Array.isArray(duplicate) && 'projectIds' in duplicate[0] ? duplicate as never[] : []) };
    const reviews = { list: vi.fn(async () => Array.isArray(duplicate) && 'type' in duplicate[0] ? duplicate as never[] : []) };
    const patterns = { list: vi.fn(async () => !Array.isArray(duplicate) ? duplicate as never : ({ schemaVersion: 1 as const, updatedAt: '2026-08-23T00:00:00.000Z', patterns: [] })) };
    const service = new AgentMemorySearchService(journals, reviews, patterns);

    await expect(service.search({ query: '第一份' })).rejects.toMatchObject({ code: 'FILE_CONFLICT', path: expect.stringContaining('duplicate') });
  });

  it('rejects an id collision across journal, review and pattern sources before mutating the index', async () => {
    const journal = { schemaVersion: 1 as const, id: 'shared_memory_id', date: '2026-08-20', createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z', projectIds: [], body: '日志内容' };
    const review = { schemaVersion: 1 as const, id: 'shared_memory_id', type: 'weekly' as const, periodStart: '2026-08-17', periodEnd: '2026-08-23', sourceIds: ['journal_a1'], projectId: null, provider: 'openai-compatible' as const, model: 'test', promptVersion: 'weekly-v1', createdAt: '2026-08-23T00:00:00.000Z', body: '复盘内容' };
    const service = new AgentMemorySearchService(
      { list: vi.fn(async () => [journal]) },
      { list: vi.fn(async () => [review]) },
      { list: vi.fn(async () => ({ schemaVersion: 1 as const, updatedAt: '2026-08-23T00:00:00.000Z', patterns: [] })) },
    );

    await expect(service.search({ query: '内容' })).rejects.toMatchObject({ code: 'FILE_CONFLICT' });
  });

  it('does not leak records between services backed by different data roots', async () => {
    const makeRootService = (id: string, body: string) => new AgentMemorySearchService(
      { list: vi.fn(async () => [{ schemaVersion: 1 as const, id, date: '2026-08-20', createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z', projectIds: [], body }]) },
      { list: vi.fn(async () => []) },
      { list: vi.fn(async () => ({ schemaVersion: 1 as const, updatedAt: '2026-08-23T00:00:00.000Z', patterns: [] })) },
    );
    const first = await makeRootService('journal_root_one', '只属于第一个数据根').search({ query: '第一个' });
    const second = await makeRootService('journal_root_two', '只属于第二个数据根').search({ query: '第一个' });

    expect(first.hits.map((hit) => hit.id)).toEqual(['journal_root_one']);
    expect(second.hits).toEqual([]);
  });

  it('rebuilds from disk after explicit invalidation even when file metadata is unchanged', async () => {
    let body = '第一次内容';
    const metadata = { size: 10, mtimeMs: 1, ctimeMs: 1 };
    const searchEntries = vi.fn(async (previous: ReadonlyMap<string, typeof metadata>) => [{
      key: 'journals/2026/rebuild.md',
      metadata,
      ...(previous.has('journals/2026/rebuild.md') ? { value: undefined } : { value: { schemaVersion: 1 as const, id: 'journal_rebuild', date: '2026-08-20', createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z', projectIds: [], body } }),
    }]);
    const service = new AgentMemorySearchService(
      { list: vi.fn(async () => []) , searchEntries },
      { list: vi.fn(async () => []) },
      { list: vi.fn(async () => ({ schemaVersion: 1 as const, updatedAt: '2026-08-23T00:00:00.000Z', patterns: [] })) },
    );

    await expect(service.search({ query: '第一次' })).resolves.toMatchObject({ hits: [{ id: 'journal_rebuild' }] });
    body = '第二次内容';
    service.rebuild();
    await expect(service.search({ query: '第二次' })).resolves.toMatchObject({ hits: [{ id: 'journal_rebuild' }] });
  });

  it('surfaces a corrupted journal file instead of indexing partial data', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'zhiji-memory-corrupt-'));
    try {
      await mkdir(path.join(root, 'journals', '2026'), { recursive: true });
      await writeFile(path.join(root, 'journals', '2026', 'corrupt.md'), 'not valid journal markdown', 'utf8');
      const service = new AgentMemorySearchService(
        new MarkdownJournalRepository(root),
        { list: vi.fn(async () => []) },
        { list: vi.fn(async () => ({ schemaVersion: 1 as const, updatedAt: '2026-08-23T00:00:00.000Z', patterns: [] })) },
      );

      await expect(service.search({ query: '内容' })).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
