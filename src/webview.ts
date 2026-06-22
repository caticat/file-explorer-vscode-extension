import "./webview.css";

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
  sortKey: "name" | "modified" | "size";
  sortDirection: "asc" | "desc";
  externalNavigationId?: string;
}

interface PersistedState {
  tabs: Array<
    Pick<
      ExplorerTab,
      | "id"
      | "path"
      | "history"
      | "historyIndex"
      | "viewMode"
      | "showHidden"
      | "sortKey"
      | "sortDirection"
    >
  >;
  activeTabId: string;
}

const vscode = acquireVsCodeApi();
const app = document.getElementById("app")!;
const metadataRequested = new Set<string>();

let workspaceRoots: WorkspaceRoot[] = [];
let initialPath = "";
let pathSeparator = "/";
let platform = "linux";
let preferredViewMode: ExplorerTab["viewMode"] = "list";
let preferredRecursiveSearch = false;
let tabs: ExplorerTab[] = [];
let activeTabId = "";
let renderScheduled = false;
let contextMenuItem: DirectoryItem | undefined;
let typeAheadBuffer = "";
let typeAheadTimer = 0;
let clipboardPaths: string[] = [];
let clipboardCut = false;

app.innerHTML = `
  <div class="shell">
    <div class="tabs-bar">
      <div id="tabs" class="tabs"></div>
      <button id="new-tab" class="icon-button" title="New tab" aria-label="New tab">${toolbarIcon(
        "M8 1.5V14.5M1.5 8H14.5"
      )}</button>
    </div>
    <div class="toolbar">
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
      <div id="address" class="address"></div>
      <input id="address-input" class="address-input hidden" spellcheck="false">
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
    </div>
    <div id="list-header" class="list-header">
      <button data-sort="name">Name</button>
      <button data-sort="modified">Modified</button>
      <button data-sort="size">Size</button>
    </div>
    <div id="viewport" class="viewport" tabindex="0">
      <div id="spacer" class="spacer"></div>
      <div id="items" class="items"></div>
      <div id="empty" class="empty hidden"></div>
    </div>
    <div class="footer-bar">
      <span id="status" class="status"></span>
      <span id="selection-status" class="selection-status"></span>
    </div>
  </div>
  <div id="context-menu" class="context-menu hidden" role="menu">
    <button id="reveal-system" role="menuitem">Reveal in System File Manager</button>
    <button id="show-in-explorer" role="menuitem">Show in This File Explorer</button>
    <div class="menu-separator"></div>
    <button id="rename-item" role="menuitem">Rename</button>
    <button id="copy-items" role="menuitem">Copy</button>
    <button id="cut-items" role="menuitem">Cut</button>
    <button id="paste-items" role="menuitem">Paste</button>
    <button id="delete-items" role="menuitem">Move to Trash</button>
  </div>
`;

const elements = {
  tabs: byId("tabs"),
  newTab: button("new-tab"),
  back: button("back"),
  forward: button("forward"),
  up: button("up"),
  workspaceHome: button("workspace-home"),
  refresh: button("refresh"),
  newFile: button("new-file"),
  newFolder: button("new-folder"),
  address: byId("address"),
  addressInput: input("address-input"),
  listView: button("list-view"),
  gridView: button("grid-view"),
  toggleHidden: button("toggle-hidden"),
  searchInput: input("search-input"),
  recursiveSearch: button("recursive-search"),
  status: byId("status"),
  selectionStatus: byId("selection-status"),
  listHeader: byId("list-header"),
  viewport: byId("viewport"),
  spacer: byId("spacer"),
  items: byId("items"),
  empty: byId("empty"),
  contextMenu: byId("context-menu"),
  revealSystem: button("reveal-system"),
  showInExplorer: button("show-in-explorer"),
  renameItem: button("rename-item"),
  copyItems: button("copy-items"),
  cutItems: button("cut-items"),
  pasteItems: button("paste-items"),
  deleteItems: button("delete-items")
};

