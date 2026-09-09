import { useEffect, useState } from 'react';
import type { StructuredOutputDiagnostics } from '../../shared/errors/app-error';
import type { InsightReviewType, Project, Review } from '../../shared/schemas/domain';
import type { NavigationIntent } from '../app/navigation';
import { Button } from '../components/button';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Field } from '../components/field';
import { PageHeader } from '../components/page-header';
import { StatusBanner } from '../components/status-banner';
import { MarkdownDocument } from '../components/markdown-document';
import { StructuredDiagnostics } from '../components/structured-diagnostics';
import { MaterialPreview } from '../features/reviews/material-preview';
import { PatternPanel } from '../features/patterns/pattern-panel';
import { ReviewTypeCard } from '../features/reviews/review-type-card';
import { InsightTools } from '../features/reviews/insight-tools';
import { getDefaultReviewRange } from '../utils/date-defaults';
import { toLocalDateString } from '../utils/local-date';
import { safeGenerationError } from '../utils/safe-generation-error';
import { RecordBrowser } from './history-page';

const today = toLocalDateString();
type Type = 'weekly' | 'monthly' | 'project';
type SelectedType = Type | InsightReviewType;

const TASK_PHASE_LABELS: Record<string, string> = {
  queued: '排队中…',
  building_context: '正在整理材料…',
  generating: 'AI 正在生成复盘…',
  retrying_format: '正在重新整理复盘格式…',
  validating: '正在校验结构…',
  saving: '正在保存到本机…',
};

