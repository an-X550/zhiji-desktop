import { useEffect, useMemo, useState } from 'react';
import type { Journal, Project, Review } from '../../shared/schemas/domain';
import { EmptyState } from '../components/empty-state';
import { buildHistoryItems, HISTORY_KIND_LABELS, type HistoryItem } from '../domain/history-items';
import { HistoryFilter } from '../features/history/history-filter';
import { HistoryReader } from '../features/history/history-reader';

export function RecordBrowser({ journals, reviews = [], projects = [], allowedKinds, initialSelectedId, hasApiKey = true, dailyReviewOverride, generatingDate, generatingJournalId, dailyFeedbackMessage, onEditJournal, onGenerateDaily, onConfigureAi, onDelete, onSelectionChange }: { journals: Journal[]; reviews?: Review[]; projects?: Project[]; allowedKinds: HistoryItem['kind'][]; initialSelectedId?: string; hasApiKey?: boolean; dailyReviewOverride?: Review; generatingDate?: string; generatingJournalId?: string | null; dailyFeedbackMessage?: string; onEditJournal?(id: string): void; onGenerateDaily?(input: { date: string; journalId: string; regenerate?: boolean }): void; onConfigureAi?(): void; onDelete?(item: HistoryItem): void; onSelectionChange?(id: string): void }) {
  const items = useMemo(() => buildHistoryItems(journals, reviews, projects).filter((item) => allowedKinds.includes(item.kind)), [journals, reviews, projects, allowedKinds]);
  const [type, setType] = useState('all');
  const [text, setText] = useState('');
  const [projectId, setProjectId] = useState('');
  const filtered = items.filter((item) => (type === 'all' || item.kind === type) && (!projectId || item.projectIds.includes(projectId)) && (!text.trim() || `${item.title}\n${item.body}`.toLocaleLowerCase().includes(text.trim().toLocaleLowerCase())));
  const [selectedId, setSelectedId] = useState(initialSelectedId ?? items[0]?.id ?? '');
  useEffect(() => { if (initialSelectedId) setSelectedId(initialSelectedId); }, [initialSelectedId]);
  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0];
  const requestedSelectionMissing = Boolean(initialSelectedId && !items.some((item) => item.id === initialSelectedId));
  return <>
    <HistoryFilter type={type} text={text} projectId={projectId} projects={projects} allowedKinds={allowedKinds} onType={setType} onText={setText} onProject={setProjectId}/>
    {filtered.length ? <div className="history-layout"><section className="history-list">{filtered.map((item) => <button key={item.id} className={item.id === selected?.id ? 'is-active' : ''} onClick={() => { setSelectedId(item.id); onSelectionChange?.(item.id); }} aria-label={`${item.title} ${HISTORY_KIND_LABELS[item.kind]}`}><time>{item.date}</time><div><strong>{item.title}</strong><span>{HISTORY_KIND_LABELS[item.kind]}</span></div></button>)}</section>{selected && !requestedSelectionMissing ? <HistoryReader item={selected} journals={journals} reviews={reviews} hasApiKey={hasApiKey} dailyReviewOverride={dailyReviewOverride?.type === 'daily' && dailyReviewOverride.periodStart === selected.date ? dailyReviewOverride : undefined} isDailyGenerating={generatingDate === selected.date && generatingJournalId === selected.id} dailyFeedbackMessage={generatingDate === selected.date && generatingJournalId === selected.id ? dailyFeedbackMessage : undefined} onEdit={onEditJournal} onGenerateDaily={onGenerateDaily} onConfigureAi={onConfigureAi} onDelete={onDelete}/> : <section className="history-reader history-reader--empty"><EmptyState title="找不到这条记录" description="它可能已被移入回收站，或当前数据目录中已经不可读。请从左侧选择其他记录。"/></section>}</div> : <EmptyState title={requestedSelectionMissing ? '找不到这条记录' : '没有符合筛选条件的记录'} description={requestedSelectionMissing ? '这条证据对应的原记录已不存在，未自动打开其他记录。' : '尝试清空搜索词或调整筛选条件。'}/>}
  </>;
}
