# 架构与开发约定

本文维护 AlwayGit 的运行结构、代码入口、跨层约定和开发流程。产品行为以 [工作台规格](WORKBENCH_SPEC.md) 为准，检查方法和验证证据见 [验证与本地更新](VALIDATION.md)，协作要求见 [项目规则](../AGENTS.md)。

## 运行结构

AlwayGit 是 Workspace 类型的 VS Code 扩展。React 工作台共用一套消息边界，可由编辑器 WebviewPanel 或独立 WebviewView 承载；Node.js 宿主管理各实例，并共享 Git 子进程、仓库发现、剪贴板、窗口和文件操作。`workbench-launcher.ts` 注册三个保留隐藏上下文的视图：主侧边栏沿用 `alwaygit.workbenchLauncher` 身份，第二侧边栏使用 `alwaygit.workbenchAuxiliary`，面板使用 `alwaygit.workbenchPanel`。停靠容器 ID 为 `alwaygit-panel` 和 `alwaygit-auxiliary`，遵循 VS Code 的字母、数字、下划线和连字符限制；视图 ID 与旧会话键保持不变。第二侧边栏通过 VS Code 1.106 起稳定提供的 `viewsContainers.secondarySidebar` 注册。尚未打开的位置显示保留两个命令 URI 的轻量启动页，独立浏览器脚本仅接收位置设置的就绪、关闭与保存请求，不接入仓库或 Git RPC；已启用的视图在恢复或显式打开时加载工作台。原生视图标题齿轮按来源 viewId 向对应启动页或实际工作台发送位置弹窗消息，内部位置图标走同一流程；载入期间的打开请求等到脚本就绪后投递。启动页和完整工作台复用 WorkbenchLocationsDialog，应用一次保存完整配置，前端同步卸载弹窗并恢复焦点后发送关闭消息，宿主消费该来源的一次性默认位置并打开；取消不写入，也不触发打开。主侧栏视图无显示条件，始终保留启动入口；第二侧栏和面板使用 alwaygit.auxiliaryLocationEnabled 与 alwaygit.panelLocationEnabled 上下文控制 views.when，空容器由 VS Code 自动隐藏。启动和配置变化依据规范化位置设置更新上下文，不自动聚焦新启用的位置。来源设置保存期间暂缓隐藏该来源，收到弹窗关闭消息后更新显示条件，再打开默认位置。启动页弹窗关闭前暂停替换承载页面，避免保存应答丢失。移动、新窗口与显式打开操作保持独立入口。Webview 不直接读取磁盘，也不执行 Git。

`alwaygit.workbenchLocations` 用一个用户级配置对象原子保存 `enabled` 和 `default`，宿主读取旧配置时去重并修正无效默认位置；保存时严格校验位置不重复、至少启用一个位置且默认位置已启用。没有有效新配置时兼容 `alwaygit.openMode`：旧 editor 对应仅标签页，旧 docked 对应标签页与侧边栏、默认侧边栏；左右侧方向由 VS Code 的主侧边栏位置设置决定。显式打开调用对应容器 `resetViewContainerLocation` 与视图 `resetViewLocation` 命令恢复原生区域，再执行 `.focus`，避免记忆的移动位置与目标不符。Show 和状态栏只路由默认位置，显式命令按指定位置打开；编辑器可复用已有编辑器实例，两个侧栏和面板各自复用本位置实例。取消勾选第二侧栏或面板时，原生视图销毁回调将其会话与终端所属实例留在宿主，重新启用后用原会话重新加载页面并迁移终端所属对象，不重启 Shell；关闭扩展时统一释放。编辑器与主侧栏取消勾选仅限制后续打开。编辑器、主侧栏、第二侧栏和面板各用 SessionWriter 保存到 `alwaygit.session`、`alwaygit.dockedSession`、`alwaygit.auxiliarySession` 和 `alwaygit.panelSession`，草稿、查询、选择与终端按实例隔离，用户界面偏好继续共享。

“携带当前状态新建标签页”通过随机 token 的 `captureWorkbench` 读取源实例的实时会话及临时筛选、提交选择、比较和差异版本，响应限定来源并经 Schema 验证。始终创建新的编辑器标签，不修改已有标签和源实例；初始化覆盖目标旧 Webview state。终端当前页不复制，进程、输入和回放仍归源实例。读取失败或 Git 操作未完成时保留所有实例状态。原生移动命令接收所选视图 ID，用户仍可把独立视图移动到主侧边栏、辅助侧边栏或面板。

扩展在启动阶段提前注册命令、面板恢复与窗口通信，激活完成不等待内置 Git 或仓库扫描。Git 可执行路径在首次 Git 请求时解析并共用一个初始化任务，优先使用显式配置，其次使用内置 Git 路径，失败时回退 PATH。启动仓库扫描在后台进行；工作台面板先创建并加载脚本，仓库列表、分组和排序请求共用首次扫描的完成结果，目录相关的选择器、发现与修改请求也等待该任务。保存路径最多四个并行验证，结果按原始顺序收集，全部完成且目录版本仍有效时一次发布；不逐项暴露未完成的目录。前端目录状态独立于仓库快照 loading，后台目录刷新保留已加载内容。首次扫描失败时保留界面并允许后续目录请求重试；后续打开或显示面板不重复扫描，工作区变化、目录同步和显式刷新仍触发既有扫描流程。启动不自动新建编辑器工作台标签；已启用的侧栏或面板在其视图恢复时加载工作台内容。

`src/protocol` 是 Webview 和宿主的共享边界。请求以 `id` 关联响应，Zod 在宿主入口验证方法与参数；宿主主动发布仓库变更、操作活动和仓库选择事件。宿主只接受已经注册的仓库及预定义方法，Git RPC 不接受任意命令；明确创建的内嵌终端提供受面板归属隔离的 Shell 输入通道。Demo 适配器独立维护示例模型，仅在显式 Demo 模式的首次请求时初始化数据；生产桥接不初始化示例状态或读取 Demo 存储。

## 模块边界

