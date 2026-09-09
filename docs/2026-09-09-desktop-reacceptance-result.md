# 桌面端二次复验结果

日期：2026-09-09
源码版本：2.6.14
范围：R1–R8；只使用合成日志和本机 mock AI，不读取真实日记、不发送真实密钥、不安装或发布。

## 结论

R1–R8 的代码修正和离线回归已完成。真实 Electron 中用同一条短合成日志完成了 A→B 两次“保存并生成反馈”：两次请求均带同一个明确 `journalId`，本机 mock 共收到 2 次结构化请求，持久化结果只有 1 条更新后的日志和 1 份同日反馈，`sourceIds` 与日志 ID 一致。

自动化质量验证全部通过：`npm test` 60 files / 415 tests、`npm run typecheck` 通过、`npm run lint` 0 errors / 7 warnings、`npm run package` 通过，带打包的 `npm run test:e2e` 为 7 passed / 2 skipped。未提交、推送、安装或发布。

## R1–R8 对照

| 项目 | 结果与证据 |
|---|---|
| R1 正文空间 | 通过。工作区高度链改为 flex/overflow 约束，textarea 以剩余空间为主并自行滚动；真实 Electron 1186×718 逻辑视口截图可见完整工具栏、编辑/分析切换和反馈内容。 |
| R2 字号与缩放 | 通过当前范围。日分析局部 Markdown 恢复为 15px；未修改系统 DPI 或用户缩放。真实运行 renderer 报告 `devicePixelRatio=1.25`；CDP fallback 无法独立读取 Electron `webContents.getZoomFactor()`，该值列为未单独验证。 |
| R3 重新生成与缓存 | 通过代码、单测和集成测。缓存返回显式 `cached: true`；强制重新生成传 `regenerate: true` 并实际请求；修改正文后按新 sourceVersion 重新生成。 |
| R4 单条来源与同日多条 | 通过。`journalId + date` 校验贯穿 IPC、Agent dispatcher、应用层和 renderer；明确选择时只读取该日志；多条同日记录不自动汇总、不自动选最后一条，旧原文保留。 |
| R5 日志/日分析切换 | 通过。两面共用同一工作区，反馈不再在正文底部重复堆叠；切换保持草稿状态。A/B 截图均显示单一分析面。 |
| R6 内容边界 | 通过提示词和回归。标题改为中性的“本次观察”，去掉重复行动，加入“未记录不等于未做”及周期反馈的证据边界；旧 Markdown 不重写。 |
| R7 Agent 空间与可达性 | 通过 renderer/CSS 单测、打包 E2E 与离线事件覆盖。移除重复页头，桌面会话列表可折叠，输入框从 1 行起步，消息区优先占空间；错误、审批、停止状态保留可见入口，上翻不会被强制拉回底部。 |
| R8 浅色层次 | 通过。复盘类型卡恢复 surface，侧栏恢复右边界，选中态和按钮状态沿用现有 tokens；浅色/暗色共享 select 的打包 E2E 通过。 |

## 三层结果

### 协议返回

- mock endpoint：`http://127.0.0.1:39433/v1/chat/completions`，仅本机临时进程。
- 两次请求均为 `stream: false`、`messageCount: 2`，模型名 `mock-daily-v1`，结构化 JSON 通过 daily schema，prompt version 为 `daily-review-v4`。
- 请求计数：2；返回 usage：第 1 次 input 112 / output 42 / cached input 0，第 2 次 input 113 / output 42 / cached input 0；合计 input 225、output 84、cached input 0。
- 这是协议与调用次数证据，不是模型分析质量证据；mock 返回固定的、专为契约验证准备的 JSON。

### 持久化与交互

- A：输入合成日志后点击“保存并生成今日反馈”。
- B：回到同一工作区把正文追加“下午又完成了归档。”，再次点击“保存并生成今日反馈”。
- 临时数据根只留下 1 个 journal Markdown、1 个 daily review Markdown 和 2 条 audit 记录；反馈 `sourceIds` 只含该 journal ID，未生成同日重复文件。
- A/B 截图：
  - [A：首次保存并生成](acceptance-followup-2026-09-09/desktop-reacceptance-A.png)
  - [B：修改后再次保存并生成](acceptance-followup-2026-09-09/desktop-reacceptance-B.png)
  - [脱敏运行元数据](acceptance-followup-2026-09-09/desktop-reacceptance-runtime.json)

### 分析质量

本次只用本机固定 mock 输出验证“输入来源、schema、渲染和落盘”闭环，不宣称真实模型的洞察质量。输出在界面中可见“本次观察”“明天试试”“新认知”，没有重复行动；审计记录两次均为 A 级证据。真实模型调用、真实服务商 token 计费和周/月分析质量不属于本轮必要调用。

## 验证命令

- `npm test`：60 files / 415 tests passed。
- `npm run typecheck`：passed。
- `npm run lint`：0 errors / 7 existing warnings。
- `npm run package`：Windows x64 package passed；保留 `gray-matter` 的既有 `eval` 打包 warning。
- `npm run test:e2e`：7 passed / 2 skipped；其中 2 项是条件跳过的窗口尺寸/安装版边界。

## 未验证项与边界

- 本机 `@oai/sky` trusted RPC 未配置，`cua` 会话只暴露浏览器面板，无法绑定原生 Electron 窗口；因此真实窗口交互使用同一 Electron dev 进程的本地 CDP fallback 完成，截图仍来自 Electron renderer，不是浏览器页面。
- Windows 原生 select 展开 popup 仍未由当前工具捕获，待人工展开确认。
- 未执行 Squirrel 安装、升级、卸载、代码签名、Windows 10/11 干净机矩阵，也未发布。
- 真实 Electron 复验记录了 renderer `devicePixelRatio=1.25`，未改变系统 DPI、用户缩放或正常 userData；精确 Electron zoomFactor 未从 fallback 调试面单独取得。
- mock 服务器、临时数据根、临时 userData 和运行脚本均已在验收后删除；截图和脱敏元数据是本轮保留产物。
