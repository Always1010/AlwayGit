# AlwayGit

AlwayGit 是运行在 VS Code 编辑器区域中的 Git 图形化工作台。它把仓库与引用导航、提交图、提交详情、工作区状态和只读 Diff 放在同一界面中；文本文件可继续使用 VS Code 原生编辑器，图片和其他二进制文件仅在工作台中预览。

## 安装与启动

运行环境为 VS Code 1.95 或更新版本、Git 2.40 或更新版本。源码构建使用 Node.js 24 和 npm。

```powershell
npm ci
npm run build
```

在 VS Code 中打开项目，按 F5 启动 Extension Development Host，然后点击活动栏的 AlwayGit 图标，在侧栏点击 **Show Git Workbench**：已有工作台标签时聚焦该标签，没有时新建。侧栏的 **Open Workbench in New Window** 创建一个尚未选择仓库的独立窗口。状态栏图标和 **AlwayGit: Show Workbench** 命令复用当前窗口的显示入口；仓库添加、分组、选择和移除都在 Workbench 内完成。

安装包使用固定路径 `artifacts/alwaygit.vsix`。首次手动安装可在扩展视图菜单选择 **Install from VSIX…**；构建、后续本地更新与安装校验见 [验证与本地更新](docs/VALIDATION.md#打包与本地更新)。

## 主要功能

- 多仓库和 工作树 导航、确认式递归发现、仓库移除与自定义项目分组、同窗口多个独立工作台标签。
- 多引用筛选、递归分支树、可分页的拓扑提交图、消息搜索及 HEAD 定位。
- Commit 详情、Merge Parent 选择、双 Commit 自动比较、文件路径筛选及文本与图片只读 Diff。
- Working Tree 的冲突、Unstaged 和 Staged 管理，整文件及批量操作、Commit、Amend 与每仓库草稿。
- 分支、远程分支、Tag、Stash 和 工作树 管理，以及 Fetch、Pull、Push、Merge、Rebase、Cherry-pick、Reset、Revert 与进行中操作处理。
- 四区 Workbench 布局、可调面板与列宽、明暗主题、Graph 配色、字号、密度、English / 简体中文和会话恢复。
- 工作台内离线帮助与指南，包含快速开始、常见任务、排错和完整中英文手册，支持主题筛选与章节跳转。
- 文本文件的 VS Code 原生编辑与 Diff、项目窗口复用及跨窗口打开。

完整交互、配置和功能边界见 [工作台规格](docs/WORKBENCH_SPEC.md)。

## 文档导航

| 文档 | 职责 |
| --- | --- |
| [用户手册（简体中文）](docs/USER_MANUAL.zh-CN.md) / [User Manual (English)](docs/USER_MANUAL.en.md) | 快速开始、日常操作、进阶任务与排错速查；两版共用截图 |
| [工作台规格](docs/WORKBENCH_SPEC.md) | 当前产品行为、交互、配置及功能边界 |
| [架构与开发约定](docs/ARCHITECTURE.md) | 运行结构、代码入口、跨层约定、开发流程与当前维护边界 |
| [验证与本地更新](docs/VALIDATION.md) | 按改动选择检查、验收范围、验证证据及打包安装流程 |
| [问题日志](docs/ISSUES.md) | 已确认问题的原因、处理与验证记录 |
| [项目协作规则](AGENTS.md) | 提交、文档治理、测试和本机更新的执行规则 |

本项目尚未指定开源许可证，也尚未发布到 Marketplace。