| 目录 | 主要入口 | 职责 |
| --- | --- | --- |
| `src/extension` | `extension.ts`、`workbench.ts`、`workbench-launcher.ts`、`project-windows.ts` | 扩展激活、活动栏入口、面板集合、RPC 路由、VS Code 命令和生命周期 |
| `src/application` | `confirm.ts`、`credentials.ts`、`window-bridge.ts`、`operation-lock.ts`、`snapshot-coordinator.ts`、`query-coordinator.ts`、`session-persistence.ts` | 操作确认、认证与窗口 IPC、跨宿主写操作租约、查询与保存协调 |
| `src/git` | `service.ts`、`runner.ts`、`error.ts`、`stash.ts`、`stash-drop.ts`、`default-branch.ts` | 系统 Git 执行、结构化解析、查询、操作、Stash 隔离与身份核验删除及共享仓库队列 |
| `src/repositories` | `manager.ts`、`catalog-store.ts`、`discovery.ts` | 仓库注册、递归发现、文件监听和持久化 |
| `src/editor` | `paths.ts`、`documents.ts` | 安全路径解析、Git 内容文档、只读预览和 VS Code 原生 Diff |
| `src/protocol` | `types.ts`、`validation.ts`、`session.ts`、`repositories.ts` | 数据模型、RPC 请求响应、运行时校验和仓库展示分组 |
| `webview` | `App.tsx`、`store.ts`、`rpc.ts`、`demo.ts` | React 组合、Zustand 状态、生产宿主桥接及独立的 Demo 适配器 |
| `webview` | `Sidebar.tsx`、`History.tsx`、`Details.tsx`、`DiffPreview.tsx` | 四区呈现、对象选择和只读比较 |
| `webview` | `BottomDock.tsx`、`dock-store.ts`、`TerminalView.tsx` | 底部多标签、终端显示与输入、活动标签状态 |
| `src/application`、`src/extension` | `terminal-sessions.ts`、`terminal-runtime.ts`、`terminal-host.ts` | 来源面板隔离、Shell 配置、PTY 辅助进程与输出流控 |
| `webview` | `shortcutKeys.ts`、`shortcuts.ts`、`ShortcutSettings.tsx`、`shortcutDefinitions.ts` | 默认键位与会话覆盖、录制和冲突移动、捕获分发、编辑/弹窗/输入法保护及组件动作注册；操作、按钮提示与帮助共用有效绑定，协议层 `src/protocol/shortcuts.ts` 校验覆盖配置 |
| `webview` | `menus.ts`、`SettingsDialog.tsx`、`appearance.ts`、`i18n.ts` | 动作定义、界面设置、外观和语言 |
| `webview` | `HelpDialog.tsx`、`help-content.ts`、`help-manuals.ts` | 离线帮助、双语手册的章节提取与打包图片映射 |
| `webview` | `refresh.ts`、`refIndex.ts`、`session-persistence.ts`、`fileSelection.ts`、`diff.ts` | 刷新失效范围、选择规则和修改块导航 |
| `webview/graph` | `layout.ts`、`GraphRow.tsx`、`palettes.ts` | 可分页的轨道布局、SVG 行渲染和配色 |

共享协议先于两端实现修改。新增宿主能力时，应依次维护共享类型与校验、宿主路由、Git 或编辑器实现、Webview 调用和真实仓库测试。Webview 菜单及工具栏应复用相同的动作描述和执行入口，避免同一 Git 操作出现不同参数或禁用规则。

帮助正文使用双语用户手册的固定章节 ID，Markdown 按手册所用的标题、段落、列表、表格、图片及行内格式提取为结构化内容，由 React 渲染为文本，不注入原始 HTML。HelpDialog 独立延迟加载；Vite 将手册文本及图片 URL 纳入 Webview 构建，图片资源位于现有 `dist/webview` 允许范围内。宿主页通过 `csp-nonce` 元标记将脚本 nonce 传给 Vite 的资源预加载逻辑，保持原有 CSP，不增加外部资源或 Git RPC。

## 仓库、引用和历史

Repository 标识工作目录，`commonDir` 标识共享 Git 存储，`gitDir` 标识该工作目录的私有 Git 元数据。同一存储的多个 工作树 共用写操作队列，但保持独立的 HEAD、Index 和工作区状态。写操作在执行前重新验证仓库、引用和 工作树 状态。

Git 发现比较 Git 目录与共享目录识别主工作目录；linked 工作树 使用 `worktree list` 返回的主目录维护可选 `mainRoot`，独立存储的普通仓库仍使用自身工作目录。不根据 `.git` 文件类型或远端 URL 推断归属。共享纯函数 `src/protocol/repositories.ts` 按规范化 `commonDir` 派生逻辑仓库，供 Workbench 仓库导航使用；活动工作目录仍为实际操作目标。用户创建的 Repository Collection 是独立的展示层级，以逻辑仓库键保存归属；没有 Collection 的仓库直接位于根层，不生成特殊的“未分组”节点。RepositoryManager 和 RPC 保留完整工作目录列表及原路径 ID，旧保存路径、会话和草稿无需重写；扫描数量以逻辑仓库计数，新增 工作树 即使不增加仓库数也发布列表变化。

