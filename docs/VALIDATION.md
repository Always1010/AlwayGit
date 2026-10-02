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
| `--workbench-only` | 整体布局、基础导航和宿主入口 |
| `--branch-only` | 分支创建、Detached HEAD 策略与 Push 引导 |
| `--stash-only` | Stash 详情、保存范围及恢复受阻 |
| `--refresh-only` | 后台刷新、选择保留和 Diff 更新 |
| `--appearance-only` | 设置、主题、配色、字体、尺寸与恢复布局 |
| `--files-only` | 文件状态图标、选择、目录显示、菜单、分组图标和 Stage All / Unstage All / Discard All 确认 |
| `--history-only` | Commit / Working Tree 行、选择、比较和键盘操作 |
| `--diff-only` | 修改块统计、导航、滚动和内容更新 |
| `--worktrees-only` | 仓库归并、Worktree 选择及草稿隔离 |
| `--remote-tracking-only` | 远程来源、本地跟踪分支与批量创建 |
| `--feedback-only` | 操作反馈、Commit 结果摘要与查看入口、冲突后关闭与中止、标记暂存、结果检查、继续确认和 Commit 入口保护 |

每次选择一个专项参数；脚本通过统一注册表选择对应检查，无参数时执行注册表中的全部专项。未知或多个参数会明确报错。

浏览器脚本以 `?demo=1` 加载产物，默认无头运行。Windows 默认使用 Microsoft Edge，其他平台使用 Playwright Chromium；可用 `ALWAYGIT_BROWSER_EXECUTABLE` 指定路径。Demo 只操作示例数据；即使使用受控宿主验证消息，也不能据此确认真实 Git、原生编辑器、剪贴板或窗口动作通过。

`test:extension` 默认下载并运行稳定版 VS Code；可通过 `ALWAYGIT_VSCODE_EXECUTABLE` 使用现有安装，或通过 `ALWAYGIT_VSCODE_VERSION` 检查指定版本。测试在系统临时目录创建独立仓库，网络操作使用本地 Bare Remote。

`test:windows` 使用独立临时 Profile、测试仓库和测试伴随扩展，验证项目窗口激活、跨窗口 Diff/编辑、保留标签和未保存文档，以及未打开项目的新窗口启动；测试进程不使用或关闭用户的 VS Code 窗口。多根工作区和不同 Worktree 的目录匹配同时由 IPC 单元测试覆盖。

## 浏览器验收矩阵

