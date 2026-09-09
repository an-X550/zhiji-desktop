import { test, expect, _electron as electron } from '@playwright/test';
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import electronPath from 'electron';

test('a non-CLI user completes the local journal loop', async () => {
  const packagedAsar = path.resolve('out/知己-win32-x64/resources/app.asar');
  await access(packagedAsar);
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'zhiji-e2e-'));
  const userDataRoot = await mkdtemp(path.join(os.tmpdir(), 'zhiji-e2e-userdata-'));
  const executablePath = electronPath as unknown as string;
  const app = await electron.launch({ executablePath, args: [packagedAsar, `--user-data-dir=${userDataRoot}`], cwd: process.cwd(), env: { ...process.env, ZHIJI_DATA_ROOT: dataRoot } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: '写下今天的经历' })).toBeVisible();
    await page.getByRole('button', { name: '知己 Agent', exact: true }).click();
    await expect(page.getByRole('heading', { name: '知己 Agent' })).toBeVisible();
    await page.getByRole('button', { name: '新建会话' }).click();
    await expect(page.getByRole('heading', { name: '新对话', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '项目', exact: true }).click();
    await page.getByRole('button', { name: '新建第一个项目' }).click();
    await page.getByRole('textbox', { name: '项目名称' }).fill('桌面端验收');
    await page.getByRole('button', { name: '创建项目' }).click();
    await expect(page.getByText('桌面端验收').first()).toBeVisible();

    await page.getByRole('button', { name: '开始', exact: true }).click();
    await page.getByRole('button', { name: '开始记录' }).click();
    await page.getByLabel('关联项目（可选）').selectOption({ label: '桌面端验收' });
      await page.getByRole('textbox', { name: '日志内容' }).fill('这是一条由桌面端自动化验收写入的本地日志。');
      await page.getByRole('button', { name: '保存日志' }).click();
      await expect(page.getByText('已保存到本机')).toBeVisible();
      await page.getByRole('button', { name: '新建日志' }).click();
      await page.getByRole('textbox', { name: '日志内容' }).fill('这是同一天的第二条日志，不应覆盖第一条。');
    await page.getByRole('button', { name: '保存日志' }).click();

    await page.getByRole('button', { name: '开始', exact: true }).click();
    await expect(page.getByRole('heading', { name: '生成今日反馈' })).toBeVisible();
    await page.getByRole('button', { name: '复盘', exact: true }).click();
    await page.getByRole('button', { name: '预览本周材料' }).click();
    await page.getByRole('button', { name: '预览材料' }).click();
    await expect(page.getByText('这是一条由桌面端自动化验收写入的本地日志。')).toBeVisible();
    await page.getByRole('button', { name: '日志', exact: true }).click();
    await page.getByRole('button', { name: '过去日志' }).click();
    await expect(page.locator('.history-reader')).toContainText(/桌面端自动化验收|第二条日志/);
    const yearRoot = path.join(dataRoot, 'journals', new Date().getFullYear().toString());
    const files = (await readdir(yearRoot)).filter((file) => file.endsWith('.md'));
    expect(files).toHaveLength(2);
    const contents = await Promise.all(files.map((file) => readFile(path.join(yearRoot, file), 'utf8')));
    expect(contents.join('\n')).toContain('桌面端自动化验收');
    expect(contents.join('\n')).toContain('第二条日志');
  } finally {
    await app.close();
    await rm(dataRoot, { recursive: true, force: true });
    await rm(userDataRoot, { recursive: true, force: true });
  }
});
