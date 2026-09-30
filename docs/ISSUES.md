# 问题日志

本文记录已确认的项目 Bug、异常与明确影响现有行为的实现不足；当前产品行为以 [工作台规格](WORKBENCH_SPEC.md) 为准。

## BUG-016：普通单击活动 Commit 未必退出多选

- 日期：2026-10-01
- 状态：已解决
- 现象：选中多个 Commit 后，如果右侧已经显示其中活动 Commit 的详情，再不按 Ctrl/Cmd 或 Shift 普通单击该 Commit，历史列表仍可能保留多选；单击其他 Commit 则能正常收敛为单选。双选自动比较会暂时绕开该路径，但三个及以上 Commit 仍可稳定复现。
- 原因：`selectCommit` 在发现同一 Commit、Parent 和 Stash 详情已经加载后直接返回，普通单击本应执行的 `selectedOids` 与选择锚点更新位于该提前返回之后。
- 解决方案：详情缓存命中时继续跳过重复请求，但在非保留选择模式下先将 Commit 选择收敛为当前 OID；修饰键选择继续通过 `preserveSelection` 保留多选。
- 验证方式：状态回归覆盖缓存详情下的三项多选收敛、详情不重复请求和保留选择模式；无头 History 验证双选自动比较、追加第三项以及普通单击活动 Commit 后只保留一项。
- 相关文件：`webview/store.ts`、`tests/ui-state.test.ts`、`scripts/test-history-ui.mjs`、`scripts/test-ui.mjs`。

## BUG-015：双选 Commit 不会自动显示两点差异

- 日期：2026-10-01
- 状态：已解决
- 现象：在 Graph 中使用 Ctrl/Cmd 或 Shift 恰好选中两个 Commit 后，右侧仍显示最后点击的单个 Commit 详情，必须再从右键菜单执行 `Compare Commits` 才能看到两个提交之间的文件差异。
- 原因：多选处理只更新 `selectedOids`，随后仍调用单 Commit 的 `selectCommit`；现有比较 RPC、Git 查询和详情界面仅连接到右键菜单入口。History 刷新恢复还把“没有单 Commit 详情”误判为需要重新选择 Commit，会清除已经打开的比较。
- 解决方案：将 Commit 多选与右侧展示统一为选择状态转换：恰好两个时自动比较，一个或三个以上时显示相应活动 Commit，清空时同步清除详情；History 刷新显式保留双 Commit 比较。继续保留右键比较和方向交换入口。
- 验证方式：状态回归覆盖双选自动比较、首个差异文件、History 刷新保持比较、取消到单选和清空选择；无头 History 界面验证 Ctrl 双选后直接出现比较摘要和差异文件。类型检查及相关单元测试通过。
- 相关文件：`webview/History.tsx`、`webview/store.ts`、`tests/ui-state.test.ts`、`scripts/test-history-ui.mjs`、`docs/WORKBENCH_SPEC.md`、`README.md`。

## BUG-014：手动添加的仓库在新窗口中丢失

- 日期：2026-10-01
- 状态：已解决
- 现象：在一个 VS Code 窗口中手动添加仓库后，原窗口可以恢复列表，但新建窗口或打开另一工作区时列表为空。
- 原因：仓库路径与 Workbench 会话一同保存在 `workspaceState`，每个工作区只能读取自己添加的路径；各窗口的 RepositoryManager 又使用独立内存注册表。
- 解决方案：将用户主动添加的仓库路径改存为版本化的扩展 `globalState`，启动时合并旧工作区路径并恢复。仓库选择、布局和草稿继续保持工作区隔离，本地路径不开启跨机同步。
- 验证方式：仓库管理回归验证两个独立工作区共享同一全局目录，并覆盖旧路径迁移、批量去重、取消扫描、监听注册失败和不受信任工作区。
- 相关文件：`src/repositories/manager.ts`、`tests/repository-manager.test.ts`、`tests/repository-watch.test.ts`、`docs/ARCHITECTURE.md`、`docs/WORKBENCH_SPEC.md`。

## BUG-013：Working Tree 看似状态栏且脱离当前 HEAD

