import crypto from 'node:crypto';
import { AgentToolBridgeRequestSchema, AgentToolResultSchema, type AgentNavigationTarget, type AgentPresentationCard, type AgentToolBridgeRequest, type AgentToolResult } from '../../shared/schemas/agent-tools';
import type { MarkdownJournalRepository } from '../infrastructure/markdown/journal-repository';
import type { MarkdownReviewRepository } from '../infrastructure/markdown/review-repository';
import type { JsonProjectRepository } from '../infrastructure/markdown/project-repository';
import type { VerifiedPatternService } from '../application/verified-patterns';
import type { AgentMemorySearchService } from './agent-memory-search-service';
import type { WebSearchService } from '../infrastructure/web/web-search-service';
import type { CreateJournal, UpdateJournal } from '../application/save-journal';
import type { GenerateDailyReview } from '../application/generate-daily-review';
import type { GeneratePeriodicReview } from '../application/generate-periodic-review';
import type { GenerateInsightReview } from '../application/generate-insight-review';
import type { ConfigureAi } from '../application/configure-ai';
import { appError } from '../../shared/errors/app-error';

const PATH_OR_URL = /(?:[a-z]:[\\/]|\\\\|\/[a-z0-9._~-]+(?:[\\/]|$)|https?:\/\/)/i;
type AgentToolErrorResult = Extract<AgentToolResult, { kind: 'error' }>;

function safeText(value: string, limit = 1_000): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return PATH_OR_URL.test(normalized) ? '内容包含受保护位置，已省略。' : (normalized || '暂无可展示内容。').slice(0, limit);
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : undefined;
}

function retryAfterSeconds(error: unknown): number | undefined {
  const value = typeof error === 'object' && error !== null && 'retryAfterSeconds' in error
    ? (error as { retryAfterSeconds?: unknown }).retryAfterSeconds
    : undefined;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? Math.min(value, 86_400) : undefined;
}

function toolError(code: AgentToolErrorResult['code'], message: string, retryable = false, retryAfter?: number): AgentToolErrorResult {
  return {
    kind: 'error',
    code,
    message,
    retryable,
    ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
  };
}

function safeError(error: unknown): AgentToolErrorResult {
  const code = errorCode(error);
  if (code === 'NOT_FOUND') return toolError('NOT_FOUND', '未找到所需内容，可能已被移动或删除。');
  if (code === 'FILE_CONFLICT') return toolError('FILE_CONFLICT', '内容已在其他位置更新，请刷新后重试。');
  if (code === 'CANCELLED') return toolError('CANCELLED', '已停止本次工具调用。');
  if (code === 'NETWORK_TIMEOUT' || code === 'SEARCH_TIMEOUT') return toolError('SEARCH_TIMEOUT', '搜索公开来源响应超时，可以自动重试一次。', true);
  if (code === 'SEARCH_RATE_LIMITED') return toolError('SEARCH_RATE_LIMITED', '搜索服务共享额度已用尽，请稍后再试。', false, retryAfterSeconds(error));
  if (code === 'SEARCH_EMPTY') return toolError('SEARCH_EMPTY', '没有找到相关公开来源，可以修改关键词后再搜索。');
  if (code === 'SOURCE_UNAVAILABLE' || code === 'WEB_SOURCE_FAILED') return toolError('SOURCE_UNAVAILABLE', '该来源暂时无法读取，可以尝试本次搜索会话中的其他来源。');
  if (code === 'SEARCH_NOT_CONFIGURED') return toolError('SEARCH_NOT_CONFIGURED', '搜索服务尚未配置，请稍后再试。');
  if (code === 'SEARCH_UNAVAILABLE' || code === 'WEB_SEARCH_FAILED') return toolError('SEARCH_UNAVAILABLE', '搜索服务暂时不可用，请稍后再试。');
  if (code === 'TASK_ALREADY_RUNNING') return toolError('TASK_ALREADY_RUNNING', '已有复盘任务正在运行，请等待它完成或先停止。');
  if (code === 'INVALID_MODEL_OUTPUT') return toolError('INVALID_MODEL_OUTPUT', 'AI 返回的正式内容格式不完整，请重试。');
  if (code === 'INVALID_INPUT') return toolError('INVALID_INPUT', '工具输入不合法，已拒绝执行。');
  if (error instanceof Error && error.message.includes('请先在知己 Agent 页面确认')) return toolError('INVALID_INPUT', error.message);
  return toolError('UNKNOWN', '知己工具暂时无法完成请求，请稍后重试。');
}