export function ReviewsPage({ projects, reviews = [], intent, onRefresh = () => undefined }: { projects: Project[]; reviews?: Review[]; intent?: NavigationIntent; onRefresh?(): Promise<void> | void }) {
  const initialType: SelectedType | null = intent?.type === 'review.weekly' ? 'weekly' : intent?.type === 'review.monthly' ? 'monthly' : intent?.type === 'review.yearly' ? 'yearly' : intent?.type === 'review.coach' ? 'coach' : intent?.type === 'review.project' ? 'project' : null;
  const [section, setSection] = useState<'create' | 'history'>(intent?.type === 'records.reviews' ? 'history' : 'create');
  const [type, setType] = useState<SelectedType | null>(initialType);
  const [range, setRange] = useState(initialType === 'weekly' || initialType === 'monthly' || initialType === 'project' ? getDefaultReviewRange(initialType, today) : { start: today, end: today });
  const [projectId, setProjectId] = useState(intent?.type === 'review.project' ? intent.projectId : '');
  const [showDates, setShowDates] = useState(initialType === 'project');
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof window.zhiji.reviews.preview>> | null>(null);
  const [result, setResult] = useState<Review | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showInsights, setShowInsights] = useState(false);
  const [topic, setTopic] = useState('');
  const [taskPhase, setTaskPhase] = useState('');
  const [periodicFailure, setPeriodicFailure] = useState<StructuredOutputDiagnostics | null>(null);
  useEffect(() => window.zhiji.reviews.onTaskPhase((phase) => setTaskPhase(TASK_PHASE_LABELS[phase] ?? '')), []);

  const choose = (next: Type) => { setSection('create'); setType(next); setRange(getDefaultReviewRange(next, today)); setShowDates(next === 'project'); setPreview(null); setResult(null); setPeriodicFailure(null); setState('idle'); setMessage(''); };
  const chooseInsight = (next: InsightReviewType) => {
    const year = today.slice(0, 4);
    const start = next === 'yearly' ? `${year}-01-01` : (() => { const date = new Date(`${today}T12:00:00.000Z`); date.setUTCDate(date.getUTCDate() - (next === 'coach' ? 6 : 89)); return date.toISOString().slice(0, 10); })();
    setSection('create'); setType(next); setRange({ start, end: next === 'yearly' ? `${year}-12-31` : today }); setShowDates(true); setPreview(null); setResult(null); setPeriodicFailure(null); setState('idle'); setMessage('');
  };
  const chooseMonth = (month?: string) => { choose('monthly'); if (month) setRange(getDefaultReviewRange('monthly', `${month}-15`)); };
  const chooseYear = (year?: string) => { setShowInsights(true); chooseInsight('yearly'); if (year) setRange({ start: `${year}-01-01`, end: `${year}-12-31` }); };
  useEffect(() => {
    if (intent?.type === 'review.weekly') choose('weekly');
    if (intent?.type === 'review.monthly') chooseMonth(intent.month);
    if (intent?.type === 'review.yearly') chooseYear(intent.year);
    if (intent?.type === 'review.coach') { setShowInsights(true); chooseInsight('coach'); }
    if (intent?.type === 'review.project') { choose('project'); setProjectId(intent.projectId); }
  }, [intent]);
  const changeRange = (key: 'start' | 'end', value: string) => { setRange((old) => ({ ...old, [key]: value })); setPreview(null); setResult(null); setPeriodicFailure(null); setState('idle'); };
  const isInsight = type === 'coach' || type === 'yearly' || type === 'life-design';
  const input = type ? { type, ...range, ...(type === 'project' && projectId ? { projectId } : {}), ...(type === 'life-design' && topic.trim() ? { topic: topic.trim() } : {}) } : null;
  const loadPreview = async () => { if (!input) return; setState('loading'); setPeriodicFailure(null); setMessage('正在读取本地材料…'); try { const next = isInsight ? await window.zhiji.reviews.previewInsight(input as Parameters<typeof window.zhiji.reviews.previewInsight>[0]) : await window.zhiji.reviews.preview(input as Parameters<typeof window.zhiji.reviews.preview>[0]); setPreview(next); setState('idle'); setMessage(`已找到 ${next.sources.length} 条材料，请确认后生成`); } catch (reason) { setState('error'); setMessage(`无法预览：${reason instanceof Error ? reason.message : '所选范围内没有材料'}`); } };
  const generate = async () => {
    if (!input || !preview) return;
    setState('loading'); setMessage(''); setPeriodicFailure(null);
    try {
      if (isInsight) {
        const next = await window.zhiji.reviews.generateInsight({ ...input, previewToken: preview.token } as Parameters<typeof window.zhiji.reviews.generateInsight>[0]);
        setResult(next);
      } else {
        const next = await window.zhiji.reviews.generatePeriodic({ ...input, previewToken: preview.token } as Parameters<typeof window.zhiji.reviews.generatePeriodic>[0]);
        if (next.kind === 'review') setResult(next.review);
        else if (next.kind === 'clarification') { setResult(null); setState('error'); setMessage(next.question); return; }
        else { setResult(null); setState('error'); setMessage(next.message); setPeriodicFailure(next.diagnostics); return; }
      }
      let refreshFailed = false;
      try { await onRefresh?.(); } catch { refreshFailed = true; }
      setState('success'); setMessage(refreshFailed ? '复盘已保存到本机，但历史列表刷新失败；稍后可重新读取。' : '复盘已保存到本机');
    } catch (reason) { setState('error'); setMessage(safeGenerationError(reason)); }
  };
  const removeReview = async () => { if (!deleteId) return; try { await window.zhiji.reviews.delete(deleteId); if (result?.id === deleteId) setResult(null); setDeleteId(null); await onRefresh(); } catch (reason) { setState('error'); setMessage(`移除失败：${reason instanceof Error ? reason.message : '回收站不可用'}`); } };

  return <>
    <PageHeader title={section === 'create' ? '把一段时间的经历放在一起看' : '历史复盘'} description={section === 'create' ? '先预览材料，再生成复盘；不会自动覆盖已有结果。' : '查看日反馈、周报、月报和项目复盘。'} action={<div className="page-tabs"><button className={section === 'create' ? 'is-active' : ''} onClick={() => setSection('create')}>生成复盘</button><button className={section === 'history' ? 'is-active' : ''} onClick={() => setSection('history')}>历史复盘</button></div>}/>
    {section === 'history' ? <>{message && <StatusBanner tone={state === 'error' ? 'error' : state === 'success' ? 'success' : 'info'}>{message}</StatusBanner>}<RecordBrowser journals={[]} reviews={result && !reviews.some((item) => item.id === result.id) ? [result, ...reviews] : reviews} projects={projects} allowedKinds={['daily', 'weekly', 'monthly', 'project', 'coach', 'yearly', 'life-design']} initialSelectedId={intent?.type === 'records.reviews' ? intent.id : undefined} onDelete={(item) => { setDeleteId(item.id); setMessage(''); }}/><ConfirmDialog open={deleteId !== null} title="移除这份复盘？" description="来源日志不会被删除。" confirmLabel="确认移除" onCancel={() => setDeleteId(null)} onConfirm={() => void removeReview()}/></> : <>
      <div className="review-cards"><ReviewTypeCard badge="周" title="本周复盘" description="读取本周日志与日反馈，找出有效行动、反例和下一步。" action="预览本周材料" onSelect={() => choose('weekly')}/><ReviewTypeCard badge="月" title="本月复盘" description="综合日志、日反馈和周复盘，检查跨周模式。" action="预览本月材料" onSelect={() => choose('monthly')}/><ReviewTypeCard badge="项" title="项目复盘" description="使用项目关联日志，也可以补选一段日期范围。" action="选择项目与范围" onSelect={() => choose('project')}/></div>
      <div className="insight-disclosure"><Button variant="ghost" onClick={() => setShowInsights((value) => !value)}>{showInsights ? '收起更多洞察' : '更多洞察'}</Button><span>低频工具，需要时再打开</span></div>
      {showInsights && <InsightTools onSelect={chooseInsight}/>}
      {type && <section className="card review-config"><h3>{type === 'weekly' ? '本周复盘' : type === 'monthly' ? '本月复盘' : type === 'project' ? '项目复盘' : type === 'coach' ? '日志质量检查' : type === 'yearly' ? '年度回顾' : '方向校准'}设置</h3>{type === 'project' && <Field label="项目（可选）"><select value={projectId} onChange={(event) => { setProjectId(event.target.value); setPreview(null); setPeriodicFailure(null); }}><option value="">仅使用日期范围</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field>}{type === 'life-design' && <Field label="想校准的问题（可选）"><input value={topic} maxLength={120} onChange={(event) => { setTopic(event.target.value); setPreview(null); }}/></Field>}{!showDates && <Button variant="ghost" onClick={() => setShowDates(true)}>调整日期</Button>}{showDates && <div className="date-row"><Field label="开始日期"><input aria-label="开始日期" type="date" value={range.start} onChange={(event) => changeRange('start', event.target.value)}/></Field><Field label="结束日期"><input aria-label="结束日期" type="date" value={range.end} onChange={(event) => changeRange('end', event.target.value)}/></Field></div>}{(message || (state === 'loading' && preview)) && <StatusBanner tone={state === 'error' ? 'error' : state === 'success' ? 'success' : 'info'}>{state === 'loading' && preview ? (taskPhase || '正在生成复盘…') : message}</StatusBanner>}{periodicFailure && <div className="review-failure-details"><StructuredDiagnostics diagnostics={periodicFailure}/></div>}<div className="button-row"><Button variant="ghost" loading={state === 'loading' && !preview} onClick={() => void loadPreview()}>预览材料</Button><Button variant="primary" loading={state === 'loading' && Boolean(preview)} disabled={!preview || state === 'success'} onClick={() => void generate()}>确认并生成</Button>{state === 'success' && <Button variant="secondary" onClick={() => setSection('history')}>查看历史复盘</Button>}</div></section>}
      {preview && <MaterialPreview sources={preview.sources}/>} {result && <article className="card inline-review"><h3>复盘结果</h3><MarkdownDocument>{result.body}</MarkdownDocument></article>}{result && <PatternPanel review={result}/>}
    </>}
  </>;
}
