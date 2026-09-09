import { ipcMain as electronIpcMain, type dialog as ElectronDialog, shell } from 'electron';
import { z } from 'zod';
import { appError } from '../../shared/errors/app-error';
import { AgentConfirmInputSchema, AgentSendInputSchema, AgentSessionInputSchema, AgentStartInputSchema, ChangeDataRootInputSchema, ConfirmPatternInputSchema, CreateJournalInputSchema, CreateProjectInputSchema, GenerateDailyReviewInputSchema, IdSchema, InsightReviewGenerateInputSchema, InsightReviewPreviewInputSchema, JournalQuerySchema, PeriodicReviewGenerateInputSchema, PeriodicReviewPreviewInputSchema, ProposePatternsInputSchema, RenameProjectInputSchema, SaveProfileInputSchema, SaveProviderConfigInputSchema, SaveTemplateInputSchema, TemplateNameSchema, UpdateJournalInputSchema } from '../../shared/schemas/ipc';
import type { MarkdownProfileRepository } from '../infrastructure/markdown/profile-repository';
import type { MarkdownJournalRepository } from '../infrastructure/markdown/journal-repository';
import type { JsonProjectRepository } from '../infrastructure/markdown/project-repository';
import type { CreateJournal, UpdateJournal } from '../application/save-journal';
import type { ConfigureAi } from '../application/configure-ai';
import type { GenerateDailyReview } from '../application/generate-daily-review';
import type { MarkdownReviewRepository } from '../infrastructure/markdown/review-repository';
import type { ReviewTaskManager } from '../domain/review-task';
import type { GeneratePeriodicReview } from '../application/generate-periodic-review';
import type { DataTransferService } from '../infrastructure/transfer/data-transfer-service';
import type { DataDirectoryService } from '../infrastructure/data-directory/data-directory-service';
import type { DataRootHolder } from '../infrastructure/data-directory/data-root-holder';
import type { DataRootConfig } from '../infrastructure/data-directory/data-root-config';
import type { TemplateRepository } from '../infrastructure/templates/template-repository';
import type { GenerateInsightReview } from '../application/generate-insight-review';
import type { VerifiedPatternService } from '../application/verified-patterns';
import type { WebSearchService } from '../infrastructure/web/web-search-service';
import type { AgentFacade } from '../agent/agent-facade';
import type { MaintenanceCoordinator } from '../infrastructure/lifecycle/maintenance-coordinator';
import type { IpcSourceGuard } from './ipc-source-guard';
import type { AgentMemorySearchService } from '../agent/agent-memory-search-service';

