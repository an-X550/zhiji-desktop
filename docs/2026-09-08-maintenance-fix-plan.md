---
created: 2026-09-08
status: completed-with-limitations
---

# 验收补修执行计划

> 当前补充验收：v2.6.8 已补齐第二轮发现的启动无界等待、running 检查晚于 draining 两处缺口。原 v2.6.7 执行记录保留为历史结果，新增验证见文末。

依据[补修方案](2026-09-08-maintenance-fix-design.md)。路径默认相对桌面端目录。本计划取代旧 P0–P6 中维护生命周期“已完成”的当前验收判断，其他已通过优化不重做。

## S0：读取与确认范围

- [x] 阅读根 AGENTS、AI 运行原则、开发治理、VERSION/PROJECT_STATUS 和 CHANGELOG 最近五条；再读本方案、本计划。
- [x] 核对 git 根、status 和相关文件 diff，保护用户当前未提交修改，尤其 `dsh-runtime.ts` persona。
- [x] 阅读 `src/main-process/agent/electron-agent-runtime.ts`、`agent-facade.ts`、`infrastructure/lifecycle/maintenance-coordinator.ts`；定向读取 DSH command/shutdown、bootstrap 和 IPC 的维护调用点。
- [x] 复用官方 Electron/Node 接口，默认不加 npm 依赖。未调用 leader skill，未另克隆仓库，未重新调研架构。

## S1：先建立能暴露问题的回归

复用 `tests/unit/agent-facade.test.ts`、`maintenance-coordinator.test.ts`、`tests/integration/data-root-holder.test.ts`；runtime 事件测试可新增一个文件。测试断言应指向修复后的行为，先确认旧代码失败。

- [x] running 回合，send 命令已确认且 activeOperationCount 为零：维护拒绝，不调用 stop、copy 或配置修改，之后 cancel 仍能用。
- [x] 维护回调暂停在可控 Promise：调用 list 返回快照，start/request 计数不增长；confirm/start/send 同样不能绕过入口。
- [x] shutdown 拒绝、kill=false、未发 exit：维护必须 reject，copy/config.patch 为零。

## S2：严格停机

主要文件：`electron-agent-runtime.ts`、`agent-facade.ts` 的 runtime port；必要时调整 Utility 的正常退出衔接，保留 DSH 业务语义。

- [x] 增加维护专用严格模式，和退出时尽力清理分开；禁止 stop 内部通过 request 意外拉起进程。
- [x] 先绑定同实例 exit 等待，再发送 shutdown；只有完成确认和 exit 都满足才成功。
- [x] 有限超时、pending 清理、并发 stop 合并；失败不丢失仍存活实例的跟踪。
- [x] error 不冒充 exit；旧实例迟到事件不破坏新实例状态。
- [x] 检查 `src/main.ts` 调用方的异常处理，未引入未处理 Promise 拒绝；只做严格模式带来的必要适配，未重写退出 UX。

必测：正常 ack→exit、ack 后 kill→exit、无 child、尚未 spawn、command.failed、等待超时、error 后延迟 exit、ack 前异常退出、重复 stop、kill=false 且无 exit、迟到旧 exit。使用事件/可控 Promise/fake timers，不长时间睡眠。

## S3：入场规则与失败恢复

主要文件：`maintenance-coordinator.ts`、`agent-facade.ts`；按需修改 bootstrap/IPC 的连接。

- [x] 关闭新操作入口前同步检查 running，并在已入场操作排空后再次检查；忙碌则释放状态，允许用户正常取消。
- [x] 维护中的 list/get 无 runtime 副作用；所有隐式启动入口受控，在途 list/start 也被排空。
- [x] 维护完成后的内部恢复不被自身 guard 拦住，不向外部提前开放 idle。
- [x] 停机不确定时不复制、不改配置、不启动第二个进程；已安全停机但复制失败时可恢复原目录工作。
- [x] 成功迁移保持等待重启只读；成功导出后恢复正常；恢复失败保持明确失败/只读边界。

必测：send 与维护入场交错、pending list/start 与维护交错、运行中取消后再维护、复制失败后恢复、停机中途失败、resume 失败、迁移成功后 list 不重启旧路径、重复维护。

## S4：验收与交付

