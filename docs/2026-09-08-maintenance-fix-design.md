---
created: 2026-09-08
status: implemented-with-limitations
---

# 验收补修方案：Agent 与数据维护生命周期

## 目标与范围

只修复本轮验收确认的三个缺陷，不重新执行上一轮 P0–P6 架构优化。实施目录由用户明确指定为 `C:\Users\panda\.claude\skills\知己\apps\zhiji-desktop`，不切换独立仓库。

相关[执行计划](2026-09-08-maintenance-fix-plan.md)与[交接提示词](2026-09-08-maintenance-fix-prompt.md)。用户在另一窗口提交执行提示词即授权本地实施，不再机械审批一次方案。

2026-09-08 验收重跑 9 文件 / 73 项测试通过，但三个临时探针分别复现了以下行为；探针已清理，实施时需转成正式回归测试。它们使用 fake runtime/进程对象证明调用边界问题，不冒充实际 OS 强杀或断电测试。

| 缺陷 | 当前证据 | 最小修复 |
|---|---|---|
| P1 停机失败却继续维护 | `ElectronAgentRuntime.stop()` 吞 shutdown 异常，不检查 kill 结果，不等待 exit；shutdown 拒绝且 kill=false 时仍 resolve | 增加维护专用严格停机语义，失败不执行复制/恢复 |
| P1 维护期间重启 Utility | `AgentFacade.list()` 无维护校验，调用 ensureStarted；停机后的复制回调内调用 list 可再次 start | 阻止所有外部启动/请求入口，list 返回已有快照 |
| P2 运行回合被维护中断 | session.send 确认的是命令接收，DSH followup 后继续异步生成；协调器计数已归零 | 使用已有 session running 状态拒绝维护，先完成或由用户正常取消 |

暂缓：检索 Worker、数据库/向量库、DSH 替换、全面模型 A/B、自动重启按钮、通用调度器、额外框架和批量依赖升级。这些不阻塞本次验收。建议工作量约 1–3 人日，包含事件竞态测试；不是 AI 用时承诺。

## 1. 成熟资源与取舍

优先复用现有 `MaintenanceCoordinator`、`AgentFacade`、DSH `runtime.shutdown → dispose → command.completed`、Electron UtilityProcess 和 Vitest。

