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
} from "./types";
import { CATEGORY_LABELS } from "./types";
import { layoutPoiLabels } from "./ppt-label-layout";
import { computeResidentialCalloutLayout } from "./ppt-callout-layout";
import { buildParkDetailLines, formatAreaSqm, formatDistanceM, summarizeParks } from "./park-analysis";
import { buildMaintenanceDetailLines, formatMaintenanceArea, summarizeMaintenanceProjects } from "./maintenance-analysis";
import { buildInsightOverlays, computeAnalysisScores, generateAnalysisNarrative, getSummaryLines } from "./analysis-engine";
import { haversineDistance } from "./geo";
import type { PptDesignConfig } from "./ppt-design-config";
import { DEFAULT_PPT_DESIGN } from "./ppt-design-config";

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const APT_PAGE_SIZE = 12;

const FONT_MAIN = "Noto Sans KR";

const EMPTY_PANEL_TEXT = "반경 내 확인된 시설이 없습니다"; // match ppt-canvas-renderer.ts

const SITE_LABEL_OFFSET_Y = 0.20;
const RING_RATIOS = [0.33, 0.66, 1.0] as const;

const LEGEND_ICON_SIZE = 0.10;
const LEGEND_ROW_H = 0.22;
const LEGEND_W = 1.4;

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

function addFooterNote(slide: PptxGenJS.Slide, text: string, d: PptDesignConfig) {
  slide.addText(text, {
    x: 0.55, y: 7.08, w: 12.2, h: 0.22,
    fontSize: 6.5, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor),
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
    x: x + 0.18, y: y + 0.12, w: w - 0.34, h: 0.18,
    fontSize: 7.5, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor), bold: true,
  });
  slide.addText(value, {
    x: x + (d.metricStyle === "number-plate" ? 0.55 : 0.18), y: y + 0.34, w: w - 0.34, h: 0.34,
    fontSize: d.metricStyle === "number-plate" ? 16 : 18, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true,
  });
  slide.addText(detail, {
    x: x + 0.18, y: y + h - 0.34, w: w - 0.34, h: 0.22,
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
      slide.addText(item.label, { x: itemX + 0.16, y: y + 0.065, w: 0.6, h: 0.2, fontSize: 6.4, fontFace: FONT_MAIN, color: pptColor(d.textColor), valign: "middle", fit: "shrink" });
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
    const iconShape = d.legendStyle === "index" || d.legendStyle === "minimal" ? "rect" : "ellipse";
    slide.addShape(iconShape, {
      x: legX + 0.12, y: y + (LEGEND_ROW_H - LEGEND_ICON_SIZE) / 2,
      w: LEGEND_ICON_SIZE, h: LEGEND_ICON_SIZE,
      fill: { color: item.color.replace("#", "") },
      line: { color: pptColor(d.markerBorderColor), transparency: d.legendStyle === "minimal" ? 70 : 0, width: 0.8 },
      rectRadius: d.legendStyle === "index" ? 0.01 : undefined,
    });
    if (d.legendStyle !== "rail") {
      slide.addText(item.label, {
        x: legX + 0.28, y, w: LEGEND_W - 0.32, h: LEGEND_ROW_H,
        fontSize: d.legendFontSize, fontFace: FONT_MAIN,
        color: pptColor(d.textColor), valign: "middle",
      });
    }
  });
}

