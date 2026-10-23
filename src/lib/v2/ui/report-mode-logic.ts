import { normalizeMapLabelBox, type MapFrameState, type MapLabelBox, type ReportDoc, type ReportDocAction, type ReportPage } from "../report/report-doc";

export type ReportRailKey = "pages" | "tiles";

/** 페이지가 있으면 무대를 먼저 보여 주고, 빈 보고서에서만 페이지 서랍을 연다. */
export function initialReportRail(hasPages: boolean): ReportRailKey | null {
  return hasPages ? null : "pages";
}

/** 표지 지도는 ReportPage에 frame이 없는 파생 지도이므로 편집 선택 대상이 아니다. */
export function reportPageMapSelectable(page: ReportPage | undefined): boolean {
  return page?.kind === "tile" || page?.kind === "compare";
}

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

/** 선택 막대의 라벨 상태는 숨김 목록보다 MapFigure가 실제로 그린 결과를 우선한다. */
export function mapLabelSwitchState(key: string, hiddenKeys: readonly string[], actualVisible?: boolean): boolean {
  if (typeof actualVisible === "boolean") return actualVisible;
  return key.length > 0 && !hiddenKeys.includes(key);
}

/** 지도 라벨 토글 patch를 페이지 frame patch로 옮긴다. 보고서 모드의 라벨 정본은 frame이다. */
export function labelFramePatch(
  frame: MapFrameState,
  patch: { pinnedKeys?: readonly string[]; hiddenKeys?: readonly string[] },
): Partial<MapFrameState> | null {
  if (patch.pinnedKeys === undefined && patch.hiddenKeys === undefined) return null;
  return {
    ...(patch.pinnedKeys !== undefined ? { pinnedKeys: [...patch.pinnedKeys] } : {}),
    ...(patch.hiddenKeys !== undefined ? { hiddenLabelKeys: [...patch.hiddenKeys] } : {}),
  };
}

/** 지도 요소 삭제는 원천 모델을 건드리지 않고 현재 페이지 frame에만 기록한다. */
export function deleteElementFramePatch(frame: MapFrameState, key: string): Partial<MapFrameState> | null {
  if (key.length === 0 || frame.deletedElementKeys.includes(key)) return null;
  return { deletedElementKeys: [...frame.deletedElementKeys, key] };
}

export function restoreAllDeletedElementFramePatch(frame: MapFrameState): Partial<MapFrameState> | null {
  if (frame.deletedElementKeys.length === 0) return null;
  return { deletedElementKeys: [] };
}

/** 라벨 말풍선은 지도 프레임 비율로 저장해 미리보기와 PPT가 같은 상자를 쓴다. */
export function labelBoxFramePatch(frame: MapFrameState, key: string, box: Partial<MapLabelBox>): Partial<MapFrameState> | null {
  if (key.length === 0) return null;
  return { labelBoxes: { ...frame.labelBoxes, [key]: normalizeMapLabelBox(box) } };
}

export function resetLabelBoxFramePatch(frame: MapFrameState, key: string): Partial<MapFrameState> | null {
  if (!(key in frame.labelBoxes)) return null;
  const labelBoxes = { ...frame.labelBoxes };
  delete labelBoxes[key];
  return { labelBoxes };
}

export function mapElementKindLabel(key: string): "영역" | "선" | "지점" {
  if (key.startsWith("polygon|")) return "영역";
  if (key.startsWith("line|")) return "선";
  return "지점";
}

/** 범례 강조 상태를 순수하게 토글한다. */
export function toggleLegendFocus(currentKey: string | null, key: string): string | null {
  return currentKey === key ? null : key;
}

export type StripKey = "ArrowLeft" | "ArrowRight" | "Home" | "End";

export function stripKeyIntent(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): { kind: "navigate"; key: StripKey } | { kind: "reorder"; key: "ArrowLeft" | "ArrowRight" } | null {
  if (e.altKey) return null;
  const arrowKey = e.key === "ArrowLeft" || e.key === "ArrowRight" ? e.key : null;
  const isStripKey = arrowKey !== null || e.key === "Home" || e.key === "End";
  if (!isStripKey) return null;
  if (e.ctrlKey || e.metaKey || e.shiftKey) {
    return e.shiftKey && (e.ctrlKey || e.metaKey) && arrowKey !== null
      ? { kind: "reorder", key: arrowKey }
      : null;
  }
  return { kind: "navigate", key: e.key as StripKey };
}

export function stripNavIndex(count: number, current: number, key: StripKey | "PageUp" | "PageDown"): number | null {
  if (count <= 0 || current < 0 || current >= count) return null;
  const next = key === "Home"
    ? 0
    : key === "End"
      ? count - 1
      : key === "ArrowLeft" || key === "PageUp"
        ? current - 1
        : current + 1;
  return next === current || next < 0 || next >= count ? null : next;
}

export function dropMoveIndex(
  pageIds: readonly string[],
  sourceId: string,
  overId: string,
  side: "before" | "after",
): number | null {
  const source = pageIds.indexOf(sourceId);
  const over = pageIds.indexOf(overId);
  if (source < 0 || over < 0 || source === over) return null;
  const insertion = over + (side === "after" ? 1 : 0);
  const next = source < insertion ? insertion - 1 : insertion;
  return next === source ? null : next;
}

export function reorderMessage(from: number, to: number): string {
  return `${from + 1}쪽을 ${to + 1}쪽 ${to > from ? "뒤로" : "앞으로"} 옮겼습니다`;
}

export function isTypingTarget(target: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  const tagName = target?.tagName?.toUpperCase();
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || target?.isContentEditable === true;
}

export type MapInteractionState = {
  selected: boolean;
  moveActive: boolean;
  settingsOpen: boolean;
};

export type MapInteractionEvent =
  | "select"
  | "enter-move"
  | "toggle-move"
  | "end-move"
  | "escape"
  | "open-settings"
  | "close-settings"
  | "outside-slide"
  | "outside-page";

export function transitionMapInteraction(
  state: MapInteractionState,
  event: MapInteractionEvent,
  locked = false,
): MapInteractionState {
  switch (event) {
    case "select":
      return { selected: true, moveActive: state.moveActive, settingsOpen: state.settingsOpen };
    case "enter-move":
      return locked ? state : { selected: true, moveActive: true, settingsOpen: state.settingsOpen };
    case "toggle-move":
      return locked ? state : { selected: true, moveActive: !state.moveActive, settingsOpen: state.settingsOpen };
    case "end-move":
      return { selected: state.selected, moveActive: false, settingsOpen: state.settingsOpen };
    case "escape":
      if (state.moveActive) return { selected: state.selected, moveActive: false, settingsOpen: state.settingsOpen };
      if (state.settingsOpen) return { selected: state.selected, moveActive: false, settingsOpen: false };
      return { selected: false, moveActive: false, settingsOpen: false };
    case "open-settings":
      return { selected: true, moveActive: false, settingsOpen: true };
    case "close-settings":
      return { selected: state.selected, moveActive: state.moveActive, settingsOpen: false };
    case "outside-slide":
      return state.moveActive
        ? { selected: state.selected, moveActive: false, settingsOpen: state.settingsOpen }
        : { selected: false, moveActive: false, settingsOpen: false };
    case "outside-page":
      return { selected: false, moveActive: false, settingsOpen: false };
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
      : page.kind === "compare" && page.cells.some((cell) => cell?.tileId === tileId);
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
