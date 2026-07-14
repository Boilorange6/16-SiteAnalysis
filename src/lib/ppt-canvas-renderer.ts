/**
 * Canvas-based PPT slide renderer.
 * Mirrors ppt-generator.ts layout logic using Canvas2D for in-browser preview.
 *
 * Coordinate system:
 *   - Slide inches: SLIDE_W=13.333, SLIDE_H=7.5
 *   - Canvas pixels: CANVAS_W=960, CANVAS_H=540
 *   - Scale: SX = SY = 72 px/in  (1pt = 1px at 72 DPI)
 */

import type { Poi, PoiPosition, RadiusPosition, PoiCategory, SubwayStation, ResidentialPoi, School, Park, MaintenanceProject, SourceStatus } from "./types";
import { CATEGORY_LABELS } from "./types";
import { dedupeRouteVariants, type RouteNormalizedPosition } from "./ppt-generator";
import type { PptDesignConfig } from "./ppt-design-config";
import { PPT_FONT_MAIN, PPT_FONT_NUM } from "./ppt-design-config";
import type { AnalysisConfig } from "./types";
import { layoutPoiLabels, poiLabelText } from "./ppt-label-layout";
import { computeResidentialCalloutLayout } from "./ppt-callout-layout";
import { buildParkDetailLines, formatAreaSqm, formatDistanceM, summarizeParks } from "./park-analysis";
import { buildMaintenanceDetailLines, formatMaintenanceArea, summarizeMaintenanceProjects } from "./maintenance-analysis";
import { buildInsightOverlays, computeAnalysisScores, generateAnalysisNarrative, getSummaryLines } from "./analysis-engine";
import { haversineDistance } from "./geo";
import { sourceStatusLines, hasFailedSource } from "./source-status-text";
import { toReportMapTone } from "./map-image-tone";
import { buildFactSummary, buildFactSheetRows, buildCategoryInsight, type FactSheetSegment, type CategoryInsightKey } from "./fact-summary";
import { isRawPoiId } from "./poi-id-guard";

// ── Coordinate constants ──────────────────────────────────────────────────────

const CANVAS_W = 960;
const CANVAS_H = 540;
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const SX = CANVAS_W / SLIDE_W; // ≈72
const SY = CANVAS_H / SLIDE_H; // 72
// 아파트 콜아웃 슬라이드 1페이지당 카드 수.
// computeResidentialCalloutLayout(ppt-callout-layout.ts)의 좌/우 컬럼 실측 수용량 합은
// calloutHeight=0.73(Task 6, 미니 데이터표 전환) 기준 이론상 최대치이며, 실측 만석 페이지는
// 카드가 컬럼 하단 경계에 딱 맞물려 시각적으로 "하단 적층"처럼 보인다(Task 6 QA, 이월 B).
// 여유 마진을 둔 안전 상한 7로 낮춰 카드 간 여백을 확보한다. 양 렌더러(canvas/pptx) 동일 값 유지.
const APT_PAGE_SIZE = 7;

// ── Static layout tokens (match ppt-generator.ts) ────────────────────────────

const FONT_CANVAS_BASE = `"${PPT_FONT_MAIN}", "${PPT_FONT_NUM}", "맑은 고딕", sans-serif`;

// next/font는 해시된 패밀리명(예: '__Noto_Sans_KR_xxxx')을 CSS 변수 --font-noto-kr로 노출한다.
// canvas ctx.font는 CSS 변수를 해석하지 못하므로, 렌더 시점에 변수 값을 읽어
// 폰트 스택 맨 앞에 연결해야 self-host된 Noto Sans KR을 canvas가 실제로 사용한다.
let cachedCanvasFontStack: string | null = null;

function getNotoFontVarValue(): string {
  if (typeof document === "undefined") return "";
  try {
    return getComputedStyle(document.documentElement).getPropertyValue("--font-noto-kr").trim();
  } catch {
    return "";
  }
}

function getCanvasFontStack(): string {
  if (cachedCanvasFontStack !== null) return cachedCanvasFontStack;
  if (typeof document === "undefined") return FONT_CANVAS_BASE; // SSR: 캐시하지 않음
  const varValue = getNotoFontVarValue();
  cachedCanvasFontStack = varValue ? `${varValue}, ${FONT_CANVAS_BASE}` : FONT_CANVAS_BASE;
  return cachedCanvasFontStack;
}

/** document.fonts.load()용 첫 패밀리명 — 해시 패밀리가 있으면 그것을, 없으면 리터럴 PPT_FONT_MAIN */
function getNotoFamilyForLoad(): string {
  const varValue = getNotoFontVarValue();
  const first = varValue.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
  return first || PPT_FONT_MAIN;
}

const EMPTY_PANEL_TEXT = "반경 내 확인된 시설이 없습니다"; // match ppt-generator.ts
const SITE_LABEL_OFFSET_Y = 0.20;
const RING_RATIOS = [0.33, 0.66, 1.0] as const;

const LEGEND_ICON_SIZE = 0.10;
const LEGEND_ROW_H = 0.22;
const LEGEND_W = 1.4;

// ── Cover slide tokens (Task 3 — match addCoverFrameSquares/addCoverSlide in ppt-generator.ts) ──
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

// ── Map section title tokens (Task 5 — 지도 분석 슬라이드 좌상단 볼드 화이트 타이틀+서브라벨) ──
// 원본 보고서 slide 5 문법: 배경 칩 없는 볼드 화이트 대형 타이틀 + 흰 서브라벨. drawTitleChip은
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

// ── Insight card tokens (Task 5 — 카테고리 슬라이드 우측 하단 라운드 검정 카드) ──
const INSIGHT_CARD_W = 3.6;
const INSIGHT_CARD_X = SLIDE_W - INSIGHT_CARD_W - 0.5;
const INSIGHT_CARD_PAD = 0.26;
const INSIGHT_CARD_TITLE_H = 0.26;
const INSIGHT_CARD_LINE_H = 0.34;
const INSIGHT_CARD_RADIUS = 0.1;
const INSIGHT_CARD_BOTTOM_MARGIN = 0.55;
const INSIGHT_CARD_LABEL = "핵심 포인트";
const INSIGHT_CARD_LABEL_COLOR = "#9CA3AF";

// ── Subway route line dash (Task 5 — 노선 폴리라인 점선화) ──
/** butt cap 기준 대시 패턴(리뷰 #1a). round cap은 대시 양단을 lineWidth/2씩 연장해 실효 간격을
 * 잡아먹어 실선처럼 보이므로 노선 스트로크는 반드시 lineCap="butt"와 함께 쓴다. 72px/in 캔버스에서
 * [7,8] ≈ 대시 0.10in·간격 0.11in — PPT "dash" 프리셋(3pt 선: 대시 ~0.17in·간격 ~0.13in)과 유사 밀도. */
const SUBWAY_ROUTE_DASH = [7, 8];
/** 역사도식선(흰 캐싱) 고정색 — d.markerBorderColor는 다른 요소(범례·POI 마커 등)와 공유하는
 * 범용 잉크색이라 지도 톤에 따라 어두울 수 있음. 역 도식선의 "흰 캐싱"은 원본 보고서 확정 문법이므로
 * 별도 리터럴로 고정한다. */
const STATION_CASING_COLOR = "#FFFFFF";

// ── Fact sheet slide tokens (Task 4 — match ADD_FACT_* constants in ppt-generator.ts) ──
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

// ── Public types ──────────────────────────────────────────────────────────────

export interface SlideRenderInput {
  readonly config: AnalysisConfig;
  readonly allPois: readonly Poi[];
  readonly baseMapImage: string;
  readonly poiPositions: readonly PoiPosition[];
  readonly radiusPosition: RadiusPosition | null;
  readonly routePositions: readonly RouteNormalizedPosition[];
  /** 1단계 데이터 신뢰성: 소스별 수집 상태 — 출처 슬라이드 수집일 표기·표지 누락 경고(Task 7)에서 사용 */
  readonly sourceStatuses?: readonly SourceStatus[];
}

export interface RenderedSlide {
  readonly index: number;
  readonly title: string;
  readonly imageDataUrl: string;
}

// ── Unit helpers ──────────────────────────────────────────────────────────────

function ix(inch: number) { return inch * SX; }
function iy(inch: number) { return inch * SY; }

/** PPT transparency (0-100, 0=opaque) → CSS rgba alpha (0-1, 1=opaque) */
function alpha(transparency: number) { return (100 - transparency) / 100; }