手动添加目录由 `src/repositories/discovery.ts` 使用异步迭代遍历，仅对有 `.git` 标记的候选目录调用 Git 验证，并在有效仓库处停止深入。仓库与空分组统一从 Webview 内嵌添加浮窗创建，空分组提交经过 Zod 校验的名称给宿主，宿主再次校验同名规则后保存并广播。Webview 只通过原生目录选择器取得扫描根目录；随后用带面板归属的扫描 ID 请求发现，宿主向该面板发布进度，关闭浮窗或取消扫描会使遍历停止。发现结果暂存在宿主且不注册监听或写入状态，Webview 显示按逻辑仓库分组的候选项、已添加状态、问题和目标 Collection；最终提交只携带扫描 ID 与选中键，宿主重新核对缓存结果和 Collection 后才批量去重、注册监听、保存、归组并发布目录变化，不能由 Webview 提交任意磁盘路径。扫描取消或关闭确认列表均不注册。根层与各 Collection 的展示顺序在共享目录快照中保存，条目通过 Collection ID 或规范化的逻辑仓库键标识。宿主重新核对排序源与目标的存在性及同层归属，仅接受相对目标的前后插入；暂不可访问仓库的排序位置保留，显式移除时清理。用户主动添加的路径、排除项、Collection、归属和顺序以扩展 `globalStorageUri/repository-catalog.v1.json` 为权威快照，包含 schema 与 revision。按规范化存储目录的 OS 回环端口短时互斥，在锁内重读、校验并临时文件原子替换；同宿主预备监听、事务与发布使用 FIFO。扫描和兼容 `globalState` 镜像在锁外，镜像失败不反转已提交操作；添加、建组和归组一次提交。未知 schema 或损坏文件保留并报错。窗口桥通知同一隔离域的其他宿主重读权威文件、重新发现路径并释放移除项，过期扫描不能提交。旧 `globalState` 在首次建档时迁移，旧 `workspaceState` 按工作区一次导入并尊重当前排除项。Webview 内嵌确认浮窗只提交已展示的逻辑仓库键，宿主重新核对其存在性和忙碌状态后才移除仓库；移除会释放其监听、删除保存路径和分组归属并保存逻辑仓库排除项，防止工作区或内置 Git 自动发现立即恢复；再次明确添加时解除排除。启动恢复只重新验证已保存路径及 VS Code 提供的仓库，不重复递归扫描分类目录。本地路径不参与 Settings Sync。

同一 commonDir 共用引用计数的 Git 元数据监听；refs 变化广播，HEAD、Index 和操作标记按 gitDir 通知所属 工作树。工作区文件监听仍按目录独立管理，按仓库相对路径排除 Git 元数据；node_modules 事件经有界批量 Index 查询保留已跟踪路径，查询失败或范围溢出时保守失效。最后一个成员移除才释放公共监听。自动发现与跨窗口同步共用扫描任务，目录或移除状态变化使旧结果失效；后续重新读取当前根目录，避免旧扫描恢复已移除项。

Status 使用 porcelain v2 与 NUL 分隔，分别保存 Index 和工作区状态。历史查询接受一组完整引用名；输入引用先去重，解析最多并发 4 条；默认引用直接使用 for-each-ref 给出的不可变 Commit ID，仅嵌套 Tag 需要追加解析。首次查询固定 tips，后续分页沿用同一组 tips，避免翻页过程中引用移动造成重复或遗漏；已解析的 tips 经标准输入传入 log/rev-list，避免引用数量突破命令行长度。多个引用的结果使用 Git 可达提交并集，共同祖先只返回一次。图算法的 pending lanes 跨页延续，虚拟列表只渲染可见行。

同一工作目录的重叠 Snapshot 请求通过应用层协调器共用正在执行的查询；写入及文件事件立即提升失效代数；过时的快照值和错误转向当前代读取，旧任务不能发布过时内容或删除新任务。操作响应与补偿轮询直接携带已读取的 Snapshot，前端复用该结果；不同 工作树 保持独立。引用索引按不可变 refs 数组缓存名称和 OID 查询，减少历史行与侧栏重复扫描。快照中的嵌套 Tag 解析和远端目标查询，以及批量本地/远程分支删除的名称校验，各批最多并发四条 Git 查询；批量分支先去重再校验，结果保留输入顺序。这是批内上限，不代表整个扩展的子进程总数。

搜索输入使用 200 ms 防抖，输入变化立即使旧结果失效；自动定位最多读取 20 页或达到 10000 条后停止，保留结果并允许手动继续。

History、Details（含 Stash 和比较）、Diff 预览按面板与类别替换过期请求，切换仓库或关闭面板也取消旧请求。宿主只读协调器最多运行 3 个查询任务；单任务内部可包含并行 Git 命令，该上限不是整个扩展的子进程总数。AbortSignal 经只读作用域传到 runner，运行中的取消任务在已知 Git 句柄完成前继续占用任务名额；失败同时取消并等待并行的同作用域命令。取消权限只针对来源面板，写操作与操作结果检查不进入此队列。

前端对异步请求使用仓库代数和请求代数，忽略切换仓库、刷新或重新筛选后返回的旧响应。宿主 Snapshot 具有单调版本，补偿刷新使用不含版本字段的指纹识别实际变化。文件监听携带相对工作区路径和 Index 变化标记，宿主与前端的防抖均合并变化范围；重叠 Snapshot 请求沿用尚未消费的变化范围，避免遗漏已处于 dirty 状态的文件内容更新。

后台及 Git 操作后的刷新按已选引用、HEAD 和全部远端引用的 OID 判断是否重读 History；远端引用参与判断以更新推送标记，单纯 Stage/Unstage 不强制重读历史。手动 Refresh 仍重新查询 History。已加载的 Commit 详情按仓库、OID 和所选 Parent 保留，History 查询不重新选择同一个 Commit。Merge Parent 作为可选会话字段保存，兼容既有 version 2 会话。

工作台标签仅在从隐藏变为可见时后台检查当前仓库，保持已有画面、选择、草稿及滚动位置；持续可见时的焦点变化不触发检查。无文件失效通知时，补偿轮询除比较新快照外，还定向重验可见 Working Tree 的已选 dirty 文件，使状态标记未变的再次编辑也能刷新；历史和纯 Staged 比较不参与该补偿。隐藏期间的仓库目录变化与当前仓库文件失效范围由宿主合并保存，恢复可见后一次补发；未知范围继续按完整失效处理。仓库列表仅在目录确有变化时重读，已加载列表和仓库的后台读取不进入首次加载状态。

## 工作台状态

### 中英文资源维护

界面、菜单、设置、宿主提示和自有错误的文案统一维护在 `src/i18n/catalogs/*.json`，按功能分组；每条记录含稳定的语义 key、`en`、`zh-CN`、使用场景 `context` 和核对状态 `review`。修改措辞时保留 key，不从新措辞重新生成标识。`translated` 表示已有不同的中文对照，`pending` 表示沿用英文、等待文案核对，`keep` 表示按当前术语约定保留原文；新增同文记录必须明确选用后两种状态。状态用于核对与检查，不自动改写文字。中文界面翻译普通动作和对象，保留 Rebase、Cherry-pick、Graph、Stash、HEAD、Detached HEAD、Index 与 Diff；工作树 统一译为“工作树”，Checkout 按语境译为“切换”。名称、路径、代码、用户内容和 Git 原始输出不翻译。

