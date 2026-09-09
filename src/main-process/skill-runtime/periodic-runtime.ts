import type { Journal, Review } from '../../shared/schemas/domain';
import { appError } from '../../shared/errors/app-error';
import type { ProviderPort } from '../infrastructure/ai/provider-port';
import type { ChatMessage } from '../infrastructure/ai/openai-compatible-provider';
import { applyPeriodicQualityGates, periodicSystemPrompt, parsePeriodicReviewOutput, renderPeriodicReview, type PeriodicReviewOutput } from '../prompts/periodic-review-v1';
import { buildPeriodicEvidence, type PeriodicEvidence, type PeriodicEvidenceGrade, type PeriodicReviewType } from './periodic-evidence';
import { buildPeriodicModelMaterials } from './periodic-materials';
import { collectValidated } from './collect-validated';

export type { ProviderPort };

export type PeriodicRuntimeResult =
  | { kind: 'review'; body: string; grade: Exclude<PeriodicEvidenceGrade, 'D'>; output: PeriodicReviewOutput }
  | { kind: 'clarification'; question: string; grade: 'D' };

interface RuntimeInput {
  type: PeriodicReviewType;
  start: string;
  end: string;
  journals: Journal[];
  reviews: Review[];
  provider: ProviderPort;
  profile?: string;
  signal?: AbortSignal;
  onStructuredRetry?(): void;
}

function clarification(evidence: PeriodicEvidence): PeriodicRuntimeResult {
  const missing = evidence.gaps[0] ?? '缺少可用于复盘的材料';
  return { kind: 'clarification', grade: 'D', question: `为了给你有依据的复盘，请补充：${missing}。` };
}

async function generateReview(input: RuntimeInput, evidence: PeriodicEvidence): Promise<PeriodicRuntimeResult> {
  if (!evidence || evidence.grade === 'D') throw appError({ code: 'UNKNOWN', message: '周期复盘工作流缺少可生成的证据等级。' });
  const { type, start, end, journals, reviews, provider, profile, signal } = input;
  const system = periodicSystemPrompt(type, evidence.grade);
  const payload = {
    type, period: { start, end },
    materials: buildPeriodicModelMaterials(type, journals, reviews),
    evidence,
    ...(profile ? { profile } : {}),
  };
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(payload) },
  ];
  const maxTokens = type === 'monthly' ? 2400 : 1800;
  const retryMaxTokens = type === 'monthly' ? 4800 : 3600;
  const { value: output } = await collectValidated({ provider, messages, signal, maxTokens, retryMaxTokens, parse: parsePeriodicReviewOutput, onRetry: input.onStructuredRetry });
  const gated = applyPeriodicQualityGates(output, evidence.grade, type);
  return { kind: 'review', grade: evidence.grade, body: renderPeriodicReview(gated, type, start, end), output: gated };
}

export async function runPeriodicFeedback(input: RuntimeInput): Promise<PeriodicRuntimeResult> {
  const evidence = buildPeriodicEvidence(input.type, input.journals, input.reviews);
  if (evidence.grade === 'D') return clarification(evidence);
  return generateReview(input, evidence);
}
