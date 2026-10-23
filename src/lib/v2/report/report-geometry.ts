/** 보고서 페이지에서 저장·복원·미리보기·출력이 공유하는 요소 사각형. */
export type PagePanelKey = "title" | "summary" | "legend" | "source" | "north" | "scaleBar" | "locator";
export type PagePanelRect = { x: number; y: number; w: number; h: number };
export type PagePanels = Partial<Record<PagePanelKey, PagePanelRect>>;

export const PAGE_PANEL_KEYS: readonly PagePanelKey[] = ["title", "summary", "legend", "source", "north", "scaleBar", "locator"];

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

