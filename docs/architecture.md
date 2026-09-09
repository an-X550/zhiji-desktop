# 知己桌面端架构与逻辑文档（AI 修改与优化指南）

> 更新日期：2026-09-08
>
> 读者：需要修改或优化 `apps/zhiji-desktop/` 的 AI 代理与开发者
>
> 证据口径：本文所有描述均核对过当前 `main` 分支源码；行为描述与代码不一致时，以代码为准并同步修正本文
>
> 关联文档：`docs/skill-compatibility-matrix.md`（Skill 兼容快照）、仓库根 `docs/archive/2026-08-14-desktop-vs-skill-system-contract-audit.md`（与 Skill 系统的契约差异）

## 0. 阅读约定

- 本文的"必须 / 禁止"表示会破坏产品契约或发布门的硬约束；"建议"表示风格或工程偏好。
- 修改任何行为前，先读第 14 节的修改检查清单；新增 IPC 端点必须按第 14.1 节的五处同步。
- 桌面端**不运行** Claude Skill/Agent，也**禁止依赖 `.claude/` 路径**（兼容矩阵隔离规则）。产品行为由 Main Process 的 TypeScript 代码与版本化提示词实现。
- 代码风格观察：本仓库大量使用单行多语句的紧凑写法（尤其 IPC handler 与 JSX）。修改时保持周围风格一致，不要顺手重排。

## 1. 产品定位与边界

知己桌面端是本地优先的 AI 日志复盘客户端，把"记录 → 反馈 → 复盘 → 沉淀"收敛为可验证的行动闭环。

在范围内：日志记录与补写、每日反馈、周/月/项目复盘、日志质量检查、年度回顾、快速方向校准（life-design 类型）、受控联网、验证模式沉淀、意图路由、个人背景授权注入、可验证备份与恢复、项目管理。

不在范围内（有意排除，勿当作缺失补上）：飞书/滴答分发、闭环缺口提醒投递、Claude Skill 运行时、云同步、多用户。详见兼容矩阵"排除"行。

## 2. 技术栈与构建

| 层面 | 选型 | 说明 |
|---|---|---|
| 运行时 | Electron ^43 | Main / Preload / Renderer 三进程 |
| 打包 | electron-forge ^7.11 + Vite 插件 + Squirrel maker | Windows x64 安装包；fuses 插件启用 |
| 前端 | React ^19 + TypeScript ^5.9 | 无路由库、无状态库，纯 useState/useEffect |
| 校验 | zod ^4 | 域模型、IPC 入参、模型输出三层都用 |
| AI 编排 | 显式 async runtime + Zod + `collectValidated` | 日反馈/周期复盘保留证据分级、质量门、取消与单次结构化重试 |
| Agent 编排 | DeepSeek Harness `0.1.0-rc.8` + Cordis `4.0.1` | 仅在独立 Utility Process 中运行会话 loop；现有领域能力仍由 Main Process 服务实现 |
| Markdown | gray-matter ^4 | frontmatter 序列化 |
| 压缩 | adm-zip | 备份导出/恢复 |
| 测试 | vitest ^2 + @testing-library/react + playwright | unit + integration + e2e；另有 `benchmark:memory` 离线基准 |

命令（在 `apps/zhiji-desktop/` 下）：

```text
npm start          开发运行
npm test           vitest run（当前 60 文件 / 383 测试，2026-09-08 实测）
npm run typecheck  tsc --noEmit
npm run lint       eslint（发布门要求 0 error）
npm run benchmark:memory  100/1,000/5,000 条合成中文检索冷/热基准
npm run package    electron-forge package（E2E 前置与发布门）
npm run test:e2e   playwright（先自动 package）
```

发布门：自动化测试、类型检查、Lint 0 error、真实 Electron 主链路 E2E、Windows x64 打包全部通过。

注意：原声明未使用的 `react-router-dom`、`zustand`、`@tanstack/react-query`、`react-hook-form`、`@hookform/resolvers` 已于 2026-08-14 从 `package.json` 移除（renderer.tsx 的 QueryClientProvider 死接线一并删除）；前端始终用原生 hooks。

## 3. 进程架构与安全基线

```text
┌─ Main Process（src/main.ts → bootstrap.ts）──────────────┐
│  application（用例）/ domain（纯逻辑）/ skill-runtime     │
│  prompts（版本化提示词）/ infrastructure（存储/AI/网络）   │
│  AgentFacade / AgentModelTransport（会话与模型密钥边界）   │
└──────────────▲───────────────────────────────────────────┘
               │ ipcMain.handle / preload（contextBridge）
┌─ Renderer（src/renderer.tsx → app/app.tsx）──────────────┐
│  pages / features / components / hooks / domain（纯函数） │
│  只能通过 window.zhiji（ZhijiDesktopApi）访问后端          │
└───────────────────────────────────────────────────────────┘
               │ Electron MessagePort（结构化事件/模型流）
┌─ Utility Process（main-process/agent/utility.ts）─────────┐
│  DSH Agent loop / session events；不持有凭证或产品数据能力 │
└───────────────────────────────────────────────────────────┘
```

安全基线（修改窗口或 IPC 时不得破坏）：

- `window-options.ts`：`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`。
- `main.ts`：`setWindowOpenHandler` 一律 deny，不打开任何新窗口。
- 凭证只进 `userData/credentials.json`（safeStorage 加密、0o600），不进数据目录、不进备份包。
- 个人背景仅在 `profile.enabledForAi === true` 时注入 AI 请求。
- 前端渲染 AI/日志内容必须走 `MarkdownDocument` 安全子集渲染器，禁止 `dangerouslySetInnerHTML`。
- `ipc-source-guard.ts`：所有业务 handler 统一校验已登记窗口、顶层 frame 和精确开发/生产页面；`main.ts` 同时限制导航与第二实例聚焦。

