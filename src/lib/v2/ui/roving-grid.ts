export type RovingGridItem = {
  id: string;
  navigable?: boolean;
};

/**
 * Returns the target index in the navigable item list for a grid key.
 * Horizontal movement stays on the current row; vertical movement keeps the
 * column where possible and clamps to the end of a shorter row.
 */
export function getRovingTargetIndex(items: readonly RovingGridItem[], currentId: string | null | undefined, key: string, columns: number): number {
  const navigable = items.filter((item) => item.navigable !== false);
  if (navigable.length === 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return navigable.length - 1;

  const currentIndex = navigable.findIndex((item) => item.id === currentId);
  if (currentIndex < 0) return -1;
  const columnCount = Math.max(1, Math.floor(columns) || 1);
  const row = Math.floor(currentIndex / columnCount);
  const column = currentIndex % columnCount;
  const positioned = navigable.map((item, index) => ({ item, position: index, index }));
  const sameRow = positioned.filter(({ position }) => Math.floor(position / columnCount) === row);

  if (key === "ArrowLeft" || key === "ArrowRight") {
    const at = sameRow.findIndex(({ item }) => item.id === currentId);
    if (at < 0) return currentIndex;
    const next = at + (key === "ArrowLeft" ? -1 : 1);
    return next >= 0 && next < sameRow.length ? sameRow[next]!.index : currentIndex;
  }
  if (key !== "ArrowUp" && key !== "ArrowDown") return currentIndex;

  const targetRow = key === "ArrowUp" ? row - 1 : row + 1;
  if (targetRow < 0) return currentIndex;
  const target = positioned.filter(({ position }) => Math.floor(position / columnCount) === targetRow);
  if (target.length === 0) return currentIndex;
  const sameColumn = target.find(({ position }) => position % columnCount === column);
  return (sameColumn ?? target[target.length - 1]!).index;
}