type PendingApproval = {
  sessionId: string;
  workflow: 'reviews.generate-periodic' | 'reviews.generate-insight';
  previewToken: string;
  approved: boolean;
  createdAt: number;
};

/**
 * Main Process 的唯一 Agent 工具入口。Utility Process 即使是本地子进程也不被信任：
 * 每次调用都先经过共享 Zod 契约，随后只委托既有的领域服务，并把跨进程结果收敛为无路径、无 URL 的摘要。
 */
export class AgentToolDispatcher {
  private readonly approvals = new Map<string, PendingApproval>();

  constructor(private readonly deps: {
    journals: Pick<MarkdownJournalRepository, 'list' | 'get'>;
    reviews: Pick<MarkdownReviewRepository, 'list' | 'get'>;
    projects: Pick<JsonProjectRepository, 'list'>;
    verifiedPatterns: Pick<VerifiedPatternService, 'list'>;
    memorySearch: Pick<AgentMemorySearchService, 'search'>;
    webSearch: Pick<WebSearchService, 'search' | 'readSource'>;
    createJournal: Pick<CreateJournal, 'execute'>;
    updateJournal: Pick<UpdateJournal, 'execute'>;
    generateDailyReview: Pick<GenerateDailyReview, 'execute'>;
    generatePeriodicReview: Pick<GeneratePeriodicReview, 'preview' | 'execute'>;
    generateInsightReview: Pick<GenerateInsightReview, 'preview' | 'execute'>;
    configureAi: Pick<ConfigureAi, 'getPublicConfig'>;
  }) {}

  async dispatch(raw: unknown, signal?: AbortSignal): Promise<AgentToolResult> {
    const request = AgentToolBridgeRequestSchema.safeParse(raw);
    if (!request.success) return toolError('INVALID_INPUT', '工具请求格式不合法，已拒绝执行。');
    try {
      return AgentToolResultSchema.parse(await this.execute(request.data, signal));
    } catch (error) {
      return safeError(error);
    }
  }

  approve(sessionId: string, approvalId: string): boolean {
    this.pruneApprovals();
    const approval = this.approvals.get(approvalId);
    if (!approval || approval.sessionId !== sessionId || approval.approved) return false;
    approval.approved = true;
    return true;
  }

  revoke(sessionId: string, approvalId: string): void {
    const approval = this.approvals.get(approvalId);
    if (approval?.sessionId === sessionId && approval.approved) approval.approved = false;
  }

