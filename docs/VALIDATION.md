# 验证与本地更新

本文维护检查入口、验收范围、验证证据和本机更新流程。验收矩阵描述应覆盖的行为；已有执行结果只对注明的版本与范围有效。当前源码版本以 `package.json` 为准。

## 检查选择

根据改动选择必要检查，不依次执行全部命令。同一目的的修改集中验证；修复失败后只重跑受影响部分。单纯文档修改检查链接、图片、旧文件名引用与 `git diff --check`，不重跑功能测试。会弹出窗口的宿主集成测试需按 [项目规则](../AGENTS.md) 先取得用户明确同意。

| 改动范围 | 检查入口 | 说明 |
| --- | --- | --- |
| TypeScript 类型与跨层协议 | `npm run typecheck` | 无界面，不生成产物 |
| 明确模块的逻辑或 Git 行为 | `npx vitest run tests/<相关文件>.test.ts` | 选择实际相关文件；Git 测试使用临时真实仓库及本地 Bare Remote |
| 影响范围无法可靠缩小的核心变更 | `npm test` | 全量 Vitest；说明为何需要扩大范围 |
| 构建或扩展实现 | `npm run build` | 生成扩展和 Webview 产物，构建本身不证明行为正确 |
| 浏览器专项 | 先构建，再使用下表的 `node scripts/test-ui.mjs --…-only` | 无头 Playwright，验证构建产物；单个专项不运行全部 UI 检查 |
| 整体界面交互 | `npm run test:ui` | 先构建再运行完整浏览器验收 |
| VS Code API 与扩展宿主 | `npm run test:extension` | 先构建；会启动 Extension Development Host |
| 跨窗口路由 | `npm run test:windows` | 先构建；会启动并切换测试窗口，可能影响桌面焦点 |

浏览器专项入口：

| 参数 | 主要范围 |
| --- | --- |
| `--appearance-only` | 设置、主题、配色、字体、尺寸与恢复布局 |
| `--files-only` | 文件状态图标、选择、目录显示、菜单、分组操作和 Stage All / Unstage All 确认 |
| `--history-only` | Commit / Working Tree 行、选择、比较和键盘操作 |
| `--diff-only` | 修改块统计、导航、滚动和内容更新 |
| `--worktrees-only` | 仓库归并、Worktree 选择及草稿隔离 |
| `--remote-tracking-only` | 远程来源、本地跟踪分支与批量创建 |
| `--feedback-only` | 操作反馈、Commit 结果摘要与查看入口、冲突后关闭与中止、标记暂存、结果检查、继续确认和 Commit 入口保护 |

每次选择一个专项参数；脚本使用互斥分支，不会把多个参数组合执行。刷新专项包含在完整 UI 流程中，目前没有独立命令行参数。

浏览器脚本以 `?demo=1` 加载产物，默认无头运行。Windows 默认使用 Microsoft Edge，其他平台使用 Playwright Chromium；可用 `ALWAYGIT_BROWSER_EXECUTABLE` 指定路径。Demo 只操作示例数据；即使使用受控宿主验证消息，也不能据此确认真实 Git、原生编辑器、剪贴板或窗口动作通过。

`test:extension` 默认下载并运行稳定版 VS Code；可通过 `ALWAYGIT_VSCODE_EXECUTABLE` 使用现有安装，或通过 `ALWAYGIT_VSCODE_VERSION` 检查指定版本。测试在系统临时目录创建独立仓库，网络操作使用本地 Bare Remote。

`test:windows` 使用独立临时 Profile、测试仓库和测试伴随扩展，验证项目窗口激活、跨窗口 Diff/编辑、保留标签和未保存文档，以及未打开项目的新窗口启动；测试进程不使用或关闭用户的 VS Code 窗口。多根工作区和不同 Worktree 的目录匹配同时由 IPC 单元测试覆盖。

## 浏览器验收矩阵

