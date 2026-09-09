# 交给另一个 AI 的执行提示词

复制以下全文到另一个窗口即可：

---

请直接实施知己桌面端 UI 优化，并完成相关验证，不要只写建议。用户指定的在用修改目录是：

`C:\Users\panda\.claude\skills\知己\apps\zhiji-desktop`

目标是“安静、清晰、有温度的中文写作工作台”。苹果味不是约束，由你依据写作、阅读和下一步行动的真实任务把握设计。优先信息层级、正文空间和操作可达性，不通过增加毛玻璃、大卡片或装饰动画证明改过。节省 token，不使用 leader skill，不全仓扫描、不并行探索多个风格、不重做本轮已经形成的方案。

先读取：

1. 目标及父级适用的 AGENTS.md/CLAUDE.md；两份相同时避免重复读取。
2. 根 `.claude/shared/ai-operating-principles.md`、`.claude/shared/contracts/first-principles-analysis.md`、`docs/development-governance.md`、`PROJECT_STATUS.md` 和 CHANGELOG 最近 5 条。根目录是 `C:\Users\panda\.claude\skills\知己`。
3. 桌面 `docs/2026-09-08-ui-design-review.md`：审查证据、设计规格与范围。
4. 桌面 `docs/2026-09-08-ui-design-plan.md`：按阶段 0→4 执行，这是执行主文档。
5. `C:\Users\panda\.codex\skills\impeccable\SKILL.md`，按其要求加载上下文，使用 Operate/Read 原则，UI 编辑前读 craft-floor；本方案与用户明确方向足以支撑实施，不重复询问苹果风或配色。PRODUCT/DESIGN 缺失时如所选流程需要，基于已确认产品事实和本方案补齐，不虚构用户偏好，也不扩展为产品需求访谈。

随后读取 `package.json`、`src/index.css`、`src/renderer/app/{app,app-shell,navigation}` 对应 TS/TSX 文件，页面、组件和测试只按阶段加载。先看 git status/diff；现有工作树有大量其他改动，保留它们。父级文档可能称 apps 为历史快照，但本次用户明确指定在此实施，不擅自切换独立仓库，不声称同步了独立仓库或安装版。

执行重点：日志元信息压缩为一行、正文与保存动作进入首屏；Agent 会话和消息区域去多层卡片、消息独立滚动且输入区留在底部；统一页头、中文排版和明暗色；复盘、记录、项目和设置沿用现有功能做一致化；修复 modal 焦点及窄窗口导航名称。保留未保存确认、取消、中文输入、previewToken/approvalId、隐私和备份恢复全部真实保护。

优先复用现有 React/CSS/组件和原生 dialog。只有具体交互问题证明需要时才按方案选择 Radix Dialog；不要为换皮迁移整套框架。不要增加自动保存、新首页逻辑或无关后端功能。

用户已补充授权：前端体验需要后端配合时一并处理。阅读 review 的“前后端联动范围”和 plan 的阶段 3B：B1 证据准确打开原记录纳入本轮；B2 列表摘要/按需详情只在性能测量证明必要时实施；B3 生成/审批状态返回页面恢复必须测试，失败才最小修复。后端优化已经做过，先复用当前原子写、维护协调、IPC 校验、增量检索和生成生命周期。按阶段 3B 指定文档了解范围，只读对应接口代码。若确需跨层变更，同步 schema/types、preload、Main、renderer 和契约测试，不停在新增未被使用的 API，也不把本轮扩成后端重构。

必须在隔离临时数据目录运行当前源码，使用合成日志/报告/会话，不读取真实密钥、不调用付费模型。`docs/ui-audit-2026-09-08/` 是旧的本地打包版参考截图，不是当前工作树逐文件一致的证明。按 plan 的窗口、主题、长内容、键盘和缩放矩阵截图实测。按改动运行相关单测，再完成 typecheck、lint、全量单测和一次带打包的 E2E；清楚记录真实模型 skip，不把离线验证当成真实 AI 流程通过。

一次批量视觉检查后集中修复，再确认一轮；达到完成条件就停止无关打磨。不要省略必要验证来省 token。按实际事实同步版本/CHANGELOG/状态，不默认提交、推送、发布或覆盖安装版。最终给出改动摘要、前后截图路径、测试结果和未完成项。
