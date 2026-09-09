import { useEffect, useState } from 'react';
import { AppShell } from './app-shell';
import type { NavigationTarget } from './navigation';
import { useAppData } from '../hooks/use-app-data';
import { TodayPage } from '../pages/today-page';
import { ReviewsPage } from '../pages/reviews-page';
import { SettingsPage } from '../pages/settings-page';
import { ProjectsPage } from '../pages/projects-page';
import { StartPage } from '../pages/start-page';
import { ConfirmDialog } from '../components/confirm-dialog';
import { AgentPage } from '../pages/agent-page';
import type { AgentWorkflowApproval } from '../../shared/schemas/agent-tools';
import { Button as DataButton } from '../components/button';

type PendingAgentApproval = { sessionId: string; approval: AgentWorkflowApproval };

export function App() {
  const [target, setTarget] = useState<NavigationTarget>({ view: 'start' });
  const [journalDirty, setJournalDirty] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<NavigationTarget | null>(null);
  const [agentApprovals, setAgentApprovals] = useState<PendingAgentApproval[]>([]);
  const data = useAppData();
  useEffect(() => window.zhiji.agent.onEvent((event) => {
    if (event.type === 'workflow.approval') setAgentApprovals((items) => [{ sessionId: event.sessionId, approval: event.approval }, ...items.filter((item) => item.approval.approvalId !== event.approval.approvalId)].slice(0, 6));
  }), []);
  if (data.loading) return <div className="boot-state"><span className="spinner"/>正在读取本地数据…</div>;
  const navigate = (next: NavigationTarget) => {
    if (target.view === 'journal' && journalDirty && next.view !== 'journal') { setPendingTarget(next); return; }
    setTarget(next);
  };
  return <AppShell view={target.view} onNavigate={navigate} connectionReady={data.hasApiKey}>
    {data.loadErrors.length > 0 && <div className="app-data-warning" role="alert"><div><strong>部分本地数据暂时无法读取</strong><span>{data.loadErrors.map((item) => item.message).join('；')}</span></div><DataButton variant="ghost" loading={data.refreshing} onClick={() => void data.refresh()}>重新读取</DataButton></div>}
    {target.view === 'start' ? <StartPage journals={data.journals} reviews={data.reviews} hasApiKey={data.hasApiKey} onNavigate={navigate}/>
      : target.view === 'agent' ? <AgentPage pendingApprovals={agentApprovals} onApprovalConsumed={(approvalId) => setAgentApprovals((items) => items.filter((item) => item.approval.approvalId !== approvalId))} onNavigate={navigate}/>
      : target.view === 'journal' ? <TodayPage journals={data.journals} projects={data.projects} reviews={data.reviews} intent={target.intent} hasApiKey={data.hasApiKey} onRefresh={data.refresh} onNavigate={navigate} onDirtyChange={setJournalDirty}/>
      : target.view === 'reviews' ? <ReviewsPage projects={data.projects.filter((item) => item.status === 'active')} reviews={data.reviews} intent={target.intent} onRefresh={data.refresh}/>
      : target.view === 'projects' ? <ProjectsPage projects={data.projects} journals={data.journals} onRefresh={data.refresh} onNavigate={navigate}/>
      : <SettingsPage initialSection={target.settingsSection} onSaved={data.refresh}/>}
    <ConfirmDialog
      open={pendingTarget !== null}
      title="离开日志编辑？"
      description="这条日志还没有保存，离开后未保存的内容会丢失。"
      confirmLabel="放弃并离开"
      onCancel={() => setPendingTarget(null)}
      onConfirm={() => { if (pendingTarget) setTarget(pendingTarget); setPendingTarget(null); }}
    />
  </AppShell>;
}
