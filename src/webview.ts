import "./webview.css";
import { formatSize } from "./webviewFormat";
import { createNameMatcher } from "./webviewMatcher";
import { copySelectionStatus, uniqueWatcherPaths } from "./webviewCommandState";
import {
  type ItemSortState,
  emptyStateMessage,
  filterItems,
  nextSortState,
  normalizeSortState,
  sortItemsInPlace
} from "./webviewItems";
import { paneGridLayout, paneRowSpan } from "./webviewPane";
import {
  type SelectionState as PureSelectionState,
  dragSelectionState,
  emptySelectionState,
  keyboardActivationSelectionState,
  type KeyboardNavigationKey,
  keyboardNavigationState,
  normalizedRect,
  rectsIntersect,
  selectAllSelectionState,
  selectionBoxLayout,
  shouldSuppressDragClickState,
  updateSelectionState
} from "./webviewSelection";
import {
  basenameForPlatform,
  dirnameForPlatform,
  isPathInsideOrEqualForPlatform,
  normalizeForComparisonForPlatform,
  splitPathForPlatform
} from "./webviewPath";
import {
  type IconThemePayload,
  type ListColumnPreferences,
  type WorkspaceSession,
  FAVORITE_LOCATIONS_SAVE_LIMIT,
  RECENT_LOCATIONS_DISPLAY_LIMIT,
  RECENT_LOCATIONS_SAVE_LIMIT,
  addFavoriteLocation,
  addRecentLocation,
  initialActiveTabIndex,
  initialTabPaths,
  isFavoriteLocation,
  isWorkspaceSession,
  normalizeFavoriteLocations,
  normalizeIconTheme,
  normalizeRecentLocations,
  normalizeListColumns,
  removeFavoriteLocation,
  restoredLayoutMode,
  visibleRecentLocations
} from "./webviewState";
import {
  canToggleTreeNodeState,
  treeAncestorPathsForRevealTarget,
  treeNodeKey
} from "./webviewTree";
import {
  cleanSelectionState,
  workspacePathForCurrentPath
} from "./webviewWorkspace";
import {
  isVirtualDrivesPath,
  isWindowsDriveRoot,
  VIRTUAL_DRIVES_PATH
} from "./webviewVirtualDrives";
import {
  metadataPathsToRequest,
  revealScrollTop,
  virtualListLayout,
  virtualRenderSignature
} from "./webviewVirtualList";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

interface DirectoryItem {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  relativePath?: string;
  size?: number;
  modified?: number;
  hasChildren?: boolean;
}

interface WorkspaceRoot {
  name: string;
  path: string;
}

interface ExplorerTab {
  id: string;
  path: string;
  title: string;
  items: DirectoryItem[];
  filteredItems: DirectoryItem[];
  history: string[];
  historyIndex: number;
  viewMode: "list" | "grid";
  loading: boolean;
  requestId?: string;
  searchRequestId?: string;
  searchQuery: string;
  recursiveSearch: boolean;
  searchMode: boolean;
  status: string;
  scrollTop: number;
  selectedPath?: string;
  pendingRevealPath?: string;
  selectedPaths: string[];
  selectionAnchorPath?: string;
  showHidden: boolean;
  preserveFocusAfterReveal?: boolean;
  focusViewportAfterLoad?: boolean;
  pendingRecentLocation?: string;
  sortKey: ItemSortState["sortKey"];
  sortDirection: ItemSortState["sortDirection"];
  externalNavigationId?: string;
}

interface TreeNodeState {
  path: string;
  name: string;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  hasChildren?: boolean;
  expanded: boolean;
  loading: boolean;
  loaded: boolean;
  error?: string;
  requestId?: string;
  children: DirectoryItem[];
}

const vscode = acquireVsCodeApi();
const app = document.getElementById("app")!;
const metadataRequested = new Set<string>();

let workspaceRoots: WorkspaceRoot[] = [];
let initialPath = "";
let pathSeparator = "/";
let platform = "linux";
let viewKind: "editor" | "sidebar" = "editor";
let preferredViewMode: ExplorerTab["viewMode"] = "list";
let preferredRecursiveSearch = false;
let preferredSortState: ItemSortState = { sortKey: "name", sortDirection: "asc" };
let listColumns: ListColumnPreferences = { modified: true, size: true };
let iconTheme: IconThemePayload | undefined;
let restoreWorkspaceSession = true;
let revealInSystemAvailable = true;
let tabs: ExplorerTab[] = [];
let activeTabId = "";
let recentLocations: string[] = [];
let favoriteLocations: string[] = [];
let renderScheduled = false;
let sessionSaveTimer = 0;
let suppressSessionSave = false;
let layoutMode: "tabs" | "panes" = "tabs";
let draggingTabId: string | undefined;
let contextMenuItem: DirectoryItem | undefined;
let typeAheadBuffer = "";
let typeAheadTimer = 0;
let clipboardPaths: string[] = [];
let clipboardCut = false;
let selectionDrag: SelectionDragState | undefined;
let suppressedDragClick: SuppressedDragClick | undefined;
let textPasteSearchInput: HTMLInputElement | undefined;
let keyboardTarget: "items" | "tree" = "items";
let treeVisible = false;
let treeShowHidden = false;
let treeProbeChildFolders = false;
let preferredTreeExpandedPaths = new Set<string>();
let lastTreeClick: { path: string; time: number } | undefined;
let focusedTreePath: string | undefined;
let pendingTreeRevealPath: string | undefined;
const treeNodes = new Map<string, TreeNodeState>();
const treeRequests = new Map<string, string>();

interface SelectionDragState {
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  additive: boolean;
  baseSelection: string[];
  active: boolean;
  viewport: HTMLElement;
  items: HTMLElement;
  selectionBox: HTMLElement;
}

interface SuppressedDragClick {
  clientX: number;
  clientY: number;
  expiresAt: number;
}

interface PaneRenderElements {
  viewport: HTMLElement;
  spacer: HTMLElement;
  items: HTMLElement;
  empty: HTMLElement;
}

app.innerHTML = `
  <div class="shell">
    <div class="tabs-bar">
      <div id="tabs" class="tabs"></div>
      <button id="new-tab" class="icon-button" title="New tab" aria-label="New tab">${toolbarIcon(
        "M8 1.5V14.5M1.5 8H14.5"
      )}</button>
      <button id="tile-tabs" class="icon-button" title="Tile tabs" aria-label="Tile tabs" aria-pressed="false">${toolbarIcon(
        "M2.5 2.5h5v11h-5v-11ZM9.5 2.5h4v4.5h-4V2.5ZM9.5 9h4v4.5h-4V9Z"
      )}</button>
      <button id="toggle-view-location" class="icon-button" title="Move to Sidebar" aria-label="Move to Sidebar">${toolbarIcon(
        "M2 2.5h12v11H2v-11ZM5.5 2.5v11"
      )}</button>
      <div id="tile-active-path" class="tile-active-path pane-mode-control" title=""></div>
      <span class="tabs-bar-separator pane-mode-control" aria-hidden="true"></span>
      <button id="tile-list-view" class="icon-button pane-mode-control" title="Details view" aria-label="Details view">${toolbarIcon(
        "M2 3.5h2v2H2v-2ZM6 4.5h8M2 7h2v2H2V7ZM6 8h8M2 10.5h2v2H2v-2ZM6 11.5h8"
      )}</button>
      <button id="tile-grid-view" class="icon-button pane-mode-control" title="Large icons" aria-label="Large icons">${toolbarIcon(
        "M2 2.5h5v5H2v-5ZM9 2.5h5v5H9v-5ZM2 9h5v5H2V9ZM9 9h5v5H9V9Z"
      )}</button>
      <button id="tile-toggle-hidden" class="icon-button pane-mode-control" title="Show hidden files" aria-label="Show hidden files">${toolbarIcon(
        "M1.5 8s2.5-4 6.5-4 6.5 4 6.5 4-2.5 4-6.5 4S1.5 8 1.5 8ZM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"
      )}</button>
    </div>
    <div class="toolbar">
      <button id="toggle-tree" class="icon-button" title="Show folder tree" aria-label="Show folder tree" aria-pressed="false">${toolbarIcon(
        "M2 2.5h4l1 1.5H14v3H2v-4.5ZM4 8.5h4l1 1.5h5v3.5H4v-5ZM2 5.5v5h2"
      )}</button>
      <button id="collapse-tree" class="icon-button" title="Collapse folder tree" aria-label="Collapse folder tree">${toolbarIcon(
        "M3 5h10M5 8h6M7 11h2"
      )}</button>
      <span id="tree-toolbar-divider" class="toolbar-divider tree-toolbar-divider" aria-hidden="true"></span>
      <div class="toolbar-group navigation-group">
        <button id="back" class="icon-button" title="Back" aria-label="Back">${toolbarIcon(
          "M10.5 3.5L6 8l4.5 4.5M6.5 8H14"
        )}</button>
        <button id="forward" class="icon-button" title="Forward" aria-label="Forward">${toolbarIcon(
          "M5.5 3.5L10 8l-4.5 4.5M9.5 8H2"
        )}</button>
        <button id="up" class="icon-button" title="Up" aria-label="Up">${toolbarIcon(
          "M8 13V3M4 7l4-4 4 4"
        )}</button>
        <button id="workspace-home" class="icon-button" title="Back to workspace" aria-label="Back to workspace">${toolbarIcon(
          "M2 7.5L8 2l6 5.5V14H9.5v-4h-3v4H2V7.5Z"
        )}</button>
        <button id="refresh" class="icon-button" title="Refresh" aria-label="Refresh">${toolbarIcon(
          "M13 5V2.5M13 2.5h-2.5M13 2.5A6 6 0 1 0 14 9"
        )}</button>
      </div>
      <span class="toolbar-divider" aria-hidden="true"></span>
      <div class="toolbar-group create-group">
        <button id="new-file" class="icon-button" title="New file" aria-label="New file">${toolbarIcon(
          "M4 1.5h5l3 3V14H4V1.5ZM9 1.5v3h3M8 7v4M6 9h4"
        )}</button>
        <button id="new-folder" class="icon-button" title="New folder" aria-label="New folder">${toolbarIcon(
          "M1.5 4h5l1.5 2H14v7H1.5V4ZM8 8v3M6.5 9.5h3"
        )}</button>
      </div>
      <span class="toolbar-divider" aria-hidden="true"></span>
      <div class="address-container">
        <div id="address" class="address"></div>
        <input id="address-input" class="address-input hidden" spellcheck="false">
        <button id="favorite-location" class="address-action-button favorite-location-button" title="Add to favorites" aria-label="Add to favorites" aria-pressed="false">${toolbarIcon(
          "M8 1.75 9.9 5.65 14.2 6.25 11.1 9.25 11.85 13.5 8 11.5 4.15 13.5 4.9 9.25 1.8 6.25 6.1 5.65 8 1.75Z"
        )}</button>
        <button id="recent-locations" class="address-action-button recent-locations-button" title="Recent and favorite locations" aria-label="Recent and favorite locations">${toolbarIcon(
          "M4 6l4 4 4-4"
        )}</button>
      </div>
      <div class="search-box">
        ${toolbarIcon("M6.5 2.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9.5 9.5 14 14", "search-icon")}
        <input
          id="search-input"
          type="search"
          placeholder="Search"
          title="Search by name. Supports * and ? wildcards."
        >
        <button
          id="recursive-search"
          class="search-option"
          type="button"
          title="Search subfolders"
          aria-label="Search subfolders"
          aria-pressed="false"
        >${toolbarIcon("M2 3.5h5l1.5 2H14v7H2v-9ZM6 8h5M9 6l2 2-2 2")}</button>
      </div>
      <span class="toolbar-divider" aria-hidden="true"></span>
      <div class="view-switch" role="group" aria-label="Display options">
        <button id="list-view" class="icon-button" title="Details view" aria-label="Details view">${toolbarIcon(
          "M2 3.5h2v2H2v-2ZM6 4.5h8M2 7h2v2H2V7ZM6 8h8M2 10.5h2v2H2v-2ZM6 11.5h8"
        )}</button>
        <button id="grid-view" class="icon-button" title="Large icons" aria-label="Large icons">${toolbarIcon(
          "M2 2.5h5v5H2v-5ZM9 2.5h5v5H9v-5ZM2 9h5v5H2V9ZM9 9h5v5H9V9Z"
        )}</button>
        <button id="toggle-hidden" class="icon-button" title="Show hidden files" aria-label="Show hidden files">${toolbarIcon(
          "M1.5 8s2.5-4 6.5-4 6.5 4 6.5 4-2.5 4-6.5 4S1.5 8 1.5 8ZM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"
        )}</button>
      </div>
      <div class="sidebar-toolbar" role="group" aria-label="Sidebar Simple File Explorer actions">
        <div class="sidebar-toolbar-group sidebar-navigation-group">
          <button id="sidebar-back" class="icon-button" title="Back" aria-label="Back">${toolbarIcon(
            "M10.5 3.5L6 8l4.5 4.5M6.5 8H14"
          )}</button>
          <button id="sidebar-up" class="icon-button" title="Up" aria-label="Up">${toolbarIcon(
            "M8 13V3M4 7l4-4 4 4"
          )}</button>
          <button id="sidebar-workspace-home" class="icon-button" title="Back to workspace" aria-label="Back to workspace">${toolbarIcon(
            "M2 7.5L8 2l6 5.5V14H9.5v-4h-3v4H2V7.5Z"
          )}</button>
          <button id="sidebar-refresh" class="icon-button" title="Refresh" aria-label="Refresh">${toolbarIcon(
            "M13 5V2.5M13 2.5h-2.5M13 2.5A6 6 0 1 0 14 9"
          )}</button>
        </div>
        <span class="sidebar-toolbar-divider" aria-hidden="true"></span>
        <div class="sidebar-toolbar-group sidebar-create-group">
          <button id="sidebar-new-file" class="icon-button" title="New file" aria-label="New file">${toolbarIcon(
            "M4 1.5h5l3 3V14H4V1.5ZM9 1.5v3h3M8 7v4M6 9h4"
          )}</button>
          <button id="sidebar-new-folder" class="icon-button" title="New folder" aria-label="New folder">${toolbarIcon(
            "M1.5 4h5l1.5 2H14v7H1.5V4ZM8 8v3M6.5 9.5h3"
          )}</button>
        </div>
        <span class="sidebar-toolbar-divider" aria-hidden="true"></span>
        <div class="sidebar-toolbar-group sidebar-view-switch" role="group" aria-label="Sidebar display options">
          <button id="sidebar-list-view" class="icon-button" title="Details view" aria-label="Details view">${toolbarIcon(
            "M2 3.5h2v2H2v-2ZM6 4.5h8M2 7h2v2H2V7ZM6 8h8M2 10.5h2v2H2v-2ZM6 11.5h8"
          )}</button>
          <button id="sidebar-grid-view" class="icon-button" title="Large icons" aria-label="Large icons">${toolbarIcon(
            "M2 2.5h5v5H2v-5ZM9 2.5h5v5H9v-5ZM2 9h5v5H2V9ZM9 9h5v5H9V9Z"
          )}</button>
          <button id="sidebar-toggle-hidden" class="icon-button" title="Show hidden files" aria-label="Show hidden files">${toolbarIcon(
            "M1.5 8s2.5-4 6.5-4 6.5 4 6.5 4-2.5 4-6.5 4S1.5 8 1.5 8ZM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"
          )}</button>
        </div>
      </div>
    </div>
    <div class="content">
      <aside id="tree-pane" class="tree-pane" aria-label="Folder tree">
        <div id="tree-items" class="tree-items"></div>
      </aside>
      <main class="main-pane">
        <div id="list-header" class="list-header">
          <button data-sort="name">Name</button>
          <button data-sort="modified">Modified</button>
          <button data-sort="size">Size</button>
        </div>
        <div id="viewport" class="viewport" tabindex="0">
          <div id="spacer" class="spacer"></div>
          <div id="items" class="items"></div>
          <div id="empty" class="empty hidden"></div>
          <div id="selection-box" class="selection-box hidden"></div>
        </div>
      </main>
      <div id="pane-grid" class="pane-grid hidden"></div>
    </div>
    <div class="footer-bar">
      <span id="status" class="status"></span>
      <span id="selection-status" class="selection-status"></span>
    </div>
  </div>
  <div id="context-menu" class="context-menu hidden" role="menu">
    <button id="new-file-menu" role="menuitem">New File</button>
    <button id="new-folder-menu" role="menuitem">New Folder</button>
    <button id="refresh-menu" role="menuitem">Refresh</button>
    <div id="create-menu-separator" class="menu-separator"></div>
    <button id="reveal-system" role="menuitem">Reveal in System File Manager</button>
    <button id="show-in-explorer" role="menuitem">Show in Simple File Explorer</button>
    <div id="item-menu-separator" class="menu-separator"></div>
    <button id="open-terminal-here" role="menuitem">Open Terminal Here</button>
    <div id="location-menu-separator" class="menu-separator"></div>
    <button id="copy-name" role="menuitem">Copy Name</button>
    <button id="copy-path" role="menuitem">Copy Path</button>
    <button id="copy-relative-path" role="menuitem">Copy Relative Path</button>
    <button id="copy-directory-path" role="menuitem">Copy Folder Path</button>
    <button id="copy-relative-directory-path" role="menuitem">Copy Relative Folder Path</button>
    <div id="path-menu-separator" class="menu-separator"></div>
    <button id="rename-item" role="menuitem">Rename</button>
    <button id="copy-items" role="menuitem">Copy</button>
    <button id="cut-items" role="menuitem">Cut</button>
    <button id="paste-items" role="menuitem">Paste</button>
    <button id="delete-items" role="menuitem">Move to Trash</button>
    <div id="view-menu-separator" class="menu-separator"></div>
    <button id="toggle-modified-column-menu" role="menuitemcheckbox" aria-checked="true">Show Modified</button>
    <button id="toggle-size-column-menu" role="menuitemcheckbox" aria-checked="true">Show Size</button>
  </div>
  <div id="recent-locations-menu" class="recent-locations-menu hidden" role="menu"></div>
`;

