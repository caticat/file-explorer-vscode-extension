# Simple File Explorer

A clean-room VS Code extension that provides a Windows-style, tabbed file browser
inside the editor area.

![File Explorer extension icon](assets/file-explorer.png)

## Opening File Explorer

Use any of these methods:

- Press `Ctrl+Alt+E` on Windows/Linux or `Cmd+Alt+E` on macOS.
- Open the Command Palette with `Ctrl+Shift+P` or `F1`, then run
  **Simple File Explorer: Open**.
- Click the folder icon added to the VS Code status bar.
- In the built-in VS Code Explorer, right-click a file or folder and select
  **Open in Simple File Explorer**.

The shortcut and command focus the existing File Explorer editor when it is
already open. The status bar button toggles it: open, focus, or close.

## Demo

![File Explorer usage demonstration](assets/file-explorer.gif)

## Current features

- Starts at the current VS Code workspace folder.
- Opens or focuses with `Ctrl+Alt+E` (`Cmd+Alt+E` on macOS).
- Opens, focuses, or closes from the files icon in the VS Code status bar.
- Opens files and folders from the built-in VS Code Explorer context menu.
- One-click return to the workspace root.
- Multiple independent file tabs.
- Back, forward, up, refresh, breadcrumbs, and manual path entry (`Ctrl+L`).
- Detailed list and large-icon views.
- A shared view-mode preference that persists across tabs and VS Code sessions.
- Streaming directory enumeration and virtualized rendering for large folders.
- Visible-row metadata loading instead of running `stat` for every file at once.
- Current-folder filtering and cancellable recursive filename search.
- Windows and Linux path handling.
- Automatic refresh using debounced, non-recursive watchers for visible tabs.
- New file, new folder, rename, and move-to-trash operations.
- Multi-selection, copy, cut, and paste.
- Sortable name, modified-time, and size columns.
- Per-tab hidden dot-file visibility.
- Context-menu reveal in the operating system file explorer.
- Search-result navigation to the containing folder with the item selected.
- Explorer shortcuts: `Backspace`/`Alt+Up`, `Alt+Left`, `Alt+Right`, `F5`,
  `Ctrl+L`, `Enter`, `Delete`, `Shift+Delete`, and incremental filename
  selection by typing.

## Development

```bash
npm install
npm run compile
```

Press `F5` in VS Code and run `File Explorer: Open` in the Extension Development
Host.

## Scope

This project does not copy source code, styles, or assets from
`Abdulkader-Safi/vscode-file-explorer`. It independently implements a similar
high-level product concept.

## Platform support

- Windows and Linux are supported.
- macOS should work through the same Node.js and VS Code APIs, but is not yet
  part of the tested release matrix.
- Browser-only VS Code environments are not supported because local directory
  streaming uses the Node.js file system API.

## License

The extension source is licensed under the MIT License. The bundled VS Code
Codicon artwork has separate attribution in `THIRD_PARTY_NOTICES.md`.

---

# 中文说明

Simple File Explorer 是一个运行在 VS Code 编辑区中的多页签文件浏览器，操作方式
接近 Windows 资源管理器。它适合在大型项目中按目录浏览和查找文件，避免在
VS Code 自带的树形 Explorer 中反复展开大量目录。

## 打开方式

可以通过以下任意方式打开：

- Windows/Linux 使用 `Ctrl+Alt+E`，macOS 使用 `Cmd+Alt+E`。
- 按 `Ctrl+Shift+P` 或 `F1` 打开命令面板，然后执行
  **Simple File Explorer: Open**。
- 点击 VS Code 底部状态栏中的文件夹图标。
- 在 VS Code 自带 Explorer 中右键文件或目录，选择
  **Open in Simple File Explorer**。

快捷键和命令会优先切换到已经打开的 File Explorer。状态栏按钮可以打开、
聚焦或关闭 File Explorer。

## 主要功能

- 多页签、前进、后退、向上、工作区首页和手动路径输入。
- 详细信息和大图标两种视图，并在所有页签和下次启动时继承视图设置。
- 大目录流式读取、虚拟滚动和可见区域元数据加载。
- 当前目录搜索和可取消的递归文件名搜索。
- 新建、重命名、删除到回收站、永久删除、复制、剪切和粘贴。
- 多选、按名称/修改时间/大小排序、隐藏点文件切换。
- 自动刷新当前打开目录，不递归监控整个项目。
- 支持 Windows 和 Linux；macOS 理论兼容但尚未正式测试。

## 常用快捷键

- `Ctrl+L`：输入路径。
- `Backspace` / `Alt+Up`：返回上级目录。
- `Alt+Left` / `Alt+Right`：后退或前进。
- `Enter`：进入选中的目录或打开文件。
- `F2`：重命名。
- `Delete`：移动到回收站。
- `Shift+Delete`：确认后永久删除。
- `Ctrl+C` / `Ctrl+X` / `Ctrl+V`：复制、剪切和粘贴。
- `F5`：刷新当前目录。
- 在非输入框中直接输入字符：按文件名前缀快速选中。
