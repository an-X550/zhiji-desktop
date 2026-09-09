---
created: 2026-09-07
status: implemented-with-limitations
scope: apps/zhiji-desktop
---

# 桌面端后端优化方案

## 1. 目标与证据边界

保留 Electron + TypeScript、Markdown/JSON 权威数据、Main 领域服务和 DSH Utility Process，解决可观察的数据可靠性、重复计算和维护成本问题。用户明确指定当前实施目录为 `apps/zhiji-desktop`，本任务不按旧仓库边界文档改去独立仓库。

本方案依据 2026-09-07 当前工作区（包括已有未提交修改），不是已发布安装版审计。已执行相关 5 文件 / 35 项测试通过；尚未做崩溃注入、性能基准、真实模型评测。代码风险不等于已发生用户事故，预期收益不等于测得收益。

实施步骤见[执行计划](2026-09-07-backend-optimization-plan.md)，交接入口见[执行提示词](2026-09-07-backend-optimization-prompt.md)。本文记录本轮已实施的后端优化范围；实现已完成离线契约验证、确定阶段子进程退出验证、打包验证和本地 RC 生成，但 OS 级强杀/Electron 崩溃、安装版真实 Agent 和真实模型 A/B 仍是明确未执行项，见质量记录与执行计划。

## 2. 选型结论

| 事项 | 采用 | 暂不采用及原因 |
|---|---|---|
| 单文件替换 | 优先采用 npm 的 `write-file-atomic`，外包一层现有业务校验 | 不自研跨平台文件事务框架；库不代替业务并发控制 |
| 写入协调 | Electron 单实例 + 小型进程内维护状态与在途操作计数 | 不引入分布式锁、数据库或通用任务调度器 |
| 检索 | 已安装 MiniSearch 的增量更新 + 可丢弃内存缓存 | 不迁 SQLite，不新增 embedding 或向量服务 |
| IPC | Electron 原生 frame/window 校验，统一注册包装 | 不另起本地 HTTP 服务 |
| 复盘编排 | 现有函数、ReviewTaskManager、AbortSignal | 移除未发挥恢复价值的临时 StateGraph，不替换 DSH |
| AI 输出 | 扩展现有 ProviderPort/Zod 处理 | 不引入第二套 AI SDK 或评测 SaaS |

成熟组件必须在实际 Electron 内置 Node、Windows 文件系统和打包产物中验证；不把上游 main 分支文档当成当前已安装版本保证。只锁定本次实际选择的依赖并更新 lockfile，不批量升级。

## 3. A：写入与恢复，最高优先级

### 问题

`src/main-process/infrastructure/markdown/atomic-write.ts` 先将目标改名为备份，再发布临时文件，存在目标缺位窗口。回滚中的 rename 如果失败，finally 仍尝试删除备份。`journal-repository.ts` 改日期先改名 `.moving`，中途退出后列表不会读取该文件。现有 updateQueue 只串行同一仓储实例的 update，不保护 create/delete、其他实例或外部编辑。

### 方案

1. 保留 `atomicWriteUtf8` 调用入口。先验证序列化内容，采用成熟组件完成同目录临时文件、文件 fsync 和替换，取消“先移走旧目标”的常规写入流程。
2. 保留现有提交前复读校验：薄适配层先把候选内容写入自身唯一临时文件，复读并调用 validator，再把校验后的字符串交给 `write-file-atomic` 发布。接受小文本多一次临时 I/O，以避免改动原有校验语义。自身临时文件只在本次调用中清理。可在以后有测量证据时简化，首轮不 fork 上游库。
3. 不误用 `tmpfileCreated` 作为“写完后校验”钩子：当前上游实现中它在写内容之前触发。库的同路径写队列也不是业务 read-modify-write 锁，不能据此移除乐观并发检查。
4. `resolveInsideRoot` 和拒绝符号链接的限制必须在适配层接入后继续生效。库会解析 realpath，不能让组件替换绕过路径策略。Windows sharing violation 等失败必须保留旧目标并明确失败；不回退到先删旧文件再写。
5. 日志更新默认保持已发现的文件路径稳定，以 frontmatter 的 date 为业务日期，消除改日期的双文件操作。新建文件仍沿用现有命名，旧文件无需批量迁移。复核跨年、目录统计、导出恢复、其他消费者没有根据文件名推断业务日期；若发现真实依赖，修正消费者或记录小范围替代方案，不能静默破坏兼容。
6. 对旧 `.bak` / `.moving` 做有限恢复：启动装配业务服务前，只扫描产品管理目录及本产品明确命名模式；解析候选并验证目标/id。正式文件缺失且只有一个合法候选时可恢复；多个候选、正式文件和候选冲突、解析失败时保留全部材料，报告具体恢复位置，不按最新 mtime 猜哪个正确。不能全盘清理临时文件，也不能自动晋升半写入 `.tmp`。
7. 为同一业务记录的检查与修改保留串行临界区，并覆盖 create/update/delete 的实际冲突路径。用 `app.requestSingleInstanceLock()` 避免相同应用多实例写同一 userData；它不保证不同安装版或外部编辑器互斥，不宣称解决了所有跨进程冲突。

