# AlwayGit

AlwayGit 是运行在 VS Code 编辑器区域中的 Git 图形化工作台。它把仓库与引用导航、提交图、提交详情、工作区状态和只读 Diff 放在同一界面中；查看或修改完整文件时使用 VS Code 原生编辑器。

## 安装与启动

运行环境为 VS Code 1.95 或更新版本、Git 2.40 或更新版本。源码构建需要 Node.js 24 和 npm。

```powershell
npm install
npm run build
```

在 VS Code 中打开项目并按 F5 启动 Extension Development Host，然后执行 **AlwayGit: Open Git Workbench**。安装 VSIX 时，在扩展视图菜单中选择 **Install from VSIX…**。可通过活动栏的 AlwayGit 图标打开工作台，使用 **Add Repository** 添加其他仓库。

## 工作台

默认的 `Workbench` 布局包含四个区域：

- 左侧以可折叠分区列出 Repositories、Local Branches、Remotes、Tags、Stashes 和 Worktrees；分支按 `/` 组成多级目录树。
- 中间显示可筛选的提交 Graph 与 History，提交行包含作者和日期。
- 右侧显示 Commit 详情及文件；选择 Working Tree 时显示变更管理与 Commit 表单。
- 底部显示选中文件的只读 Diff 预览，可按窗口高度拖动放大或收起到标题栏。

工作台固定使用四区 Workbench，面板和表格列可拖动调整；右上角恢复布局和齿轮图标分别负责恢复尺寸与打开界面设置。界面设置使用左侧分级导航，可从跟随 VS Code、清透亮色、暖纸、雾蓝、深夜、午夜蓝、石墨、森林、莓紫和高对比主题中选择，并可调整未推送数量角标颜色、语言、界面与 Diff 字号、列表密度和 Graph 配色；Graph 色板支持浅色/深色逐色编辑、增删、恢复预设和独立主线颜色，并在真实分叉预览中即时显示。文件仍可在 VS Code 原生编辑器或原生 Diff 中打开。

分支及分支目录前的复选框决定 Graph 中显示哪些引用，目录复选框支持全选、清空和半选状态。勾选多个分支时显示各分支可达提交的并集，共同祖先只出现一次；清空选择时显示空状态。单击分支名称定位并查看它，双击本地分支执行 Checkout；双击远程分支可创建或复用本地跟踪分支，远程分支目录支持一次批量创建全部后代的本地跟踪分支。Graph 以实心节点和粗体 Commit Message、作者、日期表示已到达远端跟踪引用的提交，以较小空心节点和常规字重表示本地未推送提交。单击 Commit 显示详情，Ctrl/Cmd 或 Shift 恰好选中两个 Commit 时自动显示二者的文件差异；双击 Commit 可切换到关联的本地分支，或在确认后进入 Detached HEAD。当前 HEAD 始终有清晰标记，并可通过 `Locate HEAD` 重新定位。

左侧分区标题用于展开或收起内容，标题右侧的三点按钮打开分区菜单；具体对象和 Graph 中的 Commit 支持右键操作。菜单是鼠标附近的竖向列表，可通过 Escape、点击菜单外部或键盘操作关闭。菜单命令针对实际点击的仓库和对象，不依赖此前选中的提交。

界面支持 English 和简体中文。Git 命令、Git 数据、分支名、路径和 Commit Message 保留原文；切换语言、仓库或布局时，各仓库的引用选择、当前项、搜索条件和 Commit 草稿会话继续保留。

完整交互和菜单范围见 [工作台规格](docs/WORKBENCH_SPEC.md)。

## 功能范围

- 分类目录递归批量添加仓库、多仓库导航、拓扑提交图、分页、提交消息搜索、提交详情和 Merge Commit 父提交选择。
- 本地与远端分支、Tag、Stash、Worktree 浏览和常用管理操作。
- Staged、Unstaged、Conflicts 分组；Working Tree、Commit Details 和 Commit 比较文件列表不显示复选框，直接用单击、Ctrl/Cmd 和 Shift 选择文件；Changed Files 可按完整相对路径筛选，并支持整文件及批量 Stage、Unstage、Discard、Copy Paths、Commit 和 Amend。
- Fetch、Pull、Push、Merge、Rebase、Cherry-pick、Reset 和 Revert；Push 与仓库导航以通知角标显示未推送提交数，Push 在执行前显示本地分支、远端和远端分支，并允许显式调整目标；识别未完成操作并提供 Continue、Abort 和 Skip。
- Checkout 前识别未提交修改、冲突和被其他 Worktree 占用的分支；可在适用时执行 `Stash Changes & Checkout`。
- VS Code 原生文件编辑和原生 Diff，以及工作台中的只读 Diff 预览。
- 工具栏打开项目、复用项目窗口，并在目标窗口保留原生 Diff 和文件编辑标签；Repository 可在当前窗口的新 AlwayGit 标签或新项目窗口中打开，Worktree 可在新项目窗口直接打开对应 Git Workbench。

Git 操作在仓库所在的扩展宿主中执行，架构兼容 WSL、Remote SSH 和 Dev Containers。纯浏览器虚拟工作区不受支持。当前使用整文件暂存和普通 Rebase；分块暂存、交互式 Rebase、远程 Tag 管理、提交重排、Squash、Fixup 和 Format Patch 不在当前范围内。底部文本预览限制为每侧 256 KiB、最多 4000 行，超出时提示截断；原生 Git 文本文档限制为 8 MB，二进制内容显示说明。

## 配置

- `alwaygit.gitPath`：Git 可执行文件路径；留空时依次使用 VS Code 内置 Git 配置和 PATH。
- `alwaygit.historyPageSize`：每页历史条数。
- `alwaygit.refreshInterval`：可见工作台的补偿刷新间隔，单位为秒。
- `alwaygit.language`：工作台初始语言；“界面设置”中的语言选择会按当前工作区记忆。

修改 Git 路径或刷新间隔后重新加载窗口。

## 验证与打包

```powershell
npm run typecheck
npm test
npm run test:ui
npm run test:extension
npm run package
```

`test:ui` 使用 Playwright。Windows 默认使用 Microsoft Edge，其他平台使用 Playwright Chromium；可通过 `ALWAYGIT_BROWSER_EXECUTABLE` 指定浏览器路径。测试中的 `?demo=1` 仅操作示例数据，原生 VS Code 文件、窗口和剪贴板动作由 Extension Development Host 集成测试验证。

`test:extension` 默认下载并运行当前稳定版 VS Code。可设置 `ALWAYGIT_VSCODE_EXECUTABLE` 使用现有安装，或设置 `ALWAYGIT_VSCODE_VERSION` 检查指定版本。测试在系统临时目录创建独立仓库，网络操作使用本地 Bare Remote。

日常安装包固定输出到 `artifacts/alwaygit.vsix`，同时保留带版本号的归档包。运行 `scripts/update-local.ps1` 可重新打包并安装到已记录的 VS Code；安装成功后重启 VS Code 即可使用更新。测试截图、报告和构建缓存不纳入版本控制。实际验证记录见 [验证说明](docs/VALIDATION.md)。

## 开发文档

- [架构与开发约定](docs/ARCHITECTURE.md)
- [工作台规格](docs/WORKBENCH_SPEC.md)
- [开发交接](docs/DEVELOPMENT_HANDOFF.md)
- [验证说明](docs/VALIDATION.md)
- [问题日志](docs/ISSUES.md)

本项目尚未指定开源许可证，也尚未发布到 Marketplace。
