import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownJournalRepository, recoverJournalResidues } from '../../src/main-process/infrastructure/markdown/journal-repository';
import { MarkdownReviewRepository } from '../../src/main-process/infrastructure/markdown/review-repository';

describe('MarkdownJournalRepository', () => {
  it('creates two same-day journals without overwriting either entry', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zhiji-journal-'));
    const repository = new MarkdownJournalRepository(root);
    const base = { schemaVersion: 1 as const, id: 'journal_a1', date: '2026-08-13', createdAt: '2026-08-13T08:00:00.000Z', updatedAt: '2026-08-13T08:00:00.000Z', projectIds: [] };
    await repository.create({ ...base, body: '第一条' });
    await repository.create({ ...base, id: 'journal_b2', body: '第二条' });

    await expect(repository.list()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'journal_a1', body: '第一条' }),
      expect.objectContaining({ id: 'journal_b2', body: '第二条' }),
    ]));
    await expect(readFile(path.join(root, 'journals/2026/2026-08-13--journal_a1.md'), 'utf8')).resolves.toContain('第一条');
    await expect(readFile(path.join(root, 'journals/2026/2026-08-13--journal_b2.md'), 'utf8')).resolves.toContain('第二条');
  });

  it('rejects malformed journal ids with a Chinese message', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zhiji-journal-'));
    const repository = new MarkdownJournalRepository(root);
    await expect(repository.get('../escape')).rejects.toMatchObject({ code: 'INVALID_INPUT', message: '日志 id 不合法。' });
  });

  it('updates only the requested journal and rejects stale edits', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zhiji-journal-'));
    const repository = new MarkdownJournalRepository(root);
    const first = { schemaVersion: 1 as const, id: 'journal_a1', date: '2026-08-13', createdAt: '2026-08-13T08:00:00.000Z', updatedAt: '2026-08-13T08:00:00.000Z', projectIds: [], body: '第一条' };
    const second = { ...first, id: 'journal_b2', body: '第二条' };
    await repository.create(first);
    await repository.create(second);

    await repository.update({ ...first, body: '第一条已编辑', updatedAt: '2026-08-13T09:00:00.000Z' }, first.updatedAt);

    await expect(repository.get(first.id)).resolves.toMatchObject({ body: '第一条已编辑' });
    await expect(repository.get(second.id)).resolves.toMatchObject({ body: '第二条' });
    await expect(repository.update({ ...first, body: '过期修改', updatedAt: '2026-08-13T10:00:00.000Z' }, first.updatedAt)).rejects.toMatchObject({ code: 'FILE_CONFLICT' });
  });

  it('serializes concurrent updates so only one matching version succeeds', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zhiji-journal-'));
    const repository = new MarkdownJournalRepository(root);
    const journal = { schemaVersion: 1 as const, id: 'journal_a1', date: '2026-08-13', createdAt: '2026-08-13T08:00:00.000Z', updatedAt: '2026-08-13T08:00:00.000Z', projectIds: [], body: '原文' };
    await repository.create(journal);
    const results = await Promise.allSettled([
      repository.update({ ...journal, body: '版本一', updatedAt: '2026-08-13T09:00:00.000Z' }, journal.updatedAt),
      repository.update({ ...journal, body: '版本二', updatedAt: '2026-08-13T09:01:00.000Z' }, journal.updatedAt),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('does not resurrect a journal when delete is queued with an update', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zhiji-journal-'));
    try {
      const journal = { schemaVersion: 1 as const, id: 'journal_deleterace', date: '2026-08-13', createdAt: '2026-08-13T08:00:00.000Z', updatedAt: '2026-08-13T08:00:00.000Z', projectIds: [], body: '原文' };
      const repository = new MarkdownJournalRepository(root, async (target) => rm(target));
      await repository.create(journal);

      const deleting = repository.delete(journal.id);
      const updating = repository.update({ ...journal, body: '不应复活', updatedAt: '2026-08-13T09:00:00.000Z' }, journal.updatedAt);
      const results = await Promise.allSettled([deleting, updating]);

      expect(results[0].status).toBe('fulfilled');
      expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'NOT_FOUND' } });
      await expect(repository.list()).resolves.toEqual([]);
      await expect(readFile(path.join(root, 'journals/2026/2026-08-13--journal_deleterace.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('reads legacy date files beside new id-addressed files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zhiji-journal-'));
    const repository = new MarkdownJournalRepository(root);
    const yearRoot = path.join(root, 'journals/2026');
    await mkdir(yearRoot, { recursive: true });
    await writeFile(path.join(yearRoot, '2026-08-12.md'), `---\nschema_version: 1\nid: journal_legacy\ndate: '2026-08-12'\ncreated_at: '2026-08-12T08:00:00.000Z'\nupdated_at: '2026-08-12T08:00:00.000Z'\nproject_ids: []\n---\n旧日志\n`, 'utf8');
    await repository.create({ schemaVersion: 1, id: 'journal_new', date: '2026-08-12', createdAt: '2026-08-12T09:00:00.000Z', updatedAt: '2026-08-12T09:00:00.000Z', projectIds: [], body: '新日志' });

    await expect(repository.list()).resolves.toHaveLength(2);
    await expect(repository.get('journal_legacy')).resolves.toMatchObject({ body: '旧日志' });
  });
  it('round trips a journal through readable Markdown', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zhiji-journal-'));
    const repository = new MarkdownJournalRepository(root);
    const journal = {
      schemaVersion: 1 as const,
      id: 'journal_a1',
      date: '2026-08-13',
      createdAt: '2026-08-13T10:00:00+08:00',
      updatedAt: '2026-08-13T10:00:00+08:00',
      projectIds: ['project_a1'],
      body: '今天完成了第一步。',
    };

    await repository.create(journal);
    await expect(repository.get(journal.id)).resolves.toEqual(journal);
    const markdown = await readFile(path.join(root, 'journals/2026/2026-08-13--journal_a1.md'), 'utf8');
    expect(markdown).toContain('id: journal_a1');
    expect(markdown).toContain('今天完成了第一步。');
  });

  it('rejects ids that can escape the data root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zhiji-journal-'));
    const repository = new MarkdownJournalRepository(root);
    await expect(repository.get('../outside')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('moves only the selected journal file to the operating system trash', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zhiji-journal-'));
    const trashItem = vi.fn(async () => undefined);
    const repository = new MarkdownJournalRepository(root, trashItem);
    const journal = { schemaVersion: 1 as const, id: 'journal_a1', date: '2026-08-13', createdAt: '2026-08-13T08:00:00.000Z', updatedAt: '2026-08-13T08:00:00.000Z', projectIds: [], body: '待删除日志' };
    await repository.create(journal);
    await repository.delete(journal.id);
    expect(trashItem).toHaveBeenCalledWith(path.join(root, 'journals/2026/2026-08-13--journal_a1.md'));
  });

  it('keeps the existing file path when the business date changes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zhiji-journal-'));
    const repository = new MarkdownJournalRepository(root);
    const journal = { schemaVersion: 1 as const, id: 'journal_date', date: '2026-08-13', createdAt: '2026-08-13T08:00:00.000Z', updatedAt: '2026-08-13T08:00:00.000Z', projectIds: [], body: '原日期' };
    await repository.create(journal);
    await repository.update({ ...journal, date: '2027-01-02', body: '改日期', updatedAt: '2026-08-13T09:00:00.000Z' }, journal.updatedAt);
    await expect(readFile(path.join(root, 'journals/2026/2026-08-13--journal_date.md'), 'utf8')).resolves.toContain("date: '2027-01-02'");
    await expect(repository.list()).resolves.toEqual([expect.objectContaining({ id: journal.id, date: '2027-01-02', body: '改日期' })]);
  });

  it('recovers one valid legacy residue but preserves conflicts and ambiguity', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zhiji-journal-recovery-'));
    const yearRoot = path.join(root, 'journals/2026');
    await mkdir(yearRoot, { recursive: true });
    const content = `---\nschema_version: 1\nid: journal_recover\ndate: '2026-08-13'\ncreated_at: '2026-08-13T08:00:00.000Z'\nupdated_at: '2026-08-13T08:00:00.000Z'\nproject_ids: []\n---\n恢复\n`;
    await writeFile(path.join(yearRoot, '2026-08-13--journal_recover.md.moving'), content, 'utf8');
    await writeFile(path.join(yearRoot, '2026-08-14--journal_conflict.md'), content.replace('journal_recover', 'journal_conflict'), 'utf8');
    await writeFile(path.join(yearRoot, '2026-08-14--journal_conflict.md.11111111-1111-1111-1111-111111111111.bak'), content.replace('journal_recover', 'journal_conflict'), 'utf8');
    await writeFile(path.join(yearRoot, '2026-08-15--journal_ambiguous.md.11111111-1111-1111-1111-111111111111.bak'), content.replace('journal_recover', 'journal_ambiguous'), 'utf8');
    await writeFile(path.join(yearRoot, '2026-08-15--journal_ambiguous.md.22222222-2222-2222-2222-222222222222.bak'), content.replace('journal_recover', 'journal_ambiguous'), 'utf8');

    const report = await recoverJournalResidues(root);
    expect(report.recovered).toContain(path.join('journals', '2026', '2026-08-13--journal_recover.md'));
    expect(report.conflicts).toContain(path.join('journals', '2026', '2026-08-14--journal_conflict.md'));
    expect(report.ambiguous).toContain(path.join('journals', '2026', '2026-08-15--journal_ambiguous.md'));
    await expect(new MarkdownJournalRepository(root).get('journal_recover')).resolves.toMatchObject({ body: '恢复' });
  });
});

