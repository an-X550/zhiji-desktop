---
created: 2026-09-08
status: completed-offline
---

# 后端优化离线质量记录

## 最新补修验证：v2.6.8（2026-09-08）

第二轮验收发现启动等待没有上限，以及 running 检查晚于 draining、会阻塞工具在途时的用户取消。现已修复：默认 10 秒启动超时，失败实例不接受迟到 ready、不重复启动；维护入场前与排空后两次检查 running。

新增四项回归；两条原始问题断言先在旧代码失败，再随修复通过。完整 `npm test` 60 files / 387 tests，typecheck 通过；lint 0 errors / 8 个既有 warnings（新增测试文件清除自身告警后定向复验通过）。`npm run test:e2e` 前置 package 后 6 passed / 2 skipped，产物为本地 v2.6.8 packaged-asar。未 make、安装或执行真实模型测试，旧 v2.6.6 RC 不含此修复。以下旧版本结果按原日期保留。

本记录只覆盖本地可复跑的契约、故障和合成材料检查，不把字符串断言当作真实模型语义质量证明。真实模型 A/B 没有运行：本次没有用户显式提供的模型、凭据和调用预算，测试没有读取现有 API Key，也没有上传真实日志。

## 离线样例矩阵

| 范围 | 脱敏/合成材料 | 覆盖入口 | 证据 |
|---|---|---|---|
| 日反馈证据分级 | 10 条金样本，覆盖 A/B/C/D、短第一人称评价、疑问式解释、模板日志 | 正则判级与 D 级语义复核 | `tests/unit/daily-evidence-gold.test.ts`、`tests/unit/daily-runtime.test.ts` |
| 周期复盘 | 完整六问 JSON、月报主主题/假说/升级提醒、B/C 降级和方向锚点五态 | Schema、质量门、确定性渲染和 1800/2400 token 预算 | `tests/unit/periodic-review-v1.test.ts`、`tests/unit/periodic-runtime.test.ts` |
| 中文历史检索 | 4 条日志、2 条周期复盘、1 个已验证模式；包含拆小行动、日期事实和日志/复盘冲突；另覆盖重复 ID、损坏文件、隔离根和显式 rebuild | 中文复合词、受限候选、排序、摘录、空结果、冲突可见性和索引完整性拒绝 | `tests/fixtures/agent-evidence-demo.ts`、`tests/unit/agent-memory-search-service.test.ts` |
| 结构化输出故障 | 空内容、`finish_reason=length`、非法 JSON、Schema 缺失/类型错误、第二次仍失败、网络错误、两次请求间取消 | 单次重试、最小诊断、不重试非结构错误、不保存半成品 | `tests/unit/collect-validated.test.ts`、`tests/integration/generate-daily-review.test.ts`、`tests/unit/periodic-runtime.test.ts` |
| 写入与维护边界 | 临时目录、替换失败、校验后/发布后子进程退出、旧残留候选、并发 update/delete、迁移失败、复制期间新写入、Agent 工具在途 | 原子替换、恢复保留、维护排空、失败释放、junction/子目录拒绝和只读重启边界 | `tests/unit/atomic-write.test.ts`、`tests/fixtures/atomic-write-crash.ts`、`tests/integration/markdown-repository.test.ts`、`tests/integration/data-root-holder.test.ts`、`tests/unit/maintenance-coordinator.test.ts`、`tests/unit/agent-facade.test.ts` |
| IPC 来源 | 合法窗口、未知窗口、子 frame、相似恶意 URL、生产精确 file path | handler 统一来源校验和导航策略 | `tests/unit/ipc-source-guard.test.ts` |

## 检索基准

命令：`npm run benchmark:memory`。同一脚本在 5 次查询中比较“每次重建索引”的冷路径与“首次建索引、随后只核对元数据”的热路径；计数是合成解析值，不是用户文件统计。

| 合成日志数 | 冷路径耗时 | 热路径耗时 | 冷解析值 | 热解析值 | 热路径最大事件循环延迟 |
|---:|---:|---:|---:|---:|---:|
| 100 | 106.72 ms | 30.06 ms | 500 | 100 | 12.47 ms |
| 1,000 | 781.32 ms | 310.07 ms | 5,000 | 1,000 | 43.81 ms |
| 5,000 | 3,169.24 ms | 1,293.32 ms | 25,000 | 5,000 | 198.18 ms |

结论边界：未变化材料的热路径确实减少重复解析；MiniSearch 建索引仍在 Main Process 同步执行，5,000 条时已有可观事件循环延迟。本轮没有 Worker 的必要性证据来自真实用户卡顿，因此保留更简单的内存实现并记录后续观测点。

