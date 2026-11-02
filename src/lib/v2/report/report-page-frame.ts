/**
 * 보고서 타일 장(지도 + 숫자 · 지도 + 그래프) 한 쪽의 계산 묶음(spec 2026-10-30 §3·§4·§7).
 * 제목 칩 크기·범례 판 크기·핵심 숫자 카드 맞춤·장 기하·각주 글·그래프 카드 안쪽 칸을 한 번에 구한다.
 * 화면 SlideSurface가 이 값으로 그리고, PPT(Task 7)도 같은 값을 읽는다. 호출 순서는 `keyCardBox` → `keyFigureFit` → `reportPageGeometry`.
 */
import type { PlannedSlide } from "./report-plan";
import type { KeyFigure } from "../tile/types";
import type { AnalysisCharts } from "./analysis-charts";
import type { ChartBox } from "./chart-geometry";
import type { CalloutOverviewFrame } from "./types";
import { keyFigureFit, sentenceFit, type KeyFigureFit } from "./key-figure-fit";
import { DEFAULT_REPORT_FONT_SIZES, type PagePanels } from "./report-doc";
import { fitFooterText, footerBasemaps, fontSizeForStyle, textIn } from "./pptx-kit";
import { keyCardBox, reportPageGeometry, type PageLayoutKind, type ReportPageGeometry } from "../ui/report-page-layout";
import { calloutLegendEntries, slideCalloutLegendLayout, slideGeometry, slideLegend, type Rect, type SlideFormat } from "../ui/overlay-layout";
import { calloutPageTitleTail } from "../ui/callout-layout";
import type { BasemapChoice } from "../ui/map-projection";

type TileSlide = Extract<PlannedSlide, { kind: "tile" }>;

/** 제목 칩 높이 48 px */
export const TITLE_CHIP_H = 0.5;
/** 그래프 카드 안쪽 여백: 왼쪽·오른쪽 18 px, 위 14 px(제목이 맨 위), 아래 12 px */
const CHART_PAD = { x: 0.1875, top: 0.146, bottom: 0.125 };

export type LegendFit = {
  size: { w: number; h: number };
  cols: number; rows: number;
  /** 열 폭(inch). 항목은 위에서 아래로 가 아니라 왼쪽에서 오른쪽으로 채운다(시안). */
  colWidths: number[];
  /** F1 범례 pt / 10 */
  scale: number;
  labelPt: number; notePt: number;
  rowH: number; noteH: number; padding: { top: number; right: number; bottom: number; left: number };
  iconW: number; iconGap: number; colGap: number;
  items: ReturnType<typeof slideLegend>["items"];
  notes: string[];
};

export type ReportPageFrame = {
  layout: PageLayoutKind;
  geometry: ReportPageGeometry;
  /** 카드를 그리는 장이면 맞춤, 카드가 없는 장(핵심 숫자 없음·카드 지움)이면 null */
  fit: KeyFigureFit | null;
  figure: KeyFigure | null;
  summaryPt: number;
  /** ② 열 맨 아래 해석 한 줄(카드가 없어도 사용자가 고친 요약은 그린다). ①은 카드 안(`fit.rows.sentence`)이라 null이다. */
  sentence: { lines: string[]; pt: number; height: number } | null;
  title: { text: string; kind: string; pt: number; kindPt: number };
  /** 지도 범례 판(설명선 개요가 아닐 때) */
  legend: LegendFit | null;
  /** 설명선 개요(A05·A06)의 범례 판 크기와 줄바꿈 폭 */
  calloutLegend: { size: { w: number; h: number }; maxW: number } | null;
  /** 설명선 개요의 점·범례 그림이 쓰는 틀(지도 틀·범례 자리). 아니면 null. a05/report.ts가 이 틀에 그린다. */
  calloutOverview: CalloutOverviewFrame | null;
  /** `주석 N` 칩에 올릴 중복 없는 한계·메모(카드에서 `+n`으로 접힌 배지 글 포함) */
  notes: string[];
  footer: { text: string; pt: number };
  /** ②: 그래프 자료(그 쪽이 그리는 지도로 센 것)와 그래프 카드 안쪽(제목이 그 맨 위) 칸 */
  charts: AnalysisCharts | null;
  chart1: ChartBox | null; chart2: ChartBox | null;
  /** 그래프 글자 배율(요약 pt / 13) */
  chartScale: number;
};

