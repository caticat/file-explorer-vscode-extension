import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  copyItem,
  isPathInsideOrEqualPath,
  nextCopyName,
  validateFileName
} from "../src/fileOperations.ts";
import {
  createNameMatcher as createExtensionNameMatcher,
  directoryNameFromExcludePattern
} from "../src/extensionSearch.ts";
import { parseIconThemeManifest } from "../src/extensionIconTheme.ts";
import { formatSize } from "../src/webviewFormat.ts";
import {
  copySelectionStatus,
  uniqueWatcherPaths
} from "../src/webviewCommandState.ts";
import {
  emptyStateMessage,
  filterItems,
  nextSortState,
  normalizeSortState,
  sortItemsInPlace
} from "../src/webviewItems.ts";
import { createNameMatcher } from "../src/webviewMatcher.ts";
import {
  basenameForPlatform,
  dirnameForPlatform,
  isPathInsideOrEqualForPlatform,
  normalizeForComparisonForPlatform,
  splitPathForPlatform
} from "../src/webviewPath.ts";
import {
  paneColumnCount,
  paneGridLayout,
  paneRowSpan
} from "../src/webviewPane.ts";
import {
  dragSelectionState,
  emptySelectionState,
  isRepeatedItemClick,
  keyboardActivationSelectionState,
  keyboardNavigationState,
  normalizedRect,
  rectsIntersect,
  selectAllSelectionState,
  selectionBoxLayout,
  shouldSuppressDragClickState,
  uniquePathsForPlatform,
  updateSelectionState
} from "../src/webviewSelection.ts";
import {
  addFavoriteLocation,
  addRecentLocation,
  FAVORITE_LOCATIONS_SAVE_LIMIT,
  initialActiveTabIndex,
  initialTabPaths,
  isFavoriteLocation,
  isWorkspaceSession,
  normalizeFavoriteLocations,
  normalizeIconTheme,
  normalizeListColumns,
  normalizeRecentLocations,
  RECENT_LOCATIONS_DISPLAY_LIMIT,
  removeFavoriteLocation,
  restoredLayoutMode,
  visibleRecentLocations
} from "../src/webviewState.ts";
import {
  canToggleTreeNodeState,
  treeAncestorPathsForRevealTarget,
  treeNodeKey
} from "../src/webviewTree.ts";
import {
  cleanSelectionState,
  workspacePathForCurrentPath
} from "../src/webviewWorkspace.ts";
import {
  isVirtualDrivesPath,
  isWindowsDriveRoot,
  VIRTUAL_DRIVES_PATH
} from "../src/webviewVirtualDrives.ts";
import {
  metadataPathsToRequest,
  revealScrollTop,
  virtualListLayout,
  virtualRenderSignature
} from "../src/webviewVirtualList.ts";

test("repeated item clicks survive item re-rendering", () => {
  const previous = { tabId: "tab-1", path: "C:\\Work\\file.txt", time: 1000 };

  assert.equal(
    isRepeatedItemClick({
      previous,
      current: { tabId: "tab-1", path: "c:\\work\\file.txt", time: 1250 },
      platform: "win32"
    }),
    true
  );
  assert.equal(
    isRepeatedItemClick({
      previous,
      current: { tabId: "tab-2", path: "C:\\Work\\file.txt", time: 1250 },
      platform: "win32"
    }),
    false
  );
  assert.equal(
    isRepeatedItemClick({
      previous,
      current: { tabId: "tab-1", path: "C:\\Work\\file.txt", time: 1500 },
      platform: "win32"
    }),
    false
  );
});

test("createNameMatcher matches plain text case-insensitively", () => {
  const matcher = createNameMatcher("read");

  assert.equal(matcher("README.md"), true);
  assert.equal(matcher("package.json"), false);
});

test("createNameMatcher supports wildcard patterns", () => {
  const matcher = createNameMatcher("*.ts");

  assert.equal(matcher("webview.ts"), true);
  assert.equal(matcher("webview.tsx"), false);
});

test("extension search matcher mirrors plain and wildcard filename matching", () => {
  const plain = createExtensionNameMatcher("read");
  const wildcard = createExtensionNameMatcher("*.ts");

  assert.equal(plain("README.md"), true);
  assert.equal(plain("package.json"), false);
  assert.equal(wildcard("webview.ts"), true);
  assert.equal(wildcard("webview.tsx"), false);
});

