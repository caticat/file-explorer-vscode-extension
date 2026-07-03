import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  copyItem,
  isPathInsideOrEqualPath,
  nextCopyName,
  validateFileName
} from "./fileOperations";
import { parseIconThemeManifest } from "./extensionIconTheme";
import {
  createNameMatcher,
  directoryNameFromExcludePattern
} from "./extensionSearch";

interface DirectoryItem {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  hasChildren?: boolean;
}

interface SearchItem extends DirectoryItem {
  relativePath: string;
}

const DIRECTORY_BATCH_SIZE = 250;
const SEARCH_BATCH_SIZE = 100;
const SEARCH_RESULT_LIMIT = 5000;
const DEFAULT_SEARCH_IGNORED_DIRECTORIES = [".git"];
const SEARCH_EXCLUDE_CONFIG_KEYS = ["search.exclude", "files.exclude"];
const TREE_CHILD_PROBE_CONCURRENCY = 8;
const METADATA_BATCH_LIMIT = 100;
const METADATA_STAT_CONCURRENCY = 16;
const WORKSPACE_SESSION_KEY = "workspaceSession.v1";
const MAX_SAVED_TABS = 50;

interface WorkspaceSession {
  version: 1;
  tabs: Array<{ path: string }>;
  activeTabIndex: number;
  layoutMode?: "tabs" | "panes";
}

interface ListColumnPreferences {
  modified: boolean;
  size: boolean;
}

interface IconThemePayload {
  file?: string;
  folder?: string;
  fileExtensions: Record<string, string>;
  fileNames: Record<string, string>;
  folderNames: Record<string, string>;
}

interface CachedIconThemePayload {
  file?: string;
  folder?: string;
  fileExtensions: Record<string, string>;
  fileNames: Record<string, string>;
  folderNames: Record<string, string>;
}

interface ExplorerWebviewHost {
  webview: vscode.Webview;
  viewKind: "editor" | "sidebar";
  visible(): boolean;
  dispose?(): void;
}

type ViewLocation = "editor" | "sidebar";

let activePanel: vscode.WebviewPanel | undefined;
let activePanelReady = false;
let activeSidebarView: vscode.WebviewView | undefined;
let activeSidebarReady = false;
let statusBarItem: vscode.StatusBarItem | undefined;
let pendingNavigation:
  | { id: string; path: string; revealPath?: string }
  | undefined;
const runningRequests = new Map<string, AbortController>();
const directoryWatchers = new Map<string, fs.FSWatcher>();
const watcherTimers = new Map<string, NodeJS.Timeout>();
const metadataStatQueue: Array<() => void> = [];
const pendingMetadataStats = new Map<string, Promise<{ path: string; size?: number; modified?: number }>>();
const iconThemeCache = new Map<string, CachedIconThemePayload | undefined>();
let activeMetadataStats = 0;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("workspaceFileExplorer.sidebar", {
      resolveWebviewView: (view) => resolveSidebarView(context, view)
    })
  );

  const openEditorExplorer = (): void => {
    flushActiveSessions();
    closeSidebarIfOpen();
    if (activePanel) {
      activePanel.reveal(vscode.ViewColumn.Active);
      return;
    }
    createExplorerPanel(context);
  };

  const openSidebarExplorer = async (): Promise<void> => {
    flushActiveSessions();
    activePanel?.dispose();
    await vscode.commands.executeCommand("workbench.view.extension.simpleFileExplorer");
  };

  const openExplorer = async (): Promise<void> => {
    if (getViewLocation() === "sidebar") {
      await openSidebarExplorer();
      return;
    }
    openEditorExplorer();
  };

  const toggleExplorer = async (): Promise<void> => {
    if (getViewLocation() === "sidebar") {
      await openSidebarExplorer();
      return;
    }
    if (activePanel?.active) {
      activePanel.dispose();
      return;
    }
    openEditorExplorer();
  };

  const toggleViewLocation = async (): Promise<void> => {
    const nextLocation: ViewLocation = getViewLocation() === "sidebar" ? "editor" : "sidebar";
    await vscode.workspace
      .getConfiguration("simpleFileExplorer")
      .update("viewLocation", nextLocation, vscode.ConfigurationTarget.Global);
    if (nextLocation === "sidebar") {
      await openSidebarExplorer();
    } else {
      closeSidebarIfOpen();
      openEditorExplorer();
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("workspaceFileExplorer.open", openExplorer),
    vscode.commands.registerCommand("workspaceFileExplorer.toggle", toggleExplorer),
    vscode.commands.registerCommand("workspaceFileExplorer.newTab", () =>
      postTabCommand(openExplorer, "new")
    ),
    vscode.commands.registerCommand("workspaceFileExplorer.closeTab", () =>
      postTabCommand(openExplorer, "close")
    ),
    vscode.commands.registerCommand("workspaceFileExplorer.nextTab", () =>
      postTabCommand(openExplorer, "next")
    ),
    vscode.commands.registerCommand("workspaceFileExplorer.previousTab", () =>
      postTabCommand(openExplorer, "previous")
    ),
    ...Array.from({ length: 9 }, (_, index) =>
      vscode.commands.registerCommand(`workspaceFileExplorer.activateTab${index + 1}`, () =>
        postTabCommand(openExplorer, "activate", index)
      )
    ),
    vscode.commands.registerCommand("workspaceFileExplorer.toggleViewLocation", toggleViewLocation),
    vscode.commands.registerCommand(
      "workspaceFileExplorer.openFromExplorer",
      async (uri: vscode.Uri) => {
        if (!uri || uri.scheme !== "file") return;
        await openUriInExplorer(context, uri);
      }
    ),
    vscode.commands.registerCommand(
      "workspaceFileExplorer.revealInSimpleFileExplorer",
      async (uri?: vscode.Uri) => {
        const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
        if (!targetUri || targetUri.scheme !== "file") return;
        await openUriInExplorer(context, targetUri);
      }
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("simpleFileExplorer.viewLocation")) {
        handleViewLocationChanged();
      }
      if (event.affectsConfiguration("simpleFileExplorer.restoreWorkspaceSession")) {
        activePanel?.webview.postMessage({
          command: "workspaceSessionSettingChanged",
          enabled: shouldRestoreWorkspaceSession()
        });
        activeSidebarView?.webview.postMessage({
          command: "workspaceSessionSettingChanged",
          enabled: shouldRestoreWorkspaceSession()
        });
      }
      if (
        event.affectsConfiguration("workbench.iconTheme") ||
        event.affectsConfiguration("simpleFileExplorer.iconThemeMode")
      ) {
        void refreshIconThemeForActiveWebviews(context);
      }
      if (event.affectsConfiguration("simpleFileExplorer.treeProbeChildFolders")) {
        const enabled = shouldProbeTreeChildFolders();
        activePanel?.webview.postMessage({
          command: "treeProbeChildFoldersChanged",
          enabled
        });
        activeSidebarView?.webview.postMessage({
          command: "treeProbeChildFoldersChanged",
          enabled
        });
      }
    })
  );

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    25
  );
  statusBarItem.text = "$(folder-opened)";
  statusBarItem.name = "Simple File Explorer";
  statusBarItem.tooltip = "Toggle Simple File Explorer";
  statusBarItem.command = "workspaceFileExplorer.toggle";
  updateStatusBarVisibility();
  context.subscriptions.push(statusBarItem);
}

