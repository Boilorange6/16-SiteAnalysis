/**
 * Canvas-based PPT slide renderer.
 * Mirrors ppt-generator.ts layout logic using Canvas2D for in-browser preview.
 *
 * Coordinate system:
 *   - Slide inches: SLIDE_W=13.333, SLIDE_H=7.5
 *   - Canvas pixels: CANVAS_W=960, CANVAS_H=540
 *   - Scale: SX = SY = 72 px/in  (1pt = 1px at 72 DPI)
 */

import type { Poi, PoiPosition, RadiusPosition, PoiCategory, SubwayStation, ResidentialPoi, School, Park, MaintenanceProject } from "./types";
import { CATEGORY_LABELS } from "./types";
import type { RouteNormalizedPosition } from "./ppt-generator";
import type { PptDesignConfig } from "./ppt-design-config";
import type { AnalysisConfig } from "./types";
import { layoutPoiLabels } from "./ppt-label-layout";
import { computeResidentialCalloutLayout } from "./ppt-callout-layout";
import { buildParkDetailLines, formatAreaSqm, formatDistanceM, summarizeParks } from "./park-analysis";
import { buildMaintenanceDetailLines, formatMaintenanceArea, summarizeMaintenanceProjects } from "./maintenance-analysis";
import { buildInsightOverlays, computeAnalysisScores, generateAnalysisNarrative, getSummaryLines } from "./analysis-engine";
import { haversineDistance } from "./geo";

// ── Coordinate constants ──────────────────────────────────────────────────────

const CANVAS_W = 960;
const CANVAS_H = 540;
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const SX = CANVAS_W / SLIDE_W; // ≈72
const SY = CANVAS_H / SLIDE_H; // 72
const APT_PAGE_SIZE = 12;

// ── Static layout tokens (match ppt-generator.ts) ────────────────────────────

const FONT_CANVAS = '"Noto Sans KR", "Pretendard", "맑은 고딕", sans-serif';
const EMPTY_PANEL_TEXT = "반경 내 확인된 시설이 없습니다"; // match ppt-generator.ts
const SITE_LABEL_OFFSET_Y = 0.20;
const RING_RATIOS = [0.33, 0.66, 1.0] as const;

const LEGEND_ICON_SIZE = 0.10;
const LEGEND_ROW_H = 0.22;
const LEGEND_W = 1.4;

// ── Public types ──────────────────────────────────────────────────────────────

export interface SlideRenderInput {
  readonly config: AnalysisConfig;
  readonly allPois: readonly Poi[];
  readonly baseMapImage: string;
  readonly poiPositions: readonly PoiPosition[];
  readonly radiusPosition: RadiusPosition | null;
  readonly routePositions: readonly RouteNormalizedPosition[];
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

