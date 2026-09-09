# v2.6.12 AI 恢复与界面收尾验收结果

日期：2026-09-09。状态：本轮指定范围已完成；结果基于当前源码重新打包的 packaged-asar。未提交、推送、安装或发布。

本记录承接 [`RECOVERY-REVIEW.md`](RECOVERY-REVIEW.md) 与 [`RECOVERY-PLAN.md`](RECOVERY-PLAN.md)，不覆盖 v2.6.11 的界面验收历史记录 [`ACCEPTANCE-FIX-IMPLEMENTATION-RESULT.md`](ACCEPTANCE-FIX-IMPLEMENTATION-RESULT.md)。

## 结论

本轮已完成 AI 失败恢复、日志保存失败回显、周期复盘错误呈现、旧首页局部恢复和日志页收敛。真实 packaged Electron 在隔离数据根中使用合成材料验证了连接、日反馈、周复盘、月复盘和 Agent；没有读取或发送用户日志，也没有把 mock 结果当成真实模型证据。

## 根因证据与修复

1. **保存后的正文确实进入 AI 请求**：`GenerateDailyReview` 按请求日期重新读取已保存 journals，再将其交给 `buildDailyContext`。新增集成测试断言保存的 `id` 与 `body` 出现在结构化请求 payload；真实冒烟也先写入隔离数据根，再调用日期对应的日反馈。
2. **`outputLength=0` 是模型输出长度**：`collectStructured` 从 provider 响应读取 `message.content`，与用户编辑器长度无关。`finish_reason=length` 表示结构化响应在输出侧被截断；它不能解释为“用户日志为空”，也不能仅凭此断定网络超时、服务商或推理模式是唯一原因。
3. **长度故障现在优先分类并改变恢复条件**：`collectValidated` 先处理 `length/max_tokens`，日反馈由 `1200 → 2400`，周/项目由 `1800 → 3600`，月复盘由 `2400 → 4800`；非长度的空内容、JSON/schema 错误保留原预算的单次格式重试。任何结构化调用最多两次，取消、认证、限流等不进入格式重试。
4. **诊断和落盘边界保留**：诊断继续携带 finish reason、输出长度、预算、attempt/retryOf，并在 provider 返回时保留 provider/model、usage、reasoning/refusal 元数据；只对通过 schema 的最终报告落盘，不把 reasoning 当正文，不把空内容隐藏成成功。
5. **周期复盘与写作恢复**：周期复盘返回可安全展示的 typed error/诊断，保留材料预览和 `previewToken`，不把 Electron IPC 包装直接展示给用户；保存成功后保留正文、编辑身份和 dirty 快照，AI 失败时原文与重试动作仍可见；需要新记录时显式使用“新建日志”，避免同日重复 create。

## 真实 AI 覆盖表

| 路径 | 验证方式 | 合成材料与结果 |
|---|---|---|
| Provider connection | packaged Electron + 现有加密凭据 | `deepseek / deepseek-v4-flash`，HTTP 连接成功，约 344 ms；不输出密钥 |
| 日反馈 | packaged Electron + 1 条合成日志 | 返回 `review`，正文长度 246，约 7.7 s；隔离数据成功落盘 |
| 周复盘 | packaged Electron + 2 条合成日志 | preview 2 条材料，返回 `review`，正文长度 810，约 8.9 s；`weekly` 成功落盘 |
| 月复盘 | packaged Electron + 2 条合成日志 | preview 2 条材料，返回 `review`，正文长度 1003，约 30.3 s；`monthly` 成功落盘 |
| 知己 Agent | packaged Electron + 无工具短请求 | 返回 `idle`，assistant 回复长度 5，约 1.0 s |

真实冒烟输出只保留 provider/model、是否有 key、耗时、结果类型/长度和落盘类型；没有记录 API Key、真实用户日志、完整 prompt、完整响应或推理内容。项目复盘、洞察复盘和 Agent 的真实联网搜索未额外调用；其路由、schema、取消、previewToken、工具调度和失败边界由离线集成/单元测试覆盖。

## 界面与 Electron 截图

截图来自当前 packaged-asar 和隔离合成数据，覆盖浅色开始页、日志页、周期材料预览与暗色日志页：

- [开始页浅色](acceptance-2026-09-09-start-light.png)
- [日志页浅色](acceptance-2026-09-09-journal-light.png)
- [周期材料预览](acceptance-2026-09-09-review-materials.png)
- [日志页暗色](acceptance-2026-09-09-journal-dark.png)

已确认保存后正文不因 AI 失败消失，历史/日志布局无横向溢出，主题和侧栏页面标题在真实 Electron 中可见。截图不包含用户真实数据。

## 验证结果

- `npm test -- --run`：60 files / 401 tests passed。
- `npm run typecheck`：passed。
- `npm run lint`：0 errors / 7 existing warnings。
- `npm run package`：版本同步后重新生成并核对 v2.6.12 packaged-asar。
- packaged-asar E2E：7 passed / 2 skipped；跳过项是安装版路径/显式 API Key 才能运行的用例。
- `git diff --check`：无内容错误；仅有既有工作树的 LF/CRLF 提示。

## 剩余项

- Windows 原生 `select` 展开 popup 仍需人工展开确认；当前 CUA 无法绑定 Electron 原生窗口，因此不把关闭态页面截图冒充 popup 证据。
- 尚未执行 `make`、安装/升级/卸载、代码签名、Windows 干净机矩阵、提交或推送；这些不在本轮授权范围内。
