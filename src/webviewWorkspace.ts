export interface WorkspaceRootPath {
  path: string;
}

export interface SelectionState {
  selectedPath?: string;
  selectedPaths: string[];
  selectionAnchorPath?: string;
}

export function workspacePathForCurrentPath(
  currentPath: string | undefined,
  workspaceRoots: WorkspaceRootPath[],
  initialPath: string,
  platform: string
): string {
  if (currentPath) {
    const matchingRoot = workspaceRoots
      .filter((root) => isPathInsideOrEqual(currentPath, root.path, platform))
      .sort((left, right) => right.path.length - left.path.length)[0];
    if (matchingRoot) return matchingRoot.path;
  }
  return workspaceRoots[0]?.path ?? initialPath;
}

export function cleanSelectionState(
  state: SelectionState,
  existingPaths: string[],
  platform: string
): SelectionState {
  const existing = new Set(existingPaths.map((itemPath) => normalizeForComparison(itemPath, platform)));
  const selectedPaths = state.selectedPaths.filter((selectedPath) =>
    existing.has(normalizeForComparison(selectedPath, platform))
  );
  const selectedPath =
    state.selectedPath && !existing.has(normalizeForComparison(state.selectedPath, platform))
      ? selectedPaths[0]
      : state.selectedPath;
  const selectionAnchorPath =
    state.selectionAnchorPath && !existing.has(normalizeForComparison(state.selectionAnchorPath, platform))
      ? selectedPaths[0]
      : state.selectionAnchorPath;

  return {
    selectedPath,
    selectedPaths,
    selectionAnchorPath
  };
}

function normalizeForComparison(value: string, platform: string): string {
  const normalized = value.replace(/[\\/]+$/, "");
  return platform === "win32" ? normalized.toLocaleLowerCase() : normalized;
}

function isPathInsideOrEqual(candidate: string, root: string, platform: string): boolean {
  const normalizedCandidate = normalizeForComparison(candidate, platform);
  const normalizedRoot = normalizeForComparison(root, platform);
  if (normalizedCandidate === normalizedRoot) return true;
  const separator = platform === "win32" ? "\\" : "/";
  return normalizedCandidate.startsWith(`${normalizedRoot}${separator}`);
}