- 固定四区 Workbench、旧 Editor Focus 会话迁移、面板和列拖动、Diff 动态最大高度与收起恢复、仅恢复布局而不重置界面设置的 Restore Layout、窄窗口和主题。
- 设置浮窗分级导航、预览、取消、应用、刷新期间的持久化；宿主主题与主题卡片优先级、丰富明暗主题、可配置未推送角标、字号和密度同步虚拟行高、Graph 预设及自定义浅色/深色色板的连续性与分页。
- Repository、Local Branch、Remote Branch、Remote、Tag、Stash、Worktree 的对象菜单；分组标题单击只折叠内容，右侧图标执行分组操作，右键标题打开相同操作菜单，Local Branches 的 Graph 预设具有激活状态。Repository 单击、Ctrl/Cmd、Shift、Ctrl/Cmd+A 与 Escape 管理独立的批量操作选择，右键遵循所选范围，双击或 Enter 才切换；Worktree 单击只聚焦、双击或 Enter 切换。当前 Repository、Worktree 和本地分支使用排头实心三角形及 `aria-current`，与 Repository 蓝色操作选择相互独立；浅色背景为纯黑、深色背景为纯白，不显示 Current 文字徽标。
- 菜单指针定位、视口边缘修正、竖向排列、键盘焦点、Escape 与点击外部关闭。
- 右键对象与操作对话框目标一致；仓库切换后旧菜单和对话框关闭。
- 递归分支目录、目录展开、三态目录选择、多引用选择、共同提交去重、清空选择、分页、搜索、HEAD 标记及 Locate HEAD。
- Commit 整行悬停、指针、选择、已推送实心节点与粗体消息、本地未推送空心节点与常规消息、各列双击、键盘焦点、本地分支 Checkout 及 Detached HEAD 对话框；Working Tree 使用独立菱形虚拟节点紧邻当前 HEAD，显示变更、冲突和分支，并支持整行选择及上下方向键导航。
- English / 简体中文切换，并验证 Git 命令、分支、路径和草稿保持不变。
- 切换仓库或重载后恢复筛选、选择、布局和 Commit 草稿。
- 文件以 `./` 开头的完整多层相对父目录、形状与颜色不同的状态图标及 Tooltip、Working Tree / Commit Details / Commit 比较的单击/Ctrl/Cmd/Shift 选择及无复选框交互、文件区域 Ctrl/Cmd+A、原生文本框全选、提交文件路径复制、所选文件直接 Stage / Unstage、Stage All / Unstage All 数量确认与确认按钮默认焦点，以及显式 Discard。
- Push 等操作进行中、成功、失败与目标；Commit 成功短哈希、提交文件数、剩余变更数和查看入口；错误详情、日志；持久冲突条、查看冲突、Continue 禁用原因与待检查状态；标记暂存不保证内容正确、暂存版本检查、标记行号、返回检查、明确继续确认、活动操作 Commit 入口与草稿保留；冲突后关闭窗口不 Abort、中止入口及恢复目标说明。
- Diff 修改块外框、新增/修改/删除块统计、无边框当前/总块数、箭头、手动滚动、刷新重映射、缩放、长行横向滚动和截断计数。
- Stash、Commit、浅色/深色及两种高对比主题、减少动态效果、未推送数量角标，以及默认与自定义 Push 目标。
- Demo 中的原生宿主按钮只验证发出明确请求和提示，不把模拟结果当作真实 VS Code 验证。

## Git 与宿主验收矩阵

- 添加分类目录递归发现多层仓库、`.git` 文件 Worktree、已有仓库去重、一次保存与列表通知、取消不产生部分添加；损坏仓库与无法访问目录跳过，目录链接和 junction 不跟随，已有会话保持。
- 同一共享 Git 存储的工作目录在顶层只显示一次；独立克隆与独立 Git 存储保持正确身份。覆盖旧保存路径恢复、直接添加 Worktree、VS Code 自动发现、主目录优先选择、活动 Worktree / 菜单目标、各工作目录草稿与文件状态隔离。
- 多引用历史首次查询与分页使用相同 tips，共同祖先无重复。
- Checkout 成功、当前分支、脏文件可能被覆盖、未解决冲突和 Worktree 占用；单个远程分支创建并 Checkout、本地跟踪分支复用和 Stash 重试。
- 远程分支目录递归批量创建本地跟踪分支，保持当前 HEAD；批量名称、upstream、符号引用、远程来源和层级冲突在写入前完成验证。
- `Stash Changes & Checkout` 分步结果；Checkout 失败时保留已经创建的 Stash。
- Apply、Pop、Drop Stash 在列表变化后仍验证正确对象。
- Stash 详情分别验证 Working Tree、Index 与 Untracked Files，按路径去重汇总文件数；仅含未跟踪文件时默认打开该分类，空分类给出内容位置与直接跳转，创建成功反馈说明保存范围和工作区状态。
- 同一文件同时含 Staged / Unstaged 修改时，Discard 只处理工作区一侧。
- Detached HEAD、Tracking Branch、Tag Checkout 和主 / 当前 / Locked Worktree 限制。
- Push 目标配置解析、不同名称的本地 / 远端分支 refspec 及 upstream 建立。
- 同 Remote 的远程分支单项和批量删除、符号引用限制、身份校验、确认清单及部分失败汇总。
- Diff 文本、二进制、大小限制、删除 / 重命名、Merge Parent 和冲突 Stage。
- VS Code 原生 Diff、普通编辑、剪贴板、打开 Worktree、新 AlwayGit 标签协议和新窗口。
- 多仓库共享 `commonDir` 的串行写操作与活动状态。

