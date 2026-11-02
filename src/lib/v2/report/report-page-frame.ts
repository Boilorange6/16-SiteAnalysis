/**
 * 보고서 타일 장(지도 + 숫자 · 지도 + 그래프) 한 쪽의 계산 묶음(spec 2026-10-30 §3·§4·§7).
 * 제목 칩 크기·범례 판 크기·핵심 숫자 카드 맞춤·장 기하·각주 글·그래프 카드 안쪽 칸을 한 번에 구한다.
 * 화면 SlideSurface가 이 값으로 그리고, PPT(Task 7)도 같은 값을 읽는다. 호출 순서는 `keyCardBox` → `keyFigureFit` → `reportPageGeometry`.
 */
import type { PlannedSlide } from "./report-plan";
import type { KeyFigure } from "../tile/types";
import { slideCharts, slideTerrainSection, type AnalysisCharts } from "./analysis-charts";
import { compositionContentHeight, type ChartBox } from "./chart-geometry";
import type { CalloutOverviewFrame } from "./types";
import { wrapToLines } from "./analysis-column-fit";
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
  rowH: number;
  /** 행마다 높이(그 행에서 가장 많은 줄을 따른다)와 항목 글 한 줄 높이 */
  rowHeights: number[]; labelLineH: number;
  noteH: number; noteGap: number; padding: { top: number; right: number; bottom: number; left: number };
  iconW: number; iconGap: number; colGap: number;
  items: ReturnType<typeof slideLegend>["items"];
  notes: string[];
  /** 그리는 항목 글(2열이 5 in를 넘으면 최대 2줄로 접고, 1열로도 넘는 항목만 …)과 잘림 여부. `labels`는 줄을 `\n`으로 이은 글. 잘린 글의 전문은 `items[i].label`이다. */
  labels: string[]; labelLines: string[][]; labelClipped: boolean[];
  /** 그리는 주석 줄(주석마다 최대 2줄, 넘치면 …)과 잘림 여부. 전문은 `notes[i]`다. */
  noteLines: string[][]; noteClipped: boolean[];
  /** 항목 칸·주석 칸(판 왼쪽 위 기준 inch). 화면과 PPT는 이 자리에 그리기만 한다. */
  itemRects: Rect[]; noteRects: Rect[];
};

export type ReportPageFrame = {
  layout: PageLayoutKind;
  geometry: ReportPageGeometry;
  /** 카드를 그리는 장이면 맞춤, 카드가 없는 장(핵심 숫자 없음·카드 지움)이면 null */
  fit: KeyFigureFit | null;
  figure: KeyFigure | null;
  summaryPt: number;
  /**
   * 해석 한 줄(줄·pt·높이). 카드가 있으면 `fit`의 값 그대로다(①은 카드 안 `fit.rows.sentence`에, ②는 열 맨 아래 `AnalysisColumn`이 그린다).
   * 카드가 없는 ②는 사용자가 고친 요약도 그리도록 따로 센 값이고, 해석이 없거나 ① 카드 없음이면 null이다.
   */
  sentence: { lines: string[]; pt: number; height: number; /** …로 잘렸다: 화면은 전문(`full`)을 title로 단다 */ clipped: boolean; full: string } | null;
  /** 제목 칩에 그리는 글(한 줄, 넘치면 …)과 전문. 화면은 잘렸을 때 전문을 title로 단다. */
  title: { text: string; fullText: string; titleClipped: boolean; kind: string; fullKind: string; kindClipped: boolean; pt: number; kindPt: number };
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
  /** D17 단면 장(②): 지형 단면 카드 자리 = 그래프 카드 1(`column.chart1`). 단면 장이 아니거나 자리가 없으면 null. 그래프 카드 2는 없다. */
  terrain: Rect | null;
};

/**
 * 새 배치로 그리는 장인가. 설명선 상세 장(`callout.page > 0`, Task 7 뒤)·결과 없음 장은 옛 경로다.
 * 설명선 개요(A05·A06 `callout.page === 0`)는 새 배치다(spec §4-2·§5).
 */
