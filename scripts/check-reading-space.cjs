const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const phase = process.argv[2] || 'after';
  const out = path.resolve('docs/reading-space-2026-09-09');
  await fs.mkdir(out, { recursive: true });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiji-reading-space-'));
  const app = await electron.launch({ executablePath: require('electron'), args: [path.resolve('out/知己-win32-x64/resources/app.asar'), `--user-data-dir=${path.join(temp, 'profile')}`], env: { ...process.env, ZHIJI_DATA_ROOT: path.join(temp, 'data') } });
  const metrics = [];
  try {
    const page = await app.firstWindow();
    const screenshot = async (name) => {
      await page.waitForTimeout(350);
      const base64 = await app.evaluate(async ({BrowserWindow}) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
      await fs.writeFile(path.join(out, name),Buffer.from(base64,'base64'));
    };
    await page.getByRole('button', { name: '日志', exact: true }).waitFor();
    await page.evaluate(async () => {
      const date = new Date().toLocaleDateString('en-CA');
      await window.zhiji.journals.create({ date, body: '合成布局验收材料一。', projectIds: [] });
      await window.zhiji.journals.create({ date, body: '合成布局验收材料二。', projectIds: [] });
    });
    await page.reload();
    for (const [width, height, zoom] of [[1440,900,1],[1440,900,1.25],[960,640,1]]) {
      await app.evaluate(({ BrowserWindow }, size) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(size[0],size[1]); w.webContents.setZoomFactor(size[2]); }, [width,height,zoom]);
      await page.getByRole('button', { name: '日志', exact: true }).click();
      const editor = page.getByRole('textbox', { name: '日志内容' });
      await editor.fill('今天整理了项目文档，核对了三处文字和一段引用。写到这里，需要回看前文并补充实际经历。\n'.repeat(30));
      await screenshot(`${phase}-journal-${width}-${zoom}.png`);
      const measure = async (selector) => page.evaluate((selector) => {
        const node = document.querySelector(selector), rect = node.getBoundingClientRect(), style = getComputedStyle(node);
        return { width:rect.width, height:rect.height, font:style.fontSize, lineHeight:style.lineHeight, visibleLines:Math.floor(node.clientHeight/parseFloat(style.lineHeight)), viewport:[innerWidth,innerHeight], sidebarFont:getComputedStyle(document.querySelector('.navigation button')).fontSize, horizontalOverflow:document.documentElement.scrollWidth>innerWidth };
      }, selector);
      metrics.push({ width,height,zoom,surface:'journal',...await measure('.writing textarea') });
      if (phase === 'after') {
        const visible = await page.locator('.composer-footer').evaluate(node => { const r=node.getBoundingClientRect(); return r.bottom <= innerHeight && r.right <= innerWidth; });
        if (!visible) throw Error('日志保存栏被裁切');
      }
      await editor.fill('');
      await page.getByRole('button', { name: '知己 Agent', exact: true }).click();
      if (!await page.getByRole('textbox', {name:'向知己 Agent 发送消息'}).count()) await page.getByRole('button', {name:'新建会话',exact:true}).click();
      await page.locator('.agent-messages').waitFor();
      // Offline display fixture only: no model request and no real user data.
      await page.locator('.agent-messages').evaluate(node => {
        node.replaceChildren();
        for(let i=0;i<12;i++) { const article=document.createElement('article'); article.className='agent-message agent-message--assistant'; const body=document.createElement('div'); body.className='markdown-document'; body.textContent='合成对话：今天整理了项目文档，逐段核对引用与文字。下一步回看已经完成的内容，继续补充记录。'.repeat(3); article.append(body); node.append(article); }
      });
      await screenshot(`${phase}-agent-${width}-${zoom}.png`);
      if (phase === 'after') {
        const visible = await page.locator('.agent-composer').evaluate(node => { const r=node.getBoundingClientRect(); return r.bottom <= innerHeight && r.right <= innerWidth; });
        if (!visible) throw Error('Agent 输入栏被裁切');
        await page.getByRole('button',{name:/会话列表/}).click();
        await page.locator('.agent-sessions.is-expanded').waitFor({state:'visible'});
        await page.getByRole('button',{name:/收起会话/}).click();
      }
      metrics.push({width,height,zoom,surface:'agent',...await measure('.agent-messages'),body:await measure('.agent-message .markdown-document')});
    }
    if (phase === 'after') {
      for (const view of ['设置', '复盘', '项目', '开始']) {
        await page.getByRole('button', {name:view,exact:true}).click();
        await screenshot(`${phase}-${view}.png`);
      }
      await page.getByRole('button', {name:'日志',exact:true}).click();
      await page.getByRole('textbox',{name:'日志内容'}).fill('暗色合成材料，检查正文与输入区域。\n'.repeat(40));
      await page.evaluate(() => document.documentElement.dataset.theme='dark');
      await screenshot('after-journal-dark.png');
    }
    await fs.writeFile(path.join(out, `${phase}.json`),JSON.stringify(metrics,null,2));
    console.log(JSON.stringify(metrics));
  } finally { await app.close(); await fs.rm(temp,{recursive:true,force:true}); }
})().catch(error => { console.error(error); process.exitCode=1; });