async function postTabCommand(
  openExplorer: () => Promise<void> | void,
  action: "new" | "close" | "next" | "previous" | "activate",
  index?: number
): Promise<void> {
  const webview =
    activePanel?.visible && activePanelReady
      ? activePanel.webview
      : activeSidebarView?.visible && activeSidebarReady
        ? activeSidebarView.webview
        : undefined;
  if (!webview) {
    await openExplorer();
    return;
  }
  await webview.postMessage({ command: "tabCommand", action, index });
}

function createExplorerPanel(context: vscode.ExtensionContext): void {
  activePanelReady = false;
  activePanel = vscode.window.createWebviewPanel(
    "workspaceFileExplorer",
    "Simple File Explorer",
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: webviewLocalResourceRoots(context)
    }
  );

  const panel = activePanel;
  panel.iconPath = new vscode.ThemeIcon("folder-opened");
  panel.webview.html = createWebviewHtml(panel.webview, context.extensionUri);

  panel.onDidDispose(
    () => {
      for (const controller of runningRequests.values()) {
        controller.abort();
      }
      runningRequests.clear();
      disposeDirectoryWatchers();
      if (activePanel === panel) {
        activePanel = undefined;
        activePanelReady = false;
      }
    },
    undefined,
    context.subscriptions
  );

  panel.onDidChangeViewState(
    (event) => {
      if (!event.webviewPanel.visible) {
        disposeDirectoryWatchers();
        activePanelReady = false;
      }
    },
    undefined,
    context.subscriptions
  );

  const host = createPanelHost(panel);

  panel.webview.onDidReceiveMessage(
    (message: unknown) => handleMessage(context, host, message),
    undefined,
    context.subscriptions
  );
}

function webviewLocalResourceRoots(context: vscode.ExtensionContext): vscode.Uri[] {
  const roots = [vscode.Uri.joinPath(context.extensionUri, "dist")];

  const iconThemeContribution = findActiveIconThemeContribution();
  if (iconThemeContribution) {
    roots.push(vscode.Uri.file(iconThemeContribution.extensionPath));
  }

  return roots;
}

function resolveSidebarView(
  context: vscode.ExtensionContext,
  view: vscode.WebviewView
): void {
  activeSidebarView = view;
  activeSidebarReady = false;
  view.webview.options = {
    enableScripts: true,
    localResourceRoots: webviewLocalResourceRoots(context)
  };
  view.webview.html = createWebviewHtml(view.webview, context.extensionUri);

  const host = createSidebarHost(view);
  view.onDidDispose(
    () => {
      if (activeSidebarView === view) {
        activeSidebarView = undefined;
        activeSidebarReady = false;
      }
    },
    undefined,
    context.subscriptions
  );
  view.onDidChangeVisibility(
    () => {
      if (!view.visible) {
        activeSidebarReady = false;
      }
    },
    undefined,
    context.subscriptions
  );
  view.webview.onDidReceiveMessage(
    (message: unknown) => handleMessage(context, host, message),
    undefined,
    context.subscriptions
  );
}

function createPanelHost(panel: vscode.WebviewPanel): ExplorerWebviewHost {
  return {
    webview: panel.webview,
    viewKind: "editor",
    visible: () => panel.visible,
    dispose: () => panel.dispose()
  };
}

function createSidebarHost(view: vscode.WebviewView): ExplorerWebviewHost {
  return {
    webview: view.webview,
    viewKind: "sidebar",
    visible: () => view.visible
  };
}

