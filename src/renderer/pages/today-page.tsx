import { useEffect, useMemo, useRef, useState } from 'react';
import type { StructuredOutputDiagnostics } from '../../shared/errors/app-error';
import type { Journal, JournalTemplate, Project, Review } from '../../shared/schemas/domain';
import type { NavigationIntent, NavigationTarget } from '../app/navigation';
import { Button } from '../components/button';
import { ConfirmDialog } from '../components/confirm-dialog';
import { StatusBanner } from '../components/status-banner';
import { StructuredDiagnostics } from '../components/structured-diagnostics';
import { ArrowRightIcon, ChevronRightIcon, HistoryIcon, LockIcon, ProjectsIcon, ReviewsIcon, TodayIcon } from '../components/icons';
import { DailyFeedbackPanel } from '../features/daily-feedback-panel';
import { TemplateManager } from '../features/templates/template-manager';
import { RecordBrowser } from './history-page';
import { toLocalDateString } from '../utils/local-date';
import { safeGenerationError } from '../utils/safe-generation-error';

const today = toLocalDateString();

const TASK_PHASE_LABELS: Record<string, string> = {
  queued: '排队中…',
  building_context: '正在整理材料…',
  generating: 'AI 正在生成反馈…',
  validating: '正在校验结构…',
  retrying_format: '正在重新整理反馈格式…',
  saving: '正在保存到本机…',
};

function formatJournalDate(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return { title: value, year: '', weekday: '' };
  return {
    title: `${parsed.getMonth() + 1}月${parsed.getDate()}日`,
    year: `${parsed.getFullYear()}年`,
    weekday: new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(parsed),
  };
}

