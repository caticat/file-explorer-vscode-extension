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
import { createNameMatcher } from "../src/webviewMatcher.ts";
import {
  basenameForPlatform,
  dirnameForPlatform,
  isPathInsideOrEqualForPlatform,
  normalizeForComparisonForPlatform,
  splitPathForPlatform
} from "../src/webviewPath.ts";
import {
  initialActiveTabIndex,
  initialTabPaths,
  isWorkspaceSession,
  normalizeIconTheme,
  normalizeListColumns,
  restoredLayoutMode
} from "../src/webviewState.ts";

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