代码只传 key 和具名参数：React 使用 `useTranslation()`，非组件展示使用 `uiText()`，共享层使用 `translate(language, key, parameters)`，自有错误使用 `message(key, parameters)`。完整句子中的数量、分支名、路径和目标使用 `{{name}}` 参数；确需单复数时在对应语言写 `one` / `other` 等形式，`count` 必须为数字。只有呈现需要独立样式的内联代码或标签时才拆分展示片段。历史文案在两种语言使用不同数量的参数时，`omitParameters` 显式记录允许省略的参数；故意空白的展示片段使用 `allowEmpty`。这些例外也由检查工具核对，不能掩盖新引入的参数差异。

`scripts/i18n.mjs` 从资源生成 `src/i18n/generated.ts` 的运行时词条与 key / 参数类型，并生成 VS Code 静态贡献项使用的 `package.nls.json`、`package.nls.zh-cn.json`；生成文件禁止直接编辑，检查会拒绝过期结果。运行时仅打包文字，场景和核对状态留在源资源。底层 i18next 负责插值和单复数，每次调用绑定语言，不修改共享引擎的全局语言；尚未翻译的英文单复数沿用英文规则。原生确认与请求提示通过异步请求上下文使用来源面板语言，其他入口沿用已保存的语言与扩展配置。VS Code 命令面板、活动栏与设置描述由 VS Code 自身的显示语言选择，与工作台语言选择器分别生效。

`GitError` / `MessageError` 保留英文诊断消息，并携带可选的 key 与参数。RPC 在输出和发送前隐藏凭据信息，发送错误代码、显示消息、结构化详情和经过脱敏的文案描述；前端按当前面板语言呈现已知描述，旧响应和未知描述继续使用原有消息。原始 Git 输出、仓库内容、名称、路径与用户输入保持原文。离线手册继续分别维护现有中英文 Markdown，不拆成运行时词条。

核对清单由 `npm run i18n:export` 导出到忽略的 `artifacts/copy-review.csv`，可用 Excel 打开；包含固定 key、双语文字、状态、场景、资源文件和当前代码引用位置。资源是唯一编辑源，表格是生成的核对视图；核对意见按 key 回写资源后重新生成、检查并导出，不维护第二份独立词库。

状态分为三类：

- 仓库数据：Snapshot、History 页面、Commit 详情和 Diff 预览。
- 每仓库视图：已勾选引用、引用目录展开状态、侧栏分区折叠状态、搜索、当前 Commit、文件、Stash、活动区域和 Commit 草稿。
- 用户界面偏好：语言、主题、浅色/深色 Graph 色板与主线颜色、状态颜色、界面与 Diff 字号和行高、文件间距、快捷键、修改列表模式及 Diff 导航范围。
- 面板布局：分栏尺寸、折叠和表格列宽，各标签独立恢复，工作区保留新标签的初始布局。

会话 Schema 与推导类型统一在 `src/protocol/session.ts`。持久化只订阅相关字段，各标签立即写入自己的 VS Code Webview state；前端 saveSession 请求经 200 ms 防抖、单个在途请求和最新待写状态协调；Commit 浮窗关闭时通过 flushNow 立即发送待保存状态，在途写入结束后继续保存最新草稿，收到成功响应后才更新去重基线，失败最多重试两次并提示。扩展宿主串行保存活动标签状态到 `workspaceState`，作为新标签和兼容恢复的基线；非活动标签只更新自身状态，重新激活后再提交基线；这次由宿主主动发起的同步若失败，仅记录输出日志，不自动重试。每个标签按自身最后成功保存的状态计算草稿和视图改动，在串行写入时合并最新宿主基线；旧标签的未改动字段不覆盖其他标签的新状态，空白标签保留已有仓库、草稿与视图。多个标签具有独立的活动仓库与前端选择状态；宿主按请求来源定向响应和切换仓库，仓库变化与 Git 活动事件广播到全部标签。补偿刷新覆盖所有可见标签当前仓库，并按仓库去重。Demo 模式使用浏览器 localStorage。持久化的数据只包含界面状态，不包含凭据、Git 输出或文件内容。

version 2 会话通过可选 `appearance` 与 `diffNavigationScope` 字段兼容新增设置，后者缺省为整个 Commit，宿主协议验证后保留；旧会话缺少自定义色值时使用当前预设生成完整浅色/深色色板。旧 Editor Focus 迁移为 Workbench，旧默认 26 px 行高迁移为 24 px，其余尺寸和草稿保留。设置浮窗使用内存基线实现实时预览，订阅持久化时仍写入基线，应用后通过 `saveInterfaceSettings` 保存用户配置并广播到各窗口和标签；取消恢复最新已应用偏好，不覆盖刷新后的仓库数据。`alwaygit.interfaceSettings` 与 `alwaygit.language` 为用户级配置；无用户配置时从旧工作区会话迁移已有偏好，保留草稿与浏览状态。恢复 Webview state 时以当前用户偏好优先；普通会话保存只负责恢复副本，不回写用户配置。同步期间未应用的本地预览继续保留，取消后使用最新共享基线。虚拟列表尺寸由实际字号与密度共同决定。高级 Git 操作策略使用独立的 VS Code 配置 `alwaygit.allowDetachedHead`、`alwaygit.pushFollowTags`、`alwaygit.pushTagAfterCreate` 与 `alwaygit.defaultResetMode`，不写入界面会话；`operationSettings` / `saveOperationSettings` RPC 支持显式 user/workspace 范围并严格校验完整设置，设置页默认编辑用户默认值；用户读取通过 inspect 排除工作区覆盖，用户保存不覆盖已有工作区策略，操作执行始终使用当前有效配置。空窗口拒绝工作区写入；动作对话框未指定范围的“记住默认”沿用当前窗口原有范围规则。应用保存成功后才生效，配置变化广播到所有工作台。Push、Create Tag 与 Reset 弹窗从已应用设置读取初始值，只有用户明确选择“记住为默认”并提交时才回写；普通 saveSession 无法覆盖这些策略。