/**
 * 새 배치로 그리는 장인가. 설명선 상세 장(`callout.page > 0`, Task 7 뒤)·D17 단면 장(Task 9)·결과 없음 장은 옛 경로다.
 * 설명선 개요(A05·A06 `callout.page === 0`)는 새 배치다(spec §4-2·§5).
 */
export function usesReportPageFrame(slide: PlannedSlide): boolean {
  if (slide.kind !== "tile") return false;
  const layout = slide.page?.layout;
  if (layout !== "map-key" && layout !== "map-charts") return false;
  if (slide.body.kind !== "result" || slide.missing || (slide.callout && slide.callout.page > 0)) return false;
  if (slide.view.code === "D17" && !!slide.view.terrainSections && !!slide.terrainSection) return false;
  return !!slide.map || !!slide.mass || !!slide.rose;
}

/**
 * 새 배치에서 요소별로 옮길 수 있는가·크기 핸들이 있는가(spec §7). 끌기·키보드 이동·핸들·`위치 초기화`가 모두 이 표 하나를 읽는다.
 * ① 숫자 카드만 옮기고 크기를 바꾼다. 제목 칩·범례는 옮기기만(크기는 글자가 정한다), ② 열·각주 띠는 고르고 지우기만 된다.
 */
export function framePanelRule(layout: PageLayoutKind, key: "title" | "summary" | "legend" | "source"): { movable: boolean; resizable: boolean } {
  if (key === "source") return { movable: false, resizable: false };
  if (key === "summary") return { movable: layout === "map-key", resizable: layout === "map-key" };
  return { movable: true, resizable: false };
}

/** 제목 칩 안쪽 칸(inch): 좌우 여백·색 점·사이 간격·종류 칩 안쪽 여백. 화면 CSS와 PPT가 이 값을 쓴다. */
export const TITLE_BOX = { padX: 0.167, dot: 0.125, gap: 0.1, kindPadX: 0.085, kindPadY: 0.03, kindRadius: 0.052 } as const;
/** 각주 띠 안쪽 칸(inch): 좌우 여백·글과 쪽 번호 사이 간격, 쪽 번호 pt(시안 11 px) */
export const FOOTER_BOX = { padX: 0.25, gap: 0.2, pagePt: 8.25 } as const;

const titleKindPt = (titlePt: number) => titlePt * (9 / 15.75);

/** 제목 칩 폭: 여백 + 색 점 + 제목 + 종류 칩. 글자 폭 어림은 pptx-kit의 textIn이다. */
function titleChipSize(text: string, kind: string, titlePt: number): { w: number; h: number } {
  const kindW = kind ? textIn(kind, titleKindPt(titlePt)) + 2 * TITLE_BOX.kindPadX + TITLE_BOX.gap : 0;
  return { w: Math.min(6.5, 2 * TITLE_BOX.padX + TITLE_BOX.dot + TITLE_BOX.gap + textIn(text, titlePt) * 1.04 + kindW), h: TITLE_CHIP_H };
}

