# 问题日志

本文记录已确认的项目 Bug、异常与明确影响现有行为的实现不足；当前产品行为以 [工作台规格](WORKBENCH_SPEC.md) 为准。

## BUG-108：创建 PR 或 MR 的迟到查询覆盖较新的来源

- 日期：2026-10-05
- 状态：待修复
- 优先级与可信度：P2；真实入口函数与受控 RPC 乱序最小复现通过。
- 现象：同仓库先后发起分支 A、B 的创建 PR/MR 入口，B 结果先到后，A 的迟到结果会将浮窗来源替换为 A；关闭较新浮窗后迟到结果也可重新打开。
- 原因：showRemoteRequest 等待 remoteLinks 后只核对 repoId，没有请求代次、取消或完整来源身份检查；组件 key 无法阻止旧异步结果写入 Store。
- 解决方案：待实施；用请求代次或取消控制绑定仓库、分支及来源身份，关闭或切换意图使旧结果失效，再按当前请求初始化浮窗。
- 验证方式：0.47.1 / faf4524；当前真实 showRemoteRequest 经临时 esbuild 打包，受控 RPC 先启动 A 再启动 B，先完成 B 时状态为 branch-B，随后完成 A 时退回 branch-A。无外网或实际 PR/MR 创建；现有反馈专项仅覆盖单个请求。
- 相关文件：`webview/RemoteRequestDialog.tsx`、`webview/App.tsx`、`webview/menus.ts`、`webview/PushFeedback.tsx`、`scripts/test-feedback-ui.mjs`。

## BUG-107：刷新验收夹具缺少 Cherry-pick 检查响应

- 日期：2026-10-05
- 状态：已解决
- 优先级与可信度：P2；原专项失败及内存修正后通过均已验证。
- 现象：当前无头 `--refresh-only` 专项在打开历史 Commit 菜单后产生 `Cannot read properties of undefined (reading 'head')`，最终运行时错误断言失败。
- 原因：刷新专项的受控宿主未处理新增 `cherryPickCheck` RPC，成功响应 undefined；前端检查回调读取 `.head` 时抛错。真实宿主提供结构化响应，不是本次发现的生产刷新逻辑故障。
- 解决方案：刷新受控宿主补齐 cherryPickCheck，按当前快照 HEAD、分支和选择返回结构化响应；核对现有 Cherry-pick 专项协议，保留全部刷新断言。
- 验证方式：2026-10-05：使用当前生产构建执行无头 --refresh-only 完整通过，运行时错误列表为空。
- 相关文件：`scripts/test-refresh-ui.mjs`、`webview/useCherryPickCheck.ts`、`src/protocol/types.ts`。

## BUG-106：快照查询计数断言过时导致全量测试失败

- 日期：2026-10-05
- 状态：已解决
- 优先级与可信度：P2；当前全量 Vitest 已失败并定位。
- 现象：`bounds nested tag and remote destination resolution in snapshots while preserving identities` 期望 36 条查询，实际 48 条，使全量测试以及依赖该检查的发布验证无法通过。
- 原因：快照增加远端 Read 地址解析后，每个 Remote 同时查询 Push 和 Read 地址；测试仍按每项三条计数。12 个嵌套 Tag 各两条，加 12 个 Remote 各两条，当前应为 48 条。
- 解决方案：按每个嵌套 Tag 两条读取及每个 Remote 的 Push/Read 地址两条读取更新计数；保留最多四条并行、身份和顺序断言。
- 验证方式：2026-10-05：定向 git-history-scale 单测 1 文件 / 5 项通过；查询总数为 48，最大并发不超过 4。
- 相关文件：`tests/git-history-scale.test.ts`、`src/git/service.ts`（Snapshot 的远端地址解析）、`.github/workflows/release.yml`。

## BUG-105：非 BMP 字符的行内 Diff 高亮拆分代理对

- 日期：2026-10-05
- 状态：已解决
- 优先级与可信度：P3；纯函数与 Edge 无头 DOM 最小复现通过。
- 现象：例如将 😀 改为 😁，行内变化高亮可能只覆盖零宽的低代理字符，未覆盖实际显示的 emoji；正文字符本身仍可正确显示，不属于内容损坏。
- 原因：`changedParts` 按 UTF-16 code unit 求公共前后缀，共同高代理进入 prefix，变化的低代理进入 mark；浏览器字形跨节点组合，实际宽度落在 prefix。
- 解决方案：changedParts 按完整 Unicode 码点比较公共前后缀，保留完整代理对及现有输出结构；差异专项增加 emoji DOM 高亮断言。
- 验证方式：2026-10-05：workbench-helpers 1 文件 / 7 项通过，😀→😁 返回完整码点分段；DOM 高亮验收将在统一构建后执行。
- 相关文件：`webview/diff.ts`（`changedParts`）、`webview/DiffPreview.tsx`（`content`）、`tests/diff-navigation.test.ts`、`tests/workbench-helpers.test.ts`。

## BUG-104：Escape 关闭浮窗时同时取消后层面板最大化

- 日期：2026-10-05
- 状态：待修复
- 优先级与可信度：P2；Edge 无头界面已复现。
- 现象：最大化底栏后打开设置等浮窗，Escape 关闭浮窗时还会恢复底栏大小；最大化图片 Diff 的全局 Escape 监听存在同类后层处理。
- 原因：Modal 的 window 键盘监听没有消费 Escape；BottomDock 无条件处理同一事件，图片 Diff 的捕获监听也没有排除模态浮窗。
- 解决方案：待实施；模态浮窗优先消费 Escape，后层布局监听识别模态状态及已处理事件，统一保证一次按键只关闭当前交互层。
- 验证方式：0.47.1 / faf4524；当前构建 Demo 中最大化底栏，用逗号快捷键打开设置，Escape 后浮窗关闭且 `dock-maximized` 从 true 变为 false。现有终端专项验证了菜单关闭保留最大化，未覆盖 Modal；图片 Diff 链路由代码核对，未单独执行界面复现。
- 相关文件：`webview/ui.tsx`、`webview/BottomDock.tsx`、`webview/DiffPreview.tsx`、`scripts/test-terminal-ui.mjs`、`scripts/test-appearance-ui.mjs`。

## BUG-103：中文界面未同步页面语言和动作字段无障碍名称

- 日期：2026-10-05
- 状态：待修复
- 优先级与可信度：P2；代码链路确认。
- 现象：切换简体中文后，页面仍声明英文语言；多个 Git 动作字段虽显示中文标签，其 aria-label 仍强制英文，辅助技术取得的语言与名称与界面不一致。
- 原因：构建入口固定 `html lang="en"`，宿主保留该标记，语言切换未更新根元素 lang；ActionDialog 字段与 Tag 目标输入直接调用 `translate('en', ...)`，覆盖当前语言的可见标签。
- 解决方案：待实施；初始化及语言变化时同步根元素 lang，动作字段使用当前翻译或关联可见标签。
- 验证方式：0.47.1 / faf4524；逐项核对入口 HTML、宿主 HTML 注入、语言状态及 ActionDialog 字段生成；现有语言和界面测试未断言中文页面语言与动作字段可访问名称。尚未进行真实屏幕阅读器验收。
- 相关文件：`webview/index.html`、`webview/i18n.ts`、`webview/App.tsx`、`webview/ActionDialog.tsx`、`src/extension/workbench.ts`、`scripts/test-appearance-ui.mjs`。

## BUG-102：Tag 推送缺少结构化结果且部分发布摘要不准确

- 日期：2026-10-05
- 状态：待修复
- 优先级与可信度：P2；真实多目的地本地推送已复现。
- 现象：Tag Push 成功没有实际目的地、引用状态及链接的结构化反馈；一个 Remote 的多个 Push 地址部分成功时，已发布 Tag 仍可能被摘要计为零成功。
- 原因：逐 Tag 调用普通 `run` 而非 `push` 的 porcelain 解析，成功返回 undefined，失败只拼文本且没有 `pushResult`；按单条命令退出码计数不能表达各目的地的部分发布。
- 解决方案：待实施；复用 porcelain PushResult 解析并聚合逐 Tag、逐目的地状态，失败保留实际已发布部分，前端沿用现有结构化反馈。
- 验证方式：0.47.1 / faf4524；origin 配置一个有效本地 Bare Remote 和一个不可用本地地址，前者发布成功，动作却报“0 Tag(s) pushed; 1 failed”且无 pushResult。已复核宿主 envelope 与前端反馈链路；现有测试只检查引用和错误码，没有检查结构化返回及多地址部分成功。
- 相关文件：`src/git/service.ts`、`src/git/push-result.ts`、`webview/store.ts`、`webview/ActionFeedbackBar.tsx`、`tests/git-tag-push.test.ts`、`scripts/test-feedback-ui.mjs`。

## BUG-101：完整路径的依赖目录过滤使工作区 Diff 持续陈旧

- 日期：2026-10-05
- 状态：待修复
- 优先级与可信度：P2；真实 Git 与 RepositoryManager 最小复现通过。
- 现象：仓库祖先目录包含 `node_modules`，或查看仓库内已跟踪的同名目录文件时，文件内容再次变化可能不刷新当前 Working Tree Diff，需手动刷新才能恢复。
- 原因：watcher 用完整 `uri.fsPath` 排除 `node_modules`，可误排整个仓库；补偿轮询只比较状态快照，不包含文件内容，同一 M 或未跟踪状态的再次修改没有指纹变化。
- 解决方案：待实施；目录判断限定于仓库相对路径，依赖过滤保留受 Git 管理文件的变化；核对补偿刷新对当前工作区 Diff 的内容失效策略。
- 验证方式：0.47.1 / faf4524；临时 `node_modules/project` 仓库中连续修改同一文件，真实 Manager watcher 事件通知为零，两次真实快照除 version 外相同；前端失效链路确认空 paths 与相同状态不能触发 Diff 重取。现有 watcher 测试仅断言依赖目录排除，缺同名祖先及已跟踪文件。普通路径 BUG-001 修复不覆盖本条件。
- 相关文件：`src/repositories/manager.ts`、`src/extension/workbench.ts`、`webview/refresh.ts`、`webview/store.ts`、`tests/repository-watch.test.ts`、`scripts/test-refresh-ui.mjs`。

## BUG-100：面板重叠保存可覆盖其他标签较新的恢复草稿

- 日期：2026-10-05
- 状态：已解决
- 优先级与可信度：P2；真实 Workbench 无界面最小复现通过。
- 现象：面板 A 的保存尚未完成时，B 保存同仓库较新的草稿；A 再次激活并同步未再次编辑的旧内容，最终恢复基线仍会回退 B 的新草稿或视图。
- 原因：`saveSessionBaseline` 在串行任务入队前捕获 `source.savedSession`；同一面板重复入队会使用旧成功基线，把没有再次编辑的字段误判为新改动。
- 解决方案：保存队列执行时读取面板最新成功基线；SessionWriter 将写入成功后的面板基线推进纳入同一串行任务，失败时不推进基线。
- 验证方式：2026-10-05：会话持久化及 Workbench 入口 2 文件 / 27 项通过；真实面板消息与受控 Memento 覆盖重叠保存、激活同步及首写失败。
- 相关文件：`src/extension/workbench.ts`、`src/application/session-persistence.ts`、`tests/session-persistence.test.ts`、`tests/workbench-entry.test.ts`。

## BUG-099：精确文件范围保护误拒绝已跟踪子模块

- 日期：2026-10-05
- 状态：待修复
- 优先级与可信度：P2；真实本地子模块已复现。
- 现象：已跟踪子模块更新后，Stage、Unstage 和选择性 staged Commit 均报 `FILE_SCOPE_CHANGED`；包含该路径的全量暂存也会受阻，原生 Git 暂存正常。
- 原因：范围校验一律拒绝非斜杠结尾的磁盘目录，没有区分 Git 模式 `160000` 的 gitlink。gitlink 在 Git 中是精确叶节点，其磁盘形态正常为目录。
- 解决方案：待实施；读取 Index/HEAD 模式，为相应操作识别并允许已跟踪 gitlink，继续拒绝普通目录替换及未选择的父子条目，避免放宽丢弃和隔离 Stash 的安全边界。
- 验证方式：0.47.1 / faf4524；使用两个临时本地仓库添加子模块并推进子模块提交，三个扩展操作均拒绝，原生 `git add -- sub` 成功。现有范围测试未包含 gitlink；隔离 Stash 的既有子模块限制不属于本问题。
- 相关文件：`src/git/file-scope.ts`、`src/git/service.ts`、`src/git/selected-commit.ts`、`tests/git-file-scope.test.ts`、`tests/selected-commit.test.ts`。

## BUG-098：批量跟踪分支创建丢失已捕获的起点 OID

- 日期：2026-10-05
- 状态：待修复
- 优先级与可信度：P2；真实 Git 已复现。
- 现象：不执行 Checkout 的远程跟踪分支创建，在来源核验后被外部 Fetch 或客户端推进时，会从用户未确认的新提交创建本地分支。
- 原因：计划已保存来源 `oid`，实际却运行 `branch --track <name> <source>`，重新解析可变远程跟踪引用；`checkout: true` 路径已有固定 OID 保护。
- 解决方案：待实施；批量路径也从捕获的 OID 创建引用，再设置原来源 upstream，保留已有逐项失败与已创建分支反馈。
- 验证方式：0.47.1 / faf4524；在实际创建启动前由外部 Git 推进 `refs/remotes/origin/topic`，新本地分支指向推进后的 OID。现有固定起点竞态检查只覆盖 Checkout 路径。
- 相关文件：`src/git/service.ts`（`trackBranches`）、`tests/git-safety.test.ts`。

## BUG-097：Tag 推送核验后仍会重新解析可变引用

- 日期：2026-10-05
- 状态：待修复
- 优先级与可信度：P2；真实本地 Bare Remote 已复现。
- 现象：Tag Push 核验确认的原始对象 OID 后，外部客户端替换同名 Tag，实际推送成功却发布了替换后的对象。批量推送期间也存在相同窗口。
- 原因：预检全部 `expectedOids` 后，发送 source 仍为 `refs/tags/<name>`，Git 在实际运行时再次解析可变引用。
- 解决方案：待实施；用确认的原始 Tag 对象 OID 作为推送 source，保持完整目标 Tag ref，保留注解 Tag 对象及既有拒绝覆盖规则。
- 验证方式：0.47.1 / faf4524；真实临时仓库与本地 Bare Remote 中，在实际 Push 启动前替换 Tag，远端最终 OID 为新对象而非已确认对象。现有测试仅覆盖初次核验前的替换，缺发送前及批处理中变化。
- 相关文件：`src/git/service.ts`（`tag.push`）、`tests/git-tag-push.test.ts`。

## BUG-096：URL 查询凭据和跨块 stderr 未被完整脱敏