## 打包与本地更新

```powershell
node scripts/package.mjs
```

打包由 VSCE 触发 `vscode:prepublish` 完成构建；无需在紧接着打包前重复构建。成功后才替换固定包 `artifacts/alwaygit.vsix`，保留上一份 `artifacts/alwaygit-previous.vsix` 和带版本号的包；失败时保留原固定包。

扩展修改通过相应检查后，按已授权流程安装到实际使用的 VS Code：

```powershell
scripts/update-local.ps1
# 若已成功生成当前版本包，跳过重复构建：
scripts/update-local.ps1 -InstallOnly
```

两条命令按情况择一。脚本沿用 `artifacts/local-install.json` 中记录的 CLI 和 Profile；首次默认使用 PATH 中的 `code` 和默认 Profile。可用 `-CodePath` / `-Profile` 或 `ALWAYGIT_CODE_CLI` / `ALWAYGIT_VSCODE_PROFILE` 显式指定目标。

脚本检查包身份和版本，调用官方 CLI `--install-extension <VSIX> --force`，再核对已安装扩展 `alwaygit-dev.alwaygit` 的版本。只有安装及校验成功后，才可告知用户方便时重启 VS Code；脚本不自动关闭或重启用户窗口。仅替换 VSIX 不代表已安装扩展更新成功。

扩展身份保持不变，功能版本正常递增，不通过卸载或删除用户数据更新。全部安装包、本机安装记录、构建输出、截图、报告、trace、缓存和日志均不提交。文档整理无需触发扩展重新打包安装。

## 验证证据与覆盖边界

2026-10-01 文档整理时，源码版本为 0.16.0。此前本文件可追溯的功能执行记录对应 0.10.0；它只支持下表的既有结论，不代表 0.16.0 已完成同范围复测，也不能据此推断后续版本未经过检查。问题级回归摘要见 [问题日志](ISSUES.md)。

| 证据范围 | 日期 / 版本 | 已记录结果与限制 |
| --- | --- | --- |
| 类型、状态及路径逻辑 | 2026-10-01 / 0.10.0 | 类型检查通过；`ui-state`、`file-selection` 两个文件 34 项通过，覆盖设置保存/回滚、角标颜色及目录标签 |
| 生产构建与浏览器专项 | 2026-10-01 / 0.10.0 | 构建、无头 Edge 的 `--appearance-only` 与 `--files-only` 通过；范围为主题、角标、布局恢复和文件交互 |
| 打包与本机安装 | 2026-10-01 / 0.10.0 | 固定包、版本包生成及官方 CLI 安装核对通过；此记录不是当前本机安装状态，本机目标与状态以忽略目录中的安装记录和实际 CLI 核对为准 |
| 仓库管理、完整 Git 行为及窗口桥接 | 上述 0.10.0 执行范围之外 | 该记录未包含相关复测、完整 Vitest 或 `test:windows` 的新结果 |
| 文档整理 | 2026-10-01 / 源码 0.16.0 | Markdown 本地链接、标题锚点、图片及旧文件名引用检查通过；`git diff --check` 通过。未运行功能测试，未重新打包或安装扩展 |
| 暂存确认与 Commit 结果反馈 | 2026-10-02 / 0.18.0 | 类型检查、生产构建、无头 `--files-only` 与 `--feedback-only` 通过；固定 VSIX 打包并通过官方 CLI 安装及身份/版本核对。未启动真实 VS Code 桌面集成测试 |
| Workbench 唯一入口、多标签/窗口与跨窗口安全 | 2026-10-02 / 0.19.0 | 类型检查、6 个相关 Vitest 文件 40 项、生产构建与完整无头界面套件通过；界面脚本显式验证新 Workbench 初始不选择仓库，并适配各受控宿主在 Workbench 内选择仓库。固定 VSIX 打包并通过官方 CLI 安装及 `alwaygit-dev.alwaygit@0.19.0` 核对；按规则未启动会弹窗的真实多窗口 VS Code 集成测试 |

macOS、Linux、WSL、Remote SSH、Dev Containers 和最低支持版本仍需相应环境的专项证据。验收矩阵、架构兼容性和测试文件的存在都不等同于这些环境已通过验收。