describe('MarkdownReviewRepository', () => {
  it('moves only the selected review file to the operating system trash', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zhiji-review-'));
    const trashItem = vi.fn(async () => undefined);
    const repository = new MarkdownReviewRepository(root, trashItem);
    const review = { schemaVersion: 1 as const, id: 'review_a1', type: 'weekly' as const, periodStart: '2026-08-10', periodEnd: '2026-08-16', sourceIds: ['journal_a1'], projectId: null, provider: 'openai-compatible' as const, model: 'test', promptVersion: 'weekly-v1', createdAt: '2026-08-16T08:00:00.000Z', body: '复盘' };
    await repository.save(review);
    await repository.delete(review.id);
    expect(trashItem).toHaveBeenCalledWith(path.join(root, 'reviews/weekly/2026/2026-08-10-review_a1.md'));
  });

  it('keeps one effective daily review per date and reuses its id on update', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zhiji-review-'));
    const trashItem = vi.fn(async () => undefined);
    const repository = new MarkdownReviewRepository(root, trashItem);
    const base = { schemaVersion: 2 as const, type: 'daily' as const, periodStart: '2026-08-13', periodEnd: '2026-08-13', sourceIds: ['journal_a1'], sourceVersions: [{ id: 'journal_a1', updatedAt: '2026-08-13T08:00:00.000Z' }], projectId: null, provider: 'openai-compatible' as const, model: 'test', promptVersion: 'daily-review-v3', body: '反馈' };
    await repository.save({ ...base, id: 'review_old', createdAt: '2026-08-13T08:00:00.000Z' });
    await repository.save({ ...base, id: 'review_new', createdAt: '2026-08-13T09:00:00.000Z', body: '较新的反馈' });
    await expect(repository.list()).resolves.toEqual([expect.objectContaining({ id: 'review_new', body: '较新的反馈' })]);
    const result = await repository.saveDaily({ ...base, id: 'review_random', createdAt: '2026-08-13T10:00:00.000Z', body: '更新后的反馈' });
    expect(result.review.id).toBe('review_new');
    expect(result.review.body).toBe('更新后的反馈');
    expect(trashItem).toHaveBeenCalledWith(path.join(root, 'reviews/daily/2026/2026-08-13-review_old.md'));
  });

  it('keeps the saved daily review successful when duplicate cleanup fails', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zhiji-review-'));
    const repository = new MarkdownReviewRepository(root, vi.fn().mockRejectedValue(new Error('trash unavailable')));
    const base = { schemaVersion: 2 as const, type: 'daily' as const, periodStart: '2026-08-13', periodEnd: '2026-08-13', sourceIds: ['journal_a1'], sourceVersions: [{ id: 'journal_a1', updatedAt: '2026-08-13T08:00:00.000Z' }], projectId: null, provider: 'openai-compatible' as const, model: 'test', promptVersion: 'daily-review-v3' };
    await repository.save({ ...base, id: 'review_old', createdAt: '2026-08-13T08:00:00.000Z', body: '旧反馈' });
    await repository.save({ ...base, id: 'review_mid', createdAt: '2026-08-13T09:00:00.000Z', body: '中间反馈' });
    const result = await repository.saveDaily({ ...base, id: 'review_new', createdAt: '2026-08-13T10:00:00.000Z', body: '新反馈' });
    expect(result).toMatchObject({ review: { id: 'review_mid', body: '新反馈' }, warning: expect.stringContaining('未能移入回收站') });
    expect(await repository.list()).toEqual([expect.objectContaining({ id: 'review_mid', body: '新反馈' })]);
  });
});