- 日期：2026-10-05
- 状态：待修复
- 优先级与可信度：P1；真实 Git 与进程输出最小复现通过。
- 现象：远端 URL 的 `access_token` 等查询参数原样进入输出日志和 RPC 错误；userinfo URL 在 stderr 管道中跨块输出时，也可能完整泄露到日志。
- 原因：`redactSecrets` 仅覆盖完整 HTTP(S) userinfo URL 与 Authorization；扩展对每个 stderr 块独立处理，没有保存未完成的 URL 或行。stdout 当前在命令结束后整体输出。
- 解决方案：待实施；统一覆盖 URL 查询认证参数，并使用有状态的流式脱敏，在结束时处理剩余内容；错误响应、结构化 Push 结果及日志使用一致的机密处理边界。
- 验证方式：0.47.1 / faf4524；临时仓库 Fetch 带伪造查询令牌的回环 HTTP 404 地址，真实 Git 错误及现有脱敏函数仍包含该令牌。真实 runner 接收分两次写出的 userinfo URL，逐块脱敏后拼接仍含伪造凭据，而整段脱敏正常。未使用真实凭据或外网写入；现有日志测试缺查询参数及跨块用例。
- 相关文件：`src/application/logging.ts`、`src/extension/extension.ts`、`src/git/runner.ts`、`src/git/service.ts`、`src/git/push-result.ts`、`tests/logging.test.ts`。

## BUG-095：Stash 核验后序号变化仍可能删除其他存档

- 日期：2026-10-05
- 状态：待修复
- 优先级与可信度：P1；真实 Git 已复现。
- 现象：Drop 核验用户确认的 Stash OID 后，其他客户端新增存档使 `stash@{n}` 移位，后续删除会误中未确认的新存档；Pop 成功后的删除也使用相同链路。
- 原因：`validateStash` 比较 OID 与实际 `stash drop` 分离，删除参数仍为可变序号，宿主队列不能阻止外部 Git 修改 reflog。
- 解决方案：待实施；在 Git 引用与 reflog 锁保护下将删除绑定到确认的条目身份，不能只增加一次删除前核验。Drop、Pop 及非顶部条目需要同一保护。
- 验证方式：0.47.1 / faf4524，Windows Git 2.55.0；在系统临时真实仓库中，于实际删除进程启动前由外部 Git 新建 Stash，执行成功后新存档消失、原确认存档仍在。现有测试只覆盖初次核验前变化，缺少核验与删除之间的竞态。
- 相关文件：`src/git/service.ts`（`validateStash`、`stash.drop`、`stash.apply` 的 Pop 分支）、`tests/git-safety.test.ts`、`tests/stash-state.test.ts`。

## BUG-094：Tag 删除确认框随后台刷新改变远端身份

- 日期：2026-10-05
- 状态：已解决
- 现象：Tag 删除确认框打开后，地址变化或状态刷新可能将待提交的目标地址和 OID 更新为用户未确认的身份。
- 原因：提交直接使用最新 Snapshot 地址与查询结果，没有保持确认框捕获的远端身份。
- 解决方案：冻结读取地址、Push 地址和原始 Tag OID；未查询目标只接受同地址的首次结果，刷新不能推进身份。目标变化禁用提交并提示重开，提交处理再次检查最新状态；显式选择其他目标才重新捕获。
- 验证方式：确认租约专项 4 项通过；无界面真实 React 回归验证开窗后地址变化、禁用按钮、直接提交仍不发送动作，以及重开后使用新地址；现有动作安全界面专项、类型检查和双语校验通过。
- 相关文件：`webview/ActionDialog.tsx`、`webview/tagDeleteLease.ts`、`tests/tag-delete-lease.test.ts`、`scripts/test-tag-status-ui.mjs`、`docs/ARCHITECTURE.md`。

## BUG-093：本地分支核验后被替换仍可能遭到删除

- 日期：2026-10-05
- 状态：已解决
- 现象：删除前核验 OID 后，外部 Git 修改同名分支，后续按名称删除可能误删新引用；批量删除遇到终止未确认后仍可能继续写入。
- 原因：OID 校验与 `branch -d/-D` 删除分离，没有在引用锁内比较；批量错误处理未保留进程终止隔离语义。
- 解决方案：捕获预期 OID，通过 update-ref 原子比较删除；写入前重新核对工作树占用及普通删除的 upstream/HEAD 合并状态，清理 reflog 和分支配置，保留重新创建的分支配置；终止未确认立即停止批量操作。
- 验证方式：真实 Git 分支删除专项 7 项通过，覆盖普通/强制删除竞态、合并规则、工作树占用及 HEAD 移动；runner 专项 11 项通过，覆盖写入隔离及批量终止；批量顺序和并发范围定向检查通过。
- 相关文件：`src/git/service.ts`、`src/i18n/catalogs/service.json`、`src/i18n/generated.ts`、`tests/git-branch-delete.test.ts`、`tests/git-runner.test.ts`、`tests/git-history-scale.test.ts`、`docs/ARCHITECTURE.md`。

## BUG-092：远端目标核验后仍可能向另一仓库执行危险操作

- 日期：2026-10-05
- 状态：已解决
- 现象：远端删除或强推核验地址后，其他客户端修改 pushurl，若另一仓库引用 OID 相同，操作可误作用于另一仓库。
- 原因：核验后仍按可变 remote 名称解析推送地址，Git 的 URL rewrite 规则也可能再次重定向已解析地址。
- 解决方案：捕获唯一已确认地址，命令级先清空 pushurl 列表再固定该地址；临时私有配置将整个捕获地址的原样重写放在最前，并继续包含原系统配置，阻止后续 insteadOf 改址。保持远端名称、upstream、跟踪引用和系统配置语义，不修改持久配置，进程结束后清理临时文件。只读能力检查无法证明绑定有效时拒绝发送；此能力要求 Git 2.46 或更新版本。
- 验证方式：远端租约专项 12 项通过，真实双裸仓库覆盖分支删除、强推、Tag 删除发送前修改 pushurl 和 insteadOf，核对 upstream/跟踪引用与系统配置保留；旧 Git 能力不满足时不发送；差异格式检查通过。
- 相关文件：`src/git/service.ts`、`src/i18n/catalogs/service.json`、`src/i18n/generated.ts`、`tests/git-remote-lease.test.ts`、`docs/ARCHITECTURE.md`、`docs/USER_MANUAL.zh-CN.md`、`docs/USER_MANUAL.en.md`、`package.json`。

## BUG-091：暂存和取消暂存越过所选文件边界

- 日期：2026-10-05
- 状态：已解决
- 现象：所选文件被同名目录替换后，Stage 会暂存未选的子文件，Unstage 可能取消其他子文件的暂存；选中子路径也可能移除未选的已跟踪父文件。
- 原因：这两个入口只验证路径语法，没有调用已有的精确文件范围保护，literal pathspec 仍匹配后代。
- 解决方案：重命名关联路径展开后，对 Stage、冲突暂存和 Unstage 统一执行精确文件范围校验。
- 验证方式：文件范围及相关 Git 行为定向检查 20 项通过，覆盖目录替换和未选祖先保护；差异格式检查通过。
- 相关文件：`src/git/service.ts`、`tests/git-file-scope.test.ts`、`tests/git-service.test.ts`。

## BUG-090：无效窗口记录遮蔽活动窗口

- 日期：2026-10-05
- 状态：已解决
- 现象：异常退出残留超过 256 条过期或畸形窗口注册记录后，活动窗口可能无法发现，影响候选选择、广播和窗口复用。
- 原因：在验证和过期过滤前截取前 256 个文件名。
- 解决方案：每批读取 32 个文件，在验证和过期过滤后限制有效窗口数量；不自动删除其他窗口记录，避免与并发心跳争用。
- 验证方式：窗口桥专项 14 项通过，覆盖 256 条过期或畸形记录后的活动窗口发现、候选选择及真实 IPC 路由；差异格式检查通过。
- 相关文件：`src/application/window-bridge.ts`、`tests/window-bridge.test.ts`。

## BUG-089：终端初始化失败后无法重试

- 日期：2026-10-05
- 状态：已解决
- 现象：首次终端列表请求失败后，再次加载和创建终端持续失败，直至重载工作台。
- 原因：初始化缓存永久保留 rejected Promise，创建也等待同一失败任务。
- 解决方案：失败时按任务身份清除缓存并传播原错误，保留并发加载去重和成功结果缓存。
- 验证方式：终端状态和界面专项 2 文件、4 项通过，覆盖失败后的创建、重试、并发加载和创建等待初始化；差异格式检查通过。
- 相关文件：`webview/dock-store.ts`、`tests/dock-store.test.ts`、`tests/dock-ui.test.tsx`。

## BUG-088：畸形远端链接将成功 Push 报为失败

- 日期：2026-10-05
- 状态：已解决
- 现象：远端输出含非法百分号编码的 GitHub compare 链接时，已成功的 Push 被一般解析异常覆盖，丢失实际发布结果。
- 原因：可选链接直接调用 decodeURIComponent，未隔离 URIError。
- 解决方案：逐条捕获链接解码失败并跳过该候选，继续提取其他有效链接，保留 Git 的实际推送结果。
- 验证方式：hosting 专项 5 项通过，真实 Push 结果解析覆盖畸形链接及其后的有效链接；差异格式检查通过。
- 相关文件：`src/protocol/hosting.ts`、`tests/hosting.test.ts`。

## BUG-087：Continue 检查切仓再切回留下忙碌状态

- 日期：2026-10-05
- 状态：已解决
- 现象：Continue 或活动操作 Commit 检查暂存结果期间，切到其他仓库再切回，迟到的检查结束后界面仍忙碌，后续动作被禁止。
- 原因：检查 finally 用视图 epoch 同时控制结果发布和忙碌清理；切仓使 epoch 失效，执行集合虽已移除，当前仓库的 busy 状态却未重算。
- 解决方案：结果和错误仍按原 epoch 隔离；结束时无条件释放原仓库检查锁，当前显示原仓库时按宿主活动重算 busy，并在宿主仍忙碌时保留活动说明，不影响其他仓库。
- 验证方式：状态专项覆盖切仓再切回后的成功、失败、取消，旧结果和错误不发布且能立即执行下一动作；宿主仍忙碌时不提前解锁，结束事件后恢复；原 Continue 检查与切仓回归、类型检查。
- 相关文件：`webview/store.ts`、`tests/ui-state.test.ts`、`docs/WORKBENCH_SPEC.md`。

## BUG-086：删除远端分支隐式推送未选注解标签

- 日期：2026-10-05
- 状态：已解决
- 现象：开启 `push.followTags` 时，删除远端分支会同时把本地未选中的注解 Tag 推送到远端。
- 原因：分支删除使用 Push refspec，但未显式关闭 follow-tags，继承了用户 Git 配置。
- 解决方案：每项远端分支删除显式传入 `--no-follow-tags`，保持原有目标地址、完整分支 refspec、force-with-lease 和部分失败保护。
- 验证方式：真实裸仓库测试开启 follow-tags、创建未推送的可达注解 Tag，批量删除两个分支后核对全部远端引用和本地 Tag 不变；远端 lease 测试与类型检查。
- 相关文件：`src/git/service.ts`、`tests/git-remote-lease.test.ts`、`docs/WORKBENCH_SPEC.md`。

## BUG-085：保存默认配置后旧动作跨仓库执行

- 日期：2026-10-05
- 状态：已解决
- 现象：Push 保存默认选择期间取消对话框并切仓，旧 Push 在保存完成后可能落到新仓库；切仓再切回也可能恢复过期操作。
- 原因：配置保存的异步 continuation 没有对话框存活检查，execute 在调用时读取当前仓库，没有绑定打开对话框时的仓库与切换代次。
- 解决方案：捕获仓库 ID 与 epoch，动作入口拒绝过期上下文；取消、替换、卸载使提交失效，所有提交前的异步等待后复核存活身份。等待期间锁定表单并以同步锁阻止重复提交，保留取消能力。Tag 目标解析同样复核，配置已保存的结果不回滚，但取消后不执行 Git 动作。
- 验证方式：状态单测覆盖切仓、切回和正常动作身份；无头 UI 专项覆盖延迟保存、重复提交、取消后重新打开、切仓和切回、正常完成、保存失败；类型检查与 Webview 构建。
- 相关文件：`webview/ActionDialog.tsx`、`webview/store.ts`、`tests/ui-state.test.ts`、`scripts/test-action-safety-ui.mjs`、`scripts/test-ui.mjs`、`docs/WORKBENCH_SPEC.md`。

## BUG-084：选择性文件操作越过同名目录边界

- 日期：2026-10-05
- 状态：已解决
- 现象：选中的已跟踪文件被同名目录替换后，选择性 Commit 会包含未选子文件，Stash 和 Discard 可能清理未选子文件，包括忽略文件。
- 原因：Git 的 literal pathspec 仍匹配后代路径；临时 Index 投影、restore 和 clean 将文件路径当作目录范围，没有复核 HEAD、Index 与磁盘的文件边界。
- 解决方案：共享精确文件范围检查，拒绝同名目录和会替换未选 HEAD/Index 父子文件的操作；Commit 写入前、Discard 确认与执行、Stash 保存与清理前均复核。保存后检查失败保留 Stash，不执行清理；复用父目录检查并限制并发，避免大批量操作退化。显式的嵌套仓库目录仍由 Git clean 的原有保护处理。
- 验证方式：真实 Git 回归覆盖三种操作、已暂存和未暂存子文件、忽略文件、确认后替换以及未选父文件；原选择性 Commit、Stash、Discard 测试及万文件专项；类型与双语资源检查。
- 相关文件：`src/git/file-scope.ts`、`src/git/service.ts`、`src/git/stash.ts`、`src/i18n/catalogs/paths.json`、`src/i18n/generated.ts`、`tests/git-file-scope.test.ts`、`docs/WORKBENCH_SPEC.md`。

## BUG-083：删除本地 Tag 后无法看见仍存在的远端 Tag

- 日期：2026-10-05
- 状态：已解决
- 现象：Tags 只列出本地标签，远端状态又以图标和短文字附着在本地行上；删除本地 Tag 后，即使所选远端仍保留同名 Tag，整行也会消失，容易误以为远端已同步删除，状态文字还占用较多侧栏宽度。
- 原因：远端查询结果仅用于计算本地 Tag 的状态，没有和本地列表合并；侧栏状态沿用文字按钮，而提交图已经使用纯图标。
- 解决方案：Tags 改为合并本地与上次成功查询到的远端名称，并增加“仅远端”状态；远端独有对象不伪装成本地引用，不能定位本地历史。侧栏状态统一为项目现有图标，文字移入悬浮、键盘焦点和详情说明。
- 验证方式：状态单测覆盖本地、同步、差异和仅远端条目的合并与原始对象身份；类型与双语资源检查；Tag 状态无头 UI 专项覆盖纯图标尺寸、四种主题颜色、悬浮说明和远端独有行。
- 相关文件：`webview/tagStatus.ts`、`webview/TagRemoteStatus.tsx`、`webview/Sidebar.tsx`、`webview/History.tsx`、`webview/styles.css`、`src/i18n/catalogs/tags.json`、`src/i18n/generated.ts`、`tests/git-tag-status.test.ts`、`scripts/test-tag-status-ui.mjs`、`docs/WORKBENCH_SPEC.md`、`docs/USER_MANUAL.zh-CN.md`、`docs/USER_MANUAL.en.md`。

## BUG-082：Tag 远端状态在五分钟后被时间自动覆盖