  private async execute(request: AgentToolBridgeRequest, signal?: AbortSignal): Promise<AgentToolResult> {
    switch (request.action) {
      case 'journals.list': {
        const journals = (await this.deps.journals.list()).filter((item) =>
          (!request.input.start || item.date >= request.input.start)
          && (!request.input.end || item.date <= request.input.end)
          && (!request.input.projectId || item.projectIds.includes(request.input.projectId)),
        );
        return { kind: 'journals.list', journals: journals.slice(-100).map((item) => this.journalSummary(item)) };
      }
      case 'journals.get': {
        const item = await this.deps.journals.get(request.input.id);
        return { kind: 'journals.get', journal: this.journalSummary(item) };
      }
      case 'reviews.list': {
        const reviews = await this.deps.reviews.list();
        return { kind: 'reviews.list', reviews: reviews.slice(-100).map((item) => ({ id: item.id, type: item.type, periodStart: item.periodStart, periodEnd: item.periodEnd, projectId: item.projectId, excerpt: safeText(item.body) })) };
      }
      case 'reviews.get': {
        const item = await this.deps.reviews.get(request.input.id);
        return { kind: 'reviews.get', review: { id: item.id, type: item.type, periodStart: item.periodStart, periodEnd: item.periodEnd, projectId: item.projectId, excerpt: safeText(item.body) } };
      }
      case 'projects.list': {
        const projects = await this.deps.projects.list();
        return { kind: 'projects.list', projects: projects.slice(-100).map((item) => ({ id: item.id, name: safeText(item.name, 80), status: item.status })) };
      }
      case 'patterns.list': {
        const snapshot = await this.deps.verifiedPatterns.list();
        return { kind: 'patterns.list', patterns: snapshot.patterns.slice(-100).map((item) => ({ id: item.id, statement: safeText(item.statement, 500), evidenceSummary: safeText(item.evidenceSummary), sourceReviewIds: item.sourceReviewIds })) };
      }
      case 'memory.search': {
        const response = await this.deps.memorySearch.search(request.input);
        return { kind: 'memory.search', hits: response.hits.map((item) => ({ id: item.id, kind: item.kind, date: item.date, excerpt: safeText(item.excerpt, 800) })) };
      }
      case 'web.search': {
        const response = await this.deps.webSearch.search(request.input);
        return { kind: 'web.search', searchSessionId: response.searchSessionId, results: response.results.map((item) => ({ sourceId: item.sourceId, title: safeText(item.title, 300), domain: safeText(item.domain, 255), snippet: safeText(item.snippet), publishedAt: item.publishedAt, retrievedAt: item.retrievedAt })) };
      }
      case 'web.read-source': {
        const source = await this.deps.webSearch.readSource(request.input);
        return { kind: 'web.read-source', source: { title: safeText(source.title, 300), domain: safeText(source.domain, 255), publishedAt: source.publishedAt, retrievedAt: source.retrievedAt, excerpt: safeText(source.excerpt, 2_000) } };
      }
      case 'journals.create': {
        await this.assertKnownProjects(request.input.projectIds);
        const journal = await this.deps.createJournal.execute(request.input);
        return { kind: 'workflow.completed', workflow: 'journals.create', journal: this.journalSummary(journal), navigation: { view: 'journal', intent: 'records' } };
      }
      case 'journals.update': {
        await this.assertKnownProjects(request.input.projectIds);
        const journal = await this.deps.updateJournal.execute(request.input);
        return { kind: 'workflow.completed', workflow: 'journals.update', journal: this.journalSummary(journal), navigation: { view: 'journal', intent: 'records' } };
      }
      case 'reviews.generate-daily': {
        const result = await this.deps.generateDailyReview.execute({ ...request.input, model: (await this.deps.configureAi.getPublicConfig()).model }, signal);
        if (result.kind === 'clarification') return { kind: 'workflow.clarification', workflow: 'reviews.generate-daily', question: result.question };
        if (result.kind === 'error') throw appError({ code: 'INVALID_MODEL_OUTPUT', message: result.message, diagnostics: result.diagnostics });
        return { kind: 'workflow.completed', workflow: 'reviews.generate-daily', review: this.reviewSummary(result.review), navigation: { view: 'journal', intent: 'records' } };
      }
      case 'reviews.preview-periodic': {
        if (request.input.projectId) await this.assertKnownProjects([request.input.projectId]);
        const preview = await this.deps.generatePeriodicReview.preview({ ...request.input, model: (await this.deps.configureAi.getPublicConfig()).model });
        const approvalId = this.issueApproval(request.sessionId, 'reviews.generate-periodic', preview.token);
        return { kind: 'workflow.approval-required', approval: { approvalId, workflow: 'reviews.generate-periodic', title: '确认生成周期复盘', summary: `已找到 ${preview.sources.length} 条材料（${preview.start} 至 ${preview.end}），确认后才会写入正式复盘。`, preview: this.previewSummary(preview) } };
      }
      case 'reviews.generate-periodic': {
        const approval = this.consumeApproval(request.sessionId, request.input.approvalId, 'reviews.generate-periodic', request.input.previewToken);
        const result = await this.deps.generatePeriodicReview.execute({ ...request.input, model: (await this.deps.configureAi.getPublicConfig()).model, previewToken: approval.previewToken }, signal);
        if (result.kind === 'clarification') return { kind: 'workflow.clarification', workflow: 'reviews.generate-periodic', question: result.question };
        if (result.kind === 'error') throw appError({ code: 'INVALID_MODEL_OUTPUT', message: result.message, diagnostics: result.diagnostics });
        return { kind: 'workflow.completed', workflow: 'reviews.generate-periodic', review: this.reviewSummary(result.review), navigation: this.reviewNavigation(result.review) };
      }
      case 'reviews.preview-insight': {
        const preview = await this.deps.generateInsightReview.preview({ ...request.input, model: (await this.deps.configureAi.getPublicConfig()).model });
        const approvalId = this.issueApproval(request.sessionId, 'reviews.generate-insight', preview.token);
        return { kind: 'workflow.approval-required', approval: { approvalId, workflow: 'reviews.generate-insight', title: '确认生成洞察复盘', summary: `已找到 ${preview.sources.length} 条材料（${preview.start} 至 ${preview.end}），确认后才会写入正式复盘。`, preview: this.previewSummary(preview) } };
      }
      case 'reviews.generate-insight': {
        const approval = this.consumeApproval(request.sessionId, request.input.approvalId, 'reviews.generate-insight', request.input.previewToken);
        const review = await this.deps.generateInsightReview.execute({ ...request.input, model: (await this.deps.configureAi.getPublicConfig()).model, previewToken: approval.previewToken }, signal);
        return { kind: 'workflow.completed', workflow: 'reviews.generate-insight', review: this.reviewSummary(review), navigation: this.reviewNavigation(review) };
      }
      case 'ui.navigate': {
        await this.assertKnownNavigation(request.input.target);
        return { kind: 'ui.navigate', target: request.input.target };
      }
      case 'ui.present': {
        await Promise.all(request.input.links.map((link) => this.assertKnownNavigation(link.target)));
        return { kind: 'ui.present', card: this.safeCard(request.input) };
      }
    }
  }

