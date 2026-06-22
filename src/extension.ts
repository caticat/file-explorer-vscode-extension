import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

interface DirectoryItem {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

interface SearchItem extends DirectoryItem {
  relativePath: string;
}

const DIRECTORY_BATCH_SIZE = 250;
const SEARCH_BATCH_SIZE = 100;
const SEARCH_RESULT_LIMIT = 5000;
const SEARCH_IGNORED_DIRECTORIES = new Set([".git", "node_modules"]);

let activePanel: vscode.WebviewPanel | undefined;
let activePanelReady = false;
let pendingNavigation:
  | { id: string; path: string; revealPath?: string }
  | undefined;
const runningRequests = new Map<string, AbortController>();
const directoryWatchers = new Map<string, fs.FSWatcher>();
const watcherTimers = new Map<string, NodeJS.Timeout>();

export function activate(context: vscode.ExtensionContext): void {
  const openExplorer = (): void => {
    if (activePanel) {
      activePanel.reveal(vscode.ViewColumn.Active);
      return;
    }
    createExplorerPanel(context);
  };

  const toggleExplorer = (): void => {
    if (activePanel?.active) {
      activePanel.dispose();
      return;
    }
    openExplorer();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("workspaceFileExplorer.open", openExplorer),
    vscode.commands.registerCommand("workspaceFileExplorer.toggle", toggleExplorer),
    vscode.commands.registerCommand(
      "workspaceFileExplorer.openFromExplorer",
      async (uri: vscode.Uri) => {
        if (!uri || uri.scheme !== "file") return;
        await openUriInExplorer(context, uri);
      }
    )
  );

  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    25
  );
  statusBarItem.text = "$(folder-opened)";
  statusBarItem.name = "Workspace File Explorer";
  statusBarItem.tooltip = "Toggle Workspace File Explorer";
  statusBarItem.command = "workspaceFileExplorer.toggle";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
}

function createExplorerPanel(context: vscode.ExtensionContext): void {
  activePanelReady = false;
  activePanel = vscode.window.createWebviewPanel(
    "workspaceFileExplorer",
    "File Explorer",
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: false,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")]
    }
  );

  const panel = activePanel;
  panel.iconPath = new vscode.ThemeIcon("files");
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

  panel.webview.onDidReceiveMessage(
    (message: unknown) => handleMessage(context, panel, message),
    undefined,
    context.subscriptions
  );
}

async function handleMessage(
  context: vscode.ExtensionContext,
  panel: vscode.WebviewPanel,
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
        activePanelReady = true;
        await sendPendingNavigation(panel);
        break;
      case "savePreferences":
        if (message.viewMode === "list" || message.viewMode === "grid") {
          await context.globalState.update("preferredViewMode", message.viewMode);
        }
        break;
      case "navigationComplete":
        if (pendingNavigation?.id === asString(message.requestId)) {
          pendingNavigation = undefined;
        }
        break;
      case "readDirectory":
        await streamDirectory(panel, asString(message.requestId), asString(message.path));
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
        panel.dispose();
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

  if (!activePanel) {
    createExplorerPanel(context);
    return;
  }

  activePanel.reveal(vscode.ViewColumn.Active);
  if (activePanelReady) {
    await sendPendingNavigation(activePanel);
  }
}

async function sendPendingNavigation(panel: vscode.WebviewPanel): Promise<void> {
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
  panel: vscode.WebviewPanel,
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

  await panel.webview.postMessage({
    command: "initialize",
    initialPath,
    workspaceRoots,
    pathSeparator: path.sep,
    platform: process.platform,
    preferredViewMode: context.globalState.get<"list" | "grid">(
      "preferredViewMode",
      "list"
    )
  });
}

async function streamDirectory(
  panel: vscode.WebviewPanel,
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

async function loadMetadata(panel: vscode.WebviewPanel, paths: string[]): Promise<void> {
  const uniquePaths = [...new Set(paths)].slice(0, 100);
  const results: Array<{ path: string; size?: number; modified?: number }> = [];
  const concurrency = 16;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < uniquePaths.length) {
      const index = cursor++;
      const itemPath = uniquePaths[index];
      try {
        const stat = await fs.promises.stat(itemPath);
        results.push({
          path: itemPath,
          size: stat.size,
          modified: stat.mtimeMs
        });
      } catch {
        results.push({ path: itemPath });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  await panel.webview.postMessage({ command: "metadata", items: results });
}

async function searchRecursively(
  panel: vscode.WebviewPanel,
  requestId: string,
  requestedPath: string,
  rawQuery: string,
  showHidden: boolean
): Promise<void> {
  const rootPath = normalizeInputPath(requestedPath);
  const query = rawQuery.trim().toLocaleLowerCase();
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
            !SEARCH_IGNORED_DIRECTORIES.has(entry.name)
          ) {
            pendingDirectories.push(itemPath);
          }

          if (entry.name.toLocaleLowerCase().includes(query)) {
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

function updateDirectoryWatchers(panel: vscode.WebviewPanel, paths: string[]): void {
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
            panel.webview.postMessage({ command: "directoryChanged", path: watchedPath });
          }, 300)
        );
      });
      watcher.on("error", () => {
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
  panel: vscode.WebviewPanel,
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
  await panel.webview.postMessage({ command: "operationComplete", path: directoryPath, revealPath: target });
}

async function renameItem(panel: vscode.WebviewPanel, itemPath: string): Promise<void> {
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
  panel: vscode.WebviewPanel,
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

  for (const itemPath of paths) {
    await vscode.workspace.fs.delete(vscode.Uri.file(itemPath), {
      recursive: true,
      useTrash: !permanent
    });
  }
  await panel.webview.postMessage({ command: "operationComplete", path: path.dirname(paths[0]) });
}

async function pasteItems(
  panel: vscode.WebviewPanel,
  paths: string[],
  destination: string,
  cut: boolean
): Promise<void> {
  if (!paths.length) return;
  let lastTarget: string | undefined;

  for (const source of paths) {
    if (cut && path.resolve(path.dirname(source)) === path.resolve(destination)) {
      lastTarget = source;
      continue;
    }
    const relativeDestination = path.relative(path.resolve(source), path.resolve(destination));
    if (
      relativeDestination &&
      !relativeDestination.startsWith("..") &&
      !path.isAbsolute(relativeDestination)
    ) {
      throw new Error(`Cannot copy "${path.basename(source)}" into itself.`);
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
      await fs.promises.cp(source, target, { recursive: true, errorOnExist: true });
    }
    lastTarget = target;
  }

  await panel.webview.postMessage({
    command: "operationComplete",
    path: destination,
    revealPath: lastTarget,
    clearClipboard: cut
  });
}

async function findAvailableDestination(directoryPath: string, name: string): Promise<string> {
  const extension = path.extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  let candidate = path.join(directoryPath, name);
  let index = 1;
  while (await exists(candidate)) {
    candidate = path.join(directoryPath, `${stem} copy${index === 1 ? "" : ` ${index}`}${extension}`);
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

function validateFileName(value: string): string | undefined {
  if (!value.trim()) return "Name is required.";
  if (value === "." || value === "..") return "This name is not allowed.";
  if (value.includes("/") || value.includes("\\")) return "Name cannot contain path separators.";
  return undefined;
}

async function validateDirectory(
  panel: vscode.WebviewPanel,
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
        content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>File Explorer</title>
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
