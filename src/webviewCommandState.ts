export function copySelectionStatus(count: number, cut: boolean): string {
  return `${cut ? "Cut" : "Copied"} ${count.toLocaleString()} item${count === 1 ? "" : "s"}`;
}

export function uniqueWatcherPaths(paths: string[]): string[] {
  return [...new Set(paths)];
}