async function handleMessage(
  context: vscode.ExtensionContext,
  panel: ExplorerWebviewHost,
  rawMessage: unknown
): Promise<void> {
  if (!rawMessage || typeof rawMessage !== "object") {
    return;
  }

  const message = rawMessage as Record<string, unknown>;

  try {
    switch (message.command) {
      case "ready":
        await sendInitialState(panel, context);
        if (panel.viewKind === "editor") {
          activePanelReady = true;
        } else {
          activeSidebarReady = true;
        }
        await sendPendingNavigation(panel);
        break;
      case "savePreferences":
        if (message.viewMode === "list" || message.viewMode === "grid") {
          await context.globalState.update("preferredViewMode", message.viewMode);
        }
        if (typeof message.recursiveSearch === "boolean") {
          await context.globalState.update("preferredRecursiveSearch", message.recursiveSearch);
        }
        if (isListColumnPreferences(message.listColumns)) {
          await context.globalState.update("preferredListColumns", message.listColumns);
        }
        if (typeof message.treeVisible === "boolean") {
          await context.globalState.update("preferredTreeVisible", message.treeVisible);
        }
        if (Array.isArray(message.treeExpandedPaths)) {
          await context.globalState.update("preferredTreeExpandedPaths", asStringArray(message.treeExpandedPaths));
        }
        break;
      case "saveWorkspaceSession":
        await saveWorkspaceSession(context, message.session);
        break;
      case "clearWorkspaceSession":
        if (shouldRestoreWorkspaceSession()) {
          await context.workspaceState.update(WORKSPACE_SESSION_KEY, undefined);
        }
        break;
      case "navigationComplete":
        if (pendingNavigation?.id === asString(message.requestId)) {
          pendingNavigation = undefined;
        }
        break;
      case "readDirectory":
        await readDirectoryWithRecovery(
          panel,
          asString(message.requestId),
          asString(message.path)
        );
        break;
      case "readTreeDirectory":
        await readTreeDirectory(
          panel,
          asString(message.requestId),
          asString(message.path),
          message.showHidden === true,
          message.probeChildFolders === true
        );
        break;
      case "cancelRequest":
        cancelRequest(asString(message.requestId));
        break;
      case "loadMetadata":
        await loadMetadata(panel, asStringArray(message.paths));
        break;
      case "openFile":
        await openFile(asString(message.path));
        break;
      case "revealInSystem":
        await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(asString(message.path)));
        break;
      case "watchDirectories":
        updateDirectoryWatchers(panel, asStringArray(message.paths));
        break;
      case "createFile":
        await createItem(panel, asString(message.path), false);
        break;
      case "createFolder":
        await createItem(panel, asString(message.path), true);
        break;
      case "renameItem":
        await renameItem(panel, asString(message.path));
        break;
      case "deleteItems":
        await deleteItems(panel, asStringArray(message.paths), message.permanent === true);
        break;
      case "pasteItems":
        await pasteItems(
          panel,
          asStringArray(message.paths),
          asString(message.destination),
          message.cut === true
        );
        break;
      case "closePanel":
        if (panel.dispose) {
          panel.dispose();
        } else {
          await vscode.commands.executeCommand("workbench.action.closeSidebar");
        }
        break;
      case "toggleViewLocation":
        await vscode.commands.executeCommand("workspaceFileExplorer.toggleViewLocation");
        break;
      case "search":
        await searchRecursively(
          panel,
          asString(message.requestId),
          asString(message.path),
          asString(message.query),
          message.showHidden === true
        );
        break;
      case "validateDirectory":
        await validateDirectory(panel, asString(message.requestId), asString(message.path));
        break;
    }
  } catch (error) {
    panel.webview.postMessage({
      command: "operationError",
      requestId: typeof message.requestId === "string" ? message.requestId : undefined,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

async function openUriInExplorer(
  context: vscode.ExtensionContext,
  uri: vscode.Uri
): Promise<void> {
  const stat = await fs.promises.stat(uri.fsPath);
  pendingNavigation = stat.isDirectory()
    ? { id: crypto.randomUUID(), path: uri.fsPath }
    : {
        id: crypto.randomUUID(),
        path: path.dirname(uri.fsPath),
        revealPath: uri.fsPath
      };

  if (getViewLocation() === "sidebar") {
    activePanel?.dispose();
    await vscode.commands.executeCommand("workbench.view.extension.simpleFileExplorer");
    if (activeSidebarReady && activeSidebarView) {
      await sendPendingNavigation(createSidebarHost(activeSidebarView));
    }
    return;
  }

  closeSidebarIfOpen();
  if (!activePanel) {
    createExplorerPanel(context);
    return;
  }
  activePanel.reveal(vscode.ViewColumn.Active);
  if (activePanelReady) {
    await sendPendingNavigation(createPanelHost(activePanel));
  }
}

function getViewLocation(): ViewLocation {
  const value = vscode.workspace
    .getConfiguration("simpleFileExplorer")
    .get<string>("viewLocation", "editor");
  return value === "sidebar" ? "sidebar" : "editor";
}

function handleViewLocationChanged(): void {
  flushActiveSessions();
  updateStatusBarVisibility();
  if (getViewLocation() === "sidebar") {
    activePanel?.dispose();
  } else {
    closeSidebarIfOpen();
  }
}

function updateStatusBarVisibility(): void {
  if (!statusBarItem) return;
  if (getViewLocation() === "sidebar") {
    statusBarItem.hide();
  } else {
    statusBarItem.show();
  }
}

function closeSidebarIfOpen(): void {
  if (!activeSidebarView) return;
  void vscode.commands.executeCommand("workbench.action.closeSidebar");
  activeSidebarReady = false;
}

function flushActiveSessions(): void {
  activePanel?.webview.postMessage({ command: "flushSession" });
  activeSidebarView?.webview.postMessage({ command: "flushSession" });
}

async function sendPendingNavigation(panel: ExplorerWebviewHost): Promise<void> {
  if (!pendingNavigation) return;
  const navigation = pendingNavigation;
  await panel.webview.postMessage({
    command: "navigateExternal",
    requestId: navigation.id,
    path: navigation.path,
    revealPath: navigation.revealPath
  });
}

async function sendInitialState(
  panel: ExplorerWebviewHost,
  context: vscode.ExtensionContext
): Promise<void> {
  const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
    name: folder.name,
    path: folder.uri.fsPath
  }));

  const activeUri = vscode.window.activeTextEditor?.document.uri;
  const activeWorkspace = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined;
  const initialPath =
    activeWorkspace?.uri.fsPath ??
    workspaceRoots[0]?.path ??
    os.homedir();
  const restoreWorkspaceSession = shouldRestoreWorkspaceSession();
  const workspaceSession = restoreWorkspaceSession
    ? await readWorkspaceSession(context)
    : undefined;

  await panel.webview.postMessage({
    command: "initialize",
    initialPath,
    workspaceRoots,
    pathSeparator: path.sep,
    platform: process.platform,
    preferredViewMode: context.globalState.get<"list" | "grid">(
      "preferredViewMode",
      "list"
    ),
    preferredRecursiveSearch: context.globalState.get<boolean>(
      "preferredRecursiveSearch",
      false
    ),
    listColumns: context.globalState.get<ListColumnPreferences>(
      "preferredListColumns",
      { modified: true, size: true }
    ),
    iconTheme: await loadIconTheme(panel.webview),
    restoreWorkspaceSession,
    workspaceSession,
    viewKind: panel.viewKind,
    preferredTreeVisible: context.globalState.get<boolean>("preferredTreeVisible", false),
    preferredTreeExpandedPaths: context.globalState.get<string[]>("preferredTreeExpandedPaths", []),
    treeProbeChildFolders: shouldProbeTreeChildFolders()
  });
}

