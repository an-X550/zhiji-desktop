import { test, expect, _electron as electron, chromium } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import electronPath from 'electron';
import type { Browser, ElectronApplication, Page } from 'playwright';

type RunningApp = {
  app?: ElectronApplication;
  page: Page;
  dataRoot: string;
  userDataRoot: string;
  close: () => Promise<void>;
};

async function getFreePort() {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!address || typeof address === 'string') throw new Error('无法获取本地调试端口');
  return address.port;
}

async function waitForCdp(port: number) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // The packaged app may need a few seconds before Chromium opens CDP.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('安装版未在限定时间内开放 Chromium 调试端口');
}

async function firstPage(browser: Browser) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const page = browser.contexts().flatMap((context) => context.pages())[0];
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('安装版未创建渲染窗口');
}

async function launchClean(): Promise<RunningApp> {
  const installedExecutable = process.env.ZHIJI_E2E_EXECUTABLE;
  const packagedAsar = path.resolve('out/知己-win32-x64/resources/app.asar');
  if (installedExecutable) await access(installedExecutable);
  else await access(packagedAsar);
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'zhiji-quality-'));
  const userDataRoot = await mkdtemp(path.join(os.tmpdir(), 'zhiji-quality-userdata-'));
  let app: ElectronApplication | undefined;
  let page: Page;
  let browser: Browser | undefined;
  let child: ChildProcess | undefined;
  if (installedExecutable) {
    const port = await getFreePort();
    child = spawn(installedExecutable, [`--user-data-dir=${userDataRoot}`, `--remote-debugging-port=${port}`], { cwd: process.cwd(), env: { ...process.env, ZHIJI_DATA_ROOT: dataRoot }, stdio: 'ignore' });
    await waitForCdp(port);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    page = await firstPage(browser);
  } else {
    app = await electron.launch({ executablePath: electronPath as unknown as string, args: [packagedAsar, `--user-data-dir=${userDataRoot}`], cwd: process.cwd(), env: { ...process.env, ZHIJI_DATA_ROOT: dataRoot } });
    page = await app.firstWindow();
  }
  await expect(page.getByRole('heading', { name: '写下今天的经历' })).toBeVisible();
  return {
    app,
    page,
    dataRoot,
    userDataRoot,
    close: async () => {
      if (app) await app.close();
      if (browser) {
        await page.evaluate(() => window.close()).catch(() => undefined);
        await browser.close();
      }
      child?.kill();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    },
  };
}

async function closeClean(app: RunningApp) {
  await app.close();
  await rm(app.dataRoot, { recursive: true, force: true });
  await rm(app.userDataRoot, { recursive: true, force: true });
}