## 4. 源码目录总览

```text
src/
├── main.ts                    Electron 入口：ready → bootstrap() → createWindow()
├── preload.ts                 contextBridge 暴露 window.zhiji（唯一 IPC 面）
├── renderer.tsx               React 挂载点
├── index.css                  全局样式（单文件，BEM 风格类名）
├── shared/                    前后端共享（类型 + zod schema + 错误模型 + 纯领域函数）
│   ├── contracts/desktop-api.ts   ZhijiDesktopApi 接口（前端 API 总契约，返回类型引用 domain.ts 命名 schema）
│   ├── schemas/domain.ts          Journal/Project/Review/Pattern 等域模型，及 ProviderConfig/DataDirectoryInfo/备份与预览等契约类型
│   ├── schemas/ipc.ts             所有 IPC 入参 schema
│   ├── domain/daily-freshness.ts  日反馈新鲜度纯函数（前后端共用，S6 去重）
│   └── errors/app-error.ts        AppError 判别联合 + appError() 工厂（带中文默认文案）
├── main-process/
│   ├── bootstrap.ts               组合根：手工装配全部服务
│   ├── agent/                     DSH Utility Process、MessagePort 协议、AgentFacade 与 Main 模型代理
│   ├── window-options.ts          窗口与安全配置
│   ├── application/               用例层（每个文件一个用例类）
│   ├── domain/                    纯领域逻辑（无 Electron/fs 依赖）
│   ├── skill-runtime/             显式 async 运行时 + 结构化输出校验 + 证据分级 + 审计
│   ├── prompts/                   版本化提示词 + zod 输出解析 + 确定性渲染
│   ├── infrastructure/            存储仓储、AI 适配器、凭证、备份、联网、数据目录
│   └── ipc/                       IPC 注册、来源校验与委托
└── renderer/
    ├── app/                       App / AppShell / navigation 模型
    ├── pages/                     六个一级页面（含知己 Agent；其余五页职责不变）
    ├── features/                  跨页面复用功能块（history/patterns/reviews/settings/projects）
    ├── components/                基础组件（Button/Field/Modal/MarkdownDocument 等）
    ├── hooks/use-app-data.ts      启动数据加载与刷新
    ├── domain/                    渲染端纯逻辑（next-step/history-items）
    └── utils/                     本地日期工具
```

## 5. 前端架构（Renderer）

### 5.1 应用骨架与导航模型

`App`（app/app.tsx）持有两个状态：`target: NavigationTarget` 与 `journalDirty`。没有路由库——页面切换就是 `setTarget`，视图由 `target.view` 条件渲染。

导航模型（app/navigation.ts）是前端最重要的契约之一：

```text
AppView = 'start' | 'agent' | 'journal' | 'reviews' | 'projects' | 'settings'
NavigationIntent = journal.compose | journal.generate-daily | records.journals
                 | review.weekly | review.monthly{month?} | review.yearly{year?}
                 | review.coach | review.project{projectId}
NavigationTarget = { view, intent? }
```

规则：

- 页面通过 `intent` prop 消费导航意图（如复盘页根据 `review.monthly` 自动选中月复盘并回填日期），不得为意图新建页面。
- 离开 `journal` 页且 `journalDirty` 时弹 `window.confirm` 草稿保护；`TodayPage` 通过 `onDirtyChange` 上报脏状态。

### 5.2 数据层

`hooks/use-app-data.ts` 是唯一的全局数据入口：启动时 `Promise.all` 并行拉取 journals/projects/reviews/settings/dataDirectory 五份列表，提供 `refresh()` 全量重拉。所有写操作成功后由页面调用 `onRefresh()`（即 `data.refresh`）同步状态。

没有增量更新、没有缓存层、没有乐观更新。修改时保持这个模型：写 → refresh → 重渲染。引入状态库前必须有真实性能证据（见第 15 节）。

### 5.3 页面职责

| 页面 | 文件 | 职责与关键逻辑 |
|---|---|---|
| 开始 | `pages/start-page.tsx` | `resolveNextStep` 确定性建议卡；能力链接（做复盘/查看记录/管理项目）。原意图输入框已于 2026-08-14 下线删除 |
| 知己 Agent | `pages/agent-page.tsx` | DSH 会话列表、重启后恢复、流式消息、安全 Markdown、运行状态与停止；阶段 B 的只读工具之外，阶段 C 可保存日志、生成每日反馈，或预览并经页面确认后生成周期/洞察复盘；正式产物仍由既有页面与服务负责 |
| 日志 | `pages/today-page.tsx` | 写日志/过去日志两个 section；日期可选今天或过去（补写只保存不自动生成反馈）；"保存并生成今日反馈"会先保存再调 `reviews.generateDaily`；clarification 结果以 info 横幅展示；删除走确认条 + 回收站；复用 `RecordBrowser` 浏览历史并支持对过去日期"生成这一天的反馈" |
| 复盘 | `pages/reviews-page.tsx` | 生成/历史两个 section；周/月/项目三卡 + "更多洞察"折叠区（coach/yearly/life-design）；固定流程：选类型 → 预览材料（拿 token）→ 确认并生成（带 previewToken）；结果用 `MarkdownDocument` 渲染并挂 `PatternPanel` |
| 项目 | `pages/projects-page.tsx` | 创建/重命名/归档/恢复/删除；有关联日志时删除被后端拒绝 |
| 设置 | `pages/settings-page.tsx` | AI 服务（三预设卡 + custom，测试连接成功后自动保存）、本地数据（路径可见、打开文件夹、导出/校验/恢复备份）、个人背景（保存/授权开关/清空） |

