import PptxGenJS from "pptxgenjs";
import type {
  Poi,
  PoiPosition,
  RadiusPosition,
  AnalysisConfig,
  PoiCategory,
  SubwayStation,
  School,
  Park,
  ResidentialPoi,
  MaintenanceProject,
  SourceStatus,
} from "./types";
import { CATEGORY_LABELS } from "./types";
import { layoutPoiLabels, poiLabelText } from "./ppt-label-layout";
import { computeResidentialCalloutLayout } from "./ppt-callout-layout";
import { buildParkDetailLines, formatAreaSqm, formatDistanceM, summarizeParks } from "./park-analysis";
import { buildMaintenanceDetailLines, formatMaintenanceArea, summarizeMaintenanceProjects } from "./maintenance-analysis";
import { buildInsightOverlays, computeAnalysisScores, generateAnalysisNarrative, getSummaryLines } from "./analysis-engine";
import { haversineDistance } from "./geo";
import type { PptDesignConfig } from "./ppt-design-config";
import { DEFAULT_PPT_DESIGN, PPT_FONT_MAIN } from "./ppt-design-config";
import { sourceStatusLines, hasFailedSource } from "./source-status-text";
import { toReportMapTone } from "./map-image-tone";
import { buildFactSummary, buildFactSheetRows, buildCategoryInsight, type FactSheetSegment, type CategoryInsightKey } from "./fact-summary";
import { isRawPoiId } from "./poi-id-guard";

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
// 아파트 콜아웃 슬라이드 1페이지당 카드 수. ppt-canvas-renderer.ts와 동일한 값·근거를 유지한다 —
// computeResidentialCalloutLayout(ppt-callout-layout.ts)의 좌/우 컬럼 실측 수용량 합은
// calloutHeight=0.73(Task 6, 미니 데이터표 전환) 기준 이론상 최대치이며, 만석 페이지는 카드가
// 컬럼 하단 경계에 딱 맞물려 시각적으로 "하단 적층"처럼 보인다(Task 6 QA, 이월 B). 여유 마진을 둔
// 안전 상한 7로 낮춘다.
const APT_PAGE_SIZE = 7;

const FONT_MAIN = PPT_FONT_MAIN;

const EMPTY_PANEL_TEXT = "반경 내 확인된 시설이 없습니다"; // match ppt-canvas-renderer.ts

const SITE_LABEL_OFFSET_Y = 0.20;
const RING_RATIOS = [0.33, 0.66, 1.0] as const;

const LEGEND_ICON_SIZE = 0.10;
const LEGEND_ROW_H = 0.22;
const LEGEND_W = 1.4;

// ── Cover slide tokens (Task 3 — match drawCoverFrameSquares/renderCoverSlide in ppt-canvas-renderer.ts) ──
const COVER_FRAME_TRANSPARENCY = 60; // 흰 테두리 사각 투명도(낮은 불투명도) — alpha 0.4
const COVER_EYEBROW_X = 0.85;
const COVER_EYEBROW_W = 8;
const COVER_EYEBROW_LINE1_Y = 0.6;
const COVER_EYEBROW_LINE1_H = 0.28;
const COVER_EYEBROW_LINE1_LETTER_SPACING = 2; // pt/px — "자간 넓게"
const COVER_EYEBROW_LINE1_COLOR = "#9CA3AF";
const COVER_EYEBROW_LINE2_Y = 0.94;
const COVER_EYEBROW_LINE2_H = 0.34;
const COVER_EYEBROW_LINE2_LETTER_SPACING = 5; // pt/px — "자간 극대"
const COVER_TITLE_X = 0.85;
const COVER_TITLE_Y = 4.55;
const COVER_TITLE_W = 9.4; // 슬라이드 폭(13.333in)의 ~70%
const COVER_TITLE_H = 1.5;
const COVER_META_Y = 6.15;
const COVER_META_H = 0.4;
const COVER_META_COLOR = "#E5E7EB";

// ── Map section title tokens (Task 5 — match MAP_TITLE_*/MAP_SUBTITLE_* in ppt-canvas-renderer.ts) ──
// 원본 보고서 slide 5 문법: 배경 칩 없는 볼드 화이트 대형 타이틀 + 흰 서브라벨. addTitleChip은
// 다른 슬라이드(팩트시트·표지 등)가 계속 쓰므로 지도 분석 슬라이드(overview/category) 전용으로 분리.
const MAP_TITLE_X = 0.5;
const MAP_TITLE_Y = 0.34;
const MAP_TITLE_W = 8.0;
const MAP_TITLE_H = 0.48;
const MAP_TITLE_FONT_SIZE = 26;
const MAP_SUBTITLE_Y = MAP_TITLE_Y + MAP_TITLE_H + 0.02;
const MAP_SUBTITLE_H = 0.24;
const MAP_SUBTITLE_FONT_SIZE = 12;
const MAP_SUBTITLE_COLOR = "#E5E7EB";

// ── Insight card tokens (Task 5 — match INSIGHT_CARD_* in ppt-canvas-renderer.ts) ──
const INSIGHT_CARD_W = 3.6;
const INSIGHT_CARD_X = SLIDE_W - INSIGHT_CARD_W - 0.5;
const INSIGHT_CARD_PAD = 0.26;
const INSIGHT_CARD_TITLE_H = 0.26;
const INSIGHT_CARD_LINE_H = 0.34;
const INSIGHT_CARD_RADIUS = 0.1;
const INSIGHT_CARD_BOTTOM_MARGIN = 0.55;
const INSIGHT_CARD_LABEL = "핵심 포인트";
const INSIGHT_CARD_LABEL_COLOR = "#9CA3AF";

/** 역사도식선(흰 캐싱) 고정색 — markerBorderColor는 다른 요소와 공유하는 범용 잉크색이라
 * 캐싱 전용으로는 쓰지 않는다(match STATION_CASING_COLOR in ppt-canvas-renderer.ts). */
const STATION_CASING_COLOR = "#FFFFFF";

// ── Fact sheet slide tokens (Task 4 — match FACT_* constants in ppt-canvas-renderer.ts) ──
const FACT_TITLE_TEXT = "팩트 시트";
const FACT_SUBTITLE_TEXT = "반경 내 핵심 수치 자동 요약";
const FACT_TITLE_Y = 0.55;
const FACT_TITLE_H = 0.5;
const FACT_TITLE_BOX_W = 3.6;
const FACT_TITLE_FONT_SIZE = 22;
const FACT_SUBTITLE_Y = 1.08;
const FACT_SUBTITLE_H = 0.24;
const FACT_FRAME_X = 0.55;
const FACT_FRAME_Y = 1.42;
const FACT_FRAME_W = 12.23;
const FACT_FRAME_H = 5.3;
const FACT_FRAME_RADIUS = 0.12;
const FACT_TABLE_X = 0.95;
const FACT_TABLE_Y = 1.72;
const FACT_TABLE_W = 11.43;
const FACT_LABEL_W = 2.6;
const FACT_VALUE_W = 7.3;
const FACT_SOURCE_W = FACT_TABLE_W - FACT_LABEL_W - FACT_VALUE_W; // 1.53
const FACT_HEADER_H = 0.42;
const FACT_ROW_H = 0.46;
const FACT_VALUE_FONT_SIZE = 11;

// ── Pagination helper ─────────────────────────────────────────────────────────

function pageResidentials(residentials: readonly ResidentialPoi[], pageSize: number): ResidentialPoi[][] {
  const dated = [...residentials]
    .filter(a => a.sale_date)
    .sort((a, b) => a.sale_date.localeCompare(b.sale_date));
  const undated = residentials.filter(a => !a.sale_date);
  const all = [...dated, ...undated];
  if (all.length === 0) return [[]];
  const pages: ResidentialPoi[][] = [];
  for (let i = 0; i < all.length; i += pageSize) {
    pages.push(all.slice(i, i + pageSize));
  }
  return pages;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function pptColor(hex: string): string {
  return hex.replace("#", "").toUpperCase();
}

function addMapVeil(
  slide: PptxGenJS.Slide,
  color: string,
  transparency: number
) {
  if (transparency >= 100) return;
  slide.addShape("rect", {
    x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
    fill: { color: pptColor(color), transparency },
    line: { color: pptColor(color), transparency: 100 },
  });
}

function addDesignFrame(slide: PptxGenJS.Slide, d: PptDesignConfig) {
  switch (d.frameStyle) {
    case "none":
      break;
    case "executive-rail":
      slide.addShape("rect", { x: 0, y: 0, w: 0.22, h: SLIDE_H, fill: { color: pptColor(d.accentColor), transparency: 0 }, line: { color: pptColor(d.accentColor), transparency: 100 } });
      slide.addShape("rect", { x: 0.42, y: 0.22, w: 2.1, h: 0.035, fill: { color: pptColor(d.accentColor), transparency: 0 }, line: { color: pptColor(d.accentColor), transparency: 100 } });
      slide.addShape("rect", { x: 0.42, y: 6.95, w: 12.2, h: 0.015, fill: { color: pptColor(d.markerBorderColor), transparency: 72 }, line: { color: pptColor(d.markerBorderColor), transparency: 100 } });
      break;
    case "editorial-mat":
      slide.addShape("line", { x: 0.7, y: 0.95, w: 11.9, h: 0, line: { color: pptColor(d.primaryColor), transparency: 25, width: 0.7 } });
      slide.addShape("line", { x: 0.7, y: 6.85, w: 11.9, h: 0, line: { color: pptColor(d.primaryColor), transparency: 35, width: 0.6 } });
      break;
    case "satellite-hud":
      [
        [0.35, 0.35, 0.58, 0.0], [0.35, 0.35, 0.0, 0.44],
        [12.4, 0.35, 0.58, 0.0], [12.98, 0.35, 0.0, 0.44],
        [0.35, 6.68, 0.58, 0.0], [0.35, 6.24, 0.0, 0.44],
        [12.4, 6.68, 0.58, 0.0], [12.98, 6.24, 0.0, 0.44],
      ].forEach(([x, y, w, h]) => slide.addShape("line", { x, y, w, h, line: { color: pptColor(d.accentColor), transparency: 15, width: 1.2 } }));
      slide.addShape("line", { x: 6.66, y: 0.18, w: 0, h: 0.38, line: { color: pptColor(d.accentColor), transparency: 45, width: 0.8 } });
      slide.addShape("line", { x: 6.66, y: 6.94, w: 0, h: 0.38, line: { color: pptColor(d.accentColor), transparency: 45, width: 0.8 } });
      break;
    case "boardroom-ledger":
      slide.addShape("rect", { x: 0, y: 0, w: SLIDE_W, h: 0.18, fill: { color: pptColor(d.accentColor), transparency: 18 }, line: { color: pptColor(d.accentColor), transparency: 100 } });
      [1.18, 6.85].forEach((y) => slide.addShape("line", { x: 0.62, y, w: 12.05, h: 0, line: { color: pptColor(d.accentColor), transparency: 55, width: 0.7 } }));
      slide.addShape("rect", { x: 12.7, y: 0.18, w: 0.18, h: 6.62, fill: { color: pptColor(d.accentColor), transparency: 25 }, line: { color: pptColor(d.accentColor), transparency: 100 } });
      break;
    case "blueprint-grid":
      for (let x = 0.5; x < SLIDE_W; x += 0.5) {
        slide.addShape("line", { x, y: 0, w: 0, h: SLIDE_H, line: { color: pptColor(d.accentColor), transparency: 88, width: 0.25 } });
      }
      for (let y = 0.5; y < SLIDE_H; y += 0.5) {
        slide.addShape("line", { x: 0, y, w: SLIDE_W, h: 0, line: { color: pptColor(d.accentColor), transparency: 88, width: 0.25 } });
      }
      slide.addShape("line", { x: 0.5, y: 0.92, w: 12.3, h: 0, line: { color: pptColor(d.accentColor), transparency: 35, width: 1 } });
      break;
    case "organic-contour":
      slide.addShape("ellipse", { x: -1.1, y: -0.9, w: 5.7, h: 3.1, fill: { color: pptColor(d.accentColor), transparency: 100 }, line: { color: pptColor(d.accentColor), transparency: 70, width: 1.2 } });
      slide.addShape("ellipse", { x: 9.6, y: 4.65, w: 4.5, h: 2.9, fill: { color: pptColor(d.secondaryAccentColor), transparency: 100 }, line: { color: pptColor(d.secondaryAccentColor), transparency: 70, width: 1 } });
      slide.addShape("line", { x: 0.7, y: 6.82, w: 11.7, h: 0, line: { color: pptColor(d.accentColor), transparency: 58, width: 1 } });
      break;
    case "luxury-keyline":
      slide.addShape("rect", { x: 0.32, y: 0.28, w: 12.7, h: 6.86, fill: { color: pptColor(d.canvasColor), transparency: 100 }, line: { color: pptColor(d.accentColor), transparency: 26, width: 0.9 } });
      slide.addShape("rect", { x: 0.45, y: 0.42, w: 12.43, h: 6.58, fill: { color: pptColor(d.canvasColor), transparency: 100 }, line: { color: pptColor(d.accentColor), transparency: 62, width: 0.4 } });
      break;
    case "metro-wayfinding":
      slide.addShape("rect", { x: 0, y: 0, w: SLIDE_W, h: 0.26, fill: { color: pptColor(d.primaryColor), transparency: 0 }, line: { color: pptColor(d.primaryColor), transparency: 100 } });
      ["#EF4444", "#F97316", "#EAB308", "#22C55E", "#2563EB", "#7C3AED"].forEach((color, idx) => {
        slide.addShape("rect", { x: 0.5 + idx * 0.45, y: 0.26, w: 0.33, h: 0.08, fill: { color: pptColor(color), transparency: 0 }, line: { color: pptColor(color), transparency: 100 } });
      });
      break;
    case "deal-room":
      slide.addShape("rect", { x: 0, y: 0, w: 0.36, h: SLIDE_H, fill: { color: pptColor(d.accentColor), transparency: 0 }, line: { color: pptColor(d.accentColor), transparency: 100 } });
      slide.addShape("line", { x: 3.06, y: 0.25, w: 0, h: 6.4, line: { color: pptColor(d.primaryColor), transparency: 44, width: 0.95 } });
      slide.addShape("line", { x: 0.58, y: 6.84, w: 11.95, h: 0, line: { color: pptColor(d.accentColor), transparency: 35, width: 1.1 } });
      break;
    case "minimal-document":
      slide.addShape("line", { x: 0.72, y: 0.92, w: 11.9, h: 0, line: { color: "111111", transparency: 0, width: 1.1 } });
      slide.addShape("line", { x: 0.72, y: 6.85, w: 11.9, h: 0, line: { color: "111111", transparency: 18, width: 0.6 } });
      break;
  }
}

function addCompositionBackdrop(slide: PptxGenJS.Slide, d: PptDesignConfig, _mode: "cover" | "content") {
  switch (d.compositionStyle) {
    case "none":
      break;
    case "split-command":
      slide.addShape("rect", { x: 0.32, y: 0.48, w: 0.08, h: 6.08, fill: { color: pptColor(d.accentColor), transparency: 0 }, line: { color: pptColor(d.accentColor), transparency: 100 } });
      slide.addShape("line", { x: 4.22, y: 0.45, w: 0, h: 6.2, line: { color: pptColor(d.accentColor), transparency: 45, width: 1.05 } });
      slide.addShape("line", { x: 4.46, y: 0.78, w: 0, h: 5.52, line: { color: pptColor(d.primaryColor), transparency: 68, width: 0.65 } });
      for (let i = 0; i < 7; i += 1) {
        const y = 1.0 + i * 0.68;
        slide.addShape("line", { x: 0.62, y, w: 1.28, h: 0, line: { color: pptColor(d.accentColor), transparency: 54, width: 0.55 } });
        slide.addShape("line", { x: 0.62, y: y + 0.24, w: 2.78, h: 0, line: { color: "FFFFFF", transparency: 72, width: 0.45 } });
      }
      slide.addText("COMMAND", { x: 0.62, y: 0.46, w: 2.6, h: 0.35, fontSize: 14, fontFace: FONT_MAIN, color: pptColor(d.accentColor), bold: true, margin: 0 });
      break;
    case "print-editorial":
      slide.addShape("line", { x: 0.64, y: 0.8, w: 8.95, h: 0, line: { color: pptColor(d.textColor), transparency: 0, width: 1.25 } });
      slide.addShape("line", { x: 0.64, y: 6.86, w: 8.95, h: 0, line: { color: pptColor(d.textColor), transparency: 42, width: 0.7 } });
      slide.addShape("rect", { x: 0.64, y: 0.8, w: 1.85, h: 0.12, fill: { color: pptColor(d.secondaryAccentColor), transparency: 0 }, line: { color: pptColor(d.secondaryAccentColor), transparency: 100 } });
      [1.42, 1.72, 2.02, 2.32].forEach((y, idx) => slide.addShape("line", { x: 7.35, y, w: 1.85 - idx * 0.18, h: 0, line: { color: pptColor(d.textColor), transparency: 72, width: 0.5 } }));
      slide.addText("WHITE PAPER", { x: 7.15, y: 0.54, w: 2.25, h: 0.25, fontSize: 8, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor), bold: true, align: "right", margin: 0 });
      break;
    case "radar-hud":
      for (let i = 0; i < 9; i += 1) slide.addShape("line", { x: 0, y: 0.48 + i * 0.72, w: SLIDE_W, h: 0, line: { color: pptColor(d.accentColor), transparency: 78, width: 0.32 } });
      for (let i = 0; i < 8; i += 1) slide.addShape("line", { x: 0.55 + i * 1.68, y: 0, w: 0, h: SLIDE_H, line: { color: pptColor(d.accentColor), transparency: 86, width: 0.25 } });
      slide.addShape("ellipse", { x: 2.95, y: 0, w: 7.5, h: 7.5, fill: { color: pptColor(d.accentColor), transparency: 96 }, line: { color: pptColor(d.accentColor), transparency: 34, width: 1.35 } });
      slide.addShape("ellipse", { x: 4.6, y: 1.65, w: 4.2, h: 4.2, fill: { color: pptColor(d.accentColor), transparency: 100 }, line: { color: pptColor(d.accentColor), transparency: 44, width: 1 } });
      slide.addShape("ellipse", { x: 6.15, y: 3.2, w: 1.1, h: 1.1, fill: { color: pptColor(d.accentColor), transparency: 78 }, line: { color: pptColor(d.accentColor), transparency: 8, width: 1 } });
      slide.addShape("line", { x: 6.7, y: 0.34, w: 0, h: 6.82, line: { color: pptColor(d.accentColor), transparency: 45, width: 0.9 } });
      slide.addShape("line", { x: 0.72, y: 3.75, w: 11.92, h: 0, line: { color: pptColor(d.accentColor), transparency: 45, width: 0.9 } });
      slide.addText("RADAR HUD", { x: 9.7, y: 0.62, w: 2.2, h: 0.32, fontSize: 11, fontFace: FONT_MAIN, color: pptColor(d.accentColor), bold: true, align: "right", margin: 0 });
      break;
    case "finance-ledger":
      slide.addShape("rect", { x: 8.28, y: 0.52, w: 0.12, h: 6.35, fill: { color: pptColor(d.accentColor), transparency: 8 }, line: { color: pptColor(d.accentColor), transparency: 100 } });
      [0.95, 1.62, 2.29, 2.96, 3.63, 4.3, 4.97, 5.64, 6.31].forEach((y, idx) => slide.addShape("line", { x: 8.82, y, w: 3.75, h: 0, line: { color: pptColor(d.accentColor), transparency: idx % 3 === 0 ? 38 : 70, width: idx % 3 === 0 ? 0.75 : 0.42 } }));
      slide.addText("INVESTMENT MEMO", { x: 9.02, y: 0.45, w: 2.95, h: 0.32, fontSize: 9.5, fontFace: FONT_MAIN, color: pptColor(d.accentColor), bold: true, margin: 0 });
      break;
    case "planning-sheet":
      for (let x = 0.25; x < SLIDE_W; x += 0.25) slide.addShape("line", { x, y: 0, w: 0, h: SLIDE_H, line: { color: pptColor(d.accentColor), transparency: Math.abs(x % 1) < 0.001 ? 74 : 88, width: 0.25 } });
      for (let y = 0.25; y < SLIDE_H; y += 0.25) slide.addShape("line", { x: 0, y, w: SLIDE_W, h: 0, line: { color: pptColor(d.accentColor), transparency: Math.abs(y % 1) < 0.001 ? 74 : 88, width: 0.25 } });
      slide.addShape("line", { x: 10.05, y: 0.62, w: 2.0, h: 0, line: { color: pptColor(d.accentColor), transparency: 8, width: 1.25 } });
      slide.addShape("line", { x: 12.05, y: 0.62, w: 0, h: 1.25, line: { color: pptColor(d.accentColor), transparency: 8, width: 1.25 } });
      slide.addText("PLANNING SHEET", { x: 0.76, y: 0.68, w: 2.65, h: 0.26, fontSize: 8.5, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true, margin: 0 });
      break;
    case "landscape-report":
      slide.addShape("rect", { x: 9.25, y: 0.42, w: 0.18, h: 6.45, fill: { color: pptColor(d.accentColor), transparency: 22 }, line: { color: pptColor(d.accentColor), transparency: 100 } });
      slide.addShape("ellipse", { x: -2.6, y: -1.4, w: 7.5, h: 5.1, fill: { color: pptColor(d.accentColor), transparency: 100 }, line: { color: pptColor(d.accentColor), transparency: 50, width: 1 } });
      slide.addShape("ellipse", { x: 7.6, y: 4.13, w: 6.5, h: 3.5, fill: { color: pptColor(d.secondaryAccentColor), transparency: 100 }, line: { color: pptColor(d.secondaryAccentColor), transparency: 55, width: 0.8 } });
      for (let i = 0; i < 4; i += 1) slide.addShape("ellipse", { x: 10.8 - (1.2 + i * 0.38), y: 5.85 - (0.72 + i * 0.24), w: (1.2 + i * 0.38) * 2, h: (0.72 + i * 0.24) * 2, fill: { color: pptColor(d.accentColor), transparency: 100 }, line: { color: pptColor(d.accentColor), transparency: 66, width: 0.65 } });
      slide.addText("FIELD REPORT", { x: 0.82, y: 0.58, w: 2.2, h: 0.28, fontSize: 9, fontFace: FONT_MAIN, color: pptColor(d.accentColor), bold: true, margin: 0 });
      break;
    case "luxury-brochure":
      slide.addShape("rect", { x: 1.42, y: 0.88, w: 10.48, h: 5.76, fill: { color: "111111", transparency: 100 }, line: { color: pptColor(d.accentColor), transparency: 8, width: 1.4 } });
      slide.addShape("rect", { x: 1.72, y: 1.18, w: 9.88, h: 5.16, fill: { color: "111111", transparency: 100 }, line: { color: pptColor(d.accentColor), transparency: 48, width: 0.55 } });
      slide.addShape("line", { x: 2.28, y: 5.82, w: 8.75, h: 0, line: { color: pptColor(d.accentColor), transparency: 28, width: 0.75 } });
      slide.addText("PRIVATE BRIEF", { x: 5.05, y: 0.9, w: 3.25, h: 0.35, fontSize: 10, fontFace: FONT_MAIN, color: pptColor(d.accentColor), bold: true, align: "center", margin: 0 });
      break;
    case "transit-atlas":
      ["#E11D48", "#F97316", "#EAB308", "#22C55E", "#2563EB", "#7C3AED"].forEach((color, idx) => {
        slide.addShape("rect", { x: 0.45 + idx * 0.62, y: 0.34, w: 0.45, h: 0.12, fill: { color: pptColor(color), transparency: 0 }, line: { color: pptColor(color), transparency: 100 } });
        slide.addShape("rect", { x: 12.45, y: 0.72 + idx * 0.32, w: 0.26, h: 0.17, fill: { color: pptColor(color), transparency: 0 }, line: { color: pptColor(color), transparency: 100 } });
      });
      slide.addShape("line", { x: 1.05, y: 6.65, w: 11.05, h: -5.75, line: { color: "E11D48", transparency: 8, width: 1.9 } });
      slide.addShape("line", { x: 0.55, y: 5.88, w: 12.0, h: -2.75, line: { color: "2563EB", transparency: 10, width: 1.65 } });
      slide.addShape("line", { x: 5.15, y: 1.14, w: 7.75, h: 4.65, line: { color: "22C55E", transparency: 12, width: 1.65 } });
      slide.addShape("line", { x: 0.48, y: 6.88, w: 12.05, h: 0, line: { color: pptColor(d.primaryColor), transparency: 18, width: 1.4 } });
      slide.addText("TRANSIT ATLAS", { x: 0.72, y: 0.58, w: 2.4, h: 0.3, fontSize: 9.5, fontFace: FONT_MAIN, color: pptColor(d.primaryColor), bold: true, margin: 0 });
      break;
    case "war-room":
      slide.addShape("line", { x: 3.62, y: 0.18, w: -1.05, h: 7.08, line: { color: pptColor(d.accentColor), transparency: 28, width: 1 } });
      slide.addShape("line", { x: 10.7, y: 0.18, w: 1.08, h: 7.08, line: { color: pptColor(d.accentColor), transparency: 38, width: 0.9 } });
      slide.addShape("line", { x: 12.72, y: 0.28, w: 0, h: 6.64, line: { color: pptColor(d.accentColor), transparency: 42, width: 1 } });
      slide.addShape("line", { x: 0.58, y: 6.82, w: 11.9, h: 0, line: { color: pptColor(d.accentColor), transparency: 8, width: 1.5 } });
      slide.addText("WAR ROOM", { x: 0.72, y: 0.62, w: 2.3, h: 0.35, fontSize: 13, fontFace: FONT_MAIN, color: pptColor(d.accentColor), bold: true, margin: 0 });
      break;
    case "mono-dossier":
      slide.addShape("rect", { x: 0.62, y: 0.62, w: 0.16, h: 6.18, fill: { color: pptColor(d.textColor), transparency: 0 }, line: { color: pptColor(d.textColor), transparency: 100 } });
      [1.08, 1.72, 6.52].forEach((y) => slide.addShape("line", { x: 0.96, y, w: 8.95, h: 0, line: { color: pptColor(d.textColor), transparency: y === 1.08 ? 0 : 60, width: y === 1.08 ? 1.1 : 0.65 } }));
      slide.addText("DOSSIER", { x: 8.0, y: 0.62, w: 1.85, h: 0.3, fontSize: 9, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true, align: "right", margin: 0 });
      break;
  }
}