test('settings information architecture and journal template flow are usable in the package', async () => {
  const running = await launchClean();
  try {
    const { page } = running;
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('tab', { name: '通用' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: '本地保存，查看存储位置' }).click();
    await expect(page.getByRole('tab', { name: '数据与隐私' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'AI 与个性化' }).click();
    await expect(page.getByRole('heading', { name: 'AI 服务' })).toBeVisible();
    await page.getByRole('combobox', { name: '服务商' }).selectOption('custom');
    await page.getByText('高级设置').click();
    await expect(page.getByRole('textbox', { name: 'API 地址' })).toBeVisible();
    await page.getByRole('tab', { name: '数据与隐私' }).click();
    await expect(page.getByRole('button', { name: '在资源管理器中查看' })).toBeVisible();
    await expect(page.getByRole('button', { name: '更改位置' })).toBeVisible();
    await expect(page.getByRole('button', { name: '创建备份' })).toBeVisible();
    await expect(page.getByRole('button', { name: '从备份恢复' })).toBeVisible();
    await expect(page.getByText(/发布地址|保存地址|检查更新/)).toHaveCount(0);
    await expect(page.getByText(/^版本 \d+\.\d+\.\d+$/)).toBeVisible();

    await page.getByRole('button', { name: '日志', exact: true }).click();
    const previousDate = await page.evaluate(() => { const date = new Date(); date.setDate(date.getDate() - 1); return date.toISOString().slice(0, 10); });
    await page.locator('.date-control summary').click();
    await page.getByLabel('日志日期').fill(previousDate);
    await page.getByRole('button', { name: '管理模板' }).click();
    await page.getByRole('button', { name: '新建模板' }).click();
    await page.getByRole('textbox', { name: '模板名称' }).fill('E2E 模板');
    await page.getByRole('textbox', { name: '模板正文' }).fill('事实：');
    await page.getByRole('button', { name: '保存模板' }).click();
    await expect(page.locator('select[aria-label="选择模板"] option[value="E2E 模板"]')).toHaveCount(1);
    await page.getByRole('button', { name: '关闭' }).click();
    await page.getByLabel('选择模板').selectOption('E2E 模板');
    await expect(page.getByRole('textbox', { name: '日志内容' })).toHaveValue('事实：');
    await page.getByRole('textbox', { name: '日志内容' }).fill('脱敏核心冒烟日志：完成设置与安装验证。');
    await page.getByRole('button', { name: '保存日志' }).click();
    await expect(page.getByText('已保存到本机')).toBeVisible();
  } finally {
    await closeClean(running);
  }
});

test('dark theme keeps shared selects as one non-repeating arrow', async () => {
  const running = await launchClean();
  try {
    const { page } = running;
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '深色' }).click();
    await page.getByRole('button', { name: '日志', exact: true }).click();
    const select = page.getByLabel('关联项目（可选）');
    const style = await select.evaluate((element) => { const computed = window.getComputedStyle(element); return { image: computed.backgroundImage, repeat: computed.backgroundRepeat, position: computed.backgroundPosition }; });
    expect(style.image).not.toBe('none');
    expect(style.repeat).toBe('no-repeat');
    expect(style.position).toMatch(/50%$/);
  } finally {
    await closeClean(running);
  }
});

test('history keeps long records inside the available columns at wide and compact sizes', async () => {
  test.skip(Boolean(process.env.ZHIJI_E2E_EXECUTABLE), '窗口尺寸边界在 packaged-asar 模式中验证。');
  const running = await launchClean();
  try {
    if (!running.app) return;
    const { page } = running;
    await page.evaluate(async () => {
      const body = `超长中文标题用于验证历史记录列表与正文之间的最小宽度链。${'连续英文标题 without spaces '.repeat(8)}https://example.com/a/very/long/path/that/should/wrap\n\n${'隔离正文用于验证阅读器可读性和自身滚动，不调用 AI。'.repeat(100)}`;
      await window.zhiji.journals.create({ date: '2026-09-08', body, projectIds: [] });
      await window.zhiji.journals.create({ date: '2026-09-07', body: `${body}\n第二条隔离记录`, projectIds: [] });
    });
    await page.reload();
    // This case asserts the layout breakpoint itself; keep page zoom explicit
    // so the 125% application default does not masquerade as a narrow window.
    await running.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1));
    await page.getByRole('button', { name: '日志', exact: true }).click();
    await page.getByRole('button', { name: '过去日志' }).click();
    await expect(page.locator('.history-layout')).toBeVisible();

    const measure = () => page.evaluate(() => {
      const layout = document.querySelector('.history-layout') as HTMLElement;
      const list = document.querySelector('.history-list') as HTMLElement;
      const reader = document.querySelector('.history-reader') as HTMLElement;
      const pageView = document.querySelector('.page-view') as HTMLElement;
      const layoutBox = layout.getBoundingClientRect();
      const listBox = list.getBoundingClientRect();
      const readerBox = reader.getBoundingClientRect();
      return {
        columns: getComputedStyle(layout).gridTemplateColumns.trim().split(/\s+/).length,
        listRight: listBox.right,
        readerLeft: readerBox.left,
        listBottom: listBox.bottom,
        readerTop: readerBox.top,
        layoutWidth: layoutBox.width,
        pageWidth: pageView.clientWidth,
        pageScrollWidth: pageView.scrollWidth,
        documentWidth: document.documentElement.scrollWidth,
        documentClientWidth: document.documentElement.clientWidth,
      };
    });

    await running.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 800));
    await page.waitForTimeout(250);
    const wide = await measure();
    expect(wide.columns).toBe(2);
    expect(wide.readerLeft).toBeGreaterThanOrEqual(wide.listRight - 1);
    expect(wide.pageScrollWidth).toBeLessThanOrEqual(wide.pageWidth + 1);
    expect(wide.documentWidth).toBeLessThanOrEqual(wide.documentClientWidth + 1);

    await running.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(900, 640));
    await page.waitForTimeout(250);
    const compact = await measure();
    expect(compact.columns).toBe(1);
    expect(compact.readerTop).toBeGreaterThanOrEqual(compact.listBottom - 1);
    expect(compact.pageScrollWidth).toBeLessThanOrEqual(compact.pageWidth + 1);
    expect(compact.documentWidth).toBeLessThanOrEqual(compact.documentClientWidth + 1);
  } finally {
    await closeClean(running);
  }
});

