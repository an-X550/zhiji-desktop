# zhiji Desktop Agent（知己 Windows 客户端）

> A local-first Windows app with a controlled evidence-grounded Agent for journaling, reflection, and testable actions.

这是 zhiji（知己）的独立 Windows 单机应用。它把日志、项目、复盘和行动验证放在本机，并内置一个受控 Agent，帮助你从自己的记录中找出有证据支撑的模式，形成下一步小行动，再用后续结果校准判断。

它不是整个 zhiji，也不是通用电脑控制 Agent：不运行 Claude/Codex Skill，不要求 DeepSeek Harness，不提供云同步、Shell、任意文件操作或浏览器控制。

- [下载 v2.6.15](https://github.com/an-X550/zhiji-Desktop-Agent/releases/tag/v2.6.15)
- [提交问题](https://github.com/an-X550/zhiji-Desktop-Agent/issues)
- [查看主项目](https://github.com/an-X550/zhiji)
- 许可证：[MIT](LICENSE)

## 先判断它是否适合你

适合你，如果你：

- 想在 Windows 电脑上本地保存日志、项目和复盘；
- 愿意配置 OpenAI、DeepSeek 或其他 OpenAI 兼容服务的 API Key；
- 想让 Agent 引用有限的本地证据和受控公开来源，而不是生成泛泛摘要；
- 接受这是单机单用户应用，不是云端协作平台。

不适合你，如果你需要：

- 手机、macOS、Linux 或多用户协作；
- 自动后台同步、云端托管或跨设备实时同步；
- 任意文件读取、Shell、浏览器控制或通用 Computer Use；
- 自动把桌面数据同步到 zhiji Skill、用户版或 DSH 插件。

## 最短使用路径

### 1. 安装

从 [v2.6.15 Release](https://github.com/an-X550/zhiji-Desktop-Agent/releases/tag/v2.6.15) 下载 `Zhiji-Setup-v2.6.15.exe`。GitHub 自动生成的 `Source code (zip)` 是源码，不是安装程序。

当前安装包未进行代码签名，也不承诺应用内自动更新或完整的 Windows 10/11 干净机安装矩阵。SmartScreen 显示“未知发布者”时，请先确认下载来源。

### 2. 配置模型

打开 `设置 → AI 与个性化`，选择 OpenAI、DeepSeek 或其他 OpenAI 兼容服务，填写模型名称、可选的 API 地址和自己的 API Key，然后点击“保存并测试”。

API Key 由 Electron 主进程交给 Windows `safeStorage` 加密保存；界面不会再次显示原值。没有 API Key 时，仍可写日志、管理项目和查看已有内容，但不能生成 AI 反馈、复盘或使用 Agent。

### 3. 完成一个闭环

进入 `日志`，记录今天实际发生的事件、行为、结果和状态。保存后生成今日反馈，应用会优先给出一个有原文支撑的主要洞察、一个少于五分钟的行动和一个明天可观察的验证点。

下一次记录行动结果：

```text
上次行动：做了 / 没做 / 做了一部分
结果：发生了什么
判断：支持原假说 / 出现反例 / 仍待验证
```

核心链路是：

```text
记录 → 反馈/复盘 → 行动 → 验证 → 校准
```

## Agent 的真实边界

Agent 是完成复盘闭环的一种受控能力，不是能够操作整台电脑的通用代理。

| Agent 可以做什么 | 明确不能做什么 |
| --- | --- |
| 只读检索日志、日反馈、周期复盘、项目和已确认验证模式 | 执行 Shell、任意文件操作或任意路径扫描 |
| 通过受控搜索和来源读取获取有限公开信息 | 接受任意 URL 或控制浏览器 |
| 在当前会话中组合已注册的高层工具 | 后台常驻、自行定时或自主运行 |
| 在正式日志、反馈和复盘改变前先生成预览，等待用户确认 | 绕过确认门直接写入正式内容 |
| 保存并恢复本地 Agent 会话 | 读取 API Key 或把凭证交给 Renderer |

材料不足或来源冲突时，Agent 应降低结论强度并明确证据缺口，而不是补写用户经历。

## 本地数据与隐私

默认业务数据目录是 Windows“文档”文件夹下的 `知己`：

| 路径 | 内容 |
| --- | --- |
| `journals/` | 日志 Markdown |
| `reviews/` | 日反馈、周报、月报、项目复盘和洞察结果 |
| `projects/` | 项目状态与关联关系 |
| `profile/about-me.md` | 只有用户主动提供并允许 AI 使用时才参与分析的个人背景 |
| `templates/` | 日志模板 |
| `runtime/` | Agent 会话和有限运行状态 |

应用级配置和加密凭据通常位于：

```text
%APPDATA%\知己\zhiji-config.json
%APPDATA%\知己\credentials.json
```

备份可以包含日志、复盘、项目、个人背景和公开配置，但不包含 API Key 或缓存。真实日志默认只保存在你选择的本地目录；本地保存不等于磁盘加密或访问控制。

## 与其他 zhiji 入口的关系

四个入口各自拥有运行时和数据边界：

| 你想做什么 | 应进入哪里 | 是否与本应用自动共享数据 |
| --- | --- | --- |
| Windows 本地日志、复盘和受控 Agent | 本仓库 | 本应用自己的数据目录 |
| 用 Codex/Claude 读取 Markdown 并运行完整 Skill | [用户版分发包](https://github.com/an-X550/zhiji-Agent-Skill) | 否 |
| 在 DeepSeek Harness Profile 中使用复盘 Skill | [DSH 插件](https://github.com/an-X550/zhiji-DSH-Plugin) | 否 |
| 查看产品总览、共享契约和开发入口 | [zhiji 主项目](https://github.com/an-X550/zhiji) | 不代表运行时同步 |

桌面端不读取、执行或修改 Claude/Codex 的 `.claude` Skill 系统，也不要求安装 DSH。需要手机消息入口或飞书/滴答结果分发时，请从用户版说明开始，而不是把本应用当作同步服务。

## 从源码运行

需要 Windows、Git、Node.js 22 或更新版本以及 npm：

```powershell
git clone https://github.com/an-X550/zhiji-Desktop-Agent.git
cd zhiji-Desktop-Agent
npm ci
npm start
```

不要直接双击源码目录，也不要用 `electron .` 替代 `npm start`；Electron Forge 需要先生成正确入口。

常用验证与构建命令：

```powershell
npm test
npm run typecheck
npm run lint
npm run provider:smoke
npm run package
npm run make
npm run test:e2e
```

更详细的开发资料：

- [安装、打包与分发指南](docs/install-package-distribute.md)
- [Skill 兼容矩阵](docs/skill-compatibility-matrix.md)
- [架构说明](docs/architecture.md)
- [DSH 集成说明](docs/dsh-integration-notes.md)

## 版本与发布边界

当前源码和最新公开发布版本为 `2.6.15`。本轮包含桌面端前后端优化、日志与日反馈来源隔离、生成缓存与强制重生成、Agent 视口与交互可达性修正，以及 Windows Squirrel 安装包重新构建。README 不承诺未完成的能力，包括代码签名、应用内自动更新、完整 Windows 10/11 干净机安装矩阵、云同步和跨平台客户端。

## 许可证

[MIT](LICENSE)
