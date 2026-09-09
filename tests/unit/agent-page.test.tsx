// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentPage } from '../../src/renderer/pages/agent-page';
import type { AgentEvent } from '../../src/shared/schemas/agent';

const session = { id: 'agent_abc123', title: '周复盘', status: 'idle' as const, messages: [], createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z' };

beforeEach(() => {
  window.zhiji = { agent: { start: vi.fn(async () => session), send: vi.fn(), cancel: vi.fn(), delete: vi.fn(), confirm: vi.fn(), list: vi.fn(async () => [session]), get: vi.fn(), onEvent: vi.fn(() => () => undefined) } } as unknown as Window['zhiji'];
});

describe('AgentPage', () => {
  it('shows sessions and sends a natural-language message through the named API', async () => {
    render(<AgentPage/>);
    expect((await screen.findAllByText('周复盘')).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole('textbox', { name: '向知己 Agent 发送消息' }), { target: { value: '先整理本周' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(window.zhiji.agent.send).toHaveBeenCalledWith({ sessionId: 'agent_abc123', message: '先整理本周' }));
  });

  it('sends on Enter and preserves Shift+Enter for multiline input', async () => {
    render(<AgentPage/>);
    const textbox = await screen.findByRole('textbox', { name: '向知己 Agent 发送消息' });
    fireEvent.change(textbox, { target: { value: '今天星期几' } });
    fireEvent.keyDown(textbox, { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(window.zhiji.agent.send).toHaveBeenCalledWith({ sessionId: 'agent_abc123', message: '今天星期几' }));
    fireEvent.change(textbox, { target: { value: '第一行' } });
    fireEvent.keyDown(textbox, { key: 'Enter', code: 'Enter', shiftKey: true });
    expect(window.zhiji.agent.send).toHaveBeenCalledTimes(1);
  });

  it('deletes a session only after explicit confirmation', async () => {
    render(<AgentPage/>);
    fireEvent.click(await screen.findByRole('button', { name: '删除会话' }));
    expect(await screen.findByText('删除这个 Agent 会话？')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(window.zhiji.agent.delete).toHaveBeenCalledWith({ sessionId: 'agent_abc123' }));
  });

  it('treats validated Agent navigation and result cards as data', async () => {
    let listener: ((event: AgentEvent) => void) | undefined;
    const onNavigate = vi.fn();
    window.zhiji.agent.onEvent = vi.fn((next) => { listener = next; return () => undefined; });
    render(<AgentPage onNavigate={onNavigate}/>);
    await waitFor(() => expect(listener).toBeTypeOf('function'));
    listener?.({ type: 'ui.navigate', sessionId: 'agent_abc123', target: { view: 'reviews', intent: 'project', projectId: 'project_valid1' } });
    listener?.({ type: 'ui.present', sessionId: 'agent_abc123', card: { title: '下一步', summary: '查看该项目的复盘。', links: [{ label: '打开项目复盘', target: { view: 'reviews', intent: 'project', projectId: 'project_valid1' } }] } });

    expect(onNavigate).toHaveBeenCalledWith({ view: 'reviews', intent: { type: 'review.project', projectId: 'project_valid1' } });
    expect(await screen.findByText('下一步')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开项目复盘' }));
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  it('shows bounded evidence for the current session, expands it, and does not mix sessions', async () => {
    const otherSession = { ...session, id: 'agent_other123', title: '其他会话' };
    let listener: ((event: AgentEvent) => void) | undefined;
    const onNavigate = vi.fn();
    window.zhiji.agent.list = vi.fn(async () => [session, otherSession]);
    window.zhiji.agent.onEvent = vi.fn((next) => { listener = next; return () => undefined; });
    render(<AgentPage onNavigate={onNavigate}/>);
    await waitFor(() => expect(listener).toBeTypeOf('function'));

    listener?.({ type: 'tool.evidence', sessionId: session.id, callId: crypto.randomUUID(), source: 'memory.search', hits: Array.from({ length: 5 }, (_, index) => ({ id: `journal_e${index}`, kind: 'journal' as const, date: '2026-08-20', excerpt: `证据 ${index + 1}` })) });
    expect(await screen.findByText('证据 1')).toBeInTheDocument();
    expect(screen.queryByText('证据 4')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开全部证据（最多 5 条）' }));
    expect(await screen.findByText('证据 5')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /其他会话/ }));
    expect(screen.queryByText('证据 1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /周复盘/ }));
    expect(await screen.findByText('证据 1')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '查看日志' })[0]);
    expect(onNavigate).toHaveBeenCalledWith({ view: 'journal', intent: { type: 'records.journals', id: 'journal_e0' } });
  });

  it('clears only the selected session evidence when sending a new turn', async () => {
    const otherSession = { ...session, id: 'agent_other123', title: '其他会话' };
    let listener: ((event: AgentEvent) => void) | undefined;
    window.zhiji.agent.list = vi.fn(async () => [session, otherSession]);
    window.zhiji.agent.send = vi.fn(async () => undefined);
    window.zhiji.agent.onEvent = vi.fn((next) => { listener = next; return () => undefined; });
    render(<AgentPage/>);
    await waitFor(() => expect(listener).toBeTypeOf('function'));

    listener?.({ type: 'tool.evidence', sessionId: session.id, callId: crypto.randomUUID(), source: 'memory.search', hits: Array.from({ length: 8 }, (_, index) => ({ id: `journal_old${index}`, kind: 'journal' as const, date: '2026-08-20', excerpt: `A 旧证据 ${index + 1}` })) });
    listener?.({ type: 'tool.evidence', sessionId: otherSession.id, callId: crypto.randomUUID(), source: 'memory.search', hits: [{ id: 'journal_other1', kind: 'journal', date: '2026-08-21', excerpt: 'B 会话证据' }] });

    expect(await screen.findByText('A 旧证据 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /其他会话/ }));
    expect(await screen.findByText('B 会话证据')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /周复盘/ }));
    expect(screen.queryByText('A 旧证据 4')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开全部证据（最多 8 条）' }));
    expect(await screen.findByText('A 旧证据 8')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: '向知己 Agent 发送消息' }), { target: { value: '开始新一回合' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(window.zhiji.agent.send).toHaveBeenCalledWith({ sessionId: session.id, message: '开始新一回合' }));
    expect(screen.queryByText('A 旧证据 1')).not.toBeInTheDocument();
    expect(screen.queryByText('A 旧证据 8')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /其他会话/ }));
    expect(await screen.findByText('B 会话证据')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /周复盘/ }));
    expect(screen.queryByText('A 旧证据 1')).not.toBeInTheDocument();

    listener?.({ type: 'tool.evidence', sessionId: session.id, callId: crypto.randomUUID(), source: 'memory.search', hits: [{ id: 'journal_new1', kind: 'journal', date: '2026-08-22', excerpt: 'A 新回合证据' }] });
    expect(await screen.findByText('A 新回合证据')).toBeInTheDocument();
    expect(screen.queryByText('A 旧证据 1')).not.toBeInTheDocument();
  });

  it('requires an explicit page confirmation before resuming a formal workflow', async () => {
    let listener: ((event: AgentEvent) => void) | undefined;
    window.zhiji.agent.onEvent = vi.fn((next) => { listener = next; return () => undefined; });
    render(<AgentPage/>);
    await waitFor(() => expect(listener).toBeTypeOf('function'));
    listener?.({ type: 'workflow.approval', sessionId: session.id, approval: { approvalId: 'approval_abc123', workflow: 'reviews.generate-periodic', title: '确认生成周期复盘', summary: '已找到 3 条材料，确认后才会写入正式复盘。', preview: { token: '00000000-0000-4000-8000-000000000001', type: 'weekly', start: '2026-08-17', end: '2026-08-20', sources: [{ id: 'journal_abc123', date: '2026-08-20', excerpt: '本周记录' }] } } });
    expect(await screen.findByText('确认生成周期复盘')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认并继续' }));
    await waitFor(() => expect(window.zhiji.agent.confirm).toHaveBeenCalledWith({ sessionId: session.id, approvalId: 'approval_abc123' }));
  });

  it('offers a direct settings recovery action when the model needs an API key', async () => {
    let listener: ((event: AgentEvent) => void) | undefined;
    const onNavigate = vi.fn();
    window.zhiji.agent.onEvent = vi.fn((next) => { listener = next; return () => undefined; });
    render(<AgentPage onNavigate={onNavigate}/>);
    await waitFor(() => expect(listener).toBeTypeOf('function'));
    listener?.({ type: 'error', sessionId: session.id, message: '请先在设置中保存可用的 API Key。' });

    expect(await screen.findByText('请先在设置中保存可用的 API Key。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开设置' }));
    expect(onNavigate).toHaveBeenCalledWith({ view: 'settings', settingsSection: 'ai' });
  });
});
