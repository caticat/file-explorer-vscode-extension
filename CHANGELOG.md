# Change Log

## 0.2.5

- Added a workspace-specific recent locations menu inside the address bar.
- Shows up to five recent folders while keeping a small saved history of recent
  directories for the current workspace.
- Shares recent locations across tabs and tiled panes while navigation still
  applies only to the active tab or pane.
- Keeps the current folder out of the menu and moves repeated visits to the top
  after successful navigation.
- Added tests for recent-location normalization, de-duplication, display
  filtering, and list limits.

## 0.2.4

- Added **Copy Name** for selected files and folders.
- Added file-only **Copy Folder Path** and **Copy Relative Folder Path** actions
  for copying the containing folder as text.
- Standardized the context-menu grouping so location actions, text-copy
  actions, file operations, and view options are visually separated.
- Standardized VS Code Explorer and editor tab context menu labels on
  **Show in Simple File Explorer**.
- Renamed the view-location command to **Simple File Explorer: Move Between
  Editor and Sidebar** for clearer command-palette wording.
- Fixed external **Show in Simple File Explorer** actions so returning to an
  already-created hidden webview still navigates to and selects the requested
  file or folder.
- Hid modified-time and size column toggles from the context menu while large
  icons are active because those columns are only shown in details view.
- Improved path-copy status messages so workspace-relative actions report the
  absolute-path fallback correctly when the target is outside the workspace.

## 0.2.3

- Added context-menu actions to copy the selected item path or current folder
  path as text without changing the existing file copy/cut/paste behavior.
- Added **Copy Relative Path**, which copies a workspace-relative path when the
  target is inside a workspace root and falls back to the absolute path
  otherwise.
- Added **Open Terminal Here** from item and empty-area context menus. Files
  open the terminal in their containing folder, folders open directly, and
  empty-area actions use the current explorer folder.
- Added footer status feedback after path-copy and terminal-open actions.

## 0.2.2

- Changed the default keyboard shortcut to toggle the editor explorer instead
  of only opening or focusing it.
- Added `/` search focus plus Windows Explorer-style keyboard selection with
  arrow keys, `Space`, `Ctrl`, and `Shift` modifiers.
- Improved search focus handling so text paste remains limited to an explicitly
  focused search box while file paste stays in the file view.
- Selected all newly pasted files after multi-item paste operations instead of
  selecting only the last pasted item.
- Fixed switching from large-icon view to details view so the virtualized file
  list renders both files and folders immediately.
- Expanded README guidance with usage expectations, feedback notes, and the
  updated keyboard behavior.

## 0.2.1

- Added **Reveal in Simple File Explorer** to editor tab context menus so the
  active editor file can be opened and selected in Simple File Explorer.
- Added an in-webview button for switching between editor and sidebar view
  locations while preserving the current workspace session.
- Improved tiled-pane selection and reveal behavior so pane-local drag
  selection, focus, and scroll-to-selected-item handling use the correct pane.
- Improved file operation edge cases, including Windows filename validation and
  copying folders into generated copy targets.
- Refactored file operations, workspace session handling, tree helpers,
  filtering/sorting, virtual-list calculations, selection state, recursive
  search parsing, and icon-theme parsing into focused tested modules.
- Expanded utility test coverage for path handling, recursive search matching,
  icon-theme parsing, pane layout, virtual scrolling, selection behavior, and
  file-operation helpers.

## 0.2.0

- Added editor-only tiled tabs mode, which shows all open internal explorer tabs
  as independent panes in one editor surface.
- Added per-pane navigation, address bars, search fields, context operations,
  create-file/create-folder actions, and focused-pane tracking in tiled mode.
- Added a compact tiled-mode toolbar with shared details/large-icon/hidden-file
  controls and the active pane path.
- Added automatic tiled-pane layouts for uneven tab counts, including expanded
  leading panes when the grid is not full.
- Restored tiled mode as part of the workspace session when the editor view has
  at least two saved tabs.
- Improved tiled-mode rendering so pane focus, selection, search input, list
  scrolling, large-icon layout, and copy/paste refreshes stay stable.
- Hid tiled-mode controls from the sidebar view and kept toolbar grouping
  consistent across editor, sidebar, and tiled modes.
- Added `assets/file-explorer-tile-tabs.gif` and documented tiled tabs in the
  README.

## 0.1.5

- Improved editor folder-tree synchronization so navigating in the main file
  view lazily expands the matching tree path without scanning sibling folders.
- Added double-click and keyboard handling for tree folder expand/collapse while
  keeping single-click navigation immediate.
- Reduced large-folder overhead by avoiding repeated full sorts during streamed
  directory loading and by de-duplicating concurrent metadata reads.
- Narrowed icon-theme resource access to the active icon theme extension and
  cached parsed icon-theme manifests.
- Added progress notifications for copy, move, trash, and permanent-delete
  operations.
- Reused VS Code `search.exclude` and `files.exclude` settings for recursive
  search directory skipping, with only `.git` skipped by default.
- Split common webview path, formatting, and matcher helpers into focused
  modules and added lightweight utility tests.

## 0.1.4

- Standardized user-facing labels on `Simple File Explorer`.
- Open and focus newly created files immediately after creation.
- Kept focus stable after deleting selected files from the explorer.
- Expanded selected large-icon filenames, including multi-selection, while
  keeping unselected large-icon labels compact.

## 0.1.3

- Removed the default webview body padding so the explorer fills the editor and
  sidebar surfaces edge to edge.
- Made the sidebar layout more compact, including narrower tabs, toolbar
  controls, address and search fields, and large-icon cells.
- Fixed editor large-icon view recalculating to a single column after toggling
  the folder tree.

## 0.1.2

- Grouped sidebar toolbar actions into navigation, create, and display
  sections for clearer separation in narrow sidebar layouts.