- 日期：2026-10-04
- 状态：已解决
- 现象：Tag 与所选远端已经显示“同步”“本地”或“差异”后，即使没有执行任何 Git 或远端操作，五分钟后也会自动变成“待核对 / Recheck”，用户无法继续看到上次成功核对的结果。
- 原因：实现把远端比较结果与缓存新鲜度合并成同一个状态，并由 15 秒界面计时器把超过五分钟的结果改写为 `stale`；查询失败也会用“未知”覆盖仍然有效的上次成功结果。
- 解决方案：Tag 状态改为最后一次成功核对的远端快照，时间经过不再改变“同步”“本地”或“差异”；重新核对期间及失败后保留旧结果，在详情中显示上次成功时间、查询进度和失败原因。首次展开、切换远端、明确的网络操作及手动核对仍会查询，普通本地刷新复用已有结果；从未成功核对时才显示“未知”。
- 验证方式：状态单测覆盖任意旧时间与失败查询仍保留成功结果、旧请求隔离和地址变化；类型与双语资源检查、生产构建通过；本机 Edge 无头 Tag 状态专项验证一天前的结果仍显示原状态，失败后不被“未知”覆盖。未打包或安装扩展。
- 相关文件：`webview/tagStatus.ts`、`webview/TagRemoteStatus.tsx`、`webview/store.ts`、`webview/styles.css`、`src/i18n/catalogs/tags.json`、`src/i18n/generated.ts`、`tests/git-tag-status.test.ts`、`tests/ui-state.test.ts`、`scripts/test-tag-status-ui.mjs`、`docs/WORKBENCH_SPEC.md`、`docs/USER_MANUAL.zh-CN.md`、`docs/USER_MANUAL.en.md`。

## BUG-081：Tags 标题创建标签会静默沿用历史选中提交

- 日期：2026-10-04
- 状态：已解决
- 现象：从 Tags 标题执行 Create Tag 时，Target Commit 自动填入此前在提交图中选中的 Commit；对话框只显示 Commit ID，用户容易误以为目标是最新 HEAD，并把 Tag 创建到旧提交。
- 原因：所有动作共用同一套目标默认值；Create Tag 没有显式目标时依次回退到 `selectedOid`、HEAD，未区分通用入口和提交图上下文入口。提交图入口也把 OID 放进普通可编辑字段，没有展示 Commit Message 或保持上下文身份。
- 解决方案：Tags 标题入口的目标改为空且必须显式输入，输入后解析并显示 Commit Message，提交时固定为完整 OID。提交图入口捕获被右键行的 OID 和 Message，以只读目标展示；添加 Remote 后返回仍保留固定目标。
- 验证方式：类型与双语资源检查；状态测试验证提交菜单传递固定目标；本机 Edge 无头验证 Tags 标题入口不继承选择或 HEAD、手动 Commit ID 可解析并显示 Message，以及右键提交固定到实际点击行且不可编辑。未打包或安装扩展。
- 相关文件：`webview/ActionDialog.tsx`、`webview/menus.ts`、`webview/styles.css`、`src/i18n/catalogs/actions.json`、`src/i18n/generated.ts`、`tests/ui-state.test.ts`、`scripts/test-ui.mjs`、`docs/ARCHITECTURE.md`、`docs/USER_MANUAL.zh-CN.md`、`docs/USER_MANUAL.en.md`、`docs/images/user-manual/figure-28.png`。

## BUG-080：Pull 与 Push 的待同步提醒样式不一致

- 日期：2026-10-04
- 状态：已解决
- 现象：顶部工具栏在存在待拉取提交时把数量直接拼入 Pull 文本，而待推送提交使用独立数字角标；两个相邻的同步动作尺寸和提醒层级不一致。
- 原因：Pull 沿用早期的括号计数文本，Push 后续接入了独立角标，两处没有共享同一种工具栏状态提示。
- 解决方案：Pull 与 Push 在存在待同步提交时统一复用仓库行的数字角标；Pull 显示待拉取提交数，Push 显示未推送提交数，超过 99 时显示 `99+`。真实数量同时保留在按钮的无障碍名称和悬浮提示中。
- 验证方式：类型检查、双语资源检查和生产构建通过；使用本机 Edge 无头执行 feedback UI 专项，验证 Pull 与 Push 均显示共享数字角标及正确数量，并保留包含真实数量的无障碍名称。未打包或安装扩展。
- 相关文件：`webview/App.tsx`、`webview/styles.css`、`src/i18n/catalogs/workbench.json`、`src/i18n/generated.ts`、`scripts/test-feedback-ui.mjs`。

## BUG-079：新窗口恢复仓库期间显示空目录且开放添加入口

- 日期：2026-10-04
- 状态：已解决
- 现象：新窗口工作台已显示，左侧仓库仍需等待一段时间才出现；等待期间主区域显示“没有添加仓库”并提供添加入口，容易被误认为仓库记录丢失而开始操作。
- 原因：后台恢复逐个验证保存路径，普通仓库需要四次 Git 子进程查询，目录请求等待整批恢复完成。前端只记录通用 loading，空状态仅依据当前空数组判断，无法区分尚未返回、成功空目录与读取失败。内置 Git 激活和路径访问也可能延长等待，未测量用户实际新窗口中各阶段耗时。
- 解决方案：保存路径最多四个并行验证，保留输入顺序、完整目录一次发布及扫描失效保护。前端单独管理目录加载/就绪/失败状态，在首次响应前即显示加载提示，禁用添加与重复刷新；超过十秒提供慢加载说明和日志入口，失败后允许重试。目录相关宿主操作也等待首次恢复，成功确认空目录后才展示添加引导。
- 验证方式：140 项定向无界面回归最终通过，覆盖并发上限、乱序完成、扫描失效、目录状态与宿主等待；类型和 1,405 条双语资源检查通过。使用本机 Edge 无头验证真实 React 的慢加载提示、禁用按钮、失败重试、确认空目录与恢复添加入口，并检查截图。对 `D:\WRK` 下六个实际仓库只读测量：串行约 1.97 秒，四路并行约 0.67 秒；该对比不包含 VS Code 或内置 Git 激活耗时，不代表完整新窗口启动时间。未运行真实 VS Code 桌面验证，未打包或安装扩展。
- 相关文件：`src/repositories/manager.ts`、`src/extension/workbench.ts`、`webview/store.ts`、`webview/App.tsx`、`webview/Sidebar.tsx`、`webview/menus.ts`、`webview/RepositoryCatalogStatus.tsx`、`webview/styles.css`、`src/i18n/catalogs/workbench.json`、`tests/repository-manager.test.ts`、`tests/repository-state.test.ts`、`tests/ui-state.test.ts`、`tests/workbench-entry.test.ts`。

## BUG-078：界面偏好未跨窗口共享，旧面板恢复覆盖新设置

- 日期：2026-10-04
- 状态：已解决
- 现象：原窗口应用黄色主题后，新窗口仍显示默认主题；语言、字号、快捷键和阅读偏好也随工作区变化，旧面板优先读取自身恢复副本。
- 原因：个人偏好混入 workspaceState 会话，缺少用户级保存和配置变化同步；Webview getState 优先于新注入状态。
- 解决方案：将界面偏好独立保存到用户配置，统一 alwaygit.language；兼容迁移旧会话，仅在用户配置缺失时迁移。最新用户偏好覆盖恢复副本，应用确认成功后广播；未应用预览保留，取消恢复最新共享基线。会话仍负责布局、浏览位置和草稿恢复，旧会话保存不会回写用户配置。
- 验证方式：122 项定向会话、宿主、协议、快捷键、启动和 UI 状态回归及类型、双语检查通过；覆盖旧偏好迁移、多面板广播、旧会话不回写、预览取消与保存失败。未运行桌面集成测试。
- 相关文件：`src/protocol/interface-settings.ts`、`src/extension/workbench.ts`、`webview/rpc.ts`、`webview/store.ts`、`webview/SettingsDialog.tsx`、`package.json`、`tests/session-persistence.test.ts`、`tests/workbench-entry.test.ts`、`tests/ui-state.test.ts`。

## BUG-077：新窗口工作台显示被扩展启动和仓库扫描阻塞

- 日期：2026-10-04
- 状态：已解决
- 现象：点击新窗口打开后，VS Code 窗口已出现，但 AlwayGit 工作台需要等待较长时间才显示；已保存仓库较多或 Git 初始化较慢时等待进一步增加。
- 原因：空窗口依赖 onStartupFinished 激活；扩展注册命令和窗口通信前等待内置 Git，激活和工作台打开流程又等待仓库扫描；扫描逐个验证保存路径，面板创建被非界面工作阻塞。
- 解决方案：提前完成轻量激活及窗口注册，Git 路径按需解析并共用初始化；启动扫描在后台进行，面板先显示，仓库目录相关请求等待同一次扫描，已完成的首次扫描不因打开面板而重复执行。保留目录变化、显式刷新和失败重试。
- 验证方式：类型与双语资源检查、扩展构建通过；136 项定向无界面回归通过，覆盖慢 Git/扫描下的激活与面板显示、重复 Show、目录完整恢复、扫描失败重试、Git 路径初始化去重及显式路径优先、扫描协调、窗口通信、会话与 UI 状态，以及真实 Git 的暂存、内容读取、重命名、所选提交和未出生 Index 丢弃。未启动真实 VS Code 桌面验证，未测量实际窗口耗时，未打包或安装扩展。
- 相关文件：`package.json`、`src/extension/extension.ts`、`src/extension/workbench.ts`、`src/git/service.ts`、`tests/extension-startup.test.ts`、`tests/workbench-entry.test.ts`、`tests/git-runner.test.ts`、`docs/ARCHITECTURE.md`。

## BUG-076：切回仓库标签重复初始化并重新读取工作区 Diff

- 日期：2026-10-04
- 状态：已解决
- 现象：仓库工作台标签切走再切回来，即使仓库未变化也会重复加载；可见面板的焦点变化也触发相同刷新。
- 原因：面板状态事件只检查当前是否可见，每次都发送仓库目录变化和无范围的仓库变化通知；前端初始化和后台快照读取均设置 loading，无范围通知又使工作区 Diff 完整失效。
- 解决方案：只在隐藏到可见的转换时后台检查快照，未收到文件通知时使用空路径范围保留未变化的 History 和 Diff；宿主合并隐藏期间实际收到的目录及文件失效通知，恢复可见时一次补发，未知范围保持完整失效。已加载列表和仓库的后台读取保留现有内容与加载状态。
- 验证方式：96 项定向宿主、UI 状态及仓库操作生命周期回归通过，验证标签恢复、可见面板焦点切换、隐藏通知合并与未知范围、目录更新及仓库移除、多标签隔离，以及快照版本变化时保留选择、草稿、历史阅读位置和 Diff；类型及双语资源检查通过。未启动真实 VS Code 桌面验证，未打包或安装扩展。
- 相关文件：`src/extension/workbench.ts`、`webview/store.ts`、`tests/workbench-entry.test.ts`、`tests/ui-state.test.ts`、`docs/ARCHITECTURE.md`。

## BUG-075：批量分支及快照查询产生无上限的 Git 并发

- 日期：2026-10-04
- 状态：已解决
- 现象：批量删除 1,000 个分支会同时开始 1,000 个名称校验；多个嵌套 Tag 或 Remote 也可使快照查询瞬间启动大量 Git 子进程。
- 原因：使用 Promise.all 遍历可变数量的对象，且分支去重发生在校验之后。
- 解决方案：本地/远程分支在校验前去重，复用最多四路并发的 mapGitQueries；快照中的嵌套 Tag 解析及远端目标查询使用相同调度，保留输入顺序、引用身份和既有删除 lease 校验。
- 验证方式：类型检查通过；四路调度、本地/远程批量删除、快照解析 4 项定向回归通过，真实 Git 校验并发不超过 4、重复名称只校验一次、执行顺序及实际删除结果；快照夹具模拟逐层解引用输出，追加解析仍由真实 Git 执行，验证嵌套 Tag 的 Commit/原始对象身份和远端指纹。既有远端 lease 3 项安全回归通过。
- 相关文件：`src/git/service.ts`、`tests/git-history-scale.test.ts`、`docs/ARCHITECTURE.md`。

## BUG-074：丢弃确认未识别同一文件后续保存的内容

- 日期：2026-10-04
- 状态：已解决
- 现象：生成丢弃计划后再次保存同一文件，只要 Git 状态及暂存对象未变，旧计划仍可覆盖或删除后续内容。
- 原因：确认指纹只包含 HEAD、分支、路径状态和暂存区差异，没有绑定工作区内容。
- 解决方案：确认与执行复核所选路径的文件类型、权限、内容摘要和符号链接目标；普通文件使用固定大小缓冲区计算摘要，检测读取期间的文件替换或修改，不跟随链接读取外部内容。仍存在最终复核与 Git 命令之间的外部编辑竞态，不承诺文件系统原子事务。
- 验证方式：国际化及类型检查、真实 Git 丢弃定向回归 10 项通过，覆盖等长内容变化但状态不变、已跟踪/未跟踪、全部/未暂存、重新确认、未选文件保留、10,001 个已跟踪文件、暂存保留、嵌套仓库和未出生分支；临时 Windows junction 检查确认只绑定链接目标文本，外部目标内容变化不参与指纹。
- 相关文件：`src/git/service.ts`、`tests/git-discard.test.ts`、`docs/WORKBENCH_SPEC.md`。

## BUG-073：终端菜单缺少统一键盘导航与焦点恢复

- 日期：2026-10-04
- 状态：已解决
- 现象：Shell 选择和全部标签菜单打开后没有取得焦点，缺少方向键导航及关闭后的入口焦点恢复。
- 原因：底部面板自行实现菜单，未复用项目已有的菜单交互；Escape 同时会恢复最大化面板。
- 解决方案：复用 ContextMenu，支持按钮方向键打开、菜单焦点、上下方向键及 Home/End、Enter/Space 执行、Escape/Tab 关闭并恢复入口焦点；菜单放在入口上方，长标题通过悬浮提示显示全名与目录；菜单 Escape 不改变面板最大化状态，删除废弃菜单样式。
- 验证方式：国际化与类型检查、底部面板定向单测、生产构建和无头终端专项通过，覆盖菜单焦点与导航、关闭后焦点恢复、键盘选择标签、最大化状态保留，以及既有多终端、重命名、目录隔离、退出重启和关闭流程。未启动真实 VS Code 桌面验证。
- 相关文件：`webview/BottomDock.tsx`、`webview/ContextMenu.tsx`、`webview/dock.css`、`scripts/test-terminal-ui.mjs`。

## BUG-072：提交 Hook 可将未选文件带入所选文件提交

- 日期：2026-10-04
- 状态：已解决
- 现象：仅选择一个文件提交，pre-commit 若暂存其他文件，最终 Commit 也包含未选文件。
- 原因：独立 Index 只限制了初始清单，原生 Hook 执行后没有校验最终候选提交范围。
- 解决方案：临时委托原有 Hooks，在 reference-transaction 的 prepared 阶段投影并校验候选 Tree，范围外更改拒绝更新 HEAD，保留真实 Index；仍允许所选文件格式化、消息处理、签名和提交后 Hooks，不覆盖已有环境配置，不保证回滚 Hook 的磁盘副作用。
- 验证方式：真实 Git 所选提交回归通过，覆盖 pre-commit 扩大范围被拒绝、commit-msg 的迟到 Index 写入隔离、自定义中文及引号路径、消息 Hook、引用 Hook 参数与输入、提交后 Hook、环境配置、长路径、删除、重命名、未出生分支、Amend、linked worktree 和 split Index；国际化与类型检查通过。
- 相关文件：`src/git/selected-commit.ts`、`src/git/selected-commit-hooks.ts`、`src/git/service.ts`、`src/git/stash.ts`、`src/i18n/catalogs/commit.json`、`tests/selected-commit.test.ts`。

