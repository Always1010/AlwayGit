# 工作台规格

本文记录已确认的 AlwayGit 工作台行为，作为实现、测试和以后聊天继续开发时的稳定依据。

## 布局与视觉

`Workbench` 是默认预设：左侧为仓库和引用导航，中间为 Graph 与 History，右侧为 Commit 详情、文件或 Working Tree Commit 表单，底部为只读 Diff。`Editor Focus` 收起底部 Diff，并通过 VS Code 原生编辑器查看和修改文件。

面板分隔线、作者列和日期列可拖动。`Restore Layout` 恢复默认尺寸。提交列表默认字号约 13 px、行高约 26 px，保留交替底色和可辨认的细分隔线。面板标题、边界、可点击快捷项和选中状态必须与普通文字清楚区分。窄窗口不得造成整个工作台横向溢出；必要时各面板内部滚动或收起次要内容。

Graph 使用独立于终端主题色的高区分度色板。远端默认分支（缺失时回退 `main`、`master`）使用加粗的中性色主线；浅色主题为近黑色，深色主题为近白色。其他路径使用蓝、橙、紫、青绿、玫红等颜色，并在分页、刷新和虚拟滚动时保持路径颜色稳定。

## 选择与打开

| 输入 | 行为 |
| --- | --- |
| 勾选引用复选框 | 加入或移出 Graph 显示范围，不 Checkout |
| 勾选分支目录复选框 | 选择或清除该目录下全部分支；部分选中时显示半选状态 |
| 单击引用名称 | 选择并定位该引用，不改变其他引用的勾选状态 |
| 双击本地分支 | Checkout 到该分支 |
| 右键引用 | 打开该对象的菜单，不改变 Graph 筛选 |
| `Show in Graph` | 把目标加入现有筛选 |
| `Show Only This Branch/Tag` | 仅显示目标，不 Checkout |
| 单击 Commit | 单选该 Commit，显示提交详情和文件列表 |
| `Ctrl` / `Cmd` + 单击 Commit | 加入或移出多选集合 |
| `Shift` + 单击 Commit | 从选择锚点到目标 Commit 按当前列表顺序选择连续区间 |
| `Ctrl` / `Cmd` + `Shift` + 单击 Commit | 在现有集合上追加连续区间 |
| 右键已选 Commit | 保留当前多选集合并显示适用操作 |
| 双击 Commit | 关联一个本地分支时 Checkout；关联多个时选择；没有时确认 Detached HEAD |
| 单击详情中的文件 | 在底部预览 Diff |
| 双击文件 | 在 VS Code 打开；历史删除文件打开只读历史内容或原生 Diff |

Local Branches 和 Remote Branches 按分支名中的 `/` 构成递归目录，例如 `feature/login/api` 显示为 `feature > login > api`。目录展开状态按仓库保存；首次进入或 Checkout 后自动展开当前分支所在目录。初次进入仓库时选择当前本地分支及其 upstream。多引用历史是所有已选引用可达提交的并集，共同祖先只出现一次。没有选中引用时显示说明性空状态。当前分支即使未被筛选也继续显示在顶部；`Locate HEAD` 恢复定位。HEAD 在 Graph 与 History 中应有清晰且可访问的标记。

工具栏最右侧的 `Open in VS Code`（在 VS Code 中打开项目）作用于当前选中的仓库目录。优先切换到已打开该目录的项目窗口；没有匹配窗口时打开项目新窗口，保留工作台所在窗口。匹配基于实际工作区目录，支持多根工作区，并区分不同 Worktree；相同目录存在多个窗口时优先使用最近活动的匹配窗口。

目标窗口需要启用同一 Profile 中的 AlwayGit，并信任项目工作区。新窗口就绪后才报告打开成功；目标未响应时显示明确错误。未选择仓库时禁用此按钮，悬停显示项目完整路径。

## 右键菜单通则

菜单在指针附近显示为无分组横线的竖向列表，限制在可视区域内。菜单具有 `menu` 和 `menuitem` 语义；打开时焦点进入菜单，方向键移动，Home/End 跳转，Enter 或 Space 执行，Escape、点击外部和仓库切换关闭。禁用项不可获得执行结果，并说明原因。

分区标题的主区域只执行展开或收起，标题右侧独立三点按钮打开分区菜单。三点按钮必须具有悬停、焦点和可访问名称，不能用不可点击的装饰图标暗示菜单入口。对象菜单继续支持右键和键盘 Context Menu / Shift+F10。

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

