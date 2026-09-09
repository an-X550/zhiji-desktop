import { z } from 'zod';
import { AgentSessionIdSchema } from './agent';

const StableJournalId = z.string().regex(/^journal_[a-z0-9]+$/);
const StableProjectId = z.string().regex(/^project_[a-z0-9]+$/);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}, '无效日期');

export const CreateJournalInputSchema = z.object({
  date: IsoDate,
  body: z.string().trim().min(1).max(100_000),
  projectIds: z.array(StableProjectId).max(20).default([]),
}).strict();

export const UpdateJournalInputSchema = CreateJournalInputSchema.extend({
  id: StableJournalId,
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
}).strict();

export const JournalQuerySchema = z.object({
  start: IsoDate.optional(),
  end: IsoDate.optional(),
  projectId: StableProjectId.optional(),
}).strict();

export const CreateProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
}).strict();

export const IdSchema = z.string().regex(/^(journal|project)_[a-z0-9]+$/);

export const SaveProviderConfigInputSchema = z.object({
  providerId: z.enum(['openai', 'deepseek', 'custom']),
  baseUrl: z.string().trim().min(1).max(2048),
  model: z.string().trim().min(1).max(160),
  agentThinking: z.enum(['disabled', 'enabled']).default('disabled'),
  apiKey: z.string().trim().min(1).max(4096).optional(),
}).strict();
export const SaveProfileInputSchema = z.object({ body: z.string().trim().min(1).max(100_000), enabledForAi: z.boolean() }).strict();
export type SaveProfileInput = z.infer<typeof SaveProfileInputSchema>;

export const GenerateDailyReviewInputSchema = z.object({
  date: IsoDate,
  /** 新调用必须绑定具体日志；旧日期调用仅在当天唯一日志时兼容。 */
  journalId: StableJournalId.optional(),
  regenerate: z.boolean().optional(),
}).strict();
const PeriodicReviewBaseSchema = z.object({
  type: z.enum(['weekly', 'monthly', 'project']), start: IsoDate, end: IsoDate,
  projectId: StableProjectId.optional(),
}).strict();
export const RenameProjectInputSchema = z.object({ id: StableProjectId, name: z.string().trim().min(1).max(80) }).strict();
const validPeriodicRange = (value: { start: string; end: string }) => value.start <= value.end;
export const PeriodicReviewPreviewInputSchema = PeriodicReviewBaseSchema
  .refine(validPeriodicRange, '开始日期不能晚于结束日期');
export const PeriodicReviewGenerateInputSchema = PeriodicReviewBaseSchema.extend({ previewToken: z.string().uuid() })
  .refine(validPeriodicRange, '开始日期不能晚于结束日期');
export type PeriodicReviewPreviewInput = z.infer<typeof PeriodicReviewPreviewInputSchema>;
export type PeriodicReviewGenerateInput = z.infer<typeof PeriodicReviewGenerateInputSchema>;

const InsightRangeSchema = z.object({ start: IsoDate, end: IsoDate });
const CoachInsightSchema = InsightRangeSchema.extend({ type: z.literal('coach') }).strict();
const YearlyInsightSchema = InsightRangeSchema.extend({ type: z.literal('yearly') }).strict();
const LifeDesignInsightSchema = InsightRangeSchema.extend({
  type: z.literal('life-design'),
  topic: z.string().trim().min(1).max(120).optional(),
}).strict();
const InsightReviewBaseSchema = z.discriminatedUnion('type', [CoachInsightSchema, YearlyInsightSchema, LifeDesignInsightSchema]);
export const InsightReviewPreviewInputSchema = InsightReviewBaseSchema.refine(validPeriodicRange, '开始日期不能晚于结束日期');
export const InsightReviewGenerateInputSchema = z.union([
  CoachInsightSchema.extend({ previewToken: z.string().uuid() }),
  YearlyInsightSchema.extend({ previewToken: z.string().uuid() }),
  LifeDesignInsightSchema.extend({ previewToken: z.string().uuid() }),
]).refine(validPeriodicRange, '开始日期不能晚于结束日期');
export type InsightReviewPreviewInput = z.infer<typeof InsightReviewPreviewInputSchema>;
export type InsightReviewGenerateInput = z.infer<typeof InsightReviewGenerateInputSchema>;

const StableReviewId = z.string().regex(/^review_[a-z0-9]+$/);
export const ProposePatternsInputSchema = z.object({ reviewId: StableReviewId }).strict();
export const ConfirmPatternInputSchema = z.object({
  statement: z.string().trim().min(1).max(500),
  evidenceSummary: z.string().trim().min(1).max(1000),
  sourceReviewIds: z.array(StableReviewId).min(1).max(20),
}).strict();
export type ProposePatternsInput = z.infer<typeof ProposePatternsInputSchema>;
export type ConfirmPatternInput = z.infer<typeof ConfirmPatternInputSchema>;

export type CreateJournalInput = z.infer<typeof CreateJournalInputSchema>;
export type UpdateJournalInput = z.infer<typeof UpdateJournalInputSchema>;
export type JournalQuery = z.infer<typeof JournalQuerySchema>;
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;
export type RenameProjectInput = z.infer<typeof RenameProjectInputSchema>;
export type SaveProviderConfigInput = z.infer<typeof SaveProviderConfigInputSchema>;

export const TemplateNameSchema = z.string().trim().min(1).max(40).regex(/^[^/\\:*?"<>|]+$/, '模板名包含非法字符');
export const SaveTemplateInputSchema = z.object({ name: TemplateNameSchema, body: z.string().trim().min(1).max(50_000) }).strict();
export type SaveTemplateInput = z.infer<typeof SaveTemplateInputSchema>;
export const ChangeDataRootInputSchema = z.object({ target: z.string().min(1), move: z.boolean() }).strict();
export type ChangeDataRootInput = z.infer<typeof ChangeDataRootInputSchema>;

export const AgentStartInputSchema = z.object({ title: z.string().trim().min(1).max(80).optional() }).strict();
export const AgentSendInputSchema = z.object({ sessionId: AgentSessionIdSchema, message: z.string().trim().min(1).max(20_000) }).strict();
export const AgentSessionInputSchema = z.object({ sessionId: AgentSessionIdSchema }).strict();
export const AgentConfirmInputSchema = z.object({ sessionId: AgentSessionIdSchema, approvalId: z.string().regex(/^approval_[a-z0-9]+$/) }).strict();
export type AgentStartInput = z.infer<typeof AgentStartInputSchema>;
export type AgentSendInput = z.infer<typeof AgentSendInputSchema>;
export type AgentSessionInput = z.infer<typeof AgentSessionInputSchema>;
export type AgentConfirmInput = z.infer<typeof AgentConfirmInputSchema>;
