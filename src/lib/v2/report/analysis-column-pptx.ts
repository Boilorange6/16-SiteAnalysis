/**
 * 「지도 + 그래프」 요약 열을 PPT 도형으로 그린다. 화면(analysis-column.tsx)과 같은 칸(chartsColumnLayout)·같은 맞춤 값(analysis-column-fit)·
 * 같은 그래프 기하(chart-geometry)를 쓰므로 둘의 모양이 같다. 요약 판(plate)과 각주는 부르는 쪽(render-pptx)이 맡는다.
 */
import { analysisStatLine, type AnalysisCharts } from "./analysis-charts";
import { analysisColumnFit } from "./analysis-column-fit";
import { compositionShapes, distanceShapes, type ChartShape } from "./chart-geometry";
import { addDots } from "./map-pptx";
import { CHIP, FONT, INK, MUTED, hex, type Slide } from "./pptx-kit";
import { DEFAULT_REPORT_FONT_SIZES } from "./report-doc";
import { chartsColumnLayout, type Rect } from "../ui/overlay-layout";
import type { TileView } from "../ui/tile-view";

/** 화면 SVG의 사각형 테두리 굵기(pt) */
const RECT_STROKE_PT = 0.75;

/**
 * 그래프 도형 목록(슬라이드 inch·pt)을 pptxgenjs 도형으로 옮긴다. 도형 이름은 `${namePrefix}${shape.name}`.
 * 글자는 줄바꿈·자동 맞춤 없이 기하가 준 상자 그대로(상자는 어림이라 wrap을 끈다), 높이 0 사각형은 건너뛴다.
 */
export function addChartShapes(s: Slide, shapes: readonly ChartShape[], namePrefix: string): void {
  for (const shape of shapes) {
    const objectName = `${namePrefix}${shape.name}`;
    if (shape.kind === "rect") {
      if (shape.h <= 0) continue;
      s.addShape("rect", {
        x: shape.x, y: shape.y, w: shape.w, h: shape.h,
        fill: { color: hex(shape.fill) },
        line: shape.stroke ? { color: hex(shape.stroke), width: RECT_STROKE_PT } : { color: hex(shape.fill), width: 0, transparency: 100 },
        objectName,
      });
    } else if (shape.kind === "line") {
      const dx = shape.x2 - shape.x1;
      const dy = shape.y2 - shape.y1;
      s.addShape("line", {
        x: Math.min(shape.x1, shape.x2), y: Math.min(shape.y1, shape.y2), w: Math.abs(dx), h: Math.abs(dy),
        line: { color: hex(shape.stroke), width: shape.width, ...(shape.dash ? { dashType: "dash" as const } : {}) },
        ...(dx < 0 ? { flipH: true } : {}),
        ...(dy < 0 ? { flipV: true } : {}),
        objectName,
      });
    } else if (shape.kind === "dots") {
      addDots(s, shape.points, shape.r, shape.color, shape.opacity, objectName, shape.stroke ? { color: shape.stroke, widthPt: shape.strokeWidth ?? RECT_STROKE_PT } : undefined);
    } else {
      s.addText(shape.text, {
        x: shape.x, y: shape.y, w: shape.w, h: shape.h,
        margin: 0, fontFace: FONT, fontSize: shape.pt, bold: !!shape.bold, color: hex(shape.color),
        align: shape.align, valign: "middle", wrap: false, objectName,
      });
    }
  }
}

export type AnalysisColumnInput = {
  charts: AnalysisCharts;
  view: TileView;
  sentence: string | null;
  /** 요약 판 자리(inch) */
  rect: Rect;
  summaryPt: number;
  /** 배지·큰 숫자·통계·해석 문장이 속할 도형 그룹 이름(요약 판과 같은 그룹) */
  panel: string;
};

/** 배지 줄 → 큰 숫자 → 한 줄 통계(+필터 줄) → 구성비 → 거리 → 해석 문장. 주석 칩 자리는 비워 두고 각주는 발표자 노트로 간다. */
export function drawAnalysisColumn(s: Slide, { charts, view, sentence, rect, summaryPt, panel }: AnalysisColumnInput): void {
  const scale = summaryPt / DEFAULT_REPORT_FONT_SIZES.summary;
  const col = chartsColumnLayout(rect, scale);
  const statText = analysisStatLine(charts);
  const fit = analysisColumnFit({ col, scale, summaryPt, badges: view.badges, headline: view.headline, statText, filterLine: view.filterLine, sentence });
  const { e } = fit;
  const hr = col.headline;

  // 배지: 화면 칩과 같은 폭·줄바꿈. 칩 높이는 글자 줄 높이(1.2배) + 위아래 안쪽 여백.
  const chipPt = Math.max(7, 9 * e);
  const chipH = (chipPt * 1.2) / 72 + 0.06 * e;
  const rowGap = 0.06 * e;
  for (const chip of fit.chips) {
    const box = { x: hr.x + chip.x, y: hr.y + chip.row * (chipH + rowGap), w: chip.w, h: chipH };
    s.addShape("roundRect", { ...box, fill: { color: CHIP[chip.tone].fill }, line: { color: CHIP[chip.tone].fill }, rectRadius: Math.min(0.15 * e, chipH / 2), objectName: panel });
    s.addText(chip.text, { ...box, align: "center", valign: "middle", fontFace: FONT, fontSize: chipPt, bold: true, color: CHIP[chip.tone].color, margin: 0, wrap: false, objectName: panel });
  }
  const badgesH = fit.chipRows ? fit.chipRows * chipH + (fit.chipRows - 1) * rowGap + 0.04 * e : 0;
  const headline = view.headline;
  if (headline && fit.labelPt !== null && fit.valuePt !== null) {
    const labelH = 0.24 * e;
    s.addText(headline.label, { x: hr.x, y: hr.y + badgesH, w: hr.w, h: labelH, valign: "top", fontFace: FONT, fontSize: fit.labelPt, bold: true, color: MUTED, margin: 0, fit: "shrink", objectName: panel });
    s.addText(headline.value, { x: hr.x, y: hr.y + badgesH + labelH, w: hr.w, h: 0.66 * e, valign: "middle", fontFace: FONT, fontSize: fit.valuePt, bold: true, color: INK, margin: 0, fit: "shrink", objectName: panel });
  }

  // 한 줄 통계 + 필터 줄: 한 글상자 두 문단
  s.addText(
    [{ text: statText, options: { breakLine: !!view.filterLine } }, ...(view.filterLine ? [{ text: view.filterLine, options: {} }] : [])],
    { ...col.stat, valign: "top", fontFace: FONT, fontSize: fit.statPt, color: INK, margin: 0, fit: "shrink", objectName: panel },
  );

  addChartShapes(s, compositionShapes(charts.composition, col.composition, scale, charts.titles.composition), `GRP|chart-composition-${view.code}|그래프 · 구성비|`);
  addChartShapes(s, distanceShapes(charts.distance, charts.radiusM, col.distance, scale, charts.titles.distance), `GRP|chart-distance-${view.code}|그래프 · 거리|`);

  if (sentence) s.addText(sentence, { ...col.sentence, valign: "top", fontFace: FONT, fontSize: fit.sentPt, bold: true, color: INK, margin: 0, fit: "shrink", objectName: panel });
}