test('workspace scrolls while the sidebar keeps its viewport boundary', async () => {
  const running = await launchClean();
  try {
    const { page } = running;
    await page.evaluate(async () => {
      const api = (window as unknown as { zhiji: Window['zhiji'] }).zhiji;
      for (let index = 0; index < 32; index += 1) await api.journals.create({ date: '2026-08-22', body: `脱敏打包验收日志 ${index}`, projectIds: [] });
    });
    await page.reload();
    await expect(page.getByRole('button', { name: '开始', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '日志', exact: true }).click();
    await page.getByRole('button', { name: '过去日志' }).click();
    await expect(page.locator('.history-list')).toBeVisible();
    const sidebar = page.locator('.sidebar');
    const before = await sidebar.boundingBox();
    const boundary = await page.locator('.page-view').evaluate((element) => { const node = element as HTMLElement; return { scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, overflowY: window.getComputedStyle(node).overflowY }; });
    const sidebarOverflow = await sidebar.evaluate((element) => window.getComputedStyle(element).overflowY);
    expect(boundary.scrollHeight).toBeGreaterThan(boundary.clientHeight);
    await page.locator('.page-view').evaluate((element) => { const node = element as HTMLElement; node.scrollTop = node.scrollHeight; });
    await expect.poll(() => page.locator('.page-view').evaluate((element) => (element as HTMLElement).scrollTop)).toBeGreaterThan(0);
    const after = await sidebar.boundingBox();
    expect(boundary.overflowY).toBe('auto');
    expect(sidebarOverflow).toBe('hidden');
    expect(after?.y).toBe(before?.y);
    expect(after?.height).toBe(before?.height);
  } finally {
    await closeClean(running);
  }
});

test('packaged daily feedback exposes safe recovery without leaking failed output', async () => {
  test.skip(Boolean(process.env.ZHIJI_E2E_EXECUTABLE), '安装版真实 AI 冒烟由独立验收完成；结构化失败恢复仅在 packaged-asar 模式注入。');
  const running = await launchClean();
  try {
    const { page } = running;
    await page.evaluate(async () => {
      const api = (window as unknown as { zhiji: Window['zhiji'] }).zhiji;
      await api.settings.save({ providerId: 'custom', baseUrl: 'https://example.com/v1', model: 'fake', agentThinking: 'disabled', apiKey: 'fake-e2e-key' });
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: '写下今天的经历' })).toBeVisible();
    if (running.app) {
      await running.app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('reviews:generate-daily');
        let attempts = 0;
        ipcMain.handle('reviews:generate-daily', async () => { attempts += 1; return attempts === 1 ? { kind: 'error', message: 'AI 这次没有返回可用的反馈，日志和已有数据没有受到影响。', diagnostics: { kind: 'invalid_json', finishReason: 'stop', outputLength: 21, schemaPaths: [], at: new Date().toISOString() } } : { kind: 'review', review: { schemaVersion: 2, id: 'review_e2erecovery', type: 'daily', periodStart: new Date().toISOString().slice(0, 10), periodEnd: new Date().toISOString().slice(0, 10), sourceIds: ['journal_e2erecovery'], sourceVersions: [], projectId: null, provider: 'openai-compatible', model: 'fake', promptVersion: 'daily-review-v1', createdAt: new Date().toISOString(), body: '脱敏反馈已恢复' } }; });
      });
    }
    await page.getByRole('button', { name: '日志', exact: true }).click();
    await page.getByRole('textbox', { name: '日志内容' }).fill('脱敏日反馈输入，不包含真实个人数据。');
    if (running.app) {
      await page.getByRole('button', { name: '保存并生成今日反馈' }).click();
      await expect(page.getByText('AI 这次没有返回可用的反馈，日志和已有数据没有受到影响。')).toBeVisible();
      await expect(page.getByRole('button', { name: '重新生成' })).toBeVisible();
      await expect(page.getByText('bad secret payload')).toHaveCount(0);
      await page.getByRole('button', { name: '重新生成' }).click();
      await expect(page.getByText('脱敏反馈已恢复')).toBeVisible();
    } else {
      await expect(page.getByRole('button', { name: '日志', exact: true })).toBeVisible();
    }
  } finally {
    await closeClean(running);
  }
});