/**
 * 표지 문법(Task 3, design doc "A. 표지"): 거의 검정 배경 위 우측 오프셋 흰 테두리 사각 2개.
 * 우상단 1개 + 우하단 1개, 슬라이드 밖으로 살짝 잘리는 배치(원본 보고서 표지 장식 재현).
 * 좌표는 ppt-canvas-renderer.ts의 drawCoverFrameSquares와 동일 수치를 유지할 것.
 */
function addCoverFrameSquares(slide: PptxGenJS.Slide) {
  const line = { color: pptColor("#FFFFFF"), transparency: COVER_FRAME_TRANSPARENCY, width: 1 };
  const noFill = { color: pptColor("#000000"), transparency: 100 };
  slide.addShape("rect", { x: 11.55, y: 0.55, w: 2.25, h: 2.25, fill: noFill, line });
  slide.addShape("rect", { x: 10.65, y: 4.5, w: 2.85, h: 2.35, fill: noFill, line });
}

function addFullBleedMap(slide: PptxGenJS.Slide, baseMapImage: string, d: PptDesignConfig) {
  if (!baseMapImage) return;
  slide.addImage({ data: baseMapImage, x: 0, y: 0, w: SLIDE_W, h: SLIDE_H });
  addMapVeil(slide, d.mapOverlayColor, d.mapOverlayTransparency);
  addCompositionBackdrop(slide, d, "content");
  addDesignFrame(slide, d);
}

function addTitleChip(slide: PptxGenJS.Slide, title: string, d: PptDesignConfig, subtitle?: string) {
  const chipW = Math.min(Math.max(title.length * 0.22 + 0.6, 1.8), d.titleChipMaxWidth);
  const subtitleText = subtitle ?? "";
  const titleAlign = d.titleStyle === "editorial-rule" || d.titleStyle === "ink-rule" || d.titleStyle === "blueprint-label" ? "left" : "center";
  const titleX = d.titleStyle === "editorial-rule" || d.titleStyle === "ink-rule" ? d.titleChipX + 0.02 : d.titleChipX;
  const titleW = d.titleStyle === "transit-sign" ? Math.max(chipW, 4.2) : chipW;

  if (d.titleStyle === "plain") {
    slide.addText(title, {
      x: d.titleChipX, y: d.titleChipY, w: Math.max(chipW, 4.2), h: d.titleChipHeight,
      fontSize: d.titleFontSize, fontFace: FONT_MAIN, bold: true,
      color: pptColor(d.textColor), align: "left", valign: "middle",
      margin: 0,
    });
    if (subtitleText) {
      slide.addText(subtitleText, {
        x: d.titleChipX, y: d.titleChipY + d.titleChipHeight + 0.08, w: 3.2, h: 0.22,
        fontSize: d.subtitleFontSize, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor), margin: 0,
      });
    }
    return;
  }

  if (d.titleStyle === "editorial-rule" || d.titleStyle === "ink-rule") {
    slide.addText(title, {
      x: titleX, y: d.titleChipY, w: Math.max(chipW, 4.2), h: d.titleChipHeight,
      fontSize: d.titleFontSize, fontFace: FONT_MAIN, bold: true,
      color: pptColor(d.textColor), align: "left", valign: "middle",
      margin: 0,
    });
    slide.addShape("line", {
      x: d.titleChipX, y: d.titleChipY + d.titleChipHeight + 0.08, w: Math.max(chipW, 3.4), h: 0,
      line: { color: pptColor(d.accentColor), transparency: d.titleStyle === "ink-rule" ? 0 : 12, width: d.titleStyle === "ink-rule" ? 1.1 : 0.8 },
    });
    if (subtitleText) {
      slide.addText(subtitleText, {
        x: d.titleChipX, y: d.titleChipY + d.titleChipHeight + 0.14, w: 3.2, h: 0.22,
        fontSize: d.subtitleFontSize, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor), margin: 0,
      });
    }
    return;
  }

  if (d.titleStyle === "hud-bracket") {
    slide.addShape("line", { x: d.titleChipX - 0.16, y: d.titleChipY, w: 0.22, h: 0, line: { color: pptColor(d.accentColor), width: 1.1 } });
    slide.addShape("line", { x: d.titleChipX - 0.16, y: d.titleChipY, w: 0, h: d.titleChipHeight, line: { color: pptColor(d.accentColor), width: 1.1 } });
    slide.addShape("line", { x: d.titleChipX + titleW - 0.06, y: d.titleChipY + d.titleChipHeight, w: 0.22, h: 0, line: { color: pptColor(d.accentColor), width: 1.1 } });
    slide.addShape("line", { x: d.titleChipX + titleW + 0.16, y: d.titleChipY, w: 0, h: d.titleChipHeight, line: { color: pptColor(d.accentColor), width: 1.1 } });
  }

  if (d.titleStyle === "transit-sign") {
    slide.addShape("rect", {
      x: d.titleChipX, y: d.titleChipY, w: titleW, h: d.titleChipHeight,
      fill: { color: pptColor(d.primaryColor), transparency: 0 },
      line: { color: pptColor(d.primaryColor), transparency: 100 },
      rectRadius: d.titleChipRadius,
    });
    slide.addShape("rect", {
      x: d.titleChipX, y: d.titleChipY, w: 0.16, h: d.titleChipHeight,
      fill: { color: pptColor(d.accentColor), transparency: 0 },
      line: { color: pptColor(d.accentColor), transparency: 100 },
    });
  }

  if (d.titleStyle === "luxury-plaque") {
    slide.addShape("rect", {
      x: d.titleChipX - 0.08, y: d.titleChipY - 0.06, w: titleW + 0.16, h: d.titleChipHeight + 0.12,
      fill: { color: pptColor(d.canvasColor), transparency: 12 },
      line: { color: pptColor(d.accentColor), transparency: 18, width: 0.8 },
      rectRadius: d.titleChipRadius,
    });
  }

  slide.addText(title, {
    x: d.titleChipX, y: d.titleChipY, w: titleW, h: d.titleChipHeight,
    fontSize: d.titleFontSize, fontFace: FONT_MAIN, bold: true,
    color: pptColor(d.textColor), align: titleAlign, valign: "middle",
    fill: { color: pptColor(d.overlayColor), transparency: d.titleChipTransparency },
    rectRadius: d.titleChipRadius,
    margin: d.titleStyle === "transit-sign" ? 0.08 : undefined,
  });
  if (subtitle) {
    const subW = Math.min(Math.max(subtitle.length * 0.16 + 0.4, 1.2), 3.0);
    slide.addText(subtitle, {
      x: d.titleChipX, y: d.titleChipY + d.titleChipHeight + 0.08, w: subW, h: 0.28,
      fontSize: d.subtitleFontSize, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor),
      align: "center", valign: "middle",
      fill: { color: pptColor(d.overlayColor), transparency: Math.min(95, d.titleChipTransparency + 12) },
      rectRadius: d.titleChipRadius,
    });
  }
}

/**
 * 지도 분석 슬라이드(overview/category) 전용 좌상단 타이틀 — 원본 보고서 문법: 배경 칩 없는
 * 볼드 화이트 대형 섹션 타이틀 + 흰 서브라벨(반경 표기). 다른 슬라이드는 addTitleChip을 그대로 쓴다.
 */
function addMapSectionTitle(slide: PptxGenJS.Slide, title: string, subtitle: string) {
  slide.addText(title, {
    x: MAP_TITLE_X, y: MAP_TITLE_Y, w: MAP_TITLE_W, h: MAP_TITLE_H,
    fontSize: MAP_TITLE_FONT_SIZE, fontFace: FONT_MAIN, bold: true,
    color: pptColor("#FFFFFF"), align: "left", valign: "middle", margin: 0,
  });
  slide.addText(subtitle, {
    x: MAP_TITLE_X, y: MAP_SUBTITLE_Y, w: MAP_TITLE_W, h: MAP_SUBTITLE_H,
    fontSize: MAP_SUBTITLE_FONT_SIZE, fontFace: FONT_MAIN,
    color: pptColor(MAP_SUBTITLE_COLOR), align: "left", valign: "middle", margin: 0,
  });
}

/** categories 배열로부터 buildCategoryInsight에 넘길 카테고리 키를 추론 — addCategorySlide의 4개 호출부와 매핑. */
function inferCategoryInsightKey(categories: readonly PoiCategory[]): CategoryInsightKey | null {
  if (categories.includes("subway")) return "transit";
  if (categories.includes("school")) return "education";
  if (categories.includes("park") || categories.includes("mountain")) return "nature";
  if (categories.includes("maintenance")) return "maintenance";
  return null;
}

/**
 * 카테고리 지도 슬라이드 우측 하단 라운드 검정 인사이트 카드 — fact-summary 기반 2-4줄 팩트 요약.
 * lines가 비면(반경 내 데이터 0건) 아무것도 그리지 않는다 — 왼쪽 상세 패널의 EMPTY_PANEL_TEXT가
 * 이미 그 상태를 안내하므로 카드까지 빈 상태 문구를 중복 표시하지 않는다.
 */
