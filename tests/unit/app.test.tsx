// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/app/app';
import type { AgentEvent } from '../../src/shared/schemas/agent';

function api() {
  return {
    dataDirectory: { getInfo: vi.fn(async () => ({ path: 'D:\\知己', writable: true, fileCount: 0, totalBytes: 0, categories: { journals: 0, reviews: 0, projects: 0, profile: 0, settings: 0 } })), open: vi.fn(), pickFolder: vi.fn(async () => ({ canceled: true })), changeLocation: vi.fn() },
    agent: { start: vi.fn(), send: vi.fn(), cancel: vi.fn(), list: vi.fn(async () => []), get: vi.fn(), onEvent: vi.fn(() => () => undefined) },
    profile: { get: vi.fn(async () => null), save: vi.fn(), clear: vi.fn() },
    transfer: { exportBackup: vi.fn(), previewRestore: vi.fn(), restore: vi.fn() },
    journals: { list: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), get: vi.fn() },
    projects: { list: vi.fn(async () => []), create: vi.fn(), archive: vi.fn() },
    reviews: { list: vi.fn(async () => []), generateDaily: vi.fn(), cancel: vi.fn(), preview: vi.fn(), generatePeriodic: vi.fn(), onTaskPhase: vi.fn(() => () => undefined) },
    templates: { list: vi.fn(async () => []), get: vi.fn(), save: vi.fn(), delete: vi.fn() },
    app: { getInfo: vi.fn(async () => ({ version: '1.27.0', updateUrl: null })), setUpdateUrl: vi.fn() },
    settings: { getPublicConfig: vi.fn(async () => ({ providerId: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini', agentThinking: 'disabled' as const, hasApiKey: false })), save: vi.fn(), testConnection: vi.fn() },
  } as unknown as Window['zhiji'];
}

beforeEach(() => { window.zhiji = api(); });

describe('App', () => {
  it('navigates across the product pages', async () => {
    render(<App/>);
    await screen.findByRole('heading', { name: '写下今天的经历' });
    for (const [nav, heading] of [['日志', '写一条日志'], ['复盘', '把一段时间的经历放在一起看'], ['项目', '项目与关联日志'], ['设置', '设置']] as const) {
      fireEvent.click(screen.getByRole('button', { name: nav }));
      expect(screen.getByRole('heading', { name: heading, level: 2 })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: '知己 Agent' }));
    expect(screen.getByRole('heading', { name: '知己 Agent', level: 2 })).toBeInTheDocument();
  });

  it('keeps the app usable when one initial data source fails and retries that source', async () => {
    vi.mocked(window.zhiji.journals.list).mockRejectedValueOnce(new Error('磁盘暂不可用')).mockResolvedValueOnce([]);
    render(<App/>);
    expect(await screen.findByText(/磁盘暂不可用/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '写下今天的经历' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: '写下今天的经历' })).toBeInTheDocument());
    expect(window.zhiji.journals.list).toHaveBeenCalledTimes(2);
  });

  it('retains previously loaded data when a later refresh partially fails', async () => {
    const current = api();
    current.settings.save = vi.fn(async () => ({ providerId: 'openai' as const, baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini', agentThinking: 'disabled' as const, hasApiKey: false }));
    current.reviews.list = vi.fn()
      .mockResolvedValueOnce([{ schemaVersion: 1, id: 'review_r1', type: 'daily', periodStart: '2026-09-09', periodEnd: '2026-09-09', sourceIds: ['journal_r1'], projectId: null, provider: 'openai-compatible', model: 'fake', promptVersion: 'daily-review-v1', createdAt: '2026-09-09T00:00:00.000Z', body: '已有反馈' }])
      .mockRejectedValueOnce(new Error('复盘文件暂不可用'));
    window.zhiji = current;
    render(<App/>);
    await screen.findByRole('heading', { name: '写下今天的经历' });
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'AI 与个性化' }));
    fireEvent.click(screen.getByText('高级设置'));
    fireEvent.click(screen.getByRole('button', { name: '仅保存' }));
    expect(await screen.findByText(/复盘文件暂不可用/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '复盘' }));
    fireEvent.click(screen.getByRole('button', { name: '历史复盘' }));
    expect(await screen.findAllByText('已有反馈')).not.toHaveLength(0);
  });

  it('keeps a pending Agent approval visible after leaving and returning to the page', async () => {
    const session = { id: 'agent_restore1', title: '等待确认', status: 'idle' as const, messages: [], createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z' };
    const listeners: Array<(event: AgentEvent) => void> = [];
    const current = api();
    current.agent.list = vi.fn(async () => [session]);
    current.agent.onEvent = vi.fn((listener) => { listeners.push(listener); return () => undefined; });
    window.zhiji = current;
    render(<App/>);
    await screen.findByRole('heading', { name: '写下今天的经历' });
    fireEvent.click(screen.getByRole('button', { name: '知己 Agent' }));
    await screen.findByRole('heading', { name: '知己 Agent', level: 2 });
    const approval = { type: 'workflow.approval' as const, sessionId: session.id, approval: { approvalId: 'approval_restore1', workflow: 'reviews.generate-periodic' as const, title: '确认生成周期复盘', summary: '离开页面后仍需保留的审批材料。', preview: { token: '00000000-0000-4000-8000-000000000001', type: 'weekly' as const, start: '2026-09-01', end: '2026-09-07', sources: [{ id: 'journal_restore1', date: '2026-09-07', excerpt: '合成材料' }] } } };
    listeners.forEach((listener) => listener(approval));
    expect(await screen.findByText('确认生成周期复盘')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    fireEvent.click(screen.getByRole('button', { name: '知己 Agent' }));
    expect(await screen.findByText('确认生成周期复盘')).toBeInTheDocument();
  });
});
