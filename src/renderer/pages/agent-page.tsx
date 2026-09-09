import { useEffect, useMemo, useRef, useState } from 'react';
import { AgentEventSchema, type AgentEvidenceEvent, type AgentSession } from '../../shared/schemas/agent';
import { AgentPresentationCardSchema, type AgentPresentationCard, type AgentWorkflowApproval } from '../../shared/schemas/agent-tools';
import { Button } from '../components/button';
import { ConfirmDialog } from '../components/confirm-dialog';
import { MarkdownDocument } from '../components/markdown-document';
import { StatusBanner } from '../components/status-banner';
import { agentNavigationTarget, type NavigationTarget } from '../app/navigation';

const PROVIDER_LABELS = { openai: 'OpenAI', deepseek: 'DeepSeek', custom: '自定义' } as const;

type ToolActivity = { id: string; label: string; phase: 'started' | 'completed' | 'failed' };
type EvidenceGroup = Pick<AgentEvidenceEvent, 'callId' | 'source' | 'hits'> & { expanded: boolean };
type PendingAgentApproval = { sessionId: string; approval: AgentWorkflowApproval };

function evidenceKindLabel(kind: AgentEvidenceEvent['hits'][number]['kind']): string {
  return kind === 'journal' ? '日志' : kind === 'review' ? '复盘' : '已验证模式';
}

function evidenceNavigationTarget(hit: AgentEvidenceEvent['hits'][number]): NavigationTarget | null {
  if (hit.kind === 'journal') return { view: 'journal', intent: { type: 'records.journals', id: hit.id } };
  if (hit.kind === 'review') return { view: 'reviews', intent: { type: 'records.reviews', id: hit.id } };
  return null;
}

