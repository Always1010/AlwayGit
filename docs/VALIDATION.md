# 验证与本地更新

[English](VALIDATION.en.md) | [返回项目首页](../README.md)

本文维护检查入口、验收范围、验证证据和本机更新流程。验收矩阵描述应覆盖的行为；已有执行结果只对注明的版本与范围有效。当前源码版本以 `package.json` 为准。

<a id="check-selection"></a>

## 检查选择

根据改动选择必要检查，不依次执行全部命令。同一目的的修改集中验证；修复失败后只重跑受影响部分。单纯文档修改检查链接、图片、旧文件名引用与 `git diff --check`，不重跑功能测试。会弹出窗口的宿主集成测试需按 [项目规则](../AGENTS.md) 先取得用户明确同意。

| 改动范围 | 检查入口 | 说明 |
| --- | --- | --- |
| TypeScript 类型与跨层协议 | `npm run typecheck` | 无界面，不生成产物 |
| 中英文资源和文案调用 | `npm run i18n:check` | 检查重复 / 未知 / 未使用 key、语言与单复数回退、参数一致性、核对状态、生成文件同步，以及界面展示位置和常见自然语言硬编码；动态数据与 Demo 示例不作为文案 |
| 资源生成与文案核对表 | `npm run i18n:generate` / `npm run i18n:export` | 前者更新派生类型与静态清单资源；后者生成忽略的 CSV，不把导出表提交到 Git |
| 明确模块的逻辑或 Git 行为 | `npx vitest run tests/<相关文件>.test.ts` | 选择实际相关文件；Git 测试使用临时真实仓库及本地 Bare Remote |
| 影响范围无法可靠缩小的核心变更 | `npm test` | 全量 Vitest；说明为何需要扩大范围 |
| 构建或扩展实现 | `npm run build` | 生成扩展和 Webview 产物，构建本身不证明行为正确 |
| 浏览器专项 | 先构建，再使用下表的 `node scripts/test-ui.mjs --…-only` | 无头 Playwright，验证构建产物；单个专项不运行全部 UI 检查 |
| 整体界面交互 | `npm run test:ui` | 先构建再运行完整浏览器验收 |
| VS Code API 与扩展宿主 | `npm run test:extension` | 先构建；会启动 Extension Development Host |
| 跨窗口路由 | `npm run test:windows` | 先构建；会启动并切换测试窗口，可能影响桌面焦点 |

浏览器专项入口：

| 参数 | 主要范围 |
| --- | --- |
| `--locations-only` | 位置弹窗的中英文、编辑器/两个窄侧栏/矮面板适配、四个复选框和默认下拉、取消/关闭/Esc、默认回退、空选择拦截、应用持久化、关闭后打开默认位置与启动页保存失败重试；原生标题齿轮投递由单元测试覆盖，真实 VS Code 容器需另做桌面验收 |
| `--docking-only` | 停靠工作台在窄侧栏和矮面板中的区域导航、选择保留、溢出边界、固定的刷新/设置/更多入口、单层菜单原图标与统一尺寸、菜单导航和焦点恢复及放大后的并排布局；实际 VS Code 停靠操作需另做宿主验收 |
| `--workbench-only` | 整体布局、基础导航和宿主入口 |
| `--project-only` | 打开当前窗口仓库目录的中英文短提示、重复点击续期、三秒消失、O 快捷键、窄窗口、其他窗口及错误反馈、迟到响应与草稿保留；原生资源管理器动作需另做宿主验收 |
| `--terminal-only` | Diff 与多终端标签、目录隔离、终端键盘保护、菜单导航与焦点恢复、重命名、关闭/自然退出后重启、折叠、最大化与标签列表 |
| `--branch-only` | 分支创建、Detached HEAD 策略与 Push 引导 |
| `--tag-status-only` | 标签侧栏和 Graph 状态、对象差异、远端切换、核对详情、主题布局及查询失败恢复 |
| `--cherry-pick-only` | Commit 菜单祖先关系禁用、过期查询取消与历史重新应用确认 |
| `--stash-only` | Stash 详情、保存范围及恢复受阻 |
| `--refresh-only` | 后台刷新、选择保留和 Diff 更新 |
| `--appearance-only` | 设置、主题、配色、字体、尺寸与恢复布局 |
| `--shortcuts-only` | 工作台全局单键、输入与输入法保护、弹窗和菜单优先级、按键目标、禁用/长按、Diff 折叠后跳转、整组确认与设置重载 |
| `--help-only` | 中英文离线帮助、空仓库入口、章节定位、筛选、图片与 CSP、窄窗口、键盘焦点及查看状态保留 |
| `--files-only` | 文件状态与选择、两种列表模式及持久化、全量按钮与快捷键范围、提交清单去重与版本、取消勾选、草稿、窄窗口和大型列表 |
| `--history-only` | Commit / Working Tree 行、选择、比较、键盘、加载范围提示、延迟/失败/重试、返回和当前分支恢复 |
| `--diff-only` | 完整修改块统计、分页文本与大文件末尾、超大行数滚动、加载/失败状态、单文件与 Commit 跨文件循环、设置保存、Parent 切换和内容更新 |
| `--worktrees-only` | 仓库归并、Worktree 选择及草稿隔离 |
| `--remote-tracking-only` | 远程来源、本地跟踪分支与批量创建 |
| `--feedback-only` | 前端进度遮罩与键盘隔离、Push 链接复制/打开、PR 目标选择、Commit 结果摘要与查看入口、冲突后关闭与中止、标记暂存、结果检查、继续确认和 Commit 入口保护 |

每次选择一个专项参数；脚本通过统一注册表选择对应检查，无参数时执行注册表中的全部专项。未知或多个参数会明确报错。

浏览器脚本以 `?demo=1` 加载产物，默认无头运行。Windows 默认使用 Microsoft Edge，其他平台使用 Playwright Chromium；可用 `ALWAYGIT_BROWSER_EXECUTABLE` 指定路径。Demo 只操作示例数据；即使使用受控宿主验证消息，也不能据此确认真实 Git、原生编辑器、剪贴板或窗口动作通过。

`test:extension` 默认下载并运行稳定版 VS Code；可通过 `ALWAYGIT_VSCODE_EXECUTABLE` 使用现有安装，或通过 `ALWAYGIT_VSCODE_VERSION` 检查指定版本。测试在系统临时目录创建独立仓库，网络操作使用本地 Bare Remote。

`test:windows` 使用独立临时 Profile、测试仓库和测试伴随扩展，验证项目窗口激活、跨窗口 Diff/编辑、保留标签和未保存文档，以及未打开项目的新窗口启动；还会独立打开另一个项目和 AlwayGit，通过真实面板的 `repositorySelected` / `captureWorkbench` 消息验证两个窗口继续响应、原窗口切换仓库及窗口会话隔离，不能以直接调用后端方法替代面板响应。测试进程不使用或关闭用户的 VS Code 窗口，结束时验证路径归属后删除测试 Profile 与其窗口注册目录。多根工作区和不同 Worktree 的目录匹配同时由 IPC 单元测试覆盖。

2026-10-05，经用户许可，使用本机 VS Code 1.140.0 执行真实窗口验证：当前 0.48.0 源码与现有 0.47.2 VSIX 均通过独立项目启动、两窗口面板通信及原窗口切换仓库场景，未复现用户报告的短暂失联。0.47.2 缺少 captureWorkbench，伴随扩展只在隔离测试页面注入探针，验证 saveSession/snapshot 的真实请求及应答和页面本地选择状态，不修改原 VSIX 或生产请求处理。旧包可使用 `node scripts/test-windows.mjs --vsix artifacts/alwaygit-0.47.2.vsix` 验证；设置 `ALWAYGIT_VSCODE_EXECUTABLE` 指向已有 VS Code 可避免下载。首轮测试因仓库标题变化导致标签断言过时而失败，修正后通过；后补的注册目录清理通过语法和路径归属检查，未为清理逻辑重复启动桌面测试。此结果不代表已定位或修复本次失联，日常扩展与固定安装包未更新。

<a id="manual-screenshots"></a>

### 用户手册截图维护

先判断受影响的操作场景；外围工具栏、图标或间距变化通常只更新入口文字与截图差异说明。确需更新截图时，先执行一次 `npm run build`，再运行 `node scripts/capture-manual.mjs`。脚本使用无头浏览器和当前构建的真实工作台组件，所有 RPC 均由隔离的示例夹具响应，不执行 Git、Shell、原生编辑器或窗口动作，不连接远端。固定默认主题（跟随浅色宿主呈现白色界面）、语言、字号、视口、时区和示例时间；每个场景有独立浏览器上下文，弹窗按边界裁切以保持文字可读，窄侧栏图是组件适配演示，不代表真实 VS Code 容器验收。

