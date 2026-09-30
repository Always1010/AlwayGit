# 问题日志

本文记录已确认的项目 Bug、异常与明确影响现有行为的实现不足；当前产品行为以 [工作台规格](WORKBENCH_SPEC.md) 为准。

## BUG-001：仓库自动刷新打断历史 Commit 和 Diff 查看

- 日期：2026-09-30
- 状态：已解决
- 现象：工作区文件变化或仓库刷新时，正在查看的历史 Commit 详情与 Diff 会清空并显示 Loading；Diff 滚动位置回到顶部。Merge Commit 的非默认 Parent 会回到第一个 Parent；同时含 Staged 与 Unstaged 修改时，刷新会把 Staged 比较改成 Unstaged。
- 原因：文件监听只发布无范围的变化通知；前端每次刷新均重读 History 并重新选择当前 Commit，选择过程清空详情和比较目标。Diff effect 依赖每次查询递增的 Snapshot 版本，并在每次预览返回后重置滚动位置。工作区比较选择逻辑未保留既有区域。
- 解决方案：监听携带文件路径与 Index 范围并合并防抖、并发请求中的失效信息；后台刷新按已选引用 OID 决定是否重读 History。保留同一历史 Commit 的详情、Parent 和比较目标；工作区 Diff 按所选文件及相关 Index、HEAD 和状态变化更新，兼容无范围通知。相同比较在后台保留旧画面及滚动位置；失效区域或文件才回退。Parent 以可选字段兼容保存到现有会话。
- 验证方式：状态与监听回归覆盖无关文件、引用移动、非默认 Parent、dirty 状态不变、Staged 选择、比较消失、通知合并、重叠请求与切换仓库；浏览器使用受控宿主验证实际 React 加载次数、Loading 可见性、内容更新和滚动位置。完整验证结果见 [验证说明](VALIDATION.md)。
- 相关文件：`src/repositories/manager.ts`、`src/extension/workbench.ts`、`src/protocol/types.ts`、`src/protocol/validation.ts`、`webview/store.ts`、`webview/refresh.ts`、`webview/DiffPreview.tsx`、`webview/rpc.ts`、`tests/ui-state.test.ts`、`tests/repository-watch.test.ts`、`scripts/test-refresh-ui.mjs`。
