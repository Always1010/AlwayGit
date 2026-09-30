# 架构与开发约定

本文维护 AlwayGit 的运行结构、模块边界和跨层约定。产品行为以 [工作台规格](WORKBENCH_SPEC.md) 为准，当前进展以 [开发交接](DEVELOPMENT_HANDOFF.md) 为准。

## 运行结构

AlwayGit 是 Workspace 类型的 VS Code 扩展。React WebviewPanel 提供工作台，Node.js 扩展宿主负责 Git 子进程、仓库发现、剪贴板、窗口和文件操作。Webview 不直接读取磁盘，也不执行 Git。

`src/protocol` 是 Webview 和宿主的共享边界。请求以 `id` 关联响应，Zod 在宿主入口验证方法与参数；宿主主动发布仓库变更、操作活动和仓库选择事件。宿主只接受已经注册的仓库及预定义方法，不暴露任意命令执行接口。

## 模块边界

| 目录 | 职责 |
| --- | --- |
| `src/extension` | 扩展激活、WebviewPanel、RPC 路由、VS Code 命令和生命周期 |
| `src/application` | 操作确认、认证桥接、日志脱敏和面向用例的协调 |
| `src/git` | 系统 Git 执行、结构化解析、查询、操作及共享仓库队列 |
| `src/repositories` | 仓库注册、文件监听和活动栏仓库导航 |
| `src/editor` | 安全路径解析、Git 内容文档、只读预览和 VS Code 原生 Diff |
| `src/protocol` | 数据模型、RPC 请求响应和运行时校验 |
| `webview` | React 工作台、菜单与对话框、Zustand 状态、会话和主题 |
| `webview/graph` | 可分页的轨道布局及 SVG 行渲染 |

共享协议先于两端实现修改。新增宿主能力时，应依次维护共享类型与校验、宿主路由、Git 或编辑器实现、Webview 调用和真实仓库测试。Webview 菜单及工具栏应复用相同的动作描述和执行入口，避免同一 Git 操作出现不同参数或禁用规则。

## 仓库、引用和历史

Repository 标识工作目录，`commonDir` 标识共享 Git 存储。同一存储的多个 Worktree 共用写操作队列，但保持独立的 HEAD、Index 和工作区状态。写操作在执行前重新验证仓库、引用和 Worktree 状态。

Status 使用 porcelain v2 与 NUL 分隔，分别保存 Index 和工作区状态。历史查询接受一组完整引用名；首次查询固定 tips，后续分页沿用同一组 tips，避免翻页过程中引用移动造成重复或遗漏。多个引用的结果使用 Git 可达提交并集，共同祖先只返回一次。图算法的 pending lanes 跨页延续，虚拟列表只渲染可见行。

前端对异步请求使用仓库代数和请求代数，忽略切换仓库、刷新或重新筛选后返回的旧响应。宿主 Snapshot 具有单调版本，补偿刷新使用不含版本字段的指纹识别实际变化。

## 工作台状态

状态分为三类：

- 仓库数据：Snapshot、History 页面、Commit 详情和 Diff 预览。
- 每仓库视图：已勾选引用、引用目录展开状态、侧栏分区折叠状态、搜索、当前 Commit、文件、Stash、活动区域和 Commit 草稿。
- 全局界面：语言、布局预设、面板尺寸和表格列宽。

会话写入 VS Code Webview state，并由扩展宿主保存到 `workspaceState` 以支持面板重建。Demo 模式使用浏览器 localStorage。持久化的数据只包含界面状态，不包含凭据、Git 输出或文件内容。

右键菜单保存目标对象的稳定身份及仓库 ID。打开操作对话框后，Git 写操作仍在宿主重新解析和验证引用、Stash 或 Worktree；切换仓库会关闭旧菜单和旧对话框。菜单以标准 `menu` / `menuitem` 语义呈现，支持焦点移动、Enter、Space、Escape 和点击外部关闭。

## Diff 与原生编辑器

工作台底部 Diff 是只读预览。请求携带明确的比较目标，例如 Working Tree 与 Index、Index 与 HEAD、Commit 与所选父提交。宿主读取限定仓库中的内容；每侧最多读取 256 KiB、呈现 4000 行，并返回截断或二进制说明。完整比较仍通过 VS Code 原生 Diff 打开，Git 文本文档的内容上限为 8 MB；工作区文件使用真实文件 URI，可继续在普通编辑器中修改。

历史中的删除文件没有工作区实体，打开时使用只读 Git 内容。Merge Commit 必须明确比较父提交。冲突比较使用 Index Stage 2/3，并允许打开实际文件解决冲突。

## Git 操作、并发和错误

Git 使用参数数组与 `shell: false`，引用和路径额外校验，文件操作使用 literal pathspec。子进程有输出限制、超时和非交互编辑器；超时终止子进程树。外部 Git 不受内存队列控制，因此 Git 锁和实际返回结果仍是最终依据。

同一个 `commonDir` 同时只执行一个写操作，忙碌状态同步给该 Git 存储下所有已注册 Worktree。Checkout 在宿主检查当前分支、未提交修改、未解决冲突和 Worktree 占用。`Stash Changes & Checkout` 的 Stash 与 Checkout 分别报告结果；若 Stash 成功但 Checkout 失败，保留 Stash，不隐式恢复或删除。

Fetch、Pull 和 Push 沿用系统 Git Credential Helper、SSH Agent 和配置。需要输入时，使用每条命令独立的回环 IPC AskPass 桥接到 VS Code 输入框。桥接使用随机令牌并在命令结束后关闭；凭据不持久化，也不传到 Webview。日志与前端错误隐藏 URL 中的认证信息。

Snapshot 为当前分支解析 Push 目标，依次考虑 `branch.<name>.pushRemote`、`remote.pushDefault`、分支 remote、upstream 和唯一远端，并把本地分支、远端分支及 upstream 状态作为结构化数据交给 Webview。Push 对话框提交明确的本地与远端 refspec；远端分支名可以与本地分支名不同。首次建立跟踪时才请求 `--set-upstream`，已有 upstream 的普通 Push 不隐式改变跟踪关系。

高风险操作由宿主执行明确确认。提交遇到未保存编辑器内容时说明 Git 提交的是 Index。Git hooks、签名、认证和网络错误反馈真实失败，不尝试绕过。

## 安全边界

未受信任工作区不执行 Git。Webview 使用 CSP、脚本 nonce 和受限资源目录。工作区文件打开会校验目录边界和符号链接祖先；只有已注册的非 Bare Worktree 可通过工作台打开。剪贴板和新窗口操作由宿主处理，Webview 只提交经过协议约束的数据。

## 验证

单元测试覆盖协议、路径、历史图布局、渲染、状态恢复和认证桥。Git 测试使用系统临时目录中的真实仓库及本地 Bare Remote。VS Code 集成测试验证扩展激活、仓库发现、RPC、原生 Diff、文件编辑、剪贴板和窗口入口。浏览器测试验证构建后的工作台布局、菜单、筛选、会话、键盘和响应式行为；显式 `?demo=1` 模式只修改样例数据。

构建输出、VSIX、截图、测试报告和缓存位于忽略范围。验证命令及当次结果记录在 [验证说明](VALIDATION.md)。