`RecordBrowser`（pages/history-page.tsx 导出，跨页面复用）是日志与复盘的统一浏览器：按 `allowedKinds` 过滤，支持删除回调、对日志补生成反馈、编辑日志。

### 5.4 features 功能块

- `features/reviews/material-preview.tsx`：材料预览列表（来源 id、日期、100 字摘录）。
- `features/reviews/review-type-card.tsx` / `insight-tools.tsx`：复盘类型卡与低频洞察工具入口。
- `features/patterns/pattern-panel.tsx`：验证模式面板。语义硬约束——AI 只能提候选；确认才沉淀；拒绝仅移出本地列表，无任何持久化。
- `features/settings/provider-card.tsx`：服务商选择卡。
- `features/history/history-filter.tsx` / `history-reader.tsx`：历史过滤与阅读。

### 5.5 渲染端纯逻辑（domain/）

- `next-step.ts`：首页建议的确定性决策链，按优先级：今天无日志 → 写日志；有日志无匹配当日来源版本的日反馈 → 生成反馈；周末且本周 ≥3 篇日志且无周报 → 周复盘；1 月上半月且上年 ≥6 份月报且无年报 → 年度回顾；每月前 3 天且上月 ≥2 份周报且无月报 → 月度复盘；近 30 天 ≥7 篇日志且无近期 coach → 日志质量检查；兜底 → 查看最近记录。日反馈新鲜度判断已抽至 `shared/domain/daily-freshness.ts`（S6），前后端同引用该纯函数，修改只需改一处。
- `history-items.ts`：历史条目归并排序。

### 5.6 安全渲染

`components/markdown-document.tsx` 是自研的 Markdown 子集渲染器：剥离 frontmatter，逐行识别表格/标题（级别 +1 上限 h6）/引用/无序列表/段落，全部以 React 元素输出文本，不解析内联语法（加粗、链接、行内代码不渲染为格式），不执行 HTML。所有 AI 与用户内容的展示都必须经过它。扩展渲染能力时只能在这个文件内做，且不得引入 `dangerouslySetInnerHTML`。

## 6. IPC 契约层

三件套必须保持一致：

1. `shared/contracts/desktop-api.ts`——`ZhijiDesktopApi` 接口，前端可见的完整 API 形状（包括 `agent`；其余领域 API 保持不变）。
2. `preload.ts`——每个方法逐一映射到 `ipcRenderer.invoke('通道名')`；`contextBridge.exposeInMainWorld('zhiji', api)`。
3. `ipc/register-handlers.ts`——`ipcMain.handle('通道名', ...)`，入参一律 zod schema `.parse(raw)` 后再委托服务。

通道命名约定：`域:动作`（如 `reviews:generate-daily`）。入参 schema 全部在 `shared/schemas/ipc.ts`；ID 带前缀 refine（`journal_`/`project_`/`review_`）。返回值是域模型或判别联合（如 `DailyGenerationResult = {kind:'review'|'clarification'}`）。

错误传播：Main Process 抛出的 `appError`（`shared/errors/app-error.ts`）序列化后在前端以 `reason instanceof Error ? reason.message : 兜底文案` 展示。新增错误必须扩展 `AppError` 联合而不是抛裸 Error（裸 Error 可抛但只用于内部断言）。

模型选择的约定：需要 AI 的 handler 先 `await deps.configureAi.getPublicConfig()` 取当前 model，再把 model 传给应用服务——模型是请求级参数，不在服务构造期固定。

## 7. 后端架构（Main Process）

### 7.1 组合根

`bootstrap.ts` 手工装配（无 DI 容器）：数据根 `process.env.ZHIJI_DATA_ROOT ?? Documents/知己`；按“仓储 → 凭证 → AI 配置 → 任务管理 → 生成服务 → 领域服务 → 传输/目录服务”顺序构造，最后整体注入 `registerHandlers`。`MaintenanceCoordinator` 统一包住 IPC 与 Agent 工具在途操作，迁移/导出/恢复先排空写入并按需要停止 Utility；数据根切换成功后应用保持只读，要求重启后重新装配。正常 Agent `list` 作为在途读取计数，维护中的 `list` 返回 Main Process 已有快照，不启动或请求 Utility；`start`、`send`、`delete`、`confirm` 等写入口在维护态入场前拒绝。阶段 A 额外装配 `AgentFacade`：它启动独立 Utility Process 中的最小 DSH loop，并通过 `AgentModelTransport` 调用 `ConfigureAi.streamAgent()`；密钥仅在 Main Process 内解密和使用。阶段 B/C 的 `AgentToolDispatcher` 只允许经既有服务读取摘要、受控搜索/读源，或调用高层日志/反馈/复盘用例；周期与洞察复盘的确认状态由 Main Process 持有，不能由模型文本冒充。新增服务的装配只改这一个文件。

### 7.2 application 层（用例）