## BUG-071：大批量所选文件提交后暂存区回写失败

- 日期：2026-10-04
- 状态：已解决
- 现象：长路径或大量文件的提交已更新 HEAD，但回写真实 Index 时触发参数长度上限，返回部分失败并留下反向暂存差异。
- 原因：提交准备使用标准输入传递路径，末尾的 Reset 回写却把全部路径放入命令参数。
- 解决方案：Reset 的文件范围与 Add、Restore、Rm 一样使用 NUL 分隔的标准输入路径清单，保留删除和重命名源路径的重置语义。
- 验证方式：路径参数定向测试通过；真实 Git 验证超出参数预算的长文件名、删除、重命名、暂存回写及未选文件的暂存和磁盘内容保留。
- 相关文件：`src/git/arguments.ts`、`tests/git-arguments.test.ts`、`tests/selected-commit.test.ts`。

## BUG-070：删除重复面板按钮后标准检查被废弃翻译阻断

- 日期：2026-10-04
- 状态：已解决
- 现象：`npm run typecheck` 在国际化检查阶段因三条未使用资源失败。
- 原因：移除 Diff 展开/收起按钮和终端终止按钮时，没有同步删除翻译资源。
- 解决方案：删除三条废弃资源并重新生成国际化类型与字典。
- 验证方式：国际化资源检查和 TypeScript 无输出类型检查通过。
- 相关文件：`src/i18n/catalogs/diff.json`、`src/i18n/catalogs/dock.json`、`src/i18n/generated.ts`。

## BUG-069：浅色主题的终端彩色文字难以辨认

- 日期：2026-10-04
- 状态：已解决
- 现象：白色背景下 PowerShell 的黄色输入文字与背景过于接近；已有终端未完整跟随宿主主题变化。
- 原因：仅配置终端默认前景与背景，未配置 ANSI 普通/高亮色板；主题刷新未显式依赖实际主题及宿主主题属性变化。
- 解决方案：按工作台实际浅色/深色主题提供完整 16 色，使用解析后的 CSS 背景与前景；启用 4.5 最低文字对比度保护，补全光标/选区配色，并在宿主主题改变时更新现有终端，不重建 Shell。
- 验证方式：类型检查、终端色板定向单测通过；验证浅色预设的 16 色对比度、深色关键颜色、高对比度选区和宿主颜色保留。按本次范围未构建或执行浏览器/真实 VS Code 桌面验证。
- 相关文件：`webview/TerminalView.tsx`、`webview/terminal-theme.ts`、`webview/dock.css`、`tests/terminal-theme.test.ts`。

## BUG-068：大批量丢弃被路径数量上限拒绝且逐项扫描状态

- 日期：2026-10-04
- 状态：已解决
- 现象：一次丢弃超过 10,000 个文件时协议直接拒绝并显示原始校验错误；大批量路径逐项扫描整个 Status，确认框全量渲染路径。
- 原因：协议将单次文件数量作为硬上限；Discard 的路径分类与重命名关联采用嵌套扫描，确认和执行缺少固定范围的统一计划。
- 解决方案：取消文件操作的路径数量上限，保留路径合法性校验；丢弃预检生成短期绑定仓库的确认令牌，复核分支、目标清单和暂存对象后执行；全局丢弃由宿主列举范围，路径预览虚拟渲染；路径索引与预先划分的还原/清理批次支持单次操作、进度和失败后重新检查剩余范围。
- 验证方式：类型与协议检查、真实 Git Discard/参数边界与安全回归、无头 Files 专项；10,001 已跟踪文件加未跟踪文件验证暂存保留、进度、令牌隔离/重放/暂存变化及部分失败。
- 相关文件：`src/git/service.ts`、`src/protocol/types.ts`、`src/protocol/validation.ts`、`src/extension/workbench.ts`、`webview/DiscardDialog.tsx`、`webview/OperationProgress.tsx`、`tests/git-discard.test.ts`。

## BUG-067：大规模工作区文件列表全量渲染阻塞界面

- 日期：2026-10-03
- 状态：已解决
- 现象：数万文件的 Working Tree 切换、筛选和多选明显迟缓，折叠分组仍创建全部隐藏行。
- 原因：文件列表逐项创建 DOM；分组、筛选和选择派生值每次重算，选中状态逐行扫描选择数组。
- 解决方案：复用已有虚拟列表依赖，仅挂载视口附近的可变高度行；折叠卸载行，缓存分组、筛选与选择派生值，使用 Set/Map 判断选中状态及路径查找。
- 验证方式：类型检查、文件选择定向单元测试与无头 Files 专项；41,210 文件、82,420 逻辑行验证有限 DOM、跨视口全选、折叠和完整列表筛选。
- 相关文件：`webview/VirtualFileRows.tsx`、`webview/Details.tsx`、`webview/fileSelection.ts`、`webview/styles.css`、`scripts/test-files-ui.mjs`。

## BUG-066：Linux 测试忽略没有执行权限的 Git Hook

- 日期：2026-10-03
- 状态：已解决
- 现象：Release 工作流在 Ubuntu 上验证 Git Hook 拒绝提交时，提交反而成功并返回 `undefined`，导致单元测试失败且后续打包、发布被跳过；Windows 上同一用例通过。
- 原因：测试夹具只写入 `pre-commit` 脚本内容，没有设置 Unix 可执行权限；Git 在 Linux 上忽略不可执行的 Hook，因此拒绝与超时路径均未真正触发。
- 解决方案：为拒绝提交和模拟超时的 `pre-commit` 脚本显式设置 `0755` 权限，确保各平台测试的是相同行为。
- 验证方式：定向运行 Git 安全与有界执行用例，确认 Hook 拒绝信息、超时终止及输出上限检查均通过。
- 相关文件：`tests/git-service.test.ts`。

## BUG-065：Linux 发布验证错误地小写化区分大小写的仓库路径

- 日期：2026-10-03
- 状态：已解决
- 现象：Release 工作流在 Ubuntu 上运行仓库同步回归时失败，阻止 VSIX 打包与 GitHub Release 发布；同一用例在 Windows 上通过。
- 原因：测试断言无条件将预期的仓库公共目录转成小写，而生产代码只对 Windows 驱动器路径和 UNC 路径忽略大小写；GitHub Actions 工作目录中的 `AlwayGit` 大小写因此与错误的预期值不同。
- 解决方案：断言通过正式的仓库分组键函数生成预期值，与各平台的路径大小写语义保持一致。
- 验证方式：定向运行仓库同步竞态用例，确认目录排除项仍按正式分组键持久化且测试通过。
- 相关文件：`tests/repository-manager.test.ts`。

## BUG-064：图表范围变化缺少状态说明且新范围可能对应旧内容

- 日期：2026-10-03
- 状态：已解决
- 现象：加入或只显示标签后无法直接辨认正在浏览的范围；加载新范围期间继续显示旧提交，失败后仍可能将新筛选数量与旧内容并列。
- 原因：图表请求范围与已显示内容最初共用 checkedRefs，异步切换时缺少可靠的已显示范围；后续修复又把仓库、Checkout、选择、工作区数量和读取数量集中常驻展示，与工作台现有区域重复并挤压图表空间。
- 解决方案：继续独立保存已显示范围与请求范围，取消重复的常驻位置面板；加载与失败状态只在原有图表摘要行临时显示并提供重试。图表标题栏常驻返回入口；仅在存在搜索条件或范围不是当前分支时显示 target 图标，用于清除搜索、恢复当前分支并定位 HEAD。浏览记录按仓库隔离且有缓存上限；标签继续用眼睛和加载标记区分已显示范围与请求范围，失败后的新旧范围不得混合分页。
- 验证方式：定向 UI 状态回归覆盖延迟、失败、乱序响应及重复点击、读取取消、返回阅读位置、条件显示恢复入口和清除标签/搜索恢复实际分支；类型、双语资源和无头 History 专项检查通过。对 llvm-project 三个范围分别读取 300 条并布局，验证前后 HEAD、分支和 41210 个工作区变更保持一致。
- 相关文件：webview/store.ts、webview/History.tsx、webview/HistoryLocation.tsx、webview/styles.css、webview/Sidebar.tsx、webview/menus.ts、tests/ui-state.test.ts、scripts/test-history-ui.mjs、src/i18n/catalogs/history.json、src/i18n/catalogs/menus.json。

## BUG-063：切换分支期间工作台仍可交互

- 日期：2026-10-03
- 状态：已解决
- 现象：长时间 Checkout 仅显示进度条，背景仍可选择、打开菜单或切换仓库，容易误判操作状态并重复尝试。
- 原因：前端与宿主写互斥只保护 Git 请求，没有完整隔离鼠标、键盘焦点及背景界面。
- 解决方案：对改变工作区的操作使用前端居中不可关闭进度弹窗，背景包含已有对话框和菜单全部 inert；等待本地响应与刷新结束再解锁，失败后恢复原有处理入口；停止未确认时保留写保护但允许读取与诊断。
- 验证方式：类型及双语资源检查、UI 状态单测、无头反馈专项验证遮罩、无关闭按钮、背景 inert、Esc/Tab/刷新快捷键隔离与成功/冲突后解锁。
- 相关文件：`webview/OperationProgress.tsx`、`webview/actionFeedback.ts`、`webview/App.tsx`、`webview/store.ts`、`webview/styles.css`、`webview/ActionFeedbackBar.tsx`、`scripts/test-feedback-ui.mjs`、`tests/ui-state.test.ts`、`docs/WORKBENCH_SPEC.md`。

## BUG-062：侧栏同时保留多个互不相关的操作选择

- 日期：2026-10-03
- 状态：已解决
- 现象：单击 Repository 后再选择 Local Branch、Remote Branch 或 Worktree，Repository 的蓝色操作选择仍然保留；Local 与 Remote 分支却会互相取消，侧栏同时显示多个不能被同一命令使用的操作目标，容易与当前仓库和 Graph 勾选混淆。
- 原因：Repository、分支和 Worktree 分别使用 `selectedRepositoryKeys`、`selectedRefs` 与组件局部状态；各入口只更新自己的选择。Local 与 Remote 因共用 `selectedRefs` 而互斥，Repository 和 Worktree 则没有参与统一的作用域切换。
- 解决方案：将 Worktree 操作选择提升到统一状态层；Repository、分支或 Worktree 产生非空选择时同步清除另外两类侧栏操作选择，空选择只清除自身作用域。当前仓库、当前分支与 Graph `checkedRefs` 保持独立，不因操作作用域切换而改变。
- 验证方式：1207 条双语资源检查、类型检查、64 项 UI 状态单测和生产构建通过；无头 Workbench 与 Worktrees 专项通过，覆盖单击、右键、Ctrl/Cmd+A 在 Repository、Local、Remote、Worktree 间切换时只保留一个蓝色操作选择，并保留 Graph 勾选及当前状态。未运行全量测试、真实 VS Code 桌面集成、VSIX 打包或本机安装。
- 相关文件：`webview/store.ts`、`webview/Sidebar.tsx`、`tests/ui-state.test.ts`、`scripts/test-ui.mjs`、`scripts/test-worktrees-ui.mjs`、`docs/WORKBENCH_SPEC.md`、双语用户手册与验证文档。

## BUG-061：Reset 模式固定回到 Mixed 且无法保存默认值

- 日期：2026-10-03
- 状态：已解决
- 现象：每次打开 Reset 对话框都会重新选中 Mixed；设置中没有 Soft、Mixed、Hard 的默认模式，用户反复执行同类重置时必须重复切换。
- 原因：Reset 对话框把 `mode` 初始值硬编码为 `mixed`，高级 Git 操作设置也没有对应配置字段。
- 解决方案：新增 `alwaygit.defaultResetMode`，设置页提供 Soft、Mixed、Hard 选择；Reset 对话框读取已应用默认值，并允许通过“记住为默认”在提交本次操作前持久化。Hard 仍按破坏性操作显示警告与确认。
- 验证方式：协议限制默认值只能是 Soft、Mixed 或 Hard；设置状态测试覆盖读取、变更广播、保存失败不生效与成功持久化；类型检查验证 Reset 动作仍只接受三种模式。
- 相关文件：`package.json`、`src/protocol/types.ts`、`src/protocol/validation.ts`、`src/extension/workbench.ts`、`webview/ActionDialog.tsx`、`webview/SettingsDialog.tsx`、`webview/store.ts`、`tests/ui-state.test.ts`、`tests/workbench-protocol.test.ts`。

## BUG-060：分支 Push 可能被 Git 配置隐式附带 Tag

- 日期：2026-10-03
- 状态：已解决
- 现象：界面只显示明确的本地分支到远端分支映射，但当仓库或用户启用 `push.followTags=true` 时，普通 Push 仍可能同时发布相关注解 Tag。
- 原因：分支 Push 虽然使用完整分支 refspec，却没有显式传递 `--no-follow-tags`，因此继承了 Git 的隐式 Tag 策略。
- 解决方案：Push 动作增加明确的 `followTags` 参数；关闭时固定传递 `--no-follow-tags`，开启时使用 `--follow-tags`。设置页提供安全默认值，Push 对话框允许单次覆盖并通过“记住为默认”明确持久化。
- 验证方式：真实临时远端在 `push.followTags=true` 下验证默认分支 Push 不发送任何 Tag；显式开启后只发送相关注解 Tag，不发送轻量 Tag。协议、设置状态与双语资源检查覆盖默认值和持久化。
- 相关文件：`src/git/service.ts`、`src/protocol/types.ts`、`src/protocol/validation.ts`、`src/extension/workbench.ts`、`webview/ActionDialog.tsx`、`webview/SettingsDialog.tsx`、`webview/store.ts`、`tests/git-safety.test.ts`。

## BUG-059：多选 Tag 被误当作远端分支

- 日期：2026-10-03
- 状态：已解决
- 现象：同时选择多个 Tag 后打开右键菜单，会出现远端分支删除和复制分支名称等错误操作；混合选择 Tag 与分支也沿用分支菜单。
- 原因：批量引用菜单只区分“全部本地分支”和“其他引用”，所有 Tag 与混合引用都会落入远端分支逻辑。
- 解决方案：批量菜单分别识别本地分支、远端分支、Tag 与混合引用；Tag 和混合引用只提供适用的图形查看及名称复制操作，不再生成分支删除或跟踪动作。
- 验证方式：UI 状态单元测试覆盖多 Tag 与 Tag/分支混合选择，确认不会出现分支删除操作，并显示正确的复制名称文案。
- 相关文件：`webview/menus.ts`、`src/i18n/catalogs/menus.json`、`tests/ui-state.test.ts`。

## BUG-058：历史提交右键入口未表达 Detached HEAD 禁用策略