function addInsightCard(slide: PptxGenJS.Slide, lines: readonly string[], d: PptDesignConfig) {
  if (lines.length === 0) return;
  const cardH = INSIGHT_CARD_PAD * 2 + INSIGHT_CARD_TITLE_H + lines.length * INSIGHT_CARD_LINE_H;
  const cardY = SLIDE_H - INSIGHT_CARD_BOTTOM_MARGIN - cardH;
  // 리뷰 #2: "rect" 프리셋은 rectRadius(adj)를 무시 — 라운드는 "roundRect" 프리셋에서만 실현된다.
  slide.addShape("roundRect", {
    x: INSIGHT_CARD_X, y: cardY, w: INSIGHT_CARD_W, h: cardH,
    fill: { color: pptColor(d.insightCardBg), transparency: 0 },
    line: { color: pptColor(d.insightCardBg), transparency: 100 },
    rectRadius: INSIGHT_CARD_RADIUS,
  });
  slide.addText(INSIGHT_CARD_LABEL, {
    x: INSIGHT_CARD_X + INSIGHT_CARD_PAD, y: cardY + INSIGHT_CARD_PAD - 0.03,
    w: INSIGHT_CARD_W - INSIGHT_CARD_PAD * 2, h: INSIGHT_CARD_TITLE_H,
    fontSize: 10, fontFace: FONT_MAIN, bold: true, color: pptColor(INSIGHT_CARD_LABEL_COLOR),
    align: "left", valign: "middle", margin: 0,
  });
  lines.forEach((text, i) => {
    const y = cardY + INSIGHT_CARD_PAD + INSIGHT_CARD_TITLE_H + i * INSIGHT_CARD_LINE_H;
    slide.addText(text, {
      x: INSIGHT_CARD_X + INSIGHT_CARD_PAD, y,
      w: INSIGHT_CARD_W - INSIGHT_CARD_PAD * 2, h: INSIGHT_CARD_LINE_H,
      fontSize: 11.5, fontFace: FONT_MAIN, bold: true, color: pptColor(d.insightCardText),
      align: "left", valign: "middle", margin: 0,
    });
  });
}

function addDataPanel(
  slide: PptxGenJS.Slide,
  x: number, y: number, w: number, h: number,
  d: PptDesignConfig
) {
  const lineColor = d.panelStyle === "paper" || d.panelStyle === "document"
    ? d.textColor
    : d.panelStyle === "luxury" || d.panelStyle === "blueprint" || d.panelStyle === "terminal"
      ? d.accentColor
      : d.markerBorderColor;
  slide.addShape("rect", {
    x, y, w, h,
    fill: { color: pptColor(d.panelColor), transparency: d.panelTransparency },
    line: { color: pptColor(lineColor), transparency: d.panelBorderTransparency, width: d.panelStyle === "document" ? 0.6 : 1 },
    rectRadius: d.panelRadius,
  });
  if (d.panelStyle === "ledger" || d.panelStyle === "terminal" || d.panelStyle === "transit") {
    slide.addShape("rect", {
      x, y, w, h: 0.08,
      fill: { color: pptColor(d.accentColor), transparency: d.panelStyle === "terminal" ? 0 : 8 },
      line: { color: pptColor(d.accentColor), transparency: 100 },
    });
  }
  if (d.panelStyle === "paper" || d.panelStyle === "document") {
    slide.addShape("line", { x: x + 0.18, y: y + 0.42, w: Math.max(0.4, w - 0.36), h: 0, line: { color: pptColor(d.textColor), transparency: d.panelStyle === "document" ? 72 : 82, width: 0.4 } });
  }
  if (d.panelStyle === "blueprint" || d.panelStyle === "hud") {
    slide.addShape("line", { x: x + 0.1, y: y + 0.1, w: 0.32, h: 0, line: { color: pptColor(d.accentColor), transparency: 15, width: 0.8 } });
    slide.addShape("line", { x: x + 0.1, y: y + 0.1, w: 0, h: 0.32, line: { color: pptColor(d.accentColor), transparency: 15, width: 0.8 } });
    slide.addShape("line", { x: x + w - 0.42, y: y + h - 0.1, w: 0.32, h: 0, line: { color: pptColor(d.accentColor), transparency: 15, width: 0.8 } });
    slide.addShape("line", { x: x + w - 0.1, y: y + h - 0.42, w: 0, h: 0.32, line: { color: pptColor(d.accentColor), transparency: 15, width: 0.8 } });
  }
  if (d.panelStyle === "luxury") {
    slide.addShape("rect", { x: x + 0.08, y: y + 0.08, w: Math.max(0.1, w - 0.16), h: Math.max(0.1, h - 0.16), fill: { color: pptColor(d.panelColor), transparency: 100 }, line: { color: pptColor(d.accentColor), transparency: 68, width: 0.35 } });
  }
}

function addFooterNote(slide: PptxGenJS.Slide, text: string, d: PptDesignConfig, color?: string) {
  slide.addText(text, {
    x: 0.55, y: 7.08, w: 12.2, h: 0.22,
    fontSize: 6.5, fontFace: FONT_MAIN, color: pptColor(color ?? d.mutedTextColor),
    align: "right",
  });
}

function addMiniLabel(slide: PptxGenJS.Slide, label: string, x: number, y: number, w: number, d: PptDesignConfig) {
  slide.addText(label, {
    x, y, w, h: 0.18,
    fontSize: 6.5, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor),
    bold: true,
  });
}

/**
 * Small centered translucent card + muted text, used when a slide has no panel to host
 * EMPTY_PANEL_TEXT in. `region` (default: whole slide) lets callers center the compact badge
 * inside a sub-panel's footprint instead — P4R Task C-3: 리스크 매트릭스/주거 공급 슬라이드의
 * "0건" 하위 테이블이 거대한 빈 흰 카드로 남던 문제를 이 문법으로 대체.
 */
function addEmptyStateBadge(
  slide: PptxGenJS.Slide,
  d: PptDesignConfig,
  region: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H },
  // P4R Task C fix: 범용 문구("반경 내 확인된 시설이 없습니다")가 시설은 있으나 특정 하위 데이터
  // (일정/상세 내역 등)만 없는 케이스에서 같은 슬라이드 다른 패널과 자기모순되는 문제 — 문구를
  // 파라미터화해 호출부가 상황에 맞는 문구를 넘길 수 있게 한다. 기본값은 기존 범용 문구 유지.
  message: string = EMPTY_PANEL_TEXT
) {
  const w = 4.6;
  const h = 0.56;
  const x = region.x + (region.w - w) / 2;
  const y = region.y + (region.h - h) / 2;
  addDataPanel(slide, x, y, w, h, d);
  slide.addText(message, {
    x: x + 0.2, y, w: w - 0.4, h,
    fontSize: 13, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor), align: "center", valign: "middle",
  });
}

function addMetricCard(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  detail: string,
  color: string,
  d: PptDesignConfig,
) {
  const borderColor = d.metricStyle === "number-plate" || d.metricStyle === "terminal" ? d.accentColor : color;
  const fillTransparency = d.metricStyle === "stat-sheet" ? 4 : d.metricStyle === "terminal" ? 6 : 10;
  slide.addShape("rect", {
    x, y, w, h,
    fill: { color: pptColor(d.panelColor), transparency: fillTransparency },
    line: { color: pptColor(borderColor), transparency: d.metricStyle === "stat-sheet" ? 24 : 42, width: d.metricStyle === "terminal" ? 1.2 : 1 },
    rectRadius: d.metricStyle === "stat-sheet" ? 0.02 : d.panelRadius,
  });
  if (d.metricStyle === "stripe" || d.metricStyle === "scorecard" || d.metricStyle === "ledger") {
    slide.addShape("rect", {
      x, y, w: d.metricStyle === "scorecard" ? 0.1 : 0.06, h,
      fill: { color: pptColor(color), transparency: 0 },
      line: { color: pptColor(color), transparency: 100 },
    });
  } else if (d.metricStyle === "number-plate") {
    slide.addShape("rect", {
      x: x + 0.12, y: y + 0.12, w: 0.34, h: h - 0.24,
      fill: { color: pptColor(d.accentColor), transparency: 8 },
      line: { color: pptColor(d.accentColor), transparency: 100 },
      rectRadius: 0.03,
    });
  } else if (d.metricStyle === "terminal") {
    slide.addShape("line", { x: x + 0.14, y: y + 0.16, w: w - 0.28, h: 0, line: { color: pptColor(d.accentColor), transparency: 15, width: 0.7 } });
  }
  slide.addText(label, {
    x: x + 0.18, y: y + 0.12, w: w - 0.34, h: 0.16,
    fontSize: 7.5, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor), bold: true,
  });
  slide.addText(value, {
    x: x + (d.metricStyle === "number-plate" ? 0.55 : 0.18), y: y + 0.28, w: w - 0.34, h: 0.28,
    fontSize: d.metricStyle === "number-plate" ? 16 : 18, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true,
  });
  slide.addText(detail, {
    x: x + 0.18, y: y + h - 0.24, w: w - 0.34, h: 0.24,
    fontSize: 7.5, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor), fit: "shrink",
  });
}

function addProgressBar(
  slide: PptxGenJS.Slide,
  x: number,
  y: number,
  w: number,
  value: number,
  max: number,
  color: string,
  d: PptDesignConfig,
) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  slide.addShape("rect", {
    x, y, w, h: 0.08,
    fill: { color: pptColor(d.overlayColor), transparency: 45 },
    line: { color: pptColor(d.markerBorderColor), transparency: 100 },
    rectRadius: 0.03,
  });
  slide.addShape("rect", {
    x, y, w: Math.max(0.02, w * ratio), h: 0.08,
    fill: { color: pptColor(color), transparency: 0 },
    line: { color: pptColor(color), transparency: 100 },
    rectRadius: 0.03,
  });
}

function getScoreColor(ratio: number): string {
  if (ratio >= 0.82) return "#22C55E";
  if (ratio >= 0.65) return "#3B82F6";
  if (ratio >= 0.45) return "#F59E0B";
  return "#EF4444";
}

function getLevelLabel(level: string): string {
  switch (level) {
    case "excellent": return "우수";
    case "good": return "양호";
    case "fair": return "보통";
    default: return "보완";
  }
}

function countWithin(config: AnalysisConfig, pois: readonly Poi[], radiusM: number, category?: PoiCategory): number {
  return pois.filter((poi) =>
    (!category || poi.category === category)
    && haversineDistance(config.centerLat, config.centerLng, poi.lat, poi.lng) <= radiusM
  ).length;
}

function getResidentialPois(pois: readonly Poi[]): ResidentialPoi[] {
  return pois.filter(
    (p): p is ResidentialPoi => p.category === "apartment" || p.category === "officetel" || p.category === "residential"
  );
}

function addRankedList(
  slide: PptxGenJS.Slide,
  title: string,
  rows: readonly { label: string; meta: string; color?: string }[],
  x: number,
  y: number,
  w: number,
  d: PptDesignConfig,
) {
  addDataPanel(slide, x, y, w, 0.55 + Math.max(rows.length, 1) * 0.38, d);
  slide.addText(title, {
    x: x + 0.18, y: y + 0.15, w: w - 0.36, h: 0.22,
    fontSize: 10, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true,
  });
  if (rows.length === 0) {
    slide.addText("확인된 데이터가 없습니다.", {
      x: x + 0.18, y: y + 0.52, w: w - 0.36, h: 0.25,
      fontSize: 8.5, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor),
    });
    return;
  }
  rows.forEach((row, idx) => {
    const rowY = y + 0.52 + idx * 0.38;
    const color = row.color ?? d.markerBorderColor;
    slide.addShape("ellipse", {
      x: x + 0.18, y: rowY + 0.07, w: 0.12, h: 0.12,
      fill: { color: pptColor(color), transparency: 0 },
      line: { color: pptColor(color), transparency: 100 },
    });
    slide.addText(row.label, {
      x: x + 0.38, y: rowY, w: w * 0.55, h: 0.24,
      fontSize: 8.5, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true, fit: "shrink",
    });
    slide.addText(row.meta, {
      x: x + w * 0.58, y: rowY, w: w * 0.35, h: 0.24,
      fontSize: 7.5, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor), align: "right", fit: "shrink",
    });
  });
}

function addLegend(slide: PptxGenJS.Slide, d: PptDesignConfig) {
  const items = Object.entries(CATEGORY_LABELS).map(([key, label]) => ({
    label,
    color: d.categoryColors[key as PoiCategory],
  }));
  if (d.legendStyle === "strip") {
    const rowW = 5.9;
    const rowH = 0.34;
    const x = d.legendPosition.endsWith("right") ? SLIDE_W - rowW - 0.55 : 0.55;
    const y = d.legendPosition.startsWith("top") ? 0.92 : SLIDE_H - 0.72;
    slide.addShape("rect", {
      x, y, w: rowW, h: rowH,
      fill: { color: pptColor(d.overlayColor), transparency: d.legendTransparency },
      line: { color: pptColor(d.markerBorderColor), transparency: d.legendBorderTransparency, width: 0.6 },
      rectRadius: d.legendRadius,
    });
    items.slice(0, 6).forEach((item, i) => {
      const itemX = x + 0.18 + i * 0.92;
      slide.addShape("rect", { x: itemX, y: y + 0.11, w: 0.12, h: 0.12, fill: { color: pptColor(item.color), transparency: 0 }, line: { color: pptColor(item.color), transparency: 100 } });
      slide.addText(item.label, { x: itemX + 0.16, y: y + 0.065, w: 0.6, h: 0.2, fontSize: 6.4, fontFace: FONT_MAIN, color: pptColor(d.legendTextColor), valign: "middle", fit: "shrink" });
    });
    return;
  }

  const legH = items.length * LEGEND_ROW_H + 0.15;
  const isRight = d.legendPosition.endsWith("right");
  const isTop = d.legendPosition.startsWith("top");
  const legX = isRight ? SLIDE_W - LEGEND_W - 0.4 : 0.4;
  const legY = isTop ? 0.4 : SLIDE_H - legH - 0.4;

  if (d.legendStyle !== "minimal") {
    slide.addShape("rect", {
      x: legX, y: legY, w: d.legendStyle === "rail" ? 0.54 : LEGEND_W, h: legH,
      fill: { color: pptColor(d.overlayColor), transparency: d.legendTransparency },
      line: { color: pptColor(d.markerBorderColor), transparency: d.legendBorderTransparency, width: 0.8 },
      rectRadius: d.legendRadius,
    });
  }

  items.forEach((item, i) => {
    const y = legY + 0.08 + i * LEGEND_ROW_H;
    // "minimal"(기본값)을 포함해 색 도트 아이콘 — 원본 보고서 범례 문법(좌하단, 색 도트+라벨).
    // "index"만 사각 스와치 유지(다른 프리셋 전용 스타일, 이 작업 범위 밖).
    const iconShape = d.legendStyle === "index" ? "rect" : "ellipse";
    slide.addShape(iconShape, {
      x: legX + 0.12, y: y + (LEGEND_ROW_H - LEGEND_ICON_SIZE) / 2,
      w: LEGEND_ICON_SIZE, h: LEGEND_ICON_SIZE,
      fill: { color: item.color.replace("#", "") },
      line: { color: pptColor(d.markerBorderColor), transparency: d.legendStyle === "index" ? 0 : 20, width: 0.8 },
      rectRadius: d.legendStyle === "index" ? 0.01 : undefined,
    });
    if (d.legendStyle !== "rail") {
      slide.addText(item.label, {
        x: legX + 0.28, y, w: LEGEND_W - 0.32, h: LEGEND_ROW_H,
        fontSize: d.legendFontSize, fontFace: FONT_MAIN,
        color: pptColor(d.legendTextColor), valign: "middle",
      });
    }
  });
}

function addPoiMarkers(
  slide: PptxGenJS.Slide,
  positions: readonly PoiPosition[],
  categories: readonly PoiCategory[],
  d: PptDesignConfig,
  options: { showLabels?: boolean; size?: number; radiusPosition?: RadiusPosition | null } = {}
) {
  const { showLabels = true, radiusPosition = null } = options;
  const size = options.size ?? d.markerSize;
  const filtered = positions.filter((p) => categories.includes(p.poi.category));
  const labelPlacements = showLabels
    ? layoutPoiLabels(filtered, SLIDE_W, SLIDE_H, size, { radiusPosition })
    : [];
  const poiById = new Map(filtered.map((pos) => [pos.poi.id, pos.poi]));

  filtered.forEach(({ poi, nx, ny }) => {
    const x = nx * SLIDE_W;
    const y = ny * SLIDE_H;
    const color =
      poi.category === "subway"
        ? (poi as SubwayStation).lineColor.replace("#", "")
        : d.categoryColors[poi.category].replace("#", "");

    const fillOpts: PptxGenJS.ShapeFillProps = { color };
    if (d.markerTransparency > 0) {
      (fillOpts as { color: string; transparency: number }).transparency = d.markerTransparency;
    }

    if (d.markerStyle === "square") {
      slide.addShape("rect", {
        x: x - size / 2, y: y - size / 2, w: size, h: size,
        fill: fillOpts,
        line: { color: pptColor(d.markerBorderColor), width: d.markerBorderWidth },
        rectRadius: 0.01,
      });
    } else if (d.markerStyle === "diamond") {
      slide.addShape("rect", {
        x: x - size / 2, y: y - size / 2, w: size, h: size,
        fill: fillOpts,
        line: { color: pptColor(d.markerBorderColor), width: d.markerBorderWidth },
        rotate: 45,
      });
    } else if (d.markerStyle === "ring-dot" || d.markerStyle === "jewel" || d.markerStyle === "transit-node") {
      slide.addShape("ellipse", {
        x: x - size * 0.68, y: y - size * 0.68, w: size * 1.36, h: size * 1.36,
        fill: { color: pptColor(d.overlayColor), transparency: d.markerStyle === "jewel" ? 42 : 100 },
        line: { color: pptColor(d.markerStyle === "jewel" ? d.accentColor : d.markerBorderColor), width: d.markerBorderWidth + 0.4 },
      });
      slide.addShape("ellipse", {
        x: x - size / 2, y: y - size / 2, w: size, h: size,
        fill: fillOpts,
        line: { color: pptColor(d.markerBorderColor), width: d.markerStyle === "transit-node" ? 1.4 : d.markerBorderWidth },
      });
    } else if (d.markerStyle === "crosshair" || d.markerStyle === "signal") {
      slide.addShape("line", { x: x - size * 0.8, y, w: size * 1.6, h: 0, line: { color: pptColor(d.markerBorderColor), transparency: 18, width: 0.8 } });
      slide.addShape("line", { x, y: y - size * 0.8, w: 0, h: size * 1.6, line: { color: pptColor(d.markerBorderColor), transparency: 18, width: 0.8 } });
      slide.addShape("ellipse", {
        x: x - size / 2, y: y - size / 2, w: size, h: size,
        fill: fillOpts,
        line: { color: pptColor(d.markerStyle === "signal" ? d.accentColor : d.markerBorderColor), width: d.markerBorderWidth },
      });
    } else {
      slide.addShape("ellipse", {
        x: x - size / 2, y: y - size / 2, w: size, h: size,
        fill: fillOpts,
        line: { color: pptColor(d.markerBorderColor), width: d.markerBorderWidth },
      });
    }
  });

  labelPlacements.forEach((placement) => {
    const poi = poiById.get(placement.poiId);
    if (!poi) return;
    // 지명 색 문법(Task 5, match ppt-canvas-renderer.ts) — 산은 초록(+고도m). 도로/수계 라벨은
    // 이 앱에 해당 POI 카테고리·데이터가 없어 적용 불가.
    const labelColor = poi.category === "mountain" ? d.categoryColors.mountain : d.textColor;
    slide.addText(poiLabelText(poi), {
      x: placement.x, y: placement.y, w: placement.w, h: placement.h,
      fontSize: d.labelFontSize, fontFace: FONT_MAIN,
      color: pptColor(labelColor), bold: true,
      fill: { color: pptColor(d.overlayColor), transparency: d.labelBgTransparency },
      rectRadius: d.panelRadius / 2, margin: 0.02, align: "center", valign: "middle",
    });
  });
}

