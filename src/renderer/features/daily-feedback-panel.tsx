import { isDailyReviewFresh, toSourceVersions } from '../../shared/domain/daily-freshness';
import type { Journal, Review } from '../../shared/schemas/domain';
import { Button } from '../components/button';
import { MarkdownDocument } from '../components/markdown-document';
import { toLocalDateString } from '../utils/local-date';

function formatDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(parsed);
}

function newestDailyReview(reviews: Review[], date: string): Review | undefined {
  return reviews
    .filter((review) => review.type === 'daily' && review.periodStart === date && review.periodEnd === date)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))[0];
}

export function DailyFeedbackPanel({ date, journal, journals, reviews, overrideReview, hasApiKey = true, isGenerating = false, message, onGenerate, onConfigureAi }: {
  date: string;
  journals: Journal[];
  reviews: Review[];
  journal?: Journal;
  overrideReview?: Review;
  hasApiKey?: boolean;
  isGenerating?: boolean;
  message?: string;
  onGenerate?(input: { date: string; journalId: string; regenerate?: boolean }): void;
  onConfigureAi?(): void;
}) {
  const datedJournals = journals.filter((item) => item.date === date && item.body.trim());
  const source = journal?.date === date && journal.body.trim()
    ? journal
    : datedJournals.length === 1 ? datedJournals[0] : undefined;
  const sources = source ? [source] : [];
  const review = overrideReview?.type === 'daily' && overrideReview.periodStart === date ? overrideReview : newestDailyReview(reviews, date);
  const fresh = review ? isDailyReviewFresh(review, date, toSourceVersions(sources)) : false;
  const sourceMismatch = Boolean(review && source && (review.sourceIds.length !== 1 || review.sourceIds[0] !== source.id));
  const hasSources = Boolean(source);
  const today = date === toLocalDateString();
  const actionLabel = !review ? (today ? '生成今日反馈' : '生成这一天的反馈') : fresh ? (today ? '重新生成今日反馈' : '重新生成这一天的反馈') : (today ? '更新今日反馈' : '更新这一天的反馈');
  const action = !hasApiKey ? '配置 AI 后生成' : actionLabel;
  return <section className="daily-feedback-panel" aria-label={`${formatDate(date)}日反馈`}>
    <header className="daily-feedback-panel__header">
      <div>
        <p className="eyebrow">日反馈</p>
        <h3>{formatDate(date)}</h3>
      </div>
      <span className={`daily-feedback-panel__status ${fresh ? 'is-fresh' : review ? 'is-stale' : ''}`}>{fresh ? '已更新' : review ? '待更新' : '尚未生成'}</span>
    </header>
    <p className="daily-feedback-panel__scope">{hasSources ? `根据所选日志生成 · ${source?.id}` : datedJournals.length > 1 ? `这一天有 ${datedJournals.length} 条日志，请先选择要分析的那一条` : '还没有保存的日志'}</p>
    {sourceMismatch ? <p className="daily-feedback-panel__notice">现有反馈来自另一条日志；当前日志的反馈需要单独生成。</p> : review && !fresh && <p className="daily-feedback-panel__notice">日志内容有变化，现有反馈仍可阅读；更新后会替换这一天的反馈。</p>}
    {message && <p className="daily-feedback-panel__message" role="status">{message}</p>}
    {review ? <div className="daily-feedback-panel__content"><MarkdownDocument>{review.body}</MarkdownDocument></div> : <p className="daily-feedback-panel__empty">先保存日志，再生成这一天的反馈。已有反馈会一直保留在这里。</p>}
    {(onGenerate || onConfigureAi) && <footer className="daily-feedback-panel__actions">
      {!hasApiKey && onConfigureAi ? <Button variant="secondary" onClick={onConfigureAi}>{action}</Button>
        : onGenerate && <Button variant="secondary" disabled={isGenerating || !hasSources} onClick={() => source && onGenerate({ date, journalId: source.id, ...(fresh ? { regenerate: true } : {}) })}>{isGenerating ? '正在生成…' : action}</Button>}
      {review && fresh && hasApiKey && <span>重新生成成功后会替换现有反馈</span>}
    </footer>}
  </section>;
}