test('packaged Agent lifecycle stops strictly and keeps list read-only while restart is required', async () => {
  test.skip(Boolean(process.env.ZHIJI_E2E_EXECUTABLE), '需要 ElectronApplication 才能运行隔离 packaged-asar 生命周期冒烟。');
  const running = await launchClean();
  const target = await mkdtemp(path.join(os.tmpdir(), 'zhiji-maintenance-target-'));
  try {
    const { page } = running;
    const session = await page.evaluate(() => window.zhiji.agent.start({ title: '维护生命周期冒烟' }));
    const before = await page.evaluate(() => window.zhiji.agent.list());
    expect(before).toEqual(expect.arrayContaining([expect.objectContaining({ id: session.id, title: '维护生命周期冒烟' })]));

    const changed = await page.evaluate((targetPath) => window.zhiji.dataDirectory.changeLocation({ target: targetPath, move: false }), target);
    expect(changed.moved).toBe(false);
    const after = await page.evaluate(() => window.zhiji.agent.list());
    expect(after).toEqual(expect.arrayContaining([expect.objectContaining({ id: session.id })]));
    await expect(page.evaluate(() => window.zhiji.agent.start({ title: '不应在等待重启期间启动' }))).rejects.toThrow(/维护|重启|只读/);
  } finally {
    await closeClean(running);
    await rm(target, { recursive: true, force: true });
  }
});

test('installed executable starts Agent and creates a session', async () => {
  test.skip(!process.env.ZHIJI_E2E_EXECUTABLE, '仅在 ZHIJI_E2E_EXECUTABLE 安装版验收中运行。');
  const running = await launchClean();
  try {
    const { page } = running;
    await page.getByRole('button', { name: '知己 Agent', exact: true }).click();
    await expect(page.getByRole('heading', { name: '知己 Agent' })).toBeVisible();
    await page.getByRole('button', { name: '新建会话' }).click();
    await expect(page.getByRole('heading', { name: '新对话', level: 3 })).toBeVisible();
  } finally {
    await closeClean(running);
  }
});

test('installed executable completes a real Agent search-read-answer round', async () => {
  test.setTimeout(180_000);
  test.skip(!process.env.ZHIJI_E2E_EXECUTABLE, '仅在安装版 Agent 验收中运行。');
  test.skip(!process.env.ZHIJI_E2E_API_KEY, '需要显式提供 ZHIJI_E2E_API_KEY；测试不会读取、打印或提交它。');
  const running = await launchClean();
  try {
    const { page } = running;
    const apiKey = process.env.ZHIJI_E2E_API_KEY;
    if (!apiKey) return;
    await page.evaluate(async (key) => {
      await window.zhiji.settings.save({ providerId: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', agentThinking: 'disabled', apiKey: key });
    }, apiKey);
    await page.getByRole('button', { name: '知己 Agent', exact: true }).click();
    await page.getByRole('button', { name: '新建会话' }).click();
    await page.getByRole('textbox', { name: '向知己 Agent 发送消息' }).fill('请查找 Electron net.fetch 官方文档的关键点。必须先搜索公开来源，再读取本次搜索会话中的一个来源，最后用中文简要回答，并列出实际使用来源的标题和域名。');
    await page.getByRole('button', { name: '发送' }).click();
    await expect(page.getByText('已完成：搜索公开来源')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText('已完成：读取搜索来源')).toBeVisible({ timeout: 120_000 });
    await expect.poll(async () => page.locator('.agent-message--assistant').last().textContent(), { timeout: 120_000 }).toMatch(/Electron|来源|域名/);
    await expect(page.locator('.agent-message--assistant').last()).not.toContainText('https://');
  } finally {
    await closeClean(running);
  }
});
