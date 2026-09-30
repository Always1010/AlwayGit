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
- Commit 单击、双击、本地分支 Checkout 及 Detached HEAD 对话框。
- English / 简体中文切换，并验证 Git 命令、分支、路径和草稿保持不变。
- 切换仓库或重载后恢复筛选、选择、布局和 Commit 草稿。
- Stage、Unstage、Discard、Stash、Commit、高对比只读 Diff，以及默认与自定义 Push 目标。
- Demo 中的原生宿主按钮只验证发出明确请求和提示，不把模拟结果当作真实 VS Code 验证。

## Git 与宿主验收矩阵

- 添加分类目录递归发现多层仓库、`.git` 文件 Worktree、已有仓库去重、一次保存与列表通知、取消不产生部分添加；损坏仓库与无法访问目录跳过，目录链接和 junction 不跟随，已有会话保持。
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

执行日期为 2026-09-30，Windows 环境使用 Node.js 24.20.0、Git 2.55 和 VS Code 1.139.1。UI 验收使用 Microsoft Edge。

| 项目 | 结果 | 备注 |
| --- | --- | --- |
| `npm run typecheck` | 通过 | TypeScript 7；协议、宿主与 Webview 类型一致 |
| `npm test` | 通过 | 17 个测试文件、113 项测试；涵盖 Git、安全、协议、图形、目录批量发现和注册、长扫描 RPC，以及自动刷新范围、Merge Parent、比较区域、事件合并和异步竞争回归 |
| `npm run test:ui` | 通过 | 原有布局、引用树、菜单、会话、Diff 和主题验收通过；受控宿主验证历史详情与 Parent 保留、按引用更新 History、dirty 状态不变时更新内容、后台 Diff 无 Loading 清空、滚动位置及 Staged 比较保留 |
| 构建 + `node scripts/test-extension.mjs` | 通过 | VS Code 1.139.1；真实文件与 Index 监听携带正确变化范围，修改文件后预览内容更新；批量注册、去重、活动仓库、原生 Diff、未保存文档及已有标签保持正常 |
| `npm run test:windows` | 此前通过（0.3.1） | VS Code 1.139.1 与 1.95.3；项目窗口路由专项验收。本次未修改窗口路由，未重跑该专项 |
| `scripts/update-local.ps1` | 通过 | 在修复 Worktree 构建并安装 0.4.1；同步日常固定包至 `D:\WRK\AlwayGit\artifacts\alwaygit.vsix` 并核对包内 ID、版本和校验和，本机核对为 `alwaygit-dev.alwaygit@0.4.1`；保留上一份包，沿用已记录的 VS Code 默认 Profile |

Markdown 本地链接和图片引用检查通过。VS Code 1.95.3 已完成项目窗口路由专项验收；最低版本的完整功能、远程宿主、macOS、Linux 和最低 Git 版本仍需对应环境下的验收。