## Windows 打包验证

- 在纯 ASCII 物理副本中再次运行 `npm run make`，package 阶段与 Squirrel 阶段均完成，Forge 命令退出 0。直接从中文工作区运行时曾在 `rcedit` 阶段失败，因此失败目录没有被采纳；本次外层核对曾错误期待 ASCII 安装器文件名，但实际 Squirrel 产物 `知己-2.6.6 Setup.exe` 已确认存在并完成元数据检查。
- 本次本地 RC 位于 `out/release-candidate/v2.6.6/`：`Zhiji-Setup-v2.6.6.exe`、`zhiji-2.6.6-full.nupkg` 与 `RELEASES` 三件套已从本次成功构建刷新；RC 安装器只是将原生中文文件名规范化为文档中的 ASCII 分发名，内容哈希保持一致。
- `RELEASES` 指向 `zhiji-2.6.6-full.nupkg`；nupkg 的 nuspec 版本为 `2.6.6`；安装器 PE 的 FileVersion/ProductVersion 均为 `2.6.6`。
- 未自动安装到用户系统，未执行 Windows 10 干净虚拟机、升级/卸载或安装版真实 API Agent；未 push、tag 或发布。

## 最终自动化验证（2026-09-08，v2.6.6 后端优化）

- `npm test`：59 个测试文件、371 个测试通过。
- `npm run typecheck`：通过。
- `npm run lint`：0 errors / 8 warnings；warning 均为既有代码告警。
- `npm run test:e2e`：打包后 5 passed / 2 skipped；跳过项需要显式真实模型凭据。
- 本轮已重跑 `npm run make`：纯 ASCII 物理副本构建退出 0，Squirrel 产物与 RC 三件套已核对；任务创建的 `C:\zhiji-build-src` 已清理。

## 维护补修最终自动化验证（2026-09-08，v2.6.7 本地源码）

- `npm test`：60 个测试文件、383 个测试通过。
- `npm run typecheck`：通过。
- `npm run lint`：0 errors / 8 warnings；warning 均为既有代码告警。
- `npm run test:e2e`：前置 `package` 成功；packaged-asar E2E 6 passed / 2 skipped。覆盖无密钥启动、列表快照、严格维护停机、维护期间只读刷新；跳过项需要显式真实模型凭据。
- 本轮未新增 npm 依赖、未修改 Forge/安装逻辑、未重跑 `npm run make`；未安装、升级、卸载或发布。`v2.6.6` Squirrel RC 不包含本轮补修，`v2.6.7` 仅有本地 packaged-asar 验证。

## 验收补修补充（2026-09-08，v2.6.7 本地源码）

上一轮 P2 的历史测试和 `v2.6.6` RC 记录保留；本轮新验收发现其正常 shutdown/维护路径没有覆盖三个竞态，因此不把旧“仅剩外部验收”当作补修通过。补修新增并通过以下脱敏 fake runtime/临时状态回归：

- `tests/unit/agent-facade.test.ts`：running Agent 回合在 `session.send` 命令已确认、协调器计数已归零时仍拒绝维护，未调用 stop/copy，拒绝释放后 cancel 可用；维护/只读等待期间 list 返回内存快照，start/send/confirm 不启动、不请求、不写 approval；在途 list 被排空，复制失败走内部恢复。
- `tests/unit/electron-agent-runtime.test.ts`：`command.failed`、shutdown 超时、kill=false 无 exit、ack→kill→exit、error 后延迟 exit、启动中停机、并发 stop、旧实例迟到 exit；只有同一 child 的 shutdown `command.completed` 与真实 `exit` 都确认后才允许维护回调，失败时 copy/config.patch 均为零。
- `MaintenanceCoordinator.runRead()` 将正常 list 纳入排空计数；维护/等待重启态不再通过公共 `ensureStarted` 重新启动 Utility。

本轮未新增 npm 依赖、未修改 Forge/安装逻辑；v2.6.6 Squirrel RC 不包含补修。必要的 v2.6.7 packaged-asar E2E 只使用临时数据根和合成会话，不读取 API Key、不安装、不发布、不重复 `make`。

## 未执行项

- 真实模型 A/B：未执行，缺少显式模型、凭据和预算；不阻塞离线契约验证。
- 崩溃注入/强杀：已用独立 `vite-node` 子进程在校验后和发布后两个确定阶段调用 `process.exit(17)`，验证旧版/新版文件完整性；尚未做 OS 级 SIGKILL、Electron Utility 崩溃或断电模拟，因此这些仍需单独的 Windows 验收。
- 安装版真实 API Agent：沿用现有 E2E 的显式凭据门；本次不读取或输出本地 Key。