Git 操作反馈以仓库 ID 保存在前端内存中，操作序号用于避免旧结果替换新操作；仓库切换只展示对应仓库的反馈。错误和结果不写入会话。影响当前工作区的写操作由前端进度遮罩隔离工作台所有背景区域与已有浮窗，并阻止键盘事件；遮罩依赖本地执行集合与宿主忙碌状态的并集，保留到界面同步完成。文件批量选择属于当前文件区域的临时状态，与 Diff 预览目标分离；区域切换或文件消失时重新核对选择。

`action` 响应以可选 `snapshot`、结构化 Push `result` 和 `refreshWarning` 包装，Webview 兼容旧 Snapshot 响应。Push/Tag Push 在写队列中通过 `--porcelain` 记录真实目的地和引用状态；失败仍抛 GitError，并经错误协议传递脱敏的 `pushResult`，不将部分成功转换成全部成功。宿主执行已完成后的快照失败不会反转 Git 结果。`hosting.ts` 负责平台地址解析、分支编码、Fork 比较与远端链接验证；生成网页地址和用户凭据分离。`remoteLinks` 只读本地已解析的 Push URL 与远端 HEAD，`openExternal` 严格校验 HTTPS 和无凭据 URL。结果与链接只保存在当前内存反馈中。

App、History、Sidebar、Details 和 Diff 按各自使用的状态字段订阅；主要面板使用 memo 和稳定的回调，快照中未变化的字段、选择列表和仓库摘要复用引用。内容刷新不重新执行 Working Tree 的主动选择逻辑。Diff 的局部加载、草稿输入与操作反馈不会通过整份 Store 订阅让无关面板重新计算；主题、字号、布局以及实际共享数据变化仍更新相关区域。

右键菜单保存目标对象的稳定身份及来源元素。打开操作对话框后，Git 写操作仍在宿主重新解析和验证引用、Stash 或 工作树；切换仓库会关闭旧菜单和旧对话框。菜单以标准 `menu` / `menuitem` 语义呈现，支持焦点移动、Enter、Space、Escape 和点击外部关闭。仅来源元素或其祖先滚动、窗口缩放及主动关闭操作会收起菜单；Diff 自动定位或其他面板滚动不关闭菜单。

## 内嵌终端

`BottomDock.tsx` 组合固定 Diff 标签与多个终端标签，`dock-store.ts` 保存本工作台运行期的标签与活动对象。旧会话的 `layout.diff` 和 `layout.diffCollapsed` 直接复用为整个底部面板的高度与收起状态，因此不迁移或丢弃已有尺寸、视图及草稿。Diff 控件仅在 Diff 标签活动时注册可执行快捷键；终端输入区域由全局键盘保护识别。`TerminalView.tsx` 延迟加载 xterm.js 与 FitAddon，按主题更新颜色并将可见区域的列数/行数发送给宿主。

`src/protocol/terminal.ts` 定义终端专用校验和事件。宿主要求受信任工作区与真实来源面板；新建只接受已注册仓库 ID、有限 Shell 选项和尺寸，不接受任意路径或命令启动参数。`TerminalSessions` 以来源面板隔离会话，校验输入、关闭、尺寸、重命名、快照与输出确认的所属关系，退出后保留描述信息，面板销毁时释放其全部会话。终端是明确开放的 Shell 输入通道，不使用 Git RPC 的动作白名单、确认或写租约，也不向其他工作台广播终端输出。

`terminal-runtime.ts` 为每个会话启动无窗口辅助进程 `terminal-host.cjs`，由辅助进程延迟加载 node-pty 并管理 PTY。Shell 自然退出后，辅助进程先交付剩余输出与退出码，再退出并释放原生输出线程；关闭/终止请求结束 Shell，辅助进程另有 5 秒终止兜底。Webview 保留隐藏上下文，输出按 16 ms / 32 KiB 分批；宿主只保留约 1 MiB 的内存重连缓冲，xterm 保留 5000 行。输出序号避免快照重放和实时输出重复，128 KiB 未确认输出暂停读取，渲染确认后恢复，防止慢前端无界积压。输出及命令不进入会话持久化或日志。

构建脚本将 node-pty 运行目录复制到 `dist/terminal-runtime/node-pty`，独立打包辅助进程，原生模块不进入 JS Bundle。node-pty 提供的 Windows/macOS 预编译产物随运行目录复制；Linux 需要在其构建环境准备 PTY 原生模块，Windows 本地构建不生成 Linux 模块。Demo 仅回显输入并标明不会执行命令。

## Diff 与原生编辑器

工作台底部 Diff 是只读预览。请求携带明确的比较目标，例如 Working Tree 与 Index、Index 与 HEAD、Commit 与所选父提交。宿主将结果区分为 `text`、`image` 和 `binary`：文本每侧最多读取 256 KiB、呈现 4000 行并返回截断说明；PNG、JPEG、WebP 按文件签名识别，每侧最多读取 4 MiB、单边尺寸最多 16384 像素、总像素最多 2400 万，并以 Base64 数据交给受 CSP 限制的 Webview；空侧表示新增或删除。SVG 保留文本语义，不作为可执行图片载入。其他格式、超限图片和非法编码返回明确原因且不暴露内容。

只有确认后的文本比较可以通过 VS Code 原生 Diff 打开，Git 文本文档的内容上限为 8 MB；普通工作区文本文件使用真实文件 URI。图片和其他二进制在 Webview 中禁用原生 Diff 与编辑入口，接收请求的目标宿主再次读取并分类，拒绝绕过界面的调用。叶节点符号链接使用 readlink 取得 Git 保存的链接文本，以只读虚拟文档比较，不读取目标内容。父目录仍须通过真实路径边界检查，普通打开文本文件继续验证实际目标。

Diff 的加载依赖比较目标的语义身份。历史比较不依赖 Snapshot 版本；工作区比较使用独立的内容刷新代数，根据所选文件路径、Index、相关状态与 Staged 比较的 HEAD 变化失效。来源不明确的通知保守更新当前工作区比较。更新同一个比较时保留旧预览及滚动位置，只有切换比较目标才清空内容并回到顶部。