elements.newTab.addEventListener("click", () => createTab(getWorkspacePath()));
elements.back.addEventListener("click", () => moveHistory(-1));
elements.forward.addEventListener("click", () => moveHistory(1));
elements.up.addEventListener("click", navigateUp);
elements.workspaceHome.addEventListener("click", () => navigate(getWorkspacePath()));
elements.refresh.addEventListener("click", () => loadDirectory(activeTab(), false));
elements.newFile.addEventListener("click", () =>
  vscode.postMessage({ command: "createFile", path: activeTab().path })
);
elements.newFolder.addEventListener("click", () =>
  vscode.postMessage({ command: "createFolder", path: activeTab().path })
);
elements.address.addEventListener("click", (event) => {
  if (event.target === elements.address) {
    beginAddressEdit();
  }
});
elements.address.addEventListener("dblclick", beginAddressEdit);
elements.listView.addEventListener("click", () => setViewMode("list"));
elements.gridView.addEventListener("click", () => setViewMode("grid"));
elements.toggleHidden.addEventListener("click", () => {
  const tab = activeTab();
  tab.showHidden = !tab.showHidden;
  applyLocalFilter(tab);
  if (tab.recursiveSearch && tab.searchQuery) runSearch();
  saveState();
  scheduleRender();
});
elements.searchInput.addEventListener("input", debounce(runSearch, 180));
elements.recursiveSearch.addEventListener("click", () => {
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
elements.renameItem.addEventListener("click", renameSelection);
elements.copyItems.addEventListener("click", () => copySelection(false));
elements.cutItems.addEventListener("click", () => copySelection(true));
elements.pasteItems.addEventListener("click", pasteClipboard);
elements.deleteItems.addEventListener("click", () => deleteSelection(false));
elements.listHeader.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-sort]");
  if (!target) return;
  changeSort(target.dataset.sort as ExplorerTab["sortKey"]);
});
elements.viewport.addEventListener("scroll", () => {
  hideContextMenu();
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
  }

  if (isEditableTarget(event.target)) {
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
    event.preventDefault();
    beginAddressEdit();
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
  } else if (event.key === "Delete") {
    event.preventDefault();
    deleteSelection(event.shiftKey);
  } else if (event.key === "F2") {
    event.preventDefault();
    renameSelection();
  } else if (event.key === "Enter") {
    event.preventDefault();
    openSelectedItem();
  } else if (!event.ctrlKey && !event.metaKey && !event.altKey && isTypeAheadCharacter(event.key)) {
    event.preventDefault();
    selectByTypeAhead(event.key);
  }
});
window.addEventListener("pointerdown", (event) => {
  if (!elements.contextMenu.contains(event.target as Node)) {
    hideContextMenu();
  }
});
window.addEventListener("message", (event) => handleHostMessage(event.data));

vscode.postMessage({ command: "ready" });