- [Electron UtilityProcess 官方文档](https://www.electronjs.org/docs/latest/api/utility-process)：kill 返回布尔值，exit 表示进程已结束；error 与 exit 是不同事件。用实例事件确认进程生命周期，不靠固定 sleep 猜测。
- [Node events.once](https://nodejs.org/api/events.html#eventsonceemitter-name-options)：可用于一次性事件等待；也可直接用实例 once/on 配合 Promise，依实现简洁程度选择。必须提前订阅并清理监听器/定时器。
- DSH 生命周期以当前已安装版本和 `src/main-process/agent/dsh-runtime.ts` 为准，不升级 SDK，不自建会话存储或退出协议框架。

资源已于 2026-09-08 核对。无需搜索新的 GitHub 进程管理库；现有原生接口已能解决问题，第三方依赖反而增加打包与维护负担。

## 2. 严格停机与失败处理

在现有 runtime port 增加明确的维护停机方法或目的参数，名称由实施者选择。普通应用退出可以保持有边界的尽力清理，但不能被维护调用误用。

严格停机顺序：

1. 固定本次 child/port 实例；标记 stopping，阻止并发 start/request 创建第二个进程。并发 stop 复用同一个在途 Promise。
2. 在发送 shutdown 前订阅这个 child 的 exit。发送 shutdown 不能调用会隐式 start 的通用 request 路径；无 child 时不应为了关闭而启动一个 child。
3. 等待匹配 requestId 的 command.completed，证明 DSH dispose 已完成；runtime.stopped、kill=true、pid 暂时 undefined 都不能单独替代该条件。正常创建/启动中的实例也要有明确处理，不把“尚未 spawn”误判为“已退出”。
4. 收到完成确认后，允许沿现有方式结束进程外壳；若还未退出，调用 kill 并核对返回结果，同时等待真实 exit。kill=false 但 exit 已被记录可按已退出处理；否则失败。
5. shutdown 与 exit 等待有有限超时，例如分别 10 秒，可在构造选项注入测试值。只约束此次停机，不趁机重构所有 RPC 超时。超时清理对应 pending/监听器/定时器，迟到事件不能让失败操作再次成功。
6. 仅在同一实例收到 shutdown 完成并确认退出后，允许执行本次维护任务。维护中途崩溃、shutdown 拒绝、超时、kill 失败，均拒绝这次维护；不能先强杀再宣称已经安全落盘。

无实例且未启动时，停机可直接成功。维护开始前已退出的实例，按既有异常退出恢复逻辑处理；不能把本次等待中的异常退出洗成安全 shutdown。

必须修正与本问题直接相关的事件竞态：当前 `error` 和 `exit` 共用无实例参数的 handleExit，error 不一定表示进程已退出；旧 child 的迟到 exit 也不能清掉新 child 的 port/startup/pending。用捕获的实例引用核对归属即可，不增加持久化代次号或复杂 supervisor。

失败状态不靠 catch 一律恢复 idle：

- 业务忙碌、尚未发出 shutdown：释放维护态，用户可继续或取消当前回合。
- 已完整停机，但复制/校验失败：保持原配置，走受控恢复，成功后可正常工作。
- shutdown 部分完成或进程是否存活不明确：保留实例跟踪，不启动第二个 Utility；本次复制回调不得执行。应用显示“维护未开始，请重启后重试”等明确状态，可复用只读状态，不需新增复杂状态机。
- 导出或恢复后重启 Utility 失败：不得仅 console.error 后向 UI 宣称全部正常；明确数据操作是否完成以及应用需要重启。迁移成功本来就保持只读等待重启。

## 3. 维护期间的入口控制

维护态至少覆盖 draining、实际复制/恢复/导出、等待重启。复用现有协调器的状态，不只检查 isReadOnly，也不只禁设置页按钮。

- `list/get`：返回已有 Main 会话快照；维护期间不得触发 ensureStarted、runtime.request 或磁盘会话刷新。冷缓存为空可以返回空快照或明确维护提示，不因此启动进程。
- `start/send/delete/confirm`：在任何 ensureStarted、批准记录修改或 runtime 请求之前拒绝。confirm 不能先建立 approval 再发现维护态。
- `ensureStarted` 和 runtime 的 stopping 状态提供内部兜底。按需核对 model.request、list、cancel 等侧路，不漏掉隐式启动。
- 已经进入的正常 list/启动请求要纳入协调器排空范围；不能只是函数开头检查一次，再 await 后跨进维护。可复用现有 runWrite 计数作“在途 runtime 操作”登记，但不在嵌套方法中重复拿锁或重复检查导致竞态失败。
- 正常维护结束需要恢复时，走明确的内部受控恢复方法。不要为恢复先全局改成 idle 再 await start，给用户操作留下窗口；也不要让公共 ensureStarted 的维护拒绝拦住合法内部恢复。

目标是保持现有小型结构。无需为所有函数加不同布尔开关；通过外部入口与内部不重复入场的方法区分即可。

## 4. 运行中回合的低成本策略

默认拒绝有 running 会话时开始迁移、恢复或导出，不自动取消用户生成，不排队等待整段模型回合。复用 Main 的 session.status，正确接收完成、取消、失败和异常退出事件。

运行检查和关闭新操作入口必须位于同一个同步入场步骤，避免检查后新 send 插入。对已入场但尚未把状态设为 running 的异步 start/send，排空后、严格停机前再核查一次。任一次发现 running 都在停机前退出维护并恢复正常状态。

取消操作在拒绝维护后仍能正常使用；不要让“请先停止”与“维护期间禁止取消”形成死锁。后台工具在途仍按现有计数排空，不能把整个模型回合压进 runWrite 造成工具嵌套等待。

## 5. 验收与交付边界

必须将三个复现翻转成防回归断言：运行中维护被拒且未 stop/copy；复制期间 list 不 start/request；shutdown 失败或未确认 exit 时 copy/config.patch 调用次数为零。

增加事件顺序、超时、失败恢复、迟到旧 exit 的针对性测试，复用 Vitest fake timers 和 EventEmitter；不依赖长 sleep。复用已有打包 Electron E2E 做一次不调用模型的 Utility 启动/列表/严格停机烟测，并验证导出或复制窗口内刷新列表不重启 Utility。只用临时 sessionRoot 和合成数据。

改后全套 test/typecheck/lint 一次，运行必要打包 E2E。默认不重新 make Squirrel 安装器：本轮没有新依赖或安装逻辑，打包应用运行验证足以证明此次改变；若实际改动涉及安装/Forge，再按证据增加检查。旧 2.6.6 RC 不能被称作已经包含补修。

更新上一轮执行记录和质量报告的当前验收状态，保留历史测试数据日期；修复后以新结果记录闭环，不删除之前失败事实。补充检索表口径：五次合计含首次建索引，使用模拟源，不是磁盘单次热查询。无需重跑检索或加 Worker。

不操作真实资料、系统安装版、发布、推送或付费模型。保持用户原有未提交修改；本轮规划本身不修改产品代码或版本。
