# 另一窗口执行提示词

复制下面整个代码块给执行 AI：

```text
请实施知己桌面端“验收补修”，完成代码、验证与相关文档同步，不要只给计划，不要使用 leader skill。

我明确指定的实施目录：
C:\Users\panda\.claude\skills\知己\apps\zhiji-desktop
以这里的当前代码和未提交修改为准。不要因为旧文档称其为快照而另找独立仓库，Git 根可能是上层知己目录。

先按顺序用 UTF-8 阅读：
1. C:\Users\panda\.claude\skills\知己\AGENTS.md
2. C:\Users\panda\.claude\skills\知己\.claude\shared\ai-operating-principles.md
3. C:\Users\panda\.claude\skills\知己\docs\development-governance.md
4. 根 VERSION、PROJECT_STATUS.md、CHANGELOG.md 最近五条，只读必要内容。
5. C:\Users\panda\.claude\skills\知己\apps\zhiji-desktop\docs\2026-09-08-maintenance-fix-design.md
6. C:\Users\panda\.claude\skills\知己\apps\zhiji-desktop\docs\2026-09-08-maintenance-fix-plan.md

第 5 个是方案，第 6 个是要逐项执行的 S0–S4 计划。只按阶段读取关联源码和桌面 docs/architecture.md；涉及打包再读 docs/install-package-distribute.md。此前 backend-optimization 的 P0–P6 已实施，本轮不要重做；旧记录声称“仅剩外部验收”已被新验收推翻，以本补修方案及当前代码为准。

本轮只修三个问题：
1. Utility shutdown 失败或无法确认 exit 时，必须阻止复制/恢复，不能 kill 后无条件报成功。
2. 维护及等待重启期间，list/ensureStarted/confirm 等入口不得重新启动 Utility；正常恢复走明确内部路径。
3. 有 running Agent 回合时拒绝开始维护，让用户先完成或正常取消，不自动结束回合。

优先复用现有 MaintenanceCoordinator、AgentFacade、DSH shutdown、Electron UtilityProcess 事件和 Vitest。官方资源及边界已写入方案，无需广泛搜索或新引入进程管理库。注意 error 不等于 exit，kill=true 不等于持久化完成，命令确认不等于模型回合完成。覆盖超时、迟到旧进程事件、并发入口和失败恢复，不只测试正常路径。

授权本范围内的本地实现、回归测试和必要打包应用 E2E，无需再次确认方案。先检查 git status/diff，保留所有无关修改及 dsh-runtime.ts persona。不得 reset、整文件覆盖、git add .；不 commit、push、tag、发布，不安装到系统，不迁移真实用户数据，不读个人 API Key 或调用付费模型。

以性价比优先：不做检索 Worker、数据库/向量库、DSH 替换、全面模型 A/B、自动重启按钮或通用调度器。本轮无安装/Forge/依赖变化时不重复 make Squirrel；必要打包 E2E 仍要做，旧 RC 不代表新修复已打包。不要把旧基准中五次查询合计误写成单次磁盘热查询。

先把三个复现写成修复后行为的回归断言，确认旧代码暴露问题，再实施。按 S0–S4 持续推进并更新计划状态，阶段定向测试、最终一次完整回归；不要为省 token 跳过关键竞态验证。短报进展，不复述整份方案。

完成后给出：三个缺陷的修复证据、测试和打包结果、修改文档、实际版本/产物状态、剩余限制。只阻塞缺少外部条件的部分，继续独立可完成工作；不得把尝试或 skip 称为全部完成，不声称安装版或其他仓库已同步。
```
