# 知己日志视觉精修执行计划
状态：阶段 0–3 已完成；后续验收修正也已完成。执行依据：[DESIGN.md](DESIGN.md)，基础结果见 [IMPLEMENTATION-RESULT.md](IMPLEMENTATION-RESULT.md)，验收修正结果见 [ACCEPTANCE-FIX-IMPLEMENTATION-RESULT.md](ACCEPTANCE-FIX-IMPLEMENTATION-RESULT.md)。
工作目录：`C:\Users\panda\.claude\skills\知己\apps\zhiji-desktop`。

本轮按阶段 0–3 完整执行，不在方案或预览时停下；阶段 4 是后续路线，不属于本次自动实施范围。

## 0. 最小准备
1. 读取适用规范、根 ai-operating-principles、development-governance、当前 VERSION/PROJECT_STATUS 与 CHANGELOG 最近 5 条；执行时复读版本，不硬编码下一版本。
2. 查看 git status/diff，保留已有大量前后端改动；用户明确指定此目录，不因父级旧文档称 apps 为快照而切换仓库。
3. 阅读本目录 DESIGN、样板 HTML 与最终截图；只读对应 renderer、package.json、既有 E2E 启动方法，不全仓扫描。
4. 用当前源码与隔离合成数据捕获改前日志图。历史图片可能来自不同源码/打包版，只作视觉参考，不能代替此次运行记录。

完成条件：明确本次文件范围、旧界面和当前测试入口；不创建新 spec/审批流程，不重复做风格调查。

## 1. 移植共享样式与真实日志页
| 文件 | 要做的事 |
|---|---|
| src/index.css | 合并到现有 token，更新导航/工作底/写作面/按钮/正文样式；优先局部类，删除被替换规则而非尾部层层覆盖 |
| src/renderer/app/app-shell.tsx | 浅色侧栏、设置下置、紧凑工具栏；保留导航语义、未保存守卫、路由意图 |
| src/renderer/pages/today-page.tsx | 日期文档标题、按需日期控件、紧凑项目/模板、正文与操作区；接回所有现有 state/handler |
| components/button.tsx、field.tsx、page-header.tsx | 仅必要时扩展小型样式变体；不让全局修饰破坏其他页面 |
| features/templates/template-manager.tsx | 优先直接复用；仅入口位置/键盘衔接必要时修改 |
| components/markdown-document.tsx | 仅在反馈阅读区需要时调整局部样式；保留表格横滚和长链接行为 |

按真实任务组织内容，不直接复制样板 DOM 整块替换 App。操作条在写作区底部可见；正文内部滚动，反馈与最近记录可在页面级阅读区域继续访问。不要固定整个页面使结果或按钮无法到达。

必须保留：
- 日志日期/关联项目、模板追加、模板管理、编辑历史、仅保存与今日反馈；
- 有今日日志但编辑器为空时的既有生成能力；
- 无 Key/历史日期条件、保存失败/生成失败恢复、正在执行时重复点击保护；
- 切换历史/导航时未保存确认与中文 composition；
- 模板/日期展开后的焦点、Escape 和窄窗口弹层不裁切。

阶段完成条件：真实数据保存路径未变，真实日志画面达到认可样板的结构和细节；不是旧表单换绿色/圆角。没有演示栏、固定日期、假成功或合成正文进入生产。

## 2. 修已证实缺陷与共享回归
- Agent：先复现当前打包/源码下的缩放裁切。此前有效高度约 601px、发送按钮 bottom 622.7px。修复仍存在的固定最小高度组合，按剩余空间划分头部/消息/操作区。历史消息/工具结果可滚动，输入/发送/待审批可达。
- 对比度：普通文字与 placeholder ≥4.5:1；大字及必要控件边界/焦点 ≥3:1。按实际背景检测。
- 共享回归：浏览开始、Agent、日志历史、复盘、项目、设置。修共享 token/外壳造成的退化即可，不顺手重排其他页。
- 既有 B1 精确证据与审批恢复不重做；B2 前端加载/IPC/渲染未测仍记未测。MiniSearch 基准只属于检索，不据此新增 API。

完成条件：已证实裁切修复或经当前运行证明确已不存在；共享变更没有遮挡/破坏原流程。

## 3. 验证与交付
### 行为检查
以当前测试为基础，先定向运行：
```powershell
npx vitest run tests/unit/today-page.test.tsx tests/unit/app-shell.test.tsx tests/unit/app.test.tsx tests/unit/agent-page.test.tsx tests/unit/settings-page.test.tsx
npm run typecheck
npm run lint
```
仅当新增日期/模板交互有真实风险时补必要测试；不能通过删除业务断言或只改 snapshot 使测试变绿。全部修改完成后运行一次 `npm test`。

### 运行检查
- 合成数据、临时 dataRoot/userDataRoot，不读真实密钥、不调用付费模型。
- 真实 Electron：1186×718 明/暗、960×600 等效可用视口、1440×900；实际 125%/150% 缩放另外记录 innerWidth/innerHeight。
- 日志空白、有字、长文、历史补写、已有今日记录、失败/生成中；Agent 长消息和审批；所有低频页面做共享回归。
- 日期/模板/Modal 的 Tab、Escape、焦点恢复，中文输入；长文局部滚动、反馈可读、主按钮完整可见。
- 按钮 bottom 与实际 innerHeight 对比，目标留约 16px 或以上的合理余量；无横向溢出不等于缩放通过。
- 截图排除演示控制栏，保持前后视口、主题、合成内容一致，等待字体/动画稳定。
- 一轮批量检查后集中修复，再一轮确认；必要缺陷继续解决，已达标后停止可选打磨。impeccable detector 仅在所用流程要求时对改动目标运行一次，人工筛查误报，不用分数代替视觉检查。

打包验证运行一次 `npm run test:e2e`（当前 pretest:e2e 会先 package），不要先重复 package；不跑 make、不覆盖安装版。真实安装版/API 缺显式配置保持 skip，说明即可。

### 交付要求
在 `docs/visual-redesign/IMPLEMENTATION-RESULT.md` 写简短记录：
- 实际修改文件和本轮范围；日志/外壳与样板的对照图；
- 当前源码/打包版本、视口、数据条件和关键 bounding box；
- 实跑命令结果、跳过项、样板差异与残留问题；
- 明确其他页面未做结构改版，真实 AI 未测，不把样板验证充作 Electron 验证。

按根治理处理实际版本与 CHANGELOG/PROJECT_STATUS；不提前写已完成，不默认 commit/push/tag/release。仅清理本次明确创建的临时进程/数据，保留用户与其他任务改动。

## 4. 后续路线，非本次自动实施
日志实际使用成立后，再沿同一体系推广 Agent → 历史/项目 → 复盘/设置 → 开始。此阶段需要另行明确实施范围；方向不再重新发散。完成 0–3 即完成本次任务，不因未执行本节而无限扩展。