function addConcentricRings(
  slide: PptxGenJS.Slide,
  radiusPosition: RadiusPosition | null,
  d: PptDesignConfig
) {
  if (!radiusPosition) return;
  const cx = radiusPosition.centerNx * SLIDE_W;
  const cy = radiusPosition.centerNy * SLIDE_H;
  const rx = radiusPosition.radiusNx * SLIDE_W;
  const ry = radiusPosition.radiusNy * SLIDE_H;

  // 대상지 반경 링 — accentRed로 강조(원본 보고서 문법: 대상지 빨강). markerBorderColor는
  // POI 마커·범례 등 다른 요소와 공유하는 범용 잉크색이라 대상지 전용 강조에는 accentRed를 쓴다.
  RING_RATIOS.forEach((ratio, idx) => {
    const ringRx = rx * ratio;
    const ringRy = ry * ratio;
    const isOuter = idx === RING_RATIOS.length - 1;
    slide.addShape("ellipse", {
      x: cx - ringRx, y: cy - ringRy, w: ringRx * 2, h: ringRy * 2,
      fill: { color: "FFFFFF", transparency: 100 },
      line: {
        color: pptColor(d.accentRed),
        width: isOuter ? d.ringOuterLineWidth : d.ringLineWidth,
        dashType: d.ringDash === "solid" ? undefined : d.ringDash === "dash" ? "dash" : "sysDot",
        transparency: d.ringTransparency,
      },
    });
  });
}

function addSiteMarker(slide: PptxGenJS.Slide, radiusPosition: RadiusPosition | null, d: PptDesignConfig) {
  if (!radiusPosition) return;
  const cx = radiusPosition.centerNx * SLIDE_W;
  const cy = radiusPosition.centerNy * SLIDE_H;

  // 대상지 중심 마커 — accentRed로 강조(원본 보고서 문법: 폴리곤 데이터가 없어 마커+링을 빨강화).
  slide.addShape("ellipse", {
    x: cx - d.siteMarkerOuterSize / 2, y: cy - d.siteMarkerOuterSize / 2,
    w: d.siteMarkerOuterSize, h: d.siteMarkerOuterSize,
    fill: { color: "FFFFFF", transparency: 100 },
    line: { color: pptColor(d.accentRed), width: 1.5, dashType: "dash" },
  });
  slide.addShape("ellipse", {
    x: cx - d.siteMarkerInnerSize / 2, y: cy - d.siteMarkerInnerSize / 2,
    w: d.siteMarkerInnerSize, h: d.siteMarkerInnerSize,
    fill: { color: pptColor(d.accentRed) },
    line: { color: pptColor(d.accentRed), width: 1 },
  });
  slide.addText("SITE", {
    x: cx - 0.3, y: cy + SITE_LABEL_OFFSET_Y, w: 0.6, h: 0.2,
    fontSize: d.siteLabelFontSize, fontFace: FONT_MAIN, bold: true, color: pptColor(d.accentRed), align: "center",
  });
}

export interface RouteNormalizedPosition {
  readonly line: string;
  readonly lineColor: string;
  readonly points: readonly { readonly nx: number; readonly ny: number }[];
}

// ── 노선 변이 중복 제거 (리뷰 #1b 근본 원인) ─────────────────────────────────────
// OSM 노선 데이터는 같은 노선을 상·하행/분할 way 단위로 여러 번 담는다(near-coincident 변이).
// 점선 스트로크가 위상(phase)이 어긋난 채 겹치면 서로의 간격을 메워 실선처럼 붕괴한다
// (COM 내보내기 실측: 동일 geometry 2벌인 2호선·신분당만 점선 유지, 변이가 다른 7호선 등은 실선화).
// 같은 색의 기존 유지 경로에 거의 덮이는(90% 이상 근접) 변이를 제거해 코리더당 1획만 남긴다.
// 두 렌더러가 이 함수를 공유해 동일 geometry 집합을 그린다.

/** 겹침 판정 거리(인치) — 지도 축척에서 상·하행 트랙 간격은 이보다 훨씬 작다. */
const ROUTE_DEDUPE_TOL_IN = 0.06;
/** 이 비율 이상 샘플점이 기존 경로에 근접하면 중복 변이로 간주. */
const ROUTE_DEDUPE_COVERAGE = 0.9;
/** 커버리지 판정용 샘플점 상한(성능 바운드). */
const ROUTE_DEDUPE_MAX_SAMPLES = 60;

function routePointsInches(route: RouteNormalizedPosition): Array<{ x: number; y: number }> {
  return route.points.map((pt) => ({ x: pt.nx * SLIDE_W, y: pt.ny * SLIDE_H }));
}

function polylineLength(pts: ReadonlyArray<{ x: number; y: number }>): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

function distPointToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const abx = b.x - a.x, aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

function isNearPolyline(p: { x: number; y: number }, poly: ReadonlyArray<{ x: number; y: number }>, tol: number): boolean {
  for (let i = 1; i < poly.length; i++) {
    if (distPointToSegment(p, poly[i - 1], poly[i]) <= tol) return true;
  }
  return false;
}

/**
 * 같은 색(lineColor) 노선 중 기존 유지 경로에 거의 덮이는 변이를 제거한다.
 * 긴 경로부터 유지해 짧은 상·하행 변이·분할 way가 본선에 흡수되게 한다.
 * 진짜 지선(다른 코리더)은 커버리지가 낮아 유지된다.
 */
export function dedupeRouteVariants(
  routePositions: readonly RouteNormalizedPosition[]
): readonly RouteNormalizedPosition[] {
  const sorted = [...routePositions]
    .map((route) => ({ route, pts: routePointsInches(route) }))
    .sort((a, b) => polylineLength(b.pts) - polylineLength(a.pts));
  const kept: Array<{ route: RouteNormalizedPosition; pts: Array<{ x: number; y: number }> }> = [];
  for (const cand of sorted) {
    if (cand.pts.length < 2) continue;
    const sameColor = kept.filter((k) => k.route.lineColor === cand.route.lineColor);
    if (sameColor.length > 0) {
      const stride = Math.max(1, Math.ceil(cand.pts.length / ROUTE_DEDUPE_MAX_SAMPLES));
      const samples = cand.pts.filter((_, i) => i % stride === 0);
      const covered = samples.filter((p) => sameColor.some((k) => isNearPolyline(p, k.pts, ROUTE_DEDUPE_TOL_IN))).length;
      if (covered / samples.length >= ROUTE_DEDUPE_COVERAGE) continue;
    }
    kept.push(cand);
  }
  return kept.map((k) => k.route);
}

function addSubwayRouteLines(
  slide: PptxGenJS.Slide,
  routePositions: readonly RouteNormalizedPosition[],
  d: PptDesignConfig
) {
  // 리뷰 #1b: OSM 원시 정점 쌍마다 별도 line shape를 만들면 dashType "dash" 패턴이 shape마다
  // 리셋되고 세그먼트가 dash 주기(3pt 선 기준 ~0.29in)보다 짧아 사실상 실선으로 렌더된다.
  // 수정 3요소: (1) dedupeRouteVariants로 위상 어긋난 겹침 변이 제거(실선 붕괴의 근본 원인),
  // (2) 노선 전체를 custGeom(다점 폴리라인) 한 shape로 통합해 dash가 경로를 따라 연속되게 하고
  // (pptxgenjs 3.12 custGeom points 지원 확인 — moveTo 첫 점 + lnTo 연속, 좌표는 shape 원점 기준 인치),
  // (3) ~0.3in 간격 리샘플링으로 정점 노이즈·XML 크기를 줄인다.
  dedupeRouteVariants(routePositions).forEach((route) => {
    if (route.points.length < 2) return;
    const pts = resamplePolylineInches(
      route.points.map((pt) => ({ x: pt.nx * SLIDE_W, y: pt.ny * SLIDE_H })),
      ROUTE_RESAMPLE_STEP_IN
    );
    const minX = Math.min(...pts.map((p) => p.x)), minY = Math.min(...pts.map((p) => p.y));
    const w = Math.max(Math.max(...pts.map((p) => p.x)) - minX, 0.01);
    const h = Math.max(Math.max(...pts.map((p) => p.y)) - minY, 0.01);
    // 타입 캐스트: pptxgenjs 3.12 런타임은 custGeom을 지원하지만(dist ShapeType enum·XML 생성기 확인)
    // 타입 정의의 SHAPE_NAME 유니온에 누락되어 있어 캐스트가 필요하다.
    slide.addShape("custGeom" as PptxGenJS.SHAPE_NAME, {
      x: minX, y: minY, w, h,
      points: pts.map((p) => ({ x: p.x - minX, y: p.y - minY })),
      fill: { color: "FFFFFF", transparency: 100 }, // 열린 경로 — 채움 없음
      line: { color: pptColor(route.lineColor), width: d.subwayLineWidth, dashType: "dash" }, // 원본 보고서 문법: 노선 점선화
    });
  });
}

/** 리뷰 #1b — 노선 경로 리샘플 간격(인치). PPT "dash" 프리셋 주기(3pt 선 기준 대시 0.167in+간격
 * 0.125in ≈ 0.29in)보다 약간 크게 잡아 정점당 대시 1주기 이상을 보장한다. */
const ROUTE_RESAMPLE_STEP_IN = 0.3;

/**
 * 폴리라인을 누적 거리 기반 step 간격으로 재표본한다(인치 좌표계). 원시 정점은 버리고
 * 시작점·등간격 보간점·끝점만 남긴다 — step보다 촘촘한 굴곡은 직선화되지만 지도 축척에서
 * 시각 차이는 무시 가능. drawSubwayRouteLines(canvas)는 dash가 경로를 따라 연속 적용되므로
 * 리샘플링이 불필요 — PPT 전용 헬퍼.
 */
function resamplePolylineInches(
  pts: ReadonlyArray<{ x: number; y: number }>,
  step: number
): Array<{ x: number; y: number }> {
  if (pts.length < 2) return [...pts];
  const out: Array<{ x: number; y: number }> = [pts[0]];
  let prev = pts[0];
  let carry = 0; // 마지막 방출점 이후 누적 거리
  for (let i = 1; i < pts.length; i++) {
    const cur = pts[i];
    let segLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    while (carry + segLen >= step && segLen > 0) {
      const t = (step - carry) / segLen;
      const emitted = { x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t };
      out.push(emitted);
      prev = emitted;
      segLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      carry = 0;
    }
    carry += segLen;
    prev = cur;
  }
  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (tail.x !== last.x || tail.y !== last.y) out.push(last);
  return out;
}

function addStationBars(
  slide: PptxGenJS.Slide,
  poiPositions: readonly PoiPosition[],
  routePositions: readonly RouteNormalizedPosition[],
  d: PptDesignConfig,
  radiusPosition: RadiusPosition | null,
  radiusKm: number
) {
  const stations = poiPositions.filter(p => p.poi.category === "subway");
  if (stations.length === 0 || routePositions.length === 0) return;

  // Compute half bar length in slide inches via radius mapping.
  let halfBarInch = 0.45; // fallback
  if (radiusPosition && radiusKm > 0) {
    const radiusM = radiusKm * 1000;
    const radiusInchX = radiusPosition.radiusNx * SLIDE_W;
    const radiusInchY = radiusPosition.radiusNy * SLIDE_H;
    const avgInchPerMeter = (radiusInchX + radiusInchY) / (2 * radiusM);
    halfBarInch = d.stationBarHalfLengthM * avgInchPerMeter;
  }
  const stationBarWidth = d.stationBarWidth;
  const stationBorderWidth = stationBarWidth + Math.max(2, stationBarWidth * 0.4);

  const seenBars = new Set<string>();
  const seenLabels = new Set<string>();

  /** Slide-inch distance between two normalized points */
  function slideDistInch(
    ax: number, ay: number, bx: number, by: number
  ): number {
    const dx = (bx - ax) * SLIDE_W;
    const dy = (by - ay) * SLIDE_H;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Interpolate a point at exact inch distance along route from an index */
  function interpPointInch(
    points: readonly { readonly nx: number; readonly ny: number }[],
    fromIdx: number,
    direction: 1 | -1,
    targetInch: number
  ): { nx: number; ny: number } {
    let remaining = targetInch;
    let idx = fromIdx;
    while (true) {
      const nextIdx = idx + direction;
      if (nextIdx < 0 || nextIdx >= points.length) break;
      const segLen = slideDistInch(
        points[idx].nx, points[idx].ny,
        points[nextIdx].nx, points[nextIdx].ny
      );
      if (segLen >= remaining && segLen > 0) {
        const t = remaining / segLen;
        return {
          nx: points[idx].nx + (points[nextIdx].nx - points[idx].nx) * t,
          ny: points[idx].ny + (points[nextIdx].ny - points[idx].ny) * t,
        };
      }
      remaining -= segLen;
      idx = nextIdx;
    }
    return { nx: points[idx].nx, ny: points[idx].ny };
  }

  for (const station of stations) {
    for (const route of routePositions) {
      if (route.points.length < 2) continue;

      // Find closest point on route
      let minDist = Infinity;
      let closestIdx = 0;
      for (let i = 0; i < route.points.length; i++) {
        const dx = route.points[i].nx - station.nx;
        const dy = route.points[i].ny - station.ny;
        const dist = dx * dx + dy * dy;
        if (dist < minDist) { minDist = dist; closestIdx = i; }
      }

      // Skip if too far (normalized distance threshold)
      if (minDist > 0.003) continue;
      const dedupeKey = `${route.lineColor}:${station.poi.id}`;
      if (seenBars.has(dedupeKey)) continue;
      seenBars.add(dedupeKey);

      // Interpolate exact start/end points at halfBarInch distance
      const startPt = interpPointInch(route.points, closestIdx, -1, halfBarInch);
      const endPt = interpPointInch(route.points, closestIdx, 1, halfBarInch);

      // Build ordered segment: startPt → backward intermediates → closest → forward intermediates → endPt
      const beforePts: { nx: number; ny: number }[] = [];
      let walkIdx = closestIdx;
      let acc = 0;
      while (walkIdx > 0) {
        const segLen = slideDistInch(
          route.points[walkIdx].nx, route.points[walkIdx].ny,
          route.points[walkIdx - 1].nx, route.points[walkIdx - 1].ny
        );
        if (acc + segLen >= halfBarInch) break;
        acc += segLen;
        walkIdx--;
        beforePts.unshift(route.points[walkIdx]);
      }

      const afterPts: { nx: number; ny: number }[] = [];
      walkIdx = closestIdx;
      acc = 0;
      while (walkIdx < route.points.length - 1) {
        const segLen = slideDistInch(
          route.points[walkIdx].nx, route.points[walkIdx].ny,
          route.points[walkIdx + 1].nx, route.points[walkIdx + 1].ny
        );
        if (acc + segLen >= halfBarInch) break;
        acc += segLen;
        walkIdx++;
        afterPts.push(route.points[walkIdx]);
      }

      const segment = [startPt, ...beforePts, route.points[closestIdx], ...afterPts, endPt];

      // Draw thick bar segments
      const color = route.lineColor.replace("#", "");
      for (let i = 0; i < segment.length - 1; i++) {
        const x1 = segment[i].nx * SLIDE_W, y1 = segment[i].ny * SLIDE_H;
        const x2 = segment[i + 1].nx * SLIDE_W, y2 = segment[i + 1].ny * SLIDE_H;
        const x = Math.min(x1, x2), y = Math.min(y1, y2);
        const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);

        // White border (casing) — 원본 보고서 확정 문법: 역사도식선 흰 캐싱. d.markerBorderColor는
        // 다른 요소와 공유하는 범용 잉크색(기본값이 어두움)이라 캐싱 전용으로는 쓰지 않는다.
        slide.addShape("line", {
          x, y, w: Math.max(w, 0.005), h: Math.max(h, 0.005),
          line: { color: pptColor(STATION_CASING_COLOR), width: stationBorderWidth },
          flipV: x2 >= x1 !== y2 >= y1,
        });
        // Colored bar
        slide.addShape("line", {
          x, y, w: Math.max(w, 0.005), h: Math.max(h, 0.005),
          line: { color, width: stationBarWidth },
          flipV: x2 >= x1 !== y2 >= y1,
        });
      }

      // Station name label (once per station, matching map Naver-style)
      const labelKey = `label:${station.poi.id}`;
      if (!seenLabels.has(labelKey)) {
        seenLabels.add(labelKey);

        // Angle: match web map's atan2(dLng, dLat) — negate dy because ny is y-down (opposite of lat)
        const dxInch = (endPt.nx - startPt.nx) * SLIDE_W;
        const dyInch = (endPt.ny - startPt.ny) * SLIDE_H;
        let angleDeg = Math.atan2(dxInch, -dyInch) * (180 / Math.PI) - 90;
        if (angleDeg > 90) angleDeg -= 180;
        if (angleDeg < -90) angleDeg += 180;

        const cx = station.nx * SLIDE_W;
        const cy = station.ny * SLIDE_H;

        // 역 위치 도트(원본 보고서 문법) — 노선색 채움 + 흰 테두리. 역사도식선과 별개로 정확한
        // 역 좌표를 표시하는 노드 마커이자, 별도 배지 없이도 노선을 식별하게 하는 "노선 배지" 역할.
        const stationDotR = stationBarWidth / 72;
        slide.addShape("ellipse", {
          x: cx - stationDotR, y: cy - stationDotR, w: stationDotR * 2, h: stationDotR * 2,
          fill: { color: pptColor(route.lineColor) },
          line: { color: pptColor(STATION_CASING_COLOR), width: 1.8 },
        });

        const length = Math.sqrt(dxInch * dxInch + dyInch * dyInch) || 1;
        const normalA = { x: -dyInch / length, y: dxInch / length };
        const normalB = { x: dyInch / length, y: -dxInch / length };
        const normal = normalA.y <= normalB.y ? normalA : normalB;
        const labelOffsetInch = (stationBarWidth / 2 + d.stationLabelFontSize * 0.75 + 4) / 72;
        const labelCx = cx + normal.x * labelOffsetInch;
        const labelCy = cy + normal.y * labelOffsetInch;
        const labelScale = d.stationLabelFontSize / 9;
        const labelW = station.poi.name.length * 0.12 * labelScale + 0.3;
        const labelH = Math.max(0.22, d.stationLabelFontSize / 72 * 1.7);

        // P4R Task B fix: 원시 ID 역명은 라벨 텍스트만 생략(도트·역사도식선은 위치 정보라 유지).
        if (!isRawPoiId(station.poi.name)) {
          slide.addText(station.poi.name, {
            x: labelCx - labelW / 2,
            y: labelCy - labelH / 2,
            w: labelW,
            h: labelH,
            fontSize: d.stationLabelFontSize,
            fontFace: FONT_MAIN,
            color: pptColor(STATION_CASING_COLOR), // 흰 텍스트 — 원본 보고서 문법(검정 halo 위 흰 역명)
            bold: true,
            align: "center",
            valign: "middle",
            wrap: false,
            rotate: angleDeg,
            shadow: { type: "outer", color: "000000", opacity: 1, blur: 4 },
          });
        }
      }
    }
  }
}