跨文件导航只在当前普通 Commit 的完整文件列表中查找，每轮最多读取每个文件一次，复用现有 `diffPreview` RPC 和大小限制；文本按连续修改块导航，图片按一个整文件视觉更改导航，其他二进制跳过。前端只保留当前画面与目标预览，不一次载入整个 Commit 内容。目标预览传给当前面板以避免重复读取，定位请求绑定仓库、Commit、Parent、文件与导航模式，取消或切换上下文后丢弃旧响应。

历史中的删除文件没有工作区实体，打开时使用只读 Git 内容。Merge Commit 必须明确比较父提交。冲突比较使用 Index Stage 2/3，并允许打开实际文件解决冲突。

`resolve-and-stage` 表达用户已人工处理后的 Git 标记与暂存，仍通过 `git add` 实现，不证明内容正确。`operationReview` 将当前 Index 写成不可变 Tree，扫描相对 HEAD 的暂存变更，并返回文件、标记行号、未扫描原因及宿主颁发的一次性确认 token。token 绑定工作目录身份、分支、HEAD、Tree 和操作控制文件；Continue 以及活动操作中的 Commit 在共享写队列内重新核对，普通 Stage/Abort 等写操作使已有 token 失效。确认后内容变化不能复用旧确认。每文件最多扫描 2 MiB、累计 16 MiB，未扫描内容必须向用户明确展示；标记检测只用于提醒，不做语义正确性保证。外部 Git 进程仍可能在最后检查与实际 Git 命令间竞争，Git 自身的 Index 锁及执行错误继续生效。

原生 Diff 和文件编辑请求先经项目窗口路由，再在接收方调用 `GitDocuments`；虚拟内容登记只存在于接收宿主。编辑器使用当前组与 `preview: false`，保留既有标签和工作台，避免新增侧边编辑器组。

## 项目窗口路由

`ProjectWindows` 通过 `WindowBridge` 登记每个扩展宿主的真实工作区目录和最近活动时间。登记位于系统临时目录，按 VS Code 数据/Profile、应用和宿主隔离；每个实例独立写入登记并定期续期，不写入仓库或工作台会话。Windows 路径规范化大小写并解析真实目录，工作树 按工作目录区分。

窗口间使用带随机令牌的回环 IPC，只接受预定义请求并重新核对工作区归属和信任状态。匹配优先级为精确目录、包含项目的最长工作区目录、最近活动窗口。接收方调用原生 `workbench.action.focusWindow` 激活自己；旧版通过工作区身份复用已打开窗口，并核对焦点结果。发送方等待执行回执。没有可用目标时以 `vscode.openFolder` 打开项目新窗口并等待扩展登记，超时报告失败。Repository 或 工作树 的项目窗口命令始终创建独立项目窗口，待新宿主登记后发送受限的 `workbench` 请求，由目标窗口注册仓库并显示对应工作台。独立的“在新窗口打开 Workbench”使用 VS Code 空窗口，按新出现的宿主登记定位目标，只发送不带路径的 `show-workbench` 请求，因此不会在入口处隐式选择仓库。目录刷新与活动广播是同一隔离域内的窗口级请求，不要求两个窗口打开同一项目；它们不携带任意命令或 Git 参数。

## Git 操作、并发和错误

Git 使用参数数组与 `shell: false`，引用和路径额外校验，文件操作使用 literal pathspec。Add/Restore/Rm/Reset 的文件范围以 NUL 分隔经标准输入传递，Commit/Tag 消息用 `--file=-`；消息含 NUL 拒绝执行。Clean 按保守参数预算预先划定全部批次，失败明确报告部分完成；不支持标准输入的超长参数在启动前拒绝，Stash 消息在准备现场前检查。命令执行集中在 `runner.ts`，提供输出限制、超时、AbortSignal 和非交互编辑器。停止时等待 Git 与终止器关闭；5 秒宽限后仍不能确认写进程树停止则显式隔离 commonDir，禁止继续写入。认证资源延迟到已知进程句柄关闭后释放；根进程退出本身不证明全部后代已结束。外部 Git 不受内存队列控制，因此 Git 锁和实际返回结果仍是最终依据。

同一个 `commonDir` 同时只执行一个写操作。单宿主仍使用内存忙碌状态；跨宿主使用隔离临时目录登记与 OS 管理的回环端口存活租约，按规范化共享 Git 目录散列。目录级短时端口互斥串行化登记、恢复与释放；存活持有者不因时间戳陈旧失锁，未知监听器、超时及互斥门不可用时保守拒绝。写入前原子记录运行标记，无法确认终止则持久保留保护。宿主死亡遗留的运行记录需原生确认且锁身份与已知进程检查通过才可解除，本次请求不会重放，用户需重新执行；旧格式登记仅按原超时规则兼容迁移。活动开始与结束通过窗口桥同步给其他宿主，并映射到该 Git 存储下所有已注册 工作树；广播失败只记录，清理始终执行；行动前与轮询核对实际租约，丢失结束通知可恢复。广播只负责界面反馈，租约才是执行互斥边界，外部 Git 仍由 Git 自身锁保护。GitService 在写队列内动态读取宿主提供的 Detached HEAD 策略，显式 Commit/Tag Checkout、Detached Stash 重试及显式或隐式 Detached 工作树 默认拒绝；Stash 创建和实际切换前再次校验，避免配置在预检期间变化。Rebase 内部操作保持原有流程。Checkout 在宿主检查当前分支、未提交修改、未解决冲突和 工作树 占用。远程分支本地化使用完整 `refs/remotes/*` 来源和预期 OID；批量创建在任何写入前验证全部本地名称、upstream、符号引用与层级冲突，批量创建与单项创建并切换均先按固定源 OID 创建引用，再设置 upstream；upstream 失败时准确报告已保留分支，只有单项创建并切换继续执行普通 Checkout；引用或 upstream 失败不进入 Stash 或文件切换，Checkout 受阻保留分支并支持原跟踪动作重试。`Stash Changes & Checkout` 的 Stash 与 Checkout 分别报告结果；若远程分支 Checkout 受阻，重试保留原来源、名称和 OID；若 Stash 成功但 Checkout 失败，保留 Stash，不隐式恢复或删除。Stash 保存与恢复由 `stash.ts` 提供隔离状态支持，恢复的结构化阻塞结果交由 Webview 展示；具体流程见下节。

### 所选文件提交