- 日期：2026-10-01
- 状态：已解决
- 现象：History 顶部的 Working Tree 虽然可以点击，但采用独立的跨列状态条外观，没有 Graph 节点、整行提交语义和明确的分支归属；多引用历史中它还会固定在表头下方，不能跟随当前 HEAD。
- 原因：Working Tree 在虚拟提交列表之外单独渲染，只复用普通按钮反馈；Graph 布局、虚拟滚动、键盘导航和提交行选择都只处理真实 Commit。
- 解决方案：把 Working Tree 建模为只存在于前端的虚拟历史项，以当前 HEAD 为父节点，在倒序历史中紧邻 HEAD 上方显示实心菱形节点和连接线；使用更明确的默认底色、边界、加粗标题、数量徽标、进入箭头以及悬停、焦点和选中反馈表达可操作性，不依赖说明性 Tooltip。普通 HEAD Commit 不再增加外圈、绿色行标或 `HEAD ·` 绿色徽标，只按普通 Commit 节点显示当前分支名称并保留辅助技术语义。筛选排除 HEAD 时保留当前 HEAD 锚点，分页和 Git 操作仍只计算真实 Commit。
- 验证方式：视图模型和 Graph 渲染单测覆盖可见 HEAD、筛选外 HEAD 与无首个 Commit；Git 集成测试验证筛选结果仍返回 HEAD 摘要；无头 History 检查验证虚拟节点、相邻位置、明显的行交互反馈、普通 HEAD 节点与分支徽标，以及 Working Tree 和 HEAD 间的方向键导航。
- 相关文件：`webview/History.tsx`、`webview/historyItems.ts`、`webview/graph/GraphRow.tsx`、`webview/graph/layout.ts`、`webview/styles.css`、`webview/store.ts`、`src/git/service.ts`、`src/protocol/types.ts`、`tests/history-items.test.ts`、`tests/graph-renderer.test.ts`、`tests/git-service.test.ts`、`scripts/test-history-ui.mjs`。

## BUG-012：当前项三角标识对比不足且缺少实心观感

- 日期：2026-10-01
- 状态：已解决
- 现象：Repository、Worktree 和当前分支的三角标识使用主题强调色且尺寸偏小，在部分背景上不够醒目，也缺少明确的实心形状，难以快速识别当前工作目录。
- 原因：标识直接复用了 10 px Codicon `play` 字形和 `accent` 颜色；字体轮廓及强调色均不能保证在所有浅色、深色和高对比主题中形成强烈反差。
- 解决方案：改用尺寸固定的 CSS 实心三角形；浅色与高对比浅色主题固定使用纯黑，深色与高对比深色主题固定使用纯白，继续保留统一占位和 `aria-current` 语义。
- 验证方式：外观专项无头测试读取实际计算样式，验证浅色主题为 9×12 px 纯黑实心三角形，深色和高对比深色主题为同尺寸纯白实心三角形；Worktree 专项验证标识随切换迁移。
- 相关文件：`webview/Sidebar.tsx`、`webview/styles.css`、`webview/appearance.css`、`scripts/test-appearance-ui.mjs`、`scripts/test-ui.mjs`、`scripts/test-worktrees-ui.mjs`。

## BUG-011：文件与分支目录显示无关的原生编辑菜单

- 日期：2026-10-01
- 状态：已解决
- 现象：在 Working Tree、Commit Details、Commit 比较文件和分支虚拟目录上右键时，显示“剪切 / 复制 / 粘贴”，没有对象相关操作；Remote 名称只有三点按钮能稳定打开菜单。
- 原因：文件行和分支目录没有注册对象级 `contextmenu` 处理，工作台也没有为非编辑区域提供兜底，因此事件落入 Webview 的浏览器原生编辑菜单。
- 解决方案：文件右键菜单按当前单选或多选提供 Diff、编辑、Stage、Unstage、Mark Resolved、Discard 与复制路径；分支目录提供 Graph 范围和复制名称操作，Remote 标题整行响应菜单。工作台仅在非编辑且没有文本选择时抑制无意义的原生菜单。
- 验证方式：文件无头界面检查覆盖单选、多选、Working Tree 操作菜单、历史文件菜单和输入框原生行为；主界面检查覆盖分支目录与 Remote 标题菜单。
- 相关文件：`webview/App.tsx`、`webview/Details.tsx`、`webview/Sidebar.tsx`、`webview/menus.ts`、`scripts/test-files-ui.mjs`、`scripts/test-ui.mjs`。

## BUG-010：Merge 后 Graph 保留空轨道并按历史峰值过度占宽

