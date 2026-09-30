# 验证说明

本文区分验收范围、执行方法和实际结果。没有列入“本轮结果”的项目不应被描述为已通过。

## 标准命令

```powershell
npm run typecheck
npm test
npm run test:ui
npm run test:extension
npm run package
```

`test:ui` 会先构建并以 `?demo=1` 加载产物。Windows 默认使用 Microsoft Edge；可用 `ALWAYGIT_BROWSER_EXECUTABLE` 指定浏览器。`test:extension` 使用临时真实仓库和本地 Bare Remote；可通过 `ALWAYGIT_VSCODE_EXECUTABLE` 或 `ALWAYGIT_VSCODE_VERSION` 选择 VS Code。

## 浏览器验收矩阵

- 四区 Workbench、Editor Focus、面板拖动、列拖动、Restore Layout、窄窗口和主题。
- Repository、Local Branch、Remote Branch、Remote、Tag、Stash、Worktree 及各分组标题菜单。
- 菜单指针定位、视口边缘修正、竖向排列、键盘焦点、Escape 与点击外部关闭。
- 右键对象与操作对话框目标一致；仓库切换后旧菜单和对话框关闭。
- 多引用选择、共同提交去重、清空选择、分页、搜索、HEAD 标记及 Locate HEAD。
- Commit 单击、双击、本地分支 Checkout 及 Detached HEAD 对话框。
- English / 简体中文切换，并验证 Git 命令、分支、路径和草稿保持不变。
- 切换仓库或重载后恢复筛选、选择、布局和 Commit 草稿。
- Stage、Unstage、Discard、Stash、Commit 和只读 Diff 选择。
- Demo 中的原生宿主按钮只验证发出明确请求和提示，不把模拟结果当作真实 VS Code 验证。

## Git 与宿主验收矩阵

- 多引用历史首次查询与分页使用相同 tips，共同祖先无重复。
- Checkout 成功、当前分支、脏文件可能被覆盖、未解决冲突和 Worktree 占用。
- `Stash Changes & Checkout` 分步结果；Checkout 失败时保留已经创建的 Stash。
- Apply、Pop、Drop Stash 在列表变化后仍验证正确对象。
- 同一文件同时含 Staged / Unstaged 修改时，Discard 只处理工作区一侧。
- Detached HEAD、Tracking Branch、Tag Checkout 和主 / 当前 / Locked Worktree 限制。
- Diff 文本、二进制、大小限制、删除 / 重命名、Merge Parent 和冲突 Stage。
- VS Code 原生 Diff、普通编辑、剪贴板、打开 Worktree 和新窗口。
- 多仓库共享 `commonDir` 的串行写操作与活动状态。

## 本轮结果

执行日期为 2026-09-30，Windows 环境使用 Node.js 24.20.0、Git 2.55 和 VS Code 1.139.1。UI 验收使用 Microsoft Edge。

| 项目 | 结果 | 备注 |
| --- | --- | --- |
| `npm run typecheck` | 通过 | 整合 Agent 完成前端替换后运行 |
| `npm test` | 通过 | 12 个测试文件、71 项测试，包含真实 Git、协议、Diff、Graph、路径、安全和状态回归 |
| `npm run test:ui` | 通过 | 四区布局、全部右键菜单、对象绑定、Escape 焦点恢复、尺寸与表头横向同步、同 OID Locate HEAD、多引用、双语会话、Diff 和主题 |
| `npm run test:extension` | 通过 | VS Code 1.139.1；Session v2、原生 / 预览 Diff、剪贴板、编辑、路径边界和协议校验 |
| `npm run package` | 通过 | 固定安装包 `artifacts/alwaygit.vsix`，16 个文件；已核对包内版本为 0.2.0 |

当前 README 中出现的历史环境信息不代表本轮结果。远程宿主、macOS、Linux 和声明的最低 VS Code / Git 版本需要在对应环境单独验收。
