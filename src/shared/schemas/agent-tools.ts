import { z } from 'zod';

const RequestIdSchema = z.string().uuid();
const AgentSessionIdSchema = z.string().regex(/^agent_[a-z0-9]+$/);
const StableJournalId = z.string().regex(/^journal_[a-z0-9]+$/);
const StableReviewId = z.string().regex(/^review_[a-z0-9]+$/);
const StableProjectId = z.string().regex(/^project_[a-z0-9]+$/);
const ApprovalIdSchema = z.string().regex(/^approval_[a-z0-9]+$/);
const SearchSessionIdSchema = z.string().regex(/^search_[a-z0-9]+$/);
const SourceIdSchema = z.string().regex(/^source_[a-z0-9]+$/);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const IsoDateTime = z.iso.datetime({ offset: true });
const SafeText = z.string().trim().min(1).max(2_000);
const SafeExcerpt = z.string().trim().min(1).max(1_000);

export const AgentNavigationTargetSchema = z.union([
  z.object({ view: z.literal('start') }).strict(),
  z.object({ view: z.literal('journal'), intent: z.enum(['compose', 'records', 'generate-daily']).optional() }).strict(),
  z.object({ view: z.literal('reviews'), intent: z.enum(['weekly', 'monthly', 'yearly', 'coach']).optional() }).strict(),
  z.object({ view: z.literal('reviews'), intent: z.literal('project'), projectId: StableProjectId }).strict(),
  z.object({ view: z.literal('projects') }).strict(),
  z.object({ view: z.literal('settings') }).strict(),
]);

export const AgentPresentationCardSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: SafeExcerpt,
  links: z.array(z.object({ label: z.string().trim().min(1).max(80), target: AgentNavigationTargetSchema }).strict()).max(4),
}).strict();

const JournalListInputSchema = z.object({ start: IsoDate.optional(), end: IsoDate.optional(), projectId: StableProjectId.optional() }).strict();
const JournalGetInputSchema = z.object({ id: StableJournalId }).strict();
const ReviewGetInputSchema = z.object({ id: StableReviewId }).strict();
const MemorySearchAlternatesSchema = z.preprocess(
  (value) => {
    if (!Array.isArray(value)) {
      return value;
    }

    const trimmed = value.map((item) =>
      typeof item === 'string' ? item.trim() : item,
    );
    return trimmed.filter((item, index) => trimmed.indexOf(item) === index);
  },
  z.array(z.string().min(1).max(80)).max(3).optional(),
);

const MemorySearchInputSchema = z.object({
  query: z.string().trim().min(1).max(200),
  alternates: MemorySearchAlternatesSchema,
  limit: z.number().int().min(1).max(8).optional(),
}).strict();
const WebSearchInputSchema = z.object({ query: z.string().trim().min(1).max(500) }).strict();
const WebReadInputSchema = z.object({ searchSessionId: SearchSessionIdSchema, sourceId: SourceIdSchema }).strict();
const validDateRange = (value: { start: string; end: string }) => value.start <= value.end;
const JournalCreateInputSchema = z.object({ date: IsoDate, body: z.string().trim().min(1).max(100_000), projectIds: z.array(StableProjectId).max(20).default([]) }).strict();
const JournalUpdateInputSchema = JournalCreateInputSchema.extend({ id: StableJournalId, expectedUpdatedAt: IsoDateTime }).strict();
const DailyReviewGenerateInputSchema = z.object({ date: IsoDate, journalId: StableJournalId.optional(), regenerate: z.boolean().optional() }).strict();
const PeriodicReviewBaseSchema = z.object({ type: z.enum(['weekly', 'monthly', 'project']), start: IsoDate, end: IsoDate, projectId: StableProjectId.optional() }).strict().refine((value) => value.start <= value.end, '开始日期不能晚于结束日期');
const PeriodicReviewPreviewInputSchema = PeriodicReviewBaseSchema;
const PeriodicReviewGenerateInputSchema = PeriodicReviewBaseSchema.extend({ previewToken: z.string().uuid(), approvalId: ApprovalIdSchema }).strict().refine((value) => value.start <= value.end, '开始日期不能晚于结束日期');
const InsightReviewBaseSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('coach'), start: IsoDate, end: IsoDate }).strict(),
  z.object({ type: z.literal('yearly'), start: IsoDate, end: IsoDate }).strict(),
  z.object({ type: z.literal('life-design'), start: IsoDate, end: IsoDate, topic: z.string().trim().min(1).max(120).optional() }).strict(),
]).refine(validDateRange, '开始日期不能晚于结束日期');
const InsightReviewPreviewInputSchema = InsightReviewBaseSchema;
const InsightReviewGenerateInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('coach'), start: IsoDate, end: IsoDate, previewToken: z.string().uuid(), approvalId: ApprovalIdSchema }).strict(),
  z.object({ type: z.literal('yearly'), start: IsoDate, end: IsoDate, previewToken: z.string().uuid(), approvalId: ApprovalIdSchema }).strict(),
  z.object({ type: z.literal('life-design'), start: IsoDate, end: IsoDate, topic: z.string().trim().min(1).max(120).optional(), previewToken: z.string().uuid(), approvalId: ApprovalIdSchema }).strict(),
]).refine(validDateRange, '开始日期不能晚于结束日期');