`selected-commit.ts` 从当前 HEAD 构造独立 Index，按所选来源合入 Index 或磁盘版本；真实 Index 持锁，成功后只回写所选路径，未选暂存内容保留。`selected-commit-hooks.ts` 为该次提交使用临时 Hooks 目录，委托原有 Hook（包含自定义 `core.hooksPath`）执行；`reference-transaction` 在 prepared 阶段比较实际候选提交 Tree 与仅覆盖所选路径的投影，范围外更改拒绝更新 HEAD。所选文件的 Hook 格式化允许保留，消息 Hook、签名及提交后 Hook 继续由原生 Commit 执行；命令级配置不覆盖已有环境配置。Git 进程树尚未确认停止时，延迟清理临时文件。Hook 的磁盘副作用不保证回滚。

### Stash 保存与隔离恢复

`stash-drop.ts` 在 Git files 后端的 `refs/stash.lock` 与 packed refs 锁内读取 reflog，核对原序号对应的已确认 OID 后重写日志链与引用，避免外部 Git 插入条目后误删。支持非顶部条目、packed refs、共享工作树及 SHA256；reftable 或无法核验的路径与文件类型拒绝删除。发布失败尝试回滚，回滚失败保留恢复副本和锁并显示路径。该流程保证与遵守 Git 引用锁的客户端之间的身份核验，不承诺多文件断电原子性。只读请求作用域在动作入口拒绝写入，包括此处直接文件操作。

