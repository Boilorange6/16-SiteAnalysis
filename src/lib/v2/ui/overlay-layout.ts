/**
 * 지도 몰입형 오버레이의 위치 문법 (보드 카드 · 펼침 · PPT 슬라이드 공통).
 * 화면(px)과 슬라이드(inch)가 같은 자리 이름·여백·판 스타일을 쓰도록 토큰을 한곳에 둔다. 순수 함수만 있다.
 *
 *  왼쪽 위 = 제목 칩 · 오른쪽 위 = 보고서 칩/북쪽 · 왼쪽 아래 = 핵심 값 카드(+범례)
 *  오른쪽 아래 = 축척 · 맨 아래 = 출처 띠
 */
import { isBuildingLayer, legendItemsForModel, type MapLegendLayerItem, type MapModel } from "./map-layers";
import type { PagePanelKey, PageStyle } from "./board-state";
import { VECTOR_ATTRIBUTION, type BasemapChoice } from "./map-projection";
import type { CalloutModel } from "./tile-view";

export type Box = { x0: number; y0: number; x1: number; y1: number };

export const OV = {
  /** 오버레이가 지도 가장자리에서 떨어지는 거리(px) */
  edge: 12,
  /** 판 모서리(px) / 카드 모서리(px) */
  plateRadius: 12,
  cardRadius: 18,
  /** 판 배경: 흰색 86% (CSS rgba .86 = PPT 투명도 14%) */
  plateAlpha: 0.86,
  /** 카드 높이(px). 2칸 타일도 같은 높이로 가로만 넓다 */
  cardHeight: 280,
  /** 출처 띠 높이(px) */
  stripH: 24,
  /** 핵심 값 카드 아래 상태 배지는 최대 이만큼, 나머지는 "+n" */
  maxBadges: 2,
  sourceCredit: "© VWorld(국토교통부)",
} as const;

export function badgesToShow<T>(items: T[], max: number = OV.maxBadges): { shown: T[]; more: number } {
  return { shown: items.slice(0, max), more: Math.max(0, items.length - max) };
}

/** 출처 띠 문구: 항상 출처와 기준일을 담는다 */
export function stripText(sourceLine: string, credit = true, basemap?: BasemapChoice): string {
  const base = sourceLine === "출처 없음" ? "출처 없음 · 기준일 해당 없음" : sourceLine;
  return credit ? `${base} · ${basemap === "vector" ? VECTOR_ATTRIBUTION : OV.sourceCredit}` : base;
}

/** 카드/펼침 위에 오버레이가 덮는 자리(px). 지도 라벨은 이 자리를 피한다. */
export function cardReserved(w: number, h: number, opts: { valueH?: number; titleW?: number; right?: number } = {}): Box[] {
  const e = OV.edge;
  const right = opts.right ?? 146; // 보고서 칩(보고서 · 펼치기 · 요약) 폭
  const titleW = Math.min(opts.titleW ?? 240, w - 3 * e - right); // 제목 칩은 보고서 칩을 피해 줄어든다
  const valueH = opts.valueH ?? 104;
  const valueW = Math.min(230, w - 2 * e);
  return [
    { x0: 0, y0: 0, x1: e + titleW, y1: e + 38 },
    { x0: w - e - right, y0: 0, x1: w, y1: e + 38 },
    { x0: 0, y0: h - OV.stripH - e - valueH, x1: e + valueW, y1: h },
    { x0: 0, y0: h - OV.stripH, x1: w, y1: h },
  ];
}

export type Rect = { x: number; y: number; w: number; h: number };

export type SlidePanelRects = {
  title: Rect;
  summary: Rect | null;
  legend: Rect | null;
};

export const TERRAIN_SECTION_HEIGHT = 2.45;
export const TERRAIN_SECTION_MIN_WIDTH = 3.8;
const TERRAIN_SECTION_INSET = 0.16;
const TERRAIN_SECTION_GAP = 0.14;

export type TerrainSectionLayout = {
  rect: Rect;
  /** 단면이 요약 열에 들어갈 때 위쪽 요약 판이 사용하는 rect. */
  summary: Rect | null;
  mode: "summary" | "bottom-band";
  /** 하단 밴드 fallback에서 지도 원·콜아웃을 위로 줄이는 값. */
  mapFill?: number;
  mapSiteY?: number;
  calloutLeftBottom?: number;
};

