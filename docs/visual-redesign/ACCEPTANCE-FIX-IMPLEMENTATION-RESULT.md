# v2.6.11 界面验收修正实施结果

日期：2026-09-09。状态：五项界面修正已完成；结果基于当前源码重新打包的 packaged-asar。

本记录承接 [ACCEPTANCE-FIX-DESIGN.md](ACCEPTANCE-FIX-DESIGN.md) 与 [ACCEPTANCE-FIX-PLAN.md](ACCEPTANCE-FIX-PLAN.md)。上一轮 [IMPLEMENTATION-RESULT.md](IMPLEMENTATION-RESULT.md) 保留为 v2.6.10 的历史记录，不用本文件覆盖其当时的事实。

## 结论

本轮五项修正均在隔离数据和真实 Electron packaged-asar 中完成边界验收：

1. **历史列表与正文不再相互遮挡**：宽窗口保持双栏；窄窗口折为单栏，长中文标题、连续英文和长正文均保持在各自容器内。
2. **暗色主题改为中性灰黑层次**：去除大面积绿色暗底，保留绿色作为少量主动作和状态强调。
3. **原生控件主题与滚动条已声明**：实际解析到 `color-scheme: dark`，暗色编辑器滚动条为深色轨道和灰色滑块，模板追加语义保持不变。
4. **日志模式入口与工具控件更易点击**：写日志／过去日志使用明确的双按钮，项目／模板工具行保留原生 `select` 并扩大可用尺寸。
5. **开始页全屏比例已修正**：最大化和恢复窗口下内容组均衡，矮窗口使用安全的自动边距和紧凑规则，不增加占位内容。

原生项目／模板下拉的**展开弹出层仍需人工确认**。本次平台 CUA 无法绑定 Electron 原生窗口，因此无法捕获 Windows 原生 popup；没有把关闭态 computed style 或普通页面截图冒充展开态通过证据。Playwright 已验证关闭态主题、箭头和控件样式；手动展开项是本轮唯一未自动闭环的验收子项。

## 实施范围

- `src/index.css`：中性暗色 tokens、`color-scheme`、暗色原生控件与滚动条、历史 Grid 最小宽度链和 container query、筛选布局、日志工具尺寸、开始页安全垂直布局。
- `src/renderer/pages/today-page.tsx`：保留原有未保存守卫和业务 handler，改为“写日志／过去日志”双按钮入口。
- `src/renderer/features/history/history-filter.tsx`：按两项／三项筛选显式布局。
- `e2e/release-quality.spec.ts`：增加长记录在宽窗口双栏和紧凑窗口单栏下的边界与无横溢出断言，并同步当前版本断言。
- 根版本、桌面端 package/lock、README、项目状态与 CHANGELOG 同步为 `2.6.11`。

没有修改保存、模板追加、日期、AI、存储或确认状态机；没有把样板合成内容写入产品数据。

## Electron 证据

运行来源：`out/知己-win32-x64/resources/app.asar`，包内 `package.json` 版本核对为 `2.6.11`。截图和边界脚本使用隔离 `ZHIJI_DATA_ROOT` 与临时 Electron user data，不读取真实日志或密钥，不调用真实模型。

系统缩放下 `devicePixelRatio` 为 `1.25`。窗口外框与实际 renderer viewport 的关系如下：

| 场景 | 实际 viewport | 关键结果 |
| --- | ---: | --- |
| 最大化开始页 | `1536×863` | 页面宽度 `1348`，页面／文档无横向溢出 |
| 恢复开始页（外框 `1200×780`） | `1186×718` | 页面宽度 `998`，页面／文档无横向溢出 |
| 暗色长模板最大化 | `1536×863` | `color-scheme: dark`；编辑器滚动条 `rgb(61, 61, 61) rgb(36, 36, 36)`；textarea `748×262.2` |
| 历史宽窗口（外框 `1280×800`） | `1266×738` | 双栏 `339.2px / 508.8px`；列表右边界 `622.8`，正文左边界 `646.8`；无横向溢出 |
| 历史紧凑窗口（外框 `900×640`） | `888×578` | 单栏 `668.8px`；列表底部 `348.5`，正文顶部 `372.5`；无横向溢出 |

关键截图：

- [开始页最大化](acceptance-fix-after-start-maximized.png)
- [开始页恢复窗口](acceptance-fix-after-start-restored.png)
- [暗色长模板](acceptance-fix-after-journal-dark-long-template.png)
- [历史宽窗口](acceptance-fix-after-history-wide.png)
- [历史紧凑窗口](acceptance-fix-after-history-compact.png)

## 实际验证

- `npm test`：60 files / 389 tests passed。
- `npm run typecheck`：passed。
- `npm run lint`：0 errors / 7 warnings；warnings 为既有告警。
- `npm run package`：passed；生成 v2.6.11 packaged-asar。
- `npm run test:e2e`：7 passed / 2 skipped；其中 `pretest:e2e` 再次以 v2.6.11 执行打包。
- 跳过项：安装版 Agent 启动与真实搜索回答需要显式的安装版路径和 API Key，本轮未读取或调用；Windows 原生下拉 popup 需人工展开确认。

本轮未执行 `make`、安装／升级／卸载、真实模型调用、提交或推送。其他页面仅接受共享主题与布局回归，没有做结构重排。