`stash.create` 不带 paths 表示全局范围；非空 paths 表示精确所选文件范围，空数组拒绝执行。选中一侧仍以文件为单位保存完整 Index 与 Working Tree，所选未跟踪文件随该范围保存。所选暂存 Tree 以 HEAD 为基线，仅覆盖选中路径；不能直接把整个 Index 当作存档的暂存 parent，否则未选中的暂存修改也会进入存档。清理只作用于所选范围，其他文件状态保持。交互规则由 [工作台规格](WORKBENCH_SPEC.md#working-tree-与-diff) 维护。

恢复先解析固定 Stash OID，检查未跟踪路径占用，再捕获 HEAD、原始 Index 字节、split Index 的共享文件、相关本地文件、有效配置与属性来源。工作区根及相关祖先目录的 `.gitattributes` 独立捕获，不受 ignore 过滤；缺失来源也进入指纹，属性的创建、删除和改动均使旧现场失效，属性链接不跟随。在临时独立 Git 目录中复制原始 Index 和文件内容，以只读 object alternates 读取源仓库对象；副本的 Index、工作树和新对象写入均留在临时目录。隔离命令抑制全局配置、hooks 和外部程序执行，保留受支持的 Git 合并与属性语义。在副本运行 `stash apply --index`，读取冲突或错误；失败返回包含原因、路径、Stash 身份、存档保留及本次未改动真实现场的结构化 blocker。

试恢复成功后重新捕获并比较 fingerprint，覆盖 HEAD、Index、本地文件、配置、属性与 split Index 共享内容；发现变化则停止。随后真实仓库执行 `stash apply --index`；默认保留存档，显式 Pop 仅在 Apply 成功后调用同一安全删除入口；删除失败明确报告已恢复更改及仍保留的存档，防止重复 Apply。外部进程仍可能在最后核对后修改现场，正式写入也可能失败，因此预检不提供真实 Apply 的原子回滚保证。临时目录在结束时清理，清理前校验它属于预定系统临时目录。

隔离依赖 Git 2.43 或更新版本读取系统/全局属性来源。支持范围按能否准确复现现场判断：sparse checkout、受影响的 gitlink/submodule、活动的外部 filter、自定义 merge driver 或默认外部 merge driver 均拒绝隔离；单文件超过 32 MiB 或本地文件快照累计超过 128 MiB 也拒绝。非普通且无法受支持地复制的文件类型、无法完整复制的占位目录，以及路径父级的符号链接会阻止操作；可完整复制的普通文件与受支持的叶子符号链接按实际状态复制。这些边界限定 AlwayGit 的隔离试验能力，不是 Git Stash 本身的限制；遇到不支持的现场不会退回真实仓库试运行。

Fetch、Pull 和 Push 沿用系统 Git Credential Helper、SSH Agent 和配置。需要输入时，使用每条命令独立的回环 IPC AskPass 桥接到 VS Code 输入框。桥接使用随机令牌；Git 超时、取消或输出超限立即取消输入框，连接关闭也取消对应输入。认证桥资源在进程及终止句柄关闭后释放，终止未确认时继续保留写隔离。Fetch、Pull、Push 默认有 10 分钟宿主命令预算，普通查询默认 60 秒；Webview 的 action 等待宿主结果，不以读请求的 180 秒超时提前报告失败，原生确认等待不消耗 Git 命令预算。凭据不持久化，也不传到 Webview。日志与前端错误统一隐藏 URL userinfo、认证查询参数及 Authorization。每条 Git 命令独立进行 UTF-8 流解码，完整行脱敏后才交付日志；末尾残留在结束时处理，超过缓冲上限的行安全省略，跨管道块不输出凭据片段。

Snapshot 为当前分支解析 Push 目标，依次考虑 `branch.<name>.pushRemote`、`remote.pushDefault`、分支 remote、upstream 和唯一远端，并把本地分支、远端分支及 upstream 状态作为结构化数据交给 Webview。Push 对话框提交明确的本地与远端 refspec；远端分支名可以与本地分支名不同。首次建立跟踪时才请求 `--set-upstream`，已有 upstream 的普通 Push 不隐式改变跟踪关系。分支 Push 始终显式选择 `--follow-tags` 或 `--no-follow-tags`，不继承 Git 配置的隐式行为；开启时只附带该分支可达且远端缺少的注解 Tag。

Tag Push 使用独立的 `tag.push` 动作和固定对象的 `<confirmedOid>:refs/tags/<name>` refspec，可从单个或多选 Tag 菜单进入。对话框绑定打开时捕获的原始 Tag 对象 OID，宿主在任何网络写入前复核全部选择；注解 Tag 不使用 peeled Commit OID。每个 Tag 单独推送并汇总部分失败，显式 `--no-follow-tags` 防止 Git 配置附带未选择的 Tag；远端同名 Tag 不同且未明确提供替换操作时由 Git 拒绝覆盖。Tags 标题的 Create Tag 不继承 HEAD 或历史选择，目标为空且必须显式输入；提交图入口捕获被右键行的 Commit OID 和 Message，并把目标锁定为只读，添加 Remote 后返回仍保留该身份。可编辑目标在提交前解析为完整 Commit OID，避免创建过程中引用移动。Create Tag 可按设置默认值或本次勾选，在本地创建成功后只把新 Tag 推送到所选 Remote；远端推送失败以部分失败报告，本地 Tag 保留，供显式 Tag Push 重试。

本地分支删除先捕获确认的 OID，逐项通过 `update-ref --no-deref -d <ref> <expectedOid>` 原子比较删除，避免核验后引用被替换时误删新分支。实际写入前重新检查工作树占用；普通删除以有效 upstream 或当前 HEAD 判断已合并，强制删除仍检查占用。删除后清理原分支配置和 reflog，已重新创建的分支保留配置；批量操作报告部分失败，无法确认进程终止时停止后续写入。

Tag 删除绑定打开对话框时捕获的本地与远端原始引用对象 OID（注解 Tag 不使用 peeled Commit OID）。远端确认同时冻结读取和 Push 地址指纹；尚未查询的目标只接受地址不变时的首次查询，后续刷新不能替换已确认 OID。地址或对象变化时禁用提交并提示重开，提交处理再次检查当前状态；显式选择另一 Tag 或 Remote 时重新捕获身份。本地删除通过 `update-ref --no-deref -d <ref> <expectedOid>` 原子比较，陈旧或缺失身份拒绝操作；符号引用不递归删除目标。远端删除只在读取地址与唯一 Push 地址一致时开放，提交前同时固定远端 OID 和 Push 地址指纹，并使用显式 `--force-with-lease=<ref>:<oid>` 删除，避免覆盖核对后被他人替换的同名 Tag。组合删除先写远端，成功后再比较删除本地；远端失败时本地保留，远端成功后本地发生竞态则报告部分失败并保留新的本地对象。

远端删除与 Force-with-lease 在确认时固定远端 OID 和 Push 地址指纹；执行使用显式 `--force-with-lease=<ref>:<oid>`，空 OID 表示仅允许仍不存在的目标。后台 Fetch 不更新已确认 OID；地址变化、缺少确认或多个 Push 地址拒绝危险操作。核验后捕获唯一地址，使用命令级 `remote.<name>.pushurl` 空值清空列表，再指定已捕获地址，避免后续 pushurl 修改重定向本次操作。临时私有系统配置首先添加整个捕获地址的原样 insteadOf 规则，再包含原系统配置；整个地址的最长匹配及最前位置阻止后续 URL rewrite 重定向，同时保留系统设置、全局和仓库配置、远端名称、upstream 和跟踪引用，不修改持久配置。临时文件随进程结束清理，未确认终止时延迟到进程句柄关闭。发送前以同一覆盖只读解析地址，无法证明固定为唯一捕获地址时停止；[Git 的空值清空列表语义](https://git-scm.com/docs/git-config#Documentation/git-config.txt-remotenamepushurl)要求 Git 2.46 或更新版本。指纹不向 Webview 暴露含凭据的地址。批量删除逐项报告成功与失败，终止未确认立即停止后续操作。

Reset、Merge 和 Rebase 在确认前将目标解析为固定 Commit OID，并绑定对话框打开时显示的当前分支与 HEAD，后台刷新不替换该身份；宿主确认后在共享写队列内再次核对，现场变化时拒绝操作，要求刷新后重新确认。Reset 原生确认显示当前分支、HEAD 与固定目标。外部 Git 仍可能在最后核对后竞争，Git 锁与执行错误继续生效。

高风险操作由宿主执行明确确认。提交遇到未保存编辑器内容时说明 Git 提交的是 Index。Git hooks、签名、认证和网络错误反馈真实失败，不尝试绕过。

## 安全边界

未受信任工作区不执行 Git。Webview 使用 CSP、脚本 nonce 和受限资源目录。工作区文件打开会校验目录边界和符号链接祖先；只有已注册的非 Bare 工作树 可通过工作台打开。剪贴板和新窗口操作由宿主处理，Webview 只提交经过协议约束的数据。

## 开发流程与文档维护

提交、验证与本机更新规则统一见 [项目协作规则](../AGENTS.md)，检查命令与覆盖边界见 [验证与本地更新](VALIDATION.md)。Demo 验证呈现与请求，真实临时仓库验证 Git，宿主集成验证 VS Code 原生能力。

README 只维护启动、主要功能和导航；交互与配置归工作台规格；模块与跨层设计归本文；检查方法和证据归验证文档；已确认问题归问题日志。实现状态以当前代码与规格为依据，验证结论必须注明对应版本和范围，不根据旧记录推定新版本已通过。

应用内帮助直接导入双语用户手册，章节 ID 由两版共用，主题入口集中在 `webview/help-content.ts`；正文与截图不在应用中维护第二份副本。新增独立任务需要同时补齐双语锚点和对应分类入口。截图场景集中在 `scripts/capture-manual.mjs`，采集、检查和替换流程见 [截图维护](VALIDATION.md#用户手册截图维护)。

## 当前维护边界

- GitService 仍组合查询、动作校验与执行，Workbench 保留路由与用例协调，Store 保留统一界面状态入口。已独立提取 runner、会话持久化、查询与快照协调和引用索引；后续按具体改动的独立职责拆分，避免仅按行数拆文件。
- History 已虚拟化，Working Tree、Commit Details、Commit 比较和 Stash 文件列表共用 `VirtualFileRows`。后续性能优化继续测量可见行、筛选与选择成本及交互延迟，不仅以 DOM 数量推断整体性能；已有专项结果见验证文档。
- Stash 隔离以准确复制现场为前提，当前保留完整捕获与大小限制。缩小复制范围需要证明不会遗漏属性、Index 和未选中修改，不能只为降低读取量放宽隔离保护。
- 分块暂存、交互式 Rebase、Squash/Fixup 属于当前功能范围外的独立需求，本次结构治理不引入这些操作。
