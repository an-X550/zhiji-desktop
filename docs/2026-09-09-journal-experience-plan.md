> 后续验收已发现未完成项，且用户已明确改为分析当前日志、停止同日多份自动汇总。后续执行请使用 [二次验收方案](2026-09-09-desktop-reacceptance-review.md)、[新执行计划](2026-09-09-desktop-reacceptance-plan.md)和[新提示词](2026-09-09-desktop-reacceptance-prompt.md)，本文件仅保留前轮历史。

# 日志核心体验执行计划

状态：已实施（含 J14/J16 扩展补充）。本版替代此前同名计划。唯一业务依据：[需求复核与收敛方案](2026-09-09-journal-experience-review.md)；结果见[实施与验收记录](2026-09-09-journal-experience-acceptance.md)。候选问题清单不等于全部实施范围。

## 0. 开工

目标 `C:/Users/panda/.claude/skills/知己/apps/zhiji-desktop`。读适用 AGENTS.md，检查 git status/diff，保护既有改动。读取根 `.claude/shared/ai-operating-principles.md`、`PROJECT_STATUS.md`、`CHANGELOG.md` 最近 5 条、`docs/development-governance.md`。本方案替代旧文档中的“历史只保存”“历史先编辑才能生成”“生成完跳历史页”“正文相同自动去重”要求。

不重复写计划，不新增审批环节；先核查以下路径当前实现。独立备份、Agent 内核、全局数据层和周期复盘不纳入重构。

## 1. 先修正确性：空输入、失败恢复、模型返回

目标文件：`src/renderer/pages/today-page.tsx`、`src/main-process/application/generate-daily-review.ts`、`src/main-process/skill-runtime/daily-runtime.ts`、`collect-validated.ts`、`src/main-process/infrastructure/ai/openai-compatible-provider.ts`；只有实际涉及才改 provider-port/daily-grade-review。

- 空编辑器本地阻断，不能回退到今日旧日志。服务端空材料在 Provider 前结束；已知完全未填写内置模板可精确拦截，不拦合法短句。
- 复现 J7–J9 再修：保存失败恢复状态；仅本地保存阶段可短暂锁字段，AI 阶段可继续输入；重试使用最新保存正文；迟到返回不覆盖新输入/其他日期。
- 按 J3 先验证请求参数与官方协议。限定日反馈用途修改 Provider 策略，其他服务与 Agent 保持原语义。有界自动恢复，不无上限加预算。只校验通过的最终 content 能落盘。

验收：空编辑器且有旧日志时 0 次生成 IPC；后端空材料 0 次模型调用；保存失败可继续且不生成；生成期间新输入不丢；错误重试不会分析旧草稿。

## 2. 落实用户明确的同日规则

目标文件：`application/save-journal.ts`、`application/generate-daily-review.ts`、`infrastructure/markdown/review-repository.ts`、必要 schema、当前实际日反馈写入口。复用原子写与已有任务协调。

- J18：新建日期已有日志时显示非阻断提示；一条可继续编辑，多条可查看选择；已有草稿保留，显式另记允许。按钮防重入，成功绑定 ID；再次保存更新原记录，无变化不写。不要按正文相同自动合并/返回别的记录。
- J17：同日日反馈更新现有 ID/路径，记录最近生成时间与 sourceVersions，无记录才创建。失败/取消/写入失败保留旧反馈。生成期间源变化时按实际快照保存并显示待更新。
- 旧多份反馈读取时选最新有效项，该日下次成功更新后多余文件移至现有回收站。不是每次覆盖备份，不动原始日志。不建全库迁移/清理面板。提交前重查有效记录，不能只靠 UI 隐藏来满足按日唯一。
- 在同一持久化测试中注入审计/清理失败：如已保存就如实报告，不能提示未保存后诱导再次付费；不扩展为新审计系统。

验收：同日连续三次成功生成只存一份有效结果且 ID 稳定；失败旧结果仍在；并发首次生成不新增两份；重复按同一次保存不增加日志；明确另记的相同正文不被拦；同日不同日志均计入反馈；旧重复文件退出有效存储时不损失有效反馈；草稿和原始日志不被清理。