export type SlideFormat = "wide" | "a3" | "a4";
export type ReportLayoutName = "map-full" | "map-summary" | "map-charts" | "numbers-first" | "side-by-side";

/** 슬라이드 판형의 실제 PowerPoint inch 크기. wide 수치는 기존 골든과 같다. */
export const SLIDE = { w: 13.333, h: 7.5, edge: 0.3, stripH: 0.36, infoRatio: 0.32 } as const;

/** 슬라이드 범례 판의 CSS·PPT 공용 geometry(inch). */
export const SLIDE_LEGEND = {
  padding: 0.12,
  row: 0.24,
  note: 0.22,
  iconColumn: 0.25,
  gap: 0.12,
  labelChar: 0.16,
  minWidth: 1.2,
  maxWidth: 4.4,
} as const;

const FORMAT_SIZES: Record<SlideFormat, { w: number; h: number }> = {
  wide: { w: SLIDE.w, h: SLIDE.h },
  a3: { w: 15120000 / 914400, h: 10692000 / 914400 },
  a4: { w: 10692000 / 914400, h: 7560000 / 914400 },
};

export function slideSize(format: SlideFormat = "wide"): { w: number; h: number } {
  return { ...FORMAT_SIZES[format] };
}

export type SlideGeometry = { w: number; h: number; edge: number; stripH: number; infoRatio: number };

export function slideGeometry(format: SlideFormat = "wide"): SlideGeometry {
  const size = slideSize(format);
  return { ...size, edge: SLIDE.edge, stripH: SLIDE.stripH, infoRatio: SLIDE.infoRatio };
}

export function slideLayout(format: SlideFormat = "wide"): { title: Rect; info: Rect; legendX: number; legendBottom: number; strip: Rect; page: Rect } {
  const { w, h, edge, stripH, infoRatio } = slideGeometry(format);
  const infoW = Math.round(w * infoRatio * 100) / 100;
  const titleW = format === "wide" ? 4.6 : Math.min(5.8, w * 0.35);
  const stripY = h - stripH;
  return {
    title: { x: edge, y: edge, w: titleW, h: 0.66 },
    info: { x: w - edge - infoW, y: edge, w: infoW, h: stripY - edge * 1.6 - edge },
    legendX: edge,
    legendBottom: stripY - edge * 0.6,
    strip: { x: 0, y: stripY, w, h: stripH },
    page: { x: w - 1.4, y: stripY, w: 1.3, h: stripH },
  };
}

const panelScale = (value: number | undefined): number => Math.max(0.7, Math.min(1.5, value ?? 1));
export const slidePanelScale = panelScale;

type PanelStyle = Pick<PageStyle, "titleScale" | "summaryScale" | "legendScale" | "panels" | "summary">;

function slideSafeRect(rect: Rect, format: SlideFormat = "wide"): Rect {
  const g = slideGeometry(format);
  const left = g.edge;
  const top = g.edge;
  const right = g.w - g.edge;
  const bottom = slideLayout(format).strip.y - g.edge * 0.6;
  const w = Math.min(Math.max(0, rect.w), Math.max(0, right - left));
  const h = Math.min(Math.max(0, rect.h), Math.max(0, bottom - top));
  return {
    x: Math.max(left, Math.min(right - w, rect.x)),
    y: Math.max(top, Math.min(bottom - h, rect.y)),
    w,
    h,
  };
}

function customPanelRect(style: PanelStyle | undefined, key: PagePanelKey, format: SlideFormat = "wide"): Rect | null {
  const panel = style?.panels?.[key];
  if (!panel) return null;
  const unit = (value: number): number => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const g = slideGeometry(format);
  return slideSafeRect({
    x: unit(panel.x) * g.w,
    y: unit(panel.y) * g.h,
    w: unit(panel.w) * g.w,
    h: unit(panel.h) * g.h,
  }, format);
}

function scaleAnchoredRect(
  rect: Rect,
  scale: number,
  anchor: "top-left" | "top-right" | "bottom-left",
  maxW = Number.POSITIVE_INFINITY,
  maxH = Number.POSITIVE_INFINITY,
): Rect {
  const w = Math.min(rect.w * scale, Math.max(0, maxW));
  const h = Math.min(rect.h * scale, Math.max(0, maxH));
  return {
    x: anchor === "top-right" ? rect.x + rect.w - w : rect.x,
    y: anchor === "bottom-left" ? rect.y + rect.h - h : rect.y,
    w,
    h,
  };
}

