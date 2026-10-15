import type PptxGenJS from "pptxgenjs";
import { PPT_FONT_MAIN as FONT } from "../../ppt-design-config";
import { OV, SLIDE, slideLayout, type Rect } from "../ui/overlay-layout";

export { SLIDE };

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

export const hex = (color: string) => color.replace("#", "");
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
