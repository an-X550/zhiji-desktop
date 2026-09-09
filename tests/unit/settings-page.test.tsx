// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from '../../src/renderer/pages/settings-page';

beforeEach(() => {
  window.zhiji = {
    profile: { get: vi.fn(async () => null), save: vi.fn(async (input) => ({ schemaVersion: 1, ...input, createdAt: '2026-08-13T00:00:00.000Z', updatedAt: '2026-08-13T00:00:00.000Z' })), clear: vi.fn(async () => undefined) },
    dataDirectory: { getInfo: vi.fn(async () => ({ path: 'D:\\知己', writable: true, fileCount: 6, totalBytes: 100, categories: { journals: 3, reviews: 2, projects: 1, profile: 0, settings: 0 } })), open: vi.fn(async () => undefined), pickFolder: vi.fn(async () => ({ canceled: true })), changeLocation: vi.fn() },
    transfer: { exportBackup: vi.fn(async () => ({ canceled: true })), previewRestore: vi.fn(async () => ({ canceled: true })), restore: vi.fn(async () => ({ fileCount: 0 })) },
    templates: { list: vi.fn(async () => []), get: vi.fn(), save: vi.fn(), delete: vi.fn() },
     app: { getInfo: vi.fn(async () => ({ version: '2.6.6' })) },
    settings: {
      getPublicConfig: vi.fn(async () => ({ providerId: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini', agentThinking: 'disabled' as const, hasApiKey: true })),
      save: vi.fn(async () => ({ providerId: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini', agentThinking: 'disabled' as const, hasApiKey: true })),
      clearApiKey: vi.fn(async () => ({ providerId: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini', agentThinking: 'disabled' as const, hasApiKey: false })),
      testConnection: vi.fn(async () => ({ providerId: 'openai', model: 'gpt-5-mini', finishReason: 'stop', outputLength: 11, jsonValid: true, usage: { inputTokens: 14, outputTokens: 4, cachedInputTokens: null }, reasoningPresent: false, refusalPresent: false })),
    },
  } as unknown as Window['zhiji'];
});

function openTab(label: string) { fireEvent.click(screen.getByRole('tab', { name: label })); }

describe('SettingsPage', () => {
  it('uses three internal tabs and opens on the general section', async () => {
    render(<SettingsPage/>);
    expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '通用' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('heading', { name: 'AI 服务' })).not.toBeInTheDocument();
    openTab('AI 与个性化');
    expect(screen.getByRole('heading', { name: 'AI 服务' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '个人背景' })).toBeInTheDocument();
    openTab('数据与隐私');
    expect(screen.getByRole('heading', { name: '存储位置' })).toBeInTheDocument();
  });

  it('opens the AI section with a compact provider select and keeps advanced fields collapsed', async () => {
    render(<SettingsPage initialSection="ai"/>);
    expect(await screen.findByRole('heading', { name: 'AI 服务' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '服务商' })).toHaveValue('openai');
    expect(screen.queryByRole('textbox', { name: 'API 地址' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '仅保存' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '移除已保存 Key' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存并测试' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: '服务商' }), { target: { value: 'custom' } });
    fireEvent.click(screen.getByText('高级设置'));
    expect(screen.getByRole('textbox', { name: 'API 地址' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '仅保存' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '移除已保存 Key' })).toBeInTheDocument();
  });

  it('shows a saved-key badge without ever echoing the key', async () => {
    render(<SettingsPage initialSection="ai"/>);
    expect(await screen.findByText(/已安全保存/)).toBeInTheDocument();
    expect(screen.getByLabelText('API Key')).toHaveValue('');
    expect(document.body).not.toHaveTextContent('sk-secret');
  });

  it('keeps save and test actions independently addressable', async () => {
    let finishTest!: () => void;
    vi.mocked(window.zhiji.settings.testConnection).mockReturnValueOnce(new Promise((resolve) => { finishTest = () => resolve({ providerId: 'openai', model: 'gpt-5-mini', finishReason: 'stop', outputLength: 11, jsonValid: true, usage: null, reasoningPresent: false, refusalPresent: false }); }));
    render(<SettingsPage initialSection="ai"/>);
    await screen.findByText(/已安全保存/);
    fireEvent.click(screen.getByText('高级设置'));
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-secret' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并测试' }));
    expect(screen.getByRole('button', { name: '请稍候…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '仅保存' })).toBeEnabled();
    finishTest();
    await waitFor(() => expect(screen.getByText(/连接成功/)).toBeInTheDocument());
    expect(screen.getByLabelText('AI 连接诊断')).toHaveTextContent('JSON 校验通过');
  });

  it('persists a working provider configuration after a successful connection test', async () => {
    const onSaved = vi.fn();
    render(<SettingsPage initialSection="ai" onSaved={onSaved}/>);
    await screen.findByText(/已安全保存/);
    fireEvent.change(screen.getByRole('combobox', { name: '服务商' }), { target: { value: 'deepseek' } });
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'deepseek-v4-flash' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-deepseek' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并测试' }));
    const expected = { providerId: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', agentThinking: 'disabled', apiKey: 'sk-deepseek' };
    await waitFor(() => expect(window.zhiji.settings.testConnection).toHaveBeenCalledWith(expected));
    expect(window.zhiji.settings.save).toHaveBeenCalledWith(expected);
    expect(onSaved).toHaveBeenCalled();
  });

  it('shows safe structured diagnostics when the connection probe returns unusable JSON', async () => {
    const failure = Object.assign(new Error('连接已建立，但结构化响应未通过校验。'), {
      code: 'INVALID_MODEL_OUTPUT',
      diagnostics: { kind: 'invalid_json' as const, finishReason: 'stop', outputLength: 7, schemaPaths: [], at: '2026-09-09T00:00:00.000Z', maxTokens: 32, attempt: 1, providerId: 'openai', model: 'gpt-5-mini', inputTokens: 10, outputTokens: 7, cachedInputTokens: null, reasoningPresent: false, refusalPresent: false },
    });
    vi.mocked(window.zhiji.settings.testConnection).mockRejectedValueOnce(failure);
    render(<SettingsPage initialSection="ai"/>);
    await screen.findByText(/已安全保存/);
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-secret' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并测试' }));
    expect(await screen.findByText('操作失败：连接已建立，但结构化响应未通过校验。')).toBeInTheDocument();
    expect(screen.getByText('JSON 无效')).toBeInTheDocument();
    expect(window.zhiji.settings.save).not.toHaveBeenCalled();
    expect(document.body).not.toHaveTextContent('sk-secret');
  });

  it('requires explicit confirmation before removing a saved key', async () => {
    const onSaved = vi.fn();
    render(<SettingsPage initialSection="ai" onSaved={onSaved}/>);
    await screen.findByText(/已安全保存/);
    fireEvent.click(screen.getByText('高级设置'));
    fireEvent.click(screen.getByRole('button', { name: '移除已保存 Key' }));
    expect(screen.getByText('移除后需要重新输入才能使用 AI 功能；其他设置保持不变。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认移除' }));
    await waitFor(() => expect(window.zhiji.settings.clearApiKey).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalled();
  });

  it('keeps personal background collapsed and confirms destructive clearing', async () => {
    vi.mocked(window.zhiji.profile.get).mockResolvedValueOnce({ schemaVersion: 1, body: '只主动提供的背景', enabledForAi: true, createdAt: '2026-08-13T00:00:00.000Z', updatedAt: '2026-08-13T00:00:00.000Z' });
    render(<SettingsPage/>);
    openTab('AI 与个性化');
    expect(await screen.findByText(/已填写/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '个人背景' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '编辑个人背景' }));
    expect(screen.getByRole('textbox', { name: '个人背景' })).toHaveValue('只主动提供的背景');
    fireEvent.click(screen.getByRole('button', { name: '清空个人背景' }));
    fireEvent.click(screen.getByRole('button', { name: '确认清空' }));
    await waitFor(() => expect(window.zhiji.profile.clear).toHaveBeenCalled());
  });

  it('keeps storage and backup actions in the data section', async () => {
    vi.mocked(window.zhiji.transfer.previewRestore).mockResolvedValueOnce({ canceled: false, previewId: 'preview-id', archivePath: 'backup.zhiji.zip', exportedAt: '2026-08-13T00:00:00.000Z', appVersion: '1.0.0', fileCount: 6, totalBytes: 100, categories: { journals: 3, reviews: 2, projects: 1, profile: 0, settings: 0 } });
    render(<SettingsPage initialSection="data"/>);
    expect(await screen.findByText('D:\\知己')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '在资源管理器中查看' }));
    await waitFor(() => expect(window.zhiji.dataDirectory.open).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '从备份恢复' }));
    expect(await screen.findByText('备份校验通过：6 个文件')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认恢复' }));
    await waitFor(() => expect(window.zhiji.transfer.restore).toHaveBeenCalledWith('preview-id'));
  });
});