const elements = {
  tabs: byId("tabs"),
  newTab: button("new-tab"),
  tileTabs: button("tile-tabs"),
  toggleViewLocation: button("toggle-view-location"),
  tileActivePath: byId("tile-active-path"),
  tileListView: button("tile-list-view"),
  tileGridView: button("tile-grid-view"),
  tileToggleHidden: button("tile-toggle-hidden"),
  back: button("back"),
  forward: button("forward"),
  up: button("up"),
  workspaceHome: button("workspace-home"),
  refresh: button("refresh"),
  toggleTree: button("toggle-tree"),
  collapseTree: button("collapse-tree"),
  treeToolbarDivider: byId("tree-toolbar-divider"),
  newFile: button("new-file"),
  newFolder: button("new-folder"),
  address: byId("address"),
  addressInput: input("address-input"),
  favoriteLocation: button("favorite-location"),
  recentLocations: button("recent-locations"),
  listView: button("list-view"),
  gridView: button("grid-view"),
  toggleHidden: button("toggle-hidden"),
  sidebarBack: button("sidebar-back"),
  sidebarUp: button("sidebar-up"),
  sidebarWorkspaceHome: button("sidebar-workspace-home"),
  sidebarRefresh: button("sidebar-refresh"),
  sidebarNewFile: button("sidebar-new-file"),
  sidebarNewFolder: button("sidebar-new-folder"),
  sidebarListView: button("sidebar-list-view"),
  sidebarGridView: button("sidebar-grid-view"),
  sidebarToggleHidden: button("sidebar-toggle-hidden"),
  searchInput: input("search-input"),
  recursiveSearch: button("recursive-search"),
  status: byId("status"),
  selectionStatus: byId("selection-status"),
  treePane: byId("tree-pane"),
  treeItems: byId("tree-items"),
  listHeader: byId("list-header"),
  viewport: byId("viewport"),
  spacer: byId("spacer"),
  items: byId("items"),
  empty: byId("empty"),
  selectionBox: byId("selection-box"),
  paneGrid: byId("pane-grid"),
  contextMenu: byId("context-menu"),
  recentLocationsMenu: byId("recent-locations-menu"),
  newFileMenu: button("new-file-menu"),
  newFolderMenu: button("new-folder-menu"),
  refreshMenu: button("refresh-menu"),
  createMenuSeparator: byId("create-menu-separator"),
  revealSystem: button("reveal-system"),
  showInExplorer: button("show-in-explorer"),
  itemMenuSeparator: byId("item-menu-separator"),
  openTerminalHere: button("open-terminal-here"),
  locationMenuSeparator: byId("location-menu-separator"),
  copyName: button("copy-name"),
  copyPath: button("copy-path"),
  copyRelativePath: button("copy-relative-path"),
  copyDirectoryPath: button("copy-directory-path"),
  copyRelativeDirectoryPath: button("copy-relative-directory-path"),
  pathMenuSeparator: byId("path-menu-separator"),
  renameItem: button("rename-item"),
  copyItems: button("copy-items"),
  cutItems: button("cut-items"),
  pasteItems: button("paste-items"),
  deleteItems: button("delete-items"),
  viewMenuSeparator: byId("view-menu-separator"),
  toggleModifiedColumnMenu: button("toggle-modified-column-menu"),
  toggleSizeColumnMenu: button("toggle-size-column-menu")
};

elements.newTab.addEventListener("click", () => {
  if (layoutMode === "panes") return;
  createTab(getWorkspacePath());
});
elements.tileTabs.addEventListener("click", togglePaneLayout);
elements.toggleViewLocation.addEventListener("click", () => {
  flushSavedSession();
  vscode.postMessage({ command: "toggleViewLocation" });
});
elements.tileListView.addEventListener("click", () => setAllTabsViewMode("list"));
elements.tileGridView.addEventListener("click", () => setAllTabsViewMode("grid"));
elements.tileToggleHidden.addEventListener("click", toggleAllHiddenFiles);
elements.back.addEventListener("click", () => moveHistory(-1));
elements.forward.addEventListener("click", () => moveHistory(1));
elements.up.addEventListener("click", navigateUp);
elements.workspaceHome.addEventListener("click", () =>
  navigate(getWorkspacePath(activeTab().path))
);
elements.refresh.addEventListener("click", () => {
  if (isVirtualDrivesPath(activeTab().path)) return;
  loadDirectory(activeTab(), false);
});
elements.toggleTree.addEventListener("click", toggleTreePane);
elements.collapseTree.addEventListener("click", collapseTreePane);
elements.newFile.addEventListener("click", () => {
  if (isVirtualDrivesPath(activeTab().path)) return;
  vscode.postMessage({ command: "createFile", path: activeTab().path });
});
elements.newFolder.addEventListener("click", () => {
  if (isVirtualDrivesPath(activeTab().path)) return;
  vscode.postMessage({ command: "createFolder", path: activeTab().path });
});
elements.sidebarBack.addEventListener("click", () => moveHistory(-1));
elements.sidebarUp.addEventListener("click", navigateUp);
elements.sidebarWorkspaceHome.addEventListener("click", () =>
  navigate(getWorkspacePath(activeTab().path))
);
elements.sidebarRefresh.addEventListener("click", () => {
  if (isVirtualDrivesPath(activeTab().path)) return;
  loadDirectory(activeTab(), false);
});
elements.sidebarNewFile.addEventListener("click", () => {
  if (isVirtualDrivesPath(activeTab().path)) return;
  vscode.postMessage({ command: "createFile", path: activeTab().path });
});
elements.sidebarNewFolder.addEventListener("click", () => {
  if (isVirtualDrivesPath(activeTab().path)) return;
  vscode.postMessage({ command: "createFolder", path: activeTab().path });
});
elements.address.addEventListener("click", (event) => {
  if (event.target === elements.address) {
    beginAddressEdit();
  }
});
elements.address.addEventListener("dblclick", beginAddressEdit);
elements.favoriteLocation.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleFavoriteLocation(activeTab());
});
elements.recentLocations.addEventListener("click", (event) => {
  event.stopPropagation();
  showRecentLocationsMenu(elements.recentLocations, activeTab());
});
elements.listView.addEventListener("click", () => setViewMode("list"));
elements.gridView.addEventListener("click", () => setViewMode("grid"));
elements.toggleHidden.addEventListener("click", () => toggleHiddenFiles());
elements.sidebarListView.addEventListener("click", () => setViewMode("list"));
elements.sidebarGridView.addEventListener("click", () => setViewMode("grid"));
elements.sidebarToggleHidden.addEventListener("click", () => toggleHiddenFiles());
elements.searchInput.addEventListener("input", debounce(runSearch, 180));
bindSearchInputInteractions(elements.searchInput, activeTab);
elements.recursiveSearch.addEventListener("click", () => {
  if (isVirtualDrivesPath(activeTab().path)) return;
  preferredRecursiveSearch = !preferredRecursiveSearch;
  for (const tab of tabs) {
    tab.recursiveSearch = preferredRecursiveSearch;
  }
  vscode.postMessage({
    command: "savePreferences",
    recursiveSearch: preferredRecursiveSearch
  });
  updateRecursiveSearchButton(activeTab());
  if (activeTab().searchQuery) runSearch();
});
elements.contextMenu.addEventListener("pointerdown", (event) => {
  event.stopPropagation();
});
elements.contextMenu.addEventListener("click", (event) => {
  event.stopPropagation();
});
elements.revealSystem.addEventListener("click", () => {
  if (contextMenuItem) {
    vscode.postMessage({ command: "revealInSystem", path: contextMenuItem.path });
  }
  hideContextMenu();
});
elements.showInExplorer.addEventListener("click", () => {
  if (contextMenuItem) {
    showItemInExplorer(contextMenuItem);
  }
  hideContextMenu();
});
elements.newFileMenu.addEventListener("click", () => runContextMenuAction(() => createItemInContext(false)));
elements.newFolderMenu.addEventListener("click", () => runContextMenuAction(() => createItemInContext(true)));
elements.refreshMenu.addEventListener("click", () => runContextMenuAction(refreshContextDirectory));
elements.openTerminalHere.addEventListener("click", () => runContextMenuAction(openTerminalHere));
elements.copyName.addEventListener("click", () => runContextMenuAction(copyName));
elements.copyPath.addEventListener("click", () => runContextMenuAction(() => copyPath(false)));
elements.copyRelativePath.addEventListener("click", () => runContextMenuAction(() => copyPath(true)));
elements.copyDirectoryPath.addEventListener("click", () => runContextMenuAction(() => copyDirectoryPath(false)));
elements.copyRelativeDirectoryPath.addEventListener("click", () => runContextMenuAction(() => copyDirectoryPath(true)));
elements.renameItem.addEventListener("click", () => runContextMenuAction(renameSelection));
elements.copyItems.addEventListener("click", () => runContextMenuAction(() => copySelection(false)));
elements.cutItems.addEventListener("click", () => runContextMenuAction(() => copySelection(true)));
elements.pasteItems.addEventListener("click", () => runContextMenuAction(pasteClipboard));
elements.deleteItems.addEventListener("click", () => runContextMenuAction(() => deleteSelection(false)));
elements.toggleModifiedColumnMenu.addEventListener("click", () => runContextMenuAction(() => toggleListColumn("modified")));
elements.toggleSizeColumnMenu.addEventListener("click", () => runContextMenuAction(() => toggleListColumn("size")));
elements.listHeader.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-sort]");
  if (!target) return;
  changeSort(target.dataset.sort as ExplorerTab["sortKey"]);
});
elements.listHeader.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  showContextMenu(event.clientX, event.clientY, undefined, false);
});
elements.viewport.addEventListener("scroll", () => {
  hideContextMenu();
  hideRecentLocationsMenu();
  activeTab().scrollTop = elements.viewport.scrollTop;
  scheduleRender();
});
elements.addressInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    validateAndNavigate(elements.addressInput.value);
  } else if (event.key === "Escape") {
    endAddressEdit();
  }
});
elements.addressInput.addEventListener("blur", () => window.setTimeout(endAddressEdit, 100));
window.addEventListener("resize", scheduleRender);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideContextMenu();
    hideRecentLocationsMenu();
  }

  if (isEditableTarget(event.target)) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    clearSelection();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
    event.preventDefault();
    beginAddressEdit();
  } else if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === "/") {
    event.preventDefault();
    focusSearchInput();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
    event.preventDefault();
    selectAllItems();
  } else if (event.key === "Backspace" || (event.altKey && event.key === "ArrowUp")) {
    event.preventDefault();
    navigateUp();
  } else if (event.altKey && event.key === "ArrowLeft") {
    event.preventDefault();
    moveHistory(-1);
  } else if (event.altKey && event.key === "ArrowRight") {
    event.preventDefault();
    moveHistory(1);
  } else if (event.key === "F5") {
    event.preventDefault();
    loadDirectory(activeTab(), false);
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
    event.preventDefault();
    copySelection(false);
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "x") {
    event.preventDefault();
    copySelection(true);
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
    event.preventDefault();
    pasteClipboard();
  } else if (!event.metaKey && !event.altKey && isItemNavigationKey(event.key)) {
    event.preventDefault();
    moveKeyboardSelection(event.key, event.ctrlKey, event.shiftKey);
  } else if (!event.metaKey && !event.altKey && event.key === " ") {
    event.preventDefault();
    activateFocusedSelection(event.ctrlKey, event.shiftKey);
  } else if (event.key === "Delete") {
    event.preventDefault();
    deleteSelection(event.shiftKey);
  } else if (event.key === "F2") {
    event.preventDefault();
    renameSelection();
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (!toggleKeyboardTreeNode()) {
      openSelectedItem();
    }
  } else if (!event.ctrlKey && !event.metaKey && !event.altKey && isTypeAheadCharacter(event.key)) {
    event.preventDefault();
    selectByTypeAhead(event.key);
  }
});
window.addEventListener("pointerdown", (event) => {
  if (!elements.contextMenu.contains(event.target as Node)) {
    hideContextMenu();
  }
  if (!elements.recentLocationsMenu.contains(event.target as Node)) {
    hideRecentLocationsMenu();
  }
});
elements.viewport.addEventListener("pointerdown", beginSelectionDrag);
elements.viewport.addEventListener("pointerdown", () => {
  keyboardTarget = "items";
});
elements.viewport.addEventListener("click", clearSelectionFromEmptyClick);
elements.viewport.addEventListener("contextmenu", showViewportContextMenu);
window.addEventListener("pointermove", updateSelectionDrag);
window.addEventListener("pointerup", endSelectionDrag);
window.addEventListener("pointercancel", endSelectionDrag);
window.addEventListener(
  "click",
  (event) => {
    if (!shouldSuppressDragClick(event)) return;
    event.preventDefault();
    event.stopPropagation();
  },
  true
);
window.addEventListener("message", (event) => handleHostMessage(event.data));
window.addEventListener("beforeunload", () => {
  flushSavedSession();
});

vscode.postMessage({ command: "ready" });