Graph 中 Commit 的菜单集中提供 `Create Branch…`、`Create Tag…`、Cherry-pick、`Revert…`、`Reset…`、Checkout / Detached HEAD、`Copy Commit ID` 和 `Copy Commit Message`；顶部工具栏和 Commit Details 标题不重复提供这些入口。普通 Commit 的 Cherry-pick 点击后直接执行；Merge Commit 单独选择 Mainline Parent。多选 Commit 按当前拓扑列表从旧到新执行批量 Cherry-pick，且只处理明确选中的 Commit；包含 Merge Commit 时禁用批量操作并要求单独处理。具体项目根据提交、当前分支和仓库操作状态禁用。

恰好选择两个 Commit 时提供 `Compare Commits`。存在祖先关系时祖先位于左侧；没有祖先关系时保持选择顺序。右侧显示两个 Commit 和差异文件列表，交换按钮可反转比较方向，文件 Diff 支持新增、删除和重命名。

## 禁用与受阻规则

- 当前分支禁用 `Checkout` 与 `Delete Branch`。
- 被其他 Worktree 使用的分支显示占用路径，并允许打开该 Worktree。
- 主 Worktree 和当前 Worktree不能移除；Locked Worktree 显示锁定原因。
- Remote Branch 通过 `Create Tracking Branch…` 创建本地跟踪分支；当前范围不删除远端分支。
- Tag 的 `Checkout…` 明确提示进入 Detached HEAD。
- 无变更、无 Staged 文件或没有可用目标时禁用对应操作并说明原因。Detached HEAD 禁用工具栏 Push。Push 对话框先显示实际的 `Local Branch → Remote/Remote Branch`；当前 upstream、`branch.*.pushRemote`、`remote.pushDefault` 或唯一远端可确定目标时不得显示空白可选项。用户通过 `Change Target…` 显式修改目标；首次 Push 说明会建立 upstream。多远端且没有配置目标时要求选择远端。
- Checkout 可能覆盖修改时显示受影响文件，并提供查看文件与 `Stash Changes & Checkout`。
- 存在未解决冲突时，提示先解决冲突或 Abort 当前操作。

## Working Tree 与 Diff

Working Tree 将文件分为 Conflicts、Unstaged 和 Staged。Stage、Unstage 与 Stash 是不同操作。`Discard Changes…` 只丢弃所选 Unstaged 修改，保留 Index 中同一文件的 Staged 修改；确认对话框必须准确描述受影响内容。

Commit 表单保存每仓库草稿。Commit 只提交 Index；Amend 替换当前提交。底部预览显示选中文件和比较目标，并提供在 VS Code 原生 Diff 或编辑器中打开的图标入口，文字通过悬浮提示和无障碍标签提供。上一处、下一处按钮在当前文件的连续修改块之间移动，到达首尾后禁用而不循环。删除与新增使用高辨识度的红色和绿色整行底色、边缘标记、`−` / `+` 标记及行内变化强调。二进制、超限、缺失或非法编码内容显示具体说明。

`Open Diff` 与 `Edit in VS Code` 沿用项目按钮的窗口定位规则，在目标窗口的当前主编辑器组打开保留的标签（非 Preview），不向右新建分屏，也不关闭已有标签或未保存文档。Diff 请求在目标宿主重新读取原有比较类型，不把当前窗口的内存文档 URI 跨窗口搬运。已打开的工作区文件复用其标签；历史中已删除的文件仍回退到原生 Diff。

## 语言与文案

支持 English 和 `简体中文`。语言选择对屏幕文字、工具提示、空状态、错误和确认生效。Git 操作与专业术语保留英文，包括 Checkout、Fetch、Pull、Push、Merge、Rebase、Stage、Unstage、Stash、Commit、HEAD、Index 和 Worktree。Commit Message、作者、分支、Tag、路径、代码和 Git 返回文本保持原文。

按钮使用统一的英文 Git 动作名和大小写。`Copy Commit ID` 复制完整 OID，`Copy Commit Message` 复制完整提交信息。语言切换不清除引用筛选、当前对象、面板尺寸或 Commit 草稿。

## 会话恢复

保存全局语言、布局预设、面板尺寸和列宽；按仓库保存勾选引用、分支目录展开状态、侧栏分区折叠状态、搜索、当前 Commit / Stash / 文件、活动区域和 Commit 草稿。恢复时若对象已不存在，清除该对象并给出稳定的回退选择，不对 Git 仓库执行写操作。
