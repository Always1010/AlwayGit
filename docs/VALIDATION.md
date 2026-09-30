# 验证说明

本文区分验收范围、执行方法和实际结果。没有列入“本轮结果”的项目不应被描述为已通过。

## 标准命令

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

- 四区 Workbench、Editor Focus、面板拖动、列拖动、Restore Layout、窄窗口和主题。
- Repository、Local Branch、Remote Branch、Remote、Tag、Stash、Worktree 及各分组的独立三点菜单；分组标题单击只折叠内容。
- 菜单指针定位、视口边缘修正、竖向排列、键盘焦点、Escape 与点击外部关闭。
- 右键对象与操作对话框目标一致；仓库切换后旧菜单和对话框关闭。
- 递归分支目录、目录展开、三态目录选择、多引用选择、共同提交去重、清空选择、分页、搜索、HEAD 标记及 Locate HEAD。
- Commit 整行悬停、指针、选择、各列双击、键盘焦点、本地分支 Checkout 及 Detached HEAD 对话框。
- English / 简体中文切换，并验证 Git 命令、分支、路径和草稿保持不变。
- 切换仓库或重载后恢复筛选、选择、布局和 Commit 草稿。
- 文件完整多层父目录、文件区域 Ctrl/Cmd+A、原生文本框全选、路径复制、三态选择、Stage / Unstage 范围和显式 Discard。
- Push 等操作进行中、成功、失败与目标；错误详情、日志；持久冲突条、查看冲突、Continue 禁用原因与已解决状态。
- Diff 修改块外框、当前/总块数、箭头、手动滚动、刷新重映射、缩放、长行横向滚动和截断计数。
- Stash、Commit、浅色/深色及两种高对比主题、减少动态效果，以及默认与自定义 Push 目标。
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

执行日期为 2026-10-01，版本为 0.5.1；Windows 环境使用 Node.js 24.20.0、Git 2.55 和 VS Code 1.139.1。UI 验收使用 Microsoft Edge。

| 项目 | 结果 | 备注 |
| --- | --- | --- |
| `npm run typecheck` | 通过 | TypeScript 7；协议、宿主与 Webview 类型一致 |
| `npm test` | 通过 | 22 个测试文件、148 项测试；新增逻辑仓库分组、Windows 路径、独立克隆与 Git 存储、主目录 / Worktree 发现计数、旧路径 / 草稿恢复、自动发现和单次通知回归；已有检查通过 |
| 构建 + `node scripts/test-ui.mjs` | 通过 | 新增受控宿主验证旧活动 Worktree 和草稿、单个顶层入口、独立克隆、菜单路径、Worktree 切换及列表刷新；原有布局、引用树、菜单、会话、刷新、操作反馈、文件选择、Diff 导航和主题回归通过 |
| 构建 + `node scripts/test-extension.mjs` | 通过 | VS Code 1.139.1；真实递归分组和添加数量、Worktree 切换、主 / linked 分支与文件状态隔离通过；原有文件 / Index 监听、原生 Diff、未保存文档及标签保持正常 |
| `npm run test:windows` | 此前通过（0.3.1） | VS Code 1.139.1 与 1.95.3；项目窗口路由专项验收。本次未修改窗口路由，未重跑该专项 |
| `scripts/update-local.ps1` | 通过 | 构建固定包 `artifacts/alwaygit.vsix`，保留上一份包和版本包；沿用已记录的 VS Code 默认 Profile 安装，官方 CLI 核对为 `alwaygit-dev.alwaygit@0.5.1`；本机目标、时间与校验和保存在忽略的 `artifacts/local-install.json` |

Markdown 本地链接和图片引用检查通过。VS Code 1.95.3 已完成项目窗口路由专项验收；最低版本的完整功能、远程宿主、macOS、Linux 和最低 Git 版本仍需对应环境下的验收。
