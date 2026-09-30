# 架构与开发约定

本文维护 AlwayGit 的运行结构、代码入口、跨层约定和开发流程。产品行为以 [工作台规格](WORKBENCH_SPEC.md) 为准，检查方法和验证证据见 [验证与本地更新](VALIDATION.md)，协作要求见 [项目规则](../AGENTS.md)。

## 运行结构

AlwayGit 是 Workspace 类型的 VS Code 扩展。每个 React WebviewPanel 提供一个独立工作台标签，Node.js 扩展宿主管理面板集合，并共享 Git 子进程、仓库发现、剪贴板、窗口和文件操作。Webview 不直接读取磁盘，也不执行 Git。

`src/protocol` 是 Webview 和宿主的共享边界。请求以 `id` 关联响应，Zod 在宿主入口验证方法与参数；宿主主动发布仓库变更、操作活动和仓库选择事件。宿主只接受已经注册的仓库及预定义方法，不暴露任意命令执行接口。

## 模块边界

| 目录 | 主要入口 | 职责 |
| --- | --- | --- |
| `src/extension` | `extension.ts`、`workbench.ts`、`project-windows.ts` | 扩展激活、面板集合、RPC 路由、VS Code 命令和生命周期 |
| `src/application` | `confirm.ts`、`credentials.ts`、`window-bridge.ts`、`logging.ts` | 操作确认、认证与窗口 IPC、日志脱敏和用例协调 |
| `src/git` | `service.ts`、`default-branch.ts` | 系统 Git 执行、结构化解析、查询、操作及共享仓库队列 |
| `src/repositories` | `manager.ts`、`discovery.ts` | 仓库注册、递归发现、文件监听和活动栏仓库导航 |
| `src/editor` | `paths.ts`、`documents.ts` | 安全路径解析、Git 内容文档、只读预览和 VS Code 原生 Diff |
| `src/protocol` | `types.ts`、`validation.ts`、`repositories.ts` | 数据模型、RPC 请求响应、运行时校验和仓库展示分组 |
| `webview` | `App.tsx`、`store.ts`、`rpc.ts` | React 组合、Zustand 状态、宿主桥接和 Demo |
| `webview` | `Sidebar.tsx`、`History.tsx`、`Details.tsx`、`DiffPreview.tsx` | 四区呈现、对象选择和只读比较 |
| `webview` | `menus.ts`、`SettingsDialog.tsx`、`appearance.ts`、`i18n.ts` | 动作定义、界面设置、外观和语言 |
| `webview` | `refresh.ts`、`fileSelection.ts`、`commitSelection.ts`、`diff.ts` | 刷新失效范围、选择规则和修改块导航 |
| `webview/graph` | `layout.ts`、`GraphRow.tsx`、`palettes.ts` | 可分页的轨道布局、SVG 行渲染和配色 |

共享协议先于两端实现修改。新增宿主能力时，应依次维护共享类型与校验、宿主路由、Git 或编辑器实现、Webview 调用和真实仓库测试。Webview 菜单及工具栏应复用相同的动作描述和执行入口，避免同一 Git 操作出现不同参数或禁用规则。

## 仓库、引用和历史

Repository 标识工作目录，`commonDir` 标识共享 Git 存储。同一存储的多个 Worktree 共用写操作队列，但保持独立的 HEAD、Index 和工作区状态。写操作在执行前重新验证仓库、引用和 Worktree 状态。

Git 发现比较 Git 目录与共享目录识别主工作目录；linked Worktree 使用 `worktree list` 返回的主目录维护可选 `mainRoot`，独立存储的普通仓库仍使用自身工作目录。不根据 `.git` 文件类型或远端 URL 推断归属。共享纯函数 `src/protocol/repositories.ts` 按规范化 `commonDir` 派生顶层展示分组，供 Webview 与活动栏使用；活动工作目录仍为实际操作目标。RepositoryManager 和 RPC 保留完整工作目录列表及原路径 ID，旧保存路径、会话和草稿无需重写；扫描数量以逻辑仓库分组计数，新增 Worktree 即使不增加仓库数也发布列表变化。

手动添加目录由 `src/repositories/discovery.ts` 使用异步迭代遍历，仅对有 `.git` 标记的候选目录调用 Git 验证，并在有效仓库处停止深入。扫描结果由 RepositoryManager 批量去重、注册监听、保存和发布一次列表变更；扫描取消则不注册。用户主动添加的仓库路径保存在扩展 `globalState` 中，在同一 VS Code Profile 和运行环境的窗口间共享；首次启动会合并旧 `workspaceState` 路径完成兼容迁移。启动恢复只重新验证已保存路径及 VS Code 提供的仓库，不重复递归扫描分类目录。本地路径不参与 Settings Sync。