export function usesReportPageFrame(slide: PlannedSlide): boolean {
  if (slide.kind !== "tile") return false;
  const layout = slide.page?.layout;
  if (layout !== "map-key" && layout !== "map-charts") return false;
  if (slide.body.kind !== "result" || slide.missing || (slide.callout && slide.callout.page > 0)) return false;
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

/** 제목 칩 최대 폭과, 종류 칩이 길어도 제목 글에 남기는 최소 폭 */
const TITLE_CHIP_MAX_W = 6.5;
const TITLE_TEXT_MIN_W = 1;

/**
 * 제목 칩 크기와 그리는 글: 여백 + 색 점 + 제목 + 종류 칩. 글자 폭 어림은 pptx-kit의 textIn이다.
 * 제목은 한 줄로 최대 폭 안에 자르고(…) 종류 칩이 너무 길면 그것도 자른다. 화면과 PPT는 자른 글을 그대로 그린다.
 */
function titleChipFit(text: string, kind: string, titlePt: number): { w: number; h: number; text: string; kind: string; titleClipped: boolean; kindClipped: boolean } {
  const kindPt = titleKindPt(titlePt);
  const chrome = 2 * TITLE_BOX.padX + TITLE_BOX.dot + TITLE_BOX.gap;
  const kindExtra = 2 * TITLE_BOX.kindPadX + TITLE_BOX.gap;
  let kindText = kind;
  if (kind && chrome + textIn(kind, kindPt) + kindExtra + TITLE_TEXT_MIN_W > TITLE_CHIP_MAX_W) kindText = oneLine(kind, kindPt, TITLE_CHIP_MAX_W - chrome - kindExtra - TITLE_TEXT_MIN_W);
  const kindW = kindText ? textIn(kindText, kindPt) + kindExtra : 0;
  const room = (TITLE_CHIP_MAX_W - chrome - kindW) / 1.04;
  const titleText = oneLine(text, titlePt, room);
  return { w: Math.min(TITLE_CHIP_MAX_W, chrome + textIn(titleText, titlePt) * 1.04 + kindW), h: TITLE_CHIP_H, text: titleText, kind: kindText, titleClipped: titleText !== text, kindClipped: kindText !== kind };
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
  return legendLayout(items, notes, fontSizeForStyle(slide.style, "legend") / DEFAULT_REPORT_FONT_SIZES.legend);
}

/** 판 최대 폭(inch)과, 항목이 이보다 좁을 때 주석을 접는 폭(Ruling 30) */
const LEGEND_MAX_W = 5;
const LEGEND_NOTE_W = 2.6;

/**
 * 범례 판의 폭·열·줄·칸을 정한다(Ruling 30). 판 폭의 뼈대는 항목이고, 주석은 항목 폭(좁으면 2.6 in까지)으로 접어 최대 2줄이다.
 * 2열이 5 in를 넘으면 2열을 유지하고 항목 이름을 열 폭에 맞춰 최대 2줄로 접는다(Ruling 31). 접어도 안 되는 항목이 있을 때만 1열로 내리고,
 * 1열로도 넘는 항목만 …로 줄인다. 높이는 실제 줄 수의 합이다.
 */
export function legendLayout(items: LegendFit["items"], notes: string[], scale: number): LegendFit {
  const labelPt = 9 * scale;
  const notePt = 8 * scale;
  const rowH = 0.198 * scale;
  const noteH = 0.1445 * scale;
  const noteGap = 0.0255 * scale;
  const padding = { top: 0.104 * scale, right: 0.146 * scale, bottom: 0.104 * scale, left: 0.125 * scale };
  const iconW = 0.1875 * scale;
  const iconGap = 0.073 * scale;
  const colGap = 0.1667 * scale;
  const labelLineH = labelPt / 72 * 1.25; // 화면 .legendText line-height 1.25
  const maxInner = LEGEND_MAX_W - padding.left - padding.right;
  // 글자 폭 어림의 오차(영문 대문자·− 기호는 0.56 em보다 넓다)와 항목 칸 테두리를 비율 + 고정 여유로 받는다.
  const labelW = (label: string) => textIn(label, labelPt) * 1.1 + 0.05 * scale;
  const span = (widths: number[]) => widths.reduce((sum, w) => sum + w, 0) + colGap * (widths.length - 1);
  const widthsOf = (cols: number, linesOf: string[][]) => Array.from({ length: cols }, (_, c) => iconW + iconGap + Math.max(0, ...linesOf.filter((_, i) => i % cols === c).flatMap((lines) => lines.map(labelW))));
  const oneLines = items.map((item) => [item.label]);
  // 2열이 5 in 안이면 한 줄씩. 넘으면 2열을 유지하고 열 폭에 맞춰 최대 2줄로 접는다(Ruling 31). 접어도 안 되는 항목이 있을 때만 1열.
  let cols = items.length >= 6 ? 2 : 1;
  let linesOf = oneLines;
  if (cols === 2 && span(widthsOf(2, oneLines)) > maxInner) {
    const colRoom = (maxInner - colGap) / 2 - iconW - iconGap;
    const folded = items.map((item) => foldLabel(item.label, labelPt, colRoom, 0.05 * scale));
    if (folded.every((lines) => lines !== null)) linesOf = folded as string[][];
    else cols = 1;
  }
  const rows = Math.ceil(items.length / cols);
  const colWidths = widthsOf(cols, linesOf).map((w) => Math.min(w, maxInner));
  const labelRoom = maxInner - iconW - iconGap;
  // 1열로도 넘는 항목만 …로 줄인다.
  const labelLines = linesOf.map((lines) => (lines.every((line) => labelW(line) <= labelRoom) ? lines : [oneLine(lines.join(" "), labelPt, (labelRoom - 0.05 * scale) / 1.1)]));
  const labels = labelLines.map((lines) => lines.join("\n"));
  // 행 높이는 그 행에서 가장 많은 줄을 따른다. 항목 칸은 행 높이를 쓴다(강조 면이 한 행에서 같은 높이).
  const rowHeights = Array.from({ length: rows }, (_, r) => rowH + (Math.max(1, ...labelLines.slice(r * cols, (r + 1) * cols).map((lines) => lines.length)) - 1) * labelLineH);
  const itemsW = items.length > 0 ? span(colWidths) : 0;
  const longestNote = Math.max(0, ...notes.map((note) => textIn(note, notePt) * 1.101)); // wrapToLines의 10 % 여유: 이 폭이면 한 줄에 든다
  const noteW = Math.max(itemsW, Math.min(LEGEND_NOTE_W, maxInner, longestNote));
  const noteLines = notes.map((note) => wrapToLines(note, notePt, noteW, 2));
  const noteClipped = notes.map((note) => wrapToLines(note, notePt, noteW, 3).length > 2);
  const itemRects = items.map((_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return { x: padding.left + colWidths.slice(0, col).reduce((sum, w) => sum + w + colGap, 0), y: padding.top + rowHeights.slice(0, row).reduce((sum, h) => sum + h, 0), w: colWidths[col]!, h: rowHeights[row]! };
  });
  let y = padding.top + rowHeights.reduce((sum, h) => sum + h, 0) + (notes.length > 0 ? noteGap : 0);
  const noteRects = noteLines.map((lines) => {
    const rect = { x: padding.left, y, w: noteW, h: lines.length * noteH };
    y += rect.h;
    return rect;
  });
  const size = { w: padding.left + padding.right + Math.max(itemsW, noteW), h: y + padding.bottom };
  return { size, cols, rows, colWidths, scale, labelPt, notePt, rowH, rowHeights, labelLineH, noteH, noteGap, padding, iconW, iconGap, colGap, items, notes, labels, labelLines, labelClipped: labelLines.map((lines, i) => lines !== linesOf[i]), noteLines, noteClipped, itemRects, noteRects };
}

/**
 * 항목 이름을 폭 `room`(칸 테두리 여유 `pad` 포함)에 맞춰 최대 2줄로 접는다. ` · ` 앞에서 먼저 끊고, 그래도 안 되면 공백에서 끊는다.
 * 2줄로도 안 들어가면 null.
 */
function foldLabel(label: string, pt: number, room: number, pad: number): string[] | null {
  const fits = (text: string) => textIn(text, pt) * 1.1 + pad <= room;
  if (fits(label)) return [label];
  const [head, ...rest] = label.split(" · ");
  const tail = rest.join(" · ");
  if (tail && fits(head!) && fits(tail)) return [head!, tail];
  const lines = wrapToLines(label, pt, room - pad, 3);
  return lines.length <= 2 && lines.every(fits) ? lines : null;
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
 * 어떤 글자 크기·판형에서도 글 전체가 `width` 안이고 `출처`로 시작한다. 모자라면 한계의 끝이 먼저, 그다음 출처 요약이 줄고 credit은 남는다.
 */
export function footnoteText(slide: TileSlide, basemap: BasemapChoice | undefined, width: number, filterInFootnote = false): { text: string; pt: number } {
  const pt = fontSizeForStyle(slide.style, "source") * (7.5 / DEFAULT_REPORT_FONT_SIZES.source);
  // 필터 줄은 출처가 아니다(Ruling 27): 계획이 footer 앞에 붙인 `적용 필터: … · `를 먼저 뗀다. 숫자 카드에 전문이 들어가면 각주에는 넣지 않고,
  // 카드가 없거나 카드 두 줄에서 잘린 쪽(`filterInFootnote`, Ruling 28)만 한계 자리 맨 앞에 둔다(필터가 한계보다 먼저 자리를 잡는다).
  const filterLine = slide.callout?.filterLine ?? slide.view.filterLine ?? null;
  const filtered = !!filterLine && slide.footer.startsWith(`${filterLine} · `);
  const footer = filtered ? slide.footer.slice(filterLine.length + 3) : slide.footer;
  const bare = fitFooterText(footer, false, 1e6, 9, []).text;
  // 바탕지도를 실제로 그린 장만 credit이 붙는다: 지도 없는 장(그림)과 바탕을 끈 장(`frame.basemap: "none"` → white)에는 없다(§3-3·§6-2).
  const drawn = slide.map ? footerBasemaps(slide, basemap).filter((layer) => layer !== "white") : [];
  const credit = drawn.length > 0 ? fitFooterText(footer, true, 1e6, 9, drawn).text.slice(bare.length) : "";
  const filterText = filterInFootnote ? filterLine : null;
  const caveat = slide.view.caveats[0] ?? slide.view.notes[0];
  const limit = [filterText, caveat].filter(Boolean).join(" · ");
  const cleaned = bare.replace(/제공처 미기록 · /g, "");
  const shares = [0.5, 0.4, 0.3, 0.2, 0.1, 0.05];
  const cut = (text: string) => shares.map((share) => oneLine(text, pt, width * share));
  // 한계 폭을 50 % → 5 %로 줄여 가며 남은 폭에 출처(전체 또는 요약)가 들어가는 첫 조합을 쓴다.
  // 각주의 필터는 쪽에 하나뿐인 전문이므로(Ruling 28) 한계만 줄이고, 그다음 한계를 빼고, 그래도 안 들어가는 판에서만 필터 끝을 자른다.
  const limits = filterText ? [...(caveat ? cut(caveat).map((text) => `${filterText} · ${text}`) : []), filterText, ...cut(filterText)] : limit ? cut(limit) : [""];
  for (const text of limits) {
    const fixed = `${credit}${text ? ` · ${text}` : ""}`;
    const budget = width - textIn(fixed, pt);
    if (budget <= 0) continue;
    // textIn은 pt에 비례하므로 7 pt에서 폭 budget × 7 / pt에 맞는 요약은 pt에서 폭 budget에 맞는다.
    const source = textIn(cleaned, pt) <= budget ? cleaned : fitFooterText(cleaned, false, (budget * 7) / pt, 7, []).text;
    if (source.startsWith("출처") && textIn(source, pt) <= budget) return { text: `${source}${fixed}`, pt };
  }
  // 한계를 다 줄여도 안 들어가면(아주 좁은 판) 한계를 빼고 출처를 …로 닫는다. credit은 그대로 둔다.
  const rest = Math.max(textIn("출처 …", pt), width - textIn(credit, pt));
  return { text: `${oneLine(cleaned.startsWith("출처") ? cleaned : `출처 ${cleaned}`, pt, rest)}${credit}`, pt };
}

/**
 * PPT·지도 그림(map-image)용 입구: 새 배치로 그리는 장(`usesReportPageFrame`)이면 그 장의 계산 묶음, 아니면 null.
 * 그래프 자료는 화면과 같은 판정(`map-charts`이면 `slideCharts`, 끈 레이어 반영)으로 센다.
 */
export function pageFrameFor(slide: PlannedSlide, basemap?: BasemapChoice): ReportPageFrame | null {
  if (slide.kind !== "tile" || !usesReportPageFrame(slide)) return null;
  const hidden = slide.page?.kind === "tile" ? slide.page.frame?.hiddenLayers : undefined;
  return reportPageFrame(slide, slide.page?.layout === "map-charts" ? slideCharts(slide, hidden) : null, basemap);
}

/**
 * 그림 장(바람장미 D22·3D 매스 S01)의 그림 장면 크기(px). 그림은 기하 `map` 틀을 채우므로 폭 960 px·틀 모양이다.
 * 화면 `FigureLayer`와 그림 만들기(`map-image.ts`)가 같은 값을 쓴다(1 in = `scenePxPerInch` px).
 */
export function figureSceneSize(geometry: { map: { w: number; h: number } }): { w: number; h: number } {
  return { w: 960, h: Math.round((960 * geometry.map.h) / geometry.map.w) };
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
  const terrain = slideTerrainSection(slide);
  const layout: PageLayoutKind = slide.page?.layout === "map-charts" && (charts || terrain) ? "map-charts" : "map-key";
  const panels = slide.style.panels as PagePanels | undefined;
  const figure = view.keyFigure;
  // 핵심 숫자가 없는 ①은 카드를 두지 않는다(D01·결과 없음). ②는 카드 없이도 그래프 열은 남는다.
  const cardDeleted = slide.style.summary === false || (!figure && layout === "map-key");
  // 열 전체를 지웠는가: D17 단면 장은 「열 지움」이 숫자 카드만 지우고 열과 단면 카드는 남긴다(Ruling 38).
  const summaryDeleted = cardDeleted && !(layout === "map-charts" && terrain);
  const baseNotes = cardDeleted ? [] : sameNotes(slide);
  const summaryPt = fontSizeForStyle(slide.style, "summary");
  const titlePt = fontSizeForStyle(slide.style, "title") * (15.75 / DEFAULT_REPORT_FONT_SIZES.title);
  const callout = slide.callout ?? null; // 새 틀 장은 판형과 상관없이 설명선 개요를 그린다(Ruling 39)
  const titleKind = [view.kindLabel, callout ? calloutPageTitleTail(callout.model.complexes, callout.page, callout.model.unit, callout.shownKeys, callout.numberStart ?? 1) : null].filter(Boolean).join(" · ");
  const titleText = slide.page?.titleOverride ?? view.title;
  const titleFit = titleChipFit(titleText, titleKind, titlePt);
  const titleSize = { w: titleFit.w, h: titleFit.h };
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
    const fit = figure && !cardDeleted
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
      ? { lines: fit.sentenceLines, pt: fit.sentencePt, height: fit.sentenceHeight, clipped: fit.sentenceClipped, full: fit.sentenceFull }
      : layout === "map-charts" && !cardDeleted
        ? { ...sentenceFit({ sentence, width: box.w, columns: 3, summaryPt, notes: hasNotes }), full: sentence ?? "" }
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
    chartSlots: layout === "map-charts" && !summaryDeleted ? (terrain ? 1 : 2) : 0,
    sentenceHeight: sentenceInfo?.height ?? 0,
    // 구성비 카드는 막대 줄 수만큼만 높다(내용보다 큰 빈 여백을 두지 않는다). 단면 장에는 구성비 카드가 없다.
    ...(layout === "map-charts" && charts && !terrain ? { chart1Content: compositionContentHeight(charts.composition.length, summaryPt / DEFAULT_REPORT_FONT_SIZES.summary, !!charts.titles.composition) + CHART_PAD.top + CHART_PAD.bottom } : {}),
    notes: hasNotes,
  });
  const inner = (rect: Rect | null | undefined): ChartBox | null => rect ? { x: rect.x + CHART_PAD.x, y: rect.y + CHART_PAD.top, w: Math.max(0.1, rect.w - CHART_PAD.x * 2), h: Math.max(0.1, rect.h - CHART_PAD.top - CHART_PAD.bottom) } : null;
  const footerWidth = geometry.footer.w - 2 * FOOTER_BOX.padX - geometry.pageNo.w - FOOTER_BOX.gap;
  return {
    layout, geometry, fit, figure: cardDeleted ? null : figure, summaryPt, sentence: sentenceInfo,
    title: { text: titleFit.text, fullText: titleText, titleClipped: titleFit.titleClipped, kind: titleFit.kind, fullKind: titleKind, kindClipped: titleFit.kindClipped, pt: titlePt, kindPt: titleKindPt(titlePt) },
    legend, calloutLegend,
    calloutOverview: callout && callout.page === 0 ? { map: geometry.map, legend: calloutLegend ? geometry.legend : null, legendMaxW: calloutLegend?.maxW ?? 0 } : null,
    notes,
    footer: footnoteText(slide, basemap, footerWidth, !fit || fit.filterClipped),
    charts: layout === "map-charts" ? charts : null,
    chart1: inner(geometry.column?.chart1), chart2: inner(geometry.column?.chart2),
    chartScale: summaryPt / DEFAULT_REPORT_FONT_SIZES.summary,
    terrain: terrain ? geometry.column?.chart1 ?? null : null,
  };
}