export const AgentToolBridgeRequestSchema = z.discriminatedUnion('action', [
  z.object({ type: z.literal('tool.request'), requestId: RequestIdSchema, sessionId: AgentSessionIdSchema, action: z.literal('journals.list'), input: JournalListInputSchema }).strict(),
  z.object({ type: z.literal('tool.request'), requestId: RequestIdSchema, sessionId: AgentSessionIdSchema, action: z.literal('journals.get'), input: JournalGetInputSchema }).strict(),
  z.object({ type: z.literal('tool.request'), requestId: RequestIdSchema, sessionId: AgentSessionIdSchema, action: z.literal('reviews.list'), input: z.object({}).strict() }).strict(),
  z.object({ type: z.literal('tool.request'), requestId: RequestIdSchema, sessionId: AgentSessionIdSchema, action: z.literal('reviews.get'), input: ReviewGetInputSchema }).strict(),
  z.object({ type: z.literal('tool.request'), requestId: RequestIdSchema, sessionId: AgentSessionIdSchema, action: z.literal('projects.list'), input: z.object({}).strict() }).strict(),
  z.object({ type: z.literal('tool.request'), requestId: RequestIdSchema, sessionId: AgentSessionIdSchema, action: z.literal('patterns.list'), input: z.object({}).strict() }).strict(),
  z.object({ type: z.literal('tool.request'), requestId: RequestIdSchema, sessionId: AgentSessionIdSchema, action: z.literal('memory.search'), input: MemorySearchInputSchema }).strict(),
  z.object({ type: z.literal('tool.request'), requestId: RequestIdSchema, sessionId: AgentSessionIdSchema, action: z.literal('web.search'), input: WebSearchInputSchema }).strict(),
  z.object({ type: z.literal('tool.request'), requestId: RequestIdSchema, sessionId: AgentSessionIdSchema, action: z.literal('web.read-source'), input: WebReadInputSchema }).strict(),
  z.object({ type: z.literal('tool.request'), requestId: RequestIdSchema, sessionId: AgentSessionIdSchema, action: z.literal('journals.create'), input: JournalCreateInputSchema }).strict(),
  z.object({ type: z.literal('tool.request'), requestId: RequestIdSchema, sessionId: AgentSessionIdSchema, action: z.literal('journals.update'), input: JournalUpdateInputSchema }).strict(),
  z.object({ type: z.literal('tool.request'), requestId: RequestIdSchema, sessionId: AgentSessionIdSchema, action: z.literal('reviews.generate-daily'), input: DailyReviewGenerateInputSchema }).strict(),
  z.object({ type: z.literal('tool.request'), requestId: RequestIdSchema, sessionId: AgentSessionIdSchema, action: z.literal('reviews.preview-periodic'), input: PeriodicReviewPreviewInputSchema }).strict(),
  z.object({ type: z.literal('tool.request'), requestId: RequestIdSchema, sessionId: AgentSessionIdSchema, action: z.literal('reviews.generate-periodic'), input: PeriodicReviewGenerateInputSchema }).strict(),
  z.object({ type: z.literal('tool.request'), requestId: RequestIdSchema, sessionId: AgentSessionIdSchema, action: z.literal('reviews.preview-insight'), input: InsightReviewPreviewInputSchema }).strict(),
  z.object({ type: z.literal('tool.request'), requestId: RequestIdSchema, sessionId: AgentSessionIdSchema, action: z.literal('reviews.generate-insight'), input: InsightReviewGenerateInputSchema }).strict(),
  z.object({ type: z.literal('tool.request'), requestId: RequestIdSchema, sessionId: AgentSessionIdSchema, action: z.literal('ui.navigate'), input: z.object({ target: AgentNavigationTargetSchema }).strict() }).strict(),
  z.object({ type: z.literal('tool.request'), requestId: RequestIdSchema, sessionId: AgentSessionIdSchema, action: z.literal('ui.present'), input: AgentPresentationCardSchema }).strict(),
]);