function shouldProbeTreeChildFolders(): boolean {
  return vscode.workspace
    .getConfiguration("simpleFileExplorer")
    .get<boolean>("treeProbeChildFolders", false);
}

async function refreshIconThemeForActiveWebviews(context: vscode.ExtensionContext): Promise<void> {
  if (activePanel) {
    activePanel.webview.options = {
      enableScripts: true,
      localResourceRoots: webviewLocalResourceRoots(context)
    };
    await activePanel.webview.postMessage({
      command: "iconThemeChanged",
      iconTheme: await loadIconTheme(activePanel.webview)
    });
  }
  if (activeSidebarView) {
    activeSidebarView.webview.options = {
      enableScripts: true,
      localResourceRoots: webviewLocalResourceRoots(context)
    };
    await activeSidebarView.webview.postMessage({
      command: "iconThemeChanged",
      iconTheme: await loadIconTheme(activeSidebarView.webview)
    });
  }
}

async function loadIconTheme(webview: vscode.Webview): Promise<IconThemePayload | undefined> {
  const mode = vscode.workspace
    .getConfiguration("simpleFileExplorer")
    .get<string>("iconThemeMode", "auto");
  if (mode !== "auto") return undefined;

  const themeId = vscode.workspace
    .getConfiguration("workbench")
    .get<string>("iconTheme");
  if (!themeId) return undefined;

  const contribution = findIconThemeContribution(themeId);
  if (!contribution) return undefined;

  try {
    const manifestPath = path.isAbsolute(contribution.themePath)
      ? contribution.themePath
      : path.join(contribution.extensionPath, contribution.themePath);

    const cached = await loadCachedIconTheme(manifestPath);
    if (!cached) return undefined;

    const toWebviewUri = (iconPath: string | undefined): string | undefined => {
      if (!iconPath) return undefined;
      return webview
        .asWebviewUri(vscode.Uri.file(iconPath))
        .toString();
    };

    const toWebviewUriMap = (source: Record<string, string>): Record<string, string> => {
      const result: Record<string, string> = {};
      for (const [key, iconPath] of Object.entries(source)) {
        const iconUri = toWebviewUri(iconPath);
        if (iconUri) {
          result[key] = iconUri;
        }
      }
      return result;
    };

    return {
      file: toWebviewUri(cached.file),
      folder: toWebviewUri(cached.folder),
      fileExtensions: toWebviewUriMap(cached.fileExtensions),
      fileNames: toWebviewUriMap(cached.fileNames),
      folderNames: toWebviewUriMap(cached.folderNames)
    };
  } catch {
    return undefined;
  }
}

async function loadCachedIconTheme(
  manifestPath: string
): Promise<CachedIconThemePayload | undefined> {
  const cacheKey = path.resolve(manifestPath);
  if (iconThemeCache.has(cacheKey)) {
    return iconThemeCache.get(cacheKey);
  }

  try {
    const manifest = JSON.parse(
      await fs.promises.readFile(manifestPath, "utf8")
    ) as Record<string, unknown>;
    const cached = parseIconThemeManifest(manifest, path.dirname(manifestPath));
    iconThemeCache.set(cacheKey, cached);
    return cached;
  } catch {
    iconThemeCache.set(cacheKey, undefined);
    return undefined;
  }
}

function findActiveIconThemeContribution():
  | { extensionPath: string; themePath: string }
  | undefined {
  const mode = vscode.workspace
    .getConfiguration("simpleFileExplorer")
    .get<string>("iconThemeMode", "auto");
  if (mode !== "auto") return undefined;

  const themeId = vscode.workspace
    .getConfiguration("workbench")
    .get<string>("iconTheme");
  return themeId ? findIconThemeContribution(themeId) : undefined;
}

