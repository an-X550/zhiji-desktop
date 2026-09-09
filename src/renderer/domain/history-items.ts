import type { Journal, Project, Review } from '../../shared/schemas/domain';
export interface HistoryItem { id: string; kind: 'journal' | Review['type']; date: string; createdAt: string; title: string; body: string; projectIds: string[]; sourceIds: string[]; sourceSummaries: string[] }
/** 历史记录类型的统一中文标签，历史页/筛选器/阅读器共用这一处定义。 */
export const HISTORY_KIND_LABELS: Record<HistoryItem['kind'], string> = { journal: '日志', daily: '日反馈', weekly: '周报', monthly: '月报', project: '项目复盘', coach: '日志质量', yearly: '年度回顾', 'life-design': '方向校准' };

function readableSummary(body: string, fallback: string, skipHeadings = false): string {
  const line = body.split(/\r?\n/).map((value) => value.trim()).find((value) => value && (!skipHeadings || !/^#{1,6}\s/.test(value))) ?? '';
  const cleaned = line
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^>\s*/, '')
    .replace(/^[*_`]+|[*_`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || fallback).slice(0, 55);
}

export function buildHistoryItems(journals: Journal[], reviews: Review[], projects: Project[]): HistoryItem[] {
  const projectNames = new Map(projects.map((item) => [item.id, item.name]));
  const journalById = new Map(journals.map((item) => [item.id, item]));
  const journalItems = journals.map((item): HistoryItem => ({
    id: item.id,
    kind: 'journal',
    date: item.date,
    createdAt: item.createdAt,
    title: readableSummary(item.body, '无标题日志'),
    body: item.body,
    projectIds: item.projectIds,
    sourceIds: [],
    sourceSummaries: [],
  }));
  const reviewItems = reviews.map((item): HistoryItem => ({
    id: item.id,
    kind: item.type,
    date: item.periodEnd,
    createdAt: item.createdAt,
    title: readableSummary(item.body, `${item.periodStart} 复盘`, true),
    body: item.body,
    projectIds: item.projectId ? [item.projectId] : [],
    sourceIds: item.sourceIds,
    sourceSummaries: item.sourceIds.map((sourceId) => {
      const source = journalById.get(sourceId);
      return source ? `${source.date} · ${readableSummary(source.body, '日志')}` : '相关日志（当前列表中不可见）';
    }),
  }));
  return [...journalItems, ...reviewItems]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    .map((item) => ({ ...item, title: item.title || item.projectIds.map((id) => projectNames.get(id)).filter(Boolean).join('、') }));
}