function handleHostMessage(message: Record<string, unknown>): void {
  switch (message.command) {
    case "initialize": {
      initialPath = String(message.initialPath);
      workspaceRoots = message.workspaceRoots as WorkspaceRoot[];
      pathSeparator = String(message.pathSeparator);
      platform = String(message.platform);
      viewKind = message.viewKind === "sidebar" ? "sidebar" : "editor";
      document.body.classList.toggle("sidebar-mode", viewKind === "sidebar");
      treeVisible = viewKind === "editor" && message.preferredTreeVisible === true;
      treeProbeChildFolders = message.treeProbeChildFolders === true;
      preferredTreeExpandedPaths = new Set(
        Array.isArray(message.preferredTreeExpandedPaths)
          ? message.preferredTreeExpandedPaths
              .filter((value): value is string => typeof value === "string")
              .map(normalizeForComparison)
          : []
      );
      preferredViewMode =
        message.preferredViewMode === "grid" ? "grid" : "list";
      preferredRecursiveSearch = message.preferredRecursiveSearch === true;
      preferredSortState = normalizeSortState(message.preferredSortState);
      listColumns = normalizeListColumns(message.listColumns);
      iconTheme = normalizeIconTheme(message.iconTheme);
      recentLocations = normalizeRecentLocations(
        message.recentLocations,
        RECENT_LOCATIONS_SAVE_LIMIT,
        normalizeForComparison
      );
      favoriteLocations = normalizeFavoriteLocations(
        message.favoriteLocations,
        FAVORITE_LOCATIONS_SAVE_LIMIT,
        normalizeForComparison
      );
      restoreWorkspaceSession = message.restoreWorkspaceSession !== false;
      revealInSystemAvailable = message.revealInSystemAvailable !== false;
      const workspaceSession = isWorkspaceSession(message.workspaceSession)
        ? message.workspaceSession
        : undefined;
      initializeTreeRoots();
      restoreOrCreateInitialTab(workspaceSession);
      if (treeVisible) {
        loadExpandedTreeRoots();
      }
      break;
    }
    case "iconThemeChanged": {
      iconTheme = normalizeIconTheme(message.iconTheme);
      scheduleRender();
      break;
    }
    case "treeProbeChildFoldersChanged": {
      treeProbeChildFolders = message.enabled === true;
      invalidateTreeNodes();
      scheduleRender();
      break;
    }
    case "navigateExternal": {
      const targetPath = String(message.path);
      const revealPath = message.revealPath ? String(message.revealPath) : undefined;
      const tab = activeTab();
      tab.externalNavigationId = String(message.requestId);
      if (revealPath && basename(revealPath).startsWith(".")) {
        tab.showHidden = true;
      }
      navigate(targetPath, true, revealPath);
      break;
    }
    case "workspaceSessionSettingChanged": {
      restoreWorkspaceSession = message.enabled === true;
      if (restoreWorkspaceSession) {
        saveState();
      } else {
        window.clearTimeout(sessionSaveTimer);
      }
      break;
    }
    case "tabCommand": {
      handleTabCommand(String(message.action), Number(message.index));
      break;
    }
    case "webviewCommand": {
      handleWebviewCommand(String(message.action));
      break;
    }
    case "flushSession": {
      flushSavedSession();
      break;
    }
    case "directoryStart": {
      const tab = tabForRequest(String(message.requestId));
      if (!tab) return;
      tab.path = String(message.path);
      tab.title = displayPathName(tab.path);
      tab.items = [];
      tab.filteredItems = [];
      tab.loading = true;
      tab.searchMode = false;
      tab.status = "Loading…";
      metadataRequested.clear();
      scheduleRender();
      break;
    }
    case "directoryBatch": {
      const tab = tabForRequest(String(message.requestId));
      if (!tab) return;
      tab.items.push(...(message.items as DirectoryItem[]));
      const sortDuringLoad = tab.items.length <= 1000;
      if (sortDuringLoad) {
        sortItems(tab.items, tab);
      }
      applyLocalFilter(tab, sortDuringLoad);
      if (
        tab.pendingRevealPath &&
        tab.items.some(
          (item) => normalizeForComparison(item.path) === normalizeForComparison(tab.pendingRevealPath!)
        )
      ) {
        revealSelectedItem(tab, !tab.preserveFocusAfterReveal);
      }
      scheduleRender();
      break;
    }
    case "directoryComplete": {
      const tab = tabForRequest(String(message.requestId));
      if (!tab) return;
      tab.loading = false;
      requestSortMetadata(tab);
      sortItems(tab.items, tab);
      applyLocalFilter(tab);
      updateTreeNodeChildHintFromDirectory(tab);
      revealActivePathInTree(tab.path);
      cleanSelection(tab);
      revealSelectedItem(tab, !tab.preserveFocusAfterReveal);
      completeExternalNavigation(tab);
      if (tab.focusViewportAfterLoad && tab.id === activeTabId) {
        requestAnimationFrame(() => renderTargetsForTab(tab).viewport.focus({ preventScroll: true }));
      }
      tab.pendingRevealPath = undefined;
      tab.preserveFocusAfterReveal = false;
      tab.focusViewportAfterLoad = false;
      tab.status = `${Number(message.count).toLocaleString()} items`;
      tab.requestId = undefined;
      if (tab.pendingRecentLocation) {
        if (!isVirtualDrivesPath(tab.pendingRecentLocation)) {
          rememberRecentLocation(tab.path);
        }
        tab.pendingRecentLocation = undefined;
      }
      scheduleRender();
      break;
    }
    case "directoryUnavailable": {
      const tab = tabForRequest(String(message.requestId));
      if (!tab) return;
      tab.requestId = undefined;
      tab.loading = false;
      tab.items = [];
      tab.filteredItems = [];
      tab.selectedPath = undefined;
      tab.selectedPaths = [];
      tab.selectionAnchorPath = undefined;
      tab.status = String(message.message);
      const fallbackPath = String(message.fallbackPath);
      if (normalizeForComparison(fallbackPath) !== normalizeForComparison(tab.path)) {
        tab.path = fallbackPath;
        tab.title = displayPathName(fallbackPath);
        tab.history = [fallbackPath];
        tab.historyIndex = 0;
        tab.scrollTop = 0;
        syncDirectoryWatchers();
        loadDirectory(tab, false);
        saveState();
      } else {
        scheduleRender();
      }
      break;
    }
    case "directoryChanged": {
      const changedPath = String(message.path);
      const preserveFocus = message.preserveFocus === true;
      refreshTreeNode(changedPath);
      for (const tab of tabs) {
        if (normalizeForComparison(tab.path) === normalizeForComparison(changedPath)) {
          loadDirectory(tab, true, preserveFocus);
        }
      }
      break;
    }
    case "operationComplete": {
      const changedPath = String(message.path);
      const preserveFocus = message.preserveFocus === true;
      const focusViewport = message.focusViewport === true;
      const revealPaths = Array.isArray(message.revealPaths)
        ? message.revealPaths.filter((value): value is string => typeof value === "string")
        : [];
      const revealPath =
        revealPaths[revealPaths.length - 1] ??
        (message.revealPath ? String(message.revealPath) : undefined);
      if (message.clearClipboard) {
        clipboardPaths = [];
        clipboardCut = false;
      }
      refreshTreeNode(changedPath);
      let refreshed = false;
      for (const tab of tabs) {
        if (normalizeForComparison(tab.path) === normalizeForComparison(changedPath)) {
          tab.selectedPath = revealPath;
          tab.selectedPaths = revealPaths.length ? revealPaths : revealPath ? [revealPath] : [];
          tab.selectionAnchorPath = tab.selectedPaths[0];
          tab.pendingRevealPath = revealPath;
          tab.focusViewportAfterLoad = focusViewport;
          loadDirectory(tab, false, preserveFocus);
          refreshed = true;
        }
      }
      if (!refreshed) {
        const tab = activeTab();
        if (tab.searchMode && tab.recursiveSearch && tab.searchQuery) {
          runSearch();
        } else {
          tab.focusViewportAfterLoad = focusViewport;
          loadDirectory(tab, false, preserveFocus);
        }
      }
      break;
    }
    case "metadata": {
      const metadata = message.items as DirectoryItem[];
      const lookup = new Map(metadata.map((item) => [item.path, item]));
      for (const tab of tabs) {
        applyMetadata(tab.items, lookup);
        applyMetadata(tab.filteredItems, lookup);
        if (tab.sortKey !== "name") {
          sortItems(tab.items, tab);
          if (tab.searchMode) {
            sortItems(tab.filteredItems, tab);
          } else {
            applyLocalFilter(tab);
          }
        }
      }
      scheduleRender();
      break;
    }
    case "searchStart": {
      const tab = tabForSearchRequest(String(message.requestId));
      if (!tab) return;
      tab.filteredItems = [];
      tab.searchMode = true;
      tab.status = "Searching…";
      scheduleRender();
      break;
    }
    case "searchBatch": {
      const tab = tabForSearchRequest(String(message.requestId));
      if (!tab) return;
      tab.filteredItems.push(...(message.items as DirectoryItem[]));
      if (tab.filteredItems.length <= 1000) {
        sortItems(tab.filteredItems, tab);
      }
      tab.status = `${tab.filteredItems.length.toLocaleString()} matches · ${Number(
        message.scannedDirectories
      ).toLocaleString()} folders`;
      scheduleRender();
      break;
    }
    case "searchComplete": {
      const tab = tabForSearchRequest(String(message.requestId));
      if (!tab) return;
      tab.searchRequestId = undefined;
      requestSortMetadata(tab);
      sortItems(tab.filteredItems, tab);
      const suffix = message.limited ? " · result limit reached" : "";
      tab.status = `${Number(message.count).toLocaleString()} matches · ${Number(
        message.scannedDirectories
      ).toLocaleString()} folders${suffix}`;
      scheduleRender();
      break;
    }
    case "treeDirectory": {
      const requestId = String(message.requestId);
      const nodePath = treeRequests.get(requestId);
      if (!nodePath) return;
      treeRequests.delete(requestId);
      const node = treeNode(nodePath);
      if (!node || node.requestId !== requestId) return;
      node.loading = false;
      node.loaded = true;
      node.requestId = undefined;
      node.error = undefined;
      node.children = message.items as DirectoryItem[];
      node.hasChildren = node.children.length > 0;
      for (const child of node.children) {
        const childNode = ensureTreeNode(child);
        if (
          childNode.isDirectory &&
          preferredTreeExpandedPaths.has(normalizeForComparison(childNode.path))
        ) {
          childNode.expanded = true;
          if (!childNode.loaded && !childNode.loading) {
            requestTreeDirectory(childNode);
          }
        }
      }
      continueTreePathReveal();
      scheduleRender();
      break;
    }
    case "treeDirectoryError": {
      const requestId = String(message.requestId);
      const nodePath = treeRequests.get(requestId);
      if (!nodePath) return;
      treeRequests.delete(requestId);
      const node = treeNode(nodePath);
      if (!node || node.requestId !== requestId) return;
      node.loading = false;
      node.loaded = true;
      node.requestId = undefined;
      node.error = String(message.message || "Unable to load folder.");
      scheduleRender();
      break;
    }
    case "directoryValidation": {
      if (message.valid) {
        endAddressEdit();
        navigate(String(message.path));
      } else {
        showTemporaryStatus(String(message.message || "Directory does not exist."));
        elements.addressInput.select();
      }
      break;
    }
    case "pathCopied": {
      showTemporaryStatus(String(message.status || (message.relative ? "Copied relative path" : "Copied path")));
      break;
    }
    case "textCopied": {
      showTemporaryStatus(String(message.status || "Copied text"));
      break;
    }
    case "terminalOpened": {
      showTemporaryStatus("Opened terminal");
      break;
    }
    case "operationError": {
      const requestId = message.requestId ? String(message.requestId) : "";
      const tab = tabForRequest(requestId) ?? tabForSearchRequest(requestId) ?? activeTab();
      tab.loading = false;
      tab.status = String(message.message);
      scheduleRender();
      break;
    }
  }
}

function restoreOrCreateInitialTab(workspaceSession?: WorkspaceSession): void {
  tabs = initialTabPaths(workspaceSession, workspaceRoots, initialPath).map(createTabModel);
  activeTabId = tabs[initialActiveTabIndex(workspaceSession, tabs.length)].id;
  layoutMode = restoredLayoutMode(viewKind, tabs.length, workspaceSession);
  syncDirectoryWatchers();
  for (const tab of tabs) {
    loadDirectory(tab, false);
  }
  saveState();
}

function createTab(tabPath: string): void {
  const tab = createTabModel(tabPath);
  tabs.push(tab);
  activeTabId = tab.id;
  syncDirectoryWatchers();
  loadDirectory(tab, false);
  saveState();
}

function createTabModel(tabPath: string): ExplorerTab {
  return {
    id: randomId(),
    path: tabPath,
    title: displayPathName(tabPath),
    items: [],
    filteredItems: [],
    history: [tabPath],
    historyIndex: 0,
    viewMode: preferredViewMode,
    loading: false,
    searchQuery: "",
    recursiveSearch: preferredRecursiveSearch,
    searchMode: false,
    status: "",
    scrollTop: 0,
    selectedPath: undefined,
    pendingRevealPath: undefined,
    selectedPaths: [],
    selectionAnchorPath: undefined,
    showHidden: false,
    pendingRecentLocation: tabPath,
    sortKey: preferredSortState.sortKey,
    sortDirection: preferredSortState.sortDirection
  };
}

function closeTab(tabId: string): void {
  if (tabs.length === 1) {
    cancelTabRequests(tabs[0]);
    suppressSessionSave = true;
    clearSavedSession();
    vscode.postMessage({ command: "closePanel" });
    return;
  }
  const index = tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return;
  const [removed] = tabs.splice(index, 1);
  cancelTabRequests(removed);
  if (activeTabId === tabId) {
    activeTabId = tabs[Math.max(0, index - 1)].id;
  }
  if (tabs.length < 2 && layoutMode === "panes") {
    layoutMode = "tabs";
  }
  syncDirectoryWatchers();
  activateCurrentTab();
}

function handleTabCommand(action: string, index: number): void {
  switch (action) {
    case "new":
      createTab(getWorkspacePath());
      break;
    case "close":
      closeTab(activeTabId);
      break;
    case "next":
      activateTabByOffset(1);
      break;
    case "previous":
      activateTabByOffset(-1);
      break;
    case "activate":
      if (Number.isInteger(index)) {
        activateTabAtIndex(index);
      }
      break;
  }
}

function handleWebviewCommand(action: string): void {
  switch (action) {
    case "focusSearch":
      focusSearchInput();
      break;
    case "focusAddressBar":
      beginAddressEdit();
      break;
    case "toggleHiddenFiles":
      if (layoutMode === "panes" && viewKind === "editor") {
        toggleAllHiddenFiles();
      } else {
        toggleHiddenFiles();
      }
      break;
    case "setDetailsView":
      setCommandViewMode("list");
      break;
    case "setLargeIconsView":
      setCommandViewMode("grid");
      break;
    case "toggleFolderTree":
      toggleTreePane();
      break;
    case "collapseFolderTree":
      collapseTreePane();
      break;
    case "toggleTiledTabs":
      togglePaneLayout();
      break;
  }
}

function setCommandViewMode(viewMode: ExplorerTab["viewMode"]): void {
  if (layoutMode === "panes" && viewKind === "editor") {
    setAllTabsViewMode(viewMode);
  } else {
    setViewMode(viewMode);
  }
}

function activateTab(tabId: string): void {
  activeTabId = tabId;
  activateCurrentTab();
}

function activateTabByOffset(offset: number): void {
  if (tabs.length < 2) return;
  const currentIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeTabId));
  const nextIndex = (currentIndex + offset + tabs.length) % tabs.length;
  activateTab(tabs[nextIndex].id);
}

function activateTabAtIndex(index: number): void {
  const tab = tabs[index];
  if (!tab) return;
  activateTab(tab.id);
}

function focusTab(tabId: string): ExplorerTab {
  const tab = tabs.find((candidate) => candidate.id === tabId);
  if (!tab) throw new Error("No tab to focus.");
  if (activeTabId !== tabId) {
    activeTabId = tabId;
    saveState();
    scheduleRender();
  }
  return tab;
}

function activateCurrentTab(): void {
  const tab = activeTab();
  elements.searchInput.value = tab.searchQuery;
  updateRecursiveSearchButton(tab);
  scheduleRender();
  requestAnimationFrame(() => {
    elements.viewport.scrollTop = tab.scrollTop;
  });
  saveState();
}

function togglePaneLayout(): void {
  if (viewKind !== "editor") return;
  layoutMode = layoutMode === "panes" ? "tabs" : "panes";
  if (layoutMode === "panes") {
    endAddressEdit();
    hideContextMenu();
    hideRecentLocationsMenu();
  }
  saveState();
  scheduleRender();
}

function navigate(targetPath: string, pushHistory = true, revealPath?: string): void {
  const tab = activeTab();
  navigateTab(tab, targetPath, pushHistory, revealPath);
}

function navigateTab(tab: ExplorerTab, targetPath: string, pushHistory = true, revealPath?: string): void {
  if (normalizeForComparison(targetPath) === normalizeForComparison(tab.path)) {
    tab.selectedPath = revealPath;
    tab.selectedPaths = revealPath ? [revealPath] : [];
    tab.selectionAnchorPath = revealPath;
    tab.pendingRevealPath = revealPath;
    loadDirectory(tab, false);
    return;
  }

  cancelTabRequests(tab);
  tab.searchQuery = "";
  tab.searchMode = false;
  tab.scrollTop = 0;
  tab.selectedPath = revealPath;
  tab.selectedPaths = revealPath ? [revealPath] : [];
  tab.pendingRevealPath = revealPath;
  elements.searchInput.value = "";

  if (pushHistory) {
    tab.history = tab.history.slice(0, tab.historyIndex + 1);
    tab.history.push(targetPath);
    tab.historyIndex = tab.history.length - 1;
  }

  tab.path = targetPath;
  tab.pendingRecentLocation = targetPath;
  syncDirectoryWatchers();
  loadDirectory(tab, false);
  saveState();
}

function moveHistory(offset: number): void {
  const tab = activeTab();
  moveTabHistory(tab, offset);
}

function moveTabHistory(tab: ExplorerTab, offset: number): void {
  const targetIndex = tab.historyIndex + offset;
  if (targetIndex < 0 || targetIndex >= tab.history.length) {
    return;
  }
  tab.historyIndex = targetIndex;
  tab.path = tab.history[targetIndex];
  tab.pendingRecentLocation = tab.path;
  syncDirectoryWatchers();
  loadDirectory(tab, false);
  saveState();
}

function navigateUp(): void {
  const tab = activeTab();
  navigateTabUp(tab);
}

function navigateTabUp(tab: ExplorerTab): void {
  if (isVirtualDrivesPath(tab.path)) {
    return;
  }
  if (platform === "win32" && isWindowsDriveRoot(tab.path)) {
    navigateTab(tab, VIRTUAL_DRIVES_PATH, true, normalizeDriveRootPath(tab.path));
    return;
  }
  const parent = dirname(tab.path);
  if (parent !== tab.path) {
    navigateTab(tab, parent, true, tab.path);
  }
}

function canNavigateUp(tab: ExplorerTab): boolean {
  if (isVirtualDrivesPath(tab.path)) return false;
  if (platform === "win32" && isWindowsDriveRoot(tab.path)) return true;
  return dirname(tab.path) !== tab.path;
}

function loadDirectory(tab: ExplorerTab, preserveItems: boolean, preserveFocus = false): void {
  cancelTabRequests(tab);
  tab.requestId = randomId();
  tab.loading = true;
  tab.status = "Loading…";
  tab.preserveFocusAfterReveal = preserveFocus;
  if (!preserveItems) {
    tab.items = [];
    tab.filteredItems = [];
  }
  vscode.postMessage({
    command: "readDirectory",
    requestId: tab.requestId,
    path: tab.path
  });
  scheduleRender();
}

function runSearch(): void {
  const tab = activeTab();
  runSearchForTab(tab, elements.searchInput.value.trim());
}

function runSearchForTab(tab: ExplorerTab, query: string): void {
  tab.searchQuery = query;
  cancelSearch(tab);

  if (!tab.searchQuery) {
    tab.searchMode = false;
    applyLocalFilter(tab);
    tab.status = `${tab.items.length.toLocaleString()} items`;
    scheduleRender();
    return;
  }

  if (!tab.recursiveSearch || isVirtualDrivesPath(tab.path)) {
    tab.searchMode = false;
    applyLocalFilter(tab);
    tab.status = `${tab.filteredItems.length.toLocaleString()} matches`;
    scheduleRender();
    return;
  }

  tab.searchRequestId = randomId();
  tab.searchMode = true;
  tab.filteredItems = [];
  vscode.postMessage({
    command: "search",
    requestId: tab.searchRequestId,
    path: tab.path,
    query: tab.searchQuery,
    showHidden: tab.showHidden
  });
  scheduleRender();
}

function applyLocalFilter(tab: ExplorerTab, sort = true): void {
  tab.filteredItems = filterItems(tab.items, {
    showHidden: tab.showHidden,
    searchQuery: tab.searchQuery
  });
  if (sort) {
    sortItems(tab.filteredItems, tab);
  }
}

function cancelTabRequests(tab: ExplorerTab): void {
  if (tab.requestId) {
    vscode.postMessage({ command: "cancelRequest", requestId: tab.requestId });
    tab.requestId = undefined;
  }
  cancelSearch(tab);
}

function cancelSearch(tab: ExplorerTab): void {
  if (tab.searchRequestId) {
    vscode.postMessage({ command: "cancelRequest", requestId: tab.searchRequestId });
    tab.searchRequestId = undefined;
  }
}

function validateAndNavigate(targetPath: string): void {
  vscode.postMessage({
    command: "validateDirectory",
    requestId: randomId(),
    path: targetPath
  });
}

