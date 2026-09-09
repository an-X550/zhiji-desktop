import crypto from 'node:crypto';
import { appError, isStructuredOutputError } from '../../shared/errors/app-error';
import type { Journal, PeriodicGenerationResult, Review, ReviewPreview } from '../../shared/schemas/domain';
import type { MaterialSelection } from '../domain/material-selector';
import { selectMaterials } from '../domain/material-selector';
import type { ReviewTaskManager } from '../domain/review-task';
import type { ProviderPort } from '../infrastructure/ai/provider-port';
import type { MarkdownJournalRepository } from '../infrastructure/markdown/journal-repository';
import type { MarkdownReviewRepository } from '../infrastructure/markdown/review-repository';
import { PERIODIC_REVIEW_PROMPT_VERSION } from '../prompts/periodic-review-v1';
import type { MarkdownProfileRepository } from '../infrastructure/markdown/profile-repository';
import { runPeriodicFeedback } from '../skill-runtime/periodic-runtime';
import { PreviewTokenStore } from './preview-token-store';

type Input = MaterialSelection & { model: string };

export class GeneratePeriodicReview {
  private readonly previews: PreviewTokenStore<Input>;
  constructor(private journals: MarkdownJournalRepository, private reviews: MarkdownReviewRepository, private provider: ProviderPort, private tasks: ReviewTaskManager, private now = () => new Date().toISOString(), private profiles?: Pick<MarkdownProfileRepository, 'get'>) { this.previews = new PreviewTokenStore(this.now); }
  private async materials(input: Input) { return selectMaterials(input, await this.journals.list(), await this.reviews.list()); }
  async preview(input: Input): Promise<ReviewPreview> {
    const materials = await this.materials(input);
    if (!materials.length) throw appError({ code: 'INVALID_INPUT', message: '所选范围内没有可复盘材料。' });
    const { token } = this.previews.issue(input, materials);
    return { token, type: input.type, start: input.start, end: input.end, sources: materials.map((material) => { const item: Journal | Review = material; return { id: item.id, date: 'date' in item ? item.date : item.periodStart, excerpt: item.body.slice(0, 100) }; }) };
  }
  async execute(input: Input & { previewToken: string }, externalSignal?: AbortSignal): Promise<PeriodicGenerationResult> {
    const preview = this.previews.peek(input.previewToken);
    if (!preview) throw appError({ code: 'INVALID_INPUT', message: '请先预览并确认材料。' });
    const materials = await this.materials(input);
    if (PreviewTokenStore.digest(materials) !== preview.digest) throw appError({ code: 'INVALID_INPUT', message: '材料已变化，请重新预览。' });
    const task = this.tasks.start();
    const abortExternal = () => task.controller.abort();
    if (externalSignal?.aborted) task.controller.abort();
    else externalSignal?.addEventListener('abort', abortExternal, { once: true });
    try {
      this.tasks.transition(task.taskId, 'generating');
      const profile = await this.profiles?.get();
      const journalMaterials = materials.filter((m): m is Journal => !('type' in m));
      const reviewMaterials = materials.filter((m): m is Review => 'type' in m);
      const runtime = await runPeriodicFeedback({
        type: input.type as 'weekly' | 'monthly' | 'project', start: input.start, end: input.end,
        journals: journalMaterials, reviews: reviewMaterials, provider: this.provider, signal: task.controller.signal,
        onStructuredRetry: () => this.tasks.transition(task.taskId, 'retrying_format'),
        ...(profile?.enabledForAi ? { profile: profile.body } : {}),
      });
      if (runtime.kind === 'clarification') {
        this.previews.consume(input.previewToken);
        this.tasks.transition(task.taskId, 'completed');
        return { kind: 'clarification', question: runtime.question };
      }
      this.tasks.transition(task.taskId, 'validating');
      const createdAt = this.now();
      const review: Review = { schemaVersion: 1, id: `review_${crypto.randomUUID().replace(/-/g, '')}`, type: input.type, periodStart: input.start, periodEnd: input.end, sourceIds: materials.map((x) => x.id), projectId: input.projectId ?? null, provider: 'openai-compatible', model: input.model, promptVersion: PERIODIC_REVIEW_PROMPT_VERSION, createdAt, body: runtime.body };
      this.tasks.transition(task.taskId, 'saving'); await this.reviews.save(review); this.previews.consume(input.previewToken); this.tasks.transition(task.taskId, 'completed');
      return { kind: 'review', review };
    } catch (error) {
      this.tasks.transition(task.taskId, task.controller.signal.aborted || externalSignal?.aborted ? 'cancelled' : 'failed');
      if (isStructuredOutputError(error)) return { kind: 'error', message: error.message, diagnostics: error.diagnostics };
      throw error;
    }
    finally { externalSignal?.removeEventListener('abort', abortExternal); }
  }
}