/** hex (#RRGGBB or #RGB) → rgba string */
function hexRgba(hex: string, transparency: number) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha(transparency)})`;
}

function drawLine(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, width: number, transparency = 0) {
  ctx.beginPath();
  ctx.moveTo(ix(x), iy(y));
  ctx.lineTo(ix(x + w), iy(y + h));
  ctx.strokeStyle = hexRgba(color, transparency);
  ctx.lineWidth = width;
  ctx.stroke();
}

// ── Low-level Canvas helpers ──────────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** 흑백 톤 변환된 베이스맵 로드 결과 캐시 — 원본 dataURL(+톤 여부)당 1회만 변환+디코드 */
const toneMappedImageCache = new Map<string, Promise<HTMLImageElement>>();

/**
 * 보고서용 베이스맵 로드 — `map-image-tone.ts`(공유 단일 소스)로 흑백+어둡게 톤 변환한 뒤
 * Image 엘리먼트로 디코드한다. pptx 렌더러(`ppt-generator.ts`)도 같은 `toReportMapTone`을
 * 호출하므로 미리보기≠내보내기 지도 톤 불일치가 없다.
 */
function loadReportBaseImage(src: string, grayscale: boolean): Promise<HTMLImageElement> {
  if (!src) return loadImage(src);
  if (!grayscale) return loadImage(src);
  const cacheKey = `gray:${src}`;
  const cached = toneMappedImageCache.get(cacheKey);
  if (cached) return cached;
  const promise = toReportMapTone(src).then(loadImage);
  toneMappedImageCache.set(cacheKey, promise);
  promise.catch(() => toneMappedImageCache.delete(cacheKey));
  return promise;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  radius: number,
  fillStyle?: string,
  strokeStyle?: string,
  lineWidth?: number
) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill(); }
  if (strokeStyle && lineWidth) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function drawEllipseShape(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, rx: number, ry: number,
  fillStyle?: string,
  strokeStyle?: string,
  lineWidth?: number,
  lineDash?: number[]
) {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill(); }
  if (strokeStyle && lineWidth) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    if (lineDash) ctx.setLineDash(lineDash);
    ctx.stroke();
    if (lineDash) ctx.setLineDash([]);
  }
}

/**
 * Draw text inside a bounding box with optional rounded-rect background.
 * align: "left" | "center" | "right"
 * valign: "top" | "middle" | "bottom"
 */
function drawTextBox(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number, y: number, w: number, h: number,
  options: {
    fontSize: number;
    bold?: boolean;
    color?: string;
    align?: "left" | "center" | "right";
    valign?: "top" | "middle" | "bottom";
    bgColor?: string;
    bgTransparency?: number;
    bgRadius?: number;
    maxWidth?: number;
  }
) {
  const {
    fontSize, bold = false, color = "#FFFFFF",
    align = "left", valign = "middle",
    bgColor, bgTransparency = 0, bgRadius = 0,
  } = options;

  if (bgColor) {
    drawRoundedRect(ctx, x, y, w, h, bgRadius * Math.min(w, h),
      hexRgba(bgColor, bgTransparency));
  }

  ctx.font = `${bold ? "bold " : ""}${fontSize}px ${getCanvasFontStack()}`;
  ctx.fillStyle = color;
  ctx.textBaseline = valign === "top" ? "top" : valign === "middle" ? "middle" : "alphabetic";

  const textY = valign === "top" ? y + 4 : valign === "middle" ? y + h / 2 : y + h - 4;

  if (align === "center") {
    ctx.textAlign = "center";
    ctx.fillText(text, x + w / 2, textY, w - 8);
  } else if (align === "right") {
    ctx.textAlign = "right";
    ctx.fillText(text, x + w - 4, textY, w - 8);
  } else {
    ctx.textAlign = "left";
    ctx.fillText(text, x + 4, textY, w - 8);
  }
}

// ── Mid-level visual element helpers ─────────────────────────────────────────

function drawBaseMap(ctx: CanvasRenderingContext2D, img: HTMLImageElement) {
  ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);
}

function drawMapVeil(ctx: CanvasRenderingContext2D, color: string, transparency: number) {
  if (transparency >= 100) return;
  ctx.fillStyle = hexRgba(color, transparency);
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

function drawMapOverlay(ctx: CanvasRenderingContext2D, d: PptDesignConfig) {
  drawMapVeil(ctx, d.mapOverlayColor, d.mapOverlayTransparency);
  drawCompositionBackdrop(ctx, d, "content");
  drawDesignFrame(ctx, d);
}

/**
 * 표지 문법(Task 3, design doc "A. 표지"): 거의 검정 배경 위 우측 오프셋 흰 테두리 사각 2개.
 * 우상단 1개 + 우하단 1개, 슬라이드 밖으로 살짝 잘리는 배치(원본 보고서 표지 장식 재현).
 * 좌표는 ppt-generator.ts의 addCoverFrameSquares와 동일 수치를 유지할 것.
 */
function drawCoverFrameSquares(ctx: CanvasRenderingContext2D) {
  const stroke = hexRgba("#FFFFFF", COVER_FRAME_TRANSPARENCY);
  drawRoundedRect(ctx, ix(11.55), iy(0.55), ix(2.25), iy(2.25), 0, undefined, stroke, 1);
  drawRoundedRect(ctx, ix(10.65), iy(4.5), ix(2.85), iy(2.35), 0, undefined, stroke, 1);
}

function drawCompositionBackdrop(ctx: CanvasRenderingContext2D, d: PptDesignConfig, _mode: "cover" | "content") {
  switch (d.compositionStyle) {
    case "none":
      break;
    case "split-command":
      ctx.fillStyle = hexRgba(d.accentColor, 0);
      ctx.fillRect(ix(0.32), iy(0.48), ix(0.08), iy(6.08));
      drawLine(ctx, 4.22, 0.45, 0, 6.2, d.accentColor, 1.05, 45);
      drawLine(ctx, 4.46, 0.78, 0, 5.52, d.primaryColor, 0.65, 68);
      for (let i = 0; i < 7; i += 1) {
        const y = 1.0 + i * 0.68;
        drawLine(ctx, 0.62, y, 1.28, 0, d.accentColor, 0.55, 54);
        drawLine(ctx, 0.62, y + 0.24, 2.78, 0, "#FFFFFF", 0.45, 72);
      }
      drawTextBox(ctx, "COMMAND", ix(0.62), iy(0.46), ix(2.6), iy(0.35), { fontSize: 14, bold: true, color: d.accentColor });
      break;
    case "print-editorial":
      drawLine(ctx, 0.64, 0.8, 8.95, 0, d.textColor, 1.25, 0);
      drawLine(ctx, 0.64, 6.86, 8.95, 0, d.textColor, 0.7, 42);
      ctx.fillStyle = hexRgba(d.secondaryAccentColor, 0);
      ctx.fillRect(ix(0.64), iy(0.8), ix(1.85), iy(0.12));
      [1.42, 1.72, 2.02, 2.32].forEach((y, idx) => drawLine(ctx, 7.35, y, 1.85 - idx * 0.18, 0, d.textColor, 0.5, 72));
      drawTextBox(ctx, "WHITE PAPER", ix(7.15), iy(0.54), ix(2.25), iy(0.25), { fontSize: 8, bold: true, color: d.mutedTextColor, align: "right" });
      break;
    case "radar-hud":
      for (let i = 0; i < 9; i += 1) drawLine(ctx, 0, 0.48 + i * 0.72, SLIDE_W, 0, d.accentColor, 0.32, 78);
      for (let i = 0; i < 8; i += 1) drawLine(ctx, 0.55 + i * 1.68, 0, 0, SLIDE_H, d.accentColor, 0.25, 86);
      drawEllipseShape(ctx, ix(6.7), iy(3.75), ix(3.75), iy(3.75), hexRgba(d.accentColor, 96), hexRgba(d.accentColor, 34), 1.35, [8, 8]);
      drawEllipseShape(ctx, ix(6.7), iy(3.75), ix(2.1), iy(2.1), undefined, hexRgba(d.accentColor, 44), 1.0, [5, 7]);
      drawEllipseShape(ctx, ix(6.7), iy(3.75), ix(0.55), iy(0.55), hexRgba(d.accentColor, 78), hexRgba(d.accentColor, 8), 1);
      drawLine(ctx, 6.7, 0.34, 0, 6.82, d.accentColor, 0.9, 45);
      drawLine(ctx, 0.72, 3.75, 11.92, 0, d.accentColor, 0.9, 45);
      drawTextBox(ctx, "RADAR HUD", ix(9.7), iy(0.62), ix(2.2), iy(0.32), { fontSize: 11, bold: true, color: d.accentColor, align: "right" });
      break;
    case "finance-ledger":
      ctx.fillStyle = hexRgba(d.accentColor, 8);
      ctx.fillRect(ix(8.28), iy(0.52), ix(0.12), iy(6.35));
      [0.95, 1.62, 2.29, 2.96, 3.63, 4.3, 4.97, 5.64, 6.31].forEach((y, idx) => {
        drawLine(ctx, 8.82, y, 3.75, 0, d.accentColor, idx % 3 === 0 ? 0.75 : 0.42, idx % 3 === 0 ? 38 : 70);
      });
      drawTextBox(ctx, "INVESTMENT MEMO", ix(9.02), iy(0.45), ix(2.95), iy(0.32), { fontSize: 9.5, bold: true, color: d.accentColor });
      break;
    case "planning-sheet":
      for (let x = 0.25; x < SLIDE_W; x += 0.25) drawLine(ctx, x, 0, 0, SLIDE_H, d.accentColor, 0.25, x % 1 === 0 ? 74 : 88);
      for (let y = 0.25; y < SLIDE_H; y += 0.25) drawLine(ctx, 0, y, SLIDE_W, 0, d.accentColor, 0.25, y % 1 === 0 ? 74 : 88);
      drawLine(ctx, 10.05, 0.62, 2.0, 0, d.accentColor, 1.25, 8);
      drawLine(ctx, 12.05, 0.62, 0, 1.25, d.accentColor, 1.25, 8);
      drawTextBox(ctx, "PLANNING SHEET", ix(0.76), iy(0.68), ix(2.65), iy(0.26), { fontSize: 8.5, bold: true, color: d.textColor });
      break;
    case "landscape-report":
      ctx.fillStyle = hexRgba(d.accentColor, 22);
      ctx.fillRect(ix(9.25), iy(0.42), ix(0.18), iy(6.45));
      drawEllipseShape(ctx, ix(1.15), iy(1.15), ix(3.75), iy(2.55), undefined, hexRgba(d.accentColor, 50), 1);
      drawEllipseShape(ctx, ix(10.85), iy(5.88), ix(3.25), iy(1.75), undefined, hexRgba(d.secondaryAccentColor, 55), 0.8);
      for (let i = 0; i < 4; i += 1) {
        drawEllipseShape(ctx, ix(10.8), iy(5.85), ix(1.2 + i * 0.38), iy(0.72 + i * 0.24), undefined, hexRgba(d.accentColor, 66), 0.65);
      }
      drawTextBox(ctx, "FIELD REPORT", ix(0.82), iy(0.58), ix(2.2), iy(0.28), { fontSize: 9, bold: true, color: d.accentColor });
      break;
    case "luxury-brochure":
      drawRoundedRect(ctx, ix(1.42), iy(0.88), ix(10.48), iy(5.76), 0, undefined, hexRgba(d.accentColor, 8), 1.4);
      drawRoundedRect(ctx, ix(1.72), iy(1.18), ix(9.88), iy(5.16), 0, undefined, hexRgba(d.accentColor, 48), 0.55);
      drawLine(ctx, 2.28, 5.82, 8.75, 0, d.accentColor, 0.75, 28);
      drawTextBox(ctx, "PRIVATE BRIEF", ix(5.05), iy(0.9), ix(3.25), iy(0.35), { fontSize: 10, bold: true, color: d.accentColor, align: "center" });
      break;
    case "transit-atlas":
      ["#E11D48", "#F97316", "#EAB308", "#22C55E", "#2563EB", "#7C3AED"].forEach((color, idx) => {
        ctx.fillStyle = color;
        ctx.fillRect(ix(0.45 + idx * 0.62), iy(0.34), ix(0.45), iy(0.12));
        ctx.fillRect(ix(12.45), iy(0.72 + idx * 0.32), ix(0.26), iy(0.17));
      });
      drawLine(ctx, 1.05, 6.65, 11.05, -5.75, "#E11D48", 1.9, 8);
      drawLine(ctx, 0.55, 5.88, 12.0, -2.75, "#2563EB", 1.65, 10);
      drawLine(ctx, 5.15, 1.14, 7.75, 4.65, "#22C55E", 1.65, 12);
      drawLine(ctx, 0.48, 6.88, 12.05, 0, d.primaryColor, 1.4, 18);
      drawTextBox(ctx, "TRANSIT ATLAS", ix(0.72), iy(0.58), ix(2.4), iy(0.3), { fontSize: 9.5, bold: true, color: d.primaryColor });
      break;
    case "war-room":
      drawLine(ctx, 0.58, 6.82, 11.9, 0, d.accentColor, 1.5, 8);
      drawLine(ctx, 3.62, 0.18, -1.05, 7.08, d.accentColor, 1.0, 28);
      drawLine(ctx, 10.7, 0.18, 1.08, 7.08, d.accentColor, 0.9, 38);
      drawLine(ctx, 12.72, 0.28, 0, 6.64, d.accentColor, 1.0, 42);
      drawTextBox(ctx, "WAR ROOM", ix(0.72), iy(0.62), ix(2.3), iy(0.35), { fontSize: 13, bold: true, color: d.accentColor });
      break;
    case "mono-dossier":
      ctx.fillStyle = d.textColor;
      ctx.fillRect(ix(0.62), iy(0.62), ix(0.16), iy(6.18));
      [1.08, 1.72, 6.52].forEach((y) => drawLine(ctx, 0.96, y, 8.95, 0, d.textColor, y === 1.08 ? 1.1 : 0.65, y === 1.08 ? 0 : 60));
      drawTextBox(ctx, "DOSSIER", ix(8.0), iy(0.62), ix(1.85), iy(0.3), { fontSize: 9, bold: true, color: d.textColor, align: "right" });
      break;
  }
}

function drawDesignFrame(ctx: CanvasRenderingContext2D, d: PptDesignConfig) {
  switch (d.frameStyle) {
    case "none":
      break;
    case "executive-rail":
      ctx.fillStyle = d.accentColor; ctx.fillRect(0, 0, ix(0.22), CANVAS_H);
      ctx.fillRect(ix(0.42), iy(0.22), ix(2.1), iy(0.035));
      drawLine(ctx, 0.42, 6.95, 12.2, 0, d.markerBorderColor, 1, 72);
      break;
    case "editorial-mat":
      drawLine(ctx, 0.7, 0.95, 11.9, 0, d.primaryColor, 0.7, 25);
      drawLine(ctx, 0.7, 6.85, 11.9, 0, d.primaryColor, 0.6, 35);
      break;
    case "satellite-hud":
      [[0.35, 0.35, 0.58, 0], [0.35, 0.35, 0, 0.44], [12.4, 0.35, 0.58, 0], [12.98, 0.35, 0, 0.44], [0.35, 6.68, 0.58, 0], [0.35, 6.24, 0, 0.44], [12.4, 6.68, 0.58, 0], [12.98, 6.24, 0, 0.44]]
        .forEach(([x, y, w, h]) => drawLine(ctx, x, y, w, h, d.accentColor, 1.2, 15));
      drawLine(ctx, 6.66, 0.18, 0, 0.38, d.accentColor, 0.8, 45);
      drawLine(ctx, 6.66, 6.94, 0, 0.38, d.accentColor, 0.8, 45);
      break;
    case "boardroom-ledger":
      ctx.fillStyle = hexRgba(d.accentColor, 18); ctx.fillRect(0, 0, CANVAS_W, iy(0.18)); ctx.fillRect(ix(12.7), iy(0.18), ix(0.18), iy(6.62));
      drawLine(ctx, 0.62, 1.18, 12.05, 0, d.accentColor, 0.7, 55);
      drawLine(ctx, 0.62, 6.85, 12.05, 0, d.accentColor, 0.7, 55);
      break;
    case "blueprint-grid":
      for (let x = 0.5; x < SLIDE_W; x += 0.5) drawLine(ctx, x, 0, 0, SLIDE_H, d.accentColor, 0.25, 88);
      for (let y = 0.5; y < SLIDE_H; y += 0.5) drawLine(ctx, 0, y, SLIDE_W, 0, d.accentColor, 0.25, 88);
      drawLine(ctx, 0.5, 0.92, 12.3, 0, d.accentColor, 1, 35);
      break;
    case "organic-contour":
      drawEllipseShape(ctx, ix(1.75), iy(0.65), ix(2.85), iy(1.55), undefined, hexRgba(d.accentColor, 70), 1.2);
      drawEllipseShape(ctx, ix(11.85), iy(6.1), ix(2.25), iy(1.45), undefined, hexRgba(d.secondaryAccentColor, 70), 1);
      drawLine(ctx, 0.7, 6.82, 11.7, 0, d.accentColor, 1, 58);
      break;
    case "luxury-keyline":
      drawRoundedRect(ctx, ix(0.32), iy(0.28), ix(12.7), iy(6.86), 0, undefined, hexRgba(d.accentColor, 26), 0.9);
      drawRoundedRect(ctx, ix(0.45), iy(0.42), ix(12.43), iy(6.58), 0, undefined, hexRgba(d.accentColor, 62), 0.4);
      break;
    case "metro-wayfinding":
      ctx.fillStyle = d.primaryColor; ctx.fillRect(0, 0, CANVAS_W, iy(0.26));
      ["#EF4444", "#F97316", "#EAB308", "#22C55E", "#2563EB", "#7C3AED"].forEach((color, idx) => {
        ctx.fillStyle = color; ctx.fillRect(ix(0.5 + idx * 0.45), iy(0.26), ix(0.33), iy(0.08));
      });
      break;
    case "deal-room":
      ctx.fillStyle = d.accentColor; ctx.fillRect(0, 0, ix(0.36), CANVAS_H);
      drawLine(ctx, 3.06, 0.25, 0, 6.4, d.primaryColor, 0.95, 44);
      drawLine(ctx, 0.58, 6.84, 11.95, 0, d.accentColor, 1.1, 35);
      break;
    case "minimal-document":
      drawLine(ctx, 0.72, 0.92, 11.9, 0, "#111111", 1.1, 0);
      drawLine(ctx, 0.72, 6.85, 11.9, 0, "#111111", 0.6, 18);
      break;
  }
}

function drawConcentricRings(
  ctx: CanvasRenderingContext2D,
  radiusPosition: RadiusPosition | null,
  d: PptDesignConfig
) {
  if (!radiusPosition) return;
  const cx = radiusPosition.centerNx * CANVAS_W;
  const cy = radiusPosition.centerNy * CANVAS_H;
  const rx = radiusPosition.radiusNx * CANVAS_W;
  const ry = radiusPosition.radiusNy * CANVAS_H;

  // 대상지 반경 링 — accentRed로 강조(원본 보고서 문법: 대상지 빨강). markerBorderColor는
  // POI 마커·범례 등 다른 요소와 공유하는 범용 잉크색이라 대상지 전용 강조에는 accentRed를 쓴다.
  RING_RATIOS.forEach((ratio, idx) => {
    const isOuter = idx === RING_RATIOS.length - 1;
    drawEllipseShape(ctx, cx, cy, rx * ratio, ry * ratio,
      undefined,
      hexRgba(d.accentRed, d.ringTransparency),
      isOuter ? d.ringOuterLineWidth : d.ringLineWidth,
      d.ringDash === "solid" ? undefined : d.ringDash === "dash" ? [8, 6] : [4, 4]
    );
  });
}

function drawSiteMarker(ctx: CanvasRenderingContext2D, radiusPosition: RadiusPosition | null, d: PptDesignConfig) {
  if (!radiusPosition) return;
  const cx = radiusPosition.centerNx * CANVAS_W;
  const cy = radiusPosition.centerNy * CANVAS_H;

  // 대상지 중심 마커 — accentRed로 강조(원본 보고서 문법: 폴리곤 데이터가 없어 마커+링을 빨강화).
  // outer dashed ring
  drawEllipseShape(ctx, cx, cy, ix(d.siteMarkerOuterSize / 2), iy(d.siteMarkerOuterSize / 2),
    undefined, hexRgba(d.accentRed, 10), 1.5, [5, 5]);
  // inner dot
  drawEllipseShape(ctx, cx, cy, ix(d.siteMarkerInnerSize / 2), iy(d.siteMarkerInnerSize / 2),
    d.accentRed, undefined);
  // SITE label
  drawTextBox(ctx, "SITE", cx - ix(0.3), cy + iy(SITE_LABEL_OFFSET_Y), ix(0.6), iy(0.2), {
    fontSize: d.siteLabelFontSize, bold: true, color: d.accentRed, align: "center", valign: "middle",
  });
}

function drawTitleChip(ctx: CanvasRenderingContext2D, title: string, d: PptDesignConfig, subtitle?: string) {
  const chipW = Math.min(Math.max(title.length * ix(0.22) + ix(0.6), ix(1.8)), ix(d.titleChipMaxWidth));
  const chipX = ix(d.titleChipX), chipY = iy(d.titleChipY);
  const chipH = iy(d.titleChipHeight);
  const titleW = d.titleStyle === "transit-sign" ? Math.max(chipW, ix(4.2)) : chipW;

  if (d.titleStyle === "plain") {
    drawTextBox(ctx, title, chipX, chipY, Math.max(chipW, ix(4.2)), chipH, {
      fontSize: d.titleFontSize, bold: true, color: d.textColor, align: "left", valign: "middle",
    });
    if (subtitle) {
      drawTextBox(ctx, subtitle, chipX, chipY + chipH + iy(0.08), ix(3.2), iy(0.22), {
        fontSize: d.subtitleFontSize, color: d.mutedTextColor, align: "left", valign: "middle",
      });
    }
    return;
  }

  if (d.titleStyle === "editorial-rule" || d.titleStyle === "ink-rule") {
    drawTextBox(ctx, title, chipX, chipY, Math.max(chipW, ix(4.2)), chipH, {
      fontSize: d.titleFontSize, bold: true, color: d.textColor, align: "left", valign: "middle",
    });
    drawLine(ctx, d.titleChipX, d.titleChipY + d.titleChipHeight + 0.08, Math.max(chipW / SX, 3.4), 0, d.accentColor, d.titleStyle === "ink-rule" ? 1.1 : 0.8, d.titleStyle === "ink-rule" ? 0 : 12);
    if (subtitle) {
      drawTextBox(ctx, subtitle, chipX, iy(d.titleChipY + d.titleChipHeight + 0.14), ix(3.2), iy(0.22), {
        fontSize: d.subtitleFontSize, color: d.mutedTextColor, align: "left", valign: "middle",
      });
    }
    return;
  }

  if (d.titleStyle === "hud-bracket") {
    drawLine(ctx, d.titleChipX - 0.16, d.titleChipY, 0.22, 0, d.accentColor, 1.1);
    drawLine(ctx, d.titleChipX - 0.16, d.titleChipY, 0, d.titleChipHeight, d.accentColor, 1.1);
    drawLine(ctx, d.titleChipX + titleW / SX - 0.06, d.titleChipY + d.titleChipHeight, 0.22, 0, d.accentColor, 1.1);
    drawLine(ctx, d.titleChipX + titleW / SX + 0.16, d.titleChipY, 0, d.titleChipHeight, d.accentColor, 1.1);
  }
  if (d.titleStyle === "luxury-plaque") {
    drawRoundedRect(ctx, chipX - ix(0.08), chipY - iy(0.06), titleW + ix(0.16), chipH + iy(0.12), ix(0.02),
      hexRgba(d.canvasColor, 12), hexRgba(d.accentColor, 18), 0.8);
  }
  if (d.titleStyle === "transit-sign") {
    drawRoundedRect(ctx, chipX, chipY, titleW, chipH, ix(d.titleChipRadius),
      d.primaryColor);
    ctx.fillStyle = d.accentColor;
    ctx.fillRect(chipX, chipY, ix(0.16), chipH);
  }

  drawRoundedRect(ctx, chipX, chipY, titleW, chipH,
    chipH * d.titleChipRadius,
    hexRgba(d.overlayColor, d.titleChipTransparency));
  drawTextBox(ctx, title, chipX, chipY, titleW, chipH, {
    fontSize: d.titleFontSize, bold: true, color: d.textColor,
    align: d.titleStyle === "blueprint-label" ? "left" : "center", valign: "middle",
  });

  if (subtitle) {
    const subW = Math.min(Math.max(subtitle.length * ix(0.16) + ix(0.4), ix(1.2)), ix(3.0));
    const subY = chipY + chipH + iy(0.08);
    const subH = iy(0.28);
    drawRoundedRect(ctx, chipX, subY, subW, subH, subH * d.titleChipRadius,
      hexRgba(d.overlayColor, Math.min(95, d.titleChipTransparency + 12)));
    drawTextBox(ctx, subtitle, chipX, subY, subW, subH, {
      fontSize: d.subtitleFontSize, color: d.mutedTextColor, align: "center", valign: "middle",
    });
  }
}

/**
 * 지도 분석 슬라이드(overview/category) 전용 좌상단 타이틀 — 원본 보고서 문법: 배경 칩 없는
 * 볼드 화이트 대형 섹션 타이틀 + 흰 서브라벨(반경 표기). 다른 슬라이드는 drawTitleChip을 그대로 쓴다.
 */
function drawMapSectionTitle(ctx: CanvasRenderingContext2D, title: string, subtitle: string) {
  drawTextBox(ctx, title, ix(MAP_TITLE_X), iy(MAP_TITLE_Y), ix(MAP_TITLE_W), iy(MAP_TITLE_H), {
    fontSize: MAP_TITLE_FONT_SIZE, bold: true, color: "#FFFFFF", align: "left", valign: "middle",
  });
  drawTextBox(ctx, subtitle, ix(MAP_TITLE_X), iy(MAP_SUBTITLE_Y), ix(MAP_TITLE_W), iy(MAP_SUBTITLE_H), {
    fontSize: MAP_SUBTITLE_FONT_SIZE, color: MAP_SUBTITLE_COLOR, align: "left", valign: "middle",
  });
}

/** categories 배열로부터 buildCategoryInsight에 넘길 카테고리 키를 추론 — renderCategorySlide의 4개 호출부와 매핑. */
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
function drawInsightCard(ctx: CanvasRenderingContext2D, lines: readonly string[], d: PptDesignConfig) {
  if (lines.length === 0) return;
  const cardH = INSIGHT_CARD_PAD * 2 + INSIGHT_CARD_TITLE_H + lines.length * INSIGHT_CARD_LINE_H;
  const cardY = SLIDE_H - INSIGHT_CARD_BOTTOM_MARGIN - cardH;
  drawRoundedRect(ctx, ix(INSIGHT_CARD_X), iy(cardY), ix(INSIGHT_CARD_W), iy(cardH), ix(INSIGHT_CARD_RADIUS), d.insightCardBg);
  drawTextBox(ctx, INSIGHT_CARD_LABEL,
    ix(INSIGHT_CARD_X + INSIGHT_CARD_PAD), iy(cardY + INSIGHT_CARD_PAD - 0.03),
    ix(INSIGHT_CARD_W - INSIGHT_CARD_PAD * 2), iy(INSIGHT_CARD_TITLE_H), {
      fontSize: 10, bold: true, color: INSIGHT_CARD_LABEL_COLOR, align: "left", valign: "middle",
    });
  lines.forEach((text, i) => {
    const y = cardY + INSIGHT_CARD_PAD + INSIGHT_CARD_TITLE_H + i * INSIGHT_CARD_LINE_H;
    drawTextBox(ctx, text,
      ix(INSIGHT_CARD_X + INSIGHT_CARD_PAD), iy(y),
      ix(INSIGHT_CARD_W - INSIGHT_CARD_PAD * 2), iy(INSIGHT_CARD_LINE_H), {
        fontSize: 11.5, bold: true, color: d.insightCardText, align: "left", valign: "middle",
      });
  });
}

function drawDataPanel(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  d: PptDesignConfig
) {
  const lineColor = d.panelStyle === "paper" || d.panelStyle === "document"
    ? d.textColor
    : d.panelStyle === "luxury" || d.panelStyle === "blueprint" || d.panelStyle === "terminal"
      ? d.accentColor
      : d.markerBorderColor;
  drawRoundedRect(ctx, x, y, w, h, ix(d.panelRadius),
    hexRgba(d.panelColor, d.panelTransparency),
    hexRgba(lineColor, d.panelBorderTransparency), d.panelStyle === "document" ? 0.6 : 1);
  if (d.panelStyle === "ledger" || d.panelStyle === "terminal" || d.panelStyle === "transit") {
    ctx.fillStyle = hexRgba(d.accentColor, d.panelStyle === "terminal" ? 0 : 8);
    ctx.fillRect(x, y, w, iy(0.08));
  }
  if (d.panelStyle === "paper" || d.panelStyle === "document") {
    drawLine(ctx, x / SX + 0.18, y / SY + 0.42, Math.max(0.4, w / SX - 0.36), 0, d.textColor, 0.4, d.panelStyle === "document" ? 72 : 82);
  }
  if (d.panelStyle === "blueprint" || d.panelStyle === "hud") {
    drawLine(ctx, x / SX + 0.1, y / SY + 0.1, 0.32, 0, d.accentColor, 0.8, 15);
    drawLine(ctx, x / SX + 0.1, y / SY + 0.1, 0, 0.32, d.accentColor, 0.8, 15);
    drawLine(ctx, (x + w) / SX - 0.42, (y + h) / SY - 0.1, 0.32, 0, d.accentColor, 0.8, 15);
    drawLine(ctx, (x + w) / SX - 0.1, (y + h) / SY - 0.42, 0, 0.32, d.accentColor, 0.8, 15);
  }
  if (d.panelStyle === "luxury") {
    drawRoundedRect(ctx, x + ix(0.08), y + iy(0.08), Math.max(1, w - ix(0.16)), Math.max(1, h - iy(0.16)), 0, undefined, hexRgba(d.accentColor, 68), 0.35);
  }
}

function drawFooterNote(ctx: CanvasRenderingContext2D, text: string, d: PptDesignConfig, color?: string) {
  drawTextBox(ctx, text, ix(0.55), iy(7.08), ix(12.2), iy(0.22), {
    fontSize: 6.5, color: color ?? d.mutedTextColor, align: "right",
  });
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  w: number,
  lineHeight: number,
  maxLines: number,
  options: { fontSize: number; bold?: boolean; color: string }
) {
  ctx.font = `${options.bold ? "bold " : ""}${options.fontSize}px ${getCanvasFontStack()}`;
  ctx.fillStyle = options.color;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= w || current.length === 0) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  lines.forEach((line, idx) => {
    const clipped = idx === maxLines - 1 && lines.length === maxLines ? line.replace(/\s+\S*$/, "…") : line;
    ctx.fillText(clipped, x, y + idx * lineHeight, w);
  });
}

/**
 * Small centered translucent card + muted text, used when a slide has no panel to host
 * EMPTY_PANEL_TEXT in. `region` (default: whole slide) lets callers center the compact badge
 * inside a sub-panel's footprint instead — P4R Task C-3: 리스크 매트릭스/주거 공급 슬라이드의
 * "0건" 하위 테이블이 거대한 빈 흰 카드로 남던 문제를 이 문법으로 대체.
 */
function drawEmptyStateBadge(
  ctx: CanvasRenderingContext2D,
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
  drawDataPanel(ctx, ix(x), iy(y), ix(w), iy(h), d);
  drawTextBox(ctx, message, ix(x + 0.2), iy(y), ix(w - 0.4), iy(h), {
    fontSize: 13, color: d.mutedTextColor, align: "center", valign: "middle",
  });
}

function drawMetricCard(
  ctx: CanvasRenderingContext2D,
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
  drawRoundedRect(ctx, ix(x), iy(y), ix(w), iy(h), ix(d.metricStyle === "stat-sheet" ? 0.02 : d.panelRadius),
    hexRgba(d.panelColor, fillTransparency), hexRgba(borderColor, d.metricStyle === "stat-sheet" ? 24 : 42), d.metricStyle === "terminal" ? 1.2 : 1);
  if (d.metricStyle === "stripe" || d.metricStyle === "scorecard" || d.metricStyle === "ledger") {
    ctx.fillStyle = color;
    ctx.fillRect(ix(x), iy(y), ix(d.metricStyle === "scorecard" ? 0.1 : 0.06), iy(h));
  } else if (d.metricStyle === "number-plate") {
    drawRoundedRect(ctx, ix(x + 0.12), iy(y + 0.12), ix(0.34), iy(h - 0.24), ix(0.03), hexRgba(d.accentColor, 8));
  } else if (d.metricStyle === "terminal") {
    drawLine(ctx, x + 0.14, y + 0.16, w - 0.28, 0, d.accentColor, 0.7, 15);
  }
  drawTextBox(ctx, label, ix(x + 0.18), iy(y + 0.12), ix(w - 0.34), iy(0.16), {
    fontSize: 7.5, bold: true, color: d.mutedTextColor,
  });
  drawTextBox(ctx, value, ix(x + (d.metricStyle === "number-plate" ? 0.55 : 0.18)), iy(y + 0.28), ix(w - 0.34), iy(0.28), {
    fontSize: d.metricStyle === "number-plate" ? 16 : 18, bold: true, color: d.textColor,
  });
  drawTextBox(ctx, detail, ix(x + 0.18), iy(y + h - 0.24), ix(w - 0.34), iy(0.24), {
    fontSize: 7.5, color: d.mutedTextColor,
  });
}

function drawProgressBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  value: number,
  max: number,
  color: string,
  d: PptDesignConfig,
) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  drawRoundedRect(ctx, ix(x), iy(y), ix(w), iy(0.08), ix(0.03), hexRgba(d.overlayColor, 45));
  drawRoundedRect(ctx, ix(x), iy(y), ix(Math.max(0.02, w * ratio)), iy(0.08), ix(0.03), color);
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

function drawRankedList(
  ctx: CanvasRenderingContext2D,
  title: string,
  rows: readonly { label: string; meta: string; color?: string }[],
  x: number,
  y: number,
  w: number,
  d: PptDesignConfig,
) {
  drawDataPanel(ctx, ix(x), iy(y), ix(w), iy(0.55 + Math.max(rows.length, 1) * 0.38), d);
  drawTextBox(ctx, title, ix(x + 0.18), iy(y + 0.15), ix(w - 0.36), iy(0.22), {
    fontSize: 10, bold: true, color: d.textColor,
  });
  if (rows.length === 0) {
    drawTextBox(ctx, "확인된 데이터가 없습니다.", ix(x + 0.18), iy(y + 0.52), ix(w - 0.36), iy(0.25), {
      fontSize: 8.5, color: d.mutedTextColor,
    });
    return;
  }
  rows.forEach((row, idx) => {
    const rowY = y + 0.52 + idx * 0.38;
    const color = row.color ?? d.markerBorderColor;
    drawEllipseShape(ctx, ix(x + 0.24), iy(rowY + 0.13), ix(0.06), ix(0.06), color);
    drawTextBox(ctx, row.label, ix(x + 0.38), iy(rowY), ix(w * 0.55), iy(0.24), {
      fontSize: 8.5, bold: true, color: d.textColor,
    });
    drawTextBox(ctx, row.meta, ix(x + w * 0.58), iy(rowY), ix(w * 0.35), iy(0.24), {
      fontSize: 7.5, color: d.mutedTextColor, align: "right",
    });
  });
}

function drawLegend(ctx: CanvasRenderingContext2D, d: PptDesignConfig) {
  const items = Object.entries(CATEGORY_LABELS).map(([key, label]) => ({
    label,
    color: d.categoryColors[key as PoiCategory],
  }));
  if (d.legendStyle === "strip") {
    const rowW = ix(5.9);
    const rowH = iy(0.34);
    const x = d.legendPosition.endsWith("right") ? CANVAS_W - rowW - ix(0.55) : ix(0.55);
    const y = d.legendPosition.startsWith("top") ? iy(0.92) : CANVAS_H - iy(0.72);
    drawRoundedRect(ctx, x, y, rowW, rowH, ix(d.legendRadius), hexRgba(d.overlayColor, d.legendTransparency), hexRgba(d.markerBorderColor, d.legendBorderTransparency), 0.6);
    items.slice(0, 6).forEach((item, i) => {
      const itemX = x + ix(0.18 + i * 0.92);
      ctx.fillStyle = item.color;
      ctx.fillRect(itemX, y + iy(0.11), ix(0.12), iy(0.12));
      drawTextBox(ctx, item.label, itemX + ix(0.16), y + iy(0.065), ix(0.6), iy(0.2), {
        fontSize: 6.4, color: d.legendTextColor, valign: "middle",
      });
    });
    return;
  }
  const legH = iy(items.length * LEGEND_ROW_H + 0.15);
  const isRight = d.legendPosition.endsWith("right");
  const isTop = d.legendPosition.startsWith("top");
  const legX = isRight ? CANVAS_W - ix(LEGEND_W) - ix(0.4) : ix(0.4);
  const legY = isTop ? iy(0.4) : CANVAS_H - legH - iy(0.4);
  const legW = ix(LEGEND_W);

  if (d.legendStyle !== "minimal") {
    drawRoundedRect(ctx, legX, legY, d.legendStyle === "rail" ? ix(0.54) : legW, legH, ix(d.legendRadius),
      hexRgba(d.overlayColor, d.legendTransparency),
      hexRgba(d.markerBorderColor, d.legendBorderTransparency), 0.8);
  }

  items.forEach((item, i) => {
    const itemY = legY + iy(0.08 + i * LEGEND_ROW_H);
    const iconR = ix(LEGEND_ICON_SIZE / 2);
    const iconCX = legX + ix(0.12) + iconR;
    const iconCY = itemY + iy(LEGEND_ROW_H / 2);
    if (d.legendStyle === "index") {
      drawRoundedRect(ctx, iconCX - iconR, iconCY - iconR, iconR * 2, iconR * 2, ix(0.01), item.color, hexRgba(d.markerBorderColor, 0), 0.8);
    } else {
      // "minimal"(기본값)을 포함해 색 도트 아이콘 — 원본 보고서 범례 문법(좌하단, 색 도트+라벨).
      drawEllipseShape(ctx, iconCX, iconCY, iconR, iconR, item.color, hexRgba(d.markerBorderColor, 20), 0.8);
    }
    if (d.legendStyle !== "rail") {
      drawTextBox(ctx, item.label,
        legX + ix(0.28), itemY, legW - ix(0.32), iy(LEGEND_ROW_H), {
          fontSize: d.legendFontSize, color: d.legendTextColor, valign: "middle",
        });
    }
  });
}

function drawPoiMarkers(
  ctx: CanvasRenderingContext2D,
  positions: readonly PoiPosition[],
  categories: readonly PoiCategory[],
  d: PptDesignConfig,
  options: { showLabels?: boolean; size?: number; radiusPosition?: RadiusPosition | null } = {}
) {
  const { showLabels = true, radiusPosition = null } = options;
  const sizeInch = options.size ?? d.markerSize;
  const filtered = positions.filter((p) => categories.includes(p.poi.category));
  const labelPlacements = showLabels
    ? layoutPoiLabels(filtered, SLIDE_W, SLIDE_H, sizeInch, { radiusPosition })
    : [];
  const poiById = new Map(filtered.map((pos) => [pos.poi.id, pos.poi]));

  filtered.forEach(({ poi, nx, ny }) => {
    const cx = nx * CANVAS_W;
    const cy = ny * CANVAS_H;
    const r = ix(sizeInch / 2);
    const colorHex =
      poi.category === "subway"
        ? (poi as SubwayStation).lineColor
        : d.categoryColors[poi.category];
    const fill = hexRgba(colorHex, d.markerTransparency);
    const stroke = hexRgba(d.markerBorderColor, 10);
    if (d.markerStyle === "square") {
      drawRoundedRect(ctx, cx - r, cy - r, r * 2, r * 2, ix(0.01), fill, stroke, d.markerBorderWidth);
    } else if (d.markerStyle === "diamond") {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 4);
      drawRoundedRect(ctx, -r, -r, r * 2, r * 2, 0, fill, stroke, d.markerBorderWidth);
      ctx.restore();
    } else if (d.markerStyle === "ring-dot" || d.markerStyle === "jewel" || d.markerStyle === "transit-node") {
      drawEllipseShape(ctx, cx, cy, r * 1.36, r * 1.36,
        d.markerStyle === "jewel" ? hexRgba(d.overlayColor, 42) : undefined,
        hexRgba(d.markerStyle === "jewel" ? d.accentColor : d.markerBorderColor, 0),
        d.markerBorderWidth + 0.4);
      drawEllipseShape(ctx, cx, cy, r, r, fill, stroke, d.markerStyle === "transit-node" ? 1.4 : d.markerBorderWidth);
    } else if (d.markerStyle === "crosshair" || d.markerStyle === "signal") {
      drawLine(ctx, cx / SX - sizeInch * 0.8, cy / SY, sizeInch * 1.6, 0, d.markerBorderColor, 0.8, 18);
      drawLine(ctx, cx / SX, cy / SY - sizeInch * 0.8, 0, sizeInch * 1.6, d.markerBorderColor, 0.8, 18);
      drawEllipseShape(ctx, cx, cy, r, r, fill, hexRgba(d.markerStyle === "signal" ? d.accentColor : d.markerBorderColor, 0), d.markerBorderWidth);
    } else {
      drawEllipseShape(ctx, cx, cy, r, r, fill, stroke, d.markerBorderWidth);
    }
  });

  labelPlacements.forEach((placement) => {
    const poi = poiById.get(placement.poiId);
    if (!poi) return;
    // 지명 색 문법(Task 5) — 산은 초록(+고도m). 도로/수계 라벨은 이 앱에 해당 POI 카테고리·데이터가
    // 없어 적용 불가(원본 보고서는 도로 흰/수계 하늘이지만 렌더러가 그리는 요소 범위 밖이라 미적용).
    const labelColor = poi.category === "mountain" ? d.categoryColors.mountain : d.textColor;
    drawTextBox(ctx, poiLabelText(poi),
      ix(placement.x), iy(placement.y), ix(placement.w), iy(placement.h), {
        fontSize: d.labelFontSize, bold: true, color: labelColor,
        align: "center", valign: "middle",
        bgColor: d.overlayColor, bgTransparency: d.labelBgTransparency, bgRadius: d.panelRadius,
      });
  });
}

function drawSubwayRouteLines(
  ctx: CanvasRenderingContext2D,
  routePositions: readonly RouteNormalizedPosition[],
  d: PptDesignConfig
) {
  // dedupeRouteVariants(리뷰 #1b, ppt-generator.ts 공유): 위상 어긋난 겹침 변이(상·하행/분할 way)가
  // 서로의 대시 간격을 메워 실선처럼 보이는 문제를 두 렌더러에서 동일하게 차단한다.
  dedupeRouteVariants(routePositions).forEach((route) => {
    ctx.strokeStyle = route.lineColor;
    ctx.lineWidth = d.subwayLineWidth;
    ctx.lineCap = "butt"; // 리뷰 #1a: round cap은 대시 양단을 늘려 점선이 실선처럼 붕괴
    ctx.setLineDash(SUBWAY_ROUTE_DASH); // 원본 보고서 문법: 노선 점선(dashed) 폴리라인
    ctx.beginPath();
    route.points.forEach((pt, i) => {
      const x = pt.nx * CANVAS_W;
      const y = pt.ny * CANVAS_H;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  });
}

function drawStationBars(
  ctx: CanvasRenderingContext2D,
  poiPositions: readonly PoiPosition[],
  routePositions: readonly RouteNormalizedPosition[],
  d: PptDesignConfig,
  radiusPosition: RadiusPosition | null,
  radiusKm: number
) {
  const stations = poiPositions.filter(p => p.poi.category === "subway");
  if (stations.length === 0 || routePositions.length === 0) return;

  // Compute half bar length in slide inches via radius mapping.
  let halfBarInch = 0.45;
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

      let minDist = Infinity;
      let closestIdx = 0;
      for (let i = 0; i < route.points.length; i++) {
        const dx = route.points[i].nx - station.nx;
        const dy = route.points[i].ny - station.ny;
        const dist = dx * dx + dy * dy;
        if (dist < minDist) { minDist = dist; closestIdx = i; }
      }

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

      // Draw bar segments
      for (let i = 0; i < segment.length - 1; i++) {
        const x1 = segment[i].nx * CANVAS_W;
        const y1 = segment[i].ny * CANVAS_H;
        const x2 = segment[i + 1].nx * CANVAS_W;
        const y2 = segment[i + 1].ny * CANVAS_H;

        // White border (casing) — 원본 보고서 확정 문법: 역사도식선 흰 캐싱. d.markerBorderColor는
        // 다른 요소와 공유하는 범용 잉크색(기본값이 어두움)이라 캐싱 전용으로는 쓰지 않는다.
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = STATION_CASING_COLOR;
        ctx.lineWidth = stationBorderWidth;
        ctx.lineCap = "butt";
        ctx.stroke();

        // Colored bar
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = route.lineColor;
        ctx.lineWidth = stationBarWidth;
        ctx.lineCap = "butt";
        ctx.stroke();
      }

      // Station name label (once per station)
      const labelKey = `label:${station.poi.id}`;
      if (!seenLabels.has(labelKey)) {
        seenLabels.add(labelKey);

        // Angle in canvas-pixel space (aspect-ratio corrected)
        // Angle: match web map's atan2(dLng, dLat) — negate dy because ny is y-down (opposite of lat)
        const dxPx = (endPt.nx - startPt.nx) * CANVAS_W;
        const dyPx = (endPt.ny - startPt.ny) * CANVAS_H;
        let angleDeg = Math.atan2(dxPx, -dyPx) * (180 / Math.PI) - 90;
        if (angleDeg > 90) angleDeg -= 180;
        if (angleDeg < -90) angleDeg += 180;

        const cx = station.nx * CANVAS_W;
        const cy = station.ny * CANVAS_H;

        // 역 위치 도트(원본 보고서 문법) — 노선색 채움 + 흰 테두리. 역사도식선과 별개로 정확한
        // 역 좌표를 표시하는 노드 마커이자, 별도 배지 없이도 노선을 식별하게 하는 "노선 배지" 역할.
        drawEllipseShape(ctx, cx, cy, stationBarWidth, stationBarWidth, route.lineColor, STATION_CASING_COLOR, 1.8);

        const length = Math.sqrt(dxPx * dxPx + dyPx * dyPx) || 1;
        const normalA = { x: -dyPx / length, y: dxPx / length };
        const normalB = { x: dyPx / length, y: -dxPx / length };
        const normal = normalA.y <= normalB.y ? normalA : normalB;
        const labelOffsetPx = stationBarWidth / 2 + d.stationLabelFontSize * 0.75 + 4;
        const labelX = cx + normal.x * labelOffsetPx;
        const labelY = cy + normal.y * labelOffsetPx;

        // P4R Task B fix: 원시 ID 역명은 라벨 텍스트만 생략(도트·역사도식선은 위치 정보라 유지).
        if (!isRawPoiId(station.poi.name)) {
          ctx.save();
          ctx.translate(labelX, labelY);
          ctx.rotate(angleDeg * Math.PI / 180);
          ctx.font = `bold ${d.stationLabelFontSize}px ${getCanvasFontStack()}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.shadowColor = "rgba(0,0,0,0.9)";
          ctx.shadowBlur = 4;
          ctx.fillStyle = STATION_CASING_COLOR; // 흰 텍스트 — 원본 보고서 문법(검정 halo 위 흰 역명)
          ctx.fillText(station.poi.name, 0, 0);
          ctx.shadowColor = "transparent";
          ctx.shadowBlur = 0;
          ctx.restore();
        }
      }
    }
  }
}