- 固定四区 Workbench、旧 Editor Focus 会话迁移、分支徽标与操作栏合并、右侧定位 HEAD 和双层文件夹/VS Code 纯图标按钮、底部常驻状态栏移除与顶部按需提示、面板和列拖动、Diff 动态最大高度与收起恢复、仅恢复布局而不重置界面设置的 Restore Layout、窄窗口和主题。
- 设置浮窗分级导航、预览、取消、应用、刷新期间的持久化；宿主主题与主题卡片优先级、丰富明暗主题、可配置未推送角标、字号、列表密度及独立 Diff 行高同步虚拟行高、Diff 自定义行高边界和旧设置兼容、Graph 预设及自定义浅色/深色色板的连续性与分页。
- Repository、Local Branch、Remote Branch、Remote、Tag、Stash、Worktree 的对象菜单；仓库行和仓库分组标题通过右键打开管理菜单；分区标题单击只折叠内容，右侧图标执行分组操作，Local Branches 的 Graph 预设具有激活状态。Repository 单击、Ctrl/Cmd、Shift、Ctrl/Cmd+A 与 Escape 管理独立的批量操作选择，不切换仓库，范围严格按当前显示顺序计算；双击或 Enter 切换仓库，右键遵循所选范围。Worktree 单击只聚焦、双击或 Enter 切换。当前 Repository 使用强调色仓库图标，Worktree 和本地分支保留排头实心三角形；三者均使用 `aria-current`，与 Repository 蓝色操作选择相互独立。三角形在浅色背景为纯黑、深色背景为纯白，不显示 Current 文字徽标。
- 菜单指针定位、视口边缘修正、竖向排列、键盘焦点、Escape 与点击外部关闭。
- 右键对象与操作对话框目标一致；仓库切换后旧菜单和对话框关闭。
- 递归分支目录、目录展开、三态目录选择、多引用选择及只按可见分支计算的 Shift 范围、共同提交去重、清空选择、分页、搜索、HEAD 标记及 Locate HEAD。
- Commit 整行悬停、指针、选择、已推送实心节点与粗体消息、本地未推送空心节点与常规消息、各列双击、键盘焦点、本地分支 Checkout、历史 Commit 创建并切换分支及高级 Detached HEAD 对话框；Working Tree 使用独立菱形虚拟节点紧邻当前 HEAD，显示变更、冲突和分支，并支持整行选择及上下方向键导航。
- English / 简体中文切换，并验证 Git 命令、分支、路径和草稿保持不变。
- 切换仓库或重载后恢复筛选、选择、布局和 Commit 草稿。
- 文件以 `./` 开头的完整多层相对父目录、形状与颜色不同的状态图标及 Tooltip、Working Tree / Commit Details / Commit 比较的单击/Ctrl/Cmd/Shift 选择及无复选框交互、文件区域 Ctrl/Cmd+A、原生文本框全选、提交文件路径复制、绿色暂存盒与红色回撤/垃圾桶分组图标；Stage All / Unstage All 在无选择或部分选择时均确认全部组内文件数量，确认按钮默认聚焦，执行范围不受选择影响；Discard All 在无选择或部分选择时均列出全部 Unstaged 路径，取消不执行，确认后发送完整范围，文件右键菜单仍按所选路径执行。
- 创建分支的友好起点、名称实时错误、输入和焦点保留、“仅创建”与“创建并切换”意图及完成后的当前分支；无远端 Push 的前置说明与添加入口、添加后返回目标摘要、默认折叠的高级 Push 选项；Push 等操作进行中、成功、失败与目标；Commit 成功短哈希、提交文件数、剩余变更数和查看入口；错误详情、日志；持久冲突条、查看冲突、Continue 禁用原因与待检查状态；标记暂存不保证内容正确、暂存版本检查、标记行号、返回检查、明确继续确认、活动操作 Commit 入口与草稿保留；冲突后关闭窗口不 Abort、中止入口及恢复目标说明。
- Diff 修改块外框、新增/修改/删除块统计、无边框当前/总块数、首次自动定位、首尾循环与单块重复定位、超高块从开头显示、收起展开保留位置、手动滚动、刷新重映射、缩放、长行横向滚动和截断计数。
- `Stash Selected Files…` 从 Staged / Unstaged 文件菜单打开，所选路径去重、数量准确、说明解释整个文件的 Index 与 Working Tree 都会保存，所选未跟踪文件自动包含；全局 `Stash All Changes…` 的未跟踪勾选项与说明保持一致。成功反馈仅统计实际保存范围及操作后的工作区状态。
- Apply 默认保留存档，显式 Pop 的成功后删除说明清晰；预检冲突、无法准确试验和预检期间现场变化分别说明原因、路径与存档保留，提供比较和打开图标，不显示无效的重复 Apply。说明仅承诺本次恢复未改动现场，不否认外部编辑；正式执行异常不显示未经验证的“现场不变”提示。
- Stash、Commit、浅色/深色及两种高对比主题、减少动态效果、未推送数量角标，以及默认与自定义 Push 目标。
- Demo 中的原生宿主按钮只验证发出明确请求和提示，不把模拟结果当作真实 VS Code 验证。

## Git 与宿主验收矩阵

