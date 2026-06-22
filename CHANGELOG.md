# Change Log

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
