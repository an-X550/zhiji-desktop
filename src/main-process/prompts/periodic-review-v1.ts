import { z } from 'zod';
import { parseFencedJson } from './parse-fenced-json';
import type { PeriodicEvidenceGrade, PeriodicReviewType } from '../skill-runtime/periodic-evidence';

export const PERIODIC_REVIEW_PROMPT_VERSION = 'periodic-review-v4';

const REVIEW_LABELS: Record<PeriodicReviewType, string> = {
  weekly: '周报',
  monthly: '月报',
  project: '项目复盘',
};

export function periodicSystemPrompt(type: PeriodicReviewType, grade: Exclude<PeriodicEvidenceGrade, 'D'>): string {
  const label = REVIEW_LABELS[type];
  const gradeRule = grade === 'A'
    ? '本次是 A 级证据：材料充足，可完整回答复盘六问。'
    : grade === 'B'
      ? `本次是 B 级证据：下游沉淀不足，只保留核心洞察；不得推断未经材料支持的长期模式。`
      : `本次是 C 级证据：只有原始日志没有下游沉淀，只镜像可核验事实；不得推断根因、动机或长期模式。`;
  return `你是知己 Skill 的${label}分析器。只依据给定材料和用户明确允许使用的个人背景，不得编造事实。${gradeRule}

材料按“下游沉淀优先”组织：materials.primary 是主材料（日反馈或周复盘等已沉淀复盘，或仅有原始日志时的日志）；materials.supplement 仅在主材料不足时补充原始日志全文；materials.journalIndex 是原始日志索引，只用于核对日期与引用，不是默认主输入。优先依据 primary 下结论；只有 primary 引用缺失、证据冲突或关键判断需要补证时，才引用 supplement 与 journalIndex 中的日志。

执行复盘六问：回顾目标（本期目标是什么，与长期方向的关系）；评估结果（实际结果与达成度）；分析原因（正向）（哪些做法有效、值得放大）；分析原因（负向）（哪些无效、根因是什么）；重来演练（如果重来会保留什么、调整什么，必须独立成节）；后续规划（下周期目标、手段与检查方式）。六问是稳定导航：每节只写会改变本周期评价、重来选择或后续行动的判断；同一证据不得跨节重复铺陈；没有新增判断时写一句“无新增判断”即可，不得为覆盖清单硬凑内容。

硬质量门：重要结论必须有具体证据，证据不足时必须明确标注“证据不足”并降级表述；会改变行动、取舍或评价的关键判断必须说明限制、反例或可信替代解释。周报原因分析只做 3Why，不深挖到信念层；周报的后续规划必须包含目标 + 手段 + 检查方式，保留的行动必须可检查。

方向锚点缺席检查：从材料与个人背景中识别长期方向锚点（如求职、作息稳定等主线），逐个检查本周期是否有行动证据，status 只能取五态之一：有推进（有明确行动证据）；缺席-未执行（材料直接表明没有执行、计划落空或以替代投入取代该方向）；缺席-未记录（提到做了但缺过程、数量或结果）；目标变化（已被主动降级或替换）；证据不足（无法判断，需下周期补记录）。未记录不等于未执行，只有直接证据才可使用缺席-未执行。缺席不是失败，是需要确认的校准信号；材料中确实找不到任何方向锚点时返回空数组。

qualitySelfCheck 只披露会影响结论或后续行动的异常（证据不足、方向锚点不足、缺少对比基线）；没有异常时只写“质量门已通过；无影响本次判断的已知缺口。”

${type === 'monthly' ? `月报深度：在正式写报告前先从本月材料中归并 2-3 个主主题到 mainThemes；材料按主题组织，不按视角顺序展开；每个主题补齐主题名（name）、支持视角（supportingPerspectives）、关键证据（keyEvidence）、反例或证据不足说明（counterExampleOrGap）、对重来演练或下月规划的意义（significance）。归并不出至少 2 个主主题或证据不足时返回空数组并在 qualitySelfCheck 如实记录，不强行制造。月报的 nextPlan 必须包含目标 + 手段 + 检查点 + 假说（hypothesis）。如果本月材料显示长期方向冲突、重复卡点、工作观／人生观冲突，或下月规划只能做局部修补，在 escalationReminder 写一条基于证据的升级提醒（至多一条），格式：“⚠️ 这可能不是普通执行问题：［用一句话点出证据］。建议在复盘页的“方向校准”做一次人生设计校准。”不要自动生成方向校准报告；没有触发条件时 escalationReminder 返回 null。` : '周报与项目复盘：mainThemes 返回空数组，hypothesis 与 escalationReminder 返回 null。'}

不得做确定性心理归因，不得把单一事件拔高为价值观。所有文字合计应能排版在 800 个中文字符内。

只返回一个 JSON 对象，不要 Markdown、代码块或额外说明。字段必须严格符合：
{
  "chatSummary": "一段话概括本期要点",
  "goalReview": "一、回顾目标",
  "resultEvaluation": "二、评估结果",
  "causesPositive": "三、分析原因（正向）",
  "causesNegative": "四、分析原因（负向）",
  "ifRedone": "五、重来演练",
  "nextPlan": { "goal": "下周期目标", "means": "手段路径", "check": "检查方式", "hypothesis": "假说（仅月报，其余为 null）" },
  "mainThemes": [{ "name": "主题名（仅月报，其余为空数组）", "supportingPerspectives": "支持视角", "keyEvidence": "关键证据", "counterExampleOrGap": "反例或证据不足说明", "significance": "对重来演练或下月规划的意义" }],
  "escalationReminder": "仅月报在触发条件满足时填写的提醒文本，其余为 null",
  "directionAnchors": [{ "name": "方向锚点名", "status": "有推进|缺席-未执行|缺席-未记录|目标变化|证据不足", "note": "状态依据" }],
  "qualitySelfCheck": "质量自检异常披露或通过说明"
}`;
}

