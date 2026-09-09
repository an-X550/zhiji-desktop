// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RecordBrowser } from '../../src/renderer/pages/history-page';
import type { Journal, Project, Review } from '../../src/shared/schemas/domain';

const project: Project = { schemaVersion: 1, id: 'project_a1', name: '求职', status: 'active', createdAt: '2026-08-01T00:00:00.000Z', archivedAt: null };
const journal: Journal = { schemaVersion: 1, id: 'journal_a1', date: '2026-08-12', createdAt: '2026-08-12T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z', projectIds: ['project_a1'], body: '<script>不能执行</script> 求职日志' };
const review: Review = { schemaVersion: 1, id: 'review_a1', type: 'weekly', periodStart: '2026-08-10', periodEnd: '2026-08-16', sourceIds: ['journal_a1'], projectId: 'project_a1', provider: 'openai-compatible', model: 'fake', promptVersion: 'weekly-review-v1', createdAt: '2026-08-16T00:00:00.000Z', body: '本周复盘正文' };

describe('HistoryPage', () => {
  it('shows only journal records when embedded in the journal task', () => {
    render(<RecordBrowser journals={[journal]} reviews={[review]} projects={[project]} allowedKinds={['journal']}/>);
    expect(screen.getByRole('button', { name: /求职日志/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /本周复盘正文/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('记录类型')).not.toBeInTheDocument();
    expect(within(document.querySelector('.history-reader .markdown-document') as HTMLElement).getByText('<script>不能执行</script> 求职日志')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
  });

  it('renders report markdown as safe document elements instead of raw symbols', () => {
    const markdownReview = { ...review, body: '# 本周判断\n\n> 原文证据\n\n- 一个行动' };
    render(<RecordBrowser journals={[]} reviews={[markdownReview]} projects={[project]} allowedKinds={['weekly']}/>);
    const reader = document.querySelector('.history-reader') as HTMLElement;
    expect(within(reader).getByRole('heading', { name: '本周判断' })).toBeInTheDocument();
    const quote = within(reader).getByText('原文证据');
    expect(quote).toBeInTheDocument();
    expect(quote.closest('blockquote')).toBeInTheDocument();
    expect(within(reader).getByText('一个行动', { selector: 'li' })).toBeInTheDocument();
    expect(reader.querySelector('pre')).toBeNull();
    expect(reader.textContent).not.toContain('# 本周判断');
  });

  it('shows only review records when embedded in the review task', () => {
    render(<RecordBrowser journals={[journal]} reviews={[review]} projects={[project]} allowedKinds={['daily', 'weekly', 'monthly', 'project']}/>);
    expect(screen.getByRole('button', { name: /本周复盘正文/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /求职日志/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索历史'), { target: { value: '不存在' } });
    fireEvent.change(screen.getByLabelText('项目筛选'), { target: { value: 'project_a1' } });
    expect(screen.getByText('没有符合筛选条件的记录')).toBeInTheDocument();
  });
});

const targetJournal: Journal = {
  schemaVersion: 1,
  id: 'journal_history1',
  date: '2026-09-07',
  createdAt: '2026-09-07T10:00:00.000Z',
  updatedAt: '2026-09-07T10:00:00.000Z',
  projectIds: [],
  body: '准确打开的原始日志内容',
};

const targetReview: Review = {
  schemaVersion: 1,
  id: 'review_history1',
  type: 'weekly',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-07',
  sourceIds: [targetJournal.id],
  projectId: null,
  provider: 'openai-compatible',
  model: 'test',
  promptVersion: 'periodic-review-v1',
  createdAt: '2026-09-07T10:00:00.000Z',
  body: '准确打开的原始复盘内容',
};

describe('RecordBrowser precise selection', () => {
  it('opens the requested journal or review and never falls back after a missing id', () => {
    const { rerender } = render(<RecordBrowser journals={[targetJournal]} allowedKinds={['journal']} initialSelectedId={targetJournal.id}/>);
    expect(screen.getAllByText('准确打开的原始日志内容').length).toBeGreaterThan(0);

    rerender(<RecordBrowser journals={[]} reviews={[targetReview]} allowedKinds={['weekly']} initialSelectedId={targetReview.id}/>);
    expect(screen.getAllByText('准确打开的原始复盘内容').length).toBeGreaterThan(0);

    rerender(<RecordBrowser journals={[targetJournal]} allowedKinds={['journal']} initialSelectedId="journal_deleted"/>);
    expect(screen.getByText('找不到这条记录')).toBeInTheDocument();
    expect(within(document.querySelector('.history-reader--empty') as HTMLElement).queryByText('准确打开的原始日志内容')).not.toBeInTheDocument();
  });
});
