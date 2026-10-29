# AlwayGit

English | [简体中文](README.zh-CN.md)

AlwayGit is a graphical Git workbench for VS Code editor tabs, the Primary Sidebar, Secondary Sidebar, and Panel. It brings repository and reference navigation, commit history, commit details, working-directory status, and read-only diffs into one interface. Text files can open in VS Code's native editor; images and other binary files are previewed inside the Workbench.

![AlwayGit Workbench showing repository and branch navigation, commit history, working-tree status, and a side-by-side file diff](docs/images/user-manual/figure-03.png)

Workbench overview rendered with real UI components and an example repository. See the [user manual's screenshot notes](docs/USER_MANUAL.en.md#screenshot-notes) for capture details. Click the image to view it at full size.

## Installation and launch

Use VS Code 1.106 or later. Basic functionality requires Git 2.40+; Git 2.46+ is recommended for all advanced operations. See the [manual requirements](docs/USER_MANUAL.en.md#section-01-01) for operation-specific minimums. Building from source uses Node.js 24 and npm.

```powershell
npm ci
npm run build
```

Open this project in VS Code and press F5 to launch the Extension Development Host. Click the AlwayGit Activity Bar icon, then **Open Workbench** in the launcher to open or focus the configured default location. **Open Workbench in New Window** creates an independent window without a repository selected. The AlwayGit view-title gear enables one or more of Editor Tab, Primary Sidebar, Secondary Sidebar, and Panel, and selects the default entry. All four locations can coexist with independent state. The status-bar icon and **AlwayGit: Show Workbench** command open or focus only the default. Sidebar directions follow VS Code's primary-sidebar placement. Applying location settings opens the default. Add, group, select, and remove repositories inside the Workbench.

The fixed installation package is `artifacts/alwaygit.vsix`. For an initial manual installation, choose **Install from VSIX…** from the Extensions view menu. The shared Windows/Linux installation menu is `node scripts/install.mjs`; Linux also supports `bash scripts/install.sh`. Dependency preparation, packaging, installation verification, and Tag-triggered GitHub Releases are described in [Validation and Local Updates](docs/VALIDATION.en.md#packaging-and-local-update).

Release packages target `win32-x64`, `linux-x64`, and `linux-arm64`. With Remote SSH, choose the package matching the remote computer's operating system and CPU architecture and install it into the remote extension host. See [remote installation](docs/USER_MANUAL.en.md#remote-install).

## Main features

- Multiple repositories and Worktrees, confirmed recursive discovery, repository removal and custom groups, and independent Workbench tabs in one window.
- Multiple-reference filters, recursive branch trees, paginated topological commit graphs, file history, combined author/date/path/code-change searches, and HEAD location.
- Commit details, complete commit trees and two-commit tree differences in independent tabs with optional change markers, Merge Parent selection, automatic two-commit and bidirectional branch comparison, file-path filtering, and read-only text/image diffs.
- Shared bottom Diff and terminal tabs with Shell selection, renaming, termination/restart, collapse, and maximization.
- Working Tree conflict, Unstaged, and Staged management; whole-file, Git-hunk, and bulk staging actions; Commit, Amend, and per-repository drafts.
- Conflict-file navigation, native three-way merge editing with a manual fallback, complete-side selection, and reviewed staged results before continuation.
- Git LFS status, tracking-rule previews, object fetching/uploading, cache checkout, and explicit historical-object downloads and previews.
- Branch, remote-branch, Tag, Stash, and Worktree management, plus Fetch, Pull, Push, Merge, ordinary and interactive Rebase, Cherry-pick, Reset, Revert, and active-operation handling.
- Reflog browsing and recovery-branch creation, plus a Worktree status overview.
- Four-region layout, resizable panels/columns, light/dark themes, Graph palettes, font size/density, English/Simplified Chinese, and session restoration.
- Offline Help & Guide with quick start, common tasks, troubleshooting, complete bilingual manuals, topic filtering, and section navigation.
- Native VS Code text editing/Diff, existing project-window reuse, and opening across windows.

For complete interactions, configuration, and feature boundaries, see the [Workbench Specification](docs/WORKBENCH_SPEC.en.md).

## Documentation

| Document | Purpose |
| --- | --- |
| [User Manual (English)](docs/USER_MANUAL.en.md) / [用户手册（简体中文）](docs/USER_MANUAL.zh-CN.md) | Quick start, everyday operations, terminals, shortcuts, advanced tasks, and troubleshooting; both editions and in-application help share screenshots |
| [Workbench Specification](docs/WORKBENCH_SPEC.en.md) | Current product behavior, interactions, configuration, and feature boundaries |
| [Architecture and Development](docs/ARCHITECTURE.en.md) | Runtime structure, code entry points, conventions across layers, development workflow, and maintenance boundaries |
| [Validation and Local Updates](docs/VALIDATION.en.md) | Checks appropriate to each change, acceptance scope, validation evidence, packaging, and installation |
| [Issue Log (Chinese)](docs/ISSUES.md) | Causes, fixes, and validation records for confirmed problems |
| [Project Collaboration Rules (Chinese)](AGENTS.md) | Rules for commits, documentation, testing, and local updates |

The project has not specified an open-source license and has not been published to the VS Code Marketplace.

## Release code analysis

The card identifies its release Tag and updates only after a stable Release succeeds. See [counting rules, Pages setup, and recovery](docs/VALIDATION.en.md#release-code-analysis).

[![Release code analysis: language shares, file types and counts, and Vitest test cases](https://always1010.github.io/AlwayGit/repository-stats.en.svg)](https://always1010.github.io/AlwayGit/index.en.html)