export const DIRECTION_ANCHOR_STATUSES = ['有推进', '缺席-未执行', '缺席-未记录', '目标变化', '证据不足'] as const;

export const MonthlyMainThemeSchema = z.object({
  name: z.string().min(1).max(100),
  supportingPerspectives: z.string().min(1).max(500),
  keyEvidence: z.string().min(1).max(1000),
  counterExampleOrGap: z.string().min(1).max(1000),
  significance: z.string().min(1).max(1000),
}).strict();

export const PeriodicReviewOutputSchema = z.object({
  chatSummary: z.string().min(1).max(500),
  goalReview: z.string().min(1).max(2000),
  resultEvaluation: z.string().min(1).max(2000),
  causesPositive: z.string().min(1).max(2000),
  causesNegative: z.string().min(1).max(2000),
  ifRedone: z.string().min(1).max(2000),
  nextPlan: z.object({ goal: z.string().min(1).max(1000), means: z.string().min(1).max(1000), check: z.string().min(1).max(1000), hypothesis: z.string().min(1).max(1000).nullable().default(null) }).strict(),
  mainThemes: z.array(MonthlyMainThemeSchema).max(3).default([]),
  escalationReminder: z.string().min(1).max(1000).nullable().default(null),
  directionAnchors: z.array(z.object({ name: z.string().min(1).max(100), status: z.enum(DIRECTION_ANCHOR_STATUSES), note: z.string().min(1).max(500) }).strict()).max(10),
  qualitySelfCheck: z.string().min(1).max(1000),
}).strict();

export type PeriodicReviewOutput = z.infer<typeof PeriodicReviewOutputSchema>;

export function parsePeriodicReviewOutput(raw: string): PeriodicReviewOutput {
  return parseFencedJson(raw, PeriodicReviewOutputSchema);
}

// 代码层硬质量门：证据降级标注与方向锚点缺席披露不信任提示词自觉
export function applyPeriodicQualityGates(output: PeriodicReviewOutput, grade: 'A' | 'B' | 'C', type: PeriodicReviewType = 'weekly'): PeriodicReviewOutput {
  const disclosures: string[] = [];
  if (grade === 'B') disclosures.push('证据等级 B：下游沉淀不足，结论已按降级规则限制为核心洞察，未断言未经材料支持的长期模式。');
  if (grade === 'C') disclosures.push('证据等级 C：仅有原始日志，结论仅镜像可核验事实，未推断根因、动机或长期模式。');
  if (output.directionAnchors.length === 0) disclosures.push('方向锚点不足：本期材料未识别出方向锚点，缺席检查无法完成；请下周期补记录。');
  if (type === 'monthly' && output.mainThemes.length < 2) disclosures.push(`月报主主题不足：本月材料只归并出 ${output.mainThemes.length} 个主主题，按证据不足披露，不硬凑。`);
  if (disclosures.length === 0) return output;
  return { ...output, qualitySelfCheck: [...disclosures, output.qualitySelfCheck].join('\n') };
}

const SIXTH_HEADINGS: Record<PeriodicReviewType, string> = {
  weekly: '六、下周规划',
  monthly: '六、下月规划',
  project: '六、后续规划',
};

export function renderPeriodicReview(output: PeriodicReviewOutput, type: PeriodicReviewType, start: string, end: string): string {
  const label = REVIEW_LABELS[type];
  const anchors = output.directionAnchors.length > 0
    ? output.directionAnchors.map((anchor) => `- ${anchor.name}：${anchor.status}——${anchor.note}`).join('\n')
    : '本期材料未识别出方向锚点，缺席检查无法完成；这是需要确认的校准信号，请下周期补记录。';
  const sections: string[] = [
    `# ${label}（${start} ~ ${end}）`,
    `## 聊天摘要`,
    output.chatSummary,
  ];
  if (type === 'monthly') {
    sections.push(
      `## 主主题`,
      output.mainThemes.length > 0
        ? output.mainThemes.map((theme) => [
          `- **${theme.name}**`,
          `  - 支持视角：${theme.supportingPerspectives}`,
          `  - 关键证据：${theme.keyEvidence}`,
          `  - 反例或证据不足：${theme.counterExampleOrGap}`,
          `  - 对重来演练或下月规划的意义：${theme.significance}`,
        ].join('\n')).join('\n')
        : '本月材料未能归并出至少 2 个主主题，按证据不足如实记录；不硬凑。',
    );
  }
  sections.push(
    `## 一、回顾目标`,
    output.goalReview,
    `## 二、评估结果`,
    output.resultEvaluation,
    `## 三、分析原因（正向）`,
    output.causesPositive,
    `## 四、分析原因（负向）`,
    output.causesNegative,
    `## 五、重来演练`,
    output.ifRedone,
    `## ${SIXTH_HEADINGS[type]}`,
    `目标：${output.nextPlan.goal}`,
    `手段：${output.nextPlan.means}`,
    `检查方式：${output.nextPlan.check}`,
  );
  if (type === 'monthly' && output.nextPlan.hypothesis) sections.push(`假说：${output.nextPlan.hypothesis}`);
  if (type === 'monthly' && output.escalationReminder) sections.push(output.escalationReminder);
  sections.push(
    `## 方向锚点缺席检查`,
    anchors,
    `## 质量自检`,
    output.qualitySelfCheck,
  );
  return sections.join('\n\n');
}