test("directoryNameFromExcludePattern extracts safe directory names", () => {
  assert.equal(directoryNameFromExcludePattern("node_modules"), "node_modules");
  assert.equal(directoryNameFromExcludePattern("**/dist/"), "dist");
  assert.equal(directoryNameFromExcludePattern("build\\cache"), "cache");
  assert.equal(directoryNameFromExcludePattern("**/*.tmp"), undefined);
  assert.equal(directoryNameFromExcludePattern("{dist,build}"), undefined);
  assert.equal(directoryNameFromExcludePattern(""), undefined);
});

test("parseIconThemeManifest resolves icon definitions and lowercases lookup keys", () => {
  const manifestDir = path.resolve("theme-root");

  assert.deepEqual(
    parseIconThemeManifest(
      {
        iconDefinitions: {
          fileDef: { iconPath: "./icons/file.svg" },
          folderDef: { iconPath: "./icons/folder.svg" },
          tsDef: { iconPath: "./icons/ts.svg" }
        },
        file: "fileDef",
        folder: "folderDef",
        fileExtensions: { TS: "tsDef", bad: "missingDef" },
        fileNames: { "README.md": "fileDef" },
        folderNames: { SRC: "folderDef" }
      },
      manifestDir
    ),
    {
      file: path.resolve(manifestDir, "./icons/file.svg"),
      folder: path.resolve(manifestDir, "./icons/folder.svg"),
      fileExtensions: { ts: path.resolve(manifestDir, "./icons/ts.svg") },
      fileNames: { "readme.md": path.resolve(manifestDir, "./icons/file.svg") },
      folderNames: { src: path.resolve(manifestDir, "./icons/folder.svg") }
    }
  );
});

test("formatSize formats bytes and larger units", () => {
  assert.equal(formatSize(undefined), "");
  assert.equal(formatSize(512), "512 B");
  assert.equal(formatSize(1536), "1.50 KB");
  assert.equal(formatSize(10 * 1024 * 1024), "10.0 MB");
});

test("webview path helpers handle Windows paths", () => {
  assert.equal(dirnameForPlatform("C:\\Users\\pan\\file.txt", "win32"), "C:\\Users\\pan");
  assert.equal(dirnameForPlatform("C:\\", "win32"), "C:\\");
  assert.equal(basenameForPlatform("C:\\Users\\pan\\file.txt"), "file.txt");
  assert.equal(normalizeForComparisonForPlatform("C:\\Users\\PAN\\", "win32"), "c:\\users\\pan");
  assert.equal(
    isPathInsideOrEqualForPlatform("C:\\Users\\pan\\project", "C:\\Users\\pan", "win32"),
    true
  );
  assert.deepEqual(splitPathForPlatform("C:\\Users\\pan", "win32"), [
    { label: "C:", path: "C:\\" },
    { label: "Users", path: "C:\\Users" },
    { label: "pan", path: "C:\\Users\\pan" }
  ]);
});

test("virtual drive helpers identify only the Windows drives level and drive roots", () => {
  assert.equal(isVirtualDrivesPath(VIRTUAL_DRIVES_PATH), true);
  assert.equal(isVirtualDrivesPath("C:\\"), false);
  assert.equal(isWindowsDriveRoot("C:\\"), true);
  assert.equal(isWindowsDriveRoot("c:/"), true);
  assert.equal(isWindowsDriveRoot("C:\\Users"), false);
  assert.equal(isWindowsDriveRoot("/"), false);
});

test("webview path helpers handle POSIX paths", () => {
  assert.equal(dirnameForPlatform("/home/pan/file.txt", "linux"), "/home/pan");
  assert.equal(dirnameForPlatform("/", "linux"), "/");
  assert.equal(basenameForPlatform("/home/pan/file.txt"), "file.txt");
  assert.equal(normalizeForComparisonForPlatform("/home/pan/", "linux"), "/home/pan");
  assert.equal(isPathInsideOrEqualForPlatform("/home/pan/project", "/home/pan", "linux"), true);
  assert.deepEqual(splitPathForPlatform("/home/pan", "linux"), [
    { label: "/", path: "/" },
    { label: "home", path: "/home" },
    { label: "pan", path: "/home/pan" }
  ]);
});

test("validateFileName rejects Windows-only invalid names", () => {
  assert.equal(validateFileName("notes.txt", "win32"), undefined);
  assert.equal(validateFileName("bad:name.txt", "win32"), "Name contains characters that are not allowed on Windows.");
  assert.equal(validateFileName("report.", "win32"), "Name cannot end with a space or period on Windows.");
  assert.equal(validateFileName("CON.txt", "win32"), "This name is reserved on Windows.");
});

