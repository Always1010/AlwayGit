# 问题日志

本文记录已确认的项目 Bug、异常与明确影响现有行为的实现不足；当前产品行为以 [工作台规格](WORKBENCH_SPEC.md) 为准。

## BUG-006：Diff 定位逐行蓝框且缺少修改块序号

- 日期：2026-10-01
- 状态：已解决
- 现象：点击下一处修改后，多行差异逐行显示蓝色轮廓，产生大量横线；导航附近没有当前位置或差异总数，手动滚动也不能更新定位。
- 原因：`active-change` 在每行绘制 outline；导航只保存点击索引，未展示计数，也未关联滚动和同文件刷新。
- 解决方案：连续修改块只绘制一个首尾边框；箭头右侧显示当前/总修改块。手动纵向滚动按视口中心更新，文件切换重置，同文件刷新按内容和行号重映射且保留滚动；截断预览明确计数范围。长代码共享横向滚动，双栏及行号保留在视口内。
- 验证方式：单测覆盖修改块分组、最近块及刷新映射；受控浏览器验证首尾按钮、块可见性、无逐行 outline、手动滚动、长行双栏、文件切换、刷新位置与截断计数。
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