function beginAddressEdit(): void {
  elements.address.classList.add("hidden");
  elements.addressInput.classList.remove("hidden");
  elements.addressInput.value = isVirtualDrivesPath(activeTab().path) ? "" : activeTab().path;
  elements.addressInput.focus();
  elements.addressInput.select();
}

function endAddressEdit(): void {
  elements.addressInput.classList.add("hidden");
  elements.address.classList.remove("hidden");
}

function setViewMode(viewMode: ExplorerTab["viewMode"]): void {
  if (preferredViewMode === viewMode && tabs.every((tab) => tab.viewMode === viewMode)) return;
  preferredViewMode = viewMode;
  for (const tab of tabs) {
    tab.viewMode = viewMode;
    tab.scrollTop = 0;
  }
  elements.viewport.scrollTop = 0;
  vscode.postMessage({ command: "savePreferences", viewMode });
  scheduleRender();
}

function setAllTabsViewMode(viewMode: ExplorerTab["viewMode"]): void {
  if (tabs.every((tab) => tab.viewMode === viewMode)) return;
  preferredViewMode = viewMode;
  for (const tab of tabs) {
    tab.viewMode = viewMode;
    tab.scrollTop = 0;
  }
  elements.viewport.scrollTop = 0;
  vscode.postMessage({ command: "savePreferences", viewMode });
  scheduleRender();
}

function toggleAllHiddenFiles(): void {
  const showHidden = !activeTab().showHidden;
  for (const tab of tabs) {
    tab.showHidden = showHidden;
    applyLocalFilter(tab);
    if (tab.recursiveSearch && tab.searchQuery) {
      runSearchForTab(tab, tab.searchQuery);
    }
  }
  scheduleRender();
}

function toggleListColumn(column: keyof ListColumnPreferences): void {
  listColumns = {
    ...listColumns,
    [column]: !listColumns[column]
  };
  vscode.postMessage({ command: "savePreferences", listColumns });
  scheduleRender();
}

function toggleHiddenFiles(): void {
  const tab = activeTab();
  tab.showHidden = !tab.showHidden;
  applyLocalFilter(tab);
  if (tab.recursiveSearch && tab.searchQuery) runSearch();
  scheduleRender();
}

function scheduleRender(): void {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    render();
  });
}

function render(): void {
  if (!tabs.length) return;
  const tab = activeTab();
  const shell = document.querySelector(".shell");
  const paneMode = layoutMode === "panes" && viewKind === "editor";
  shell?.classList.toggle("grid-mode", !paneMode && tab.viewMode === "grid");
  shell?.classList.toggle("tree-visible", !paneMode && viewKind === "editor" && treeVisible);
  shell?.classList.toggle("pane-mode", paneMode);
  document.body.classList.toggle("hide-modified-column", !listColumns.modified);
  document.body.classList.toggle("hide-size-column", !listColumns.size);
  renderTabs();
  renderAddress(tab);
  renderToolbar(tab);
  renderTree(tab);
  elements.paneGrid.classList.toggle("hidden", !paneMode);
  elements.newTab.disabled = paneMode;
  elements.tileTabs.classList.toggle("active", paneMode);
  elements.tileTabs.setAttribute("aria-pressed", String(paneMode));
  elements.tileTabs.title = paneMode ? "Return to tab view" : "Tile tabs";
  elements.tileTabs.setAttribute("aria-label", paneMode ? "Return to tab view" : "Tile tabs");
  elements.toggleViewLocation.title = viewKind === "sidebar" ? "Open in Editor" : "Move to Sidebar";
  elements.toggleViewLocation.setAttribute("aria-label", elements.toggleViewLocation.title);
  elements.tileActivePath.textContent = paneMode ? tab.path : "";
  elements.tileActivePath.title = paneMode ? tab.path : "";
  elements.tileListView.classList.toggle("active", paneMode && tabs.every((candidate) => candidate.viewMode === "list"));
  elements.tileGridView.classList.toggle("active", paneMode && tabs.every((candidate) => candidate.viewMode === "grid"));
  elements.tileToggleHidden.classList.toggle("active", paneMode && tabs.some((candidate) => candidate.showHidden));
  elements.tileToggleHidden.title = activeTab().showHidden ? "Hide hidden files" : "Show hidden files";
  const showListHeader = tab.viewMode === "list";
  elements.listHeader.classList.toggle("hidden", !showListHeader);
  elements.listView.classList.toggle("active", tab.viewMode === "list");
  elements.gridView.classList.toggle("active", tab.viewMode === "grid");
  elements.toggleHidden.classList.toggle("active", tab.showHidden);
  elements.toggleHidden.title = tab.showHidden ? "Hide hidden files" : "Show hidden files";
  elements.toggleTree.classList.toggle("active", treeVisible);
  elements.toggleTree.title = treeVisible ? "Hide folder tree" : "Show folder tree";
  elements.toggleTree.setAttribute("aria-label", treeVisible ? "Hide folder tree" : "Show folder tree");
  elements.toggleTree.setAttribute("aria-pressed", String(treeVisible));
  elements.sidebarListView.classList.toggle("active", tab.viewMode === "list");
  elements.sidebarGridView.classList.toggle("active", tab.viewMode === "grid");
  elements.sidebarToggleHidden.classList.toggle("active", tab.showHidden);
  elements.sidebarToggleHidden.title = tab.showHidden ? "Hide hidden files" : "Show hidden files";
  if (paneMode) {
    renderPaneGrid();
  } else {
    elements.paneGrid.replaceChildren();
    renderVirtualItems(tab);
  }
  elements.status.textContent = tab.status;
  elements.selectionStatus.textContent =
    tab.selectedPaths.length > 1 ? `${tab.selectedPaths.length.toLocaleString()} selected` : "";
  updateListColumnMenu();
  updateListHeaderSortState(elements.listHeader, tab);
  updateRecursiveSearchButton(tab);
}

function renderTabs(): void {
  elements.tabs.replaceChildren(
    ...tabs.map((tab) => {
      const tabElement = document.createElement("button");
      tabElement.className = `tab ${tab.id === activeTabId ? "active" : ""}`;
      tabElement.title = tab.path;
      tabElement.draggable = true;
      tabElement.addEventListener("click", () => activateTab(tab.id));
      tabElement.addEventListener("dragstart", (event) => {
        draggingTabId = tab.id;
        tabElement.classList.add("dragging");
        event.dataTransfer?.setData("text/plain", tab.id);
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
        }
      });
      tabElement.addEventListener("dragover", (event) => {
        if (!draggingTabId || draggingTabId === tab.id) return;
        event.preventDefault();
        const bounds = tabElement.getBoundingClientRect();
        const after = event.clientX >= bounds.left + bounds.width / 2;
        tabElement.classList.toggle("drop-before", !after);
        tabElement.classList.toggle("drop-after", after);
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
      });
      tabElement.addEventListener("dragleave", () => {
        tabElement.classList.remove("drop-before", "drop-after");
      });
      tabElement.addEventListener("drop", (event) => {
        event.preventDefault();
        if (!draggingTabId || draggingTabId === tab.id) return;
        const bounds = tabElement.getBoundingClientRect();
        reorderTab(draggingTabId, tab.id, event.clientX >= bounds.left + bounds.width / 2);
      });
      tabElement.addEventListener("dragend", () => {
        draggingTabId = undefined;
        clearTabDragStyles();
      });

      const label = document.createElement("span");
      label.textContent = tab.title;
      label.className = "tab-label";
      tabElement.append(label);

      const close = document.createElement("span");
      close.textContent = "×";
      close.className = "tab-close";
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        closeTab(tab.id);
      });
      tabElement.append(close);
      return tabElement;
    })
  );
}

function reorderTab(sourceId: string, targetId: string, after: boolean): void {
  const sourceIndex = tabs.findIndex((tab) => tab.id === sourceId);
  if (sourceIndex < 0) return;
  const [sourceTab] = tabs.splice(sourceIndex, 1);
  const targetIndex = tabs.findIndex((tab) => tab.id === targetId);
  if (targetIndex < 0) {
    tabs.splice(sourceIndex, 0, sourceTab);
    return;
  }
  tabs.splice(targetIndex + (after ? 1 : 0), 0, sourceTab);
  draggingTabId = undefined;
  clearTabDragStyles();
  saveState();
  scheduleRender();
}

function clearTabDragStyles(): void {
  for (const tabElement of Array.from(elements.tabs.querySelectorAll(".tab"))) {
    tabElement.classList.remove("dragging", "drop-before", "drop-after");
  }
}

function renderAddress(tab: ExplorerTab): void {
  if (isVirtualDrivesPath(tab.path)) {
    elements.address.replaceChildren(createVirtualDrivesBreadcrumb());
    return;
  }

  const parts = splitPath(tab.path);
  const nodes: Node[] = [];

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (index > 0) {
      const separator = document.createElement("span");
      separator.className = "breadcrumb-separator";
      separator.textContent = "›";
      nodes.push(separator);
    }
    const buttonElement = document.createElement("button");
    buttonElement.className = "breadcrumb";
    buttonElement.textContent = part.label;
    buttonElement.title = part.path;
    buttonElement.addEventListener("click", () => navigate(part.path));
    nodes.push(buttonElement);
  }

  elements.address.replaceChildren(...nodes);
}

function renderToolbar(tab: ExplorerTab): void {
  const virtualDrives = isVirtualDrivesPath(tab.path);
  const canGoUp = canNavigateUp(tab);
  elements.back.disabled = tab.historyIndex <= 0;
  elements.forward.disabled = tab.historyIndex >= tab.history.length - 1;
  elements.up.disabled = !canGoUp;
  elements.workspaceHome.disabled = !workspaceRoots.length;
  elements.refresh.disabled = virtualDrives;
  elements.newFile.disabled = virtualDrives;
  elements.newFolder.disabled = virtualDrives;
  elements.recursiveSearch.disabled = virtualDrives;
  updateFavoriteButton(elements.favoriteLocation, tab);
  elements.favoriteLocation.disabled = virtualDrives;
  elements.recentLocations.disabled = recentLocationOptions(tab).length === 0 && favoriteLocationOptions().length === 0;
  elements.sidebarBack.disabled = tab.historyIndex <= 0;
  elements.sidebarUp.disabled = !canGoUp;
  elements.sidebarWorkspaceHome.disabled = !workspaceRoots.length;
  elements.sidebarRefresh.disabled = virtualDrives;
  elements.sidebarNewFile.disabled = virtualDrives;
  elements.sidebarNewFolder.disabled = virtualDrives;
}

function recentLocationOptions(tab: ExplorerTab): string[] {
  return visibleRecentLocations(
    recentLocations,
    tab.path,
    RECENT_LOCATIONS_DISPLAY_LIMIT,
    normalizeForComparison
  ).filter((location) => !isFavoriteLocation(favoriteLocations, location, normalizeForComparison));
}

function rememberRecentLocation(location: string): void {
  const nextLocations = addRecentLocation(
    recentLocations,
    location,
    RECENT_LOCATIONS_SAVE_LIMIT,
    normalizeForComparison
  );
  if (sameStringArray(recentLocations, nextLocations)) return;
  recentLocations = nextLocations;
  vscode.postMessage({ command: "saveRecentLocations", locations: recentLocations });
}

function favoriteLocationOptions(): string[] {
  return favoriteLocations;
}

function toggleFavoriteLocation(tab: ExplorerTab): void {
  if (isVirtualDrivesPath(tab.path)) return;
  const favorited = isFavoriteLocation(favoriteLocations, tab.path, normalizeForComparison);
  favoriteLocations = favorited
    ? removeFavoriteLocation(favoriteLocations, tab.path, normalizeForComparison)
    : addFavoriteLocation(
        favoriteLocations,
        tab.path,
        FAVORITE_LOCATIONS_SAVE_LIMIT,
        normalizeForComparison
      );
  saveFavoriteLocations();
  showTemporaryStatus(favorited ? "Removed favorite location" : "Added favorite location");
  scheduleRender();
}

function removeFavoriteFromMenu(location: string, tab: ExplorerTab, anchor?: HTMLElement): void {
  favoriteLocations = removeFavoriteLocation(favoriteLocations, location, normalizeForComparison);
  saveFavoriteLocations();
  showTemporaryStatus("Removed favorite location");
  if (anchor && (recentLocationOptions(tab).length || favoriteLocationOptions().length)) {
    showRecentLocationsMenu(anchor, tab);
  } else {
    hideRecentLocationsMenu();
  }
  scheduleRender();
}

function saveFavoriteLocations(): void {
  vscode.postMessage({ command: "saveFavoriteLocations", locations: favoriteLocations });
}

function updateFavoriteButton(buttonElement: HTMLButtonElement, tab: ExplorerTab): void {
  if (isVirtualDrivesPath(tab.path)) {
    buttonElement.classList.remove("active");
    buttonElement.title = "Virtual locations cannot be added to favorites";
    buttonElement.setAttribute("aria-label", buttonElement.title);
    buttonElement.setAttribute("aria-pressed", "false");
    return;
  }
  const favorited = isFavoriteLocation(favoriteLocations, tab.path, normalizeForComparison);
  buttonElement.classList.toggle("active", favorited);
  buttonElement.title = favorited ? "Remove from favorites" : "Add to favorites";
  buttonElement.setAttribute("aria-label", buttonElement.title);
  buttonElement.setAttribute("aria-pressed", String(favorited));
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function showRecentLocationsMenu(anchor: HTMLElement, tab: ExplorerTab): void {
  const recent = recentLocationOptions(tab);
  const favorites = favoriteLocationOptions();
  if (!recent.length && !favorites.length) return;

  hideContextMenu();
  const nodes: HTMLElement[] = [];
  if (recent.length) {
    nodes.push(createLocationsMenuHeader("Recent"));
    nodes.push(...recent.map((location) => createLocationMenuItem(location, tab, false, anchor)));
  }
  if (recent.length && favorites.length) {
    const separator = document.createElement("div");
    separator.className = "locations-menu-separator";
    nodes.push(separator);
  }
  if (favorites.length) {
    nodes.push(createLocationsMenuHeader("Favorites"));
    nodes.push(...favorites.map((location) => createLocationMenuItem(location, tab, true, anchor)));
  }

  elements.recentLocationsMenu.replaceChildren(...nodes);
  elements.recentLocationsMenu.classList.remove("hidden");
  const anchorRect = anchor.getBoundingClientRect();
  const menuRect = elements.recentLocationsMenu.getBoundingClientRect();
  const left = Math.min(anchorRect.right - menuRect.width, window.innerWidth - menuRect.width - 6);
  const top = Math.min(anchorRect.bottom + 3, window.innerHeight - menuRect.height - 6);
  elements.recentLocationsMenu.style.left = `${Math.max(4, left)}px`;
  elements.recentLocationsMenu.style.top = `${Math.max(4, top)}px`;
}

function createLocationsMenuHeader(label: string): HTMLElement {
  const header = document.createElement("div");
  header.className = "locations-menu-header";
  header.textContent = label;
  return header;
}

function createLocationMenuItem(
  location: string,
  tab: ExplorerTab,
  favorite = false,
  anchor?: HTMLElement
): HTMLElement {
  const row = document.createElement("div");
  row.className = `location-menu-row ${favorite ? "favorite" : ""}`;
  const buttonElement = document.createElement("button");
  buttonElement.className = "location-menu-target";
  buttonElement.type = "button";
  buttonElement.setAttribute("role", "menuitem");
  const name = document.createElement("span");
  name.className = "recent-location-name";
  name.textContent = basename(location) || location;
  const pathElement = document.createElement("span");
  pathElement.className = "recent-location-path";
  pathElement.textContent = location;
  buttonElement.append(name, pathElement);
  buttonElement.addEventListener("click", () => {
    hideRecentLocationsMenu();
    focusTab(tab.id);
    navigateTab(tab, location);
  });
  row.append(buttonElement);

  if (favorite) {
    const favoriteButton = document.createElement("button");
    favoriteButton.className = "location-menu-favorite";
    favoriteButton.type = "button";
    favoriteButton.title = "Remove from favorites";
    favoriteButton.setAttribute("aria-label", "Remove from favorites");
    favoriteButton.innerHTML = toolbarIcon(
      "M8 1.75 9.9 5.65 14.2 6.25 11.1 9.25 11.85 13.5 8 11.5 4.15 13.5 4.9 9.25 1.8 6.25 6.1 5.65 8 1.75Z"
    );
    favoriteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      removeFavoriteFromMenu(location, tab, anchor);
    });
    row.append(favoriteButton);
  }
  return row;
}

function hideRecentLocationsMenu(): void {
  elements.recentLocationsMenu.classList.add("hidden");
}

function initializeTreeRoots(): void {
  treeNodes.clear();
  treeRequests.clear();

  const roots = workspaceRoots.length
    ? workspaceRoots
    : [{ name: basename(initialPath) || initialPath, path: initialPath }];

  for (const root of roots) {
    ensureTreeNode({
      name: root.name || basename(root.path) || root.path,
      path: root.path,
      isDirectory: true,
      isSymbolicLink: false
    });
  }
}

function renderTree(tab: ExplorerTab): void {
  elements.toggleTree.classList.toggle("hidden", viewKind !== "editor");
  elements.collapseTree.classList.toggle("hidden", viewKind !== "editor" || !treeVisible);
  elements.treeToolbarDivider.classList.toggle("hidden", viewKind !== "editor");
  elements.treePane.classList.toggle("hidden", viewKind !== "editor" || !treeVisible);
  if (viewKind !== "editor" || !treeVisible) {
    elements.treeItems.replaceChildren();
    return;
  }

  syncTreeHiddenMode(tab.showHidden);

  const nodes: HTMLElement[] = [];
  const roots = workspaceRoots.length
    ? workspaceRoots.map((root) =>
        ensureTreeNode({
          name: root.name || basename(root.path) || root.path,
          path: root.path,
          isDirectory: true,
          isSymbolicLink: false
        })
      )
    : [
        ensureTreeNode({
          name: basename(initialPath) || initialPath,
          path: initialPath,
          isDirectory: true,
          isSymbolicLink: false
        })
      ];

  for (const root of roots) {
    appendTreeNode(nodes, root, 0, tab.path);
  }

  elements.treeItems.replaceChildren(...nodes);
}