export function registerHandlers(deps: { createJournal: CreateJournal; updateJournal: UpdateJournal; journals: MarkdownJournalRepository; projects: JsonProjectRepository; profile: MarkdownProfileRepository; configureAi: ConfigureAi; generateDailyReview: GenerateDailyReview; generatePeriodicReview: GeneratePeriodicReview; generateInsightReview: GenerateInsightReview; verifiedPatterns: VerifiedPatternService; webSearch: WebSearchService; templates: TemplateRepository; dataRootHolder: DataRootHolder; dataRootConfig: DataRootConfig; appVersion: string; reviews: MarkdownReviewRepository; reviewTasks: ReviewTaskManager; transfer: DataTransferService; dataDirectory: DataDirectoryService; dialog: Pick<typeof ElectronDialog, 'showSaveDialog' | 'showOpenDialog'>; agentFacade: AgentFacade; maintenance: MaintenanceCoordinator; sourceGuard: IpcSourceGuard; memorySearch: Pick<AgentMemorySearchService, 'invalidate'> }) {
  /** 所有生成类通道共用：从公开配置取当前模型注入输入。 */
  const withModel = async <T extends object>(input: T): Promise<T & { model: string }> => ({ ...input, model: (await deps.configureAi.getPublicConfig()).model });
  const agentSubscriptions = new Map<number, () => void>();
  const write = <T>(task: () => Promise<T>): Promise<T> => deps.maintenance.runWrite(async () => { const result = await task(); deps.memorySearch.invalidate(); return result; });
  const ipcMain = { handle: (channel: string, handler: (event: Electron.IpcMainInvokeEvent, raw?: unknown) => unknown) => electronIpcMain.handle(channel, (event, raw) => { deps.sourceGuard.assert(event); return handler(event, raw); }) };
  const ensureAgentSubscription = (sender: Electron.IpcMainInvokeEvent['sender']) => {
    if (agentSubscriptions.has(sender.id)) return;
    const unsubscribe = deps.agentFacade.subscribe((payload) => { if (!sender.isDestroyed()) sender.send('agent:event', payload); });
    agentSubscriptions.set(sender.id, unsubscribe);
    sender.once('destroyed', () => { agentSubscriptions.get(sender.id)?.(); agentSubscriptions.delete(sender.id); });
  };
  ipcMain.handle('agent:start', async (event, raw) => { ensureAgentSubscription(event.sender); return deps.agentFacade.start(AgentStartInputSchema.parse(raw).title); });
  ipcMain.handle('agent:send', async (event, raw) => { ensureAgentSubscription(event.sender); const input = AgentSendInputSchema.parse(raw); await deps.agentFacade.send(input.sessionId, input.message); });
  ipcMain.handle('agent:cancel', async (event, raw) => { ensureAgentSubscription(event.sender); await deps.agentFacade.cancel(AgentSessionInputSchema.parse(raw).sessionId); });
  ipcMain.handle('agent:delete', async (event, raw) => { ensureAgentSubscription(event.sender); await deps.agentFacade.delete(AgentSessionInputSchema.parse(raw).sessionId); });
  ipcMain.handle('agent:confirm', async (event, raw) => { ensureAgentSubscription(event.sender); const input = AgentConfirmInputSchema.parse(raw); await deps.agentFacade.confirm(input.sessionId, input.approvalId); });
  ipcMain.handle('agent:list', async (event) => { ensureAgentSubscription(event.sender); return deps.agentFacade.list(); });
  ipcMain.handle('agent:get', (event, raw) => { ensureAgentSubscription(event.sender); return deps.agentFacade.get(AgentSessionInputSchema.parse(raw).sessionId); });
  ipcMain.handle('data-directory:get-info', () => deps.dataDirectory.getInfo());
  ipcMain.handle('data-directory:open', () => deps.dataDirectory.open());
  ipcMain.handle('data-directory:pick-folder', async () => {
    const result = await deps.dialog.showOpenDialog({ title: '选择数据存储位置', properties: ['openDirectory'] });
    return result.canceled || !result.filePaths[0] ? { canceled: true } : { canceled: false, path: result.filePaths[0] };
  });
  ipcMain.handle('data-directory:change-location', async (_event, raw) => deps.dataRootHolder.changeLocation(ChangeDataRootInputSchema.parse(raw).target, { move: ChangeDataRootInputSchema.parse(raw).move }));
  ipcMain.handle('templates:list', () => deps.templates.list());
  ipcMain.handle('templates:get', (_event, raw) => deps.templates.get(TemplateNameSchema.parse(raw)));
  ipcMain.handle('templates:save', (_event, raw) => write(() => deps.templates.save(SaveTemplateInputSchema.parse(raw))));
  ipcMain.handle('templates:delete', (_event, raw) => write(() => deps.templates.delete(TemplateNameSchema.parse(raw))));
  ipcMain.handle('app:get-info', () => ({ version: deps.appVersion }));
  ipcMain.handle('profile:get', () => deps.profile.get()); ipcMain.handle('profile:save', (_event, raw) => write(() => deps.profile.save(SaveProfileInputSchema.parse(raw)))); ipcMain.handle('profile:clear', () => write(() => deps.profile.clear()));
  ipcMain.handle('transfer:export', async () => {
    const result = await deps.dialog.showSaveDialog({ title: '导出知己备份', defaultPath: `知己备份-${new Date().toISOString().slice(0, 10)}.zhiji.zip`, filters: [{ name: '知己备份', extensions: ['zip'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    const destination = result.filePath.endsWith('.zhiji.zip') ? result.filePath : `${result.filePath.replace(/\.zip$/i, '')}.zhiji.zip`;
    return { canceled: false, ...await deps.maintenance.runMaintenance(() => deps.transfer.exportTo(destination)) };
  });
  ipcMain.handle('transfer:preview-restore', async () => {
    const result = await deps.dialog.showOpenDialog({ title: '选择知己备份', properties: ['openFile'], filters: [{ name: '知己备份', extensions: ['zip'] }] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return { canceled: false, ...await deps.transfer.preview(result.filePaths[0]) };
  });
  ipcMain.handle('transfer:restore', (_event, raw) => deps.maintenance.runMaintenance(async () => { const result = await deps.transfer.restore(z.string().uuid().parse(raw)); deps.memorySearch.invalidate(); return result; }));
  ipcMain.handle('journals:create', (_event, raw) => write(() => deps.createJournal.execute(CreateJournalInputSchema.parse(raw))));
  ipcMain.handle('journals:update', (_event, raw) => write(() => deps.updateJournal.execute(UpdateJournalInputSchema.parse(raw))));
  ipcMain.handle('journals:list', async (_event, raw = {}) => {
    const query = JournalQuerySchema.parse(raw);
    return (await deps.journals.list()).filter((item) => (!query.start || item.date >= query.start) && (!query.end || item.date <= query.end) && (!query.projectId || item.projectIds.includes(query.projectId)));
  });
  ipcMain.handle('journals:get', (_event, raw) => deps.journals.get(IdSchema.parse(raw)));
  ipcMain.handle('journals:delete', (_event, raw) => write(() => deps.journals.delete(IdSchema.refine((id) => id.startsWith('journal_')).parse(raw))));
  ipcMain.handle('projects:create', (_event, raw) => write(() => deps.projects.create(CreateProjectInputSchema.parse(raw).name)));
  ipcMain.handle('projects:list', () => deps.projects.list());
  ipcMain.handle('projects:archive', (_event, raw) => write(() => deps.projects.archive(IdSchema.refine((id) => id.startsWith('project_')).parse(raw))));
  ipcMain.handle('projects:rename', (_event, raw) => write(() => { const input = RenameProjectInputSchema.parse(raw); return deps.projects.rename(input.id, input.name); }));
  ipcMain.handle('projects:restore', (_event, raw) => write(() => deps.projects.restore(IdSchema.refine((id) => id.startsWith('project_')).parse(raw))));
  ipcMain.handle('projects:delete', async (_event, raw) => write(async () => { const id = IdSchema.refine((value) => value.startsWith('project_')).parse(raw); if ((await deps.journals.list()).some((journal) => journal.projectIds.includes(id))) throw appError({ code: 'INVALID_INPUT', message: '有关联日志，不能删除项目。' }); await deps.projects.delete(id); }));
  ipcMain.handle('settings:get', () => deps.configureAi.getPublicConfig());
  ipcMain.handle('settings:save', (_event, raw) => write(() => deps.configureAi.save(SaveProviderConfigInputSchema.parse(raw))));
  ipcMain.handle('settings:test', (_event, raw) => deps.configureAi.testConnection(SaveProviderConfigInputSchema.parse(raw)));
  ipcMain.handle('settings:clear-api-key', () => write(() => deps.configureAi.clearApiKey()));
  ipcMain.handle('reviews:generate-daily', async (event, raw) => {
    const input = GenerateDailyReviewInputSchema.parse(raw);
    deps.reviewTasks.onTransition = (phase) => { if (!event.sender.isDestroyed()) event.sender.send('reviews:task-phase', { phase }); };
    return write(async () => deps.generateDailyReview.execute(await withModel(input)));
  });
  ipcMain.handle('reviews:list', () => deps.reviews.list());
  ipcMain.handle('reviews:delete', (_event, raw) => write(() => deps.reviews.delete(z.string().regex(/^review_[a-z0-9]+$/).parse(raw))));
  ipcMain.handle('reviews:cancel', () => { const task = deps.reviewTasks.getCurrent(); if (task) deps.reviewTasks.cancel(task.taskId); });
  ipcMain.handle('reviews:preview', async (_event, raw) => { const input = PeriodicReviewPreviewInputSchema.parse(raw); return deps.generatePeriodicReview.preview(await withModel(input)); });
  ipcMain.handle('reviews:generate-periodic', async (event, raw) => { const input = PeriodicReviewGenerateInputSchema.parse(raw); deps.reviewTasks.onTransition = (phase) => { if (!event.sender.isDestroyed()) event.sender.send('reviews:task-phase', { phase }); }; return write(async () => deps.generatePeriodicReview.execute(await withModel(input))); });
  ipcMain.handle('reviews:preview-insight', async (_event, raw) => { const input = InsightReviewPreviewInputSchema.parse(raw); return deps.generateInsightReview.preview(await withModel(input)); });
  ipcMain.handle('reviews:generate-insight', async (event, raw) => { const input = InsightReviewGenerateInputSchema.parse(raw); deps.reviewTasks.onTransition = (phase) => { if (!event.sender.isDestroyed()) event.sender.send('reviews:task-phase', { phase }); }; return write(async () => deps.generateInsightReview.execute(await withModel(input))); });
  ipcMain.handle('patterns:list', async () => (await deps.verifiedPatterns.list()).patterns);
  ipcMain.handle('patterns:propose', async (_event, raw) => { const input = ProposePatternsInputSchema.parse(raw); return deps.verifiedPatterns.propose(await withModel(input)); });
  ipcMain.handle('patterns:confirm', (_event, raw) => write(() => deps.verifiedPatterns.confirm(ConfirmPatternInputSchema.parse(raw))));
  // 联网搜索仅作为 DSH 的受控工具使用，不向 renderer 暴露通用网络能力。
}
