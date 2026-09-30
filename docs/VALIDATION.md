# 验证说明

本文区分验收范围、执行方法和实际结果。没有列入“本轮结果”的项目不应被描述为已通过。

## 标准命令

根据改动选择必要检查，不依次执行下列全部命令。默认完成同一目的的修改后集中验证；失败修复只重跑受影响部分。界面设置与配色可使用构建后的 `node scripts/test-ui.mjs --appearance-only`，只运行该专项无头流程。会弹出窗口的宿主集成测试需先取得用户明确同意。

```powershell
npm run typecheck
npm test
npm run test:ui
npm run test:extension
npm run test:windows
npm run package
```

`test:ui` 会先构建并以 `?demo=1` 加载产物。Windows 默认使用 Microsoft Edge；可用 `ALWAYGIT_BROWSER_EXECUTABLE` 指定浏览器。`test:extension` 使用临时真实仓库和本地 Bare Remote；可通过 `ALWAYGIT_VSCODE_EXECUTABLE` 或 `ALWAYGIT_VSCODE_VERSION` 选择 VS Code。

`test:windows` 使用独立临时 Profile、测试仓库和测试伴随扩展，验证项目窗口激活、跨窗口 Diff/编辑、保留标签和未保存文档，以及未打开项目的新窗口启动；测试进程不使用或关闭用户的 VS Code 窗口。多根工作区和不同 Worktree 的目录匹配同时由 IPC 单元测试覆盖。

## 浏览器验收矩阵

- 固定四区 Workbench、旧 Editor Focus 会话迁移、面板和列拖动、仅恢复几何尺寸的 Restore Layout、窄窗口和主题。
- 设置浮窗分级导航、预览、取消、应用、刷新期间的持久化；宿主主题与手动主题优先级、字号和密度同步虚拟行高、Graph 预设及自定义浅色/深色色板的连续性与分页。
- Repository、Local Branch、Remote Branch、Remote、Tag、Stash、Worktree 及各分组的独立三点菜单；分组标题单击只折叠内容。
- 菜单指针定位、视口边缘修正、竖向排列、键盘焦点、Escape 与点击外部关闭。
- 右键对象与操作对话框目标一致；仓库切换后旧菜单和对话框关闭。
- 递归分支目录、目录展开、三态目录选择、多引用选择、共同提交去重、清空选择、分页、搜索、HEAD 标记及 Locate HEAD。
- Commit 整行悬停、指针、选择、已推送实心节点与粗体消息、本地未推送空心节点与常规消息、各列双击、键盘焦点、本地分支 Checkout 及 Detached HEAD 对话框。
- English / 简体中文切换，并验证 Git 命令、分支、路径和草稿保持不变。
- 切换仓库或重载后恢复筛选、选择、布局和 Commit 草稿。
- 文件完整多层父目录、Working Tree 单击/Ctrl/Cmd/Shift 选择及无复选框交互、文件区域 Ctrl/Cmd+A、原生文本框全选、提交文件路径复制、Stage / Unstage 范围和显式 Discard。
- Push 等操作进行中、成功、失败与目标；错误详情、日志；持久冲突条、查看冲突、Continue 禁用原因与已解决状态。
- Diff 修改块外框、当前/总块数、箭头、手动滚动、刷新重映射、缩放、长行横向滚动和截断计数。
- Stash、Commit、浅色/深色及两种高对比主题、减少动态效果、未推送数量角标，以及默认与自定义 Push 目标。
- Demo 中的原生宿主按钮只验证发出明确请求和提示，不把模拟结果当作真实 VS Code 验证。

## Git 与宿主验收矩阵

- 添加分类目录递归发现多层仓库、`.git` 文件 Worktree、已有仓库去重、一次保存与列表通知、取消不产生部分添加；损坏仓库与无法访问目录跳过，目录链接和 junction 不跟随，已有会话保持。
- 同一共享 Git 存储的工作目录在顶层只显示一次；独立克隆与独立 Git 存储保持正确身份。覆盖旧保存路径恢复、直接添加 Worktree、VS Code 自动发现、主目录优先选择、活动 Worktree / 菜单目标、各工作目录草稿与文件状态隔离。
- 多引用历史首次查询与分页使用相同 tips，共同祖先无重复。
- Checkout 成功、当前分支、脏文件可能被覆盖、未解决冲突和 Worktree 占用。
- `Stash Changes & Checkout` 分步结果；Checkout 失败时保留已经创建的 Stash。
- Apply、Pop、Drop Stash 在列表变化后仍验证正确对象。
- 同一文件同时含 Staged / Unstaged 修改时，Discard 只处理工作区一侧。
- Detached HEAD、Tracking Branch、Tag Checkout 和主 / 当前 / Locked Worktree 限制。
- Push 目标配置解析、不同名称的本地 / 远端分支 refspec 及 upstream 建立。
- Diff 文本、二进制、大小限制、删除 / 重命名、Merge Parent 和冲突 Stage。
- VS Code 原生 Diff、普通编辑、剪贴板、打开 Worktree 和新窗口。
- 多仓库共享 `commonDir` 的串行写操作与活动状态。

## 本轮结果

执行日期为 2026-10-01，版本为 0.8.1。检查集中在实现完成后执行；0.8.1 仅增强角标颜色和已推送提交字重，因此复用 0.8.0 的功能用例结果，没有重跑无关单测、Graph 性能基准或桌面集成测试，也没有启动可见 VS Code / 浏览器测试窗口。

| 项目 | 结果 | 备注 |
| --- | --- | --- |
| `npm run typecheck` | 通过 | 0.8.1 样式调整后的 Webview 类型一致 |
| 相关 Vitest 用例 | 通过 | 43 项 Graph 渲染、文件选择、状态管理和协议用例；另有 2 项真实 Git 集成用例通过，覆盖 Push 前后的远端可达性、未推送计数、轻量仓库状态及 Detached HEAD 不显示分支角标 |
| `npm run build` | 通过 | 扩展与 Webview 生产构建成功 |
| `git diff --check` | 通过 | 修改文件无空白错误 |
| `scripts/update-local.ps1` | 通过 | 构建固定包 `artifacts/alwaygit.vsix`，保留上一份和版本包；沿用已记录的 VS Code 默认 Profile 安装。官方 CLI 核对为 `alwaygit-dev.alwaygit@0.8.1`，未关闭或重启用户窗口 |

复现本轮定向单测：

```powershell
npx vitest run tests/graph-renderer.test.ts tests/file-selection.test.ts tests/ui-state.test.ts tests/workbench-protocol.test.ts
npx vitest run tests/git-service.test.ts -t 'fetches, pushes and pulls'
npx vitest run tests/git-safety.test.ts -t 'checks out a commit in Detached HEAD'
```

本轮未改动写入型 Git 操作或窗口路由，没有启动对应桌面集成测试。真实 VS Code 内的人工视觉体验、远程宿主、macOS、Linux 和最低支持版本仍需对应环境验收。