function toggleTreePane(): void {
  if (viewKind !== "editor") return;
  treeVisible = !treeVisible;
  if (treeVisible) {
    if (preferredTreeExpandedPaths.size === 0) {
      expandTreeRoots();
    } else {
      loadExpandedTreeRoots();
    }
    revealActivePathInTree(activeTab().path);
  }
  saveTreePreferences();
  scheduleRender();
}

function collapseTreePane(): void {
  if (viewKind !== "editor" || !treeVisible) return;
  preferredTreeExpandedPaths.clear();

  const rootKeys = new Set<string>();
  for (const root of treeRootNodes()) {
    rootKeys.add(normalizeForComparison(root.path));
  }

  for (const node of treeNodes.values()) {
    const isRoot = rootKeys.has(normalizeForComparison(node.path));
    node.expanded = isRoot;
    if (isRoot) {
      preferredTreeExpandedPaths.add(normalizeForComparison(node.path));
    }
  }

  saveTreePreferences();
  scheduleRender();
}

function loadExpandedTreeRoots(): void {
  for (const node of treeNodes.values()) {
    if (node.isDirectory && node.expanded && !node.loaded && !node.loading) {
      requestTreeDirectory(node);
    }
  }
}

function revealActivePathInTree(targetPath: string): void {
  if (viewKind !== "editor" || !treeVisible) return;
  pendingTreeRevealPath = targetPath;
  continueTreePathReveal();
}

function continueTreePathReveal(): void {
  if (!pendingTreeRevealPath || viewKind !== "editor" || !treeVisible) return;
  const ancestorPaths = treeAncestorPathsForReveal(pendingTreeRevealPath);
  if (ancestorPaths.length === 0) {
    pendingTreeRevealPath = undefined;
    return;
  }

  let changed = false;
  for (const ancestorPath of ancestorPaths) {
    const node = treeNode(ancestorPath);
    if (!node || !node.isDirectory) return;

    if (!node.expanded) {
      node.expanded = true;
      preferredTreeExpandedPaths.add(normalizeForComparison(node.path));
      changed = true;
    }

    if (!node.loaded) {
      if (!node.loading) {
        requestTreeDirectory(node);
        changed = true;
      }
      if (changed) {
        saveTreePreferences();
        scheduleRender();
      }
      return;
    }
  }

  pendingTreeRevealPath = undefined;
  if (changed) {
    saveTreePreferences();
    scheduleRender();
  }
}

function treeAncestorPathsForReveal(targetPath: string): string[] {
  return treeAncestorPathsForRevealTarget(
    targetPath,
    treeRootNodes().map((root) => root.path),
    platform
  );
}

function syncTreeHiddenMode(showHidden: boolean): void {
  if (treeShowHidden === showHidden) return;
  treeShowHidden = showHidden;
  invalidateTreeNodes();
  loadExpandedTreeRoots();
  continueTreePathReveal();
}

function invalidateTreeNodes(): void {
  for (const node of treeNodes.values()) {
    node.loaded = false;
    node.children = [];
    node.error = undefined;
    node.hasChildren = undefined;
    if (node.requestId) {
      vscode.postMessage({ command: "cancelRequest", requestId: node.requestId });
      treeRequests.delete(node.requestId);
      node.requestId = undefined;
      node.loading = false;
    }
  }
}

function expandTreeRoots(): void {
  const roots = treeRootNodes();

  for (const root of roots) {
    root.expanded = true;
    preferredTreeExpandedPaths.add(normalizeForComparison(root.path));
    if (!root.loaded && !root.loading) {
      requestTreeDirectory(root);
    }
  }
}

function treeRootNodes(): TreeNodeState[] {
  return workspaceRoots.length
    ? workspaceRoots.map((root) =>
        ensureTreeNode({
          name: root.name || basename(root.path) || root.path,
          path: root.path,
          isDirectory: true,
          isSymbolicLink: false
        })
      )
    : [
        ensureTreeNode({
          name: basename(initialPath) || initialPath,
          path: initialPath,
          isDirectory: true,
          isSymbolicLink: false
        })
      ];
}

function appendTreeNode(
  nodes: HTMLElement[],
  node: TreeNodeState,
  depth: number,
  activePath: string
): void {
  const normalizedNodePath = normalizeForComparison(node.path);
  const isActive = normalizeForComparison(activePath) === normalizedNodePath;
  const containsActive = !isActive && isPathInsideOrEqual(activePath, node.path);
  const canExpand = node.loaded ? node.children.length > 0 : node.hasChildren !== false;

  const row = document.createElement("button");
  row.type = "button";
  row.className = `tree-item directory${isActive ? " active" : ""}${containsActive ? " contains-active" : ""}`;
  row.style.setProperty("--tree-depth", String(depth));
  row.title = node.path;
  row.dataset.path = node.path;
  row.addEventListener("click", (event) => {
    keyboardTarget = "tree";
    focusedTreePath = node.path;
    const now = performance.now();
    const isRepeatedClick =
      lastTreeClick?.path === node.path && now - lastTreeClick.time <= 400;
    lastTreeClick = { path: node.path, time: now };

    if (isRepeatedClick) {
      event.preventDefault();
      if (canToggleTreeNode(node)) {
        toggleTreeNode(node);
      }
      return;
    }

    navigate(node.path);
  });
  row.addEventListener("dblclick", (event) => {
    event.preventDefault();
  });
  row.addEventListener("focus", () => {
    keyboardTarget = "tree";
    focusedTreePath = node.path;
  });

  const toggle = document.createElement("span");
  toggle.className = `tree-toggle${canExpand ? "" : " empty"}`;
  toggle.textContent = canExpand ? (node.expanded ? "⌄" : "›") : "";
  toggle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (canExpand) toggleTreeNode(node);
  });

  const icon = createFileIcon({
    name: node.name,
    path: node.path,
    isDirectory: node.isDirectory,
    isSymbolicLink: node.isSymbolicLink
  });
  icon.classList.add("tree-icon");

  const label = document.createElement("span");
  label.className = "tree-label";
  label.textContent = node.name;

  row.append(toggle, icon, label);
  nodes.push(row);

  if (node.error && node.expanded) {
    const error = document.createElement("div");
    error.className = "tree-message";
    error.style.setProperty("--tree-depth", String(depth + 1));
    error.textContent = "Unable to load";
    error.title = node.error;
    nodes.push(error);
  }

  if (treeProbeChildFolders && node.loading && node.expanded) {
    const loading = document.createElement("div");
    loading.className = "tree-message";
    loading.style.setProperty("--tree-depth", String(depth + 1));
    loading.textContent = "Loading...";
    nodes.push(loading);
  }

  if (!node.expanded) return;
  for (const child of node.children) {
    const childNode = ensureTreeNode(child);
    appendTreeNode(nodes, childNode, depth + 1, activePath);
  }
}

function toggleKeyboardTreeNode(): boolean {
  if (keyboardTarget !== "tree" || viewKind !== "editor" || !treeVisible || !focusedTreePath) {
    return false;
  }
  const node = treeNode(focusedTreePath);
  if (!node || !canToggleTreeNode(node)) return false;
  toggleTreeNode(node);
  return true;
}

function canToggleTreeNode(node: TreeNodeState): boolean {
  return canToggleTreeNodeState(node);
}

function toggleTreeNode(node: TreeNodeState): void {
  if (!node.isDirectory) return;
  node.expanded = !node.expanded;
  const normalizedPath = normalizeForComparison(node.path);
  if (node.expanded) {
    preferredTreeExpandedPaths.add(normalizedPath);
  } else {
    preferredTreeExpandedPaths.delete(normalizedPath);
  }
  if (node.expanded && !node.loaded && !node.loading) {
    requestTreeDirectory(node);
  }
  saveTreePreferences();
  scheduleRender();
}

function requestTreeDirectory(node: TreeNodeState): void {
  if (viewKind !== "editor" || !node.isDirectory) return;
  if (node.requestId) {
    vscode.postMessage({ command: "cancelRequest", requestId: node.requestId });
    treeRequests.delete(node.requestId);
  }

  node.loading = true;
  node.error = undefined;
  node.requestId = randomId();
  treeRequests.set(node.requestId, node.path);
  vscode.postMessage({
    command: "readTreeDirectory",
    requestId: node.requestId,
    path: node.path,
    showHidden: activeTab().showHidden,
    probeChildFolders: treeProbeChildFolders
  });
}

function refreshTreeNode(nodePath: string): void {
  const node = treeNode(nodePath);
  if (!node || !node.isDirectory) return;
  node.loaded = false;
  node.children = [];
  node.error = undefined;
  node.hasChildren = undefined;
  if (node.expanded) {
    requestTreeDirectory(node);
  }
}

function updateTreeNodeChildHintFromDirectory(tab: ExplorerTab): void {
  if (viewKind !== "editor") return;
  const node = treeNode(tab.path);
  if (!node || !node.isDirectory || node.loaded) return;
  const hasVisibleChildFolder = tab.items.some(
    (item) => item.isDirectory && (tab.showHidden || !item.name.startsWith("."))
  );
  if (hasVisibleChildFolder || node.hasChildren !== false) {
    node.hasChildren = hasVisibleChildFolder;
  }
}

function ensureTreeNode(item: DirectoryItem): TreeNodeState {
  const key = treeKey(item.path);
  const existing = treeNodes.get(key);
  if (existing) {
    existing.name = item.name;
    existing.isDirectory = item.isDirectory;
    existing.isSymbolicLink = item.isSymbolicLink;
    if (item.hasChildren !== undefined) {
      existing.hasChildren = item.hasChildren;
    }
    return existing;
  }

  const node: TreeNodeState = {
    path: item.path,
    name: item.name,
    isDirectory: item.isDirectory,
    isSymbolicLink: item.isSymbolicLink,
    hasChildren: item.hasChildren,
    expanded: false,
    loading: false,
    loaded: !item.isDirectory,
    children: []
  };
  if (node.isDirectory && preferredTreeExpandedPaths.has(normalizeForComparison(node.path))) {
    node.expanded = true;
  }
  treeNodes.set(key, node);
  return node;
}

function saveTreePreferences(): void {
  vscode.postMessage({
    command: "savePreferences",
    treeVisible,
    treeExpandedPaths: Array.from(preferredTreeExpandedPaths)
  });
}

function treeNode(nodePath: string): TreeNodeState | undefined {
  return treeNodes.get(treeKey(nodePath));
}

function treeKey(nodePath: string): string {
  return treeNodeKey(nodePath, platform);
}

function updateListColumnMenu(): void {
  setMenuCheckbox(elements.toggleModifiedColumnMenu, listColumns.modified, "Show Modified");
  setMenuCheckbox(elements.toggleSizeColumnMenu, listColumns.size, "Show Size");
}

function setMenuCheckbox(buttonElement: HTMLButtonElement, checked: boolean, label: string): void {
  buttonElement.textContent = `${checked ? "✓ " : ""}${label}`;
  buttonElement.setAttribute("aria-checked", String(checked));
}

function renderPaneGrid(): void {
  const { columns, rows } = paneGridLayout(tabs.length, window.innerWidth, window.innerHeight);
  elements.paneGrid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  elements.paneGrid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  const existing = new Map(
    Array.from(elements.paneGrid.querySelectorAll<HTMLElement>(".explorer-pane")).map((pane) => [
      pane.dataset.tabId,
      pane
    ])
  );
  const panes = tabs.map((tab) => existing.get(tab.id) ?? createPaneElement(tab));
  syncPaneGridChildren(panes);
  applyPaneSpans(panes, columns, rows);
  for (const tab of tabs) {
    const pane = existing.get(tab.id) ?? panes.find((candidate) => candidate.dataset.tabId === tab.id);
    if (pane) {
      updatePaneChrome(tab, pane);
    }
  }
  requestAnimationFrame(renderMountedPaneItems);
}

function applyPaneSpans(panes: HTMLElement[], columns: number, rows: number): void {
  panes.forEach((pane, index) => {
    pane.style.gridRow = paneRowSpan(index, panes.length, columns, rows);
  });
}

function syncPaneGridChildren(panes: HTMLElement[]): void {
  const current = Array.from(elements.paneGrid.children);
  const unchanged =
    current.length === panes.length &&
    panes.every((pane, index) => current[index] === pane);
  if (unchanged) return;
  elements.paneGrid.replaceChildren(...panes);
}

function renderMountedPaneItems(): void {
  for (const pane of Array.from(elements.paneGrid.querySelectorAll<HTMLElement>(".explorer-pane"))) {
    const tabId = pane.dataset.tabId;
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (!tab) continue;
    const refs = paneRenderElements(pane);
    if (!refs) continue;
    if (pane.dataset.scrollInitialized !== "true") {
      refs.viewport.scrollTop = tab.scrollTop;
      pane.dataset.scrollInitialized = "true";
    }
    renderVirtualItemsInto(tab, refs);
  }
}

function createPaneElement(tab: ExplorerTab): HTMLElement {
  const pane = document.createElement("section");
  pane.className = "explorer-pane";
  pane.dataset.tabId = tab.id;
  pane.addEventListener("pointerdown", () => focusTab(tab.id));

  const header = document.createElement("div");
  header.className = "pane-header";

  const title = document.createElement("button");
  title.className = "pane-title";
  title.dataset.role = "title";
  title.addEventListener("click", () => {
    activateTab(tab.id);
  });

  const actions = document.createElement("div");
  actions.className = "pane-actions";
  actions.append(
    paneIconButton("Back", "M10.5 3.5L6 8l4.5 4.5M6.5 8H14", () => {
      focusTab(tab.id);
      moveTabHistory(tab, -1);
    }, false, false, "back"),
    paneIconButton("Forward", "M5.5 3.5L10 8l-4.5 4.5M9.5 8H2", () => {
      focusTab(tab.id);
      moveTabHistory(tab, 1);
    }, false, false, "forward"),
    paneIconButton("Up", "M8 13V3M4 7l4-4 4 4", () => {
      focusTab(tab.id);
      navigateTabUp(tab);
    }, false, false, "up"),
    paneIconButton("Back to workspace", "M2 7.5L8 2l6 5.5V14H9.5v-4h-3v4H2V7.5Z", () => {
      focusTab(tab.id);
      navigateTab(tab, getWorkspacePath(tab.path));
    }, false, false, "home"),
    paneIconButton("Refresh", "M13 5V2.5M13 2.5h-2.5M13 2.5A6 6 0 1 0 14 9", () => {
      focusTab(tab.id);
      if (isVirtualDrivesPath(tab.path)) return;
      loadDirectory(tab, false);
    }, false, false, "refresh"),
    paneActionSeparator(),
    paneIconButton("New file", "M4 1.5h5l3 3V14H4V1.5ZM9 1.5v3h3M8 7v4M6 9h4", () => {
      focusTab(tab.id);
      if (isVirtualDrivesPath(tab.path)) return;
      vscode.postMessage({ command: "createFile", path: tab.path });
    }, false, false, "newFile"),
    paneIconButton("New folder", "M1.5 4h5l1.5 2H14v7H1.5V4ZM8 8v3M6.5 9.5h3", () => {
      focusTab(tab.id);
      if (isVirtualDrivesPath(tab.path)) return;
      vscode.postMessage({ command: "createFolder", path: tab.path });
    }, false, false, "newFolder")
  );

  header.append(title, actions);

  const pathRow = document.createElement("div");
  pathRow.className = "pane-path-row";
  const addressContainer = document.createElement("div");
  addressContainer.className = "address-container pane-address-container";
  const address = document.createElement("div");
  address.className = "address pane-address";
  address.dataset.role = "address";
  const addressInput = document.createElement("input");
  addressInput.className = "address-input pane-address-input hidden";
  addressInput.dataset.role = "addressInput";
  addressInput.spellcheck = false;
  const favoriteButton = document.createElement("button");
  favoriteButton.className = "address-action-button favorite-location-button";
  favoriteButton.dataset.role = "favoriteLocation";
  favoriteButton.title = "Add to favorites";
  favoriteButton.setAttribute("aria-label", "Add to favorites");
  favoriteButton.setAttribute("aria-pressed", "false");
  favoriteButton.innerHTML = toolbarIcon(
    "M8 1.75 9.9 5.65 14.2 6.25 11.1 9.25 11.85 13.5 8 11.5 4.15 13.5 4.9 9.25 1.8 6.25 6.1 5.65 8 1.75Z"
  );
  const recentButton = document.createElement("button");
  recentButton.className = "address-action-button recent-locations-button";
  recentButton.dataset.role = "recentLocations";
  recentButton.title = "Recent and favorite locations";
  recentButton.setAttribute("aria-label", "Recent and favorite locations");
  recentButton.innerHTML = toolbarIcon("M4 6l4 4 4-4");
  address.addEventListener("click", (event) => {
    focusTab(tab.id);
    if (event.target === address) {
      beginPaneAddressEdit(tab, address, addressInput);
    }
  });
  address.addEventListener("dblclick", () => {
    focusTab(tab.id);
    beginPaneAddressEdit(tab, address, addressInput);
  });
  addressInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      focusTab(tab.id);
      endPaneAddressEdit(address, addressInput);
      navigateTab(tab, addressInput.value);
    } else if (event.key === "Escape") {
      endPaneAddressEdit(address, addressInput);
    }
  });
  addressInput.addEventListener("blur", () => {
    endPaneAddressEdit(address, addressInput);
  });
  favoriteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    focusTab(tab.id);
    toggleFavoriteLocation(tab);
  });
  recentButton.addEventListener("click", (event) => {
    event.stopPropagation();
    focusTab(tab.id);
    showRecentLocationsMenu(recentButton, tab);
  });
  addressContainer.append(address, addressInput, favoriteButton, recentButton);
  pathRow.append(addressContainer);

  const toolbar = document.createElement("div");
  toolbar.className = "pane-toolbar";
  const searchBox = document.createElement("div");
  searchBox.className = "search-box pane-search-box";
  searchBox.innerHTML = toolbarIcon("M6.5 2.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9.5 9.5 14 14", "search-icon");
  const searchInput = document.createElement("input");
  searchInput.dataset.role = "search";
  searchInput.type = "search";
  searchInput.placeholder = "Search";
  searchInput.title = "Search by name. Supports * and ? wildcards.";
  searchInput.addEventListener("input", debounce(() => {
    focusTab(tab.id);
    runSearchForTab(tab, searchInput.value.trim());
  }, 180));
  bindSearchInputInteractions(searchInput, () => {
    focusTab(tab.id);
    return tab;
  });
  const recursive = document.createElement("button");
  recursive.className = "search-option";
  recursive.dataset.role = "recursiveSearch";
  recursive.type = "button";
  recursive.setAttribute("aria-label", "Search subfolders");
  recursive.innerHTML = toolbarIcon("M2 3.5h5l1.5 2H14v7H2v-9ZM6 8h5M9 6l2 2-2 2");
  recursive.addEventListener("click", () => {
    focusTab(tab.id);
    if (isVirtualDrivesPath(tab.path)) return;
    tab.recursiveSearch = !tab.recursiveSearch;
    if (tab.searchQuery) {
      runSearchForTab(tab, tab.searchQuery);
    } else {
      scheduleRender();
    }
  });
  searchBox.append(searchInput, recursive);

  toolbar.append(searchBox);

  const mainPane = document.createElement("main");
  mainPane.className = `main-pane pane-main ${tab.viewMode === "grid" ? "pane-grid-mode" : ""}`;
  const listHeader = createPaneListHeader(tab);
  const viewport = document.createElement("div");
  viewport.className = "viewport pane-viewport";
  viewport.tabIndex = 0;
  const spacer = document.createElement("div");
  spacer.className = "spacer";
  const items = document.createElement("div");
  items.className = "items";
  const empty = document.createElement("div");
  empty.className = "empty hidden";
  viewport.append(spacer, items, empty);
  const refs = { viewport, spacer, items, empty };
  viewport.scrollTop = tab.scrollTop;
  viewport.addEventListener("scroll", () => {
    tab.scrollTop = viewport.scrollTop;
    renderVirtualItemsInto(tab, refs);
  });
  viewport.addEventListener("pointerdown", () => {
    focusTab(tab.id);
    keyboardTarget = "items";
  });
  viewport.addEventListener("pointerdown", beginSelectionDrag);
  viewport.addEventListener("click", clearSelectionFromEmptyClick);
  viewport.addEventListener("contextmenu", showViewportContextMenu);
  mainPane.append(listHeader, viewport);

  const footer = document.createElement("div");
  footer.className = "footer-bar pane-footer";
  const status = document.createElement("span");
  status.className = "status";
  status.dataset.role = "status";
  const selectionStatus = document.createElement("span");
  selectionStatus.className = "selection-status";
  selectionStatus.dataset.role = "selectionStatus";
  footer.append(status, selectionStatus);

  pane.append(header, pathRow, toolbar, mainPane, footer);
  return pane;
}

