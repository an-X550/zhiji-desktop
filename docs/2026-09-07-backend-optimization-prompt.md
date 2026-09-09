# 交给另一窗口的执行提示词

复制下面整个代码块给执行 AI。无需粘贴此前聊天，文档包含必要上下文。

```text
请在当前本地工作区实施知己桌面端后端优化，完成代码、相关测试、打包验证和文档同步，不要只输出计划。不要使用 leader skill。

指定实施目录：
C:\Users\panda\.claude\skills\知己\apps\zhiji-desktop

这是我明确指定的桌面端在用目录。本任务以这里的当前代码和未提交修改为准，不因旧文档称其为“快照”而另找、克隆或切换独立仓库。Git 根可能是上层知己仓库。

先按顺序阅读（UTF-8）：
1. C:\Users\panda\.claude\skills\知己\AGENTS.md
2. C:\Users\panda\.claude\skills\知己\.claude\shared\ai-operating-principles.md
3. C:\Users\panda\.claude\skills\知己\docs\development-governance.md
4. 根 VERSION、PROJECT_STATUS.md 和 CHANGELOG.md 最近五条，只加载必要部分。
5. C:\Users\panda\.claude\skills\知己\apps\zhiji-desktop\docs\2026-09-07-backend-optimization-design.md
6. C:\Users\panda\.claude\skills\知己\apps\zhiji-desktop\docs\2026-09-07-backend-optimization-plan.md

执行第 6 个文档的 P0–P6，第 5 个文档是设计依据。按阶段读取桌面 docs/architecture.md 和相关源码，架构描述过时时以代码为准。涉及 DSH 生命周期和打包时再读桌面 docs/dsh-integration-notes.md、docs/install-package-distribute.md。涉及提示词语义时再读桌面 docs/contract-prompt-mapping.md 和 docs/skill-compatibility-matrix.md。不重复全仓库审计，不读取我的私人日志做测试。

目标优先级：可靠文件替换/恢复 → 数据迁移与会话写入协调 → IPC 来源校验 → 检索增量缓存 → 精简 LangGraph 与统一结构化输出 → 离线质量与打包验收。

优先复用成熟资源：write-file-atomic、现有 MiniSearch、Electron 原生 API、现有 ProviderPort/Zod/Vitest/DSH。方案已经给出上游链接和采用边界，只核对本次实际使用的版本，不重新做宽泛技术调研。不要批量升级依赖，不引入 SQLite、向量库、微服务或第二套 Agent 框架。具体组件若不适合实际环境，以验证证据选择更简单替代并记录，不盲从库名。

这条消息授权上述范围内的本地实现、测试和本地打包；普通实现选择自主决定，无需重新确认方案。真实模型付费 A/B 是可选后续：缺少我显式提供的调用配置和预算时，完成离线样例、运行说明并标明未执行，不阻塞其余工作。不要读取或输出个人 API Key，不上传真实日志，不自动迁移真实数据或修改系统安装版。不要 commit、push、创建 tag 或发布 Release。

先检查 git status 和现有 diff，保护包括 dsh-runtime.ts 在内的已有修改，不 reset、不整文件覆盖、不 git add .。保持现有 safeStorage、路径校验、预览 token/approvalId、取消、备份验证、DSH 会话持久化和个人背景授权边界。实现时注意原子写队列不等于业务事务，Utility kill 不等于落盘完成，元数据缓存不等于权威材料新鲜度检查。

节省 token：按阶段阅读、简短汇报，不重述整份方案；定向测试先行，最终做一次完整回归和必要产物验收。只有新修改/失败才重复检查。不要为了省 token 跳过故障恢复或数据一致性验证。

持续推进至 P0–P6 核心范围完成。每阶段完成就在执行计划更新状态和实际证据；不可把计划、尝试或 skip 说成完成。缺外部条件只阻塞依赖部分，继续独立工作。最后报告：完成项、验证结果、实测性能、实际依赖变化、剩余限制与唯一必要的后续动作。不要声称已同步其他仓库或安装版。
```