- 日期：2026-10-03
- 状态：已解决
- 现象：高级开关关闭时，历史 Commit 菜单仍显示可点击的“切换到此提交（Detached HEAD）”，点击却进入创建分支流程；目标存在本地分支时也借用相同文案，菜单与操作含义不一致。
- 原因：Commit 主菜单没有依据目标本地分支及 Detached HEAD 开关计算名称和禁用状态，只有额外的直接切换入口检查开关。
- 解决方案：没有本地分支直接指向时，直接 Detached Checkout 按策略置灰并说明原因，邻接提供创建并切换分支；开启后该项明确执行直接 Checkout。Commit 顶端的本地分支切换显示名称或选择分支，保留当前分支和 Worktree 占用保护；Tag 同步显示被策略禁用的入口，继续保留后端拦截。
- 验证方式：62 项 UI 状态单元测试、TypeScript 类型检查和 1172 条双语资源检查通过；无头 History 专项通过，覆盖置灰原因、键盘跳过、创建分支入口和开关开启后的直接切换；0.38.1 构建打包通过。
- 相关文件：`webview/menus.ts`、`src/i18n/catalogs/menus.json`、`tests/ui-state.test.ts`、`scripts/test-history-ui.mjs`、`scripts/test-ui.mjs`、工作台规格与用户手册。

## BUG-057：Cherry-pick 普通入口允许重复应用当前分支已有提交

- 日期：2026-10-03
- 状态：已解决
- 现象：在 main 上右键当前 HEAD 或当前分支已有提交时，Cherry-pick to main 仍可点击，执行后才报告失败，可能留下需要处理的 Git 操作状态。
- 原因：Commit 菜单只检查本地分支、活动操作和 Merge Commit，没有查询真实祖先关系；执行入口也没有重复应用预检。
- 解决方案：菜单用独立可取消查询检查完整 Git 历史，当前 HEAD 即时禁用；已有提交、混合多选、检查中和查询失败时禁用普通入口。保留带勾选确认的历史重新应用，禁止当前 HEAD 自应用；宿主在任何写入前预检全部选择并复核目标上下文，保持 Revert 原有行为。
- 验证方式：双语资源检查、类型检查、84 项定向单元测试、生产构建和 Cherry-pick 无头界面专项通过。真实临时仓库覆盖 HEAD、历史祖先、Merge 纳入的提交、批量预检无部分写入、其他分支独有提交、Revert 后明确重新应用、目标 HEAD/分支变化和 Detached HEAD；界面覆盖查询期间/失败禁用、过期响应取消、确认前禁止提交、编辑后重新确认与对话框目标绑定。未启动真实 VS Code 桌面集成测试。
- 相关文件：`src/git/service.ts`、`src/protocol/types.ts`、`src/protocol/validation.ts`、`src/protocol/queries.ts`、`src/extension/workbench.ts`、`webview/useCherryPickCheck.ts`、`webview/menus.ts`、`webview/App.tsx`、`webview/ActionDialog.tsx`、`webview/demo.ts`、`src/i18n/catalogs/`、相关测试和工作台规格、用户手册。

## BUG-056：定位 HEAD 无条件清空并重载 Graph

- 日期：2026-10-03
- 状态：已解决
- 现象：HEAD 已在加载的提交列表中时，点击工具栏定位图标仍清空 Graph 并显示正在读取历史，丢失已加载分页和当前搜索。
- 原因：定位入口无条件重置提交列表、分页和筛选后调用 History 查询，未区分定位已有节点与读取缺失节点；只读首屏也不能保证较旧 HEAD 可见。
- 解决方案：已加载 HEAD 只更新选择和滚动定位令牌，保留提交、引用、搜索和分页；缺失 HEAD 时恢复必要引用、清除阻挡的搜索并复用有界跨页定位，同一历史的未加载 HEAD 继续追加分页。
- 验证方式：类型检查、状态与历史项两文件 60 项单元测试、无头 History 专项通过；覆盖重复定位、筛选保持、HEAD 被筛除、Detached HEAD 和分页追加。受控宿主以 150 条提交验证两次滚动定位较旧 HEAD，Graph 数量始终保留，不重读 Snapshot/History、不显示空列表或加载状态；未启动真实 VS Code 桌面集成。
- 相关文件：`webview/store.ts`、`tests/ui-state.test.ts`、`scripts/test-history-ui.mjs`、`scripts/test-ui.mjs`、`docs/WORKBENCH_SPEC.md`。

## BUG-055：Stash 预检隐藏底层诊断并将涉及文件误作冲突路径

- 日期：2026-10-03
- 状态：已解决
- 现象：恢复因无关的新增暂存文件受阻，Git 实际指向 staged-only.txt 并报告 Index was not unstashed，Git details 与 Show Log 却只显示通用摘要；路径列表显示存档涉及的文件。对应 0.29.0 报告 B02，现场与 Stash 保留保护有效。
- 原因：隔离命令静默运行；结构化 output 未用于前端详情或 RPC 日志。失败分类依赖错误文字，未区分实际 unmerged 路径与 affected 回退清单。
- 解决方案：RPC 统一脱敏结构化输出，详情与日志使用同一份诊断；仅实际 unmerged 路径判为已确认冲突，其余阻碍列为恢复涉及文件。保留全部恢复预检与现场保护，不自动清理其他修改。
- 验证方式：类型检查、Stash 状态/日志/宿主入口/Demo 四文件 34 项回归与无头 Stash 专项通过；真实 Git 覆盖新增暂存文件引起的 Index 阻碍及实际冲突路径，保留 HEAD、Index、文件与存档。消息桥检查详情和日志使用相同脱敏输出；界面检查具体错误、日志入口和路径分组。真实 VS Code 桌面集成未运行。
- 相关文件：`src/git/stash.ts`、`src/protocol/types.ts`、`src/application/logging.ts`、`src/extension/workbench.ts`、`webview/ActionDialog.tsx`、`tests/stash-state.test.ts`、`tests/logging.test.ts`、`tests/workbench-entry.test.ts`、`scripts/test-stash-ui.mjs`、`docs/WORKBENCH_SPEC.md`。

## BUG-054：Commit 与 Amend 成功反馈可能引用另一轮刷新结果

- 日期：2026-10-03
- 状态：已解决
- 现象：提交后的历史加载等待期间，后台刷新带来另一 HEAD；成功提示、剩余数量及 View Commit 随后使用后台现场。切换仓库后完成的提交还可能缺失结果摘要。对应 0.29.0 报告 B01；0.30 的快照失效保护已改善旧请求覆盖，但未固定反馈身份。
- 原因：操作已经返回 Snapshot，反馈仍在刷新完成后读取可变的全局 Snapshot。
- 解决方案：收到操作响应时按仓库身份固定提交 OID、剩余数量与 Amend 标志，立即保存反馈；历史刷新和仓库切换只更新视图。缺少权威响应时保留通用成功提示，不推测提交身份。Demo 与受控宿主同步返回操作快照。
- 验证方式：类型检查、状态与 Demo 两文件 55 项回归通过，覆盖普通提交、Amend、刷新交叠、历史读取失败、仓库切换和详情目标；真实 VS Code 桌面集成未运行。
- 相关文件：`webview/store.ts`、`webview/demo.ts`、`tests/ui-state.test.ts`、`scripts/test-feedback-ui.mjs`。

## BUG-052：按名称删除 Tag 可能删除确认后替换的引用

- 日期：2026-10-03
- 状态：已解决
- 现象：Tag 在对话框等待期间被重建后仍可能删除；注解 Tag 即使指向同一 Commit，注解对象也可能已变化。
- 原因：删除只携带名称，Snapshot 的 oid 是 peeled Commit，未保留原始引用身份。
- 解决方案：Snapshot 提供 refOid，菜单与对话框捕获原始身份；宿主预检并使用 update-ref 的旧 OID 原子校验删除，拒绝缺失和陈旧身份；不解引用符号 Tag。
- 验证方式：类型检查通过；四文件 Tag 定向 7 项测试通过，覆盖注解 Tag 同 Commit 重建、轻量 Tag 移动、缺失/zero/peeled 身份、预检后的删除竞态以及正常删除。
- 相关文件：`src/git/service.ts`、`src/protocol/types.ts`、`src/protocol/validation.ts`、`webview/ActionDialog.tsx`、`webview/menus.ts`、`webview/demo.ts`、`tests/git-tag-delete.test.ts`、对应协议与菜单测试。

## BUG-053：网络超时层不一致且结束的命令可留下凭据输入框

- 日期：2026-10-03
- 状态：已解决
- 现象：网络命令套用 60 秒查询时限，前端又在 180 秒自行失败；命令停止或 AskPass 断开后，原生凭据输入仍可能等待。
- 原因：读取与网络写入共用预算，前端独立计时；输入框缺少与命令和连接生命周期关联的取消信号。
- 解决方案：网络命令默认 10 分钟，action 等待宿主结果；停止命令即取消输入，断开连接取消对应输入。取消输入与桥资源释放分离，保留原有终止确认及写隔离边界。
- 验证方式：类型检查通过，Git runner、真实 AskPass 和 RPC 三文件 20 项测试通过；覆盖超出 60/180 秒、宿主 10 分钟停止、立即取消输入及延迟资源释放。未弹出原生 VS Code 输入框。
- 相关文件：`src/git/service.ts`、`src/git/runner.ts`、`src/application/credentials.ts`、`src/extension/extension.ts`、`src/extension/askpass.cjs`、`webview/rpc.ts`、对应回归测试。

## BUG-050：交错目录修改与多窗口缓存可覆盖仓库分组及顺序

- 日期：2026-10-03
- 状态：已解决
- 现象：移除操作等待保存时，另一个移动已成功却被旧归属覆盖；跨窗口陈旧缓存可丢失添加、删除或排序。
- 原因：多个 Memento 键分别读改写，宿主缓存无法提供跨窗口权威事务；扫描和监听发布也可能交错。
- 解决方案：改为带 schema/revision 的共享 JSON，OS 短互斥下重读并原子替换；同宿主 FIFO 串行预备、提交与发布，镜像在锁外；复合添加一次提交，过期扫描重新读取，旧工作区逐一迁移。
- 验证方式：相关 39 项测试及后续受影响复合添加、宿主入口 7 项通过，覆盖独立 Store 争用、陈旧缓存、磁盘写失败、镜像失败与监听顺序；最终集成类型检查通过。未启动实际多 VS Code 窗口。
- 相关文件：`src/repositories/catalog-store.ts`、`src/repositories/manager.ts`、`src/extension/workbench.ts`、`tests/repository-catalog.test.ts`、`tests/repository-manager.test.ts`、`tests/repository-watch.test.ts`。

## BUG-051：Reset、Merge 和 Rebase 确认后可能作用于已改变的分支

- 日期：2026-10-03
- 状态：已解决
- 现象：对话框打开或原生确认等待期间切换分支、移动 HEAD 或目标引用，执行仍可能作用于新的现场或引用。
- 原因：请求仅携带目标名称，没有绑定确认时的分支、HEAD 和固定目标。
- 解决方案：对话框固定打开时的分支与 HEAD 并显示其身份，RPC 要求该上下文；确认前解析固定 Commit，写队列中重新校验现场，变化或缺失上下文拒绝操作；Reset 原生确认展示分支、HEAD 和目标。
- 验证方式：类型检查通过；相关四文件 46 项检查通过（其中修正旧测试调用后定向重跑 4 项），另通过 Checkout 冲突保护 1 项及无头 feedback 专项（含三种对话框刷新后仍提交原分支与 HEAD）；真实 Git 覆盖三种操作期间分支切换、目标移动及 HEAD 变化。
- 相关文件：`src/git/service.ts`、`src/protocol/types.ts`、`src/protocol/validation.ts`、`src/extension/workbench.ts`、`src/application/confirm.ts`、`webview/ActionDialog.tsx`、对应回归测试。

## BUG-049：忽略的属性文件缺失使所选 Stash 保存错误编码并阻止恢复

- 日期：2026-10-03
- 状态：已解决
- 现象：工作区中被 ignore 的 `.gitattributes` 设置文件编码后，所选文件 Stash 的 Git blob 可能错误保存原始工作编码；清理现场后 Apply 自己的 Stash 被阻止。
- 原因：隔离快照通过排除 ignore 的文件枚举复制属性上下文，只单独捕获 system、global 和 info 属性，漏掉有效的工作区属性文件。
- 解决方案：独立捕获整个隔离现场涉及路径的根与祖先目录属性文件，存在或缺失均进入现场指纹；沙箱复制原字节，属性变动阻止清理。属性叶节点链接与父目录链接保持拒绝跟随保护。
- 验证方式：Stash 状态 20 项真实 Git 检查通过，覆盖 info、忽略的根及祖先属性的 UTF-16 工作字节与 UTF-8 blob 往返，属性创建、删除和变化时现场保留，以及属性链接保护。
- 相关文件：`src/git/stash.ts`、`tests/stash-state.test.ts`、`docs/ARCHITECTURE.md`。

## BUG-048：远程跟踪分支创建失败可能提前改动 Index 和工作文件

- 日期：2026-10-03
- 状态：已解决
- 现象：远程分支创建并切换在预检后遭遇外部引用层级冲突时报告失败，HEAD 仍在原分支，但 Index 和工作文件可能已经载入目标提交。
- 原因：远程跟踪入口仍使用 `switch -c --track`，引用创建失败前 Git 已可能更新文件；普通分支创建的引用先行保护没有覆盖该入口。
- 解决方案：固定已验证的源 OID，先创建引用并设置 upstream，再执行普通 Checkout；引用或 upstream 失败不进入 Stash。Checkout 失败保留已创建分支，反馈创建结果，并保持原来源和 Stash 重试信息。
- 验证方式：远程跟踪相关 6 项真实 Git 检查通过，覆盖外部引用层级冲突时 HEAD、Index、文件和 Stash 不变，源引用推进仍使用固定起点，upstream 失败保留分支，以及脏文件阻塞后的 Stash 重试。
- 相关文件：`src/git/service.ts`、`tests/git-safety.test.ts`、`docs/ARCHITECTURE.md`。

## BUG-047：重新激活旧标签会回退其他标签较新的恢复草稿

- 日期：2026-10-03
- 状态：已解决
- 现象：一个标签更新草稿后，激活一直未编辑的旧标签或空白标签，会将其旧草稿集合写回宿主；随后新建标签可能恢复旧内容。
- 原因：活动标签保存整份会话，空白标签只保留旧 repoId，未区分本标签实际改动和其他标签已经更新的仓库字段。
- 解决方案：各标签记录最后成功保存的自身基线，排队执行时读取最新宿主基线，仅合并本标签实际改动的草稿和视图。空白标签保留既有仓库、草稿和视图；主动清空草稿仍作为有效修改保存。
- 验证方式：会话持久化 4 项与入口 8 项相关检查通过；覆盖交叠排队写入、旧标签重新激活、空白标签、其他仓库最新字段保留与清空草稿；类型检查通过。旧入口夹具补齐配置事件和工作区状态接口后，仅重跑两个受影响场景。
- 相关文件：`src/application/session-persistence.ts`、`src/extension/workbench.ts`、`tests/session-persistence.test.ts`、`tests/workbench-entry.test.ts`。

