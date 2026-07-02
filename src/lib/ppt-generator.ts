// SlideSpec → pptxgenjs 얇은 매퍼. 디자인 결정은 전부 slide-builder.ts에 있다.
import PptxGenJS from "pptxgenjs";
import type { SlideElement, SlideSpec, Fill, Stroke } from "./slide-spec";
import { SLIDE_W, SLIDE_H } from "./slide-spec";

const FONT = "Noto Sans KR";

export interface SlideLike {
  addImage(opts: object): void;
  addShape(type: string, opts: object): void;
  addText(text: string, opts: object): void;
  addTable(rows: unknown[][], opts: object): void;
  addChart(type: unknown, data: unknown[], opts: object): void;
  background?: unknown;
}

const hex = (c: string) => c.replace("#", "");

function fillOf(fill: Fill) {
  const transparency = Math.round((1 - (fill.alpha ?? 1)) * 100);
  return transparency > 0 ? { color: hex(fill.color), transparency } : { color: hex(fill.color) };
}

function lineOf(stroke: Stroke) {
  return {
    color: hex(stroke.color),
    width: stroke.widthPt,
    ...(stroke.dash === "dash" ? { dashType: "dash" as const } : {}),
  };
}

const SHADOW = { type: "outer" as const, blur: 8, offset: 3, color: "000000", opacity: 0.25 };

export function applyElement(slide: SlideLike, el: SlideElement, barChartType: unknown): void {
  switch (el.kind) {
    case "image":
      slide.addImage({ data: el.dataUrl, x: el.x * SLIDE_W, y: el.y * SLIDE_H, w: el.w * SLIDE_W, h: el.h * SLIDE_H });
      return;

    case "rect":
      slide.addShape(el.radiusIn ? "roundRect" : "rect", {
        x: el.x * SLIDE_W, y: el.y * SLIDE_H, w: el.w * SLIDE_W, h: el.h * SLIDE_H,
        fill: fillOf(el.fill),
        ...(el.stroke ? { line: lineOf(el.stroke) } : {}),
        ...(el.radiusIn ? { rectRadius: el.radiusIn } : {}),
        ...(el.shadow ? { shadow: SHADOW } : {}),
      });
      return;

    case "ellipse":
      slide.addShape("ellipse", {
        x: (el.cx - el.rx) * SLIDE_W, y: (el.cy - el.ry) * SLIDE_H,
        w: el.rx * 2 * SLIDE_W, h: el.ry * 2 * SLIDE_H,
        fill: fillOf(el.fill),
        ...(el.stroke ? { line: lineOf(el.stroke) } : {}),
        ...(el.shadow ? { shadow: SHADOW } : {}),
      });
      return;

    case "line": {
      const x = Math.min(el.x1, el.x2) * SLIDE_W;
      const y = Math.min(el.y1, el.y2) * SLIDE_H;
      const w = Math.max(Math.abs(el.x2 - el.x1) * SLIDE_W, 0.005);
      const h = Math.max(Math.abs(el.y2 - el.y1) * SLIDE_H, 0.005);
      const goesRight = el.x2 >= el.x1;
      const goesDown = el.y2 >= el.y1;
      slide.addShape("line", { x, y, w, h, line: lineOf(el.stroke), flipV: goesRight !== goesDown });
      return;
    }

    case "text":
      slide.addText(el.text, {
        x: el.x * SLIDE_W, y: el.y * SLIDE_H, w: el.w * SLIDE_W, h: el.h * SLIDE_H,
        fontSize: el.fontSizePt, fontFace: FONT, color: hex(el.color),
        bold: el.bold ?? false,
        align: el.align ?? "left",
        valign: el.valign ?? "top",
        ...(el.charSpacingPt ? { charSpacing: el.charSpacingPt } : {}),
        ...(el.fill ? { fill: fillOf(el.fill) } : {}),
        ...(el.radiusIn ? { rectRadius: el.radiusIn } : {}),
      });
      return;

    case "table": {
      const header = el.columns.map((c) => ({
        text: c.label,
        options: { bold: true, color: hex(el.headerColor), fill: { color: hex(el.headerFill) }, align: c.align ?? "left" },
      }));
      const body = el.rows.map((row, ri) =>
        row.map((cell, ci) => ({
          text: cell,
          options: {
            align: el.columns[ci].align ?? "left",
            ...(el.zebraFill && ri % 2 === 1 ? { fill: { color: hex(el.zebraFill) } } : {}),
          },
        }))
      );
      slide.addTable([header, ...body], {
        x: el.x * SLIDE_W, y: el.y * SLIDE_H, w: el.w * SLIDE_W,
        colW: el.columns.map((c) => c.wFrac * el.w * SLIDE_W),
        fontSize: el.fontSizePt, fontFace: FONT, rowH: el.rowHIn,
        border: { type: "solid", pt: 0.5, color: "E2E8F0" },
        color: "334155",
      });
      return;
    }

    case "chart":
      slide.addChart(
        barChartType,
        [{ name: el.title, labels: [...el.categories], values: [...el.values] }],
        {
          x: el.x * SLIDE_W, y: el.y * SLIDE_H, w: el.w * SLIDE_W, h: el.h * SLIDE_H,
          barDir: "col",
          chartColors: [hex(el.color)],
          catAxisLabelFontSize: 8, valAxisLabelFontSize: 8,
          dataLabelFontSize: 8, showValue: true,
          fontFace: FONT,
          valGridLine: { style: "none" },
          showLegend: false, showTitle: false,
        }
      );
      return;
  }
}

export function createPptx(specs: readonly SlideSpec[], title: string): PptxGenJS {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = title;
  specs.forEach((spec) => {
    const slide = pptx.addSlide();
    spec.elements.forEach((el) => applyElement(slide as unknown as SlideLike, el, pptx.ChartType.bar));
  });
  return pptx;
}

export async function generatePptFromSlides(specs: readonly SlideSpec[], fileName: string): Promise<void> {
  const pptx = createPptx(specs, fileName.replace(/\.pptx$/, ""));
  await pptx.writeFile({ fileName });
}
