# AlwayGit

AlwayGit 是可在 VS Code 编辑器标签页、主侧边栏、第二侧边栏或面板中使用的 Git 图形化工作台。它把仓库与引用导航、提交图、提交详情、工作区状态和只读 Diff 放在同一界面中；文本文件可继续使用 VS Code 原生编辑器，图片和其他二进制文件仅在工作台中预览。

[![发布版本代码分析：语言占比、文件类型与数量、Vitest 测试用例](https://always1010.github.io/AlwayGit/repository-stats.svg)](https://always1010.github.io/AlwayGit/)

图卡标明对应的发布 Tag，仅在稳定版本 Release 成功后更新；首次 Pages 部署前图片暂不可用。[统计口径、Pages 设置与恢复方式](docs/VALIDATION.md#发布版本代码分析)。

## 安装与启动

运行环境为 VS Code 1.106 或更新版本；基础功能要求 Git 2.40+，完整高级操作推荐 Git 2.46+，具体版本要求见[用户手册](docs/USER_MANUAL.zh-CN.md#section-01-01)。源码构建使用 Node.js 24 和 npm。

```powershell
npm ci
npm run build
```

在 VS Code 中打开项目，按 F5 启动 Extension Development Host，然后点击活动栏的 AlwayGit 图标，在侧栏点击 **Show Git Workbench**：按设置打开或聚焦默认位置。侧栏的 **Open Workbench in New Window** 创建一个尚未选择仓库的独立窗口。AlwayGit 视图标题栏齿轮可多选标签页、主侧边栏、第二侧边栏和底部面板，并单独设置默认入口。四个位置可同时使用，状态独立；状态栏图标和 **AlwayGit: Show Workbench** 命令只打开或聚焦默认位置。两侧位置跟随 VS Code 的主侧边栏布局设置；点击应用后打开默认位置。仓库添加、分组、选择和移除都在 Workbench 内完成。

安装包使用固定路径 `artifacts/alwaygit.vsix`。首次手动安装可在扩展视图菜单选择 **Install from VSIX…**；Windows、Linux 通用的安装菜单使用 `node scripts/install.mjs`，Linux 也可使用 `bash scripts/install.sh`。依赖准备、打包、安装校验与 Tag 触发的 GitHub Release 见 [验证与本地更新](docs/VALIDATION.md#打包与本地更新)。

发布包按 `win32-x64`、`linux-x64`、`linux-arm64` 区分。通过 Remote SSH 连接远程电脑时，应根据远程电脑的操作系统与 CPU 架构选择安装包，并安装到远端扩展宿主；操作步骤见[远程安装](docs/USER_MANUAL.zh-CN.md#remote-install)。

## 主要功能

- 多仓库和 工作树 导航、确认式递归发现、仓库移除与自定义项目分组、同窗口多个独立工作台标签。
- 多引用筛选、递归分支树、可分页的拓扑提交图、消息搜索及 HEAD 定位。
- Commit 详情、Merge Parent 选择、双 Commit 自动比较、文件路径筛选及文本与图片只读 Diff。
- 底部 Diff 与多终端共用标签面板，支持 Shell 选择、重命名、终止/重启、折叠及最大化。
- Working Tree 的冲突、Unstaged 和 Staged 管理，整文件及批量操作、Commit、Amend 与每仓库草稿。
- 分支、远程分支、Tag、Stash 和 工作树 管理，以及 Fetch、Pull、Push、Merge、Rebase、Cherry-pick、Reset、Revert 与进行中操作处理。
- 四区 Workbench 布局、可调面板与列宽、明暗主题、Graph 配色、字号、密度、English / 简体中文和会话恢复。
- 工作台内离线帮助与指南，包含快速开始、常见任务、排错和完整中英文手册，支持主题筛选与章节跳转。
- 文本文件的 VS Code 原生编辑与 Diff、项目窗口复用及跨窗口打开。

完整交互、配置和功能边界见 [工作台规格](docs/WORKBENCH_SPEC.md)。

## 文档导航

| 文档 | 职责 |
| --- | --- |
| [用户手册（简体中文）](docs/USER_MANUAL.zh-CN.md) / [User Manual (English)](docs/USER_MANUAL.en.md) | 快速开始、日常操作、终端、快捷键、进阶任务与排错；两版与应用内帮助共用截图 |
| [工作台规格](docs/WORKBENCH_SPEC.md) / [Workbench Specification (English)](docs/WORKBENCH_SPEC.en.md) | 当前产品行为、交互、配置及功能边界 |
| [架构与开发约定](docs/ARCHITECTURE.md) / [Architecture (English)](docs/ARCHITECTURE.en.md) | 运行结构、代码入口、跨层约定、开发流程与当前维护边界 |
| [验证与本地更新](docs/VALIDATION.md) / [Validation (English)](docs/VALIDATION.en.md) | 按改动选择检查、验收范围、验证证据及打包安装流程 |
| [问题日志](docs/ISSUES.md) | 已确认问题的原因、处理与验证记录 |
| [项目协作规则](AGENTS.md) | 提交、文档治理、测试和本机更新的执行规则 |

本项目尚未指定开源许可证，也尚未发布到 Marketplace。
