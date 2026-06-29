export interface PaneGridLayout {
  columns: number;
  rows: number;
}

export function paneGridLayout(
  count: number,
  viewportWidth: number,
  viewportHeight: number
): PaneGridLayout {
  const columns = paneColumnCount(count, viewportWidth, viewportHeight);
  return {
    columns,
    rows: Math.max(1, Math.ceil(count / columns))
  };
}

export function paneColumnCount(
  count: number,
  viewportWidth: number,
  viewportHeight: number
): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  const ratio = Math.max(0.75, Math.min(2, viewportWidth / Math.max(1, viewportHeight)));
  return Math.max(3, Math.min(4, Math.ceil(Math.sqrt(count * ratio))));
}

export function paneRowSpan(index: number, paneCount: number, columns: number, rows: number): string {
  const extraCells = Math.max(0, columns * rows - paneCount);
  return extraCells > 0 && index < extraCells ? "span 2" : "";
}