function findIconThemeContribution(
  themeId: string
): { extensionPath: string; themePath: string } | undefined {
  for (const extension of vscode.extensions.all) {
    const iconThemes = (extension.packageJSON as Record<string, unknown>)?.contributes &&
      asRecord((extension.packageJSON as Record<string, unknown>).contributes)?.iconThemes;
    if (!Array.isArray(iconThemes)) continue;
    for (const theme of iconThemes) {
      const themeRecord = asRecord(theme);
      if (
        themeRecord?.id === themeId &&
        typeof themeRecord.path === "string"
      ) {
        return {
          extensionPath: extension.extensionPath,
          themePath: themeRecord.path
        };
      }
    }
  }
  return undefined;
}

function shouldRestoreWorkspaceSession(): boolean {
  return vscode.workspace
    .getConfiguration("simpleFileExplorer")
    .get<boolean>("restoreWorkspaceSession", true);
}

async function readWorkspaceSession(
  context: vscode.ExtensionContext
): Promise<WorkspaceSession | undefined> {
  const saved = context.workspaceState.get<WorkspaceSession>(WORKSPACE_SESSION_KEY);
  if (!saved || saved.version !== 1 || !Array.isArray(saved.tabs) || !saved.tabs.length) {
    return undefined;
  }

  const validTabs: Array<{ path: string }> = [];
  let activeTabIndex = 0;
  for (let index = 0; index < saved.tabs.length && validTabs.length < MAX_SAVED_TABS; index += 1) {
    const savedPath = saved.tabs[index]?.path;
    if (typeof savedPath !== "string") continue;
    try {
      const resolvedPath = path.resolve(savedPath);
      if ((await fs.promises.stat(resolvedPath)).isDirectory()) {
        if (index === saved.activeTabIndex) {
          activeTabIndex = validTabs.length;
        }
        validTabs.push({ path: resolvedPath });
      }
    } catch {
      // Ignore deleted or inaccessible saved directories.
    }
  }

  if (!validTabs.length) return undefined;
  return {
    version: 1,
    tabs: validTabs,
    activeTabIndex: Math.min(activeTabIndex, validTabs.length - 1),
    layoutMode: saved.layoutMode === "panes" ? "panes" : "tabs"
  };
}

async function saveWorkspaceSession(
  context: vscode.ExtensionContext,
  rawSession: unknown
): Promise<void> {
  if (!shouldRestoreWorkspaceSession() || !rawSession || typeof rawSession !== "object") return;
  const session = rawSession as Record<string, unknown>;
  if (!Array.isArray(session.tabs)) return;

  const tabs = session.tabs
    .slice(0, MAX_SAVED_TABS)
    .map((tab) => {
      if (!tab || typeof tab !== "object") return undefined;
      const tabPath = (tab as Record<string, unknown>).path;
      return typeof tabPath === "string" ? { path: path.resolve(tabPath) } : undefined;
    })
    .filter((tab): tab is { path: string } => tab !== undefined);
  if (!tabs.length) return;

  const requestedIndex =
    typeof session.activeTabIndex === "number" ? Math.trunc(session.activeTabIndex) : 0;
  const saved: WorkspaceSession = {
    version: 1,
    tabs,
    activeTabIndex: Math.max(0, Math.min(requestedIndex, tabs.length - 1)),
    layoutMode: session.layoutMode === "panes" && tabs.length > 1 ? "panes" : "tabs"
  };
  await context.workspaceState.update(WORKSPACE_SESSION_KEY, saved);
}