预览输出到忽略目录 `artifacts/manual-capture/`；`--only=NN` 查看单个场景，`--from=NN` 从指定场景继续采集，均不改手册图片。局部更新使用 `--only=NN`，核对后只将对应 PNG 复制到 `docs/images/user-manual/`，优先保留清晰的操作区域；日常验收预览不复制到维护目录。仅在用户明确要求或专门的手册改版任务中，使用 `node scripts/capture-manual.mjs --write` 全量采集；全部场景成功才开始替换维护图片，部分采集不能使用 `--write`。场景定义集中在该脚本，不手工保留不同版本的旧图。

两份用户手册共用图片、章节锚点和截图来源说明；新增图片必须同时被两版引用。更新时核对受影响图片的实际入口、对象、数量、方向和正文，删除失效或未引用资源，保持真正的 PNG 编码。手册来源说明记录实际采集日期与源码版本；局部替换按图号记录新来源，其余图片保留原来源，外围界面差异在说明中注明。不能把 Demo 反馈当作真实 Git 或终端执行证据。需要 VS Code 原生外壳截图或宿主行为验收时，另按项目规则取得可见窗口许可。

完成后检查链接与 `git diff --check`，运行 `npx vitest run tests/help-content.test.ts`，构建最终帮助资源并运行无头 `node scripts/test-ui.mjs --help-only`。修改帮助 TypeScript 时同时运行类型检查；不因为截图变化启动完整功能测试。验证结论记录在本文的“验证证据与覆盖边界”。

<a id="browser-validation-matrix"></a>

## 浏览器验收矩阵

内嵌终端的真实无窗口宿主检查使用构建后的 `node scripts/test-terminal-host.mjs`，覆盖 PTY 输入/输出、自然退出、主动终止、启动失败和辅助进程退出；Windows 额外验证 PowerShell。该检查不启动 VS Code，它验证当前运行平台的原生模块，不代表其他平台也已验收。

- 统一捕获入口在行内阻止冒泡的控件上仍生效；单键作用于当前仓库和 Diff；输入框、可编辑内容、选择控件、输入法组合、弹窗及菜单中暂停；忙碌和长按不重复执行；Commit 打开 Message 浮窗，Stage/Unstage All 保留确认，分组模式遵循工作区路径筛选，统一模式处理完整仓库，关闭单键仍能刷新且保存草稿及开关。

- 帮助问号入口与空状态快速开始入口、按当前语言读取双语 Markdown、四类导航、正文关键词筛选、内部章节定位、完整章节与表格/图片；模拟 Webview CSP 下无外部资源请求，窄窗口可滚动，Escape 与 Tab 焦点返回；打开和关闭帮助保留仓库、草稿、布局、文件选择与 Diff，不执行 Git 或原生编辑器动作。

- 固定四区 Workbench、旧 Editor Focus 会话迁移、分支徽标与操作栏合并、右侧定位 HEAD 和双层文件夹/VS Code 纯图标按钮、底部常驻状态栏移除与顶部按需提示、面板和列拖动、Diff 动态最大高度与收起恢复、仅恢复布局而不重置界面设置的 Restore Layout、窄窗口和主题。
- 设置浮窗分级导航、预览、取消、应用、刷新期间的持久化；宿主主题与主题卡片优先级、丰富明暗主题、可配置未推送角标、字号、列表密度及独立 Diff 行高同步虚拟行高、Diff 自定义行高边界和旧设置兼容、Graph 预设及自定义浅色/深色色板的连续性与分页。
- Repository、Local Branch、Remote Branch、Remote、Tag、Stash、Worktree 的对象菜单；仓库行和仓库分组标题通过右键打开管理菜单；分区标题单击只折叠内容，右侧图标执行分组操作，Local Branches 的 Graph 预设具有激活状态。Repository 单击、Ctrl/Cmd、Shift、Ctrl/Cmd+A 与 Escape 管理批量操作选择，不切换仓库，范围严格按当前显示顺序计算；Repository、Local、单个 Remote 与 Worktree 同时只保留一个非空侧栏操作选择作用域，切换作用域不改变 Graph 勾选、当前仓库或当前分支。双击或 Enter 切换仓库，右键遵循所选范围。Worktree 单击只聚焦、双击或 Enter 切换。当前 Repository 使用强调色仓库图标，Worktree 和本地分支保留排头实心三角形；三者均使用 `aria-current`，与蓝色操作选择相互独立。三角形在浅色背景为纯黑、深色背景为纯白，不显示 Current 文字徽标。
- 菜单指针定位、视口边缘修正、竖向排列、键盘焦点、Escape 与点击外部关闭。
- 右键对象与操作对话框目标一致；仓库切换后旧菜单和对话框关闭。
- 递归分支目录、目录展开、三态目录选择、多引用选择及只按可见分支计算的 Shift 范围、共同提交去重、清空选择、分页、搜索、HEAD 标记及 Locate HEAD。
- Commit 整行悬停、指针、选择、已推送实心节点与粗体消息、本地未推送空心节点与常规消息、各列双击、键盘焦点、本地分支 Checkout、历史 Commit 创建并切换分支及高级 Detached HEAD 对话框；Working Tree 使用独立菱形虚拟节点紧邻当前 HEAD，显示变更、冲突和分支，并支持整行选择及上下方向键导航。
- English / 简体中文切换，并验证 Git 命令、分支、路径和草稿保持不变。
- 切换仓库或重载后恢复筛选、选择、布局和 Commit 草稿。
- 文件以 `./` 开头的完整多层相对父目录、形状与颜色不同的状态图标及 Tooltip、Working Tree / Commit Details / Commit 比较的单击/Ctrl/Cmd/Shift 选择及无复选框交互、文件区域 Ctrl/Cmd+A、原生文本框全选、提交文件路径复制、绿色暂存盒与红色回撤/垃圾桶分组图标；Stage All / Unstage All 在无选择或部分选择时均确认全部组内文件数量，确认按钮默认聚焦，执行范围不受选择影响；Discard All 在无选择或部分选择时均列出全部 Unstaged 路径，取消不执行，确认后发送完整范围，文件右键菜单仍按所选路径执行。
- 创建分支的友好起点、名称实时错误、输入和焦点保留、“仅创建”与“创建并切换”意图及完成后的当前分支；无远端 Push 的前置说明与添加入口、添加后返回目标摘要、默认折叠的高级 Push 选项；Push 等操作进行中、成功、失败与目标；Commit 成功短哈希、提交文件数、剩余变更数和查看入口；错误详情、日志；持久冲突条、查看冲突、Continue 禁用原因与待检查状态；标记暂存不保证内容正确、暂存版本检查、标记行号、返回检查、明确继续确认、活动操作 Commit 入口与草稿保留；冲突后关闭窗口不 Abort、中止入口及恢复目标说明。
- Diff 修改块外框、新增/修改/删除块统计、无边框当前/总块数、首次自动定位、单文件首尾循环与单块重复定位、Commit 跨文件首尾循环及反向末处定位、空/二进制文件跳过、读取失败停止、路径筛选、Parent 切换取消旧请求与导航设置恢复、超高块从开头显示、收起展开保留位置、手动滚动、刷新重映射、缩放、长行横向滚动、第 100001 行修改、按范围读取与有限页缓存、模拟 500 万行首尾访问，以及完整比较加载/失败时不显示零修改。
- `Stash Selected Files…` 从 Staged / Unstaged 文件菜单打开，所选路径去重、数量准确、说明解释整个文件的 Index 与 Working Tree 都会保存，所选未跟踪文件自动包含；全局 `Stash All Changes…` 的未跟踪勾选项与说明保持一致。成功反馈仅统计实际保存范围及操作后的工作区状态。
- Apply 默认保留存档，显式 Pop 的成功后删除说明清晰；预检冲突、无法准确试验和预检期间现场变化分别说明原因、路径与存档保留，提供比较和打开图标，不显示无效的重复 Apply。说明仅承诺本次恢复未改动现场，不否认外部编辑；正式执行异常不显示未经验证的“现场不变”提示。
- Stash、Commit、浅色/深色及两种高对比主题、减少动态效果、未推送数量角标，以及默认与自定义 Push 目标。
- Demo 中的原生宿主按钮只验证发出明确请求和提示，不把模拟结果当作真实 VS Code 验证。

<a id="git-and-host-validation-matrix"></a>

## Git 与宿主验收矩阵