/**
 * 페이지 스타일이 적용된 PPT 패널 자리.
 * 범례는 항목 수에 따라 기준 rect가 달라지므로 실제 rect를 넘길 수 있고,
 * 생략하면 테스트·미리보기용 대표 4행 rect를 사용한다.
 */
export function slidePanelRects(
  style: PanelStyle | undefined,
  hasSummary: boolean,
  legendBase?: Rect | null,
  format: SlideFormat = "wide",
): SlidePanelRects {
  const g = slideGeometry(format);
  const l = slideLayout(format);
  const baseLegend = legendBase ?? slideLegendRect(4, 0, 8, format);
  const titleScale = panelScale(style?.titleScale);
  const summaryScale = panelScale(style?.summaryScale);
  const legendScale = panelScale(style?.legendScale);
  const customSummary = hasSummary ? customPanelRect(style, "summary", format) : null;
  const panelGap = 0.18;
  const maxSideBySideW = Math.max(0, g.w - 2 * g.edge - panelGap);
  const requestedTitleW = Math.min(l.title.w * titleScale, g.w - 2 * g.edge);
  const requestedSummaryW = Math.min(l.info.w * summaryScale, g.w - 2 * g.edge);
  const sideBySideRatio = hasSummary && requestedTitleW + requestedSummaryW > maxSideBySideW
    ? maxSideBySideW / (requestedTitleW + requestedSummaryW)
    : 1;
  const titleW = requestedTitleW * sideBySideRatio;
  const summaryW = requestedSummaryW * sideBySideRatio;
  const safeBottom = l.strip.y - g.edge * 0.6;
  const safeHeight = Math.max(0, safeBottom - g.edge);
  const title = slideSafeRect(scaleAnchoredRect(l.title, titleScale, "top-left", titleW, safeHeight), format);
  const summary = hasSummary
    ? slideSafeRect(scaleAnchoredRect(l.info, summaryScale, "top-right", summaryW, safeHeight), format)
    : null;
  const requestedLegend = baseLegend ? scaleAnchoredRect(baseLegend, legendScale, "bottom-left") : null;
  const legend = requestedLegend
    ? slideSafeRect({
        ...requestedLegend,
        w: Math.min(requestedLegend.w, Math.max(0, (customSummary?.x ?? summary?.x ?? g.w - g.edge) - g.edge - panelGap)),
      }, format)
    : null;
  const custom = {
    title: customPanelRect(style, "title", format),
    summary: customSummary,
    legend: customPanelRect(style, "legend", format),
  };
  return {
    title: custom.title ?? title,
    summary: custom.summary ?? summary,
    legend: custom.legend ?? legend,
  };
}

/** D17 단면 도판의 preview/PPT 공용 자리. 요약 열이 충분하면 그 안에, 아니면 하단 밴드에 둔다. */
export function terrainSectionLayout(
  panels: Pick<SlidePanelRects, "summary" | "legend">,
  layout = slideLayout(),
  format: SlideFormat = "wide",
): TerrainSectionLayout | null {
  const g = slideGeometry(format);
  const pageBottom = layout.strip.y - g.edge * 0.6;
  const sectionH = TERRAIN_SECTION_HEIGHT;
  const summary = panels.summary;
  if (summary) {
    const inset = Math.min(TERRAIN_SECTION_INSET, Math.max(0.1, summary.w * 0.04));
    const sectionW = Math.max(0, summary.w - inset * 2);
    const y = pageBottom - sectionH;
    if (sectionW >= TERRAIN_SECTION_MIN_WIDTH && y >= summary.y + 1.5) {
      const rect = { x: summary.x + inset, y, w: sectionW, h: sectionH };
      return {
        rect,
        summary: { ...summary, h: Math.max(0, rect.y - summary.y - TERRAIN_SECTION_GAP) },
        mode: "summary",
      };
    }
  }

  const safeBottom = Math.min(pageBottom, panels.legend ? panels.legend.y - TERRAIN_SECTION_GAP : pageBottom);
  const bandW = Math.max(0.2, Math.min(6.7, (summary?.x ?? g.w) - g.edge - TERRAIN_SECTION_GAP));
  const rect = { x: g.edge, y: safeBottom - sectionH, w: bandW, h: sectionH };
  const mapSiteY = 0.32;
  const mapCenterY = g.h * mapSiteY;
  const radius = Math.max(0, rect.y - TERRAIN_SECTION_GAP - mapCenterY);
  return {
    rect,
    summary,
    mode: "bottom-band",
    mapFill: Math.max(0.28, Math.min(0.52, (2 * radius) / g.h)),
    mapSiteY,
    calloutLeftBottom: rect.y - TERRAIN_SECTION_GAP,
  };
}

