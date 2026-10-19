import type { ReportDoc, ReportDocAction } from "../report/report-doc";

export type MapInteractionState = {
  selected: boolean;
  moveActive: boolean;
};

export type MapInteractionEvent =
  | "select"
  | "enter-move"
  | "toggle-move"
  | "end-move"
  | "escape"
  | "outside-slide"
  | "outside-page";

export function transitionMapInteraction(
  state: MapInteractionState,
  event: MapInteractionEvent,
): MapInteractionState {
  switch (event) {
    case "select":
      return { selected: true, moveActive: state.moveActive };
    case "enter-move":
      return { selected: true, moveActive: true };
    case "toggle-move":
      return { selected: true, moveActive: !state.moveActive };
    case "end-move":
      return { selected: state.selected, moveActive: false };
    case "escape":
    case "outside-slide":
      return state.moveActive
        ? { selected: state.selected, moveActive: false }
        : { selected: false, moveActive: false };
    case "outside-page":
      return { selected: false, moveActive: false };
  }
}

export function insertIndexAfter(doc: ReportDoc, selectedId: string | null): number {
  if (!selectedId) return doc.pages.length;
  const index = doc.pages.findIndex((page) => page.id === selectedId);
  return index < 0 ? doc.pages.length : index + 1;
}

export function pagesUsingTile(doc: ReportDoc, tileId: string): number[] {
  return doc.pages.reduce<number[]>((pages, page, index) => {
    const usesTile = page.kind === "tile"
      ? page.tileId === tileId
      : page.kind === "compare" && page.cells.some((cell) => cell.tileId === tileId);
    if (usesTile) pages.push(index + 1);
    return pages;
  }, []);
}

export function moveByKey(
  doc: ReportDoc,
  id: string,
  key: "ArrowLeft" | "ArrowRight" | "Home" | "End",
): Extract<ReportDocAction, { type: "move" }> | null {
  const index = doc.pages.findIndex((page) => page.id === id);
  if (index < 0 || doc.pages.length < 2) return null;
  const last = doc.pages.length - 1;
  const to = key === "Home"
    ? 0
    : key === "End"
      ? last
      : key === "ArrowLeft"
        ? index - 1
        : index + 1;
  if (to === index || to < 0 || to > last) return null;
  return { type: "move", id, to };
}