- 日期：2026-10-01
- 状态：已解决
- 现象：历史中出现多次 Merge 或短时多轨道后，Graph 列按已加载历史的最大轨道数统一扩宽，已结束路径留下的中间空位也会继续挤压提交信息。
- 原因：轨道分配只删除尾部空位，不收拢内部空洞；列宽固定按每轨 16 px 乘全局峰值计算，且用户无法单独调整 Graph 宽度。
- 解决方案：每行结束时按原有顺序收拢活跃轨道，用过渡曲线对齐下一行；Graph 默认宽度改为 64 px，轨道间距在可用宽度内自适应，极端并行路径保留最小间距并交由历史区横向滚动。Graph 右边界新增 48–180 px 可持久化拖动。
- 验证方式：Graph 布局单测覆盖空轨道收拢、复杂 DAG 端点连续性、百父节点 Merge 和分页一致性；类型检查与无头界面验证确认旧会话迁移、Graph 分隔线跟随和宽度恢复。
- 相关文件：`webview/graph/layout.ts`、`webview/History.tsx`、`webview/store.ts`、`webview/rpc.ts`、`src/protocol/validation.ts`、`tests/graph.test.ts`、`scripts/test-appearance-ui.mjs`。

## BUG-009：提交列表列拖柄方向相反且日期拖柄难以命中

- 日期：2026-10-01
- 状态：已解决
- 现象：向右拖动作者标题右侧的拖柄时，作者列反而向左扩展；日期列拖柄位于表格最右边缘，视觉和鼠标命中都不清晰。
- 原因：作者、日期是靠右的定宽列，宽度增加时左边界向左移动；实现却把拖柄放在列的右边界，并按正向位移增加宽度。
- 解决方案：把作者和日期拖柄移到各自左边界，反向换算列宽，并用 9 px 命中区和细分隔线提供稳定的悬停与键盘焦点反馈。
- 验证方式：类型检查与无头界面验证；确认两条分隔线位于对应列左边界，向右拖动时分隔线同向移动且列宽缩小。
- 相关文件：`webview/History.tsx`、`webview/styles.css`、`webview/appearance.css`、`scripts/test-appearance-ui.mjs`、`scripts/test-ui.mjs`。

## BUG-008：Commit 文字偏上且工作区分组标题被操作按钮挤断

- 日期：2026-10-01
- 状态：已解决
- 现象：Commit 消息文字在行内偏上，与 Graph 节点和引用徽标不对齐；右侧 Working Tree 的 Unstaged Changes 标题换行，操作按钮挤占标题空间。
- 原因：消息从按钮改为 span 后仍占满行高，却没有居中行高；分组标题允许折行，长标题与操作共用有限宽度。
- 解决方案：提交消息行高与虚拟行高统一，作者、日期和标签容器居中；分组使用短标题、数量徽标和固定操作区，Discard 为图标，标题保持单行。清除宿主默认页面 padding，避免实际 Webview 比 Demo 多出边缘留白。
- 验证方式：类型检查与无头界面验收通过；实际截图核对默认 24 px 行、大字号 28 px 行和 230 px 详情区域，文字/节点居中且分组操作没有越界。
- 相关文件：`webview/styles.css`、`webview/Details.tsx`、`scripts/test-appearance-ui.mjs`。

## BUG-007：递归发现将同一仓库的 Worktree 平铺为多个顶层仓库

- 日期：2026-10-01
- 状态：已解决
- 现象：扫描包含主目录和兄弟 Worktree 的分类目录时，Repositories 顶层将同一个 SwiftResume 仓库显示四次；启动恢复与打开 Worktree 也会注册这些独立入口。
- 原因：Repository ID 基于工作目录路径，发现与注册仅按该 ID 去重；顶层界面直接遍历所有工作目录，没有按共享 `commonDir` 归并。原测试将 Worktree 独立计为仓库，未覆盖逻辑仓库展示。
- 解决方案：保持工作目录 ID 和独立操作状态，按规范化的共享 Git 存储派生统一展示分组；Git 报告主目录名称，Webview 和活动栏共用分组逻辑。发现与添加数量按逻辑仓库计数，兼容既有保存路径、活动 Worktree 和各自草稿。
- 验证方式：真实 Git 验证主目录及 linked Worktree、独立 Git 存储、递归/直接添加、旧路径恢复、自动发现、单次通知及独立状态；共享函数验证 Windows 路径与独立克隆；受控浏览器验证顶层归并、活动入口、菜单路径、Worktree 切换及草稿保留。VS Code 集成检查验证切换 Worktree 后的分支与文件状态隔离；对用户的四个 SwiftResume 目录只读验证归并为一个入口。完整结果见 [验证说明](VALIDATION.md)。
- 相关文件：`src/protocol/types.ts`、`src/protocol/repositories.ts`、`src/git/service.ts`、`src/repositories/discovery.ts`、`src/repositories/manager.ts`、`webview/Sidebar.tsx`、`tests/repository-discovery.test.ts`、`tests/repository-manager.test.ts`、`tests/repository-groups.test.ts`、`tests/extension/runner.ts`、`scripts/test-worktrees-ui.mjs`、`scripts/test-ui.mjs`。

