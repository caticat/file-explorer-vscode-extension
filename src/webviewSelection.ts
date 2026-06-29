export interface SelectionItem {
  path: string;
}

export interface SelectionState {
  selectedPath?: string;
  selectedPaths: string[];
  selectionAnchorPath?: string;
}

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface BoxLayout {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SuppressedDragClickState {
  clientX: number;
  clientY: number;
  expiresAt: number;
}

export function updateSelectionState(options: {
  state: SelectionState;
  itemPath: string;
  visibleItems: SelectionItem[];
  toggle: boolean;
  range: boolean;
  platform: string;
}): SelectionState {
  const normalized = normalizeForComparison(options.itemPath, options.platform);
  const selectedPaths = [...options.state.selectedPaths];
  let selectionAnchorPath = options.state.selectionAnchorPath;

  if (options.range && selectionAnchorPath) {
    const start = options.visibleItems.findIndex(
      (item) => normalizeForComparison(item.path, options.platform) === normalizeForComparison(selectionAnchorPath!, options.platform)
    );
    const end = options.visibleItems.findIndex(
      (item) => normalizeForComparison(item.path, options.platform) === normalized
    );
    if (start >= 0 && end >= 0) {
      const [from, to] = start < end ? [start, end] : [end, start];
      return {
        selectedPath: options.itemPath,
        selectedPaths: options.visibleItems.slice(from, to + 1).map((item) => item.path),
        selectionAnchorPath
      };
    }
  }

  if (options.toggle) {
    const existing = selectedPaths.findIndex(
      (selectedPath) => normalizeForComparison(selectedPath, options.platform) === normalized
    );
    if (existing >= 0) {
      selectedPaths.splice(existing, 1);
    } else {
      selectedPaths.push(options.itemPath);
    }
    selectionAnchorPath = options.itemPath;
  } else {
    selectedPaths.length = 0;
    selectedPaths.push(options.itemPath);
    selectionAnchorPath = options.itemPath;
  }

  return {
    selectedPath: options.itemPath,
    selectedPaths,
    selectionAnchorPath
  };
}

export function selectAllSelectionState(paths: string[]): SelectionState {
  return {
    selectedPath: paths[paths.length - 1],
    selectedPaths: [...paths],
    selectionAnchorPath: paths[0]
  };
}

export function emptySelectionState(): SelectionState {
  return {
    selectedPath: undefined,
    selectedPaths: [],
    selectionAnchorPath: undefined
  };
}

export function dragSelectionState(options: {
  hitPaths: string[];
  additive: boolean;
  baseSelection: string[];
  platform: string;
}): SelectionState | undefined {
  if (!options.additive && options.hitPaths.length === 0) {
    return undefined;
  }
  const selectedPaths = options.additive
    ? uniquePathsForPlatform([...options.baseSelection, ...options.hitPaths], options.platform)
    : [...options.hitPaths];
  return {
    selectedPath: selectedPaths[selectedPaths.length - 1],
    selectedPaths,
    selectionAnchorPath: selectedPaths[0]
  };
}

export function uniquePathsForPlatform(paths: string[], platform: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const itemPath of paths) {
    const normalized = normalizeForComparison(itemPath, platform);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(itemPath);
  }
  return result;
}

export function normalizedRect(left: number, top: number, right: number, bottom: number): RectLike {
  return {
    left: Math.min(left, right),
    top: Math.min(top, bottom),
    right: Math.max(left, right),
    bottom: Math.max(top, bottom)
  };
}

export function rectsIntersect(left: RectLike, right: RectLike): boolean {
  return (
    left.left <= right.right &&
    left.right >= right.left &&
    left.top <= right.bottom &&
    left.bottom >= right.top
  );
}

export function selectionBoxLayout(options: {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  viewport: { left: number; top: number; width: number; height: number };
  scrollTop: number;
}): BoxLayout {
  const left = Math.max(0, Math.min(options.startX, options.currentX) - options.viewport.left);
  const top = Math.max(0, Math.min(options.startY, options.currentY) - options.viewport.top);
  const right = Math.min(
    options.viewport.width,
    Math.max(options.startX, options.currentX) - options.viewport.left
  );
  const bottom = Math.min(
    options.viewport.height,
    Math.max(options.startY, options.currentY) - options.viewport.top
  );

  return {
    left,
    top: top + options.scrollTop,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  };
}

export function shouldSuppressDragClickState(
  pending: SuppressedDragClickState | undefined,
  event: { clientX: number; clientY: number },
  now: number,
  tolerance = 8
): boolean {
  if (!pending) return false;
  if (now > pending.expiresAt) return false;

  const distanceX = Math.abs(event.clientX - pending.clientX);
  const distanceY = Math.abs(event.clientY - pending.clientY);
  return distanceX <= tolerance && distanceY <= tolerance;
}

function normalizeForComparison(value: string, platform: string): string {
  const normalized = value.replace(/[\\/]+$/, "");
  return platform === "win32" ? normalized.toLocaleLowerCase() : normalized;
}
