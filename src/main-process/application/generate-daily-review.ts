import crypto from 'node:crypto';
import { appError, isStructuredOutputError } from '../../shared/errors/app-error';
import { isDailyReviewFresh, toSourceVersions } from '../../shared/domain/daily-freshness';
import type { DailyGenerationResult, Review } from '../../shared/schemas/domain';
import type { ReviewTaskManager } from '../domain/review-task';
import type { MarkdownJournalRepository } from '../infrastructure/markdown/journal-repository';
import type { MarkdownReviewRepository } from '../infrastructure/markdown/review-repository';
import { DAILY_REVIEW_PROMPT_VERSION } from '../prompts/daily-review-v1';
import type { ProviderPort } from '../infrastructure/ai/provider-port';
import type { MarkdownProfileRepository } from '../infrastructure/markdown/profile-repository';
import { runDailyFeedback } from '../skill-runtime/daily-runtime';
import type { DailyAuditEvent, DailyAuditRecorder } from '../skill-runtime/daily-audit-recorder';

export type DailyReviewResult = DailyGenerationResult;

export class GenerateDailyReview {
  constructor(private readonly journals: MarkdownJournalRepository, private readonly reviews: MarkdownReviewRepository, private readonly provider: ProviderPort, private readonly tasks: ReviewTaskManager, private readonly now = () => new Date().toISOString(), private readonly profiles?: Pick<MarkdownProfileRepository, 'get'>, private readonly audit?: Pick<DailyAuditRecorder, 'record'>) {}
  async execute(input: { date: string; journalId?: string; model: string; regenerate?: boolean }, externalSignal?: AbortSignal): Promise<DailyReviewResult> {
    const allJournals = await this.journals.list();
    const requestedJournal = input.journalId ? allJournals.find((journal) => journal.id === input.journalId) : undefined;
    if (input.journalId && !requestedJournal) throw appError({ code: 'NOT_FOUND', entity: input.journalId });
    if (requestedJournal && requestedJournal.date !== input.date) throw appError({ code: 'INVALID_INPUT', message: '选择的日志日期与请求日期不一致。' });
    const datedJournals = allJournals.filter((journal) => journal.date === input.date);
    if (!requestedJournal && !datedJournals.length) throw appError({ code: 'NOT_FOUND', entity: input.date });
    if (!requestedJournal && datedJournals.length > 1) throw appError({ code: 'INVALID_INPUT', message: '这一天有多条日志，请先选择要分析的那一条。' });
    const selectedJournal = requestedJournal ?? datedJournals[0];
    if (!selectedJournal || !selectedJournal.body.trim()) throw appError({ code: 'INVALID_INPUT', message: '这一天没有可用于反馈的日志，请先写点具体内容。' });
    const journals = [selectedJournal];
    const sourceVersions = toSourceVersions(journals);
    const existing = (await this.reviews.list()).filter((review) => review.type === 'daily' && review.periodStart === input.date).at(-1);
    if (isDailyReviewFresh(existing, input.date, sourceVersions) && !input.regenerate) return { kind: 'review', review: existing, cached: true };
    const task = this.tasks.start();
    const abortExternal = () => task.controller.abort();
    if (externalSignal?.aborted) task.controller.abort();
    else externalSignal?.addEventListener('abort', abortExternal, { once: true });
    try {
      this.tasks.transition(task.taskId, 'building_context');
      this.tasks.transition(task.taskId, 'generating');
      const profile = await this.profiles?.get();
      const runtime = await runDailyFeedback({ journals, reviews: await this.reviews.list(), provider: this.provider, signal: task.controller.signal, onStructuredRetry: () => this.tasks.transition(task.taskId, 'retrying_format'), ...(profile?.enabledForAi ? { profile: profile.body } : {}) });
      if (runtime.kind === 'clarification') {
        await this.recordAudit({ date: input.date, sourceIds: journals.map((journal) => journal.id), grade: runtime.grade, outcome: 'clarification' });
        this.tasks.transition(task.taskId, 'completed');
        return { kind: 'clarification', question: runtime.question };
      }
      this.tasks.transition(task.taskId, 'validating');
      const createdAt = this.now();
      const review: Review = { schemaVersion: 2, id: `review_${crypto.randomUUID().replace(/-/g, '')}`, type: 'daily', periodStart: input.date, periodEnd: input.date, sourceIds: journals.map((journal) => journal.id), sourceVersions, projectId: null, provider: 'openai-compatible', model: input.model, promptVersion: DAILY_REVIEW_PROMPT_VERSION, createdAt, body: runtime.body };
      this.tasks.transition(task.taskId, 'saving');
      const saved = await this.reviews.saveDaily(review);
      const auditWarning = await this.recordAudit({ date: input.date, sourceIds: saved.review.sourceIds, grade: runtime.grade, outcome: 'review', ...(runtime.output.priorAction ? { priorActionStatus: runtime.output.priorAction.status } : {}) });
      this.tasks.transition(task.taskId, 'completed');
      const warnings = [saved.warning, auditWarning].filter((warning): warning is string => Boolean(warning));
      return { kind: 'review', review: saved.review, cached: false, ...(warnings.length ? { warning: warnings.join(' ') } : {}) };
    } catch (error) {
      if (task.controller.signal.aborted || externalSignal?.aborted) this.tasks.transition(task.taskId, 'cancelled');
      else this.tasks.transition(task.taskId, 'failed');
      if (isStructuredOutputError(error)) return { kind: 'error', message: error.message, diagnostics: error.diagnostics };
      throw error;
    }
    finally { externalSignal?.removeEventListener('abort', abortExternal); }
  }

  /** 审计是辅助记录；正式反馈已经落盘时，审计故障不能把成功说成失败。 */
  private async recordAudit(event: DailyAuditEvent): Promise<string | undefined> {
    if (!this.audit) return undefined;
    try {
      await this.audit.record(event);
      return undefined;
    } catch (error) {
      console.warn('daily feedback audit failed', error instanceof Error ? error.message : 'unknown error');
      return '反馈已保存，但本次本机审计记录失败。';
    }
  }
}