export function TodayPage({ journals, projects, reviews, intent, hasApiKey = true, onRefresh, onNavigate, onDirtyChange }: { journals: Journal[]; projects: Project[]; reviews: Review[]; intent?: NavigationIntent; hasApiKey?: boolean; onRefresh(): Promise<void> | void; onNavigate(target: NavigationTarget): void; onDirtyChange?(dirty: boolean): void }) {
  const [section, setSection] = useState<'compose' | 'records'>(intent?.type === 'records.journals' ? 'records' : 'compose');
  const [workspace, setWorkspace] = useState<'journal' | 'feedback'>('journal');
  const [date, setDate] = useState(today);
  const [body, setBody] = useState('');
  const [projectId, setProjectId] = useState('');
  const [editing, setEditing] = useState<Journal | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [reviewState, setReviewState] = useState<'idle' | 'loading' | 'success' | 'error' | 'info'>('idle');
  const [reviewMessage, setReviewMessage] = useState('');
  const [localReview, setLocalReview] = useState<{ date: string; journalId: string; review: Review } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [taskPhase, setTaskPhase] = useState('');
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null);
  const [templates, setTemplates] = useState<JournalTemplate[]>([]);
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [dailyFailure, setDailyFailure] = useState<StructuredOutputDiagnostics | null>(null);
  const [retryDate, setRetryDate] = useState<string | null>(null);
  const [retryJournalId, setRetryJournalId] = useState<string | null>(null);
  const [historySelectionId, setHistorySelectionId] = useState<string | undefined>(intent?.type === 'records.journals' ? intent.id : undefined);
  const [generatingDate, setGeneratingDate] = useState<string | null>(null);
  const [generatingJournalId, setGeneratingJournalId] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const dateControlRef = useRef<HTMLDetailsElement>(null);
  const draftRevisionRef = useRef(0);
  const saveInFlightRef = useRef<Promise<Journal | null> | null>(null);
  const reviewInFlightRef = useRef(false);
  const suppressAutoLoadRef = useRef(false);
  const contextRef = useRef({ section, date, historySelectionId });
  contextRef.current = { section, date, historySelectionId };
  const matchesSavedJournal = Boolean(editing
    && editing.date === date
    && editing.body === body
    && (editing.projectIds[0] ?? '') === projectId);
  const dirty = editing ? !matchesSavedJournal : Boolean(body.trim());
  const sameDayJournals = useMemo(() => journals.filter((item) => item.date === date && item.body.trim()), [journals, date]);

  const clearSaveStatus = () => { setSaveState('idle'); setSaveMessage(''); };
  const markDraftChanged = () => { draftRevisionRef.current += 1; clearSaveStatus(); };
  // 未保存时先弹确认框，确认后才执行动作；干净时直接执行
  const guardDiscard = (action: () => void) => { if (dirty) setPendingDiscard(() => action); else action(); };

  useEffect(() => {
    if (intent?.type === 'records.journals') {
      setSection('records');
      setHistorySelectionId(intent.id);
    }
    if (intent?.type === 'journal.compose' || intent?.type === 'journal.generate-daily') {
      setSection('compose');
      window.setTimeout(() => editorRef.current?.focus(), 0);
    }
  }, [intent]);
  useEffect(() => {
    if (section !== 'compose' || suppressAutoLoadRef.current || dirty || editing || body.trim()) return;
    const candidates = journals.filter((item) => item.date === date && item.body.trim());
    if (candidates.length !== 1) return;
    const journal = candidates[0];
    draftRevisionRef.current += 1;
    setEditing(journal);
    setBody(journal.body);
    setProjectId(journal.projectIds[0] ?? '');
    setWorkspace('journal');
    clearSaveStatus();
  }, [body, date, dirty, editing, journals, section]);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => window.zhiji.reviews.onTaskPhase((phase) => setTaskPhase(TASK_PHASE_LABELS[phase] ?? '')), []);
  useEffect(() => { void window.zhiji.templates.list().then(setTemplates).catch(() => undefined); }, []);

  const displayDate = useMemo(() => formatJournalDate(date), [date]);

  const save = async (): Promise<Journal | null> => {
    if (!body.trim()) return null;
    if (saveInFlightRef.current) return saveInFlightRef.current;
    const snapshot = { date, body, projectId, editing };
    const revisionAtStart = draftRevisionRef.current;
    const request = (async () => {
      setSaveState('loading');
      setSaveMessage('');
      try {
        const common = { date: snapshot.date, body: snapshot.body, projectIds: snapshot.projectId ? [snapshot.projectId] : [] };
        const saved = snapshot.editing
          ? await window.zhiji.journals.update({ ...common, id: snapshot.editing.id, expectedUpdatedAt: snapshot.editing.updatedAt })
          : await window.zhiji.journals.create(common);
        if (!saved) throw new Error('保存服务未返回日志。');
        const draftStillMatches = draftRevisionRef.current === revisionAtStart
          && date === snapshot.date
          && body === snapshot.body
          && projectId === snapshot.projectId;
        setSaveState('success');
        setSaveMessage(draftStillMatches ? '已保存到本机' : '已保存到本机；你有新的修改');
        // 始终绑定服务端返回的 ID；只在没有新输入时回填字段，避免迟到响应覆盖草稿。
        setEditing(saved);
        if (draftStillMatches) {
          setBody(saved.body);
          setDate(saved.date);
          setProjectId(saved.projectIds[0] ?? '');
        }
        try { await onRefresh(); } catch { /* 正文已经保存，刷新失败不改写保存结果。 */ }
        return saved;
      } catch (reason) {
        setSaveState('error');
        setSaveMessage(`保存失败：${reason instanceof Error ? reason.message : '请稍后重试'}`);
        return null;
      }
    })();
    saveInFlightRef.current = request;
    try { return await request; }
    finally { if (saveInFlightRef.current === request) saveInFlightRef.current = null; }
  };

  const runDailyReview = async (request: { date: string; journalId?: string; regenerate?: boolean }, pendingBody: boolean) => {
    if (reviewInFlightRef.current) return;
    if (!hasApiKey) { onNavigate({ view: 'settings', settingsSection: 'ai' }); return; }
    reviewInFlightRef.current = true;
    const sectionAtStart = section;
    const selectionAtStart = historySelectionId;
    const revisionBeforeSave = draftRevisionRef.current;
    let reviewDate = request.date;
    let journalId = request.journalId ?? (section === 'compose' ? editing?.id : undefined);
    setGeneratingDate(reviewDate);
    setGeneratingJournalId(journalId ?? null);
    setReviewState('loading');
    setReviewMessage('');
    setDailyFailure(null);
    setRetryDate(null);
    setRetryJournalId(null);
    const surfaceMatches = () => {
      const current = contextRef.current;
      return sectionAtStart === 'records'
        ? current.section === 'records' && current.historySelectionId === selectionAtStart
        : current.section === 'compose' && current.date === reviewDate;
    };
    try {
      if (pendingBody) {
        const journal = await save();
        if (!journal) {
          setReviewState('idle');
          return;
        }
        reviewDate = journal.date;
        journalId = journal.id;
        setGeneratingDate(reviewDate);
        setGeneratingJournalId(journalId);
        if (draftRevisionRef.current !== revisionBeforeSave || contextRef.current.date !== reviewDate) {
          if (!surfaceMatches()) return;
          setReviewState('info');
          setReviewMessage('日志已保存；你有新的修改，确认后再生成反馈。');
          return;
        }
      }
      if (!journalId) {
        const candidates = journals.filter((item) => item.date === reviewDate && item.body.trim());
        if (candidates.length !== 1) {
          if (surfaceMatches()) {
            setReviewState('info');
            setReviewMessage(candidates.length > 1 ? '这一天有多条日志，请先从过去日志中选择一条。' : '请先保存一条日志，再生成反馈。');
          }
          return;
        }
        journalId = candidates[0].id;
        setGeneratingJournalId(journalId);
      }
      const revisionAtGeneration = draftRevisionRef.current;
      const result = await window.zhiji.reviews.generateDaily({ date: reviewDate, journalId, ...(request.regenerate ? { regenerate: true } : {}) });
      if (result.kind === 'clarification') {
        if (!surfaceMatches()) return;
        setReviewState('info');
        setReviewMessage(result.question);
        return;
      }
      if (result.kind === 'error') {
        if (!surfaceMatches()) return;
        setReviewState('error');
        setReviewMessage(result.message);
        setDailyFailure(result.diagnostics);
        setRetryDate(reviewDate);
        setRetryJournalId(journalId);
        return;
      }
      try { await onRefresh(); } catch { /* 生成结果仍由本地返回值展示。 */ }
      const sameContext = draftRevisionRef.current === revisionAtGeneration
        && (sectionAtStart === 'records'
          ? section === 'records' && historySelectionId === selectionAtStart
          : section === 'compose' && date === reviewDate);
      if (sameContext) {
        setLocalReview({ date: reviewDate, journalId, review: result.review });
        setWorkspace('feedback');
      }
      if (surfaceMatches()) {
        setReviewState('success');
        setReviewMessage(sameContext
          ? (result.cached ? '已读取本机已有反馈' : `这一天的反馈已生成并保存${result.warning ? `；${result.warning}` : ''}`)
          : '反馈已生成并保存；你有新的修改，当前编辑内容未被覆盖。');
      }
    } catch (reason) {
      if (!surfaceMatches()) return;
      setReviewState('error');
      setReviewMessage(safeGenerationError(reason));
      setRetryDate(reviewDate);
      setRetryJournalId(journalId ?? null);
    } finally {
      reviewInFlightRef.current = false;
      setGeneratingDate(null);
      setGeneratingJournalId(null);
    }
  };

  const startNewJournal = () => guardDiscard(() => {
    draftRevisionRef.current += 1;
    suppressAutoLoadRef.current = true;
    setEditing(null);
    setBody('');
    setDate(today);
    setProjectId('');
    setWorkspace('journal');
    clearSaveStatus();
    setReviewState('idle');
    setReviewMessage('');
    setDailyFailure(null);
    setRetryDate(null);
    setRetryJournalId(null);
  });
  const generate = async () => {
    if (!body.trim()) {
      setReviewState('info');
      setReviewMessage('先写点内容，再保存或生成反馈。');
      return;
    }
    await runDailyReview({ date, journalId: editing?.id }, dirty);
  };
  const generateForDate = async (request: { date: string; journalId: string; regenerate?: boolean }) => runDailyReview(request, false);
  const retryDailyReview = () => {
    if (!retryDate || !retryJournalId) return;
    if (dirty && date === retryDate && editing?.id === retryJournalId && !body.trim()) {
      setReviewState('info');
      setReviewMessage('当前有未保存的空内容修改，请补充后再重试。');
      return;
    }
    void runDailyReview({ date: retryDate, journalId: retryJournalId, regenerate: true }, dirty && date === retryDate && editing?.id === retryJournalId);
  };
  const removeJournal = async () => {
    if (!deleteId) return;
    try { await window.zhiji.journals.delete(deleteId); setDeleteId(null); await onRefresh(); }
    catch (reason) { setReviewState('error'); setReviewMessage(`移除失败：${reason instanceof Error ? reason.message : '回收站不可用'}`); }
  };
  const editJournal = (id: string) => guardDiscard(() => {
    const journal = journals.find((item) => item.id === id);
    if (!journal) return;
    draftRevisionRef.current += 1;
    setEditing(journal);
    setDate(journal.date);
    setBody(journal.body);
    setProjectId(journal.projectIds[0] ?? '');
    setSection('compose');
    setWorkspace('journal');
    suppressAutoLoadRef.current = false;
    clearSaveStatus();
    setReviewMessage('');
    setReviewState('idle');
  });
  const openSameDayRecords = () => {
    setHistorySelectionId(sameDayJournals[0]?.id);
    setSection('records');
  };

  const changeDate = (nextDate: string) => {
    if (!nextDate || nextDate === date) return;
    guardDiscard(() => {
      draftRevisionRef.current += 1;
      suppressAutoLoadRef.current = false;
      setEditing(null);
      setBody('');
      setProjectId('');
      setDate(nextDate);
      setWorkspace('journal');
      clearSaveStatus();
      setReviewState('idle');
      setReviewMessage('');
      setDailyFailure(null);
      setRetryDate(null);
      setRetryJournalId(null);
    });
  };

  const canGenerate = hasApiKey;
  const primaryLabel = canGenerate ? (body.trim() ? (date === today ? '保存并生成今日反馈' : '保存并生成这一天的反馈') : '保存并生成反馈') : '保存日志';
  const busy = saveState === 'loading' || reviewState === 'loading';
  const draftLabel = dirty ? (editing ? '编辑中' : '尚未保存') : editing ? '已保存' : '尚未保存';
  const closeDateControl = () => {
    const node = dateControlRef.current;
    if (!node?.open) return;
    node.open = false;
    node.querySelector<HTMLElement>('summary')?.focus();
  };

  return <div className={`today-page today-page--${section}`}>
    <header className="journal-toolbar">
      <div className="journal-toolbar__title"><h1>日志</h1><span className="journal-toolbar__divider" aria-hidden="true"/><span>留下一段真实经历</span></div>
      <div className="journal-mode-switch" role="group" aria-label="日志模式">
        <button type="button" className={section === 'compose' ? 'is-active' : ''} aria-pressed={section === 'compose'} onClick={() => setSection('compose')}><TodayIcon aria-hidden="true"/>写日志</button>
        <button type="button" className={section === 'records' ? 'is-active' : ''} aria-pressed={section === 'records'} onClick={() => guardDiscard(() => setSection('records'))}><HistoryIcon aria-hidden="true"/>过去日志</button>
      </div>
    </header>
    {section === 'records' ? <>
      <div className="journal-records-content">
        <div className="records-heading"><h2>过去日志</h2><p>按日期找到过去的原始记录，反馈也固定放在所选日志旁边。</p></div>
        {reviewMessage && <StatusBanner tone={reviewState === 'error' ? 'error' : reviewState === 'success' ? 'success' : 'info'}>{reviewMessage}</StatusBanner>}
        <RecordBrowser journals={journals} reviews={reviews} projects={projects} allowedKinds={['journal']} initialSelectedId={historySelectionId} hasApiKey={hasApiKey} dailyReviewOverride={localReview?.review} generatingDate={generatingDate ?? undefined} generatingJournalId={generatingJournalId} dailyFeedbackMessage={generatingDate ? reviewMessage : undefined} onSelectionChange={setHistorySelectionId} onDelete={(item) => { setDeleteId(item.id); setReviewMessage(''); }} onGenerateDaily={(request) => void generateForDate(request)} onConfigureAi={() => onNavigate({ view: 'settings', settingsSection: 'ai' })} onEditJournal={editJournal}/>
      </div>
      <ConfirmDialog open={deleteId !== null} title="移除这条日志？" description="已有复盘不会同步删除。" confirmLabel="确认移除" onCancel={() => setDeleteId(null)} onConfirm={() => void removeJournal()}/>
    </> : <>
      <div className="journal-stage">
        <h2 className="visually-hidden">写一条日志</h2>
        <section className="journal-surface" aria-label="日志编辑器">
          <header className="journal-head">
            <div>
              <div className="date-heading"><h2>{displayDate.title}</h2><span>{displayDate.weekday}</span></div>
              <details ref={dateControlRef} className="date-control" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closeDateControl(); } }}>
                <summary><span>{displayDate.year}</span><span>更改日期</span><ChevronRightIcon aria-hidden="true"/></summary>
                <div className="date-popover"><label htmlFor="journal-date-input">日志日期</label><input id="journal-date-input" aria-label="日志日期" type="date" max={today} value={date} onChange={(event) => { changeDate(event.target.value); closeDateControl(); }}/></div>
              </details>
            </div>
            <span className="draft-state"><TodayIcon aria-hidden="true"/><span>{draftLabel}</span></span>
          </header>
          <nav className="journal-workspace-switch" aria-label="日志工作区">
            <button type="button" className={workspace === 'journal' ? 'is-active' : ''} aria-pressed={workspace === 'journal'} onClick={() => setWorkspace('journal')}>日志</button>
            <button type="button" className={workspace === 'feedback' ? 'is-active' : ''} aria-pressed={workspace === 'feedback'} onClick={() => setWorkspace('feedback')}>日分析</button>
          </nav>
          {!editing && sameDayJournals.length > 0 && <div className="same-day-notice" role="note">
            <div><strong>这一天已有 {sameDayJournals.length} 条日志。</strong><span>先从过去日志中选择要继续编辑或分析的那一条。</span></div>
            {sameDayJournals.length === 1
              ? <Button variant="ghost" onClick={() => editJournal(sameDayJournals[0].id)}>继续编辑已有日志</Button>
              : <Button variant="ghost" onClick={openSameDayRecords}>查看已有日志</Button>}
          </div>}
          {workspace === 'journal' ? <>
          <div className="journal-tools">
            <label className="tool-chip"><ProjectsIcon aria-hidden="true"/><span className="tool-chip__label">项目</span><select aria-label="关联项目（可选）" value={projectId} onChange={(event) => { markDraftChanged(); setProjectId(event.target.value); }}><option value="">不关联项目</option>{projects.filter((item) => item.status === 'active').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="tool-chip"><ReviewsIcon aria-hidden="true"/><span className="tool-chip__label">模板</span><select aria-label="选择模板" value="" onChange={(event) => { if (event.target.value) { const tpl = templates.find((t) => t.name === event.target.value); if (tpl) { markDraftChanged(); setBody((old) => (old ? `${old}\n\n${tpl.body}` : tpl.body)); } } event.currentTarget.value = ''; }}><option value="">日志模板</option>{templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}</select></label>
            <button type="button" className="template-entry__manage" onClick={() => setTemplateManagerOpen(true)}>管理模板</button>
          </div>
          <div className="writing">
            {!body.trim() && <p className="writing-hint">不必组织得很完整。先记下发生了什么。</p>}
            <textarea ref={editorRef} aria-label="日志内容" value={body} onChange={(event) => { markDraftChanged(); setBody(event.target.value); }} placeholder="今天，有什么值得记下来？"/>
          </div>
          {saveMessage && <StatusBanner tone={saveState === 'error' ? 'error' : 'success'}>{saveMessage}</StatusBanner>}
          <footer className="composer-footer">
            <span className="word-count">{body.length} 字</span>
            <div className="save-actions">
              {editing && <Button variant="ghost" onClick={startNewJournal}>新建日志</Button>}
              {canGenerate && <Button variant="secondary" loading={saveState === 'loading'} disabled={busy || !body.trim()} onClick={() => void save()}>{date === today ? '仅保存日志' : '保存日志'}</Button>}
              <Button variant="primary" loading={busy} disabled={busy || !body.trim()} onClick={() => void (canGenerate ? generate() : save())}>{primaryLabel}{canGenerate && <ArrowRightIcon aria-hidden="true"/>}</Button>
            </div>
          </footer>
          {reviewState === 'loading' && <StatusBanner tone="info">{taskPhase || '正在根据日志生成反馈…'}</StatusBanner>}
          {reviewState !== 'loading' && reviewMessage && <StatusBanner tone={reviewState === 'error' ? 'error' : reviewState === 'success' ? 'success' : 'info'}>{reviewMessage}</StatusBanner>}
          {reviewState === 'error' && retryDate && <div className="review-failure-actions">
            <Button variant="secondary" onClick={retryDailyReview}>重新生成</Button>
            {dailyFailure && <StructuredDiagnostics diagnostics={dailyFailure}/>}
          </div>}
          </> : <>
            {saveMessage && <StatusBanner tone={saveState === 'error' ? 'error' : 'success'}>{saveMessage}</StatusBanner>}
            <DailyFeedbackPanel
              date={date}
              journal={editing ?? (sameDayJournals.length === 1 ? sameDayJournals[0] : undefined)}
              journals={journals}
              reviews={reviews}
              overrideReview={localReview?.date === date && localReview.journalId === (editing?.id ?? sameDayJournals[0]?.id) ? localReview.review : undefined}
              hasApiKey={hasApiKey}
              isGenerating={generatingDate === date && generatingJournalId === (editing?.id ?? sameDayJournals[0]?.id)}
              message={reviewMessage}
              onGenerate={(request) => void runDailyReview(request, dirty && request.journalId === editing?.id)}
              onConfigureAi={() => onNavigate({ view: 'settings', settingsSection: 'ai' })}
            />
            {reviewState === 'error' && retryDate && <div className="review-failure-actions">
              <Button variant="secondary" onClick={retryDailyReview}>重新生成</Button>
              {dailyFailure && <StructuredDiagnostics diagnostics={dailyFailure}/>}
            </div>}
          </>}
        </section>
        <div className="context-note">
          <span><LockIcon aria-hidden="true"/>{!hasApiKey ? '日志可直接保存；配置后还能生成反馈。' : '生成反馈时，所选日期的日志会发送给你配置的 AI 服务。'}</span>
          {hasApiKey ? <span className="context-note__status">已配置 AI 服务</span> : <button className="context-link" onClick={() => onNavigate({ view: 'settings', settingsSection: 'ai' })}>配置 AI</button>}
        </div>
      </div>
    </>}
    <ConfirmDialog open={pendingDiscard !== null} title="放弃未保存的内容？" description="这条日志还没有保存，继续操作会丢失未保存的内容。" confirmLabel="放弃" onCancel={() => setPendingDiscard(null)} onConfirm={() => { const action = pendingDiscard; setPendingDiscard(null); action?.(); }}/>
    <TemplateManager open={templateManagerOpen} templates={templates} onClose={() => setTemplateManagerOpen(false)} onChanged={setTemplates}/>
  </div>;
}
