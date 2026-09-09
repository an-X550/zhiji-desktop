// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewsPage } from '../../src/renderer/pages/reviews-page';
import type { Project, Review } from '../../src/shared/schemas/domain';
import { getDefaultReviewRange } from '../../src/renderer/utils/date-defaults';
import { toLocalDateString } from '../../src/renderer/utils/local-date';

const project: Project = { schemaVersion: 1, id: 'project_a1', name: '知己客户端', status: 'active', createdAt: '2026-08-01T00:00:00.000Z', archivedAt: null };
const historicalReview: Review = { schemaVersion: 1, id: 'review_history', type: 'monthly', periodStart: '2026-07-01', periodEnd: '2026-07-31', sourceIds: [], projectId: null, provider: 'openai-compatible', model: 'test', promptVersion: 'monthly-review-v1', createdAt: '2026-07-31T00:00:00.000Z', body: '七月复盘正文' };
const expectedWeeklyRange = getDefaultReviewRange('weekly', toLocalDateString());

beforeEach(() => { window.zhiji = { patterns: { list: vi.fn(async () => []), propose: vi.fn(async () => []), confirm: vi.fn() }, reviews: { preview: vi.fn(async () => ({ token: 'token', type: 'weekly', start: '2026-08-10', end: '2026-08-16', sources: [{ id: 'journal_a1', date: '2026-08-13', excerpt: '真实材料' }] })), generatePeriodic: vi.fn(async () => ({ kind: 'review', review: { schemaVersion: 1, id: 'review_a1', type: 'weekly', periodStart: '2026-08-10', periodEnd: '2026-08-16', sourceIds: ['journal_a1'], projectId: null, provider: 'openai-compatible', model: 'test', promptVersion: 'periodic-review-v1', createdAt: '2026-08-13T00:00:00.000Z', body: '本周有效行动' } })), previewInsight: vi.fn(async (input) => ({ token: 'insight-token', ...input, sources: [{ id: 'journal_a1', date: '2026-08-13', excerpt: '深度材料' }] })), generateInsight: vi.fn(async (input) => ({ schemaVersion: 1, id: 'review_insight', type: input.type, periodStart: input.start, periodEnd: input.end, sourceIds: ['journal_a1'], projectId: null, provider: 'openai-compatible', model: 'test', promptVersion: `${input.type}-v1`, createdAt: '2026-08-13T00:00:00.000Z', body: '深度洞察' })), delete: vi.fn(async () => undefined), cancel: vi.fn(), list: vi.fn(), generateDaily: vi.fn(), onTaskPhase: vi.fn(() => () => undefined) } } as unknown as Window['zhiji']; });