// ── Apartment pagination & label algorithm ────────────────────────────────────

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

// ── Slide render functions ────────────────────────────────────────────────────

/**
 * 표지 슬라이드(Task 3 재설계) — 원본 보고서 문법: 지도 없는 거의 검정 배경, 우측 오프셋
 * 테두리 사각 장식, 좌상단 아이브로우 2줄, 좌하단 초대형 타이틀 + 메타 행.
 * 좌표·색·폰트는 ppt-generator.ts의 addCoverSlide와 동일 수치를 유지할 것.
 */
function renderCoverSlide(
  ctx: CanvasRenderingContext2D,
  _img: HTMLImageElement,
  input: SlideRenderInput,
  _d: PptDesignConfig
) {
  const { config } = input;

  ctx.fillStyle = _d.coverBg;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawCoverFrameSquares(ctx);

  // 좌상단 아이브로우: 1줄 주소 요약(centerName) · 2줄 "사이트 입지 분석"(Bold, 자간 극대)
  const eyebrowLine1FontSize = Math.round(_d.coverSubtitleFontSize * 0.75);
  ctx.save();
  ctx.letterSpacing = `${COVER_EYEBROW_LINE1_LETTER_SPACING}px`;
  drawTextBox(ctx, config.centerName, ix(COVER_EYEBROW_X), iy(COVER_EYEBROW_LINE1_Y), ix(COVER_EYEBROW_W), iy(COVER_EYEBROW_LINE1_H), {
    fontSize: eyebrowLine1FontSize, color: COVER_EYEBROW_LINE1_COLOR, align: "left", valign: "top",
  });
  ctx.restore();
  ctx.save();
  ctx.letterSpacing = `${COVER_EYEBROW_LINE2_LETTER_SPACING}px`;
  drawTextBox(ctx, "사이트 입지 분석", ix(COVER_EYEBROW_X), iy(COVER_EYEBROW_LINE2_Y), ix(COVER_EYEBROW_W), iy(COVER_EYEBROW_LINE2_H), {
    fontSize: _d.coverSubtitleFontSize, bold: true, color: "#FFFFFF", align: "left", valign: "top",
  });
  ctx.restore();

  // 좌하단 초대형 타이틀(centerName) + 메타 행
  drawTextBox(ctx, config.centerName, ix(COVER_TITLE_X), iy(COVER_TITLE_Y), ix(COVER_TITLE_W), iy(COVER_TITLE_H), {
    fontSize: _d.coverTitleFontSize, bold: true, color: "#FFFFFF", align: "left", valign: "bottom",
  });
  const refDate = new Date().toLocaleDateString("ko-KR"); // 기존 코드가 쓰던 날짜 산출 방식 재사용
  drawTextBox(ctx, `반경 ${config.radiusKm}km / ${refDate} / Site Analysis`, ix(COVER_TITLE_X), iy(COVER_META_Y), ix(COVER_TITLE_W), iy(COVER_META_H), {
    fontSize: _d.coverMetaFontSize, color: COVER_META_COLOR, align: "left", valign: "top",
  });

  if (hasFailedSource(input.sourceStatuses ?? [])) {
    // 표지는 거의 검정 배경(coverBg)이라 공유 mutedTextColor(밝은 배경용 회색)는 대비가 낮다.
    // 이 호출부에서만 밝은 색을 넘겨 가독성을 확보 — 다른 슬라이드의 drawFooterNote 호출은 무변경.
    drawFooterNote(ctx, "⚠ 일부 데이터 누락 — 출처 슬라이드 참조", _d, "#E2E8F0");
  }
}