const AgentJournalSummarySchema = z.object({ id: StableJournalId, date: IsoDate, projectIds: z.array(StableProjectId).max(20), updatedAt: IsoDateTime, excerpt: SafeExcerpt }).strict();
const AgentReviewSummarySchema = z.object({ id: StableReviewId, type: z.enum(['daily', 'weekly', 'monthly', 'project', 'coach', 'yearly', 'life-design']), periodStart: IsoDate, periodEnd: IsoDate, projectId: StableProjectId.nullable(), excerpt: SafeExcerpt }).strict();
const AgentProjectSummarySchema = z.object({ id: StableProjectId, name: z.string().trim().min(1).max(80), status: z.enum(['active', 'archived']) }).strict();
const AgentPatternSummarySchema = z.object({ id: z.string().regex(/^pattern_[a-z0-9]+$/), statement: SafeExcerpt, evidenceSummary: SafeExcerpt, sourceReviewIds: z.array(StableReviewId).max(20) }).strict();
export const AgentMemoryHitSchema = z.object({ id: z.string().regex(/^(journal|review|pattern)_[a-z0-9]+$/), kind: z.enum(['journal', 'review', 'pattern']), date: IsoDate.nullable(), excerpt: z.string().trim().min(1).max(800) }).strict();
const AgentSearchResultSchema = z.object({ sourceId: SourceIdSchema, title: z.string().trim().min(1).max(300), domain: z.string().trim().min(1).max(255), snippet: z.string().max(1_000), publishedAt: z.string().max(40).nullable(), retrievedAt: IsoDateTime }).strict();
const AgentReviewPreviewSourceSchema = z.object({ id: z.string().regex(/^(journal|review)_[a-z0-9]+$/), date: IsoDate, excerpt: SafeExcerpt }).strict();
export const AgentToolErrorCodeSchema = z.enum([
  'INVALID_INPUT',
  'NOT_FOUND',
  'CANCELLED',
  'TASK_ALREADY_RUNNING',
  'INVALID_MODEL_OUTPUT',
  'FILE_CONFLICT',
  'SEARCH_UNAVAILABLE',
  'SEARCH_TIMEOUT',
  'SEARCH_RATE_LIMITED',
  'SEARCH_EMPTY',
  'SOURCE_UNAVAILABLE',
  'SEARCH_NOT_CONFIGURED',
  'UNKNOWN',
]);
export type AgentToolErrorCode = z.infer<typeof AgentToolErrorCodeSchema>;
export const AgentReviewPreviewSchema = z.object({ token: z.string().uuid(), type: z.enum(['weekly', 'monthly', 'project', 'coach', 'yearly', 'life-design']), start: IsoDate, end: IsoDate, sources: z.array(AgentReviewPreviewSourceSchema).max(100) }).strict();
const AgentWorkflowSchema = z.enum(['journals.create', 'journals.update', 'reviews.generate-daily', 'reviews.generate-periodic', 'reviews.generate-insight']);
export const AgentWorkflowApprovalSchema = z.object({ approvalId: ApprovalIdSchema, workflow: z.enum(['reviews.generate-periodic', 'reviews.generate-insight']), title: z.string().trim().min(1).max(120), summary: SafeExcerpt, preview: AgentReviewPreviewSchema }).strict();

