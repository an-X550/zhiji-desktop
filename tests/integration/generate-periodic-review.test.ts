import { describe, expect, it, vi } from 'vitest';
import { GeneratePeriodicReview } from '../../src/main-process/application/generate-periodic-review';
import type { Journal } from '../../src/shared/schemas/domain';

const journal: Journal = { schemaVersion: 1, id: 'journal_a1', date: '2026-08-13', createdAt: '2026-08-13T08:00:00.000Z', updatedAt: '2026-08-13T08:00:00.000Z', projectIds: ['project_a1'], body: '证据' };

const validModelOutput = JSON.stringify({
  chatSummary: '完成了功能开发',
  goalReview: '目标是交付项目功能',
  resultEvaluation: '目标达成',
  causesPositive: '上午专注有效',
  causesNegative: '晚间加班效果递减',
  ifRedone: '会更早开始测试',
  nextPlan: { goal: '补齐测试', means: '先写失败测试', check: '下次复盘核对' },
  directionAnchors: [{ name: '求职', status: '证据不足', note: '本期材料未提及行动' }],
  qualitySelfCheck: '质量门已通过；无影响本次判断的已知缺口。',
});

describe('GeneratePeriodicReview', () => {
  it('injects an enabled profile as separate context', async () => {
    let sent = '';
    const profiles = { get: async () => ({ body: '长期目标是做有价值的产品', enabledForAi: true }) } as never;
    const service = new GeneratePeriodicReview(
      { list: async () => [journal] } as never,
      { list: async () => [], save: async (review: unknown) => review } as never,
      { collect: async (messages: { content: string }[]) => { sent = messages.at(-1)?.content ?? ''; return validModelOutput; } } as never,
      { start: () => ({ taskId: 'x', controller: new AbortController(), phase: 'queued' }), transition: () => undefined } as never,
      () => '2026-08-13T10:00:00.000Z',
      profiles,
    );
    const input = { type: 'project' as const, start: '2026-08-01', end: '2026-08-31', projectId: 'project_a1', model: 'fake' };
    const preview = await service.preview(input);
    const result = await service.execute({ ...input, previewToken: preview.token });
    expect(result.kind).toBe('review');
    expect(JSON.parse(sent)).toMatchObject({ profile: '长期目标是做有价值的产品' });
  });

  it('requires a fresh preview token and limits the model to confirmed sources', async () => {
    const service = new GeneratePeriodicReview(
      { list: async () => [journal] } as never,
      { list: async () => [], save: async (review: unknown) => review } as never,
      { collect: async () => validModelOutput } as never,
      { start: () => ({ taskId: 'x', controller: new AbortController(), phase: 'queued' }), transition: () => undefined } as never,
      () => '2026-08-13T10:00:00.000Z',
    );
    const input = { type: 'project' as const, start: '2026-08-01', end: '2026-08-31', projectId: 'project_a1', model: 'fake' };
    await expect(service.execute({ ...input, previewToken: 'missing' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const preview = await service.preview(input);
    const result = await service.execute({ ...input, previewToken: preview.token });
    expect(result.kind).toBe('review');
    if (result.kind === 'review') {
      expect(result.review.sourceIds).toEqual(['journal_a1']);
    }
  });

  it('returns a clarification instead of saving when evidence is D-grade', async () => {
    const collect = vi.fn();
    const service = new GeneratePeriodicReview(
      { list: async () => [] } as never,
      { list: async () => [], save: async () => undefined } as never,
      { collect } as never,
      { start: () => ({ taskId: 'x', controller: new AbortController(), phase: 'queued' }), transition: () => undefined } as never,
      () => '2026-08-13T10:00:00.000Z',
    );
    const input = { type: 'project' as const, start: '2026-08-01', end: '2026-08-31', projectId: 'project_a1', model: 'fake' };
    await expect(service.preview(input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(collect).not.toHaveBeenCalled();
  });

  it('expires preview tokens after the TTL window', async () => {
    let current = '2026-08-13T10:00:00.000Z';
    const service = new GeneratePeriodicReview(
      { list: async () => [journal] } as never,
      { list: async () => [], save: async (review: unknown) => review } as never,
      { collect: async () => validModelOutput } as never,
      { start: () => ({ taskId: 'x', controller: new AbortController(), phase: 'queued' }), transition: () => undefined } as never,
      () => current,
    );
    const input = { type: 'project' as const, start: '2026-08-01', end: '2026-08-31', projectId: 'project_a1', model: 'fake' };
    const preview = await service.preview(input);
    current = '2026-08-13T10:31:00.000Z';
    await expect(service.execute({ ...input, previewToken: preview.token })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('propagates Agent cancellation before saving a formal review', async () => {
    const save = vi.fn();
    const provider = { collect: vi.fn((_messages: unknown, signal?: AbortSignal) => new Promise<string>((_resolve, reject) => { const abort = () => reject(Object.assign(new Error('aborted'), { code: 'CANCELLED' })); if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true }); })) };
    const service = new GeneratePeriodicReview(
      { list: async () => [journal] } as never,
      { list: async () => [], save } as never,
      provider as never,
      { start: () => ({ taskId: 'x', controller: new AbortController(), phase: 'queued' }), transition: () => undefined } as never,
      () => '2026-08-13T10:00:00.000Z',
    );
    const input = { type: 'project' as const, start: '2026-08-01', end: '2026-08-31', projectId: 'project_a1', model: 'fake' };
    const preview = await service.preview(input);
    const controller = new AbortController();
    const pending = service.execute({ ...input, previewToken: preview.token }, controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(save).not.toHaveBeenCalled();
  });

  it('returns safe structured diagnostics without consuming the preview, then allows a confirmed retry', async () => {
    const save = vi.fn(async (review: unknown) => review);
    const collectStructured = vi.fn()
      .mockResolvedValueOnce({ content: '', finishReason: 'length' })
      .mockResolvedValueOnce({ content: '', finishReason: 'stop' })
      .mockResolvedValueOnce({ content: validModelOutput, finishReason: 'stop' });
    const service = new GeneratePeriodicReview(
      { list: async () => [journal] } as never,
      { list: async () => [], save } as never,
      { collect: vi.fn(), collectStructured } as never,
      { start: () => ({ taskId: 'x', controller: new AbortController(), phase: 'queued' }), transition: () => undefined } as never,
      () => '2026-08-13T10:00:00.000Z',
    );
    const input = { type: 'project' as const, start: '2026-08-01', end: '2026-08-31', projectId: 'project_a1', model: 'fake' };
    const preview = await service.preview(input);
    const failed = await service.execute({ ...input, previewToken: preview.token });
    expect(failed).toMatchObject({ kind: 'error', diagnostics: { kind: 'empty_content', finishReason: 'stop', outputLength: 0, retryOf: 'truncated', maxTokens: 3600 } });
    expect(save).not.toHaveBeenCalled();
    const retried = await service.execute({ ...input, previewToken: preview.token });
    expect(retried.kind).toBe('review');
    expect(save).toHaveBeenCalledOnce();
  });
});
