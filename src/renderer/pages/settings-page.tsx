import { useEffect, useState } from 'react';
import type { SaveProviderConfigInput } from '../../shared/schemas/ipc';
import { isStructuredOutputError, type StructuredOutputDiagnostics } from '../../shared/errors/app-error';
import type { AiConnectionTestResult } from '../../shared/schemas/domain';
import type { SettingsSection } from '../app/navigation';
import { Button } from '../components/button';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Field } from '../components/field';
import { PageHeader } from '../components/page-header';
import { StatusBanner } from '../components/status-banner';
import { StructuredDiagnostics } from '../components/structured-diagnostics';
import { AiConnectionDiagnostics } from '../components/ai-connection-diagnostics';
import { applyThemePreference, getThemePreference, type ThemePreference } from '../utils/theme';

const presets = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
} as const;
const SETTINGS_TABS = [['general', '通用'], ['ai', 'AI 与个性化'], ['data', '数据与隐私']] as const;

type DataInfo = Awaited<ReturnType<Window['zhiji']['dataDirectory']['getInfo']>>;
type RestorePreview = Awaited<ReturnType<Window['zhiji']['transfer']['previewRestore']>>;

export function SettingsPage({ initialSection = 'general', onSaved }: { initialSection?: SettingsSection; onSaved?(): void | Promise<void> }) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [form, setForm] = useState<SaveProviderConfigInput>({ providerId: 'openai', ...presets.openai, agentThinking: 'disabled' });
  const [hasApiKey, setHasApiKey] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [connectionResult, setConnectionResult] = useState<AiConnectionTestResult | null>(null);
  const [connectionFailure, setConnectionFailure] = useState<StructuredOutputDiagnostics | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(() => getThemePreference());
  const [profile, setProfile] = useState({ body: '', enabledForAi: false });
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);
  const [confirmClearKey, setConfirmClearKey] = useState(false);
  const [confirmClearProfile, setConfirmClearProfile] = useState(false);
  const [dataInfo, setDataInfo] = useState<DataInfo | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
  const [confirmChangeLocation, setConfirmChangeLocation] = useState<{ target: string; move: boolean } | null>(null);
  const [transferBusy, setTransferBusy] = useState<'export' | 'preview' | 'restore' | null>(null);
  const [transferMessage, setTransferMessage] = useState('');
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [appVersion, setAppVersion] = useState('—');

  useEffect(() => { setSection(initialSection); }, [initialSection]);
  useEffect(() => {
    void window.zhiji.app.getInfo().then(({ version }) => setAppVersion(version)).catch(() => undefined);
    void Promise.all([window.zhiji.settings.getPublicConfig(), window.zhiji.dataDirectory.getInfo(), window.zhiji.profile.get()]).then(([{ hasApiKey: saved, ...config }, info, savedProfile]) => {
      setForm(config); setHasApiKey(saved); setDataInfo(info);
      if (savedProfile) setProfile({ body: savedProfile.body, enabledForAi: savedProfile.enabledForAi });
    });
  }, []);

  const changeTheme = (next: ThemePreference) => { setTheme(next); applyThemePreference(next); };
  const updateProvider = (providerId: SaveProviderConfigInput['providerId']) => {
    setMessage(''); setError(''); setConnectionResult(null); setConnectionFailure(null);
    setForm((old) => ({ ...old, providerId, agentThinking: providerId === 'deepseek' ? old.agentThinking : 'disabled', ...(providerId === 'custom' ? {} : presets[providerId]) }));
  };
  const clearConnectionResult = () => { setConnectionResult(null); setConnectionFailure(null); setMessage(''); setError(''); };
  const runProvider = async (kind: 'save' | 'test') => {
    setBusy(kind); setMessage(''); setError('');
    try {
      let tested: AiConnectionTestResult | null = null;
      if (kind === 'test') {
        tested = await window.zhiji.settings.testConnection(form);
        setConnectionResult(tested);
        setConnectionFailure(null);
      }
      const saved = await window.zhiji.settings.save(form);
      setHasApiKey(saved.hasApiKey); await onSaved?.();
      setForm((current) => ({ providerId: current.providerId, baseUrl: current.baseUrl, model: current.model, agentThinking: current.agentThinking }));
      setMessage(kind === 'test' ? `连接成功，结构化响应有效${tested?.usage?.outputTokens !== null && tested?.usage?.outputTokens !== undefined ? `（本次输出 ${tested.usage.outputTokens} token）` : ''}，设置已安全保存` : '设置已安全保存');
    } catch (reason) {
      if (isStructuredOutputError(reason)) setConnectionFailure(reason.diagnostics);
      setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+':\s*/, '').trim() : '请检查配置后重试');
    }
    finally { setBusy(null); }
  };
  const clearApiKey = async () => {
    setBusy('save'); setMessage(''); setError('');
    try { const result = await window.zhiji.settings.clearApiKey(); setHasApiKey(result.hasApiKey); setConnectionResult(null); setConnectionFailure(null); await onSaved?.(); setMessage('已移除当前服务商的 API Key'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '移除失败'); }
    finally { setBusy(null); }
  };
  const saveProfile = async () => {
    setProfileBusy(true); setProfileMessage('');
    try { await window.zhiji.profile.save({ body: profile.body, enabledForAi: profile.enabledForAi }); setProfileMessage('个人背景已保存'); setProfileEditing(false); }
    catch (reason) { setProfileMessage(`保存失败：${reason instanceof Error ? reason.message : '请稍后重试'}`); }
    finally { setProfileBusy(false); }
  };
  const clearProfile = async () => {
    setProfileBusy(true); setProfileMessage('');
    try { await window.zhiji.profile.clear(); setProfile({ body: '', enabledForAi: false }); setProfileEditing(false); setProfileMessage('个人背景已清空'); }
    catch (reason) { setProfileMessage(`清空失败：${reason instanceof Error ? reason.message : '请稍后重试'}`); }
    finally { setProfileBusy(false); }
  };
  const chooseLocation = async () => {
    setLocationBusy(true); setLocationMessage('');
    try {
      const result = await window.zhiji.dataDirectory.pickFolder();
      if (!result.canceled) setConfirmChangeLocation({ target: result.path, move: true });
    } catch (reason) { setLocationMessage(`选择失败：${reason instanceof Error ? reason.message : '请稍后重试'}`); }
    finally { setLocationBusy(false); }
  };
  const changeLocation = async () => {
    if (!confirmChangeLocation) return;
    const { target, move } = confirmChangeLocation;
    setLocationBusy(true); setLocationMessage('');
    try { const result = await window.zhiji.dataDirectory.changeLocation({ target, move }); setConfirmChangeLocation(null); setLocationMessage(`已${result.moved ? '迁移数据并' : ''}更改位置到 ${result.to}，请重启应用生效。`); }
    catch (reason) { setLocationMessage(`更改失败：${reason instanceof Error ? reason.message : '请稍后重试'}`); }
    finally { setLocationBusy(false); }
  };
  const exportBackup = async () => {
    setTransferBusy('export'); setTransferMessage('');
    try { const result = await window.zhiji.transfer.exportBackup(); if (!result.canceled) setTransferMessage(`备份已创建，共 ${result.fileCount} 个文件。`); }
    catch (reason) { setTransferMessage(`创建失败：${reason instanceof Error ? reason.message : '请稍后重试'}`); }
    finally { setTransferBusy(null); }
  };
  const previewBackup = async () => {
    setTransferBusy('preview'); setTransferMessage(''); setRestorePreview(null);
    try { const result = await window.zhiji.transfer.previewRestore(); if (!result.canceled) setRestorePreview(result); }
    catch (reason) { setTransferMessage(`校验失败：${reason instanceof Error ? reason.message : '备份不可用'}`); }
    finally { setTransferBusy(null); }
  };
  const restoreBackup = async () => {
    if (!restorePreview?.previewId) return;
    setTransferBusy('restore'); setTransferMessage('');
    try { const result = await window.zhiji.transfer.restore(restorePreview.previewId); setRestorePreview(null); setTransferMessage(`恢复完成，共写入 ${result.fileCount} 个文件。请重启知己读取数据。`); }
    catch (reason) { setTransferMessage(`恢复失败：${reason instanceof Error ? reason.message : '请稍后重试'}`); }
    finally { setTransferBusy(null); }
  };
  const moveTab = (direction: 1 | -1) => {
    const index = SETTINGS_TABS.findIndex(([value]) => value === section);
    const next = SETTINGS_TABS[(index + direction + SETTINGS_TABS.length) % SETTINGS_TABS.length][0];
    setSection(next);
    window.setTimeout(() => document.getElementById(`settings-tab-${next}`)?.focus(), 0);
  };

  const renderGeneral = () => <section className="card settings-panel settings-task-group">
      <div className="section-heading"><div><h3>界面主题</h3><p>跟随系统时随 Windows 设置自动切换。</p></div></div>
      <div className="page-tabs" role="group" aria-label="外观主题">{([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']] as const).map(([value, label]) => <button key={value} className={theme === value ? 'is-active' : ''} aria-pressed={theme === value} onClick={() => changeTheme(value)}>{label}</button>)}</div>
  </section>;

  const renderAi = () => <>
  <section className="card settings-panel ai-settings-panel">
    <div className="section-heading"><div><h3>AI 服务</h3><p>选择服务商并保存连接设置。API Key 只会写入系统安全存储。</p></div>{hasApiKey && <span className="saved-key-badge">✓ 已安全保存</span>}</div>
    <div className="settings-fields"><Field label="服务商"><select aria-label="服务商" value={form.providerId} onChange={(event) => updateProvider(event.target.value as SaveProviderConfigInput['providerId'])}><option value="openai">OpenAI</option><option value="deepseek">DeepSeek</option><option value="custom">自定义 OpenAI 兼容接口</option></select></Field><Field label="模型"><input aria-label="模型" value={form.model} onChange={(event) => { clearConnectionResult(); setForm({ ...form, model: event.target.value }); }}/></Field><Field label="API Key"><input aria-label="API Key" type="password" value={form.apiKey ?? ''} placeholder={hasApiKey ? '留空即保留当前 Key' : '输入你的 API Key'} autoComplete="new-password" onChange={(event) => { clearConnectionResult(); setForm({ ...form, apiKey: event.target.value || undefined }); }}/><small>Key 不会再次显示原值。</small></Field></div>
    <details className="settings-advanced" open={advancedOpen}><summary onClick={(event) => { event.preventDefault(); setAdvancedOpen((value) => !value); }}>高级设置</summary>{advancedOpen && <div className="settings-fields">{form.providerId === 'custom' && <Field label="API 地址"><input aria-label="API 地址" value={form.baseUrl} placeholder="https://api.example.com/v1" onChange={(event) => { clearConnectionResult(); setForm({ ...form, baseUrl: event.target.value }); }}/><small>必须使用 HTTPS；开发环境仅允许 localhost HTTP。</small></Field>}<Field label="Agent 思考模式"><select aria-label="Agent 思考模式" value={form.agentThinking} disabled={form.providerId !== 'deepseek'} onChange={(event) => { clearConnectionResult(); setForm({ ...form, agentThinking: event.target.value as SaveProviderConfigInput['agentThinking'] }); }}><option value="disabled">关闭（更快、更省）</option><option value="enabled">开启（更深思考）</option></select><small>{form.providerId === 'deepseek' ? '仅影响 Agent 对话；开启后通常会增加延迟和用量。' : '当前服务商未声明 DeepSeek thinking 协议，Agent 保持关闭。'}</small></Field><div className="settings-actions"><Button variant="ghost" loading={busy === 'save'} onClick={() => void runProvider('save')}>仅保存</Button></div>{hasApiKey && <Button variant="danger" onClick={() => setConfirmClearKey(true)}>移除已保存 Key</Button>}</div>}</details>
    {message && <StatusBanner tone="success">{message}</StatusBanner>}{error && <StatusBanner tone="error">操作失败：{error}</StatusBanner>}{connectionFailure && <StructuredDiagnostics diagnostics={connectionFailure}/>} {connectionResult && <AiConnectionDiagnostics result={connectionResult}/>}
    <div className="settings-actions"><Button variant="primary" loading={busy === 'test'} onClick={() => void runProvider('test')}>保存并测试</Button></div>
  </section>
  <section className="card settings-panel profile-summary">
    <div className="section-heading"><div><h3>个人背景</h3><p>{profile.body.trim() ? `已填写 ${profile.body.trim().length} 个字符${profile.enabledForAi ? '，已允许用于 AI 分析' : ''}` : '尚未填写个人背景。'}</p></div><Button variant="secondary" onClick={() => { setProfileEditing((value) => !value); setProfileMessage(''); }}>{profileEditing ? '收起编辑' : '编辑个人背景'}</Button></div>
    {profileEditing && <div className="profile-editor"><Field label="个人背景"><textarea aria-label="个人背景" value={profile.body} onChange={(event) => setProfile({ ...profile, body: event.target.value })} placeholder="只填写你愿意主动提供给知己的背景。"/></Field><label className="profile-toggle"><input type="checkbox" checked={profile.enabledForAi} onChange={(event) => setProfile({ ...profile, enabledForAi: event.target.checked })}/>允许 AI 在复盘和方向校准中使用</label><div className="settings-actions"><Button variant="danger" disabled={!profile.body.trim()} onClick={() => setConfirmClearProfile(true)}>清空个人背景</Button><Button variant="primary" loading={profileBusy} disabled={!profile.body.trim()} onClick={() => void saveProfile()}>保存个人背景</Button></div></div>}
    {profileMessage && <StatusBanner tone={profileMessage.includes('失败') ? 'error' : 'success'}>{profileMessage}</StatusBanner>}
  </section>
  </>;

  const renderData = () => <>
    <section className="card settings-panel settings-task-group"><div className="section-heading"><div><h3>存储位置</h3><p>日志、复盘、项目与个人背景都保存在本机。</p></div></div>{dataInfo && <div className="data-location"><strong>{dataInfo.path}</strong><span>{dataInfo.writable ? '可写入' : '当前不可写'} · {dataInfo.fileCount} 个文件</span><div className="settings-actions"><Button onClick={() => void window.zhiji.dataDirectory.open()}>在资源管理器中查看</Button><Button variant="secondary" loading={locationBusy} onClick={() => void chooseLocation()}>更改位置</Button></div></div>}{locationMessage && <StatusBanner tone={locationMessage.includes('失败') ? 'error' : 'success'}>{locationMessage}</StatusBanner>}</section>
    <section className="card settings-panel settings-task-group"><div className="section-heading"><div><h3>备份与恢复</h3><p>备份前会打包当前本地数据；恢复前必须先完成校验。</p></div></div><div className="settings-actions"><Button loading={transferBusy === 'export'} onClick={() => void exportBackup()}>创建备份</Button><Button variant="secondary" loading={transferBusy === 'preview'} onClick={() => void previewBackup()}>从备份恢复</Button></div>{restorePreview?.previewId && <div className="restore-preview"><strong>备份校验通过：{restorePreview.fileCount} 个文件</strong><p>{restorePreview.categories?.journals ?? 0} 篇日志 · {restorePreview.categories?.reviews ?? 0} 份复盘 · {restorePreview.categories?.projects ?? 0} 个项目</p><p className="muted">为避免覆盖，恢复只允许写入空数据目录。</p><Button variant="primary" loading={transferBusy === 'restore'} onClick={() => void restoreBackup()}>确认恢复</Button></div>}{transferMessage && <StatusBanner tone={transferMessage.includes('失败') ? 'error' : 'success'}>{transferMessage}</StatusBanner>}</section>
  </>;

  return <div className="settings-page">
    <PageHeader title="设置" description="用三个清晰的区域管理外观、AI 与本地数据。"/>
    <div className="settings-tabs" role="tablist" aria-label="设置分类" aria-orientation="horizontal">{SETTINGS_TABS.map(([value, label]) => <button key={value} id={`settings-tab-${value}`} role="tab" aria-controls={`settings-panel-${value}`} aria-selected={section === value} tabIndex={section === value ? 0 : -1} className={section === value ? 'is-active' : ''} onClick={() => setSection(value)} onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); moveTab(1); } if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); moveTab(-1); } }}>{label}</button>)}</div>
    <div id={`settings-panel-${section}`} className="settings-section" role="tabpanel" aria-labelledby={`settings-tab-${section}`} tabIndex={0}>{section === 'general' ? renderGeneral() : section === 'ai' ? renderAi() : renderData()}</div>
    <footer className="settings-footer">版本 {appVersion}</footer>
    <ConfirmDialog open={confirmClearKey} title="移除已保存的 API Key？" description="移除后需要重新输入才能使用 AI 功能；其他设置保持不变。" confirmLabel="确认移除" loading={busy === 'save'} onCancel={() => setConfirmClearKey(false)} onConfirm={() => { setConfirmClearKey(false); void clearApiKey(); }}/>
    <ConfirmDialog open={confirmClearProfile} title="清空个人背景？" description="这会删除你主动保存的个人背景，不会影响日志和复盘。" confirmLabel="确认清空" loading={profileBusy} onCancel={() => setConfirmClearProfile(false)} onConfirm={() => { setConfirmClearProfile(false); void clearProfile(); }}/>
    <ConfirmDialog open={confirmChangeLocation !== null} title="更改数据存储位置？" description={confirmChangeLocation ? `将把数据位置更改为：${confirmChangeLocation.target}（现有数据会被复制到新位置）。更改后需要重启应用生效。` : ''} confirmLabel="确认更改" loading={locationBusy} onCancel={() => setConfirmChangeLocation(null)} onConfirm={() => void changeLocation()}/>
  </div>;
}