function updatePaneChrome(tab: ExplorerTab, pane: HTMLElement): void {
  const virtualDrives = isVirtualDrivesPath(tab.path);
  const previousViewMode = pane.dataset.viewMode;
  const previousPath = pane.dataset.path;
  pane.dataset.viewMode = tab.viewMode;
  pane.dataset.path = tab.path;
  pane.classList.toggle("focused", tab.id === activeTabId);
  const title = pane.querySelector<HTMLButtonElement>("[data-role='title']");
  if (title) {
    title.textContent = tab.title;
    title.title = tab.path;
  }
  const address = pane.querySelector<HTMLElement>("[data-role='address']");
  const addressInput = pane.querySelector<HTMLInputElement>("[data-role='addressInput']");
  if (address && addressInput && addressInput.classList.contains("hidden")) {
    address.replaceChildren(...createAddressNodes(tab));
  }
  const favoriteButton = pane.querySelector<HTMLButtonElement>("[data-role='favoriteLocation']");
  if (favoriteButton) {
    updateFavoriteButton(favoriteButton, tab);
    favoriteButton.disabled = virtualDrives;
  }
  const recentButton = pane.querySelector<HTMLButtonElement>("[data-role='recentLocations']");
  if (recentButton) {
    recentButton.disabled = recentLocationOptions(tab).length === 0 && favoriteLocationOptions().length === 0;
  }
  const searchInput = pane.querySelector<HTMLInputElement>("[data-role='search']");
  if (searchInput && document.activeElement !== searchInput && searchInput.value !== tab.searchQuery) {
    searchInput.value = tab.searchQuery;
  }
  const recursive = pane.querySelector<HTMLButtonElement>("[data-role='recursiveSearch']");
  if (recursive) {
    recursive.classList.toggle("active", tab.recursiveSearch);
    recursive.title = tab.recursiveSearch ? "Search subfolders: on" : "Search subfolders: off";
    recursive.setAttribute("aria-pressed", String(tab.recursiveSearch));
    recursive.disabled = virtualDrives;
  }
  setPaneButtonDisabled(pane, "back", tab.historyIndex <= 0);
  setPaneButtonDisabled(pane, "forward", tab.historyIndex >= tab.history.length - 1);
  setPaneButtonDisabled(pane, "up", !canNavigateUp(tab));
  setPaneButtonDisabled(pane, "home", !workspaceRoots.length);
  setPaneButtonDisabled(pane, "refresh", virtualDrives);
  setPaneButtonDisabled(pane, "newFile", virtualDrives);
  setPaneButtonDisabled(pane, "newFolder", virtualDrives);
  const mainPane = pane.querySelector<HTMLElement>(".pane-main");
  mainPane?.classList.toggle("pane-grid-mode", tab.viewMode === "grid");
  const listHeader = pane.querySelector<HTMLElement>(".pane-list-header");
  if (listHeader) {
    listHeader.classList.toggle("hidden", tab.viewMode !== "list");
    updateListHeaderSortState(listHeader, tab);
  }
  if (previousViewMode && previousViewMode !== tab.viewMode) {
    const items = pane.querySelector<HTMLElement>(".items");
    if (items) {
      delete items.dataset.renderSignature;
    }
  }
  if ((previousPath && previousPath !== tab.path) || (previousViewMode && previousViewMode !== tab.viewMode)) {
    const viewport = pane.querySelector<HTMLElement>(".pane-viewport");
    if (viewport) {
      viewport.scrollTop = tab.scrollTop;
    }
  }
  const status = pane.querySelector<HTMLElement>("[data-role='status']");
  if (status) status.textContent = tab.status;
  const selectionStatus = pane.querySelector<HTMLElement>("[data-role='selectionStatus']");
  if (selectionStatus) {
    selectionStatus.textContent =
      tab.selectedPaths.length > 1 ? `${tab.selectedPaths.length.toLocaleString()} selected` : "";
  }
}

function setPaneButtonDisabled(pane: HTMLElement, role: string, disabled: boolean): void {
  const buttonElement = pane.querySelector<HTMLButtonElement>(`[data-role='${role}']`);
  if (buttonElement) buttonElement.disabled = disabled;
}

function beginPaneAddressEdit(
  tab: ExplorerTab,
  address: HTMLElement,
  addressInput: HTMLInputElement
): void {
  address.classList.add("hidden");
  addressInput.classList.remove("hidden");
  addressInput.value = tab.path;
  addressInput.focus();
  addressInput.select();
}

function endPaneAddressEdit(address: HTMLElement, addressInput: HTMLInputElement): void {
  addressInput.classList.add("hidden");
  address.classList.remove("hidden");
}

function paneRenderElements(pane: HTMLElement): PaneRenderElements | undefined {
  const viewport = pane.querySelector<HTMLElement>(".pane-viewport");
  const spacer = pane.querySelector<HTMLElement>(".spacer");
  const items = pane.querySelector<HTMLElement>(".items");
  const empty = pane.querySelector<HTMLElement>(".empty");
  if (!viewport || !spacer || !items || !empty) return undefined;
  return { viewport, spacer, items, empty };
}

function createAddressNodes(tab: ExplorerTab): Node[] {
  if (isVirtualDrivesPath(tab.path)) {
    return [createVirtualDrivesBreadcrumb()];
  }

  const parts = splitPath(tab.path);
  const nodes: Node[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (index > 0) {
      const separator = document.createElement("span");
      separator.className = "breadcrumb-separator";
      separator.textContent = "›";
      nodes.push(separator);
    }
    const buttonElement = document.createElement("button");
    buttonElement.className = "breadcrumb";
    buttonElement.textContent = part.label;
    buttonElement.title = part.path;
    buttonElement.addEventListener("click", () => {
      focusTab(tab.id);
      navigate(part.path);
    });
    nodes.push(buttonElement);
  }
  return nodes;
}

function createVirtualDrivesBreadcrumb(): HTMLElement {
  const buttonElement = document.createElement("button");
  buttonElement.className = "breadcrumb";
  buttonElement.textContent = "This PC";
  buttonElement.title = "Available drives";
  buttonElement.disabled = true;
  return buttonElement;
}

function paneIconButton(
  label: string,
  pathData: string,
  onClick: () => void,
  disabled = false,
  active = false,
  role?: string
): HTMLButtonElement {
  const buttonElement = document.createElement("button");
  buttonElement.className = `icon-button ${active ? "active" : ""}`;
  buttonElement.title = label;
  buttonElement.setAttribute("aria-label", label);
  if (role) buttonElement.dataset.role = role;
  buttonElement.disabled = disabled;
  buttonElement.innerHTML = toolbarIcon(pathData);
  buttonElement.addEventListener("click", onClick);
  return buttonElement;
}

function paneActionSeparator(): HTMLElement {
  const separator = document.createElement("span");
  separator.className = "pane-action-separator";
  separator.setAttribute("aria-hidden", "true");
  return separator;
}

function createPaneListHeader(tab: ExplorerTab): HTMLElement {
  const header = document.createElement("div");
  header.className = `list-header pane-list-header ${tab.viewMode === "list" ? "" : "hidden"}`;
  for (const [key, label] of [
    ["name", "Name"],
    ["modified", "Modified"],
    ["size", "Size"]
  ] as Array<[ExplorerTab["sortKey"], string]>) {
    const buttonElement = document.createElement("button");
    buttonElement.dataset.sort = key;
    buttonElement.classList.toggle("active", key === tab.sortKey);
    buttonElement.textContent = `${label}${key === tab.sortKey ? (tab.sortDirection === "asc" ? " ↑" : " ↓") : ""}`;
    buttonElement.addEventListener("click", () => {
      focusTab(tab.id);
      changeSort(key);
    });
    header.append(buttonElement);
  }
  return header;
}

function updateListHeaderSortState(headerElement: HTMLElement, tab: ExplorerTab): void {
  for (const header of Array.from(
    headerElement.querySelectorAll<HTMLButtonElement>("button[data-sort]")
  )) {
    const active = header.dataset.sort === tab.sortKey;
    header.classList.toggle("active", active);
    header.textContent = `${header.dataset.sort === "name" ? "Name" : header.dataset.sort === "modified" ? "Modified" : "Size"}${
      active ? (tab.sortDirection === "asc" ? " ↑" : " ↓") : ""
    }`;
  }
}

function renderVirtualItems(tab: ExplorerTab): void {
  renderVirtualItemsInto(tab, elements);
}

function renderVirtualItemsInto(tab: ExplorerTab, target: PaneRenderElements): void {
  const data = tab.filteredItems;
  const layout = virtualListLayout({
    itemCount: data.length,
    viewMode: tab.viewMode,
    viewportHeight: target.viewport.clientHeight,
    viewportWidth: target.viewport.clientWidth,
    scrollTop: target.viewport.scrollTop,
    listRowHeight: listRowHeight(),
    gridItemWidth: gridItemWidth(),
    gridRowHeight: gridRowHeight()
  });

  target.spacer.style.height = `${layout.totalHeight}px`;
  target.items.style.transform = `translateY(${layout.top}px)`;
  target.items.className = `items ${tab.viewMode}`;
  if (tab.viewMode === "grid") {
    target.items.style.gridTemplateColumns = `repeat(${layout.columns}, minmax(0, 1fr))`;
  } else {
    target.items.style.removeProperty("grid-template-columns");
  }

  const visible = data.slice(layout.startIndex, layout.endIndex);
  const renderSignature = virtualRenderSignature({
    tabId: tab.id,
    viewMode: tab.viewMode,
    selectedPaths: tab.selectedPaths,
    visibleItems: visible,
    startIndex: layout.startIndex,
    endIndex: layout.endIndex,
    top: layout.top,
    totalHeight: layout.totalHeight,
    columns: layout.columns,
    viewportWidth: target.viewport.clientWidth,
    viewportHeight: target.viewport.clientHeight,
    normalizePath: normalizeForComparison
  });
  if (target.items.dataset.renderSignature !== renderSignature) {
    target.items.dataset.renderSignature = renderSignature;
    target.items.replaceChildren(...visible.map((item) => createItemElement(item, tab)));
  }

  const needsMetadata = isVirtualDrivesPath(tab.path)
    ? []
    : metadataPathsToRequest(visible, metadataRequested);
  if (needsMetadata.length > 0) {
    needsMetadata.forEach((itemPath) => metadataRequested.add(itemPath));
    vscode.postMessage({ command: "loadMetadata", paths: needsMetadata });
  }

  const showEmpty = !tab.loading && data.length === 0;
  target.empty.classList.toggle("hidden", !showEmpty);
  target.empty.textContent = isVirtualDrivesPath(tab.path)
    ? "No available drives."
    : emptyStateMessage(tab.items, {
        showHidden: tab.showHidden,
        searchQuery: tab.searchQuery,
        recursiveSearch: tab.recursiveSearch
      });
}

function listRowHeight(): number {
  return viewKind === "sidebar" ? 30 : 34;
}

function gridItemWidth(): number {
  if (layoutMode === "panes" && viewKind === "editor") return 96;
  return viewKind === "sidebar" ? 68 : 128;
}

function gridRowHeight(): number {
  if (layoutMode === "panes" && viewKind === "editor") return 92;
  return viewKind === "sidebar" ? 100 : 128;
}

function createItemElement(item: DirectoryItem, tab: ExplorerTab): HTMLElement {
  const element = document.createElement("button");
  element.className = `file-item ${item.isDirectory ? "directory" : "file"} ${tab.viewMode}`;
  element.classList.toggle(
    "selected",
    tab.selectedPaths.some(
      (selectedPath) => normalizeForComparison(item.path) === normalizeForComparison(selectedPath)
    )
  );
  element.title = item.path;
  element.dataset.path = item.path;

  const icon = createFileIcon(item);

  const name = document.createElement("span");
  name.className = "file-name";
  name.textContent = tab.searchMode && item.relativePath ? item.relativePath : item.name;

  element.append(icon, name);

  if (tab.viewMode === "list") {
    const modified = document.createElement("span");
    modified.className = "file-modified";
    modified.textContent = item.modified ? new Date(item.modified).toLocaleString() : "";

    const size = document.createElement("span");
    size.className = "file-size";
    size.textContent = item.isDirectory ? "" : formatSize(item.size);
    element.append(modified, size);
  }

  element.addEventListener("click", (event) => {
    if (shouldSuppressDragClick(event)) {
      event.preventDefault();
      return;
    }
    focusTab(tab.id);
    updateSelection(tab, item.path, event.ctrlKey || event.metaKey, event.shiftKey);
    scheduleRender();
  });
  element.addEventListener("dblclick", () => {
    focusTab(tab.id);
    if (item.isDirectory) {
      navigate(item.path);
    } else {
      vscode.postMessage({ command: "openFile", path: item.path });
    }
  });
  element.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    focusTab(tab.id);
    if (
      !tab.selectedPaths.some(
        (selectedPath) => normalizeForComparison(selectedPath) === normalizeForComparison(item.path)
      )
    ) {
      updateSelection(tab, item.path, false, false);
    }
    showContextMenu(event.clientX, event.clientY, item, tab.searchMode);
    scheduleRender();
  });
  return element;
}

function splitPath(value: string): Array<{ label: string; path: string }> {
  return splitPathForPlatform(value, platform);
}

function sortItems(items: DirectoryItem[], tab: ExplorerTab): void {
  sortItemsInPlace(items, tab, platform);
}

function changeSort(sortKey: ExplorerTab["sortKey"]): void {
  preferredSortState = nextSortState(preferredSortState, sortKey);
  for (const tab of tabs) {
    tab.sortKey = preferredSortState.sortKey;
    tab.sortDirection = preferredSortState.sortDirection;
    requestSortMetadata(tab);
    sortItems(tab.items, tab);
    if (tab.searchMode) {
      sortItems(tab.filteredItems, tab);
    } else {
      applyLocalFilter(tab);
    }
  }
  vscode.postMessage({ command: "savePreferences", sortState: preferredSortState });
  scheduleRender();
}

function requestSortMetadata(tab: ExplorerTab): void {
  if (tab.sortKey === "name" || isVirtualDrivesPath(tab.path)) return;
  requestMetadata(tab.searchMode ? tab.filteredItems : tab.items);
}