Status 使用 porcelain v2 与 NUL 分隔，分别保存 Index 和工作区状态。历史查询接受一组完整引用名；首次查询固定 tips，后续分页沿用同一组 tips，避免翻页过程中引用移动造成重复或遗漏。多个引用的结果使用 Git 可达提交并集，共同祖先只返回一次。图算法的 pending lanes 跨页延续，虚拟列表只渲染可见行。

前端对异步请求使用仓库代数和请求代数，忽略切换仓库、刷新或重新筛选后返回的旧响应。宿主 Snapshot 具有单调版本，补偿刷新使用不含版本字段的指纹识别实际变化。文件监听携带相对工作区路径和 Index 变化标记，宿主与前端的防抖均合并变化范围；重叠 Snapshot 请求沿用尚未消费的变化范围，避免遗漏已处于 dirty 状态的文件内容更新。

后台刷新只在已选引用的 OID 或选择范围变化时重读 History；手动 Refresh 仍重新查询 History。已加载的 Commit 详情按仓库、OID 和所选 Parent 保留，History 查询不重新选择同一个 Commit。Merge Parent 作为可选会话字段保存，兼容既有 version 2 会话。

## 工作台状态

状态分为三类：

- 仓库数据：Snapshot、History 页面、Commit 详情和 Diff 预览。
- 每仓库视图：已勾选引用、引用目录展开状态、侧栏分区折叠状态、搜索、当前 Commit、文件、Stash、活动区域和 Commit 草稿。
- 全局界面：语言、主题、可编辑的浅色/深色 Graph 色板与主线颜色、界面与 Diff 字号、密度、面板尺寸和表格列宽。

会话写入各自的 VS Code Webview state，并由扩展宿主把最近状态保存到 `workspaceState` 作为新标签和兼容恢复的基线。多个标签具有独立的活动仓库与前端选择状态；宿主按请求来源定向响应和切换仓库，仓库变化与 Git 活动事件广播到全部标签。补偿刷新覆盖所有可见标签当前仓库，并按仓库去重。Demo 模式使用浏览器 localStorage。持久化的数据只包含界面状态，不包含凭据、Git 输出或文件内容。

version 2 会话通过可选 `appearance` 字段兼容新增设置，宿主协议验证后保留；旧会话缺少自定义色值时使用当前预设生成完整浅色/深色色板。旧 Editor Focus 迁移为 Workbench，旧默认 26 px 行高迁移为 24 px，其余尺寸和草稿保留。设置浮窗使用内存基线实现实时预览，订阅持久化时仍写入基线，应用后才保存新值；取消只恢复设置，不覆盖刷新后的仓库数据。虚拟列表尺寸由实际字号与密度共同决定。

Git 操作反馈以仓库 ID 保存在前端内存中，操作序号用于避免旧结果替换新操作；仓库切换只展示对应仓库的反馈。错误和结果不写入会话。文件批量选择属于当前文件区域的临时状态，与 Diff 预览目标分离；区域切换或文件消失时重新核对选择。

右键菜单保存目标对象的稳定身份及仓库 ID。打开操作对话框后，Git 写操作仍在宿主重新解析和验证引用、Stash 或 Worktree；切换仓库会关闭旧菜单和旧对话框。菜单以标准 `menu` / `menuitem` 语义呈现，支持焦点移动、Enter、Space、Escape 和点击外部关闭。

## Diff 与原生编辑器

工作台底部 Diff 是只读预览。请求携带明确的比较目标，例如 Working Tree 与 Index、Index 与 HEAD、Commit 与所选父提交。宿主读取限定仓库中的内容；每侧最多读取 256 KiB、呈现 4000 行，并返回截断或二进制说明。完整比较仍通过 VS Code 原生 Diff 打开，Git 文本文档的内容上限为 8 MB；工作区文件使用真实文件 URI，可继续在普通编辑器中修改。

Diff 的加载依赖比较目标的语义身份。历史比较不依赖 Snapshot 版本；工作区比较使用独立的内容刷新代数，根据所选文件路径、Index、相关状态与 Staged 比较的 HEAD 变化失效。来源不明确的通知保守更新当前工作区比较。更新同一个比较时保留旧预览及滚动位置，只有切换比较目标才清空内容并回到顶部。

历史中的删除文件没有工作区实体，打开时使用只读 Git 内容。Merge Commit 必须明确比较父提交。冲突比较使用 Index Stage 2/3，并允许打开实际文件解决冲突。

原生 Diff 和文件编辑请求先经项目窗口路由，再在接收方调用 `GitDocuments`；虚拟内容登记只存在于接收宿主。编辑器使用当前组与 `preview: false`，保留既有标签和工作台，避免新增侧边编辑器组。