/** 값 조각(FactSheetSegment) 배열을 한 줄에 이어 그린다 — accent 조각만 accentRed로 강조. */
function drawFactSheetSegments(
  ctx: CanvasRenderingContext2D,
  segments: readonly FactSheetSegment[],
  xPx: number,
  yPx: number,
  hPx: number,
  d: PptDesignConfig,
  fontSize: number
) {
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let cursor = xPx;
  const centerY = yPx + hPx / 2;
  segments.forEach((seg) => {
    ctx.font = `${seg.accent ? "bold " : ""}${fontSize}px ${getCanvasFontStack()}`;
    ctx.fillStyle = seg.accent ? d.accentRed : d.textColor;
    ctx.fillText(seg.text, cursor, centerY);
    cursor += ctx.measureText(seg.text).width;
  });
}

/** 중앙 상단 제목 + 좌우 수평선 플랭크 (design doc "B. 백색 정보 슬라이드"). */
function drawFactSheetTitle(ctx: CanvasRenderingContext2D, d: PptDesignConfig) {
  const centerXIn = SLIDE_W / 2;
  const boxXIn = centerXIn - FACT_TITLE_BOX_W / 2;
  drawTextBox(ctx, FACT_TITLE_TEXT, ix(boxXIn), iy(FACT_TITLE_Y), ix(FACT_TITLE_BOX_W), iy(FACT_TITLE_H), {
    fontSize: FACT_TITLE_FONT_SIZE, bold: true, color: d.textColor, align: "center", valign: "middle",
  });
  const lineY = FACT_TITLE_Y + FACT_TITLE_H / 2;
  drawLine(ctx, FACT_FRAME_X, lineY, boxXIn - FACT_FRAME_X, 0, d.mutedTextColor, 0.8, 45);
  const rightLineStartIn = boxXIn + FACT_TITLE_BOX_W;
  drawLine(ctx, rightLineStartIn, lineY, (SLIDE_W - FACT_FRAME_X) - rightLineStartIn, 0, d.mutedTextColor, 0.8, 45);
  drawTextBox(ctx, FACT_SUBTITLE_TEXT, ix(centerXIn - 2.2), iy(FACT_SUBTITLE_Y), ix(4.4), iy(FACT_SUBTITLE_H), {
    fontSize: 10, color: d.mutedTextColor, align: "center", valign: "middle",
  });
}