  private safeCard(card: AgentPresentationCard): AgentPresentationCard {
    return { title: safeText(card.title, 120), summary: safeText(card.summary), links: card.links.map((link) => ({ label: safeText(link.label, 80), target: link.target })) };
  }

  private journalSummary(item: { id: string; date: string; projectIds: string[]; updatedAt: string; body: string }) {
    return { id: item.id as `journal_${string}`, date: item.date, projectIds: item.projectIds as Array<`project_${string}`>, updatedAt: item.updatedAt, excerpt: safeText(item.body) };
  }

  private reviewSummary(item: { id: string; type: string; periodStart: string; periodEnd: string; projectId: string | null; body: string }) {
    return { id: item.id as `review_${string}`, type: item.type as 'daily' | 'weekly' | 'monthly' | 'project' | 'coach' | 'yearly' | 'life-design', periodStart: item.periodStart, periodEnd: item.periodEnd, projectId: item.projectId as `project_${string}` | null, excerpt: safeText(item.body) };
  }

  private previewSummary(preview: { token: string; type: string; start: string; end: string; sources: Array<{ id: string; date: string; excerpt: string }> }) {
    return { token: preview.token, type: preview.type as 'weekly' | 'monthly' | 'project' | 'coach' | 'yearly' | 'life-design', start: preview.start, end: preview.end, sources: preview.sources.map((source) => ({ id: source.id as `journal_${string}` | `review_${string}`, date: source.date, excerpt: safeText(source.excerpt) })) };
  }

  private issueApproval(sessionId: string, workflow: PendingApproval['workflow'], previewToken: string): string {
    this.pruneApprovals();
    const approvalId = `approval_${crypto.randomUUID().replaceAll('-', '')}`;
    this.approvals.set(approvalId, { sessionId, workflow, previewToken, approved: false, createdAt: Date.now() });
    return approvalId;
  }

  private consumeApproval(sessionId: string, approvalId: string, workflow: PendingApproval['workflow'], previewToken: string): PendingApproval {
    this.pruneApprovals();
    const approval = this.approvals.get(approvalId);
    if (!approval || approval.sessionId !== sessionId || approval.workflow !== workflow || approval.previewToken !== previewToken || !approval.approved) throw new Error('请先在知己 Agent 页面确认预览材料，再生成正式内容。');
    this.approvals.delete(approvalId);
    return approval;
  }

  private pruneApprovals(): void {
    const horizon = Date.now() - 30 * 60 * 1000;
    for (const [approvalId, approval] of this.approvals) if (approval.createdAt < horizon) this.approvals.delete(approvalId);
    while (this.approvals.size > 50) {
      const oldest = this.approvals.keys().next();
      if (oldest.done) break;
      this.approvals.delete(oldest.value);
    }
  }

  private reviewNavigation(review: { type: string; projectId: string | null }): AgentNavigationTarget {
    if (review.type === 'weekly' || review.type === 'monthly' || review.type === 'yearly' || review.type === 'coach') return { view: 'reviews', intent: review.type };
    if (review.type === 'project' && review.projectId) return { view: 'reviews', intent: 'project', projectId: review.projectId as `project_${string}` };
    return { view: 'reviews' };
  }

  private async assertKnownNavigation(target: AgentNavigationTarget): Promise<void> {
    if (target.view === 'reviews' && target.intent === 'project') {
      await this.assertKnownProjects([target.projectId]);
    }
  }

  private async assertKnownProjects(projectIds: string[]): Promise<void> {
    if (!projectIds.length) return;
    const known = new Set((await this.deps.projects.list()).map((project) => project.id));
    if (projectIds.some((projectId) => !known.has(projectId))) throw new Error('unknown project');
  }
}
