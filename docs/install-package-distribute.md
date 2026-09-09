# 知己桌面端：安装 · 打包 · 分发指南

> 适用版本：当前源码与本次发布均为 v2.6.15。本文回答三个问题：怎么装、怎么打包、怎么发给别人；并附当前产品的文件职责清单。

---

## 一、如何安装

产物分两种形态，任选其一即可：

| 形态 | 路径 | 说明 |
| --- | --- | --- |
| **v2.6.15 安装版** | `out/release-candidate/v2.6.15/Zhiji-Setup-v2.6.15.exe` | 本次 Squirrel 发布包，三件套来自同一次 `npm run make` |
| **v2.6.15 packaged-asar** | `out/知己-win32-x64/知己.exe` | 本地免安装版，已通过打包 E2E |

### 安装版流程（Setup.exe）

1. 双击 `Setup.exe` → 等待安装进度条走完。
2. 安装位置：`%LOCALAPPDATA%\知己\`（Squirrel 默认装到本机应用目录，不需要选择）。
3. 首次启动后，数据默认落在 **`文档\知己`**；在设置 → 数据与隐私可查看、打开或更改该目录。

### 免安装版流程

1. 把整个 `out/知己-win32-x64/` 文件夹拷到任意位置。
2. 双击其中的 `知己.exe` 运行。数据同样默认落在 `文档\知己`。

> 两种形态共用同一份本地数据（默认 `文档\知己`），切换形态不会丢数据。

本次 v2.6.15 已生成并验证 packaged-asar 与 Squirrel 三件套；仍不要把未实际安装的免安装目录称作已安装版本。

---

## 二、如何打包

在仓库根目录执行。**先同步版本号**：改 `package.json` 的 `version` 与仓库根目录 `VERSION` 文件，保持一致（`app.getVersion()` 读取的是 package.json 的 version）。

```bash
cd zhiji-Desktop-Agent

# 安装依赖（首次）
npm install

# 1) 免安装版（快速，产出 out/知己-win32-x64/）
npm run package

