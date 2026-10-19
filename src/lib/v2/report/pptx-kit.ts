import type PptxGenJS from "pptxgenjs";
import { PPT_FONT_MAIN as FONT } from "../../ppt-design-config";
import type { PageStyle } from "../ui/board-state";
import { OV, SLIDE, slideLayout, slidePanelRects, slidePanelScale, slideSize, stripText, layoutRects, type Rect, type SlideFormat } from "../ui/overlay-layout";

export { SLIDE, layoutRects, slideSize };
export type { SlideFormat };

export type Slide = ReturnType<PptxGenJS["addSlide"]>;
export type Border = PptxGenJS.BorderProps;
export type ReportItem = { h: number; draw: (y: number, slide?: Slide) => void };

export { FONT };
export const INK = "15171C";
export const MUTED = "5B606B";
export const LINE = "D9DCE2";
export const PLATE_ALPHA = Math.round((1 - OV.plateAlpha) * 100);
export const L = slideLayout();
export const E = SLIDE.edge;
export const IX = L.info.x + 0.25;
export const IW = L.info.w - 0.5;

export function hex(color: string): string {
  const value = color.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(value)) return [...value].map((ch) => ch + ch).join("").toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(value)) return value.toUpperCase();
  throw new Error(`Invalid PPTX color: ${color}`);
}
const chW = (ch: string) => (ch.charCodeAt(0) > 0x2e80 ? 1 : 0.56);
export const textIn = (value: string, pt: number) => ([...value].reduce((width, ch) => width + chW(ch), 0) * pt) / 72;
export const linesOf = (value: string, pt: number, width: number) => Math.max(1, Math.ceil((textIn(value, pt) / width) * 1.1));

export type FitBlockBox = { w: number; h: number };

/** 줄 배열이 박스 안에 들어가는 최대 글자 크기(기준 상한, 최소 7pt). */
export function fitBlock(lines: readonly string[] | string, box: FitBlockBox, maxPt = 18, minPt = 7): number {
  const values = (Array.isArray(lines) ? lines : [lines]).flatMap((line) => String(line).split("\n"));
  const width = Math.max(0.01, box.w);
  const height = Math.max(0, box.h);
  const floor = Math.max(7, minPt);
  const ceiling = Math.max(floor, maxPt);
  for (let pt = ceiling; pt >= floor; pt -= 0.5) {
    const rows = values.reduce((sum, value) => sum + linesOf(value, pt, width), 0);
    const blockH = rows * (pt / 72) * 1.25;
    if (blockH <= height + 1e-9) return pt;
  }
  return floor;
}

/** maxLines 안에 들어가는 가장 큰 글자 크기 */
export function fitPt(value: string, maxPt: number, width: number, maxLines: number, minPt = 8): number {
  let pt = maxPt;
  while (pt > minPt && linesOf(value, pt, width) > maxLines) pt -= 0.5;
  return pt;
}

export type CoverLayout = {
  left: Rect;
  right: Rect;
  leftInner: Rect;
  address: Rect;
  metricCellW: number;
  metricsY: number;
  metricsH: number;
  asOf: Rect;
  incompleteY: number;
  rightHeading: Rect;
  rowH: number;
  row: (index: number) => Rect;
  addressPt: number;
};

/** 표지의 판·텍스트 자리를 화면 미리보기와 PPT가 함께 사용한다. */
export function coverLayout(input: { address: string; metricCount: number; lineCount: number; incomplete: boolean }, format: SlideFormat = "wide"): CoverLayout {
  const size = slideSize(format);
  const geometry = slideLayout(format);
  const edge = format === "wide" ? E : geometry.title.x;
  const leftW = 5.7;
  const leftInner = { x: edge + 0.3, y: edge + 0.22, w: leftW - 0.6, h: 0.26 };
  const addressPt = fitPt(input.address, 28, leftInner.w, 2, 16);
  const addressH = linesOf(input.address, addressPt, leftInner.w) * (addressPt / 72) * 1.35 + 0.05;
  const metricRows = Math.max(1, Math.ceil(input.metricCount / 2));
  const metricsH = 0.62 * metricRows;
  const metricsY = edge + 0.22 + 0.3 + addressH + 0.15;
  const asOfY = metricsY + metricsH + 0.1;
  const chipH = input.incomplete ? 0.42 : 0;
  const leftH = 0.25 + 0.3 + addressH + 0.15 + metricsH + 0.3 + chipH + 0.2;
  const left = { x: edge, y: edge, w: leftW, h: leftH };
  const rightW = 5.6;
  const rowH = Math.min(0.4, 6 / Math.max(1, input.lineCount));
  const rightH = Math.min(0.62 + input.lineCount * rowH + 0.12, geometry.info.h);
  const right = { x: size.w - edge - rightW, y: edge, w: rightW, h: rightH };
  const rightHeading = { x: right.x + 0.3, y: edge + 0.18, w: rightW - 0.6, h: 0.28 };
  return {
    left,
    right,
    leftInner,
    address: { x: leftInner.x, y: edge + 0.52, w: leftInner.w, h: addressH },
    metricCellW: leftInner.w / 2 - 0.1,
    metricsY,
    metricsH,
    asOf: { x: leftInner.x, y: asOfY, w: leftInner.w, h: 0.26 },
    incompleteY: asOfY + 0.36,
    rightHeading,
    rowH,
    row: (index) => ({ x: right.x + 0.3, y: edge + 0.55 + index * rowH, w: right.w - 0.85, h: rowH }),
    addressPt,
  };
}

