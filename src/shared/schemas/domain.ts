import { z } from 'zod';
import type { StructuredOutputDiagnostics } from '../errors/app-error';

const StableId = z.string().regex(/^(journal|review|project)_[a-z0-9]+$/);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const IsoDateTime = z.iso.datetime({ offset: true });

export const JournalSchema = z.object({
  schemaVersion: z.literal(1),
  id: StableId.refine((id) => id.startsWith('journal_')),
  date: IsoDate,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  projectIds: z.array(StableId.refine((id) => id.startsWith('project_'))),
  body: z.string().min(1),
});

export const ProjectSchema = z.object({
  schemaVersion: z.literal(1),
  id: StableId.refine((id) => id.startsWith('project_')),
  name: z.string().trim().min(1).max(80),
  status: z.enum(['active', 'archived']),
  createdAt: IsoDateTime,
  archivedAt: IsoDateTime.nullable(),
});

const ReviewBaseSchema = z.object({
  id: StableId.refine((id) => id.startsWith('review_')),
  type: z.enum(['daily', 'weekly', 'monthly', 'project', 'coach', 'yearly', 'life-design']),
  periodStart: IsoDate,
  periodEnd: IsoDate,
  sourceIds: z.array(StableId).min(1),
  projectId: StableId.nullable(),
  provider: z.literal('openai-compatible'),
  model: z.string().min(1),
  promptVersion: z.string().regex(/^[a-z-]+-v\d+$/),
  createdAt: IsoDateTime,
  body: z.string().min(1),
});
export const ReviewSchema = z.union([
  ReviewBaseSchema.extend({ schemaVersion: z.literal(1) }),
  ReviewBaseSchema.extend({
    schemaVersion: z.literal(2),
    sourceVersions: z.array(z.object({ id: StableId, updatedAt: IsoDateTime })).min(1),
  }),
]);
export const ProfileSchema = z.object({ schemaVersion: z.literal(1), body: z.string().max(100_000), enabledForAi: z.boolean(), createdAt: IsoDateTime, updatedAt: IsoDateTime });

const StablePatternId = z.string().regex(/^pattern_[a-z0-9]+$/);
const StableReviewId = z.string().regex(/^review_[a-z0-9]+$/);
export const VerifiedPatternSchema = z.object({
  schemaVersion: z.literal(1),
  id: StablePatternId,
  statement: z.string().trim().min(1).max(500),
  evidenceSummary: z.string().trim().min(1).max(1000),
  sourceReviewIds: z.array(StableReviewId).min(1).max(20),
  createdAt: IsoDateTime,
});
export const VerifiedPatternSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: IsoDateTime,
  patterns: z.array(VerifiedPatternSchema).max(500),
});
export const VerifiedPatternCandidateSchema = z.object({
  statement: z.string().trim().min(1).max(500),
  evidenceSummary: z.string().trim().min(1).max(1000),
  sourceReviewIds: z.array(StableReviewId).min(1).max(20),
}).strict();

export type Journal = z.infer<typeof JournalSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Review = z.infer<typeof ReviewSchema>;
export type DailyGenerationResult =
  | { kind: 'review'; review: Review; warning?: string; cached?: boolean }
  | { kind: 'clarification'; question: string }
  | { kind: 'error'; message: string; diagnostics: StructuredOutputDiagnostics };
export type PeriodicGenerationResult =
  | { kind: 'review'; review: Review }
  | { kind: 'clarification'; question: string }
  | { kind: 'error'; message: string; diagnostics: StructuredOutputDiagnostics };
export type InsightReviewType = Extract<Review['type'], 'coach' | 'yearly' | 'life-design'>;
export type Profile = z.infer<typeof ProfileSchema>;
export type VerifiedPattern = z.infer<typeof VerifiedPatternSchema>;
export type VerifiedPatternSnapshot = z.infer<typeof VerifiedPatternSnapshotSchema>;
export type VerifiedPatternCandidate = z.infer<typeof VerifiedPatternCandidateSchema>;

export const WebSearchResultSchema = z.object({
  sourceId: z.string().regex(/^source_[a-z0-9]+$/),
  title: z.string().trim().min(1).max(300),
  url: z.url().max(2048),
  domain: z.string().trim().min(1).max(255),
  snippet: z.string().max(1000),
  publishedAt: z.string().max(40).nullable(),
  retrievedAt: IsoDateTime,
});
export type WebSearchResult = z.infer<typeof WebSearchResultSchema>;

