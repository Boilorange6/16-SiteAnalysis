/** 보고서 페이지에서 저장·복원·미리보기·출력이 공유하는 요소 사각형. */
export type PagePanelKey = "title" | "summary" | "legend" | "source" | "north" | "scaleBar" | "locator";
export type PagePanelRect = { x: number; y: number; w: number; h: number };
export type PagePanels = Partial<Record<PagePanelKey, PagePanelRect>>;

export const PAGE_PANEL_KEYS: readonly PagePanelKey[] = ["title", "summary", "legend", "source", "north", "scaleBar", "locator"];

export const ACTION_BAR_HEIGHT = 40;
export const ACTION_BAR_GAP = 8;

export type ActionBarPixelBox = { x: number; y: number; w: number; h: number };
export type ActionBarPlacement = "above" | "below" | "inside-top";

function actionBoxesOverlap(a: ActionBarPixelBox, b: ActionBarPixelBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function clampActionBar(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** 선택 요소 기준으로 모든 보고서 공통 막대의 무대 내 위치를 계산한다. */
export function placeActionBar(
  anchor: ActionBarPixelBox,
  bounds: { w: number; h: number },
  avoid: readonly ActionBarPixelBox[] = [],
  barWidth = 190,
): { left: number; top: number; placement: ActionBarPlacement } {
  const width = Math.max(1, barWidth);
  const height = ACTION_BAR_HEIGHT;
  const left = clampActionBar(anchor.x, 4, Math.max(4, bounds.w - width - 4));
  const candidates: Array<{ top: number; placement: ActionBarPlacement }> = [
    { top: anchor.y - ACTION_BAR_GAP - height, placement: "above" },
    { top: anchor.y + anchor.h + ACTION_BAR_GAP, placement: "below" },
  ];
  const fits = (candidate: { top: number; placement: ActionBarPlacement }): boolean => {
    const box = { x: left, y: candidate.top, w: width, h: height };
    return box.y >= 4 && box.y + box.h <= bounds.h - 4 && avoid.every((item) => !actionBoxesOverlap(box, item));
  };
  const placed = candidates.find(fits);
  if (placed) return { left, top: placed.top, placement: placed.placement };
  return {
    left,
    top: clampActionBar(anchor.y + ACTION_BAR_GAP, 4, Math.max(4, bounds.h - height - 4)),
    placement: "inside-top",
  };
}

/** 셀 지도 장식·콜아웃이 실제 frame 높이에 비례하도록 공용 논리 단위를 계산한다. */
export function mapLayoutUnitForFrame(frameHeightPx: number): number {
  return Math.min(1.5, Math.max(1, frameHeightPx / 360));
}

const MIN_PANEL_SIZE = 0.01;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 페이지 전체를 기준으로 저장하는 0..1 정규화 사각형. 잘못된 저장값은 버린다. */
export function normalizePagePanelRect(value: unknown): PagePanelRect | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (![raw.x, raw.y, raw.w, raw.h].every(finite)) return null;
  const w = Math.max(MIN_PANEL_SIZE, Math.min(1, raw.w as number));
  const h = Math.max(MIN_PANEL_SIZE, Math.min(1, raw.h as number));
  const x = Math.max(0, Math.min(1 - w, raw.x as number));
  const y = Math.max(0, Math.min(1 - h, raw.y as number));
  return { x, y, w, h };
}

export function normalizePagePanels(value: unknown): PagePanels | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const output: PagePanels = {};
  const raw = value as Record<string, unknown>;
  for (const key of PAGE_PANEL_KEYS) {
    const rect = normalizePagePanelRect(raw[key]);
    if (rect) output[key] = rect;
  }
  return Object.keys(output).length > 0 ? output : null;
}

export function clonePagePanels(panels: PagePanels | undefined): PagePanels | undefined {
  const normalized = normalizePagePanels(panels);
  if (!normalized) return undefined;
  return Object.fromEntries(Object.entries(normalized).map(([key, rect]) => [key, { ...rect }])) as PagePanels;
}

export function pagePanelHasOverride(panels: PagePanels | undefined, key: PagePanelKey): boolean {
  return !!panels?.[key];
}

export function pagePanelGeometryKey(panels: PagePanels | undefined): string {
  if (!panels) return "";
  return PAGE_PANEL_KEYS.map((key) => {
    const rect = panels[key];
    return rect ? `${key}=${rect.x},${rect.y},${rect.w},${rect.h}` : `${key}=-`;
  }).join(";");
}