# 2) 安装版（产出 Setup.exe + nupkg，用于分发）
npm run make
```

DSH 的外置 ESM 包使用了 peer-only 运行依赖；桌面端已将实际运行所需的 DSH peer 包声明为 production dependencies，并由 Forge 保留在 `app.asar` 中。不要只依赖本机 `node_modules` 中的传递安装结果，否则开发模式可能正常而安装版会在主进程启动时出现 `ERR_MODULE_NOT_FOUND`。

### 本机打包的两个环境坑（必须带上）

本机（WorkBuddy 环境）打包需要绕过两个注入，否则可能失败：

```bash
# 完整可用命令（复制使用）
HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= \
NODE_OPTIONS="--use-system-ca" \
npm run make
```

- `NODE_OPTIONS="--use-system-ca"`：去掉 WorkBuddy 注入的 safe-delete 拦截（它会拦截构建工具的 rm 并报错）。
- 置空 `HTTP_PROXY/HTTPS_PROXY`：本机代理指向 `127.0.0.1:7897` 但 Clash 未开时，下载 Electron/Squirrel 工具会 `ECONNREFUSED`。

### 镜像源（加速下载，已配置）

项目根已加 `.npmrc`，使用**阿里云 npmmirror**（不用清华源）：

```
registry=https://registry.npmmirror.com
electron_mirror=https://npmmirror.com/mirrors/electron/
```

首次在新机器 `npm install` 会走阿里云镜像，Electron 二进制也走镜像，速度快且不依赖 GitHub。若本机已有缓存，会自动复用，不会重复下载。

### 复用已有 Electron 缓存（离线打包）

Electron 二进制缓存于 `%LOCALAPPDATA%\electron\Cache\`。若发现 `node_modules\electron\dist\` 为空导致打包回退去下载，直接把缓存 zip 解压进去即可离线打包：

```bash
# 找到缓存 zip（例如 electron-v43.4.0-win32-x64.zip）
ls "$LOCALAPPDATA/electron/Cache"/*/
# 解压到本地 dist，之后 npm run package/make 不再联网下载 Electron
unzip -oq "$LOCALAPPDATA/electron/Cache/<hash>/electron-v<版本>-win32-x64.zip" -d node_modules/electron/dist
```

### 首次打包耗时

`npm run make` 首次会下载 Squirrel 打包工具，可能耗时数十分钟；`out/make/squirrel.windows/x64/` 出现文件不等于成功，必须同时确认命令退出 0、安装器元数据正确且三件套内部版本一致。之后再打包会快很多（工具已缓存）。

> ⚠️ **rcedit 或任何非零 `make` 都是失败**：即使 `out/make` 已出现 `Setup.exe`、`.nupkg` 或 `RELEASES`，也不得从失败运行的目录复制或分发任何文件。应从纯 ASCII 物理路径重新执行，直到退出码为 0，并确认安装器元数据正确、`RELEASES` 指向同版本 `.nupkg`、三件套文件版本一致。

需要绕过中文路径时，可用下面的安全 PowerShell 流程。当前 Forge/electron-packager 在 junction 下可能把路径解析为 symlink 并在打包阶段报 `EPERM`，因此这里使用 ASCII 物理副本；不要把 junction 当作当前版本的成功依据。脚本只在目标不存在时创建副本，并且只删除本次创建、已核对的临时副本：

```powershell
$desktopPath = (Resolve-Path '.').Path
if (-not (Test-Path -LiteralPath (Join-Path $desktopPath 'package.json'))) {
  throw '请在 apps/zhiji-desktop 目录执行此流程。'
}
$asciiPath = 'C:\zhiji-build'
$createdCopy = $false

if (Test-Path -LiteralPath $asciiPath) {
  throw "已有 $asciiPath；为避免覆盖未知内容，请先人工核对并移走它。"
}
New-Item -ItemType Directory -Path $asciiPath | Out-Null
$createdCopy = $true
try {
  robocopy $desktopPath $asciiPath /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /MT:16 /XD (Join-Path $desktopPath 'out') (Join-Path $desktopPath 'test-results') | Out-Host
  if ($LASTEXITCODE -gt 7) { throw "复制桌面端到 ASCII 临时目录失败，robocopy=$LASTEXITCODE" }

  Push-Location $asciiPath
  try {
    npm run make
    if ($LASTEXITCODE -ne 0) { throw "make failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
} finally {
  if ($createdCopy -and (Test-Path -LiteralPath $asciiPath)) { Remove-Item -LiteralPath $asciiPath -Recurse -Force }
}
```

`/XD` 使用源目录的完整路径，只排除桌面端自己的旧 `out` 与 `test-results`；不要写成单独的 `out`，否则会误排除依赖包内部的 `out` 目录。

---

## 三、如何分发

### 要发哪些文件

**给普通用户安装 → 只需发一个文件：**

```
out/release-candidate/v2.6.6/Zhiji-Setup-v2.6.6.exe
```

**一次发布的安装包由这三个 Squirrel 文件组成；对普通用户直接提供安装器即可：**

```
zhiji-x.y.z-full.nupkg   # 完整安装包（核心）
RELEASES                 # Squirrel 版本清单
Setup.exe                # 引导安装器
```

知己当前不提供应用内版本检查或自动更新；不要让用户填写发布地址，也不要把旧版 `检查更新` 文案当作发布能力。需要升级时，提供经人工验收的对应版本安装器。

### 免安装分发

把整个 `out/知己-win32-x64/` 文件夹打包成 zip 发给用户，用户解压双击 `知己.exe` 即可。

### 当前限制（诚实边界）

- **未代码签名**：Windows SmartScreen 可能提示「未知发布者」，需点「仍要运行」。正式对外分发前建议购买代码签名证书。
- 未做自动更新、未验证 Windows 10 干净虚拟机、未做升级/卸载的完整回归；v2.6.8 目前只承诺用隔离临时数据根完成 packaged-asar 核心冒烟，v2.6.6 RC 仍是上一轮 Squirrel 证据。
- 数据目录与用户数据（API Key）是两处：换机器或重装需用「设置 → 数据与隐私 → 创建备份」迁移。

### 版本独立的本地 Release Candidate

每次准备分发时，先完成 `npm run package`、`npm run test:e2e`，再执行 `npm run make`。确认 `out/make/squirrel.windows/x64/` 是本次新生成的目录后，把本次三件套复制到版本独立目录：

```text
out/release-candidate/v2.6.15/
├─ Zhiji-Setup-v2.6.15.exe
├─ zhiji-2.6.15-full.nupkg
└─ RELEASES
```

只用该目录中的 `Zhiji-Setup-v2.6.15.exe` 做全新用户数据和核心功能验收；不要把旧 `out/make` 中的 `Setup.exe` 当成本次构建。旧版本 RC 保留不覆盖。远程发布只上传已经验收的同一份文件。

---

## 四、文件职责清单

### 4.1 本地数据目录（默认 `文档\知己`，可在设置里更改位置）

| 路径 | 内容 | 用途 |
| --- | --- | --- |
| `journals/<年>/<日期>--journal_<id>.md` | 每日日志 | 带 frontmatter（日期/项目关联）+ Markdown 正文，是复盘的最原始材料 |
| `reviews/<类型>/<年>/<日期>-review_<id>.md` | 各类复盘 | 类型：daily 日反馈 / weekly 周报 / monthly 月报 / project 项目复盘 / coach 日志质量 / yearly 年度回顾 / life-design 方向校准 |
| `projects/*.json` | 项目 | 项目名（全局唯一）、状态、时间；日志通过 `projectIds` 关联 |
| `profile/about-me.md` | 个人背景 | 用户主动提供的背景，仅在开启「允许 AI 使用」后注入复盘 |
| `patterns/verified-patterns.json` | 已验证模式快照 | 用户确认过的长期行为假说 |
| `topics/index.json` + `topics/<名>.md` | 旧版主题数据 | 历史主题正文保留在数据目录，但桌面端不再读取、写入或导出 |
| `templates/*.md` | 日志模板 | 写日志时一键插入的预设结构，文件名即模板名 |
| `settings.json` | AI 公开配置 | 服务商 id、baseUrl、模型名（**不含 API Key**） |
| `runtime/topic-sessions/*.json` | 旧版主题 checkpoint | 不主动删除；桌面端已移除主题会话运行时，需继续讨论时使用 Skill/CLI |
| `runtime/daily-feedback-audit.jsonl` | 日反馈审计摘要 | 追溯等级/结果/昨日行动，不含全文与 Key |

### 4.2 用户数据目录（`%APPDATA%\知己`，与数据目录分离）

| 路径 | 内容 | 用途 |
| --- | --- | --- |
| `credentials.json` | 加密的 API Key | 用 Windows safeStorage 加密，仅主进程读取 |
| `zhiji-config.json` | 应用级配置 | 自定义数据目录路径；历史 `updateUrl` 仅兼容读取，不再有用户界面或运行行为 |

### 4.3 源码结构（`src/`）

| 目录/文件 | 职责 |
| --- | --- |
| `main.ts` | Electron 主进程入口：创建窗口、调用 bootstrap |
| `main-process/bootstrap.ts` | 手工装配：读配置 → 建仓储/服务 → 注入 registerHandlers |
| `main-process/application/` | 业务用例：保存日志、生成各类复盘、验证模式、AI 配置 |
| `main-process/domain/` | 纯领域逻辑：任务状态机、材料选择、日反馈新鲜度等 |
| `main-process/infrastructure/` | 落地实现：Markdown/JSON 仓储、AI 服务商、凭据、传输、数据目录、模板 |
| `main-process/skill-runtime/` | Skill 行为的确定性复刻（显式 async 编排 + 证据分级 + 结构化输出校验） |
| `main-process/prompts/` | 各链路的提示词 + 输出解析（版本化） |
| `main-process/ipc/register-handlers.ts` | 所有渲染进程 ↔ 主进程的 IPC 通道注册 |
| `shared/schemas/` | Zod 契约（domain 数据结构 + ipc 输入）与 `desktop-api` 类型 |
| `shared/errors/app-error.ts` | 统一错误码 + 中文默认文案 |
| `preload.ts` | 上下文隔离桥：只暴露具名 API，不暴露 Node |
| `renderer/` | React 界面：页面、组件、hooks、设计令牌（`index.css`） |
| `tests/unit/` `tests/integration/` | 单元/集成测试（AI 调用一律注入假实现） |
| `forge.config.ts` | 打包配置：Vite 构建、Squirrel 安装器、Fuses 加固 |

### 4.4 项目根目录关键文件

| 文件 | 用途 |
| --- | --- |
| `VERSION` | 当前版本号（与 package.json 的 version 同步） |
| `CHANGELOG.md` | 每次变更记录 |
| `PROJECT_STATUS.md` | 项目当前状态、版本、决策记录 |
| `docs/specs/` | 需求/方案规格文档 |
| `docs/first-principles.md` `docs/development-governance.md` | 第一性原理与开发治理规范 |