| 用例类 | 文件 | 职责 |
|---|---|---|
| `CreateJournal` / `UpdateJournal` | `save-journal.ts` | zod 校验 → 拒绝未来日期 → 生成 `journal_` id → 仓储写入；更新带 `expectedUpdatedAt` 乐观并发 |
| `GenerateDailyReview` | `generate-daily-review.ts` | 快路径（sourceVersions 指纹未变且非 regenerate → 返回缓存）→ 任务状态机 → `runDailyFeedback` → 保存 Review(schemaVersion 2) → 审计记录；可接收 Agent 的外部 AbortSignal |
| `GeneratePeriodicReview` | `generate-periodic-review.ts` | 预览（生成 uuid token + 材料 SHA-256 digest）→ 生成时校验 token 与 digest（材料变化则要求重新预览）→ `runPeriodicFeedback` → 保存 Review(schemaVersion 1)；Agent 生成前还需 Main Process 一次性页面确认，并转发取消信号 |
| `GenerateInsightReview` | `generate-insight-review.ts` | coach/yearly/life-design 三种洞察工具；同样的预览-digest 确认门，Agent 复用页面确认；coach 走 JSON 模式 + `renderJournalCoach`，其余为自由文本 |
| `VerifiedPatternService` | `verified-patterns.ts` | propose：从单篇复盘提取 ≤3 条候选（不落库）；confirm：确认后才写入 JSON 快照 |
| `ConfigureAi` | `configure-ai.ts` | settings.json 读写（原子写 + schema 复读校验）、Key 存凭证库、连接测试、`collect()` 适配器；非开发环境强制 HTTPS |

### 7.3 domain 层（纯逻辑，可单测）

- `review-task.ts`：`ReviewTaskManager` 单任务状态机。相位：`queued → building_context → generating → validating → saving → completed|failed|cancelled`。已有非终态任务时 `start()` 抛 `TASK_ALREADY_RUNNING`；每个任务持独立 `AbortController`，`reviews:cancel` 触发 abort。
- `material-selector.ts`：周期复盘材料选择——范围内日志 + 下游沉淀（weekly 收 daily 复盘；monthly 收 weekly 复盘；project 收项目交集日志），按 id 去重、按日期排序。
- `insight-materials.ts`：洞察工具材料与门槛——coach ≥3 篇日志（取最近 40）；yearly ≥6 份月报；life-design 按月>周>日优先级混排取 40 条。
- `daily-context.ts`：日反馈上下文组装（当日日志 + 最近前次反馈）。

### 7.4 skill-runtime 层（Skill 行为的确定性复刻）

设计原则：证据分级与降级由代码强制，不信任提示词自觉。

- `daily-evidence.ts`：中文关键词正则把日志分句归入 facts/states/interpretations/intentions，输出 A-D 等级与 gaps。A=四类齐全；B=事实+（状态或解释）；C=仅片段但有本人经历；D=无法确认本人经历。**已知风险**：正则实现与 Skill 侧语义判级可能分歧（见契约审计 R2）。
- `daily-runtime.ts`：显式 async 分支——先做 A-D 证据分级，D 级追加至多一次 `confirmPersonalExperience` 短复核，仍为 D 才返回补证问题；A/B/C 通过 `collectValidated` 走 1200 token 的结构化生成，C 级在代码层强制 `patternConnection = null`。
- `periodic-evidence.ts` / `periodic-runtime.ts` / `periodic-materials.ts`：周期版同构。证据等级按材料数量判定（如 weekly：无日志且无日反馈=D；无日反馈=C；日反馈<3 或日志<3=B；否则 A）。材料按"下游沉淀优先"组装为 `{ primary, supplement, journalIndex }`：周复盘主材料是日反馈，月复盘主材料是周复盘；下游沉淀 <3 条才补日志全文，否则只给日志索引。周期结构化预算为 weekly/project 1800、monthly 2400，`collectValidated` 对空、截断、非法 JSON 或 Schema 错误最多重试一次。
- `collect-validated.ts`：统一结构化响应诊断（失败类别、finish reason、长度、Schema 路径、时间）与单次重试；网络、认证和取消不重试，诊断不保存模型原文。
- `daily-audit-recorder.ts`：JSONL 仅追加审计（日期、来源 id、证据等级、结果、上一行动状态），不做长期模式沉淀。
- `compatibility/`：`daily-feedback-v1.ts`、`periodic-review-v1.ts` 冻结兼容快照常量，声明桌面端对齐的规则版本；与仓库根契约审计文档联动阅读。

### 7.5 prompts 层（版本化提示词）

