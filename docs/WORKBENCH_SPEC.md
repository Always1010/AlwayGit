# 工作台规格

本文记录已确认的 AlwayGit 工作台行为，作为实现、测试和以后聊天继续开发时的稳定依据。

## 布局与视觉

Workbench 是 AlwayGit 唯一的仓库工作入口。活动栏 AlwayGit 图标展开启动侧栏，侧栏使用 VS Code 原生主题按钮，依次显示 `Show Git Workbench` 和 `Open Workbench in New Window`；仅按钮点击执行命令，显示或恢复侧栏不自动打开 Workbench，执行按钮也不强制关闭侧栏。Show 在当前窗口优先聚焦活动 Workbench，否则聚焦最近使用的 Workbench，没有工作台标签时新建；聚焦已有标签保留其仓库、布局与草稿。状态栏 AlwayGit 图标始终保留，`AlwayGit: Show Workbench` 命令复用相同显示行为。`Open Workbench in New Window` 按钮、同名命令与工作台标题栏的窗口图标创建独立空白 VS Code 窗口，并在扩展宿主就绪后打开未选择仓库的 Workbench；仓库选择仍在新 Workbench 内完成。

Workbench 顶部的分栏图标显式创建一个新标签。新标签继承界面设置、草稿与仓库列表，但初始不选择仓库；空白标签的会话保存不得覆盖普通 `Show Workbench` 用于恢复的最后仓库。从仓库对象菜单显式在新标签打开时，则使用该仓库作为新标签的当前仓库。

工作台固定使用 `Workbench`：左侧为仓库和引用导航，中间为 Graph 与 History，右侧为 Commit 详情、文件或 Working Tree Commit 表单，底部为只读 Diff。不再显示布局模式选择；旧 `Editor Focus` 会话兼容迁移到 Workbench，保留面板尺寸、仓库视图和草稿。原生文件编辑与 Diff 入口继续保留。

面板分隔线以及 Graph、作者和日期列可拖动。底部 Diff 的最大高度随当前工作区高度变化，不使用固定像素上限；顶部面板保留最低可用空间。Diff 标题栏提供带悬浮说明和无障碍名称的图标按钮，可收起到标题栏并恢复此前的展开高度。Graph 使用右边界，作者与日期使用各自左边界的可见分隔线；分隔线必须跟随指针方向，不在表格最右边放置难以命中的列拖柄。右上角 `Restore Layout` 为带悬停说明的图标按钮，只恢复面板和列尺寸及 Diff 展开状态，不重置界面设置。提交列表默认字号 13 px、行高 24 px，文字、引用、作者、日期和 Graph 节点垂直居中，保留交替底色和细分隔线。Working Tree 作为紧随当前 HEAD 的前端虚拟 Commit 节点，以实心菱形、强调底色、边界、数量徽标和右侧箭头表达可选择与可进入状态，不显示说明性 Tooltip；HEAD 本身使用普通 Commit 节点，只显示当前分支名称，不增加外圈、绿色行标或 `HEAD ·` 徽标。窄窗口不得造成整个工作台横向溢出；必要时各面板内部滚动或收起次要内容。

