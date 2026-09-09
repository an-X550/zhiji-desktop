import type { Journal, Review } from '../../shared/schemas/domain';
import { appError } from '../../shared/errors/app-error';
import { buildDailyContext } from '../domain/daily-context';
import type { ProviderPort } from '../infrastructure/ai/provider-port';
import type { ChatMessage } from '../infrastructure/ai/openai-compatible-provider';
import { DAILY_REVIEW_SYSTEM_PROMPT, parseDailyReviewOutput, renderDailyReview, type DailyReviewOutput } from '../prompts/daily-review-v1';
import { buildDailyEvidence, type DailyEvidence, type DailyEvidenceGrade } from './daily-evidence';
import { confirmPersonalExperience } from './daily-grade-review';
import { collectValidated } from './collect-validated';

export type { ProviderPort };

export type DailyRuntimeResult =
  | { kind: 'review'; body: string; grade: Exclude<DailyEvidenceGrade, 'D'>; output: DailyReviewOutput }
  | { kind: 'clarification'; question: string; grade: 'D' };

interface RuntimeInput {
  journals: Journal[];
  reviews: Review[];
  provider: ProviderPort;
  profile?: string;
  signal?: AbortSignal;
  onStructuredRetry?(): void;
}

function clarification(evidence: DailyEvidence): DailyRuntimeResult {
  const missing = evidence.gaps[0] ?? '缺少可用于分析的具体经历';
  return { kind: 'clarification', grade: 'D', question: `为了给你有依据的反馈，请补充：${missing}。` };
}

function gradeInstruction(grade: Exclude<DailyEvidenceGrade, 'D'>): string {
  if (grade === 'B') return '本次是 B 级证据：只保留一个核心洞察；没有明确跨日证据时 patternConnection 必须为 null。';
  if (grade === 'C') return '本次是 C 级证据：只镜像可核验事实或状态，patternConnection 必须为 null；不得推断根因、动机或长期模式。';
  return '本次是 A 级证据：仅在给定材料支持时才可填写 patternConnection。';
}

const DAILY_REVIEW_MAX_TOKENS = 1200;
const DAILY_REVIEW_RETRY_MAX_TOKENS = 2400;

async function generateReview(input: RuntimeInput, evidence: DailyEvidence): Promise<DailyRuntimeResult> {
  if (!evidence || evidence.grade === 'D') throw appError({ code: 'UNKNOWN', message: '日反馈工作流缺少可生成的证据等级。' });
  const context = buildDailyContext(input.journals, input.reviews);
  const messages: ChatMessage[] = [
    { role: 'system', content: `${DAILY_REVIEW_SYSTEM_PROMPT}\n\n${gradeInstruction(evidence.grade)}` },
    { role: 'user', content: JSON.stringify({ context, evidence, ...(input.profile ? { profile: input.profile } : {}) }) },
  ];
  const { value: output } = await collectValidated({ provider: input.provider, messages, signal: input.signal, maxTokens: DAILY_REVIEW_MAX_TOKENS, retryMaxTokens: DAILY_REVIEW_RETRY_MAX_TOKENS, thinking: 'disabled', parse: parseDailyReviewOutput, onRetry: input.onStructuredRetry });
  const normalized = evidence.grade === 'C' ? { ...output, patternConnection: null } : output;
  const date = input.journals[0]?.date;
  if (!date) throw appError({ code: 'UNKNOWN', message: '日反馈工作流缺少日志日期。' });
  return { kind: 'review', grade: evidence.grade, body: renderDailyReview(normalized, date), output: normalized };
}

async function reviewGrade(input: RuntimeInput, evidence: DailyEvidence): Promise<DailyEvidence> {
  if (evidence.grade !== 'D') return evidence;
  const confirmed = await confirmPersonalExperience(input.provider, input.journals, input.signal);
  if (!confirmed) return evidence;
  // 保守升级：只升到 C（镜像反射级），不跳 A/B，避免过度修正
  return { ...evidence, grade: 'C' };
}

export async function runDailyFeedback(input: RuntimeInput): Promise<DailyRuntimeResult> {
  const evidence = await reviewGrade(input, buildDailyEvidence(input.journals));
  if (evidence.grade === 'D') return clarification(evidence);
  return generateReview(input, evidence);
}