export const AgentToolResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('journals.list'), journals: z.array(AgentJournalSummarySchema).max(100) }).strict(),
  z.object({ kind: z.literal('journals.get'), journal: AgentJournalSummarySchema }).strict(),
  z.object({ kind: z.literal('reviews.list'), reviews: z.array(AgentReviewSummarySchema).max(100) }).strict(),
  z.object({ kind: z.literal('reviews.get'), review: AgentReviewSummarySchema }).strict(),
  z.object({ kind: z.literal('projects.list'), projects: z.array(AgentProjectSummarySchema).max(100) }).strict(),
  z.object({ kind: z.literal('patterns.list'), patterns: z.array(AgentPatternSummarySchema).max(100) }).strict(),
  z.object({ kind: z.literal('memory.search'), hits: z.array(AgentMemoryHitSchema).max(8) }).strict(),
  z.object({ kind: z.literal('web.search'), searchSessionId: SearchSessionIdSchema, results: z.array(AgentSearchResultSchema).max(8) }).strict(),
  z.object({ kind: z.literal('web.read-source'), source: z.object({ title: z.string().trim().min(1).max(300), domain: z.string().trim().min(1).max(255), publishedAt: z.string().max(40).nullable(), retrievedAt: IsoDateTime, excerpt: z.string().max(2_000) }).strict() }).strict(),
  z.object({ kind: z.literal('workflow.approval-required'), approval: AgentWorkflowApprovalSchema }).strict(),
  z.object({ kind: z.literal('workflow.clarification'), workflow: z.enum(['reviews.generate-daily', 'reviews.generate-periodic']), question: SafeText }).strict(),
  z.object({ kind: z.literal('workflow.completed'), workflow: AgentWorkflowSchema, journal: AgentJournalSummarySchema.optional(), review: AgentReviewSummarySchema.optional(), navigation: AgentNavigationTargetSchema }).strict(),
  z.object({ kind: z.literal('ui.navigate'), target: AgentNavigationTargetSchema }).strict(),
  z.object({ kind: z.literal('ui.present'), card: AgentPresentationCardSchema }).strict(),
  z.object({ kind: z.literal('error'), code: AgentToolErrorCodeSchema, message: z.string().trim().min(1).max(500), retryable: z.boolean(), retryAfterSeconds: z.number().int().min(0).max(86_400).optional() }).strict(),
]);

export const AgentToolBridgeResponseSchema = z.object({ type: z.literal('tool.result'), requestId: RequestIdSchema, result: AgentToolResultSchema }).strict();

export type AgentToolBridgeRequest = z.infer<typeof AgentToolBridgeRequestSchema>;
export type AgentToolResult = z.infer<typeof AgentToolResultSchema>;
export type AgentToolBridgeResponse = z.infer<typeof AgentToolBridgeResponseSchema>;
export type AgentNavigationTarget = z.infer<typeof AgentNavigationTargetSchema>;
export type AgentPresentationCard = z.infer<typeof AgentPresentationCardSchema>;
export type AgentWorkflowApproval = z.infer<typeof AgentWorkflowApprovalSchema>;
export type AgentReviewPreview = z.infer<typeof AgentReviewPreviewSchema>;
export type AgentWorkflow = z.infer<typeof AgentWorkflowSchema>;
