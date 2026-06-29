export interface SortableDirectoryItem {
  name: string;
  isDirectory: boolean;
  size?: number;
  modified?: number;
}

export type ItemSortKey = "name" | "modified" | "size";
export type ItemSortDirection = "asc" | "desc";

export interface ItemSortState {
  sortKey: ItemSortKey;
  sortDirection: ItemSortDirection;
}

export function filterItems<T extends { name: string }>(
  items: T[],
  options: { showHidden: boolean; searchQuery: string }
): T[] {
  const matchesQuery = createNameMatcher(options.searchQuery);
  return items.filter(
    (item) =>
      (options.showHidden || !item.name.startsWith(".")) &&
      (!options.searchQuery || matchesQuery(item.name))
  );
}

export function sortItemsInPlace<T extends SortableDirectoryItem>(
  items: T[],
  sortState: ItemSortState,
  platform: string
): void {
  items.sort((left, right) => compareItems(left, right, sortState, platform));
}

export function nextSortState(
  current: ItemSortState,
  sortKey: ItemSortKey
): ItemSortState {
  if (current.sortKey === sortKey) {
    return {
      sortKey,
      sortDirection: current.sortDirection === "asc" ? "desc" : "asc"
    };
  }
  return {
    sortKey,
    sortDirection: sortKey === "name" ? "asc" : "desc"
  };
}

function compareItems(
  left: SortableDirectoryItem,
  right: SortableDirectoryItem,
  sortState: ItemSortState,
  platform: string
): number {
  if (left.isDirectory !== right.isDirectory) {
    return left.isDirectory ? -1 : 1;
  }
  let result = 0;
  if (sortState.sortKey === "modified") {
    result = (left.modified ?? 0) - (right.modified ?? 0);
  } else if (sortState.sortKey === "size") {
    result = (left.size ?? 0) - (right.size ?? 0);
  } else {
    result = left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: platform === "win32" ? "base" : "variant"
    });
  }
  if (result === 0 && sortState.sortKey !== "name") {
    result = left.name.localeCompare(right.name, undefined, { numeric: true });
  }
  return sortState.sortDirection === "asc" ? result : -result;
}

function createNameMatcher(query: string): (name: string) => boolean {
  if (!query.includes("*") && !query.includes("?")) {
    const normalized = query.toLocaleLowerCase();
    return (name) => name.toLocaleLowerCase().includes(normalized);
  }

  const escaped = query.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const expression = escaped.replaceAll("*", ".*").replaceAll("?", ".");
  const regex = new RegExp(`^${expression}$`, "i");
  return (name) => regex.test(name);
}