/**
 * 백색 팩트 시트 슬라이드(Task 4, 표지 다음 2번 위치): 흰 배경 + 중앙 상단 제목(좌우 수평선
 * 플랭크) + 라운드 대형 외곽 프레임 + 검정 헤더 표(행 라벨/값/출처, 핵심 수치는 accentRed 강조).
 * 팩트 계산은 fact-summary.ts(buildFactSummary/buildFactSheetRows)를 pptx 렌더러와 공유해
 * 두 렌더러가 항상 동일 수치를 표시하도록 보장한다.
 */
function renderFactSheetSlide(
  ctx: CanvasRenderingContext2D,
  _img: HTMLImageElement,
  input: SlideRenderInput,
  d: PptDesignConfig
) {
  ctx.fillStyle = d.canvasColor;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  drawFactSheetTitle(ctx, d);

  drawRoundedRect(
    ctx, ix(FACT_FRAME_X), iy(FACT_FRAME_Y), ix(FACT_FRAME_W), iy(FACT_FRAME_H), ix(FACT_FRAME_RADIUS),
    undefined, hexRgba(d.mutedTextColor, 70), 1
  );

  const summary = buildFactSummary({ config: input.config, allPois: input.allPois });
  const rows = buildFactSheetRows(input.config, summary);

  let y = FACT_TABLE_Y;
  drawRoundedRect(ctx, ix(FACT_TABLE_X), iy(y), ix(FACT_TABLE_W), iy(FACT_HEADER_H), 0, d.insightCardBg);
  drawTextBox(ctx, "구분", ix(FACT_TABLE_X + 0.18), iy(y), ix(FACT_LABEL_W - 0.18), iy(FACT_HEADER_H), {
    fontSize: 11, bold: true, color: d.insightCardText, align: "left", valign: "middle",
  });
  drawTextBox(ctx, "핵심 수치", ix(FACT_TABLE_X + FACT_LABEL_W + 0.12), iy(y), ix(FACT_VALUE_W - 0.12), iy(FACT_HEADER_H), {
    fontSize: 11, bold: true, color: d.insightCardText, align: "left", valign: "middle",
  });
  drawTextBox(ctx, "출처", ix(FACT_TABLE_X + FACT_LABEL_W + FACT_VALUE_W), iy(y), ix(FACT_SOURCE_W - 0.15), iy(FACT_HEADER_H), {
    fontSize: 9, bold: true, color: d.insightCardText, align: "right", valign: "middle",
  });
  y += FACT_HEADER_H;

  rows.forEach((row) => {
    drawTextBox(ctx, row.label, ix(FACT_TABLE_X + 0.18), iy(y), ix(FACT_LABEL_W - 0.18), iy(FACT_ROW_H), {
      fontSize: 10.5, bold: true, color: d.textColor, align: "left", valign: "middle",
    });
    drawFactSheetSegments(
      ctx, row.value, ix(FACT_TABLE_X + FACT_LABEL_W + 0.12), iy(y), iy(FACT_ROW_H), d, FACT_VALUE_FONT_SIZE
    );
    drawTextBox(ctx, row.source, ix(FACT_TABLE_X + FACT_LABEL_W + FACT_VALUE_W), iy(y), ix(FACT_SOURCE_W - 0.15), iy(FACT_ROW_H), {
      fontSize: 7.5, color: d.mutedTextColor, align: "right", valign: "middle",
    });
    drawLine(ctx, FACT_TABLE_X, y + FACT_ROW_H, FACT_TABLE_W, 0, d.mutedTextColor, 0.5, 80);
    y += FACT_ROW_H;
  });

  drawTextBox(
    ctx, "※ 도보시간은 직선거리 기준 분속 80m 환산치이며, 실제 보행 경로와 차이가 있을 수 있습니다.",
    ix(FACT_TABLE_X), iy(y + 0.14), ix(FACT_TABLE_W), iy(0.2),
    { fontSize: 8, color: d.mutedTextColor, align: "left", valign: "middle" }
  );

  if (hasFailedSource(input.sourceStatuses ?? [])) {
    drawFooterNote(ctx, "⚠ 일부 데이터 누락 — 출처 슬라이드 참조", d);
  }
}

function renderOverviewSlide(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  input: SlideRenderInput,
  d: PptDesignConfig
) {
  drawBaseMap(ctx, img);
  drawMapOverlay(ctx, d);
  drawConcentricRings(ctx, input.radiusPosition, d);
  const subwayAsMarkers = input.routePositions.length === 0;
  drawSubwayRouteLines(ctx, input.routePositions, d);
  drawPoiMarkers(ctx, input.poiPositions, subwayAsMarkers
    ? ["school", "park", "mountain", "apartment", "maintenance", "subway"]
    : ["school", "park", "mountain", "apartment", "maintenance"], d, {
    showLabels: false, size: d.markerSizeSm,
  });
  if (!subwayAsMarkers) {
    drawStationBars(ctx, input.poiPositions, input.routePositions, d, input.radiusPosition, input.config.radiusKm);
  }
  drawSiteMarker(ctx, input.radiusPosition, d);
  drawMapSectionTitle(ctx, "입지 현황 종합", `반경 ${input.config.radiusKm}km`);
  drawLegend(ctx, d);
}

function renderScoreDashboardSlide(
  ctx: CanvasRenderingContext2D,
  _img: HTMLImageElement,
  input: SlideRenderInput,
  d: PptDesignConfig
) {
  // P4R Task C-7a: 백색(B문법) 전환 — 토글 on 시에만 노출되는 슬라이드라 Task A 일괄 전환에서
  // 누락되어 있었다. 다른 백색 정보 슬라이드와 동일하게 지도/오버레이/프레임 제거.
  ctx.fillStyle = d.canvasColor;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawTitleChip(ctx, "입지 점수 대시보드", d, "분석 항목별 경쟁력");
  const scores = computeAnalysisScores(input.config, input.allPois);
  const strongest = [...scores.items].sort((a, b) => b.score / b.max - a.score / a.max)[0];
  const weakest = [...scores.items].sort((a, b) => a.score / a.max - b.score / b.max)[0];
  const gradeColor = scores.total >= 76 ? "#22C55E" : scores.total >= 64 ? "#3B82F6" : scores.total >= 50 ? "#F59E0B" : "#EF4444";

  drawDataPanel(ctx, ix(0.7), iy(1.25), ix(3.0), iy(4.8), d);
  drawTextBox(ctx, "TOTAL", ix(1.0), iy(1.6), ix(2.4), iy(0.28), { fontSize: 9, bold: true, color: d.mutedTextColor, align: "center" });
  drawTextBox(ctx, String(scores.total), ix(0.9), iy(1.9), ix(2.6), iy(0.95), { fontSize: 46, bold: true, color: d.textColor, align: "center" });
  drawTextBox(ctx, "/100", ix(2.55), iy(2.52), ix(0.6), iy(0.24), { fontSize: 12, bold: true, color: d.mutedTextColor });
  drawEllipseShape(ctx, ix(2.2), iy(3.7), ix(0.65), ix(0.65), hexRgba(gradeColor, 8), gradeColor, 1.2);
  drawTextBox(ctx, scores.grade, ix(1.55), iy(3.32), ix(1.3), iy(0.42), { fontSize: 26, bold: true, color: d.textColor, align: "center" });
  drawWrappedText(ctx, scores.headline, ix(0.95), iy(4.72), ix(2.5), iy(0.28), 2, { fontSize: 10, bold: true, color: d.textColor });

  const startX = 4.15;
  drawDataPanel(ctx, ix(4.0), iy(1.08), ix(8.7), iy(4.24), d);
  scores.items.forEach((item, idx) => {
    const y = 1.25 + idx * 0.87;
    const color = getScoreColor(item.score / item.max);
    drawTextBox(ctx, item.label, ix(startX), iy(y), ix(1.1), iy(0.22), { fontSize: 10, bold: true, color: d.textColor });
    drawTextBox(ctx, `${item.score}/${item.max} · ${getLevelLabel(item.level)}`, ix(startX + 1.15), iy(y), ix(1.4), iy(0.22), { fontSize: 8, bold: true, color, align: "right" });
    drawProgressBar(ctx, startX, y + 0.31, 2.55, item.score, item.max, color, d);
    drawWrappedText(ctx, item.detail, ix(startX + 2.85), iy(y - 0.02), ix(5.55), iy(0.2), 2, { fontSize: 8.2, color: d.mutedTextColor });
  });
  drawMetricCard(ctx, 4.15, 6.05, 2.55, 0.8, "최고 경쟁력", strongest.label, strongest.detail, getScoreColor(strongest.score / strongest.max), d);
  drawMetricCard(ctx, 6.9, 6.05, 2.55, 0.8, "보완 검토", weakest.label, weakest.detail, getScoreColor(weakest.score / weakest.max), d);
  // P4R Task C fix: 저대비 지명 hex(#93C5FD) 정리 — 등급색(gradeColor)이 아닌 참고 카드이므로 무채 잉크.
  drawMetricCard(ctx, 9.65, 6.05, 2.55, 0.8, "분석 반경", `${input.config.radiusKm}km`, `${input.allPois.length.toLocaleString()}개 POI 반영`, d.accentColor, d);
  drawFooterNote(ctx, "점수는 POI 수, 거리, 면적, 정비사업 경계 확인 여부를 조합한 내부 기준입니다.", d);
}

function renderInsightSummarySlide(
  ctx: CanvasRenderingContext2D,
  _img: HTMLImageElement,
  input: SlideRenderInput,
  d: PptDesignConfig
) {
  // Task A: 백색(B문법) 전환 — 2단계에서 지도가 흑백·어둡게 바뀐 뒤에도 이 슬라이드는 구 문법
  // (밝은 지도 시절의 어두운 잉크 타이틀/각주)이 남아 판독 불가했다. 팩트시트/출처 슬라이드와
  // 동일한 단색 흰 배경으로 전환 — 지도 베이스맵/오버레이/프레임 제거.
  ctx.fillStyle = d.canvasColor;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawTitleChip(ctx, "핵심 인사이트 요약", d, "강점 · 리스크 · 후속 확인");
  const narrative = generateAnalysisNarrative(input.config, input.allPois);
  drawDataPanel(ctx, ix(0.7), iy(1.15), ix(11.95), iy(1.05), d);
  drawWrappedText(ctx, narrative.summary, ix(1.0), iy(1.38), ix(11.35), iy(0.3), 2, { fontSize: 17, bold: true, color: d.textColor });
  // P4R Task C-1: 구 팔레트(초록/주황/파랑) 정리 — 2단계 팔레트(무채 잉크 + accentRed 1곳)로.
  // 3열 중 "리스크"만 주의가 필요한 항목이라 accentRed로 강조하고 나머지는 무채 잉크 스트립.
  const columns = [
    { title: "핵심 강점", rows: narrative.bullets.slice(0, 5), color: d.accentColor },
    { title: "리스크", rows: narrative.risks.length ? narrative.risks.slice(0, 5) : ["현재 데이터 기준 중대한 약점은 제한적입니다."], color: d.accentRed },
    { title: "다음 액션", rows: narrative.nextActions.slice(0, 5), color: d.accentColor },
  ];
  columns.forEach((column, idx) => {
    const x = 0.7 + idx * 4.05;
    drawDataPanel(ctx, ix(x), iy(2.55), ix(3.75), iy(3.85), d);
    ctx.fillStyle = column.color;
    ctx.fillRect(ix(x), iy(2.55), ix(3.75), iy(0.08));
    drawTextBox(ctx, column.title, ix(x + 0.22), iy(2.82), ix(3.3), iy(0.28), { fontSize: 13, bold: true, color: d.textColor });
    column.rows.forEach((text, rowIdx) => {
      drawWrappedText(ctx, `${rowIdx + 1}. ${text}`, ix(x + 0.25), iy(3.28 + rowIdx * 0.55), ix(3.25), iy(0.18), 2, { fontSize: 8.6, color: d.mutedTextColor });
    });
  });
  drawFooterNote(ctx, "요약 문장은 현재 검색 결과와 점수 모델을 기반으로 자동 생성됩니다.", d);
}

