# 开发交接

本文用于在新聊天或新开发者接手时快速恢复上下文。开始工作前依次阅读 [README](../README.md)、[工作台规格](WORKBENCH_SPEC.md)、[架构](ARCHITECTURE.md) 和本文；运行结果以 [验证说明](VALIDATION.md) 为准。

## 已确认范围

AlwayGit 的目标是 VS Code 内的完整 Git 工作台：左侧仓库和引用树，中间 Graph / History，右侧详情或 Working Tree，底部只读 Diff。保留 `Workbench` 与 `Editor Focus` 两种布局，支持 English / 简体中文，Git 术语保持英文。

当前核心交付包括：多引用复选筛选、递归分支目录、明确 HEAD、Commit 单击与双击行为、独立三点菜单、Graph 菜单、明确的 Push 目标、Checkout 受阻反馈、高对比只读 Diff、布局与语言会话恢复，以及相应的真实 Git、VS Code 和浏览器验收。

当前范围不包括 Squash、Fixup、交互式 Rebase、提交重排、Format Patch、分块暂存、远程分支删除、远程 Tag 管理或自由浮动面板。

## 关键约定

- Webview 只负责呈现与意图；文件、剪贴板、窗口和 Git 均由扩展宿主完成。
- Git 写操作以完整仓库 ID 和稳定对象身份执行，并在宿主重新验证。
- 多引用历史首次查询确定 tips，分页沿用 tips。
- 分支目录由引用名按 `/` 派生，不改变真实 Git ref；目录选择归并为完整 ref 列表送入历史查询。
- Push 必须显示并提交明确的本地分支、remote 和远端分支，首次跟踪与已有 upstream 使用不同的 `--set-upstream` 行为。
- 菜单和工具栏共享动作定义；菜单目标不跟随当前选中项漂移。
- 底部 Diff 只读；完整查看与编辑走 VS Code 原生能力。
- 会话不得保存凭据、文件内容或 Git 输出。
- Demo RPC 只能模拟明确的工作台交互；它不能证明 VS Code 原生动作可用。

## 主要入口

| 文件或目录 | 用途 |
| --- | --- |
| `src/protocol/types.ts`、`validation.ts` | 跨层数据与输入边界 |
| `src/extension/workbench.ts` | RPC 路由、会话和 VS Code API |
| `src/git/` | Git 查询、操作和解析 |
| `src/repositories/` | 单仓库注册、递归目录发现和批量保存 |
| `src/editor/` | 内容、原生 Diff 和文件打开 |
| `webview/App.tsx` | 工作台组合和主要交互 |
| `webview/store.ts` | 数据、选择、筛选、操作和会话状态 |
| `webview/rpc.ts` | Webview 桥接及 Demo 数据 |
| `webview/refTree.ts` | Local / Remote Branch 的递归目录派生与选择范围 |
| `webview/graph/` | Graph 轨道与行渲染 |
| `webview/styles.css` | 面板、菜单、主题与响应式布局 |
| `scripts/test-ui.mjs` | 构建后浏览器验收 |
| `tests/extension/runner.ts` | Extension Development Host 验收 |

## 继续开发时的检查顺序

1. 先查看 `git status --short`，保留用户和其他 Agent 的未提交修改。
2. 将需求对照 `WORKBENCH_SPEC.md`，确定是修复既定行为还是扩大范围。
3. 涉及 Git 或原生能力时先修改协议与校验，再修改宿主、Webview 和测试。
4. 使用 Demo 模式检查纯 UI；使用临时真实仓库检查 Git；使用 Extension Development Host 检查 VS Code API。
5. 完成后更新本文的实现状态与 `VALIDATION.md`，不要把计划写成已通过的结果。

## 当前实现和验证状态

- 工作台四区布局、Editor Focus、面板与列尺寸、English / 简体中文、清晰的面板层级及会话恢复已经实现。
- 添加仓库支持选择分类总目录并递归批量加载，具体扫描边界和取消行为见 [工作台规格](WORKBENCH_SPEC.md)。
- Repository、分组、Local / Remote Branch、Remote、Tag、Stash、Worktree 和 Commit 菜单已经实现；分区标题负责折叠，独立三点按钮打开菜单。Local / Remote Branch 以递归目录显示并支持目录级三态选择。
- 多引用历史、空选择、固定 tips 分页、HEAD 呈现及紧凑 Graph 已经接入；同一 OID 的 `Locate HEAD`、分页后定位以及表头与内容横向滚动同步都有回归测试。
- Checkout / Detached HEAD、脏文件与 Worktree 阻塞、Stash 后 Checkout、Push 目标解析、Diff Preview、剪贴板和窗口接口已经接入宿主。
- 当前验收结果和本机安装版本统一见 [验证说明](VALIDATION.md)。

开始工作前先检查工作树；若存在未提交改动，应确认其来源和用途，不要用 Git 清理命令覆盖。

## 新聊天起始提示

可在新聊天中使用：

> 请先阅读 README.md、docs/WORKBENCH_SPEC.md、docs/ARCHITECTURE.md、docs/DEVELOPMENT_HANDOFF.md 和 docs/VALIDATION.md，检查 git status 与当前代码后继续开发 AlwayGit。以 WORKBENCH_SPEC.md 的已确认交互为准，不要覆盖未提交修改；完成后更新交接与验证记录。