export const WebSourceContentSchema = z.object({
  title: z.string().trim().min(1).max(300),
  url: z.url().max(2048),
  domain: z.string().trim().min(1).max(255),
  publishedAt: z.string().max(40).nullable(),
  retrievedAt: IsoDateTime,
  excerpt: z.string().max(2000),
}).strict();
export type WebSourceContent = z.infer<typeof WebSourceContentSchema>;

// —— 契约层共享类型（S5：从 main-process 归位到 shared，消除反向依赖） ——

export const AgentThinkingModeSchema = z.enum(['disabled', 'enabled']).default('disabled');
export const ProviderConfigSchema = z.object({
  providerId: z.enum(['openai', 'deepseek', 'custom']),
  baseUrl: z.string().trim().min(1).max(2048),
  model: z.string().trim().min(1).max(160),
  agentThinking: AgentThinkingModeSchema,
}).strict();
export const PublicProviderConfigSchema = ProviderConfigSchema.extend({ hasApiKey: z.boolean() }).strict();
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type PublicProviderConfig = z.infer<typeof PublicProviderConfigSchema>;

export const AiUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  cachedInputTokens: z.number().int().nonnegative().nullable(),
}).strict();
export type AiUsage = z.infer<typeof AiUsageSchema>;

/** 设置页连接测试返回的安全诊断；不包含 API Key、提示词或模型原文。 */
export const AiConnectionTestResultSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1),
  finishReason: z.string().nullable(),
  outputLength: z.number().int().nonnegative(),
  jsonValid: z.boolean(),
  usage: AiUsageSchema.nullable(),
  reasoningPresent: z.boolean(),
  refusalPresent: z.boolean(),
}).strict();
export type AiConnectionTestResult = z.infer<typeof AiConnectionTestResultSchema>;

const DataCategoryCountsSchema = z.object({
  journals: z.number().int().nonnegative(),
  reviews: z.number().int().nonnegative(),
  projects: z.number().int().nonnegative(),
  profile: z.number().int().nonnegative(),
  settings: z.number().int().nonnegative(),
}).strict();
export const DataDirectoryInfoSchema = z.object({
  path: z.string().min(1),
  writable: z.boolean(),
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  categories: DataCategoryCountsSchema,
}).strict();
export type DataDirectoryInfo = z.infer<typeof DataDirectoryInfoSchema>;

// —— 契约返回类型命名化（S5：desktop-api 匿名内联类型归位） ——

export const BackupExportOutcomeSchema = z.object({
  canceled: z.boolean(),
  path: z.string().min(1).optional(),
  fileCount: z.number().int().nonnegative().optional(),
  totalBytes: z.number().int().nonnegative().optional(),
}).strict();
export type BackupExportOutcome = z.infer<typeof BackupExportOutcomeSchema>;

export const RestorePreviewOutcomeSchema = z.object({
  canceled: z.boolean(),
  previewId: z.string().min(1).optional(),
  archivePath: z.string().min(1).optional(),
  exportedAt: z.string().min(1).optional(),
  appVersion: z.string().min(1).optional(),
  fileCount: z.number().int().nonnegative().optional(),
  totalBytes: z.number().int().nonnegative().optional(),
  categories: DataCategoryCountsSchema.optional(),
}).strict();
export type RestorePreviewOutcome = z.infer<typeof RestorePreviewOutcomeSchema>;

export const RestoreResultSchema = z.object({
  fileCount: z.number().int().nonnegative(),
}).strict();
export type RestoreResult = z.infer<typeof RestoreResultSchema>;

/** 周期与洞察复盘共用的材料预览结果（原 preview/previewInsight 重复定义合并）。 */
export const ReviewPreviewSchema = z.object({
  token: z.string().min(1),
  type: z.string().min(1),
  start: IsoDate,
  end: IsoDate,
  sources: z.array(z.object({ id: z.string().min(1), date: IsoDate, excerpt: z.string() })),
}).strict();
export type ReviewPreview = z.infer<typeof ReviewPreviewSchema>;

/** 日志模板：name 为模板名，body 为待插入正文。 */
export interface JournalTemplate { name: string; body: string }
