# Simple File Explorer

[![VS Marketplace](https://vsmarketplacebadges.dev/version-short/panjie039.workspace-file-explorer.svg)](https://marketplace.visualstudio.com/items?itemName=panjie039.workspace-file-explorer)
[![VS Marketplace downloads](https://vsmarketplacebadges.dev/downloads-short/panjie039.workspace-file-explorer.svg)](https://marketplace.visualstudio.com/items?itemName=panjie039.workspace-file-explorer)
[![Open VSX downloads](https://img.shields.io/open-vsx/dt/panjie039/workspace-file-explorer?label=Open%20VSX)](https://open-vsx.org/extension/panjie039/workspace-file-explorer)
[![CI](https://img.shields.io/github/actions/workflow/status/caticat/file-explorer-vscode-extension/ci.yml?branch=master&label=CI)](https://github.com/caticat/file-explorer-vscode-extension/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A Windows Explorer-style file manager for VS Code.

Browse large folders in independent tabs, compare directories with tiled panes,
use familiar Explorer-style selection, and manage files without fighting the
built-in project tree.

Works in local and Remote SSH workspaces.

Designed to feel familiar: common Windows Explorer mouse actions, selection
patterns, and keyboard habits should work naturally.

## Highlights

- Tabbed file browsing in the editor area or optional Activity Bar sidebar.
- Optional tiled panes for comparing folders side by side.
- Details and Large Icons views with persistent sorting.
- Fast large-folder browsing with incremental loading and virtualized
  rendering.
- Windows drive-root navigation with a virtual **This PC** level for switching
  between available drives.
- Cancellable recursive filename search that reuses VS Code exclude settings.
- Windows Explorer-like mouse and keyboard selection.
- File operations: create, rename, copy, cut, paste, trash, and permanent
  delete.
- Remote SSH workspace support.

## Quick Start

Press `Ctrl+Alt+Q` on Windows/Linux or `Cmd+Alt+Q` on macOS.

Or open the Command Palette and run **Simple File Explorer: Open**.

## Demo

The first demo shows tabbed browsing and common file operations. The second demo
shows tiled panes for comparing multiple folders in one editor surface.

![Simple File Explorer usage demonstration](assets/file-explorer.gif)

![Tiled tabs demonstration](assets/file-explorer-tile-tabs.gif)

## Why Simple File Explorer?

VS Code's built-in Explorer is excellent for project structure navigation, but
it is still a tree view.

Simple File Explorer is designed for file-manager workflows:

- Browse folders in independent tabs.
- Compare folders with tiled panes.
- Use Windows Explorer-style mouse and keyboard selection.
- Work with large directories without expanding huge trees.
- Search filenames recursively with cancellation.
- Copy paths, open terminals, and perform common file operations from context
  menus.

## Opening Simple File Explorer

Use any of these methods:

- Press `Ctrl+Alt+Q` on Windows/Linux or `Cmd+Alt+Q` on macOS to toggle the
  editor explorer open or closed.
- Open the Command Palette with `Ctrl+Shift+P` or `F1`, then run
  **Simple File Explorer: Open**.
- Click the folder icon added to the VS Code status bar.
- If `simpleFileExplorer.viewLocation` is set to `sidebar`, click the Simple
  File Explorer icon in the Activity Bar.
- In the built-in VS Code Explorer, right-click a file or folder and select
  **Show in Simple File Explorer**.
- In an editor tab context menu, select **Show in Simple File Explorer** to
  open the containing folder and select the active file.

By default, Simple File Explorer opens in the editor area. Set
`simpleFileExplorer.viewLocation` to `sidebar` to use the Activity Bar sidebar
view instead; in sidebar mode the Activity Bar entry is shown and the status bar
button is hidden. The shortcut toggles the editor explorer when it is already
open. Use the toolbar location button to move the current explorer between the
editor area and sidebar.

## Current status

The core workflow is stable for daily use. New versions mainly refine edge
cases, usability, and platform support.

## Platform support

- Windows and Linux are supported.
- Remote SSH workspaces are supported. The extension runs on the remote
  workspace host so file browsing and file operations apply to remote files.
  **Reveal in System File Manager** is hidden in remote windows because remote
  paths cannot reliably be opened in the local operating system file manager.
  File icon themes can be reused only when the theme is also available to the
  remote extension host; otherwise icons fall back to the built-in Codicon set.
- macOS should work through the same Node.js and VS Code APIs, but is not yet
  part of the tested release matrix.
- Browser-only VS Code environments are not supported because local directory
  streaming uses the Node.js file system API.

## Features

### Layout and navigation

- Opens in the editor area by default, with optional Activity Bar sidebar mode.
- Switches between editor and sidebar locations from the toolbar.
- Fills the available editor or sidebar surface without extra webview padding.
- Starts from the current VS Code workspace folder.
- Supports multi-root workspaces, with one initial tab per root folder when no
  saved session exists.
- Restores tab order, current paths, active tab, and tiled-tab mode per
  workspace when session restoration is enabled, including the virtual
  **This PC** tab on Windows.
- Provides back, forward, up, refresh, breadcrumbs, manual path entry
  (`Ctrl+L`), and one-click workspace Home navigation.
- On Windows, navigating up from a drive root such as `C:\` opens a virtual
  **This PC** view that lists available drives; navigating into a drive returns
  to normal folder browsing.
- Opens files and folders from the built-in VS Code Explorer context menu.
- Reveals the active editor tab file from the editor tab context menu.

### Tabs, panes, and views

- Supports multiple independent file tabs with drag-and-drop tab ordering.
- Provides editor-only tiled tabs mode, where open tabs become independent panes
  in one editor surface.
- Keeps per-pane navigation, address bars, search fields, selection, and file
  operations in tiled mode while sharing display controls.
- Automatically keeps sidebar tabs compact so the new-tab button remains
  reachable.
- Supports Details and Large Icons views.
- Persists the shared view mode and shared sort preference across tabs, tiled
  panes, and VS Code sessions.
- Sorts by name, modified time, or size, including ascending and descending
  direction.
- Lets the modified-time and size columns be shown or hidden from the context
  menu.
- Expands selected filenames in Large Icons view while keeping unselected items
  compact.

### Tree, locations, and icons

- Provides an optional editor-only folder tree with collapse-all, persisted
  visibility, and persisted expanded state.
- Keeps the folder tree rooted at the current VS Code workspace folders, while
  external folders and drive-level navigation stay in the active file tab.
- Lazily follows the active folder path in the tree without expanding sibling
  folders.
- Supports tree expand/collapse from the arrow, double-click, or `Enter` when
  the tree was the most recent navigation target.
- Keeps Large Icons columns stable when the folder tree is shown or hidden.
- Provides recent and favorite location menus in the address bar.
- Lets the current folder be added to or removed from workspace favorites with
  the address-bar star button.
- Reuses the current VS Code file icon theme when possible, with built-in
  Codicon fallbacks.

### Search and performance

- Streams directory entries and virtualizes rendering for large folders.
- Loads metadata for visible rows first instead of running `stat` for every
  file at once.
- De-duplicates and concurrency-limits metadata reads.
- Supports current-folder filtering and cancellable recursive filename search.
- Reuses safe directory names from VS Code `search.exclude` and `files.exclude`
  for recursive-search exclusions.
- Persists recursive-search mode and supports basic filename wildcards:
  `*` and `?`.
- Automatically refreshes visible tabs through debounced, non-recursive
  watchers.
- Falls back to an existing parent or workspace root when an open directory is
  deleted.

### File operations and selection

- Creates files and folders, renames items, moves items to trash, permanently
  deletes items, and copies, cuts, and pastes files.
- Opens and focuses newly created files automatically.
- Selects all newly pasted items together after multi-item paste operations.
- Shows VS Code progress notifications for longer copy, move, trash, and
  permanent-delete operations.
- Supports `Ctrl` / `Cmd` click, `Shift` click, keyboard selection, mouse box
  selection, and `Ctrl+A` / `Cmd+A`.
- Supports empty-area context-menu actions for creating files or folders,
  refreshing, opening a terminal, copying the current folder path, and pasting.
- Provides context-menu text-copy actions for item names, item paths,
  workspace-relative item paths, file folder paths, and workspace-relative file
  folder paths.
- Opens terminals from a selected file's containing folder, a selected folder,
  or the current empty-area folder.
- Navigates from recursive search results to the containing folder with the item
  selected.

### Remote SSH support

- Declares the extension as a VS Code workspace extension so Remote SSH runs it
  on the remote workspace host.
- Applies file browsing, search, watchers, terminals, and file operations to
  remote workspace files in Remote SSH windows.
- Hides **Reveal in System File Manager** in remote windows because remote paths
  cannot reliably be opened in the local operating system file manager.
- Reuses file icon themes in Remote SSH only when the theme is available to the
  remote extension host; otherwise the built-in Codicon icons are used.

### Keyboard shortcuts

- Explorer toggle: `Ctrl+Alt+Q` on Windows/Linux, `Cmd+Alt+Q` on macOS.
- Navigation: `Backspace` / `Alt+Up`, `Alt+Left`, `Alt+Right`, `F5`,
  `Ctrl+L`.
- Selection and activation: `Enter`, `Space`, `Ctrl+A` / `Cmd+A`, arrow keys,
  `Ctrl` focus movement, `Shift` range selection, and incremental filename
  selection by typing.
- File operations: `F2`, `Delete`, `Shift+Delete`, `Ctrl+C`, `Ctrl+X`,
  `Ctrl+V`.
- Search: `/` focuses the active search box.

## Command Palette Actions

These actions are available from the Command Palette and Keyboard Shortcuts
editor. Except for **Simple File Explorer: Toggle**, they do not define default
keyboard shortcuts, so you can bind only the commands you need.

- **Simple File Explorer: Toggle** — toggle the editor explorer.
- **Simple File Explorer: Move Between Editor and Sidebar** — switch the current
  explorer location.
- **Simple File Explorer: New Tab**, **Close Tab**, **Next Tab**,
  **Previous Tab**, and **Activate Tab 1-9** — manage explorer tabs.
- **Simple File Explorer: Focus Search** — focus the active search box.
- **Simple File Explorer: Focus Address Bar** — edit the active path.
- **Simple File Explorer: Toggle Hidden Files** — show or hide dot files.
- **Simple File Explorer: Details View** and **Large Icons** — switch display
  modes.
- **Simple File Explorer: Toggle Folder Tree** and **Collapse Folder Tree** —
  control the editor-only navigation tree.
- **Simple File Explorer: Toggle Tiled Tabs** — switch between tab view and
  tiled-pane view in the editor explorer.

## Settings

- `simpleFileExplorer.restoreWorkspaceSession` — restore tab order, current
  paths, and the active tab separately for each workspace. Default: `true`.
- `simpleFileExplorer.viewLocation` — choose where the explorer opens:
  `editor` or `sidebar`. Default: `editor`.
- `simpleFileExplorer.iconThemeMode` — choose file and folder icons:
  `auto` reuses the current VS Code file icon theme when possible, while
  `codicon` always uses the built-in fallback icons. In Remote SSH windows,
  `auto` can only reuse icon themes available to the remote extension host;
  otherwise the built-in fallback icons are used. Default: `auto`.
- `simpleFileExplorer.treeProbeChildFolders` — check whether folders in the
  editor tree have visible child folders before showing expand arrows. Default:
  `false` for better performance.

## Folder Tree Performance

The editor-only folder tree is lazy loaded. It reads child folders only when a
tree node is expanded, and it does not recursively expand the full workspace.
When the main file view navigates to a folder, the tree lazily expands only the
ancestor chain required to reveal that folder.
The tree remains anchored to the VS Code workspace roots. If a file tab browses
outside the workspace, including Windows drive roots or the virtual **This PC**
view, the tree keeps showing the workspace structure while the active tab shows
the external location.
By default the tree does not probe child folders before expansion, so unloaded
folders show an expand arrow and folders without visible child folders lose the
arrow after they are opened. Enable `simpleFileExplorer.treeProbeChildFolders`
to check one level below visible child folders as they are loaded and hide those
arrows up front.

When the folder tree is hidden, it is not rendered and does not issue tree
directory reads. In editor mode the webview context is retained while hidden so
returning to the explorer does not reset the tree state; this keeps a small
amount of webview state in memory.

## Safety and Privacy

- Simple File Explorer runs inside the VS Code extension host for the current
  workspace.
- It does not upload file names, paths, or file contents to any external
  service.
- No telemetry is collected by this extension.
- File browsing, search, terminals, watchers, and file operations use local or
  remote workspace file-system APIs provided by VS Code and Node.js.
- Trash and permanent delete are separate actions.
- Permanent delete requires confirmation.
- Recursive search is cancellable and reuses safe directory names from VS Code
  `search.exclude` and `files.exclude` settings.

## Feedback

Bug reports and workflow suggestions are welcome through GitHub issues. If
Simple File Explorer helps your daily workflow, a rating on VS Marketplace or
Open VSX also helps other users decide whether to try it.

Thanks for using Simple File Explorer.

## Development

```bash
npm install
npm run compile
npm test
```

Press `F5` in VS Code and run `Simple File Explorer: Open` in the Extension
Development Host.

## Attribution and Originality

This project does not copy source code, styles, or assets from
`Abdulkader-Safi/vscode-file-explorer`. It independently implements a similar
high-level product concept.

## License

The extension source is licensed under the MIT License. The bundled VS Code
Codicon artwork has separate attribution in `THIRD_PARTY_NOTICES.md`.

---

# 中文说明

Simple File Explorer 是一个运行在 VS Code 中的多页签文件浏览器，操作方式接近
Windows 资源管理器。

它适合在大型项目中按目录浏览文件、用平铺 pane 并排对比目录、执行常见文件操作，
并避免在 VS Code 自带树形 Explorer 中反复展开大量目录。

支持本地工作区和 Remote SSH 工作区。

设计目标是尽量贴近 Windows 资源管理器：常见鼠标操作、选择方式和键盘习惯
应当自然可用。

## 亮点

- 可在 editor 主编辑区或可选 Activity Bar sidebar 中浏览文件。
- 支持多页签和并排平铺 pane，方便对比多个目录。
- 支持详细信息和大图标视图，并保留排序偏好。
- 大目录使用流式读取和虚拟滚动。
- Windows 下支持从盘符根目录向上进入虚拟 **This PC** 层级，用于在可用盘符之间切换。
- 支持可取消的递归文件名搜索，并复用 VS Code 排除设置。
- 鼠标和键盘选择方式接近 Windows 资源管理器。
- 支持新建、重命名、复制、剪切、粘贴、删除到回收站和永久删除。
- 支持 Remote SSH 工作区。

## 快速开始

Windows/Linux 按 `Ctrl+Alt+Q`，macOS 按 `Cmd+Alt+Q`。

也可以打开命令面板，执行 **Simple File Explorer: Open**。

## 演示

第一个演示展示多页签浏览和常见文件操作；第二个演示展示平铺 pane，用于在同一个
编辑区并排对比多个目录。

![Simple File Explorer 使用演示](assets/file-explorer.gif)

![平铺页签演示](assets/file-explorer-tile-tabs.gif)

## 为什么需要 Simple File Explorer？

VS Code 自带 Explorer 很适合按项目树浏览代码结构，但它本质上仍是树形视图。

Simple File Explorer 更接近文件管理器工作流：

- 在独立页签中浏览不同目录。
- 用平铺 pane 并排对比目录。
- 使用接近 Windows 资源管理器的鼠标和键盘选择方式。
- 浏览大目录时不需要展开巨大的项目树。
- 可取消地递归搜索文件名。
- 通过右键菜单复制路径、打开终端并执行常见文件操作。

## 打开方式

可以通过以下任意方式打开：

- Windows/Linux 使用 `Ctrl+Alt+Q`，macOS 使用 `Cmd+Alt+Q`，用于打开或关闭
  editor 模式的浏览器。
- 按 `Ctrl+Shift+P` 或 `F1` 打开命令面板，然后执行
  **Simple File Explorer: Open**。
- 默认使用 editor 主编辑区模式，可以点击 VS Code 底部状态栏中的文件夹图标
  打开、聚焦或关闭。
- 如果将 `simpleFileExplorer.viewLocation` 设置为 `sidebar`，可以点击 Activity
  Bar 中的 Simple File Explorer 图标。
- 在 VS Code 自带 Explorer 中右键文件或目录，选择
  **Show in Simple File Explorer**。
- 在编辑器页签右键菜单中选择 **Show in Simple File Explorer**，可以打开当前
  文件所在目录并选中该文件。

快捷键会在 editor 模式下切换 Simple File Explorer 的打开和关闭。默认 editor
模式会显示底部状态栏按钮，并隐藏 Activity Bar 入口；切换到 sidebar 模式后则相反。
也可以通过工具栏中的位置切换按钮在 editor 和 sidebar 模式之间移动当前浏览器。

## 当前状态

核心工作流已可用于日常使用。后续版本主要改进边界情况、易用性和平台支持。

## 主要功能

### 布局和导航

- 默认在 editor 主编辑区打开，也可以切换到 Activity Bar sidebar 模式。
- 可通过工具栏在 editor 和 sidebar 显示位置之间切换。
- 会铺满 editor 或 sidebar 可用区域，不保留额外 webview 边距。
- 默认从当前 VS Code 工作区目录开始。
- 支持多根工作区；没有保存状态时，会为每个根目录创建一个初始页签。
- 可按工作区恢复页签顺序、当前路径、活动页签和平铺页签模式；Windows 下也会恢复
  虚拟 **This PC** 页签。
- 支持前进、后退、向上、刷新、面包屑、手动路径输入 (`Ctrl+L`) 和工作区首页。
- Windows 下从 `C:\` 等盘符根目录继续向上会进入虚拟 **This PC** 视图，显示可用盘符；
  进入某个盘符后会回到普通文件夹浏览。
- 可从 VS Code 自带 Explorer 右键菜单打开文件或目录。
- 可从编辑器页签右键菜单中将当前文件定位到 Simple File Explorer。

### 页签、平铺和视图

- 支持多个独立文件页签，并可拖动调整页签顺序。
- editor 模式支持平铺页签视图，将打开的页签同时显示为多个独立 pane。
- 平铺视图中，每个 pane 保留独立导航、地址栏、搜索框、选择和文件操作，
  同时共享显示控制。
- 侧边栏页签会自动压缩宽度，保持新建页签按钮可用。
- 支持详细信息和大图标两种视图。
- 视图模式和排序偏好会在页签、平铺 pane 和 VS Code 会话之间共享并保留。
- 可按名称、修改时间、大小排序，并保留正序/倒序方向。
- 可通过右键菜单显示或隐藏修改时间和大小列。
- 大图标视图中，选中的文件会展开显示完整文件名，多选时每个选中项都会展开。

### 树形导航、位置和图标

- editor 模式可开启左侧文件夹树，支持一键折叠，并保存显示和展开状态。
- 左侧文件夹树保持以当前 VS Code 工作区根目录为边界；外部目录和盘符层级导航会保留在
  当前文件页签中。
- 主文件区切换目录时，左侧文件夹树会懒加载并展开当前路径的祖先链，不会展开旁支目录。
- 树形目录可以通过箭头、双击，或在最近操作目标为树时按 `Enter` 展开和折叠。
- editor 模式下切换左侧文件夹树时，大图标视图会保持正确列数。
- 地址栏提供最近位置和收藏位置下拉菜单，可快速回到当前工作区中的常用目录。
- 地址栏星标按钮可将当前目录加入或移出当前工作区收藏。
- 默认尝试复用当前 VS Code 文件图标主题，失败时回退到内置 Codicon 图标。

### 搜索和性能

- 大目录使用流式读取和虚拟滚动。
- 优先加载可见区域元数据，不会一次性对所有文件执行 `stat`。
- 元数据读取会去重并限制并发，降低大目录浏览时的文件系统压力。
- 支持当前目录搜索和可取消的递归文件名搜索。
- 递归搜索会复用 VS Code `search.exclude` 和 `files.exclude` 中可安全识别的目录排除规则。
- 递归搜索模式会跨目录、页签和 VS Code 启动保留。
- 文件名搜索支持基础通配符：`*` 匹配任意字符，`?` 匹配单个字符。
- 自动刷新当前打开目录，不递归监控整个项目。
- 当前打开目录被删除时，自动回退到有效父目录或其他工作区根目录。

### 文件操作和选择

- 支持新建文件、新建文件夹、重命名、删除到回收站、永久删除、复制、剪切和粘贴。
- 新建文件后会自动打开并聚焦。
- 粘贴多个文件后会同时选中新生成的内容。
- 复制、移动、删除到回收站和永久删除会显示 VS Code 进度提示。
- 支持 `Ctrl` 点击、`Shift` 点击、鼠标框选、键盘选择和 `Ctrl+A` 全选。
- 支持方向键移动焦点、`Space` 选择、`Ctrl`/`Shift` 配合键盘进行多选和范围选择。
- 空白区域右键菜单可在当前目录中新建文件或文件夹、刷新当前目录、打开终端、
  复制当前目录路径或粘贴文件。
- 右键菜单支持复制名称、路径、工作区相对路径、文件所在文件夹路径，以及文件所在
  文件夹的工作区相对路径，并写入 VS Code 文本剪贴板。
- 右键菜单支持在当前位置打开终端；文件会使用所在目录，文件夹会使用自身目录，
  空白区域会使用当前浏览目录。
- 递归搜索结果可以跳转到所在目录并选中目标项。

### Remote SSH 支持

- 扩展声明为 VS Code workspace extension，因此 Remote SSH 窗口中会运行在远程
  workspace host 上。
- 在 Remote SSH 中，文件浏览、搜索、目录监听、终端和文件操作都作用于远程工作区文件。
- 远程窗口中会隐藏 **Reveal in System File Manager**，因为远程路径无法可靠地在
  本地系统文件管理器中打开。
- 文件图标主题只有在远程 extension host 也可访问时才能复用，否则会回退到内置
  Codicon 图标。

## 常用快捷键

- `Ctrl+L`：输入路径。
- `Backspace` / `Alt+Up`：返回上级目录。
- `Alt+Left` / `Alt+Right`：后退或前进。
- `Enter`：进入选中的目录或打开文件。
- `F2`：重命名。
- `Delete`：移动到回收站。
- `Shift+Delete`：确认后永久删除。
- `Ctrl+C` / `Ctrl+X` / `Ctrl+V`：复制、剪切和粘贴。
- `Ctrl+A` / `Cmd+A`：全选当前显示的文件，包括搜索结果。
- `/`：聚焦当前搜索框。
- `方向键`：在文件区移动选择；`Ctrl` 只移动焦点，`Shift` 扩展范围选择。
- `Space`：选择当前焦点项；`Ctrl+Space` 切换当前焦点项的选中状态。
- `F5`：刷新当前目录。
- 在非输入框中直接输入字符：按文件名前缀快速选中。

## 命令面板动作

这些动作可以在命令面板和 VS Code 键盘快捷方式中搜索到。除了
**Simple File Explorer: Toggle** 之外，它们都不带默认快捷键；需要时可以只绑定
自己常用的命令。

- **Simple File Explorer: Toggle**：切换 editor 浏览器显示。
- **Simple File Explorer: Move Between Editor and Sidebar**：在 editor 和 sidebar
  之间移动当前浏览器。
- **Simple File Explorer: New Tab**、**Close Tab**、**Next Tab**、
  **Previous Tab** 和 **Activate Tab 1-9**：管理浏览器页签。
- **Simple File Explorer: Focus Search**：聚焦当前搜索框。
- **Simple File Explorer: Focus Address Bar**：编辑当前路径。
- **Simple File Explorer: Toggle Hidden Files**：显示或隐藏点文件。
- **Simple File Explorer: Details View** 和 **Large Icons**：切换显示模式。
- **Simple File Explorer: Toggle Folder Tree** 和 **Collapse Folder Tree**：
  控制 editor 模式下的文件夹树。
- **Simple File Explorer: Toggle Tiled Tabs**：在 editor 浏览器的普通页签和平铺
  pane 视图之间切换。

## 设置

- `simpleFileExplorer.restoreWorkspaceSession`：按工作区恢复页签顺序、
  当前路径和活动页签，默认开启。
- `simpleFileExplorer.viewLocation`：选择显示位置，可选 `editor` 或 `sidebar`，
  默认 `editor`。
- `simpleFileExplorer.iconThemeMode`：选择文件和文件夹图标，`auto` 会尽量复用
  当前 VS Code 文件图标主题，`codicon` 始终使用内置兜底图标。Remote SSH 窗口中，
  `auto` 只能复用远程 extension host 可访问的图标主题；否则会回退到内置图标。
  默认 `auto`。
- `simpleFileExplorer.treeProbeChildFolders`：在 editor 树形导航中提前检查文件夹
  是否有可见子文件夹，再决定是否显示展开箭头。默认关闭以获得更好的性能。

## 树形导航性能

左侧文件夹树仅在 editor 模式可用，并采用懒加载。只有展开某个树节点时，
才读取该目录下的子文件夹，不会递归展开整个工作区。默认不会在展开前探测
子目录，因此未加载的文件夹会显示展开箭头；如果展开后没有可见子目录，箭头
会自动消失。开启 `simpleFileExplorer.treeProbeChildFolders` 后，加载某层
目录时会额外检查可见子文件夹的下一层，从而提前隐藏这些箭头。

当主文件区导航到某个目录时，树形导航会只沿当前路径的祖先链逐级展开。
如果某一级还没有加载，只会读取这一层，等返回后继续展开下一层，不会扫描
兄弟目录。
树形导航始终锚定在 VS Code 工作区根目录。当前文件页签浏览到工作区之外时，
包括 Windows 盘符根目录或虚拟 **This PC** 视图，树形导航会继续显示工作区结构，
外部位置由当前页签和地址栏表达。

隐藏文件夹树时，不会渲染树，也不会发起树形目录读取。editor 模式下会保留
webview 上下文，切换到文件编辑器再回来时不会重置树状态；代价是隐藏时会保留
少量 webview 内存状态。

## 安全和隐私

- Simple File Explorer 运行在当前工作区的 VS Code extension host 中。
- 插件不会将文件名、路径或文件内容上传到任何外部服务。
- 插件自身不收集遥测数据。
- 文件浏览、搜索、终端、目录监听和文件操作使用 VS Code 与 Node.js 提供的
  本地或远程工作区文件系统 API。
- 删除到回收站和永久删除是两个不同操作。
- 永久删除需要确认。
- 递归搜索可以取消，并会复用 VS Code `search.exclude` 和 `files.exclude`
  设置中可安全识别的目录排除规则。

## 反馈

欢迎通过 GitHub issues 反馈问题和工作流建议。如果 Simple File Explorer 对你的
日常工作有帮助，也欢迎在 VS Marketplace 或 Open VSX 上评分，帮助其他用户判断
是否值得尝试。

感谢使用 Simple File Explorer。