function renderRadiusAnalysisSlide(
  ctx: CanvasRenderingContext2D,
  _img: HTMLImageElement,
  input: SlideRenderInput,
  d: PptDesignConfig
) {
  // Task A: 백색(B문법) 전환 — 아래 렌더 로직 대부분이 카드/패널로 화면을 거의 다 덮으므로
  // 지도는 장식 이상의 정보를 전달하지 못했다. 링/대상지 마커도 지도 없이는 무의미해 함께 제거.
  ctx.fillStyle = d.canvasColor;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawTitleChip(ctx, "생활권 반경 분석", d, "500m · 1km · 1.5km · 전체 반경");
  // P4R Task C-1/5: 구 팔레트(주황/파랑/핑크/회색) 정리 → 무채 잉크 + accentRed 1곳(보고서 분석권 —
  // 이후 전 슬라이드 POI 집계가 이 반경을 기준으로 하므로 대표 지표로 선택). "개발 영향권"(1.5km
  // 고정)과 "보고서 분석권"(설정 반경)의 반경이 완전히 같으면(분석 반경 1.5km) 두 카드의 수치가
  // 항상 동일해 중복 카드가 되므로 하나로 합치고 "개발 영향권 겸" 부제를 붙인다(4장 → 3장).
  const analysisRadiusM = input.config.radiusKm * 1000;
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
    drawDataPanel(ctx, ix(x), iy(y), ix(w), iy(1.95), d);
    drawTextBox(ctx, row.label, ix(x + 0.26), iy(y + 0.2), ix(2.6), iy(0.28), { fontSize: 13, bold: true, color: d.textColor });
    if (row.subtitle) {
      drawTextBox(ctx, row.subtitle, ix(x + 0.26), iy(y + 0.47), ix(3.2), iy(0.16), { fontSize: 7.5, color: d.mutedTextColor });
    }
    const radiusLabel = row.radiusM >= 1000 ? `${(row.radiusM / 1000).toFixed(row.radiusM % 1000 === 0 ? 0 : 1)}km` : `${row.radiusM}m`;
    drawTextBox(ctx, radiusLabel, ix(x + w - 1.4), iy(y + 0.16), ix(1.05), iy(0.34), { fontSize: 17, bold: true, color: row.color, align: "right" });
    const metricGap = (w - 0.6) / 4;
    [
      ["역", countWithin(input.config, input.allPois, row.radiusM, "subway")],
      ["학교", countWithin(input.config, input.allPois, row.radiusM, "school")],
      ["공원", countWithin(input.config, input.allPois, row.radiusM, "park")],
      ["정비", countWithin(input.config, input.allPois, row.radiusM, "maintenance")],
    ].forEach(([label, value], metricIdx) => {
      const mx = x + 0.3 + metricIdx * metricGap;
      drawTextBox(ctx, String(label), ix(mx), iy(y + 0.72), ix(0.8), iy(0.2), { fontSize: 7, color: d.mutedTextColor, align: "center" });
      drawTextBox(ctx, String(value), ix(mx), iy(y + 0.96), ix(0.8), iy(0.34), { fontSize: 18, bold: true, color: d.textColor, align: "center" });
    });
    drawTextBox(ctx, row.note, ix(x + 0.3), iy(y + 1.48), ix(w - 0.65), iy(0.22), { fontSize: 8, color: d.mutedTextColor });
  });
  // Task A: 하단 오버플로 수정 — 4개 항목을 단일 열로 쌓으면 패널이 슬라이드 하단(7.5in) 밖으로
  // 잘리고 각주와 겹쳤다(s8 결함). 2열 2행 그리드로 재배치해 7.5in 안에 들어오게 하고, 라벨 아래
  // 설명을 줄바꿈해 다음 항목과 겹치지 않게 한다.
  // P4R Task C-7b: 아래 2×2 그리드는 4칸을 가정한다 — buildInsightOverlays가 그 이상을 반환해도
  // 패널(gridH=1.3, 2행)을 벗어나지 않도록 방어적으로 4개까지만 사용한다.
  const insightOverlays = buildInsightOverlays(input.config, input.allPois).slice(0, 4);
  const gridX = 0.72, gridY = 5.65, gridW = 11.6, gridH = 1.3;
  drawDataPanel(ctx, ix(gridX), iy(gridY), ix(gridW), iy(gridH), d);
  drawTextBox(ctx, "지도 인사이트 레이어 기준", ix(gridX + 0.2), iy(gridY + 0.14), ix(gridW - 0.4), iy(0.22), {
    fontSize: 10, bold: true, color: d.textColor,
  });
  const gridPad = 0.2, gridColGap = 0.2, gridRowH = 0.45;
  const gridColW = (gridW - gridPad * 2 - gridColGap) / 2;
  const gridTopY = gridY + 0.4;
  insightOverlays.forEach((overlay, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const cx = gridX + gridPad + col * (gridColW + gridColGap);
    const cy = gridTopY + row * gridRowH;
    drawEllipseShape(ctx, ix(cx + 0.06), iy(cy + 0.09), ix(0.05), ix(0.05), overlay.color);
    drawTextBox(ctx, overlay.label, ix(cx + 0.2), iy(cy), ix(gridColW - 0.2), iy(0.2), {
      fontSize: 9, bold: true, color: d.textColor,
    });
    drawWrappedText(ctx, overlay.description, ix(cx + 0.2), iy(cy + 0.2), ix(gridColW - 0.25), iy(0.12), 2, {
      fontSize: 7, color: d.mutedTextColor,
    });
  });
  drawFooterNote(ctx, "반경 분석은 직선거리 기준이며 실제 보행 경로와 차이가 있을 수 있습니다.", d);
}

function renderCategorySlide(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  input: SlideRenderInput,
  d: PptDesignConfig,
  title: string,
  categories: PoiCategory[],
  details: string[],
  includeRoutes = false
) {
  drawBaseMap(ctx, img);
  drawMapOverlay(ctx, d);
  drawConcentricRings(ctx, input.radiusPosition, d);
  const hasSubway = categories.includes("subway");
  const subwayBarsAvailable = hasSubway && input.routePositions.length > 0;
  if (includeRoutes) drawSubwayRouteLines(ctx, input.routePositions, d);
  const markerCats = subwayBarsAvailable ? categories.filter(c => c !== "subway") : categories;
  if (markerCats.length > 0) {
    drawPoiMarkers(ctx, input.poiPositions, markerCats, d, {
      showLabels: !subwayBarsAvailable,
      radiusPosition: input.radiusPosition,
    });
  }
  if (subwayBarsAvailable) {
    drawStationBars(ctx, input.poiPositions, input.routePositions, d, input.radiusPosition, input.config.radiusKm);
  }
  drawSiteMarker(ctx, input.radiusPosition, d);
  drawMapSectionTitle(ctx, title, `반경 ${input.config.radiusKm}km`);

  const panelW = ix(d.panelWidth);
  const panelH = Math.min(iy(4.8), details.length * iy(0.42) + iy(0.6));
  drawDataPanel(ctx, ix(d.panelX), iy(d.panelY), panelW, panelH, d);
  if (details.length === 0) {
    drawTextBox(ctx, EMPTY_PANEL_TEXT, ix(d.panelX + 0.2), iy(d.panelY + 0.2), panelW - ix(0.4), iy(0.36), {
      fontSize: d.detailFontSize, color: d.mutedTextColor, valign: "middle",
    });
  }
  details.forEach((text, i) => {
    drawTextBox(ctx, `• ${text}`, ix(d.panelX + 0.2), iy(d.panelY + 0.2) + i * iy(0.42), panelW - ix(0.4), iy(0.36), {
      fontSize: d.detailFontSize, color: d.textColor, valign: "middle",
    });
  });

  // 인사이트 카드(Task 5) — fact-summary 기반 카테고리 결론 2-4줄. 데이터 0건이면 빈 배열이라
  // 카드를 그리지 않고 위 details의 EMPTY_PANEL_TEXT 문법을 그대로 유지한다.
  const insightKey = inferCategoryInsightKey(categories);
  if (insightKey) {
    const summary = buildFactSummary({ config: input.config, allPois: input.allPois });
    drawInsightCard(ctx, buildCategoryInsight(insightKey, summary), d);
  }

  drawLegend(ctx, d);
}

function renderParkAccessDetailSlide(
  ctx: CanvasRenderingContext2D,
  _img: HTMLImageElement,
  input: SlideRenderInput,
  d: PptDesignConfig
) {
  // Task A: 백색(B문법) 전환. 부수적으로 s9에서 있던 반투명 패널 아래 지도 라벨 잔상(ghosting)
  // 문제도 배경이 완전 불투명 흰색이 되며 함께 해소된다.
  ctx.fillStyle = d.canvasColor;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawTitleChip(ctx, "공원/녹지 접근성 상세", d, "경계 기준 접근거리 우선");
  const parks = input.allPois.filter((p): p is Park => p.category === "park");
  const summary = summarizeParks(parks);
  // P4R Task B-4b: "접근성 점수 NN/100"(내부 산식 점수)를 팩트 지표(최근접 공원 실거리)로 격하.
  // summary.nearestPark는 park-analysis.ts에서 이미 원시 ID 이름을 건너뛴 표시 후보다.
  const nearestParkDistanceM = summary.nearestPark
    ? summary.nearestPark.access_distance_m ?? summary.nearestPark.distance_m ?? 0
    : null;
  // P4R Task C fix: 구 팔레트(#10B981/#22C55E/#3B82F6/#F59E0B) 정리 — "생활권 공원"(접근성
  // 슬라이드의 대표 지표: 500m 이내 실사용 가능 공원 수)만 accentRed로 강조하고 나머지는 무채 잉크 테두리.
  drawMetricCard(ctx, 0.55, 1.18, 2.45, 0.86, "생활권 공원", `${summary.nearby500Count}개`, "접근 500m 이내", d.accentRed, d);
  drawMetricCard(ctx, 3.18, 1.18, 2.45, 0.86, "총 녹지 면적", formatAreaSqm(summary.totalAreaSqm), `${summary.count}개 공원`, d.accentColor, d);
  drawMetricCard(ctx, 5.8, 1.18, 2.45, 0.86, "최근접 공원",
    nearestParkDistanceM !== null ? formatDistanceM(nearestParkDistanceM) : "미확인",
    summary.nearestPark?.name ?? "반경 내 공원 없음", d.accentColor, d);
  drawMetricCard(ctx, 8.42, 1.18, 2.45, 0.86, "대형공원", `${summary.majorCount}개`, "광역 이용 가능성", d.accentColor, d);
  // P4R Task B fix: 랭킹 리스트도 원시 ID 이름 공원 제외(표시만 — 상단 카드의 count 집계는 원본 기준).
  const topParks = [...parks]
    .filter((park) => !isRawPoiId(park.name))
    .sort((a, b) => (a.access_distance_m ?? a.distance_m ?? Infinity) - (b.access_distance_m ?? b.distance_m ?? Infinity))
    .slice(0, 7);
  drawRankedList(ctx, "최근접 공원 접근거리", topParks.map((park) => ({
    label: park.name,
    meta: `${formatDistanceM(park.access_distance_m ?? park.distance_m ?? 0)} · ${park.area_sqm > 0 ? formatAreaSqm(park.area_sqm) : "면적 미확인"}`,
    color: d.accentColor,
  })), 0.55, 2.42, 5.55, d);
  drawDataPanel(ctx, ix(6.35), iy(2.42), ix(5.35), iy(3.25), d);
  drawTextBox(ctx, "공원 성격별 구성", ix(6.6), iy(2.68), ix(4.85), iy(0.25), { fontSize: 12, bold: true, color: d.textColor });
  [
    ["대형/광역", summary.qualityCounts.major],
    ["근린공원", summary.qualityCounts.neighborhood],
    ["어린이/소공원", summary.qualityCounts.children + summary.qualityCounts.small],
    ["녹지/기타", summary.qualityCounts.green + summary.qualityCounts.unknown],
  ].forEach(([label, value], idx) => {
    const y = 3.18 + idx * 0.5;
    drawTextBox(ctx, String(label), ix(6.65), iy(y), ix(1.45), iy(0.22), { fontSize: 8.5, color: d.mutedTextColor });
    drawProgressBar(ctx, 8.25, y + 0.06, 2.1, Number(value), Math.max(summary.count, 1), d.accentColor, d);
    drawTextBox(ctx, `${value}개`, ix(10.55), iy(y), ix(0.6), iy(0.22), { fontSize: 8.5, bold: true, color: d.textColor, align: "right" });
  });
  drawWrappedText(ctx, "경계 좌표가 있는 공원은 폴리곤 외곽선까지의 최단거리를 사용하고, 경계가 없는 공원은 면적 기반 원형 추정으로 보정합니다.", ix(6.65), iy(5.28), ix(4.65), iy(0.18), 2, { fontSize: 7.4, color: d.mutedTextColor });
  drawFooterNote(ctx, `대상지: ${input.config.centerName} / 자연환경 데이터는 공공 도시공원·OSM 보조 데이터를 결합합니다.`, d);
}

