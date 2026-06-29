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
import { formatSize } from "../src/webviewFormat.ts";
import {
  filterItems,
  nextSortState,
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
  initialActiveTabIndex,
  initialTabPaths,
  isWorkspaceSession,
  normalizeIconTheme,
  normalizeListColumns,
  restoredLayoutMode
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
  metadataPathsToRequest,
  virtualListLayout,
  virtualRenderSignature
} from "../src/webviewVirtualList.ts";

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
  assert.equal(isPathInsideOrEqualPath("C:\\Work\\Project", "C:\\Work\\Project"), true);
  assert.equal(isPathInsideOrEqualPath("C:\\Work\\Project\\child", "C:\\Work\\Project"), true);
  assert.equal(isPathInsideOrEqualPath("C:\\Work\\Project2", "C:\\Work\\Project"), false);
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
