# 问题日志

本文记录已确认的项目 Bug、异常与明确影响现有行为的实现不足；当前产品行为以 [工作台规格](WORKBENCH_SPEC.md) 为准。

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