## BUG-046：失效前开始的旧快照可能覆盖写操作后的状态

- 日期：2026-10-03
- 状态：已解决
- 现象：轮询在写操作前读取旧 Status，其他子查询较慢而在新快照后完成；旧内容取得更大的完成版本并覆盖界面。
- 原因：快照失效只删除在途查询入口，没有阻止旧 Promise 的结果继续发布；完成版本不代表内容采集顺序。
- 解决方案：协调器按工作目录维护失效代数，过时结果与过时异常均转向当前代读取，避免旧状态发布；工作台关闭时结束等待并清理协调器。
- 验证方式：快照协调与宿主生命周期 9 项相关回归通过；覆盖旧版本号更大仍不得覆盖、连续失效及旧错误、Worktree 隔离、关闭前未开始读取不启动 Git，类型检查通过。
- 相关文件：`src/application/snapshot-coordinator.ts`、`src/extension/workbench.ts`、`tests/snapshot-coordinator.test.ts`。

## BUG-045：长说明和大批量目标超过命令行长度边界

- 日期：2026-10-03
- 状态：已解决
- 现象：协议允许的长说明、批量文件路径或历史引用直接拼入 Git 参数，可能超过 Windows 命令行长度，操作在启动阶段失败；分批清理也需要明确说明已经完成的范围。
- 原因：消息和路径没有区分可通过标准输入传递的命令，缺少统一参数预算与清理分批预检。
- 解决方案：Commit/Tag 消息使用标准输入，Add/Restore/Rm 使用 NUL 分隔的 pathspec 标准输入，历史查询把已解析的 Commit ID 通过标准输入传入；Clean 在执行前确定全部批次并检查预算，失败报告已经完成的批次。其他超长参数在启动前明确拒绝，Stash 消息在可能修改现场前检查，消息中的 NUL 字符拒绝执行。
- 验证方式：长 Unicode 消息、大于原 Windows 参数上限的文件集合、部分 Clean 失败与残留状态的真实 Git 回归，以及相关 runner 和 Stash 定向检查通过；310 个真实分支的历史读取、固定分页、HEAD、推送标记及嵌套 Tag 回归通过。
- 相关文件：`src/git/arguments.ts`、`src/git/service.ts`、`src/git/query-map.ts`、`tests/git-arguments.test.ts`、`tests/git-history-scale.test.ts`。

## BUG-044：工作区符号链接 Diff 读取目标文件内容

- 日期：2026-10-03
- 状态：已解决
- 现象：Git 中记录为符号链接的文件，工作区侧 Diff 读取了链接目标的文件内容；外部链接还会被当作越界文件而无法比较。
- 原因：工作区 Diff 与普通打开文件共用跟随叶节点的路径处理，未区分 Git 保存的链接文本语义。
- 解决方案：验证父目录仍在仓库内，使用 lstat/readlink 将叶节点符号链接呈现为只读链接文本；普通文件继续检查真实路径，普通打开操作保持原越界保护。
- 验证方式：类型检查及编辑器文档、路径共 13 项回归通过；覆盖指向仓库外的链接 Diff、链接文本、原有普通文件行为与越界打开拒绝。
- 相关文件：`src/editor/documents.ts`、`src/editor/paths.ts`、`tests/documents.test.ts`。

## BUG-043：共享 Git 监听误刷新其他 Worktree 且扫描可恢复已移除仓库

- 日期：2026-10-03
- 状态：已解决
- 现象：一个 Worktree 修改 Index 会触发同仓库其他 Worktree 的 Index 刷新；重叠目录扫描可能重复发现，或把扫描期间移除的仓库重新注册。
- 原因：每个工作目录重复监听整个 commonDir，私有元数据未按 gitDir 分流；异步扫描没有共享任务、失效代数或移除标记。
- 解决方案：同 commonDir 共用引用计数监听，refs 广播，HEAD、Index 和操作元数据只通知所属工作目录；扫描共用任务，目录变化废弃旧结果并重新读取，移除立即记录标记。
- 验证方式：类型检查通过；仓库管理与监听共 31 项相关回归通过，覆盖共享监听释放、私有事件、路径重新绑定、交叠扫描、移除和新增并发。
- 相关文件：`src/repositories/manager.ts`、`src/git/service.ts`、`src/protocol/types.ts`、`tests/repository-watch.test.ts`、`tests/repository-manager.test.ts`。

## BUG-042：远端删除与强推未绑定确认时的远端版本

- 日期：2026-10-03
- 状态：已解决
- 现象：打开确认后，其他客户端推进远端分支或后台 Fetch 更新本地跟踪引用，删除和强推仍可能覆盖用户未确认的新状态。
- 原因：删除仅核对本地跟踪引用，强推使用随 Fetch 变化的隐式 lease；远端 Push 地址改变也没有重新确认。
- 解决方案：确认时固定目标 OID 与 Push 地址指纹，执行时使用显式 `--force-with-lease=<ref>:<oid>`；空 OID 只允许仍不存在的分支，地址变化或多个 Push 地址拒绝危险操作；输入空白或重新选中同一目标不更新确认版本。批量删除保留逐项结果，进程终止未确认立即上抛。
- 验证方式：两个本地 Clone 与 Bare 远端回归覆盖并发推进、后台 Fetch、并发创建、部分删除失败、地址改变与多 Push 地址；协议、既有 Push/Pull/Upstream 定向检查和类型检查通过；额外回归验证规范化目标不变时仍保留旧确认。
- 相关文件：`src/git/service.ts`、`src/protocol/types.ts`、`src/protocol/validation.ts`、`webview/remoteLease.ts`、`webview/ActionDialog.tsx`、`webview/menus.ts`、`tests/git-remote-lease.test.ts`、`tests/git-service.test.ts`。

## BUG-041：会话恢复基线保存失败无法反馈且重复全量发送

- 日期：2026-10-03
- 状态：已解决
- 现象：宿主保存被拒绝或失败后，前端仍将已发送状态当成保存完成；新标签可能使用旧恢复基线，高频界面变化反复整理会话。
- 原因：保存绕过 RPC 响应表，在确认前更新去重标志；全 Store 订阅与多个标签写入没有独立协调。
- 解决方案：共享会话 Schema 和类型，本标签立即保存；宿主请求采用确认、短防抖、串行最新待写及两次有限重试，失败明确提示。只订阅持久字段，宿主串行写基线，非活动标签保留自己的状态，重新激活时保存其最新基线；不删除草稿。
- 验证方式：会话持久化 3 项、状态 45 项、RPC/宿主协议 7 项回归及类型检查通过，覆盖迟到确认、连续更新、写失败重试和失败后继续保存。
- 相关文件：`src/protocol/session.ts`、`src/protocol/validation.ts`、`src/application/session-persistence.ts`、`src/extension/workbench.ts`、`webview/session-persistence.ts`、`webview/rpc.ts`、`webview/store.ts`、`tests/session-persistence.test.ts`。

## BUG-040：跨窗口忙碌状态与写保护无法可靠恢复

- 日期：2026-10-03
- 状态：已解决
- 现象：丢失结束通知后，其他窗口持续显示忙碌；广播读取失败可能绕过租约释放；宿主退出后不能据此确认 Git 子进程已经结束。
- 原因：忙碌状态仅依赖边沿事件，广播与租约清理缺少独立异常边界，文件没有实际操作进行中的持久标记。
- 解决方案：行动前与轮询核对实际租约，并避免旧查询清除新活动；广播失败仅记录、租约释放后再通知结束。执行前原子保存运行标记，无法确认终止时持久隔离；死亡持有者须经用户确认且通过锁身份及进程检查才能解除，本次请求不重放写操作。
- 验证方式：7 项锁与 5 项生命周期回归通过，覆盖漏通知、旧活动查询、广播失败、崩溃保护、活持有者不可恢复、旧 token 不得删新锁，以及确认恢复后必须重试。
- 相关文件：`src/application/operation-lock.ts`、`src/extension/project-windows.ts`、`src/extension/workbench.ts`、`tests/operation-lock.test.ts`、`tests/repository-operation-lifecycle.test.ts`。

## BUG-039：Git 停止请求提前结束写操作并释放认证资源

- 日期：2026-10-03
- 状态：已解决
- 现象：超时或输出超限时，终止进程树仍在执行或失败，原逻辑已结束写队列，后续写操作可能与旧 Git 或 Hook 重叠。
- 原因：停止请求被当作进程已结束，未等待 Git close 与 taskkill close，也未处理终止器非零退出；批量操作的局部 catch 还可能包装隔离错误并继续下一条写命令。
- 解决方案：提取进程 runner，等待已知进程与终止器关闭；支持 AbortSignal。5 秒终止宽限后无法确认写命令停止时明确报错并隔离该公共仓库，认证资源延迟至已知句柄关闭才释放。run 和 execute 统一保留隔离标记并禁止后续写入；纯读取消保留错误与清理句柄，不隔离写操作，只读请求作用域拒绝运行写命令。
- 验证方式：类型检查、8 项 runner 回归、真实 Git 超时/输出限额及既有写队列定向回归通过；覆盖包装错误、批量后续命令拒绝、只读取消与写入隔离、close 前不释放认证，避免把根进程退出当作整个进程树已结束。
- 相关文件：`src/git/service.ts`、`src/git/runner.ts`、`src/git/error.ts`、`src/git/command-kind.ts`、`tests/git-runner.test.ts`、`tests/git-service.test.ts`。

## BUG-038：过期文件租约恢复可能误删新持有者的写锁

- 日期：2026-10-03
- 状态：已解决
- 现象：多个窗口同时恢复过期锁时，后一个恢复者可能删除刚创建的新锁；心跳停顿还可能把活操作判为过期。
- 原因：读取时间戳、删除与重新创建之间没有互斥，续期也没有验证持有者。
- 解决方案：使用 OS 管理的本机端口存活租约，目录级短时互斥事务串行执行恢复、创建和释放；新租约不依赖 TTL。未知端点、超时及互斥门不可用时保守拒绝，旧格式仅按原过期规则兼容迁移。
- 验证方式：5 项租约回归及类型检查通过；真实子进程退出后 8 个争抢者仅一人成功，活持有者即使旧 mtime 仍拒绝抢锁。
- 相关文件：`src/application/operation-lock.ts`、`tests/operation-lock.test.ts`。

## BUG-037：重叠仓库目录刷新可覆盖新目录与活动选择

- 日期：2026-10-03
- 状态：已解决
- 现象：两个目录初始化请求交叠时，旧响应可覆盖新目录、误清除活动仓库；旧请求也会提前清除新请求的 Loading。
- 原因：目录初始化没有请求代数，成功、错误和 finally 均无条件更新 Store。
- 解决方案：目录请求采用独立代数，仅最新请求提交目录、分组、顺序及加载状态；目录和失效选择一次更新，移除时清理过期 Stash 与操作审阅。
- 验证方式：状态模块 45 项定向回归通过，新增可控延迟用例覆盖旧响应晚到及旧请求先结束时的新请求 Loading。
- 相关文件：`webview/store.ts`、`tests/ui-state.test.ts`。

## BUG-036：取消 Amend 后迟到详情仍填入提交草稿

- 日期：2026-10-03
- 状态：已解决
- 现象：空草稿勾选 Amend 后立即取消，尚未返回的 HEAD 详情仍可能填入普通 Commit 草稿。
- 原因：回调只检查仓库与草稿为空，没有关联 Amend 意图、HEAD 或组件生命周期。
- 解决方案：详情请求绑定仓库、HEAD 与请求代数，取消、依赖变化及卸载使旧请求失效；只填充仍为空的当前草稿，忽略过期错误。
- 验证方式：Webview 构建和无头 Files 专项通过，验证取消后旧响应不写草稿、加载期间用户新输入不被覆盖；同步修正专项中未包含已有 Stash 操作的旧菜单预期。
- 相关文件：`webview/Details.tsx`、`scripts/test-files-ui.mjs`。

## BUG-035：Diff 加载关闭 Graph 菜单且面板更新范围过大

- 日期：2026-10-02
- 状态：已解决
- 现象：在 Graph 中打开提交右键菜单后，底部 Diff 延迟加载并自动定位会关闭菜单；主要面板全量订阅工作台状态，无关字段更新也触发计算，Stage/Unstage 成功后还强制重读 History。
- 原因：菜单在窗口捕获所有滚动事件，没有区分来源区域；面板直接调用全量 Store，父组件向面板传递新回调；快照、引用选择和仓库摘要每次重建，刷新调用主动 Working Tree 选择逻辑，操作成功走手动刷新路径。
- 解决方案：菜单保存来源元素，仅来源及祖先滚动关闭；面板按字段浅比较订阅，稳定父层回调并使用 memo，快照未变化字段及选择/摘要复用引用。工作区刷新只协调比较目标，不重新选择区域；空工作区也清理从会话恢复的失效文件选择。操作后按所选引用、HEAD 与远端引用变化失效历史，手动刷新仍强制查询。
- 验证方式：类型检查、生产构建、状态/历史项/Diff 导航单测 47 项通过；刷新、History、文件和 Diff 四个无头专项通过。回归复现 600 ms 延迟预览自动定位第 150 行后菜单保留，其他区域滚动不关闭，来源滚动/Escape/点击外部正常关闭；验证暂存后不重读历史、未勾选远端移动和 HEAD 变化更新历史、Parent/文件/滚动及多选保持。未启动真实 VS Code 桌面集成测试。
- 相关文件：`webview/ContextMenu.tsx`、`webview/subscriptions.ts`、`webview/App.tsx`、`webview/History.tsx`、`webview/Sidebar.tsx`、`webview/Details.tsx`、`webview/DiffPreview.tsx`、`webview/store.ts`、`webview/refresh.ts`、`tests/ui-state.test.ts`、`scripts/test-refresh-ui.mjs`、`scripts/test-ui.mjs`、`docs/ARCHITECTURE.md`。

## BUG-034：创建分支未阻止已有名称与路径冲突，失败可能改动工作区

- 日期：2026-10-02
- 状态：已解决
- 现象：已有 `test/b1` 时，Create Branch 仍允许输入 `test` 并提交；创建报引用锁冲突。在从旧 Commit 创建并切换时，即使分支创建失败，当前分支和 HEAD 未变，Index 与 Working Tree 也可能被切到旧版本，出现额外修改和删除。
- 原因：普通创建流程只有名称格式校验，未复用远程转本地流程的命名空间冲突检查；`git switch -c` 可能先更新文件再因分支引用冲突失败。
- 解决方案：前后端共享同名与双向斜杠路径冲突规则；前端实时提示具体分支并禁用两个创建按钮，提交路径再次拦截；后端在写操作队列内重读所有本地引用，覆盖 packed refs 和过期界面状态。先仅创建分支引用，再执行已有分支 Checkout，防止外部创建竞态导致文件提前切换；后续 Checkout 受阻时保留分支并明确提示已创建、尚未切换。
- 验证方式：名称校验和真实 Git 安全回归 26 项、正常分支创建与远端 upstream 回归 2 项、类型检查与生产构建通过；无头分支弹窗及远程跟踪专项通过。验证同名、双向路径冲突、packed refs、过期快照、干净及含暂存/未暂存/未跟踪修改时 HEAD、引用、Index 和文件内容不变，外部创建竞态不触及文件，Checkout 受阻保留分支且可通过 Stash & Checkout 重试；两个按钮及直接表单提交均拦截非法名称，合法相邻名称和仅有远程引用的名称恢复可用。未启动真实 VS Code 桌面集成测试。
- 相关文件：`src/protocol/ref-name.ts`、`src/protocol/types.ts`、`src/git/service.ts`、`webview/ActionDialog.tsx`、`webview/App.tsx`、`webview/remoteTracking.ts`、`webview/rpc.ts`、`tests/ref-name.test.ts`、`tests/git-safety.test.ts`、`scripts/test-branch-ui.mjs`、`scripts/test-ui.mjs`、`docs/WORKBENCH_SPEC.md`。