function renderDevelopmentRiskMatrixSlide(
  ctx: CanvasRenderingContext2D,
  _img: HTMLImageElement,
  input: SlideRenderInput,
  d: PptDesignConfig
) {
  // Task A: 백색(B문법) 전환.
  ctx.fillStyle = d.canvasColor;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawTitleChip(ctx, "개발 호재/리스크 매트릭스", d, "영향도 · 확정성 · 거리");
  const projects = input.allPois.filter((p): p is MaintenanceProject => p.category === "maintenance");
  const summary = summarizeMaintenanceProjects(projects);
  // P4R Task C-1: 구 팔레트(핑크/파랑/주황) 정리 — "정비사업"(총 건수, 나머지 두 지표의 상위 총량)
  // 1곳만 accentRed로 강조하고 나머지는 무채 잉크 테두리.
  drawMetricCard(ctx, 0.55, 1.15, 2.35, 0.82, "정비사업", `${summary.count}건`, `총 ${formatMaintenanceArea(summary.totalAreaSqm)}`, d.accentRed, d);
  drawMetricCard(ctx, 3.05, 1.15, 2.35, 0.82, "경계 확인", `${summary.boundaryConfirmedCount}건`, `${summary.count - summary.boundaryConfirmedCount}건은 위치 확인 필요`, d.accentColor, d);
  drawMetricCard(ctx, 5.55, 1.15, 2.35, 0.82, "주요 사업", `${summary.topProjects.length}건`, "면적·거리 기준 선별", d.accentColor, d);
  const topProjects = summary.topProjects.slice(0, 7);
  if (topProjects.length === 0) {
    // P4R Task C-3: 0건일 때 거대한 빈 흰 카드 대신 콜아웃 슬라이드의 컴팩트 중앙 배지 문법.
    // P4R Task C fix: 범용 문구 대신 이 패널(정비사업 상세 테이블) 전용 문구로 정확화.
    drawEmptyStateBadge(ctx, d, { x: 0.55, y: 2.25, w: 7.35, h: 3.95 }, "표시할 정비사업 상세 내역이 없습니다");
  } else {
    drawDataPanel(ctx, ix(0.55), iy(2.25), ix(7.35), iy(3.95), d);
    drawTextBox(ctx, "주요 정비사업 영향도 테이블", ix(0.8), iy(2.5), ix(6.8), iy(0.25), { fontSize: 12, bold: true, color: d.textColor });
    topProjects.forEach((project, idx) => {
      const y = 2.96 + idx * 0.42;
      const dist = project.distance_m != null ? formatDistanceM(project.distance_m) : "거리 미확인";
      const impact = project.area_sqm >= 100_000 ? "상" : project.area_sqm >= 30_000 ? "중" : "보통";
      drawTextBox(ctx, project.name, ix(0.82), iy(y), ix(2.8), iy(0.24), { fontSize: 8.2, bold: true, color: d.textColor });
      drawTextBox(ctx, project.stage, ix(3.75), iy(y), ix(1.2), iy(0.24), { fontSize: 7.4, color: d.mutedTextColor });
      // P4R Task C-2: 백카드 저대비 강조 텍스트(#93C5FD/#FBBF24) 정리 — 확인(정상)은 무채 잉크,
      // 미확인(주의 필요)만 accentRed로 백배경에서도 판독 가능하게.
      drawTextBox(ctx, `${impact} · ${project.boundary_status === "confirmed" ? "확인" : "미확인"} · ${dist}`, ix(5.02), iy(y), ix(2.1), iy(0.24), { fontSize: 7.4, color: project.boundary_status === "confirmed" ? d.textColor : d.accentRed, align: "right" });
    });
  }
  drawDataPanel(ctx, ix(8.25), iy(2.25), ix(4.1), iy(3.95), d);
  drawTextBox(ctx, "해석 기준", ix(8.52), iy(2.52), ix(3.45), iy(0.25), { fontSize: 12, bold: true, color: d.textColor });
  [
    "영향도: 사업 면적과 대상지 거리로 판단",
    "확정성: 공식 경계 확인 여부를 우선 반영",
    "초기 단계 사업은 장기 호재이나 일정 변동 리스크가 큼",
    "관리처분·착공 단계는 가시성이 높지만 공급 충격도 함께 검토",
  ].forEach((note, idx) => {
    drawWrappedText(ctx, `• ${note}`, ix(8.55), iy(3.02 + idx * 0.55), ix(3.35), iy(0.18), 2, { fontSize: 8.4, color: d.mutedTextColor });
  });
  drawFooterNote(ctx, "정비사업 데이터는 고시·공공데이터 기준이며, 사업 단계와 고시일은 별도 실사 확인을 권장합니다.", d);
}