export function AgentPage({ onNavigate = () => undefined, pendingApprovals = [], onApprovalConsumed = () => undefined }: { onNavigate?: (target: NavigationTarget) => void; pendingApprovals?: PendingAgentApproval[]; onApprovalConsumed?: (approvalId: string) => void }) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [sessionsExpanded, setSessionsExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [stream, setStream] = useState<{ sessionId: string; messageId: string; content: string } | null>(null);
  const [error, setError] = useState('');
  const [activities, setActivities] = useState<Record<string, ToolActivity[]>>({});
  const [cards, setCards] = useState<Record<string, AgentPresentationCard[]>>({});
  const [evidenceGroups, setEvidenceGroups] = useState<Record<string, EvidenceGroup[]>>({});
  const [localApprovals, setLocalApprovals] = useState<PendingAgentApproval[]>([]);
  const [needsApiKey, setNeedsApiKey] = useState(false);
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);
  const [aiConfig, setAiConfig] = useState<Awaited<ReturnType<Window['zhiji']['settings']['getPublicConfig']>> | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    void window.zhiji.agent.list().then((items) => {
      setSessions(items);
      setSelectedId((current) => current ?? items[0]?.id ?? null);
    }).catch(() => setError('无法读取 Agent 会话，请重试。'));
    return window.zhiji.agent.onEvent((event) => {
      if (event.type === 'session.updated') {
        setSessions((items) => [event.session, ...items.filter((item) => item.id !== event.session.id)].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
        setSelectedId((current) => current ?? event.session.id);
      }
      if (event.type === 'message.delta') setStream((current) => current?.messageId === event.messageId ? { ...current, content: current.content + event.delta } : { sessionId: event.sessionId, messageId: event.messageId, content: event.delta });
      if (event.type === 'message.completed') setStream((current) => current?.messageId === event.message.id ? null : current);
      if (event.type === 'tool.activity') setActivities((items) => ({ ...items, [event.sessionId]: [{ id: event.callId, label: event.label, phase: event.phase }, ...(items[event.sessionId] ?? []).filter((item) => item.id !== event.callId)].slice(0, 8) }));
      if (event.type === 'ui.navigate') {
        const target = agentNavigationTarget(event.target);
        if (target) onNavigate(target);
        else setError('Agent 请求的页面无效，已拒绝打开。');
      }
      if (event.type === 'ui.present') {
        const card = AgentPresentationCardSchema.safeParse(event.card);
        if (card.success) setCards((items) => ({ ...items, [event.sessionId]: [card.data, ...(items[event.sessionId] ?? [])].slice(0, 6) }));
        else setError('Agent 请求的结果卡片无效，已拒绝展示。');
      }
      if (event.type === 'tool.evidence') {
        const evidence = AgentEventSchema.safeParse(event);
        if (evidence.success && evidence.data.type === 'tool.evidence' && evidence.data.hits.length > 0) {
          setEvidenceGroups((items) => ({ ...items, [event.sessionId]: [{ callId: event.callId, source: event.source, hits: event.hits, expanded: false }, ...(items[event.sessionId] ?? []).filter((item) => item.callId !== event.callId)].slice(0, 6) }));
        } else if (!evidence.success) setError('Agent 返回的检索证据无效，已拒绝展示。');
      }
      if (event.type === 'workflow.approval') setLocalApprovals((items) => [{ sessionId: event.sessionId, approval: event.approval }, ...items.filter((item) => item.approval.approvalId !== event.approval.approvalId)].slice(0, 6));
      if (event.type === 'error') {
        setError(event.message);
        setNeedsApiKey(/API Key|密钥/.test(event.message));
      }
    });
  }, []);

  useEffect(() => {
    if (!window.zhiji.settings) return;
    void window.zhiji.settings.getPublicConfig().then(setAiConfig).catch(() => setAiConfig(null));
  }, []);

  const selected = useMemo(() => sessions.find((item) => item.id === selectedId) ?? null, [selectedId, sessions]);
  const createSession = async (): Promise<AgentSession | null> => {
    try {
      setError('');
      setNeedsApiKey(false);
      const session = await window.zhiji.agent.start();
      setSelectedId(session.id);
      return session;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法启动知己 Agent。');
      return null;
    }
  };
  const send = async () => {
    const content = message.trim();
    if (!content) return;
    const session = selected ?? await createSession();
    if (!session) return;
    setMessage('');
    setError('');
    setNeedsApiKey(false);
    setEvidenceGroups((items) => { const next = { ...items }; delete next[session.id]; return next; });
    try { await window.zhiji.agent.send({ sessionId: session.id, message: content }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '发送失败，请重试。'); }
  };
  const stop = async () => {
    if (!selected) return;
    try { await window.zhiji.agent.cancel({ sessionId: selected.id }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '无法停止当前任务。'); }
  };
  const removeSession = async () => {
    const id = deleteSessionId;
    if (!id) return;
    try {
      await window.zhiji.agent.delete({ sessionId: id });
      const remaining = sessions.filter((item) => item.id !== id);
      setSessions(remaining);
      if (selectedId === id) setSelectedId(remaining[0]?.id ?? null);
      setDeleteSessionId(null);
      setStream(null);
      setActivities((items) => { const next = { ...items }; delete next[id]; return next; });
      setCards((items) => { const next = { ...items }; delete next[id]; return next; });
      setEvidenceGroups((items) => { const next = { ...items }; delete next[id]; return next; });
      for (const item of pendingApprovals.filter((current) => current.sessionId === id)) onApprovalConsumed(item.approval.approvalId);
      setLocalApprovals((items) => items.filter((item) => item.sessionId !== id));
      setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '删除会话失败，请重试。'); }
  };
  const confirmApproval = async (item: { sessionId: string; approval: AgentWorkflowApproval }) => {
    try {
      setError('');
      await window.zhiji.agent.confirm({ sessionId: item.sessionId, approvalId: item.approval.approvalId });
      onApprovalConsumed(item.approval.approvalId);
      setLocalApprovals((items) => items.filter((current) => current.approval.approvalId !== item.approval.approvalId));
    } catch (reason) { setError(reason instanceof Error ? reason.message : '确认失败，请重新预览材料。'); }
  };
  const toggleEvidence = (sessionId: string, callId: string) => {
    setEvidenceGroups((items) => ({ ...items, [sessionId]: (items[sessionId] ?? []).map((group) => group.callId === callId ? { ...group, expanded: !group.expanded } : group) }));
  };
  const selectedActivities = selected ? activities[selected.id] ?? [] : [];
  const selectedCards = selected ? cards[selected.id] ?? [] : [];
  const selectedEvidenceGroups = selected ? evidenceGroups[selected.id] ?? [] : [];
  const approvals = useMemo(() => {
    const merged = [...localApprovals, ...pendingApprovals];
    return merged.filter((item, index) => merged.findIndex((candidate) => candidate.approval.approvalId === item.approval.approvalId) === index);
  }, [localApprovals, pendingApprovals]);

  useEffect(() => {
    const node = messagesRef.current;
    if (node && stickToBottomRef.current) node.scrollTop = node.scrollHeight;
  }, [selected?.id, selected?.messages.length, stream?.messageId, stream?.content]);

  return <div className="agent-page">
    <header className="agent-page__toolbar"><button type="button" className="btn btn--ghost" aria-expanded={sessionsExpanded} onClick={() => setSessionsExpanded((value) => !value)}>{sessionsExpanded ? '收起会话' : '会话列表'}（{sessions.length}）</button><div className="button-row"><Button variant="ghost" onClick={() => onNavigate({ view: 'settings', settingsSection: 'ai' })}>模型设置</Button><Button variant="secondary" onClick={() => void createSession()}>新建会话</Button></div></header>
    <div className={`agent-layout${sessionsExpanded ? ' agent-layout--sessions-open' : ''}`}>
      <aside className={`agent-sessions${sessionsExpanded ? ' is-expanded' : ''}`} aria-label="Agent 会话列表">
        <div className="agent-sessions__body">
          <h3>会话</h3>
          {sessions.length === 0 && <p className="muted">新建会话后，开始描述你想完成的目标。</p>}
          <div className="agent-session-list">{sessions.map((session) => <button key={session.id} className={session.id === selectedId ? 'is-active' : ''} onClick={() => { setSelectedId(session.id); setError(''); }}><strong>{session.title}</strong><span>{session.status === 'running' ? '正在处理…' : session.status === 'failed' ? '运行已停止' : '等待继续'}</span></button>)}</div>
        </div>
      </aside>
      <section className="agent-conversation">
        {!selected && <div className="agent-empty"><h3>从一个目标开始</h3><p>例如：帮我梳理本周值得复盘的问题。</p><Button variant="primary" onClick={() => void createSession()}>开始对话</Button></div>}
        {selected && <>
          <div className="agent-conversation__header"><div><h3>{selected.title}</h3><span className="muted">{selected.status === 'running' ? 'Agent 正在思考与组织回复' : selected.status === 'failed' ? '运行已停止，可新建会话继续' : '可以继续输入'}</span>{aiConfig && <span className="agent-model-status" aria-label="当前 Agent 模型">模型：{PROVIDER_LABELS[aiConfig.providerId]} / {aiConfig.model} · 思考：{aiConfig.providerId === 'deepseek' && aiConfig.agentThinking === 'enabled' ? '开启' : '关闭'}</span>}</div><div className="button-row">{selected.status === 'running' && <Button variant="ghost" onClick={() => void stop()}>停止</Button>}<Button variant="danger" disabled={selected.status === 'running'} onClick={() => setDeleteSessionId(selected.id)}>删除会话</Button></div></div>
          <div ref={messagesRef} className="agent-messages" onScroll={(event) => { const node = event.currentTarget; stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48; }}>{selected.messages.map((item) => <article key={item.id} className={`agent-message agent-message--${item.role}`}><strong>{item.role === 'user' ? '你' : '知己 Agent'}</strong>{item.role === 'assistant' ? <MarkdownDocument>{item.content}</MarkdownDocument> : <p>{item.content}</p>}</article>)}
            {stream?.sessionId === selected.id && <article className="agent-message agent-message--assistant"><strong>知己 Agent</strong><MarkdownDocument>{stream.content}</MarkdownDocument><span className="stream-caret" aria-hidden="true"/></article>}
          </div>
          {(selectedActivities.length > 0 || selectedCards.length > 0 || selectedEvidenceGroups.length > 0 || approvals.some((item) => item.sessionId === selected.id)) && <section className="agent-tool-results" aria-label="Agent 工具活动">
            {selectedActivities.map((item) => <p key={item.id} className={`agent-tool-results__activity agent-tool-results__activity--${item.phase}`}>{item.phase === 'started' ? '正在' : item.phase === 'completed' ? '已完成' : '未完成'}：{item.label}</p>)}
            {approvals.filter((item) => item.sessionId === selected.id).map((item) => <article className="agent-result-card" key={item.approval.approvalId}><h4>{item.approval.title}</h4><p>{item.approval.summary}</p><p className="muted">材料：{item.approval.preview.sources.length} 条；确认后才会写入正式复盘。</p><ul>{item.approval.preview.sources.slice(0, 8).map((source) => <li key={source.id}>{source.date}：{source.excerpt}</li>)}</ul><Button variant="primary" disabled={selected.status === 'running'} onClick={() => void confirmApproval(item)}>确认并继续</Button></article>)}
            {selectedEvidenceGroups.map((group) => <article className="agent-evidence-group agent-result-card" key={group.callId} aria-label="检索证据"><div className="agent-evidence-group__header"><div><h4>本次检索证据</h4><p className="muted">来自已校验的本地记录；候选查询不会作为原文展示。</p></div><span className="agent-evidence-group__count">{group.hits.length} 条</span></div><ul className="agent-evidence-list">{group.hits.slice(0, group.expanded ? 8 : 3).map((hit) => { const target = evidenceNavigationTarget(hit); return <li key={hit.id} className="agent-evidence-card"><div className="agent-evidence-card__meta"><span>{evidenceKindLabel(hit.kind)}</span><time>{hit.date ?? '日期未知'}</time></div><p>{hit.excerpt}</p>{target && <Button variant="secondary" onClick={() => onNavigate(target)}>查看{evidenceKindLabel(hit.kind)}</Button>}</li>; })}</ul>{group.hits.length > 3 && <Button variant="ghost" onClick={() => toggleEvidence(selected.id, group.callId)}>{group.expanded ? '收起证据' : `展开全部证据（最多 ${Math.min(group.hits.length, 8)} 条）`}</Button>}</article>)}
            {selectedCards.map((card, index) => <article className="agent-result-card" key={`${card.title}-${index}`}><h4>{card.title}</h4><p>{card.summary}</p><div>{card.links.map((link, linkIndex) => <Button key={`${link.label}-${linkIndex}`} variant="secondary" onClick={() => { const target = agentNavigationTarget(link.target); if (target) onNavigate(target); else setError('结果链接无效，已拒绝打开。'); }}>{link.label}</Button>)}</div></article>)}
          </section>}
          {error && <StatusBanner tone="error"><span>{error}</span>{needsApiKey && <Button variant="secondary" onClick={() => onNavigate({ view: 'settings', settingsSection: 'ai' })}>打开设置</Button>}</StatusBanner>}
          <div className="agent-composer"><textarea aria-label="向知己 Agent 发送消息" value={message} rows={1} placeholder="描述目标、补充材料或继续追问…" disabled={selected.status === 'running'} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}/><Button variant="primary" disabled={!message.trim() || selected.status === 'running'} onClick={() => void send()}>发送</Button></div>
        </>}
      </section>
    </div>
    <ConfirmDialog open={deleteSessionId !== null} title="删除这个 Agent 会话？" description="会话消息会移入系统回收站，日志、复盘和其他会话不受影响。" confirmLabel="确认删除" onCancel={() => setDeleteSessionId(null)} onConfirm={() => void removeSession()}/>
    {!selected && error && <StatusBanner tone="error"><span>{error}</span>{needsApiKey && <Button variant="secondary" onClick={() => onNavigate({ view: 'settings', settingsSection: 'ai' })}>打开设置</Button>}</StatusBanner>}
  </div>;
}
