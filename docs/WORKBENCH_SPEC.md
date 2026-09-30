# 工作台规格

本文记录已确认的 AlwayGit 工作台行为，作为实现、测试和以后聊天继续开发时的稳定依据。

## 布局与视觉

`Workbench` 是默认预设：左侧为仓库和引用导航，中间为 Graph 与 History，右侧为 Commit 详情、文件或 Working Tree Commit 表单，底部为只读 Diff。`Editor Focus` 收起底部 Diff，并通过 VS Code 原生编辑器查看和修改文件。

面板分隔线、作者列和日期列可拖动。`Restore Layout` 恢复默认尺寸。提交列表默认字号约 13 px、行高约 26 px，保留轻微交替底色和细分隔线。窄窗口不得造成整个工作台横向溢出；必要时各面板内部滚动或收起次要内容。

## 选择与打开

| 输入 | 行为 |
| --- | --- |
| 勾选引用复选框 | 加入或移出 Graph 显示范围，不 Checkout |
| 单击引用名称 | 选择并定位该引用，不改变其他引用的勾选状态 |
| 双击本地分支 | Checkout 到该分支 |
| 右键引用 | 打开该对象的菜单，不改变 Graph 筛选 |
| `Show in Graph` | 把目标加入现有筛选 |
| `Show Only This Branch/Tag` | 仅显示目标，不 Checkout |
| 单击 Commit | 显示提交详情和文件列表 |
| 双击 Commit | 关联一个本地分支时 Checkout；关联多个时选择；没有时确认 Detached HEAD |
| 单击详情中的文件 | 在底部预览 Diff |
| 双击文件 | 在 VS Code 打开；历史删除文件打开只读历史内容或原生 Diff |

初次进入仓库时选择当前本地分支及其 upstream。多引用历史是所有已选引用可达提交的并集，共同祖先只出现一次。没有选中引用时显示说明性空状态。当前分支即使未被筛选也继续显示在顶部；`Locate HEAD` 恢复定位。HEAD 在 Graph 与 History 中应有清晰且可访问的标记。

## 右键菜单通则

菜单在指针附近显示为无分组横线的竖向列表，限制在可视区域内。菜单具有 `menu` 和 `menuitem` 语义；打开时焦点进入菜单，方向键移动，Home/End 跳转，Enter 或 Space 执行，Escape、点击外部和仓库切换关闭。禁用项不可获得执行结果，并说明原因。

操作绑定被右键点击的仓库和对象。打开对话框后也不能改用之前选中的 Commit、当前筛选或变化后的 `stash@{n}`；执行前重新核对对象身份。

## 左侧对象菜单

| 对象 | 项目 |
| --- | --- |
| Repository | `Open Workbench`、`Open in New Window`、`Refresh`、`Fetch…`、`Copy Repository Path` |
| Local Branch | `Checkout…`、`Show in Graph`、`Show Only This Branch`、`Create Branch…`、`Create Tag…`、`Merge…`、`Rebase…`、`Push…`、`Delete Branch…`、`Copy Branch Name` |
| Remote Branch | `Show in Graph`、`Show Only This Branch`、`Create Tracking Branch…`、`Merge…`、`Rebase…`、`Copy Branch Name` |
| Remote，例如 `origin` | `Fetch…`、`Refresh` |
| Tag | `Show in Graph`、`Show Only This Tag`、`Create Branch…`、`Checkout…`、`Delete Tag…`、`Copy Tag Name`、`Copy Commit ID` |
| Stash | `View Changes`、`Apply Stash`、`Pop Stash`、`Drop Stash…` |
| Worktree | `Open Worktree`、`Open in New Window`、`Refresh`、`Remove Worktree…`、`Copy Worktree Path` |

## 左侧分组菜单

| 标题 | 项目 |
| --- | --- |
| Repositories | `Add Repository…`、`Refresh` |
| Local Branches | `Create Branch…`、`Select All`、`Clear Selection` |
| Remotes | `Fetch…`、`Refresh` |
| Tags | `Create Tag…`、`Refresh` |
| Stashes | `Stash Changes…`、`Refresh` |
| Worktrees | `Add Worktree…`、`Refresh` |

Graph 中 Commit 的菜单沿用详情操作，包括 `Create Branch…`、`Create Tag…`、`Cherry-pick…`、`Revert…`、`Reset…`、Checkout / Detached HEAD、`Copy Commit ID` 和 `Copy Commit Message`；具体项目根据提交和仓库状态禁用。

## 禁用与受阻规则

- 当前分支禁用 `Checkout` 与 `Delete Branch`。
- 被其他 Worktree 使用的分支显示占用路径，并允许打开该 Worktree。
- 主 Worktree 和当前 Worktree不能移除；Locked Worktree 显示锁定原因。
- Remote Branch 通过 `Create Tracking Branch…` 创建本地跟踪分支；当前范围不删除远端分支。
- Tag 的 `Checkout…` 明确提示进入 Detached HEAD。
- 无变更、无 Staged 文件或没有可用目标时禁用对应操作并说明原因。Push / Pull 缺少默认 remote、upstream 或 branch 时，可在参数框中显式填写；配置仍不足时显示 Git 的具体错误。
- Checkout 可能覆盖修改时显示受影响文件，并提供查看文件与 `Stash Changes & Checkout`。
- 存在未解决冲突时，提示先解决冲突或 Abort 当前操作。

## Working Tree 与 Diff

Working Tree 将文件分为 Conflicts、Unstaged 和 Staged。Stage、Unstage 与 Stash 是不同操作。`Discard Changes…` 只丢弃所选 Unstaged 修改，保留 Index 中同一文件的 Staged 修改；确认对话框必须准确描述受影响内容。

Commit 表单保存每仓库草稿。Commit 只提交 Index；Amend 替换当前提交。底部预览显示选中文件和比较目标，并提供在 VS Code 原生 Diff 或编辑器中打开的入口。二进制、超限、缺失或非法编码内容显示具体说明。

## 语言与文案

支持 English 和 `简体中文`。语言选择对屏幕文字、工具提示、空状态、错误和确认生效。Git 操作与专业术语保留英文，包括 Checkout、Fetch、Pull、Push、Merge、Rebase、Stage、Unstage、Stash、Commit、HEAD、Index 和 Worktree。Commit Message、作者、分支、Tag、路径、代码和 Git 返回文本保持原文。

按钮使用统一的英文 Git 动作名和大小写。`Copy Commit ID` 复制完整 OID，`Copy Commit Message` 复制完整提交信息。语言切换不清除引用筛选、当前对象、面板尺寸或 Commit 草稿。

## 会话恢复

保存全局语言、布局预设、面板尺寸和列宽；按仓库保存勾选引用、搜索、当前 Commit / Stash / 文件、活动区域和 Commit 草稿。恢复时若对象已不存在，清除该对象并给出稳定的回退选择，不对 Git 仓库执行写操作。