function addPoiMarkers(
  slide: PptxGenJS.Slide,
  positions: readonly PoiPosition[],
  categories: readonly PoiCategory[],
  d: PptDesignConfig,
  options: { showLabels?: boolean; size?: number } = {}
) {
  const { showLabels = true } = options;
  const size = options.size ?? d.markerSize;
  const filtered = positions.filter((p) => categories.includes(p.poi.category));
  const labelPlacements = showLabels ? layoutPoiLabels(filtered, SLIDE_W, SLIDE_H, size) : [];
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
    slide.addText(poi.name, {
      x: placement.x, y: placement.y, w: placement.w, h: placement.h,
      fontSize: d.labelFontSize, fontFace: FONT_MAIN,
      color: pptColor(d.textColor), bold: true,
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

  RING_RATIOS.forEach((ratio, idx) => {
    const ringRx = rx * ratio;
    const ringRy = ry * ratio;
    const isOuter = idx === RING_RATIOS.length - 1;
    slide.addShape("ellipse", {
      x: cx - ringRx, y: cy - ringRy, w: ringRx * 2, h: ringRy * 2,
      fill: { color: "FFFFFF", transparency: 100 },
      line: {
        color: pptColor(d.markerBorderColor),
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

  slide.addShape("ellipse", {
    x: cx - d.siteMarkerOuterSize / 2, y: cy - d.siteMarkerOuterSize / 2,
    w: d.siteMarkerOuterSize, h: d.siteMarkerOuterSize,
    fill: { color: "FFFFFF", transparency: 100 },
    line: { color: pptColor(d.markerBorderColor), width: 1.5, dashType: "dash" },
  });
  slide.addShape("ellipse", {
    x: cx - d.siteMarkerInnerSize / 2, y: cy - d.siteMarkerInnerSize / 2,
    w: d.siteMarkerInnerSize, h: d.siteMarkerInnerSize,
    fill: { color: pptColor(d.markerBorderColor) },
    line: { color: pptColor(d.markerBorderColor), width: 1 },
  });
  slide.addText("SITE", {
    x: cx - 0.3, y: cy + SITE_LABEL_OFFSET_Y, w: 0.6, h: 0.2,
    fontSize: d.siteLabelFontSize, fontFace: FONT_MAIN, bold: true, color: pptColor(d.markerBorderColor), align: "center",
  });
}

export interface RouteNormalizedPosition {
  readonly line: string;
  readonly lineColor: string;
  readonly points: readonly { readonly nx: number; readonly ny: number }[];
}

function addSubwayRouteLines(
  slide: PptxGenJS.Slide,
  routePositions: readonly RouteNormalizedPosition[],
  d: PptDesignConfig
) {
  routePositions.forEach((route) => {
    const color = route.lineColor.replace("#", "");
    for (let i = 0; i < route.points.length - 1; i++) {
      const from = route.points[i];
      const to = route.points[i + 1];
      const x1 = from.nx * SLIDE_W, y1 = from.ny * SLIDE_H;
      const x2 = to.nx * SLIDE_W, y2 = to.ny * SLIDE_H;
      const x = Math.min(x1, x2), y = Math.min(y1, y2);
      const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
      slide.addShape("line", {
        x, y, w: Math.max(w, 0.005), h: Math.max(h, 0.005),
        line: { color, width: d.subwayLineWidth },
        flipV: x2 >= x1 !== y2 >= y1,
      });
    }
  });
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

        // White border
        slide.addShape("line", {
          x, y, w: Math.max(w, 0.005), h: Math.max(h, 0.005),
          line: { color: pptColor(d.markerBorderColor), width: stationBorderWidth },
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

        slide.addText(station.poi.name, {
          x: labelCx - labelW / 2,
          y: labelCy - labelH / 2,
          w: labelW,
          h: labelH,
          fontSize: d.stationLabelFontSize,
          fontFace: FONT_MAIN,
          color: pptColor(d.markerBorderColor),
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

// ── Slides ──────────────────────────────────────────────────────────────────

function addCoverSlide(pptx: PptxGenJS, config: AnalysisConfig, baseMapImage: string, d: PptDesignConfig) {
  const slide = pptx.addSlide();
  const isLightCover = usesLightCoverText(d);
  const coverTextColor = isLightCover ? d.textColor : "#FFFFFF";
  const coverMetaColor = isLightCover ? d.mutedTextColor : "#E5E7EB";
  if (baseMapImage) {
    slide.addImage({ data: baseMapImage, x: 0, y: 0, w: SLIDE_W, h: SLIDE_H });
    addMapVeil(slide, getCoverOverlayColor(d), d.coverOverlayTransparency);
  } else {
    slide.background = { fill: pptColor(getCoverOverlayColor(d)) };
  }
  addCompositionBackdrop(slide, d, "cover");
  addDesignFrame(slide, d);
  const { titleX, titleY, titleW, titleAlign } = getCoverTextLayout(d);
  if (d.titleStyle === "luxury-plaque") {
    slide.addShape("rect", { x: 2.55, y: 2.08, w: 8.25, h: 2.55, fill: { color: pptColor(d.canvasColor), transparency: 100 }, line: { color: pptColor(d.accentColor), transparency: 18, width: 0.9 }, rectRadius: 0.02 });
  }
  slide.addText(config.centerName, {
    x: titleX, y: titleY, w: titleW, h: 1,
    fontSize: d.coverTitleFontSize, fontFace: FONT_MAIN, color: pptColor(coverTextColor), bold: true, align: titleAlign,
    margin: titleAlign === "left" ? 0 : undefined,
  });
  slide.addText("사이트 입지 분석 보고서", {
    x: titleX, y: titleY + 1.0, w: titleW, h: 0.6,
    fontSize: d.coverSubtitleFontSize, fontFace: FONT_MAIN, color: pptColor(coverTextColor), align: titleAlign,
    margin: titleAlign === "left" ? 0 : undefined,
  });
  if (d.titleStyle !== "plain") {
    slide.addShape("rect", { x: titleAlign === "center" ? titleX + titleW / 2 - 1.65 : titleX, y: titleY + 1.8, w: titleAlign === "center" ? 3.3 : 2.8, h: 0.03, fill: { color: pptColor(d.accentColor), transparency: 10 }, line: { color: pptColor(d.accentColor), transparency: 100 } });
  }
  const refDate = new Date().toLocaleDateString("ko-KR");
  slide.addText(`${refDate} | 반경 ${config.radiusKm}km 분석`, {
    x: titleX, y: titleY + 2.3, w: titleW, h: 0.4,
    fontSize: d.coverMetaFontSize, fontFace: FONT_MAIN, color: pptColor(coverMetaColor), align: titleAlign,
    margin: titleAlign === "left" ? 0 : undefined,
  });
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
  addSubwayRouteLines(slide, routePositions, d);
  addPoiMarkers(slide, poiPositions, ["school", "park", "mountain", "apartment", "officetel", "residential"], d, {
    showLabels: false, size: d.markerSizeSm,
  });
  addStationBars(slide, poiPositions, routePositions, d, radiusPosition, config.radiusKm);
  addSiteMarker(slide, radiusPosition, d);
  addTitleChip(slide, "입지 현황 종합", d, `반경 ${config.radiusKm}km`);
  addLegend(slide, d);
}

function addScoreDashboardSlide(
  pptx: PptxGenJS,
  config: AnalysisConfig,
  pois: readonly Poi[],
  baseMapImage: string,
  d: PptDesignConfig,
) {
  const slide = pptx.addSlide();
  addFullBleedMap(slide, baseMapImage, d);
  addCompositionBackdrop(slide, d, "content");
  addDesignFrame(slide, d);
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
  addMetricCard(slide, 9.65, 6.05, 2.55, 0.8, "분석 반경", `${config.radiusKm}km`, `${pois.length.toLocaleString()}개 POI 반영`, "#93C5FD", d);
  addFooterNote(slide, "점수는 POI 수, 거리, 면적, 정비사업 경계 확인 여부를 조합한 내부 기준입니다.", d);
}

function addInsightSummarySlide(
  pptx: PptxGenJS,
  config: AnalysisConfig,
  pois: readonly Poi[],
  baseMapImage: string,
  d: PptDesignConfig,
) {
  const slide = pptx.addSlide();
  addFullBleedMap(slide, baseMapImage, d);
  addCompositionBackdrop(slide, d, "content");
  addDesignFrame(slide, d);
  addTitleChip(slide, "핵심 인사이트 요약", d, "강점 · 리스크 · 후속 확인");

  const narrative = generateAnalysisNarrative(config, pois);
  addDataPanel(slide, 0.7, 1.15, 11.95, 1.05, d);
  slide.addText(narrative.summary, {
    x: 1.0, y: 1.38, w: 11.35, h: 0.52,
    fontSize: 17, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true, fit: "shrink",
  });

  const columns = [
    { title: "핵심 강점", rows: narrative.bullets.slice(0, 5), color: "#22C55E" },
    { title: "리스크", rows: narrative.risks.length ? narrative.risks.slice(0, 5) : ["현재 데이터 기준 중대한 약점은 제한적입니다."], color: "#F59E0B" },
    { title: "다음 액션", rows: narrative.nextActions.slice(0, 5), color: "#3B82F6" },
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
  baseMapImage: string,
  radiusPosition: RadiusPosition | null,
  d: PptDesignConfig,
) {
  const slide = pptx.addSlide();
  addFullBleedMap(slide, baseMapImage, d);
  addConcentricRings(slide, radiusPosition, d);
  addSiteMarker(slide, radiusPosition, d);
  addTitleChip(slide, "생활권 반경 분석", d, "500m · 1km · 1.5km · 전체 반경");

  const overlays = buildInsightOverlays(config, pois);
  const radiusRows = [
    { label: "근린 핵심권", radiusM: 500, color: "#F59E0B", note: "도보·일상 접근성의 1차 체감권" },
    { label: "생활 편의권", radiusM: 1000, color: "#3B82F6", note: "통학·공원·역세권을 함께 판단" },
    { label: "개발 영향권", radiusM: 1500, color: "#EC4899", note: "정비사업과 공급 변화의 영향권" },
    { label: "보고서 분석권", radiusM: config.radiusKm * 1000, color: "#94A3B8", note: "PPT 전체 POI 집계 기준" },
  ];

  radiusRows.forEach((row, idx) => {
    const x = 0.72 + (idx % 2) * 6.05;
    const y = 1.25 + Math.floor(idx / 2) * 2.35;
    addDataPanel(slide, x, y, 5.55, 1.95, d);
    slide.addText(row.label, {
      x: x + 0.26, y: y + 0.2, w: 2.6, h: 0.28,
      fontSize: 13, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true,
    });
    slide.addText(row.radiusM >= 1000 ? `${(row.radiusM / 1000).toFixed(row.radiusM % 1000 === 0 ? 0 : 1)}km` : `${row.radiusM}m`, {
      x: x + 4.15, y: y + 0.16, w: 1.05, h: 0.34,
      fontSize: 17, fontFace: FONT_MAIN, color: pptColor(row.color), bold: true, align: "right",
    });
    const metrics = [
      { label: "역", value: countWithin(config, pois, row.radiusM, "subway") },
      { label: "학교", value: countWithin(config, pois, row.radiusM, "school") },
      { label: "공원", value: countWithin(config, pois, row.radiusM, "park") },
      { label: "정비", value: countWithin(config, pois, row.radiusM, "maintenance") },
    ];
    metrics.forEach((metric, metricIdx) => {
      const mx = x + 0.3 + metricIdx * 1.18;
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
      x: x + 0.3, y: y + 1.48, w: 4.9, h: 0.22,
      fontSize: 8, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor),
    });
  });

  addRankedList(slide, "지도 인사이트 레이어 기준", overlays.map((overlay) => ({
    label: overlay.label,
    meta: overlay.description,
    color: overlay.color,
  })), 0.72, 6.08, 11.6, d);
  addFooterNote(slide, "반경 분석은 직선거리 기준이며 실제 보행 경로와 차이가 있을 수 있습니다.", d);
}

function addParkAccessDetailSlide(
  pptx: PptxGenJS,
  config: AnalysisConfig,
  pois: readonly Poi[],
  baseMapImage: string,
  poiPositions: readonly PoiPosition[],
  radiusPosition: RadiusPosition | null,
  d: PptDesignConfig,
) {
  const slide = pptx.addSlide();
  addFullBleedMap(slide, baseMapImage, d);
  addConcentricRings(slide, radiusPosition, d);
  addPoiMarkers(slide, poiPositions, ["park", "mountain"], d, { showLabels: true });
  addSiteMarker(slide, radiusPosition, d);
  addTitleChip(slide, "공원/녹지 접근성 상세", d, "경계 기준 접근거리 우선");

  const parks = pois.filter((p): p is Park => p.category === "park");
  const summary = summarizeParks(parks);
  addMetricCard(slide, 0.55, 1.18, 2.45, 0.86, "생활권 공원", `${summary.nearby500Count}개`, "접근 500m 이내", "#10B981", d);
  addMetricCard(slide, 3.18, 1.18, 2.45, 0.86, "총 녹지 면적", formatAreaSqm(summary.totalAreaSqm), `${summary.count}개 공원`, "#22C55E", d);
  addMetricCard(slide, 5.8, 1.18, 2.45, 0.86, "접근성 점수", `${summary.accessibilityScore}/100`, "면적·거리·공원 등급 반영", "#3B82F6", d);
  addMetricCard(slide, 8.42, 1.18, 2.45, 0.86, "대형공원", `${summary.majorCount}개`, "광역 이용 가능성", "#F59E0B", d);

  const topParks = [...parks]
    .sort((a, b) => (a.access_distance_m ?? a.distance_m ?? Infinity) - (b.access_distance_m ?? b.distance_m ?? Infinity))
    .slice(0, 7);
  addRankedList(slide, "최근접 공원 접근거리", topParks.map((park) => ({
    label: park.name,
    meta: `${formatDistanceM(park.access_distance_m ?? park.distance_m ?? 0)} · ${park.area_sqm > 0 ? formatAreaSqm(park.area_sqm) : "면적 미확인"}`,
    color: "#10B981",
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
    addProgressBar(slide, 8.25, y + 0.06, 2.1, row.value, Math.max(summary.count, 1), "#10B981", d);
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
  baseMapImage: string,
  poiPositions: readonly PoiPosition[],
  radiusPosition: RadiusPosition | null,
  d: PptDesignConfig,
) {
  const slide = pptx.addSlide();
  addFullBleedMap(slide, baseMapImage, d);
  addConcentricRings(slide, radiusPosition, d);
  addPoiMarkers(slide, poiPositions, ["maintenance"], d, { showLabels: true });
  addSiteMarker(slide, radiusPosition, d);
  addTitleChip(slide, "개발 호재/리스크 매트릭스", d, "영향도 · 확정성 · 거리");

  const projects = pois.filter((p): p is MaintenanceProject => p.category === "maintenance");
  const summary = summarizeMaintenanceProjects(projects);
  addMetricCard(slide, 0.55, 1.15, 2.35, 0.82, "정비사업", `${summary.count}건`, `총 ${formatMaintenanceArea(summary.totalAreaSqm)}`, "#EC4899", d);
  addMetricCard(slide, 3.05, 1.15, 2.35, 0.82, "경계 확인", `${summary.boundaryConfirmedCount}건`, `${summary.count - summary.boundaryConfirmedCount}건은 위치 확인 필요`, "#3B82F6", d);
  addMetricCard(slide, 5.55, 1.15, 2.35, 0.82, "주요 사업", `${summary.topProjects.length}건`, "면적·거리 기준 선별", "#F59E0B", d);

  addDataPanel(slide, 0.55, 2.25, 7.35, 3.95, d);
  slide.addText("주요 정비사업 영향도 테이블", {
    x: 0.8, y: 2.5, w: 6.8, h: 0.25,
    fontSize: 12, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true,
  });
  const rows = summary.topProjects.slice(0, 7);
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
    slide.addText(`${impact} · ${confidence} · ${dist}`, {
      x: 5.02, y, w: 2.1, h: 0.24,
      fontSize: 7.4, fontFace: FONT_MAIN, color: pptColor(project.boundary_status === "confirmed" ? "#93C5FD" : "#FBBF24"), align: "right",
    });
  });

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
  baseMapImage: string,
  poiPositions: readonly PoiPosition[],
  radiusPosition: RadiusPosition | null,
  d: PptDesignConfig,
) {
  const slide = pptx.addSlide();
  addFullBleedMap(slide, baseMapImage, d);
  addConcentricRings(slide, radiusPosition, d);
  addPoiMarkers(slide, poiPositions, ["apartment", "officetel", "residential"], d, { showLabels: false });
  addSiteMarker(slide, radiusPosition, d);
  addTitleChip(slide, "주거 공급 경쟁 구도", d, "세대수 · 분양예정 · 입주 시점");

  const residentials = getResidentialPois(pois);
  const totalUnits = residentials.reduce((sum, apt) => sum + Math.max(0, apt.units), 0);
  const planned = residentials.filter((apt) => apt.status === "planned");
  const totalParking = residentials.reduce((sum, apt) => sum + Math.max(0, apt.parking_count), 0);
  const avgParking = totalUnits > 0 ? totalParking / totalUnits : 0;
  addMetricCard(slide, 0.55, 1.16, 2.45, 0.84, "주거시설", `${residentials.length}개`, "아파트·오피스텔 포함", "#3B82F6", d);
  addMetricCard(slide, 3.2, 1.16, 2.45, 0.84, "총 세대수", `${totalUnits.toLocaleString()}세대`, `주차 ${totalParking.toLocaleString()}대`, "#22C55E", d);
  addMetricCard(slide, 5.85, 1.16, 2.45, 0.84, "분양예정", `${planned.length}건`, "공급 변화 모니터링", "#F59E0B", d);
  addMetricCard(slide, 8.5, 1.16, 2.45, 0.84, "주차비율", `${avgParking.toFixed(2)}대/세대`, "단지 상품성 참고", "#EC4899", d);

  const topUnits = [...residentials].sort((a, b) => b.units - a.units).slice(0, 7);
  addRankedList(slide, "대단지/주요 주거시설", topUnits.map((apt) => ({
    label: apt.name,
    meta: `${apt.units.toLocaleString()}세대 · ${apt.distance_m ? formatDistanceM(apt.distance_m) : "거리 미확인"}`,
    color: apt.status === "planned" ? "#F59E0B" : "#3B82F6",
  })), 0.55, 2.34, 5.6, d);

  addDataPanel(slide, 6.42, 2.34, 5.2, 3.4, d);
  slide.addText("분양/입주 타임라인", {
    x: 6.7, y: 2.6, w: 4.7, h: 0.25,
    fontSize: 12, fontFace: FONT_MAIN, color: pptColor(d.textColor), bold: true,
  });
  const timeline = [...residentials]
    .filter((apt) => apt.sale_date || apt.move_in_month)
    .sort((a, b) => (a.move_in_month || a.sale_date).localeCompare(b.move_in_month || b.sale_date))
    .slice(0, 6);
  timeline.forEach((apt, idx) => {
    const y = 3.04 + idx * 0.42;
    const date = apt.move_in_month || apt.sale_date;
    slide.addText(date || "일정 미확인", {
      x: 6.72, y, w: 1.05, h: 0.22,
      fontSize: 7.8, fontFace: FONT_MAIN, color: pptColor(apt.status === "planned" ? "#FBBF24" : d.mutedTextColor), bold: true,
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
  if (timeline.length === 0) {
    slide.addText("일정 정보가 있는 분양/입주 데이터가 없습니다.", {
      x: 6.72, y: 3.05, w: 4.3, h: 0.28,
      fontSize: 8.5, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor),
    });
  }
  addFooterNote(slide, `주거 공급 장표는 ${config.radiusKm}km 반경의 건축물대장·분양 공고 기반 데이터를 요약합니다.`, d);
}

function addDataSourceSlide(
  pptx: PptxGenJS,
  config: AnalysisConfig,
  pois: readonly Poi[],
  baseMapImage: string,
  d: PptDesignConfig,
) {
  const slide = pptx.addSlide();
  addFullBleedMap(slide, baseMapImage, d);
  slide.addShape("rect", {
    x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
    fill: { color: pptColor(d.primaryColor), transparency: 8 },
    line: { color: pptColor(d.primaryColor), transparency: 100 },
  });
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
  addDataPanel(slide, 0.7, 4.72, 11.9, 1.55, d);
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
  routePositions: readonly RouteNormalizedPosition[] = []
) {
  const slide = pptx.addSlide();
  addFullBleedMap(slide, baseMapImage, d);
  addConcentricRings(slide, radiusPosition, d);
  const cats = Array.isArray(category) ? category : [category];
  const hasSubway = cats.includes("subway");
  if (hasSubway) {
    addSubwayRouteLines(slide, routePositions, d);
  }
  const markerCats = hasSubway ? cats.filter(c => c !== "subway") : cats;
  addPoiMarkers(slide, poiPositions, markerCats.length > 0 ? markerCats : cats, d, {
    showLabels: !hasSubway,
  });
  if (hasSubway) {
    addStationBars(slide, poiPositions, routePositions, d, radiusPosition, config.radiusKm);
  }
  addSiteMarker(slide, radiusPosition, d);
  addTitleChip(slide, title, d, `반경 ${config.radiusKm}km`);

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
  addLegend(slide, d);
}

function addApartmentCalloutSlide(
  pptx: PptxGenJS,
  aptsOnPage: readonly ResidentialPoi[],
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
    ? `주변 주거시설 현황 ${pageIdx + 1}/${totalPages}`
    : "주변 주거시설 현황";
  addTitleChip(slide, pageTitle, d, `반경 ${config.radiusKm}km`);
  addLegend(slide, d);

  if (aptsOnPage.length === 0) return;

  const aptIdSet = new Set(aptsOnPage.map(a => a.id));
  const aptPositions = poiPositions.filter(p => aptIdSet.has(p.poi.id));
  if (aptPositions.length === 0) return;

  const APT_CARD_W = d.calloutWidth;
  const APT_CARD_H = d.calloutHeight;
  const CARD_MARGIN = 0.10;
  const labelPositions = computeResidentialCalloutLayout(
    aptPositions.map(p => ({ id: p.poi.id, nx: p.nx, ny: p.ny })),
    {
      slideWidth: SLIDE_W,
      slideHeight: SLIDE_H,
      cardWidth: APT_CARD_W,
      cardHeight: APT_CARD_H,
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

  aptPositions.forEach(({ poi, nx, ny }) => {
    const lp = labelPosById.get(poi.id);
    if (!lp) return;
    const apt = aptById.get(poi.id);
    if (!apt) return;

    const markerX = nx * SLIDE_W;
    const markerY = ny * SLIDE_H;
    const isLeftSide = lp.labelX < SLIDE_W / 2;

    // Card: fixed size, aligned to left or right edge
    const cardX = isLeftSide
      ? CARD_MARGIN
      : SLIDE_W - CARD_MARGIN - APT_CARD_W;
    const cardY = Math.max(0.05, Math.min(lp.labelY - APT_CARD_H / 2, SLIDE_H - APT_CARD_H - 0.05));
    const cardMidY = cardY + APT_CARD_H / 2;

    // Marker dot
    const dotR = d.markerSize / 2;
    slide.addShape("ellipse", {
      x: markerX - dotR, y: markerY - dotR, w: d.markerSize, h: d.markerSize,
      fill: { color: (d.categoryColors[apt.category] ?? d.categoryColors.apartment).replace("#", "") },
      line: { color: pptColor(d.markerBorderColor), width: d.markerBorderWidth },
    });

    // Leader line: marker → inner edge of card
    const lx1 = markerX, ly1 = markerY;
    const lx2 = isLeftSide ? cardX + APT_CARD_W : cardX;
    const ly2 = cardMidY;
    slide.addShape("line", {
      x: Math.min(lx1, lx2),
      y: Math.min(ly1, ly2),
      w: Math.max(Math.abs(lx2 - lx1), 0.005),
      h: Math.max(Math.abs(ly2 - ly1), 0.005),
      line: { color: pptColor(d.markerBorderColor), width: d.leaderLineWidth, transparency: d.leaderLineTransparency },
      flipV: (lx2 >= lx1) !== (ly2 >= ly1),
    });

    // Card background
    slide.addShape("rect", {
      x: cardX, y: cardY, w: APT_CARD_W, h: APT_CARD_H,
      fill: { color: pptColor(d.panelColor), transparency: d.calloutTransparency },
      line: { color: pptColor(d.markerBorderColor), transparency: 55, width: 0.6 },
      rectRadius: d.panelRadius / 2,
    });

    // Name
    slide.addText(apt.name, {
      x: cardX + 0.07, y: cardY + 0.05, w: APT_CARD_W - 0.14, h: 0.22,
      fontSize: d.calloutFontSize, fontFace: FONT_MAIN, bold: true, color: pptColor(d.textColor),
      valign: "middle",
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
      slide.addText(parts.join(" / "), {
        x: cardX + 0.07, y: cardY + 0.27, w: APT_CARD_W - 0.14, h: 0.20,
        fontSize: d.calloutDetailFontSize, fontFace: FONT_MAIN, color: pptColor(d.mutedTextColor), valign: "middle",
      });
    }
    const floorplanUrl = apt.floorplans?.[0]?.source_url || apt.homepage_url || apt.notice_url;
    if (floorplanUrl) {
      slide.addText("평면도 보기", {
        x: cardX + APT_CARD_W - 0.72, y: cardY + 0.39, w: 0.65, h: 0.12,
        fontSize: 6.5, fontFace: FONT_MAIN, color: "93C5FD", bold: true,
        hyperlink: { url: floorplanUrl, tooltip: "공식 평면도/분양 페이지 열기" },
      });
    }
  });
}

function addSummarySlide(
  pptx: PptxGenJS,
  config: AnalysisConfig,
  pois: readonly Poi[],
  baseMapImage: string,
  radiusPosition: RadiusPosition | null,
  d: PptDesignConfig
) {
  const slide = pptx.addSlide();
  addFullBleedMap(slide, baseMapImage, d);
  addConcentricRings(slide, radiusPosition, d);
  addSiteMarker(slide, radiusPosition, d);
  addTitleChip(slide, "종합 분석 및 시사점", d, `반경 ${config.radiusKm}km`);

  const panelW = 6;
  addDataPanel(slide, d.panelX, d.panelY, panelW, 5, d);

  const points = getSummaryLines(config, pois);
  points.forEach((text, idx) => {
    slide.addText(text, {
      x: d.panelX + 0.3, y: d.panelY + 0.4 + idx * 0.65, w: panelW - 0.5, h: 0.5,
      fontSize: d.summaryFontSize, fontFace: FONT_MAIN, color: pptColor(d.textColor),
      bold: idx === points.length - 1,
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
  designConfig: PptDesignConfig = DEFAULT_PPT_DESIGN
): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = `${config.centerName} 입지 분석`;
  const d = designConfig;

  addCoverSlide(pptx, config, baseMapImage, d);
  addOverviewSlide(pptx, config, baseMapImage, poiPositions, radiusPosition, routePositions, d);
  addScoreDashboardSlide(pptx, config, allPois, baseMapImage, d);
  addInsightSummarySlide(pptx, config, allPois, baseMapImage, d);
  addRadiusAnalysisSlide(pptx, config, allPois, baseMapImage, radiusPosition, d);

  const subways = allPois.filter((p): p is SubwayStation => p.category === "subway");
  addCategorySlide(pptx, "교통 분석", "subway", config, baseMapImage, poiPositions, radiusPosition,
    subways.slice(0, 8).map(s => `${s.name} (${s.line})`), d, routePositions);

  const schools = allPois.filter((p): p is School => p.category === "school");
  addCategorySlide(pptx, "교육 환경", "school", config, baseMapImage, poiPositions, radiusPosition,
    schools.slice(0, 8).map(s => `${s.name} (${s.level === "elementary" ? "초" : s.level === "middle" ? "중" : "고"})`), d);

  const parks = allPois.filter((p): p is Park => p.category === "park");
  const mountains = allPois.filter(p => p.category === "mountain");
  addCategorySlide(pptx, "자연 환경", ["park", "mountain"], config, baseMapImage, poiPositions, radiusPosition,
    [...buildParkDetailLines(parks, 7), ...mountains.slice(0, 1).map(p => `인접 산: ${p.name}`)].slice(0, 8), d);
  addParkAccessDetailSlide(pptx, config, allPois, baseMapImage, poiPositions, radiusPosition, d);

  const maintenanceProjects = allPois.filter((p): p is MaintenanceProject => p.category === "maintenance");
  addCategorySlide(pptx, "개발/정비사업 현황", "maintenance", config, baseMapImage, poiPositions, radiusPosition,
    buildMaintenanceDetailLines(maintenanceProjects, 8), d);
  addDevelopmentRiskMatrixSlide(pptx, config, allPois, baseMapImage, poiPositions, radiusPosition, d);

  const residentials = allPois.filter(
    (p): p is ResidentialPoi => p.category === "apartment" || p.category === "officetel" || p.category === "residential"
  );
  addResidentialSupplySlide(pptx, config, allPois, baseMapImage, poiPositions, radiusPosition, d);
  const aptPages = pageResidentials(residentials, APT_PAGE_SIZE);
  aptPages.forEach((aptsOnPage, i) => {
    addApartmentCalloutSlide(pptx, aptsOnPage, config, baseMapImage, poiPositions,
      radiusPosition, d, i, aptPages.length);
  });

  addSummarySlide(pptx, config, allPois, baseMapImage, radiusPosition, d);
  addDataSourceSlide(pptx, config, allPois, baseMapImage, d);

  await pptx.writeFile({ fileName: `${config.centerName}_사이트분석.pptx` });
}