// ── Slides ──────────────────────────────────────────────────────────────────

/**
 * 표지 슬라이드(Task 3 재설계) — 원본 보고서 문법: 지도 없는 거의 검정 배경, 우측 오프셋
 * 테두리 사각 장식, 좌상단 아이브로우 2줄, 좌하단 초대형 타이틀 + 메타 행.
 * 좌표·색·폰트는 ppt-canvas-renderer.ts의 renderCoverSlide와 동일 수치를 유지할 것.
 */
function addCoverSlide(pptx: PptxGenJS, config: AnalysisConfig, _baseMapImage: string, d: PptDesignConfig, sourceStatuses: readonly SourceStatus[] = []) {
  const slide = pptx.addSlide();
  slide.background = { fill: pptColor(d.coverBg) };
  addCoverFrameSquares(slide);

  // 좌상단 아이브로우: 1줄 주소 요약(centerName) · 2줄 "사이트 입지 분석"(Bold, 자간 극대)
  const eyebrowLine1FontSize = Math.round(d.coverSubtitleFontSize * 0.75);
  slide.addText(config.centerName, {
    x: COVER_EYEBROW_X, y: COVER_EYEBROW_LINE1_Y, w: COVER_EYEBROW_W, h: COVER_EYEBROW_LINE1_H,
    fontSize: eyebrowLine1FontSize, fontFace: FONT_MAIN, color: pptColor(COVER_EYEBROW_LINE1_COLOR),
    charSpacing: COVER_EYEBROW_LINE1_LETTER_SPACING, align: "left", valign: "top", margin: 0,
  });
  slide.addText("사이트 입지 분석", {
    x: COVER_EYEBROW_X, y: COVER_EYEBROW_LINE2_Y, w: COVER_EYEBROW_W, h: COVER_EYEBROW_LINE2_H,
    fontSize: d.coverSubtitleFontSize, fontFace: FONT_MAIN, color: pptColor("#FFFFFF"), bold: true,
    charSpacing: COVER_EYEBROW_LINE2_LETTER_SPACING, align: "left", valign: "top", margin: 0,
  });

  // 좌하단 초대형 타이틀(centerName) + 메타 행
  slide.addText(config.centerName, {
    x: COVER_TITLE_X, y: COVER_TITLE_Y, w: COVER_TITLE_W, h: COVER_TITLE_H,
    fontSize: d.coverTitleFontSize, fontFace: FONT_MAIN, color: pptColor("#FFFFFF"), bold: true,
    align: "left", valign: "bottom", margin: 0,
  });
  const refDate = new Date().toLocaleDateString("ko-KR"); // 기존 코드가 쓰던 날짜 산출 방식 재사용
  slide.addText(`반경 ${config.radiusKm}km / ${refDate} / Site Analysis`, {
    x: COVER_TITLE_X, y: COVER_META_Y, w: COVER_TITLE_W, h: COVER_META_H,
    fontSize: d.coverMetaFontSize, fontFace: FONT_MAIN, color: pptColor(COVER_META_COLOR),
    align: "left", valign: "top", margin: 0,
  });

  if (hasFailedSource(sourceStatuses)) {
    // 표지는 거의 검정 배경(coverBg)이라 공유 mutedTextColor(밝은 배경용 회색)는 대비가 낮다.
    // 이 호출부에서만 밝은 색을 넘겨 가독성을 확보 — 다른 슬라이드의 addFooterNote 호출은 무변경.
    addFooterNote(slide, "⚠ 일부 데이터 누락 — 출처 슬라이드 참조", d, "#E2E8F0");
  }
}

/** 값 조각(FactSheetSegment) 배열을 텍스트 런(run) 배열로 변환해 한 addText 호출에 담는다 — accent 조각만 accentRed로 강조. */
function addFactSheetValueRuns(
  slide: PptxGenJS.Slide,
  segments: readonly FactSheetSegment[],
  x: number, y: number, w: number, h: number,
  d: PptDesignConfig,
  fontSize: number
) {
  slide.addText(
    segments.map((seg) => ({
      text: seg.text,
      options: { color: pptColor(seg.accent ? d.accentRed : d.textColor), bold: !!seg.accent },
    })),
    { x, y, w, h, fontSize, fontFace: FONT_MAIN, align: "left", valign: "middle", margin: 0 }
  );
}

/** 중앙 상단 제목 + 좌우 수평선 플랭크 (design doc "B. 백색 정보 슬라이드"). */
function addFactSheetTitle(slide: PptxGenJS.Slide, d: PptDesignConfig) {
  const centerX = SLIDE_W / 2;
  const boxX = centerX - FACT_TITLE_BOX_W / 2;
  slide.addText(FACT_TITLE_TEXT, {
    x: boxX, y: FACT_TITLE_Y, w: FACT_TITLE_BOX_W, h: FACT_TITLE_H,
    fontSize: FACT_TITLE_FONT_SIZE, fontFace: FONT_MAIN, bold: true, color: pptColor(d.textColor),
    align: "center", valign: "middle", margin: 0,
  });
  const lineY = FACT_TITLE_Y + FACT_TITLE_H / 2;
  slide.addShape("line", {
    x: FACT_FRAME_X, y: lineY, w: boxX - FACT_FRAME_X, h: 0,
    line: { color: pptColor(d.mutedTextColor), transparency: 45, width: 0.8 },
  });
  const rightLineStart = boxX + FACT_TITLE_BOX_W;
  slide.addShape("line", {
    x: rightLineStart, y: lineY, w: (SLIDE_W - FACT_FRAME_X) - rightLineStart, h: 0,
    line: { color: pptColor(d.mutedTextColor), transparency: 45, width: 0.8 },
  });
  slide.addText(FACT_SUBTITLE_TEXT, {
    x: centerX - 2.2, y: FACT_SUBTITLE_Y, w: 4.4, h: FACT_SUBTITLE_H,
    fontSize: 10, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor),
    align: "center", valign: "middle", margin: 0,
  });
}

/**
 * 백색 팩트 시트 슬라이드(Task 4, 표지 다음 2번 위치): 흰 배경 + 중앙 상단 제목(좌우 수평선
 * 플랭크) + 라운드 대형 외곽 프레임 + 검정 헤더 표(행 라벨/값/출처, 핵심 수치는 accentRed 강조).
 * 팩트 계산은 fact-summary.ts(buildFactSummary/buildFactSheetRows)를 canvas 렌더러와 공유해
 * 두 렌더러가 항상 동일 수치를 표시하도록 보장한다.
 */
function addFactSheetSlide(
  pptx: PptxGenJS,
  config: AnalysisConfig,
  allPois: readonly Poi[],
  d: PptDesignConfig,
  sourceStatuses: readonly SourceStatus[] = []
) {
  const slide = pptx.addSlide();
  slide.background = { fill: pptColor(d.canvasColor) };

  addFactSheetTitle(slide, d);

  slide.addShape("rect", {
    x: FACT_FRAME_X, y: FACT_FRAME_Y, w: FACT_FRAME_W, h: FACT_FRAME_H,
    fill: { color: pptColor(d.canvasColor), transparency: 100 },
    line: { color: pptColor(d.mutedTextColor), transparency: 70, width: 1 },
    rectRadius: FACT_FRAME_RADIUS,
  });

  const summary = buildFactSummary({ config, allPois });
  const rows = buildFactSheetRows(config, summary);

  let y = FACT_TABLE_Y;
  slide.addShape("rect", {
    x: FACT_TABLE_X, y, w: FACT_TABLE_W, h: FACT_HEADER_H,
    fill: { color: pptColor(d.insightCardBg), transparency: 0 },
    line: { color: pptColor(d.insightCardBg), transparency: 100 },
  });
  slide.addText("구분", {
    x: FACT_TABLE_X + 0.18, y, w: FACT_LABEL_W - 0.18, h: FACT_HEADER_H,
    fontSize: 11, fontFace: FONT_MAIN, bold: true, color: pptColor(d.insightCardText),
    align: "left", valign: "middle", margin: 0,
  });
  slide.addText("핵심 수치", {
    x: FACT_TABLE_X + FACT_LABEL_W + 0.12, y, w: FACT_VALUE_W - 0.12, h: FACT_HEADER_H,
    fontSize: 11, fontFace: FONT_MAIN, bold: true, color: pptColor(d.insightCardText),
    align: "left", valign: "middle", margin: 0,
  });
  slide.addText("출처", {
    x: FACT_TABLE_X + FACT_LABEL_W + FACT_VALUE_W, y, w: FACT_SOURCE_W - 0.15, h: FACT_HEADER_H,
    fontSize: 9, fontFace: FONT_MAIN, bold: true, color: pptColor(d.insightCardText),
    align: "right", valign: "middle", margin: 0,
  });
  y += FACT_HEADER_H;

  rows.forEach((row) => {
    slide.addText(row.label, {
      x: FACT_TABLE_X + 0.18, y, w: FACT_LABEL_W - 0.18, h: FACT_ROW_H,
      fontSize: 10.5, fontFace: FONT_MAIN, bold: true, color: pptColor(d.textColor),
      align: "left", valign: "middle", margin: 0,
    });
    addFactSheetValueRuns(
      slide, row.value, FACT_TABLE_X + FACT_LABEL_W + 0.12, y, FACT_VALUE_W - 0.12, FACT_ROW_H, d, FACT_VALUE_FONT_SIZE
    );
    slide.addText(row.source, {
      x: FACT_TABLE_X + FACT_LABEL_W + FACT_VALUE_W, y, w: FACT_SOURCE_W - 0.15, h: FACT_ROW_H,
      fontSize: 7.5, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor),
      align: "right", valign: "middle", margin: 0,
    });
    slide.addShape("line", {
      x: FACT_TABLE_X, y: y + FACT_ROW_H, w: FACT_TABLE_W, h: 0,
      line: { color: pptColor(d.mutedTextColor), transparency: 80, width: 0.5 },
    });
    y += FACT_ROW_H;
  });

  slide.addText("※ 도보시간은 직선거리 기준 분속 80m 환산치이며, 실제 보행 경로와 차이가 있을 수 있습니다.", {
    x: FACT_TABLE_X, y: y + 0.14, w: FACT_TABLE_W, h: 0.2,
    fontSize: 8, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor), margin: 0,
  });

  if (hasFailedSource(sourceStatuses)) {
    addFooterNote(slide, "⚠ 일부 데이터 누락 — 출처 슬라이드 참조", d);
  }
}

function addOverviewSlide(
  pptx: PptxGenJS,
  config: AnalysisConfig,
  baseMapImage: string,
  poiPositions: readonly PoiPosition[],
  radiusPosition: RadiusPosition | null,
  routePositions: readonly RouteNormalizedPosition[],
  d: PptDesignConfig
) {
  const slide = pptx.addSlide();
  addFullBleedMap(slide, baseMapImage, d);
  addConcentricRings(slide, radiusPosition, d);
  const subwayAsMarkers = routePositions.length === 0;
  addSubwayRouteLines(slide, routePositions, d);
  addPoiMarkers(slide, poiPositions, subwayAsMarkers
    ? ["school", "park", "mountain", "apartment", "officetel", "residential", "subway"]
    : ["school", "park", "mountain", "apartment", "officetel", "residential"], d, {
    showLabels: false, size: d.markerSizeSm,
  });
  if (!subwayAsMarkers) {
    addStationBars(slide, poiPositions, routePositions, d, radiusPosition, config.radiusKm);
  }
  addSiteMarker(slide, radiusPosition, d);
  addMapSectionTitle(slide, "입지 현황 종합", `반경 ${config.radiusKm}km`);
  addLegend(slide, d);
}

function addScoreDashboardSlide(
  pptx: PptxGenJS,
  config: AnalysisConfig,
  pois: readonly Poi[],
  _baseMapImage: string,
  d: PptDesignConfig,
) {
  const slide = pptx.addSlide();
  // P4R Task C-7a: 백색(B문법) 전환 — 토글 on 시에만 노출되는 슬라이드라 Task A 일괄 전환에서
  // 누락되어 있었다. 다른 백색 정보 슬라이드와 동일하게 지도/오버레이/프레임 제거.
  slide.background = { fill: pptColor(d.canvasColor) };
  addTitleChip(slide, "입지 점수 대시보드", d, "분석 항목별 경쟁력");

  const scores = computeAnalysisScores(config, pois);
  const strongest = [...scores.items].sort((a, b) => b.score / b.max - a.score / a.max)[0];
  const weakest = [...scores.items].sort((a, b) => a.score / a.max - b.score / b.max)[0];
  const gradeColor = scores.total >= 76 ? "#22C55E" : scores.total >= 64 ? "#3B82F6" : scores.total >= 50 ? "#F59E0B" : "#EF4444";

  addDataPanel(slide, 0.7, 1.25, 3.0, 4.8, d);
  slide.addText("TOTAL", {
    x: 1.0, y: 1.6, w: 2.4, h: 0.28,
    fontSize: 9, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor), bold: true, align: "center",
  });
  slide.addText(`${scores.total}`, {
    x: 0.9, y: 1.9, w: 2.6, h: 0.95,
    fontSize: 46, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true, align: "center",
  });
  slide.addText(`/100`, {
    x: 2.55, y: 2.52, w: 0.6, h: 0.24,
    fontSize: 12, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor), bold: true,
  });
  slide.addShape("ellipse", {
    x: 1.55, y: 3.05, w: 1.3, h: 1.3,
    fill: { color: pptColor(gradeColor), transparency: 8 },
    line: { color: pptColor(gradeColor), width: 1.2 },
  });
  slide.addText(scores.grade, {
    x: 1.55, y: 3.32, w: 1.3, h: 0.42,
    fontSize: 26, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true, align: "center",
  });
  slide.addText(scores.headline, {
    x: 0.95, y: 4.72, w: 2.5, h: 0.72,
    fontSize: 10, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true,
    align: "center", valign: "middle",
  });

  const startX = 4.15;
  const startY = 1.25;
  addDataPanel(slide, 4.0, 1.08, 8.7, 4.24, d);
  scores.items.forEach((item, idx) => {
    const y = startY + idx * 0.87;
    const ratio = item.score / item.max;
    const color = getScoreColor(ratio);
    slide.addText(item.label, {
      x: startX, y, w: 1.1, h: 0.22,
      fontSize: 10, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true,
    });
    slide.addText(`${item.score}/${item.max} · ${getLevelLabel(item.level)}`, {
      x: startX + 1.15, y, w: 1.4, h: 0.22,
      fontSize: 8, fontFace: FONT_MAIN, color: pptColor(color), bold: true, align: "right",
    });
    addProgressBar(slide, startX, y + 0.31, 2.55, item.score, item.max, color, d);
    slide.addText(item.detail, {
      x: startX + 2.85, y: y - 0.02, w: 5.55, h: 0.46,
      fontSize: 8.2, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor), fit: "shrink",
    });
  });

  addMetricCard(slide, 4.15, 6.05, 2.55, 0.8, "최고 경쟁력", strongest.label, strongest.detail, getScoreColor(strongest.score / strongest.max), d);
  addMetricCard(slide, 6.9, 6.05, 2.55, 0.8, "보완 검토", weakest.label, weakest.detail, getScoreColor(weakest.score / weakest.max), d);
  // P4R Task C fix: 저대비 지명 hex(#93C5FD) 정리 — 등급색(gradeColor)이 아닌 참고 카드이므로 무채 잉크.
  addMetricCard(slide, 9.65, 6.05, 2.55, 0.8, "분석 반경", `${config.radiusKm}km`, `${pois.length.toLocaleString()}개 POI 반영`, d.accentColor, d);
  addFooterNote(slide, "점수는 POI 수, 거리, 면적, 정비사업 경계 확인 여부를 조합한 내부 기준입니다.", d);
}