- [x] 定向测试通过后跑一次 `npm test`、`npm run typecheck`、`npm run lint`；仅因新改动/失败重跑。
- [x] 复用现有 E2E 和临时数据，覆盖真实打包 Utility 的无密钥启动/列表/严格停机，以及维护期间刷新列表。运行 `npm run test:e2e` 前检查 scripts，其 pretest 已 package，避免重复打包。
- [x] 无安装逻辑/Forge/依赖变化时不要求 Squirrel make；如确需增加，写明具体理由。不能将旧 RC 当作补修产物。
- [x] 更新 `docs/architecture.md` 的生命周期段落、上一轮执行计划及质量报告当前验收说明；保留历史结果并修正检索统计口径，不扩展文档清理。
- [x] 依根治理记录实际产品修复的版本/状态/CHANGELOG；不预先指定下一版本，不每步升版本、不声称安装版已升级。
- [x] 更新本计划下面的执行记录，交付实际结果、剩余限制和是否有新打包产物；不 commit/push/tag/release。

## 第二轮补修验证（2026-09-08，v2.6.8）

- [x] 启动超时覆盖 spawn/ready 全过程，默认 10 秒，测试可注入短时限；列表与严格维护等待随失败释放，迟到 ready 不复活超时实例，也不重复 fork。
- [x] running 在维护入场前同步检查，排空后再次检查；已运行工具不会使拒绝维护之前的 draining 阻塞取消。
- [x] 新增四项回归，覆盖启动/停机超时、列表排空、工具在途取消和 send 入场竞态；原始两个复现先失败后通过。
- [x] 完整测试 60 files / 387 tests、typecheck、lint（0 errors / 8 个既有 warnings）、package + E2E（6 passed / 2 skipped）通过。无新依赖，未 make/安装/真实模型调用/提交/发布。

## 完成标准

三个验收缺陷均有防回归证据；维护成功前已确认无 Utility 写入者且不会被列表重新启动；忙碌回合不会被维护静默取消；失败有清晰可恢复状态。其他此前通过的架构优化保留，Worker/模型 A/B 等暂缓事项不算欠账。

遇到代码事实变化，调整最小实现并说明证据；不以缺真实模型、代码签名、安装矩阵为理由停止离线补修。测试只能用临时合成数据，不触碰个人日记或密钥。

## 执行记录（2026-09-08，S0–S4）

- **S0**：完成。Git 根为知己主仓库；保留所有既有未提交修改，未 reset、未 `git add .`，`dsh-runtime.ts` 只保留原 persona 改动；无依赖新增、无仓库迁移、未使用 leader skill。
- **S1**：先加入三条反向回归断言并在旧代码上运行，分别复现 running 回合仍会继续维护、维护中的 list 会启动/request Utility、shutdown failure 仍会进入维护。修复后断言已通过。
- **S2**：`ElectronAgentRuntime.stopForMaintenance()` 使用同实例事件闭环：`command.completed` 后再 kill，并等待真实 `exit`；shutdown timeout、exit timeout、kill=false、error/exit、启动中停机、并发 stop 和迟到旧实例事件均有 fake EventEmitter 回归。普通 `stop()` 保留有界尽力清理，维护不再误用。
- **S3**：`MaintenanceCoordinator.runRead()` 排空正常 list；维护/只读等待期间 `AgentFacade.list()` 返回内存快照，start/send/delete/confirm 在任何启动、请求或 approval 修改前拒绝；running session 在严格停机前拒绝维护，cancel 在维护失败释放后仍可用；复制失败走内部恢复路径。
- **S4**：完成。`npm test` 通过 60 个测试文件 / 383 个测试；`npm run typecheck` 通过；`npm run lint` 为 0 errors / 8 warnings（均为既有告警）。`npm run test:e2e` 在前置 package 后通过 6 项、跳过 2 项（跳过项需要显式真实模型凭据），覆盖无密钥 packaged-asar 启动、列表快照、严格维护停机、维护期间只读刷新及既有桌面端冒烟。
- **交付边界**：本轮仅生成并验证本地 `out/知己-win32-x64/知己.exe` packaged-asar；未执行 `npm run make`、安装/升级/卸载、OS 级 SIGKILL/Electron 崩溃、真实模型或远程发布。`v2.6.6` Squirrel RC 保留为历史制品且不包含本轮修复；当前源码版本为 `v2.6.7`，没有声称安装版已升级。
- **最终状态**：三项验收缺陷均有回归证据，计划完成但保留上述外部验收限制。
