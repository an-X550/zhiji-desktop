# UI 优化执行计划

状态：待实施。执行依据：[审查与设计方案](2026-09-08-ui-design-review.md)。实际修改目标是用户明确指定的 `apps/zhiji-desktop`，不转去另一个仓库。

## 0. 最小准备

- 查看适用 AGENTS/CLAUDE、根开发治理、git status/diff。当前工作树已有大量后端与测试改动，不能覆盖或打包提交无关内容。
- 读取 review 文档、`src/index.css`、`src/renderer/app/app-shell.tsx`、`app.tsx`、`navigation.ts`、`package.json`；其他文件按阶段读取。
- 复用现有 Electron Playwright 测试的临时 dataRoot/userDataRoot，重新构建当前源码后捕获原状。不可把本轮现存 asar 的参考图当成最新源码保证。
- 使用合成数据，覆盖空数据与有数据；不读取用户密钥、不调用付费模型。截图关闭入场动画。优先比较日志、Agent、设置三个代表页。
- 不新增路由、自动保存、知识库、富文本编辑器或后台任务；先保留当前 app 默认入口。

## 1. 样式基础与高频日志页（最高收益）

文件：`src/index.css`、`app/app-shell.tsx`、`components/page-header.tsx`、`button.tsx`、`field.tsx`、`pages/today-page.tsx`。

操作：统一语义 token、减少普通卡片投影、合并重复页头；品牌降级、设置放侧栏底部；主导航文字可读；日志元信息横排、编辑器扩宽、右侧统计下移、保存操作条始终可达。移除相关 inline style，以局部类名管理。不要只在 CSS 文件尾部不断叠覆盖，也不顺手拆出大型组件库。

验收：1186×718 CSS px 下，无 API key 的日志首屏同时可见至少约 240px 高正文输入和主要保存动作；日期/项目/模板均可键盘到达。已配置 AI 时“仅保存”和“生成反馈”维持现有正确调用。离开未保存日志仍确认；不声称自动保存。暗色无白色漏底。

## 2. Agent 与阅读布局

文件：`pages/agent-page.tsx`、`pages/history-page.tsx`、`features/history/history-reader.tsx`、`components/markdown-document.tsx` 与对应 CSS。

操作：平整会话栏；容器使用明确 flex/grid 高度、min-height:0 和限定 overflow；消息可滚动，输入区不随历史流出窗口；工具活动可折叠，待确认审批独立突出。历史正文最大宽度、表格局部横滚、长 URL 折行。保留 Enter/Shift+Enter 与中文 composition 行为。

验收：50 条合成消息和一篇长报告下输入区可见，滚动历史不会被新 token 强行拉回；取消、会话切换、证据展开、确认并继续可用；审批失败能恢复，未确认不生成正式产物。使用离线 mock 测试这些状态，不靠真实模型。

## 3. 低频页面一致化

文件：`pages/start-page.tsx`、`reviews-page.tsx`、`projects-page.tsx`、`settings-page.tsx`、`features/reviews/` 及相关 CSS。

操作：开始页保留下一步判断、缩短宣传内容；复盘类型采用紧凑选择和单一配置区；记录/项目平整列表；设置三标签不重构，只压缩行距和重复说明；错误提示在操作附近。

验收：开始页导航意图正确；周/月/项目复盘仍先预览；高级洞察可访问；设置服务商、测试连接、隐私同意、备份恢复及迁移入口完整。按钮改布局不改变业务语义。

## 3B. 前后端联动（穿插在对应页面阶段）

依据 review 的 B1–B3，用户已允许处理必要后端配合；不因涉及 Main 就停止。但先检查当前实现，后端既有优化不重复实施。

准备按需读取：`docs/2026-09-07-backend-optimization-design.md` 的范围与选型、`docs/2026-09-08-backend-optimization-quality-report.md` 的结论/限制，`src/renderer/hooks/use-app-data.ts`、`src/preload.ts`、`src/shared/schemas/agent.ts`、`agent-tools.ts` 和实际 IPC 契约。只有触及生命周期再读维护补修设计，不全读后端历史。