## BUG-006：Diff 定位逐行蓝框且缺少修改块序号

- 日期：2026-10-01
- 状态：已解决
- 现象：点击下一处修改后，多行差异逐行显示蓝色轮廓，产生大量横线；导航附近没有当前位置或差异总数，手动滚动也不能更新定位。
- 原因：`active-change` 在每行绘制 outline；导航只保存点击索引，未展示计数，也未关联滚动和同文件刷新。
- 解决方案：连续修改块只绘制一个首尾边框；箭头右侧显示当前/总修改块。手动纵向滚动按视口中心更新，文件切换重置，同文件刷新按内容和行号重映射且保留滚动；截断预览明确计数范围。长代码共享横向滚动，双栏及行号保留在视口内。
- 验证方式：单测覆盖修改块分组、最近块及刷新映射；受控浏览器验证首尾按钮、块可见性、无逐行 outline、手动滚动、长行双栏、窗口缩放、文件切换、刷新位置与截断计数。缩放检查发现双栏沿用旧宽度后，补充独立尺寸监听并验证两栏同步更新。
- 相关文件：`webview/DiffPreview.tsx`、`webview/diff.ts`、`webview/styles.css`、`tests/diff-navigation.test.ts`、`scripts/test-diff-ui.mjs`、`scripts/test-ui.mjs`。

## BUG-005：Commit 行各列的鼠标反馈与操作不一致

- 日期：2026-10-01
- 状态：已解决
- 现象：鼠标经过 Commit Message 时只有这一列变色并显示手型，作者和日期没有同等反馈；双击入口也分散在部分列。
- 原因：图形与 Message 独立使用按钮，作者和日期为普通文本；悬停与双击行为绑定在子元素。
- 解决方案：Commit 整行统一悬停、指针、选择、焦点、双击与提交菜单；键盘方向键同步行选择和焦点。引用徽标保留独立分支操作并阻止冒泡；Working Tree 显示冲突数量。
- 验证方式：浏览器验证作者悬停和选择、四处指针、日期/图形/Message 双击、Enter、方向键焦点、Shift+F10 和修饰键多选。
- 相关文件：`webview/History.tsx`、`webview/styles.css`、`scripts/test-history-ui.mjs`、`scripts/test-ui.mjs`。

## BUG-004：文件区域 Ctrl+A 选择整页文字而非文件

- 日期：2026-10-01
- 状态：已解决
- 现象：在 Commit 变更文件或 Working Tree 文件区域按 Ctrl+A，会选择页面文字，不能批量选择当前面板文件。
- 原因：文件列表没有处理选择快捷键；Working Tree 仅支持逐项勾选，历史文件列表没有批量选择状态。
- 解决方案：在当前文件区域处理 Ctrl/Cmd+A、修饰键点击、范围选择及 Escape，预览与批量选择分离。全选覆盖当前面板文件，组内操作只处理该组路径；文本框保留原生全选。历史和比较列表提供 Copy Paths；Discard 必须明确选中文件。
- 验证方式：选择助手单测与浏览器验证全选范围、路径复制、部分选择、Staged/Unstaged 交叉文件、Discard 确认目标和 Commit 文本框全选。
- 相关文件：`webview/Details.tsx`、`webview/fileSelection.ts`、`webview/styles.css`、`tests/file-selection.test.ts`、`scripts/test-files-ui.mjs`、`scripts/test-ui.mjs`。