function handleHostMessage(message: Record<string, unknown>): void {
  switch (message.command) {
    case "initialize": {
      initialPath = String(message.initialPath);
      workspaceRoots = message.workspaceRoots as WorkspaceRoot[];
      pathSeparator = String(message.pathSeparator);
      platform = String(message.platform);
      preferredViewMode =
        message.preferredViewMode === "grid" ? "grid" : "list";
      preferredRecursiveSearch = message.preferredRecursiveSearch === true;
      restoreOrCreateInitialTab();
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
    case "directoryStart": {
      const tab = tabForRequest(String(message.requestId));
      if (!tab) return;
      tab.path = String(message.path);
      tab.title = basename(tab.path) || tab.path;
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
      if (tab.items.length <= 1000) {
        sortItems(tab.items, tab);
      }
      applyLocalFilter(tab);
      if (
        tab.pendingRevealPath &&
        tab.items.some(
          (item) => normalizeForComparison(item.path) === normalizeForComparison(tab.pendingRevealPath!)
        )
      ) {
        revealSelectedItem(tab);
      }
      scheduleRender();
      break;
    }
    case "directoryComplete": {
      const tab = tabForRequest(String(message.requestId));
      if (!tab) return;
      tab.loading = false;
      sortItems(tab.items, tab);
      applyLocalFilter(tab);
      revealSelectedItem(tab);
      completeExternalNavigation(tab);
      tab.pendingRevealPath = undefined;
      tab.status = `${Number(message.count).toLocaleString()} items`;
      tab.requestId = undefined;
      saveState();
      scheduleRender();
      break;
    }
    case "directoryChanged": {
      const changedPath = String(message.path);
      for (const tab of tabs) {
        if (normalizeForComparison(tab.path) === normalizeForComparison(changedPath)) {
          loadDirectory(tab, true);
        }
      }
      break;
    }
    case "operationComplete": {
      const changedPath = String(message.path);
      if (message.clearClipboard) {
        clipboardPaths = [];
        clipboardCut = false;
      }
      let refreshed = false;
      for (const tab of tabs) {
        if (normalizeForComparison(tab.path) === normalizeForComparison(changedPath)) {
          tab.selectedPath = message.revealPath ? String(message.revealPath) : undefined;
          tab.selectedPaths = tab.selectedPath ? [tab.selectedPath] : [];
          tab.pendingRevealPath = tab.selectedPath;
          loadDirectory(tab, false);
          refreshed = true;
        }
      }
      if (!refreshed) {
        const tab = activeTab();
        if (tab.searchMode && tab.recursiveSearch && tab.searchQuery) {
          runSearch();
        } else {
          loadDirectory(tab, false);
        }
      }
      break;
    }
    case "metadata": {
      const metadata = message.items as DirectoryItem[];
      const lookup = new Map(metadata.map((item) => [item.path, item]));
      for (const tab of tabs) {
        for (const item of tab.items) {
          const value = lookup.get(item.path);
          if (value) {
            item.size = value.size;
            item.modified = value.modified;
          }
        }
        if (tab.sortKey !== "name") {
          sortItems(tab.items, tab);
          applyLocalFilter(tab);
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
      sortItems(tab.filteredItems, tab);
      const suffix = message.limited ? " · result limit reached" : "";
      tab.status = `${Number(message.count).toLocaleString()} matches · ${Number(
        message.scannedDirectories
      ).toLocaleString()} folders${suffix}`;
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

function restoreOrCreateInitialTab(): void {
  const persisted = vscode.getState() as PersistedState | undefined;
  if (persisted?.tabs?.length) {
    tabs = persisted.tabs.map((saved) => ({
      ...saved,
      viewMode: preferredViewMode,
      title: basename(saved.path) || saved.path,
      items: [],
      filteredItems: [],
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
      showHidden: saved.showHidden ?? false,
      sortKey: saved.sortKey ?? "name",
      sortDirection: saved.sortDirection ?? "asc"
    }));
    activeTabId = tabs.some((tab) => tab.id === persisted.activeTabId)
      ? persisted.activeTabId
      : tabs[0].id;
    syncDirectoryWatchers();
    for (const tab of tabs) {
      loadDirectory(tab, false);
    }
    return;
  }
  createTab(initialPath);
}

function createTab(tabPath: string): void {
  const tab: ExplorerTab = {
    id: randomId(),
    path: tabPath,
    title: basename(tabPath) || tabPath,
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
    sortKey: "name",
    sortDirection: "asc"
  };
  tabs.push(tab);
  activeTabId = tab.id;
  syncDirectoryWatchers();
  loadDirectory(tab, false);
}

function closeTab(tabId: string): void {
  if (tabs.length === 1) {
    cancelTabRequests(tabs[0]);
    vscode.postMessage({ command: "closePanel" });
    return;
  }
  const index = tabs.findIndex((tab) => tab.id === tabId);
  const [removed] = tabs.splice(index, 1);
  cancelTabRequests(removed);
  if (activeTabId === tabId) {
    activeTabId = tabs[Math.max(0, index - 1)].id;
  }
  syncDirectoryWatchers();
  activateCurrentTab();
}

function activateTab(tabId: string): void {
  activeTabId = tabId;
  activateCurrentTab();
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

function navigate(targetPath: string, pushHistory = true, revealPath?: string): void {
  const tab = activeTab();
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
  syncDirectoryWatchers();
  loadDirectory(tab, false);
}

function moveHistory(offset: number): void {
  const tab = activeTab();
  const targetIndex = tab.historyIndex + offset;
  if (targetIndex < 0 || targetIndex >= tab.history.length) {
    return;
  }
  tab.historyIndex = targetIndex;
  tab.path = tab.history[targetIndex];
  syncDirectoryWatchers();
  loadDirectory(tab, false);
}

function navigateUp(): void {
  const tab = activeTab();
  const parent = dirname(tab.path);
  if (parent !== tab.path) {
    navigate(parent);
  }
}

function loadDirectory(tab: ExplorerTab, preserveItems: boolean): void {
  cancelTabRequests(tab);
  tab.requestId = randomId();
  tab.loading = true;
  tab.status = "Loading…";
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
  tab.searchQuery = elements.searchInput.value.trim();
  cancelSearch(tab);

  if (!tab.searchQuery) {
    tab.searchMode = false;
    applyLocalFilter(tab);
    tab.status = `${tab.items.length.toLocaleString()} items`;
    scheduleRender();
    return;
  }

  if (!tab.recursiveSearch) {
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

function applyLocalFilter(tab: ExplorerTab): void {
  const matchesQuery = createNameMatcher(tab.searchQuery);
  tab.filteredItems = tab.items.filter(
    (item) =>
      (tab.showHidden || !item.name.startsWith(".")) &&
      (!tab.searchQuery || matchesQuery(item.name))
  );
  sortItems(tab.filteredItems, tab);
}

function createNameMatcher(query: string): (name: string) => boolean {
  if (!query.includes("*") && !query.includes("?")) {
    const normalized = query.toLocaleLowerCase();
    return (name) => name.toLocaleLowerCase().includes(normalized);
  }

  const escaped = query.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const expression = escaped.replaceAll("*", ".*").replaceAll("?", ".");
  const regex = new RegExp(`^${expression}$`, "i");
  return (name) => regex.test(name);
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
  elements.addressInput.value = activeTab().path;
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
  saveState();
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
  renderTabs();
  renderAddress(tab);
  renderToolbar(tab);
  renderVirtualItems(tab);
  elements.status.textContent = tab.status;
  elements.selectionStatus.textContent =
    tab.selectedPaths.length > 1 ? `${tab.selectedPaths.length.toLocaleString()} selected` : "";
  elements.listHeader.classList.toggle("hidden", tab.viewMode !== "list");
  document.querySelector(".shell")?.classList.toggle("grid-mode", tab.viewMode === "grid");
  elements.listView.classList.toggle("active", tab.viewMode === "list");
  elements.gridView.classList.toggle("active", tab.viewMode === "grid");
  elements.toggleHidden.classList.toggle("active", tab.showHidden);
  elements.toggleHidden.title = tab.showHidden ? "Hide hidden files" : "Show hidden files";
  for (const header of Array.from(
    elements.listHeader.querySelectorAll<HTMLButtonElement>("button[data-sort]")
  )) {
    const active = header.dataset.sort === tab.sortKey;
    header.classList.toggle("active", active);
    header.textContent = `${header.dataset.sort === "name" ? "Name" : header.dataset.sort === "modified" ? "Modified" : "Size"}${
      active ? (tab.sortDirection === "asc" ? " ↑" : " ↓") : ""
    }`;
  }
  updateRecursiveSearchButton(tab);
}

function renderTabs(): void {
  elements.tabs.replaceChildren(
    ...tabs.map((tab) => {
      const tabElement = document.createElement("button");
      tabElement.className = `tab ${tab.id === activeTabId ? "active" : ""}`;
      tabElement.title = tab.path;
      tabElement.addEventListener("click", () => activateTab(tab.id));

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

function renderAddress(tab: ExplorerTab): void {
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
  elements.back.disabled = tab.historyIndex <= 0;
  elements.forward.disabled = tab.historyIndex >= tab.history.length - 1;
  elements.up.disabled = dirname(tab.path) === tab.path;
  elements.workspaceHome.disabled = !workspaceRoots.length;
}

function renderVirtualItems(tab: ExplorerTab): void {
  const data = tab.filteredItems;
  const viewportHeight = elements.viewport.clientHeight;
  const scrollTop = elements.viewport.scrollTop;
  const overscan = 4;
  let startIndex = 0;
  let endIndex = 0;
  let totalHeight = 0;
  let top = 0;
  let columns = 1;
  let rowHeight = 34;

  if (tab.viewMode === "list") {
    rowHeight = 34;
    totalHeight = data.length * rowHeight;
    startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    endIndex = Math.min(data.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
    top = startIndex * rowHeight;
  } else {
    const itemWidth = 128;
    rowHeight = 112;
    columns = Math.max(1, Math.floor(elements.viewport.clientWidth / itemWidth));
    const rowCount = Math.ceil(data.length / columns);
    totalHeight = rowCount * rowHeight;
    const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const endRow = Math.min(rowCount, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
    startIndex = startRow * columns;
    endIndex = Math.min(data.length, endRow * columns);
    top = startRow * rowHeight;
  }

  elements.spacer.style.height = `${totalHeight}px`;
  elements.items.style.transform = `translateY(${top}px)`;
  elements.items.className = `items ${tab.viewMode}`;
  if (tab.viewMode === "grid") {
    elements.items.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  } else {
    elements.items.style.removeProperty("grid-template-columns");
  }

  const visible = data.slice(startIndex, endIndex);
  elements.items.replaceChildren(...visible.map((item) => createItemElement(item, tab)));

  const needsMetadata = visible
    .filter((item) => !metadataRequested.has(item.path))
    .map((item) => item.path);
  if (needsMetadata.length > 0) {
    needsMetadata.forEach((itemPath) => metadataRequested.add(itemPath));
    vscode.postMessage({ command: "loadMetadata", paths: needsMetadata });
  }

  const showEmpty = !tab.loading && data.length === 0;
  elements.empty.classList.toggle("hidden", !showEmpty);
  elements.empty.textContent = tab.searchQuery ? "No matching files." : "This folder is empty.";
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
    updateSelection(tab, item.path, event.ctrlKey || event.metaKey, event.shiftKey);
    scheduleRender();
  });
  element.addEventListener("dblclick", () => {
    if (item.isDirectory) {
      navigate(item.path);
    } else {
      vscode.postMessage({ command: "openFile", path: item.path });
    }
  });
  element.addEventListener("contextmenu", (event) => {
    event.preventDefault();
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
  if (platform === "win32") {
    const normalized = value.replaceAll("/", "\\");
    const rootMatch = normalized.match(/^(?:[A-Za-z]:\\|\\\\[^\\]+\\[^\\]+\\?)/);
    const root = rootMatch?.[0] ?? "";
    const remainder = normalized.slice(root.length).split("\\").filter(Boolean);
    const result: Array<{ label: string; path: string }> = [];
    let current = root || normalized;
    if (root) {
      result.push({ label: root.replace(/\\$/, ""), path: root });
    }
    for (const segment of remainder) {
      current = current.endsWith("\\") ? `${current}${segment}` : `${current}\\${segment}`;
      result.push({ label: segment, path: current });
    }
    return result;
  }

  const segments = value.split("/").filter(Boolean);
  const result = [{ label: "/", path: "/" }];
  let current = "";
  for (const segment of segments) {
    current += `/${segment}`;
    result.push({ label: segment, path: current });
  }
  return result;
}

function sortItems(items: DirectoryItem[], tab: ExplorerTab): void {
  items.sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) {
      return left.isDirectory ? -1 : 1;
    }
    let result = 0;
    if (tab.sortKey === "modified") {
      result = (left.modified ?? 0) - (right.modified ?? 0);
    } else if (tab.sortKey === "size") {
      result = (left.size ?? 0) - (right.size ?? 0);
    } else {
      result = left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: platform === "win32" ? "base" : "variant"
      });
    }
    if (result === 0 && tab.sortKey !== "name") {
      result = left.name.localeCompare(right.name, undefined, { numeric: true });
    }
    return tab.sortDirection === "asc" ? result : -result;
  });
}

function changeSort(sortKey: ExplorerTab["sortKey"]): void {
  const tab = activeTab();
  if (tab.sortKey === sortKey) {
    tab.sortDirection = tab.sortDirection === "asc" ? "desc" : "asc";
  } else {
    tab.sortKey = sortKey;
    tab.sortDirection = sortKey === "name" ? "asc" : "desc";
  }

  if (sortKey !== "name") {
    requestMetadata(tab.items);
  }
  sortItems(tab.items, tab);
  applyLocalFilter(tab);
  saveState();
  scheduleRender();
}

function requestMetadata(items: DirectoryItem[]): void {
  const pending = items.filter((item) => item.modified === undefined).map((item) => item.path);
  for (let index = 0; index < pending.length; index += 100) {
    const paths = pending.slice(index, index + 100);
    paths.forEach((itemPath) => metadataRequested.add(itemPath));
    vscode.postMessage({ command: "loadMetadata", paths });
  }
}

function getWorkspacePath(): string {
  return workspaceRoots[0]?.path ?? initialPath;
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
  const normalized = value.replace(/[\\/]+$/, "");
  if (platform === "win32") {
    if (/^[A-Za-z]:$/.test(normalized)) return `${normalized}\\`;
    const index = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
    if (index <= 2 && /^[A-Za-z]:/.test(normalized)) return `${normalized.slice(0, 2)}\\`;
    return index > 0 ? normalized.slice(0, index) : value;
  }
  if (!normalized || normalized === "/") return "/";
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

function basename(value: string): string {
  const normalized = value.replace(/[\\/]+$/, "");
  const index = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  return normalized.slice(index + 1);
}

function createFileIcon(item: DirectoryItem): SVGSVGElement {
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

function formatSize(size: number | undefined): string {
  if (size === undefined) return "";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function normalizeForComparison(value: string): string {
  const normalized = value.replace(/[\\/]+$/, "");
  return platform === "win32" ? normalized.toLocaleLowerCase() : normalized;
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function saveState(): void {
  const state: PersistedState = {
    tabs: tabs.map(
      ({ id, path, history, historyIndex, viewMode, showHidden, sortKey, sortDirection }) => ({
      id,
      path,
      history,
      historyIndex,
      viewMode,
      showHidden,
      sortKey,
      sortDirection
    })
    ),
    activeTabId
  };
  vscode.setState(state);
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
  item: DirectoryItem,
  allowShowInExplorer: boolean
): void {
  contextMenuItem = item;
  elements.showInExplorer.classList.toggle("hidden", !allowShowInExplorer);
  elements.renameItem.disabled = activeTab().selectedPaths.length !== 1;
  elements.pasteItems.disabled = clipboardPaths.length === 0;
  elements.contextMenu.classList.remove("hidden");

  const rect = elements.contextMenu.getBoundingClientRect();
  const left = Math.min(clientX, window.innerWidth - rect.width - 6);
  const top = Math.min(clientY, window.innerHeight - rect.height - 6);
  elements.contextMenu.style.left = `${Math.max(4, left)}px`;
  elements.contextMenu.style.top = `${Math.max(4, top)}px`;
}

function hideContextMenu(): void {
  contextMenuItem = undefined;
  elements.contextMenu.classList.add("hidden");
}

function showItemInExplorer(item: DirectoryItem): void {
  const parentPath = dirname(item.path);
  navigate(parentPath, true, item.path);
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

function updateSelection(
  tab: ExplorerTab,
  itemPath: string,
  toggle: boolean,
  range: boolean
): void {
  const normalized = normalizeForComparison(itemPath);
  if (range && tab.selectionAnchorPath) {
    const start = tab.filteredItems.findIndex(
      (item) => normalizeForComparison(item.path) === normalizeForComparison(tab.selectionAnchorPath!)
    );
    const end = tab.filteredItems.findIndex(
      (item) => normalizeForComparison(item.path) === normalized
    );
    if (start >= 0 && end >= 0) {
      const [from, to] = start < end ? [start, end] : [end, start];
      tab.selectedPaths = tab.filteredItems.slice(from, to + 1).map((item) => item.path);
    }
  } else if (toggle) {
    const existing = tab.selectedPaths.findIndex(
      (selectedPath) => normalizeForComparison(selectedPath) === normalized
    );
    if (existing >= 0) {
      tab.selectedPaths.splice(existing, 1);
    } else {
      tab.selectedPaths.push(itemPath);
    }
    tab.selectionAnchorPath = itemPath;
  } else {
    tab.selectedPaths = [itemPath];
    tab.selectionAnchorPath = itemPath;
  }
  tab.selectedPath = itemPath;
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
  const paths = selectedPaths();
  if (paths.length === 1) {
    vscode.postMessage({ command: "renameItem", path: paths[0] });
  }
  hideContextMenu();
}

function deleteSelection(permanent = false): void {
  const paths = selectedPaths();
  if (paths.length) {
    vscode.postMessage({ command: "deleteItems", paths, permanent });
  }
  hideContextMenu();
}

function copySelection(cut: boolean): void {
  const paths = selectedPaths();
  if (!paths.length) return;
  clipboardPaths = paths;
  clipboardCut = cut;
  activeTab().status = `${cut ? "Cut" : "Copied"} ${paths.length.toLocaleString()} item${
    paths.length === 1 ? "" : "s"
  }`;
  hideContextMenu();
  scheduleRender();
}

function pasteClipboard(): void {
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
  vscode.postMessage({
    command: "watchDirectories",
    paths: [...new Set(tabs.map((tab) => tab.path))]
  });
}

function revealSelectedItem(tab: ExplorerTab): void {
  if (!tab.selectedPath) {
    return;
  }

  const index = tab.filteredItems.findIndex(
    (item) => normalizeForComparison(item.path) === normalizeForComparison(tab.selectedPath!)
  );
  if (index < 0) {
    return;
  }

  let targetScrollTop: number;
  if (tab.viewMode === "list") {
    targetScrollTop = index * 34;
  } else {
    const columns = Math.max(1, Math.floor(elements.viewport.clientWidth / 128));
    targetScrollTop = Math.floor(index / columns) * 112;
  }

  const rowHeight = tab.viewMode === "list" ? 34 : 112;
  targetScrollTop = Math.max(
    0,
    targetScrollTop - Math.max(0, (elements.viewport.clientHeight - rowHeight) / 2)
  );
  tab.scrollTop = targetScrollTop;

  // The virtual spacer and visible rows must be rendered before applying a
  // large scroll offset. Otherwise Chromium may clamp it to the old height.
  scheduleRender();
  requestAnimationFrame(() => {
    elements.viewport.scrollTop = targetScrollTop;
    scheduleRender();
    requestAnimationFrame(() => {
      const selected = elements.items.querySelector<HTMLElement>(".file-item.selected");
      selected?.focus({ preventScroll: true });
    });
  });
}

function completeExternalNavigation(tab: ExplorerTab): void {
  if (!tab.externalNavigationId) return;
  const requestId = tab.externalNavigationId;
  const targetFound =
    !tab.pendingRevealPath ||
    tab.items.some(
      (item) =>
        normalizeForComparison(item.path) === normalizeForComparison(tab.pendingRevealPath!)
    );

  if (targetFound) {
    tab.externalNavigationId = undefined;
    vscode.postMessage({ command: "navigationComplete", requestId });
  }
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
