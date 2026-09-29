# 架构与开发约定

本文件维护当前运行结构、模块边界和扩展方式。使用方式和功能范围以 [README](../README.md) 为准。

## 运行结构

AlwayGit 是 Workspace 类型 VS Code 扩展。React WebviewPanel 提供工作台，Node.js 扩展宿主负责 Git 子进程、仓库发现、文件打开和生命周期。前端不直接访问磁盘或执行 Git。

`src/protocol` 维护双方共享类型及 Zod 输入校验。请求通过 `id` 关联响应；宿主发布仓库变更、操作活动和仓库选择事件。宿主只接受已注册仓库和预定义方法，不提供任意命令执行入口。

## 模块边界

| 目录 | 职责 |
| --- | --- |
| `src/extension` | 扩展激活、WebviewPanel、RPC 路由、命令与生命周期 |
| `src/application` | 操作确认、认证桥接、日志脱敏 |
| `src/git` | 系统 Git 执行、结构化解析、查询、操作与共享仓库队列 |
| `src/repositories` | 仓库注册、文件监听、轻量原生导航 |
| `src/editor` | 安全路径解析、只读 Git 文档和原生 Diff |
| `src/protocol` | 数据模型、请求响应与运行时校验 |
| `webview` | React 工作台、Zustand 状态、RPC 客户端、主题 |
| `webview/graph` | 可分页的轨道布局和 SVG 行渲染 |

## 仓库与数据

Repository 标识工作目录；其 `commonDir` 标识共享 Git 存储。同一存储的多个 Worktree 共享写操作队列，但保持独立 HEAD、Index 和工作区状态。每次执行写操作前重新验证注册信息。

Status 使用 porcelain v2 和 NUL 分隔，分别保存 Index 与工作区状态。历史以拓扑顺序读取完整 OID 和父提交，分页请求固定起点 tips。图算法的 pending lanes 可跨页延续；React 虚拟列表只渲染可见行。快照版本和界面请求代数用于识别刷新及过期响应。

文件历史和 Index 内容通过 `alwaygit-content` URI 提供只读文档；工作区一侧使用真实文件 URI。Merge Commit 详情明确选择比较父提交。冲突界面比较 Index Stage 2/3，并允许打开实际文件解决冲突。

## 操作与认证

Git 使用参数数组和 `shell: false`，引用和路径经额外校验，文件操作使用 literal pathspec。对子进程设置输出限制、超时和非交互编辑器；超时终止子进程树。外部 Git 不受内存队列控制，Git 锁及实际返回结果仍是最终依据。

Fetch / Pull / Push 沿用系统 Git Credential Helper、SSH Agent 和配置。需要输入时，通过每次命令独立的回环 IPC AskPass 桥接到 VS Code 输入框。桥接使用随机令牌，结束后关闭；凭据不持久化，不传入 Webview。日志和前端错误隐藏 URL 中的认证信息。

高风险操作由宿主执行明确确认；前端表单用于填写参数。提交遇到未保存文件时说明 Git 提交的是 Index 内容。Git hooks、签名、认证及网络错误都反馈实际失败，不尝试绕过。

未受信任工作区不执行 Git。Webview 使用 CSP、脚本 nonce 和受限资源目录。工作区文件打开校验目录边界及符号链接祖先；已注册 Worktree 才能通过工作台打开。

## 验证方式

单元测试覆盖协议、路径、图布局、渲染和认证桥。Git 集成测试使用系统临时目录的真实仓库和本地 Bare Remote。VS Code 测试验证扩展激活、仓库发现、RPC、原生 Diff 与文件编辑入口。浏览器测试验证打包后的工作台布局和交互，其显式 `?demo=1` 模式只修改示例数据。

构建输出、安装包、截图、测试报告和缓存均在忽略范围内。新增 Git 操作需要同时维护协议校验、Git 实现、界面入口和真实仓库测试。