describe('ReviewsPage', () => {
  it('starts from three prototype review cards and uses a sensible weekly range', () => {
    render(<ReviewsPage projects={[]}/>);
    expect(screen.getByText('本周复盘')).toBeInTheDocument(); expect(screen.getByText('本月复盘')).toBeInTheDocument(); expect(screen.getByText('项目复盘')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '预览本周材料' }));
    expect(screen.queryByLabelText('开始日期')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '调整日期' }));
    expect(screen.getByLabelText('开始日期')).toHaveValue(expectedWeeklyRange.start); expect(screen.getByLabelText('结束日期')).toHaveValue(expectedWeeklyRange.end);
  });

  it('invalidates a preview after range changes and enables generation only after preview', async () => {
    render(<ReviewsPage projects={[]}/>); fireEvent.click(screen.getByRole('button', { name: '预览本周材料' })); fireEvent.click(screen.getByRole('button', { name: '调整日期' })); fireEvent.click(screen.getByRole('button', { name: '预览材料' }));
    await screen.findByText('真实材料'); expect(screen.getByRole('button', { name: '确认并生成' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-08-15' } });
    expect(screen.getByRole('button', { name: '确认并生成' })).toBeDisabled();
  });

  it('shows a history action after successful generation', async () => {
    const refresh = vi.fn(async () => undefined);
    render(<ReviewsPage projects={[]} onRefresh={refresh}/>); fireEvent.click(screen.getByRole('button', { name: '预览本周材料' })); fireEvent.click(screen.getByRole('button', { name: '预览材料' })); await screen.findByText('真实材料'); fireEvent.click(screen.getByRole('button', { name: '确认并生成' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '查看历史复盘' })).toBeInTheDocument()); fireEvent.click(screen.getByRole('button', { name: '查看历史复盘' })); expect(screen.getByRole('heading', { name: '历史复盘' })).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledOnce();
    expect(within(document.querySelector('.history-reader .markdown-document') as HTMLElement).getByText('本周有效行动')).toBeInTheDocument();
  });

  it('keeps a saved result successful when refreshing the shared review list fails', async () => {
    const refresh = vi.fn(async () => { throw new Error('列表暂不可用'); });
    render(<ReviewsPage projects={[]} onRefresh={refresh}/>);
    fireEvent.click(screen.getByRole('button', { name: '预览本周材料' }));
    fireEvent.click(screen.getByRole('button', { name: '预览材料' }));
    await screen.findByText('真实材料');
    fireEvent.click(screen.getByRole('button', { name: '确认并生成' }));
    expect(await screen.findByText('复盘已保存到本机，但历史列表刷新失败；稍后可重新读取。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看历史复盘' })).toBeInTheDocument();
  });

  it('shows safe structured diagnostics for periodic failure and keeps the confirmed materials available for retry', async () => {
    const diagnostics = { kind: 'truncated' as const, finishReason: 'length', outputLength: 0, schemaPaths: [], at: new Date().toISOString(), maxTokens: 3600, attempt: 2 };
    vi.mocked(window.zhiji.reviews.generatePeriodic)
      .mockResolvedValueOnce({ kind: 'error', message: 'AI 这次没有返回可用的反馈，日志和已有数据没有受到影响。', diagnostics })
      .mockResolvedValueOnce({ kind: 'review', review: { schemaVersion: 1, id: 'review_retry', type: 'weekly', periodStart: '2026-08-10', periodEnd: '2026-08-16', sourceIds: ['journal_a1'], projectId: null, provider: 'openai-compatible', model: 'test', promptVersion: 'weekly-review-v1', createdAt: '2026-08-13T00:00:00.000Z', body: '重试成功' } });
    render(<ReviewsPage projects={[]}/>);
    fireEvent.click(screen.getByRole('button', { name: '预览本周材料' }));
    fireEvent.click(screen.getByRole('button', { name: '预览材料' }));
    await screen.findByText('真实材料');
    fireEvent.click(screen.getByRole('button', { name: '确认并生成' }));
    expect(await screen.findByText('AI 这次没有返回可用的反馈，日志和已有数据没有受到影响。')).toBeInTheDocument();
    expect(screen.getByText('输出被截断')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认并生成' }));
    expect(await screen.findByText('重试成功')).toBeInTheDocument();
    expect(window.zhiji.reviews.generatePeriodic).toHaveBeenCalledTimes(2);
  });

  it('removes the Electron IPC wrapper from a periodic provider error', async () => {
    vi.mocked(window.zhiji.reviews.generatePeriodic).mockRejectedValueOnce(new Error("Error invoking remote method 'reviews:generate-periodic': 网络请求失败或超时，请稍后重试。"));
    render(<ReviewsPage projects={[]}/>);
    fireEvent.click(screen.getByRole('button', { name: '预览本周材料' }));
    fireEvent.click(screen.getByRole('button', { name: '预览材料' }));
    await screen.findByText('真实材料');
    fireEvent.click(screen.getByRole('button', { name: '确认并生成' }));
    expect(await screen.findByText('生成失败：网络请求失败或超时，请稍后重试。')).toBeInTheDocument();
    expect(screen.queryByText(/Error invoking remote method/)).not.toBeInTheDocument();
  });

  it('applies weekly and project navigation intents and keeps review history in this page', () => {
    const { rerender } = render(<ReviewsPage projects={[project]} reviews={[historicalReview]} intent={{ type: 'review.weekly' }}/>);
    expect(screen.getByRole('heading', { name: '本周复盘设置' })).toBeInTheDocument();
    rerender(<ReviewsPage projects={[project]} reviews={[historicalReview]} intent={{ type: 'review.project', projectId: project.id }}/>);
    expect(screen.getByLabelText('项目（可选）')).toHaveValue(project.id);
    fireEvent.click(screen.getByRole('button', { name: '历史复盘' }));
    expect(within(document.querySelector('.history-reader .markdown-document') as HTMLElement).getByText('七月复盘正文')).toBeInTheDocument();
  });
  it('uses the previous period carried by monthly and yearly suggestions', () => {
    const { rerender } = render(<ReviewsPage projects={[]} intent={{ type: 'review.monthly', month: '2026-07' }}/>);
    fireEvent.click(screen.getByRole('button', { name: '调整日期' }));
    expect(screen.getByLabelText('开始日期')).toHaveValue('2026-07-01');
    expect(screen.getByLabelText('结束日期')).toHaveValue('2026-07-31');
    rerender(<ReviewsPage projects={[]} intent={{ type: 'review.yearly', year: '2025' }}/>);
    expect(screen.getByLabelText('开始日期')).toHaveValue('2025-01-01');
    expect(screen.getByLabelText('结束日期')).toHaveValue('2025-12-31');
  });

  it('keeps insight tools hidden until the user asks for them', () => {
    render(<ReviewsPage projects={[]}/>);
    expect(screen.queryByText('日志质量检查')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '更多洞察' }));
    expect(screen.getByText('日志质量检查')).toBeInTheDocument();
    expect(screen.getByText('年度回顾')).toBeInTheDocument();
    expect(screen.getByText('方向校准')).toBeInTheDocument();
  });

  it('previews and generates an insight through the dedicated API', async () => {
    render(<ReviewsPage projects={[]}/>);
    fireEvent.click(screen.getByRole('button', { name: '更多洞察' }));
    fireEvent.click(screen.getByRole('button', { name: '检查日志质量' }));
    fireEvent.click(screen.getByRole('button', { name: '预览材料' }));
    expect(await screen.findByText('深度材料')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认并生成' }));
    await waitFor(() => expect(window.zhiji.reviews.generateInsight).toHaveBeenCalled());
    expect(await screen.findByText('深度洞察')).toBeInTheDocument();
  });
  it('moves a historical review to the recycle bin without deleting source journals', async () => {
    const refresh = vi.fn();
    render(<ReviewsPage projects={[]} reviews={[historicalReview]} onRefresh={refresh}/>);
    fireEvent.click(screen.getByRole('button', { name: '历史复盘' }));
    fireEvent.click(screen.getByRole('button', { name: '移到回收站' }));
    expect(screen.getByText('来源日志不会被删除。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认移除' }));
    await waitFor(() => expect(window.zhiji.reviews.delete).toHaveBeenCalledWith(historicalReview.id));
    expect(refresh).toHaveBeenCalled();
  });
  it('keeps the review visible when the recycle bin operation fails', async () => {
    vi.mocked(window.zhiji.reviews.delete).mockRejectedValueOnce(new Error('回收站不可用'));
    render(<ReviewsPage projects={[]} reviews={[historicalReview]}/>);
    fireEvent.click(screen.getByRole('button', { name: '历史复盘' }));
    fireEvent.click(screen.getByRole('button', { name: '移到回收站' }));
    fireEvent.click(screen.getByRole('button', { name: '确认移除' }));
    expect(await screen.findByText('移除失败：回收站不可用')).toBeInTheDocument();
    expect(within(document.querySelector('.history-reader .markdown-document') as HTMLElement).getByText('七月复盘正文')).toBeInTheDocument();
  });
});