## BUG-033：Commit 搜索结果的 Graph 累积悬空轨道

- 日期：2026-10-02
- 状态：已解决
- 现象：搜索 `chore` 等 Commit 信息后，Graph 出现不断增加的彩色竖线，挤占信息列并使同一条历史看起来像许多独立分支。
- 原因：搜索只返回匹配提交，但前端继续用真实父提交绘制完整拓扑；被过滤的父提交无法消费待连接轨道，造成悬空线路持续累积。
- 解决方案：搜索模式隐藏整个 Graph 列并跳过布局，释放宽度给信息列；用独立圆点保留推送状态，显示匹配数量，单选结果后提供完整历史定位。搜索切换清除旧结果，避免完整历史加载前短暂绘制筛选后的拓扑；清空搜索恢复原 Graph 列宽。
- 验证方式：类型检查、History 状态和视图模型单测 38 项、生产构建与无头 History 专项通过；覆盖整列隐藏、状态与徽标保留、信息列扩宽、清空恢复、空结果、跨页定位和新搜索取消旧定位。未启动真实 VS Code 桌面集成测试。
- 相关文件：`webview/History.tsx`、`webview/store.ts`、`webview/styles.css`、`tests/ui-state.test.ts`、`scripts/test-history-ui.mjs`、`scripts/test-ui.mjs`、`docs/WORKBENCH_SPEC.md`。

## BUG-032：增加 Diff 行高时阅读位置被旧内容高度截断

- 日期：2026-10-02
- 状态：已解决
- 现象：在靠近文件底部的位置增加 Diff 行高后，顶部阅读行向前跳动；无头验证中，第 80 行在行高从 18 px 增至 24 px 后变为约第 72 行。
- 原因：虚拟列表重新测量后，同一轮立即恢复滚动，实际内容容器仍使用旧高度，浏览器把新滚动位置截断到旧容器底部。
- 解决方案：保存顶部阅读行，等待重新测量后的内容高度生效，再按实际行高恢复滚动；收起时也按行高换算保存位置。Diff 行高设置、CSS、虚拟列表与跳转共享实际行高计算。
- 验证方式：类型检查、生产构建、状态及设置单测 33 项、Diff 和外观无头界面专项通过；验证改变行高保留顶部行、大字号最低行高与 CSS 一致、取消设置后跳转正确，以及自定义范围、保存重载和旧设置兼容。
- 相关文件：`webview/DiffPreview.tsx`、`webview/appearance.ts`、`webview/App.tsx`、`webview/SettingsDialog.tsx`、`webview/appearance.css`、`webview/styles.css`、`src/protocol/validation.ts`、`tests/ui-state.test.ts`、`scripts/test-diff-ui.mjs`、`scripts/test-appearance-ui.mjs`。

## BUG-031：Diff 未自动定位且单处修改无法重新跳转

- 日期：2026-10-02
- 状态：已解决
- 现象：打开文件后，第一处修改虽然被选中，视口仍留在文件顶部；仅有一处修改时上下箭头同时禁用，手动滚远后无法快速返回。
- 原因：预览加载只初始化选中索引，没有调用滚动定位；按钮按首尾索引禁用，把唯一修改同时当成两个不可跳转的边界。
- 解决方案：每个新比较在内容和视口就绪后自动定位第一处修改，收起时延迟到展开；短修改块居中，超高修改块定位开头。上下箭头按修改块循环，单块时均可重复定位，无修改才禁用。同一比较刷新及收起展开保留阅读位置。
- 验证方式：类型检查、生产构建、Diff 导航与对齐相关单测 14 项、Diff 无头界面专项通过；覆盖远处首块、首尾循环、唯一块两枚按钮重复定位、收起期间切换比较后展开、超高块、无修改禁用和同文件刷新保留滚动。
- 相关文件：`webview/DiffPreview.tsx`、`scripts/test-diff-ui.mjs`、`docs/WORKBENCH_SPEC.md`、`docs/VALIDATION.md`。

## BUG-030：工作台入口丢失及恢复方式偏离需求

- 日期：2026-10-02
- 状态：已解决
- 现象：移除侧栏仓库树时活动栏图标一并丢失。提交 `e95d870` 恢复入口时改用普通树节点，只提供 Show，缺少侧栏的新窗口按钮；视图变为可见就自动打开 Workbench 并强制关闭侧栏。该提交还未经需求确认修改了仓库单击切换和省略号入口。
- 原因：把活动栏的启动视图当成点击事件处理，未区分布局恢复与用户操作；TreeItem 替代了原先的 `viewsWelcome` 原生按钮。入口修复额外扩大到了工作台仓库交互。
- 解决方案：启动视图返回空列表，通过 `viewsWelcome` 显示 Show Git Workbench 和 Open Workbench in New Window 两个原生主题按钮，复用已有命令；移除可见性自动启动和强制关闭侧栏逻辑。Show 优先复用活动或最近使用的标签，没有时创建。仓库恢复单击选择、修饰键多选、双击或 Enter 切换，管理动作恢复右键入口；双击切换和右键管理本身不作为 Bug。
- 验证方式：类型检查、入口相关单测 8 项、生产构建及无头 `--worktrees-only` 通过；覆盖两个按钮的命令配置、初始可见与后续可见事件不触发命令、Show 新建/复用/活动标签优先/最近使用/关闭后重建，以及仓库双击和 Enter 切换、多选、右键管理及草稿保留。0.25.1 固定 VSIX 已通过官方 CLI 安装并核对 `alwaygit-dev.alwaygit@0.25.1`；真实 VS Code 桌面按钮样式和跨窗口集成未运行。
- 相关文件：`package.json`、`src/extension/extension.ts`、`src/extension/workbench-launcher.ts`、`src/extension/workbench.ts`、`webview/Sidebar.tsx`、`webview/styles.css`、`tests/workbench-entry.test.ts`、`scripts/test-ui.mjs`、`scripts/test-worktrees-ui.mjs`、`README.md`、`docs/WORKBENCH_SPEC.md`、`docs/ARCHITECTURE.md`、`docs/VALIDATION.md`。

## BUG-029：折叠分支仍会进入 Shift 范围选择

- 日期：2026-10-02
- 状态：已解决
- 现象：Local Branch 或 Remote Branch 的目录折叠后，在两个可见分支之间 Shift 选择，结果可能暗中包含折叠目录里的不可见分支。
- 原因：分支树渲染会根据展开状态隐藏后代，但范围选择始终使用整棵树的全部引用顺序，没有排除折叠节点。
- 解决方案：从与渲染相同的已排序树派生可见引用序列；叶子分支直接进入序列，只有已展开目录的自身引用和后代参与 Shift 范围。Commit、文件和 Worktree 的范围顺序经审计已经直接复用各自渲染数组，无需修改。
- 验证方式：分支树回归覆盖全部折叠、展开一级目录和展开嵌套目录三种状态，确认可见引用序列与屏幕行一致；类型检查通过。
- 相关文件：`webview/refTree.ts`、`webview/Sidebar.tsx`、`tests/workbench-helpers.test.ts`。

## BUG-028：仓库 Shift 范围选择与可见顺序不一致

- 日期：2026-10-02
- 状态：已解决
- 现象：仓库列表按名称显示时，从 `BreakReminder` Shift 单击到 `SwiftResume` 会漏选视觉上位于两者之间的 `llvm-project`、`MySkill` 和 `SchedulePin`，结果呈现为不连续蓝色选择。
- 原因：仓库行渲染前按名称排序，Shift 范围计算却使用 RepositoryManager 的注册顺序；先注册的旧仓库和后追加的新仓库在内部数组中的位置与屏幕顺序不同。
- 解决方案：集中派生仓库展示条目和当前可见仓库键序列，渲染与 Shift 范围选择共用该序列；折叠分组中的隐藏仓库不进入可见范围，既有 Ctrl/Cmd+A 全选全部逻辑仓库的行为保持不变。
- 验证方式：单元回归故意以旧仓库在前、新仓库在后的顺序注册八个仓库，确认显示按名称排序且范围顺序与渲染一致；另覆盖展开与折叠分组的可见范围。
- 相关文件：`webview/repositoryOrder.ts`、`webview/Sidebar.tsx`、`tests/repository-groups.test.ts`。

## BUG-027：无远端时 Push 进入无法完成的表单

- 日期：2026-10-02
- 状态：已解决
- 现象：仓库没有配置远端时，Push 对话框仍显示空的目标下拉框和 `Force-with-lease`；提交后只提示选择列表项目，但列表没有可选项，Remotes 空状态也没有添加入口。
- 原因：Push 表单只校验目标是否已选择，没有把“尚未连接远端仓库”建模为独立前置状态；产品协议没有添加远端动作，高级强制选项也与普通目标配置处在同一层级。
- 解决方案：Push 在无远端时先说明本地 Commit 已保存、发送前需要添加远端，只提供“添加远端”下一步；Remotes 空状态和标题同时提供入口。新增经过协议和后端校验的 `remote.add` 动作，添加成功后返回已具备目标的 Push 摘要。`Force-with-lease` 收入默认折叠的高级选项，启用时解释其可能覆盖远端历史及 lease 保护条件。
- 验证方式：协议与真实 Git 临时仓库回归覆盖远端名称、地址、重复名称及 Snapshot 更新；无头主界面覆盖 Remotes 空状态、Push 前置说明、无空选择器、添加远端后返回 Push，以及高级选项默认折叠。类型检查、生产构建和完整无头界面套件通过；0.20.0 固定 VSIX 已打包并通过官方 CLI 安装及身份/版本核对。
- 相关文件：`src/protocol/types.ts`、`src/protocol/validation.ts`、`src/protocol/remote.ts`、`src/git/service.ts`、`webview/App.tsx`、`webview/ActionDialog.tsx`、`webview/Sidebar.tsx`、`webview/menus.ts`、`webview/rpc.ts`、`webview/actionFeedback.ts`、`webview/styles.css`、`tests/git-service.test.ts`、`tests/workbench-protocol.test.ts`、`scripts/test-ui.mjs`、`docs/WORKBENCH_SPEC.md`、`docs/VALIDATION.md`。

## BUG-026：创建分支没有解释名称错误和切换结果

- 日期：2026-10-02
- 状态：已解决
- 现象：输入含空格的分支名后只显示 `Git exited with status 1`；输入保留但没有指出如何修正。创建对话框默认不 Checkout，成功后也没有说明当前仍在原分支，容易让后续修改落错位置。起点直接显示 `refs/heads/main` 或完整 Commit ID。
- 原因：名称只在 Git `check-ref-format` 阶段校验，而该命令失败时可能没有错误输出；创建与 Checkout 由默认关闭的复选框控制，通用操作反馈不携带创建后的当前分支；起点字段直接暴露内部引用。
- 解决方案：前后端共享完整的分支名规则并在输入框旁实时解释错误，保留输入、错误语义和字段焦点，后端继续执行最终校验。对话框用“仅创建”和默认主操作“创建并切换”明确区分意图；起点显示当前分支、远程分支、Tag 或短 Commit 的用户语义，内部引用收进 Git 详情。成功反馈明确显示已切换到新分支或当前仍在原分支。
- 验证方式：名称规则单测覆盖常用合法名称、空格、开头连字符、连续斜杠、隐藏段、`.lock` 和 `@{`；真实 Git 回归确认后端返回可操作错误；无头主界面验证实时错误、输入与焦点保留、友好起点、“仅创建”及仍在原分支的结果反馈。类型检查、生产构建和完整无头界面套件通过；0.20.0 固定 VSIX 已打包并通过官方 CLI 安装及身份/版本核对。
- 相关文件：`src/protocol/ref-name.ts`、`src/git/service.ts`、`webview/ActionDialog.tsx`、`webview/actionFeedback.ts`、`webview/ActionFeedbackBar.tsx`、`webview/store.ts`、`webview/styles.css`、`tests/ref-name.test.ts`、`tests/git-service.test.ts`、`scripts/test-ui.mjs`、`docs/WORKBENCH_SPEC.md`、`docs/VALIDATION.md`。

## BUG-025：重复恢复未跟踪文件时缺少安全下一步

- 日期：2026-10-02
- 状态：已解决
- 现象：含未跟踪 `notes.txt` 的 Stash 首次 Apply 成功后，再次 Apply 同一记录会因文件已存在而失败；对话框只显示 Git 输出，仍保留 Cancel 和 Apply Stash，用户需要自行判断现有文件与 Stash 是否安全，也容易重复无效提交。
- 原因：恢复直接交给 `git stash apply`，没有在写入前识别 Stash 未跟踪文件与工作区路径冲突；错误协议只支持 Checkout 阻塞信息，操作对话框无法得到可确认的安全状态和具体处理入口。
- 解决方案：Apply / Pop 在调用 Git 前读取 Stash 的未跟踪文件分类，逐路径检查现有文件、非目录父级和符号链接；命中时不执行 Apply，并返回“工作区未变、Stash 保留”的结构化结果。对话框明确说明原因与安全状态，移除无效重复提交，按冲突文件提供比较收起内容和打开现有文件的图标入口，只保留“取消并保留当前状态”；更换 Stash 后可重新尝试。
- 验证方式：真实 Git 回归覆盖首次 Apply、继续编辑现有文件、再次 Pop 被预检阻止、文件内容不变和 Stash 保留；文档预览测试覆盖 Stash 与 Working Tree 两份内容的比较；状态与协议测试覆盖结构化阻塞结果；类型检查、生产构建及无头 Stash 专项通过，无头场景确认原因无需查看日志、无重复 Apply 按钮、比较与打开入口均可用。0.19.1 固定 VSIX 已打包并通过官方 CLI 安装及身份/版本核对。
- 相关文件：`src/protocol/types.ts`、`src/protocol/validation.ts`、`src/git/service.ts`、`src/editor/documents.ts`、`src/extension/workbench.ts`、`webview/rpc.ts`、`webview/store.ts`、`webview/App.tsx`、`webview/ActionDialog.tsx`、`webview/refresh.ts`、`webview/styles.css`、`tests/git-safety.test.ts`、`tests/documents.test.ts`、`tests/ui-state.test.ts`、`tests/workbench-protocol.test.ts`、`scripts/test-stash-ui.mjs`、`docs/WORKBENCH_SPEC.md`、`docs/ARCHITECTURE.md`、`docs/VALIDATION.md`。

## BUG-024：仅含未跟踪文件的 Stash 默认显示为空

