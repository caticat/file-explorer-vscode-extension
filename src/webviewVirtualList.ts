export interface VirtualListLayout {
  startIndex: number;
  endIndex: number;
  totalHeight: number;
  top: number;
  columns: number;
  rowHeight: number;
}

export function virtualListLayout(options: {
  itemCount: number;
  viewMode: "list" | "grid";
  viewportHeight: number;
  viewportWidth: number;
  scrollTop: number;
  listRowHeight: number;
  gridItemWidth: number;
  gridRowHeight: number;
  overscan?: number;
}): VirtualListLayout {
  const overscan = options.overscan ?? 4;

  if (options.viewMode === "list") {
    const rowHeight = options.listRowHeight;
    const totalHeight = options.itemCount * rowHeight;
    const startIndex = Math.max(0, Math.floor(options.scrollTop / rowHeight) - overscan);
    const endIndex = Math.min(
      options.itemCount,
      Math.ceil((options.scrollTop + options.viewportHeight) / rowHeight) + overscan
    );
    return {
      startIndex,
      endIndex,
      totalHeight,
      top: startIndex * rowHeight,
      columns: 1,
      rowHeight
    };
  }

  const rowHeight = options.gridRowHeight;
  const columns = Math.max(1, Math.floor(options.viewportWidth / options.gridItemWidth));
  const rowCount = Math.ceil(options.itemCount / columns);
  const totalHeight = rowCount * rowHeight;
  const startRow = Math.max(0, Math.floor(options.scrollTop / rowHeight) - overscan);
  const endRow = Math.min(
    rowCount,
    Math.ceil((options.scrollTop + options.viewportHeight) / rowHeight) + overscan
  );

  return {
    startIndex: startRow * columns,
    endIndex: Math.min(options.itemCount, endRow * columns),
    totalHeight,
    top: startRow * rowHeight,
    columns,
    rowHeight
  };
}