- **B1 必做，随阶段 2**：新增 renderer 精确记录意图，把已校验证据 hit.id 传至对应历史阅读器。检查现有详情 API，缺失错误语义才最小补后端。测试第二条证据精准选中、复盘进入历史、记录已删、非法 ID、未保存日志拦截；不得静默回退第一条记录。
- **B2 先测，证据触发**：用 review 指定合成规模分解读取/IPC/React 耗时。在同一设备记录 5 次热操作和单次冷启动；可把搜索响应超过 200ms 或列表明显卡顿作为调查起点，而非跨机器绝对性能承诺。前端问题先局部刷新/分页；只有读取传输主导才落实摘要/详情接口。写下触发证据与选型后直接实施已授权范围，不新造审批流程。若没有瓶颈，报告测量结果并明确不加接口。
- **B3 必测，失败才改**：运行中/待审批离页返回，检查阶段、取消、审批卡及既有 approvalId。优先提升 renderer 状态，再考虑 Main 只读快照；覆盖 stale/取消/完成竞态，失败不能重放正式写入。

涉及接口变更时，同步 shared schema/types、preload、register-handlers、Main 用例和 renderer，保留 IPC 来源校验、维护阻断、数据目录隔离；新增契约测试覆盖非法参数、无效游标/ID、删除后详情、跨页全文搜索与统计正确性。只读快照测试审批过期与取消；不要重复改写原子写/搜索索引/生成引擎。

## 4. 键盘、边界与必要验证

文件：`components/modal.tsx`、`confirm-dialog.tsx`、设置/页面 tabs、相关测试。

先验证并优先使用原生 `<dialog>.showModal()` 实现 modal；管理关闭后焦点恢复、初始焦点、Escape、点击背景、嵌套层级、短窗口内部滚动。保留 ConfirmDialog 的 loading 语义；异步不可取消操作不因换组件获得退出后门。原生方案出现具体无法解决的兼容问题时，才选 Radix Dialog 并说明事实与新增成本。

必须验证：Tab 不穿透模态、关闭后焦点回到触发元素、危险确认默认焦点安全；设置 tabs 方向键与选中 panel 关联；紧凑导航拥有可访问名称；普通文本对比度至少 4.5:1，大文本及必要控件/焦点边界至少 3:1，状态不只靠颜色。

测试顺序（cwd 为桌面目录）：

1. 按改动运行相关 `npx vitest run tests/unit/...`，重点保留现有行为断言；新增测试只覆盖焦点、滚动/输入、业务确认等真实风险，不为圆角/颜色写实现镜像测试。
2. `npm run typecheck`、`npm run lint`；全部页面完成后跑一次 `npm test`。
3. `npm run test:e2e` 自带 `pretest:e2e` 打包，避免先单独 package 再重复打包。真实 API 测试缺配置时保持 skip，报告中说明。纯 UI 不运行安装器 make 或发布。
4. 一轮批量视觉检查：1186×718、1440×900、960×640 CSS px；明/暗、空/长内容；另测 125%/150% 缩放与 reduced motion。实际窗口最小尺寸以 bootstrap 当前配置为准，若不同需记录对应尺寸，不为拍截图偷偷修改生产限制。
5. 批量修复发现的问题，最多再一轮视觉确认；功能阻塞缺陷继续修复，常规检查通过后停止可选抛光。

## 最终交付

- 改后截图至少包含日志、Agent、复盘、设置及记录阅读，明暗主题均有代表；标明源码版本/工作树、视口、合成数据状态。
- 写简短质量记录：前后变化、实际命令结果、未测项、剩余问题；分别报告离线 UI 与真实模型验证。
- 依根治理按实际行为变化处理版本、CHANGELOG 和 PROJECT_STATUS；当前计划本身不表示实现完成，不提前改发布状态。不修改两份 AGENTS/CLAUDE。
- 不默认 commit/push/tag/release，也不安装覆盖用户正在用的程序。只清理本次创建的临时进程和明确路径的测试数据。

相对工作量：阶段 1、2 为中等，阶段 3 为中等，阶段 4 为小到中等；主要成本在交互回归而非配色。若预算受限，先完整完成 1+2 的相关验证并明确余项，不能把部分优化写成全部完成。