- 日期：2026-10-02
- 状态：已解决
- 现象：Stash 仅保存未跟踪文件时，打开详情首先看到 `Changed Files 0` 和 `No changed files`；必须自行切换到 `Untracked Files` 才能确认文件与内容仍在，容易把当前分类为空误解为保存失败或数据丢失。
- 原因：详情默认把 Stash 主提交与 HEAD 比较，只加载当前分类；Working Tree、Index 和未跟踪文件分散在 Stash 的不同父提交中，界面没有整体摘要、分类数量或非空分类选择逻辑。
- 解决方案：宿主按 Index→Stash、HEAD→Index 和未跟踪文件提交分别返回三个分类，按路径去重计算保存总数；详情显示整体摘要和分类数量，首次打开自动选择第一个非空分类。空分类说明内容所在位置并提供直接跳转，创建成功反馈显示保存文件数、未跟踪文件数及工作区是否干净。
- 验证方式：真实 Git 集成测试覆盖同一路径的 Staged/Unstaged 内容与独立未跟踪文件，验证分类和去重总数；状态回归覆盖仅有未跟踪文件时自动进入非空分类及分类切换；协议、类型检查、生产构建和无头主界面专项通过。0.19.1 固定 VSIX 已打包并通过官方 CLI 安装及身份/版本核对。
- 相关文件：`src/protocol/types.ts`、`src/protocol/validation.ts`、`src/git/service.ts`、`src/extension/workbench.ts`、`webview/rpc.ts`、`webview/store.ts`、`webview/Details.tsx`、`webview/actionFeedback.ts`、`webview/ActionFeedbackBar.tsx`、`webview/styles.css`、`tests/git-service.test.ts`、`tests/ui-state.test.ts`、`tests/workbench-protocol.test.ts`、`scripts/test-stash-ui.mjs`、`scripts/test-feedback-ui.mjs`、`scripts/test-ui.mjs`、`docs/WORKBENCH_SPEC.md`、`docs/VALIDATION.md`。

## BUG-023：多窗口仓库目录不同步且写操作可能并发

- 日期：2026-10-02
- 状态：已解决
- 现象：在一个 VS Code 窗口添加、分组、移动或移除仓库后，另一个已打开的 Workbench 不会立即刷新；两个窗口还可能同时对同一仓库执行写操作，只能依赖 Git 最终报锁冲突。
- 原因：仓库目录虽然写入共享 `globalState`，但扩展宿主之间没有变更通知；写操作队列只存在于单个扩展宿主内存中，不能覆盖不同 VS Code 窗口。
- 解决方案：复用经过认证的窗口桥广播目录变更与仓库活动，接收窗口重新对齐保存路径、排除项和分组状态；按规范化 `commonDir` 建立跨宿主文件租约，运行期间续期并在结束后释放，崩溃遗留租约超时恢复。同仓库的第二个写操作在执行前被拒绝，不同仓库仍可并行。
- 验证方式：类型检查、相关 6 个测试文件 40 项、生产构建及完整无头界面套件通过；窗口桥测试覆盖无共同工作区时的目录与活动广播，仓库管理测试覆盖跨窗口添加、分组和移除对齐，租约测试覆盖同仓库互斥、不同仓库并行和陈旧租约恢复。0.19.0 固定 VSIX 已打包并通过官方 CLI 安装及身份/版本核对；未启动会弹窗的真实多窗口 VS Code 集成测试。
- 相关文件：`src/application/window-bridge.ts`、`src/application/operation-lock.ts`、`src/extension/project-windows.ts`、`src/extension/workbench.ts`、`src/repositories/manager.ts`、`tests/window-bridge.test.ts`、`tests/operation-lock.test.ts`、`tests/repository-manager.test.ts`、`docs/ARCHITECTURE.md`、`docs/WORKBENCH_SPEC.md`。

## BUG-022：未选择仓库时误显示 Detached HEAD

- 日期：2026-10-02
- 状态：已解决
- 现象：首次打开 Workbench 或当前没有选择仓库时，顶部分支栏显示 `Detached HEAD`，将“还没有开始”误表达为仓库的特殊 Git 状态。
- 原因：分支标题只判断 `snapshot.branch`；`snapshot` 不存在时也落入同一个 `Detached HEAD` 分支，空状态同时将“没有仓库”与“尚未选择”合并。
- 解决方案：建立未选择、正在打开、普通分支与真实 Detached HEAD 四种显式界面状态；仅已加载仓库且没有分支时显示 `Detached HEAD`，并为无仓库与未选择仓库提供不同引导。
- 验证方式：状态回归覆盖无仓库、打开中、普通分支与真实 Detached HEAD；类型检查通过。
- 相关文件：`webview/App.tsx`、`webview/repositoryState.ts`、`tests/repository-state.test.ts`、`docs/WORKBENCH_SPEC.md`。

## BUG-021：批量暂存可误触且提交结果缺少范围反馈

- 日期：2026-10-02
- 状态：已解决
- 现象：Working Tree 中最醒目的 `Stage All` / `Unstage All` 会立即改变整个分组，误触时没有范围确认；文件状态只显示字母和颜色。Commit 完成后只有通用成功提示，不能直接确认新提交、提交文件数以及仍未提交的内容。
- 原因：分组按钮把“没有选择”直接解释为“操作全部”，与明确选择文件的操作共用执行路径；文件状态和通用操作反馈没有针对范围核对设计语义化呈现。
- 解决方案：仅对无选择状态下的 `Stage All` / `Unstage All` 增加带实际文件数的确认浮窗，确认按钮默认聚焦以支持 Enter，选择文件和右键操作继续直接执行。文件状态改为不同形状、语义色和 Tooltip 的紧凑图标。Commit 成功反馈显示短哈希、提交文件数、剩余变更或干净状态，并提供 `View Commit`；失败继续保留草稿和详细错误反馈。
- 验证方式：类型检查和生产构建通过；无头文件专项覆盖状态图标及无常驻字母、Stage All / Unstage All 数量确认、确认按钮默认焦点、Enter 执行、Escape 取消和所选文件直接操作；无头反馈专项覆盖 Commit 短哈希、2 个提交文件、1 项剩余变更及 `View Commit`。0.18.0 固定 VSIX 已打包，并通过官方 CLI 安装和扩展身份/版本核对。未启动真实 VS Code 桌面集成测试。
- 相关文件：`webview/Details.tsx`、`webview/ui.tsx`、`webview/styles.css`、`webview/actionFeedback.ts`、`webview/ActionFeedbackBar.tsx`、`webview/store.ts`、`scripts/test-files-ui.mjs`、`scripts/test-feedback-ui.mjs`、`docs/WORKBENCH_SPEC.md`、`docs/VALIDATION.md`。

## BUG-020：冲突后的发起窗口混淆关闭与中止

- 日期：2026-10-02
- 状态：已解决
- 现象：Merge 发生冲突后，原窗口继续保留 Merge 和 Cancel；Cancel 只关闭对话框，合并仍处于暂停状态，真正的 Abort 位于窗口后面的操作条。用户不易判断取消是否已经中止合并，或如何恢复到合并前状态。
- 原因：对话框只在 Git 成功时关闭，失败并产生活动操作后仍保留发起状态；关闭与中止共用模糊的取消表述，中止说明没有可确认的操作起点。
- 解决方案：Merge / Rebase / Cherry-pick / Revert / Pull 发起窗口在活动操作出现后转换成暂停处理状态；主入口为查看并处理冲突，关闭写明“关闭此窗口”且明确操作依旧暂停，同窗口直接提供中止入口。宿主读取可确认的 Merge / Rebase / Sequencer 原始 HEAD，工作台与原生 Abort 确认显示 Git 将尝试恢复的 Commit 和可能丢弃的修改，不保证操作前本地修改一定可以完整恢复。
- 验证方式：无头操作反馈专项通过，检查暂停窗口不再保留 Merge/Cancel、关闭不发出 Abort、后台操作条继续存在和 Abort 显示恢复 Commit；真实 Git 验证中止恢复 HEAD 与干净工作区。原生确认适配器测试覆盖恢复起点、取消与未保存编辑提示；针对性 5 项、类型检查和构建通过。未启动真实 VS Code 桌面集成测试。
- 相关文件：`webview/ActionDialog.tsx`、`webview/App.tsx`、`src/protocol/types.ts`、`src/git/service.ts`、`src/extension/workbench.ts`、`src/application/confirm.ts`、`scripts/test-feedback-ui.mjs`、`tests/git-service.test.ts`、`tests/confirm.test.ts`、`docs/WORKBENCH_SPEC.md`、`docs/VALIDATION.md`。

## BUG-019：冲突暂存被宣称为已解决且能直接完成操作

- 日期：2026-10-02
- 状态：已解决
- 现象：未编辑冲突文件便点击 Mark Resolved，文件通过 `git add` 进入暂存；界面宣称 Conflicts resolved / Ready to Continue，随后可生成仍含冲突标记的提交。
- 原因：冲突按钮与普通 Stage 共用动作；是否能 Continue 只根据 Git unmerged entries 是否归零，界面把 Index 状态当成内容正确性证明。Continue 和活动操作 Commit 没有结果检查。
- 解决方案：新增人工标记并暂存动作与准确反馈；操作条显示待检查结果并保留暂存审阅入口。Continue / 活动操作 Commit 检查实际暂存内容，列出疑似标记行号及未扫描文件，有提示时明确确认后允许继续；无标记不保证正确。确认绑定操作及暂存版本，变化后重新检查，普通 Commit 不能绕过。
- 验证方式：真实临时仓库覆盖 Merge / Rebase / Cherry-pick / Revert 的未编辑暂存、Continue 与 Commit 保护、明确确认继续、Index 与工作文件不同、确认后重新暂存、自定义及 diff3 标记、未扫描内容和 Abort；相关 4 个测试文件 70 项、类型检查、构建及无头操作反馈专项通过。原生 VS Code 窗口和非 Windows 环境未运行桌面集成复测。
- 相关文件：`src/git/service.ts`、`src/protocol/types.ts`、`src/protocol/validation.ts`、`src/extension/workbench.ts`、`src/application/confirm.ts`、`webview/Details.tsx`、`webview/menus.ts`、`webview/OperationNotice.tsx`、`webview/OperationReviewDialog.tsx`、`webview/store.ts`、`webview/ActionFeedbackBar.tsx`、`tests/git-service.test.ts`、`tests/git-safety.test.ts`、`tests/ui-state.test.ts`、`tests/workbench-protocol.test.ts`、`scripts/test-feedback-ui.mjs`、`docs/WORKBENCH_SPEC.md`、`docs/ARCHITECTURE.md`、`docs/VALIDATION.md`。

## BUG-018：递归扫描会直接添加仓库且列表无法移除

- 日期：2026-10-02
- 状态：已解决
- 现象：选择一个包含多个 Git 仓库的目录后，扫描结果未经确认便全部加入 AlwayGit；活动栏和工作台列表没有移除入口，用户无法撤销不需要的仓库。
- 原因：RepositoryManager 的批量扫描同时承担发现、注册监听和持久化，宿主在扫描完成后直接调用该流程；仓库目录只有追加路径，没有排除和释放已注册仓库的生命周期。
- 解决方案：把递归发现与注册拆成独立阶段，扫描结束后显示包含“可添加”和“已添加”状态的多选确认列表；只有确认项才注册并保存。活动栏和工作台仓库菜单增加单个及批量移除，明确不删除磁盘文件，同时释放监听、移除保存路径并记录排除项，防止工作区自动发现立即恢复该仓库。
- 验证方式：仓库管理测试覆盖无副作用发现、确认添加、关闭确认列表、逻辑仓库移除、保存路径清理、工作区自动发现排除和宿主确认文案；协议校验、类型检查和相关无头界面检查通过。
- 相关文件：`src/repositories/manager.ts`、`src/extension/workbench.ts`、`src/extension/extension.ts`、`src/protocol/types.ts`、`src/protocol/validation.ts`、`webview/menus.ts`、`package.json`、`tests/repository-manager.test.ts`、`docs/ARCHITECTURE.md`、`docs/WORKBENCH_SPEC.md`。

## BUG-017：多选区域的 Ctrl+A 可能选中整页文本

- 日期：2026-10-01
- 状态：已解决
- 现象：焦点位于 Repository、Local Branch、单个 Remote、Worktrees 或 Commit History 等可批量选择区域时，按 Ctrl/Cmd+A 可能没有选中该区域内的对象，反而触发浏览器默认行为并选中整页文本；不同区域对 Escape 清除选择的支持也不一致。首次修复还错误地把 Worktrees 当成仅单项导航而排除，导致该区域继续复现。
- 原因：选择快捷键分别绑定在部分子列表的冒泡阶段，焦点落在标题、操作控件或行内元素时可能越过处理边界；各区域还使用分散且不一致的按键判定，History 和 Worktrees 缺少区域级全选处理。
- 解决方案：统一共享 Ctrl/Cmd+A 与 Escape 的键盘判定，在可聚焦的侧栏选择容器和 History 面板捕获按键，并按焦点所在作用域更新对象选择。Repository 全选逻辑仓库，Local 只全选本地分支，Remote 只全选当前 Remote 的分支，Worktrees 全选当前仓库的全部 Worktree；分支 action selection 不改变 Graph `checkedRefs`。History 只选择当前已经加载的真实 Commit，不隐式加载更多并排除 Working Tree 虚拟 Commit；文件区域沿用相同判定。输入框、文本域和可编辑内容继续使用原生全选与 Escape 行为。
- 验证方式：选择键盘判定单测覆盖 Windows/macOS 修饰键、无效修饰键组合及可编辑控件；无头界面覆盖 Repository、Local、单个 Remote、History 与文件区域。Worktrees 专项保留 Ctrl/Cmd+A 全选、Escape 清空和页面文本不被选中的回归场景。
- 相关文件：`webview/selectionKeyboard.ts`、`webview/Sidebar.tsx`、`webview/menus.ts`、`webview/History.tsx`、`webview/Details.tsx`、`webview/fileSelection.ts`、`tests/file-selection.test.ts`、`scripts/test-ui.mjs`、`scripts/test-worktrees-ui.mjs`、`scripts/test-history-ui.mjs`、`docs/WORKBENCH_SPEC.md`。

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
- 解决方案：把 Working Tree 建模为只存在于前端的虚拟历史项；当前 HEAD 在 Graph 筛选结果中可见时，以它为父节点并紧邻其上方显示实心菱形节点和连接线，HEAD 被筛除时则只显示独立 Working Tree，不重新插入 HEAD 或悬空连线。Working Tree 使用明确的默认底色、边界、加粗标题、数量徽标、进入箭头以及悬停、焦点和选中反馈表达可操作性，不依赖说明性 Tooltip。普通 HEAD Commit 不增加外圈、绿色行标或 `HEAD ·` 绿色徽标，只按普通 Commit 节点显示当前分支名称并保留辅助技术语义。分页和 Git 操作仍只计算真实 Commit。
- 验证方式：视图模型和 Graph 渲染单测覆盖可见 HEAD、筛选排除 HEAD 与无首个 Commit；Git 集成测试验证筛选结果仍返回 HEAD 摘要但前端不强制展示；无头 History 检查验证取消全部分支后只剩 Working Tree，且没有 HEAD 行、筛选外徽标或悬空父节点，同时覆盖普通状态下的相邻位置、行交互反馈和方向键导航。
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
