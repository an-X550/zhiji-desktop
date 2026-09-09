import type { Project } from '../../../shared/schemas/domain';
import { HISTORY_KIND_LABELS, type HistoryItem } from '../../domain/history-items';

export function HistoryFilter({ type, text, projectId, projects, allowedKinds, onType, onText, onProject }: { type: string; text: string; projectId: string; projects: Project[]; allowedKinds: HistoryItem['kind'][]; onType(value: string): void; onText(value: string): void; onProject(value: string): void }) {
  return <div className={`history-filters ${allowedKinds.length > 1 ? 'history-filters--three' : 'history-filters--two'}`}>
    {allowedKinds.length > 1 && <label>记录类型<select aria-label="记录类型" value={type} onChange={(event) => onType(event.target.value)}><option value="all">全部</option>{allowedKinds.map((kind) => <option key={kind} value={kind}>{HISTORY_KIND_LABELS[kind]}</option>)}</select></label>}
    <label>搜索<input aria-label="搜索历史" value={text} onChange={(event) => onText(event.target.value)} placeholder="搜索正文"/></label>
    <label>项目<select aria-label="项目筛选" value={projectId} onChange={(event) => onProject(event.target.value)}><option value="">全部项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
  </div>;
}
