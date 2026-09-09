import { z } from 'zod';
import { parseFencedJson } from './parse-fenced-json';

export const DAILY_REVIEW_PROMPT_VERSION = 'daily-review-v4';
export const DAILY_REVIEW_SYSTEM_PROMPT = `你是知己 Skill 的日反馈分析器。只依据给定日志、前次反馈和用户明确允许使用的个人背景，不得编造事实。内部执行 D0-D6：闭环昨日行动；引用当天原文；只指出一个最关键观察；只有可靠证据且能改变行动时才连接历史模式；明天只能有一个动作，必须在五分钟内可启动且无需再次拆解；预测必须是 24 小时内可观察的真实行为或结果。

自由叙事不因缺少固定栏目降级。不得做确定性心理归因，不得把单一事件拔高为价值观。未记录不等于未做：没有记录昨日行动结果时只能标记 insufficient，不能推断未做；只有日志直接表明没有执行时才可标记 not_done。patternConnection 没有可靠证据时返回 null。普通情况全部文字控制在 260 个中文字符以内，例外也不得超过 320 个中文字符；只有昨日闭环证据复杂或当天材料存在直接证据冲突时才可增加必要说明，不得借此加入第二个洞察或第二个行动。

只返回一个 JSON 对象，不要 Markdown、代码块或额外说明。字段必须严格符合：
{
  "priorAction": null | { "action": "上一条反馈中的行动", "prediction": "上一条反馈中的预测", "status": "done" | "not_done" | "insufficient", "evidence": "今天日志的证据", "insightStatus": "上一条新认知本次被支持、未执行或证据不足的一句话" },
  "insight": { "quote": "日志原文中的短引用", "text": "一个盲点洞见" },
  "patternConnection": null | "一条有证据且会影响行动的历史连接",
  "action": { "step": "五分钟内可启动的行动", "prediction": "24小时内可观察的行为或结果" },
  "newInsight": "本次关键发现"
}`;

export const DailyReviewOutputSchema = z.object({
  priorAction: z.object({
    action: z.string().min(1).max(500),
    prediction: z.string().min(1).max(500),
    status: z.enum(['done', 'not_done', 'insufficient']),
    evidence: z.string().min(1).max(1000),
    insightStatus: z.string().min(1).max(500),
  }).strict().nullable(),
  insight: z.object({ quote: z.string().min(1).max(2000), text: z.string().min(1).max(4000) }).strict(),
  patternConnection: z.string().min(1).max(1000).nullable(),
  action: z.object({ step: z.string().min(1).max(1000), prediction: z.string().min(1).max(1000) }).strict(),
  newInsight: z.string().min(1).max(1000),
}).strict();

export type DailyReviewOutput = z.infer<typeof DailyReviewOutputSchema>;

export function parseDailyReviewOutput(raw: string): DailyReviewOutput {
  return parseFencedJson(raw, DailyReviewOutputSchema);
}

export function renderDailyReview(output: DailyReviewOutput, date: string): string {
  const [, month, day] = date.split('-').map(Number);
  const status = { done: '✅ 做到了', not_done: '❌ 没做', insufficient: '⚠️ 证据不足' } as const;
  return [
    `📋 ${month}月${day}日 日志反馈`,
    output.priorAction ? `⏮️ 昨天你答应自己\n${output.priorAction.action}；预测：${output.priorAction.prediction}\n${status[output.priorAction.status]} → ${output.priorAction.evidence}；${output.priorAction.insightStatus}` : null,
    `🔍 本次观察\n「${output.insight.quote}」${output.insight.text}`,
    output.patternConnection ? `🔗 和之前有关\n${output.patternConnection}` : null,
    `⚡ 明天试试\n行动：${output.action.step}\n预测：${output.action.prediction}`,
    `💊 新认知：${output.newInsight}\n验证：待明天`,
  ].filter(Boolean).join('\n\n');
}
