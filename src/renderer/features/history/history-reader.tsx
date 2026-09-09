import { HISTORY_KIND_LABELS, type HistoryItem } from '../../domain/history-items';
import { MarkdownDocument } from '../../components/markdown-document';
import { DailyFeedbackPanel } from '../daily-feedback-panel';

export function HistoryReader({ item, journals = [], reviews = [], hasApiKey = true, dailyReviewOverride, isDailyGenerating = false, dailyFeedbackMessage, onEdit, onGenerateDaily, onConfigureAi, onDelete }: { item: HistoryItem; journals?: import('../../../shared/schemas/domain').Journal[]; reviews?: import('../../../shared/schemas/domain').Review[]; hasApiKey?: boolean; dailyReviewOverride?: import('../../../shared/schemas/domain').Review; isDailyGenerating?: boolean; dailyFeedbackMessage?: string; onEdit?(id: string): void; onGenerateDaily?(input: { date: string; journalId: string; regenerate?: boolean }): void; onConfigureAi?(): void; onDelete?(item: HistoryItem): void }) {
  return <article className="card history-reader">
    <div className="reader-meta">
      <span className="tag">{HISTORY_KIND_LABELS[item.kind]}</span>
      <time>{item.date}</time>
      <span className="reader-actions">
        {item.kind === 'journal' && onEdit && <button onClick={() => onEdit(item.id)}>编辑</button>}
        {onDelete && <button onClick={() => onDelete(item)}>移到回收站</button>}
      </span>
    </div>
    {item.kind === 'journal' && <h2>{item.title}</h2>}
    <MarkdownDocument>{item.body}</MarkdownDocument>
    {item.kind === 'journal' && onGenerateDaily && <DailyFeedbackPanel date={item.date} journal={journals.find((journal) => journal.id === item.id)} journals={journals} reviews={reviews} overrideReview={dailyReviewOverride} hasApiKey={hasApiKey} isGenerating={isDailyGenerating} message={dailyFeedbackMessage} onGenerate={onGenerateDaily} onConfigureAi={onConfigureAi}/>}
    {item.sourceSummaries.length > 0 && <footer><strong>材料来源</strong><p>{item.sourceSummaries.join('、')}</p></footer>}
  </article>;
}