/** 왼쪽 아래 범례 판: 항목 n개 + 문구 m줄. 출처 띠 바로 위에 붙는다 */
export function slideLegendRect(items: number, notes: number, labelChars: number, format: SlideFormat = "wide"): Rect | null {
  if (items + notes === 0) return null;
  const l = slideLayout(format);
  const h = SLIDE_LEGEND.padding * 2 + items * SLIDE_LEGEND.row + notes * SLIDE_LEGEND.note;
  const contentW = SLIDE_LEGEND.iconColumn + SLIDE_LEGEND.gap + Math.max(0, labelChars) * SLIDE_LEGEND.labelChar;
  const w = Math.min(SLIDE_LEGEND.maxWidth, Math.max(SLIDE_LEGEND.minWidth, SLIDE_LEGEND.padding * 2 + contentW));
  return { x: l.legendX, y: l.legendBottom - h, w, h };
}

/** 미리보기·PPT가 같은 범례 판 안쪽의 아이콘 열·라벨·문구 자리를 쓴다. */
export function slideLegendGeometry(rect: Rect, scale = 1): {
  padding: number;
  iconColumn: number;
  gap: number;
  contentX: number;
  contentRight: number;
  labelX: number;
  labelW: number;
  noteX: number;
  noteW: number;
} {
  const padding = SLIDE_LEGEND.padding * scale;
  const iconColumn = SLIDE_LEGEND.iconColumn * scale;
  const gap = SLIDE_LEGEND.gap * scale;
  const contentX = rect.x + padding;
  const contentRight = Math.max(contentX, rect.x + rect.w - padding);
  const labelX = contentX + iconColumn + gap;
  return {
    padding,
    iconColumn,
    gap,
    contentX,
    contentRight,
    labelX,
    labelW: Math.max(0, contentRight - labelX),
    noteX: contentX,
    noteW: Math.max(0, contentRight - contentX),
  };
}

/** 미리보기·PPT가 같은 범례 판 안에서 사용하는 각 행의 예약 자리. */
export function slideLegendRowRects(rect: Rect | null, items: number, notes: number): { items: Rect[]; notes: Rect[] } {
  if (!rect) return { items: [], notes: [] };
  const x = rect.x + SLIDE_LEGEND.padding;
  const w = Math.max(0, rect.w - SLIDE_LEGEND.padding * 2);
  let y = rect.y + SLIDE_LEGEND.padding;
  const itemRects = Array.from({ length: Math.max(0, items) }, () => {
    const row = { x, y, w, h: SLIDE_LEGEND.row };
    y += SLIDE_LEGEND.row;
    return row;
  });
  const noteRects = Array.from({ length: Math.max(0, notes) }, () => {
    const row = { x, y, w, h: SLIDE_LEGEND.note };
    y += SLIDE_LEGEND.note;
    return row;
  });
  return { items: itemRects, notes: noteRects };
}

export type SlideCalloutLegendEntry = { text: string; color?: string | null; hollow?: boolean };
export type SlideCalloutLegendRow = SlideCalloutLegendEntry & { x: number; w: number };
export type SlideCalloutLegendLayout = { rect: Rect; rows: SlideCalloutLegendRow[][] };

/**
 * A05/A06 개요·설명표가 공유하는 가로 범례의 실제 판 자리와 줄바꿈.
 * PPT 글자 측정은 pptx-kit과 같은 고정폭 규칙을 써서 지도 장면도 같은
 * rect를 회피 입력으로 사용할 수 있게 한다.
 */