/** 범례 판: 내용 크기. 6개 이상이면 2열, 항목은 왼쪽에서 오른쪽으로 채운다. */
export function legendFit(slide: TileSlide): LegendFit | null {
  const model = slide.map;
  if (!model) return null;
  const options = slide.page?.kind === "tile" ? slide.page.frame.legend : undefined;
  if (options?.placement === "hidden") return null;
  const format = (slide.format ?? "wide") as SlideFormat;
  const { items, notes } = slideLegend(model, !slide.muted, undefined, true, format, options);
  if (items.length === 0 && notes.length === 0) return null;
  const scale = fontSizeForStyle(slide.style, "legend") / DEFAULT_REPORT_FONT_SIZES.legend;
  const labelPt = 9 * scale;
  const notePt = 8 * scale;
  const rowH = 0.198 * scale;
  const noteH = 0.17 * scale;
  const padding = { top: 0.104 * scale, right: 0.146 * scale, bottom: 0.104 * scale, left: 0.125 * scale };
  const iconW = 0.1875 * scale;
  const iconGap = 0.073 * scale;
  const colGap = 0.1667 * scale;
  const cols = items.length >= 6 ? 2 : 1;
  const rows = Math.ceil(items.length / cols);
  const colWidths = Array.from({ length: cols }, (_, c) => iconW + iconGap + Math.max(0, ...items.filter((_, i) => i % cols === c).map((item) => textIn(item.label, labelPt) * 1.04)));
  const noteW = Math.max(0, ...notes.map((note) => textIn(note, notePt) * 1.04));
  const inner = Math.max(colWidths.reduce((sum, w) => sum + w, 0) + colGap * (cols - 1), noteW);
  const w = Math.min(5, padding.left + padding.right + inner);
  const h = padding.top + padding.bottom + rows * rowH + notes.length * noteH;
  return { size: { w, h }, cols, rows, colWidths, scale, labelPt, notePt, rowH, noteH, padding, iconW, iconGap, colGap, items, notes };
}

/** 한 줄에 맞게 자른다(…). textIn 어림이라 PPT와 화면이 같은 글을 쓴다. */
function oneLine(text: string, pt: number, width: number): string {
  if (textIn(text, pt) <= width) return text;
  let cut = [...text];
  while (cut.length > 1 && textIn(`${cut.join("")}…`, pt) > width) cut = cut.slice(0, -1);
  return `${cut.join("").trimEnd()}…`;
}

/**
 * 각주 띠 글. 글자 순서는 `출처 … · {바탕지도 출처} · {한계}`지만 자리는 한계부터 잡는다(Ruling 23):
 * 한계(그 장의 첫 한계, 없으면 첫 메모)는 폭의 50 %까지(넘치면 끝이 …), 바탕지도 출처(credit)는 출처 표기 조건이라 자르지 않으며
 * 남은 폭에 출처를 넣는다. 출처가 넘치면 먼저 `제공처 미기록 · `(자료 없음 잡음, 출처 장에는 남는다)을 빼고, 그래도 넘치면
 * `fitFooterText`의 `… 외 n건 · 출처 장 참조` 요약을 쓴다. 바탕지도를 그린 장만 credit이 붙는다(§3-3).
 */
export function footnoteText(slide: TileSlide, basemap: BasemapChoice | undefined, width: number): { text: string; pt: number } {
  const pt = fontSizeForStyle(slide.style, "source") * (7.5 / DEFAULT_REPORT_FONT_SIZES.source);
  const bare = fitFooterText(slide.footer, false, 1e6, 9, []).text;
  const credit = slide.map ? fitFooterText(slide.footer, true, 1e6, 9, footerBasemaps(slide, basemap)).text.slice(bare.length) : "";
  const limit = slide.view.caveats[0] ?? slide.view.notes[0];
  const fixed = `${credit}${limit ? ` · ${oneLine(limit, pt, width * 0.5)}` : ""}`;
  const budget = Math.max(0.5, width - textIn(fixed, pt));
  const cleaned = bare.replace(/제공처 미기록 · /g, "");
  // textIn은 pt에 비례하므로 7 pt에서 폭 budget × 7 / pt에 맞는 요약은 pt에서 폭 budget에 맞는다.
  const source = textIn(cleaned, pt) <= budget ? cleaned : fitFooterText(cleaned, false, (budget * 7) / pt, 7, []).text;
  return { text: `${source}${fixed}`, pt };
}

export type PixelBox = { x0: number; y0: number; x1: number; y1: number };