function requestMetadata(items: DirectoryItem[]): void {
  const pending = items.filter((item) => item.modified === undefined).map((item) => item.path);
  for (let index = 0; index < pending.length; index += 100) {
    const paths = pending.slice(index, index + 100);
    paths.forEach((itemPath) => metadataRequested.add(itemPath));
    vscode.postMessage({ command: "loadMetadata", paths });
  }
}

function applyMetadata(items: DirectoryItem[], lookup: Map<string, DirectoryItem>): void {
  for (const item of items) {
    const value = lookup.get(item.path);
    if (value) {
      item.size = value.size;
      item.modified = value.modified;
    }
  }
}

function getWorkspacePath(currentPath?: string): string {
  return workspacePathForCurrentPath(currentPath, workspaceRoots, initialPath, platform);
}

function isPathInsideOrEqual(candidate: string, root: string): boolean {
  return isPathInsideOrEqualForPlatform(candidate, root, platform);
}

function cleanSelection(tab: ExplorerTab): void {
  const selection = cleanSelectionState(tab, tab.items.map((item) => item.path), platform);
  tab.selectedPath = selection.selectedPath;
  tab.selectedPaths = selection.selectedPaths;
  tab.selectionAnchorPath = selection.selectionAnchorPath;
}

function activeTab(): ExplorerTab {
  const tab = tabs.find((candidate) => candidate.id === activeTabId);
  if (!tab) throw new Error("No active tab.");
  return tab;
}

function tabForRequest(requestId: string): ExplorerTab | undefined {
  return tabs.find((tab) => tab.requestId === requestId);
}

function tabForSearchRequest(requestId: string): ExplorerTab | undefined {
  return tabs.find((tab) => tab.searchRequestId === requestId);
}

function dirname(value: string): string {
  return dirnameForPlatform(value, platform);
}

function basename(value: string): string {
  return basenameForPlatform(value);
}

function displayPathName(value: string): string {
  return isVirtualDrivesPath(value) ? "This PC" : basename(value) || value;
}

function normalizeDriveRootPath(value: string): string {
  const drive = value.slice(0, 2).toLocaleUpperCase();
  return `${drive}\\`;
}

function createFileIcon(item: DirectoryItem): Element {
  const themedIcon = themedIconFor(item);
  if (themedIcon) {
    const image = document.createElement("img");
    image.className = "file-icon themed-file-icon";
    image.src = themedIcon;
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    image.draggable = false;
    image.addEventListener("error", () => {
      image.replaceWith(createFallbackFileIcon(item));
    }, { once: true });
    return image;
  }

  return createFallbackFileIcon(item);
}

function createFallbackFileIcon(item: DirectoryItem): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "file-icon");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");

  for (const pathData of iconPathsFor(item)) {
    const pathElement = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathElement.setAttribute("d", pathData);
    svg.append(pathElement);
  }

  return svg;
}

function themedIconFor(item: DirectoryItem): string | undefined {
  if (!iconTheme) return undefined;

  const name = item.name.toLocaleLowerCase();
  if (item.isDirectory) {
    return iconTheme.folderNames[name] ?? iconTheme.folder;
  }

  const fileNameIcon = iconTheme.fileNames[name];
  if (fileNameIcon) return fileNameIcon;

  for (const extension of extensionsForIconLookup(name)) {
    const extensionIcon = iconTheme.fileExtensions[extension];
    if (extensionIcon) return extensionIcon;
  }

  return iconTheme.file;
}

function extensionsForIconLookup(name: string): string[] {
  const parts = name.split(".");
  if (parts.length <= 1) return [];
  const extensions: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    extensions.push(parts.slice(index).join("."));
  }
  return extensions;
}

function iconPathsFor(item: DirectoryItem): string[] {
  if (item.isDirectory) {
    return [
      "M2 4.5V6H5.58579C5.71839 6 5.84557 5.94732 5.93934 5.85355L7.29289 4.5L5.93934 3.14645C5.84557 3.05268 5.71839 3 5.58579 3H3.5C2.67157 3 2 3.67157 2 4.5ZM1 4.5C1 3.11929 2.11929 2 3.5 2H5.58579C5.98361 2 6.36514 2.15804 6.64645 2.43934L8.20711 4H12.5C13.8807 4 15 5.11929 15 6.5V11.5C15 12.8807 13.8807 14 12.5 14H3.5C2.11929 14 1 12.8807 1 11.5V4.5ZM2 7V11.5C2 12.3284 2.67157 13 3.5 13H12.5C13.3284 13 14 12.3284 14 11.5V6.5C14 5.67157 13.3284 5 12.5 5H8.20711L6.64645 6.56066C6.36514 6.84197 5.98361 7 5.58579 7H2Z"
    ];
  }

  const extension = item.name.split(".").pop()?.toLocaleLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(extension ?? "")) {
    return [
      "M6 1C4.89543 1 4 1.89543 4 3V6H5V3C5 2.44772 5.44772 2 6 2H9V4.5C9 5.32843 9.67157 6 10.5 6H13V13C13 13.5523 12.5523 14 12 14H10.9646C10.9141 14.3531 10.8109 14.6891 10.6632 15H12C13.1046 15 14 14.1046 14 13V5.41421C14 5.01639 13.842 4.63486 13.5607 4.35355L10.6464 1.43934C10.3651 1.15804 9.98361 1 9.58579 1H6ZM12.7929 5H10.5C10.2239 5 10 4.77614 10 4.5V2.20711L12.7929 5ZM1 9.5C1 8.11929 2.11929 7 3.5 7H7.5C8.88071 7 10 8.11929 10 9.5V13.5C10 14.0095 9.84756 14.4835 9.5858 14.8787L6.56066 11.8536C5.97487 11.2678 5.02513 11.2678 4.43934 11.8536L1.4142 14.8787C1.15244 14.4835 1 14.0095 1 13.5V9.5ZM8 9.75C8 9.33579 7.66421 9 7.25 9C6.83579 9 6.5 9.33579 6.5 9.75C6.5 10.1642 6.83579 10.5 7.25 10.5C7.66421 10.5 8 10.1642 8 9.75ZM2.12131 15.5858C2.51652 15.8476 2.99046 16 3.5 16H7.5C8.00954 16 8.48348 15.8476 8.87869 15.5858L5.85355 12.5607C5.65829 12.3654 5.34171 12.3654 5.14645 12.5607L2.12131 15.5858Z"
    ];
  }
  if (["zip", "7z", "rar", "tar", "gz", "bz2", "xz"].includes(extension ?? "")) {
    return [
      "M2 6V4.5C2 3.67157 2.67157 3 3.5 3H5.58579C5.71839 3 5.84557 3.05268 5.93934 3.14645L7.29289 4.5L5.93934 5.85355C5.84557 5.94732 5.71839 6 5.58579 6H2ZM3.5 2C2.11929 2 1 3.11929 1 4.5V11.5C1 12.8807 2.11929 14 3.5 14H12.5C13.8807 14 15 12.8807 15 11.5V6.5C15 5.11929 13.8807 4 12.5 4H8.20711L6.64645 2.43934C6.36514 2.15804 5.98361 2 5.58579 2H3.5ZM9 5V7.5C9 7.77614 9.22386 8 9.5 8H10V9H9.5C9.22386 9 9 9.22386 9 9.5C9 9.77614 9.22386 10 9.5 10H10V11H9.5C9.22386 11 9 11.2239 9 11.5C9 11.7761 9.22386 12 9.5 12H10V13H3.5C2.67157 13 2 12.3284 2 11.5V7H5.58579C5.98361 7 6.36514 6.84197 6.64645 6.56066L8.20711 5H9ZM11 13V11H11.5C11.7761 11 12 10.7761 12 10.5C12 10.2239 11.7761 10 11.5 10H11V8H11.5C11.7761 8 12 7.77614 12 7.5V5H12.5C13.3284 5 14 5.67157 14 6.5V11.5C14 12.3284 13.3284 13 12.5 13H11ZM11 5V7H10V5H11Z"
    ];
  }
  if (
    ["js", "jsx", "ts", "tsx", "py", "go", "rs", "java", "c", "h", "cpp", "hpp", "cs", "html", "css", "scss", "sh", "ps1"].includes(
      extension ?? ""
    )
  ) {
    return [
      "M13.56 4.35L10.65 1.44C10.368 1.16009 9.98732 1.00208 9.58998 1H5.99998C5.47003 1.00158 4.96224 1.2128 4.58751 1.58753C4.21278 1.96227 4.00156 2.47005 3.99998 3V8.83C4.28127 8.9031 4.53719 9.05181 4.73998 9.26C4.84686 9.3602 4.93492 9.47874 4.99998 9.61V3C4.99998 2.73478 5.10534 2.48043 5.29287 2.29289C5.48041 2.10536 5.73476 2 5.99998 2H8.99998V4.5C8.99998 4.89782 9.15801 5.27936 9.43932 5.56066C9.72062 5.84196 10.1022 6 10.5 6H13V13C13 13.2652 12.8946 13.5196 12.7071 13.7071C12.5195 13.8946 12.2652 14 12 14H10.48L9.46998 15H12C12.5299 14.9984 13.0377 14.7872 13.4124 14.4125C13.7872 14.0377 13.9984 13.5299 14 13V5.41C13.9979 5.01266 13.8399 4.63202 13.56 4.35ZM10.5 5C10.3674 5 10.2402 4.94732 10.1464 4.85355C10.0527 4.75979 9.99998 4.63261 9.99998 4.5V2.21L12.79 5H10.5Z",
      "M3.47798 14.978C3.34548 14.9777 3.21852 14.9248 3.12498 14.831L1.14598 12.854C1.09942 12.8076 1.06247 12.7524 1.03727 12.6916C1.01206 12.6309 0.999084 12.5658 0.999084 12.5C0.999084 12.4342 1.01206 12.3691 1.03727 12.3084C1.06247 12.2476 1.09942 12.1924 1.14598 12.146L3.14598 10.146C3.23986 10.0521 3.3672 9.99937 3.49998 9.99937C3.63275 9.99937 3.76009 10.0521 3.85398 10.146C3.94787 10.2399 4.00061 10.3672 4.00061 10.5C4.00061 10.6328 3.94787 10.7601 3.85398 10.854L2.20698 12.5L3.83198 14.124C3.90209 14.1939 3.94985 14.2831 3.96922 14.3802C3.98858 14.4773 3.97868 14.578 3.94076 14.6695C3.90284 14.7609 3.83862 14.8391 3.75623 14.894C3.67384 14.9489 3.577 14.9782 3.47798 14.978Z",
      "M7.52198 14.978C7.42296 14.9782 7.32611 14.9489 7.24372 14.894C7.16134 14.8391 7.09711 14.7609 7.05919 14.6695C7.02128 14.578 7.01137 14.4773 7.03074 14.3802C7.05011 14.2831 7.09787 14.1939 7.16798 14.124L8.79298 12.5L7.14598 10.854C7.05209 10.7601 6.99935 10.6328 6.99935 10.5C6.99935 10.3672 7.05209 10.2399 7.14598 10.146C7.23986 10.0521 7.3672 9.99937 7.49998 9.99937C7.63275 9.99937 7.76009 10.0521 7.85398 10.146L9.85398 12.146C9.90054 12.1924 9.93748 12.2476 9.96269 12.3084C9.9879 12.3691 10.0009 12.4342 10.0009 12.5C10.0009 12.5658 9.9879 12.6309 9.96269 12.6916C9.93748 12.7524 9.90054 12.8076 9.85398 12.854L7.87498 14.831C7.78144 14.9248 7.65447 14.9777 7.52198 14.978Z"
    ];
  }
  return [
    "M5 1C3.89543 1 3 1.89543 3 3V13C3 14.1046 3.89543 15 5 15H11C12.1046 15 13 14.1046 13 13V5.41421C13 5.01639 12.842 4.63486 12.5607 4.35355L9.64645 1.43934C9.36514 1.15804 8.98361 1 8.58579 1H5ZM4 3C4 2.44772 4.44772 2 5 2H8V4.5C8 5.32843 8.67157 6 9.5 6H12V13C12 13.5523 11.5523 14 11 14H5C4.44772 14 4 13.5523 4 13V3ZM11.7929 5H9.5C9.22386 5 9 4.77614 9 4.5V2.20711L11.7929 5Z"
  ];
}

function normalizeForComparison(value: string): string {
  return normalizeForComparisonForPlatform(value, platform);
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function saveState(): void {
  if (!restoreWorkspaceSession || suppressSessionSave || !tabs.length) return;
  window.clearTimeout(sessionSaveTimer);
  sessionSaveTimer = window.setTimeout(() => {
    flushSavedSession();
  }, 50);
}

function clearSavedSession(): void {
  window.clearTimeout(sessionSaveTimer);
  if (restoreWorkspaceSession) {
    vscode.postMessage({ command: "clearWorkspaceSession" });
  }
}

function flushSavedSession(): void {
  window.clearTimeout(sessionSaveTimer);
  if (!restoreWorkspaceSession || suppressSessionSave || !tabs.length) return;
  const activeTabIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeTabId)
  );
  vscode.postMessage({
    command: "saveWorkspaceSession",
    session: {
      version: 1,
      tabs: tabs.map((tab) => ({ path: tab.path })),
      activeTabIndex,
      layoutMode: viewKind === "editor" && tabs.length > 1 ? layoutMode : "tabs"
    } satisfies WorkspaceSession
  });
}

function showTemporaryStatus(message: string): void {
  const tab = activeTab();
  const previous = tab.status;
  tab.status = message;
  scheduleRender();
  window.setTimeout(() => {
    if (tab.status === message) {
      tab.status = previous;
      scheduleRender();
    }
  }, 4000);
}

function showContextMenu(
  clientX: number,
  clientY: number,
  item: DirectoryItem | undefined,
  allowShowInExplorer: boolean
): void {
  contextMenuItem = item;
  const virtualDrives = isVirtualDrivesPath(activeTab().path);
  const itemMenu = Boolean(item);
  const searchResultItem = itemMenu && allowShowInExplorer && !virtualDrives;
  elements.newFileMenu.classList.toggle("hidden", itemMenu || virtualDrives);
  elements.newFolderMenu.classList.toggle("hidden", itemMenu || virtualDrives);
  elements.refreshMenu.classList.toggle("hidden", itemMenu || virtualDrives);
  elements.revealSystem.classList.toggle("hidden", virtualDrives || !itemMenu || !revealInSystemAvailable);
  elements.showInExplorer.classList.toggle("hidden", virtualDrives || !itemMenu || !allowShowInExplorer);
  elements.openTerminalHere.classList.toggle("hidden", virtualDrives);
  elements.copyName.classList.toggle("hidden", !itemMenu);
  elements.copyDirectoryPath.classList.toggle("hidden", virtualDrives || !itemMenu || item?.isDirectory === true);
  elements.copyRelativeDirectoryPath.classList.toggle("hidden", virtualDrives || !itemMenu || item?.isDirectory === true);
  elements.renameItem.classList.toggle("hidden", virtualDrives || !itemMenu);
  elements.copyItems.classList.toggle("hidden", virtualDrives || !itemMenu);
  elements.cutItems.classList.toggle("hidden", virtualDrives || !itemMenu);
  elements.deleteItems.classList.toggle("hidden", virtualDrives || !itemMenu);
  elements.pasteItems.classList.toggle("hidden", virtualDrives || searchResultItem);
  elements.renameItem.disabled = virtualDrives || !itemMenu || activeTab().selectedPaths.length !== 1;
  elements.pasteItems.disabled = clipboardPaths.length === 0;
  elements.copyPath.classList.toggle("hidden", virtualDrives && !itemMenu);
  elements.copyRelativePath.classList.toggle("hidden", virtualDrives);
  elements.copyPath.textContent = itemMenu ? "Copy Path" : "Copy Current Folder Path";
  elements.copyRelativePath.textContent = itemMenu ? "Copy Relative Path" : "Copy Current Folder Relative Path";
  const showListColumnOptions = activeTab().viewMode === "list";
  elements.toggleModifiedColumnMenu.classList.toggle("hidden", !showListColumnOptions);
  elements.toggleSizeColumnMenu.classList.toggle("hidden", !showListColumnOptions);
  updateListColumnMenu();
  updateContextMenuSeparators();
  elements.contextMenu.classList.remove("hidden");

  const rect = elements.contextMenu.getBoundingClientRect();
  const left = Math.min(clientX, window.innerWidth - rect.width - 6);
  const top = Math.min(clientY, window.innerHeight - rect.height - 6);
  elements.contextMenu.style.left = `${Math.max(4, left)}px`;
  elements.contextMenu.style.top = `${Math.max(4, top)}px`;
}

function showViewportContextMenu(event: MouseEvent): void {
  if ((event.target as HTMLElement).closest(".file-item")) return;
  event.preventDefault();
  focusTabForEventTarget(event.target);
  clearSelection();
  showContextMenu(event.clientX, event.clientY, undefined, false);
}

function hideContextMenu(): void {
  contextMenuItem = undefined;
  elements.contextMenu.classList.add("hidden");
}