export function slideCalloutLegendLayout(
  entries: readonly SlideCalloutLegendEntry[],
  x: number,
  bottom: number,
  maxW: number,
  fontScale = 1,
): SlideCalloutLegendLayout | null {
  if (entries.length === 0 || maxW <= 0) return null;
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  const textIn = (value: string, pt: number) => ([...value].reduce((width, ch) => width + (ch.charCodeAt(0) > 0x2e80 ? 1 : 0.56), 0) * pt * scale) / 72;
  const rows: SlideCalloutLegendRow[][] = [[]];
  let cx = 0;
  for (const entry of entries) {
    const w = (entry.color ? 0.22 : 0.04) + textIn(entry.text, 9) + 0.1;
    if (cx > 0 && cx + w > maxW - 0.3) {
      rows.push([]);
      cx = 0;
    }
    rows.at(-1)!.push({ ...entry, x: cx, w });
    cx += w;
  }
  const width = Math.min(maxW, Math.max(...rows.map((row) => row.reduce((sum, entry) => sum + entry.w, 0))) + 0.3);
  const height = 0.14 + rows.length * 0.24;
  return { rect: { x, y: bottom - height, w: width, h: height }, rows };
}

export type SlideCalloutAvoidance = {
  calloutLegend: Rect | null;
  calloutTop: number;
  calloutLeftBottom?: number;
};

/** 개요 지도와 PPT/미리보기의 콜아웃이 공유하는 제목·범례 회피 자리. */
export function slideCalloutAvoidance(
  panels: SlidePanelRects,
  entries: readonly SlideCalloutLegendEntry[] = [],
  layout = slideLayout(),
  format: SlideFormat = "wide",
  fontScale = 1,
): SlideCalloutAvoidance {
  const g = slideGeometry(format);
  const summaryX = panels.summary?.x ?? g.w;
  const calloutLegend = entries.length > 0
    ? slideCalloutLegendLayout(entries, g.edge, layout.legendBottom, Math.max(0, summaryX - 2 * g.edge), fontScale)?.rect ?? null
    : null;
  const gap = g.edge * 0.5;
  const lowerOverlayTop = Math.min(panels.legend?.y ?? g.h, calloutLegend?.y ?? g.h);
  return {
    calloutLegend,
    calloutTop: panels.title.y + panels.title.h + gap,
    ...(lowerOverlayTop < SLIDE.h ? { calloutLeftBottom: lowerOverlayTop - gap } : {}),
  };
}

type SlideLegendItem = Omit<MapLegendLayerItem, "highlight"> & { site?: boolean };
export type SlideLegendOptions = { order?: readonly string[]; hidden?: readonly string[]; visibleOnly?: boolean; placement?: "below" | "right" | "hidden" };

export type CalloutLegendOptions = Pick<SlideLegendOptions, "order" | "hidden" | "visibleOnly" | "placement">;

export function legendMatches(item: Pick<MapLegendLayerItem, "layer" | "label">, value: string): boolean {
  const needle = value.trim().toLowerCase();
  if (!needle) return false;
  const layer = item.layer.toLowerCase();
  const label = item.label.toLowerCase();
  return layer === needle
    || label === needle
    || label.startsWith(`${needle}(`)
    || label.startsWith(`${needle} ·`)
    || (needle === "건물" && isBuildingLayer(item.layer));
}

/** A05/A06 설명선 범례를 지도 범례와 같은 숨김·순서·배치 계약으로 만든다. */
export function calloutLegendEntries(model: CalloutModel, options: CalloutLegendOptions = {}): SlideCalloutLegendEntry[] {
  if (options.placement === "hidden") return [];
  let items = model.legend.items.map((item) => ({ text: item.label, color: item.color, hollow: item.hollow === true }));
  const matches = (item: SlideCalloutLegendEntry, value: string): boolean => legendMatches({ layer: item.text, label: item.text }, value);
  if (options.hidden?.length) items = items.filter((item) => !options.hidden!.some((hidden) => matches(item, hidden)));
  if (options.order?.length) {
    const order = options.order;
    items = items
      .map((item, index) => ({ item, index, rank: order.findIndex((value) => matches(item, value)) }))
      .sort((a, b) => (a.rank < 0 ? Number.MAX_SAFE_INTEGER : a.rank) - (b.rank < 0 ? Number.MAX_SAFE_INTEGER : b.rank) || a.index - b.index)
      .map(({ item }) => item);
  }
  return [{ text: model.legend.title }, ...items, { text: model.legend.sizeLabel }];
}