- Added a bordered background around the sidebar display controls so details,
  large-icon, and hidden-file choices match the editor toolbar styling.
- Updated the bundled usage GIF.

## 0.1.1

- Changed the default view location back to the editor area while keeping the
  sidebar as an optional mode.
- Added `simpleFileExplorer.iconThemeMode` with automatic reuse of the current
  VS Code file icon theme when possible.
- Added fallback handling so unavailable theme icons fall back to built-in
  icons instead of rendering blank entries.
- Added right-click menu toggles for the modified-time and size columns.
- Refined sidebar tab and toolbar layout for narrow sidebars.
- Updated the README for the editor/sidebar default behavior and icon theme
  support.

## 0.1.0

- Changed the default view location to the Activity Bar sidebar.
- Added an optional editor-tab mode controlled by
  `simpleFileExplorer.viewLocation`.
- Added a dedicated compact toolbar for the sidebar layout.
- Updated documentation for sidebar/editor opening behavior, mouse box
  selection, `Ctrl+A` / `Cmd+A`, and context-menu file operations.
- Updated the bundled usage GIF.

## 0.0.19

- Added `Ctrl+A` / `Cmd+A` to select all currently displayed files, including
  search results.
- Added visible-area mouse box selection with optional `Ctrl` / `Cmd` additive
  selection.
- Fixed native text selection artifacts when selecting files from the webview.
- Added empty-area context menu support for paste operations.
- Fixed context-menu copy, cut, paste, rename, and delete actions to execute
  reliably without being interrupted by menu dismissal.
- Refined empty-area click and drag selection behavior to avoid accidental
  selection loss.

## 0.0.18

- Fixed the Home button to return to the workspace root that contains the
  current tab path in multi-root workspaces.
- Added automatic recovery when the currently open directory is deleted.
- Preserved only still-existing selections after a directory refresh.

## 0.0.17

- Added drag-and-drop ordering for internal File Explorer tabs.
- Added optional workspace-scoped session restoration for tab order, current
  paths, and the active tab.
- Added one initial tab per workspace root when a multi-root workspace has no
  saved File Explorer session.

## 0.0.16

- Fixed recursive-search mode being reset for restored tabs, folder changes,
  and newly created tabs.
- Persisted recursive-search mode as a shared extension preference.
- Added `*` and `?` filename wildcards to current-folder and recursive search.

## 0.0.15

- Unified the editor tab, status bar, and Explorer context-menu icon with the
  native VS Code `folder-opened` Codicon.

## 0.0.14

- Changed the Marketplace publisher from the placeholder `local` to the
  existing publisher ID `panjie039`.
- Updated command labels to use the `Simple File Explorer` display name.
- Added Marketplace search keywords.

## 0.0.13

- Renamed the Marketplace display name to `Simple File Explorer` to avoid a
  collision with an existing extension.
- Updated the publish script to publish the exact VSIX that was just packaged.

## 0.0.12

- Simplified the extension icon to a single foreground folder.
- Added a complete Chinese usage section to the README.

## 0.0.11

- Added an original PNG extension icon and connected it to the VS Code manifest.
- Renamed the user-facing extension display name to `File Explorer`.
- Added opening instructions and the animated usage demonstration to the README.

## 0.0.10

- Fixed external file reveal for items far below the current virtual viewport.
- Centered and focused externally revealed files after virtual layout completes.
- Made details/large-icon view mode a global extension preference.
- New and restored tabs now share the saved view mode across VS Code sessions.
- Grouped hidden-file visibility with the other display controls.

## 0.0.9

- Reworked the toolbar with consistent VS Code-style SVG icons and grouping.
- Replaced the view toggle with separate details and large-icon buttons.
- Replaced the hidden-file symbol with an eye control.
- Made address-bar whitespace clickable for direct path entry.
- Moved item and selection status to a compact footer.
- Refined internal tabs, column headers, row spacing, and responsive behavior.

## 0.0.8

- Added `Enter` to open the single selected file or directory.
- Fixed intermittent VS Code Explorer context-menu navigation loss after the
  webview had been hidden or rebuilt.
- Fixed external file selection and scrolling when opening the current folder.

## 0.0.7

- Added `Open in Workspace File Explorer` to the built-in VS Code Explorer
  context menu.
- Files open in their containing folder and are selected; folders open directly.

## 0.0.6

- Added `Shift+Delete` for confirmed permanent deletion.
- Added a VS Code status bar files icon that opens, focuses, or closes the explorer.

## 0.0.5

- Added low-overhead, non-recursive automatic refresh for open directories.
- Added new file, new folder, rename, and move-to-trash operations.
- Added multi-selection plus copy, cut, and paste.
- Added sortable name, modified-time, and size columns.
- Added a per-tab hidden dot-file toggle.

## 0.0.4

- Added `Ctrl+Alt+E` (`Cmd+Alt+E` on macOS) to open or focus the explorer.
- Completed the project MIT license attribution.

## 0.0.3

- Added a context menu for revealing items in the system file explorer.
- Added search-result navigation back to the containing folder with selection.
- Replaced emoji file icons with official VS Code Codicon SVG artwork.
- Added scoped explorer shortcuts and incremental filename selection.

## 0.0.2

- Fixed the large-icon view being clipped by the hidden list header row.
- Moved search into the navigation toolbar.
- Replaced the recursive checkbox with an in-field search option button.
- Removed the redundant Clear button.
- Closing the last internal tab now closes the File Explorer editor tab.

## 0.0.1

- Initial clean-room implementation.
- Added tabbed file navigation, workspace return, breadcrumbs, and manual paths.
- Added list and large-icon views with virtualized rendering.
- Added streaming directory loading and lazy metadata requests.
- Added current-folder and recursive filename search.