使用统一的内容、侧栏、标题和工具栏表面层级，按钮采用小圆角、边界和短时悬停反馈；当前分支独立显示，普通状态、操作进度和冲突使用不同语义。标题默认约 26 px、按钮约 24 px；文件两行信息和操作说明保持可读，不为压缩高度隐藏完整父目录。分区标题保留展开/收起和独立图标操作，具体入口见 [左侧分组操作](#左侧分组操作)。减少动态效果设置关闭过渡与旋转。

右上角齿轮图标打开“界面设置”浮窗，按钮通过悬浮说明和无障碍名称表达用途，不重复显示文字。浮窗约 760 px 宽，左侧以“常规 / 界面 / 提交图”为一级分组，包含语言、主题、字号与密度、配色等二级入口；右侧一次只显示当前设置页并标明层级路径。主题以可预览卡片选择，可跟随 VS Code 明暗/高对比模式，也可独立选择清透亮色、暖纸、雾蓝、深夜、午夜蓝、石墨、森林、莓紫或高对比；AlwayGit 使用每套主题统一的表面、文字、边框和选中颜色。界面字号支持 12–16 px，Diff 字号支持 11–18 px（默认 12 px）；列表密度为 22/24/28 px。文件列表间距独立控制文件行的上下留白，默认每侧 1 px，提供 0/1/3/5 px 预设与 0–8 px 自定义值；13 px 字号下默认两行文件列表约 32 px 高，Commit Details、Commit 比较和 Working Tree 一致使用。长路径换行或大字号时自动增高，旧会话使用新默认间距并保留其他设置。Diff 行高独立设置，默认 18 px，提供 18/20/22/24 px 预设及 16–36 px 自定义值，实际行高至少为 Diff 字号 + 4 px；旧会话缺少此设置时使用新默认值，保留已有字号。大字号自动增加最小行高，虚拟列表同步测量并保留顶部阅读位置。

调整立即预览；“应用”保存，无需重启。“取消”、关闭、Esc 或点击遮罩还原未应用的预览。预览期间后台刷新仍保存已应用设置；提交草稿、仓库选择和文件内容不受设置影响。设置存于当前工作区，对其全部仓库生效。顶部工具栏移除重复的 Stage、Unstage、Discard，文件操作集中于 Working Tree 分组。

Graph 提供鲜明 12 色（默认）、高区分 8 色、扩展 16 色，默认色值采用高饱和、跨色相方案，并分别适配浅色和深色背景。预设是编辑起点；用户可以逐色输入 HEX 或使用取色器，也可在 4–16 色范围内增删颜色、恢复当前预设，并单独设置浅色/深色主线。配色页使用实际分叉、并行和合并路径预览，并提示每种颜色与预览背景是否达到 3:1。远端默认分支（缺失时回退 `main`、`master`）使用加粗主线；HEAD 节点保持普通 Commit 外观，通过分支名称和无障碍语义识别。颜色绑定历史路径而非列位置：第一父继承，已存在的父路径沿用原色，新路径优先空闲色，再按用户当前浅色和深色色板的色差选择。结束路径释放色位，色板耗尽时优先避免邻线同色，不保证任意多条同时活跃路径全部异色。

Graph 根据本机最近一次 Fetch 后已知的 `refs/remotes/*` 判断 Commit 是否存在于远端：远端可达的 Commit 使用实心节点和加粗消息，仅本地 Commit 使用较小空心节点和正常字重。Merge Commit 保留较大尺寸，选择和悬停状态与推送状态叠加显示。路径结束后必须及时收拢内部空轨道，以过渡曲线保持相邻行端点一致；默认 Graph 列为 64 px，可在 48–180 px 之间持久化调整，轨道间距自适应，极端并行路径不得被裁掉。历史标题区提供紧凑图例；分页和搜索结果由 Git 层携带推送状态，不根据当前可见引用标签推测。

Working Tree 作为只存在于前端的虚拟提交节点显示，不创建 Git Commit，也不计入历史数量、分页 offset 或 Commit 批量操作。当前 HEAD 位于 Graph 筛选结果中时，Working Tree 以它为父节点，在新到旧的列表中紧邻 HEAD 上方，并随 Commit、Checkout、Reset 和分支切换移动；当前分支或 HEAD 被筛除时，只保留独立 Working Tree，不重新插入 HEAD，也不绘制指向隐藏 HEAD 的连线。整行常驻青绿色底色、左侧 3 px 色条和细边界；菱形节点、柔和外圈、连接 HEAD 的当前行短线、文件图标和进入箭头使用同一青绿色，明暗主题分别适配。悬停和选中逐级加深底色，选中后仍保留绿色，与普通 Commit 的主题选中状态区分；行高及历史位置不变。Message 列显示加粗标题、次要变更数量徽标、冲突数和带分支图标的当前分支，Date 列显示 `Uncommitted`。没有首个 Commit 时同样显示独立的初始 Working Tree 节点。

单击 Working Tree 显示工作区详情，Enter 等同单击；上下方向键可以在它与相邻 HEAD/Commit 间连续导航。Working Tree 不参加 Ctrl/Cmd 或 Shift Commit 多选，不响应 Checkout 双击，也不显示 Commit 右键菜单。辅助技术必须能够识别其虚拟节点、当前分支、变更数量、未提交状态和选中状态。

分页携带路径、色板特征和分配游标；主题切换保留色位，预设、色值或颜色数量变化都会重建全图，不拼接旧色板的分页。相同历史顺序刷新与虚拟滚动保持颜色；筛选、引用范围变化可能重分配。悬停 Graph 路径强调所有可见片段，并淡化其他路径。有限色板不宣称适用于所有色觉情况。

## 选择与打开

Workbench 明确区分未添加仓库、尚未选择仓库、正在打开仓库、仓库已移除或不可用、普通分支与真实 Detached HEAD。只有已加载的仓库没有当前分支时显示 `Detached HEAD`；其他未开始状态不借用 Git 异常状态表达。新会话不自动选中列表第一个仓库；当前仓库被移除时标签明确回到未选择状态，不静默切换到其他项目。

`Add Repository…` 可选择单个仓库或存放多个仓库的目录。选中目录有 `.git` 时验证并添加该仓库；否则递归扫描所有层级的子目录，一次性添加发现的有效仓库和 Worktree（支持 `.git` 目录与文件）。找到有效仓库后不再扫描其内部，因而不自动添加嵌套仓库和子模块；不跟随子目录链接或 Windows junction，也不进入 `.git`。

扫描显示已扫描目录数和发现仓库数，支持取消；取消扫描不添加任何仓库。无效仓库和无法访问的子目录单独跳过并汇总提示，详情写入 AlwayGit 输出。重复仓库不重复注册；批量添加只保存和通知一次，保持当前仓库、布局与草稿，记住新增仓库供下次打开工作台恢复。递归扫描仅在主动添加目录时执行。

Workbench 的 Repositories 顶层列表按共享 Git 存储归并，同一仓库的主目录及 linked Worktree 只占一个入口；仓库名称来自 Git 报告的主工作目录。递归发现、新增和已有仓库数量均按归并后的仓库统计，独立克隆保持独立。工作目录在当前仓库的 Worktrees 区域切换；选中 linked Worktree 时，顶层仍标记所属仓库，菜单和工具栏操作以当前工作目录为目标。直接只添加 Worktree 也保留其入口；没有当前选择时优先使用已注册的主目录。

`Add Repository…` 打开工作台内嵌浮窗；只有选择磁盘目录时使用 VS Code 原生目录选择器。选定目录后，同一浮窗显示可取消的递归扫描进度，再按名称显示逻辑仓库级多选结果，分别标记“可添加”和禁用的“已添加”。可添加项默认全选，支持筛选、全选、普通切换与 Shift 连续范围；目标分组和内联新建分组位于同一确认流程，主按钮明确显示将添加的仓库数量。扫描、筛选和关闭浮窗不改变仓库目录，只有最终确认项才注册；跳过项及原因留在浮窗中查看。仓库行和分组标题通过右键打开管理菜单；仓库菜单及多选菜单提供 `Remove from AlwayGit…`。工作台内嵌确认浮窗列出将移除的仓库并说明磁盘文件不受影响。该操作只移除导航与持久化记录、释放监听并阻止自动发现立即恢复，不删除磁盘目录或 Git 数据；再次明确添加会恢复显示。

用户可以创建、重命名和删除仓库分组，并将单个或多个逻辑仓库移动到分组。分组在 Workbench 的 Repositories 中显示为可折叠目录；没有归属的仓库不创建“未分组”目录，直接与分组目录同处 Repositories 根层。删除分组只删除组织结构，其中仓库回到根层，不从 AlwayGit 移除。分组名称、归属及排列顺序随仓库路径在同一 VS Code Profile 与运行环境内共享。根层的仓库与分组共用顺序，新增项追加到所在层级末尾；移动仓库到分组或根层时追加到目标末尾，重命名不改变位置。分组和仓库支持同层拖动排序，落点显示插入线；右键提供上移、下移，边界项禁用。删除分组时其中仓库按组内顺序追加到根层末尾。旧数据首次迁移保留根层仓库原有相对顺序，分组按保存的创建顺序排在其后；迁移与排序不改变仓库 ID、活动 Worktree、草稿和选择，Shift 范围与展开后的显示顺序一致。

Repository 和 Worktree 名称行单击只改变操作选择，不切换当前仓库或工作目录；普通单击单选，Ctrl/Cmd 单击切换单项，Shift 单击选择连续范围，Ctrl/Cmd+Shift 将连续范围加入既有选择。双击或键盘 Enter 才切换仓库或 Worktree。右键已选项保留批量选择，右键未选项先切为单选。当前 Repository、Worktree 和本地分支统一在内容排头显示实心播放三角形，浅色背景使用纯黑、深色背景使用纯白；蓝色选择背景只表示操作范围，当前状态与操作选择可以同时存在。非当前行保留同宽空位以对齐内容。分支复选框属于 Graph 筛选控件，三角形位于复选框之后、分支图标之前。当前状态使用 `aria-current` 暴露给辅助技术，不重复显示 `Current` 文字徽标。Detached HEAD 时不标记本地分支，但仍标记当前 Worktree。

当焦点位于可多选区域或其标题、行内控件时，Ctrl/Cmd+A 只全选焦点所属作用域，Escape 只清除该作用域的操作选择；快捷键由区域容器捕获，不能落到整页文本选择。Repository 的范围是全部逻辑仓库；Local Branches 的范围是全部本地分支；每个 Remote 是独立范围，只包含该 Remote 下的分支；Worktrees 的范围是当前仓库的全部 Worktree。分支 action selection 与 Graph 筛选复选框相互独立，Ctrl/Cmd+A 和 Escape 都不改变 `checkedRefs`。History 的范围是当前已经加载的真实 Commit，不为全选隐式加载下一页，并排除 Working Tree 虚拟 Commit。Working Tree、Commit Details 和 Commit 比较的文件区域只处理当前面板可见文件。输入框、文本域和可编辑内容保留 Ctrl/Cmd+A 与 Escape 的原生行为。

Working Tree、Commit Details 和 Commit 比较的文件列表统一使用中性的文件图标，右下角以彩色角标显示 Git 状态：黄色 M 修改、绿色 A 新增、红色 D 删除、紫色 R 重命名，未跟踪显示 ?、冲突显示 !，复制和类型变更分别显示 C 和 T。悬停角标或文件名可查看完整含义；列表不常驻显示状态图例。没有选择文件时，分组按钮显示 `Stage All` 或 `Unstage All`，点击后先显示实际文件数量的确认浮窗，确认按钮默认获得焦点，可按 Enter 快速执行；Escape、点击遮罩或 Cancel 取消。已明确选择文件时，分组按钮以及右键菜单中的 Stage / Unstage 直接作用于所选范围，不重复确认。

分组应用于全部添加、恢复和自动发现入口。已有保存路径无需清除，工作目录 ID、各自的 Commit 草稿与视图继续保留；不将多个 Worktree 的文件或暂存区状态合并。

| 输入 | 行为 |
| --- | --- |
| 单击 Repository 名称 | 更新单选或 Ctrl/Cmd、Shift 批量操作选择，不切换当前仓库 |
| Repositories 中按 `Ctrl` / `Cmd` + `A`；按 `Escape` | 全选全部逻辑仓库的操作选择；清除 Repository 操作选择 |
| 单击 Worktree 名称 | 更新单选或 Ctrl/Cmd、Shift 批量操作选择，不切换当前工作目录 |
| Worktrees 中按 `Ctrl` / `Cmd` + `A`；按 `Escape` | 全选当前仓库的全部 Worktree；清除 Worktree 操作选择 |
| 双击 Repository / Worktree 名称 | 切换到目标仓库或 Worktree |
| Repository / Worktree 名称获得焦点后按 Enter | 切换到目标仓库或 Worktree |
| 勾选引用复选框 | 加入或移出 Graph 显示范围，不 Checkout |
| 勾选分支目录复选框 | 选择或清除该目录下全部分支；部分选中时显示半选状态 |
| 单击引用名称 | 选择并定位该引用，不改变其他引用的勾选状态 |
| `Ctrl` / `Cmd` + 单击分支 | 加入或移出批量操作选择，不改变 Graph 勾选状态 |
| `Shift` + 单击分支 | 在同一个 Local 或 Remote 树内按可见顺序选择连续范围 |
| Local Branches 中按 `Ctrl` / `Cmd` + `A`；按 `Escape` | 全选全部本地分支的 action selection；清除该选择；均不改变 Graph `checkedRefs` |
| 单个 Remote 中按 `Ctrl` / `Cmd` + `A`；按 `Escape` | 只全选或清除该 Remote 下分支的 action selection；不影响其他 Remote、Local 或 Graph `checkedRefs` |
| 双击本地分支 | Checkout 到该分支 |
| 双击远程分支 / 远程引用徽标 | 打开 `Checkout as Local Branch…`，创建或复用本地跟踪分支并默认 Checkout |
| 右键已选分支 | 保留当前批量选择并打开适用菜单，不改变 Graph 筛选 |
| 右键未选分支 | 先将批量操作选择切换到该分支，再打开菜单 |
| 右键分支目录 | 选择目录下全部分支，并打开批量操作菜单 |
| `Show in Graph` | 把目标加入现有筛选 |
| `Show Only This Branch/Tag` | 仅显示目标，不 Checkout |
| 单击 Commit | 单选该 Commit，显示提交详情和文件列表 |
| `Ctrl` / `Cmd` + 单击 Commit | 加入或移出多选集合；恰好选中两个时自动比较 |
| `Shift` + 单击 Commit | 从选择锚点到目标 Commit 按当前列表顺序选择连续区间；区间恰好包含两个时自动比较 |
| `Ctrl` / `Cmd` + `Shift` + 单击 Commit | 在现有集合上追加连续区间 |
| History 中按 `Ctrl` / `Cmd` + `A`；按 `Escape` | 全选当前已加载的真实 Commit 或清空 Commit 多选；不加载更多，不包含 Working Tree |
| 右键已选 Commit | 保留当前多选集合并显示适用操作 |
| 双击 Commit | 关联一个本地分支时 Checkout；关联多个时选择；没有时确认 Detached HEAD |
| 单击 Working Tree 虚拟节点 | 单选 Working Tree 并显示工作区状态；不加入 Commit 多选 |
| Working Tree / HEAD 获得焦点后按上下方向键 | 在虚拟节点与真实 Commit 间连续选择和移动焦点 |
| 单击详情中的文件 | 在底部预览 Diff |
| 双击文件 | 在 VS Code 打开；历史删除文件打开只读历史内容或原生 Diff |

Local Branches 和 Remote Branches 按分支名中的 `/` 构成递归目录，例如 `feature/login/api` 显示为 `feature > login > api`。目录展开状态按仓库保存；首次进入或 Checkout 后自动展开当前分支所在目录。初次进入仓库时选择当前本地分支及其 upstream。多引用历史是所有已选引用可达提交的并集，共同祖先只出现一次。没有选中引用时显示说明性空状态。Working Tree 始终保留并显示当前分支名称，不重新插入被过滤掉的 HEAD Commit；`Locate HEAD` 恢复定位。可见 HEAD 通过当前分支徽标和辅助技术语义表达归属。

输入 Commit 搜索条件时，History 显示“提交搜索结果”和已加载的匹配数量；仍有下一页时数量带 `+`。搜索结果隐藏整个 Graph 列、分隔线与节点，不对缺少中间提交的结果计算轨道；提交信息列使用释放的宽度。引用徽标、作者、时间、行选择与菜单继续可用，推送状态以标题前的实心或空心圆点表达。单选一个匹配 Commit 后，可用“在完整历史中定位”图标清空搜索，沿用当前引用范围加载历史直到目标可见并滚动定位；更改搜索、引用、仓库或选择会停止旧定位。清空搜索恢复 Graph 及原有列宽。

工具栏最右侧的 `Open in VS Code`（在 VS Code 中打开项目）作用于当前选中的仓库目录。优先切换到已打开该目录的项目窗口；没有匹配窗口时打开项目新窗口，保留工作台所在窗口。匹配基于实际工作区目录，支持多根工作区，并区分不同 Worktree；相同目录存在多个窗口时优先使用最近活动的匹配窗口。

目标窗口需要启用同一 Profile 中的 AlwayGit，并信任项目工作区。新窗口就绪后才报告打开成功；目标未响应时显示明确错误。未选择仓库时禁用此按钮，悬停显示项目完整路径。

## 自动更新与查看状态

工作区文件变化会更新当前仓库的状态；已选引用变化时更新 History。查看历史 Commit 时，无关的文件、Index 或引用变化不会清空 Commit 详情和 Diff，也不会重置已选 Merge Parent、文件及 Diff 滚动位置。手动 Refresh 会重查仓库状态和历史，同时保留同一个历史比较。

Working Tree 中所选文件或相关 Index 内容变化时更新该比较，包括文件一直处于 modified 状态而内容再次改变的情况。有效的 Staged / Unstaged / Conflicts 选择继续保留；比较区域或文件消失时才回退到有效目标。后台更新同一个 Diff 时保留现有画面和滚动位置，切换比较目标时在内容加载后自动定位第一处修改；收起面板时暂缓，首次展开后定位。

## 右键菜单通则

Commit 的图形、Message、作者和日期作为整行统一悬停、选择和焦点；双击任一列执行相同的 Checkout 入口。Enter 选择，方向键同步移动选择和焦点，Context Menu / Shift+F10 打开提交菜单。行内引用徽标保持独立的分支操作。

菜单在指针附近显示为无分组横线的竖向列表，限制在可视区域内。菜单具有 `menu` 和 `menuitem` 语义；打开时焦点进入菜单，方向键移动，Home/End 跳转，Enter 或 Space 执行，Escape、点击外部和仓库切换关闭。禁用项不可获得执行结果，并说明原因。

分区及 Remote 标题的主区域只执行展开或收起，标题右侧图标按钮直接执行对应操作；右键标题可打开相同操作的菜单。图标按钮具有悬停、焦点和可访问名称。仓库、分支、Tag、Stash、Worktree、文件和 Commit 的对象菜单通过右键或键盘 Context Menu / Shift+F10 打开。

操作绑定被右键点击的仓库和对象。打开对话框后也不能改用之前选中的 Commit、当前筛选或变化后的 `stash@{n}`；执行前重新核对对象身份。

## 左侧对象菜单

用户主动添加的仓库列表在同一 VS Code Profile 和本地或远程运行环境内的窗口间共享。任一窗口添加、移除、建立分组、重命名或移动仓库后，其他已打开窗口重新对齐目录并刷新；不同 Profile 或本地/远程扩展运行环境仍然隔离。`Open in New AlwayGit Tab` 在当前 VS Code 窗口创建独立编辑器标签，标题为 `AlwayGit — 仓库名`；每个标签独立维护活动仓库、引用选择、查找、滚动和查看状态，Git 状态变化与仓库操作忙碌状态在标签和窗口间同步。同一共享 Git 存储的写操作跨窗口串行，第二个操作不会与正在运行的操作并发；不同仓库可并行。显式选择新标签时始终新建，不复用已有标签；多选仓库菜单不提供批量打开标签。新建空白标签和新建窗口都不继承当前标签选择，重新打开已有窗口时才按该窗口自己的会话恢复。不同 VS Code 窗口的界面会话同样不会互相覆盖。

| 对象 | 项目 |
| --- | --- |
| Repository（单选） | `Switch to Repository`、`Open in New AlwayGit Tab`、`Open Repository in New Project Window`、`Fetch…`、`Refresh Status`、`Copy Repository Path`、`Move to Repository Group…`、`Remove from AlwayGit…` |
| Repository（多选） | `Fetch N Repositories…`、`Refresh Status for N Repositories`、`Copy N Repository Paths`、`Move to Repository Group…`、`Remove from AlwayGit…` |
| Repository Group | `Rename Repository Group…`、`Delete Repository Group…` |
| Local Branch | `Checkout…`、`Show in Graph`、`Show Only This Branch`、`Create Branch…`、`Create Tag…`、`Merge…`、`Rebase…`、`Push…`、`Delete Branch…`、`Copy Branch Name` |
| Remote Branch | `Show in Graph`、`Show Only This Branch`、`Checkout as Local Branch…`、`Merge…`、`Rebase…`、`Delete Branch from <remote>…`、`Copy Branch Name` |
| Remote 分支目录 / 多选 | `Create Local Tracking Branches…`、Graph 批量筛选、远端批量删除和复制名称 |
| Remote，例如 `origin` | `Fetch…`、`Create Local Tracking Branches…`、`Refresh` |
| Tag | `Show in Graph`、`Show Only This Tag`、`Create Branch…`、`Checkout…`、`Delete Tag…`、`Copy Tag Name`、`Copy Commit ID` |
| Stash | `View Changes`、`Apply Stash`、`Pop Stash`、`Drop Stash…` |
| Worktree | `Open Worktree`、`Open Worktree in New Project Window`、`Refresh`、`Remove Worktree…`、`Copy Worktree Path` |
| Worktree（多选） | `Refresh`、`Copy N Worktree Paths` |

## 左侧分组操作

分组标题不使用省略号菜单；项目少且含义明确的操作直接显示为纯图标按钮，并通过悬浮提示、键盘焦点和无障碍名称说明用途。右键标题仍可打开同一组操作。Local Branches 的 Graph 筛选位于标题下方的分段图标控件，提供全部本地分支和仅当前分支两个预设；当前预设以强调状态显示，自定义勾选组合时两项均不激活。

| 标题 | 项目 |
| --- | --- |
| Repositories | `Add Repository…`、`Create Repository Group`、`Refresh` |
| Local Branches | 标题：`Create Branch…`；Graph 预设：`Show All Local Branches in Graph`、`Show Current Branch Only in Graph` |
| Remotes | 标题行仅显示 `＋` 添加远端图标，悬浮提示与无障碍名称为 `Add Remote…`；右键菜单提供 `Add Remote…`、`Create Local Tracking Branches…`、`Refresh`。Fetch 位于各 Remote 行；没有远端时正文说明尚未连接并保留文字入口 |
| Tags | `Create Tag…`、`Refresh` |
| Stashes | `Stash Changes…`、`Refresh` |
| Worktrees | `Add Worktree…`、`Refresh` |

Graph 中 Commit 的菜单集中提供 `Create Branch…`、`Create Tag…`、Cherry-pick、`Revert…`、`Reset…`、Checkout / Detached HEAD、`Copy Commit ID` 和 `Copy Commit Message`；顶部工具栏和 Commit Details 标题不重复提供这些入口。普通 Commit 的 Cherry-pick 点击后直接执行；Merge Commit 单独选择 Mainline Parent。多选 Commit 按当前拓扑列表从旧到新执行批量 Cherry-pick，且只处理明确选中的 Commit；包含 Merge Commit 时禁用批量操作并要求单独处理。具体项目根据提交、当前分支和仓库操作状态禁用。

恰好选择两个 Commit 时自动进入 `Compare Commits`，右键菜单仍保留显式入口。存在祖先关系时祖先位于左侧；没有祖先关系时保持选择顺序。右侧显示两个 Commit 和差异文件列表，交换按钮可反转比较方向，文件 Diff 支持新增、删除和重命名。取消到一个 Commit 时恢复该提交详情；增加到三个以上时显示最后操作的提交并保留多选批量操作；清空选择时同步清空右侧详情。手动或后台刷新 History 时保留仍然有效的双 Commit 比较。

## 禁用与受阻规则

工具栏下的操作信息栏显示 Git 操作名称、目标及进行中、成功、失败状态；结果保留到用户关闭或下一次操作，进行中不可关闭。Commit 成功时显示短哈希、实际提交的暂存文件数以及剩余未提交变更数或干净工作区状态，并提供 `View Commit` 直接打开新提交。失败显示原因摘要，并提供完整错误详情和日志入口；Commit 失败不清空消息草稿。失败后重新读取仓库状态。操作反馈按仓库隔离，切换仓库不会展示其他仓库的结果。

Merge、Rebase、Cherry-pick、Revert 的活动状态在独立操作条中持续显示。冲突时显示数量、处理说明和“查看冲突”，进入 Working Tree 并定位首个冲突文件；Continue 禁用原因直接可见。Git 的 unmerged entries 归零后显示“待检查结果”和“检查暂存结果”，只表示 Git 允许继续，不宣称内容已经正确解决；完成或 Abort 后移除。没有活动操作的冲突也显示提醒。Skip 只在 Git 支持时出现。

冲突处理顺序为查看冲突、在 VS Code 中编辑并保存、返回工作台“已手动处理，标记并暂存”。此动作不会选择正确内容或验证结果；反馈写“已标记并暂存；继续前请检查结果”。冲突菜单与普通文件 Stage 分开，混合选择不能用普通 Stage 文案隐含标记冲突。

Continue 和活动操作期间的普通 Commit 均先检查实际 Index 内容，列出暂存变更文件及疑似冲突标记行号（含 diff3/zdiff3 与非默认标记宽度，最多显示每文件前 100 处）。单文件超过 2 MiB、累计超过 16 MiB、二进制、非 UTF-8 内容及子模块明确标为未扫描。提供返回检查、暂存 Diff 和编辑入口；有疑似标记或未扫描文件时，需要勾选明确确认后才能“仍然继续”，允许合法标记文本。没有标记也不保证语义正确。确认绑定当前操作、分支、HEAD 和 Index 内容，变更后必须重新检查；编辑后需重新保存并暂存。活动操作期间不允许 Amend，未保存的编辑器修改在 Continue / Commit 前另行提示。

Merge 等操作暂停后，原发起对话框改为处理状态，主入口是“查看并处理冲突”，关闭按钮写“关闭此窗口”，并直接提供“中止本次操作”。关闭对话框只关闭窗口，Git 仍暂停；操作条继续保留 Abort。Abort 使用工作台说明与原生确认，有可确认的操作起点时显示 Commit，说明 Git 将尝试恢复操作开始时的状态、冲突处理修改可能丢弃，以及操作前已有修改可能影响完整恢复。

- 当前分支禁用 `Checkout` 与 `Delete Branch`。
- Create Branch 在名称字段实时解释 Git 分支名限制并保留错误输入和焦点；起点优先显示“当前分支 `<name>` · 当前版本”或对应分支、Tag、Commit，内部引用只在 Git 详情中显示。对话框明确提供“仅创建”和默认主操作“创建并切换”；完成后分别说明当前仍在原分支或已经切换到新分支。
- 被其他 Worktree 使用的分支显示占用路径，并允许打开该 Worktree。
- 主 Worktree 和当前 Worktree不能移除；Locked Worktree 显示锁定原因。
- Remote Branch 的 `Checkout as Local Branch…` 列出远程来源与本地名称，默认剥除 Remote 前缀并保持完整目录（`origin/feature/login/api` → `feature/login/api`），自动选择已有跟踪分支，允许改名。多个已有本地跟踪分支时提示用户选择名称。单项默认 Checkout，可取消切换；Remote 父级、Remotes 分组、分支目录和远程多选通过 `Create Local Tracking Branches…` 创建或复用全部后代，保持当前分支。对话框逐项显示将创建、已跟踪、同名 upstream 冲突、路径冲突与成功结果；名称冲突阻止执行，不覆盖已有分支或改写 upstream。使用最近 Fetch 的引用，不自动 Fetch/Pull；后端重新校验来源与 OID。`origin/HEAD` 等符号引用不可检出为本地分支，批量范围自动排除。
- Local 与 Remote 的批量选择互相隔离；同一 Remote 下的普通分支可以批量 `Delete … from <remote>…`，操作明确显示远端和分支清单并二次确认，通过逐项 Push 删除并汇总部分失败。`origin/HEAD` 等符号引用不可删除。
- Tag 的 `Checkout…` 明确提示进入 Detached HEAD。
- 无变更、无 Staged 文件或没有可用目标时禁用对应操作并说明原因。Detached HEAD 禁用工具栏 Push。仓库没有远端时，Push 不显示无法完成的空选择器，而是说明本地 Commit 已保存、发送前需要连接远端，并直接进入 `Add Remote…`；添加成功后返回 Push。Push 对话框先显示实际的 `Local Branch → Remote/Remote Branch`；当前 upstream、`branch.*.pushRemote`、`remote.pushDefault` 或唯一远端可确定目标时不得显示空白可选项。用户通过 `Change Target…` 显式修改目标；首次 Push 说明会建立 upstream。多远端且没有配置目标时要求选择远端。`Force-with-lease` 位于默认折叠的高级选项，启用后说明可能覆盖远端历史以及只在远端未发生未知变化时执行的保护条件。
- 当前分支存在未推送提交时，工具栏 Push 与仓库导航项使用高饱和通知角标显示数量；用户可以在“界面 / 状态提醒”中选用预设色或输入 HEX，文字自动在黑白之间选择以保持对比，并使用亮色边缘增强辨识度。数量为零时不显示角标。仓库列表先显示，角标状态随后在后台加载，当前仓库的角标随状态刷新即时更新。
- Checkout 可能覆盖修改时显示受影响文件，并提供查看文件与 `Stash Changes & Checkout`。
- 存在未解决冲突时，提示先解决冲突或 Abort 当前操作。

## Working Tree 与 Diff

Working Tree 将文件分为 Conflicts、Unstaged 和 Staged。Stage、Unstage 与 Stash 是不同操作。`Discard Changes…` 只丢弃所选 Unstaged 修改，保留 Index 中同一文件的 Staged 修改；确认对话框必须准确描述受影响内容。

Stash 详情按 Working Tree、Index 和 Untracked Files 分类展示并在页签标明数量；顶部按路径去重显示保存文件总数和未跟踪文件数。首次打开选择第一个非空分类。用户主动进入空分类时，空状态指出包含内容的分类及数量，并提供直接跳转。Stash 成功反馈同时说明保存文件数、未跟踪文件数和操作后的工作区状态。

Apply / Pop Stash 在执行前检查保存的未跟踪文件是否已在工作区存在。命中路径冲突时不得调用 Git Apply，也不得覆盖、删除或重命名任一份内容；对话框说明现有文件未被覆盖、Stash 仍保留，列出冲突路径并提供比较两份内容和打开现有文件的图标入口。已知原因未解决时不保留重复 Apply 按钮，只允许取消并保留当前状态；用户更换 Stash 或外部解决冲突后可重新发起。其他可能由 Git 部分应用的失败不得宣称工作区未改变。

分组标题采用展开箭头、短标题与数量徽标，可通过单击或键盘展开、收起文件列表；收起分组不切换已有 Diff，Ctrl/Cmd+A 只选择展开分组的可见文件。右侧 `Stage All` / `Unstage All` 为清晰的描边按钮；有选择时显示操作数量。Working Tree 不显示文件或分组复选框，Discard 为带悬停说明和可访问名称的图标按钮，仅在选中 Unstaged 文件后启用。空分组压缩提示，完整父目录和文件选择规则保持不变。

文件行第一行显示文件名，第二行显示以 `./` 开头的完整仓库相对父目录链，不限制目录层级；根目录文件显示 `./`，子目录文件显示如 `./docs`、`./src/protocol`。长父目录换行，完整路径也可通过悬浮提示查看。Commit Details 和 Commit 比较的 Changed Files 支持按完整仓库相对路径进行大小写不敏感的关键字筛选；筛选仅影响可见文件和当前批量选择，不自动切换既有 Diff，切换 Commit 时保留查询，离开历史详情或切换仓库时清空。

Working Tree、Commit Details 和 Commit 比较文件列表均不显示复选框：单击文件即选中并预览，Ctrl/Cmd+单击切换选择，Shift+单击选择范围。焦点在文件区域时 Ctrl/Cmd+A 全选当前面板可见文件，Escape 清空，文本输入保持原生行为。Working Tree 的组内按钮只处理该组选择，没有选择时 Stage / Unstage 明确显示 All，Discard 无选择时禁用；Commit Details 和比较文件的 Copy Paths 处理当前可见选择。

文件右键菜单绑定当前批量选择：右键已选文件保留选择，右键未选文件先切换为单选。Working Tree 按文件区域提供 Stage、Unstage、“已手动处理，标记并暂存”与 Discard；单文件同时提供在 VS Code 中打开 Diff 和编辑入口，冲突文件还提供行内编辑按钮及返回工作台暂存的说明。历史与比较文件提供打开 Diff、编辑和复制路径。非输入、非可编辑、没有文本选择的工作台区域不显示宿主的剪切、复制、粘贴菜单；文本输入与 Diff 文本选择保留原生编辑和复制行为。

Commit 表单保存每仓库草稿。Commit 只提交 Index；Amend 替换当前提交。底部预览显示选中文件和比较目标，并提供在 VS Code 原生 Diff 或编辑器中打开的图标入口，文字通过悬浮提示和无障碍标签提供。上一处、下一处按钮在当前文件的连续修改块之间循环移动；仅有一处修改时，两枚按钮均可重新定位这一处，只有没有修改时禁用。短修改块尽量居中，超过视口高度的修改块从开头显示。收起并展开同一比较时保留阅读位置。删除与新增使用高辨识度的红色和绿色整行底色、边缘标记、`−` / `+` 标记及行内变化强调。二进制、超限、缺失或非法编码内容显示具体说明。

`Open Diff` 与 `Edit in VS Code` 沿用项目按钮的窗口定位规则，在目标窗口的当前主编辑器组打开保留的标签（非 Preview），不向右新建分屏，也不关闭已有标签或未保存文档。Diff 请求在目标宿主重新读取原有比较类型，不把当前窗口的内存文档 URI 跨窗口搬运。已打开的工作区文件复用其标签；历史中已删除的文件仍回退到原生 Diff。

Diff 标题栏平铺显示新增、修改、删除块数量及“当前/总修改块”，不使用输入框式边框或背景。只有右侧内容的连续块计为新增，只有左侧内容的连续块计为删除，同时包含两侧内容的连续块计为修改，三者之和等于总修改块数。上下箭头在连续修改块之间导航，一个连续修改块只画一个外边框。手动纵向滚动以视口中心对应的最近修改块更新序号；换文件重置，同文件刷新保持滚动并重映射当前块。长行横向滚动时两侧比较列及行号保持可见。截断文件的全部计数注明仅覆盖预览。

## 语言与文案

支持 English 和 `简体中文`。语言选择对屏幕文字、工具提示、空状态、错误和确认生效。Git 操作与专业术语保留英文，包括 Checkout、Fetch、Pull、Push、Merge、Rebase、Stage、Unstage、Stash、Commit、HEAD、Index 和 Worktree。Commit Message、作者、分支、Tag、路径、代码和 Git 返回文本保持原文。

按钮使用统一的英文 Git 动作名和大小写。`Copy Commit ID` 复制完整 OID，`Copy Commit Message` 复制完整提交信息。语言切换不清除引用筛选、当前对象、面板尺寸或 Commit 草稿。

## 会话恢复

保存工作区内的界面设置、面板尺寸、Diff 收起状态和列宽；按仓库保存勾选引用、分支目录展开状态、侧栏分区折叠状态、搜索、当前 Commit / Stash / 文件、活动区域和 Commit 草稿。恢复时若对象已不存在，清除该对象并给出稳定的回退选择，不对 Git 仓库执行写操作。

同一窗口中的多个 AlwayGit 标签分别使用 VS Code Webview state 恢复自身状态；最近保存的工作区会话只作为新建标签的初始基线，不会主动覆盖已打开标签的内存状态。

## VS Code 配置

| 设置 | 默认值 / 范围 | 行为 |
| --- | --- | --- |
| `alwaygit.gitPath` | 空字符串；机器级设置 | 依次使用显式路径、VS Code 内置 Git 扩展提供的路径和 PATH |
| `alwaygit.historyPageSize` | 300；50–1000 | 每次历史分页加载的真实 Commit 数量上限 |
| `alwaygit.refreshInterval` | 15 秒；5–300 秒 | 对可见工作台当前仓库进行补偿刷新 |
| `alwaygit.language` | `en`；`en` / `zh-CN` / `auto` | 初始语言；`auto` 跟随 VS Code，界面设置中的工作区语言选择优先 |

修改 Git 路径或刷新间隔后需要重新加载 VS Code 窗口。界面设置中的主题、配色、字号、密度和语言应用后即时生效。

## 功能与环境边界

Git 操作在仓库所在的扩展宿主中执行，架构面向本地、WSL、Remote SSH 和 Dev Containers；各环境的验收证据见 [验证与本地更新](VALIDATION.md#验证证据与覆盖边界)。未受信任工作区不执行 Git，纯浏览器虚拟工作区不受支持。

当前使用整文件暂存和普通 Rebase。分块暂存、交互式 Rebase、提交重排、Squash、Fixup、Format Patch、远程 Tag 管理和自由浮动面板不在当前范围内。远程分支单项及同 Remote 批量删除已支持，具体确认与部分失败行为见 [禁用与受阻规则](#禁用与受阻规则)。

底部 Diff 是有大小限制的只读预览，超出时提示截断；二进制内容显示说明，工作区文件继续使用原生编辑器。具体读取上限和比较来源见 [架构中的 Diff 与原生编辑器](ARCHITECTURE.md#diff-与原生编辑器)。