/**
 * 지도 장면(`buildMapScene`)이 피해야 할 자리(px, 지도 틀 왼쪽 위 기준). 제목 칩·범례 판과, ①은 숫자 카드(+주석 칩)가 있는 왼쪽 띠다.
 * 왼쪽 띠는 지도 틀 맨 위부터 시작한다: 설명선 열의 시작 높이는 첫 카드 자리와 겹치는 상자만 밀어 내리므로(map-scene `overlayCalloutTop`),
 * 카드 위 틈에서 시작하지 않으면 설명선이 카드 옆구리로 들어온다(시안 A-zoning의 avoid도 같다). 방위표·축척 막대는 장면이 자기 상자를 직접 안다.
 */
export function reportMapAvoid(geometry: ReportPageGeometry, unit: number): PixelBox[] {
  const box = (r: Rect): PixelBox => ({ x0: r.x * unit, y0: r.y * unit, x1: (r.x + r.w) * unit, y1: (r.y + r.h) * unit });
  const boxes: PixelBox[] = [box(geometry.title)];
  if (geometry.keyCard && !geometry.column) {
    // 아래 여유 0.35 in: 설명선 카드 열이 카드 띠 아래에서 시작해도 지시선이 카드 오른쪽 아래 모서리·주석 칩 곁을 지나지 않게 한다
    // (대치동 503 A12에서 여유 0이면 칩에 닿고, 0.5 in이면 설명선 하나가 자리를 잃는다. 시안 A-zoning의 avoid도 카드보다 넉넉했다).
    const bottom = (geometry.keyNotesChip ? geometry.keyNotesChip.y + geometry.keyNotesChip.h : geometry.keyCard.y + geometry.keyCard.h) + 0.35;
    boxes.push(box({ x: geometry.keyCard.x, y: 0, w: geometry.keyCard.w, h: bottom }));
  }
  if (geometry.legend) boxes.push(box(geometry.legend));
  return boxes;
}

const sameNotes = (slide: TileSlide): string[] => [...new Set([...slide.view.caveats, ...slide.view.notes])];