/** 지도 모델 → 범례 항목·문구·자리 (슬라이드 그리기와 지도 이미지의 라벨 회피가 같은 값을 쓴다) */
export function slideLegend(
  model: MapModel,
  includeSite = true,
  style?: PanelStyle,
  hasSummary = true,
  format: SlideFormat = "wide",
  options: SlideLegendOptions = {},
) {
  let items: SlideLegendItem[] = [
    ...legendItemsForModel(model).filter((item) => item.layer !== "parcel_site" && item.layer !== "pnu"),
    ...(includeSite ? [{ layer: "__site_marker", label: "대지", color: "#111", site: true as const }] : []),
  ];
  if (options.hidden?.length) items = items.filter((item) => item.site || !options.hidden!.some((hidden) => legendMatches(item, hidden)));
  if (options.order?.length) {
    const order = options.order;
    items = items
      .map((item, index) => ({ item, index, rank: order.findIndex((value) => legendMatches(item, value)) }))
      .sort((a, b) => (a.rank < 0 ? Number.MAX_SAFE_INTEGER : a.rank) - (b.rank < 0 ? Number.MAX_SAFE_INTEGER : b.rank) || a.index - b.index)
      .map(({ item }) => item);
  }
  const notes = [...model.notes, ...(model.total > model.features.length ? [`표시 ${model.features.length.toLocaleString("en-US")} / 전체 ${model.total.toLocaleString("en-US")}`] : [])];
  const baseRect = slideLegendRect(items.length, notes.length, Math.max(0, ...items.map((i) => i.label.length), ...notes.map((n) => n.length * 0.75)), format);
  let rect = options.placement === "hidden" ? null : baseRect ? slidePanelRects(style, hasSummary, baseRect, format).legend : null;
  if (rect && options.placement === "right") {
    const g = slideGeometry(format);
    rect = { ...rect, x: g.w - g.edge - rect.w, y: g.edge + 0.9 };
  }
  return { items, notes, rect };
}

/** 슬라이드 좌표(inch)를 지도 이미지 픽셀 좌표로 바꾼 예약 자리 (라벨 충돌 회피용) */
export function slideReserved(
  pxPerInch: number,
  opts: {
    info?: boolean;
    hasSummary?: boolean;
    style?: PanelStyle;
    infoRect?: Rect | null;
    titleRect?: Rect | null;
    legend?: Rect | null;
    legendBase?: Rect | null;
    calloutLegend?: Rect | null;
    terrainSection?: Rect | null;
    format?: SlideFormat;
  } = {},
): Box[] {
  const format = opts.format ?? "wide";
  const l = slideLayout(format);
  const hasSummary = opts.hasSummary ?? (opts.info !== false && opts.style?.summary !== false);
  const derived = opts.style
    ? slidePanelRects(opts.style, hasSummary, opts.legendBase, format)
    : null;
  const b = (r: Rect): Box => ({ x0: r.x * pxPerInch, y0: r.y * pxPerInch, x1: (r.x + r.w) * pxPerInch, y1: (r.y + r.h) * pxPerInch });
  const title = opts.titleRect ?? derived?.title ?? l.title;
  const info = opts.infoRect ?? (derived ? derived.summary : l.info);
  const legend = opts.legend ?? derived?.legend ?? null;
  return [
    b(title),
    ...(opts.info === false ? [] : info ? [b(info)] : []),
    ...(legend ? [b(legend)] : []),
    ...(opts.calloutLegend ? [b(opts.calloutLegend)] : []),
    ...(opts.terrainSection ? [b(opts.terrainSection)] : []),
    b(l.strip),
  ];
}

/** 가로 방향 지도 중심 위치: 슬라이드에서는 오른쪽 정보 판을 뺀 영역의 가운데 */
export function slideSiteX(
  style?: PanelStyle,
  hasSummary = true,
  format: SlideFormat = "wide",
): number {
  const g = slideGeometry(format);
  const summary = slidePanelRects(style, hasSummary, undefined, format).summary;
  return summary ? (summary.x - g.edge) / 2 / g.w : 0.5;
}

export type LayoutRects = { map: Rect | null; title: Rect; summary: Rect | null; legend: Rect | null; second?: Rect };