/** 보고서 제목 판의 실제 폭을 계산한다. render-pptx와 미리보기의 제목 조판 계약. */
export function titlePlateRect(code: string, title: string, kind: string, maxW: number, style: PageStyle = {}, hasSummary = true, format: SlideFormat = "wide"): Rect {
  const base = slidePanelRects(style, hasSummary, undefined, format).title;
  // panels.title이 있으면 사용자가 정한 도형 자리를 그대로 보존한다.
  // 좁은 사용자 박스를 텍스트 길이에 맞춰 다시 키우면 Preview/PPT 좌표가 달라진다.
  if (style.panels?.title) return base;
  const scale = slidePanelScale(style.titleScale);
  const w = Math.min(maxW, Math.max(base.w, 0.62 + textIn(`${code}  `, 10 * scale) + textIn(title, 18 * scale) + textIn(`  ${kind}`, 10 * scale)));
  return { ...base, w };
}

export type SourceLayout = { title: Rect; table: Rect; dense: boolean; tableContent: Rect; footer: Rect };

/** 출처 장의 표·기준일 자리를 미리보기와 PPT가 함께 사용한다. */
export function sourceLayout(rowCount: number, style: PageStyle = {}, format: SlideFormat = "wide"): SourceLayout {
  const size = slideSize(format);
  const geometry = slideLayout(format);
  const edge = format === "wide" ? E : geometry.title.x;
  const dense = rowCount >= 12;
  const table = { x: edge, y: 1.2, w: size.w - 2 * edge, h: Math.min(geometry.strip.y - 1.2 - 0.46, 0.5 + (dense ? 0.34 : 0.4) * (rowCount + 1)) };
  return {
    title: titlePlateRect("", "자료 출처와 기준일", "", size.w - 2 * edge, style, false, format),
    table,
    dense,
    tableContent: { x: table.x + 0.3, y: table.y + 0.2, w: table.w - 0.6, h: Math.max(0, table.h - 0.3) },
    footer: { x: table.x + 0.3, y: table.y + table.h + 0.08, w: table.w - 0.6, h: 0.24 },
  };
}

export type FooterFit = { text: string; fontSize: number; lines: 1 };

function oneLineAt(value: string, pt: number, width: number): boolean {
  return linesOf(value, pt, width) <= 1 && textIn(value, pt) <= width;
}

/** 출처 띠는 최소 7pt 한 줄을 우선하고, 그래도 길면 출처 장 참조로 요약한다. */
export function fitFooterText(sourceLine: string, credit: boolean, width = SLIDE.w - E - 1.7): FooterFit {
  const full = stripText(sourceLine, credit);
  for (let pt = 9; pt >= 7; pt -= 0.5) {
    if (oneLineAt(full, pt, width)) return { text: full, fontSize: pt, lines: 1 };
  }
  const parts = full.split(" · ");
  const dateCount = full.match(/(?:\d{4}(?:-\d{2}){0,2}|기준일 미확인)/g)?.length ?? 0;
  const totalEntries = Math.max(1, dateCount || parts.length - 1);
  for (let keep = parts.length - 1; keep >= 1; keep -= 1) {
    const keptEntries = parts.slice(0, keep).join(" · ").match(/(?:\d{4}(?:-\d{2}){0,2}|기준일 미확인)/g)?.length ?? 0;
    const suffix = `… 외 ${Math.max(1, totalEntries - keptEntries)}건 · 출처 장 참조`;
    const candidate = `${parts.slice(0, keep).join(" · ")} ${suffix}`;
    if (oneLineAt(candidate, 7, width)) return { text: candidate, fontSize: 7, lines: 1 };
  }
  return { text: `… 외 ${totalEntries}건 · 출처 장 참조`, fontSize: 7, lines: 1 };
}

export function plate(s: Slide, r: Rect, radius = 0.12, objectName?: string) {
  s.addShape("roundRect", { x: r.x, y: r.y, w: r.w, h: r.h, fill: { color: "FFFFFF", transparency: PLATE_ALPHA }, line: { color: INK, width: 0.5, transparency: 92 }, rectRadius: radius, ...(objectName ? { objectName } : {}) });
}

export function seg(s: Slide, a: [number, number], b: [number, number], color: string, width: number, transparency: number, objectName: string) {
  s.addShape("line", {
    x: Math.min(a[0], b[0]),
    y: Math.min(a[1], b[1]),
    w: Math.max(Math.abs(b[0] - a[0]), 0.005),
    h: Math.max(Math.abs(b[1] - a[1]), 0.005),
    line: { color, width, transparency },
    flipV: b[0] >= a[0] !== b[1] >= a[1],
    objectName,
  });
}