不把文件 fsync + rename 宣称为任意硬件断电下的完整事务保证。首轮保证范围是支持的本地 Windows 文件系统上的进程中断/常见 I/O 失败；网络盘、同步盘和外部并发编辑的限制须如实说明。

## 4. B：迁移、恢复与 Agent 写入生命周期

`DataRootHolder.changeLocation()` 复制后仅更新配置；当前仓储和 Utility 仍持有旧路径。`DataTransferService` 的空目录检查也没有阻止检查后的并发新写入。

采用一个小型维护协调器，放在业务服务调用边界，覆盖 IPC 和 Agent 工具共用的写入用例。普通独立写入无需全局串行；维护操作需要先阻止新写入，再等待已有操作完成。嵌套用例不可重复拿不可重入锁导致死锁。

默认行为：

- 迁移/恢复在有复盘生成、运行中 Agent 或未保存草稿时，不开始复制；保留草稿并说明需先完成或停止当前操作，复用既有确认界面，不另造多轮批准。
- 检查空闲和设置维护态必须在同一临界区完成。维护态拒绝新的生成、Agent 会话开始/发送、日志/项目/模式/设置等写入。不能只禁用设置页按钮。
- 利用 DSH 现有 shutdown/持久化能力释放会话写入者，等待停止完成才复制。核对 `ElectronAgentRuntime.stop()` 的 ack/exit 语义，不把 `kill()` 已调用视为落盘完成。停机失败就不复制，不强杀后谎报成功。
- 目标路径规范化，拒绝相同目录、源目录内部目标、经 junction/symlink 指回源目录的目标，保留现有空目录要求。
- 复制完成后用已有业务校验和文件集合/大小校验确认目标可用，再更新配置。旧目录保留，失败不切配置。无需新增持久化 hash 台账。
- 成功进入“等待重启”只读状态，提供明确重启入口；重启处理用 Electron 原生 API，退出流程应等待必要清理。不要在仍可写旧目录时只给一条提示。
- 失败释放维护态并恢复原目录能力；如果 Utility 已停机，需要验证重新初始化路径，不让失败后 Agent 永久不可用。
- 恢复沿用既有预览与空目录限制，不扩展合并恢复；导出期间也暂停写入并确保会话落盘一致，再恢复正常工作，避免得到逐文件合法但非同一时点的备份。

## 5. C：统一 IPC 信任边界

在 handler 注册入口加统一包装，验证调用来自已登记的应用窗口、顶层 frame 和允许的精确页面。开发态仅接受实际 Vite URL 的 origin/页面规则；生产态只接受当前打包入口，不使用字符串 startsWith 判断可信域名。销毁的窗口、子 frame 和导航后的非应用页面必须拒绝。

窗口禁止跳离应用页面，继续保留新窗口 deny、sandbox、contextIsolation 和 Zod 参数校验。现有 Agent event 订阅也经过同一校验。范围只做入口校验和相应生命周期测试，不趁机重写全部 handler 或加新 RPC 框架。

## 6. D：检索缓存与测量

`AgentMemorySearchService.search()` 每次 list 全部材料并重建 MiniSearch；日志 get 也全量解析。先测再改，保留目前中文 tokenizer、排序、片段和 limit/alternates 行为。

第一版使用每个 dataRoot 独立的内存文件目录表及 MiniSearch 实例：

1. 搜索前枚举相关路径并比较 mtime/ctime/size 等廉价元数据，只复读、解析和更新变化文件，删除文件从索引移除。复用 MiniSearch 的 add/replace/discard；以已安装版本 API 为准。
2. 应用内写成功主动失效对应条目；恢复和数据根切换清空全部缓存；同一服务的并发搜索合并构建，构建失败不得发布半个索引或静默返回旧数据。
3. 外部编辑通过每次查询的目录/元数据核对发现，不把 `fs.watch` 当唯一正确性来源。文件读取前后状态变化则有限重读；真实 get、复盘预览和生成的版本检查仍复读权威文件，不能把缓存用于批准新鲜度判断。
4. 元数据缓存无法保证发现刻意保留全部元数据的替换。提供内部强制重建能力，重启必重建，并在结果说明记录此限制。若普通编辑场景验证不可靠，优先退回每次读原文、仅复用未变化文档的解析/分词，而不是返回过期证据。
5. 内存中按 id 保存路径，get 只复读目标；缓存失效/目标缺失时重新发现。重复 id、损坏文件继续明确报错，不自动跳过改变结果。

使用合成中文数据：100、1,000、5,000 篇日志及比例合理的复盘，报告冷/热查询耗时、文件读取次数、内存和主进程事件循环延迟。正确性测试要求缓存前后排序一致；性能要求未变数据的热查询不再全库 read/parse/addAll。耗时收益实测记录，不预设“提升 10 倍”等承诺。

