# 工作台规格

本文记录已确认的 AlwayGit 工作台行为，作为实现、测试和以后聊天继续开发时的稳定依据。

## 布局与视觉

Workbench 是 AlwayGit 唯一的仓库工作入口。活动栏 AlwayGit 图标展开启动侧栏，侧栏使用 VS Code 原生主题按钮，依次显示 `Show Git Workbench` 和 `Open Workbench in New Window`；仅按钮点击执行命令，显示或恢复侧栏不自动打开 Workbench，执行按钮也不强制关闭侧栏。Show 在当前窗口优先聚焦活动 Workbench，否则聚焦最近使用的 Workbench，没有工作台标签时新建；聚焦已有标签保留其仓库、布局与草稿。状态栏 AlwayGit 图标始终保留，`AlwayGit: Show Workbench` 命令复用相同显示行为。`Open Workbench in New Window` 按钮、同名命令与工作台标题栏的窗口图标创建独立空白 VS Code 窗口，并在扩展宿主就绪后打开未选择仓库的 Workbench；仓库选择仍在新 Workbench 内完成。

Workbench 顶部的分栏图标显式创建一个新标签。新标签继承界面设置、草稿与仓库列表，但初始不选择仓库；空白标签的会话保存不得覆盖普通 `Show Workbench` 用于恢复的最后仓库。从仓库对象菜单显式在新标签打开时，则使用该仓库作为新标签的当前仓库。

工作台固定使用 `Workbench`：左侧为仓库和引用导航，中间为 Graph 与 History，右侧为 Commit 详情、文件或 Working Tree 状态，底部为只读 Diff。Commit Message 使用独立浮窗，不常驻占用文件列表空间。不再显示布局模式选择；旧 `Editor Focus` 会话兼容迁移到 Workbench，保留面板尺寸、仓库视图和草稿。原生文件编辑与 Diff 入口继续保留。

面板分隔线以及 Graph、作者和日期列可拖动。底部 Diff 的最大高度随当前工作区高度变化，不使用固定像素上限；顶部面板保留最低可用空间。Diff 标题栏提供带悬浮说明和无障碍名称的图标按钮，可收起到标题栏并恢复此前的展开高度。Graph 使用右边界，作者与日期使用各自左边界的可见分隔线；分隔线必须跟随指针方向，不在表格最右边放置难以命中的列拖柄。右上角 `Restore Layout` 为带悬停说明的图标按钮，只恢复面板和列尺寸及 Diff 展开状态，不重置界面设置。提交列表默认字号 13 px、行高 24 px，文字、引用、作者、日期和 Graph 节点垂直居中，保留交替底色和细分隔线。Working Tree 作为紧随当前 HEAD 的前端虚拟 Commit 节点，以实心菱形、强调底色、边界、数量徽标和右侧箭头表达可选择与可进入状态，不显示说明性 Tooltip；HEAD 本身使用普通 Commit 节点，只显示当前分支名称，不增加外圈、绿色行标或 `HEAD ·` 徽标。窄窗口不得造成整个工作台横向溢出；必要时各面板内部滚动或收起次要内容。