test("copy naming follows the existing copy suffix style", () => {
  assert.equal(nextCopyName("folder", 1), "folder copy");
  assert.equal(nextCopyName("folder", 2), "folder copy 2");
  assert.equal(nextCopyName("file.txt", 1), "file copy.txt");
});

test("path containment treats equal paths and descendants as inside", () => {
  const root = path.resolve("Work", "Project");
  const child = path.join(root, "child");
  const sibling = path.resolve("Work", "Project2");

  assert.equal(isPathInsideOrEqualPath(root, root), true);
  assert.equal(isPathInsideOrEqualPath(child, root), true);
  assert.equal(isPathInsideOrEqualPath(sibling, root), false);
});

test("copyItem can copy a directory into itself using the generated target folder", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "file-explorer-copy-"));
  try {
    const source = path.join(root, "source");
    const target = path.join(source, "source copy");
    await fs.mkdir(path.join(source, "nested"), { recursive: true });
    await fs.writeFile(path.join(source, "child.txt"), "child");
    await fs.writeFile(path.join(source, "nested", "deep.txt"), "deep");

    await copyItem(source, target);

    assert.equal(await fs.readFile(path.join(target, "child.txt"), "utf8"), "child");
    assert.equal(await fs.readFile(path.join(target, "nested", "deep.txt"), "utf8"), "deep");
    await assert.rejects(
      fs.stat(path.join(target, "source copy")),
      /ENOENT/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("isWorkspaceSession accepts only restorable session payloads", () => {
  assert.equal(
    isWorkspaceSession({
      version: 1,
      tabs: [{ path: "/workspace" }],
      activeTabIndex: 0,
      layoutMode: "panes"
    }),
    true
  );
  assert.equal(isWorkspaceSession({ version: 1, tabs: [], activeTabIndex: 0 }), false);
  assert.equal(isWorkspaceSession({ version: 1, tabs: [{ path: "/workspace" }], activeTabIndex: "0" }), false);
  assert.equal(isWorkspaceSession({ version: 1, tabs: [{ path: "/workspace" }], activeTabIndex: 0, layoutMode: "grid" }), false);
});

test("normalizeListColumns defaults missing values to visible", () => {
  assert.deepEqual(normalizeListColumns(undefined), { modified: true, size: true });
  assert.deepEqual(normalizeListColumns({ modified: false }), { modified: false, size: true });
  assert.deepEqual(normalizeListColumns({ size: false }), { modified: true, size: false });
});

test("normalizeIconTheme keeps string values and lowercases lookup keys", () => {
  assert.deepEqual(
    normalizeIconTheme({
      file: "/icons/file.svg",
      folder: 42,
      fileExtensions: { TS: "/icons/ts.svg", bad: false },
      fileNames: { "README.md": "/icons/readme.svg" },
      folderNames: { SRC: "/icons/src.svg" }
    }),
    {
      file: "/icons/file.svg",
      folder: undefined,
      fileExtensions: { ts: "/icons/ts.svg" },
      fileNames: { "readme.md": "/icons/readme.svg" },
      folderNames: { src: "/icons/src.svg" }
    }
  );
});

test("initialTabPaths restores saved tabs before workspace defaults", () => {
  const session = {
    version: 1,
    tabs: [{ path: "/saved/a" }, { path: "/saved/b" }],
    activeTabIndex: 1
  };

  assert.deepEqual(
    initialTabPaths(session, [{ path: "/root/a" }, { path: "/root/b" }], "/initial"),
    ["/saved/a", "/saved/b"]
  );
  assert.deepEqual(
    initialTabPaths(undefined, [{ path: "/root/a" }, { path: "/root/b" }], "/initial"),
    ["/root/a", "/root/b"]
  );
  assert.deepEqual(
    initialTabPaths(undefined, [{ path: "/root/a" }], "/initial"),
    ["/initial"]
  );
});

test("initialActiveTabIndex clamps restored index", () => {
  const session = {
    version: 1,
    tabs: [{ path: "/a" }, { path: "/b" }],
    activeTabIndex: 8
  };

  assert.equal(initialActiveTabIndex(undefined, 2), 0);
  assert.equal(initialActiveTabIndex(session, 2), 1);
  assert.equal(initialActiveTabIndex({ ...session, activeTabIndex: -2 }, 2), 0);
  assert.equal(initialActiveTabIndex(session, 0), 0);
});

test("restoredLayoutMode only restores panes for editor views with multiple tabs", () => {
  const session = {
    version: 1,
    tabs: [{ path: "/a" }, { path: "/b" }],
    activeTabIndex: 0,
    layoutMode: "panes"
  };

  assert.equal(restoredLayoutMode("editor", 2, session), "panes");
  assert.equal(restoredLayoutMode("editor", 1, session), "tabs");
  assert.equal(restoredLayoutMode("sidebar", 2, session), "tabs");
  assert.equal(restoredLayoutMode("editor", 2, undefined), "tabs");
});

test("recent locations normalize, dedupe, and cap saved entries", () => {
  const normalize = (value) => value.toLowerCase();

  assert.deepEqual(
    normalizeRecentLocations(["/a", "", 42, "/b", "/A", "/c"], 3, normalize),
    ["/a", "/b", "/c"]
  );
});

test("addRecentLocation moves existing locations to the top", () => {
  const normalize = (value) => value.toLowerCase();

  assert.deepEqual(
    addRecentLocation(["C:\\Work\\src", "C:\\Work\\test"], "C:\\WORK\\SRC", 3, normalize),
    ["C:\\WORK\\SRC", "C:\\Work\\test"]
  );
  assert.deepEqual(
    addRecentLocation(["/a", "/b", "/c"], "/d", 3),
    ["/d", "/a", "/b"]
  );
});

test("visibleRecentLocations hides current path and limits display count", () => {
  const locations = ["/current", "/a", "/b", "/c", "/d", "/e", "/f"];

  assert.deepEqual(
    visibleRecentLocations(locations, "/current", RECENT_LOCATIONS_DISPLAY_LIMIT),
    ["/a", "/b", "/c", "/d", "/e"]
  );
});

test("favorite locations normalize, add, remove, and match by platform key", () => {
  const normalize = (value) => value.toLowerCase();
  const normalized = normalizeFavoriteLocations(["C:\\A", "C:\\B", "c:\\a"], FAVORITE_LOCATIONS_SAVE_LIMIT, normalize);

  assert.deepEqual(normalized, ["C:\\A", "C:\\B"]);
  assert.deepEqual(
    addFavoriteLocation(normalized, "C:\\C", FAVORITE_LOCATIONS_SAVE_LIMIT, normalize),
    ["C:\\C", "C:\\A", "C:\\B"]
  );
  assert.deepEqual(removeFavoriteLocation(normalized, "c:\\a", normalize), ["C:\\B"]);
  assert.equal(isFavoriteLocation(normalized, "c:\\b", normalize), true);
  assert.equal(isFavoriteLocation(normalized, "c:\\c", normalize), false);
});

test("treeNodeKey normalizes paths using the active platform", () => {
  assert.equal(treeNodeKey("C:\\Work\\Project\\", "win32"), "c:\\work\\project");
  assert.equal(treeNodeKey("/Work/Project/", "linux"), "/Work/Project");
});

test("treeAncestorPathsForRevealTarget returns ancestors from the longest matching root", () => {
  assert.deepEqual(
    treeAncestorPathsForRevealTarget(
      "C:\\Work\\Project\\src\\feature",
      ["C:\\Work", "C:\\Work\\Project"],
      "win32"
    ),
    ["C:\\Work\\Project", "C:\\Work\\Project\\src"]
  );
  assert.deepEqual(
    treeAncestorPathsForRevealTarget("/repo/src/feature", ["/repo"], "linux"),
    ["/repo", "/repo/src"]
  );
  assert.deepEqual(treeAncestorPathsForRevealTarget("/repo", ["/repo"], "linux"), []);
  assert.deepEqual(treeAncestorPathsForRevealTarget("/other", ["/repo"], "linux"), []);
});

test("canToggleTreeNodeState follows loaded children and unloaded hints", () => {
  assert.equal(canToggleTreeNodeState({ loaded: true, children: [{}] }), true);
  assert.equal(canToggleTreeNodeState({ loaded: true, children: [] }), false);
  assert.equal(canToggleTreeNodeState({ loaded: false, children: [], hasChildren: false }), false);
  assert.equal(canToggleTreeNodeState({ loaded: false, children: [] }), true);
});

test("filterItems applies hidden-file and search filters", () => {
  const items = [
    { name: "README.md" },
    { name: ".env" },
    { name: "package.json" }
  ];

  assert.deepEqual(
    filterItems(items, { showHidden: false, searchQuery: "" }).map((item) => item.name),
    ["README.md", "package.json"]
  );
  assert.deepEqual(
    filterItems(items, { showHidden: true, searchQuery: "*.md" }).map((item) => item.name),
    ["README.md"]
  );
});

test("emptyStateMessage explains hidden-file and search empty states", () => {
  const hiddenOnly = [{ name: ".env" }];
  const mixed = [{ name: "README.md" }, { name: ".secret.txt" }];

  assert.equal(
    emptyStateMessage([], { showHidden: false, searchQuery: "", recursiveSearch: false }),
    "This folder is empty."
  );
  assert.equal(
    emptyStateMessage(hiddenOnly, { showHidden: false, searchQuery: "", recursiveSearch: false }),
    "This folder only contains hidden files."
  );
  assert.equal(
    emptyStateMessage(mixed, { showHidden: false, searchQuery: "secret", recursiveSearch: false }),
    "Only matching hidden files are currently hidden."
  );
  assert.equal(
    emptyStateMessage(mixed, { showHidden: false, searchQuery: "missing", recursiveSearch: false }),
    "No matching visible files."
  );
  assert.equal(
    emptyStateMessage(mixed, { showHidden: false, searchQuery: "secret", recursiveSearch: true }),
    "No matching visible files. Hidden files are not included."
  );
});

test("sortItemsInPlace keeps directories first and sorts names numerically", () => {
  const items = [
    { name: "file10.txt", isDirectory: false },
    { name: "src", isDirectory: true },
    { name: "file2.txt", isDirectory: false }
  ];

  sortItemsInPlace(items, { sortKey: "name", sortDirection: "asc" }, "win32");

  assert.deepEqual(items.map((item) => item.name), ["src", "file2.txt", "file10.txt"]);
});

test("sortItemsInPlace sorts metadata descending and falls back to name", () => {
  const items = [
    { name: "b.txt", isDirectory: false, modified: 5 },
    { name: "a.txt", isDirectory: false, modified: 5 },
    { name: "c.txt", isDirectory: false, modified: 8 }
  ];

  sortItemsInPlace(items, { sortKey: "modified", sortDirection: "desc" }, "linux");

  assert.deepEqual(items.map((item) => item.name), ["c.txt", "b.txt", "a.txt"]);
});

test("nextSortState toggles existing key and defaults new keys", () => {
  assert.deepEqual(
    nextSortState({ sortKey: "name", sortDirection: "asc" }, "name"),
    { sortKey: "name", sortDirection: "desc" }
  );
  assert.deepEqual(
    nextSortState({ sortKey: "name", sortDirection: "asc" }, "modified"),
    { sortKey: "modified", sortDirection: "desc" }
  );
  assert.deepEqual(
    nextSortState({ sortKey: "modified", sortDirection: "desc" }, "name"),
    { sortKey: "name", sortDirection: "asc" }
  );
});

test("normalizeSortState accepts only supported sort preferences", () => {
  assert.deepEqual(normalizeSortState(undefined), { sortKey: "name", sortDirection: "asc" });
  assert.deepEqual(normalizeSortState({ sortKey: "modified", sortDirection: "desc" }), {
    sortKey: "modified",
    sortDirection: "desc"
  });
  assert.deepEqual(normalizeSortState({ sortKey: "bad", sortDirection: "sideways" }), {
    sortKey: "name",
    sortDirection: "asc"
  });
});

test("workspacePathForCurrentPath picks the longest containing root", () => {
  const roots = [{ path: "C:\\Work" }, { path: "C:\\Work\\Project" }];

  assert.equal(
    workspacePathForCurrentPath("C:\\Work\\Project\\src", roots, "C:\\Fallback", "win32"),
    "C:\\Work\\Project"
  );
  assert.equal(
    workspacePathForCurrentPath("C:\\Other", roots, "C:\\Fallback", "win32"),
    "C:\\Work"
  );
  assert.equal(
    workspacePathForCurrentPath(undefined, [], "/home/pan", "linux"),
    "/home/pan"
  );
});

test("cleanSelectionState removes deleted selected paths and repairs anchors", () => {
  assert.deepEqual(
    cleanSelectionState(
      {
        selectedPath: "C:\\Work\\B.txt",
        selectedPaths: ["C:\\Work\\A.txt", "C:\\Work\\B.txt"],
        selectionAnchorPath: "C:\\Work\\B.txt"
      },
      ["C:\\Work\\A.txt"],
      "win32"
    ),
    {
      selectedPath: "C:\\Work\\A.txt",
      selectedPaths: ["C:\\Work\\A.txt"],
      selectionAnchorPath: "C:\\Work\\A.txt"
    }
  );
});

test("paneColumnCount uses compact fixed columns for small pane counts", () => {
  assert.equal(paneColumnCount(1, 1200, 800), 1);
  assert.equal(paneColumnCount(4, 1200, 800), 2);
  assert.equal(paneColumnCount(6, 1200, 800), 3);
});

test("paneGridLayout clamps larger pane grids by viewport ratio", () => {
  assert.deepEqual(paneGridLayout(7, 1200, 800), { columns: 4, rows: 2 });
  assert.deepEqual(paneGridLayout(12, 600, 1200), { columns: 3, rows: 4 });
});

test("paneRowSpan assigns extra grid cells to leading panes", () => {
  assert.equal(paneRowSpan(0, 3, 2, 2), "span 2");
  assert.equal(paneRowSpan(1, 3, 2, 2), "");
  assert.equal(paneRowSpan(0, 4, 2, 2), "");
});

test("virtualListLayout computes list ranges with overscan", () => {
  assert.deepEqual(
    virtualListLayout({
      itemCount: 100,
      viewMode: "list",
      viewportHeight: 90,
      viewportWidth: 500,
      scrollTop: 60,
      listRowHeight: 30,
      gridItemWidth: 100,
      gridRowHeight: 100,
      overscan: 1
    }),
    {
      startIndex: 1,
      endIndex: 6,
      totalHeight: 3000,
      top: 30,
      columns: 1,
      rowHeight: 30
    }
  );
});

test("virtualListLayout computes grid ranges and columns", () => {
  assert.deepEqual(
    virtualListLayout({
      itemCount: 20,
      viewMode: "grid",
      viewportHeight: 200,
      viewportWidth: 250,
      scrollTop: 100,
      listRowHeight: 30,
      gridItemWidth: 100,
      gridRowHeight: 80,
      overscan: 1
    }),
    {
      startIndex: 0,
      endIndex: 10,
      totalHeight: 800,
      top: 0,
      columns: 2,
      rowHeight: 80
    }
  );
});

test("virtualRenderSignature includes selection, viewport, and visible metadata", () => {
  assert.equal(
    virtualRenderSignature({
      tabId: "tab-1",
      viewMode: "list",
      selectedPaths: ["C:\\Work\\A.txt"],
      visibleItems: [{ path: "C:\\Work\\A.txt", modified: 10, size: 20 }],
      startIndex: 1,
      endIndex: 2,
      top: 30,
      totalHeight: 300,
      columns: 1,
      viewportWidth: 500,
      viewportHeight: 200,
      normalizePath: (value) => value.toLocaleLowerCase()
    }),
    "tab-1;list;c:\\work\\a.txt;1;2;30;300;1;500;200;C:\\Work\\A.txt:10:20"
  );
});

test("metadataPathsToRequest returns only visible paths not already requested", () => {
  assert.deepEqual(
    metadataPathsToRequest(
      [{ path: "/repo/a.txt" }, { path: "/repo/b.txt" }],
      new Set(["/repo/a.txt"])
    ),
    ["/repo/b.txt"]
  );
});

test("updateSelectionState selects, toggles, and range-selects visible items", () => {
  const visibleItems = [{ path: "/repo/a" }, { path: "/repo/b" }, { path: "/repo/c" }];

  assert.deepEqual(
    updateSelectionState({
      state: { selectedPaths: [] },
      itemPath: "/repo/b",
      visibleItems,
      toggle: false,
      range: false,
      platform: "linux"
    }),
    {
      selectedPath: "/repo/b",
      selectedPaths: ["/repo/b"],
      selectionAnchorPath: "/repo/b"
    }
  );

  assert.deepEqual(
    updateSelectionState({
      state: { selectedPath: "/repo/b", selectedPaths: ["/repo/b"], selectionAnchorPath: "/repo/b" },
      itemPath: "/repo/c",
      visibleItems,
      toggle: true,
      range: false,
      platform: "linux"
    }),
    {
      selectedPath: "/repo/c",
      selectedPaths: ["/repo/b", "/repo/c"],
      selectionAnchorPath: "/repo/c"
    }
  );

  assert.deepEqual(
    updateSelectionState({
      state: { selectedPath: "/repo/b", selectedPaths: ["/repo/b"], selectionAnchorPath: "/repo/b" },
      itemPath: "/repo/a",
      visibleItems,
      toggle: false,
      range: true,
      platform: "linux"
    }),
    {
      selectedPath: "/repo/a",
      selectedPaths: ["/repo/a", "/repo/b"],
      selectionAnchorPath: "/repo/b"
    }
  );
});

test("keyboardNavigationState single-selects during plain list navigation", () => {
  const visibleItems = [{ path: "/repo/a" }, { path: "/repo/b" }, { path: "/repo/c" }];

  assert.deepEqual(
    keyboardNavigationState({
      state: { selectedPath: "/repo/b", selectedPaths: ["/repo/a"] },
      visibleItems,
      viewMode: "list",
      columns: 1,
      key: "ArrowDown",
      preserveSelection: false,
      rangeSelection: false,
      platform: "linux"
    }),
    {
      selectedPath: "/repo/c",
      selectedPaths: ["/repo/c"],
      selectionAnchorPath: "/repo/c"
    }
  );

  assert.equal(
    keyboardNavigationState({
      state: { selectedPath: "/repo/b", selectedPaths: ["/repo/a"] },
      visibleItems,
      viewMode: "list",
      columns: 1,
      key: "ArrowRight",
      preserveSelection: false,
      rangeSelection: false,
      platform: "linux"
    }),
    undefined
  );
});

test("keyboardNavigationState supports Ctrl focus movement and Shift range selection", () => {
  const visibleItems = [{ path: "/repo/a" }, { path: "/repo/b" }, { path: "/repo/c" }];

  assert.deepEqual(
    keyboardNavigationState({
      state: { selectedPath: "/repo/b", selectedPaths: ["/repo/a"], selectionAnchorPath: "/repo/a" },
      visibleItems,
      viewMode: "list",
      columns: 1,
      key: "ArrowDown",
      preserveSelection: true,
      rangeSelection: false,
      platform: "linux"
    }),
    {
      selectedPath: "/repo/c",
      selectedPaths: ["/repo/a"],
      selectionAnchorPath: "/repo/a"
    }
  );

  assert.deepEqual(
    keyboardNavigationState({
      state: { selectedPath: "/repo/a", selectedPaths: ["/repo/a"], selectionAnchorPath: "/repo/a" },
      visibleItems,
      viewMode: "list",
      columns: 1,
      key: "ArrowDown",
      preserveSelection: false,
      rangeSelection: true,
      platform: "linux"
    }),
    {
      selectedPath: "/repo/b",
      selectedPaths: ["/repo/a", "/repo/b"],
      selectionAnchorPath: "/repo/a"
    }
  );
});

test("keyboardNavigationState moves by columns in grid mode", () => {
  const visibleItems = ["/a", "/b", "/c", "/d", "/e"].map((itemPath) => ({ path: itemPath }));

  assert.deepEqual(
    keyboardNavigationState({
      state: { selectedPath: "/b", selectedPaths: [] },
      visibleItems,
      viewMode: "grid",
      columns: 2,
      key: "ArrowDown",
      preserveSelection: false,
      rangeSelection: false,
      platform: "linux"
    })?.selectedPath,
    "/d"
  );
  assert.deepEqual(
    keyboardNavigationState({
      state: { selectedPath: "/d", selectedPaths: [] },
      visibleItems,
      viewMode: "grid",
      columns: 2,
      key: "ArrowUp",
      preserveSelection: false,
      rangeSelection: false,
      platform: "linux"
    })?.selectedPath,
    "/b"
  );
  assert.deepEqual(
    keyboardNavigationState({
      state: { selectedPath: "/d", selectedPaths: [] },
      visibleItems,
      viewMode: "grid",
      columns: 2,
      key: "ArrowRight",
      preserveSelection: false,
      rangeSelection: false,
      platform: "linux"
    })?.selectedPath,
    "/e"
  );
});

test("keyboardActivationSelectionState selects plainly and toggles with Ctrl", () => {
  const visibleItems = [{ path: "/repo/a" }, { path: "/repo/b" }];

  assert.deepEqual(
    keyboardActivationSelectionState({
      state: { selectedPath: "/repo/b", selectedPaths: ["/repo/a"] },
      visibleItems,
      toggle: false,
      range: false,
      platform: "linux"
    }),
    {
      selectedPath: "/repo/b",
      selectedPaths: ["/repo/b"],
      selectionAnchorPath: "/repo/b"
    }
  );
  assert.deepEqual(
    keyboardActivationSelectionState({
      state: { selectedPath: "/repo/b", selectedPaths: ["/repo/a"] },
      visibleItems,
      toggle: true,
      range: false,
      platform: "linux"
    }),
    {
      selectedPath: "/repo/b",
      selectedPaths: ["/repo/a", "/repo/b"],
      selectionAnchorPath: "/repo/b"
    }
  );
  assert.deepEqual(
    keyboardActivationSelectionState({
      state: { selectedPath: "/repo/a", selectedPaths: ["/repo/a", "/repo/b"] },
      visibleItems,
      toggle: true,
      range: false,
      platform: "linux"
    }),
    {
      selectedPath: "/repo/a",
      selectedPaths: ["/repo/b"],
      selectionAnchorPath: "/repo/a"
    }
  );
});

test("selection helpers build all, empty, and drag states", () => {
  assert.deepEqual(selectAllSelectionState(["/a", "/b"]), {
    selectedPath: "/b",
    selectedPaths: ["/a", "/b"],
    selectionAnchorPath: "/a"
  });
  assert.deepEqual(emptySelectionState(), {
    selectedPath: undefined,
    selectedPaths: [],
    selectionAnchorPath: undefined
  });
  assert.deepEqual(
    dragSelectionState({
      hitPaths: ["/b", "/c"],
      additive: true,
      baseSelection: ["/a", "/b"],
      platform: "linux"
    }),
    {
      selectedPath: "/c",
      selectedPaths: ["/a", "/b", "/c"],
      selectionAnchorPath: "/a"
    }
  );
  assert.equal(
    dragSelectionState({ hitPaths: [], additive: false, baseSelection: ["/a"], platform: "linux" }),
    undefined
  );
});

test("uniquePathsForPlatform deduplicates case-insensitively on Windows", () => {
  assert.deepEqual(
    uniquePathsForPlatform(["C:\\Repo\\A.txt", "c:\\repo\\a.txt", "C:\\Repo\\B.txt"], "win32"),
    ["C:\\Repo\\A.txt", "C:\\Repo\\B.txt"]
  );
  assert.deepEqual(
    uniquePathsForPlatform(["/Repo/A.txt", "/repo/a.txt"], "linux"),
    ["/Repo/A.txt", "/repo/a.txt"]
  );
});

test("selection geometry normalizes rectangles and detects intersections", () => {
  assert.deepEqual(normalizedRect(20, 30, 5, 10), {
    left: 5,
    top: 10,
    right: 20,
    bottom: 30
  });
  assert.equal(
    rectsIntersect(
      { left: 0, top: 0, right: 10, bottom: 10 },
      { left: 10, top: 10, right: 20, bottom: 20 }
    ),
    true
  );
  assert.equal(
    rectsIntersect(
      { left: 0, top: 0, right: 9, bottom: 9 },
      { left: 10, top: 10, right: 20, bottom: 20 }
    ),
    false
  );
});

test("selectionBoxLayout clamps drag box to viewport and includes scroll offset", () => {
  assert.deepEqual(
    selectionBoxLayout({
      startX: 80,
      startY: 90,
      currentX: 10,
      currentY: 20,
      viewport: { left: 20, top: 30, width: 100, height: 80 },
      scrollTop: 40
    }),
    {
      left: 0,
      top: 40,
      width: 60,
      height: 60
    }
  );
});

test("shouldSuppressDragClickState respects expiry and pointer tolerance", () => {
  const pending = { clientX: 100, clientY: 100, expiresAt: 200 };

  assert.equal(shouldSuppressDragClickState(pending, { clientX: 106, clientY: 108 }, 150), true);
  assert.equal(shouldSuppressDragClickState(pending, { clientX: 109, clientY: 100 }, 150), false);
  assert.equal(shouldSuppressDragClickState(pending, { clientX: 100, clientY: 100 }, 250), false);
  assert.equal(shouldSuppressDragClickState(undefined, { clientX: 100, clientY: 100 }, 150), false);
});

test("copySelectionStatus formats copy and cut messages", () => {
  assert.equal(copySelectionStatus(1, false), "Copied 1 item");
  assert.equal(copySelectionStatus(2, false), "Copied 2 items");
  assert.equal(copySelectionStatus(3, true), "Cut 3 items");
});

test("uniqueWatcherPaths preserves first occurrence order", () => {
  assert.deepEqual(uniqueWatcherPaths(["/a", "/b", "/a", "/c"]), ["/a", "/b", "/c"]);
});

test("revealScrollTop centers list and grid items when possible", () => {
  assert.equal(
    revealScrollTop({
      itemIndex: 10,
      viewMode: "list",
      viewportWidth: 400,
      viewportHeight: 120,
      listRowHeight: 30,
      gridItemWidth: 100,
      gridRowHeight: 80
    }),
    255
  );
  assert.equal(
    revealScrollTop({
      itemIndex: 7,
      viewMode: "grid",
      viewportWidth: 250,
      viewportHeight: 200,
      listRowHeight: 30,
      gridItemWidth: 100,
      gridRowHeight: 80
    }),
    180
  );
  assert.equal(
    revealScrollTop({
      itemIndex: 0,
      viewMode: "list",
      viewportWidth: 400,
      viewportHeight: 120,
      listRowHeight: 30,
      gridItemWidth: 100,
      gridRowHeight: 80
    }),
    0
  );
});