function addInsightSummarySlide(
  pptx: PptxGenJS,
  config: AnalysisConfig,
  pois: readonly Poi[],
  _baseMapImage: string,
  d: PptDesignConfig,
) {
  const slide = pptx.addSlide();
  // Task A: 백색(B문법) 전환 — 2단계에서 지도가 흑백·어둡게 바뀐 뒤에도 이 슬라이드는 구 문법
  // (밝은 지도 시절의 어두운 잉크 타이틀/각주)이 남아 판독 불가했다. 팩트시트/출처 슬라이드와
  // 동일한 단색 흰 배경으로 전환 — 지도 베이스맵/오버레이/프레임 제거.
  slide.background = { fill: pptColor(d.canvasColor) };
  addTitleChip(slide, "핵심 인사이트 요약", d, "강점 · 리스크 · 후속 확인");

  const narrative = generateAnalysisNarrative(config, pois);
  addDataPanel(slide, 0.7, 1.15, 11.95, 1.05, d);
  slide.addText(narrative.summary, {
    x: 1.0, y: 1.38, w: 11.35, h: 0.52,
    fontSize: 17, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true, fit: "shrink",
  });

  // P4R Task C-1: 구 팔레트(초록/주황/파랑) 정리 — 2단계 팔레트(무채 잉크 + accentRed 1곳)로.
  // 3열 중 "리스크"만 주의가 필요한 항목이라 accentRed로 강조하고 나머지는 무채 잉크 스트립.
  const columns = [
    { title: "핵심 강점", rows: narrative.bullets.slice(0, 5), color: d.accentColor },
    { title: "리스크", rows: narrative.risks.length ? narrative.risks.slice(0, 5) : ["현재 데이터 기준 중대한 약점은 제한적입니다."], color: d.accentRed },
    { title: "다음 액션", rows: narrative.nextActions.slice(0, 5), color: d.accentColor },
  ];
  columns.forEach((column, idx) => {
    const x = 0.7 + idx * 4.05;
    addDataPanel(slide, x, 2.55, 3.75, 3.85, d);
    slide.addShape("rect", {
      x, y: 2.55, w: 3.75, h: 0.08,
      fill: { color: pptColor(column.color), transparency: 0 },
      line: { color: pptColor(column.color), transparency: 100 },
    });
    slide.addText(column.title, {
      x: x + 0.22, y: 2.82, w: 3.3, h: 0.28,
      fontSize: 13, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true,
    });
    column.rows.forEach((text, rowIdx) => {
      slide.addText(`${rowIdx + 1}. ${text}`, {
        x: x + 0.25, y: 3.28 + rowIdx * 0.55, w: 3.25, h: 0.42,
        fontSize: 8.6, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor), fit: "shrink",
      });
    });
  });
  addFooterNote(slide, "요약 문장은 현재 검색 결과와 점수 모델을 기반으로 자동 생성됩니다.", d);
}

function addRadiusAnalysisSlide(
  pptx: PptxGenJS,
  config: AnalysisConfig,
  pois: readonly Poi[],
  _baseMapImage: string,
  _radiusPosition: RadiusPosition | null,
  d: PptDesignConfig,
) {
  const slide = pptx.addSlide();
  // Task A: 백색(B문법) 전환 — 아래 렌더 로직 대부분이 카드/패널로 화면을 거의 다 덮으므로
  // 지도는 장식 이상의 정보를 전달하지 못했다. 링/대상지 마커도 지도 없이는 무의미해 함께 제거.
  slide.background = { fill: pptColor(d.canvasColor) };
  addTitleChip(slide, "생활권 반경 분석", d, "500m · 1km · 1.5km · 전체 반경");

  // P4R Task C-7b: 아래 2×2 그리드는 4칸을 가정한다 — buildInsightOverlays가 그 이상을 반환해도
  // 패널(gridH=1.3, 2행)을 벗어나지 않도록 방어적으로 4개까지만 사용한다.
  const overlays = buildInsightOverlays(config, pois).slice(0, 4);
  // P4R Task C-1/5: 구 팔레트(주황/파랑/핑크/회색) 정리 → 무채 잉크 + accentRed 1곳(보고서 분석권 —
  // 이후 전 슬라이드 POI 집계가 이 반경을 기준으로 하므로 대표 지표로 선택). "개발 영향권"(1.5km
  // 고정)과 "보고서 분석권"(설정 반경)의 반경이 완전히 같으면(분석 반경 1.5km) 두 카드의 수치가
  // 항상 동일해 중복 카드가 되므로 하나로 합치고 "개발 영향권 겸" 부제를 붙인다(4장 → 3장).
  const analysisRadiusM = config.radiusKm * 1000;
  const developmentImpactRadiusM = 1500;
  const mergeDevelopmentIntoAnalysisCard = analysisRadiusM === developmentImpactRadiusM;
  interface RadiusRow { label: string; radiusM: number; color: string; note: string; subtitle?: string }
  const radiusRows: RadiusRow[] = mergeDevelopmentIntoAnalysisCard
    ? [
        { label: "근린 핵심권", radiusM: 500, color: d.accentColor, note: "도보·일상 접근성의 1차 체감권" },
        { label: "생활 편의권", radiusM: 1000, color: d.accentColor, note: "통학·공원·역세권을 함께 판단" },
        { label: "보고서 분석권", radiusM: analysisRadiusM, color: d.accentRed, note: "PPT 전체 POI 집계 기준", subtitle: "개발 영향권 겸" },
      ]
    : [
        { label: "근린 핵심권", radiusM: 500, color: d.accentColor, note: "도보·일상 접근성의 1차 체감권" },
        { label: "생활 편의권", radiusM: 1000, color: d.accentColor, note: "통학·공원·역세권을 함께 판단" },
        { label: "개발 영향권", radiusM: developmentImpactRadiusM, color: d.accentColor, note: "정비사업과 공급 변화의 영향권" },
        { label: "보고서 분석권", radiusM: analysisRadiusM, color: d.accentRed, note: "PPT 전체 POI 집계 기준" },
      ];
  // 카드 배치: 기존 2열×2행 간격 규칙(x=0.72/6.77, y=1.25/3.6, w=5.55, h=1.95)을 그대로 재사용.
  // 3장으로 줄면 마지막 카드만 두 열을 합친 폭(11.6 = 기존 그리드 우측 끝과 동일)으로 확장한다.
  const cardLayouts = mergeDevelopmentIntoAnalysisCard
    ? [
        { x: 0.72, y: 1.25, w: 5.55, h: 1.95 },
        { x: 6.77, y: 1.25, w: 5.55, h: 1.95 },
        { x: 0.72, y: 3.6, w: 11.6, h: 1.95 },
      ]
    : [
        { x: 0.72, y: 1.25, w: 5.55, h: 1.95 },
        { x: 6.77, y: 1.25, w: 5.55, h: 1.95 },
        { x: 0.72, y: 3.6, w: 5.55, h: 1.95 },
        { x: 6.77, y: 3.6, w: 5.55, h: 1.95 },
      ];

  radiusRows.forEach((row, idx) => {
    const { x, y, w } = cardLayouts[idx];
    addDataPanel(slide, x, y, w, 1.95, d);
    slide.addText(row.label, {
      x: x + 0.26, y: y + 0.2, w: 2.6, h: 0.28,
      fontSize: 13, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true,
    });
    if (row.subtitle) {
      slide.addText(row.subtitle, {
        x: x + 0.26, y: y + 0.47, w: 3.2, h: 0.16,
        fontSize: 7.5, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor),
      });
    }
    slide.addText(row.radiusM >= 1000 ? `${(row.radiusM / 1000).toFixed(row.radiusM % 1000 === 0 ? 0 : 1)}km` : `${row.radiusM}m`, {
      x: x + w - 1.4, y: y + 0.16, w: 1.05, h: 0.34,
      fontSize: 17, fontFace: FONT_MAIN, color: pptColor(row.color), bold: true, align: "right",
    });
    const metricGap = (w - 0.6) / 4;
    const metrics = [
      { label: "역", value: countWithin(config, pois, row.radiusM, "subway") },
      { label: "학교", value: countWithin(config, pois, row.radiusM, "school") },
      { label: "공원", value: countWithin(config, pois, row.radiusM, "park") },
      { label: "정비", value: countWithin(config, pois, row.radiusM, "maintenance") },
    ];
    metrics.forEach((metric, metricIdx) => {
      const mx = x + 0.3 + metricIdx * metricGap;
      slide.addText(metric.label, {
        x: mx, y: y + 0.72, w: 0.8, h: 0.2,
        fontSize: 7, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor), align: "center",
      });
      slide.addText(String(metric.value), {
        x: mx, y: y + 0.96, w: 0.8, h: 0.34,
        fontSize: 18, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true, align: "center",
      });
    });
    slide.addText(row.note, {
      x: x + 0.3, y: y + 1.48, w: w - 0.65, h: 0.22,
      fontSize: 8, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor),
    });
  });

  // Task A: 하단 오버플로 수정 — 4개 항목을 단일 열로 쌓으면 패널이 슬라이드 하단(7.5in) 밖으로
  // 잘리고 각주와 겹쳤다(s8 결함). 2열 2행 그리드로 재배치해 7.5in 안에 들어오게 하고, 라벨 아래
  // 설명을 줄바꿈해 다음 항목과 겹치지 않게 한다. (수치는 ppt-canvas-renderer.ts와 동일)
  const gridX = 0.72, gridY = 5.65, gridW = 11.6, gridH = 1.3;
  addDataPanel(slide, gridX, gridY, gridW, gridH, d);
  slide.addText("지도 인사이트 레이어 기준", {
    x: gridX + 0.2, y: gridY + 0.14, w: gridW - 0.4, h: 0.22,
    fontSize: 10, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true,
  });
  const gridPad = 0.2, gridColGap = 0.2, gridRowH = 0.45;
  const gridColW = (gridW - gridPad * 2 - gridColGap) / 2;
  const gridTopY = gridY + 0.4;
  overlays.forEach((overlay, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const cx = gridX + gridPad + col * (gridColW + gridColGap);
    const cy = gridTopY + row * gridRowH;
    slide.addShape("ellipse", {
      x: cx, y: cy + 0.04, w: 0.1, h: 0.1,
      fill: { color: pptColor(overlay.color), transparency: 0 },
      line: { color: pptColor(overlay.color), transparency: 100 },
    });
    slide.addText(overlay.label, {
      x: cx + 0.2, y: cy, w: gridColW - 0.2, h: 0.2,
      fontSize: 9, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true, fit: "shrink",
    });
    slide.addText(overlay.description, {
      x: cx + 0.2, y: cy + 0.2, w: gridColW - 0.25, h: 0.24,
      fontSize: 7, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor), fit: "shrink",
    });
  });
  addFooterNote(slide, "반경 분석은 직선거리 기준이며 실제 보행 경로와 차이가 있을 수 있습니다.", d);
}

function addParkAccessDetailSlide(
  pptx: PptxGenJS,
  config: AnalysisConfig,
  pois: readonly Poi[],
  _baseMapImage: string,
  _poiPositions: readonly PoiPosition[],
  _radiusPosition: RadiusPosition | null,
  d: PptDesignConfig,
) {
  const slide = pptx.addSlide();
  // Task A: 백색(B문법) 전환. 부수적으로 반투명 패널 아래 지도 라벨 잔상(ghosting) 문제도
  // 배경이 완전 불투명 흰색이 되며 함께 해소된다.
  slide.background = { fill: pptColor(d.canvasColor) };
  addTitleChip(slide, "공원/녹지 접근성 상세", d, "경계 기준 접근거리 우선");

  const parks = pois.filter((p): p is Park => p.category === "park");
  const summary = summarizeParks(parks);
  // P4R Task B-4b: "접근성 점수 NN/100"(내부 산식 점수)를 팩트 지표(최근접 공원 실거리)로 격하.
  // summary.nearestPark는 park-analysis.ts에서 이미 원시 ID 이름을 건너뛴 표시 후보다.
  const nearestParkDistanceM = summary.nearestPark
    ? summary.nearestPark.access_distance_m ?? summary.nearestPark.distance_m ?? 0
    : null;
  // P4R Task C fix: 구 팔레트(#10B981/#22C55E/#3B82F6/#F59E0B) 정리 — "생활권 공원"(접근성
  // 슬라이드의 대표 지표: 500m 이내 실사용 가능 공원 수)만 accentRed로 강조하고 나머지는 무채 잉크 테두리.
  addMetricCard(slide, 0.55, 1.18, 2.45, 0.86, "생활권 공원", `${summary.nearby500Count}개`, "접근 500m 이내", d.accentRed, d);
  addMetricCard(slide, 3.18, 1.18, 2.45, 0.86, "총 녹지 면적", formatAreaSqm(summary.totalAreaSqm), `${summary.count}개 공원`, d.accentColor, d);
  addMetricCard(slide, 5.8, 1.18, 2.45, 0.86, "최근접 공원",
    nearestParkDistanceM !== null ? formatDistanceM(nearestParkDistanceM) : "미확인",
    summary.nearestPark?.name ?? "반경 내 공원 없음", d.accentColor, d);
  addMetricCard(slide, 8.42, 1.18, 2.45, 0.86, "대형공원", `${summary.majorCount}개`, "광역 이용 가능성", d.accentColor, d);

  // P4R Task B fix: 랭킹 리스트도 원시 ID 이름 공원 제외(표시만 — 상단 카드의 count 집계는 원본 기준).
  const topParks = [...parks]
    .filter((park) => !isRawPoiId(park.name))
    .sort((a, b) => (a.access_distance_m ?? a.distance_m ?? Infinity) - (b.access_distance_m ?? b.distance_m ?? Infinity))
    .slice(0, 7);
  addRankedList(slide, "최근접 공원 접근거리", topParks.map((park) => ({
    label: park.name,
    meta: `${formatDistanceM(park.access_distance_m ?? park.distance_m ?? 0)} · ${park.area_sqm > 0 ? formatAreaSqm(park.area_sqm) : "면적 미확인"}`,
    color: d.accentColor,
  })), 0.55, 2.42, 5.55, d);

  const qualityRows = [
    { label: "대형/광역", value: summary.qualityCounts.major },
    { label: "근린공원", value: summary.qualityCounts.neighborhood },
    { label: "어린이/소공원", value: summary.qualityCounts.children + summary.qualityCounts.small },
    { label: "녹지/기타", value: summary.qualityCounts.green + summary.qualityCounts.unknown },
  ];
  addDataPanel(slide, 6.35, 2.42, 5.35, 3.25, d);
  slide.addText("공원 성격별 구성", {
    x: 6.6, y: 2.68, w: 4.85, h: 0.25,
    fontSize: 12, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true,
  });
  qualityRows.forEach((row, idx) => {
    const y = 3.18 + idx * 0.5;
    slide.addText(row.label, {
      x: 6.65, y, w: 1.45, h: 0.22,
      fontSize: 8.5, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor),
    });
    addProgressBar(slide, 8.25, y + 0.06, 2.1, row.value, Math.max(summary.count, 1), d.accentColor, d);
    slide.addText(`${row.value}개`, {
      x: 10.55, y, w: 0.6, h: 0.22,
      fontSize: 8.5, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true, align: "right",
    });
  });
  slide.addText("경계 좌표가 있는 공원은 폴리곤 외곽선까지의 최단거리를 사용하고, 경계가 없는 공원은 면적 기반 원형 추정으로 보정합니다.", {
    x: 6.65, y: 5.28, w: 4.65, h: 0.34,
    fontSize: 7.4, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor), fit: "shrink",
  });
  addFooterNote(slide, `대상지: ${config.centerName} / 자연환경 데이터는 공공 도시공원·OSM 보조 데이터를 결합합니다.`, d);
}