function renderResidentialSupplySlide(
  ctx: CanvasRenderingContext2D,
  _img: HTMLImageElement,
  input: SlideRenderInput,
  d: PptDesignConfig
) {
  // Task A: 백색(B문법) 전환.
  ctx.fillStyle = d.canvasColor;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawTitleChip(ctx, "주거 공급 경쟁 구도", d, "세대수 · 분양예정 · 입주 시점");
  const residentials = getResidentialPois(input.allPois);
  const totalUnits = residentials.reduce((sum, apt) => sum + Math.max(0, apt.units), 0);
  const planned = residentials.filter((apt) => apt.status === "planned");
  const totalParking = residentials.reduce((sum, apt) => sum + Math.max(0, apt.parking_count), 0);
  const avgParking = totalUnits > 0 ? totalParking / totalUnits : 0;
  // P4R Task C-1: 구 팔레트(파랑/초록/주황/핑크) 정리 — "총 세대수"(다른 지표들의 상위 총량)만
  // accentRed로 강조. P4R Task C-4: 주거시설 0개면 "0.00대/세대"가 무의미한 지표이므로 "-" 표기.
  drawMetricCard(ctx, 0.55, 1.16, 2.45, 0.84, "주거시설", `${residentials.length}개`, "아파트·오피스텔 포함", d.accentColor, d);
  drawMetricCard(ctx, 3.2, 1.16, 2.45, 0.84, "총 세대수", `${totalUnits.toLocaleString()}세대`, `주차 ${totalParking.toLocaleString()}대`, d.accentRed, d);
  drawMetricCard(ctx, 5.85, 1.16, 2.45, 0.84, "분양예정", `${planned.length}건`, "공급 변화 모니터링", d.accentColor, d);
  drawMetricCard(ctx, 8.5, 1.16, 2.45, 0.84, "주차비율", totalUnits > 0 ? `${avgParking.toFixed(2)}대/세대` : "-", "단지 상품성 참고", d.accentColor, d);
  drawRankedList(ctx, "대단지/주요 주거시설", [...residentials].sort((a, b) => b.units - a.units).slice(0, 7).map((apt) => ({
    label: apt.name,
    meta: `${apt.units.toLocaleString()}세대 · ${apt.distance_m ? formatDistanceM(apt.distance_m) : "거리 미확인"}`,
    color: apt.status === "planned" ? d.accentRed : d.accentColor,
  })), 0.55, 2.34, 5.6, d);
  const timeline = [...residentials]
    .filter((apt) => apt.sale_date || apt.move_in_month)
    .sort((a, b) => (a.move_in_month || a.sale_date).localeCompare(b.move_in_month || b.sale_date))
    .slice(0, 6);
  if (timeline.length === 0) {
    // P4R Task C-3: 0건일 때 거대한 빈 흰 카드 대신 콜아웃 슬라이드의 컴팩트 중앙 배지 문법.
    // P4R Task C fix: 시설(주거시설)은 있으나 일정 데이터만 없는 케이스에서 좌측 랭킹 리스트와
    // 자기모순되지 않도록 범용 문구 대신 이 패널(분양/입주 타임라인) 전용 문구로 정확화.
    drawEmptyStateBadge(ctx, d, { x: 6.42, y: 2.34, w: 5.2, h: 3.4 }, "일정 정보가 있는 분양/입주 데이터가 없습니다");
  } else {
    drawDataPanel(ctx, ix(6.42), iy(2.34), ix(5.2), iy(3.4), d);
    drawTextBox(ctx, "분양/입주 타임라인", ix(6.7), iy(2.6), ix(4.7), iy(0.25), { fontSize: 12, bold: true, color: d.textColor });
    timeline.forEach((apt, idx) => {
      const y = 3.04 + idx * 0.42;
      // P4R Task C-2: 백카드 저대비 강조 텍스트(#FBBF24) 정리 — 예정일(분양예정 상태)만 accentRed.
      drawTextBox(ctx, apt.move_in_month || apt.sale_date || "일정 미확인", ix(6.72), iy(y), ix(1.05), iy(0.22), { fontSize: 7.8, bold: true, color: apt.status === "planned" ? d.accentRed : d.mutedTextColor });
      drawTextBox(ctx, apt.name, ix(7.9), iy(y), ix(2.4), iy(0.22), { fontSize: 7.8, color: d.textColor });
      drawTextBox(ctx, `${apt.units.toLocaleString()}세대`, ix(10.25), iy(y), ix(0.82), iy(0.22), { fontSize: 7.4, color: d.mutedTextColor, align: "right" });
    });
  }
  drawFooterNote(ctx, `주거 공급 장표는 ${input.config.radiusKm}km 반경의 건축물대장·분양 공고 기반 데이터를 요약합니다.`, d);
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

/**
 * 미니 데이터표 행 — 세대수/준공·입주(예정)/주차/전용면적대 중 가용 필드만, 값이 없는 행은 생략.
 * status=existing의 sale_date는 건축물대장 사용승인일·K-APT 사용검사일이므로 라벨은 "준공".
 * 예약 슬롯(calloutHeight)이 헤더+3행 상한이라 최대 3행까지만 채택(우선순위 = push 순서).
 * pptx 생성기(ppt-generator.ts)의 동명 함수와 동일 로직을 유지할 것(수치 parity).
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
  const areas = (apt.floorplans ?? [])
    .map((f) => f.area_sqm)
    .filter((a): a is number => typeof a === "number" && a > 0);
  if (areas.length > 0) {
    const min = Math.round(Math.min(...areas));
    const max = Math.round(Math.max(...areas));
    rows.push({ label: "전용면적", value: min === max ? `${min}㎡` : `${min}~${max}㎡` });
  }
  return rows.slice(0, 3);
}

function renderApartmentCalloutSlide(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  input: SlideRenderInput,
  d: PptDesignConfig,
  aptsOnPage: readonly ResidentialPoi[],
  pageIdx: number,
  totalPages: number
) {
  drawBaseMap(ctx, img);
  drawMapOverlay(ctx, d);
  drawConcentricRings(ctx, input.radiusPosition, d);
  drawSiteMarker(ctx, input.radiusPosition, d);

  const pageTitle = totalPages > 1
    ? `주변 분양 현황 ${pageIdx + 1}/${totalPages}`
    : "주변 분양 현황";
  // Task A: 지도 배경은 유지하되, 어두운 잉크 drawTitleChip 대신 Task 5의 흰 지도 섹션 타이틀
  // 문법(drawMapSectionTitle)로 교체해 판독 불가 결함을 해소한다.
  drawMapSectionTitle(ctx, pageTitle, `반경 ${input.config.radiusKm}km`);
  drawLegend(ctx, d);

  if (aptsOnPage.length === 0) {
    drawEmptyStateBadge(ctx, d);
    return;
  }

  const aptIdSet = new Set(aptsOnPage.map(a => a.id));
  const aptPositions = input.poiPositions.filter(p => aptIdSet.has(p.poi.id));
  if (aptPositions.length === 0) {
    drawEmptyStateBadge(ctx, d);
    return;
  }

  // 표 치수: calloutWidth/calloutHeight는 헤더+최대 3행 예약 상한(겹침 방지 레이아웃 입력).
  // 실제 그리는 행 수가 이보다 적은 단지는 예약 슬롯 안에서 세로 중앙 정렬한다.
  const TABLE_W_IN = d.calloutWidth;
  const TABLE_H_IN = d.calloutHeight;
  const CARD_MARGIN_IN = 0.10;
  const TABLE_W_PX = ix(TABLE_W_IN);
  const TABLE_H_PX = iy(TABLE_H_IN);
  const HEADER_H_PX = iy(d.calloutHeaderHeight);
  const ROW_H_PX = iy(d.calloutRowHeight);
  const labelPositions = computeResidentialCalloutLayout(
    aptPositions.map(p => ({ id: p.poi.id, nx: p.nx, ny: p.ny })),
    {
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      cardWidth: TABLE_W_IN,
      cardHeight: TABLE_H_IN,
      cardMargin: CARD_MARGIN_IN,
      chipY: d.titleChipY,
      chipHeight: d.titleChipHeight,
      legendRows: Object.keys(CATEGORY_LABELS).length,
      legendRowHeight: LEGEND_ROW_H,
      legendBottomMargin: 0.4,
    },
  );
  const labelPosById = new Map(labelPositions.map(lp => [lp.id, lp]));
  const aptById = new Map(aptsOnPage.map(a => [a.id, a]));
  const nearestId = findNearestResidentialId(input.config, getResidentialPois(input.allPois));

  aptPositions.forEach(({ poi, nx, ny }) => {
    const lp = labelPosById.get(poi.id);
    if (!lp) return;
    const apt = aptById.get(poi.id);
    if (!apt) return;

    const markerCX = nx * CANVAS_W;
    const markerCY = ny * CANVAS_H;
    const isLeftSide = lp.labelX < SLIDE_W / 2;

    // Marker dot (category color)
    const dotR = ix(d.markerSize / 2);
    drawEllipseShape(ctx, markerCX, markerCY, dotR, dotR,
      hexRgba(d.categoryColors[apt.category] ?? d.categoryColors.apartment, d.markerTransparency),
      hexRgba(d.markerBorderColor, 10), d.markerBorderWidth);

    // 표: 예약 슬롯 안에서 실제 높이(헤더+가용 행)만큼만 그리고 세로 중앙 정렬
    const rows = buildResidentialTableRows(apt);
    const tableHPx = HEADER_H_PX + rows.length * ROW_H_PX;
    const tableX = isLeftSide
      ? ix(CARD_MARGIN_IN)
      : CANVAS_W - ix(CARD_MARGIN_IN) - TABLE_W_PX;
    const slotY = Math.max(0, Math.min(lp.labelY * SY - TABLE_H_PX / 2, CANVAS_H - TABLE_H_PX));
    const tableY = slotY + (TABLE_H_PX - tableHPx) / 2;
    const tableMidY = tableY + tableHPx / 2;

    // Leader line: marker → inner edge of table (흰 1px — 원본 보고서 콜아웃 문법)
    const lineEndX = isLeftSide ? tableX + TABLE_W_PX : tableX;
    ctx.beginPath();
    ctx.moveTo(markerCX, markerCY);
    ctx.lineTo(lineEndX, tableMidY);
    ctx.strokeStyle = hexRgba(d.overlayColor, d.leaderLineTransparency);
    ctx.lineWidth = d.leaderLineWidth;
    ctx.setLineDash([]);
    ctx.stroke();

    // 표 외곽 테두리
    drawRoundedRect(ctx, tableX, tableY, TABLE_W_PX, tableHPx, 0,
      undefined, hexRgba(d.markerBorderColor, 55), 0.6);

    // 헤더 셀: 단지명 — 대상지 최근접 1곳만 빨강(accentRed), 나머지 검정
    const isNearest = apt.id === nearestId;
    drawRoundedRect(ctx, tableX, tableY, TABLE_W_PX, HEADER_H_PX, 0,
      isNearest ? d.accentRed : d.primaryColor);
    drawTextBox(ctx, apt.name,
      tableX + ix(0.07), tableY, TABLE_W_PX - ix(0.14), HEADER_H_PX, {
        fontSize: d.calloutFontSize, bold: true, color: d.overlayColor, valign: "middle",
      });

    // 데이터 행: 라벨(좌, 흐림) + 값(우, 진하게) — 백색 행
    rows.forEach((row, idx) => {
      const rowY = tableY + HEADER_H_PX + idx * ROW_H_PX;
      drawRoundedRect(ctx, tableX, rowY, TABLE_W_PX, ROW_H_PX, 0,
        hexRgba(d.panelColor, d.calloutTransparency));
      if (idx > 0) {
        ctx.beginPath();
        ctx.moveTo(tableX, rowY);
        ctx.lineTo(tableX + TABLE_W_PX, rowY);
        ctx.strokeStyle = hexRgba(d.markerBorderColor, 85);
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
      drawTextBox(ctx, row.label,
        tableX + ix(0.07), rowY, TABLE_W_PX * 0.42, ROW_H_PX, {
          fontSize: d.calloutDetailFontSize, color: d.mutedTextColor, valign: "middle",
        });
      drawTextBox(ctx, row.value,
        tableX + TABLE_W_PX * 0.42, rowY, TABLE_W_PX * 0.58 - ix(0.07), ROW_H_PX, {
          fontSize: d.calloutDetailFontSize, bold: true, color: d.textColor, valign: "middle", align: "right",
        });
    });
  });
}

function renderSummarySlide(
  ctx: CanvasRenderingContext2D,
  _img: HTMLImageElement,
  input: SlideRenderInput,
  d: PptDesignConfig
) {
  const { allPois, config } = input;
  // Task A: 백색(B문법) 전환.
  ctx.fillStyle = d.canvasColor;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawTitleChip(ctx, "종합 분석 및 시사점", d, `반경 ${config.radiusKm}km`);

  // P4R Task C-6: 백색 전환 후 패널이 6in(약 ~7in 체감)로 좁아 우측 절반이 공백으로 남았다(p4rA-s14
  // 결함). 다른 백색 정보 슬라이드(핵심 인사이트 요약 등)와 동일하게 콘텐츠 영역 전체 폭(x=0.7,
  // w=11.95)으로 확장 — 줄 수·문구는 불변, 텍스트 박스 폭만 패널을 따라 함께 넓어진다.
  const summaryPanelX = 0.7;
  const summaryPanelW = 11.95;
  const panelW = ix(summaryPanelW);
  drawDataPanel(ctx, ix(summaryPanelX), iy(d.panelY), panelW, iy(5), d);

  const points = getSummaryLines(config, allPois);
  const lastBodyIdx = points.length - 2; // 마지막 줄은 항상 muted 점수 보조 지표 — 강조는 그 앞줄에 둔다.
  points.forEach((point, idx) => {
    drawTextBox(ctx, point.text, ix(summaryPanelX + 0.3), iy(d.panelY + 0.4) + idx * iy(0.65), panelW - ix(0.5), iy(0.5), {
      fontSize: point.muted ? Math.max(8, Math.round(d.summaryFontSize * 0.7)) : d.summaryFontSize,
      bold: !point.muted && idx === lastBodyIdx,
      color: point.muted ? d.mutedTextColor : d.textColor,
      valign: "middle",
    });
  });
}

function renderDataSourceSlide(
  ctx: CanvasRenderingContext2D,
  _img: HTMLImageElement,
  input: SlideRenderInput,
  d: PptDesignConfig
) {
  // Task 4: 백색 정보 슬라이드 문법으로 전환 — 지도 베이스맵/오버레이 제거, 단색 흰 배경.
  // 이하 카드·패널·출처 표기 로직은 1단계(Task 7) 그대로 보존.
  ctx.fillStyle = d.canvasColor;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawTitleChip(ctx, "데이터 출처 및 신뢰도", d, "보고서 해석 전제");
  [
    { title: "주소/지도", value: "Naver API", detail: "지오코딩·지도 표시·검색 좌표 기준", color: "#3B82F6" },
    { title: "교통/POI", value: "Naver + OSM", detail: "지하철·생활 POI·보조 경로 데이터", color: "#F59E0B" },
    { title: "공원/녹지", value: "공공데이터 + OSM", detail: "도시공원 면적, 경계 좌표 보조", color: "#10B981" },
    { title: "정비사업", value: "공공 고시 데이터", detail: "서울/부산 정비사업 및 경계 확인", color: "#EC4899" },
    { title: "주거 공급", value: "대장/분양 정보", detail: "세대수, 주차, 분양/입주 일정", color: "#22C55E" },
    { title: "보고서 산출", value: "자동 분석 모델", detail: "거리·개수·면적·단계 기반 점수화", color: "#94A3B8" },
  ].forEach((card, idx) => {
    const x = 0.7 + (idx % 3) * 4.0;
    const y = 1.35 + Math.floor(idx / 3) * 1.55;
    drawMetricCard(ctx, x, y, 3.55, 1.08, card.title, card.value, card.detail, card.color, d);
  });
  drawDataPanel(ctx, ix(0.7), iy(4.72), ix(11.9), iy(2.2), d);
  drawTextBox(ctx, "주의사항", ix(1.0), iy(4.98), ix(2.0), iy(0.25), { fontSize: 12, bold: true, color: d.textColor });
  [
    "거리 기준은 기본적으로 직선거리이며, 일부 공원은 경계 폴리곤 최단거리로 보정합니다.",
    "정비사업은 고시·공공데이터 반영 시점에 따라 단계 또는 경계 정보가 실제와 다를 수 있습니다.",
    "분양·입주 일정과 평면도 링크는 원천 공고 변경에 따라 사후 확인이 필요합니다.",
    "보고서 점수는 의사결정 보조 지표이며, 최종 판단에는 현장조사·시세·법적 검토가 병행되어야 합니다.",
  ].forEach((text, idx) => {
    drawWrappedText(ctx, `• ${text}`, ix(1.0 + (idx % 2) * 5.75), iy(5.36 + Math.floor(idx / 2) * 0.42), ix(5.25), iy(0.17), 2, { fontSize: 7.8, color: d.mutedTextColor });
  });
  // 1단계 데이터 신뢰성: 소스별 수집일·누락 표기 (Task 7)
  sourceStatusLines(input.sourceStatuses ?? []).forEach((text, idx) => {
    drawTextBox(ctx, text, ix(1.0 + (idx % 2) * 5.75), iy(6.18 + Math.floor(idx / 2) * 0.2), ix(5.25), iy(0.2), { fontSize: 9, color: d.mutedTextColor });
  });
  drawFooterNote(ctx, `${input.config.centerName} / ${input.allPois.length.toLocaleString()}개 POI 기준 자동 생성`, d);
}

// ── Font preload ──────────────────────────────────────────────────────────────

async function ensureFontsLoaded() {
  if (typeof document === "undefined") return;
  try {
    // 웹폰트가 아직 어떤 텍스트에도 "사용"되지 않았으면 document.fonts.ready가
    // 즉시 resolve될 수 있으므로, canvas가 그릴 글꼴을 명시적으로 먼저 로드 요청한다.
    // Noto는 next/font가 주입한 해시 패밀리명으로 load해야 실제로 매칭된다.
    const notoFamily = getNotoFamilyForLoad();
    await Promise.all([
      document.fonts.load(`16px "${notoFamily}"`),
      document.fonts.load(`bold 16px "${notoFamily}"`),
      document.fonts.load(`500 16px "${PPT_FONT_NUM}"`),
      document.fonts.load(`600 16px "${PPT_FONT_NUM}"`),
    ]);
    await document.fonts.ready;
  } catch {
    // ignore — fallback fonts will render
  }
}

// ── Dynamic slide list ────────────────────────────────────────────────────────

type SlideRenderer = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  input: SlideRenderInput,
  d: PptDesignConfig
) => void;

interface SlideDef {
  title: string;
  render: SlideRenderer;
}

// 2단계 재설계(Task 7): 기본 구성은 표지→팩트시트→입지종합→교통→교육→자연→(기존 상세/현황
// 슬라이드 유지)→아파트 콜아웃→종합 의견→출처. "입지 점수 대시보드"는 기본 제외(옵션 토글로만 노출),
// 켜면 입지 현황 종합 바로 다음(원위치)에 삽입한다. 핵심 인사이트 요약/생활권 반경 분석은 계획서가
// 명시적으로 언급하지 않아 "기존 상세/현황 슬라이드 유지" 묶음(자연 환경 다음, 아파트 콜아웃 전)으로
// 이동했다 — 삭제하지 않고 위치만 재편했다(task-7-report.md 참고).
function buildSlideDefs(input: SlideRenderInput, includeScoreDashboard = false): SlideDef[] {
  const residentials = input.allPois.filter(
    (p): p is ResidentialPoi => p.category === "apartment" || p.category === "officetel" || p.category === "residential"
  );
  const aptPages = pageResidentials(residentials, APT_PAGE_SIZE);
  const totalPages = aptPages.length;

  const defs: SlideDef[] = [
    { title: "표지", render: renderCoverSlide },
    { title: "팩트 시트", render: renderFactSheetSlide },
    { title: "입지 현황 종합", render: renderOverviewSlide },
    ...(includeScoreDashboard ? [{ title: "입지 점수 대시보드", render: renderScoreDashboardSlide }] : []),
    {
      title: "교통 분석",
      render: (ctx, img, inp, d) => {
        const subways = inp.allPois.filter((p) => p.category === "subway") as SubwayStation[];
        renderCategorySlide(ctx, img, inp, d, "교통 분석", ["subway"],
          subways.filter(s => !isRawPoiId(s.name)).slice(0, 8).map(s => `${s.name} (${s.line})`), true);
      },
    },
    {
      title: "교육 환경",
      render: (ctx, img, inp, d) => {
        const schools = inp.allPois.filter((p): p is School => p.category === "school");
        renderCategorySlide(ctx, img, inp, d, "교육 환경", ["school"],
          schools.filter(s => !isRawPoiId(s.name)).slice(0, 8).map(s =>
            `${s.name} (${s.level === "elementary" ? "초" : s.level === "middle" ? "중" : "고"})`
          ));
      },
    },
    {
      title: "자연 환경",
      render: (ctx, img, inp, d) => {
        const parks = inp.allPois.filter((p): p is Park => p.category === "park");
        const mountains = inp.allPois.filter(p => p.category === "mountain" && !isRawPoiId(p.name));
        renderCategorySlide(ctx, img, inp, d, "자연 환경", ["park", "mountain"],
          [...buildParkDetailLines(parks, 7), ...mountains.slice(0, 1).map(p => `인접 산: ${p.name}`)].slice(0, 8));
      },
    },
    { title: "핵심 인사이트 요약", render: renderInsightSummarySlide },
    { title: "생활권 반경 분석", render: renderRadiusAnalysisSlide },
    { title: "공원/녹지 접근성 상세", render: renderParkAccessDetailSlide },
    {
      title: "개발/정비사업 현황",
      render: (ctx, img, inp, d) => {
        const projects = inp.allPois.filter((p): p is MaintenanceProject => p.category === "maintenance");
        renderCategorySlide(ctx, img, inp, d, "개발/정비사업 현황", ["maintenance"],
          buildMaintenanceDetailLines(projects, 8));
      },
    },
    { title: "개발 호재/리스크 매트릭스", render: renderDevelopmentRiskMatrixSlide },
    { title: "주거 공급 경쟁 구도", render: renderResidentialSupplySlide },
  ];

  // Dynamic apartment pages
  aptPages.forEach((aptsOnPage, i) => {
    const pageTitle = totalPages > 1
      ? `주변 분양 현황 ${i + 1}/${totalPages}`
      : "주변 분양 현황";
    const capturedPage = aptsOnPage;
    const capturedIdx = i;
    defs.push({
      title: pageTitle,
      render: (ctx, img, inp, d) => {
        renderApartmentCalloutSlide(ctx, img, inp, d, capturedPage, capturedIdx, totalPages);
      },
    });
  });

  defs.push({ title: "종합 분석", render: renderSummarySlide });
  defs.push({ title: "데이터 출처 및 신뢰도", render: renderDataSourceSlide });

  return defs;
}

function createCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d")!;
  return [canvas, ctx];
}

export async function renderAllSlides(
  input: SlideRenderInput,
  designConfig: PptDesignConfig,
  includeScoreDashboard = false
): Promise<RenderedSlide[]> {
  await ensureFontsLoaded();
  const baseImg = await loadReportBaseImage(input.baseMapImage, designConfig.mapGrayscale !== false);
  const slideDefs = buildSlideDefs(input, includeScoreDashboard);

  return slideDefs.map(({ title, render }, index) => {
    const [canvas, ctx] = createCanvas();
    render(ctx, baseImg, input, designConfig);
    return { index, title, imageDataUrl: canvas.toDataURL("image/png") };
  });
}

export async function renderSingleSlide(
  slideIndex: number,
  input: SlideRenderInput,
  designConfig: PptDesignConfig,
  preloadedImage?: HTMLImageElement,
  includeScoreDashboard = false
): Promise<RenderedSlide> {
  await ensureFontsLoaded();
  const baseImg = preloadedImage ?? (await loadReportBaseImage(input.baseMapImage, designConfig.mapGrayscale !== false));
  const slideDefs = buildSlideDefs(input, includeScoreDashboard);
  const def = slideDefs[slideIndex] ?? slideDefs[0];
  const [canvas, ctx] = createCanvas();
  def.render(ctx, baseImg, input, designConfig);
  return { index: slideIndex, title: def.title, imageDataUrl: canvas.toDataURL("image/png") };
}

/** 미리보기 모달이 초기 오픈 시 베이스맵을 선반입(preload)할 때 쓰는 진입점 — 기본적으로 흑백 톤 적용 */
export async function preloadBaseImage(dataUrl: string, grayscale = true): Promise<HTMLImageElement> {
  return loadReportBaseImage(dataUrl, grayscale);
}