- 活动栏启动页展示四个位置说明、实际默认与已启用位置；Open Workbench 主按钮下方提示目标位置，正文配置入口与标题齿轮打开当前视图的设置弹窗，新窗口为次级链接。覆盖中英文、旧配置兼容、配置变化后的摘要刷新及窄侧栏/矮面板适配；视图可见性变化不自动打开工作台或关闭侧栏。Show 覆盖新建、重复点击复用、活动标签优先、最近使用标签及关闭后重新创建；新窗口命令保留空白启动与宿主就绪路由。

- 统一添加浮窗的仓库/分组类型切换、空分组创建、名称校验与 Enter 提交、草稿和已完成扫描选择保留、切换类型取消扫描并忽略迟到结果；添加仓库模式的目录选择、可取消扫描、候选筛选、可见顺序 Shift 范围、已有仓库禁用、目标分组与内联新建分组；分类目录递归发现多层仓库、`.git` 文件 Worktree、已有仓库去重、一次保存与列表通知、取消不产生部分添加；损坏仓库与无法访问目录跳过，目录链接和 junction 不跟随，已有会话保持。内嵌移除确认列出目标仓库并保留磁盘文件，宿主在执行前重新校验。
- 同一共享 Git 存储的工作目录在顶层只显示一次；独立克隆与独立 Git 存储保持正确身份。覆盖旧保存路径恢复、直接添加 Worktree、VS Code 自动发现、主目录优先选择、活动 Worktree / 菜单目标、各工作目录草稿与文件状态隔离。
- 多引用历史首次查询与分页使用相同 tips，共同祖先无重复。
- Checkout 成功、当前分支、脏文件可能被覆盖、未解决冲突和 Worktree 占用；单个远程分支创建并 Checkout、本地跟踪分支复用和 Stash 重试。
- 分支名称后端校验返回可操作原因；仅创建保持当前分支，创建并切换后 HEAD 与当前分支同时更新。
- 远程分支目录递归批量创建本地跟踪分支，保持当前 HEAD；批量名称、upstream、符号引用、远程来源和层级冲突在写入前完成验证。
- `Stash Changes & Checkout` 分步结果；Checkout 失败时保留已经创建的 Stash。
- 所选文件 Stash 在暂存与未暂存两侧都保存整个文件，涵盖同一文件同时修改、所选未跟踪文件、重命名、删除与路径去重；未选中已暂存文件的内容不进入 Stash Index parent，也不被清理。全局 Stash 分别检查包含与排除未跟踪文件，反馈文件数严格对应保存范围。
- Apply、Pop、Drop Stash 在列表变化后仍验证正确对象；默认 `apply --index` 同时恢复 Index 与 Working Tree 划分且保留存档，显式 Pop 仅成功后 Drop。分别验证仅暂存、仅未暂存、同文件两侧修改、未跟踪及删除状态。
- 隔离预检中一文件冲突、其他文件可恢复时，整次恢复停止，真实 Index、工作区与 Stash 原记录不被这次恢复更改；未跟踪目标已存在、非目录父级及符号链接占用同样停止。预检期间外部编辑使 fingerprint 变化时停止；正式执行意外失败报告实际结果，保留 Stash，不承诺原子回滚。
- 隔离副本使用原始 Index 与文件内容、split Index 共享内容及只读源对象 alternates；检查试运行没有向源仓库写入 Index、工作区或隔离生成的对象，结束后安全清理临时目录。
- 隔离支持边界逐项检查：Git 属性来源读取能力不足、sparse checkout、受影响 gitlink、外部 filter、自定义或默认外部 merge driver、单文件超过 32 MiB、快照累计超过 128 MiB、非普通文件、无法完整复制的占位目录和父级符号链接。应说明不支持原因并停止，不回退为直接在真实现场试恢复；支持范围见 [架构说明](ARCHITECTURE.md#stash-保存与隔离恢复)。
- 受阻文件比较读取保存的 tracked 工作树内容或 untracked 第三 parent，包含仅暂存、两侧修改及保存/当前删除的空内容，打开入口使用真实工作区路径。
- Stash 详情分别验证 Working Tree、Index 与 Untracked Files，按路径去重汇总文件数；仅含未跟踪文件时默认打开该分类，空分类给出内容位置与直接跳转，创建成功反馈说明保存范围和工作区状态。
- 同一文件同时含 Staged / Unstaged 修改时，Discard 只处理工作区一侧。
- Detached HEAD 默认禁止、设置应用/取消/重载、关闭后返回分支、Commit/Tag/Stash 重试和隐式 Detached Worktree 后端拦截、Tracking Branch、Tag 创建并切换分支 和主 / 当前 / Locked Worktree 限制。
- 远端名称、地址、重复名称与添加后的 Snapshot；Push 目标配置解析、不同名称的本地 / 远端分支 refspec 及 upstream 建立。
- 同 Remote 的远程分支单项和批量删除、符号引用限制、身份校验、确认清单及部分失败汇总。
- 本地、远端及组合 Tag 删除分别绑定原始对象身份；远端使用地址指纹和 Force-with-lease，远端变化、读取/Push 地址分离及多 Push 地址均在写入前或由租约拒绝。组合删除先远端后本地，远端失败保留本地，远端成功后的本地竞态作为部分失败反馈。
- Diff 文本、二进制、大小限制、删除 / 重命名、Merge Parent 和冲突 Stage。
- VS Code 原生 Diff、普通编辑、剪贴板、打开 Worktree、新 AlwayGit 标签协议和新窗口。
- 多仓库共享 `commonDir` 的串行写操作与活动状态。

<a id="packaging-and-local-update"></a>

## 打包与本地更新

```powershell
node scripts/package.mjs
```

打包自动识别当前平台，向 VSCE 传递 `--target`，并由 `vscode:prepublish` 完成构建；无需在紧接着打包前重复构建。脚本传递 `--allow-star-activation`，明确接受现有的 `*` 启动激活方式，省掉每次打包的人工确认；此参数不优化启动性能或改变扩展激活时机。也可显式执行 `node scripts/package.mjs --target linux-arm64`，但目标必须与构建机器一致；该参数不会交叉编译 node-pty。Linux 必须使用 glibc 系统并准备 Python、make 与 C++ 编译器，源码构建采用 Node.js 24。

构建先清理旧 PTY 目录并过滤其他平台的预编译文件。打包后、替换固定包前，`verify-package.mjs` 解包核对扩展身份、版本、目标平台、工作区宿主和 askpass 执行权限，并在不依赖源码 node_modules 的临时目录运行真实终端生命周期检查。成功后才替换 `artifacts/alwaygit.vsix`，保留上一份 `artifacts/alwaygit-previous.vsix` 和 `artifacts/alwaygit-<版本>-<平台>.vsix`；失败时保留原固定包。校验临时目录在结束时删除。

已经生成的包可单独检查，不重复构建：

```bash
node scripts/verify-package.mjs artifacts/alwaygit.vsix
```

这项检查必须在包所对应的平台运行。`scripts/test-terminal-host.mjs` 可单独验证当前构建的终端辅助进程，也可接受已解包的 `terminal-host.cjs` 路径。构建及检查不安装或重载 VS Code 扩展。

统一安装入口是 `scripts/install.mjs`，Windows、Linux 共用。需要已有 Node.js；源码构建采用 Node.js 24，并先在目标机器的项目目录准备 `npm ci` 所安装的依赖及原生编译工具。脚本不自动安装依赖、Node.js 或工具链。安装已有 VSIX 的模式只需要 Node.js 和可用的 VS Code CLI，无需项目 node_modules、Python 或编译器。

安装操作先调用所选 CLI 的 `--version`，按项目的 `engines.vscode` 要求检查兼容性；不兼容或无法读取版本时，在构建、替换固定包和安装之前停止。安装已有 VSIX 还会校验包内的版本要求；只打包无需 VS Code。当前最低版本为 VS Code 1.106，第二侧边栏容器贡献项依赖该版本，不能仅降低清单要求来兼容 1.98。若所选桌面 VS Code 低于项目要求，更新桌面目标需要先更新编辑器；用于 Remote SSH 的 AlwayGit 应选择 Server 目标。脚本不会自动升级编辑器或更换安装位置。


交互终端中不传操作参数时，显示平台、操作和安装位置菜单：

```bash
node scripts/install.mjs
# Linux 便捷入口，行为相同：
bash scripts/install.sh
```

平台菜单推荐自动识别，提供 Windows x64/ARM64、Linux x64/ARM64 和 macOS x64/ARM64；按执行脚本的电脑所用的操作系统与 CPU 架构选择平台。操作菜单必须明确选择构建并安装、安装已有包或只打包。安装位置只选择一次：`desktop`（默认）更新执行脚本机器上的桌面 VS Code，`server` 更新该机器上的官方 VS Code Server；路径与可用管理入口自动定位，不要求用户另选 CLI 或 Server 版本。只打包不询问安装位置。非交互终端必须传入操作参数；明确指定操作时跳过菜单，未指定平台则自动识别，未指定 `--install-to` 则使用桌面目标。当前 CI 发布范围仍为 Windows x64、Linux x64、Linux ARM64。

在 Linux 远程电脑上的普通 SSH 或 VS Code 终端中，按需求择一运行。以下命令默认自动识别平台；需要显式指定时，可使用 `--target linux-x64` 或 `--target linux-arm64`，目标必须与远程电脑一致：

```bash
# 安装已有固定包到远程电脑的桌面 VS Code（默认），不构建：
bash scripts/install.sh --install-only
# 安装已有固定包到远程电脑的 VS Code Server，供 Remote SSH 使用：
bash scripts/install.sh --install-only --install-to server
# 构建、打包并安装到 Server；须已准备项目依赖和编译工具：
bash scripts/install.sh --build-install --install-to server
# 安装指定路径的包，身份及版本必须与当前项目一致：
bash scripts/install.sh --install-only --install-to server --vsix '/path/to/匹配当前平台的安装包.vsix'
# 只打包，不调用 VS Code：
bash scripts/install.sh --package-only
```

选择平台或 Server 不会自动连接另一台机器，也不会交叉编译，目标必须与执行脚本的机器一致。本地电脑连接远程电脑时，脚本在远程电脑上执行，Desktop 指远程电脑的桌面版，Server 指远程电脑的 VS Code Server；脚本在本地电脑的终端执行时，Desktop 指本地电脑的桌面版。脚本打印包路径、平台、安装位置、实际 CLI、版本和 Profile，Server 额外显示扩展目录。Shell 与 PowerShell 入口根据自身路径寻找统一脚本；传入 `--vsix` 的相对路径则相对于调用时的目录解析。

桌面检测跳过 PATH 与历史记录里的 Server/remote-cli，并移除 CLI 的远程转发环境变量。Server 优先定位当前 VS Code 会话对应的实例；会话实例不可用或不兼容时停止，避免用另一版本掩盖当前窗口的限制。普通 SSH 中扫描当前用户的官方安装目录，包括 `bin/<commit>` 与 `cli/servers/<实例>/server`，使用该数据根目录下最新可用且兼容的管理入口；标准 Stable 存储优先于 Insiders，支持 `VSCODE_AGENT_FOLDER` 自定义数据根目录。调用官方 `bin/code-server` 管理扩展，在安装与核对时明确指定同一数据目录及扩展目录，无需 Remote CLI 的窗口 IPC。找不到所选目标时停止，不自动切换 Desktop/Server，也不自动准备 Server。

扩展修改通过相应检查后，也可继续使用原有 Windows 入口：

```powershell
scripts/update-local.ps1
# 若已成功生成当前版本包，跳过重复构建：
scripts/update-local.ps1 -InstallOnly
# 指定目标平台或只打包：
scripts/update-local.ps1 -Target win32-x64 -PackageOnly
```

PowerShell 入口保持不传参数即构建并安装到 Desktop 的行为，支持原有 `-CodePath`、`-Profile`、`-InstallOnly`，另支持 `-Target`、`-Vsix`、`-PackageOnly`、`-InstallTo desktop|server`；`-Vsix` 需要搭配 `-InstallOnly`。

安装记录 `artifacts/local-install.json` 使用 schema 3，按平台、主机、Desktop/Server 分开保存，Server 再按数据根目录隔离；上次选 Server 不改变下次的 Desktop 默认值。旧 `local` 与无 schema 的 Windows 桌面记录可迁移，旧 `remote` 记录因无法判断其实际安装位置而仅保留，不复用。Desktop 复用仍有效的桌面 CLI；Server 每次重新定位当前实例或最新可用入口，适应版本更新。统一入口可用 `--code-path` / `--profile`，或 `ALWAYGIT_CODE_CLI` / `ALWAYGIT_VSCODE_PROFILE` 覆盖；CLI 必须属于所选位置，不能通过旧环境变量改变 Desktop/Server 选择。Profile 优先级为参数、环境变量、该目标的安装记录、默认 Profile；目标 CLI 不支持 `--profile` 时，指定非空 Profile 会停止。使用 `--profile=` 清除旧 Profile，PowerShell 对应 `-Profile ''`。Server 管理入口使用默认 Profile，不自动推断 Windows 客户端的当前 Profile。

安装前使用 Node.js 内置功能读取包的 JSON/XML 元数据，核对当前项目的扩展身份、版本、目标平台与 workspace 宿主；拒绝重复、损坏、过大的元数据及不支持的 ZIP64/多卷格式。这个静态检查不代替打包时的原生终端生命周期验证。脚本调用官方 CLI `--install-extension <VSIX> --force`，再核对已安装扩展 `alwaygit-dev.alwaygit` 的版本和包哈希。安装及校验均成功才写入记录；失败时保留原安装记录，不宣称已安装，也不自动卸载或回滚扩展。成功后可方便时重新加载 VS Code 窗口，脚本不自动关闭或重启用户窗口。仅替换 VSIX 不代表已安装扩展更新成功。

统一入口的定向检查覆盖交互选择、平台和包身份拒绝、模拟 CLI 安装与版本核对、失败时记录保留、Profile 能力检查、目标与记录隔离、构建失败停止及 Windows CMD 参数引用。目标定位检查覆盖 Remote CLI 优先的 PATH、普通 SSH、当前会话实例、多个版本、旧目录布局、自定义数据根目录、符号链接和所选目标缺失；Linux 入口检查语法。2026-10-11，Linux ARM64 远程电脑上的只读验证自动找到 Desktop 1.98.2 与 Server 1.141.0，固定包和安装记录哈希未变；本次未打包或安装扩展。PowerShell 参数转发采用拦截 Node 调用的无安装检查；Windows 原生安装、本地 Windows → Linux ARM64 远程电脑的界面、认证、多窗口以及自定义 Profile 仍需对应设备验收。

扩展身份保持不变，功能版本正常递增，不通过卸载或删除用户数据更新。全部安装包、本机安装记录、构建输出、截图、报告、trace、缓存和日志均不提交。文档整理无需触发扩展重新打包安装。

<a id="remote-tag-releases"></a>

## 远程 Tag 发布

推送格式为 `vMAJOR.MINOR.PATCH` 的稳定版本 Tag 后，GitHub Actions 工作流 `.github/workflows/release.yml` 会自动验证并发布可安装的 VSIX。Tag 去掉 `v` 后必须与 `package.json`、`package-lock.json` 及其根包记录中的版本完全一致，且 Tag 指向的 Commit 必须已经包含在远程 `main` 中；任一条件不满足时停止，不创建 Release。

发布工作流使用 Node.js 24，在公共验证 Job 中执行 `npm ci`、类型与翻译检查、一次全量 Vitest，并保留原有统计摘要。通过后，Windows x64、Ubuntu x64 和 Ubuntu ARM64 三个 Job 并行安装对应平台的原生依赖、构建、打包和验证解包后的终端；Linux 使用 Ubuntu 22.04 / 22.04 ARM64 作为构建基线，不使用会自动升级的 latest 镜像。

三个平台全部通过后，独立发布 Job 才使用 `contents: write` 创建同名 GitHub Release，上传 `alwaygit-<版本>-win32-x64.vsix`、`alwaygit-<版本>-linux-x64.vsix`、`alwaygit-<版本>-linux-arm64.vsix` 及各自的 `.sha256` 文件。发布前重新核对六份文件完整性及校验和；已有同名 Release 时拒绝覆盖。校验在 CI 的系统 Node.js 中执行，不代替 VS Code Server 内置 Node.js 和 Linux ARM64 远程电脑的实机验收。Linux 发布包的支持基线为 64 位 glibc 系统，Ubuntu 22.04+ / Debian 12+；更旧系统需要在对应环境专项构建与验证。

发布前先按 Conventional Commits 提交版本文件，再创建附注 Tag；不要使用 `npm version` 自动生成不符合项目提交格式的提交。以下版本号仅为示例：

```powershell
npm version 0.40.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore: 发布 0.40.0"
git tag -a v0.40.0 -m "AlwayGit 0.40.0"
git push origin main
git push origin v0.40.0
```

必须先让发布工作流进入 Tag 指向的 Commit，再推送 Tag；历史 Tag 不会因后来加入工作流而自动补发。已发布的 Tag 和 Release 不复用、不覆盖；发现问题时修复并递增版本重新发布。GitHub Release 提供可下载的 VSIX，但不等同于发布到 VS Code Marketplace，也不会让 VS Code 自动获取更新。

<a id="release-code-analysis"></a>

## 发布版本代码分析

README 的图卡和 [完整统计页](https://always1010.github.io/AlwayGit/) 展示最新成功发布的稳定版本，版本与 Commit 直接取自对应 Tag。普通分支推送、PR 和本地编辑不更新图卡；只在推送 `vMAJOR.MINOR.PATCH` Tag、现有 Release 校验与发布成功之后，调用 `.github/workflows/repository-stats.yml` 分析该 Tag 并部署 GitHub Pages。首次部署前 README 图片不可用。

统计口径：

- 文件总数与文件类型来自 `git ls-tree` 读取的 Tag 快照，包括源码、测试、脚本、配置、锁文件、文档、图片与生成代码；不会扫描 Runner 上安装的依赖、构建产物或未跟踪文件。后缀统一小写，无后缀文件单列，`.gitignore` 等点文件以文件名分类。当前不支持含子模块的统计，遇到子模块会停止并要求确定口径。
- 语言占比按自有源码字节数计算，包含源码、测试和维护脚本；`.ts/.tsx` 合并为 TypeScript，`.js/.jsx/.mjs/.cjs` 合并为 JavaScript，另外识别 CSS、HTML、PowerShell 和 Shell。JSON、Markdown、SVG 等只计入文件分析。声明文件、`src/i18n/generated.ts`、`generated/`、`.generated.*`、压缩代码，以及已识别的依赖、第三方与构建目录不参与语言占比；符号链接不作为源码。该规则不保证与 GitHub Linguist 完全一致。
- 测试数量复用 Release 中同一次 `npm test` 的 Vitest JSON 报告，逐项统计测试用例，参数化测试按展开结果计数，`describe` 分组不计数。图卡显示总数、通过、跳过与待实现数量，不代表测试覆盖率，也不包括未在 Release 中执行的桌面/UI 测试。原始报告和内部路径不会发布到 Pages。

首次启用需要仓库管理员完成 GitHub 设置：

1. 免费账号使用公开仓库；进入 **Settings → Pages → Build and deployment → Source**，选择 **GitHub Actions**。无需自定义域名、服务器或生成文件分支。
2. 在 **Settings → Environments → github-pages** 核对部署规则。使用 **Selected branches and tags** 时，分别允许发布 Tag `v*` 和默认分支 `main`；后者用于从默认分支手动恢复。核对仓库允许工作流运行所用的官方 Actions。
3. 先将本功能合入主干，再推送新的发布 Tag。已有 Pages 站点应先合并部署内容，本工作流上传的是完整统计站点，不能与其他工作流各自覆盖同一 Pages 站点。

`scripts/repository-stats.mjs` 从同一份 Tag 快照与原始测试汇总生成中文 `repository-stats.svg` / `index.html` 和英文 `repository-stats.en.svg` / `index.en.html`，两版页面均列出全部文件类型并可互相切换，共用 `repository-stats.json`；数据与统计口径不因语言而变化。现有中文地址保持不变，英文资源在包含该生成器的新稳定版本发布并成功部署 Pages 后可用。部署前英文 README 只提供现有统计页的文字入口与语言说明，避免失效图卡；部署后可接入英文图卡与页面。图卡只显示前八种文件类型并汇总其余类型。生成文件位于忽略目录 `artifacts/`，通过 `upload-pages-artifact` / `deploy-pages` 部署，不执行 Git commit 或 push，不使用 `gh-pages` 分支。首次配置所需的脚本、工作流和 README 引用是正常项目提交，后续生成结果不进入 Git。

统计部署使用仓库/Actions 只读及 Pages/OIDC 发布权限，不使用代码写入权限。部署任务统一串行，发布前检查原始 Release run 的工作流、提交及报告身份，再检查已发布稳定版本与 Pages 当前版本；低版本不会覆盖高版本。图卡统计或 Pages 失败不撤回已创建的 Release，上一版已部署图卡继续可用；Actions 中可查看失败原因。Pages 发布及 GitHub 图片缓存会带来显示延迟，图卡版本是统计对象的依据。

Release 会把已通过的测试计数、Tag、Commit、仓库和 run ID 保存为 `release-test-summary-<Tag>` Artifact，申请保留 90 天（以仓库允许的实际保留期为准）。统计恢复不重新运行测试或打包：在 **Actions → Release repository statistics → Run workflow** 中选择默认分支，填写 `tag` 和原始 **Release VSIX** 的 `release_run_id`（运行详情网址 `/actions/runs/<ID>` 中的数字）。恢复仅适用于包含本功能且已成功发布的稳定 Tag；必须仍能下载原始统计 Artifact，过期或被删除时明确失败，不用重跑结果冒充原始发布测试。失败的统计任务也可直接重跑；不要为图卡失败重跑整个 Release 创建流程。

本功能定向检查：`npx vitest run tests/repository-stats.test.ts`。覆盖 Tag 快照隔离、语言/类型口径、运行用例计数、报告与版本身份绑定、双语页面、图卡与全部部署文件的一致性、输出转义，以及原始发布验证和低版本覆盖保护。生成数据与报告不得提交。

<a id="validation-evidence-and-boundaries"></a>

## 验证证据与覆盖边界

下表保留不同版本实际执行过的检查范围，不把旧版本结果视为当前版本的全量验证。问题级回归摘要见 [问题日志](ISSUES.md)。

| 证据范围 | 日期 / 版本 | 已记录结果与限制 |
| --- | --- | --- |
| 英文 README 与首页入口 | 2026-10-13 / 源码 1.5.2 | 默认中文 README、新英文入口、核心文档与手册的首页/语言导航完成；12 份 Markdown 的 215 处本地链接、图片和锚点检查通过，README 两版章节/功能项对应，中文内部材料显式标注语言。导航修改前后的帮助解析内容完全一致，最终 Webview 资源构建通过，沿用第一阶段帮助验收；40 张维护截图未变。英文 README 暂用已发布中文统计页的文字入口；未全量测试、打包、安装、部署或推送 |
| 发布统计双语展示 | 2026-10-13 / 源码 1.5.2 | 统计脚本语法检查与 6 项统计专项测试通过；两种 SVG、两种 HTML、共用 JSON 和页面链接一致，计数口径不变。用示例测试数完成无头桌面/390px 页面、语言导航、图片解码和 SVG 文本边界检查并查看预览；直接打开 SVG 的首轮截图超时，改用内嵌 SVG 和本地 HTTP 页面后通过。远端中文页为 200，英文图卡/页面尚为 404；未部署、全量测试、打包、安装或推送 |
| 核心文档英文版与双语导航 | 2026-10-13 / 源码 1.5.2 | 新增规格、架构、验证英文版，技术文档共用稳定锚点，英文手册关联链接进入英文文档；11 份 Markdown 的 193 处本地链接、图片和锚点检查通过，3 项帮助内容测试、生产构建和无头 `--help-only` 通过。83 个手册锚点与 40 张共享 PNG 保持不变；未重拍截图、运行全量测试、启动可见窗口、打包、安装或远程推送 |
| 网络运行状态统一转圈 | 2026-10-11 / 源码 1.4.1 | 类型与 1555 条双语资源检查、生产构建、无头 Feedback 专项通过；验证 Push/Pull 圆圈样式相同且匀速连续、三个网络操作均无横条、真实指标和日志保留、迟到消息隔离、收起后的非阻塞反馈、Fetch 刷新与完成停止。已查看 Push/Pull/Fetch 预览；未运行全量测试或真实 VS Code 桌面验收，未打包、安装或远程推送 |
| 可配置网络命令超时 | 2026-10-11 / 源码 1.4.0 | 类型与 1555 条双语资源通过；Runner、扩展启动与 RPC 三文件 30 项通过，覆盖逐命令读取设置、延长/关闭上限、非法配置回退、普通查询保留原预算及关闭上限后进程树取消保护。扩展构建通过；前端未变化，不重复运行浏览器专项。未修改本机 VS Code 设置、打包或安装扩展 |
| 网络操作实时进度 | 2026-10-11 / 源码 1.4.0 | 类型与 1554 条双语资源、生产构建和无头 Feedback 专项通过；9 个定向单测文件共 213 项中 202 项通过，新增进度解析和真实本地 Push/Fetch/Pull 通过。11 项既有远端绑定用例受本机 Git 2.43 限制，修改前隔离版本复现两类代表失败。未修改本机工具、打包、安装或远程推送；截图仅存忽略的 artifacts，未重采集维护截图 |
| 单行工具栏与保留原图标的更多菜单 | 2026-10-11 / 源码 1.3.3 | 类型检查、1537 条双语资源检查、生产构建、快捷键与帮助内容两文件共 9 项单测通过；无头 Workbench、Docking、Project、Locations、Appearance、Help 六个专项通过，另单独运行已有 HEAD 定位检查并通过。覆盖右侧入口在窄窗口滚动时固定可见、七个单层菜单项、原图标统一为 16 × 16 px、组合图标、键盘导航及焦点恢复；保留 0.52.0 的 40 张原有操作截图，手册注明外围工具栏差异，最终帮助资源的图片与 CSP 检查通过。重做提交时复查手册内容、链接和最终帮助资源，不重复未改变的功能检查。完整 History 专项在 Detached HEAD 演示切换处失败，并在修改前的 1.3.2 源码独立复现，不将其计为本次通过范围。使用已有 Chromium 114，无本机软件安装；未执行全量测试、真实 VS Code 宿主验收、VSIX 打包或本机扩展更新 |
| 工作台四个显示位置与应用后的默认入口 | 2026-10-06 / 源码 0.51.1 | 主侧栏启动入口始终保留，第二侧栏和面板通过原生显示条件随位置设置显示或隐藏；类型检查与 1506 条双语资源检查通过，入口/启动/仓库管理/操作生命周期/终端五文件合计 92 项定向测试通过。覆盖规范化设置与旧配置回退、外部配置切换、来源 Apply 应答后再隐藏、默认位置打开、原生视图销毁后的会话及终端迁移、即时页面草稿优先于宿主延迟保存、无原生状态时的宿主恢复与最终终端释放。修正草稿优先级后仅重跑类型检查及入口文件 49 项，全部通过。原生显示与视图销毁机制已核对 VS Code 实现；未运行真实 VS Code 桌面验收、生产构建、打包、安装或远程推送 |
| 当前问题修复与最终验证 | 2026-10-05 / 源码 0.47.1（修复代码 a57dba9） | BUG-095 至 BUG-108 已逐项修复并提交，另修复验收夹具 BUG-109。1459 条双语资源检查、类型检查及最终生产构建通过；最终全量 Vitest 为 60 文件全部通过、573 项通过 / 1 项跳过，耗时约 11 分 42 秒，单例上限为 60 秒；跳过项为 Windows 文件符号链接权限不足的用例。无头 Appearance、Feedback、Diff、Terminal、Refresh、Action Safety 六个专项通过，保留业务断言；后两个使用最终生产构建执行。真实 Git 覆盖外部 Stash 插入、固定 Tag/分支起点、双 Push 地址部分发布、子模块范围、同状态连续编辑及保存队列竞态。Stash 删除只支持 files 引用后端，reftable 安全拒绝，不承诺多文件断电原子性。未运行真实 VS Code 桌面集成、跨平台验收、VSIX 打包或本机安装；未远程推送 |
| 修复前全仓审查与验证基线 | 2026-10-05 / 0.47.1（faf4524） | 已审全部手写模块、测试及交付配置，覆盖明细见下文。1455 条双语资源与类型检查、生产构建通过；一次全量 Vitest 为 59 文件 / 538 项，58 文件 / 537 项通过，唯一失败为查询计数 48 与过时期望 36 不符。无头 Action Safety、Tag Status 和真实 Windows cmd / PowerShell PTY 检查通过；原 Refresh 专项因夹具缺少 CherryPickCheck 失败，仅在内存补齐响应且不减断言后通过，当时仓库夹具尚未修复；后续修复见当前修复证据行。官方 npm 安全接口报告零已知依赖漏洞，锁文件含 298 个包记录，所有具有下载地址的包均使用 HTTPS 并有完整性校验；这不证明不存在未知漏洞。该审查基线确认 BUG-095 至 BUG-108，后续修复与验证见当前修复证据行及问题日志；未运行真实 VS Code 桌面集成、跨平台验收、VSIX 打包或本机安装 |
| 远端 Tag 安全删除 | 2026-10-05 / 源码 0.47.0 | 1452 条双语资源与类型检查通过；Tag 删除/状态、协议、确认、界面状态及 Push 结果 6 个定向测试文件最初共 121 项通过，后续仅重跑受影响的界面状态 85 项、Tag 状态 2 项和最终 Tag 删除 9 项；帮助内容 3 项通过。真实本地 Bare Remote 覆盖本地与远端组合删除、仅远端删除、远端对象竞态、组合删除的部分失败和读写地址分离；生产构建及无头 `--tag-status-only` 通过，覆盖仅远端 Tag 菜单、删除对话框、风险提示与按钮状态。未运行全量测试、真实 VS Code 桌面集成、VSIX 打包或本机安装 |
| 快捷键管理 | 2026-10-04 / 源码（版本号保持 0.45.0） | 1391 条双语资源、类型检查、快捷键/协议/界面状态/帮助定向单测通过；在 Vite 开发服务上直接执行无头快捷键交互检查，覆盖录制、Esc、保留键、冲突转移、恢复默认、备用键、搜索筛选、Cancel/Apply、提示与帮助同步、重开恢复和草稿保留。中英文布局及 800px 窄窗口检查通过；合入 main 后再次通过定向单测和无头快捷键交互，保留主分支新增的终端键位及作用域说明，帮助速查兼容额外的 VS Code 快捷键行。未构建、打包、安装或运行全量测试；原生 VS Code 快捷键设置入口仅验证 RPC 意图，未运行真实桌面集成 |
| 底部多标签与内嵌终端 | 2026-10-04 / 0.44.0 | 1309 条双语资源与类型检查、终端生命周期/面板归属/协议/快捷键/会话与界面状态定向单测以及帮助/入口回归通过；生产构建与无头 `--terminal-only`、`--diff-only`、`--shortcuts-only` 通过，覆盖多终端、重命名、跨仓库目录隔离、折叠/最大化、终止/重启、关闭和显式文件选择切回 Diff。真实 Windows cmd/PowerShell PTY 输入输出、正常退出、强制停止、启动失败和辅助进程释放检查通过。固定 VSIX 已打包，官方 CLI 在既有默认 Profile 安装并核对 `alwaygit-dev.alwaygit@0.44.0`，包哈希与本机安装记录一致，上一份固定包保留。未运行全量测试、真实 VS Code 桌面终端集成或远程平台验收；Windows 构建不包含 Linux PTY 原生模块 |
| 图表浏览状态与恢复 | 2026-10-03 / 源码 0.41.0 | 1283 条双语资源与类型检查、75 项状态/历史项回归及缓存上限/快照来源校验/相关返回定位补充 5 项定向检查通过；生产构建和无头 `--history-only` 通过，截图核对常驻状态与标签范围。覆盖延迟、失败、乱序响应、取消、重复点击、范围分页隔离、返回阅读位置、当前分支恢复和引用定位。对用户 llvm-project 的 main 与两个标签分别只读获取 300 条，读取约 5.7–7.7 秒、布局约 1–2 毫秒；验证前后 HEAD/分支/工作区变更保持一致。未运行全量测试、真实 VS Code 桌面集成、VSIX 打包或安装 |
| 操作进度与远端后续入口 | 2026-10-03 / 源码 0.40.0 | 1250 条双语资源与类型检查、89 项状态/协议/地址/租约/脱敏测试、18 项 Push/Tag/写队列真实 Git 回归通过；生产构建和无头 `--feedback-only` 通过。覆盖 Checkout 遮罩和宿主提前结束、键盘隔离、冲突解锁、真实 Bare Remote 发布/已是最新/多目标部分失败、HTTPS/SSH 分支编码、GitHub Fork、GitLab 创建和已有 MR 链接、自建 GitLab 相关链接识别、复制与打开网页请求以及成功后的刷新失败。网页入口由受控宿主验证，未实际创建 PR/MR/Release，未运行全量测试、真实 VS Code 桌面集成、VSIX 打包或本机安装 |
| 侧栏操作选择作用域 | 2026-10-03 / 源码 0.39.0 | 1207 条双语资源检查、类型检查、64 项 UI 状态单测、生产构建及无头 `--workbench-only`、`--worktrees-only` 通过；覆盖 Repository、Local、Remote、Worktree 的单击、右键与 Ctrl/Cmd+A 作用域切换，确认同时只保留一个蓝色操作选择且不改变 Graph 勾选、当前仓库或当前分支。双语持久化流程的测试定位器同步支持中英文无障碍名称。未运行全量测试、真实 VS Code 桌面集成、VSIX 打包或本机安装 |
| 图片 Diff 预览与二进制打开限制 | 2026-10-03 / 0.38.0 | 1171 条双语资源检查与类型检查通过；文档预览、Diff 导航、协议、翻译 4 个定向测试文件 33 项通过，新增 JPEG/WebP 识别后重跑文档预览 12 项通过；生产构建及无头 `--diff-only` 通过。覆盖 PNG/JPEG/WebP 内容签名、字节与像素限制、两侧图片、尺寸/大小、缩放、100%、适应、最大化、整文件导航，以及图片和其他二进制的 VS Code 编辑/原生 Diff 前端禁用与宿主拒绝。未运行全量测试或真实 VS Code 桌面集成 |
| 工作区搜索与 Commit 浮窗 | 2026-10-03 / 0.36.0 | 类型检查与文件选择、界面状态、会话保存、双语帮助 4 个定向测试文件通过；无头 `--files-only`、`--shortcuts-only`、`--feedback-only`、`--worktrees-only`、`--appearance-only`、`--help-only`、`--workbench-only` 通过。覆盖匹配范围暂存/撤回/丢弃、230px 标题入口、Cancel/Esc/关闭和重载草稿恢复、失败保留、隐藏冲突、零暂存 Amend、提交成功定向清理、迟到读取与新草稿保护，以及活动操作暂存结果检查。更新两张当前入口截图并移除失效表单图；未运行全量测试或真实 VS Code 桌面集成 |
| 工作台单键快捷键 | 2026-10-03 / 0.35.0 | 类型检查与 6 个定向测试文件 91 项通过；无头 `--shortcuts-only`、`--diff-only`、`--files-only` 通过。覆盖捕获阶段全局触发、当前仓库与文件目标、输入框/选择控件/输入法/弹窗/菜单保护、禁用与长按、准备 Commit、整组暂存确认、Diff 折叠及跨文件导航、设置取消/保存/重载与草稿保留。未运行全量测试或真实 VS Code 桌面集成，原生打开/编辑动作仅验证模拟 RPC 意图 |
| Commit 跨文件 Diff 导航 | 2026-10-03 / 0.33.0 | 类型检查、73 项差异导航/界面状态/协议/双语帮助测试及无头 `--diff-only` 通过。覆盖默认整个 Commit、单文件模式、正反首尾循环、跨文件末处定位、重命名与 Parent、路径筛选、二进制和空文件跳过、读取失败停止、迟到响应取消、设置取消/保存/重载，以及原有滚动、行高、收起恢复和截断行为；86 处本地 Markdown 链接与图片引用检查通过。固定 VSIX 已打包，并通过官方 CLI 安装及 `alwaygit-dev.alwaygit@0.33.0` 核对；未运行全量测试或真实 VS Code 桌面集成 |
| 双语手册与离线帮助 | 2026-10-06 / 0.52.0 | 原有 27 张截图全部替换，新增 13 张；40 个无头示例场景按默认白色主题全量采集成功，均为真正 PNG，两版引用一致且无闲置图片。六份相关文档的链接与锚点检查、类型及双语词条检查、3 项手册内容测试、生产构建和无头 `--help-only` 通过；中英文帮助逐章解码全部 40 张图片，覆盖离线 CSP、空仓库入口、搜索、章节跳转、表格、600/380 宽度、Tab / Escape 焦点以及仓库、草稿、布局和 Diff 保留，不发送 Git 或原生编辑器动作。首轮中文帮助检查因旧夹具未提供用户级语言设置失败，补齐夹具后通过。白色截图全量核对并重新通过 3 项内容测试、Webview 构建及 `--help-only`。截图使用隔离示例数据；未运行真实 Git 操作、全量功能测试或可见 VS Code 集成，本次截图调整未重新打包或安装扩展 |
| 类型、状态及路径逻辑 | 2026-10-01 / 0.10.0 | 类型检查通过；`ui-state`、`file-selection` 两个文件 34 项通过，覆盖设置保存/回滚、角标颜色及目录标签 |
| 生产构建与浏览器专项 | 2026-10-01 / 0.10.0 | 构建、无头 Edge 的 `--appearance-only` 与 `--files-only` 通过；范围为主题、角标、布局恢复和文件交互 |
| 打包与本机安装 | 2026-10-01 / 0.10.0 | 固定包、版本包生成及官方 CLI 安装核对通过；此记录不是当前本机安装状态，本机目标与状态以忽略目录中的安装记录和实际 CLI 核对为准 |
| 仓库管理、完整 Git 行为及窗口桥接 | 上述 0.10.0 执行范围之外 | 该记录未包含相关复测、完整 Vitest 或 `test:windows` 的新结果 |
| 文档整理 | 2026-10-01 / 源码 0.16.0 | Markdown 本地链接、标题锚点、图片及旧文件名引用检查通过；`git diff --check` 通过。未运行功能测试，未重新打包或安装扩展 |
| 暂存确认与 Commit 结果反馈 | 2026-10-02 / 0.18.0 | 类型检查、生产构建、无头 `--files-only` 与 `--feedback-only` 通过；固定 VSIX 打包并通过官方 CLI 安装及身份/版本核对。未启动真实 VS Code 桌面集成测试 |
| Workbench 唯一入口、多标签/窗口与跨窗口安全 | 2026-10-02 / 0.19.0 | 类型检查、6 个相关 Vitest 文件 40 项、生产构建与完整无头界面套件通过；界面脚本显式验证新 Workbench 初始不选择仓库，并适配各受控宿主在 Workbench 内选择仓库。固定 VSIX 打包并通过官方 CLI 安装及 `alwaygit-dev.alwaygit@0.19.0` 核对；按规则未启动会弹窗的真实多窗口 VS Code 集成测试 |
| Stash 内容可见性与重复恢复安全 | 2026-10-02 / 0.19.1 | 类型检查、状态与协议 35 项、两项真实 Git 定向回归、生产构建及无头 `--stash-only` 通过；固定 VSIX 打包并通过官方 CLI 安装及 `alwaygit-dev.alwaygit@0.19.1` 核对。未启动会弹窗的真实 VS Code 桌面集成测试 |
| 分支创建意图与无远端 Push 引导 | 2026-10-02 / 0.20.0 | 类型检查、协议与真实 Git 定向测试 26 项、生产构建及完整无头界面套件通过；覆盖分支名就近说明、仅创建/创建并切换、Remotes 空状态、添加远端后返回 Push 和折叠高级选项。固定 VSIX 已打包并通过官方 CLI 安装及 `alwaygit-dev.alwaygit@0.20.0` 核对；未启动会弹窗的真实 VS Code 桌面集成测试 |
| 统一仓库与分组添加入口 | 2026-10-02 / 0.26.0 | 类型检查、宿主与协议 24 项相关单测、生产构建和无头 Worktrees 专项通过；覆盖单一加号、空分组创建无原生输入或扫描、名称边界与同名拒绝、Enter 提交、类型切换保留草稿/选择、迟到扫描取消，以及原有批量添加。两种添加模式的布局已通过无头截图核对。固定 VSIX 已打包并通过官方 CLI 安装及 `alwaygit-dev.alwaygit@0.26.0` 核对；未启动真实 VS Code 桌面集成测试 |
| 仓库与分组顺序 | 2026-10-02 / 0.26.0 | 类型检查、4 个相关 Vitest 文件共 65 项、生产构建和无头 Worktrees 专项通过；覆盖旧顺序迁移、新增追加、混合根层及组内排序、跨层拒绝、重启恢复、暂不可访问项的位置保留，以及拖动和右键排序不切换活动仓库 |
| 可见顺序范围选择与仓库内嵌管理 | 2026-10-02 / 0.21.0 | 完成 Repository、Local / Remote Branch、History Commit、Details / Working Tree 文件、Worktree 及新增候选仓库列表的 Shift 范围审计，修复仓库排序和折叠分支两处与可见顺序不一致的问题。类型检查、6 个相关 Vitest 文件 39 项、生产构建及无头 `--worktrees-only` 通过；后者覆盖内嵌扫描添加、候选 Shift 范围、新建目标分组和内嵌移除确认。固定 VSIX 已打包并通过官方 CLI 安装及 `alwaygit-dev.alwaygit@0.21.0` 核对；未启动会弹窗的真实 VS Code 桌面集成测试 |
| Diff 定位、循环跳转与独立行高 | 2026-10-02 / 0.23.0 | 类型检查、Diff 导航/对齐及状态/设置单测共 47 项、生产构建、Diff 和外观两个无头界面专项通过。覆盖首处自动定位、单处重复定位、首尾循环、超高块与收起恢复；默认 18 px 行高、自定义边界、字号安全下限、预览/取消/保存重载、旧设置兼容与改变行高保留阅读行。固定 VSIX 已通过官方 CLI 安装并核对 `alwaygit-dev.alwaygit@0.23.0`；未启动真实 VS Code 桌面集成测试 |
| 工作台入口与仓库交互勘误 | 2026-10-02 / 0.25.1 | 类型检查、入口回归 8 项、生产构建与无头 `--worktrees-only` 通过；覆盖两个原生按钮的命令配置、视图可见性无自动动作、Show 标签新建与复用、活动/最近使用标签、关闭后重建，以及恢复仓库单击选择、双击/Enter 切换与右键管理。固定 VSIX 已通过官方 CLI 安装并核对 `alwaygit-dev.alwaygit@0.25.1`；真实 VS Code 桌面按钮外观与跨窗口集成未运行 |
| Detached HEAD 高级开关与历史分支引导 | 2026-10-02 / 0.28.0 | 类型检查、Git 安全/状态/协议三个文件 67 项单测、生产构建与无头 History、Appearance、Branch 三个专项通过；覆盖默认拒绝 Commit/Tag、显式及隐式 Detached Worktree、Stash 前预检策略变化和文件保留、关闭后返回分支、设置取消/应用/重载及历史创建并切换。固定 VSIX 已通过官方 CLI 安装并核对 `alwaygit-dev.alwaygit@0.28.0`；未启动真实 VS Code 桌面集成测试 |
| 整文件 Stash 与安全恢复 | 2026-10-02 / 0.29.0 | 类型检查、13 项真实 Git Stash 状态用例、48 项既有 Git 服务/安全回归、46 项 UI/Demo 用例、3 项定向文件比较及 1 项新协议用例通过；受影响失败修复后仅重跑对应检查。覆盖所选范围隔离、同文件 Index/工作树不同、重命名、未跟踪、缺失 Index、编码属性、整次冲突停止及 Git 环境变量隔离。生产构建与固定 VSIX 打包通过，官方 CLI 已安装并核对 `alwaygit-dev.alwaygit@0.29.0`；未启动真实 VS Code 桌面集成测试 |
| 并发边界、持久化和查询治理 | 2026-10-03 / 0.30.0 | 类型检查、相关 Git/宿主/协议/状态定向回归通过，覆盖进程终止与写保护、锁恢复、远端版本约束、旧快照失效、多标签草稿合并、只读取消、共享监听、符号链接及长参数；真实 Git 检查包括本地 Bare Remote 与两个 Clone 的并发变更、310 个分支的历史查询。11 个无头界面专项分批通过，失败修复后只重跑受影响专项；没有执行全量 Vitest 或真实 VS Code 多窗口桌面集成。0.30.0 生产构建与固定 VSIX 打包通过；随后当前工作区合入仓库行样式改动并由其更新流程重新构建安装，本轮再次核对官方 CLI、安装记录与固定包哈希一致。六份长期文档的本地链接及标题锚点检查通过 |
| 顶部工具栏精简与底部状态栏移除 | 2026-10-03 / 0.31.0 | 类型检查、48 项状态测试、生产构建及无头 `--workbench-only` 通过；覆盖分支徽标并入工具栏、定位 HEAD 图标、双层文件夹中央 VS Code 标识、打开仓库目录的悬停说明、底部状态栏移除，以及顶部普通提示的显示和关闭。固定 VSIX 已打包并通过官方 CLI 安装及 `alwaygit-dev.alwaygit@0.31.0` 核对；未执行全量 Vitest 或真实 VS Code 桌面集成测试 |
| Git 操作身份、Stash 属性、目录事务与网络生命周期 | 2026-10-03 / 0.31.1 | 类型检查通过；远程跟踪 6 项、Stash 状态 20 项、操作上下文/协议/确认 46 项及 Checkout 冲突保护 1 项、目录事务相关 39 项及受影响复合添加/宿主入口 7 项、Tag 定向 7 项、Runner/AskPass/RPC 20 项通过（受影响复测含重叠范围，不按总数叠加）。真实 Git 覆盖属性编码、分支/HEAD/目标变化与 Tag 重建及删除竞态；独立目录 Store 与陈旧 Memento 模拟跨宿主争用。生产构建、固定 VSIX 打包及无头 `--feedback-only` 通过，包含三种操作对话框刷新后保留打开时身份。官方 CLI 已安装并核对 `alwaygit-dev.alwaygit@0.31.1`，固定包哈希与本机记录一致；未执行全量 Vitest、真实多 VS Code 窗口或原生认证输入框集成。UI 优化计划暂缓 |
| 报告 B01/B02：提交反馈与 Stash 底层诊断 | 2026-10-03 / 0.31.2 | 类型检查、UI 状态/Demo 两文件 55 项及 Stash 状态/日志/宿主入口/Demo 四文件 34 项通过（Demo 范围重叠，不累加）；无头 `--feedback-only` 与 `--stash-only` 通过。真实 Git 覆盖实际冲突与无关新增暂存文件的 Index 阻碍，消息桥验证响应与日志使用同一脱敏诊断。生产构建和固定 VSIX 打包通过，临时 TMP 资料排除；官方 CLI 已在既有默认 Profile 安装并核对 `alwaygit-dev.alwaygit@0.31.2`，安装记录与固定包哈希一致，上一已安装版本 0.31.1 保留在 previous 包。Markdown 本地文件与图片引用及差异格式检查通过；未运行全量 Vitest 或真实 VS Code 桌面集成 |
| 设置分类与 Diff 显示集中管理 | 2026-10-03 / 0.34.0 | 类型检查、UI 状态与帮助内容两文件 55 项、生产构建及无头 Appearance、Diff、History 专项通过；另检查中英文入口、预览字号与实际行高、默认折叠规则、浅色/深色及窄窗口布局。更新双语手册与设置截图，固定 VSIX 已通过官方 CLI 安装并核对 alwaygit-dev.alwaygit@0.34.0；未启动真实 VS Code 桌面集成测试 |
| 中英文文案资源与翻译接口迁移 | 2026-10-03 / 0.37.0 | 1,145 条资源、生成文件同步、硬编码检查与类型检查通过；15 个相关 Vitest 文件的 142 项检查通过，包含独立语言、原文参数、错误脱敏、协议、取消、确认、跨进程锁及文件展示。跨进程夹具改为打包依赖后只重跑该模块。无头 Workbench、Appearance、Branch、Feedback 专项通过；新旧构建的中英文菜单、设置页和 Push 弹窗共 26 组可见文字 / 提示 / 无障碍标签快照一致。未运行全量 Vitest 或真实 VS Code 桌面集成；既有措辞保持，后续文案核对单独处理 |

以下审查覆盖统计以修复前的 0.47.1 / faf4524 为基线；表中的“已审”表示阅读实现、关联测试与跨层链路，不表示已验证全部环境或保证不存在其他缺陷。

| 范围 | 覆盖方式与审查时结论 |
| --- | --- |
| `src/git`（12 文件）及操作确认 | 已审命令执行、取消、参数、精确范围、引用身份、所选提交、Hook、Stash 和批量反馈；真实临时仓库及本地 Bare Remote 复现已记录于问题日志 |
| `src/application`（10）、`src/extension`（9）、`src/editor`（2）、`src/protocol`（12）、`src/repositories`（3） | 已逐文件审查宿主信任与校验、CSP、路径、IPC、租约、终端、目录事务、监听、会话和资源生命周期；会话、凭据、路径过滤疑点已最小验证 |
| `webview`（74 文件） | 已审状态、RPC、动作与确认、选择、Graph / Diff、文件虚拟化、终端、浮窗、快捷键、文案、Demo 及样式；跨层复核并验证乱序入口、模态键盘与 Unicode 高亮边界 |
| `src/i18n`（46 资源清单、1 手写入口、1 生成文件）及两个 manifest 语言文件 | 资源与手写入口已审；生成文件按生成来源、参数、引用和同步机制核对，不逐行审读派生内容 |
| `tests`（59 单测文件、3 宿主或仓库夹具）、`scripts`（24） | 已审测试断言、真实与 Demo 边界、16 个浏览器专项、构建、打包、本机更新、终端及桌面测试入口；执行范围以本表和证据行注明的结果为准 |
| 根配置、依赖锁、发布工作流、媒体资源与文档 | 已审扩展 manifest、类型 / 构建 / 测试配置、忽略规则、调试任务、发布权限与产物链、锁文件下载及完整性信息；8 份 Markdown 的 121 处本地文件 / 图片引用有效，手册图片均有引用，图像内容未逐张重新验收 |

第三方源码、安装与构建缓存不逐行审读；依赖漏洞查询仅覆盖所用安全数据库在检查时报告的已知问题。macOS、Linux、WSL、Remote SSH、Dev Containers 和最低支持版本仍需相应环境的专项证据。验收矩阵、架构兼容性和测试文件的存在都不等同于这些环境已通过验收。
