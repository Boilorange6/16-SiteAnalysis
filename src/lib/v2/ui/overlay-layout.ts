/**
 * 지도 몰입형 오버레이의 위치 문법 (보드 카드 · 펼침 · PPT 슬라이드 공통).
 * 화면(px)과 슬라이드(inch)가 같은 자리 이름·여백·판 스타일을 쓰도록 토큰을 한곳에 둔다. 순수 함수만 있다.
 *
 *  왼쪽 위 = 제목 칩 · 오른쪽 위 = 보고서 칩/북쪽 · 왼쪽 아래 = 핵심 값 카드(+범례)
 *  오른쪽 아래 = 축척 · 맨 아래 = 출처 띠
 */
import { legendItemsForModel, type MapModel } from "./map-layers";
import type { PageStyle } from "./board-state";

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
export function stripText(sourceLine: string, credit = true): string {
  const base = sourceLine === "출처 없음" ? "출처 없음 · 기준일 해당 없음" : sourceLine;
  return credit ? `${base} · ${OV.sourceCredit}` : base;
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

/** 슬라이드(16:9, inch) 오버레이 자리. */
export const SLIDE = { w: 13.333, h: 7.5, edge: 0.3, stripH: 0.36, infoRatio: 0.32 } as const;

export function slideLayout(): { title: Rect; info: Rect; legendX: number; legendBottom: number; strip: Rect; page: Rect } {
  const { w, h, edge, stripH } = SLIDE;
  const infoW = Math.round(w * SLIDE.infoRatio * 100) / 100;
  const stripY = h - stripH;
  return {
    title: { x: edge, y: edge, w: 4.6, h: 0.66 },
    info: { x: w - edge - infoW, y: edge, w: infoW, h: stripY - edge * 1.6 - edge },
    legendX: edge,
    legendBottom: stripY - edge * 0.6,
    strip: { x: 0, y: stripY, w, h: stripH },
    page: { x: w - 1.4, y: stripY, w: 1.3, h: stripH },
  };
}

const panelScale = (value: number | undefined): number => Math.max(0.7, Math.min(1.5, value ?? 1));
export const slidePanelScale = panelScale;

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
  style: Pick<PageStyle, "titleScale" | "summaryScale" | "legendScale"> | undefined,
  hasSummary: boolean,
  legendBase?: Rect | null,
): SlidePanelRects {
  const l = slideLayout();
  const baseLegend = legendBase ?? slideLegendRect(4, 0, 8);
  const titleScale = panelScale(style?.titleScale);
  const summaryScale = panelScale(style?.summaryScale);
  const legendScale = panelScale(style?.legendScale);
  const panelGap = 0.18;
  const maxSideBySideW = Math.max(0, SLIDE.w - 2 * SLIDE.edge - panelGap);
  const requestedTitleW = Math.min(l.title.w * titleScale, SLIDE.w - 2 * SLIDE.edge);
  const requestedSummaryW = Math.min(l.info.w * summaryScale, SLIDE.w - 2 * SLIDE.edge);
  const sideBySideRatio = hasSummary && requestedTitleW + requestedSummaryW > maxSideBySideW
    ? maxSideBySideW / (requestedTitleW + requestedSummaryW)
    : 1;
  const titleW = requestedTitleW * sideBySideRatio;
  const summaryW = requestedSummaryW * sideBySideRatio;
  const safeBottom = l.strip.y - SLIDE.edge * 0.6;
  const safeHeight = Math.max(0, safeBottom - SLIDE.edge);
  const title = scaleAnchoredRect(l.title, titleScale, "top-left", titleW, safeHeight);
  const summary = hasSummary
    ? scaleAnchoredRect(l.info, summaryScale, "top-right", summaryW, safeHeight)
    : null;
  const requestedLegend = baseLegend ? scaleAnchoredRect(baseLegend, legendScale, "bottom-left") : null;
  const legend = requestedLegend
    ? {
        ...requestedLegend,
        w: Math.min(requestedLegend.w, Math.max(0, (summary?.x ?? SLIDE.w - SLIDE.edge) - SLIDE.edge - panelGap)),
      }
    : null;
  return {
    title,
    summary,
    legend,
  };
}

