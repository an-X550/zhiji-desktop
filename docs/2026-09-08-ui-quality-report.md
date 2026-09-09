---
created: 2026-09-08
status: completed-offline
---

# 桌面端 UI 优化质量记录

本轮依据 [UI 审查](2026-09-08-ui-design-review.md) 与 [执行计划](2026-09-08-ui-design-plan.md)，在用户明确指定的 `apps/zhiji-desktop` 范围内完成 UI 优化和离线验收。未读取真实日志、密钥或调用真实模型；未安装、发布、提交或推送。

## 已交付

- 收敛为平整的中文写作工作台：紧凑侧栏与顶栏、单一页面主标题、减少普通卡片阴影、统一浅色/暗色语义变量和控件焦点样式。
- 日志页改为单一主写作区：日期/项目同排、模板入口降级到正文标题行、正文输入保持 240px、保存动作边界在首屏内；未引入自动保存，离开未保存内容仍需确认。
- Agent 页改为会话栏 + 有界消息区 + 底部输入区；工具活动、证据和审批保持可见；证据 `hit.id` 可精准打开对应日志/复盘，删除或缺失记录不会静默回退到第一条。
- 应用级保存 Agent 审批状态，离开 Agent 页面后返回仍能看到待确认项；设置标签补齐 ARIA 关联和方向键切换。
- Modal 使用原生 `dialog` 的焦点圈定、Escape 取消、关闭后焦点恢复和短窗口内部滚动； Markdown 表格使用局部横向滚动。
- 开始页、复盘、历史记录、设置和项目页统一层级与留白；未改变预览 token、approval ID、备份恢复、数据目录和保存语义。

## 视觉与交互矩阵

合成数据使用 48 条长日志、1 个项目和 20 个 Agent 会话。截图位于 [`ui-audit-2026-09-08/`](ui-audit-2026-09-08/)。

| 检查 | 结果 | 证据 |
|---|---|---|
| 日志首屏（1186×718） | 通过；正文 240px，主保存按钮边界 715.8px，完整落在 718px 视口内 | `source-final/journal.png`，Playwright bounding-box 探针 |
| 长历史列表（1440×900） | 通过；48 行，工作区 `scrollHeight=3621`、`clientHeight=852` | `quality-matrix/history-light-1440x900.png`、`metrics.json` |
| 窄窗口历史（960×640） | 通过；无横向溢出 | `quality-matrix/history-light-960x640.png`、`metrics.json` |
| 暗色设置/日志/Agent | 通过；没有白底漏出，共享 select 箭头不重复 | `quality-matrix/settings-dark-960x640.png`、`journal-dark-960x640.png`、`agent-dark-960x640.png` |
| Modal 键盘 | 通过；Tab 焦点留在 dialog，Escape 关闭，焦点恢复到“管理模板” | `metrics.json` |
| Agent 输入区 | 通过；960×640 下输入区 bottom=622.7px，仍在视口内 | `quality-matrix/agent-dark-960x640.png`、`metrics.json` |
| 125% / 150% 缩放 + reduced motion | 通过；125% 与 150% 下无横向溢出，减少动效媒体条件生效 | `quality-matrix/agent-dark-zoom125-reduced-motion.png`、`agent-dark-zoom150-reduced-motion.png` |

Impeccable detector 运行一次，返回 1 个证据卡左侧强调边框和若干已有 `--ease-spring` 命名告警。前者是 Markdown 引用的明确层级，后者实际为平滑 cubic-bezier、并非弹跳动画；均未改变为装饰性 UI。

## 前后端联动验收

- B1 已完成：Agent 证据跳转携带已校验的本地 `id`，日志和复盘历史阅读器精准选中；缺失 ID 显示明确空态。定向测试覆盖日志、复盘和删除后不回退。
- B2 已测量：现有 MiniSearch 热路径基准为 100/1,000/5,000 条合成日志约 34/249/1,256ms，5,000 条最大事件循环延迟约 166ms。当前没有把“全量摘要接口”作为猜测性改动引入；后续若真实用户数据出现明显卡顿，再按读取、IPC、渲染分解定位。
- B3 已完成：待确认审批状态从 Agent 页提升到应用级，离页返回不会丢失；仍复用原 approval ID，不重放写入。

## 自动化验证

- `npm test`：60 个测试文件、389 个测试通过。
- `npm run typecheck`：通过。
- `npm run lint`：0 errors，7 条既有 warning。
- `npm run package`：通过，生成本地 packaged-asar。
- `npm run test:e2e`：6 passed、2 skipped；skip 仅针对显式安装版/真实 API key 场景。
- `npm run benchmark:memory`：100/1,000/5,000 条热路径分别约 34/249/1,256ms。
- `git diff --check`：本轮修改无 trailing whitespace。

## 未覆盖边界

未执行真实模型质量 A/B、安装版真实 Agent、Windows 安装/升级/卸载矩阵、OS 级强杀或 Electron 崩溃恢复；这些不是本轮 UI 离线验收的证据，继续沿用现有显式条件和发布边界。
