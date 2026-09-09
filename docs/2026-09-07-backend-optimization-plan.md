---
created: 2026-09-07
status: completed-with-limitations
---

# 桌面后端优化执行计划

设计依据：[后端优化方案](2026-09-07-backend-optimization-design.md)。路径除明确注明外，均相对 `apps/zhiji-desktop`。每步完成时把待办改为完成并附实际证据；不要预填测试结果。

## P0：最小上下文与现状核对

- [x] 读取根 `AGENTS.md`、`.claude/shared/ai-operating-principles.md`、`docs/development-governance.md`、`VERSION`、`PROJECT_STATUS.md` 和 CHANGELOG 最近五条，再读本方案与本计划。旧架构文档只按相关章节读取。
- [x] 在用户指定目录核对 `git rev-parse --show-toplevel`、`git status --short`、已有 diff 和 package scripts。Git 根是知己主仓库；保护了原有 `dsh-runtime.ts` 等修改，没有 reset 或全量 add。
- [x] 核对方案列出的风险；已修复项以代码和测试标记，未把未执行的强杀/真实模型质量写成已完成。
- [x] 选择并验证 `write-file-atomic@6.0.0` 的 Electron/Node 兼容性、类型和打包保留方式，并用临时目录完成替换成功/失败验证。
- [x] 先跑受影响测试，再完成全量测试；未新增 baseline 文件、hash 清单或质量平台。

## P1：可靠写入和旧残留恢复

主要文件：`infrastructure/markdown/atomic-write.ts`、`journal-repository.ts`、`path-policy.ts`（均在 `src/main-process` 下）、`bootstrap.ts`、`src/main.ts`、`package.json` 与 lockfile。

- [x] 接入方案 A 的成熟替换适配层，保留提交前校验、失败原文和路径限制；read-modify-write 继续保留 `expectedUpdatedAt`。
- [x] 日志改日期保持文件定位稳定，以 frontmatter 日期为业务日期；未批量重命名历史文件。
- [x] 实现有限旧 `.bak` / `.moving` 恢复，歧义时保留材料并报告恢复边界。
- [x] 增加单实例入口，兼容 Squirrel 启动处理、第二实例聚焦与已有窗口生命周期。
- [x] 用临时目录和子进程测试：首次写、覆盖、校验拒绝、替换失败、发布前/后强制退出、恢复候选冲突、跨年改日期、并发 update/delete。强制退出在校验后/发布后两个确定阶段触发；测试辅助回调只存在于代码注入参数，不开放为产品环境变量后门。

完成条件：支持范围内正式文件保持完整旧版或新版，不能出现正常替换留下的缺位；失败不删除唯一恢复材料；旧合法数据可读，业务并发冲突不会静默覆盖。

## P2：维护状态与迁移闭环

主要文件：`bootstrap.ts`、`infrastructure/data-directory/data-root-holder.ts`、`infrastructure/transfer/data-transfer-service.ts`、`application/` 写入用例、`agent/agent-facade.ts`、`agent/electron-agent-runtime.ts`、`ipc/register-handlers.ts`、`src/main.ts`、`src/renderer/pages/settings-page.tsx`；涉及 IPC 时同步 shared schema/API/preload。

- [x] 做小型维护协调器，覆盖 Main 与 Agent 工具请求的写入入口，处理在途操作和失败释放。
- [x] 活跃生成/会话和未保存草稿通过维护态与既有确认边界阻断新的写入；复制前等待已登记操作排空。
- [x] Utility shutdown 使用完成确认后再继续；维护失败保持可恢复/只读边界。
- [x] 迁移检查真实路径、目标为空及不在源内；先复制/验证再改配置，旧目录保留。
- [x] 成功后保持不可写并要求重启；恢复复用空目录限制；导出继续由维护边界保护。
- [x] 测试生成中迁移、复制时新写入、Agent JSONL 写入、配置更新失败、复制失败、目标子目录/junction、重启后读取新增目录、导出恢复一致性以及失败后可继续工作。全部使用临时数据，不自动安装或迁移用户资料；真实安装版/跨进程 Windows 生命周期仍单列为外部验收边界。

