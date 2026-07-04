export interface WorkspaceSession {
  version: 1;
  tabs: Array<{ path: string }>;
  activeTabIndex: number;
  layoutMode?: "tabs" | "panes";
}

export interface ListColumnPreferences {
  modified: boolean;
  size: boolean;
}

export interface IconThemePayload {
  file?: string;
  folder?: string;
  fileExtensions: Record<string, string>;
  fileNames: Record<string, string>;
  folderNames: Record<string, string>;
}

export const RECENT_LOCATIONS_DISPLAY_LIMIT = 5;
export const RECENT_LOCATIONS_SAVE_LIMIT = 15;
export const FAVORITE_LOCATIONS_SAVE_LIMIT = 10;

export function isWorkspaceSession(value: unknown): value is WorkspaceSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Record<string, unknown>;
  return (
    session.version === 1 &&
    Array.isArray(session.tabs) &&
    session.tabs.length > 0 &&
    session.tabs.every(
      (tab) =>
        tab !== null &&
        typeof tab === "object" &&
        typeof (tab as Record<string, unknown>).path === "string"
    ) &&
    typeof session.activeTabIndex === "number" &&
    (session.layoutMode === undefined || session.layoutMode === "tabs" || session.layoutMode === "panes")
  );
}

export function normalizeListColumns(value: unknown): ListColumnPreferences {
  const columns = value && typeof value === "object" ? (value as Partial<ListColumnPreferences>) : {};
  return {
    modified: columns.modified !== false,
    size: columns.size !== false
  };
}

export function normalizeIconTheme(value: unknown): IconThemePayload | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<IconThemePayload>;
  return {
    file: typeof source.file === "string" ? source.file : undefined,
    folder: typeof source.folder === "string" ? source.folder : undefined,
    fileExtensions: normalizeStringMap(source.fileExtensions),
    fileNames: normalizeStringMap(source.fileNames),
    folderNames: normalizeStringMap(source.folderNames)
  };
}

export function initialTabPaths(
  workspaceSession: WorkspaceSession | undefined,
  workspaceRoots: Array<{ path: string }>,
  initialPath: string
): string[] {
  if (workspaceSession?.tabs.length) {
    return workspaceSession.tabs.map((tab) => tab.path);
  }
  if (workspaceRoots.length > 1) {
    return workspaceRoots.map((root) => root.path);
  }
  return [initialPath];
}

export function initialActiveTabIndex(
  workspaceSession: WorkspaceSession | undefined,
  tabCount: number
): number {
  if (!workspaceSession || tabCount <= 0) return 0;
  return Math.max(0, Math.min(workspaceSession.activeTabIndex, tabCount - 1));
}

export function restoredLayoutMode(
  viewKind: "editor" | "sidebar",
  tabCount: number,
  workspaceSession: WorkspaceSession | undefined
): "tabs" | "panes" {
  return viewKind === "editor" && tabCount > 1 && workspaceSession?.layoutMode === "panes"
    ? "panes"
    : "tabs";
}

export function normalizeRecentLocations(
  value: unknown,
  maxCount = RECENT_LOCATIONS_SAVE_LIMIT,
  normalize: (value: string) => string = (item) => item
): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !item) continue;
    const key = normalize(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= maxCount) break;
  }
  return result;
}

export function addRecentLocation(
  locations: string[],
  location: string,
  maxCount = RECENT_LOCATIONS_SAVE_LIMIT,
  normalize: (value: string) => string = (value) => value
): string[] {
  if (!location) return locations.slice(0, maxCount);
  const key = normalize(location);
  return [
    location,
    ...locations.filter((candidate) => normalize(candidate) !== key)
  ].slice(0, maxCount);
}

export function visibleRecentLocations(
  locations: string[],
  currentLocation: string,
  maxCount = RECENT_LOCATIONS_DISPLAY_LIMIT,
  normalize: (value: string) => string = (value) => value
): string[] {
  const currentKey = normalize(currentLocation);
  return locations
    .filter((candidate) => normalize(candidate) !== currentKey)
    .slice(0, maxCount);
}

export function normalizeFavoriteLocations(
  value: unknown,
  maxCount = FAVORITE_LOCATIONS_SAVE_LIMIT,
  normalize: (value: string) => string = (item) => item
): string[] {
  return normalizeRecentLocations(value, maxCount, normalize);
}

export function addFavoriteLocation(
  locations: string[],
  location: string,
  maxCount = FAVORITE_LOCATIONS_SAVE_LIMIT,
  normalize: (value: string) => string = (value) => value
): string[] {
  return addRecentLocation(locations, location, maxCount, normalize);
}

export function removeFavoriteLocation(
  locations: string[],
  location: string,
  normalize: (value: string) => string = (value) => value
): string[] {
  const key = normalize(location);
  return locations.filter((candidate) => normalize(candidate) !== key);
}

export function isFavoriteLocation(
  locations: string[],
  location: string,
  normalize: (value: string) => string = (value) => value
): boolean {
  const key = normalize(location);
  return locations.some((candidate) => normalize(candidate) === key);
}

function normalizeStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, mapValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof mapValue === "string") {
      result[key.toLocaleLowerCase()] = mapValue;
    }
  }
  return result;
}
