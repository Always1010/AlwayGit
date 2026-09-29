# AlwayGit

运行在 VS Code 编辑器区域的 Git 图形化工作台。提交图、仓库导航和文件状态集中在一个工作台中，代码与差异通过 VS Code 原生编辑器查看和修改。

## 使用

环境要求：VS Code 1.95 或更新版本、Git 2.40 或更新版本。开发构建需要 Node.js 24 和 npm。

当前在 Windows、VS Code 1.139.1、Git 2.55 上通过集成验收。声明的最低版本、macOS、Linux 和远程环境仍待对应环境下的实测。

安装打包后的 VSIX：在 VS Code 扩展视图的菜单中选择 **Install from VSIX…**。打开受信任的 Git 工作区后，执行 **AlwayGit: Open Git Workbench**；也可以点击活动栏 AlwayGit 图标。使用 **Add Repository** 添加其他仓库。

源码开发：

```powershell
npm install
npm run build
```

在 VS Code 打开本项目，按 F5 启动 Extension Development Host，然后执行 **AlwayGit: Open Git Workbench**。

## 功能

- 多仓库导航、拓扑提交图、分页、提交消息搜索、提交详情和 Merge Commit 父提交选择。
- 本地与远程分支、Tag、Stash、Worktree 浏览；分支、Tag、Stash、Worktree 的常用管理操作。
- Staged / Unstaged / Conflicts 分组、整文件和批量暂存、取消暂存、丢弃修改、Commit、Amend。
- Fetch、Pull（默认仅 Fast-forward，支持 Merge / Rebase）、Push 与 Force-with-lease。
- Merge、Rebase、Cherry-pick、Reset、Revert；识别未完成操作并提供 Continue / Abort / Skip。
- 原生 HEAD → Index、Index → 工作区、Commit → 父提交 Diff；直接打开文件编辑和解决冲突。
- 可调整的工作台面板、VS Code 主题、键盘导航、操作状态、提交草稿与界面会话恢复。

Git 操作在仓库所在的扩展宿主执行，架构兼容 WSL、Remote SSH 和 Dev Containers；这些远程环境尚需对应环境下的集成验收。纯浏览器虚拟工作区不受支持。

当前使用整文件暂存和普通 Rebase。分块暂存、交互式 Rebase、远程 Tag 管理、任意两个 Commit 的比较尚未实现。二进制和超过 8 MB 的文件提供提示而非文本内容；非法 UTF-8 文件名不能通过文本界面操作。当前界面使用英文。

## 验证和打包

```powershell
npm run typecheck
npm test
npm run test:ui
npm run test:extension
npm run package
```

`test:ui` 使用 Playwright；Windows 默认使用 Microsoft Edge，其他平台需要 Playwright Chromium。可通过 `ALWAYGIT_BROWSER_EXECUTABLE` 指定浏览器路径。

`test:extension` 默认下载并运行当前稳定版 VS Code。可设置 `ALWAYGIT_VSCODE_EXECUTABLE` 使用现有安装，或设置 `ALWAYGIT_VSCODE_VERSION` 检查指定版本。测试会在系统临时目录创建独立仓库；网络操作测试使用本地 Bare Remote。

安装包输出到 `artifacts/alwaygit-0.1.0.vsix`。测试截图和构建缓存不会纳入版本控制。

## 配置与文档

`alwaygit.gitPath` 指定 Git 可执行文件；默认尝试 VS Code 内置 Git 扩展配置，然后使用 PATH。`alwaygit.historyPageSize` 控制历史分页大小，`alwaygit.refreshInterval` 控制可见工作台的补偿刷新间隔。修改 Git 路径或刷新间隔后重新加载窗口。

- [架构与开发约定](docs/ARCHITECTURE.md)

本项目尚未指定开源许可证，也尚未发布到 Marketplace。