完成条件：没有“迁移成功后继续写旧目录”的入口；不会把正在变化的 Agent 会话当成稳定备份；失败不切错路径、不丢草稿、不永久锁死应用。

## P3：IPC 来源校验

- [x] `register-handlers.ts` 集中包装来源校验；window/frame/URL 由应用登记，生产和开发规则分开。
- [x] `src/main.ts` 限制导航；保留旧安全选项；Agent 订阅同样校验。
- [x] 测试合法调用、未知窗口、子 frame、伪造相似 URL、窗口销毁、页面导航；打包 E2E 确认合法页面仍可保存和读取。

完成条件：无来源校验的业务 handler 不再暴露，非法来源不能注册事件订阅；不损坏开发启动或生产页面。

## P4：检索缓存

主要文件：`agent/agent-memory-search-service.ts`、相关 repository、`bootstrap.ts`，不要将索引加入备份权威数据。

- [x] 用合成中文数据记录冷/热耗时、解析值和事件循环延迟，保存同一脚本供改后复跑。
- [x] 复用 MiniSearch 增量操作、文件路径缓存和元数据核对；写后失效、删除失效、恢复清空；合并并发构建。
- [x] 补齐独立回归：重复 id（来源内与跨来源）、损坏文件、不同 dataRoot 隔离和显式 rebuild；现有排序、中文复合词、冲突、修改/删除、未变化缓存和并发构建继续覆盖。
- [x] 复跑 100/1,000/5,000 篇相同数据并记录结果；5,000 条仍有主进程事件循环延迟，暂无真实卡顿证据支持增加 Worker。

完成条件：正确性不降低；未变数据热搜索不再全库 read/parse/addAll；真实 get 和预览确认继续核验原文。

## P5：AI 编排与输出统一

主要文件：`skill-runtime/daily-runtime.ts`、`periodic-runtime.ts`、`infrastructure/ai/provider-port.ts`、`openai-compatible-provider.ts`，按需更新 shared errors、审计记录、package/lockfile。

- [x] 先以现有用例锁定业务行为，再将两个图改成显式 async 分支；保留 D 级复核、AbortSignal、质量门和渲染。
- [x] 全量搜索确认 LangGraph/LangChain 不再是桌面端运行依赖并移除；DSH 不动。
- [x] 抽取结构化生成函数，接入日反馈与周期复盘；预算分别设置；限制结构重试次数。
- [x] 扩展可选 usage 与最小诊断字段；不支持 usage 时为 `null`。
- [x] 测试空、截断、非法 JSON、缺字段、非结构错误、取消发生在两次请求间、第二次仍失败、不写半成品；验证周期完整六问输出未被小预算破坏。

完成条件：关键业务输出与原逻辑一致；周期复盘具有日反馈同等级的结构失败恢复；最多一次重试；依赖变少或保留理由明确。

## P6：交付验收与文档

- [x] 按方案 F 补齐离线样例；真实模型 A/B 因缺少显式配置/预算标记未运行，没有读取私有密钥。
- [x] 全部改动完成后运行 `npm test`、`npm run typecheck`、`npm run lint`；结果见执行记录。
- [x] 运行 `npm run test:e2e`，其 pretest 已执行 package；5 passed / 2 skipped。安装版真实 Agent 的创建/resume/取消/shutdown 仍需显式安装版与凭据验收，未伪称通过。
- [x] 改变 Forge/package 生产依赖后在纯 ASCII 物理副本运行 `npm run make` 并检查产物；退出 0，未自动安装、push、tag 或 release。
- [x] 更新 `docs/architecture.md` 的写入、目录迁移、IPC、索引、编排和测试日期；保留历史测试结果的时间属性。
- [x] 按根开发治理同步版本、状态和 CHANGELOG；版本为实际产品代码兼容性变化后的 `2.6.6`，没有因阶段机械升版。
- [x] 在本文件底部填写交付记录；不含密钥或用户日志。

## 故障与回退规则

阶段性验证失败先修；遇到确实缺少的外部条件仅阻塞依赖部分，其余继续。实现选择允许调整，但必须写明代码/实测证据及对结果的影响，不重开无必要方案讨论。