## BUG-003：进行中的 Git 操作与冲突提醒缺乏可见性

- 日期：2026-10-01
- 状态：已解决
- 现象：Merge / Cherry-pick 冲突提示与普通面板同色，容易忽略；Continue 禁用没有直接解释，也没有进入冲突文件的入口。
- 原因：原操作条只展示操作名、冲突数字和三个按钮，没有区分受阻与等待继续，也未提供冲突导航。
- 解决方案：持久显示带语义颜色、图标和冲突数量的操作条；提供“查看冲突”并定位首个冲突文件。直接解释 Continue 的禁用原因；冲突解决后显示等待 Continue，操作完成后才消失。无活动操作的冲突同样提供导航。
- 验证方式：受控浏览器验证两个冲突、Continue 禁用说明、首个冲突预览、Abort 对话框、已解决状态与 Continue 完成后的移除。
- 相关文件：`webview/OperationNotice.tsx`、`webview/App.tsx`、`webview/styles.css`、`scripts/test-feedback-ui.mjs`。

## BUG-002：Git 操作反馈不醒目且失败后状态更新不及时

- 日期：2026-10-01
- 状态：已解决
- 现象：Push 等操作主要通过底部短文本报告状态，进行中、成功与失败缺乏清晰区分；Merge 或 Cherry-pick 失败后，前端未立即读取操作状态，冲突提示需要等待后续刷新。
- 原因：操作结果只有 `activity`、`notice` 和通用错误文本；失败路径仅针对部分 Checkout 刷新，未统一读取 Git 执行后的状态。
- 解决方案：工具栏下增加操作信息栏，显示操作名称、目标、进行中、成功、失败、错误详情和日志入口。结果保留到关闭或下一次操作，进行中不可关闭；状态按仓库隔离。失败后重新读取仓库状态，保留原始错误详情。
- 验证方式：状态测试覆盖 Push 目标、宿主活动结束与响应顺序、结果保留和仓库切换；受控浏览器验证 Push 的三个状态、错误展开和日志入口。
- 相关文件：`webview/store.ts`、`webview/actionFeedback.ts`、`webview/ActionFeedbackBar.tsx`、`webview/App.tsx`、`webview/styles.css`、`tests/ui-state.test.ts`、`scripts/test-feedback-ui.mjs`、`scripts/test-ui.mjs`。

## BUG-001：仓库自动刷新打断历史 Commit 和 Diff 查看

- 日期：2026-09-30
- 状态：已解决
- 现象：工作区文件变化或仓库刷新时，正在查看的历史 Commit 详情与 Diff 会清空并显示 Loading；Diff 滚动位置回到顶部。Merge Commit 的非默认 Parent 会回到第一个 Parent；同时含 Staged 与 Unstaged 修改时，刷新会把 Staged 比较改成 Unstaged。
- 原因：文件监听只发布无范围的变化通知；前端每次刷新均重读 History 并重新选择当前 Commit，选择过程清空详情和比较目标。Diff effect 依赖每次查询递增的 Snapshot 版本，并在每次预览返回后重置滚动位置。工作区比较选择逻辑未保留既有区域。
- 解决方案：监听携带文件路径与 Index 范围并合并防抖、并发请求中的失效信息；后台刷新按已选引用 OID 决定是否重读 History。保留同一历史 Commit 的详情、Parent 和比较目标；工作区 Diff 按所选文件及相关 Index、HEAD 和状态变化更新，兼容无范围通知。相同比较在后台保留旧画面及滚动位置；失效区域或文件才回退。Parent 以可选字段兼容保存到现有会话。
- 验证方式：状态与监听回归覆盖无关文件、引用移动、非默认 Parent、dirty 状态不变、Staged 选择、比较消失、通知合并、重叠请求与切换仓库；浏览器使用受控宿主验证实际 React 加载次数、Loading 可见性、内容更新和滚动位置。完整验证结果见 [验证说明](VALIDATION.md)。
- 相关文件：`src/repositories/manager.ts`、`src/extension/workbench.ts`、`src/protocol/types.ts`、`src/protocol/validation.ts`、`webview/store.ts`、`webview/refresh.ts`、`webview/DiffPreview.tsx`、`webview/rpc.ts`、`tests/ui-state.test.ts`、`tests/repository-watch.test.ts`、`scripts/test-refresh-ui.mjs`。