- 活动栏侧栏以原生按钮显示 Show Git Workbench 与 Open Workbench in New Window；视图可见性变化不自动打开工作台或关闭侧栏。Show 覆盖新建、重复点击复用、活动标签优先、最近使用标签及关闭后重新创建；新窗口命令保留空白启动与宿主就绪路由。

- 统一添加浮窗的仓库/分组类型切换、空分组创建、名称校验与 Enter 提交、草稿和已完成扫描选择保留、切换类型取消扫描并忽略迟到结果；添加仓库模式的目录选择、可取消扫描、候选筛选、可见顺序 Shift 范围、已有仓库禁用、目标分组与内联新建分组；分类目录递归发现多层仓库、`.git` 文件 Worktree、已有仓库去重、一次保存与列表通知、取消不产生部分添加；损坏仓库与无法访问目录跳过，目录链接和 junction 不跟随，已有会话保持。内嵌移除确认列出目标仓库并保留磁盘文件，宿主在执行前重新校验。
- 同一共享 Git 存储的工作目录在顶层只显示一次；独立克隆与独立 Git 存储保持正确身份。覆盖旧保存路径恢复、直接添加 Worktree、VS Code 自动发现、主目录优先选择、活动 Worktree / 菜单目标、各工作目录草稿与文件状态隔离。
- 多引用历史首次查询与分页使用相同 tips，共同祖先无重复。
- Checkout 成功、当前分支、脏文件可能被覆盖、未解决冲突和 Worktree 占用；单个远程分支创建并 Checkout、本地跟踪分支复用和 Stash 重试。
- 分支名称后端校验返回可操作原因；仅创建保持当前分支，创建并切换后 HEAD 与当前分支同时更新。
- 远程分支目录递归批量创建本地跟踪分支，保持当前 HEAD；批量名称、upstream、符号引用、远程来源和层级冲突在写入前完成验证。
- `Stash Changes & Checkout` 分步结果；Checkout 失败时保留已经创建的 Stash。
- 所选文件 Stash 在暂存与未暂存两侧都保存整个文件，涵盖同一文件同时修改、所选未跟踪文件、重命名、删除与路径去重；未选中已暂存文件的内容不进入 Stash Index parent，也不被清理。全局 Stash 分别检查包含与排除未跟踪文件，反馈文件数严格对应保存范围。
- Apply、Pop、Drop Stash 在列表变化后仍验证正确对象；默认 `apply --index` 同时恢复 Index 与 Working Tree 划分且保留存档，显式 Pop 仅成功后 Drop。分别验证仅暂存、仅未暂存、同文件两侧修改、未跟踪及删除状态。
- 隔离预检中一文件冲突、其他文件可恢复时，整次恢复停止，真实 Index、工作区与 Stash 原记录不被这次恢复更改；未跟踪目标已存在、非目录父级及符号链接占用同样停止。预检期间外部编辑使 fingerprint 变化时停止；正式执行意外失败报告实际结果，保留 Stash，不承诺原子回滚。
- 隔离副本使用原始 Index 与文件内容、split Index 共享内容及只读源对象 alternates；检查试运行没有向源仓库写入 Index、工作区或隔离生成的对象，结束后安全清理临时目录。
- 隔离支持边界逐项检查：Git 属性来源读取能力不足、sparse checkout、受影响 gitlink、外部 filter、自定义或默认外部 merge driver、单文件超过 32 MiB、快照累计超过 128 MiB、非普通文件、无法完整复制的占位目录和父级符号链接。应说明不支持原因并停止，不回退为直接在真实现场试恢复；支持范围见 [架构说明](ARCHITECTURE.md#stash-保存与隔离恢复)。
- 受阻文件比较读取保存的 tracked 工作树内容或 untracked 第三 parent，包含仅暂存、两侧修改及保存/当前删除的空内容，打开入口使用真实工作区路径。
- Stash 详情分别验证 Working Tree、Index 与 Untracked Files，按路径去重汇总文件数；仅含未跟踪文件时默认打开该分类，空分类给出内容位置与直接跳转，创建成功反馈说明保存范围和工作区状态。
- 同一文件同时含 Staged / Unstaged 修改时，Discard 只处理工作区一侧。
- Detached HEAD 默认禁止、设置应用/取消/重载、关闭后返回分支、Commit/Tag/Stash 重试和隐式 Detached Worktree 后端拦截、Tracking Branch、Tag 创建并切换分支 和主 / 当前 / Locked Worktree 限制。
- 远端名称、地址、重复名称与添加后的 Snapshot；Push 目标配置解析、不同名称的本地 / 远端分支 refspec 及 upstream 建立。
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

下表保留不同版本实际执行过的检查范围，不把旧版本结果视为当前版本的全量验证。问题级回归摘要见 [问题日志](ISSUES.md)。

| 证据范围 | 日期 / 版本 | 已记录结果与限制 |
| --- | --- | --- |
| 类型、状态及路径逻辑 | 2026-10-01 / 0.10.0 | 类型检查通过；`ui-state`、`file-selection` 两个文件 34 项通过，覆盖设置保存/回滚、角标颜色及目录标签 |
| 生产构建与浏览器专项 | 2026-10-01 / 0.10.0 | 构建、无头 Edge 的 `--appearance-only` 与 `--files-only` 通过；范围为主题、角标、布局恢复和文件交互 |
| 打包与本机安装 | 2026-10-01 / 0.10.0 | 固定包、版本包生成及官方 CLI 安装核对通过；此记录不是当前本机安装状态，本机目标与状态以忽略目录中的安装记录和实际 CLI 核对为准 |
| 仓库管理、完整 Git 行为及窗口桥接 | 上述 0.10.0 执行范围之外 | 该记录未包含相关复测、完整 Vitest 或 `test:windows` 的新结果 |
| 文档整理 | 2026-10-01 / 源码 0.16.0 | Markdown 本地链接、标题锚点、图片及旧文件名引用检查通过；`git diff --check` 通过。未运行功能测试，未重新打包或安装扩展 |
| 暂存确认与 Commit 结果反馈 | 2026-10-02 / 0.18.0 | 类型检查、生产构建、无头 `--files-only` 与 `--feedback-only` 通过；固定 VSIX 打包并通过官方 CLI 安装及身份/版本核对。未启动真实 VS Code 桌面集成测试 |
| Workbench 唯一入口、多标签/窗口与跨窗口安全 | 2026-10-02 / 0.19.0 | 类型检查、6 个相关 Vitest 文件 40 项、生产构建与完整无头界面套件通过；界面脚本显式验证新 Workbench 初始不选择仓库，并适配各受控宿主在 Workbench 内选择仓库。固定 VSIX 打包并通过官方 CLI 安装及 `alwaygit-dev.alwaygit@0.19.0` 核对；按规则未启动会弹窗的真实多窗口 VS Code 集成测试 |
| Stash 内容可见性与重复恢复安全 | 2026-10-02 / 0.19.1 | 类型检查、状态与协议 35 项、两项真实 Git 定向回归、生产构建及无头 `--stash-only` 通过；固定 VSIX 打包并通过官方 CLI 安装及 `alwaygit-dev.alwaygit@0.19.1` 核对。未启动会弹窗的真实 VS Code 桌面集成测试 |
| 分支创建意图与无远端 Push 引导 | 2026-10-02 / 0.20.0 | 类型检查、协议与真实 Git 定向测试 26 项、生产构建及完整无头界面套件通过；覆盖分支名就近说明、仅创建/创建并切换、Remotes 空状态、添加远端后返回 Push 和折叠高级选项。固定 VSIX 已打包并通过官方 CLI 安装及 `alwaygit-dev.alwaygit@0.20.0` 核对；未启动会弹窗的真实 VS Code 桌面集成测试 |
| 统一仓库与分组添加入口 | 2026-10-02 / 0.26.0 | 类型检查、宿主与协议 24 项相关单测、生产构建和无头 Worktrees 专项通过；覆盖单一加号、空分组创建无原生输入或扫描、名称边界与同名拒绝、Enter 提交、类型切换保留草稿/选择、迟到扫描取消，以及原有批量添加。两种添加模式的布局已通过无头截图核对。固定 VSIX 已打包并通过官方 CLI 安装及 `alwaygit-dev.alwaygit@0.26.0` 核对；未启动真实 VS Code 桌面集成测试 |
| 仓库与分组顺序 | 2026-10-02 / 0.26.0 | 类型检查、4 个相关 Vitest 文件共 65 项、生产构建和无头 Worktrees 专项通过；覆盖旧顺序迁移、新增追加、混合根层及组内排序、跨层拒绝、重启恢复、暂不可访问项的位置保留，以及拖动和右键排序不切换活动仓库 |
| 可见顺序范围选择与仓库内嵌管理 | 2026-10-02 / 0.21.0 | 完成 Repository、Local / Remote Branch、History Commit、Details / Working Tree 文件、Worktree 及新增候选仓库列表的 Shift 范围审计，修复仓库排序和折叠分支两处与可见顺序不一致的问题。类型检查、6 个相关 Vitest 文件 39 项、生产构建及无头 `--worktrees-only` 通过；后者覆盖内嵌扫描添加、候选 Shift 范围、新建目标分组和内嵌移除确认。固定 VSIX 已打包并通过官方 CLI 安装及 `alwaygit-dev.alwaygit@0.21.0` 核对；未启动会弹窗的真实 VS Code 桌面集成测试 |
| Diff 定位、循环跳转与独立行高 | 2026-10-02 / 0.23.0 | 类型检查、Diff 导航/对齐及状态/设置单测共 47 项、生产构建、Diff 和外观两个无头界面专项通过。覆盖首处自动定位、单处重复定位、首尾循环、超高块与收起恢复；默认 18 px 行高、自定义边界、字号安全下限、预览/取消/保存重载、旧设置兼容与改变行高保留阅读行。固定 VSIX 已通过官方 CLI 安装并核对 `alwaygit-dev.alwaygit@0.23.0`；未启动真实 VS Code 桌面集成测试 |
| 工作台入口与仓库交互勘误 | 2026-10-02 / 0.25.1 | 类型检查、入口回归 8 项、生产构建与无头 `--worktrees-only` 通过；覆盖两个原生按钮的命令配置、视图可见性无自动动作、Show 标签新建与复用、活动/最近使用标签、关闭后重建，以及恢复仓库单击选择、双击/Enter 切换与右键管理。固定 VSIX 已通过官方 CLI 安装并核对 `alwaygit-dev.alwaygit@0.25.1`；真实 VS Code 桌面按钮外观与跨窗口集成未运行 |
| Detached HEAD 高级开关与历史分支引导 | 2026-10-02 / 0.28.0 | 类型检查、Git 安全/状态/协议三个文件 67 项单测、生产构建与无头 History、Appearance、Branch 三个专项通过；覆盖默认拒绝 Commit/Tag、显式及隐式 Detached Worktree、Stash 前预检策略变化和文件保留、关闭后返回分支、设置取消/应用/重载及历史创建并切换。固定 VSIX 已通过官方 CLI 安装并核对 `alwaygit-dev.alwaygit@0.28.0`；未启动真实 VS Code 桌面集成测试 |
| 整文件 Stash 与安全恢复 | 2026-10-02 / 0.29.0 | 类型检查、13 项真实 Git Stash 状态用例、48 项既有 Git 服务/安全回归、46 项 UI/Demo 用例、3 项定向文件比较及 1 项新协议用例通过；受影响失败修复后仅重跑对应检查。覆盖所选范围隔离、同文件 Index/工作树不同、重命名、未跟踪、缺失 Index、编码属性、整次冲突停止及 Git 环境变量隔离。生产构建与固定 VSIX 打包通过，官方 CLI 已安装并核对 `alwaygit-dev.alwaygit@0.29.0`；未启动真实 VS Code 桌面集成测试 |
| 并发边界、持久化和查询治理 | 2026-10-03 / 0.30.0 | 类型检查、相关 Git/宿主/协议/状态定向回归通过，覆盖进程终止与写保护、锁恢复、远端版本约束、旧快照失效、多标签草稿合并、只读取消、共享监听、符号链接及长参数；真实 Git 检查包括本地 Bare Remote 与两个 Clone 的并发变更、310 个分支的历史查询。11 个无头界面专项分批通过，失败修复后只重跑受影响专项；没有执行全量 Vitest 或真实 VS Code 多窗口桌面集成。0.30.0 生产构建与固定 VSIX 打包通过；随后当前工作区合入仓库行样式改动并由其更新流程重新构建安装，本轮再次核对官方 CLI、安装记录与固定包哈希一致。六份长期文档的本地链接及标题锚点检查通过 |
| 顶部工具栏精简与底部状态栏移除 | 2026-10-03 / 0.31.0 | 类型检查、48 项状态测试、生产构建及无头 `--workbench-only` 通过；覆盖分支徽标并入工具栏、定位 HEAD 图标、双层文件夹中央 VS Code 标识、打开仓库目录的悬停说明、底部状态栏移除，以及顶部普通提示的显示和关闭。固定 VSIX 已打包并通过官方 CLI 安装及 `alwaygit-dev.alwaygit@0.31.0` 核对；未执行全量 Vitest 或真实 VS Code 桌面集成测试 |
| Git 操作身份、Stash 属性、目录事务与网络生命周期 | 2026-10-03 / 0.31.1 | 类型检查通过；远程跟踪 6 项、Stash 状态 20 项、操作上下文/协议/确认 46 项及 Checkout 冲突保护 1 项、目录事务相关 39 项及受影响复合添加/宿主入口 7 项、Tag 定向 7 项、Runner/AskPass/RPC 20 项通过（受影响复测含重叠范围，不按总数叠加）。真实 Git 覆盖属性编码、分支/HEAD/目标变化与 Tag 重建及删除竞态；独立目录 Store 与陈旧 Memento 模拟跨宿主争用。生产构建、固定 VSIX 打包及无头 `--feedback-only` 通过，包含三种操作对话框刷新后保留打开时身份。官方 CLI 已安装并核对 `alwaygit-dev.alwaygit@0.31.1`，固定包哈希与本机记录一致；未执行全量 Vitest、真实多 VS Code 窗口或原生认证输入框集成。UI 优化计划暂缓 |
| 报告 B01/B02：提交反馈与 Stash 底层诊断 | 2026-10-03 / 0.31.2 | 类型检查、UI 状态/Demo 两文件 55 项及 Stash 状态/日志/宿主入口/Demo 四文件 34 项通过（Demo 范围重叠，不累加）；无头 `--feedback-only` 与 `--stash-only` 通过。真实 Git 覆盖实际冲突与无关新增暂存文件的 Index 阻碍，消息桥验证响应与日志使用同一脱敏诊断。生产构建和固定 VSIX 打包通过，临时 TMP 资料排除；官方 CLI 已在既有默认 Profile 安装并核对 `alwaygit-dev.alwaygit@0.31.2`，安装记录与固定包哈希一致，上一已安装版本 0.31.1 保留在 previous 包。Markdown 本地文件与图片引用及差异格式检查通过；未运行全量 Vitest 或真实 VS Code 桌面集成 |

macOS、Linux、WSL、Remote SSH、Dev Containers 和最低支持版本仍需相应环境的专项证据。验收矩阵、架构兼容性和测试文件的存在都不等同于这些环境已通过验收。