function addDevelopmentRiskMatrixSlide(
  pptx: PptxGenJS,
  config: AnalysisConfig,
  pois: readonly Poi[],
  _baseMapImage: string,
  _poiPositions: readonly PoiPosition[],
  _radiusPosition: RadiusPosition | null,
  d: PptDesignConfig,
) {
  const slide = pptx.addSlide();
  // Task A: 백색(B문법) 전환.
  slide.background = { fill: pptColor(d.canvasColor) };
  addTitleChip(slide, "개발 호재/리스크 매트릭스", d, "영향도 · 확정성 · 거리");

  const projects = pois.filter((p): p is MaintenanceProject => p.category === "maintenance");
  const summary = summarizeMaintenanceProjects(projects);
  // P4R Task C-1: 구 팔레트(핑크/파랑/주황) 정리 — "정비사업"(총 건수, 나머지 두 지표의 상위 총량)
  // 1곳만 accentRed로 강조하고 나머지는 무채 잉크 테두리.
  addMetricCard(slide, 0.55, 1.15, 2.35, 0.82, "정비사업", `${summary.count}건`, `총 ${formatMaintenanceArea(summary.totalAreaSqm)}`, d.accentRed, d);
  addMetricCard(slide, 3.05, 1.15, 2.35, 0.82, "경계 확인", `${summary.boundaryConfirmedCount}건`, `${summary.count - summary.boundaryConfirmedCount}건은 위치 확인 필요`, d.accentColor, d);
  addMetricCard(slide, 5.55, 1.15, 2.35, 0.82, "주요 사업", `${summary.topProjects.length}건`, "면적·거리 기준 선별", d.accentColor, d);

  const rows = summary.topProjects.slice(0, 7);
  if (rows.length === 0) {
    // P4R Task C-3: 0건일 때 거대한 빈 흰 카드 대신 콜아웃 슬라이드의 컴팩트 중앙 배지 문법.
    // P4R Task C fix: 범용 문구 대신 이 패널(정비사업 상세 테이블) 전용 문구로 정확화.
    addEmptyStateBadge(slide, d, { x: 0.55, y: 2.25, w: 7.35, h: 3.95 }, "표시할 정비사업 상세 내역이 없습니다");
  } else {
    addDataPanel(slide, 0.55, 2.25, 7.35, 3.95, d);
    slide.addText("주요 정비사업 영향도 테이블", {
      x: 0.8, y: 2.5, w: 6.8, h: 0.25,
      fontSize: 12, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true,
    });
    rows.forEach((project, idx) => {
      const y = 2.96 + idx * 0.42;
      const dist = project.distance_m != null ? formatDistanceM(project.distance_m) : "거리 미확인";
      const impact = project.area_sqm >= 100_000 ? "상" : project.area_sqm >= 30_000 ? "중" : "보통";
      const confidence = project.boundary_status === "confirmed" ? "확인" : "미확인";
      slide.addText(project.name, {
        x: 0.82, y, w: 2.8, h: 0.24,
        fontSize: 8.2, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true, fit: "shrink",
      });
      slide.addText(project.stage, {
        x: 3.75, y, w: 1.2, h: 0.24,
        fontSize: 7.4, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor), fit: "shrink",
      });
      // P4R Task C-2: 백카드 저대비 강조 텍스트(#93C5FD/#FBBF24) 정리 — 확인(정상)은 무채 잉크,
      // 미확인(주의 필요)만 accentRed로 백배경에서도 판독 가능하게.
      slide.addText(`${impact} · ${confidence} · ${dist}`, {
        x: 5.02, y, w: 2.1, h: 0.24,
        fontSize: 7.4, fontFace: FONT_MAIN, color: pptColor(project.boundary_status === "confirmed" ? d.textColor : d.accentRed), align: "right",
      });
    });
  }

  addDataPanel(slide, 8.25, 2.25, 4.1, 3.95, d);
  slide.addText("해석 기준", {
    x: 8.52, y: 2.52, w: 3.45, h: 0.25,
    fontSize: 12, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true,
  });
  const notes = [
    "영향도: 사업 면적과 대상지 거리로 판단",
    "확정성: 공식 경계 확인 여부를 우선 반영",
    "초기 단계 사업은 장기 호재이나 일정 변동 리스크가 큼",
    "관리처분·착공 단계는 가시성이 높지만 공급 충격도 함께 검토",
  ];
  notes.forEach((note, idx) => {
    slide.addText(`• ${note}`, {
      x: 8.55, y: 3.02 + idx * 0.55, w: 3.35, h: 0.35,
      fontSize: 8.4, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor), fit: "shrink",
    });
  });
  addFooterNote(slide, "정비사업 데이터는 고시·공공데이터 기준이며, 사업 단계와 고시일은 별도 실사 확인을 권장합니다.", d);
}

function addResidentialSupplySlide(
  pptx: PptxGenJS,
  config: AnalysisConfig,
  pois: readonly Poi[],
  _baseMapImage: string,
  _poiPositions: readonly PoiPosition[],
  _radiusPosition: RadiusPosition | null,
  d: PptDesignConfig,
) {
  const slide = pptx.addSlide();
  // Task A: 백색(B문법) 전환.
  slide.background = { fill: pptColor(d.canvasColor) };
  addTitleChip(slide, "주거 공급 경쟁 구도", d, "세대수 · 분양예정 · 입주 시점");

  const residentials = getResidentialPois(pois);
  const totalUnits = residentials.reduce((sum, apt) => sum + Math.max(0, apt.units), 0);
  const planned = residentials.filter((apt) => apt.status === "planned");
  const totalParking = residentials.reduce((sum, apt) => sum + Math.max(0, apt.parking_count), 0);
  const avgParking = totalUnits > 0 ? totalParking / totalUnits : 0;
  // P4R Task C-1: 구 팔레트(파랑/초록/주황/핑크) 정리 — "총 세대수"(다른 지표들의 상위 총량)만
  // accentRed로 강조. P4R Task C-4: 주거시설 0개면 "0.00대/세대"가 무의미한 지표이므로 "-" 표기.
  addMetricCard(slide, 0.55, 1.16, 2.45, 0.84, "주거시설", `${residentials.length}개`, "아파트·오피스텔 포함", d.accentColor, d);
  addMetricCard(slide, 3.2, 1.16, 2.45, 0.84, "총 세대수", `${totalUnits.toLocaleString()}세대`, `주차 ${totalParking.toLocaleString()}대`, d.accentRed, d);
  addMetricCard(slide, 5.85, 1.16, 2.45, 0.84, "분양예정", `${planned.length}건`, "공급 변화 모니터링", d.accentColor, d);
  addMetricCard(slide, 8.5, 1.16, 2.45, 0.84, "주차비율", totalUnits > 0 ? `${avgParking.toFixed(2)}대/세대` : "-", "단지 상품성 참고", d.accentColor, d);

  // 단지 상세 표 — 확정 필드셋(세대수/준공/주차/최고층수/동수/시공사, 2026-07-14).
  // 부대시설 목록은 셀에 안 들어가므로 표 하단 각주 1줄(최근접 단지)로 처리.
  const detailRows = buildComplexDetailRows(residentials);
  if (detailRows.length === 0) {
    addEmptyStateBadge(slide, d, { x: 0.55, y: 2.34, w: 5.6, h: 3.4 }, "반경 내 확인된 시설이 없습니다");
  } else {
    addDataPanel(slide, 0.55, 2.34, 5.6, 3.4, d);
    slide.addText("주요 단지 상세", {
      x: 0.83, y: 2.6, w: 4.9, h: 0.25,
      fontSize: 12, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true,
    });
    COMPLEX_DETAIL_COLUMNS.forEach((col) => {
      slide.addText(col.label, {
        x: col.x, y: 2.94, w: col.w, h: 0.18,
        fontSize: 7.2, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor), bold: true, align: col.align,
      });
    });
    detailRows.forEach((row, idx) => {
      const y = 3.16 + idx * 0.3;
      const values = complexDetailCellValues(row);
      COMPLEX_DETAIL_COLUMNS.forEach((col, ci) => {
        slide.addText(values[ci], {
          x: col.x, y, w: col.w, h: 0.2,
          fontSize: ci === 0 ? 7.8 : 7.4, fontFace: FONT_MAIN,
          color: pptColor(ci === 0 ? (row.planned ? d.accentRed : d.textColor) : d.mutedTextColor),
          align: col.align, fit: "shrink",
        });
      });
    });
    const welfareNote = buildWelfareNote(residentials);
    if (welfareNote) {
      slide.addText(welfareNote, {
        x: 0.8, y: 5.4, w: 5.15, h: 0.2,
        fontSize: 7, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor), fit: "shrink",
      });
    }
  }

  const timeline = [...residentials]
    .filter((apt) => apt.sale_date || apt.move_in_month)
    .sort((a, b) => (a.move_in_month || a.sale_date).localeCompare(b.move_in_month || b.sale_date))
    .slice(0, 6);
  if (timeline.length === 0) {
    // P4R Task C-3: 0건일 때 거대한 빈 흰 카드 대신 콜아웃 슬라이드의 컴팩트 중앙 배지 문법.
    // P4R Task C fix: 시설(주거시설)은 있으나 일정 데이터만 없는 케이스에서 좌측 랭킹 리스트와
    // 자기모순되지 않도록 범용 문구 대신 이 패널(분양/입주 타임라인) 전용 문구로 정확화.
    addEmptyStateBadge(slide, d, { x: 6.42, y: 2.34, w: 5.2, h: 3.4 }, "일정 정보가 있는 분양/입주 데이터가 없습니다");
  } else {
    addDataPanel(slide, 6.42, 2.34, 5.2, 3.4, d);
    slide.addText("분양/입주 타임라인", {
      x: 6.7, y: 2.6, w: 4.7, h: 0.25,
      fontSize: 12, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true,
    });
    timeline.forEach((apt, idx) => {
      const y = 3.04 + idx * 0.42;
      const date = apt.move_in_month || apt.sale_date;
      // P4R Task C-2: 백카드 저대비 강조 텍스트(#FBBF24) 정리 — 예정일(분양예정 상태)만 accentRed.
      slide.addText(date || "일정 미확인", {
        x: 6.72, y, w: 1.05, h: 0.22,
        fontSize: 7.8, fontFace: FONT_MAIN, color: pptColor(apt.status === "planned" ? d.accentRed : d.mutedTextColor), bold: true,
      });
      slide.addText(apt.name, {
        x: 7.9, y, w: 2.4, h: 0.22,
        fontSize: 7.8, fontFace: FONT_MAIN, color: pptColor(d.textColor), fit: "shrink",
      });
      slide.addText(`${apt.units.toLocaleString()}세대`, {
        x: 10.25, y, w: 0.82, h: 0.22,
        fontSize: 7.4, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor), align: "right",
      });
    });
  }
  addFooterNote(slide, `주거 공급 장표는 ${config.radiusKm}km 반경의 건축물대장·분양 공고 기반 데이터를 요약합니다.`, d);
}

function addDataSourceSlide(
  pptx: PptxGenJS,
  config: AnalysisConfig,
  pois: readonly Poi[],
  _baseMapImage: string,
  d: PptDesignConfig,
  sourceStatuses: readonly SourceStatus[] = [],
) {
  const slide = pptx.addSlide();
  // Task 4: 백색 정보 슬라이드 문법으로 전환 — 지도 베이스맵/오버레이 제거, 단색 흰 배경.
  // 이하 카드·패널·출처 표기 로직은 1단계(Task 7) 그대로 보존.
  slide.background = { fill: pptColor(d.canvasColor) };
  addTitleChip(slide, "데이터 출처 및 신뢰도", d, "보고서 해석 전제");

  const sourceCards = [
    { title: "주소/지도", value: "Naver API", detail: "지오코딩·지도 표시·검색 좌표 기준", color: "#3B82F6" },
    { title: "교통/POI", value: "Naver + OSM", detail: "지하철·생활 POI·보조 경로 데이터", color: "#F59E0B" },
    { title: "공원/녹지", value: "공공데이터 + OSM", detail: "도시공원 면적, 경계 좌표 보조", color: "#10B981" },
    { title: "정비사업", value: "공공 고시 데이터", detail: "서울/부산 정비사업 및 경계 확인", color: "#EC4899" },
    { title: "주거 공급", value: "대장/분양 정보", detail: "세대수, 주차, 분양/입주 일정", color: "#22C55E" },
    { title: "보고서 산출", value: "자동 분석 모델", detail: "거리·개수·면적·단계 기반 점수화", color: "#94A3B8" },
  ];
  sourceCards.forEach((card, idx) => {
    const x = 0.7 + (idx % 3) * 4.0;
    const y = 1.35 + Math.floor(idx / 3) * 1.55;
    addMetricCard(slide, x, y, 3.55, 1.08, card.title, card.value, card.detail, card.color, d);
  });

  const limitations = [
    "거리 기준은 기본적으로 직선거리이며, 일부 공원은 경계 폴리곤 최단거리로 보정합니다.",
    "정비사업은 고시·공공데이터 반영 시점에 따라 단계 또는 경계 정보가 실제와 다를 수 있습니다.",
    "분양·입주 일정과 평면도 링크는 원천 공고 변경에 따라 사후 확인이 필요합니다.",
    "보고서 점수는 의사결정 보조 지표이며, 최종 판단에는 현장조사·시세·법적 검토가 병행되어야 합니다.",
  ];
  addDataPanel(slide, 0.7, 4.72, 11.9, 2.2, d);
  slide.addText("주의사항", {
    x: 1.0, y: 4.98, w: 2.0, h: 0.25,
    fontSize: 12, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true,
  });
  limitations.forEach((text, idx) => {
    slide.addText(`• ${text}`, {
      x: 1.0 + (idx % 2) * 5.75, y: 5.36 + Math.floor(idx / 2) * 0.42, w: 5.25, h: 0.3,
      fontSize: 7.8, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor), fit: "shrink",
    });
  });
  // 1단계 데이터 신뢰성: 소스별 수집일·누락 표기 (Task 7)
  sourceStatusLines(sourceStatuses).forEach((text, idx) => {
    slide.addText(text, {
      x: 1.0 + (idx % 2) * 5.75, y: 6.18 + Math.floor(idx / 2) * 0.2, w: 5.25, h: 0.2,
      fontSize: 9, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor),
    });
  });
  addFooterNote(slide, `${config.centerName} / ${pois.length.toLocaleString()}개 POI 기준 자동 생성`, d);
}

function addCategorySlide(
  pptx: PptxGenJS,
  title: string,
  category: PoiCategory | PoiCategory[],
  config: AnalysisConfig,
  baseMapImage: string,
  poiPositions: readonly PoiPosition[],
  radiusPosition: RadiusPosition | null,
  details: string[],
  d: PptDesignConfig,
  routePositions: readonly RouteNormalizedPosition[] = [],
  allPois: readonly Poi[] = []
) {
  const slide = pptx.addSlide();
  addFullBleedMap(slide, baseMapImage, d);
  addConcentricRings(slide, radiusPosition, d);
  const cats = Array.isArray(category) ? category : [category];
  const hasSubway = cats.includes("subway");
  const subwayBarsAvailable = hasSubway && routePositions.length > 0;
  if (hasSubway) {
    addSubwayRouteLines(slide, routePositions, d);
  }
  const markerCats = subwayBarsAvailable ? cats.filter(c => c !== "subway") : cats;
  addPoiMarkers(slide, poiPositions, markerCats, d, {
    showLabels: !subwayBarsAvailable,
    radiusPosition,
  });
  if (subwayBarsAvailable) {
    addStationBars(slide, poiPositions, routePositions, d, radiusPosition, config.radiusKm);
  }
  addSiteMarker(slide, radiusPosition, d);
  addMapSectionTitle(slide, title, `반경 ${config.radiusKm}km`);

  const panelW = d.panelWidth;
  const panelH = Math.min(4.8, details.length * 0.42 + 0.6);
  addDataPanel(slide, d.panelX, d.panelY, panelW, panelH, d);
  if (details.length === 0) {
    slide.addText(EMPTY_PANEL_TEXT, {
      x: d.panelX + 0.2, y: d.panelY + 0.2, w: panelW - 0.4, h: 0.36,
      fontSize: d.detailFontSize, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor),
    });
  }
  details.forEach((text, i) => {
    slide.addText(`• ${text}`, {
      x: d.panelX + 0.2, y: d.panelY + 0.2 + i * 0.42, w: panelW - 0.4, h: 0.36,
      fontSize: d.detailFontSize, fontFace: FONT_MAIN, color: pptColor(d.textColor),
    });
  });

  // 인사이트 카드(Task 5) — fact-summary 기반 카테고리 결론 2-4줄. 데이터 0건이면 빈 배열이라
  // 카드를 그리지 않고 위 details의 EMPTY_PANEL_TEXT 문법을 그대로 유지한다.
  const insightKey = inferCategoryInsightKey(cats);
  if (insightKey) {
    const summary = buildFactSummary({ config, allPois });
    addInsightCard(slide, buildCategoryInsight(insightKey, summary), d);
  }

  addLegend(slide, d);
}

/** 대상지에서 가장 가까운 주거 단지 1개(빨강 헤더 대상) — haversine 최소 거리, 페이지 무관 전체 기준. */
function findNearestResidentialId(config: AnalysisConfig, residentials: readonly ResidentialPoi[]): string | null {
  let nearestId: string | null = null;
  let minDist = Infinity;
  for (const r of residentials) {
    const dist = haversineDistance(config.centerLat, config.centerLng, r.lat, r.lng);
    if (dist < minDist) {
      minDist = dist;
      nearestId = r.id;
    }
  }
  return nearestId;
}

interface ResidentialTableRow {
  readonly label: string;
  readonly value: string;
}

// ─── 주거 공급 슬라이드: 단지 상세 표 (2026-07-14 확정 필드셋) ────────────────
// canvas 렌더러(ppt-canvas-renderer.ts)의 동명 심볼과 동일 로직/치수를 유지할 것(수치 parity).

/** 컬럼 x/w는 인치. 좌측 패널(x0.55 w5.6) 내부 여백 기준. */
const COMPLEX_DETAIL_COLUMNS = [
  { label: "단지명", x: 0.8, w: 1.45, align: "left" },
  { label: "세대수", x: 2.25, w: 0.7, align: "right" },
  { label: "준공", x: 2.95, w: 0.55, align: "right" },
  { label: "주차", x: 3.5, w: 0.72, align: "right" },
  { label: "층", x: 4.22, w: 0.4, align: "right" },
  { label: "동", x: 4.62, w: 0.4, align: "right" },
  { label: "시공사", x: 5.12, w: 0.85, align: "left" },
] as const;

interface ComplexDetailRow {
  readonly name: string;
  readonly units: string;
  readonly year: string;
  readonly parking: string;
  readonly floors: string;
  readonly dongs: string;
  readonly constructorName: string;
  readonly planned: boolean;
}

/** 공동 시공(쉼표 구분 다수 업체)은 셀 폭을 넘치므로 첫 업체 + "외"로 축약. */
function shortenConstructorName(name: string): string {
  const parts = name.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length <= 1 ? name : `${parts[0]} 외`;
}

