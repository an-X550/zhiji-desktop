// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TodayPage } from '../../src/renderer/pages/today-page';
import { toLocalDateString } from '../../src/renderer/utils/local-date';
import type { Journal, Review } from '../../src/shared/schemas/domain';

const date = toLocalDateString();
const journal: Journal = { schemaVersion: 1, id: 'journal_today', date, createdAt: `${date}T01:00:00.000Z`, updatedAt: `${date}T01:00:00.000Z`, projectIds: [], body: '原来的日志' };

beforeEach(() => {
  window.zhiji = {
    journals: { create: vi.fn(async (input) => ({ ...journal, ...input })), update: vi.fn(async (input) => ({ ...journal, ...input, updatedAt: `${date}T02:00:00.000Z` })), delete: vi.fn(async () => undefined), list: vi.fn(), get: vi.fn() },
    reviews: { generateDaily: vi.fn(async () => ({}) as never), list: vi.fn(), cancel: vi.fn(), preview: vi.fn(), generatePeriodic: vi.fn(), onTaskPhase: vi.fn(() => () => undefined) },
    templates: { list: vi.fn(async () => []), get: vi.fn(), save: vi.fn(), delete: vi.fn() },
  } as unknown as Window['zhiji'];
});

describe('TodayPage', () => {
  it('offers a truthful save action when AI is not configured', () => {
    render(<TodayPage journals={[]} projects={[]} reviews={[]} hasApiKey={false} onRefresh={vi.fn()} onNavigate={vi.fn()}/>);
    expect(screen.getByRole('button', { name: '保存日志' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /生成今日反馈/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '配置 AI' })).toBeInTheDocument();
  });
  it('loads the unique journal for today and updates it without creating a duplicate', async () => {
    render(<TodayPage journals={[journal]} projects={[]} reviews={[]} onRefresh={vi.fn()} onNavigate={vi.fn()}/>);
    await waitFor(() => expect(screen.getByRole('textbox', { name: '日志内容' })).toHaveValue(journal.body));
    expect(screen.getByLabelText('日志日期')).toHaveAttribute('max', date);
    expect(screen.queryByText(/自动保存/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '日志内容' }), { target: { value: '补充后的日志内容' } });
    fireEvent.click(screen.getByRole('button', { name: '仅保存日志' }));
    await waitFor(() => expect(screen.getByText('已保存到本机')).toBeInTheDocument());
    expect(window.zhiji.journals.update).toHaveBeenCalledWith({ date, body: '补充后的日志内容', projectIds: [], id: journal.id, expectedUpdatedAt: journal.updatedAt });
    expect(window.zhiji.journals.create).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: '日志内容' })).toHaveValue('补充后的日志内容');
    expect(screen.getByText('已保存')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '日志内容' }), { target: { value: '再次保存的内容' } });
    fireEvent.click(screen.getByRole('button', { name: '仅保存日志' }));
    await waitFor(() => expect(window.zhiji.journals.update).toHaveBeenCalledWith({ date, body: '再次保存的内容', projectIds: [], id: journal.id, expectedUpdatedAt: `${date}T02:00:00.000Z` }));
    expect(window.zhiji.journals.create).not.toHaveBeenCalled();
  });

  it('manages templates from the journal editor and refreshes the selector', async () => {
    const initial = [{ name: '每日回顾', body: '今天发生了什么？' }];
    const updated = [...initial, { name: '事件记录', body: '事实：' }];
    vi.mocked(window.zhiji.templates.list).mockResolvedValueOnce(initial).mockResolvedValueOnce(updated);
    render(<TodayPage journals={[]} projects={[]} reviews={[]} onRefresh={vi.fn()} onNavigate={vi.fn()}/>);
    expect(await screen.findByRole('option', { name: '每日回顾' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '管理模板' }));
    fireEvent.click(screen.getByRole('button', { name: '新建模板' }));
    fireEvent.change(screen.getByRole('textbox', { name: '模板名称' }), { target: { value: '事件记录' } });
    fireEvent.change(screen.getByRole('textbox', { name: '模板正文' }), { target: { value: '事实：' } });
    vi.mocked(window.zhiji.templates.save).mockResolvedValueOnce(updated[1]);
    fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
    expect(await screen.findByRole('option', { name: '事件记录' })).toBeInTheDocument();
  });

  it('retains the draft and exposes a retryable error when saving fails', async () => {
    vi.mocked(window.zhiji.journals.create).mockRejectedValueOnce(new Error('disk full'));
    render(<TodayPage journals={[]} projects={[]} reviews={[]} onRefresh={vi.fn()} onNavigate={vi.fn()}/>);
    const editor = screen.getByRole('textbox', { name: '日志内容' });
    fireEvent.change(editor, { target: { value: '不能丢失的草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '仅保存日志' }));
    await waitFor(() => expect(screen.getByText(/保存失败/)).toBeInTheDocument());
    expect(editor).toHaveValue('不能丢失的草稿');
  });

  it('keeps the writing view focused and leaves history to the past-journals mode', () => {
    const journals = Array.from({ length: 5 }, (_, index) => ({ ...journal, id: `journal_a${index}`, date: `2026-08-0${index + 1}`, body: `日志 ${index}` }));
    render(<TodayPage journals={journals} projects={[]} reviews={[]} onRefresh={vi.fn()} onNavigate={vi.fn()}/>);
    expect(screen.queryByTestId('recent-journal')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '过去日志' })).toBeInTheDocument();
  });

  it('keeps the saved body visible when AI fails and retries without creating a duplicate', async () => {
    const refresh = vi.fn();
    const diagnostics = { kind: 'truncated' as const, finishReason: 'length', outputLength: 0, schemaPaths: [], at: new Date().toISOString() };
    vi.mocked(window.zhiji.reviews.generateDaily)
      .mockResolvedValueOnce({ kind: 'error', message: 'AI 这次没有返回可用的反馈，日志和已有数据没有受到影响。', diagnostics })
      .mockResolvedValueOnce({ kind: 'review', review: { ...journal, id: 'review_a1', type: 'daily', periodStart: date, periodEnd: date, sourceIds: [journal.id], projectId: null, provider: 'openai-compatible', model: 'test', promptVersion: 'daily-review-v1', body: '重试后的反馈' } as never });
    render(<TodayPage journals={[]} projects={[]} reviews={[]} onRefresh={refresh} onNavigate={vi.fn()}/>);
    const editor = screen.getByRole('textbox', { name: '日志内容' });
    fireEvent.change(editor, { target: { value: '可恢复的日志正文' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并生成今日反馈' }));
    expect(await screen.findByText('AI 这次没有返回可用的反馈，日志和已有数据没有受到影响。')).toBeInTheDocument();
    expect(editor).toHaveValue('可恢复的日志正文');
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }));
    expect(await screen.findByText('重试后的反馈')).toBeInTheDocument();
    expect(window.zhiji.journals.create).toHaveBeenCalledOnce();
  });

  it('clears the dirty guard after save and restores it after an edit', async () => {
    const dirtyStates: boolean[] = [];
    render(<TodayPage journals={[]} projects={[]} reviews={[]} onRefresh={vi.fn()} onNavigate={vi.fn()} onDirtyChange={(dirty) => dirtyStates.push(dirty)}/>);
    fireEvent.change(screen.getByRole('textbox', { name: '日志内容' }), { target: { value: '已保存正文' } });
    expect(dirtyStates.at(-1)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '仅保存日志' }));
    await waitFor(() => expect(screen.getByText('已保存到本机')).toBeInTheDocument());
    expect(dirtyStates.at(-1)).toBe(false);
    fireEvent.change(screen.getByRole('textbox', { name: '日志内容' }), { target: { value: '已保存正文，补充一行' } });
    expect(dirtyStates.at(-1)).toBe(true);
  });

  it('starts a new entry explicitly without changing the saved journal', async () => {
    const refresh = vi.fn();
    const saved = { ...journal, id: 'journal_saved', body: '已保存正文' };
    vi.mocked(window.zhiji.journals.create).mockResolvedValueOnce(saved);
    render(<TodayPage journals={[]} projects={[]} reviews={[]} onRefresh={refresh} onNavigate={vi.fn()}/>);
    fireEvent.change(screen.getByRole('textbox', { name: '日志内容' }), { target: { value: '已保存正文' } });
    fireEvent.click(screen.getByRole('button', { name: '仅保存日志' }));
    await screen.findByText('已保存到本机');
    fireEvent.click(screen.getByRole('button', { name: '新建日志' }));
    expect(screen.getByRole('textbox', { name: '日志内容' })).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox', { name: '日志内容' }), { target: { value: '第二条正文' } });
    fireEvent.click(screen.getByRole('button', { name: '仅保存日志' }));
    await waitFor(() => expect(window.zhiji.journals.create).toHaveBeenCalledWith({ date, body: '第二条正文', projectIds: [] }));
    expect(window.zhiji.journals.update).not.toHaveBeenCalled();
  });

  it('shows the generated daily review without forcing a history jump', async () => {
    const review: Review = { schemaVersion: 1, id: 'review_a1', type: 'daily', periodStart: date, periodEnd: date, sourceIds: [journal.id], projectId: null, provider: 'openai-compatible', model: 'test', promptVersion: 'daily-review-v1', createdAt: `${date}T01:00:00.000Z`, body: '今天最重要的反馈' };
    vi.mocked(window.zhiji.reviews.generateDaily).mockResolvedValueOnce({ kind: 'review', review });
    render(<TodayPage journals={[journal]} projects={[]} reviews={[]} onRefresh={vi.fn()} onNavigate={vi.fn()}/>);
    fireEvent.change(screen.getByRole('textbox', { name: '日志内容' }), { target: { value: '新内容' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并生成今日反馈' }));
    expect(await screen.findByText('今天最重要的反馈')).toBeInTheDocument();
  });

  it('keeps saving available while pointing an unconfigured user to AI settings', () => {
    const onNavigate = vi.fn(); render(<TodayPage journals={[]} projects={[]} reviews={[]} hasApiKey={false} onRefresh={vi.fn()} onNavigate={onNavigate}/>);
    expect(screen.getByText('日志可直接保存；配置后还能生成反馈。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '配置 AI' })); expect(onNavigate).toHaveBeenCalledWith({ view: 'settings', settingsSection: 'ai' });
  });

  it('opens past journals from a records intent and focuses writing from a compose intent', async () => {
    const { rerender } = render(<TodayPage journals={[journal]} projects={[]} reviews={[]} intent={{ type: 'records.journals' }} onRefresh={vi.fn()} onNavigate={vi.fn()}/>);
    expect(screen.getByRole('heading', { name: '过去日志' })).toBeInTheDocument();
    expect(document.querySelector('.history-reader .markdown-document')).toHaveTextContent('原来的日志');
    rerender(<TodayPage journals={[journal]} projects={[]} reviews={[]} intent={{ type: 'journal.compose' }} onRefresh={vi.fn()} onNavigate={vi.fn()}/>);
    await waitFor(() => expect(screen.getByRole('textbox', { name: '日志内容' })).toHaveFocus());
  });

  it('generates a daily review directly from a historical journal', async () => {
    const pastJournal = { ...journal, id: 'journal_past', date: '2026-08-01', body: '过去的一篇日志' };
    const review: Review = { schemaVersion: 1, id: 'review_past', type: 'daily', periodStart: pastJournal.date, periodEnd: pastJournal.date, sourceIds: [pastJournal.id], projectId: null, provider: 'openai-compatible', model: 'test', promptVersion: 'daily-review-v1', createdAt: `${date}T01:00:00.000Z`, body: '过去这一天的反馈' };
    vi.mocked(window.zhiji.reviews.generateDaily).mockResolvedValueOnce({ kind: 'review', review });
    render(<TodayPage journals={[pastJournal]} projects={[]} reviews={[]} intent={{ type: 'records.journals' }} hasApiKey onRefresh={vi.fn()} onNavigate={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: '生成这一天的反馈' }));
    expect(await screen.findByText('过去这一天的反馈')).toBeInTheDocument();
    expect(window.zhiji.reviews.generateDaily).toHaveBeenCalledWith({ date: pastJournal.date, journalId: pastJournal.id });
  });
  it('moves a historical journal to the recycle bin after confirmation', async () => {
    const refresh = vi.fn();
    render(<TodayPage journals={[journal]} projects={[]} reviews={[]} intent={{ type: 'records.journals' }} onRefresh={refresh} onNavigate={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: '移到回收站' }));
    expect(screen.getByText('已有复盘不会同步删除。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认移除' }));
    await waitFor(() => expect(window.zhiji.journals.delete).toHaveBeenCalledWith(journal.id));
    expect(refresh).toHaveBeenCalled();
  });
  it('keeps the journal visible when the recycle bin operation fails', async () => {
    vi.mocked(window.zhiji.journals.delete).mockRejectedValueOnce(new Error('回收站不可用'));
    render(<TodayPage journals={[journal]} projects={[]} reviews={[]} intent={{ type: 'records.journals' }} onRefresh={vi.fn()} onNavigate={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: '移到回收站' }));
    fireEvent.click(screen.getByRole('button', { name: '确认移除' }));
    expect(await screen.findByText('移除失败：回收站不可用')).toBeInTheDocument();
    expect(document.querySelector('.history-reader .markdown-document')).toHaveTextContent('原来的日志');
  });

  it('generates feedback from an existing journal without creating a duplicate', async () => {
    const review: Review = { schemaVersion: 1, id: 'review_a1', type: 'daily', periodStart: date, periodEnd: date, sourceIds: [journal.id], projectId: null, provider: 'openai-compatible', model: 'test', promptVersion: 'daily-review-v1', createdAt: `${date}T01:00:00.000Z`, body: '已有日志的反馈' };
    vi.mocked(window.zhiji.reviews.generateDaily).mockResolvedValueOnce({ kind: 'review', review });
    render(<TodayPage journals={[journal]} projects={[]} reviews={[]} onRefresh={vi.fn()} onNavigate={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: '日分析' }));
    fireEvent.click(screen.getByRole('button', { name: '生成今日反馈' }));
    expect(await screen.findByText('已有日志的反馈')).toBeInTheDocument();
    expect(window.zhiji.journals.create).not.toHaveBeenCalled();
    expect(window.zhiji.reviews.generateDaily).toHaveBeenCalledWith({ date, journalId: journal.id });
  });

  it('lets the user backfill a past date without calling AI', async () => {
    render(<TodayPage journals={[]} projects={[]} reviews={[]} onRefresh={vi.fn()} onNavigate={vi.fn()}/>);
    fireEvent.change(screen.getByLabelText('日志日期'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByRole('textbox', { name: '日志内容' }), { target: { value: '补写内容' } });
    fireEvent.click(screen.getByRole('button', { name: '保存日志' }));
    await waitFor(() => expect(window.zhiji.journals.create).toHaveBeenCalledWith({ date: '2026-08-01', body: '补写内容', projectIds: [] }));
    expect(window.zhiji.reviews.generateDaily).not.toHaveBeenCalled();
  });

  it('keeps an unsaved draft when the user cancels opening history', () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    render(<TodayPage journals={[journal]} projects={[]} reviews={[]} onRefresh={vi.fn()} onNavigate={vi.fn()}/>);
    fireEvent.change(screen.getByRole('textbox', { name: '日志内容' }), { target: { value: '未保存草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '过去日志' }));
    expect(screen.getByRole('textbox', { name: '日志内容' })).toHaveValue('未保存草稿');
  });

  it('requires selecting one journal before generating when a day has multiple entries', async () => {
    const second = { ...journal, id: 'journal_second', body: '第二条日志内容' };
    const review: Review = { schemaVersion: 1, id: 'review_second', type: 'daily', periodStart: date, periodEnd: date, sourceIds: [second.id], projectId: null, provider: 'openai-compatible', model: 'test', promptVersion: 'daily-review-v4', createdAt: `${date}T03:00:00.000Z`, body: '第二条反馈' };
    vi.mocked(window.zhiji.reviews.generateDaily).mockResolvedValueOnce({ kind: 'review', review });
    render(<TodayPage journals={[journal, second]} projects={[]} reviews={[]} onRefresh={vi.fn()} onNavigate={vi.fn()}/>);
    expect(screen.getByText('这一天已有 2 条日志。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '过去日志' }));
    fireEvent.click(screen.getByRole('button', { name: /第二条日志内容/ }));
    fireEvent.click(screen.getByRole('button', { name: '生成今日反馈' }));
    expect(await screen.findByText('第二条反馈')).toBeInTheDocument();
    expect(window.zhiji.reviews.generateDaily).toHaveBeenCalledWith({ date, journalId: second.id });
  });

  it('does not move a saved journal when navigating to another date', async () => {
    render(<TodayPage journals={[journal]} projects={[]} reviews={[]} onRefresh={vi.fn()} onNavigate={vi.fn()}/>);
    await waitFor(() => expect(screen.getByRole('textbox', { name: '日志内容' })).toHaveValue(journal.body));
    fireEvent.change(screen.getByLabelText('日志日期'), { target: { value: '2026-08-01' } });
    await waitFor(() => expect(screen.getByRole('textbox', { name: '日志内容' })).toHaveValue(''));
    expect(window.zhiji.journals.update).not.toHaveBeenCalled();
  });

  it('keeps the journal draft and daily analysis in one switchable workspace', async () => {
    render(<TodayPage journals={[journal]} projects={[]} reviews={[]} onRefresh={vi.fn()} onNavigate={vi.fn()}/>);
    await waitFor(() => expect(screen.getByRole('textbox', { name: '日志内容' })).toHaveValue(journal.body));
    fireEvent.click(screen.getByRole('button', { name: '日分析' }));
    expect(screen.getByRole('region', { name: `${new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(`${date}T12:00:00`))}日反馈` })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '日志内容' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '日志' }));
    expect(screen.getByRole('textbox', { name: '日志内容' })).toHaveValue(journal.body);
  });

  it('passes regenerate for a fresh selected daily review instead of silently using cache', async () => {
    const review: Review = { schemaVersion: 2, id: 'review_fresh', type: 'daily', periodStart: date, periodEnd: date, sourceIds: [journal.id], sourceVersions: [{ id: journal.id, updatedAt: journal.updatedAt }], projectId: null, provider: 'openai-compatible', model: 'test', promptVersion: 'daily-review-v4', createdAt: `${date}T03:00:00.000Z`, body: '已有反馈' };
    vi.mocked(window.zhiji.reviews.generateDaily).mockResolvedValueOnce({ kind: 'review', review: { ...review, body: '重新生成的反馈' }, cached: false });
    render(<TodayPage journals={[journal]} projects={[]} reviews={[review]} onRefresh={vi.fn()} onNavigate={vi.fn()}/>);
    await waitFor(() => expect(screen.getByRole('textbox', { name: '日志内容' })).toHaveValue(journal.body));
    fireEvent.click(screen.getByRole('button', { name: '日分析' }));
    fireEvent.click(screen.getByRole('button', { name: '重新生成今日反馈' }));
    expect(await screen.findByText('重新生成的反馈')).toBeInTheDocument();
    expect(window.zhiji.reviews.generateDaily).toHaveBeenCalledWith({ date, journalId: journal.id, regenerate: true });
  });
});