/** 왼쪽 아래 범례 판: 항목 n개 + 문구 m줄. 출처 띠 바로 위에 붙는다 */
export function slideLegendRect(items: number, notes: number, labelChars: number): Rect | null {
  if (items + notes === 0) return null;
  const l = slideLayout();
  const h = 0.16 + items * 0.25 + notes * 0.22;
  const w = Math.min(4.4, Math.max(2.0, 0.75 + labelChars * 0.16));
  return { x: l.legendX, y: l.legendBottom - h, w, h };
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
): SlideCalloutLegendLayout | null {
  if (entries.length === 0 || maxW <= 0) return null;
  const textIn = (value: string, pt: number) => ([...value].reduce((width, ch) => width + (ch.charCodeAt(0) > 0x2e80 ? 1 : 0.56), 0) * pt) / 72;
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

/** 지도 모델 → 범례 항목·문구·자리 (슬라이드 그리기와 지도 이미지의 라벨 회피가 같은 값을 쓴다) */
export function slideLegend(
  model: MapModel,
  includeSite = true,
  style?: Pick<PageStyle, "titleScale" | "summaryScale" | "legendScale">,
  hasSummary = true,
) {
  const items: Array<{ layer: string; label: string; color: string; site?: boolean; badge?: string; symbol?: "rail-axis" | "rail-exit" }> = [
    ...legendItemsForModel(model).filter((item) => item.layer !== "parcel_site" && item.layer !== "pnu"),
    ...(includeSite ? [{ layer: "__site_marker", label: "대지", color: "#111", site: true as const }] : []),
  ];
  const notes = [...model.notes, ...(model.total > model.features.length ? [`표시 ${model.features.length.toLocaleString("en-US")} / 전체 ${model.total.toLocaleString("en-US")}`] : [])];
  const baseRect = slideLegendRect(items.length, notes.length, Math.max(0, ...items.map((i) => i.label.length), ...notes.map((n) => n.length * 0.75)));
  const rect = baseRect ? slidePanelRects(style, hasSummary, baseRect).legend : null;
  return { items, notes, rect };
}

/** 슬라이드 좌표(inch)를 지도 이미지 픽셀 좌표로 바꾼 예약 자리 (라벨 충돌 회피용) */
export function slideReserved(
  pxPerInch: number,
  opts: { info?: boolean; infoRect?: Rect | null; titleRect?: Rect | null; legend?: Rect | null; calloutLegend?: Rect | null } = {},
): Box[] {
  const l = slideLayout();
  const b = (r: Rect): Box => ({ x0: r.x * pxPerInch, y0: r.y * pxPerInch, x1: (r.x + r.w) * pxPerInch, y1: (r.y + r.h) * pxPerInch });
  return [b(opts.titleRect ?? l.title), ...(opts.info === false ? [] : [b(opts.infoRect ?? l.info)]), ...(opts.legend ? [b(opts.legend)] : []), ...(opts.calloutLegend ? [b(opts.calloutLegend)] : []), b(l.strip)];
}

/** 가로 방향 지도 중심 위치: 슬라이드에서는 오른쪽 정보 판을 뺀 영역의 가운데 */
export function slideSiteX(
  style?: Pick<PageStyle, "summaryScale">,
  hasSummary = true,
): number {
  const l = slideLayout();
  const summary = slidePanelRects(style, hasSummary).summary;
  return summary ? (summary.x - SLIDE.edge) / 2 / SLIDE.w : 0.5;
}

/** 펼침에서 오른쪽 정보 판(360px)을 뺀 영역의 가운데 (모바일은 0.5) */
export function detailSiteX(width: number, panelW = 360): number {
  if (width <= 720) return 0.5;
  return Math.max(0.3, (width - panelW - 2 * OV.edge) / 2 / width);
}

/** 사각형이 겹치는가 (라벨 충돌 판정) */
export const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