/** 세대수 상위 7개 단지의 상세 표 행. 없는 값은 "-" (K-APT 미등록 소단지 등). */
function buildComplexDetailRows(residentials: readonly ResidentialPoi[]): ComplexDetailRow[] {
  return [...residentials]
    .sort((a, b) => b.units - a.units)
    .slice(0, 7)
    .map((apt) => {
      const date = apt.move_in_month || apt.sale_date;
      return {
        name: apt.name,
        units: apt.units > 0 ? apt.units.toLocaleString() : "-",
        year: date ? date.slice(0, 4) : "-",
        parking: apt.parking_count > 0 ? apt.parking_count.toLocaleString() : "-",
        floors: apt.max_floor && apt.max_floor > 0 ? String(apt.max_floor) : "-",
        dongs: apt.dong_count && apt.dong_count > 0 ? String(apt.dong_count) : "-",
        constructorName: apt.constructor_name ? shortenConstructorName(apt.constructor_name) : "-",
        planned: apt.status === "planned",
      };
    });
}

function complexDetailCellValues(row: ComplexDetailRow): readonly string[] {
  return [row.name, row.units, row.year, row.parking, row.floors, row.dongs, row.constructorName];
}

/** 부대시설 각주 — 부대시설 목록이 있는 단지 중 최근접 1개. 없으면 null. */
function buildWelfareNote(residentials: readonly ResidentialPoi[]): string | null {
  const withWelfare = residentials
    .filter((apt) => apt.welfare_facilities)
    .sort((a, b) => (a.distance_m || Infinity) - (b.distance_m || Infinity));
  const first = withWelfare[0];
  if (!first) return null;
  return `부대시설 · ${first.name}: ${first.welfare_facilities}`;
}

/**
 * 미니 데이터표 행 — 세대수/준공·입주(예정)/주차/층·동/시공사/전용면적대 중 가용 필드만,
 * 값이 없는 행은 생략. status=existing의 sale_date는 건축물대장 사용승인일·K-APT
 * 사용검사일이므로 라벨은 "준공". 예약 슬롯(calloutHeight)이 헤더+5행 상한이라
 * 최대 5행까지만 채택(우선순위 = push 순서, 2026-07-14 사용자 확정 규격).
 * canvas 렌더러(ppt-canvas-renderer.ts)의 동명 함수와 동일 로직을 유지할 것(수치 parity).
 */
function buildResidentialTableRows(apt: ResidentialPoi): ResidentialTableRow[] {
  const rows: ResidentialTableRow[] = [];
  if (apt.units > 0) {
    rows.push({ label: "세대수", value: `${apt.units.toLocaleString()}세대` });
  }
  if (apt.move_in_month) {
    rows.push({ label: apt.status === "planned" ? "입주예정" : "입주", value: apt.move_in_month });
  } else if (apt.sale_date) {
    rows.push({ label: apt.status === "planned" ? "분양예정" : "준공", value: `${apt.sale_date.slice(0, 4)}년` });
  }
  if (apt.parking_count > 0) {
    rows.push({ label: "주차", value: `${apt.parking_count.toLocaleString()}대` });
  }
  const floor = apt.max_floor && apt.max_floor > 0 ? `${apt.max_floor}층` : "";
  const dong = apt.dong_count && apt.dong_count > 0 ? `${apt.dong_count}동` : "";
  if (floor || dong) {
    rows.push({ label: "층·동", value: floor && dong ? `${floor}·${dong}` : floor || dong });
  }
  if (apt.constructor_name) {
    rows.push({ label: "시공사", value: shortenConstructorName(apt.constructor_name) });
  }
  const areas = (apt.floorplans ?? [])
    .map((f) => f.area_sqm)
    .filter((a): a is number => typeof a === "number" && a > 0);
  if (areas.length > 0) {
    const min = Math.round(Math.min(...areas));
    const max = Math.round(Math.max(...areas));
    rows.push({ label: "전용면적", value: min === max ? `${min}㎡` : `${min}~${max}㎡` });
  }
  return rows.slice(0, 5);
}

function addApartmentCalloutSlide(
  pptx: PptxGenJS,
  aptsOnPage: readonly ResidentialPoi[],
  allResidentials: readonly ResidentialPoi[],
  config: AnalysisConfig,
  baseMapImage: string,
  poiPositions: readonly PoiPosition[],
  radiusPosition: RadiusPosition | null,
  d: PptDesignConfig,
  pageIdx: number,
  totalPages: number
) {
  const slide = pptx.addSlide();
  addFullBleedMap(slide, baseMapImage, d);
  addConcentricRings(slide, radiusPosition, d);
  addSiteMarker(slide, radiusPosition, d);

  const pageTitle = totalPages > 1
    ? `주변 분양 현황 ${pageIdx + 1}/${totalPages}`
    : "주변 분양 현황";
  // Task A: 지도 배경은 유지하되, 어두운 잉크 addTitleChip 대신 Task 5의 흰 지도 섹션 타이틀
  // 문법(addMapSectionTitle)로 교체해 판독 불가 결함을 해소한다.
  addMapSectionTitle(slide, pageTitle, `반경 ${config.radiusKm}km`);
  addLegend(slide, d);

  if (aptsOnPage.length === 0) {
    addEmptyStateBadge(slide, d);
    return;
  }

  const aptIdSet = new Set(aptsOnPage.map(a => a.id));
  const aptPositions = poiPositions.filter(p => aptIdSet.has(p.poi.id));
  if (aptPositions.length === 0) {
    addEmptyStateBadge(slide, d);
    return;
  }

  // 표 치수: calloutWidth/calloutHeight는 헤더+최대 5행 예약 상한(겹침 방지 레이아웃 입력).
  // 실제 그리는 행 수가 이보다 적은 단지는 예약 슬롯 안에서 세로 중앙 정렬한다.
  const TABLE_W = d.calloutWidth;
  const TABLE_H = d.calloutHeight;
  const CARD_MARGIN = 0.10;
  const HEADER_H = d.calloutHeaderHeight;
  const ROW_H = d.calloutRowHeight;
  const labelPositions = computeResidentialCalloutLayout(
    aptPositions.map(p => ({ id: p.poi.id, nx: p.nx, ny: p.ny })),
    {
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      cardWidth: TABLE_W,
      cardHeight: TABLE_H,
      cardMargin: CARD_MARGIN,
      chipY: d.titleChipY,
      chipHeight: d.titleChipHeight,
      legendRows: Object.keys(CATEGORY_LABELS).length,
      legendRowHeight: LEGEND_ROW_H,
      legendBottomMargin: 0.4,
    },
  );
  const labelPosById = new Map(labelPositions.map(lp => [lp.id, lp]));
  const aptById = new Map(aptsOnPage.map(a => [a.id, a]));
  const nearestId = findNearestResidentialId(config, allResidentials);

  aptPositions.forEach(({ poi, nx, ny }) => {
    const lp = labelPosById.get(poi.id);
    if (!lp) return;
    const apt = aptById.get(poi.id);
    if (!apt) return;

    const markerX = nx * SLIDE_W;
    const markerY = ny * SLIDE_H;
    const isLeftSide = lp.labelX < SLIDE_W / 2;

    // Marker dot
    const dotR = d.markerSize / 2;
    slide.addShape("ellipse", {
      x: markerX - dotR, y: markerY - dotR, w: d.markerSize, h: d.markerSize,
      fill: { color: (d.categoryColors[apt.category] ?? d.categoryColors.apartment).replace("#", "") },
      line: { color: pptColor(d.markerBorderColor), width: d.markerBorderWidth },
    });

    // 표: 예약 슬롯 안에서 실제 높이(헤더+가용 행)만큼만 그리고 세로 중앙 정렬
    const rows = buildResidentialTableRows(apt);
    const tableH = HEADER_H + rows.length * ROW_H;
    const tableX = isLeftSide
      ? CARD_MARGIN
      : SLIDE_W - CARD_MARGIN - TABLE_W;
    const slotY = Math.max(0.05, Math.min(lp.labelY - TABLE_H / 2, SLIDE_H - TABLE_H - 0.05));
    const tableY = slotY + (TABLE_H - tableH) / 2;
    const tableMidY = tableY + tableH / 2;

    // Leader line: marker → inner edge of table (흰 1px — 원본 보고서 콜아웃 문법)
    const lx1 = markerX, ly1 = markerY;
    const lx2 = isLeftSide ? tableX + TABLE_W : tableX;
    const ly2 = tableMidY;
    slide.addShape("line", {
      x: Math.min(lx1, lx2),
      y: Math.min(ly1, ly2),
      w: Math.max(Math.abs(lx2 - lx1), 0.005),
      h: Math.max(Math.abs(ly2 - ly1), 0.005),
      line: { color: pptColor(d.overlayColor), width: d.leaderLineWidth, transparency: d.leaderLineTransparency },
      flipV: (lx2 >= lx1) !== (ly2 >= ly1),
    });

    // 표 외곽 테두리
    slide.addShape("rect", {
      x: tableX, y: tableY, w: TABLE_W, h: tableH,
      fill: { color: pptColor(d.panelColor), transparency: 100 },
      line: { color: pptColor(d.markerBorderColor), transparency: 55, width: 0.6 },
    });

    // 헤더 셀: 단지명 — 대상지 최근접 1곳만 빨강(accentRed), 나머지 검정
    const isNearest = apt.id === nearestId;
    slide.addShape("rect", {
      x: tableX, y: tableY, w: TABLE_W, h: HEADER_H,
      fill: { color: pptColor(isNearest ? d.accentRed : d.primaryColor), transparency: 0 },
      line: { color: pptColor(isNearest ? d.accentRed : d.primaryColor), transparency: 100 },
    });
    slide.addText(apt.name, {
      x: tableX + 0.07, y: tableY, w: TABLE_W - 0.14, h: HEADER_H,
      fontSize: d.calloutFontSize, fontFace: FONT_MAIN, bold: true, color: pptColor(d.overlayColor),
      valign: "middle",
    });

    // 데이터 행: 라벨(좌, 흐림) + 값(우, 진하게) — 백색 행. 행 사이 구분선은 canvas 렌더러와
    // 동일하게(가로 1px only) 별도 line shape로 그려 상하좌우 테두리 렌더 편차를 없앤다.
    rows.forEach((row, idx) => {
      const rowY = tableY + HEADER_H + idx * ROW_H;
      slide.addShape("rect", {
        x: tableX, y: rowY, w: TABLE_W, h: ROW_H,
        fill: { color: pptColor(d.panelColor), transparency: d.calloutTransparency },
        line: { color: pptColor(d.panelColor), transparency: 100 },
      });
      if (idx > 0) {
        slide.addShape("line", {
          x: tableX, y: rowY, w: TABLE_W, h: 0,
          line: { color: pptColor(d.markerBorderColor), transparency: 85, width: 0.5 },
        });
      }
      slide.addText(row.label, {
        x: tableX + 0.07, y: rowY, w: TABLE_W * 0.42, h: ROW_H,
        fontSize: d.calloutDetailFontSize, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor), valign: "middle",
      });
      slide.addText(row.value, {
        x: tableX + TABLE_W * 0.42, y: rowY, w: TABLE_W * 0.58 - 0.07, h: ROW_H,
        fontSize: d.calloutDetailFontSize, fontFace: FONT_MAIN, bold: true, color: pptColor(d.textColor),
        valign: "middle", align: "right",
      });
    });
  });
}

function addSummarySlide(
  pptx: PptxGenJS,
  config: AnalysisConfig,
  pois: readonly Poi[],
  _baseMapImage: string,
  _radiusPosition: RadiusPosition | null,
  d: PptDesignConfig
) {
  const slide = pptx.addSlide();
  // Task A: 백색(B문법) 전환.
  slide.background = { fill: pptColor(d.canvasColor) };
  addTitleChip(slide, "종합 분석 및 시사점", d, `반경 ${config.radiusKm}km`);

  // P4R Task C-6: 백색 전환 후 패널이 6in로 좁아 우측 절반이 공백으로 남았다(p4rA-s14 결함).
  // 다른 백색 정보 슬라이드(핵심 인사이트 요약 등)와 동일하게 콘텐츠 영역 전체 폭(x=0.7, w=11.95)
  // 으로 확장 — 줄 수·문구는 불변, 텍스트 박스 폭만 패널을 따라 함께 넓어진다.
  const summaryPanelX = 0.7;
  const panelW = 11.95;
  addDataPanel(slide, summaryPanelX, d.panelY, panelW, 5, d);

  const points = getSummaryLines(config, pois);
  const lastBodyIdx = points.length - 2; // 마지막 줄은 항상 muted 점수 보조 지표 — 강조는 그 앞줄에 둔다.
  points.forEach((point, idx) => {
    slide.addText(point.text, {
      x: summaryPanelX + 0.3, y: d.panelY + 0.4 + idx * 0.65, w: panelW - 0.5, h: 0.5,
      fontSize: point.muted ? Math.max(8, Math.round(d.summaryFontSize * 0.7)) : d.summaryFontSize,
      fontFace: FONT_MAIN,
      color: pptColor(point.muted ? d.mutedTextColor : d.textColor),
      bold: !point.muted && idx === lastBodyIdx,
    });
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function generateSiteAnalysisPpt(
  config: AnalysisConfig,
  allPois: readonly Poi[],
  baseMapImage: string,
  poiPositions: readonly PoiPosition[],
  radiusPosition: RadiusPosition | null = null,
  routePositions: readonly RouteNormalizedPosition[] = [],
  designConfig: PptDesignConfig = DEFAULT_PPT_DESIGN,
  sourceStatuses: readonly SourceStatus[] = [],
  includeScoreDashboard = false
): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = `${config.centerName} 입지 분석`;
  const d = designConfig;

  // 베이스맵 흑백 톤 변환 — 미리보기(canvas)와 동일한 map-image-tone.ts를 통해 1회 변환.
  // 미리보기에서 이어서 내보내는 흐름이면 canvas 렌더러가 이미 변환/캐시해둔 결과를 그대로 재사용한다.
  const reportBaseMapImage = baseMapImage && d.mapGrayscale !== false
    ? await toReportMapTone(baseMapImage)
    : baseMapImage;

  // 2단계 재설계(Task 7): 표지→팩트시트→입지종합→교통→교육→자연→(기존 상세/현황 슬라이드 유지)
  // →아파트 콜아웃→종합 의견→출처. 점수 대시보드는 기본 제외, 켜면 입지 현황 종합 다음(원위치)에 삽입.
  // 슬라이드 순서는 ppt-canvas-renderer.ts의 buildSlideDefs와 동일하게 유지한다.
  addCoverSlide(pptx, config, reportBaseMapImage, d, sourceStatuses);
  addFactSheetSlide(pptx, config, allPois, d, sourceStatuses);
  addOverviewSlide(pptx, config, reportBaseMapImage, poiPositions, radiusPosition, routePositions, d);
  if (includeScoreDashboard) {
    addScoreDashboardSlide(pptx, config, allPois, reportBaseMapImage, d);
  }

  const subways = allPois.filter((p): p is SubwayStation => p.category === "subway");
  addCategorySlide(pptx, "교통 분석", "subway", config, reportBaseMapImage, poiPositions, radiusPosition,
    subways.filter(s => !isRawPoiId(s.name)).slice(0, 8).map(s => `${s.name} (${s.line})`), d, routePositions, allPois);

  const schools = allPois.filter((p): p is School => p.category === "school");
  addCategorySlide(pptx, "교육 환경", "school", config, reportBaseMapImage, poiPositions, radiusPosition,
    schools.filter(s => !isRawPoiId(s.name)).slice(0, 8).map(s => `${s.name} (${s.level === "elementary" ? "초" : s.level === "middle" ? "중" : "고"})`), d, [], allPois);

  const parks = allPois.filter((p): p is Park => p.category === "park");
  const mountains = allPois.filter(p => p.category === "mountain" && !isRawPoiId(p.name));
  addCategorySlide(pptx, "자연 환경", ["park", "mountain"], config, reportBaseMapImage, poiPositions, radiusPosition,
    [...buildParkDetailLines(parks, 7), ...mountains.slice(0, 1).map(p => `인접 산: ${p.name}`)].slice(0, 8), d, [], allPois);

  addInsightSummarySlide(pptx, config, allPois, reportBaseMapImage, d);
  addRadiusAnalysisSlide(pptx, config, allPois, reportBaseMapImage, radiusPosition, d);
  addParkAccessDetailSlide(pptx, config, allPois, reportBaseMapImage, poiPositions, radiusPosition, d);

  const maintenanceProjects = allPois.filter((p): p is MaintenanceProject => p.category === "maintenance");
  addCategorySlide(pptx, "개발/정비사업 현황", "maintenance", config, reportBaseMapImage, poiPositions, radiusPosition,
    buildMaintenanceDetailLines(maintenanceProjects, 8), d, [], allPois);
  addDevelopmentRiskMatrixSlide(pptx, config, allPois, reportBaseMapImage, poiPositions, radiusPosition, d);

  const residentials = allPois.filter(
    (p): p is ResidentialPoi => p.category === "apartment" || p.category === "officetel" || p.category === "residential"
  );
  addResidentialSupplySlide(pptx, config, allPois, reportBaseMapImage, poiPositions, radiusPosition, d);
  const aptPages = pageResidentials(residentials, APT_PAGE_SIZE);
  aptPages.forEach((aptsOnPage, i) => {
    addApartmentCalloutSlide(pptx, aptsOnPage, residentials, config, reportBaseMapImage, poiPositions,
      radiusPosition, d, i, aptPages.length);
  });

  addSummarySlide(pptx, config, allPois, reportBaseMapImage, radiusPosition, d);
  addDataSourceSlide(pptx, config, allPois, reportBaseMapImage, d, sourceStatuses);

  await pptx.writeFile({ fileName: `${config.centerName}_사이트분석.pptx` });
}