使用统一的内容、侧栏、标题和工具栏表面层级，按钮采用小圆角、边界和短时悬停反馈。当前分支徽标位于操作工具栏最左侧，只常驻显示分支图标和分支名；仓库、上游分支及特殊状态通过悬停说明补充。Fetch、Pull、Push、刷新、Commit 与 Stash 保持在同一行；工具栏最右侧依次放置定位 HEAD 和打开仓库目录两个较大的纯图标按钮。工作台不保留底部常驻状态栏；Git 操作使用顶部操作反馈，定位结果、复制完成等其他有效提示在顶部按需显示并可关闭。普通状态、操作进度和冲突使用不同语义。标题默认约 26 px、普通按钮约 24 px；文件两行信息和操作说明保持可读，不为压缩高度隐藏完整父目录。分区标题保留展开/收起和独立图标操作，具体入口见 [左侧分组操作](#左侧分组操作)。减少动态效果设置关闭过渡与旋转。

右上角齿轮图标打开“设置”浮窗，按钮通过悬浮说明和无障碍名称表达用途，不重复显示文字。浮窗约 760 px 宽，左侧以“常规 / 界面 / 提交图 / 高级”为一级分组，包含语言、主题、字号与密度、Diff、配色和 Git 操作等二级入口；右侧一次只显示当前设置页并标明层级路径。“字号与密度”仅包含界面字号、列表密度和文件间距，提供提交行和文件行预览；“Diff”按“显示 / 导航”分区，集中设置 Diff 字号、行高和导航范围，提供实时差异文字预览，详细导航规则默认折叠。主题以可预览卡片选择，可跟随 VS Code 明暗/高对比模式，也可独立选择清透亮色、暖纸、雾蓝、深夜、午夜蓝、石墨、森林、莓紫或高对比；AlwayGit 使用每套主题统一的表面、文字、边框和选中颜色。界面字号支持 12–16 px，Diff 字号支持 11–18 px（默认 12 px）；列表密度为 22/24/28 px。文件列表间距独立控制文件行的上下留白，默认每侧 1 px，提供 0/1/3/5 px 预设与 0–8 px 自定义值；13 px 字号下默认两行文件列表约 32 px 高，Commit Details、Commit 比较和 Working Tree 一致使用。长路径换行或大字号时自动增高，旧会话使用新默认间距并保留其他设置。Diff 行高独立设置，默认 18 px，提供 18/20/22/24 px 预设及 16–36 px 自定义值，实际行高至少为 Diff 字号 + 4 px；旧会话缺少此设置时使用新默认值，保留已有字号。大字号自动增加最小行高，虚拟列表同步测量并保留顶部阅读位置。

调整立即预览；“应用”保存，无需重启。“取消”、关闭、Esc 或点击遮罩还原未应用的预览。预览期间后台刷新仍保存已应用设置；提交草稿、仓库选择和文件内容不受设置影响。设置存于当前工作区，对其全部仓库生效。顶部工具栏移除重复的 Stage、Unstage、Discard，文件操作集中于 Working Tree 分组。

Graph 提供鲜明 12 色（默认）、高区分 8 色、扩展 16 色，默认色值采用高饱和、跨色相方案，并分别适配浅色和深色背景。预设是编辑起点；用户可以逐色输入 HEX 或使用取色器，也可在 4–16 色范围内增删颜色、恢复当前预设，并单独设置浅色/深色主线。配色页使用实际分叉、并行和合并路径预览，并提示每种颜色与预览背景是否达到 3:1。远端默认分支（缺失时回退 `main`、`master`）使用加粗主线；HEAD 节点保持普通 Commit 外观，通过分支名称和无障碍语义识别。颜色绑定历史路径而非列位置：第一父继承，已存在的父路径沿用原色，新路径优先空闲色，再按用户当前浅色和深色色板的色差选择。结束路径释放色位，色板耗尽时优先避免邻线同色，不保证任意多条同时活跃路径全部异色。

Graph 根据本机最近一次 Fetch 后已知的 `refs/remotes/*` 判断 Commit 是否存在于远端：远端可达的 Commit 使用实心节点和加粗消息，仅本地 Commit 使用较小空心节点和正常字重。Merge Commit 保留较大尺寸，选择和悬停状态与推送状态叠加显示。路径结束后必须及时收拢内部空轨道，以过渡曲线保持相邻行端点一致；默认 Graph 列为 64 px，可在 48–180 px 之间持久化调整，轨道间距自适应，极端并行路径不得被裁掉。历史标题区提供紧凑图例；分页和搜索结果由 Git 层携带推送状态，不根据当前可见引用标签推测。

Working Tree 作为只存在于前端的虚拟提交节点显示，不创建 Git Commit，也不计入历史数量、分页 offset 或 Commit 批量操作。当前 HEAD 位于 Graph 筛选结果中时，Working Tree 以它为父节点，在新到旧的列表中紧邻 HEAD 上方，并随 Commit、Checkout、Reset 和分支切换移动；当前分支或 HEAD 被筛除时，只保留独立 Working Tree，不重新插入 HEAD，也不绘制指向隐藏 HEAD 的连线。整行常驻青绿色底色、左侧 3 px 色条和细边界；菱形节点、柔和外圈、连接 HEAD 的当前行短线、文件图标和进入箭头使用同一青绿色，明暗主题分别适配。悬停和选中逐级加深底色，选中后仍保留绿色，与普通 Commit 的主题选中状态区分；行高及历史位置不变。Message 列显示加粗标题、次要变更数量徽标、冲突数和带分支图标的当前分支，Date 列显示 `Uncommitted`。没有首个 Commit 时同样显示独立的初始 Working Tree 节点。

单击 Working Tree 显示工作区详情，Enter 等同单击；上下方向键可以在它与相邻 HEAD/Commit 间连续导航。Working Tree 不参加 Ctrl/Cmd 或 Shift Commit 多选，不响应 Checkout 双击，也不显示 Commit 右键菜单。辅助技术必须能够识别其虚拟节点、当前分支、变更数量、未提交状态和选中状态。

分页携带路径、色板特征和分配游标；主题切换保留色位，预设、色值或颜色数量变化都会重建全图，不拼接旧色板的分页。相同历史顺序刷新与虚拟滚动保持颜色；筛选、引用范围变化可能重分配。悬停 Graph 路径强调所有可见片段，并淡化其他路径。有限色板不宣称适用于所有色觉情况。

## 帮助与指南

右上角设置按钮旁的问号图标打开“帮助与指南”，悬浮说明和无障碍名称一致。尚未添加或选择仓库时，空状态同时提供“快速开始”入口。帮助浮窗使用“快速开始 / 常见任务 / 常见问题 / 完整手册”四类导航；关键词筛选当前分类的主题标题和正文，无匹配时明确提示。完整手册按章节展示，正文内的章节链接会切换到完整手册并定位对应小节。按 Escape、点击遮罩或关闭按钮退出，键盘焦点返回打开帮助的控件。

帮助语言跟随当前工作台语言，适配主题和窄窗口。正文及共用截图来自 [中文用户手册](USER_MANUAL.zh-CN.md) 与 [英文用户手册](USER_MANUAL.en.md)，随扩展打包且离线可用；仅在首次打开帮助时加载页面资源，图片延迟加载。截图沿用 0.29.0 的界面示例，显示对应来源说明。帮助导航与筛选只保存在浮窗内，不执行 Git 或原生编辑器操作，不改变当前仓库、草稿、布局、历史选择或 Diff，也不自动启动导览。

## 选择与打开

Workbench 明确区分未添加仓库、尚未选择仓库、正在打开仓库、仓库已移除或不可用、普通分支与真实 Detached HEAD。只有已加载的仓库没有当前分支时显示 `Detached HEAD`；其他未开始状态不借用 Git 异常状态表达。新会话不自动选中列表第一个仓库；当前仓库被移除时标签明确回到未选择状态，不静默切换到其他项目。

“添加仓库”模式可选择单个仓库或存放多个仓库的目录。选中目录有 `.git` 时验证该仓库；否则递归扫描所有层级的子目录，列出发现的有效仓库和 Worktree（支持 `.git` 目录与文件），由用户最终确认后批量添加。找到有效仓库后不再扫描其内部，因而不自动添加嵌套仓库和子模块；不跟随子目录链接或 Windows junction，也不进入 `.git`。

扫描显示已扫描目录数和发现仓库数，支持取消；取消扫描不添加任何仓库。无效仓库和无法访问的子目录单独跳过并汇总提示，详情写入 AlwayGit 输出。重复仓库不重复注册；批量添加只保存和通知一次，保持当前仓库、布局与草稿，记住新增仓库供下次打开工作台恢复。递归扫描仅在主动添加目录时执行。

Workbench 的 Repositories 顶层列表按共享 Git 存储归并，同一仓库的主目录及 linked Worktree 只占一个入口；仓库名称来自 Git 报告的主工作目录。递归发现、新增和已有仓库数量均按归并后的仓库统计，独立克隆保持独立。工作目录在当前仓库的 Worktrees 区域切换；选中 linked Worktree 时，顶层仍标记所属仓库，菜单和工具栏操作以当前工作目录为目标。直接只添加 Worktree 也保留其入口；没有当前选择时优先使用已注册的主目录。

Repositories 标题只显示一个 `Add…` 加号和刷新图标，标题右键也复用该添加入口。加号打开工作台内嵌“添加”浮窗，顶部可切换“添加仓库”和“添加分组”，默认进入添加仓库；添加分组直接输入名称并创建空分组，空白、超长或同名名称在浮窗内提示，支持 Enter 提交及 Esc 取消，不使用 VS Code 输入框。切换类型保留各自草稿及已完成的扫描选择；切换时正在进行的扫描会取消，关闭不产生部分添加。只有选择磁盘目录时使用 VS Code 原生目录选择器。选定目录后，同一浮窗显示可取消的递归扫描进度，再按名称显示逻辑仓库级多选结果，分别标记“可添加”和禁用的“已添加”。可添加项默认全选，支持筛选、全选、普通切换与 Shift 连续范围；目标分组和内联新建分组位于同一确认流程，主按钮明确显示将添加的仓库数量。扫描、筛选和关闭浮窗不改变仓库目录，只有最终确认项才注册；跳过项及原因留在浮窗中查看。仓库行和分组标题通过右键打开管理菜单；仓库菜单及多选菜单提供 `Remove from AlwayGit…`。工作台内嵌确认浮窗列出将移除的仓库并说明磁盘文件不受影响。该操作只移除导航与持久化记录、释放监听并阻止自动发现立即恢复，不删除磁盘目录或 Git 数据；再次明确添加会恢复显示。

用户可以创建、重命名和删除仓库分组，并将单个或多个逻辑仓库移动到分组。分组在 Workbench 的 Repositories 中显示为可折叠目录；没有归属的仓库不创建“未分组”目录，直接与分组目录同处 Repositories 根层。删除分组只删除组织结构，其中仓库回到根层，不从 AlwayGit 移除。分组名称、归属及排列顺序随仓库路径在同一 VS Code Profile 与运行环境内共享。根层的仓库与分组共用顺序，新增项追加到所在层级末尾；移动仓库到分组或根层时追加到目标末尾，重命名不改变位置。分组和仓库支持同层拖动排序，落点显示插入线；右键提供上移、下移，边界项禁用。删除分组时其中仓库按组内顺序追加到根层末尾。旧数据首次迁移保留根层仓库原有相对顺序，分组按保存的创建顺序排在其后；迁移与排序不改变仓库 ID、活动 Worktree、草稿和选择，Shift 范围与展开后的显示顺序一致。

Repository 和 Worktree 名称行单击只改变操作选择，不切换当前仓库或工作目录；普通单击单选，Ctrl/Cmd 单击切换单项，Shift 单击选择连续范围，Ctrl/Cmd+Shift 将连续范围加入既有选择。双击或键盘 Enter 才切换仓库或 Worktree。右键已选项保留批量选择，右键未选项先切为单选。当前 Repository 以主题强调色的仓库图标标识，不另加三角形或占位列。Worktree 和本地分支在内容排头显示实心播放三角形，浅色背景使用纯黑、深色背景使用纯白，非当前行保留同宽空位以对齐内容；蓝色选择背景只表示操作范围，当前状态与操作选择可以同时存在。分支复选框属于 Graph 筛选控件，三角形位于复选框之后、分支图标之前。当前状态使用 `aria-current` 暴露给辅助技术，不重复显示 `Current` 文字徽标。Detached HEAD 时不标记本地分支，但仍标记当前 Worktree。

工作台全局快捷键在当前 Webview 拥有焦点时生效，以顶部当前仓库和当前 Diff 为目标，不跟随侧栏操作选择或悬停改变目标。单键默认开启，键位与操作语义以中英文用户手册的“选择和快捷键”为准，相关操作悬浮提示同步显示按键。统一入口在捕获阶段分发，避免行内控件阻止冒泡造成失效；文字输入、可编辑内容、选择控件、输入法组合、弹窗和菜单拥有键盘优先级，长按不重复执行。点击非输入区域后正确转移焦点。所有操作复用按钮回调及可用条件；C 打开 Commit 浮窗，A/U 仅在 Working Tree 视图确认当前匹配范围的暂存或取消暂存。Diff 折叠后的修改跳转先展开，再沿用当前导航范围。设置 → 常规 → 快捷键可关闭单键；该选项兼容旧会话默认开启，Apply 才持久化，Cancel 恢复基线，保留草稿、仓库视图和布局。关闭单键仍保留受焦点与弹窗规则约束的 Ctrl/Cmd+R。

当焦点位于可多选区域或其标题、行内控件时，Ctrl/Cmd+A 只全选焦点所属作用域，Escape 只清除该作用域的操作选择；快捷键由区域容器捕获，不能落到整页文本选择。Repository 的范围是全部逻辑仓库；Local Branches 的范围是全部本地分支；每个 Remote 是独立范围，只包含该 Remote 下的分支；Worktrees 的范围是当前仓库的全部 Worktree。分支 action selection 与 Graph 筛选复选框相互独立，Ctrl/Cmd+A 和 Escape 都不改变 `checkedRefs`。History 的范围是当前已经加载的真实 Commit，不为全选隐式加载下一页，并排除 Working Tree 虚拟 Commit。Working Tree、Commit Details 和 Commit 比较的文件区域只处理当前面板可见文件。输入框、文本域和可编辑内容保留 Ctrl/Cmd+A 与 Escape 的原生行为。

Working Tree、Commit Details 和 Commit 比较的文件列表统一使用中性的文件图标，右下角以彩色角标显示 Git 状态：黄色 M 修改、绿色 A 新增、红色 D 删除、紫色 R 重命名，未跟踪显示 ?、冲突显示 !，复制和类型变更分别显示 C 和 T。悬停角标或文件名可查看完整含义；列表不常驻显示状态图例。Working Tree 在摘要下面按文件名或完整相对路径实时筛选，忽略大小写，同时覆盖 Staged、Unstaged 和冲突分组；搜索词按工作目录保留在当前工作台内存中，刷新或切换视图不清除，重新打开工作台时清空。筛选时显示匹配数与总数，保留没有匹配文件的分组标题，提示被筛选隐藏的冲突和当前 Diff；摘要和提交范围始终使用完整仓库状态。分组按钮无筛选时处理 `Stage All` / `Unstage All` / `Discard All`，有筛选时提示匹配文件数量并只处理匹配路径，不随批量选择改变范围；Stage / Unstage 点击后先确认本次实际文件数量，确认按钮默认获得焦点，可按 Enter 快速执行，Escape、点击遮罩或 Cancel 取消。A/U 沿用同一筛选范围。文件右键菜单中的 Stage / Unstage 作用于所选可见范围，不重复确认。

分组应用于全部添加、恢复和自动发现入口。已有保存路径无需清除，工作目录 ID、各自的 Commit 草稿与视图继续保留；不将多个 Worktree 的文件或暂存区状态合并。

Staged 标题中 Unstage 图标右侧放置 `Commit…` 按钮；分组为空、折叠或无筛选匹配时仍保留入口。顶部 Commit 和 C 快捷键打开同一居中浮窗，显示当前仓库、分支和完整 Staged 数量，聚焦 Message。空草稿、没有暂存文件或存在冲突时可以打开并保存草稿，实际提交按完整仓库状态校验；普通 Commit 需要非空 Message、至少一个 Staged 文件和零冲突。Enter 换行，Ctrl/Cmd+Enter 提交；输入法组合和长按不触发提交。Amend 每次打开默认关闭，草稿为空时才读取 HEAD 的 Message，取消或迟到的读取不覆盖新文字。Cancel、关闭、Esc 和遮罩保留完整草稿，立即发送待保存状态并恢复入口焦点；失败保持浮窗和草稿，成功关闭。草稿仍使用原有每仓库持久化，实际 Git 提交成功后只清理该仓库本次使用且尚未改写的草稿；活动 Git 操作继续沿用暂存结果检查，不叠加两个浮窗。

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
| 双击 Commit | 顶端有一个本地分支直接指向时 Checkout；有多个时选择；没有时创建并切换新分支，开启高级选项后也沿用此默认路径 |
| 单击 Working Tree 虚拟节点 | 单选 Working Tree 并显示工作区状态；不加入 Commit 多选 |
| Working Tree / HEAD 获得焦点后按上下方向键 | 在虚拟节点与真实 Commit 间连续选择和移动焦点 |
| 单击详情中的文件 | 在底部预览 Diff |
| 双击文件 | 在 VS Code 打开；历史删除文件打开只读历史内容或原生 Diff |

Local Branches 和 Remote Branches 按分支名中的 `/` 构成递归目录，例如 `feature/login/api` 显示为 `feature > login > api`。目录展开状态按仓库保存；首次进入或 Checkout 后自动展开当前分支所在目录。初次进入仓库时选择当前本地分支及其 upstream。多引用历史是所有已选引用可达提交的并集，共同祖先只出现一次。没有选中引用时显示说明性空状态。Working Tree 始终保留并显示当前分支名称，不重新插入被过滤掉的 HEAD Commit；工具栏右侧的定位图标恢复定位，悬停说明为 `Locate HEAD`。HEAD 已加载时只选择并滚动到该节点，保留 Graph、搜索、引用与分页；HEAD 缺失时才恢复必要筛选并有界读取，未加载分页继续追加。重复点击仍可重新定位。可见 HEAD 通过当前分支徽标和辅助技术语义表达归属。

输入 Commit 搜索条件后暂停 200 ms 开始查询，连续输入合并为最后条件；输入变化立即清除旧结果。History 显示“提交搜索结果”和已加载的匹配数量；仍有下一页时数量带 `+`。搜索结果隐藏整个 Graph 列、分隔线与节点，不对缺少中间提交的结果计算轨道；提交信息列使用释放的宽度。引用徽标、作者、时间、行选择与菜单继续可用，推送状态以标题前的实心或空心圆点表达。单选一个匹配 Commit 后，可用“在完整历史中定位”图标清空搜索，沿用当前引用范围加载历史并滚动定位；自动读取最多 20 页或达到 10000 条后停止并提示，保留已加载结果与目标详情，可用 Load More 继续或缩小引用范围；更改搜索、引用、仓库或选择会停止旧定位。清空搜索恢复 Graph 及原有列宽。

工具栏最右侧使用“双层文件夹 + 中央 VS Code 标识”的纯图标按钮打开当前选中的仓库目录，悬停说明为 `Open Repository Folder` 并显示完整路径；不常驻显示 `Open in VS Code` 文字。按钮优先切换到已打开该目录的项目窗口；没有匹配窗口时打开项目新窗口，保留工作台所在窗口。匹配基于实际工作区目录，支持多根工作区，并区分不同 Worktree；相同目录存在多个窗口时优先使用最近活动的匹配窗口。

目标窗口需要启用同一 Profile 中的 AlwayGit，并信任项目工作区。新窗口就绪后才报告打开成功；目标未响应时显示明确错误。未选择仓库时禁用此按钮，悬停显示项目完整路径。

## 自动更新与查看状态

工作区文件变化会更新当前仓库的状态；已选引用变化时更新 History。查看历史 Commit 时，无关的文件、Index 或引用变化不会清空 Commit 详情和 Diff，也不会重置已选 Merge Parent、文件及 Diff 滚动位置。常驻刷新图标只保留两个：顶部工具栏提示“刷新当前仓库状态和提交历史”，重查当前仓库状态和历史，同时保留同一个历史比较；Repositories 标题提示“刷新仓库列表和状态角标”，重新读取已登记仓库、分组、排序及各仓库状态，不扫描新仓库。Tags、Stashes、Worktrees 和各 Remote 的重复刷新入口只保留在右键菜单中。两种刷新均不执行 Fetch。

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
| Tag | `Show in Graph`、`Show Only This Tag`、`Create Branch…`、`Create Branch and Checkout…`、条件显示的 `Checkout to Detached HEAD…`、`Delete Tag…`、`Copy Tag Name`、`Copy Commit ID` |
| Stash | `View Changes`、`Apply Stash`、`Pop Stash`、`Drop Stash…` |
| Worktree | `Open Worktree`、`Open Worktree in New Project Window`、`Refresh`、`Remove Worktree…`、`Copy Worktree Path` |
| Worktree（多选） | `Refresh`、`Copy N Worktree Paths` |
| Working Tree 文件（Staged / Unstaged） | Stage / Unstage、`Stash Selected Files…`、适用的 `Discard…`、路径复制；单文件额外提供 Diff 与编辑入口 |

## 左侧分组操作

分组标题不使用省略号菜单；项目少且含义明确的操作直接显示为纯图标按钮，并通过悬浮提示、键盘焦点和无障碍名称说明用途。右键标题仍可打开该分组的完整操作，包括不再常驻显示的 `Refresh`。Local Branches 的 Graph 筛选位于标题下方的分段图标控件，提供全部本地分支和仅当前分支两个预设；当前预设以强调状态显示，自定义勾选组合时两项均不激活。

| 标题 | 项目 |
| --- | --- |
| Repositories | `Add…`、`Refresh` |
| Local Branches | 标题：`Create Branch…`；Graph 预设：`Show All Local Branches in Graph`、`Show Current Branch Only in Graph` |
| Remotes | 标题行仅显示 `＋` 添加远端图标，悬浮提示与无障碍名称为 `Add Remote…`；右键菜单提供 `Add Remote…`、`Create Local Tracking Branches…`、`Refresh`。Fetch 位于各 Remote 行；没有远端时正文说明尚未连接并保留文字入口 |
| Tags | `Create Tag…` |
| Stashes | `Stash All Changes…` |
| Worktrees | `Add Worktree…` |

Graph 中 Commit 的菜单集中提供 `Create Branch…`、`Create Tag…`、Cherry-pick、`Revert…`、`Reset…`、分支感知的 Checkout、条件显示的 `Checkout to Detached HEAD…`、`Copy Commit ID` 和 `Copy Commit Message`；顶部工具栏和 Commit Details 标题不重复提供这些入口。普通 Commit 的 Cherry-pick 点击后直接执行；Merge Commit 单独选择 Mainline Parent。多选 Commit 按当前拓扑列表从旧到新执行批量 Cherry-pick，且只处理明确选中的 Commit；包含 Merge Commit 时禁用批量操作并要求单独处理。具体项目根据提交、当前分支和仓库操作状态禁用。

恰好选择两个 Commit 时自动进入 `Compare Commits`，右键菜单仍保留显式入口。存在祖先关系时祖先位于左侧；没有祖先关系时保持选择顺序。右侧显示两个 Commit 和差异文件列表，交换按钮可反转比较方向，文件 Diff 支持新增、删除和重命名。取消到一个 Commit 时恢复该提交详情；增加到三个以上时显示最后操作的提交并保留多选批量操作；清空选择时同步清空右侧详情。手动或后台刷新 History 时保留仍然有效的双 Commit 比较。

## 禁用与受阻规则

工具栏下的操作信息栏显示 Git 操作名称、目标及进行中、成功、失败状态；结果保留到用户关闭或下一次操作，进行中不可关闭。Commit 成功时显示短哈希、实际提交的暂存文件数以及剩余未提交变更数或干净工作区状态，并提供 `View Commit` 直接打开新提交。失败显示原因摘要，并提供完整错误详情和日志入口；Commit 失败不清空消息草稿。失败后重新读取仓库状态。若写操作的进程终止无法确认，保留仓库写保护；原持有宿主退出后，需确认进程已结束并检查仓库，再按提示解除保护。解除不会自动重放操作，需重新发起。操作反馈按仓库隔离，切换仓库不会展示其他仓库的结果。

Merge、Rebase、Cherry-pick、Revert 的活动状态在独立操作条中持续显示。冲突时显示数量、处理说明和“查看冲突”，进入 Working Tree 并定位首个冲突文件；Continue 禁用原因直接可见。Git 的 unmerged entries 归零后显示“待检查结果”和“检查暂存结果”，只表示 Git 允许继续，不宣称内容已经正确解决；完成或 Abort 后移除。没有活动操作的冲突也显示提醒。Skip 只在 Git 支持时出现。

冲突处理顺序为查看冲突、在 VS Code 中编辑并保存、返回工作台“已手动处理，标记并暂存”。此动作不会选择正确内容或验证结果；反馈写“已标记并暂存；继续前请检查结果”。冲突菜单与普通文件 Stage 分开，混合选择不能用普通 Stage 文案隐含标记冲突。

Continue 和活动操作期间的普通 Commit 均先检查实际 Index 内容，列出暂存变更文件及疑似冲突标记行号（含 diff3/zdiff3 与非默认标记宽度，最多显示每文件前 100 处）。单文件超过 2 MiB、累计超过 16 MiB、二进制、非 UTF-8 内容及子模块明确标为未扫描。提供返回检查、暂存 Diff 和编辑入口；有疑似标记或未扫描文件时，需要勾选明确确认后才能“仍然继续”，允许合法标记文本。没有标记也不保证语义正确。确认绑定当前操作、分支、HEAD 和 Index 内容，变更后必须重新检查；编辑后需重新保存并暂存。活动操作期间不允许 Amend，未保存的编辑器修改在 Continue / Commit 前另行提示。

Merge 等操作暂停后，原发起对话框改为处理状态，主入口是“查看并处理冲突”，关闭按钮写“关闭此窗口”，并直接提供“中止本次操作”。关闭对话框只关闭窗口，Git 仍暂停；操作条继续保留 Abort。Abort 使用工作台说明与原生确认，有可确认的操作起点时显示 Commit，说明 Git 将尝试恢复操作开始时的状态、冲突处理修改可能丢弃，以及操作前已有修改可能影响完整恢复。

- 当前分支禁用 `Checkout` 与 `Delete Branch`。
- Create Branch 在名称字段实时解释 Git 分支名限制，以及同名本地分支或双向父子路径冲突（已有 `test/b1` 时不能创建 `test`，已有 `test` 时不能创建 `test/b1`）；提示具体冲突分支，禁用两个创建按钮并拦截键盘提交，保留错误输入和焦点。仅检查本地分支命名空间，远程引用、Tag 和合法相邻路径不造成误拦截；后端在写操作队列中重新读取本地引用并校验。起点优先显示“当前分支 `<name>` · 当前版本”或对应分支、Tag、Commit，内部引用只在 Git 详情中显示。对话框明确提供“仅创建”和默认主操作“创建并切换”；先创建分支，成功后再 Checkout，创建失败不改动 Index 或 Working Tree。完成后分别说明当前仍在原分支或已经切换到新分支；创建成功但 Checkout 受阻时明确说明分支已保留、尚未切换，并提供受影响文件及适用的 Stash & Checkout 入口。
- 被其他 Worktree 使用的分支显示占用路径，并允许打开该 Worktree。
- 主 Worktree 和当前 Worktree不能移除；Locked Worktree 显示锁定原因。
- Remote Branch 的 `Checkout as Local Branch…` 列出远程来源与本地名称，默认剥除 Remote 前缀并保持完整目录（`origin/feature/login/api` → `feature/login/api`），自动选择已有跟踪分支，允许改名。多个已有本地跟踪分支时提示用户选择名称。单项默认 Checkout，可取消切换；Remote 父级、Remotes 分组、分支目录和远程多选通过 `Create Local Tracking Branches…` 创建或复用全部后代，保持当前分支。对话框逐项显示将创建、已跟踪、同名 upstream 冲突、路径冲突与成功结果；名称冲突阻止执行，不覆盖已有分支或改写 upstream。使用最近 Fetch 的引用，不自动 Fetch/Pull；后端重新校验来源与 OID。`origin/HEAD` 等符号引用不可检出为本地分支，批量范围自动排除。
- Local 与 Remote 的批量选择互相隔离；同一 Remote 下的普通分支可以批量 `Delete … from <remote>…`，操作明确显示远端和分支清单并二次确认，以确认时的远端 Commit 版本为执行条件逐项 Push 删除并汇总部分失败；远端版本或 Push 地址变化时拒绝执行，刷新后重新确认。`origin/HEAD` 等符号引用不可删除。
- 默认禁止主动进入 Detached HEAD。旧 Commit 的分支感知 Checkout 与 Tag 的 `Create Branch and Checkout…` 进入固定起点的新建分支浮窗，仅提供取消和创建并切换；普通 Create Branch 保留仅创建。设置 → 高级 → Git 操作中的“允许直接进入 Detached HEAD”默认关闭，应用保存成功后即时生效；开启后 Commit 和 Tag 菜单额外显示 `Checkout to Detached HEAD…`，确认说明原分支位置不变、后续提交需要分支承接。关闭时不显示该入口和 Worktree 的 Detached 选项；Worktree 要求已有或新建分支。宿主执行前重新检查策略，Stash 重试在保存 Stash 前拦截，禁止显式和隐式 Detached Worktree。外部造成的已有 Detached HEAD 可以正常读取、返回分支和创建分支；Rebase 内部临时 Detached 状态不受此限制。
- 无变更、无 Staged 文件或没有可用目标时禁用对应操作并说明原因。Detached HEAD 禁用工具栏 Push。仓库没有远端时，Push 不显示无法完成的空选择器，而是说明本地 Commit 已保存、发送前需要连接远端，并直接进入 `Add Remote…`；添加成功后返回 Push。Push 对话框先显示实际的 `Local Branch → Remote/Remote Branch`；当前 upstream、`branch.*.pushRemote`、`remote.pushDefault` 或唯一远端可确定目标时不得显示空白可选项。用户通过 `Change Target…` 显式修改目标；首次 Push 说明会建立 upstream。多远端且没有配置目标时要求选择远端。`Force-with-lease` 位于默认折叠的高级选项，启用后显示确认的远端 Commit，远端仍与该版本一致才执行；目标在本地尚不存在时，仅允许远端也仍不存在。后台 Fetch 不改变已打开窗口的确认版本。Push 地址变化或配置多个 Push 地址时拒绝此危险操作，刷新并重新选择单一目标后确认。
- 当前分支存在未推送提交时，工具栏 Push 与仓库导航项使用高饱和通知角标显示数量；用户可以在“界面 / 状态提醒”中选用预设色或输入 HEX，文字自动在黑白之间选择以保持对比，并使用亮色边缘增强辨识度。数量为零时不显示角标。仓库列表先显示，角标状态随后在后台加载，当前仓库的角标随状态刷新即时更新。
- Checkout 可能覆盖修改时显示受影响文件，并提供查看文件与 `Stash Changes & Checkout`。
- 存在未解决冲突时，提示先解决冲突或 Abort 当前操作。

## Working Tree 与 Diff

Working Tree 将文件分为 Conflicts、Unstaged 和 Staged。Stage、Unstage 与 Stash 是不同操作。分组标题的 `Discard All…` 丢弃全部 Unstaged 修改，文件右键菜单的 `Discard` 只处理所选文件；两者均保留 Index 中同一文件的 Staged 修改，确认对话框必须准确列出受影响路径并描述内容。

文件菜单的 `Stash Selected Files…` 按路径去重，只保存明确选中的整个文件。无论从 Staged 还是 Unstaged 选择，都同时保存该文件完整的 Index 与 Working Tree 状态，所选未跟踪文件一并保存；同一文件同时出现在两侧只计一次。未选中文件的暂存与未暂存修改不进入存档，也不被清理。对话框显示所选文件数量、完整路径和可选说明，并解释整文件保存范围。顶部工具栏及 Stashes 分组的 `Stash All Changes…` 保存全部已跟踪修改，并通过勾选项决定是否包含未跟踪文件。

Stash 详情按 Working Tree、Index 和 Untracked Files 分类展示并在页签标明数量；顶部按路径去重显示保存文件总数和未跟踪文件数。首次打开选择第一个非空分类。用户主动进入空分类时，空状态指出包含内容的分类及数量，并提供直接跳转。Stash 成功反馈同时说明保存文件数、未跟踪文件数和操作后的工作区状态。

默认 `Apply Stash` 使用 `git stash apply --index` 恢复保存的 Index 与 Working Tree 状态，始终保留原 Stash；显式 `Pop Stash` 仅在恢复成功后删除原条目，失败时保留。执行前重新核对 selector 与预期 OID，并检查保存的未跟踪文件目标及父路径占用，不覆盖、删除或重命名现有内容。

Apply / Pop 正式执行前在隔离副本中试恢复。任何冲突或无法准确复现的现场都会停止整次恢复，包括本可恢复的其他文件；真实 Index 与 Working Tree 不被这次恢复更改，原 Stash 保留。试恢复成功后重新核对现场指纹；预检期间发现外部变化同样停止，不声称外部编辑未发生。隔离支持范围见 [架构中的 Stash 隔离](ARCHITECTURE.md#stash-保存与隔离恢复)。正式 Apply 若因新的外部变化、写入失败等原因意外失败，报告实际 Git 结果，不承诺原子回滚或现场完全未变。

受阻对话框说明原因；已确认的 unmerged 路径显示为冲突文件，未取得实际冲突路径时只列出本次恢复涉及的文件，路径占用单独说明。Git details 与 Show Log 提供同一份脱敏后的底层 Git 输出，保留 Index 限制等具体原因。对话框提供比较保存的文件与当前文件、打开现有文件的图标入口；tracked 比较读取 Stash 的完整工作树，untracked 比较读取独立的未跟踪快照，删除侧显示空内容。已知原因未解决时不保留重复 Apply 按钮，只允许取消；更换 Stash，或处理阻碍后关闭并重试，都会重新预检。

分组标题采用展开箭头、短标题与数量徽标，可通过单击或键盘展开、收起文件列表；收起分组不切换已有 Diff，Ctrl/Cmd+A 只选择展开分组的可见文件。右侧按钮仅显示图标：Stage All 使用绿色暂存盒，Unstage All 使用红色斜向回撤箭头，Discard All 使用红色垃圾桶。悬停说明和可访问名称固定明确 All，三个按钮均处理对应分组的全部文件，不受选择或分组折叠影响；空分组或有操作进行中时禁用。Stage All / Unstage All 点击后确认全部文件数量，Discard All 点击后列出全部 Unstaged 路径供确认。Working Tree 不显示文件或分组复选框。空分组压缩提示，完整父目录和文件选择规则保持不变。

文件行第一行显示文件名，第二行显示以 `./` 开头的完整仓库相对父目录链，不限制目录层级；根目录文件显示 `./`，子目录文件显示如 `./docs`、`./src/protocol`。长父目录换行，完整路径也可通过悬浮提示查看。Commit Details 和 Commit 比较的 Changed Files 支持按完整仓库相对路径进行大小写不敏感的关键字筛选；筛选仅影响可见文件和当前批量选择，不自动切换既有 Diff，切换 Commit 时保留查询，离开历史详情或切换仓库时清空。

Working Tree、Commit Details 和 Commit 比较文件列表均不显示复选框：单击文件即选中并预览，Ctrl/Cmd+单击切换选择，Shift+单击选择范围。焦点在文件区域时 Ctrl/Cmd+A 全选当前面板可见文件，Escape 清空，文本输入保持原生行为。Working Tree 的选择用于预览和文件右键菜单，不改变分组标题的 Stage All / Unstage All / Discard All 范围；冲突组的标记暂存仍按所选冲突文件执行，没有选择时处理全部冲突文件。Commit Details 和比较文件的 Copy Paths 处理当前可见选择。

文件右键菜单绑定当前批量选择：右键已选文件保留选择，右键未选文件先切换为单选。Working Tree 按文件区域提供 Stage、Unstage、“已手动处理，标记并暂存”与 Discard；单文件同时提供在 VS Code 中打开 Diff 和编辑入口，冲突文件还提供行内编辑按钮及返回工作台暂存的说明。历史与比较文件提供打开 Diff、编辑和复制路径。非输入、非可编辑、没有文本选择的工作台区域不显示宿主的剪切、复制、粘贴菜单；文本输入与 Diff 文本选择保留原生编辑和复制行为。

底部预览显示选中文件和比较目标，并提供在 VS Code 原生 Diff 或编辑器中打开的图标入口，文字通过悬浮提示和无障碍标签提供。“设置 → 界面 → Diff”的导航范围提供“整个 Commit”（默认）和“当前文件”，按工作区保存，旧会话缺少选项时使用默认值。整个 Commit 模式按当前 Commit 及所选 Parent 的全部变更文件顺序浏览连续修改块，包含路径筛选隐藏的文件；向下跨文件定位首处，向上跨文件定位末处，Commit 首尾循环，不进入其他 Commit。跨文件同步当前预览文件，路径筛选隐藏该文件时显示说明。二进制及无文本修改块文件跳过，读取失败停止并显示错误；查找最多遍历一轮，全部无修改块后禁用导航。当前文件模式保留文件内首尾循环；只有一处修改时，两枚按钮均可重新定位，只有没有修改时禁用。Working Tree、Stash 与 Commit 比较沿用当前文件模式。读取期间禁用上下箭头，切换文件、仓库、Parent、导航模式或收起面板时取消旧导航。短修改块尽量居中，超过视口高度的修改块从开头显示。收起并展开同一比较时保留阅读位置。删除与新增使用高辨识度的红色和绿色整行底色、边缘标记、`−` / `+` 标记及行内变化强调。符号链接比较链接文本，不读取所指向文件的内容。二进制、超限、缺失或非法编码内容显示具体说明。

`Open Diff` 与 `Edit in VS Code` 沿用项目按钮的窗口定位规则，在目标窗口的当前主编辑器组打开保留的标签（非 Preview），不向右新建分屏，也不关闭已有标签或未保存文档。Diff 请求在目标宿主重新读取原有比较类型，不把当前窗口的内存文档 URI 跨窗口搬运。已打开的工作区文件复用其标签；历史中已删除的文件仍回退到原生 Diff。

Diff 标题栏平铺显示当前文件的新增、修改、删除块数量，当前文件模式显示“当前/总修改块”，整个 Commit 模式显示“文件 2/5 · 修改 1/3”（文件位置与文件内块位置），不使用输入框式边框或背景。只有右侧内容的连续块计为新增，只有左侧内容的连续块计为删除，同时包含两侧内容的连续块计为修改，三者之和等于总修改块数。上下箭头在连续修改块之间导航，一个连续修改块只画一个外边框。手动纵向滚动以视口中心对应的最近修改块更新序号；手动换文件定位首处，跨文件导航按方向定位首处或末处，同文件刷新保持滚动并重映射当前块。长行横向滚动时两侧比较列及行号保持可见。截断文件的全部计数注明仅覆盖预览。

## 语言与文案

支持 English 和 `简体中文`。语言选择对屏幕文字、工具提示、空状态、错误和确认生效。Git 操作与专业术语保留英文，包括 Checkout、Fetch、Pull、Push、Merge、Rebase、Stage、Unstage、Stash、Commit、HEAD、Index 和 Worktree。Commit Message、作者、分支、Tag、路径、代码和 Git 返回文本保持原文。

按钮使用统一的英文 Git 动作名和大小写。`Copy Commit ID` 复制完整 OID，`Copy Commit Message` 复制完整提交信息。语言切换不清除引用筛选、当前对象、面板尺寸或 Commit 草稿。

## 会话恢复

保存工作区内的界面设置、Diff 导航范围、面板尺寸、Diff 收起状态和列宽；按仓库保存勾选引用、分支目录展开状态、侧栏分区折叠状态、搜索、当前 Commit / Stash / 文件、活动区域和 Commit 草稿。恢复时若对象已不存在，清除该对象并给出稳定的回退选择，不对 Git 仓库执行写操作。

同一窗口中的多个 AlwayGit 标签分别使用 VS Code Webview state 恢复自身状态；活动标签成功保存的工作区会话只作为新建标签的初始基线，不会主动覆盖已打开标签的内存状态。本标签状态及时保存，宿主只合并该标签实际改动的仓库字段，重新激活旧标签或空白标签不会回退其他标签较新的草稿和视图。前端会话保存请求失败会明确提示并有限重试，保留当前草稿；标签重新激活时由宿主发起的基线同步失败仅记录输出日志。

## VS Code 配置

| 设置 | 默认值 / 范围 | 行为 |
| --- | --- | --- |
| `alwaygit.gitPath` | 空字符串；机器级设置 | 依次使用显式路径、VS Code 内置 Git 扩展提供的路径和 PATH |
| `alwaygit.historyPageSize` | 300；50–1000 | 每次历史分页加载的真实 Commit 数量上限 |
| `alwaygit.refreshInterval` | 15 秒；5–300 秒 | 对可见工作台当前仓库进行补偿刷新 |
| `alwaygit.allowDetachedHead` | `false`；布尔值 | 高级设置的唯一配置来源；有工作区时保存到工作区，无工作区时保存到用户设置；应用后同步各工作台，禁止未应用预览放开操作 |
| `alwaygit.language` | `en`；`en` / `zh-CN` / `auto` | 初始语言；`auto` 跟随 VS Code，界面设置中的工作区语言选择优先 |

修改 Git 路径或刷新间隔后需要重新加载 VS Code 窗口。界面设置中的主题、配色、字号、密度和语言应用后即时生效。

## 功能与环境边界

Git 操作在仓库所在的扩展宿主中执行，架构面向本地、WSL、Remote SSH 和 Dev Containers；各环境的验收证据见 [验证与本地更新](VALIDATION.md#验证证据与覆盖边界)。未受信任工作区不执行 Git，纯浏览器虚拟工作区不受支持。

当前使用整文件暂存和普通 Rebase。分块暂存、交互式 Rebase、提交重排、Squash、Fixup、Format Patch、远程 Tag 管理和自由浮动面板不在当前范围内。远程分支单项及同 Remote 批量删除已支持，具体确认与部分失败行为见 [禁用与受阻规则](#禁用与受阻规则)。

底部 Diff 是有大小限制的只读预览，超出时提示截断；二进制内容显示说明，工作区文件继续使用原生编辑器。具体读取上限和比较来源见 [架构中的 Diff 与原生编辑器](ARCHITECTURE.md#diff-与原生编辑器)。