async function streamDirectory(
  panel: ExplorerWebviewHost,
  requestId: string,
  requestedPath: string
): Promise<void> {
  const directoryPath = normalizeInputPath(requestedPath);
  const controller = beginRequest(requestId);

  try {
    const stat = await fs.promises.stat(directoryPath);
    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${directoryPath}`);
    }

    await panel.webview.postMessage({
      command: "directoryStart",
      requestId,
      path: directoryPath
    });

    const directory = await fs.promises.opendir(directoryPath);
    let batch: DirectoryItem[] = [];
    let count = 0;

    try {
      for await (const entry of directory) {
        if (controller.signal.aborted) {
          return;
        }

        batch.push({
          name: entry.name,
          path: path.join(directoryPath, entry.name),
          isDirectory: entry.isDirectory(),
          isSymbolicLink: entry.isSymbolicLink()
        });
        count += 1;

        if (batch.length >= DIRECTORY_BATCH_SIZE) {
          await panel.webview.postMessage({
            command: "directoryBatch",
            requestId,
            items: batch
          });
          batch = [];
        }
      }
    } finally {
      await directory.close().catch(() => undefined);
    }

    if (batch.length > 0 && !controller.signal.aborted) {
      await panel.webview.postMessage({
        command: "directoryBatch",
        requestId,
        items: batch
      });
    }

    if (!controller.signal.aborted) {
      await panel.webview.postMessage({
        command: "directoryComplete",
        requestId,
        count
      });
    }
  } finally {
    finishRequest(requestId, controller);
  }
}

async function readDirectoryWithRecovery(
  panel: ExplorerWebviewHost,
  requestId: string,
  requestedPath: string
): Promise<void> {
  try {
    await streamDirectory(panel, requestId, requestedPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      throw error;
    }

    const fallbackPath = await findFallbackDirectory(requestedPath);
    await panel.webview.postMessage({
      command: "directoryUnavailable",
      requestId,
      path: path.resolve(requestedPath),
      fallbackPath,
      message: `Directory no longer exists: ${path.resolve(requestedPath)}`
    });
  }
}

async function readTreeDirectory(
  panel: ExplorerWebviewHost,
  requestId: string,
  requestedPath: string,
  showHidden: boolean,
  probeChildFolders: boolean
): Promise<void> {
  const directoryPath = normalizeInputPath(requestedPath);
  const controller = beginRequest(requestId);

  try {
    const entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
    if (controller.signal.aborted) return;

    const directoryEntries = entries.filter(
      (entry) => entry.isDirectory() && (showHidden || !entry.name.startsWith("."))
    );

    const items = probeChildFolders
      ? await buildTreeDirectoryItems(directoryPath, directoryEntries, showHidden, controller)
      : directoryEntries.map((entry) => ({
          name: entry.name,
          path: path.join(directoryPath, entry.name),
          isDirectory: true,
          isSymbolicLink: entry.isSymbolicLink()
        }));

    items.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));

    await panel.webview.postMessage({
      command: "treeDirectory",
      requestId,
      path: directoryPath,
      items
    });
  } catch (error) {
    if (!controller.signal.aborted) {
      await panel.webview.postMessage({
        command: "treeDirectoryError",
        requestId,
        path: directoryPath,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  } finally {
    finishRequest(requestId, controller);
  }
}

async function buildTreeDirectoryItems(
  parentPath: string,
  entries: fs.Dirent[],
  showHidden: boolean,
  controller: AbortController
): Promise<DirectoryItem[]> {
  const items = new Array<DirectoryItem>(entries.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (!controller.signal.aborted) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= entries.length) return;

      const entry = entries[index];
      const itemPath = path.join(parentPath, entry.name);
      items[index] = {
        name: entry.name,
        path: itemPath,
        isDirectory: true,
        isSymbolicLink: entry.isSymbolicLink(),
        hasChildren: await hasTreeChildDirectory(itemPath, showHidden)
      };
    }
  };

  const workerCount = Math.min(TREE_CHILD_PROBE_CONCURRENCY, entries.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return items.filter((item): item is DirectoryItem => item !== undefined);
}

async function hasTreeChildDirectory(directoryPath: string, showHidden: boolean): Promise<boolean> {
  let directory: fs.Dir | undefined;
  try {
    directory = await fs.promises.opendir(directoryPath);
    for await (const entry of directory) {
      if (entry.isDirectory() && (showHidden || !entry.name.startsWith("."))) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  } finally {
    await directory?.close().catch(() => undefined);
  }
}

async function findFallbackDirectory(requestedPath: string): Promise<string> {
  const resolvedPath = path.resolve(requestedPath);
  const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map((folder) =>
    path.resolve(folder.uri.fsPath)
  );
  const matchingRoot = workspaceRoots
    .filter((root) => isPathInsideOrEqual(resolvedPath, root))
    .sort((left, right) => right.length - left.length)[0];

  if (matchingRoot) {
    let candidate = resolvedPath;
    while (isPathInsideOrEqual(candidate, matchingRoot)) {
      if (await isExistingDirectory(candidate)) return candidate;
      const parent = path.dirname(candidate);
      if (parent === candidate) break;
      candidate = parent;
    }
  } else {
    let candidate = resolvedPath;
    while (true) {
      if (await isExistingDirectory(candidate)) return candidate;
      const parent = path.dirname(candidate);
      if (parent === candidate) break;
      candidate = parent;
    }
  }

  for (const root of workspaceRoots) {
    if (await isExistingDirectory(root)) return root;
  }
  return os.homedir();
}

function isPathInsideOrEqual(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function isExistingDirectory(directoryPath: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(directoryPath)).isDirectory();
  } catch {
    return false;
  }
}

async function loadMetadata(panel: ExplorerWebviewHost, paths: string[]): Promise<void> {
  const uniquePaths = [...new Set(paths)].slice(0, METADATA_BATCH_LIMIT);
  const results = await Promise.all(uniquePaths.map((itemPath) => queueMetadataStat(itemPath)));
  await panel.webview.postMessage({ command: "metadata", items: results });
}

function queueMetadataStat(itemPath: string): Promise<{ path: string; size?: number; modified?: number }> {
  const cacheKey = path.resolve(itemPath);
  const existing = pendingMetadataStats.get(cacheKey);
  if (existing) return existing;

  const pending = new Promise<{ path: string; size?: number; modified?: number }>((resolve) => {
    const run = (): void => {
      activeMetadataStats += 1;
      void statMetadata(itemPath)
        .then(resolve)
        .finally(() => {
          activeMetadataStats -= 1;
          pendingMetadataStats.delete(cacheKey);
          runQueuedMetadataStats();
        });
    };

    metadataStatQueue.push(run);
    runQueuedMetadataStats();
  });
  pendingMetadataStats.set(cacheKey, pending);
  return pending;
}

function runQueuedMetadataStats(): void {
  while (
    activeMetadataStats < METADATA_STAT_CONCURRENCY &&
    metadataStatQueue.length > 0
  ) {
    metadataStatQueue.shift()!();
  }
}

async function statMetadata(itemPath: string): Promise<{ path: string; size?: number; modified?: number }> {
  try {
    const stat = await fs.promises.stat(itemPath);
    return {
      path: itemPath,
      size: stat.size,
      modified: stat.mtimeMs
    };
  } catch {
    return { path: itemPath };
  }
}

async function searchRecursively(
  panel: ExplorerWebviewHost,
  requestId: string,
  requestedPath: string,
  rawQuery: string,
  showHidden: boolean
): Promise<void> {
  const rootPath = normalizeInputPath(requestedPath);
  const query = rawQuery.trim();
  const matchesQuery = createNameMatcher(query);
  const ignoredDirectories = searchIgnoredDirectories();
  const controller = beginRequest(requestId);

  try {
    await panel.webview.postMessage({
      command: "searchStart",
      requestId,
      path: rootPath
    });

    const pendingDirectories = [rootPath];
    let batch: SearchItem[] = [];
    let scannedDirectories = 0;
    let matchCount = 0;
    let limited = false;

    while (pendingDirectories.length > 0 && !controller.signal.aborted) {
      const currentPath = pendingDirectories.pop()!;
      let directory: fs.Dir;

      try {
        directory = await fs.promises.opendir(currentPath);
      } catch {
        continue;
      }

      scannedDirectories += 1;

      try {
        for await (const entry of directory) {
          if (controller.signal.aborted) {
            return;
          }

          const itemPath = path.join(currentPath, entry.name);
          const isDirectory = entry.isDirectory();
          if (!showHidden && entry.name.startsWith(".")) {
            continue;
          }

          if (
            isDirectory &&
            !entry.isSymbolicLink() &&
            !ignoredDirectories.has(entry.name)
          ) {
            pendingDirectories.push(itemPath);
          }

          if (matchesQuery(entry.name)) {
            batch.push({
              name: entry.name,
              path: itemPath,
              relativePath: path.relative(rootPath, itemPath),
              isDirectory,
              isSymbolicLink: entry.isSymbolicLink()
            });
            matchCount += 1;

            if (batch.length >= SEARCH_BATCH_SIZE) {
              await panel.webview.postMessage({
                command: "searchBatch",
                requestId,
                items: batch,
                scannedDirectories
              });
              batch = [];
            }

            if (matchCount >= SEARCH_RESULT_LIMIT) {
              limited = true;
              pendingDirectories.length = 0;
              break;
            }
          }
        }
      } finally {
        await directory.close().catch(() => undefined);
      }
    }

    if (batch.length > 0 && !controller.signal.aborted) {
      await panel.webview.postMessage({
        command: "searchBatch",
        requestId,
        items: batch,
        scannedDirectories
      });
    }

    if (!controller.signal.aborted) {
      await panel.webview.postMessage({
        command: "searchComplete",
        requestId,
        count: matchCount,
        scannedDirectories,
        limited
      });
    }
  } finally {
    finishRequest(requestId, controller);
  }
}

function searchIgnoredDirectories(): Set<string> {
  const names = new Set(DEFAULT_SEARCH_IGNORED_DIRECTORIES);
  for (const configKey of SEARCH_EXCLUDE_CONFIG_KEYS) {
    const excluded = vscode.workspace
      .getConfiguration()
      .get<Record<string, boolean | { when?: string }>>(configKey, {});
    for (const [pattern, value] of Object.entries(excluded)) {
      if (!value) continue;
      const directoryName = directoryNameFromExcludePattern(pattern);
      if (directoryName) {
        names.add(directoryName);
      }
    }
  }
  return names;
}

function updateDirectoryWatchers(panel: ExplorerWebviewHost, paths: string[]): void {
  const wanted = new Set(paths.map((item) => path.resolve(item)));

  for (const [watchedPath, watcher] of directoryWatchers) {
    if (!wanted.has(watchedPath)) {
      watcher.close();
      directoryWatchers.delete(watchedPath);
      const timer = watcherTimers.get(watchedPath);
      if (timer) clearTimeout(timer);
      watcherTimers.delete(watchedPath);
    }
  }

  for (const watchedPath of wanted) {
    if (directoryWatchers.has(watchedPath)) continue;
    try {
      const watcher = fs.watch(watchedPath, { persistent: false }, () => {
        const previous = watcherTimers.get(watchedPath);
        if (previous) clearTimeout(previous);
        watcherTimers.set(
          watchedPath,
          setTimeout(() => {
            watcherTimers.delete(watchedPath);
            if (panel.visible()) {
              panel.webview.postMessage({
                command: "directoryChanged",
                path: watchedPath,
                preserveFocus: true
              });
            }
          }, 300)
        );
      });
      watcher.on("error", () => {
        if (panel.visible()) {
          panel.webview.postMessage({
            command: "directoryChanged",
            path: watchedPath,
            preserveFocus: true
          });
        }
        watcher.close();
        directoryWatchers.delete(watchedPath);
      });
      directoryWatchers.set(watchedPath, watcher);
    } catch {
      // Some network and virtual file systems do not support native watchers.
    }
  }
}

function disposeDirectoryWatchers(): void {
  for (const watcher of directoryWatchers.values()) watcher.close();
  directoryWatchers.clear();
  for (const timer of watcherTimers.values()) clearTimeout(timer);
  watcherTimers.clear();
}

async function createItem(
  panel: ExplorerWebviewHost,
  directoryPath: string,
  isDirectory: boolean
): Promise<void> {
  const name = await vscode.window.showInputBox({
    title: isDirectory ? "New Folder" : "New File",
    prompt: isDirectory ? "Enter the folder name" : "Enter the file name",
    validateInput: validateFileName
  });
  if (!name) return;

  const target = path.join(directoryPath, name);
  if (isDirectory) {
    await fs.promises.mkdir(target);
  } else {
    await fs.promises.writeFile(target, "", { flag: "wx" });
  }
  await panel.webview.postMessage({
    command: "operationComplete",
    path: directoryPath,
    revealPath: target,
    preserveFocus: !isDirectory
  });
  if (!isDirectory) {
    await openCreatedFile(target);
  }
}

async function renameItem(panel: ExplorerWebviewHost, itemPath: string): Promise<void> {
  const oldName = path.basename(itemPath);
  const name = await vscode.window.showInputBox({
    title: "Rename",
    value: oldName,
    valueSelection: [0, oldName.length],
    validateInput: validateFileName
  });
  if (!name || name === oldName) return;

  const target = path.join(path.dirname(itemPath), name);
  await fs.promises.rename(itemPath, target);
  await panel.webview.postMessage({
    command: "operationComplete",
    path: path.dirname(itemPath),
    revealPath: target
  });
}

async function deleteItems(
  panel: ExplorerWebviewHost,
  paths: string[],
  permanent: boolean
): Promise<void> {
  if (!paths.length) return;
  const label = paths.length === 1 ? `"${path.basename(paths[0])}"` : `${paths.length} items`;
  const action = permanent ? "Delete Permanently" : "Move to Trash";
  const answer = await vscode.window.showWarningMessage(
    permanent
      ? `Permanently delete ${label}? This cannot be undone.`
      : `Move ${label} to the recycle bin/trash?`,
    { modal: true },
    action
  );
  if (answer !== action) return;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: permanent ? "Deleting items" : "Moving items to trash",
      cancellable: false
    },
    async (progress) => {
      const increment = paths.length > 0 ? 100 / paths.length : 100;
      for (const itemPath of paths) {
        progress.report({ message: path.basename(itemPath) });
        await vscode.workspace.fs.delete(vscode.Uri.file(itemPath), {
          recursive: true,
          useTrash: !permanent
        });
        progress.report({ increment });
      }
    }
  );

  await panel.webview.postMessage({
    command: "operationComplete",
    path: path.dirname(paths[0]),
    focusViewport: true
  });
}

async function pasteItems(
  panel: ExplorerWebviewHost,
  paths: string[],
  destination: string,
  cut: boolean
): Promise<void> {
  if (!paths.length) return;
  const targets = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: cut ? "Moving items" : "Copying items",
      cancellable: false
    },
    async (progress) => {
      const targets: string[] = [];
      const increment = paths.length > 0 ? 100 / paths.length : 100;

      for (const source of paths) {
        progress.report({ message: path.basename(source) });
        if (cut && path.resolve(path.dirname(source)) === path.resolve(destination)) {
          targets.push(source);
          progress.report({ increment });
          continue;
        }
        if (cut && isPathInsideOrEqualPath(destination, source)) {
          throw new Error(`Cannot move "${path.basename(source)}" into itself.`);
        }
        const target = await findAvailableDestination(destination, path.basename(source));
        if (cut) {
          try {
            await fs.promises.rename(source, target);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
            await fs.promises.cp(source, target, { recursive: true, errorOnExist: true });
            await fs.promises.rm(source, { recursive: true, force: true });
          }
        } else {
          await copyItem(source, target);
        }
        targets.push(target);
        progress.report({ increment });
      }

      return targets;
    }
  );

  const lastTarget = targets[targets.length - 1];
  await panel.webview.postMessage({
    command: "operationComplete",
    path: destination,
    revealPath: lastTarget,
    revealPaths: targets,
    clearClipboard: cut
  });
}

async function findAvailableDestination(directoryPath: string, name: string): Promise<string> {
  let candidate = path.join(directoryPath, name);
  let index = 1;
  while (await exists(candidate)) {
    candidate = path.join(directoryPath, nextCopyName(name, index));
    index += 1;
  }
  return candidate;
}

async function exists(itemPath: string): Promise<boolean> {
  try {
    await fs.promises.access(itemPath);
    return true;
  } catch {
    return false;
  }
}

async function validateDirectory(
  panel: ExplorerWebviewHost,
  requestId: string,
  requestedPath: string
): Promise<void> {
  const directoryPath = normalizeInputPath(requestedPath);
  try {
    const stat = await fs.promises.stat(directoryPath);
    await panel.webview.postMessage({
      command: "directoryValidation",
      requestId,
      valid: stat.isDirectory(),
      path: directoryPath
    });
  } catch (error) {
    await panel.webview.postMessage({
      command: "directoryValidation",
      requestId,
      valid: false,
      path: directoryPath,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

async function openFile(filePath: string): Promise<void> {
  await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(filePath), {
    preview: false,
    viewColumn: vscode.ViewColumn.Active
  });
}

async function openCreatedFile(filePath: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: false,
    viewColumn: vscode.ViewColumn.Active
  });
}

function normalizeInputPath(input: string): string {
  const trimmed = input.trim().replace(/^~(?=$|[\\/])/, os.homedir());
  if (!trimmed) {
    throw new Error("Path is empty.");
  }
  return path.resolve(trimmed);
}

function beginRequest(requestId: string): AbortController {
  cancelRequest(requestId);
  const controller = new AbortController();
  runningRequests.set(requestId, controller);
  return controller;
}

function finishRequest(requestId: string, controller: AbortController): void {
  if (runningRequests.get(requestId) === controller) {
    runningRequests.delete(requestId);
  }
}

function cancelRequest(requestId: string): void {
  runningRequests.get(requestId)?.abort();
  runningRequests.delete(requestId);
}

function asString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Expected a string value.");
  }
  return value;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("Expected a string array.");
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isListColumnPreferences(value: unknown): value is ListColumnPreferences {
  if (!value || typeof value !== "object") return false;
  const columns = value as Record<string, unknown>;
  return (
    typeof columns.modified === "boolean" &&
    typeof columns.size === "boolean"
  );
}

function createWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview.css"));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>Simple File Explorer</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

export function deactivate(): void {
  for (const controller of runningRequests.values()) {
    controller.abort();
  }
  runningRequests.clear();
  disposeDirectoryWatchers();
}
