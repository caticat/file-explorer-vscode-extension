export function treeNodeKey(nodePath: string, platform: string): string {
  return normalizeForComparison(nodePath, platform);
}

export function canToggleTreeNodeState(node: {
  loaded: boolean;
  children: unknown[];
  hasChildren?: boolean;
}): boolean {
  return node.loaded ? node.children.length > 0 : node.hasChildren !== false;
}

export function treeAncestorPathsForRevealTarget(
  targetPath: string,
  rootPaths: string[],
  platform: string
): string[] {
  const targetRoot = rootPaths
    .filter((root) => isPathInsideOrEqual(targetPath, root, platform))
    .sort((left, right) => right.length - left.length)[0];
  if (!targetRoot) return [];

  if (
    normalizeForComparison(targetPath, platform) ===
    normalizeForComparison(targetRoot, platform)
  ) {
    return [];
  }

  const ancestors: string[] = [];
  let current = targetPath;
  while (
    normalizeForComparison(current, platform) !==
    normalizeForComparison(targetRoot, platform)
  ) {
    const parent = dirname(current, platform);
    if (
      normalizeForComparison(parent, platform) ===
      normalizeForComparison(current, platform)
    ) {
      return [];
    }
    ancestors.push(parent);
    current = parent;
  }
  return ancestors.reverse();
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

function dirname(value: string, platform: string): string {
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
