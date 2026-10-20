import type { ReportDoc, ReportDocAction } from "../report/report-doc";

function orderedKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  return keys.filter((key) => key.length > 0 && !seen.has(key) && (seen.add(key), true));
}

/** 선택된 페이지 속성의 공통값을 반환한다. */
export function mixedValue<T>(values: readonly T[], fallback: T): T | undefined {
  if (values.length === 0 || values.every((value) => value === undefined)) return fallback;
  const first = values[0];
  return values.every((value) => Object.is(value, first)) ? first : undefined;
}

/** 자동 라벨과 고정 라벨을 같은 visible/hidden 상태 기계로 토글한다. */
export function toggleLabelVisibility(
  pinnedKeys: readonly string[],
  hiddenKeys: readonly string[],
  key: string,
  currentlyVisible: boolean,
): { pinnedKeys: string[]; hiddenKeys: string[] } {
  const pinned = orderedKeys(pinnedKeys).filter((candidate) => candidate !== key);
  const hidden = orderedKeys(hiddenKeys).filter((candidate) => candidate !== key);
  if (key.length === 0) return { pinnedKeys: pinned, hiddenKeys: hidden };
  return currentlyVisible
    ? { pinnedKeys: pinned, hiddenKeys: [...hidden, key] }
    : { pinnedKeys: [...pinned, key], hiddenKeys: hidden };
}

/** 범례 강조 상태를 순수하게 토글한다. */
export function toggleLegendFocus(currentKey: string | null, key: string): string | null {
  return currentKey === key ? null : key;
}

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