## 3. 完成自然的写作和阅读流程

目标文件：`today-page.tsx`、`history-page.tsx`、`features/history/history-reader.tsx`、必要的 `app/navigation.ts`、`domain/history-items.ts`、`shared/domain/daily-freshness.ts` 与 `src/index.css`。

- 今日/历史共用生成函数，编辑器先保存再生成；历史只读详情在“日反馈”区域可直接生成，不必先编辑。
- 复用一个“日志 / 日反馈”内容区或同等小组件，让结果有固定阅读位置。清除跨日期临时正文；通过 persisted Review 派生状态，刷新共享列表，重启可找回。
- 生成完成仅在仍是相同上下文、无新输入时展示反馈；否则提示完成，不抢用户页面。切标签保留编辑器状态。
- 已有未变化反馈直接查看，更新/重生成才调用 AI。同日多条时解释范围；来源日期和记录可辨识，不向用户展示裸 ID。
- 给历史列表有效摘要、同日稳定排序；修改后清除不真实的“已保存”提示。这些是小修，不做全文搜索/日期系统重构。
- 复用 textarea 自适应高度、现有 Markdown 渲染和主题。短文不困在小滚动框；长文可读、操作可达；技术信息折叠，反馈有段间距和阅读容器。不要换编辑器或加 UI 框架。

视觉检查：1440×900 与 960×640、明暗色，233 字和长文/长模板；补一个 125% 或 150% 缩放。检查短文无需 textarea 内滚、长文不截断、无横向溢出、操作栏不盖正文、键盘能切换并看清焦点。不把固定宽度或首屏容纳所有长文当验收条件。

## 4. 不扩展的范围

J14/J16 初始列为暂缓；实施过程中按扩展范围完成最小闭环：周期复盘保存后刷新、逐资源加载与安全结构化连接探针/usage 诊断。费用计价、完整成本账单、额外 D 级复核调用仍暂缓。J12 通用证据导航、J13 日期系统重构不纳入。没有证据不新增内容查重、自动合并、自动保存、日历、反馈版本、数据迁移框架或状态框架。

## 5. 验收与交付

先跑受影响定向测试，再一次完整验证：

```powershell
npm test -- tests/unit/today-page.test.tsx tests/unit/history-page.test.tsx tests/integration/generate-daily-review.test.ts tests/integration/markdown-repository.test.ts tests/integration/openai-provider.test.ts
npm test
npm run typecheck
npm run lint
npm run test:e2e
```

test:e2e 已有 pretest:e2e 打包，不连续重复 package；如脚本已变先核实。只写行为/故障回归，不写重复实现的类名断言。

三条必须走通的用户任务：

1. 补写昨日 → 保存并生成 → 在当前日志工作区读反馈，无需绕历史页找小链接。
2. 今天已有日志 → 可继续编辑或明确另记 → 更新反馈 → 同日仍只有一份反馈，全部实际来源清楚。
3. 重启 → 过去日志 → 选日期 → 读已有反馈，不需要 API key，也不触发生成。

再核查空白 0 调用、失败保留、生成期间继续写/换日期不被打断。用户已明确说明 AI API 已配置，并授权本任务直接使用它测试，无需再次询问调用权限。先完成离线检查，再通过实际日反馈链路用一条简短合成日志做一次真实验证；通过即停止额外模型测试。失败先读诊断、定位和修复，仅在有具体改动或待验证假设时追加必要实测，不机械重试，不为省 token 把输出上限压到无法完成结构化输出。其他重复、并发、空白和错误场景优先用 mock。使用隔离测试数据，不发送用户原日记、不覆盖用户反馈、不输出密钥；记录服务商返回的 token 用量（不可用则注明）。若配置实际无法访问，先排查再如实报告，不把已获授权说成未授权。

已输出 `docs/2026-09-09-journal-experience-acceptance.md`，记录任务结果、异常回归、截图和真实模型验证范围；J1–J18 仅用于追踪，仍明确标出费用计价等暂缓项，不以勾完清单扩大开发。依治理规则已同步实际变更，未提交、推送、安装或发布；源码和本地 packaged-asar 完成不代表安装版已更新。