  ctx.font = `${bold ? "bold " : ""}${fontSize}px ${FONT_CANVAS}`;
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

function getCoverOverlayColor(d: PptDesignConfig): string {
  return d.panelStyle === "paper" || d.panelStyle === "document" || d.panelStyle === "organic" || d.panelStyle === "transit"
    ? d.overlayColor
    : d.primaryColor;
}

function usesLightCoverText(d: PptDesignConfig): boolean {
  return d.panelStyle === "paper" ||
    d.panelStyle === "document" ||
    d.panelStyle === "organic" ||
    d.panelStyle === "transit" ||
    d.compositionStyle === "print-editorial" ||
    d.compositionStyle === "planning-sheet" ||
    d.compositionStyle === "landscape-report" ||
    d.compositionStyle === "transit-atlas" ||
    d.compositionStyle === "mono-dossier";
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

function drawCoverMapOverlay(ctx: CanvasRenderingContext2D, d: PptDesignConfig) {
  drawMapVeil(ctx, getCoverOverlayColor(d), d.coverOverlayTransparency);
  drawCompositionBackdrop(ctx, d, "cover");
  drawDesignFrame(ctx, d);
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

function getCoverTextLayout(d: PptDesignConfig): {
  titleX: number;
  titleY: number;
  titleW: number;
  titleAlign: "left" | "center" | "right";
} {
  switch (d.compositionStyle) {
    case "none":
      return { titleX: 0.72, titleY: 2.08, titleW: 6.8, titleAlign: "left" };
    case "split-command":
      return { titleX: 0.72, titleY: 2.08, titleW: 3.45, titleAlign: "left" };
    case "print-editorial":
      return { titleX: 0.86, titleY: 1.22, titleW: 7.9, titleAlign: "left" };
    case "radar-hud":
      return { titleX: 1.25, titleY: 2.25, titleW: 10.8, titleAlign: "center" };
    case "finance-ledger":
      return { titleX: 0.92, titleY: 1.78, titleW: 6.75, titleAlign: "left" };
    case "planning-sheet":
      return { titleX: 0.88, titleY: 1.15, titleW: 6.6, titleAlign: "left" };
    case "landscape-report":
      return { titleX: 0.9, titleY: 1.82, titleW: 6.65, titleAlign: "left" };
    case "luxury-brochure":
      return { titleX: 2.35, titleY: 2.22, titleW: 8.65, titleAlign: "center" };
    case "transit-atlas":
      return { titleX: 0.82, titleY: 1.2, titleW: 7.2, titleAlign: "left" };
    case "war-room":
      return { titleX: 0.76, titleY: 2.2, titleW: 3.75, titleAlign: "left" };
    case "mono-dossier":
      return { titleX: 1.05, titleY: 1.2, titleW: 7.25, titleAlign: "left" };
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

  RING_RATIOS.forEach((ratio, idx) => {
    const isOuter = idx === RING_RATIOS.length - 1;
    drawEllipseShape(ctx, cx, cy, rx * ratio, ry * ratio,
      undefined,
      hexRgba(d.markerBorderColor, d.ringTransparency),
      isOuter ? d.ringOuterLineWidth : d.ringLineWidth,
      d.ringDash === "solid" ? undefined : d.ringDash === "dash" ? [8, 6] : [4, 4]
    );
  });
}

function drawSiteMarker(ctx: CanvasRenderingContext2D, radiusPosition: RadiusPosition | null, d: PptDesignConfig) {
  if (!radiusPosition) return;
  const cx = radiusPosition.centerNx * CANVAS_W;
  const cy = radiusPosition.centerNy * CANVAS_H;

  // outer dashed ring
  drawEllipseShape(ctx, cx, cy, ix(d.siteMarkerOuterSize / 2), iy(d.siteMarkerOuterSize / 2),
    undefined, hexRgba(d.markerBorderColor, 10), 1.5, [5, 5]);
  // inner white dot
  drawEllipseShape(ctx, cx, cy, ix(d.siteMarkerInnerSize / 2), iy(d.siteMarkerInnerSize / 2),
    d.markerBorderColor, undefined);
  // SITE label
  drawTextBox(ctx, "SITE", cx - ix(0.3), cy + iy(SITE_LABEL_OFFSET_Y), ix(0.6), iy(0.2), {
    fontSize: d.siteLabelFontSize, bold: true, color: d.markerBorderColor, align: "center", valign: "middle",
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

function drawFooterNote(ctx: CanvasRenderingContext2D, text: string, d: PptDesignConfig) {
  drawTextBox(ctx, text, ix(0.55), iy(7.08), ix(12.2), iy(0.22), {
    fontSize: 6.5, color: d.mutedTextColor, align: "right",
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
  ctx.font = `${options.bold ? "bold " : ""}${options.fontSize}px ${FONT_CANVAS}`;
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
  drawTextBox(ctx, label, ix(x + 0.18), iy(y + 0.12), ix(w - 0.34), iy(0.18), {
    fontSize: 7.5, bold: true, color: d.mutedTextColor,
  });
  drawTextBox(ctx, value, ix(x + (d.metricStyle === "number-plate" ? 0.55 : 0.18)), iy(y + 0.34), ix(w - 0.34), iy(0.34), {
    fontSize: d.metricStyle === "number-plate" ? 16 : 18, bold: true, color: d.textColor,
  });
  drawTextBox(ctx, detail, ix(x + 0.18), iy(y + h - 0.34), ix(w - 0.34), iy(0.22), {
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
        fontSize: 6.4, color: d.textColor, valign: "middle",
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
    if (d.legendStyle === "index" || d.legendStyle === "minimal") {
      drawRoundedRect(ctx, iconCX - iconR, iconCY - iconR, iconR * 2, iconR * 2, ix(0.01), item.color, hexRgba(d.markerBorderColor, d.legendStyle === "minimal" ? 70 : 0), 0.8);
    } else {
      drawEllipseShape(ctx, iconCX, iconCY, iconR, iconR, item.color, hexRgba(d.markerBorderColor, 20), 0.8);
    }
    if (d.legendStyle !== "rail") {
      drawTextBox(ctx, item.label,
        legX + ix(0.28), itemY, legW - ix(0.32), iy(LEGEND_ROW_H), {
          fontSize: d.legendFontSize, color: d.textColor, valign: "middle",
        });
    }
  });
}

function drawPoiMarkers(
  ctx: CanvasRenderingContext2D,
  positions: readonly PoiPosition[],
  categories: readonly PoiCategory[],
  d: PptDesignConfig,
  options: { showLabels?: boolean; size?: number } = {}
) {
  const { showLabels = true } = options;
  const sizeInch = options.size ?? d.markerSize;
  const filtered = positions.filter((p) => categories.includes(p.poi.category));
  const labelPlacements = showLabels ? layoutPoiLabels(filtered, SLIDE_W, SLIDE_H, sizeInch) : [];
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
    drawTextBox(ctx, poi.name,
      ix(placement.x), iy(placement.y), ix(placement.w), iy(placement.h), {
        fontSize: d.labelFontSize, bold: true, color: d.textColor,
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
  routePositions.forEach((route) => {
    ctx.strokeStyle = route.lineColor;
    ctx.lineWidth = d.subwayLineWidth;
    ctx.lineCap = "round";
    ctx.beginPath();
    route.points.forEach((pt, i) => {
      const x = pt.nx * CANVAS_W;
      const y = pt.ny * CANVAS_H;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
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

        // White border
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = d.markerBorderColor;
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
        const length = Math.sqrt(dxPx * dxPx + dyPx * dyPx) || 1;
        const normalA = { x: -dyPx / length, y: dxPx / length };
        const normalB = { x: dyPx / length, y: -dxPx / length };
        const normal = normalA.y <= normalB.y ? normalA : normalB;
        const labelOffsetPx = stationBarWidth / 2 + d.stationLabelFontSize * 0.75 + 4;
        const labelX = cx + normal.x * labelOffsetPx;
        const labelY = cy + normal.y * labelOffsetPx;

        ctx.save();
        ctx.translate(labelX, labelY);
        ctx.rotate(angleDeg * Math.PI / 180);
        ctx.font = `bold ${d.stationLabelFontSize}px ${FONT_CANVAS}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0,0,0,0.9)";
        ctx.shadowBlur = 4;
        ctx.fillStyle = d.markerBorderColor;
        ctx.fillText(station.poi.name, 0, 0);
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
        ctx.restore();
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

function renderCoverSlide(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  input: SlideRenderInput,
  _d: PptDesignConfig
) {
  drawBaseMap(ctx, img);
  drawCoverMapOverlay(ctx, _d);

  const { config } = input;
  const { titleX, titleY, titleW, titleAlign } = getCoverTextLayout(_d);
  const coverTextColor = usesLightCoverText(_d) ? _d.textColor : "#FFFFFF";
  const coverMetaColor = usesLightCoverText(_d) ? _d.mutedTextColor : "#E5E7EB";
  if (_d.titleStyle === "luxury-plaque") {
    drawRoundedRect(ctx, ix(2.55), iy(2.08), ix(8.25), iy(2.55), ix(0.02), undefined, hexRgba(_d.accentColor, 18), 0.9);
  }
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.82)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  drawTextBox(ctx, config.centerName, ix(titleX), iy(titleY), ix(titleW), iy(1), {
    fontSize: _d.coverTitleFontSize, bold: true, color: coverTextColor, align: titleAlign, valign: "middle",
  });
  drawTextBox(ctx, "사이트 입지 분석 보고서", ix(titleX), iy(titleY + 1.0), ix(titleW), iy(0.6), {
    fontSize: _d.coverSubtitleFontSize, color: coverTextColor, align: titleAlign, valign: "middle",
  });
  ctx.restore();
  if (_d.titleStyle !== "plain") {
    ctx.fillStyle = hexRgba(_d.accentColor, 10);
    ctx.fillRect(ix(titleAlign === "center" ? titleX + titleW / 2 - 1.65 : titleX), iy(titleY + 1.8), ix(titleAlign === "center" ? 3.3 : 2.8), iy(0.03));
  }
  const refDate = new Date().toLocaleDateString("ko-KR");
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.72)";
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 1;
  drawTextBox(ctx, `${refDate} | 반경 ${config.radiusKm}km 분석`, ix(titleX), iy(titleY + 2.3), ix(titleW), iy(0.4), {
    fontSize: _d.coverMetaFontSize, color: coverMetaColor, align: titleAlign, valign: "middle",
  });
  ctx.restore();
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
  drawSubwayRouteLines(ctx, input.routePositions, d);
  drawPoiMarkers(ctx, input.poiPositions, ["school", "park", "mountain", "apartment", "maintenance"], d, {
    showLabels: false, size: d.markerSizeSm,
  });
  drawStationBars(ctx, input.poiPositions, input.routePositions, d, input.radiusPosition, input.config.radiusKm);
  drawSiteMarker(ctx, input.radiusPosition, d);
  drawTitleChip(ctx, "입지 현황 종합", d, `반경 ${input.config.radiusKm}km`);
  drawLegend(ctx, d);
}

function renderScoreDashboardSlide(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  input: SlideRenderInput,
  d: PptDesignConfig
) {
  drawBaseMap(ctx, img);
  drawMapOverlay(ctx, d);
  drawCompositionBackdrop(ctx, d, "content");
  drawDesignFrame(ctx, d);
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
  drawMetricCard(ctx, 9.65, 6.05, 2.55, 0.8, "분석 반경", `${input.config.radiusKm}km`, `${input.allPois.length.toLocaleString()}개 POI 반영`, "#93C5FD", d);
  drawFooterNote(ctx, "점수는 POI 수, 거리, 면적, 정비사업 경계 확인 여부를 조합한 내부 기준입니다.", d);
}

function renderInsightSummarySlide(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  input: SlideRenderInput,
  d: PptDesignConfig
) {
  drawBaseMap(ctx, img);
  drawMapOverlay(ctx, d);
  drawCompositionBackdrop(ctx, d, "content");
  drawDesignFrame(ctx, d);
  drawTitleChip(ctx, "핵심 인사이트 요약", d, "강점 · 리스크 · 후속 확인");
  const narrative = generateAnalysisNarrative(input.config, input.allPois);
  drawDataPanel(ctx, ix(0.7), iy(1.15), ix(11.95), iy(1.05), d);
  drawWrappedText(ctx, narrative.summary, ix(1.0), iy(1.38), ix(11.35), iy(0.3), 2, { fontSize: 17, bold: true, color: d.textColor });
  const columns = [
    { title: "핵심 강점", rows: narrative.bullets.slice(0, 5), color: "#22C55E" },
    { title: "리스크", rows: narrative.risks.length ? narrative.risks.slice(0, 5) : ["현재 데이터 기준 중대한 약점은 제한적입니다."], color: "#F59E0B" },
    { title: "다음 액션", rows: narrative.nextActions.slice(0, 5), color: "#3B82F6" },
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
  img: HTMLImageElement,
  input: SlideRenderInput,
  d: PptDesignConfig
) {
  drawBaseMap(ctx, img);
  drawMapOverlay(ctx, d);
  drawConcentricRings(ctx, input.radiusPosition, d);
  drawSiteMarker(ctx, input.radiusPosition, d);
  drawTitleChip(ctx, "생활권 반경 분석", d, "500m · 1km · 1.5km · 전체 반경");
  const radiusRows = [
    { label: "근린 핵심권", radiusM: 500, color: "#F59E0B", note: "도보·일상 접근성의 1차 체감권" },
    { label: "생활 편의권", radiusM: 1000, color: "#3B82F6", note: "통학·공원·역세권을 함께 판단" },
    { label: "개발 영향권", radiusM: 1500, color: "#EC4899", note: "정비사업과 공급 변화의 영향권" },
    { label: "보고서 분석권", radiusM: input.config.radiusKm * 1000, color: "#94A3B8", note: "PPT 전체 POI 집계 기준" },
  ];
  radiusRows.forEach((row, idx) => {
    const x = 0.72 + (idx % 2) * 6.05;
    const y = 1.25 + Math.floor(idx / 2) * 2.35;
    drawDataPanel(ctx, ix(x), iy(y), ix(5.55), iy(1.95), d);
    drawTextBox(ctx, row.label, ix(x + 0.26), iy(y + 0.2), ix(2.6), iy(0.28), { fontSize: 13, bold: true, color: d.textColor });
    const radiusLabel = row.radiusM >= 1000 ? `${(row.radiusM / 1000).toFixed(row.radiusM % 1000 === 0 ? 0 : 1)}km` : `${row.radiusM}m`;
    drawTextBox(ctx, radiusLabel, ix(x + 4.15), iy(y + 0.16), ix(1.05), iy(0.34), { fontSize: 17, bold: true, color: row.color, align: "right" });
    [
      ["역", countWithin(input.config, input.allPois, row.radiusM, "subway")],
      ["학교", countWithin(input.config, input.allPois, row.radiusM, "school")],
      ["공원", countWithin(input.config, input.allPois, row.radiusM, "park")],
      ["정비", countWithin(input.config, input.allPois, row.radiusM, "maintenance")],
    ].forEach(([label, value], metricIdx) => {
      const mx = x + 0.3 + metricIdx * 1.18;
      drawTextBox(ctx, String(label), ix(mx), iy(y + 0.72), ix(0.8), iy(0.2), { fontSize: 7, color: d.mutedTextColor, align: "center" });
      drawTextBox(ctx, String(value), ix(mx), iy(y + 0.96), ix(0.8), iy(0.34), { fontSize: 18, bold: true, color: d.textColor, align: "center" });
    });
    drawTextBox(ctx, row.note, ix(x + 0.3), iy(y + 1.48), ix(4.9), iy(0.22), { fontSize: 8, color: d.mutedTextColor });
  });
  drawRankedList(ctx, "지도 인사이트 레이어 기준", buildInsightOverlays(input.config, input.allPois).map((overlay) => ({
    label: overlay.label,
    meta: overlay.description,
    color: overlay.color,
  })), 0.72, 6.08, 11.6, d);
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
  if (includeRoutes) drawSubwayRouteLines(ctx, input.routePositions, d);
  const markerCats = hasSubway ? categories.filter(c => c !== "subway") : categories;
  if (markerCats.length > 0) {
    drawPoiMarkers(ctx, input.poiPositions, markerCats, d, { showLabels: !hasSubway });
  }
  if (hasSubway) {
    drawStationBars(ctx, input.poiPositions, input.routePositions, d, input.radiusPosition, input.config.radiusKm);
  }
  drawSiteMarker(ctx, input.radiusPosition, d);
  drawTitleChip(ctx, title, d, `반경 ${input.config.radiusKm}km`);

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
  drawLegend(ctx, d);
}

function renderParkAccessDetailSlide(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  input: SlideRenderInput,
  d: PptDesignConfig
) {
  drawBaseMap(ctx, img);
  drawMapOverlay(ctx, d);
  drawConcentricRings(ctx, input.radiusPosition, d);
  drawPoiMarkers(ctx, input.poiPositions, ["park", "mountain"], d, { showLabels: true });
  drawSiteMarker(ctx, input.radiusPosition, d);
  drawTitleChip(ctx, "공원/녹지 접근성 상세", d, "경계 기준 접근거리 우선");
  const parks = input.allPois.filter((p): p is Park => p.category === "park");
  const summary = summarizeParks(parks);
  drawMetricCard(ctx, 0.55, 1.18, 2.45, 0.86, "생활권 공원", `${summary.nearby500Count}개`, "접근 500m 이내", "#10B981", d);
  drawMetricCard(ctx, 3.18, 1.18, 2.45, 0.86, "총 녹지 면적", formatAreaSqm(summary.totalAreaSqm), `${summary.count}개 공원`, "#22C55E", d);
  drawMetricCard(ctx, 5.8, 1.18, 2.45, 0.86, "접근성 점수", `${summary.accessibilityScore}/100`, "면적·거리·공원 등급 반영", "#3B82F6", d);
  drawMetricCard(ctx, 8.42, 1.18, 2.45, 0.86, "대형공원", `${summary.majorCount}개`, "광역 이용 가능성", "#F59E0B", d);
  const topParks = [...parks]
    .sort((a, b) => (a.access_distance_m ?? a.distance_m ?? Infinity) - (b.access_distance_m ?? b.distance_m ?? Infinity))
    .slice(0, 7);
  drawRankedList(ctx, "최근접 공원 접근거리", topParks.map((park) => ({
    label: park.name,
    meta: `${formatDistanceM(park.access_distance_m ?? park.distance_m ?? 0)} · ${park.area_sqm > 0 ? formatAreaSqm(park.area_sqm) : "면적 미확인"}`,
    color: "#10B981",
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
    drawProgressBar(ctx, 8.25, y + 0.06, 2.1, Number(value), Math.max(summary.count, 1), "#10B981", d);
    drawTextBox(ctx, `${value}개`, ix(10.55), iy(y), ix(0.6), iy(0.22), { fontSize: 8.5, bold: true, color: d.textColor, align: "right" });
  });
  drawWrappedText(ctx, "경계 좌표가 있는 공원은 폴리곤 외곽선까지의 최단거리를 사용하고, 경계가 없는 공원은 면적 기반 원형 추정으로 보정합니다.", ix(6.65), iy(5.28), ix(4.65), iy(0.18), 2, { fontSize: 7.4, color: d.mutedTextColor });
  drawFooterNote(ctx, `대상지: ${input.config.centerName} / 자연환경 데이터는 공공 도시공원·OSM 보조 데이터를 결합합니다.`, d);
}

function renderDevelopmentRiskMatrixSlide(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  input: SlideRenderInput,
  d: PptDesignConfig
) {
  drawBaseMap(ctx, img);
  drawMapOverlay(ctx, d);
  drawConcentricRings(ctx, input.radiusPosition, d);
  drawPoiMarkers(ctx, input.poiPositions, ["maintenance"], d, { showLabels: true });
  drawSiteMarker(ctx, input.radiusPosition, d);
  drawTitleChip(ctx, "개발 호재/리스크 매트릭스", d, "영향도 · 확정성 · 거리");
  const projects = input.allPois.filter((p): p is MaintenanceProject => p.category === "maintenance");
  const summary = summarizeMaintenanceProjects(projects);
  drawMetricCard(ctx, 0.55, 1.15, 2.35, 0.82, "정비사업", `${summary.count}건`, `총 ${formatMaintenanceArea(summary.totalAreaSqm)}`, "#EC4899", d);
  drawMetricCard(ctx, 3.05, 1.15, 2.35, 0.82, "경계 확인", `${summary.boundaryConfirmedCount}건`, `${summary.count - summary.boundaryConfirmedCount}건은 위치 확인 필요`, "#3B82F6", d);
  drawMetricCard(ctx, 5.55, 1.15, 2.35, 0.82, "주요 사업", `${summary.topProjects.length}건`, "면적·거리 기준 선별", "#F59E0B", d);
  drawDataPanel(ctx, ix(0.55), iy(2.25), ix(7.35), iy(3.95), d);
  drawTextBox(ctx, "주요 정비사업 영향도 테이블", ix(0.8), iy(2.5), ix(6.8), iy(0.25), { fontSize: 12, bold: true, color: d.textColor });
  summary.topProjects.slice(0, 7).forEach((project, idx) => {
    const y = 2.96 + idx * 0.42;
    const dist = project.distance_m != null ? formatDistanceM(project.distance_m) : "거리 미확인";
    const impact = project.area_sqm >= 100_000 ? "상" : project.area_sqm >= 30_000 ? "중" : "보통";
    drawTextBox(ctx, project.name, ix(0.82), iy(y), ix(2.8), iy(0.24), { fontSize: 8.2, bold: true, color: d.textColor });
    drawTextBox(ctx, project.stage, ix(3.75), iy(y), ix(1.2), iy(0.24), { fontSize: 7.4, color: d.mutedTextColor });
    drawTextBox(ctx, `${impact} · ${project.boundary_status === "confirmed" ? "확인" : "미확인"} · ${dist}`, ix(5.02), iy(y), ix(2.1), iy(0.24), { fontSize: 7.4, color: project.boundary_status === "confirmed" ? "#93C5FD" : "#FBBF24", align: "right" });
  });
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
  img: HTMLImageElement,
  input: SlideRenderInput,
  d: PptDesignConfig
) {
  drawBaseMap(ctx, img);
  drawMapOverlay(ctx, d);
  drawConcentricRings(ctx, input.radiusPosition, d);
  drawPoiMarkers(ctx, input.poiPositions, ["apartment", "officetel", "residential"], d, { showLabels: false });
  drawSiteMarker(ctx, input.radiusPosition, d);
  drawTitleChip(ctx, "주거 공급 경쟁 구도", d, "세대수 · 분양예정 · 입주 시점");
  const residentials = getResidentialPois(input.allPois);
  const totalUnits = residentials.reduce((sum, apt) => sum + Math.max(0, apt.units), 0);
  const planned = residentials.filter((apt) => apt.status === "planned");
  const totalParking = residentials.reduce((sum, apt) => sum + Math.max(0, apt.parking_count), 0);
  const avgParking = totalUnits > 0 ? totalParking / totalUnits : 0;
  drawMetricCard(ctx, 0.55, 1.16, 2.45, 0.84, "주거시설", `${residentials.length}개`, "아파트·오피스텔 포함", "#3B82F6", d);
  drawMetricCard(ctx, 3.2, 1.16, 2.45, 0.84, "총 세대수", `${totalUnits.toLocaleString()}세대`, `주차 ${totalParking.toLocaleString()}대`, "#22C55E", d);
  drawMetricCard(ctx, 5.85, 1.16, 2.45, 0.84, "분양예정", `${planned.length}건`, "공급 변화 모니터링", "#F59E0B", d);
  drawMetricCard(ctx, 8.5, 1.16, 2.45, 0.84, "주차비율", `${avgParking.toFixed(2)}대/세대`, "단지 상품성 참고", "#EC4899", d);
  drawRankedList(ctx, "대단지/주요 주거시설", [...residentials].sort((a, b) => b.units - a.units).slice(0, 7).map((apt) => ({
    label: apt.name,
    meta: `${apt.units.toLocaleString()}세대 · ${apt.distance_m ? formatDistanceM(apt.distance_m) : "거리 미확인"}`,
    color: apt.status === "planned" ? "#F59E0B" : "#3B82F6",
  })), 0.55, 2.34, 5.6, d);
  drawDataPanel(ctx, ix(6.42), iy(2.34), ix(5.2), iy(3.4), d);
  drawTextBox(ctx, "분양/입주 타임라인", ix(6.7), iy(2.6), ix(4.7), iy(0.25), { fontSize: 12, bold: true, color: d.textColor });
  const timeline = [...residentials]
    .filter((apt) => apt.sale_date || apt.move_in_month)
    .sort((a, b) => (a.move_in_month || a.sale_date).localeCompare(b.move_in_month || b.sale_date))
    .slice(0, 6);
  timeline.forEach((apt, idx) => {
    const y = 3.04 + idx * 0.42;
    drawTextBox(ctx, apt.move_in_month || apt.sale_date || "일정 미확인", ix(6.72), iy(y), ix(1.05), iy(0.22), { fontSize: 7.8, bold: true, color: apt.status === "planned" ? "#FBBF24" : d.mutedTextColor });
    drawTextBox(ctx, apt.name, ix(7.9), iy(y), ix(2.4), iy(0.22), { fontSize: 7.8, color: d.textColor });
    drawTextBox(ctx, `${apt.units.toLocaleString()}세대`, ix(10.25), iy(y), ix(0.82), iy(0.22), { fontSize: 7.4, color: d.mutedTextColor, align: "right" });
  });
  if (timeline.length === 0) {
    drawTextBox(ctx, "일정 정보가 있는 분양/입주 데이터가 없습니다.", ix(6.72), iy(3.05), ix(4.3), iy(0.28), { fontSize: 8.5, color: d.mutedTextColor });
  }
  drawFooterNote(ctx, `주거 공급 장표는 ${input.config.radiusKm}km 반경의 건축물대장·분양 공고 기반 데이터를 요약합니다.`, d);
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
  drawTitleChip(ctx, pageTitle, d, `반경 ${input.config.radiusKm}km`);
  drawLegend(ctx, d);

  if (aptsOnPage.length === 0) return;

  const aptIdSet = new Set(aptsOnPage.map(a => a.id));
  const aptPositions = input.poiPositions.filter(p => aptIdSet.has(p.poi.id));
  if (aptPositions.length === 0) return;

  const APT_CARD_W_IN = d.calloutWidth;
  const APT_CARD_H_IN = d.calloutHeight;
  const CARD_MARGIN_IN = 0.10;
  const CARD_W_PX = ix(APT_CARD_W_IN);
  const CARD_H_PX = iy(APT_CARD_H_IN);
  const labelPositions = computeResidentialCalloutLayout(
    aptPositions.map(p => ({ id: p.poi.id, nx: p.nx, ny: p.ny })),
    {
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      cardWidth: APT_CARD_W_IN,
      cardHeight: APT_CARD_H_IN,
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

  aptPositions.forEach(({ poi, nx, ny }) => {
    const lp = labelPosById.get(poi.id);
    if (!lp) return;
    const apt = aptById.get(poi.id);
    if (!apt) return;

    const markerCX = nx * CANVAS_W;
    const markerCY = ny * CANVAS_H;
    const isLeftSide = lp.labelX < SLIDE_W / 2;

    // Marker dot (apartment color)
    const dotR = ix(d.markerSize / 2);
    drawEllipseShape(ctx, markerCX, markerCY, dotR, dotR,
      hexRgba(d.categoryColors.apartment, d.markerTransparency),
      hexRgba(d.markerBorderColor, 10), d.markerBorderWidth);

    // Card: fixed size, aligned to left or right edge
    const cardX = isLeftSide
      ? ix(CARD_MARGIN_IN)
      : CANVAS_W - ix(CARD_MARGIN_IN) - CARD_W_PX;
    const cardY = Math.max(0, Math.min(lp.labelY * SY - CARD_H_PX / 2, CANVAS_H - CARD_H_PX));
    const cardMidY = cardY + CARD_H_PX / 2;

    // Leader line: marker → inner edge of card
    const lineEndX = isLeftSide ? cardX + CARD_W_PX : cardX;
    ctx.beginPath();
    ctx.moveTo(markerCX, markerCY);
    ctx.lineTo(lineEndX, cardMidY);
    ctx.strokeStyle = hexRgba(d.markerBorderColor, d.leaderLineTransparency);
    ctx.lineWidth = d.leaderLineWidth;
    ctx.setLineDash([]);
    ctx.stroke();

    // Card background
    drawRoundedRect(ctx, cardX, cardY, CARD_W_PX, CARD_H_PX, ix(d.panelRadius / 2),
      hexRgba(d.panelColor, d.calloutTransparency),
      hexRgba(d.markerBorderColor, 55), 0.6);

    // Name
    drawTextBox(ctx, apt.name,
      cardX + ix(0.07), cardY + iy(0.05), CARD_W_PX - ix(0.14), iy(0.22), {
        fontSize: d.calloutFontSize, bold: true, color: d.textColor, valign: "middle",
      });

    // Details: 156세대 / 주차180대 / 최고35층 / 2003년
    const parts: string[] = [];
    if (apt.status === "planned") parts.push("분양예정");
    if (apt.units > 0) parts.push(`${apt.units}세대`);
    if (apt.parking_count > 0) parts.push(`주차${apt.parking_count}대`);
    if (apt.max_floor && apt.max_floor > 0) parts.push(`최고${apt.max_floor}층`);
    if (apt.move_in_month) parts.push(`입주 ${apt.move_in_month}`);
    else if (apt.sale_date) parts.push(`${apt.sale_date.slice(0, 4)}년`);
    if (parts.length > 0) {
      drawTextBox(ctx, parts.join(" / "),
        cardX + ix(0.07), cardY + iy(0.27), CARD_W_PX - ix(0.14), iy(0.20), {
          fontSize: d.calloutDetailFontSize, color: d.mutedTextColor, valign: "middle",
        });
    }
    if (apt.floorplans?.[0]?.source_url || apt.homepage_url || apt.notice_url) {
      drawTextBox(ctx, "평면도 보기",
        cardX + CARD_W_PX - ix(0.72), cardY + iy(0.39), ix(0.65), iy(0.12), {
          fontSize: 6.5, bold: true, color: "#93C5FD", valign: "middle", align: "right",
        });
    }
  });
}

function renderSummarySlide(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  input: SlideRenderInput,
  d: PptDesignConfig
) {
  const { allPois, config } = input;
  drawBaseMap(ctx, img);
  drawMapOverlay(ctx, d);
  drawConcentricRings(ctx, input.radiusPosition, d);
  drawSiteMarker(ctx, input.radiusPosition, d);
  drawTitleChip(ctx, "종합 분석 및 시사점", d, `반경 ${config.radiusKm}km`);

  const panelW = ix(6);
  drawDataPanel(ctx, ix(d.panelX), iy(d.panelY), panelW, iy(5), d);

  const points = getSummaryLines(config, allPois);
  points.forEach((text, idx) => {
    drawTextBox(ctx, text, ix(d.panelX + 0.3), iy(d.panelY + 0.4) + idx * iy(0.65), panelW - ix(0.5), iy(0.5), {
      fontSize: d.summaryFontSize, bold: idx === points.length - 1, color: d.textColor, valign: "middle",
    });
  });
}

function renderDataSourceSlide(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  input: SlideRenderInput,
  d: PptDesignConfig
) {
  drawBaseMap(ctx, img);
  drawMapOverlay(ctx, d);
  ctx.fillStyle = hexRgba(d.primaryColor, 8);
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
  drawDataPanel(ctx, ix(0.7), iy(4.72), ix(11.9), iy(1.55), d);
  drawTextBox(ctx, "주의사항", ix(1.0), iy(4.98), ix(2.0), iy(0.25), { fontSize: 12, bold: true, color: d.textColor });
  [
    "거리 기준은 기본적으로 직선거리이며, 일부 공원은 경계 폴리곤 최단거리로 보정합니다.",
    "정비사업은 고시·공공데이터 반영 시점에 따라 단계 또는 경계 정보가 실제와 다를 수 있습니다.",
    "분양·입주 일정과 평면도 링크는 원천 공고 변경에 따라 사후 확인이 필요합니다.",
    "보고서 점수는 의사결정 보조 지표이며, 최종 판단에는 현장조사·시세·법적 검토가 병행되어야 합니다.",
  ].forEach((text, idx) => {
    drawWrappedText(ctx, `• ${text}`, ix(1.0 + (idx % 2) * 5.75), iy(5.36 + Math.floor(idx / 2) * 0.42), ix(5.25), iy(0.17), 2, { fontSize: 7.8, color: d.mutedTextColor });
  });
  drawFooterNote(ctx, `${input.config.centerName} / ${input.allPois.length.toLocaleString()}개 POI 기준 자동 생성`, d);
}

// ── Font preload ──────────────────────────────────────────────────────────────

async function ensureFontsLoaded() {
  if (typeof document === "undefined") return;
  try {
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

function buildSlideDefs(input: SlideRenderInput): SlideDef[] {
  const residentials = input.allPois.filter(
    (p): p is ResidentialPoi => p.category === "apartment" || p.category === "officetel" || p.category === "residential"
  );
  const aptPages = pageResidentials(residentials, APT_PAGE_SIZE);
  const totalPages = aptPages.length;

  const defs: SlideDef[] = [
    { title: "표지", render: renderCoverSlide },
    { title: "입지 현황 종합", render: renderOverviewSlide },
    { title: "입지 점수 대시보드", render: renderScoreDashboardSlide },
    { title: "핵심 인사이트 요약", render: renderInsightSummarySlide },
    { title: "생활권 반경 분석", render: renderRadiusAnalysisSlide },
    {
      title: "교통 분석",
      render: (ctx, img, inp, d) => {
        const subways = inp.allPois.filter((p) => p.category === "subway") as SubwayStation[];
        renderCategorySlide(ctx, img, inp, d, "교통 분석", ["subway"],
          subways.slice(0, 8).map(s => `${s.name} (${s.line})`), true);
      },
    },
    {
      title: "교육 환경",
      render: (ctx, img, inp, d) => {
        const schools = inp.allPois.filter((p): p is School => p.category === "school");
        renderCategorySlide(ctx, img, inp, d, "교육 환경", ["school"],
          schools.slice(0, 8).map(s =>
            `${s.name} (${s.level === "elementary" ? "초" : s.level === "middle" ? "중" : "고"})`
          ));
      },
    },
    {
      title: "자연 환경",
      render: (ctx, img, inp, d) => {
        const parks = inp.allPois.filter((p): p is Park => p.category === "park");
        const mountains = inp.allPois.filter(p => p.category === "mountain");
        renderCategorySlide(ctx, img, inp, d, "자연 환경", ["park", "mountain"],
          [...buildParkDetailLines(parks, 7), ...mountains.slice(0, 1).map(p => `인접 산: ${p.name}`)].slice(0, 8));
      },
    },
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
  designConfig: PptDesignConfig
): Promise<RenderedSlide[]> {
  await ensureFontsLoaded();
  const baseImg = await loadImage(input.baseMapImage);
  const slideDefs = buildSlideDefs(input);

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
  preloadedImage?: HTMLImageElement
): Promise<RenderedSlide> {
  await ensureFontsLoaded();
  const baseImg = preloadedImage ?? (await loadImage(input.baseMapImage));
  const slideDefs = buildSlideDefs(input);
  const def = slideDefs[slideIndex] ?? slideDefs[0];
  const [canvas, ctx] = createCanvas();
  def.render(ctx, baseImg, input, designConfig);
  return { index: slideIndex, title: def.title, imageDataUrl: canvas.toDataURL("image/png") };
}

export async function preloadBaseImage(dataUrl: string): Promise<HTMLImageElement> {
  return loadImage(dataUrl);
}