function updateContextMenuSeparators(): void {
  updateSeparatorVisibility(elements.createMenuSeparator, [
    elements.newFileMenu,
    elements.newFolderMenu,
    elements.refreshMenu
  ], [
    elements.revealSystem,
    elements.showInExplorer,
    elements.openTerminalHere,
    elements.copyName,
    elements.copyPath,
    elements.copyRelativePath
  ]);
  updateSeparatorVisibility(elements.itemMenuSeparator, [
    elements.revealSystem,
    elements.showInExplorer
  ], [
    elements.openTerminalHere,
    elements.copyName,
    elements.copyPath,
    elements.copyRelativePath
  ]);
  updateSeparatorVisibility(elements.locationMenuSeparator, [
    elements.openTerminalHere
  ], [
    elements.copyName,
    elements.copyPath,
    elements.copyRelativePath,
    elements.copyDirectoryPath,
    elements.copyRelativeDirectoryPath
  ]);
  updateSeparatorVisibility(elements.pathMenuSeparator, [
    elements.copyName,
    elements.copyPath,
    elements.copyRelativePath,
    elements.copyDirectoryPath,
    elements.copyRelativeDirectoryPath
  ], [
    elements.renameItem,
    elements.copyItems,
    elements.cutItems,
    elements.pasteItems,
    elements.deleteItems
  ]);
  updateSeparatorVisibility(elements.viewMenuSeparator, [
    elements.renameItem,
    elements.copyItems,
    elements.cutItems,
    elements.pasteItems,
    elements.deleteItems
  ], [
    elements.toggleModifiedColumnMenu,
    elements.toggleSizeColumnMenu
  ]);
}

function updateSeparatorVisibility(
  separator: HTMLElement,
  before: HTMLElement[],
  after: HTMLElement[]
): void {
  separator.classList.toggle("hidden", !hasVisibleMenuItem(before) || !hasVisibleMenuItem(after));
}

function hasVisibleMenuItem(items: HTMLElement[]): boolean {
  return items.some((item) => !item.classList.contains("hidden"));
}

function focusTabForEventTarget(target: EventTarget | null): void {
  const pane = (target as HTMLElement | null)?.closest<HTMLElement>(".explorer-pane");
  const tabId = pane?.dataset.tabId;
  if (tabId) {
    focusTab(tabId);
  }
}

function runContextMenuAction(action: () => void): void {
  action();
  hideContextMenu();
}

function showItemInExplorer(item: DirectoryItem): void {
  const parentPath = dirname(item.path);
  navigate(parentPath, true, item.path);
}

function contextMenuPath(): string {
  return contextMenuItem?.path ?? activeTab().path;
}

function contextMenuDirectoryPath(): string {
  if (!contextMenuItem) return activeTab().path;
  return contextMenuItem.isDirectory ? contextMenuItem.path : dirname(contextMenuItem.path);
}

function createItemInContext(isDirectory: boolean): void {
  vscode.postMessage({
    command: isDirectory ? "createFolder" : "createFile",
    path: contextMenuDirectoryPath()
  });
}

function refreshContextDirectory(): void {
  loadDirectory(activeTab(), false);
}

function copyName(): void {
  if (!contextMenuItem) return;
  vscode.postMessage({
    command: "copyText",
    text: contextMenuItem.name,
    status: "Copied name"
  });
}

function copyPath(relative: boolean): void {
  vscode.postMessage({
    command: "copyPath",
    path: contextMenuPath(),
    relative,
    status: relative ? "Copied relative path" : "Copied path",
    fallbackStatus: "Copied path"
  });
}

function copyDirectoryPath(relative: boolean): void {
  vscode.postMessage({
    command: "copyPath",
    path: contextMenuDirectoryPath(),
    relative,
    status: relative ? "Copied relative folder path" : "Copied folder path",
    fallbackStatus: "Copied folder path"
  });
}

function openTerminalHere(): void {
  if (isVirtualDrivesPath(activeTab().path)) return;
  vscode.postMessage({
    command: "openTerminalHere",
    path: contextMenuDirectoryPath()
  });
}

function selectByTypeAhead(character: string): void {
  const tab = activeTab();
  const nowBuffer = `${typeAheadBuffer}${character}`.toLocaleLowerCase();
  window.clearTimeout(typeAheadTimer);
  typeAheadBuffer = nowBuffer;
  typeAheadTimer = window.setTimeout(() => {
    typeAheadBuffer = "";
  }, 900);

  const items = tab.filteredItems;
  if (!items.length) {
    return;
  }

  const currentIndex = items.findIndex(
    (item) => normalizeForComparison(item.path) === normalizeForComparison(tab.selectedPath ?? "")
  );
  const ordered = [...items.slice(currentIndex + 1), ...items.slice(0, currentIndex + 1)];
  const match = ordered.find((item) => item.name.toLocaleLowerCase().startsWith(typeAheadBuffer));

  if (match) {
    tab.selectedPath = match.path;
    tab.selectedPaths = [match.path];
    tab.selectionAnchorPath = match.path;
    revealSelectedItem(tab);
    scheduleRender();
  }
}

function focusSearchInput(): void {
  const pane =
    layoutMode === "panes" && viewKind === "editor"
      ? Array.from(elements.paneGrid.querySelectorAll<HTMLElement>(".explorer-pane")).find(
          (candidate) => candidate.dataset.tabId === activeTabId
        )
      : undefined;
  const paneSearchInput = pane?.querySelector<HTMLInputElement>("[data-role='search']");
  (paneSearchInput ?? elements.searchInput).focus();
}

function moveKeyboardSelection(
  key: KeyboardNavigationKey,
  preserveSelection: boolean,
  rangeSelection: boolean
): void {
  const tab = activeTab();
  const targets = renderTargetsForTab(tab);
  const next = keyboardNavigationState({
    state: tab,
    visibleItems: tab.filteredItems,
    viewMode: tab.viewMode,
    columns: Math.max(1, Math.floor(targets.viewport.clientWidth / gridItemWidth())),
    key,
    preserveSelection,
    rangeSelection,
    platform
  });
  if (!next) return;

  applySelectionState(tab, next);
  revealSelectedItem(tab);
}

function activateFocusedSelection(toggle: boolean, range: boolean): void {
  const tab = activeTab();
  const next = keyboardActivationSelectionState({
    state: tab,
    visibleItems: tab.filteredItems,
    toggle,
    range,
    platform
  });
  if (!next) return;

  applySelectionState(tab, next);
  revealSelectedItem(tab);
}

function bindSearchInputInteractions(
  searchInput: HTMLInputElement,
  tabProvider: () => ExplorerTab
): void {
  searchInput.addEventListener("focus", () => {
    textPasteSearchInput = searchInput;
  });
  searchInput.addEventListener("blur", () => {
    if (textPasteSearchInput === searchInput) {
      textPasteSearchInput = undefined;
    }
  });
  searchInput.addEventListener("keydown", (event) => {
    handleSearchInputKeydown(tabProvider(), searchInput, event);
  });
  searchInput.addEventListener("paste", (event) => {
    handleSearchInputPaste(event);
  });
}

function handleSearchInputKeydown(
  tab: ExplorerTab,
  searchInput: HTMLInputElement,
  event: KeyboardEvent
): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    textPasteSearchInput = undefined;
    resetSearchAndFocusItems(tab, searchInput);
  }
}

function handleSearchInputPaste(event: ClipboardEvent): void {
  if (event.currentTarget === textPasteSearchInput) {
    return;
  }
  event.preventDefault();
}

function resetSearchAndFocusItems(tab: ExplorerTab, searchInput: HTMLInputElement): void {
  if (tab.searchQuery || searchInput.value) {
    searchInput.value = "";
    runSearchForTab(tab, "");
  }
  searchInput.blur();
  requestAnimationFrame(() => {
    renderTargetsForTab(tab).viewport.focus({ preventScroll: true });
  });
}

function isItemNavigationKey(key: string): key is KeyboardNavigationKey {
  return key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";
}

function updateSelection(
  tab: ExplorerTab,
  itemPath: string,
  toggle: boolean,
  range: boolean
): void {
  applySelectionState(
    tab,
    updateSelectionState({
      state: tab,
      itemPath,
      visibleItems: tab.filteredItems,
      toggle,
      range,
      platform
    })
  );
}

function selectAllItems(): void {
  const tab = activeTab();
  applySelectionState(tab, selectAllSelectionState(tab.filteredItems.map((item) => item.path)));
  clearNativeTextSelection();
  scheduleRender();
}

function clearNativeTextSelection(): void {
  window.getSelection()?.removeAllRanges();
  requestAnimationFrame(() => window.getSelection()?.removeAllRanges());
}

function clearSelection(): void {
  const tab = activeTab();
  if (!tab.selectedPaths.length) return;
  applySelectionState(tab, emptySelectionState());
  scheduleRender();
}

function clearSelectionFromEmptyClick(event: MouseEvent): void {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if ((event.target as HTMLElement).closest(".file-item")) return;
  clearSelection();
}

function beginSelectionDrag(event: PointerEvent): void {
  if (event.button !== 0 || isEditableTarget(event.target)) return;
  const viewport = (event.target as HTMLElement).closest<HTMLElement>(".viewport");
  if (!viewport) return;
  const items = viewport.querySelector<HTMLElement>(".items");
  if (!items) return;

  selectionDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    currentX: event.clientX,
    currentY: event.clientY,
    additive: event.ctrlKey || event.metaKey,
    baseSelection: [...activeTab().selectedPaths],
    active: false,
    viewport,
    items,
    selectionBox: ensureSelectionBox(viewport)
  };
}

function updateSelectionDrag(event: PointerEvent): void {
  if (!selectionDrag || event.pointerId !== selectionDrag.pointerId) return;

  selectionDrag.currentX = event.clientX;
  selectionDrag.currentY = event.clientY;

  if (!selectionDrag.active) {
    const distanceX = Math.abs(selectionDrag.currentX - selectionDrag.startX);
    const distanceY = Math.abs(selectionDrag.currentY - selectionDrag.startY);
    if (distanceX < 5 && distanceY < 5) return;
    selectionDrag.active = true;
    selectionDrag.selectionBox.classList.remove("hidden");
    document.body.classList.add("drag-selecting");
    clearNativeTextSelection();
  }

  event.preventDefault();
  renderSelectionBox(selectionDrag);
  applySelectionDrag(selectionDrag);
}

function endSelectionDrag(event: PointerEvent): void {
  if (!selectionDrag || event.pointerId !== selectionDrag.pointerId) return;

  if (selectionDrag.active) {
    event.preventDefault();
    suppressedDragClick = {
      clientX: event.clientX,
      clientY: event.clientY,
      expiresAt: performance.now() + 350
    };
  }

  const selectionBox = selectionDrag.selectionBox;
  selectionDrag = undefined;
  selectionBox.classList.add("hidden");
  document.body.classList.remove("drag-selecting");
}

function shouldSuppressDragClick(event: MouseEvent): boolean {
  if (!suppressedDragClick) return false;

  const pending = suppressedDragClick;
  suppressedDragClick = undefined;
  return shouldSuppressDragClickState(pending, event, performance.now());
}

function renderSelectionBox(state: SelectionDragState): void {
  const viewportRect = state.viewport.getBoundingClientRect();
  const box = selectionBoxLayout({
    startX: state.startX,
    startY: state.startY,
    currentX: state.currentX,
    currentY: state.currentY,
    viewport: viewportRect,
    scrollTop: state.viewport.scrollTop
  });

  state.selectionBox.style.left = `${box.left}px`;
  state.selectionBox.style.top = `${box.top}px`;
  state.selectionBox.style.width = `${box.width}px`;
  state.selectionBox.style.height = `${box.height}px`;
}

function applySelectionDrag(state: SelectionDragState): void {
  const selectionRect = normalizedRect(state.startX, state.startY, state.currentX, state.currentY);
  const hitPaths: string[] = [];

  for (const element of Array.from(state.items.querySelectorAll<HTMLElement>(".file-item"))) {
    const itemRect = element.getBoundingClientRect();
    if (rectsIntersect(selectionRect, itemRect)) {
      const itemPath = element.dataset.path;
      if (itemPath) hitPaths.push(itemPath);
    }
  }

  const tab = activeTab();
  const selection = dragSelectionState({
    hitPaths,
    additive: state.additive,
    baseSelection: state.baseSelection,
    platform
  });
  if (!selection) return;
  applySelectionState(tab, selection);
  render();
}

function ensureSelectionBox(viewport: HTMLElement): HTMLElement {
  const existing = viewport.querySelector<HTMLElement>(".selection-box");
  if (existing) return existing;

  const selectionBox = document.createElement("div");
  selectionBox.className = "selection-box hidden";
  viewport.append(selectionBox);
  return selectionBox;
}

function applySelectionState(tab: ExplorerTab, selection: PureSelectionState): void {
  tab.selectedPath = selection.selectedPath;
  tab.selectedPaths = selection.selectedPaths;
  tab.selectionAnchorPath = selection.selectionAnchorPath;
}

function selectedPaths(): string[] {
  return [...activeTab().selectedPaths];
}

function openSelectedItem(): void {
  const tab = activeTab();
  if (tab.selectedPaths.length !== 1) return;
  const selectedPath = tab.selectedPaths[0];
  const item = tab.filteredItems.find(
    (candidate) =>
      normalizeForComparison(candidate.path) === normalizeForComparison(selectedPath)
  );
  if (!item) return;

  if (item.isDirectory) {
    navigate(item.path);
  } else {
    vscode.postMessage({ command: "openFile", path: item.path });
  }
}

function renameSelection(): void {
  if (isVirtualDrivesPath(activeTab().path)) return;
  const paths = selectedPaths();
  if (paths.length === 1) {
    vscode.postMessage({ command: "renameItem", path: paths[0] });
  }
  hideContextMenu();
}

function deleteSelection(permanent = false): void {
  if (isVirtualDrivesPath(activeTab().path)) return;
  const paths = selectedPaths();
  if (paths.length) {
    vscode.postMessage({ command: "deleteItems", paths, permanent });
  }
  hideContextMenu();
}

function copySelection(cut: boolean): void {
  if (isVirtualDrivesPath(activeTab().path)) return;
  const paths = selectedPaths();
  if (!paths.length) return;
  clipboardPaths = paths;
  clipboardCut = cut;
  activeTab().status = copySelectionStatus(paths.length, cut);
  hideContextMenu();
  scheduleRender();
}

function pasteClipboard(): void {
  if (isVirtualDrivesPath(activeTab().path)) return;
  if (!clipboardPaths.length) return;
  vscode.postMessage({
    command: "pasteItems",
    paths: clipboardPaths,
    destination: activeTab().path,
    cut: clipboardCut
  });
  hideContextMenu();
}

function syncDirectoryWatchers(): void {
  const paths = tabs
    .map((tab) => tab.path)
    .filter((tabPath) => !isVirtualDrivesPath(tabPath));
  vscode.postMessage({
    command: "watchDirectories",
    paths: uniqueWatcherPaths(paths)
  });
}

function revealSelectedItem(tab: ExplorerTab, focusSelected = true): void {
  if (!tab.selectedPath) {
    return;
  }

  const index = tab.filteredItems.findIndex(
    (item) => normalizeForComparison(item.path) === normalizeForComparison(tab.selectedPath!)
  );
  if (index < 0) {
    return;
  }

  const targets = renderTargetsForTab(tab);
  const targetScrollTop = revealScrollTop({
    itemIndex: index,
    viewMode: tab.viewMode,
    viewportWidth: targets.viewport.clientWidth,
    viewportHeight: targets.viewport.clientHeight,
    listRowHeight: listRowHeight(),
    gridItemWidth: gridItemWidth(),
    gridRowHeight: gridRowHeight()
  });
  tab.scrollTop = targetScrollTop;

  // The virtual spacer and visible rows must be rendered before applying a
  // large scroll offset. Otherwise Chromium may clamp it to the old height.
  scheduleRender();
  requestAnimationFrame(() => {
    const nextTargets = renderTargetsForTab(tab);
    nextTargets.viewport.scrollTop = targetScrollTop;
    scheduleRender();
    requestAnimationFrame(() => {
      if (!focusSelected) return;
      focusItemElement(nextTargets.items, tab.selectedPath);
    });
  });
}

function focusItemElement(container: HTMLElement, itemPath: string | undefined): void {
  if (!itemPath) return;
  const normalizedPath = normalizeForComparison(itemPath);
  const item = Array.from(container.querySelectorAll<HTMLElement>(".file-item")).find(
    (candidate) => candidate.dataset.path && normalizeForComparison(candidate.dataset.path) === normalizedPath
  );
  item?.focus({ preventScroll: true });
}

function renderTargetsForTab(tab: ExplorerTab): PaneRenderElements {
  if (layoutMode === "panes" && viewKind === "editor") {
    const pane = Array.from(
      elements.paneGrid.querySelectorAll<HTMLElement>(".explorer-pane")
    ).find((candidate) => candidate.dataset.tabId === tab.id);
    const refs = pane ? paneRenderElements(pane) : undefined;
    if (refs) return refs;
  }
  return elements;
}

function completeExternalNavigation(tab: ExplorerTab): void {
  if (!tab.externalNavigationId) return;
  const requestId = tab.externalNavigationId;
  tab.externalNavigationId = undefined;
  vscode.postMessage({ command: "navigationComplete", requestId });
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function isTypeAheadCharacter(key: string): boolean {
  return key.length === 1 && !/\s/.test(key);
}

function updateRecursiveSearchButton(tab: ExplorerTab): void {
  elements.recursiveSearch.classList.toggle("active", tab.recursiveSearch);
  elements.recursiveSearch.setAttribute("aria-pressed", String(tab.recursiveSearch));
  elements.recursiveSearch.title = tab.recursiveSearch
    ? "Search subfolders: on"
    : "Search subfolders: off";
}

function debounce(callback: () => void, delay: number): () => void {
  let timer = 0;
  return () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(callback, delay);
  };
}

function toolbarIcon(pathData: string, className = ""): string {
  return `<svg class="toolbar-icon ${className}" viewBox="0 0 16 16" aria-hidden="true"><path d="${pathData}"/></svg>`;
}

function byId(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function button(id: string): HTMLButtonElement {
  return byId(id) as HTMLButtonElement;
}

function input(id: string): HTMLInputElement {
  return byId(id) as HTMLInputElement;
}