function normalized(rect: Rect | null, g: SlideGeometry): Rect | null {
  return rect ? { x: rect.x / g.w, y: rect.y / g.h, w: rect.w / g.w, h: rect.h / g.h } : null;
}

/** 보고서 편집기와 PPT가 공유하는 정규화된 페이지 레이아웃. */
export function layoutRects(layout: ReportLayoutName = "map-summary", format: SlideFormat = "wide"): LayoutRects {
  const g = slideGeometry(format);
  if (layout === "numbers-first") {
    return {
      map: { x: 0.55, y: 0.14, w: 0.42, h: 0.72 },
      title: { x: 0.03, y: 0.03, w: 0.48, h: 0.08 },
      summary: { x: 0.03, y: 0.14, w: 0.48, h: 0.5 },
      legend: { x: 0.03, y: 0.67, w: 0.48, h: 0.19 },
    };
  }
  if (layout === "side-by-side") {
    return {
      map: { x: 0.03, y: 0.14, w: 0.45, h: 0.72 },
      second: { x: 0.52, y: 0.14, w: 0.45, h: 0.72 },
      title: { x: 0.03, y: 0.03, w: 0.94, h: 0.08 },
      summary: null,
      legend: { x: 0.03, y: 0.87, w: 0.94, h: 0.08 },
    };
  }
  const panels = slidePanelRects({}, layout === "map-summary" || layout === "map-charts", undefined, format);
  return {
    map: { x: 0, y: 0, w: 1, h: 1 },
    title: normalized(panels.title, g)!,
    summary: normalized(panels.summary, g),
    legend: normalized(panels.legend, g),
  };
}

export type ChartsColumn = { headline: Rect; stat: Rect; composition: Rect; distance: Rect; sentence: Rect; notesChip: Rect };

/**
 * 「지도 + 그래프」 오른쪽 열의 여섯 칸(슬라이드 inch). 화면 미리보기와 PPT가 같은 함수를 쓴다.
 * 높이 배분은 큰 숫자 20 · 한 줄 통계 6 · 구성비 26 · 거리 32 · 해석 16 %이고, 주석 칩 자리는 해석 몫에서 뗀다(거리 그래프 칸은 줄지 않는다).
 * 바깥 여백은 고정(글자 배율을 따르지 않는다): 거리 그래프 칸이 글자 크기와 상관없이 같은 크기라 기하를 같은 값으로 검증한다.
 * 칸 사이 간격만 글자 배율을 따르며, 위 칸은 아래쪽, 해석 칸은 위쪽에서 뗀다(거리 그래프 칸 자체는 줄이지 않는다).
 */
export function chartsColumnLayout(summaryRect: Rect, scale: number): ChartsColumn {
  const pad = Math.min(0.18, summaryRect.w / 4, summaryRect.h / 4);
  const x = summaryRect.x + pad;
  const w = Math.max(0.01, summaryRect.w - pad * 2);
  const H = Math.max(0.01, summaryRect.h - pad * 2);
  const gap = Math.min(0.04 * scale, H * 0.01);
  const chip = Math.min(0.26, H * 0.06);
  let y = summaryRect.y + pad;
  const take = (share: number, trailingGap = gap): Rect => {
    const h = H * share;
    const rect = { x, y, w, h: h - trailingGap };
    y += h;
    return rect;
  };
  const headline = take(0.2);
  const stat = take(0.06);
  const composition = take(0.26);
  const distanceTop = y;
  const sentenceTop = distanceTop + H * 0.32;
  const bottom = summaryRect.y + pad + H;
  const distance = { x, y: distanceTop, w, h: sentenceTop - distanceTop };
  const sentence = { x, y: sentenceTop + gap, w, h: bottom - chip - sentenceTop - gap };
  const notesChip = { x, y: bottom - chip, w, h: chip };
  return { headline, stat, composition, distance, sentence, notesChip };
}

/** 펼침에서 오른쪽 정보 판(360px)을 뺀 영역의 가운데 (모바일은 0.5) */
export function detailSiteX(width: number, panelW = 360): number {
  if (width <= 720) return 0.5;
  return Math.max(0.3, (width - panelW - 2 * OV.edge) / 2 / width);
}

/** 사각형이 겹치는가 (라벨 충돌 판정) */
export const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
