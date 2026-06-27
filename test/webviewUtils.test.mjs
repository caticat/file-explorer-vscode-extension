import assert from "node:assert/strict";
import test from "node:test";

import { formatSize } from "../src/webviewFormat.ts";
import { createNameMatcher } from "../src/webviewMatcher.ts";
import {
  basenameForPlatform,
  dirnameForPlatform,
  isPathInsideOrEqualForPlatform,
  normalizeForComparisonForPlatform,
  splitPathForPlatform
} from "../src/webviewPath.ts";

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