export function reportPageFrame(slide: TileSlide, charts: AnalysisCharts | null, basemap?: BasemapChoice): ReportPageFrame {
  const format = (slide.format ?? "wide") as SlideFormat;
  const view = slide.view;
  const layout: PageLayoutKind = slide.page?.layout === "map-charts" && charts ? "map-charts" : "map-key";
  const panels = slide.style.panels as PagePanels | undefined;
  const figure = view.keyFigure;
  // 핵심 숫자가 없는 ①은 카드를 두지 않는다(D01·결과 없음). ②는 카드 없이도 그래프 열은 남는다.
  const summaryDeleted = slide.style.summary === false || (!figure && layout === "map-key");
  const baseNotes = summaryDeleted ? [] : sameNotes(slide);
  const summaryPt = fontSizeForStyle(slide.style, "summary");
  const titlePt = fontSizeForStyle(slide.style, "title") * (15.75 / DEFAULT_REPORT_FONT_SIZES.title);
  const callout = slide.callout && format === "wide" ? slide.callout : null;
  const titleKind = [view.kindLabel, callout ? calloutPageTitleTail(callout.model.complexes, callout.page, callout.model.unit, callout.shownKeys, callout.numberStart ?? 1) : null].filter(Boolean).join(" · ");
  const titleText = slide.page?.titleOverride ?? view.title;
  const titleSize = titleChipSize(titleText, titleKind, titlePt);
  // 설명선 개요(A05·A06)의 범례는 지도 범례가 아니라 설명선 범례(준공 연대·크기)다. 같은 범례 자리를 쓰고 그 판은 설명선 그림이 그린다.
  const legendScale = fontSizeForStyle(slide.style, "legend") / DEFAULT_REPORT_FONT_SIZES.legend;
  const legendOptions = slide.page?.kind === "tile" ? slide.page.frame.legend : undefined;
  let calloutLegend: ReportPageFrame["calloutLegend"] = null;
  if (callout) {
    const g = slideGeometry(format);
    const mapW = layout === "map-charts" && !summaryDeleted ? g.w * (1 - g.infoRatio) : g.w;
    const maxW = Math.max(3, mapW - 0.5 - 3.4); // 오른쪽 아래 축척 막대 자리를 남긴다
    const laid = slideCalloutLegendLayout(calloutLegendEntries(callout.model, legendOptions), 0, 0, maxW, legendScale);
    calloutLegend = laid ? { size: { w: laid.rect.w, h: laid.rect.h }, maxW } : null;
  }
  const legend = callout ? null : legendFit(slide);
  const legendSize = calloutLegend?.size ?? legend?.size ?? null;
  const sentence = slide.page?.summaryOverride ?? view.sentence;

  const run = (hasNotes: boolean) => {
    const box = keyCardBox({ layout, format, panels, summaryDeleted, titleSize, legendSize, notes: hasNotes });
    const fit = figure && !summaryDeleted
      ? keyFigureFit({ // 카드 안 글은 그 쪽이 그리는 보기의 핵심 숫자·배지·등급·필터·해석이다
          figure,
          badges: view.badges.map((badge) => badge.text),
          grades: view.grades.map((grade) => `${grade.target} ${grade.label}`),
          filterLine: view.filterLine ?? null,
          sentence,
          width: box.w,
          columns: layout === "map-charts" ? 3 : 2,
          summaryPt,
          ...(box.h !== null ? { maxHeight: box.h } : {}),
          notes: hasNotes,
        })
      : null;
    // 카드가 없는 ②도 해석 한 줄(사용자가 고친 요약 등)은 열 맨 아래에 그린다.
    const sentenceInfo = fit
      ? { lines: fit.sentenceLines, pt: fit.sentencePt, height: fit.sentenceHeight }
      : layout === "map-charts" && !summaryDeleted
        ? sentenceFit({ sentence, width: box.w, columns: 3, summaryPt, notes: hasNotes })
        : null;
    return { fit, sentenceInfo };
  };
  // 카드에서 접힌 배지 글은 주석 칩 목록에 합친다(정직성 배지를 잃지 않는다). 칩이 새로 생기면 칩 자리를 두고 다시 맞춘다.
  let hasNotes = baseNotes.length > 0;
  let { fit, sentenceInfo } = run(hasNotes);
  const notes = [...new Set([...baseNotes, ...(fit?.badgesFolded ?? [])])];
  if (!hasNotes && notes.length > 0) {
    hasNotes = true;
    ({ fit, sentenceInfo } = run(true));
  }
  const geometry = reportPageGeometry({
    layout, format, panels, summaryDeleted, titleSize,
    keyCardHeight: fit?.height ?? 0, legendSize,
    chartSlots: layout === "map-charts" && !summaryDeleted ? 2 : 0,
    sentenceHeight: sentenceInfo?.height ?? 0,
    notes: hasNotes,
  });
  const inner = (rect: Rect | null | undefined): ChartBox | null => rect ? { x: rect.x + CHART_PAD.x, y: rect.y + CHART_PAD.top, w: Math.max(0.1, rect.w - CHART_PAD.x * 2), h: Math.max(0.1, rect.h - CHART_PAD.top - CHART_PAD.bottom) } : null;
  const footerWidth = geometry.footer.w - 2 * FOOTER_BOX.padX - geometry.pageNo.w - FOOTER_BOX.gap;
  return {
    layout, geometry, fit, figure: summaryDeleted ? null : figure, summaryPt, sentence: sentenceInfo,
    title: { text: titleText, kind: titleKind, pt: titlePt, kindPt: titleKindPt(titlePt) },
    legend, calloutLegend,
    calloutOverview: callout && callout.page === 0 ? { map: geometry.map, legend: calloutLegend ? geometry.legend : null, legendMaxW: calloutLegend?.maxW ?? 0 } : null,
    notes,
    footer: footnoteText(slide, basemap, footerWidth),
    charts: layout === "map-charts" ? charts : null,
    chart1: inner(geometry.column?.chart1), chart2: inner(geometry.column?.chart2),
    chartScale: summaryPt / DEFAULT_REPORT_FONT_SIZES.summary,
  };
}