缓存可退回原始读取路径，编排可按本次 diff 精确回退；数据可靠性失败不能把旧危险路径称为可接受降级。不得用 `git reset --hard`、覆盖工作区或恢复整个文件抹掉用户修改。没有授权不提交/推送。

## 执行记录（2026-09-08）

- **P0**：完成。核对根目录、既有工作区改动、运行脚本、依赖选型与方案风险；未 reset、未全量 add，保留既有 `dsh-runtime.ts` persona 改动。
- **P1**：完成。原子写单元测试已覆盖验证拒绝、替换失败和发布前/后子进程强制退出；仓储测试覆盖恢复候选冲突、跨年日期、并发 update/delete；退出阶段由 `tests/fixtures/atomic-write-crash.ts` 明确注入，不依赖随机等待。
- **P2**：完成本地离线核心矩阵。维护协调、Agent tool 写入计数、生成/复制期间新写入阻断、迁移路径/空目录/源内/junction 检查、复制验证、配置/复制失败释放、成功只读、备份恢复和 DSH JSONL 重启读取均有临时目录或 fake runtime 证据；真实安装版与跨进程 Windows 生命周期仍需外部验收。
- **P3**：统一 IPC 来源 guard、导航限制和单元测试完成；打包 E2E 通过合法保存/读取冒烟。
- **P4**：完成。MiniSearch 增量缓存与基准保持不变；重复 ID 现在在索引变更前以 `FILE_CONFLICT` 拒绝，损坏文件错误不被部分索引吞掉，且已覆盖隔离与显式 rebuild。100/1,000/5,000 条冷/热结果仍见质量报告；5,000 条同步事件循环延迟未凭猜测引入 Worker。
- **P5**：显式 async 编排、`collectValidated` 单次结构重试、周期预算、usage 保留和取消边界完成；定向与全量自动化测试通过。
- **P6**：最终 `npm test` 59 files / 371 tests、`npm run typecheck`、`npm run lint`（0 errors / 8 warnings）、`npm run test:e2e`（5 passed / 2 skipped）通过。随后在纯 ASCII 物理副本再次运行 `npm run make` 并由 Forge 成功退出 0；Squirrel 原生安装器文件名为 `知己-2.6.6 Setup.exe`，本地 RC 三件套已从该次成功构建刷新，nupkg/RELEASES/安装器元数据均为 2.6.6。未安装、未 push/tag/release；任务创建的 ASCII 临时副本已清理。

### 补充验收状态（2026-09-08）

P0–P6 的历史结果与日期保留不变，但 P2 中“Utility shutdown 使用完成确认后即可维护”的离线结论被本轮新验收的三个竞态复现收窄：此前只证明正常路径和协调器边界，不足以证明 shutdown failure、迟到 exit 与 running Agent 回合的安全语义。补修已在 `v2.6.7` 本地源码中完成：严格维护停机、维护态 Agent 入口隔离和 running session 拒绝维护分别由 `electron-agent-runtime.ts`、`agent-facade.ts` 与 `maintenance-coordinator.ts` 实现；正式证据见 `apps/zhiji-desktop/docs/2026-09-08-maintenance-fix-plan.md` 与补充质量记录。v2.6.6 Squirrel RC 不包含补修；本轮不重复 `make`，也未安装或发布。

### 变更路径

- 写入与恢复：`src/main-process/infrastructure/markdown/atomic-write.ts`、`journal-repository.ts`、`src/main.ts`。
- 维护与迁移：`src/main-process/infrastructure/lifecycle/maintenance-coordinator.ts`、`data-directory/data-root-holder.ts`、`agent/agent-facade.ts`、`bootstrap.ts`。
- IPC 与检索：`ipc/ipc-source-guard.ts`、`agent/agent-memory-search-service.ts`、`infrastructure/markdown/search-entries.ts`。
- 编排与模型：`skill-runtime/collect-validated.ts`、`daily-runtime.ts`、`periodic-runtime.ts`、`infrastructure/ai/openai-compatible-provider.ts`。
- 验证与说明：新增/扩展 `tests/`、`scripts/benchmark-memory-search.ts`、本计划、质量记录、架构和安装文档；`write-file-atomic@6.0.0`、`minisearch@7.2.0` 保持明确锁定。