## 项目窗口路由

`ProjectWindows` 通过 `WindowBridge` 登记每个扩展宿主的真实工作区目录和最近活动时间。登记位于系统临时目录，按 VS Code 数据/Profile、应用和宿主隔离；每个实例独立写入登记并定期续期，不写入仓库或工作台会话。Windows 路径规范化大小写并解析真实目录，Worktree 按工作目录区分。

窗口间使用带随机令牌的回环 IPC，只接受预定义请求并重新核对工作区归属和信任状态。匹配优先级为精确目录、包含项目的最长工作区目录、最近活动窗口。接收方调用原生 `workbench.action.focusWindow` 激活自己；旧版通过工作区身份复用已打开窗口，并核对焦点结果。发送方等待执行回执。没有可用目标时以 `vscode.openFolder` 打开项目新窗口并等待扩展登记，超时报告失败。Repository 或 Worktree 的“在新窗口打开 Workbench”始终创建独立项目窗口，待新宿主登记后发送受限的 `workbench` 请求，由目标窗口注册仓库并显示对应工作台。

## Git 操作、并发和错误

Git 使用参数数组与 `shell: false`，引用和路径额外校验，文件操作使用 literal pathspec。子进程有输出限制、超时和非交互编辑器；超时终止子进程树。外部 Git 不受内存队列控制，因此 Git 锁和实际返回结果仍是最终依据。

同一个 `commonDir` 同时只执行一个写操作，忙碌状态同步给该 Git 存储下所有已注册 Worktree。Checkout 在宿主检查当前分支、未提交修改、未解决冲突和 Worktree 占用。远程分支本地化使用完整 `refs/remotes/*` 来源和预期 OID；批量创建在任何写入前验证全部本地名称、upstream、符号引用与层级冲突，单项创建并切换通过带 `--track` 的 `switch -c` 原子建立本地分支和跟踪关系。`Stash Changes & Checkout` 的 Stash 与 Checkout 分别报告结果；若远程分支 Checkout 受阻，重试保留原来源、名称和 OID；若 Stash 成功但 Checkout 失败，保留 Stash，不隐式恢复或删除。

Fetch、Pull 和 Push 沿用系统 Git Credential Helper、SSH Agent 和配置。需要输入时，使用每条命令独立的回环 IPC AskPass 桥接到 VS Code 输入框。桥接使用随机令牌并在命令结束后关闭；凭据不持久化，也不传到 Webview。日志与前端错误隐藏 URL 中的认证信息。

Snapshot 为当前分支解析 Push 目标，依次考虑 `branch.<name>.pushRemote`、`remote.pushDefault`、分支 remote、upstream 和唯一远端，并把本地分支、远端分支及 upstream 状态作为结构化数据交给 Webview。Push 对话框提交明确的本地与远端 refspec；远端分支名可以与本地分支名不同。首次建立跟踪时才请求 `--set-upstream`，已有 upstream 的普通 Push 不隐式改变跟踪关系。

高风险操作由宿主执行明确确认。提交遇到未保存编辑器内容时说明 Git 提交的是 Index。Git hooks、签名、认证和网络错误反馈真实失败，不尝试绕过。

## 安全边界

未受信任工作区不执行 Git。Webview 使用 CSP、脚本 nonce 和受限资源目录。工作区文件打开会校验目录边界和符号链接祖先；只有已注册的非 Bare Worktree 可通过工作台打开。剪贴板和新窗口操作由宿主处理，Webview 只提交经过协议约束的数据。

## 开发流程与文档维护

1. 阅读 README、相关工作台规格和本文，检查 `git status --short`；保留现有未提交修改。
2. 对照当前行为界定改动。同一需求的相关修改集中完成，独立功能或问题分别提交；仅已确认的问题进入 [问题日志](ISSUES.md)。
3. 跨层能力先维护协议类型和运行时校验，再修改宿主、Git 或编辑器实现及 Webview。调整会话时兼容已有状态和草稿。
4. 按 [验证与本地更新](VALIDATION.md) 选择最小必要检查。Demo 验证呈现与请求，真实临时仓库验证 Git，宿主集成验证 VS Code 原生能力。
5. 更新对应的长期文档，检查链接、图片与旧文件名引用，按 [项目规则](../AGENTS.md) 创建本地提交。扩展修改通过检查后执行规定的本机更新流程。

README 只维护启动、主要功能和导航；交互与配置归工作台规格；模块与跨层设计归本文；检查方法和证据归验证文档；已确认问题归问题日志。实现状态以当前代码与规格为依据，验证结论必须注明对应版本和范围，不根据旧记录推定新版本已通过。
