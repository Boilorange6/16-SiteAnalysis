/**
 * 「지도 + 그래프」 오른쪽 분석 열을 PPT 도형으로 그린다(spec 2026-10-30 §3-3). 화면 analysis-column.tsx와 같은 장 기하(`column`)·
 * 같은 카드 맞춤(`keyFigureFit`)·같은 그래프 기하(chart-geometry)를 `ReportPageFrame`에서 받아 그리기만 한다.
 * 열 바탕 띠 + 핵심 숫자 카드 + 그래프 카드 둘 + 열 맨 아래 해석 한 줄이다. 각주(한계·메모)는 쪽 위에 칩이 없으므로 발표자 노트로 간다(부르는 쪽).
 */
import { RECT_STROKE_PT, compositionShapes, distanceShapes, type ChartShape } from "./chart-geometry";
import { SENTENCE_BAR, BAR_W } from "./key-figure-fit";
import { drawKeyFigureCard } from "./key-figure-pptx";
import { addDots } from "./map-pptx";
import { FONT, INK, hex, type Slide } from "./pptx-kit";
import { drawTerrainSectionPptx } from "./terrain-section-pptx";
import type { TerrainSections } from "../tile-result";
import type { ReportPageFrame } from "./report-page-frame";
import type { Rect } from "../ui/overlay-layout";
import type { TileView } from "../ui/tile-view";

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
        fill: { color: hex(shape.fill), ...(shape.opacity !== undefined ? { transparency: Math.round((1 - shape.opacity) * 100) } : {}) },
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
  /** 이 쪽의 계산 묶음(`pageFrameFor`). `geometry.column`이 있는 ②여야 한다. */
  frame: ReportPageFrame;
  view: TileView;
  /** 장 크기(inch). 열 바탕 띠가 지도 틀 오른쪽 끝에서 장 오른쪽 끝까지 그려진다. */
  page: { w: number };
  /** 핵심 숫자 카드 그룹 이름: 부위를 받아 `GRP|panel-summary|핵심 숫자|부위` */
  cardTag: (part: string) => string;
  /** D17 단면 장: 그래프 카드 1 자리(`frame.terrain`)에 선택 단면을 그린다. 그래프 카드는 없다. */
  terrain?: { sections: TerrainSections; selected: "A" | "B"; facilityCount: number | null };
};

/** 열 바탕 띠 → 핵심 숫자 카드 → 그래프 카드 둘(구성비·거리) → 열 맨 아래 해석 한 줄. 모든 사각형은 `frame`이 준다. */
export function drawAnalysisColumn(s: Slide, { frame, view, page, cardTag, terrain }: AnalysisColumnInput): void {
  const { column, map } = frame.geometry;
  if (!column) return;
  s.addShape("rect", { x: map.w, y: 0, w: page.w - map.w, h: map.h, fill: { color: "F0EFE9" }, line: { color: "F0EFE9", width: 0 }, objectName: "GRP|column-band|열 바탕|band" });

  if (frame.fit && frame.figure) drawKeyFigureCard(s, { view, fit: frame.fit, rect: column.key, tag: cardTag });

  const charts = frame.charts;
  const card = (rect: Rect | null, box: Rect | null, key: string, display: string, shapes: ChartShape[]) => {
    if (!rect) return;
    const prefix = `GRP|chart-${key}-${view.code}|${display}|`;
    s.addShape("roundRect", { ...rect, rectRadius: 0.125, fill: { color: "FFFFFF" }, line: { color: "E1E4E9", width: 0.75 }, shadow: { type: "outer", color: "15171C", opacity: 0.08, blur: 6, offset: 1.5, angle: 90 }, objectName: `${prefix}card` });
    if (box) addChartShapes(s, shapes, prefix);
  };
  if (terrain) {
    // 단면은 그래프 카드와 같은 카드(흰 바탕·1 px #e1e4e9·모서리 0.125 in) 안에 그린다.
    if (frame.terrain) {
      s.addShape("roundRect", { ...frame.terrain, rectRadius: 0.125, fill: { color: "FFFFFF" }, line: { color: "E1E4E9", width: 0.75 }, shadow: { type: "outer", color: "15171C", opacity: 0.08, blur: 6, offset: 1.5, angle: 90 }, objectName: `GRP|terrain-section|${terrain.selected}|plate` });
      drawTerrainSectionPptx(s, terrain.sections, terrain.selected, frame.terrain, terrain.facilityCount, false);
    }
  } else {
    card(column.chart1, frame.chart1, "composition", "그래프 · 구성비", charts && frame.chart1 ? compositionShapes(charts.composition, frame.chart1, frame.chartScale, charts.titles.composition) : []);
    card(column.chart2, frame.chart2, "distance", "그래프 · 거리", charts && frame.chart2 ? distanceShapes(charts.distance, charts.radiusM, frame.chart2, frame.chartScale, charts.titles.distance) : []);
  }

  // 해석 한 줄: 열 맨 아래, 카드 없음. 왼쪽 3 px 타일 색 막대 + 글(줄 높이 1.25).
  const info = frame.sentence;
  if (info && info.lines.length > 0) {
    const r = column.sentence;
    const group = "GRP|column-sentence|해석 줄|";
    s.addShape("roundRect", { x: r.x, y: r.y, w: BAR_W, h: r.h, rectRadius: BAR_W / 2, fill: { color: hex(view.color) }, line: { color: hex(view.color), width: 0 }, objectName: `${group}bar` });
    s.addText(info.lines.map((line, i) => ({ text: line, options: { breakLine: i < info.lines.length - 1 } })), {
      x: r.x + SENTENCE_BAR, y: r.y, w: r.w - SENTENCE_BAR, h: r.h, valign: "top", fontFace: FONT, fontSize: info.pt, lineSpacing: info.pt * 1.25, bold: true, color: INK, margin: 0, wrap: false, objectName: `${group}text`,
    });
  }
}