先不持久化索引、不引入 watcher 包；只有测试显示缓存后仍有明显主进程长阻塞，才把索引计算移到 Worker。备份压缩的 Worker 改造同样以实测卡顿为依据，不能顺手扩大范围。

## 7. E：精简复盘编排，统一输出恢复

### 编排

日反馈与周期复盘的图每次新建 MemorySaver 和随机 thread id，不提供跨请求恢复。改成显式 async 函数，复用已有构建证据、D 级复核、澄清、生成、质量门和渲染函数。保留 ReviewTaskManager 状态、AbortSignal、缓存快路径、预览 digest 和 Main 确认。

特别保留日反馈 D 级的 `confirmPersonalExperience` 复核调用：旧架构检查清单“D 级不调模型”的笼统描述不代表当前代码。复核后仍为 D 才澄清、不生成正式报告。不能为了“等价简化”删除这次复核。

确认全部使用点后删除 `@langchain/langgraph` 和不再需要的 `@langchain/core` 直接依赖；若别处仍用则保留相应依赖。DSH、Cordis、官方会话 JSONL 和压缩插件不改。

### 结构化输出

抽取小型 `collectValidated`（名称可调整），参数包含 messages、parser、signal、输出预算和重试通知。日反馈和周期复盘优先接入，暂不把所有自由文本工具强改 JSON。

- 识别空内容、截断、非法 JSON、Schema 不匹配；只有结构类失败最多重试一次。网络/认证错误、取消不作为结构错误重试。
- 保持日反馈现有预算和输出语义；周期复盘单独设预算，根据合成完整六问样例验证，不能照搬 1200 导致必然截断。
- 第二次截断明确失败，不进入无限加预算循环。失败输出不写入正式复盘，也不完整写诊断日志。
- provider 返回 usage 时保留输入/输出/缓存 token 等可用字段；不支持时为 unknown/null，不记成 0。DSH TokenMeter 是上下文估算，不能冒充账单用量。
- 诊断只保留耗时、失败类别、次数、模型标识和用量等最小字段，优先复用现有审计设施，不存 API Key、完整日记、提示词或 reasoning。

## 8. F：质量评测与打包验证

核心范围包含离线可复跑样例与现有测试扩展，不新增评测平台。建议 20–30 个脱敏/合成样例，覆盖证据分级、六问结构、中文词法召回、冲突证据、工具确认/取消、长对话压缩后的关键事实。使用已有 Vitest、ProviderPort 假实现和现有 E2E；语义质量必须人工或真实模型核查，不能用字符串断言冒充。

真实模型 A/B 为可选后续：只有显式提供允许调用的模型/凭据入口和调用预算后运行；缺少时完成离线材料与运行说明，标为未执行，不阻塞核心修复。不要读取现有个人密钥或自动上传真实日志。记录每样例成功率、证据错误、耗时、用量与失败类别，凭结果再决定换模型/升级 DSH。

复用现有 Forge 和打包 E2E，在产物中实际启动 Utility，证明新增依赖解析及会话创建/resume、取消、shutdown 链路可用。保持现有 external 依赖处理，只修复有证据的漏项。不开新发布平台，不借此批量替换工具链。

## 9. 优先级与范围

核心顺序：A 写入恢复 → B 数据生命周期 → C IPC → D 检索 → E 编排/输出 → F 离线验收及交付。按模块交付可复查结果。总量粗估 8–15 人日，取决于 Windows 故障测试与既有耦合，不是 AI 执行时间承诺；真实模型 A/B 另计。

不新增 SQLite、向量数据库、HTTP 后端、微服务、通用事件总线、通用事务引擎、自动更新平台。同步更新受影响架构段落即可，不进行全仓库文档大扫除。不操作真实数据迁移、系统安装版、Git 推送、tag 或 Release。

## 10. 已核实的成熟资源

以下于 2026-09-07 核查，实施时只复核实际选定版本，不重复广泛调研：

- [npm/write-file-atomic](https://github.com/npm/write-file-atomic)：替换、fsync 和同路径写队列；[源码](https://raw.githubusercontent.com/npm/write-file-atomic/main/lib/index.js)用于核对 hook 时序、realpath 和异常清理，不能视为跨进程业务事务。
- [MiniSearch API](https://lucaong.github.io/minisearch/classes/MiniSearch.MiniSearch.html)：复用增量索引 API，中文分词仍用当前实现。
- [Electron app API](https://www.electronjs.org/docs/latest/api/app)：单实例、relaunch 和 quit；异步持久化由应用正确衔接。
- [Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security)：验证 IPC 来源、限制导航。
- [Electron 性能建议](https://www.electronjs.org/docs/latest/tutorial/performance)：主进程避免重型阻塞计算，按测量结果处理。
- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)：解释检查点价值及当前临时图没有利用的能力，不构成换 DSH 的依据。
