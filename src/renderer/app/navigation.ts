export type AppView = 'start' | 'agent' | 'journal' | 'reviews' | 'projects' | 'settings';
export type SettingsSection = 'general' | 'ai' | 'data';

export type NavigationIntent =
  | { type: 'journal.compose' }
  | { type: 'journal.generate-daily' }
  | { type: 'records.journals'; id?: string }
  | { type: 'records.reviews'; id?: string }
  | { type: 'review.weekly' }
  | { type: 'review.monthly'; month?: string }
  | { type: 'review.yearly'; year?: string }
  | { type: 'review.coach' }
  | { type: 'review.project'; projectId: string };

export type NavigationTarget = { view: AppView; intent?: NavigationIntent; settingsSection?: SettingsSection };

/** 将 Agent 传来的受校验数据映射为既有页面意图；不解释文本或执行脚本。 */
export function agentNavigationTarget(raw: unknown): NavigationTarget | null {
  const parsed = AgentNavigationTargetSchema.safeParse(raw);
  if (!parsed.success) return null;
  return mapAgentTarget(parsed.data);
}

function mapAgentTarget(target: AgentNavigationTarget): NavigationTarget {
  if (target.view === 'journal') return { view: 'journal', ...(target.intent === 'compose' ? { intent: { type: 'journal.compose' } } : target.intent === 'records' ? { intent: { type: 'records.journals' } } : target.intent === 'generate-daily' ? { intent: { type: 'journal.generate-daily' } } : {}) };
  if (target.view === 'reviews') return { view: 'reviews', ...(target.intent === 'weekly' ? { intent: { type: 'review.weekly' } } : target.intent === 'monthly' ? { intent: { type: 'review.monthly' } } : target.intent === 'yearly' ? { intent: { type: 'review.yearly' } } : target.intent === 'coach' ? { intent: { type: 'review.coach' } } : target.intent === 'project' ? { intent: { type: 'review.project', projectId: target.projectId } } : {}) };
  return { view: target.view };
}

export const APP_NAVIGATION: { id: AppView; label: string }[] = [
  { id: 'start', label: '开始' },
  { id: 'agent', label: '知己 Agent' },
  { id: 'journal', label: '日志' },
  { id: 'reviews', label: '复盘' },
  { id: 'projects', label: '项目' },
  { id: 'settings', label: '设置' },
];
import { AgentNavigationTargetSchema, type AgentNavigationTarget } from '../../shared/schemas/agent-tools';