每个提示词文件三件套：系统提示词（或按类型生成）、zod 输出 schema + `parseXxxOutput`（容忍 ```json 代码块包裹，字段严格校验）、确定性 `renderXxx`（把结构化输出排版为 Markdown 正文）。

| 文件 | 版本常量 | 要点 |
|---|---|---|
| `daily-review-v1.ts` | `daily-review-v3` | D0-D6 摘要、单洞察单行动、常规 260 字上限与例外 320 字（提示词软约束）、JSON 字段契约 |
| `periodic-review-v1.ts` | `periodic-review-v4` | 按类型与等级生成系统提示；复盘六问一级标题结构与 Skill 侧 review-synthesis 契约同构（含回顾目标、聊天摘要、方向锚点五态缺席检查、质量自检，B/C 降级与空锚点披露由代码强制）；月报深度（主主题归并、下月规划假说、升级提醒）；800 字上限；下游沉淀优先说明 |
| `journal-coach-v2.ts` | `journal-coach-v3` | A-D 就绪度 + 六步法表格（回忆事实/筛选重点/评估结果/洞察思考/行为改进/分享讨论） + 一项低摩擦动作；`directionWarning` 需四类方向信号中至少两类才填，单日低落或普通任务压力不触发 |
| `verified-patterns-v1.ts` | `verified-patterns-v1` | 单篇复盘提取 0-3 条可验证行为假说候选 |
| `insight-review-prompts.ts` | 按类型 | yearly（`yearly-review-v2`，含升级提醒触发条件）/life-design（`life-design-v2`，含下次如何验证）的系统提示词与版本 |

规则：提示词语义变化必须递增版本常量（`xxx-vN`），并写入 Review 的 `promptVersion` 字段与兼容快照；渲染函数是输出格式的唯一真相，不要让模型直接产出最终 Markdown。

### 7.6 infrastructure 层

Markdown 仓储（`infrastructure/markdown/`）统一模式：

- 序列化：gray-matter frontmatter + 正文；回读经 zod schema 校验。
- `atomic-write.ts`：写入同目录校验临时文件并复读，再交给 `write-file-atomic@6.0.0` 完成 fsync/替换；失败不先移走正式文件。所有落盘必须用它。
- `path-policy.ts`：`resolveInsideRoot` 防路径穿越；中文目录名是现实约束（仓库已知问题），新代码保持兼容。
- `journal-repository.ts`：`journals/YYYY/*.md`；create/update/delete 共用 Promise 队列，更新日期只改 frontmatter、不搬文件；启动阶段只恢复唯一合法 `.bak`/`.moving` 候选，冲突与歧义保留并告警；重复 id 抛 `FILE_CONFLICT`；删除走 `shell.trashItem`。
- `review-repository.ts` / `profile-repository.ts`（`profile/about-me.md`）/ `project-repository.ts`（JSON，项目名全局唯一）同模式；日志/复盘仓储提供元数据核对的 `searchEntries`，供检索索引增量复用。

其他基础设施：

- `ai/openai-compatible-provider.ts`：手写 SSE 流解析；HTTP 状态码映射结构化错误（401/403→INVALID_API_KEY、404→MODEL_NOT_FOUND、429→RATE_LIMITED）；`jsonObject` 选项启用 `response_format: json_object`；Agent 工具名仅在外部 API 边界转换为合法格式并在返回时恢复内部名称，DeepSeek Agent 使用非思考模式。
- `ai/provider-config.ts`：三预设（openai/deepseek/custom）+ HTTPS 校验（开发环境可放行 loopback HTTP）；DeepSeek 默认 `deepseek-v4-flash`，旧模型名由配置服务迁移。
- `credentials/credential-store.ts`：safeStorage 加密，`userData/credentials.json`，加密不可用时明确报错不降级明文；旧密钥环导致密文无法解密时保留文件并按“未配置 API Key”恢复设置页。
- `data-directory/data-directory-service.ts`：数据目录信息（路径、可写性、文件数、字节数、分类计数）与打开。
- `data-directory/data-root-holder.ts` + `lifecycle/maintenance-coordinator.ts`：迁移/恢复/导出先同步检查 running 会话，忙碌时不进入 draining，保留用户取消能力；通过后排空所有 Main 与 Agent 写入；`AgentFacade` 在严格维护停机前再次检查 session.status，存在 running 回合则拒绝维护，让用户完成或正常取消。`ElectronAgentRuntime.stopForMaintenance()` 不复用会隐式启动的 request：先确认同一 child 的 `runtime.shutdown` `command.completed`，再核对 `kill()` 与真实 `exit`；shutdown 失败、超时、`kill=false` 或无 exit 均不进入复制/恢复，`error` 不冒充 `exit`，旧 child 迟到事件不清理新实例。逐项复制并验证文件集/大小后原子更新配置，成功进入只读等待重启，失败经明确内部恢复路径恢复原路径能力。
- `transfer/data-transfer-service.ts` + `archive-manifest.ts` + `business-archive-validator.ts`：导出 `.zhiji.zip`（manifest 含 formatVersion/appVersion/逐文件 sha256）；恢复两段式——preview 校验（路径白名单、哈希、业务 schema）返回 previewId，restore 只允许写入空数据目录；API Key 与缓存不入包。
- `agent/dsh-runtime.ts` + `@deepseek-ai/dsh-session-persistence-jsonl`：Agent 事件日志写入数据根 `agent/sessions/`；Main 负责路径、恢复列表和安全投影，Utility 负责 DSH session loop，不把领域正文复制进会话。
- `agent/agent-memory-search-service.ts` + `markdown/search-entries.ts`：MiniSearch 内存索引按文件 `size/mtimeMs/ctimeMs` 增量刷新；写入、恢复和数据根切换主动失效，来源内或跨来源重复 ID 在索引变更前以 `FILE_CONFLICT` 拒绝，损坏文件不被跳过，索引不进入备份权威数据。真实 get、预览和生成仍读取权威文件。
- `ipc/ipc-source-guard.ts`：统一登记 BrowserWindow、校验顶层 frame 与精确页面来源；生产只接受精确 `file://` 入口，开发只接受实际 Vite origin/path。
- `ai/openai-compatible-provider.ts`：结构化请求使用非流式 `response_format: json_object`，保留 `finish_reason` 和可选 input/output/cached usage；不支持的字段为 `null`。
- `patterns/verified-pattern-repository.ts`：单一 JSON 快照，原子写 + zod 复读；损坏报错。
- `web/tavily-web-search-provider.ts` + `web/web-search-service.ts`：受控联网。官方 `@tavily/core@0.7.7` 走 keyless `search/extract`；搜索最多保存 8 条 HTTPS/HTTP 公开来源及域名、时间和有限正文，结果绑定 `search_` 会话；`readSource` 只接受本会话返回过的 `sourceId`，正文最多 2000 字，不向 Agent 暴露任意 URL。Provider 错误在 Main Process 收敛为不可用、超时、共享限额、空结果或来源不可读。

## 8. 数据模型与存储布局

域模型（`shared/schemas/domain.ts`）核心：

- `Journal`（schemaVersion 1）：`journal_` id、ISO 日期、body、projectIds、createdAt/updatedAt。
- `Review` 联合：v1 无来源版本；v2 增加 `sourceVersions`（目前仅 daily 使用，支撑新鲜度快路径）。type 七值：daily/weekly/monthly/project/coach/yearly/life-design。必带 model/promptVersion 溯源字段。
- `VerifiedPatternSnapshot`：≤500 条模式；候选不落库。
- 主题思考不再是桌面端域模型；历史 `topics/` 数据若已存在仍保留在数据根目录，但桌面端不再读取、写入或展示。

数据目录（默认 `Documents/知己`，`ZHIJI_DATA_ROOT` 可覆盖）：

```text
知己/
├── journals/YYYY/*.md          日志（frontmatter + 正文）
├── reviews/...                 复盘（Markdown）
├── projects.json               项目列表
├── profile/about-me.md         个人背景
├── settings.json               公开 AI 配置（无 Key）
├── patterns/...                验证模式 JSON 快照
├── topics/...                  旧版主题数据（保留但不再由桌面端读写）
├── audits/...                  日反馈 JSONL 审计
└── agent/sessions/...          DSH Agent JSONL 事件日志（可迁移、可备份校验）
userData/credentials.json       safeStorage 加密的 API Key（不入备份）
```

## 9. 关键业务流程

### 9.1 每日反馈

```text
TodayPage.generate → 先保存草稿（若有）→ reviews:generate-daily
→ GenerateDailyReview：当日日志为空抛 NOT_FOUND
→ 快路径：已有 v2 反馈且 sourceVersions 一致且非 regenerate → 返回缓存
→ ReviewTaskManager.start（并发则 TASK_ALREADY_RUNNING）
→ runDailyFeedback（显式 async）：
    build_evidence（正则分级）
    ├─ D 级 → confirmPersonalExperience（至多一次短复核）→ 仍为 D：返回补证问题，不保存
    └─ A/B/C → 组上下文（当日日志+前次反馈+可选 profile）
       → collectValidated（1200 token，结构失败至多重试一次）→ parseDailyReviewOutput
       → C 级强制 patternConnection=null → renderDailyReview
→ 保存 Review v2 → DailyAuditRecorder 记录 → completed
```

前端把 `clarification.question` 显示为 info 横幅，把 `review.body` 显示为成功横幅（日反馈正文以横幅形式展示，不进 MarkdownDocument）。

### 9.2 周期复盘（预览-确认门）

```text
reviews:preview → selectMaterials（日志+下游沉淀）→ 空则 INVALID_INPUT
→ 生成 uuid token，保存 {input, digest(SHA-256 材料指纹)} → 返回来源摘录
reviews:generate-periodic（带 previewToken）
→ token 不存在 → “请先预览并确认材料”
→ 重算材料 digest ≠ 预览 digest → “材料已变化，请重新预览”
→ runPeriodicFeedback（build_evidence → D?clarify : generate）
    generate：periodicSystemPrompt(type, grade) + {materials: 下游沉淀优先结构, evidence, profile?}
    → collectValidated（weekly/project 1800；monthly 2400，结构失败至多重试一次）→ 六问 Schema → 质量门 → 确定性渲染
→ 保存 Review v1
```

洞察工具（coach/yearly/life-design）同门，材料门槛见 7.3；coach 额外走 JSON schema 渲染。

### 9.3 Agent 正式工作流（阶段 C）

```text
DSH tool.request
→ Main Process AgentToolDispatcher 共享 Zod 校验
→ journals.create/update：调用 CreateJournal / UpdateJournal，复用日期、ID 与乐观并发规则
→ reviews.generate-daily：调用 GenerateDailyReview；D 级只返回补证问题，不保存残缺反馈
→ reviews.preview-periodic / preview-insight：调用既有 preview，返回材料摘录 + previewToken
→ Main Process 签发短期一次性 approvalId，Renderer 展示材料与“确认并继续”
→ agent:confirm（Main 校验 sessionId + approvalId）→ Agent 继续一轮
→ reviews.generate-periodic / generate-insight：校验 token、材料 digest 与 approvalId 后调用既有用例
→ AgentFacade 把成功结果转换成受校验的正式结果卡；Renderer 只能导航既有日志/复盘页
```

`tool.cancel` 沿 MessagePort 反向传播为 Main Process 的 `AbortSignal`，再连接 `ReviewTaskManager`；取消发生在保存前时不会生成半写入正式复盘。确认状态只存在于 Main Process 的短期内存中，过期或进程退出后必须重新预览。

所有 Agent `tool.request` 也计入 `MaintenanceCoordinator` 的在途操作；数据迁移、导出或恢复先拒绝 running 回合，通过后等待已入场工具返回、再次核查回合状态，再请求 Utility shutdown，避免会话工具在复制期间继续写入。`session.send` 的命令完成只代表 DSH 接收 followup，不代表模型回合完成；本地 session 状态仍为 `running` 时，维护在严格停机前拒绝且不调用 stop/copy。维护及重启等待期间，`list/get` 只读 Main Process 快照；复制失败时使用内部恢复路径，成功迁移则保持只读并要求重启。

### 9.3.1 Agent 会话持久化与数据生命周期（阶段 D1）

```text
bootstrap → dataRoot/agent/sessions/
→ Main 将绝对 root 传给 Utility
→ DSH JsonlSessionPersistence（compression=none）追加 session events
→ agent:list → session.list → list + inspect → 有限长度 session.snapshot
→ 重启后 agent:send → AgentRegistry.resume → 继续原事件历史
```

会话日志是 Agent 对话过程的权威，不取代日志、日反馈、周/月复盘和项目的 Markdown/JSON 仓储。数据目录迁移复用 `DataRootHolder` 的递归复制；备份路径白名单接纳 `agent/sessions/<project>/<agent>/session.jsonl`，业务校验用 DSH `Session.fromRestore` 验证 header、事件类型、顺序和序号。损坏日志以 `IMPORT_REJECTED` 或“会话数据损坏”明确失败，保留原文件，不静默重置。

Agent 每轮模型请求会额外收到由桌面端本地时钟生成的当前日期/星期事实，避免把相对日期交给模型猜测；用户确认删除后，Utility 释放 live handle，Main Process 将对应会话目录移入系统回收站。Enter 发送、Shift+Enter 换行，运行中的会话不可删除。v2.0.4 打包版实测在当前 API Key 下按 Enter 询问“今天星期几”返回本机正确星期，并能通过只读工具读取真实日志摘要；删除后重启不会恢复该验收会话。

主题思考不再属于桌面端运行时。已存在的 `topics/` 文件不会被删除，作为用户可自行处理的旧数据保留；桌面端不再提供主题页面、IPC、会话 checkpoint、主题仓储或 DSH 主题工具。Skill/CLI 侧的主题讨论契约不受影响；每日反馈、周复盘、月复盘和其他复盘页面不受影响。

### 9.4 已移除的桌面端主题思考

主题思考原本只是“与 AI 讨论后沉淀认识”的辅助便利，不是日志复盘闭环的必要步骤。依据第一性原理，继续维护一套独立会话、提案、差异和确认协议的成本高于它对核心目标的贡献，因此从桌面端删除；需要该能力时仍可在 Skill/CLI 侧按需讨论和沉淀。

### 9.5 验证模式

```text
patterns:propose（reviewId）→ 模型提 ≤3 条候选（仅返回，不落库）
patterns:confirm（候选）→ 生成 pattern_ id → 快照 add（原子写 + 复读校验）
拒绝：前端只移除列表项，后端无调用、无持久化
```

### 9.6 备份与恢复

导出：对话框选路径（强制 `.zhiji.zip` 后缀）→ 收集数据文件 → manifest（逐文件 sha256）→ adm-zip 写出。恢复：选包 → preview（校验 manifest、路径白名单、哈希、逐文件业务 schema；返回分类计数与 previewId）→ restore（uuid 校验 previewId；只允许空数据目录；提示重启）。

## 10. 错误码表（shared/errors/app-error.ts）

| code | 语义 | 典型触发 |
|---|---|---|
| INVALID_INPUT | 入参或前置条件不满足 | 材料为空、预览缺失、日期范围倒置 |
| NOT_FOUND | 目标不存在 | 当日无日志却请求反馈 |
| INVALID_API_KEY | 401/403 | Key 无效或过期 |
| MODEL_NOT_FOUND | 404 | 模型名错误 |
| RATE_LIMITED | 429 | 限流 |
| NETWORK_TIMEOUT | 网络失败/中断 | fetch 失败或 abort |
| INVALID_MODEL_OUTPUT | 模型输出不合 schema | JSON 解析或字段校验失败 |
| FILE_CONFLICT | 重复 id/并发冲突 | 仓储或检索索引读到重复 id |
| DATA_CORRUPTED | 本地数据损坏 | 快照/索引复读校验失败 |
| IMPORT_REJECTED | 备份校验拒绝 | manifest/哈希/路径/业务 schema 不合格 |
| TASK_ALREADY_RUNNING | 已有进行中的生成任务 | ReviewTaskManager 并发拦截 |
| SEARCH_UNAVAILABLE / SEARCH_TIMEOUT | 搜索服务不可用或超时 | Tavily provider 网络失败、请求超时；超时只允许同轮自动重试一次 |
| SEARCH_RATE_LIMITED | keyless 共享额度受限 | Tavily keyless 返回限额错误，可带 `retryAfterSeconds` |
| SEARCH_EMPTY | 搜索没有可用结果 | provider 返回空结果或不合格来源 |
| SOURCE_UNAVAILABLE | 搜索会话中的来源不可读 | `extract` 失败或返回空正文 |
| SEARCH_NOT_CONFIGURED | 搜索服务未配置 | 仅作安全兜底，当前默认走 keyless，不读取 API Key |
| UNKNOWN | 兜底 | 附 message |

Agent 工具错误统一返回 `code/message/retryable/retryAfterSeconds?`；普通回复保持 Markdown。Main Process 不向 Agent 或 Renderer 传递 provider 原始错误、凭据、文件路径或任意 URL。

## 11. 测试与验证

- `tests/unit/`（39 文件）：domain 纯逻辑、证据分级、提示词解析/渲染、仓储、服务（ProviderPort 注入假实现）。
- `tests/integration/`（15 文件）：用例级链路（含审计记录、预览门、确认门）。
- `e2e/desktop.spec.ts`：真实打包 Electron 主链路（项目、日志保存、历史读取等）。
- `tests/setup.ts`：jsdom 环境。
- 测试约定：AI 调用一律注入 `ProviderPort` 假实现，不打真实网络；时间用构造注入的 `now`；文件用临时目录。

## 12. 约定速查（修改代码前必读）

1. 日期一律 `YYYY-MM-DD` 字符串，比较直接用字典序（`start <= end`）。
2. ID 前缀固定：`journal_`/`review_`/`project_`/`pattern_`/`search_`/`source_`，生成用 `crypto.randomUUID()` 去连字符。
3. 所有落盘走 `atomicWriteUtf8` 并传复读校验回调；删除走回收站。
4. 模型输出必须经 `parseXxxOutput` + zod strict；渲染必须经 `renderXxx`。
5. 提示词语义变化 → 递增 `xxx-vN` 版本常量并更新兼容快照。
6. 新增/修改域模型字段 → `domain.ts` schema + 相关仓储序列化 + 测试三处同步。
7. 中文 UI 文案保持现有语气：不责备、不鸡汤、结论直给（参考 TodayPage/StatusBanner 文案）。
8. 不引入对 `.claude/` 的运行时依赖；Skill 对齐语义记录在兼容快照与契约审计文档。

## 13. 修改检查清单

### 13.1 新增一个 IPC 端点（五处同步，缺一即类型断裂）

1. `shared/schemas/ipc.ts`：入参 schema。
2. `shared/schemas/domain.ts`：返回值模型（如需要）。
3. `shared/contracts/desktop-api.ts`：接口方法签名。
4. `preload.ts`：`ipcRenderer.invoke` 映射。
5. `ipc/register-handlers.ts`：`ipcMain.handle` + zod parse + 委托。
另：`renderer/global.d.ts` 声明（若 `window.zhiji` 类型来源在此）、对应 unit/integration 测试。

### 13.2 修改生成类行为

- 是否影响新鲜度快路径（`shared/domain/daily-freshness.ts`，前后端同引用）？
- 是否需要递增 promptVersion？是否需要同步 `skill-runtime/compatibility/` 快照？
- 是否经过 `ReviewTaskManager` 状态机与 AbortSignal？
- D 级/材料不足路径是否仍然不调模型、不落盘？

### 13.3 修改存储

- schemaVersion 是否需要升级？旧文件能否被现有 parse 读回（向后兼容是硬要求）？
- 备份/恢复的 `business-archive-validator` 是否覆盖新文件类别？
- `DataDirectoryService` 的分类计数是否需要更新？

## 14. 已知技术债与优化候选（按证据强度排序）

1. ~~**未使用依赖**~~：已于 2026-08-14 清理（移除五个未使用依赖与 react-query 死接线，lock 文件同步）。
2. ~~**跨端重复的新鲜度逻辑**~~：已于 2026-08-14 抽至 `shared/domain/daily-freshness.ts`，双端对照单测见 `daily-freshness.test.ts`。
3. **预览 Map 无回收**：`GeneratePeriodicReview`、`GenerateInsightReview` 的 previews 只在成功 execute 时删除；放弃的 token 常驻内存至进程退出。单用户场景影响小，但加 TTL 或上限是低成本加固。
4. ~~**IPC 无 sender 校验**~~：已于 2026-09-08 由 `IpcSourceGuard` 统一校验已登记窗口、顶层 frame 和精确页面来源；真实 Electron 页面仍需随打包 E2E 复验。
5. **日反馈长度仅软约束**：提示词写 320 字但 zod 字段上限宽松且无渲染期校验；出现真实超长样本再加硬校验。
6. **MarkdownDocument 无内联格式**：加粗/链接/行内代码不渲染；扩展须在安全渲染器内实现。
7. **register-handlers.ts 单文件承载 ~45 个 handler** 且含少量业务判断（项目删除前关联检查、备份对话框流程）；按域拆分可提升可维护性，属重构而非缺陷。
8. **证据分级正则与语义判级的分歧风险**：见仓库根契约审计 R2；需要真实样本对照证据后再动。
9. **周期复盘报告结构与 Skill 契约不同构**：已于 2026-08-14 用户拍板选项 A 并完成同构（六问一级标题、硬质量门、方向锚点五态检查）；月报深度（主主题归并、升级提醒指向复盘页方向校准）已于 2026-08-14 阶段 B 落地，快照 `desktop-periodic-review-v3`。

## 15. 性能与扩展性现状

数据规模假设：单用户、数千篇日志以内。日志/复盘的 Agent 检索使用元数据核对 + MiniSearch 增量内存索引，权威 Markdown 仍不变；真实 get、预览和生成仍全量复读目标材料。`npm run benchmark:memory` 在 2026-09-08 用同一合成数据和模拟源运行 5 次查询：冷路径是每次重建索引的五次合计，热路径包含首次建索引后四次查询的五次合计；100 条冷/热约 106.72/30.06ms、1,000 条约 781.32/310.07ms、5,000 条约 3,169.24/1,293.32ms。这里的热值不是一次磁盘热查询，解析计数同样是五次合计（冷 500/5,000/25,000，热 100/1,000/5,000）。5,000 条热查询期间观测到约 198.18ms 最大事件循环延迟，说明仍有主进程同步索引工作，但本轮不引入 Worker；后续若真实数据规模或卡顿证据超过该边界，再评估 Worker。该基准是本地实现前后的冷/热对照，不是历史版本发布承诺。

### 维护等待边界（v2.6.8）

Utility 从创建到 ready 默认最多等待 10 秒，启动超时会释放列表与维护排空等待。超时实例保留跟踪至真实 exit，迟到 ready 不会重新启用它，也不会创建第二个进程。维护入场前同步检查 running，排空后再次检查，避免等待工具时阻止正常取消。实现复用现有定时器/Promise 与协调器，没有新增依赖。
