"use client";

import * as React from "react";
import { createContext, memo, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { BasemapChoice } from "@/lib/v2/ui/map-projection";
import type { BaseThemeId } from "@/lib/v2/ui/map-theme";
import { BaseThemeContext } from "../base-theme-context";
import { metersPerPixel, slideViewport, zoomViewAt, type MapView } from "@/lib/v2/ui/map-projection";
import { mapFrameScaleOptions, scaleOptionsForFrame, zoomForScale } from "@/lib/v2/ui/report-scale";
import { SLIDE_LEGEND, calloutLegendEntries, layoutRects, slideCalloutAvoidance, slideCalloutLegendLayout, slideGeometry, slideLayout, slideLegend, slideLegendGeometry, slidePanelRects, slidePanelScale, slideReserved, slideSize, slideSiteX, terrainSectionLayout, type Rect, type SlideFormat, type TerrainSectionLayout } from "@/lib/v2/ui/overlay-layout";
import { coverLayout, fitBlock, fitFooterText, fontSizeForStyle, sourceLayout, titlePlateRect, type Slide } from "@/lib/v2/report/pptx-kit";
import { SLIDE_OVERVIEW_FILL, calloutHoverText, calloutKeyFromTag, calloutKeyTag, calloutPageTitleTail, slideCalloutFrame } from "@/lib/v2/ui/callout-layout";
import { a05ReportModule } from "@/lib/v2/tile/a05/report";
import { layerStyle, legendItemsOf, legendLabelOf } from "@/lib/v2/ui/map-layers";
import { reportSummaryNotes, terrainCrossingLayer, terrainElevationLabel, terrainSectionAxisStops, terrainSectionBands, terrainSectionElevationAt, terrainSectionMarkerGeometry, terrainSectionPosition, terrainSectionTotal, sortTerrainCrossings, TERRAIN_CROSSING_LABELS, TERRAIN_SECTION_LABELS, TERRAIN_SECTION_TABLE_MAX_ROWS } from "@/lib/v2/ui/terrain-section";
import MapFigure, { type MapFigureElementPick } from "../map-figure";
import { locatorBox, northArrowBox, scaleBarBox, scaleChromeScaleForBox } from "@/lib/v2/ui/map-scene";
import type { PageStyle } from "@/lib/v2/ui/board-state";
import { clampTextBox, DEFAULT_REPORT_FONT_SIZES, TEXT_BOX_COLORS, TEXT_BOX_DEFAULTS, textBoxDefaults, type MapFrameState, type MapLabelBox, type PagePanelRect, type PagePanels, type TextBox, type TextBoxColor, type TextBoxKind } from "@/lib/v2/report/report-doc";
import type { PlannedSlide } from "@/lib/v2/report/report-plan";
import type { TileView } from "@/lib/v2/ui/tile-view";
import { sheetCells, type SheetGrid } from "@/lib/v2/ui/sheet";
import { labelBoxFramePatch, labelFramePatch, mapLabelSwitchState, reportPageMapSelectable, mixedValue, resetLabelBoxFramePatch, toggleLabelVisibility, toggleLegendFocus } from "@/lib/v2/ui/report-mode-logic";
import { mapLayoutUnitForFrame, placeActionBar, type ActionBarPixelBox } from "@/lib/v2/report/report-geometry";

type SurfaceStyles = Record<string, string>;
const FALLBACK_STYLES: SurfaceStyles = new Proxy<SurfaceStyles>({} as SurfaceStyles, { get: (_target, key) => String(key) });
const SurfaceStyleContext = createContext<SurfaceStyles>(FALLBACK_STYLES);
const SurfaceSelectContext = createContext<((selection: SurfaceSelection) => void) | undefined>(undefined);
function useSurfaceStyles(): SurfaceStyles {
  return useContext(SurfaceStyleContext);
}

type SurfaceLegendItem = {
  color: string;
  site?: boolean;
  symbol?: "rail-axis" | "rail-exit";
  legendSwatch?: "line" | "polygon";
  lineSwatch?: boolean;
  hollow?: boolean;
  fill?: string;
  stroke?: string;
  fillOpacity?: number;
  strokeWidth?: number;
  dash?: string;
  lineCap?: "butt" | "round" | "square";
  casing?: string;
  tickMarks?: boolean;
  hatch?: boolean;
};

function LegendSwatch({ item }: { item: SurfaceLegendItem }) {
  const id = useId().replace(/:/g, "");
  const kind = item.site ? "site" : (item.symbol ?? (item.lineSwatch ? "line" : item.legendSwatch ?? "point"));
  if (kind === "site") return <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><rect x="2.2" y="2.2" width="7.6" height="7.6" fill="#fff" stroke="#111" strokeWidth="1" transform="rotate(45 6 6)" /><circle cx="6" cy="6" r="1.3" fill="#111" /></svg>;
  if (kind === "rail-axis") return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><line x1="1" y1="8" x2="15" y2="8" stroke="#172033" strokeWidth="6" strokeLinecap="round" /><line x1="1" y1="8" x2="15" y2="8" stroke={item.color} strokeWidth="4" strokeLinecap="round" /></svg>;
  if (kind === "rail-exit") return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="5.2" fill="#FFD200" stroke="#172033" strokeWidth="0.9" /></svg>;
  if (kind === "polygon" && (item.fill || item.stroke || item.hatch)) {
    const fill = item.hollow ? "transparent" : item.fill ?? item.color;
    return <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><defs>{item.hatch && <pattern id={`surface-hatch-${id}`} patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)"><rect width="10" height="10" fill={fill} fillOpacity={item.fillOpacity ?? 1} /><path d="M0 0V10" stroke={item.color} strokeWidth="1.2" strokeOpacity=".75" /></pattern>}</defs><rect x=".5" y=".5" width="9" height="9" rx="1.5" fill={item.hatch ? `url(#surface-hatch-${id})` : fill} fillOpacity={item.hatch ? 1 : item.fillOpacity ?? 1} stroke={item.stroke ?? item.color} strokeWidth={item.strokeWidth ?? 1} strokeDasharray={item.dash} /></svg>;
  }
  if (kind === "line") return <svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true" focusable="false"><line x1="1" y1="6" x2="19" y2="6" stroke={item.casing ?? "transparent"} strokeWidth={(item.strokeWidth ?? 1.5) + (item.casing ? 2.4 : 0)} strokeDasharray={item.dash} strokeLinecap={item.lineCap ?? "butt"} /><line x1="1" y1="6" x2="19" y2="6" stroke={item.color} strokeWidth={item.strokeWidth ?? 1.5} strokeDasharray={item.dash} strokeLinecap={item.lineCap ?? "butt"} />{item.tickMarks && [4, 8, 12, 16].map((x) => <line key={x} x1={x} y1="3" x2={x} y2="9" stroke={item.color} strokeWidth="1" strokeLinecap="round" />)}</svg>;
  return <span data-kind={kind} aria-hidden="true" style={{ display: "inline-block", width: 12, height: 10, borderRadius: 2, background: item.hollow ? "transparent" : item.color, border: item.hollow ? `1px solid ${item.color}` : undefined }} />;
}
type PreviewStylePatch = Partial<PageStyle>;

type PanelKey = "title" | "summary" | "legend" | "source";
export type FontTargetKey = PanelKey | "labels" | "scale";
export type SurfaceDecorationKey = "north" | "scaleBar" | "locator";
export type SurfaceContextTarget =
  | { kind: "panel"; key: "title" | "summary" | "legend"; cell?: number }
  | { kind: "element"; key: "source"; cell?: number }
  | { kind: "textBox"; id: string }
  | { kind: "decoration"; key: SurfaceDecorationKey; cell?: number }
  | { kind: "mapElement"; key: string; cell?: number }
  | { kind: "mapLabel"; key: string; cell?: number }
  | { kind: "sheetCell"; cell: number }
  | { kind: "font"; key: FontTargetKey; cell?: number };
export type SurfaceContextMenuTarget = SurfaceContextTarget | FontTargetKey;
export type SurfaceContextMenuHandler = (target: SurfaceContextMenuTarget, x: number, y: number, opener: HTMLElement) => void;
type PanelRatio = PagePanelRect;
type ResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

function isResizeAnchorHit(direction: ResizeDirection, event: ReactPointerEvent<HTMLElement>): boolean {
  const frame = event.currentTarget.closest<HTMLElement>("[data-panel-frame], [data-decoration-frame]")?.getBoundingClientRect();
  if (!frame) return true;
  const x = event.clientX - frame.left;
  const y = event.clientY - frame.top;
  const anchorX = direction.includes("e") ? frame.width : direction.includes("w") ? 0 : frame.width / 2;
  const anchorY = direction.includes("s") ? frame.height : direction.includes("n") ? 0 : frame.height / 2;
  return Math.hypot(x - anchorX, y - anchorY) <= 14;
}

const PANEL_LABEL: Record<PanelKey, string> = { title: "제목", summary: "요약", legend: "범례", source: "출처 줄" };
const PANEL_MIN: Record<PanelKey, { w: number; h: number }> = {
  title: { w: 1.1, h: 0.46 },
  summary: { w: 1.8, h: 1.1 },
  legend: { w: 1.3, h: 0.52 },
  source: { w: 3.2, h: 0.28 },
};
const SHEET_GRID_OPTIONS: readonly { grid: SheetGrid; label: string }[] = [
  { grid: "2x2", label: "2×2 · 4칸" },
  { grid: "3x2", label: "3×2 · 6칸" },
  { grid: "3x1", label: "3×1 · 3칸" },
];

type PanelInteraction = {
  "data-panel-key": PanelKey;
  "data-panel-selected": "true" | "false";
  "data-font-highlight"?: "true" | "false";
  tabIndex: 0;
  role: "group";
  "aria-label": string;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mixedField<T>(slides: readonly PlannedSlide[], read: (slide: PlannedSlide) => T, fallback: T): { value: T; mixed: boolean } {
  if (slides.length === 0) return { value: fallback, mixed: false };
  const value = mixedValue(slides.map(read), fallback);
  return value === undefined ? { value: fallback, mixed: true } : { value, mixed: false };
}

function formatZoom(value: number): string {
  const normalized = Math.round(value * 10) / 10;
  return (normalized > 0 ? "+" : "") + String(normalized).replace(/\.0$/, "");
}

function formatScale(value: number): string {
  return String(Math.round(value * 100)) + "%";
}

type InlineIconName = "close" | "grid" | "plus" | "chevronDown" | "chevronLeft" | "chevronRight" | "zoomOut" | "zoomIn" | "center" | "summary";

function InlineIcon({ name, size }: { name: InlineIconName; size?: number }) {
  const styles = useSurfaceStyles();
  let content: React.ReactNode;
  switch (name) {
    case "close":
      content = <path d="M6 6l12 12M18 6 6 18" />;
      break;
    case "grid":
      content = <>
        <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
        <rect x="13.5" y="4" width="6.5" height="6.5" rx="1" />
        <rect x="4" y="13.5" width="6.5" height="6.5" rx="1" />
        <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" />
      </>;
      break;
    case "plus":
      content = <path d="M12 5v14M5 12h14" />;
      break;
    case "chevronDown":
      content = <path d="m7 9 5 5 5-5" />;
      break;
    case "chevronLeft":
      content = <path d="m14.5 5-7 7 7 7" />;
      break;
    case "chevronRight":
      content = <path d="m9.5 5 7 7-7 7" />;
      break;
    case "zoomOut":
      content = <>
        <circle cx="10.5" cy="10.5" r="5.75" />
        <path d="m15 15 4.25 4.25M8 10.5h5" />
      </>;
      break;
    case "zoomIn":
      content = <>
        <circle cx="10.5" cy="10.5" r="5.75" />
        <path d="m15 15 4.25 4.25M8 10.5h5M10.5 8v5" />
      </>;
      break;
    case "center":
      content = <>
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      </>;
      break;
    case "summary":
      content = <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M7.5 9h9M7.5 12h6M7.5 15h8" />
      </>;
      break;
  }
  return <svg className={styles.iconSvg} style={size ? { width: size, height: size } : undefined} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{content}</svg>;
}

function slideTitle(slide: PlannedSlide): string {
  if (slide.kind === "cover") return slide.address;
  if (slide.kind === "sources") return "출처·기준일";
  return slide.view.title;
}

function mapForSlide(slide: PlannedSlide): NonNullable<Extract<PlannedSlide, { kind: "tile" | "cover" | "sources" }>["map"]> | null {
  return slide.kind === "tile" || slide.kind === "cover" || slide.kind === "sources" ? slide.map : null;
}

function hasSummaryPanel(slide: PlannedSlide): boolean {
  return slide.kind === "tile" && slide.style.summary !== false && !(slide.callout && slide.callout.page > 0);
}

function rectStyle(rect: Rect, unit: number): CSSProperties {
  return { left: rect.x * unit, top: rect.y * unit, width: rect.w * unit, height: rect.h * unit };
}

function fontStyle(pt: number, unit: number, extra: CSSProperties = {}): CSSProperties {
  // 슬라이드 축소본이므로 글자도 배치와 같은 비율로 줄인다(하한을 두면 좁은 화면에서 줄이 겹친다).
  return { ...extra, fontSize: (pt / 72) * unit };
}

function canvasStyle(unit: number): CSSProperties {
  return { "--slide-unit": String(unit) + "px" } as CSSProperties;
}

function ratioOfRect(rect: Rect, format: SlideFormat = "wide"): PanelRatio {
  const size = slideSize(format);
  return {
    x: clampNumber(rect.x / size.w, 0, 1),
    y: clampNumber(rect.y / size.h, 0, 1),
    w: clampNumber(rect.w / size.w, 0, 1),
    h: clampNumber(rect.h / size.h, 0, 1),
  };
}

function panelPatch(key: PanelKey, rect: Rect, existing: Partial<Record<PanelKey, PanelRatio>> = {}, format: SlideFormat = "wide"): PreviewStylePatch {
  return { panels: { ...existing, [key]: ratioOfRect(rect, format) } } as unknown as PreviewStylePatch;
}

function safePanelBounds(format: SlideFormat = "wide", key?: PanelKey): { left: number; top: number; right: number; bottom: number } {
  const geometry = slideGeometry(format);
  return {
    left: geometry.edge,
    top: geometry.edge,
    right: geometry.w - geometry.edge,
    bottom: key === "source" ? geometry.h - geometry.edge * 0.1 : geometry.h - geometry.stripH - geometry.edge * 0.6,
  };
}

function actionBarOffsetForRect(rect: Rect, unit: number, bounds: { w: number; h: number }, avoid: readonly ActionBarPixelBox[] = [], barWidth = 190): { left: number; top: number } {
  const position = placeActionBar({ x: rect.x * unit, y: rect.y * unit, w: rect.w * unit, h: rect.h * unit }, bounds, avoid, barWidth);
  return { left: position.left - rect.x * unit, top: position.top - rect.y * unit };
}

function clampPanelRect(key: PanelKey, rect: Rect, format: SlideFormat = "wide"): Rect {
  const bounds = safePanelBounds(format, key);
  const min = PANEL_MIN[key];
  const w = clampNumber(rect.w, Math.min(min.w, bounds.right - bounds.left), bounds.right - bounds.left);
  const h = clampNumber(rect.h, Math.min(min.h, bounds.bottom - bounds.top), bounds.bottom - bounds.top);
  return {
    x: clampNumber(rect.x, bounds.left, bounds.right - w),
    y: clampNumber(rect.y, bounds.top, bounds.bottom - h),
    w,
    h,
  };
}

function snapPanelRect(key: PanelKey, proposed: Rect, all: Partial<Record<PanelKey, Rect>>, format: SlideFormat = "wide"): { rect: Rect; xGuides: number[]; yGuides: number[] } {
  const bounds = safePanelBounds(format, key);
  const snapThreshold = slideSize(format).w * 0.01;
  let rect = clampPanelRect(key, proposed, format);
  const xCandidates = [bounds.left, bounds.right];
  const yCandidates = [bounds.top, bounds.bottom];
  for (const [otherKey, other] of Object.entries(all)) {
    if (otherKey === key || !other) continue;
    xCandidates.push(other.x, other.x + other.w);
    yCandidates.push(other.y, other.y + other.h);
  }
  const xEdges = [rect.x, rect.x + rect.w];
  const yEdges = [rect.y, rect.y + rect.h];
  const nearest = (edges: number[], candidates: number[]) => {
    let best: { delta: number; target: number } | null = null;
    for (const edge of edges) {
      for (const target of candidates) {
        const delta = target - edge;
        if (Math.abs(delta) <= snapThreshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, target };
      }
    }
    return best;
  };
  const xSnap = nearest(xEdges, xCandidates);
  const ySnap = nearest(yEdges, yCandidates);
  if (xSnap) rect = clampPanelRect(key, { ...rect, x: rect.x + xSnap.delta }, format);
  if (ySnap) rect = clampPanelRect(key, { ...rect, y: rect.y + ySnap.delta }, format);
  return {
    rect,
    xGuides: xSnap ? [xSnap.target] : [],
    yGuides: ySnap ? [ySnap.target] : [],
  };
}

function panelLabelFor(key: PanelKey): string {
  return PANEL_LABEL[key] + " 탭";
}

type ContainFrameSize = { width: number; height: number };

function useContainFrameSize(ref: React.RefObject<HTMLDivElement | null>, format: SlideFormat = "wide"): ContainFrameSize {
  const [size, setSize] = useState<ContainFrameSize>({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const geometry = slideSize(format);
    const measure = () => {
      const maxWidth = element.clientWidth;
      const maxHeight = element.clientHeight;
      if (maxWidth <= 0 || maxHeight <= 0) return;
      const width = Math.floor(Math.min(maxWidth, maxHeight * geometry.w / geometry.h));
      const height = Math.floor(width * geometry.h / geometry.w);
      setSize((current) => current.width === width && current.height === height ? current : { width, height });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [format, ref]);
  return size;
}

type MapLayerProps = {
  model: NonNullable<ReturnType<typeof mapForSlide>>;
  style: PageStyle;
  unit: number;
  basemap: BasemapChoice;
  panels: { title: Rect; summary: Rect | null; legend: Rect | null };
  siteX: number;
  pinnedKeys?: readonly string[];
  interactive: boolean;
  pickable?: boolean;
  selectedElementKey?: string | null;
  selectedElementLabelVisible?: boolean;
  selectedLabelKey?: string | null;
  selectedPanelKey?: PanelKey | null;
  onMapElementSelect?: (feature: MapFigureElementPick) => void;
  onMapLabelSelect?: (feature: MapFigureElementPick) => void;
  onLabelBoxChange?: (key: string, box: MapLabelBox) => void;
  onLabelBoxReset?: (key: string) => void;
  onDeleteElement?: (key: string) => void;
  onHideLabel?: (key: string) => void;
  onShowLabel?: (key: string) => void;
  onPanelDelete?: (key: PanelKey) => void;
  selectedDecorationKey?: SurfaceDecorationKey | null;
  onDecorationSelect?: (key: SurfaceDecorationKey) => void;
  onDecorationDelete?: (key: SurfaceDecorationKey, cell?: number) => void;
  onMapHoverLegend?: (label: string | null) => void;
  panelInteraction?: (key: PanelKey) => PanelInteraction;
  mapEditEntry?: boolean;
  onMapMoveActive?: (active: boolean) => void;
  thumbnail?: boolean;
  onPatch: (patch: PreviewStylePatch) => void;
  onDirectPatch?: (patch: PreviewStylePatch) => void;
  hoverLegend?: string | null;
  terrainSection?: "A" | "B";
  terrainLayout?: TerrainSectionLayout | null;
  calloutLegend?: Rect | null;
  calloutTop?: number;
  calloutLeftBottom?: number;
  northAvoid?: { x0: number; y0: number; x1: number; y1: number } | null;
  scale?: boolean;
  fill?: number;
  callout?: Extract<PlannedSlide, { kind: "tile" }>;
  label: string;
  format?: SlideFormat;
  frame?: Rect;
  /** 타일은 페이지, 조판 셀은 해당 cell frame을 기준으로 장식 사각형을 읽는다. */
  panelBasis?: "page" | "frame";
  reportFrame?: MapFrameState;
  preserveShortCalloutLabels?: boolean;
  fontHighlight?: FontTargetKey | null;
  onFontContextMenu?: SurfaceContextMenuHandler;
  contextCell?: number;
};

const EMPTY_PAGE_KEYS: readonly string[] = [];

function panelRectInMap(panel: PagePanelRect | undefined, format: SlideFormat, unit: number, frame: Rect | undefined, basis: "page" | "frame", width: number, height: number): { x0: number; y0: number; x1: number; y1: number } | null {
  if (!panel) return null;
  const page = slideSize(format);
  const frameWidth = (frame?.w ?? page.w) * unit;
  const frameHeight = (frame?.h ?? page.h) * unit;
  const originX = basis === "page" ? (frame?.x ?? 0) * unit : 0;
  const originY = basis === "page" ? (frame?.y ?? 0) * unit : 0;
  const sourceWidth = basis === "page" ? page.w * unit : frameWidth;
  const sourceHeight = basis === "page" ? page.h * unit : frameHeight;
  const x0 = panel.x * sourceWidth - originX;
  const y0 = panel.y * sourceHeight - originY;
  const x1 = x0 + panel.w * sourceWidth;
  const y1 = y0 + panel.h * sourceHeight;
  const left = clampNumber(x0, 0, Math.max(0, width - 1));
  const top = clampNumber(y0, 0, Math.max(0, height - 1));
  return { x0: left, y0: top, x1: clampNumber(x1, left + 1, width), y1: clampNumber(y1, top + 1, height) };
}

function panelRectFromMapBox(box: { x0: number; y0: number; x1: number; y1: number }, format: SlideFormat, unit: number, frame: Rect | undefined, basis: "page" | "frame"): PagePanelRect {
  const page = slideSize(format);
  const sourceWidth = (basis === "page" ? page.w : (frame?.w ?? page.w)) * unit;
  const sourceHeight = (basis === "page" ? page.h : (frame?.h ?? page.h)) * unit;
  const originX = basis === "page" ? (frame?.x ?? 0) * unit : 0;
  const originY = basis === "page" ? (frame?.y ?? 0) * unit : 0;
  return {
    x: clampNumber((box.x0 + originX) / sourceWidth, 0, 1),
    y: clampNumber((box.y0 + originY) / sourceHeight, 0, 1),
    w: clampNumber((box.x1 - box.x0) / sourceWidth, 0.01, 1),
    h: clampNumber((box.y1 - box.y0) / sourceHeight, 0.01, 1),
  };
}

type DecorationBox = { x0: number; y0: number; x1: number; y1: number };
type DecorationResizeDirection = Extract<ResizeDirection, "nw" | "ne" | "se" | "sw">;
type DecorationTransformState = { pointerId: number; key: SurfaceDecorationKey; mode: "drag" | "resize"; direction?: DecorationResizeDirection; x: number; y: number; box: DecorationBox; ratio: number };

function clampDecorationBox(box: DecorationBox, width: number, height: number, minWidth = 32, minHeight = 24): DecorationBox {
  const w = clampNumber(box.x1 - box.x0, Math.min(minWidth, width), width);
  const h = clampNumber(box.y1 - box.y0, Math.min(minHeight, height), height);
  return {
    x0: clampNumber(box.x0, 0, Math.max(0, width - w)),
    y0: clampNumber(box.y0, 0, Math.max(0, height - h)),
    x1: clampNumber(box.x0, 0, Math.max(0, width - w)) + w,
    y1: clampNumber(box.y0, 0, Math.max(0, height - h)) + h,
  };
}

function snapDecorationBox(key: SurfaceDecorationKey, proposed: DecorationBox, all: Partial<Record<SurfaceDecorationKey, DecorationBox>>, width: number, height: number): { box: DecorationBox; xGuides: number[]; yGuides: number[] } {
  let box = clampDecorationBox(proposed, width, height, key === "scaleBar" ? 44 : 36, key === "scaleBar" ? 24 : 32);
  const threshold = Math.max(4, Math.max(width, height) * 0.01);
  const xCandidates = [0, width];
  const yCandidates = [0, height];
  for (const [otherKey, other] of Object.entries(all)) {
    if (otherKey === key || !other) continue;
    xCandidates.push(other.x0, other.x1);
    yCandidates.push(other.y0, other.y1);
  }
  const nearest = (edges: number[], candidates: number[]) => {
    let best: { delta: number; target: number } | null = null;
    for (const edge of edges) for (const target of candidates) {
      const delta = target - edge;
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, target };
    }
    return best;
  };
  const x = nearest([box.x0, box.x1], xCandidates);
  const y = nearest([box.y0, box.y1], yCandidates);
  if (x) box = clampDecorationBox({ ...box, x0: box.x0 + x.delta, x1: box.x1 + x.delta }, width, height);
  if (y) box = clampDecorationBox({ ...box, y0: box.y0 + y.delta, y1: box.y1 + y.delta }, width, height);
  return { box, xGuides: x ? [x.target] : [], yGuides: y ? [y.target] : [] };
}

function hiddenLayer(layer: string, hidden: readonly string[]): boolean {
  return hidden.includes(layer) || hidden.includes(layerStyle(layer).label);
}

function modelWithHiddenLayers(model: NonNullable<ReturnType<typeof mapForSlide>>, hidden: readonly string[]): NonNullable<ReturnType<typeof mapForSlide>> {
  if (hidden.length === 0) return model;
  return {
    ...model,
    features: model.features.filter((feature) => !hiddenLayer(feature.layer, hidden)),
    polygons: model.polygons?.filter((polygon) => !hiddenLayer(polygon.layer, hidden)),
    lines: model.lines?.filter((line) => !hiddenLayer(line.layer, hidden)),
  };
}

function recordPreviewMetric(name: string): void {
  if (typeof window === "undefined" || process.env.NODE_ENV === "production") return;
  const target = window as Window & { __V2_PREVIEW_METRICS__?: Record<string, number> };
  const metrics = target.__V2_PREVIEW_METRICS__ ?? (target.__V2_PREVIEW_METRICS__ = {});
  metrics[name] = (metrics[name] ?? 0) + 1;
}

function recordPreviewTiming(name: string, elapsedMs: number): void {
  if (typeof window === "undefined" || process.env.NODE_ENV === "production") return;
  const target = window as Window & { __V2_PREVIEW_METRICS__?: Record<string, number> };
  const metrics = target.__V2_PREVIEW_METRICS__ ?? (target.__V2_PREVIEW_METRICS__ = {});
  metrics[`${name}LastMs`] = elapsedMs;
  metrics[`${name}TotalMs`] = (metrics[`${name}TotalMs`] ?? 0) + elapsedMs;
  metrics[`${name}Samples`] = (metrics[`${name}Samples`] ?? 0) + 1;
}

type ElementAction = { key: string; label: string; onClick?: () => void; pressed?: boolean; ariaPressed?: boolean; switch?: boolean };

function ElementActionBar({
  elementLabel,
  left,
  top,
  actions = [],
  onDelete,
}: {
  elementLabel: string;
  left: number;
  top: number;
  actions?: ElementAction[];
  onDelete?: () => void;
}) {
  const styles = useSurfaceStyles();
  return (
    <div className={styles.elementActionBar ?? styles.mapSelectionToolbar} data-element-action-bar="true" data-element-action-layer="true" data-element-action={elementLabel} style={{ left, top }} onPointerDown={(event) => event.stopPropagation()}>
      {actions.map((action) => <button key={action.key} type="button" className={action.switch ? styles.mapSelectionSwitch : (styles.elementActionButton ?? styles.mapSelectionToolbarButton)} aria-label={action.switch ? `${action.label} ${action.ariaPressed ? "켜짐" : "꺼짐"}` : undefined} aria-pressed={action.ariaPressed ?? action.pressed} onClick={action.onClick}>{action.switch ? <><span>{action.label}</span><span className={styles.mapSelectionSwitchTrack} aria-hidden="true"><span className={styles.mapSelectionSwitchThumb} /></span></> : action.label}</button>)}
      {actions.length > 0 && <span className={styles.elementActionSeparator ?? styles.mapSelectionToolbarSeparator} aria-hidden="true" />}
      <button type="button" className={styles.elementActionDanger ?? styles.mapSelectionToolbarButton + " " + styles.mapSelectionDanger} aria-label={`${elementLabel} 지우기`} onClick={onDelete}>지우기</button>
    </div>
  );
}

function DecorationTransformFrame({ label, box, bounds, onDragStart, onDragMove, onDragEnd, onResizeStart, onResizeMove, onResizeEnd, onKeyDown, actions, onDelete, onContextMenu }: {
  label: string;
  box: DecorationBox;
  bounds: { w: number; h: number };
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onDragMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDragEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeStart: (direction: DecorationResizeDirection, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  actions?: ElementAction[];
  onDelete?: () => void;
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const styles = useSurfaceStyles();
  const directions: DecorationResizeDirection[] = ["nw", "ne", "se", "sw"];
  const actionBar = placeActionBar({ x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 }, bounds);
  return <div className={styles.decorationSelectionFrame ?? styles.panelSelectionFrame} data-decoration-frame={label} style={{ left: box.x0, top: box.y0, width: Math.max(1, box.x1 - box.x0), height: Math.max(1, box.y1 - box.y0) }} tabIndex={0} role="group" aria-label={`${label} 선택됨`} onPointerDown={(event) => { if ((event.target as HTMLElement).closest("button")) return; onDragStart(event); }} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd} onKeyDown={onKeyDown} onContextMenu={(event) => { if ((event.target as HTMLElement).closest("button")) return; event.preventDefault(); event.stopPropagation(); onContextMenu?.(event); }}>
    <ElementActionBar elementLabel={label} left={actionBar.left - box.x0} top={actionBar.top - box.y0} actions={actions} onDelete={onDelete} />
    {directions.map((direction) => <button key={direction} type="button" tabIndex={-1} className={styles.panelHandle + " " + styles["panelHandle" + direction.toUpperCase() as keyof typeof styles]} data-decoration-handle={direction} aria-label={`${label} ${direction} 모서리 크기 조절`} title={`${label} ${direction} 크기 조절`} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); if (!isResizeAnchorHit(direction, event)) { onDragStart(event); return; } onResizeStart(direction, event); }} onPointerMove={onResizeMove} onPointerUp={onResizeEnd} onPointerCancel={onResizeEnd}><span aria-hidden="true" /></button>)}
  </div>;
}

function MapLayer({ model, style, unit, basemap, panels, siteX, pinnedKeys, interactive, pickable = false, selectedElementKey = null, selectedElementLabelVisible, selectedLabelKey = null, selectedPanelKey = null, onMapElementSelect, onMapLabelSelect, onLabelBoxChange, onLabelBoxReset, onDeleteElement, onHideLabel, onShowLabel, selectedDecorationKey = null, onDecorationSelect, onDecorationDelete, onMapHoverLegend, panelInteraction, mapEditEntry = false, onMapMoveActive, thumbnail = false, onPatch, onDirectPatch, hoverLegend, terrainSection, terrainLayout, calloutLegend, calloutTop, calloutLeftBottom, northAvoid, scale = true, label, format = "wide", frame, panelBasis = "page", reportFrame, preserveShortCalloutLabels = false, fontHighlight, onFontContextMenu, contextCell, fill, callout }: MapLayerProps) {
  const styles = useSurfaceStyles();
  const selectSurface = useContext(SurfaceSelectContext);
  const geometry = slideGeometry(format);
  const frameWidth = frame?.w ?? geometry.w;
  const frameHeight = frame?.h ?? geometry.h;
  const width = Math.max(1, Math.round(frameWidth * unit));
  const height = Math.max(1, Math.round(frameHeight * unit));
  const [dragging, setDragging] = useState(false);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [labelVisibilityOverride, setLabelVisibilityOverride] = useState<boolean | null>(null);
  const mapInteractionRef = useRef<HTMLDivElement>(null);
  const [selectionToolbarAnchor, setSelectionToolbarAnchor] = useState<{ x: number; y: number } | null>(null);
  const [decorationDraftBox, setDecorationDraftBox] = useState<DecorationBox | null>(null);
  const [decorationSnapGuides, setDecorationSnapGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const decorationTransform = useRef<DecorationTransformState | null>(null);
  const gestureLayerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; offset: [number, number]; dx: number; dy: number; moved: boolean } | null>(null);
  const suppressFeatureClick = useRef(false);
  const panDeltaRef = useRef<[number, number] | null>(null);
  const wheelDeltaRef = useRef(0);
  const wheelBaseViewRef = useRef<MapView | null>(null);
  const wheelPreviewViewRef = useRef<MapView | null>(null);
  const wheelOriginRef = useRef<[number, number] | null>(null);
  const wheelTimerRef = useRef<number | null>(null);
  const labelLongPressRef = useRef<{ pointerId: number; x: number; y: number; target: HTMLElement; timer: number } | null>(null);
  const labelToggleStartedRef = useRef<number | null>(null);
  const styleRef = useRef(style);
  const patchRef = useRef(onPatch);
  styleRef.current = style;
  patchRef.current = onPatch;
  const effectivePinnedKeys = useMemo(
    () => [...new Set([...(pinnedKeys ?? EMPTY_PAGE_KEYS), ...(style.pinnedKeys ?? EMPTY_PAGE_KEYS), ...(reportFrame?.pinnedKeys ?? EMPTY_PAGE_KEYS)])],
    [pinnedKeys, reportFrame?.pinnedKeys, style.pinnedKeys],
  );
  useEffect(() => {
    setLabelVisibilityOverride(selectedElementLabelVisible ?? null);
  }, [selectedElementKey, selectedElementLabelVisible]);
  useEffect(() => {
    setDecorationDraftBox(null);
    setDecorationSnapGuides({ x: [], y: [] });
    decorationTransform.current = null;
  }, [selectedDecorationKey]);
  const mapFill = terrainLayout?.mapFill ?? fill ?? 0.8;
  const mapSiteY = terrainLayout?.mapSiteY ?? 0.5;
  const rightInset = panels.summary
    ? Math.max(0, width - panels.summary.x * unit + geometry.edge * unit * 0.5)
    : geometry.edge * unit;
  const bottomInset = unit * (geometry.stripH + (calloutLegend ? calloutLegend.h + 0.18 : 0));
  const layoutUnit = panelBasis === "frame" && frame
    ? mapLayoutUnitForFrame(height)
    : 1.5 * (unit / (960 / geometry.w));
  const showNorth = reportFrame?.decorations.north ?? false;
  const showScale = reportFrame?.decorations.scaleBar ?? scale;
  const savedNorthBox = panelRectInMap(style.panels?.north, format, unit, frame, panelBasis, width, height);
  const savedScaleBox = panelRectInMap(style.panels?.scaleBar, format, unit, frame, panelBasis, width, height);
  const savedLocatorBox = panelRectInMap(style.panels?.locator, format, unit, frame, panelBasis, width, height);
  const displayBasemap: BasemapChoice = reportFrame?.basemap === "air" ? "Satellite" : reportFrame?.basemap === "none" ? "white" : reportFrame?.basemap === "road" ? "Base" : reportFrame?.basemap === "base" ? (model.base ? "vector" : "Base") : basemap;
  const baseViewport = useMemo(() => slideViewport(model, undefined, { width, height, siteX, siteY: mapSiteY, fill: mapFill }), [height, mapFill, mapSiteY, model, siteX, width]);
  const viewport = useMemo(() => slideViewport(model, style, { width, height, siteX, siteY: mapSiteY, fill: mapFill }), [height, mapFill, mapSiteY, model, siteX, style, width]);
  const focusedLabel = useMemo(() => legendLabelOf(model, style.legendFocus), [model, style.legendFocus]);
  const activeLegendLabel = hoverLegend ?? focusedLabel;
  const avoid = useMemo(() => {
    const frameOffsetX = frame?.x ? frame.x * unit : 0;
    const frameOffsetY = frame?.y ? frame.y * unit : 0;
    const reserved = slideReserved(unit, {
      info: panels.summary !== null,
      titleRect: panels.title,
      infoRect: panels.summary,
      legend: panels.legend,
      calloutLegend,
      terrainSection: terrainLayout?.rect,
      format,
    }).map((box) => ({ x0: box.x0 - frameOffsetX, y0: box.y0 - frameOffsetY, x1: box.x1 - frameOffsetX, y1: box.y1 - frameOffsetY }));
    const scaleAvoid = scaleBarBox(width, height, metersPerPixel(viewport.center[1], viewport.zoom), bottomInset, rightInset, false, undefined, layoutUnit);
    return [...reserved, ...(showScale && !savedScaleBox ? [scaleAvoid] : []), ...(showNorth && !savedNorthBox && northAvoid ? [northAvoid] : [])];
  }, [bottomInset, calloutLegend, format, frame?.x, frame?.y, height, layoutUnit, northAvoid, panels.legend, panels.summary, panels.title, rightInset, savedNorthBox, savedScaleBox, showNorth, showScale, terrainLayout?.rect, unit, viewport, width]);
  const locator = reportFrame?.decorations.locator && model.radiusM > 0 ? (savedLocatorBox ?? locatorBox(width, height, unit, avoid)) : null;
  const automaticScaleBox = showScale ? scaleBarBox(width, height, metersPerPixel(viewport.center[1], viewport.zoom), bottomInset, rightInset, false, undefined, layoutUnit) : null;
  const scaleBox = showScale ? (savedScaleBox ?? automaticScaleBox) : null;
  const defaultNorthWidth = Math.max(1, northAvoid ? northAvoid.x1 - northAvoid.x0 : 26 * layoutUnit);
  const defaultNorthHeight = Math.max(1, northAvoid ? northAvoid.y1 - northAvoid.y0 : 26 * layoutUnit);
  const northScale = savedNorthBox
    ? clampNumber(((savedNorthBox.x1 - savedNorthBox.x0) / defaultNorthWidth + (savedNorthBox.y1 - savedNorthBox.y0) / defaultNorthHeight) / 2, 0.5, 3)
    : 1;
  const scaleChromeScale = scaleChromeScaleForBox(savedScaleBox, automaticScaleBox);
  const decorationBoxes: Partial<Record<SurfaceDecorationKey, { x0: number; y0: number; x1: number; y1: number }>> = {
    ...(showNorth && (savedNorthBox ?? northAvoid) ? { north: savedNorthBox ?? northAvoid! } : {}),
    ...(scaleBox ? { scaleBar: scaleBox } : {}),
    ...(locator ? { locator } : {}),
  };
  const onFeatureHover = useCallback((key: string | null, legendLabel?: string | null) => {
    if (!interactive && !pickable) return;
    setHoverKey((current) => current === key ? current : key);
    onMapHoverLegend?.(key ? legendLabel ?? null : null);
  }, [interactive, onMapHoverLegend, pickable]);
  useEffect(() => {
    const host = mapInteractionRef.current;
    const selectedKey = selectedElementKey ?? selectedLabelKey;
    if (!host || !selectedKey) {
      setSelectionToolbarAnchor(null);
      return;
    }
    const update = () => {
      const hostRect = host.getBoundingClientRect();
      const boxes = Array.from(host.querySelectorAll<SVGElement>("[data-map-feature]"))
        .filter((element) => element.getAttribute("data-map-feature") === selectedKey)
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0);
      if (boxes.length === 0 || hostRect.width <= 0 || hostRect.height <= 0) {
        setSelectionToolbarAnchor(null);
        return;
      }
      const left = Math.min(...boxes.map((rect) => rect.left));
      const top = Math.min(...boxes.map((rect) => rect.top));
      const right = Math.max(...boxes.map((rect) => rect.right));
      const bottom = Math.max(...boxes.map((rect) => rect.bottom));
      const scaleX = width / hostRect.width;
      const scaleY = height / hostRect.height;
      const position = placeActionBar({
        x: (left - hostRect.left) * scaleX,
        y: (top - hostRect.top) * scaleY,
        w: (right - left) * scaleX,
        h: (bottom - top) * scaleY,
      }, { w: width, h: height });
      setSelectionToolbarAnchor({ x: position.left, y: position.top });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [height, reportFrame?.labelBoxes, selectedElementKey, selectedLabelKey, style.offsetM?.[0], style.offsetM?.[1], style.zoomDelta, width]);
  const onFeaturePin = useCallback((feature: { key: string; labelVisible?: boolean }) => {
    if (!onDirectPatch || suppressFeatureClick.current) return;
    const currentStyle = styleRef.current;
    const currentHidden = [...new Set([...(currentStyle.hiddenKeys ?? EMPTY_PAGE_KEYS), ...(reportFrame?.hiddenLabelKeys ?? EMPTY_PAGE_KEYS)])];
    const next = toggleLabelVisibility(
      effectivePinnedKeys,
      currentHidden,
      feature.key,
      feature.labelVisible ?? false,
    );
    labelToggleStartedRef.current = typeof performance === "undefined" ? null : performance.now();
    recordPreviewMetric("labelToggleDispatches");
    onDirectPatch({ pinnedKeys: next.pinnedKeys, hiddenKeys: next.hiddenKeys });
  }, [effectivePinnedKeys, onDirectPatch, reportFrame?.hiddenLabelKeys]);
  const setGestureTransform = useCallback(() => {
    const element = gestureLayerRef.current;
    if (!element) return;
    const pan = panDeltaRef.current;
    const zoom = wheelDeltaRef.current;
    const origin = wheelOriginRef.current;
    if (!pan && zoom === 0) {
      element.style.transform = "";
      element.style.transformOrigin = "";
      element.style.willChange = "";
      return;
    }
    const translate = pan ? `translate3d(${pan[0]}px, ${pan[1]}px, 0)` : "";
    const scale = zoom === 0 ? "" : `scale(${2 ** zoom})`;
    element.style.transformOrigin = origin ? `${origin[0]}px ${origin[1]}px` : "50% 50%";
    element.style.transform = `${translate} ${scale}`.trim();
    element.style.willChange = "transform";
  }, []);
  const startPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactive || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-map-pick], [data-map-label-selection], [data-map-label-handle], [data-map-selection-toolbar]")) return;
    event.preventDefault();
    const sourceOffset = styleRef.current.offsetM ?? [0, 0];
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, offset: [sourceOffset[0], sourceOffset[1]], dx: 0, dy: 0, moved: false };
  }, [interactive]);
  const movePointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.moved && Math.hypot(dx, dy) < 4) return;
    if (!state.moved) {
      state.moved = true;
      suppressFeatureClick.current = true;
      setDragging(true);
      // 4px 전에는 capture하지 않아야 click이 지도 SVG로 간다.
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    state.dx = dx;
    state.dy = dy;
    panDeltaRef.current = [dx, dy];
    setGestureTransform();
    event.preventDefault();
  }, [setGestureTransform]);
  const endPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    if (state.moved) {
      const mpp = metersPerPixel(viewport.center[1], viewport.zoom);
      const next: [number, number] = [state.offset[0] - state.dx * mpp, state.offset[1] + state.dy * mpp];
      patchRef.current({ offsetM: next });
      recordPreviewMetric("panCommits");
      panDeltaRef.current = null;
      setGestureTransform();
      setDragging(false);
      window.setTimeout(() => { suppressFeatureClick.current = false; }, 0);
      event.preventDefault();
    } else {
      suppressFeatureClick.current = false;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  }, [setGestureTransform, viewport.center, viewport.zoom]);
  const clearLabelLongPress = useCallback((event?: ReactPointerEvent<HTMLDivElement>) => {
    const pending = labelLongPressRef.current;
    if (!pending || (event && pending.pointerId !== event.pointerId)) return;
    window.clearTimeout(pending.timer);
    labelLongPressRef.current = null;
  }, []);
  const startLabelLongPress = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    clearLabelLongPress();
    if (!onFontContextMenu || (event.pointerType !== "touch" && event.pointerType !== "pen") || event.button !== 0) return;
    const target = event.currentTarget;
    const x = event.clientX;
    const y = event.clientY;
    const timer = window.setTimeout(() => {
      labelLongPressRef.current = null;
      onFontContextMenu({ kind: "font", key: "labels", ...(contextCell === undefined ? {} : { cell: contextCell }) }, x, y, target);
    }, 500);
    labelLongPressRef.current = { pointerId: event.pointerId, x, y, target, timer };
  }, [clearLabelLongPress, contextCell, onFontContextMenu]);
  const moveLabelLongPress = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pending = labelLongPressRef.current;
    if (pending && (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 8 || pending.pointerId !== event.pointerId)) clearLabelLongPress(event);
  }, [clearLabelLongPress]);
  useEffect(() => () => {
    if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current);
    if (labelLongPressRef.current !== null) window.clearTimeout(labelLongPressRef.current.timer);
  }, []);
  useEffect(() => {
    if (!interactive) return;
    const element = mapInteractionRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const cssWidth = rect.width > 0 ? rect.width : width;
      const cssHeight = rect.height > 0 ? rect.height : height;
      const px = (event.clientX - rect.left) * (width / cssWidth);
      const py = (event.clientY - rect.top) * (height / cssHeight);
      const currentView = wheelPreviewViewRef.current ?? {
        zoomDelta: styleRef.current.zoomDelta ?? 0,
        offsetM: styleRef.current.offsetM ?? [0, 0],
      };
      wheelBaseViewRef.current ??= currentView;
      const nextView = zoomViewAt(baseViewport, currentView, event.deltaY < 0 ? 0.5 : -0.5, px, py, 3, -3);
      wheelPreviewViewRef.current = nextView;
      wheelDeltaRef.current = nextView.zoomDelta - (wheelBaseViewRef.current?.zoomDelta ?? 0);
      wheelOriginRef.current = [event.clientX - rect.left, event.clientY - rect.top];
      setGestureTransform();
      if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = window.setTimeout(() => {
        const committed = wheelPreviewViewRef.current;
        if (!committed) return;
        patchRef.current({ zoomDelta: committed.zoomDelta, offsetM: [committed.offsetM[0], committed.offsetM[1]] });
        recordPreviewMetric("wheelCommits");
        wheelDeltaRef.current = 0;
        wheelBaseViewRef.current = null;
        wheelPreviewViewRef.current = null;
        wheelOriginRef.current = null;
        wheelTimerRef.current = null;
        setGestureTransform();
      }, 150);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [baseViewport, height, interactive, setGestureTransform, width]);
  useEffect(() => {
    if (drag.current || wheelTimerRef.current !== null) return;
    panDeltaRef.current = null;
    wheelDeltaRef.current = 0;
    wheelBaseViewRef.current = null;
    wheelPreviewViewRef.current = null;
    wheelOriginRef.current = null;
    setGestureTransform();
  }, [setGestureTransform, style.offsetM?.[0], style.offsetM?.[1], style.zoomDelta]);
  useEffect(() => {
    const started = labelToggleStartedRef.current;
    if (started === null || typeof window === "undefined" || typeof performance === "undefined") return;
    labelToggleStartedRef.current = null;
    const frame = window.requestAnimationFrame(() => recordPreviewTiming("labelToggleCommit", performance.now() - started));
    return () => window.cancelAnimationFrame(frame);
  }, [style.hiddenKeys, style.pinnedKeys]);
  const map = (
    <div ref={gestureLayerRef} className={styles.mapGestureLayer} onDragStart={(event) => event.preventDefault()}>
      <MapFigure
        model={model}
        width={width}
        height={height}
        fixed={!thumbnail}
        layoutUnit={layoutUnit}
        basemap={thumbnail ? "none" : "tiles"}
        layer={displayBasemap}
        legend={false}
        north={showNorth ? ((savedNorthBox ?? northAvoid) ? ((savedNorthBox ?? northAvoid)!.y0 + (savedNorthBox ?? northAvoid)!.y1) / 2 : undefined) : false}
        northX={showNorth && savedNorthBox ? (savedNorthBox.x0 + savedNorthBox.x1) / 2 : undefined}
        northScale={northScale}
        credit={false}
        label={label}
        viewport={viewport}
        avoid={avoid}
        pinnedKeys={effectivePinnedKeys}
        hiddenKeys={[...new Set([...(style.hiddenKeys ?? EMPTY_PAGE_KEYS), ...(reportFrame?.hiddenLabelKeys ?? EMPTY_PAGE_KEYS)])]}
        deletedElementKeys={reportFrame?.deletedElementKeys}
        labelBoxes={reportFrame?.labelBoxes}
        selectedElementKey={selectedElementKey}
        selectedLabelKey={selectedLabelKey?.startsWith("callout-key:") || selectedLabelKey?.startsWith("callout-") ? null : selectedLabelKey}
        onLabelBoxChange={pickable ? onLabelBoxChange : undefined}
        onLabelBoxReset={pickable ? onLabelBoxReset : undefined}
        legendFocus={focusedLabel}
        highlightLabel={activeLegendLabel}
        highlightPinnedLabel={focusedLabel}
        terrainSection={terrainSection}
        fill={mapFill}
        siteY={mapSiteY}
        bottomInset={bottomInset}
        rightInset={rightInset}
        scale={showScale}
        scaleX={savedScaleBox ? savedScaleBox.x0 + 6 * layoutUnit : undefined}
        scaleY={savedScaleBox ? savedScaleBox.y1 - 8 * layoutUnit : undefined}
        scaleBoxOverride={savedScaleBox ?? undefined}
        scaleChromeScale={scaleChromeScale}
        scaleFontScale={fontSizeForStyle(style, "scale") / DEFAULT_REPORT_FONT_SIZES.scale}
        calloutTop={calloutTop}
        calloutLeftBottom={calloutLeftBottom ?? (terrainLayout?.calloutLeftBottom ? terrainLayout.calloutLeftBottom * unit : undefined)}
         showAutomaticLabels={reportFrame?.labelRule !== "off"}
         labelScale={fontSizeForStyle(style, "labels") / DEFAULT_REPORT_FONT_SIZES.labels}
         previewInteraction={pickable}
        preserveShortCalloutLabels={preserveShortCalloutLabels}
        hoverKey={pickable ? hoverKey : null}
        onFeatureHover={pickable || interactive ? onFeatureHover : undefined}
        onFeatureSelect={pickable ? onMapElementSelect : undefined}
        onLabelSelect={pickable ? onMapLabelSelect : undefined}
        onFeaturePin={interactive ? onFeaturePin : undefined}
        dragging={dragging}
      />
      {callout && <CalloutSlideOverlay slide={callout} part="anchored" dragging={dragging} />}
    </div>
  );
  const calloutFixed = callout && <CalloutSlideOverlay slide={callout} part="fixed" />;
  const selectedCalloutKey = selectedLabelKey?.startsWith("callout-key:") || selectedLabelKey?.startsWith("callout-") ? selectedLabelKey : null;
  const mapLabelKey = selectedCalloutKey ? null : selectedLabelKey;
  const calloutSelection = callout && pickable
    ? <CalloutSelectionLayer slide={callout} unit={unit} format={format} legendRect={panels.legend} selectedCardKey={selectedCalloutKey} selectedPanel={selectedPanelKey === "legend"} panelInteraction={panelInteraction} onPanelSelect={() => selectSurface?.({ kind: "panel", key: "legend" })} onSelectCard={(key) => selectSurface?.({ kind: "mapLabel", key })} onHideLabel={onHideLabel} onShowLabel={onShowLabel} onFontContextMenu={onFontContextMenu} />
    : null;
  const locatorElement =locator ? <LocatorInset model={model} basemap={basemap} box={locator} /> : null;
  const selectedMapKey = mapLabelKey ?? selectedElementKey;
  const labelHiddenKeys = [...new Set([...(style.hiddenKeys ?? EMPTY_PAGE_KEYS), ...(reportFrame?.hiddenLabelKeys ?? EMPTY_PAGE_KEYS)])];
  const selectedLabelBox = mapLabelKey ? reportFrame?.labelBoxes[mapLabelKey] : undefined;
  const toolbarAnchor: ActionBarPixelBox = selectedLabelBox
    ? { x: selectedLabelBox.x * width, y: selectedLabelBox.y * height, w: selectedLabelBox.w * width, h: selectedLabelBox.h * height }
    : { x: width / 2 - 1, y: 0, w: 2, h: 1 };
  const toolbarPosition = selectionToolbarAnchor ?? (() => {
    const position = placeActionBar(toolbarAnchor, { w: width, h: height });
    return { x: position.left, y: position.top };
  })();
  const toggleSelectedLabel = () => {
    if (!selectedMapKey || !onDirectPatch) return;
    const actualVisible = selectedElementKey === selectedMapKey
      ? labelVisibilityOverride ?? selectedElementLabelVisible
      : undefined;
    const currentVisible = mapLabelSwitchState(selectedMapKey, labelHiddenKeys, actualVisible);
    const next = toggleLabelVisibility(
      effectivePinnedKeys,
      labelHiddenKeys,
      selectedMapKey,
      currentVisible,
    );
    setLabelVisibilityOverride(!currentVisible);
    onDirectPatch({ pinnedKeys: next.pinnedKeys, hiddenKeys: next.hiddenKeys });
  };
  const commitDecorationBox = (key: SurfaceDecorationKey, box: DecorationBox) => {
    if (!onDirectPatch) return;
    const panels = Object.fromEntries(Object.entries(styleRef.current.panels ?? {}).filter(([panelKey]) => panelKey !== key)) as PagePanels;
    panels[key] = panelRectFromMapBox(box, format, unit, frame, panelBasis);
    onDirectPatch({ panels });
  };
  const startDecorationDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!pickable || !onDirectPatch || !selectedDecorationKey) return;
    const box = decorationBoxes[selectedDecorationKey];
    if (!box || event.button !== 0) return;
    decorationTransform.current = { pointerId: event.pointerId, key: selectedDecorationKey, mode: "drag", x: event.clientX, y: event.clientY, box, ratio: Math.max(0.1, (box.x1 - box.x0) / Math.max(1, box.y1 - box.y0)) };
    setDecorationSnapGuides({ x: [], y: [] });
    const captureTarget = event.currentTarget.closest<HTMLElement>("[data-decoration-frame]") ?? event.currentTarget;
    captureTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
    event.preventDefault();
  };
  const resizeDecorationBox = (state: DecorationTransformState, dx: number, dy: number): DecorationBox => {
    const start = state.box;
    const startW = start.x1 - start.x0;
    const startH = start.y1 - start.y0;
    const direction = state.direction!;
    const horizontal = direction.includes("e") ? startW + dx : direction.includes("w") ? startW - dx : startW;
    const vertical = direction.includes("s") ? startH + dy : direction.includes("n") ? startH - dy : startH;
    const targetW = Math.max(24, Math.abs(horizontal) >= Math.abs(vertical * state.ratio) ? horizontal : vertical * state.ratio);
    const targetH = targetW / state.ratio;
    const next = {
      x0: direction.includes("w") ? start.x1 - targetW : start.x0,
      y0: direction.includes("n") ? start.y1 - targetH : start.y0,
      x1: direction.includes("e") ? start.x0 + targetW : start.x1,
      y1: direction.includes("s") ? start.y0 + targetH : start.y1,
    };
    return clampDecorationBox(next, width, height, 32, 24);
  };
  const onDecorationMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = decorationTransform.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    const proposed = state.mode === "drag" ? { x0: state.box.x0 + dx, y0: state.box.y0 + dy, x1: state.box.x1 + dx, y1: state.box.y1 + dy } : resizeDecorationBox(state, dx, dy);
    const next = snapDecorationBox(state.key, proposed, decorationBoxes, width, height);
    setDecorationDraftBox(next.box);
    setDecorationSnapGuides({ x: next.xGuides, y: next.yGuides });
    event.preventDefault();
  };
  const onDecorationEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = decorationTransform.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    const proposed = state.mode === "drag" ? { x0: state.box.x0 + dx, y0: state.box.y0 + dy, x1: state.box.x1 + dx, y1: state.box.y1 + dy } : resizeDecorationBox(state, dx, dy);
    const next = snapDecorationBox(state.key, proposed, decorationBoxes, width, height);
    commitDecorationBox(state.key, next.box);
    decorationTransform.current = null;
    setDecorationDraftBox(null);
    setDecorationSnapGuides({ x: [], y: [] });
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const startDecorationResize = (direction: DecorationResizeDirection, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!pickable || !onDirectPatch || !selectedDecorationKey) return;
    const box = decorationBoxes[selectedDecorationKey];
    if (!box) return;
    decorationTransform.current = { pointerId: event.pointerId, key: selectedDecorationKey, mode: "resize", direction, x: event.clientX, y: event.clientY, box, ratio: Math.max(0.1, (box.x1 - box.x0) / Math.max(1, box.y1 - box.y0)) };
    setDecorationSnapGuides({ x: [], y: [] });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onDecorationResizeMove = (event: ReactPointerEvent<HTMLButtonElement>) => onDecorationMove(event as unknown as ReactPointerEvent<HTMLDivElement>);
  const onDecorationResizeEnd = (event: ReactPointerEvent<HTMLButtonElement>) => onDecorationEnd(event as unknown as ReactPointerEvent<HTMLDivElement>);
  const onDecorationKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!selectedDecorationKey || !onDirectPatch) return;
    const current = decorationBoxes[selectedDecorationKey];
    if (!current || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const stepX = width * 0.01;
    const stepY = height * 0.01;
    let next: DecorationBox = current;
    if (event.shiftKey) {
      const ratio = Math.max(0.1, (current.x1 - current.x0) / Math.max(1, current.y1 - current.y0));
      const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? Math.max(stepX, stepY) : -Math.max(stepX, stepY);
      const nextW = Math.max(32, current.x1 - current.x0 + delta);
      const nextH = nextW / ratio;
      next = clampDecorationBox({ ...current, x1: current.x0 + nextW, y1: current.y0 + nextH }, width, height, 32, 24);
    } else {
      const dx = event.key === "ArrowRight" ? stepX : event.key === "ArrowLeft" ? -stepX : 0;
      const dy = event.key === "ArrowDown" ? stepY : event.key === "ArrowUp" ? -stepY : 0;
      next = clampDecorationBox({ x0: current.x0 + dx, y0: current.y0 + dy, x1: current.x1 + dx, y1: current.y1 + dy }, width, height, 32, 24);
    }
    const snapped = snapDecorationBox(selectedDecorationKey, next, decorationBoxes, width, height);
    event.preventDefault();
    event.stopPropagation();
    setDecorationSnapGuides({ x: snapped.xGuides, y: snapped.yGuides });
    commitDecorationBox(selectedDecorationKey, snapped.box);
  };
  const resetDecoration = (key: SurfaceDecorationKey) => {
    if (!onDirectPatch || !styleRef.current.panels?.[key]) return;
    const panels = Object.fromEntries(Object.entries(styleRef.current.panels).filter(([panelKey]) => panelKey !== key)) as PagePanels;
    onDirectPatch({ panels });
  };
  const decorationKeys = (Object.keys(decorationBoxes) as SurfaceDecorationKey[]);
  const selectedDecorationBox = selectedDecorationKey ? (decorationDraftBox ?? decorationBoxes[selectedDecorationKey]) : undefined;
  const decorationTargets = pickable && onDecorationSelect
    ? decorationKeys.map((key) => {
        const box = decorationBoxes[key];
        if (!box) return null;
        const selected = selectedDecorationKey === key;
        const label = key === "north" ? "방위표" : key === "scaleBar" ? "축척 막대" : "위치도";
        return <button key={key} type="button" className={styles.decorationHitTarget} data-report-decoration={key} data-decoration-selected={selected ? "true" : undefined} data-font-highlight={fontHighlight === (key === "scaleBar" ? "scale" : key) ? "true" : undefined} aria-label={`${label} 선택`} aria-pressed={selected} title={`${label} 선택`} style={{ left: box.x0, top: box.y0, width: Math.max(44, box.x1 - box.x0), height: Math.max(44, box.y1 - box.y0) }} onPointerDown={(event) => { event.stopPropagation(); }} onClick={(event) => { event.stopPropagation(); onDecorationSelect(key); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onFontContextMenu?.({ kind: "decoration", key, ...(contextCell === undefined ? {} : { cell: contextCell }) }, event.clientX, event.clientY, event.currentTarget); }} />;
      })
    : null;
  const decorationLabel = selectedDecorationKey === "north" ? "방위표" : selectedDecorationKey === "scaleBar" ? "축척 막대" : "위치도";
  const decorationTransformFrame = pickable && selectedDecorationKey && selectedDecorationBox
    ? <DecorationTransformFrame label={decorationLabel} box={selectedDecorationBox} bounds={{ w: width, h: height }} onDragStart={startDecorationDrag} onDragMove={onDecorationMove} onDragEnd={onDecorationEnd} onResizeStart={startDecorationResize} onResizeMove={onDecorationResizeMove} onResizeEnd={onDecorationResizeEnd} onKeyDown={onDecorationKeyDown} actions={styleRef.current.panels?.[selectedDecorationKey] ? [{ key: "reset", label: "위치 초기화", onClick: () => resetDecoration(selectedDecorationKey) }] : []} onDelete={() => onDecorationDelete?.(selectedDecorationKey)} onContextMenu={(event) => onFontContextMenu?.({ kind: "decoration", key: selectedDecorationKey, ...(contextCell === undefined ? {} : { cell: contextCell }) }, event.clientX, event.clientY, event.currentTarget)} />
    : null;
  const decorationGuideLayer = decorationTransformFrame && (decorationSnapGuides.x.length > 0 || decorationSnapGuides.y.length > 0)
    ? <div className={styles.decorationSnapGuides ?? styles.snapGuides} aria-hidden="true">
        {decorationSnapGuides.x.map((x) => <span className={styles.snapGuideX} style={{ left: x }} key={`decoration-x-${x}`} />)}
        {decorationSnapGuides.y.map((y) => <span className={styles.snapGuideY} style={{ top: y }} key={`decoration-y-${y}`} />)}
      </div>
    : null;
  const selectionToolbar = pickable && selectedMapKey
    ? <ElementActionBar
        elementLabel={mapLabelKey ? "지도 라벨" : "지도 요소"}
        left={toolbarPosition.x}
        top={toolbarPosition.y}
        actions={[
          ...(mapLabelKey ? [{ key: "auto", label: "자동 배치", onClick: () => onLabelBoxReset?.(mapLabelKey) }] : []),
          { key: "label", label: "라벨", switch: true, ariaPressed: mapLabelSwitchState(selectedMapKey, labelHiddenKeys, selectedElementKey === selectedMapKey ? labelVisibilityOverride ?? selectedElementLabelVisible : undefined), onClick: toggleSelectedLabel },
        ]}
        onDelete={mapLabelKey ? () => onHideLabel?.(mapLabelKey) : selectedElementKey ? () => onDeleteElement?.(selectedElementKey) : undefined}
      />
    : null;
  const openMapContext = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onFontContextMenu) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.target instanceof Element ? event.target : null;
    const labelNode = target?.closest<HTMLElement>("[data-map-label-box], [data-map-label-hit], [data-map-label-key]");
    const labelKey = labelNode?.getAttribute("data-map-label-box") ?? labelNode?.getAttribute("data-map-label-hit") ?? labelNode?.getAttribute("data-map-label-key");
    const featureKey = target?.closest<HTMLElement>("[data-map-feature]")?.getAttribute("data-map-feature");
    const cell = contextCell === undefined ? {} : { cell: contextCell };
    const contextTarget: SurfaceContextTarget = labelKey
      ? { kind: "mapLabel", key: labelKey, ...cell }
      : featureKey
        ? { kind: "mapElement", key: featureKey, ...cell }
        : { kind: "font", key: "labels", ...cell };
    onFontContextMenu(contextTarget, event.clientX, event.clientY, event.currentTarget);
  };
  const mapEnterKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) && onFontContextMenu) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      onFontContextMenu({ kind: "font", key: "labels", ...(contextCell === undefined ? {} : { cell: contextCell }) }, rect.left, rect.bottom + 8, event.currentTarget);
      return;
    }
    if (event.key !== "Enter" || !onMapMoveActive) return;
    event.preventDefault();
    onMapMoveActive(true);
  };
  if (!interactive) return <>
    <div ref={mapInteractionRef} className={styles.slideMap} data-preview-map="true" data-map-pickable={pickable ? "true" : undefined} data-font-highlight={fontHighlight === "labels" ? "true" : undefined} tabIndex={mapEditEntry ? 0 : undefined} aria-label={mapEditEntry ? `${label} 지도. Enter 또는 두 번 눌러 편집합니다.` : undefined} onKeyDown={mapEditEntry ? mapEnterKeyDown : undefined} onContextMenu={openMapContext}>{map}{calloutFixed}{calloutSelection}{locatorElement}{decorationTargets}</div>
    <div className={styles.elementActionLayer ?? styles.mapSelectionToolbar} data-element-action-layer="true">{selectionToolbar}{decorationGuideLayer}{decorationTransformFrame}</div>
  </>;
  const zoomMapAt = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const element = mapInteractionRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const cssWidth = rect.width > 0 ? rect.width : width;
    const cssHeight = rect.height > 0 ? rect.height : height;
    const px = (event.clientX - rect.left) * (width / cssWidth);
    const py = (event.clientY - rect.top) * (height / cssHeight);
    const currentView = {
      zoomDelta: styleRef.current.zoomDelta ?? 0,
      offsetM: styleRef.current.offsetM ?? [0, 0] as [number, number],
    } satisfies MapView;
    const nextView = zoomViewAt(baseViewport, currentView, 0.5, px, py, 3, -3);
    patchRef.current({ zoomDelta: nextView.zoomDelta, offsetM: [nextView.offsetM[0], nextView.offsetM[1]] });
  };
  const mapKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) && onFontContextMenu) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      onFontContextMenu({ kind: "font", key: "labels", ...(contextCell === undefined ? {} : { cell: contextCell }) }, rect.left, rect.bottom + 8, event.currentTarget);
      return;
    }
    if (event.key === "Enter" && onMapMoveActive) {
      event.preventDefault();
      onMapMoveActive(true);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      patchRef.current({ offsetM: [0, 0] });
      return;
    }
    const zoomStep = event.key === "+" || event.key === "=" ? 0.25 : event.key === "-" ? -0.25 : null;
    if (zoomStep !== null) {
      event.preventDefault();
      const currentZoom = styleRef.current.zoomDelta ?? 0;
      patchRef.current({ zoomDelta: clampNumber(currentZoom + zoomStep, -3, 3) });
      return;
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      const offset = styleRef.current.offsetM ?? [0, 0];
      const step = Math.max(1, model.radiusM * 0.02);
      const dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
      const dy = event.key === "ArrowDown" ? -step : event.key === "ArrowUp" ? step : 0;
      event.preventDefault();
      patchRef.current({ offsetM: [offset[0] + dx, offset[1] + dy] });
    }
  };
  return <>
    <div
      ref={mapInteractionRef}
      className={styles.mapInteraction}
      data-preview-map="true"
      data-font-highlight={fontHighlight === "labels" ? "true" : undefined}
      data-dragging={dragging ? "true" : "false"}
      tabIndex={0}
      role="application"
      aria-label={label + " 지도. 드래그하여 이동하고 휠로 확대합니다."}
      onPointerDown={(event) => { startLabelLongPress(event); startPointer(event); }}
      onPointerMove={(event) => { moveLabelLongPress(event); movePointer(event); }}
      onPointerUp={(event) => { clearLabelLongPress(event); endPointer(event); }}
      onPointerCancel={(event) => { clearLabelLongPress(event); endPointer(event); }}
      onKeyDown={mapKeyDown}
      onContextMenu={openMapContext}
      onDoubleClick={zoomMapAt}
      onDragStart={(event) => event.preventDefault()}
    >
      {map}
      {calloutFixed}
      {calloutSelection}
      {locatorElement}
      {decorationTargets}
    </div>
    <div className={styles.elementActionLayer ?? styles.mapSelectionToolbar} data-element-action-layer="true">{selectionToolbar}{decorationGuideLayer}{decorationTransformFrame}</div>
  </>;
}

function SlideFooter({ slide, rect: rectProp, unit, fontHighlight, onFontContextMenu, interactive = false, hidden = false, selected = false, onSelect, onDelete, interaction }: { slide: PlannedSlide; rect?: Rect; unit: number; fontHighlight?: FontTargetKey | null; onFontContextMenu?: SurfaceContextMenuHandler; interactive?: boolean; hidden?: boolean; selected?: boolean; onSelect?: (selection: SurfaceSelection) => void; onDelete?: () => void; interaction?: PanelInteraction }) {
  const styles = useSurfaceStyles();
  const format = (slide.format ?? "wide") as SlideFormat;
  const rect = rectProp ?? slideLayout(format).strip;
  const actionBar = actionBarOffsetForRect(rect, unit, { w: slideSize(format).w * unit, h: slideSize(format).h * unit });
  const footer = fitFooterText(slide.footer, slide.kind === "sheet" || !!slide.map, slideSize(format).w - slideGeometry(format).edge - 1.7, fontSizeForStyle(slide.style, "source"));
  const longPressRef = useRef<{ x: number; y: number; timer: number } | null>(null);
  const clearLongPress = () => {
    if (longPressRef.current) window.clearTimeout(longPressRef.current.timer);
    longPressRef.current = null;
  };
  useEffect(() => clearLongPress, []);
  const openContext = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onFontContextMenu) return;
    event.preventDefault();
    onFontContextMenu({ kind: "element", key: "source" }, event.clientX, event.clientY, event.currentTarget);
  };
  const openLongPress = (event: ReactPointerEvent<HTMLDivElement>) => {
    clearLongPress();
    if (!onFontContextMenu || !interactive || (event.pointerType !== "touch" && event.pointerType !== "pen") || event.button !== 0) return;
    const target = event.currentTarget;
    const x = event.clientX;
    const y = event.clientY;
    const timer = window.setTimeout(() => {
      longPressRef.current = null;
      onFontContextMenu({ kind: "element", key: "source" }, x, y, target);
    }, 500);
    longPressRef.current = { x, y, timer };
  };
  return (
    <div className={styles.slideFooter} style={{ ...rectStyle(rect, unit), right: "auto", bottom: "auto" }} {...interaction} data-source-element="true" data-source-selected={selected ? "true" : undefined} data-font-highlight={fontHighlight === "source" ? "true" : undefined} tabIndex={interactive ? 0 : undefined} onClick={() => interactive && onSelect?.({ kind: "element", key: "source" })} onContextMenu={onFontContextMenu ? openContext : undefined} onKeyDown={interactive && onFontContextMenu ? (event) => {
      if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      onFontContextMenu({ kind: "element", key: "source" }, rect.left, rect.top, event.currentTarget);
    } : undefined} onPointerDown={interaction?.onPointerDown ?? openLongPress} onPointerMove={interaction?.onPointerMove ?? ((event) => {
      const pending = longPressRef.current;
      if (pending && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 8) clearLongPress();
    })} onPointerUp={interaction?.onPointerUp ?? clearLongPress} onPointerCancel={interaction?.onPointerCancel ?? clearLongPress}>
      {!hidden && <span className={styles.slideFooterText} style={fontStyle(footer.fontSize, unit)}>{footer.text}</span>}
      <span className={styles.slideFooterPage}>{slide.no} / {slide.total}</span>
      {selected && interactive && !interaction && <ElementActionBar elementLabel="출처 줄" left={actionBar.left} top={actionBar.top} onDelete={onDelete} />}
    </div>
  );
}

function ReportTitlePanel({ color, title, kind, rect, unit, style = {}, interaction }: { color: string; title: string; kind: string; rect: Rect; unit: number; style?: PageStyle; interaction?: PanelInteraction }) {
  const styles = useSurfaceStyles();
  const titleBox = { w: Math.max(0.2, rect.w - 0.58), h: Math.max(0.16, rect.h - 0.08) };
  const titleMaxPt = fontSizeForStyle(style, "title");
  const titlePt = fitBlock([title], titleBox, titleMaxPt, 7);
  const metaPt = fitBlock([kind], titleBox, 10 * (titleMaxPt / DEFAULT_REPORT_FONT_SIZES.title), 7);
  return (
    <div className={styles.slidePanel + " " + styles.titlePanel} style={rectStyle(rect, unit)} {...interaction}>
      <span className={styles.titleDot} style={{ background: color }} aria-hidden="true" />
      <h3 className={styles.slideTitle} style={fontStyle(titlePt, unit)}>{title}</h3>
      {kind && <span className={styles.slideKind} style={fontStyle(metaPt, unit)}>{kind}</span>}
    </div>
  );
}

function TitlePanel({ slide, rect, unit, interaction, onText }: { slide: Extract<PlannedSlide, { kind: "tile" }>; rect: Rect; unit: number; interaction?: PanelInteraction; onText?: () => void }) {
  const calloutTail = slide.callout ? calloutPageTitleTail(slide.callout.model.complexes, slide.callout.page, slide.callout.model.unit, slide.callout.shownKeys, slide.callout.numberStart ?? 1) : null;
  const kind = [slide.view.kindLabel, calloutTail].filter((value): value is string => Boolean(value)).join(" · ");
  return <ReportTitlePanel color={slide.view.color} title={slide.page?.titleOverride ?? slide.view.title} kind={kind} rect={rect} unit={unit} style={slide.style} interaction={interaction} />;
}

function SummaryPanel({ slide, rect, unit, terrainSectionShown = false, interaction, onText }: { slide: Extract<PlannedSlide, { kind: "tile" }>; rect: Rect; unit: number; terrainSectionShown?: boolean; interaction?: PanelInteraction; onText?: () => void }) {
  const styles = useSurfaceStyles();
  const view = slide.view;
  const summaryPt = fontSizeForStyle(slide.style, "summary");
  const summaryScale = summaryPt / DEFAULT_REPORT_FONT_SIZES.summary;
  const innerW = Math.max(0.2, rect.w - 0.44);
  const children: React.ReactNode[] = [];
  if (view.headline) {
    const valuePt = fitBlock([view.headline.value], { w: innerW, h: 0.66 * summaryScale }, 36 * summaryScale, 7);
    const labelPt = fitBlock([view.headline.label], { w: innerW, h: 0.24 * summaryScale }, 11 * summaryScale, 7);
    children.push(
      <div className={styles.summaryLineFull} key="headline">
        <div className={styles.slideMetricLabel} style={fontStyle(labelPt, unit)}>{view.headline.label}</div>
        <div className={styles.slideMetricValue} style={fontStyle(valuePt, unit, { textAlign: "left" })}>{view.headline.value}</div>
      </div>,
    );
  }
  const sentence = slide.page?.summaryOverride ?? view.sentence;
  if (sentence) {
    const pt = fitBlock([sentence], { w: innerW, h: 0.66 }, summaryPt, 7);
    children.push(<div className={styles.summaryLineFull} key="sentence"><div className={styles.slideText + " " + styles.slideTextStrong} style={fontStyle(pt, unit)}>{sentence}</div></div>);
  }
  if (view.filterLine) {
    const pt = fitBlock([view.filterLine], { w: innerW, h: 0.4 * summaryScale }, 10 * summaryScale, 7);
    children.push(<div className={styles.summaryLineFull} key="filter"><div className={styles.slideText} style={fontStyle(pt, unit)}>{view.filterLine}</div></div>);
  }
  if (slide.body.face === "single") {
    view.rows.slice(0, 5).forEach((row, index) => {
      const value = [row.value, row.aux, row.tag].filter(Boolean).join(" · ");
      const labelPt = fitBlock([row.label], { w: innerW * 0.55, h: 0.28 * summaryScale }, 11 * summaryScale, 7);
      const valuePt = fitBlock([value], { w: innerW * 0.45, h: 0.28 * summaryScale }, 11 * summaryScale, 7);
      children.push(
        <div className={styles.summaryLine} key={"row-" + index}>
          <span className={styles.slideMetricLabel} style={fontStyle(labelPt, unit)}>{row.label}</span>
          <span className={styles.slideMetricValue} style={fontStyle(valuePt, unit)}>{value}</span>
        </div>,
      );
    });
  }
  const notes = reportSummaryNotes(view, terrainSectionShown);
  notes.forEach((note, index) => {
    const pt = fitBlock([note], { w: innerW, h: 0.44 * summaryScale }, 9 * summaryScale, 7);
    children.push(<div className={styles.summaryLineFull} key={"note-" + index}><div className={styles.slideText} style={fontStyle(pt, unit)}>{note}</div></div>);
  });
  return <div className={styles.slidePanel + " " + styles.summaryPanel} style={rectStyle(rect, unit)} {...interaction}>
    {children}
  </div>;
}

function LegendPanel({ slide, rect, unit, format = (slide.format ?? "wide") as SlideFormat, hoverLabel, onLegendHover, onLegendPin, onLegendMenu, interaction, legendOptions }: { slide: Extract<PlannedSlide, { kind: "tile" }>; rect: Rect; unit: number; format?: SlideFormat; hoverLabel?: string | null; onLegendHover?: (label: string | null) => void; onLegendPin?: (label: string) => void; onLegendMenu?: (x: number, y: number, opener: HTMLElement) => void; interaction?: PanelInteraction; legendOptions?: MapFrameState["legend"] }) {
  const styles = useSurfaceStyles();
  if (!slide.map) return null;
  const legend = slideLegend(slide.map, !slide.muted, undefined, true, format, legendOptions);
  const focus = legendLabelOf(slide.map, slide.style.legendFocus);
  const legendKeys = new Map(legendItemsOf(slide.map).map((entry) => [entry.label, entry.key]));
  const activeLabel = hoverLabel ?? focus;
  const legendScale = slidePanelScale(slide.style.legendScale);
  const legendPt = fontSizeForStyle(slide.style, "legend");
  const legendGeometry = slideLegendGeometry(rect, legendScale);
  const legendPanelStyle = {
    ...rectStyle(rect, unit),
    "--legend-pad": String(legendGeometry.padding),
    "--legend-icon-column": String(legendGeometry.iconColumn),
    "--legend-gap": String(legendGeometry.gap),
    "--legend-row": String(SLIDE_LEGEND.row * legendScale),
    "--legend-note": String(SLIDE_LEGEND.note * legendScale),
  } as CSSProperties;
  return (
    <div className={styles.slidePanel + " " + styles.legendPanel} data-report-panel="legend" style={legendPanelStyle} {...interaction}>
      {legend.items.map((item, index) => {
        const focused = !item.site && focus !== null && item.label === focus;
        const hovered = !item.site && hoverLabel !== null && hoverLabel !== undefined && item.label === hoverLabel;
        const dimmed = activeLabel !== null && activeLabel !== undefined && !item.site && !focused && !hovered;
        const pt = fitBlock([item.label], { w: Math.max(0.2, legendGeometry.labelW), h: SLIDE_LEGEND.row * legendScale }, legendPt, 7);
        const key = legendKeys.get(item.label) ?? item.label;
        const instruction = focused ? "강조 해제" : "눌러서 강조";
        const rowClass = styles.legendRow + (focused || hovered ? " " + styles.legendRowActive : "");
        if (item.site) return (
          <div className={styles.legendRow} key={item.label + "-" + index}>
            <span className={styles.legendSwatchSite} aria-hidden="true" />
            <span className={styles.legendText} style={fontStyle(pt, unit)}>{item.label}</span>
          </div>
        );
        // 썸네일(버튼 안)처럼 조작할 수 없는 범례는 button을 중첩하지 않는다.
        const swatch = item.lineSwatch || item.legendSwatch
          ? <LegendSwatch item={item} />
          : <span className={styles.legendSwatch} style={{ background: item.color }} aria-hidden="true" />;
        if (!onLegendPin) return (
          <div className={styles.legendRow} key={key + "-" + index}>
            {swatch}
            <span className={styles.legendText} style={fontStyle(pt, unit)}>{item.label}</span>
          </div>
        );
          return (
          <button key={key + "-" + index} type="button" className={rowClass} data-panel-action="legend-item" data-preview-legend={item.label} aria-label={`${item.label} 범례 강조`} aria-pressed={focused} title={instruction} onClick={() => onLegendPin?.(key)} onPointerEnter={(event) => { if (event.pointerType !== "touch") onLegendHover?.(item.label); }} onPointerLeave={() => onLegendHover?.(null)} onFocus={() => onLegendHover?.(item.label)} onBlur={() => onLegendHover?.(null)}>
            {swatch}
            <span className={styles.legendText + (dimmed ? " " + styles.legendDimmed : "") + (focused ? " " + styles.legendFocused : "")} style={fontStyle(pt, unit)}>{item.label}</span>
            {focused && <span className={styles.legendCheck} aria-hidden="true">✓</span>}
          </button>
        );
      })}
      {legend.notes.map((note, index) => {
        const pt = fitBlock([note], { w: Math.max(0.2, legendGeometry.noteW), h: SLIDE_LEGEND.note * legendScale }, 8.5 * legendScale, 7);
        return <div className={styles.legendNote} style={fontStyle(pt, unit)} key={"note-" + index}>{note}</div>;
      })}
      {onLegendMenu && <button type="button" className={styles.legendMenuButton} aria-label="범례 메뉴" title="범례 메뉴" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); onLegendMenu(rect.right - 8, rect.bottom + 8, event.currentTarget); }}>⋯</button>}
    </div>
  );
}

function ChartPlaceholder({ view, unit }: { view: TileView; unit: number }) {
  const styles = useSurfaceStyles();
  const chart = view.chart ?? [];
  const max = Math.max(1, ...chart.map((entry) => entry.value));
  return (
    <div className={styles.chartPlaceholder}>
      {chart.map((entry, index) => (
        <div className={styles.chartRow} key={entry.label + "-" + index}>
          <span className={styles.slideText} style={fontStyle(9, unit)}>{entry.label}</span>
          <span className={styles.chartTrack}><span className={styles.chartFill} style={{ width: String((entry.value / max) * 100) + "%" }} /></span>
          <span className={styles.chartValue} style={fontStyle(9, unit)}>{String(entry.value) + (entry.unit === "%" ? "%" : " " + entry.unit)}</span>
        </div>
      ))}
    </div>
  );
}

const TERRAIN_CAVEAT = "보간값(추정) · 현장 실측 아님";

function TerrainSectionPreview({ slide, unit, layout }: { slide: Extract<PlannedSlide, { kind: "tile" }>; unit: number; layout: TerrainSectionLayout | null }) {
  const styles = useSurfaceStyles();
  const sections = slide.view.terrainSections;
  if (!sections || !slide.terrainSection) return null;
  if (!layout) return null;
  const section = sections[slide.terrainSection];
  const valid = section.samples.filter((sample): sample is { d: number; z: number } => sample.z !== null && Number.isFinite(sample.z));
  const total = terrainSectionTotal(section);
  const minZ = valid.length > 0 ? Math.min(...valid.map((sample) => sample.z)) : 0;
  const maxZ = valid.length > 0 ? Math.max(...valid.map((sample) => sample.z)) : 1;
  const zRange = Math.max(1, maxZ - minZ);
  const xFor = (d: number) => 52 + (d / total) * 656;
  const yFor = (z: number) => 212 - ((z - minZ) / zRange) * 184;
  const paths: string[] = [];
  let path: string[] = [];
  for (const sample of section.samples) {
    if (sample.z === null) {
      if (path.length > 0) paths.push(path.join(" "));
      path = [];
      continue;
    }
    path.push(`${path.length === 0 ? "M" : "L"}${xFor(sample.d).toFixed(2)},${yFor(sample.z).toFixed(2)}`);
  }
  if (path.length > 0) paths.push(path.join(" "));
  const [siteStart, siteEnd] = section.siteSpan;
  const axisStops = terrainSectionAxisStops(section);
  const siteValues = valid.filter((sample) => sample.d >= siteStart && sample.d <= siteEnd).map((sample) => sample.z);
  const range = siteValues.length > 1 ? Math.max(...siteValues) - Math.min(...siteValues) : null;
  const stepRow = slide.view.rows.find((row) => row.label === "반경 안 단차 시설 수");
  const parsedFacilityCount = stepRow ? Number.parseInt(stepRow.value.replace(/[^0-9-]/g, ""), 10) : NaN;
  const facilityCount = Number.isFinite(parsedFacilityCount) ? parsedFacilityCount : section.crossings.length;
  const slopeSamples: number[] = [];
  for (let index = 1; index < section.samples.length; index += 1) {
    const before = section.samples[index - 1];
    const current = section.samples[index];
    if (before.z === null || current.z === null || before.d > siteEnd || current.d < siteStart) continue;
    slopeSamples.push(Math.atan(Math.abs(current.z - before.z) / (current.d - before.d)) * 180 / Math.PI);
  }
  const slope = slopeSamples.length > 0 ? slopeSamples.reduce((sum, value) => sum + value, 0) / slopeSamples.length : null;
  const format = (value: number | null, suffix: string) => value === null ? "미확인" : `${value.toFixed(1)}${suffix}`;
  const crossings = sortTerrainCrossings(section);
  const visibleCrossings = crossings.slice(0, TERRAIN_SECTION_TABLE_MAX_ROWS);
  const preview = layout.rect;
  const bands = terrainSectionBands({ x: 0, y: 0, w: preview.w, h: preview.h });
  const terrainGridStyle: CSSProperties = {
    gridTemplateColumns: `${bands.plot.w * unit}px ${bands.table.w * unit}px`,
    gridTemplateRows: `${bands.header.h * unit}px ${bands.table.h * unit}px ${bands.footer.h * unit}px`,
    columnGap: `${bands.gapX * unit}px`,
    rowGap: `${bands.gapY * unit}px`,
    padding: `${bands.paddingTop * unit}px ${bands.paddingX * unit}px ${bands.paddingBottom * unit}px`,
  };
  const graphStyle: CSSProperties = {
    gridTemplateRows: `${bands.plot.h * unit}px ${bands.axis.h * unit}px`,
    rowGap: `${bands.gapY * unit}px`,
  };
  return (
    <section className={styles.terrainPreview} style={{ ...terrainGridStyle, left: preview.x * unit, top: preview.y * unit, width: preview.w * unit, height: preview.h * unit }} aria-label={`${TERRAIN_SECTION_LABELS[slide.terrainSection]} 보고서 미리보기`}>
      <div className={styles.terrainPreviewHeader}>
        <strong style={fontStyle(9.5, unit)}>{TERRAIN_SECTION_LABELS[slide.terrainSection]} · 지형 단면</strong>
        <span style={fontStyle(7.5, unit)}>대지 음영 · 단차 시설 표식</span>
      </div>
      <div className={styles.terrainPreviewGraphShell}>
        <div className={styles.terrainPreviewYAxis} aria-hidden="true">
          <span style={fontStyle(8.5, unit)}>{terrainElevationLabel(maxZ)}</span>
          <span style={fontStyle(8.5, unit)}>{terrainElevationLabel(minZ)}</span>
        </div>
        <div className={styles.terrainPreviewGraphMain} style={graphStyle}>
          <svg className={styles.terrainPreviewGraph} viewBox="0 0 760 240" preserveAspectRatio="none" role="img" aria-label={`${TERRAIN_SECTION_LABELS[slide.terrainSection]} 표고 프로파일`}>
            <title>{`${TERRAIN_SECTION_LABELS[slide.terrainSection]} 표고 프로파일`}</title>
            <rect x={xFor(siteStart)} y="28" width={Math.max(0, xFor(siteEnd) - xFor(siteStart))} height="184" fill="#2350b8" fillOpacity=".09" />
            <line x1="52" x2="708" y1="212" y2="212" stroke="#b9c0ca" strokeWidth="1" />
            {paths.map((entry, index) => <path key={index} d={entry} fill="none" stroke="#8a5a2e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
            {crossings.map((crossing, index) => {
              const style = layerStyle(terrainCrossingLayer(crossing.kind));
              const x = xFor(crossing.d);
              const elevation = terrainSectionElevationAt(section, crossing.d);
              const marker = elevation === null ? null : terrainSectionMarkerGeometry(x, yFor(elevation));
              return <g key={`${crossing.d}-${crossing.kind}-${index}`}>
                {marker && <>
                  <line x1={marker.x} x2={marker.x} y1={marker.y1} y2={marker.y2} stroke="#fff" strokeWidth={Math.max(3, (style.strokeWidth ?? 1.5) + 2)} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  <line x1={marker.x} x2={marker.x} y1={marker.y1} y2={marker.y2} stroke={style.color} strokeWidth={Math.max(1.5, style.strokeWidth ?? 1.5)} strokeDasharray={style.dash} strokeLinecap={style.lineCap ?? "butt"} vectorEffect="non-scaling-stroke" />
                </>}
              </g>;
            })}
          </svg>
          <div className={styles.terrainPreviewXAxis} aria-hidden="true">
            <span style={fontStyle(8.5, unit)}>{axisStops[0]}</span>
            <span style={fontStyle(8.5, unit)}>{axisStops[1]}</span>
            <span style={fontStyle(8.5, unit)}>{axisStops[2]}</span>
          </div>
        </div>
      </div>
      <table className={styles.terrainPreviewTable} aria-label="단면 시설 표">
        <caption className={styles.srOnly}>단면 시설 표</caption>
        <tbody>
          {visibleCrossings.map((crossing, index) => <tr key={`${crossing.d}-${crossing.kind}-${index}`}><td>{TERRAIN_CROSSING_LABELS[crossing.kind]}</td><td className={styles.terrainPosition}>{terrainSectionPosition(section, crossing.d)}</td><td>{crossing.heightM === null ? "높이 미확인" : `${crossing.heightM.toFixed(1)}m`}</td></tr>)}
          {crossings.length > visibleCrossings.length && <tr><td colSpan={3}>{`외 ${crossings.length - visibleCrossings.length}건`}</td></tr>}
          <tr className={styles.terrainPreviewCaveat}><td colSpan={3} style={fontStyle(7, unit)}>{TERRAIN_CAVEAT}</td></tr>
        </tbody>
      </table>
      <div className={styles.terrainPreviewSummary} style={fontStyle(7.4, unit)}>{`대지 고저차 ${format(range, "m")} · 대지 평균 경사 ${format(slope, "°")} · 반경 내 단차 시설 수 ${facilityCount}개`}</div>
    </section>
  );
}

function VisualPlaceholder({ title, message, unit }: { title: string; message: string; unit: number }) {
  const styles = useSurfaceStyles();
  return (
    <div className={styles.chartPlaceholder}>
      <strong className={styles.slideTitle} style={fontStyle(18, unit)}>{title}</strong>
      <span className={styles.slideText} style={fontStyle(11, unit)}>{message}</span>
    </div>
  );
}

function BlankSurface({ unit }: { unit: number }) {
  const styles = useSurfaceStyles();
  return <div className={styles.blankSurface ?? styles.chartPlaceholder} style={{ padding: unit * 0.45 }}><span className={styles.slideText} style={fontStyle(12, unit)}>빈 페이지</span></div>;
}

type TextBoxSurfaceProps = {
  boxes: readonly TextBox[];
  unit: number;
  selectedId?: string;
  startEditingId?: string | null;
  maxWidth: number;
  maxHeight: number;
  editable?: boolean;
  onSelect?: (selection: SurfaceSelection) => void;
  onTextBox?: (box: TextBox | { id: string; remove: true }) => void;
  onEditingChange?: (id: string | null) => void;
  onContextMenu?: SurfaceContextMenuHandler;
};

const TEXT_BOX_HANDLE_DIRECTIONS: readonly { direction: ResizeDirection; label: string }[] = [
  { direction: "nw", label: "왼쪽 위" },
  { direction: "n", label: "위" },
  { direction: "ne", label: "오른쪽 위" },
  { direction: "e", label: "오른쪽" },
  { direction: "se", label: "오른쪽 아래" },
  { direction: "s", label: "아래" },
  { direction: "sw", label: "왼쪽 아래" },
  { direction: "w", label: "왼쪽" },
];

function TextBoxGripIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>;
}

function TextBoxSizeIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 19 8 6l5 13M5 14.5h6" /><path d="m14.5 19 3.5-8 3.5 8M15.6 16.5h4.8" /></svg>;
}

function TextBoxTrashIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" /></svg>;
}

function TextBoxAlignIcon({ center = false }: { center?: boolean }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16" /><path d={center ? "M7 12h10" : "M4 12h10"} /><path d={center ? "M5 18h14" : "M4 18h14"} /></svg>;
}

function TextBoxSurface({ boxes, unit, selectedId, startEditingId, maxWidth, maxHeight, editable = false, onSelect, onTextBox, onEditingChange, onContextMenu }: TextBoxSurfaceProps) {
  const styles = useSurfaceStyles();
  const [draft, setDraft] = useState<{ mode: "move" | "resize"; direction?: ResizeDirection; pointerId: number; startX: number; startY: number; box: TextBox } | null>(null);
  const [draftBox, setDraftBox] = useState<TextBox | null>(null);
  const [internalEditingId, setInternalEditingId] = useState<string | null>(null);
  const [colorOpenId, setColorOpenId] = useState<string | null>(null);
  const boxRefs = useRef(new Map<string, HTMLDivElement>());
  const editingId = startEditingId !== undefined ? startEditingId : internalEditingId;

  useEffect(() => {
    if (!selectedId && editingId) {
      setInternalEditingId(null);
      onEditingChange?.(null);
    }
  }, [editingId, onEditingChange, selectedId]);

  // 글 칸은 편집 상태로 그려진 뒤에야 포커스를 받을 수 있다.
  useEffect(() => {
    if (!editingId) return;
    const frame = window.requestAnimationFrame(() => {
      const text = boxRefs.current.get(editingId)?.querySelector<HTMLElement>("[data-text-box-content]");
      if (!text || document.activeElement === text) return;
      text.focus();
      const range = document.createRange();
      range.selectNodeContents(text);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingId]);

  const setEditing = (id: string | null) => {
    setInternalEditingId(id);
    setColorOpenId(null);
    onEditingChange?.(id);
  };

  const commitText = (id: string | null) => {
    if (!id) return;
    const box = boxes.find((candidate) => candidate.id === id);
    const text = boxRefs.current.get(id)?.querySelector<HTMLElement>("[data-text-box-content]")?.textContent ?? box?.text ?? "";
    if (box && text !== box.text) onTextBox?.({ ...box, text });
    setEditing(null);
  };

  useEffect(() => {
    if (!editingId) return;
    const onOutsidePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (boxRefs.current.get(editingId)?.contains(event.target)) return;
      commitText(editingId);
    };
    document.addEventListener("pointerdown", onOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", onOutsidePointerDown, true);
  }, [editingId, boxes]);

  const beginEditing = (id: string) => {
    if (!editable) return;
    onSelect?.({ kind: "textBox", id });
    setEditing(id);
  };

  const updateDraft = (event: ReactPointerEvent<HTMLElement>) => {
    if (!draft || draft.pointerId !== event.pointerId) return;
    const dx = (event.clientX - draft.startX) / Math.max(1, unit);
    const dy = (event.clientY - draft.startY) / Math.max(1, unit);
    let next = draft.mode === "move"
      ? { ...draft.box, x: draft.box.x + dx, y: draft.box.y + dy }
      : { ...draft.box };
    if (draft.mode === "resize" && draft.direction) {
      const direction = draft.direction;
      if (direction.includes("e")) next.w += dx;
      if (direction.includes("w")) { next.x += dx; next.w -= dx; }
      if (direction.includes("s")) next.h += dy;
      if (direction.includes("n")) { next.y += dy; next.h -= dy; }
    }
    next = clampTextBox(next, maxWidth, maxHeight);
    setDraftBox(next);
    event.preventDefault();
  };
  const endDraft = (event: ReactPointerEvent<HTMLElement>) => {
    if (!draft || draft.pointerId !== event.pointerId) return;
    onTextBox?.(draftBox ?? draft.box);
    setDraft(null);
    setDraftBox(null);
    const root = event.currentTarget.closest<HTMLElement>("[data-text-box]");
    if (root?.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
  };
  const beginDraft = (mode: "move" | "resize", box: TextBox, event: ReactPointerEvent<HTMLElement>, direction?: ResizeDirection) => {
    if (!editable || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setEditing(null);
    setDraft({ mode, direction, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, box });
    setDraftBox(box);
    const root = event.currentTarget.closest<HTMLElement>("[data-text-box]");
    root?.setPointerCapture(event.pointerId);
  };
  const updateBox = (box: TextBox, patch: Partial<TextBox>) => {
    const liveText = boxRefs.current.get(box.id)?.querySelector<HTMLElement>("[data-text-box-content]")?.textContent;
    onTextBox?.({ ...box, ...(liveText !== undefined ? { text: liveText } : {}), ...patch });
  };

  return <>{boxes.map((box) => {
    const selected = selectedId === box.id;
    const editing = editable && editingId === box.id;
    const visibleBox = draftBox?.id === box.id ? draftBox : box;
    const kind = box.kind ?? "body";
    const defaults = TEXT_BOX_DEFAULTS[kind];
    const color = box.color ?? defaults.color;
    const bold = box.bold ?? defaults.bold;
    const italic = box.italic ?? defaults.italic;
    const align = box.align ?? defaults.align;
    const actionBar = actionBarOffsetForRect(visibleBox, unit, { w: maxWidth * unit, h: maxHeight * unit });
    const removeBox = () => { onTextBox?.({ id: box.id, remove: true }); setEditing(null); onSelect?.(null); };
    return <div
      key={box.id}
      className={styles.textBox ?? styles.slidePanel}
      data-text-box={box.id}
      ref={(element) => {
        if (element) boxRefs.current.set(box.id, element);
        else boxRefs.current.delete(box.id);
      }}
      tabIndex={selected ? 0 : -1}
      style={{ position: "absolute", left: visibleBox.x * unit, top: visibleBox.y * unit, width: visibleBox.w * unit, height: visibleBox.h * unit, color, background: selected ? "rgba(255,255,255,.94)" : "transparent", fontSize: (visibleBox.pt / 72) * unit, fontWeight: bold ? 700 : 400, fontStyle: italic ? "italic" : "normal", textAlign: align, lineHeight: 1.25, whiteSpace: "pre-wrap", overflow: "visible", border: selected ? `${editing ? 2 : 1.5}px solid #2f6fdb` : "1px solid transparent", boxShadow: editing ? "0 0 0 4px rgba(47,111,219,.16)" : undefined, cursor: editing ? "text" : "move" }}
      onPointerDown={(event) => {
        if (!editable || (event.target as HTMLElement).closest("button")) return;
        if (!selected) {
          event.currentTarget.focus({ preventScroll: true });
          setEditing(null);
          onSelect?.({ kind: "textBox", id: box.id });
          return;
        }
        if (editing) return;
        beginDraft("move", visibleBox, event);
      }}
      onPointerMove={updateDraft}
      onPointerUp={endDraft}
      onPointerCancel={endDraft}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button") || !editable) return;
        if (!selected) onSelect?.({ kind: "textBox", id: box.id });
      }}
      onDoubleClick={() => { if (editable) beginEditing(box.id); }}
      onContextMenu={(event) => { if (!editable || (event.target as HTMLElement).closest("button")) return; event.preventDefault(); event.stopPropagation(); onContextMenu?.({ kind: "textBox", id: box.id }, event.clientX, event.clientY, event.currentTarget); }}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        if (editing) commitText(box.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && editing) {
          event.preventDefault();
          event.stopPropagation();
          commitText(box.id);
          return;
        }
        if ((event.key === "Delete" || event.key === "Backspace") && selected && !editing) {
          event.preventDefault();
          onTextBox?.({ id: box.id, remove: true });
          onSelect?.(null);
          return;
        }
        if (event.key === "Enter" && selected && !editing) {
          event.preventDefault();
          beginEditing(box.id);
          return;
        }
        if (selected && !editing && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault();
          const dx = event.key === "ArrowRight" ? 0.08 : event.key === "ArrowLeft" ? -0.08 : 0;
          const dy = event.key === "ArrowDown" ? 0.08 : event.key === "ArrowUp" ? -0.08 : 0;
          onTextBox?.(clampTextBox({ ...box, x: box.x + dx, y: box.y + dy }, maxWidth, maxHeight));
        }
      }}
    >
      <div data-text-box-content contentEditable={editing} suppressContentEditableWarning style={{ position: "absolute", inset: 0, padding: 0.08 * unit, overflow: "hidden", outline: "none" }} onInput={() => undefined}>{visibleBox.text}</div>
      {selected && editable && !editing && <ElementActionBar elementLabel="글상자" left={actionBar.left} top={actionBar.top} actions={[{ key: "edit", label: "고치기", onClick: () => beginEditing(box.id) }]} onDelete={removeBox} />}
      {selected && editable && editing && <div className={styles.textBoxToolbar} role="toolbar" aria-label="글상자 서식">
        <button type="button" className={styles.textBoxToolbarButton} aria-label="글자 작게" onPointerDown={(event) => event.stopPropagation()} onClick={() => updateBox(box, { pt: Math.max(7, (box.pt ?? 14) - 1) })}>−</button>
        <output className={styles.textBoxFontValue}>{box.pt}pt</output>
        <button type="button" className={styles.textBoxToolbarButton} aria-label="글자 크게" onPointerDown={(event) => event.stopPropagation()} onClick={() => updateBox(box, { pt: Math.min(72, (box.pt ?? 14) + 1) })}>+</button>
        <span className={styles.textBoxToolbarSeparator} aria-hidden="true" />
        <button type="button" className={`${styles.textBoxToolbarButton} ${bold ? styles.textBoxToolbarButtonActive : ""}`} aria-label="굵게" aria-pressed={bold} onPointerDown={(event) => event.stopPropagation()} onClick={() => updateBox(box, { bold: !bold })}>B</button>
        <button type="button" className={`${styles.textBoxToolbarButton} ${styles.textBoxItalicButton} ${italic ? styles.textBoxToolbarButtonActive : ""}`} aria-label="기울임" aria-pressed={italic} onPointerDown={(event) => event.stopPropagation()} onClick={() => updateBox(box, { italic: !italic })}>I</button>
        <span className={styles.textBoxColorControl}>
          <button type="button" className={styles.textBoxToolbarButton} aria-label="글자 색" aria-expanded={colorOpenId === box.id} onPointerDown={(event) => event.stopPropagation()} onClick={() => setColorOpenId((current) => current === box.id ? null : box.id)}><span aria-hidden="true">가</span><i className={styles.textBoxColorMark} style={{ background: color }} /></button>
          {colorOpenId === box.id && <span className={styles.textBoxColorMenu} role="listbox" aria-label="글자 색 견본">{TEXT_BOX_COLORS.map((swatch) => <button key={swatch} type="button" className={styles.textBoxColorSwatch} style={{ background: swatch }} aria-label={swatch} aria-selected={color === swatch} onPointerDown={(event) => event.stopPropagation()} onClick={() => { updateBox(box, { color: swatch as TextBoxColor }); setColorOpenId(null); }} />)}</span>}
        </span>
        <span className={styles.textBoxToolbarSeparator} aria-hidden="true" />
        <button type="button" className={`${styles.textBoxToolbarButton} ${align === "left" ? styles.textBoxToolbarButtonActive : ""}`} aria-label="왼쪽 정렬" aria-pressed={align === "left"} onPointerDown={(event) => event.stopPropagation()} onClick={() => updateBox(box, { align: "left" })}><TextBoxAlignIcon /></button>
        <button type="button" className={`${styles.textBoxToolbarButton} ${align === "center" ? styles.textBoxToolbarButtonActive : ""}`} aria-label="가운데 정렬" aria-pressed={align === "center"} onPointerDown={(event) => event.stopPropagation()} onClick={() => updateBox(box, { align: "center" })}><TextBoxAlignIcon center /></button>
        <span className={styles.textBoxToolbarSeparator} aria-hidden="true" />
      </div>}
      {selected && editable && editing && <ElementActionBar elementLabel="글상자" left={actionBar.left} top={actionBar.top} actions={[{ key: "done", label: "완료", onClick: () => commitText(box.id) }]} onDelete={removeBox} />}
      {selected && editable && !editing && TEXT_BOX_HANDLE_DIRECTIONS.map(({ direction, label }) => <button key={direction} type="button" className={`${styles.textBoxHandle} ${styles[`textBoxHandle${direction.toUpperCase()}`]}`} data-resize-handle={direction} aria-label={`${label} 글상자 크기 조절`} onPointerDown={(event) => beginDraft("resize", visibleBox, event, direction)} />)}
    </div>;
  })}</>;
}

type TextBoxPlacement = { kind: TextBoxKind; x: number; y: number };

function TextBoxPlacementLayer({ placement, unit, maxWidth, maxHeight, onMove, onCommit }: { placement: TextBoxPlacement; unit: number; maxWidth: number; maxHeight: number; onMove: (x: number, y: number) => void; onCommit: (x: number, y: number) => void }) {
  const styles = useSurfaceStyles();
  const layerRef = useRef<HTMLDivElement>(null);
  const positionForEvent = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = layerRef.current?.getBoundingClientRect();
    if (!rect) return { x: placement.x, y: placement.y };
    const defaults = TEXT_BOX_DEFAULTS[placement.kind];
    const x = (event.clientX - rect.left) / Math.max(1, unit) - defaults.w / 2;
    const y = (event.clientY - rect.top) / Math.max(1, unit) - defaults.h / 2;
    const next = clampTextBox(textBoxDefaults(placement.kind, "preview", x, y), maxWidth, maxHeight);
    return { x: next.x, y: next.y };
  };
  const preview = clampTextBox(textBoxDefaults(placement.kind, "preview", placement.x, placement.y), maxWidth, maxHeight);
  return <div ref={layerRef} className={styles.textBoxPlacementLayer} data-text-box-placement="true" onPointerMove={(event) => { const next = positionForEvent(event); onMove(next.x, next.y); }} onPointerDown={(event) => { event.preventDefault(); const next = positionForEvent(event); onCommit(next.x, next.y); }}>
    <div className={styles.textBoxPlacementPreview} style={{ left: preview.x * unit, top: preview.y * unit, width: preview.w * unit, height: preview.h * unit, fontSize: (preview.pt / 72) * unit, fontWeight: preview.bold ? 700 : 400, color: preview.color }}><span>{preview.kind === "title" ? "제목" : preview.kind === "note" ? "주석·출처" : "본문 글"}</span></div>
  </div>;
}

function CoverSurface({ slide, unit, basemap, interactive, thumbnail = false, onPatch, onDirectPatch, fontHighlight, onFontContextMenu }: { slide: Extract<PlannedSlide, { kind: "cover" }>; unit: number; basemap: BasemapChoice; interactive: boolean; thumbnail?: boolean; onPatch: (patch: PreviewStylePatch) => void; onDirectPatch?: (patch: PreviewStylePatch) => void; fontHighlight?: FontTargetKey | null; onFontContextMenu?: SurfaceContextMenuHandler }) {
  const format = (slide.format ?? "wide") as SlideFormat;
  const styles = useSurfaceStyles();
  const map = slide.map;
  const layout = coverLayout({ address: slide.address, metricCount: slide.metrics.length, lineCount: slide.lines.length, incomplete: !!slide.incomplete }, format);
  const mapPanels = { title: layout.left, summary: layout.right, legend: null };
  return (
    <>
      {map && <MapLayer model={map} style={slide.style} unit={unit} basemap={basemap} panels={mapPanels} siteX={0.5} interactive={interactive} thumbnail={thumbnail} onPatch={onPatch} onDirectPatch={onDirectPatch} format={format} label="표지 지도" fontHighlight={fontHighlight} onFontContextMenu={onFontContextMenu} />}
      <div className={styles.coverSlide}>
        <div className={styles.coverPlate} style={rectStyle(layout.left, unit)} aria-hidden="true" />
        <p className={styles.coverKicker} style={{ ...rectStyle(layout.leftInner, unit), ...fontStyle(11, unit) }}>사이트 분석 보고서</p>
        <h2 className={styles.coverTitle} style={{ ...rectStyle(layout.address, unit), ...fontStyle(layout.addressPt, unit) }}>{slide.address}</h2>
        {slide.metrics.map((metric, index) => {
          const x = layout.leftInner.x + (index % 2) * (layout.leftInner.w / 2);
          const y = layout.metricsY + Math.floor(index / 2) * 0.62;
          const metricRect = { x, y, w: layout.metricCellW, h: 0.58 };
          return <div className={styles.coverMetric} style={rectStyle(metricRect, unit)} key={metric.label}>
            <span className={styles.coverLabel} style={fontStyle(10, unit)}>{metric.label}</span>
            <span className={styles.coverValue} style={fontStyle(fitBlock([metric.value], { w: metricRect.w, h: 0.36 }, 17, 11), unit)}>{metric.value}</span>
          </div>;
        })}
        <p className={styles.coverAsOf} style={{ ...rectStyle(layout.asOf, unit), ...fontStyle(11, unit) }}>{slide.asOfLine}</p>
        {slide.incomplete && <span className={styles.coverIncomplete} style={{ left: layout.leftInner.x * unit, top: layout.incompleteY * unit, width: layout.leftInner.w * unit }}>{slide.incomplete}</span>}
        <div className={styles.coverPlate} style={rectStyle(layout.right, unit)} aria-hidden="true" />
        <p className={styles.coverKicker} style={{ ...rectStyle(layout.rightHeading, unit), ...fontStyle(11, unit) }}>타일</p>
        <ul className={styles.coverList} style={{ left: (layout.right.x + 0.3) * unit, top: (0.3 + 0.55) * unit, width: (layout.right.w - 0.6) * unit, height: Math.max(0, (layout.right.h - 0.67) * unit) }}>
          {slide.lines.map((line, index) => {
            const row = layout.row(index);
            const text = `${line.title}  ${line.text}`;
            const pt = fitBlock([text], { w: row.w, h: row.h }, 11, 8);
            return <li key={line.title} style={{ height: row.h * unit }}>
              <span className={styles.coverListDot} style={{ background: line.color }} aria-hidden="true" />
              <b className={styles.slideText} style={fontStyle(pt, unit)}>{line.title}</b>
              <span className={styles.slideText} style={fontStyle(pt, unit)}>{line.text}</span>
            </li>;
          })}
        </ul>
      </div>
      <SlideFooter slide={slide} unit={unit} fontHighlight={fontHighlight} onFontContextMenu={onFontContextMenu} interactive={interactive && !!onFontContextMenu} />
    </>
  );
}

function SourcesSurface({ slide, unit, basemap, thumbnail = false, fontHighlight, onFontContextMenu }: { slide: Extract<PlannedSlide, { kind: "sources" }>; unit: number; basemap: BasemapChoice; thumbnail?: boolean; fontHighlight?: FontTargetKey | null; onFontContextMenu?: SurfaceContextMenuHandler }) {
  const format = (slide.format ?? "wide") as SlideFormat;
  const styles = useSurfaceStyles();
  const layout = sourceLayout(slide.rows.length, slide.style, format);
  const mapPanels = { title: layout.title, summary: null, legend: null };
  const map = slide.map;
  const sourcePt = fontSizeForStyle(slide.style, "source");
  return (
    <>
      {map && <MapLayer model={map} style={slide.style} unit={unit} basemap={basemap} panels={mapPanels} siteX={0.5} interactive={false} thumbnail={thumbnail} onPatch={() => undefined} format={format} label="출처 장 배경 지도" fontHighlight={fontHighlight} onFontContextMenu={onFontContextMenu} />}
      <div className={styles.sourceSlide}>
        <ReportTitlePanel color="#7A7E87" title="자료 출처와 기준일" kind="" rect={layout.title} unit={unit} style={slide.style} />
        <div className={styles.sourceTableWrap} style={rectStyle(layout.table, unit)}>
          <table className={styles.sourceTable} data-report-source-table="true">
            <colgroup><col style={{ width: "24%" }} /><col style={{ width: "14%" }} /><col style={{ width: "16%" }} /><col style={{ width: "25%" }} /><col style={{ width: "21%" }} /></colgroup>
            <thead><tr><th style={fontStyle(sourcePt, unit)}>제공처·자료</th><th style={fontStyle(sourcePt, unit)}>기준일</th><th style={fontStyle(sourcePt, unit)}>이용조건</th><th style={fontStyle(sourcePt, unit)}>원문 확인</th><th style={fontStyle(sourcePt, unit)}>사용한 타일</th></tr></thead>
            <tbody>{slide.rows.map((row) => <tr key={row.source + "|" + row.asOf}><td className={styles.sourceCell} style={fontStyle(sourcePt, unit)}><b>{row.provider || "제공처 미기록"}</b><br />{row.source}</td><td className={styles.sourceCell} style={fontStyle(sourcePt, unit)}>{row.asOf}</td><td className={styles.sourceCell} style={fontStyle(sourcePt, unit)}>{row.license || "미기록"}</td><td className={styles.sourceCell} style={fontStyle(sourcePt, unit)}>{row.url ? <a href={row.url}>원문 확인</a> : "원문 링크 미기록"}</td><td className={styles.sourceCell} style={fontStyle(sourcePt, unit)}>{row.tiles}</td></tr>)}</tbody>
          </table>
        </div>
        <p className={styles.sourceAsOf} style={{ ...rectStyle(layout.footer, unit), ...fontStyle(sourcePt, unit) }}>분석 생성일 {slide.analysisDate} · 기준일은 원천 자료 날짜{slide.rows.length > 12 ? ` · 원천 ${slide.rows.length}건` : ""}</p>
      </div>
      <SlideFooter slide={slide} unit={unit} fontHighlight={fontHighlight} onFontContextMenu={onFontContextMenu} interactive={!thumbnail && !!onFontContextMenu} />
    </>
  );
}

function SheetCellEditSurface({ slide, cellIndex, unit, basemap, selection, mapActive = false, onSelect, onFrame, onCellPanels, onMapMoveActive, onMapElementDelete, onMapLabelHide, onDecorationDelete, onDone, onNavigate, fontHighlight, onFontContextMenu }: { slide: Extract<PlannedSlide, { kind: "sheet" }>; cellIndex: number; unit: number; basemap: BasemapChoice; selection?: SurfaceSelection; mapActive?: boolean; onSelect?: (selection: SurfaceSelection) => void; onFrame?: (cell: number | undefined, patch: Partial<MapFrameState>) => void; onCellPanels?: (cell: number, panels: PagePanels) => void; onMapMoveActive?: (active: boolean) => void; onMapElementDelete?: (key: string) => void; onMapLabelHide?: (key: string) => void; onDecorationDelete?: (key: SurfaceDecorationKey, cell?: number) => void; onDone?: () => void; onNavigate?: (direction: -1 | 1) => void; fontHighlight?: FontTargetKey | null; onFontContextMenu?: SurfaceContextMenuHandler }) {
  const format = (slide.format ?? "wide") as SlideFormat;
  const styles = useSurfaceStyles();
  const geometry = slideGeometry(format);
  const cell = slide.cells[cellIndex] ?? null;
  const rect = sheetCells(slide.grid as SheetGrid)[cellIndex] ?? { x: 0.3, y: 1.1, w: geometry.w - 0.6, h: geometry.h - 1.5 };
  const ratio = rect.w / Math.max(0.01, rect.h);
  const frameTop = 0.92;
  const frameBottom = geometry.h - 0.45;
  const frameMaxW = geometry.w - geometry.edge * 2;
  const frameMaxH = frameBottom - frameTop;
  const frameW = Math.min(frameMaxW, frameMaxH * ratio);
  const frameH = frameW / ratio;
  const frame = { x: (geometry.w - frameW) / 2, y: frameTop + (frameMaxH - frameH) / 2, w: frameW, h: frameH };
  const map = cell?.view.map ?? cell?.view.backdrop ?? null;
  const width = Math.max(1, Math.round(frame.w * unit));
  const height = Math.max(1, Math.round(frame.h * unit));
  const cellScaleOptions = cell?.reportFrame && map ? scaleOptionsForFrame(frame.w * 25.4, { width, height, siteX: 0.5, fill: 0.8 }) : null;
  const cellStyle = cell?.reportFrame && map ? {
    ...(cell.style ?? slide.style),
    zoomDelta: cell.reportFrame.scaleDenominator === null ? cell.reportFrame.zoomDelta : zoomForScale(cell.reportFrame.scaleDenominator, map, cellScaleOptions!),
    offsetM: cell.reportFrame.offsetM,
  } : cell?.style ?? slide.style;
  const selected = (selection?.kind === "map" || selection?.kind === "mapElement" || selection?.kind === "mapLabel" || selection?.kind === "decoration")
    ? selection.cell === cellIndex
    : selection?.kind === "sheetCell" && selection.cell === cellIndex;
  const cellMapPatch = (patch: PreviewStylePatch) => {
    if (!cell?.reportFrame || (cell.reportFrame.locked && (patch.zoomDelta !== undefined || patch.offsetM !== undefined))) return;
    onFrame?.(cellIndex, patch as Partial<MapFrameState>);
  };
  const cellDirectPatch = (patch: PreviewStylePatch) => {
    if (!cell?.reportFrame) return;
    if (patch.panels && onCellPanels) onCellPanels(cellIndex, patch.panels as PagePanels);
    const patchFrame = labelFramePatch(cell.reportFrame, patch);
    if (patchFrame) onFrame?.(cellIndex, patchFrame);
  };
  const cellLabelBoxChange = (key: string, box: MapLabelBox) => {
    if (!cell?.reportFrame) return;
    const patchFrame = labelBoxFramePatch(cell.reportFrame, key, box);
    if (patchFrame) onFrame?.(cellIndex, patchFrame);
  };
  const cellLabelBoxReset = (key: string) => {
    if (!cell?.reportFrame) return;
    const patchFrame = resetLabelBoxFramePatch(cell.reportFrame, key);
    if (patchFrame) onFrame?.(cellIndex, patchFrame);
  };
  const emptyPanels = { title: { x: 0, y: 0, w: 0, h: 0 }, summary: null, legend: null };
  const elementSelection = selected && selection?.kind === "mapElement" ? selection : null;
  const labelSelection = selected && selection?.kind === "mapLabel" ? selection : null;
  const decorationSelection = selected && selection?.kind === "decoration" ? selection : null;
  return (
    <div className={styles.sheetCellEditSurface} data-sheet-cell-editing="true" onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onFontContextMenu?.({ kind: "sheetCell", cell: cellIndex }, event.clientX, event.clientY, event.currentTarget); }}>
      <div className={styles.sheetCellEditHeader} role="toolbar" aria-label="조판 칸 크게 편집">
        <span className={styles.sheetCellEditLocation}>조판 {cellIndex + 1} / {slide.cells.length}</span>
        <strong>{cell?.view.title ?? "빈 칸"} 칸 편집 중</strong>
        <span className={styles.sheetCellEditHint}>칸 비율 그대로 크게 · 이 칸에만 적용</span>
        <span className={styles.sheetCellEditSpacer} />
        <button type="button" className={styles.sheetCellEditNav} onClick={() => onNavigate?.(-1)} aria-label="이전 조판 칸">◀</button>
        <button type="button" className={styles.sheetCellEditNav} onClick={() => onNavigate?.(1)} aria-label="다음 조판 칸">▶</button>
        <button type="button" className={styles.sheetCellEditDone} onClick={onDone}>완료</button>
      </div>
      {!cell ? <div className={styles.sheetCellEditEmpty}>이 칸에는 타일이 없습니다.</div> : map ? (
        <div className={styles.sheetCellEditMap} data-preview-map="true" data-map-cell-index={cellIndex} style={rectStyle(frame, unit)}>
          <MapLayer
            model={cell.reportFrame ? modelWithHiddenLayers(map, cell.reportFrame.hiddenLayers) : map}
            style={{ ...cellStyle, ...(cell.panels ? { panels: cell.panels } : {}) }}
            unit={unit}
            basemap={basemap}
            panels={emptyPanels}
            siteX={0.5}
            pinnedKeys={cell.reportFrame ? [...new Set([...(cell.pinnedKeys ?? []), ...cell.reportFrame.pinnedKeys])] : cell.pinnedKeys ?? slide.style.pinnedKeys ?? []}
            interactive={mapActive && !cell.reportFrame?.locked}
            pickable
            selectedElementKey={elementSelection?.key ?? null}
            selectedElementLabelVisible={elementSelection?.labelVisible}
            selectedLabelKey={labelSelection?.key ?? null}
            selectedDecorationKey={decorationSelection?.key ?? null}
            onMapElementSelect={(feature) => onSelect?.({ kind: "mapElement", key: feature.key, cell: cellIndex, labelVisible: feature.labelVisible })}
            onMapLabelSelect={(feature) => onSelect?.({ kind: "mapLabel", key: feature.key, cell: cellIndex })}
            onDecorationSelect={(key) => onSelect?.({ kind: "decoration", key, cell: cellIndex })}
            onDecorationDelete={(key) => { onSelect?.({ kind: "decoration", key, cell: cellIndex }); onDecorationDelete?.(key, cellIndex); }}
            onLabelBoxChange={cellLabelBoxChange}
            onLabelBoxReset={cellLabelBoxReset}
            onDeleteElement={onMapElementDelete}
            onHideLabel={onMapLabelHide}
            mapEditEntry
            onMapMoveActive={onMapMoveActive}
            onPatch={cellMapPatch}
            onDirectPatch={cellDirectPatch}
            label={cell.view.title + " 지도"}
            format={format}
            frame={frame}
            panelBasis="frame"
            contextCell={cellIndex}
            reportFrame={cell.reportFrame}
            fontHighlight={fontHighlight}
            onFontContextMenu={onFontContextMenu}
          />
        </div>
      ) : <div className={styles.sheetCellEditEmpty}>이 칸은 지도 대신 도판으로 표시됩니다.</div>}
    </div>
  );
}

function SheetSurface({ slide, unit, basemap, thumbnail = false, editable = false, selection, mapActive = false, cellEditing, recentCell, onCellActivate, onCellEdit, onCellFit, onCellDelete, onCellDone, onCellNavigate, onSelect, onFrame, onCellPanels, onMapMoveActive, onMapElementDelete, onMapLabelHide, onDecorationDelete, fontHighlight, onFontContextMenu }: { slide: Extract<PlannedSlide, { kind: "sheet" }>; unit: number; basemap: BasemapChoice; thumbnail?: boolean; editable?: boolean; selection?: SurfaceSelection; mapActive?: boolean; cellEditing?: number | null; recentCell?: number | null; onCellActivate?: (index: number) => void; onCellEdit?: (index: number) => void; onCellFit?: (index: number) => void; onCellDelete?: (index: number) => void; onCellDone?: () => void; onCellNavigate?: (direction: -1 | 1) => void; onSelect?: (selection: SurfaceSelection) => void; onFrame?: (cell: number | undefined, patch: Partial<MapFrameState>) => void; onCellPanels?: (cell: number, panels: PagePanels) => void; onMapMoveActive?: (active: boolean) => void; onMapElementDelete?: (key: string) => void; onMapLabelHide?: (key: string) => void; onDecorationDelete?: (key: SurfaceDecorationKey, cell?: number) => void; fontHighlight?: FontTargetKey | null; onFontContextMenu?: SurfaceContextMenuHandler }) {
  if (cellEditing !== undefined && cellEditing !== null) return <SheetCellEditSurface slide={slide} cellIndex={cellEditing} unit={unit} basemap={basemap} selection={selection} mapActive={mapActive} onSelect={onSelect} onFrame={onFrame} onCellPanels={onCellPanels} onMapMoveActive={onMapMoveActive} onMapElementDelete={onMapElementDelete} onMapLabelHide={onMapLabelHide} onDecorationDelete={onDecorationDelete} onDone={onCellDone} onNavigate={onCellNavigate} fontHighlight={fontHighlight} onFontContextMenu={onFontContextMenu} />;
  const format = (slide.format ?? "wide") as SlideFormat;
  const layoutName = slide.page?.layout ?? "map-summary";
  const styles = useSurfaceStyles();
  const cellRects = sheetCells(slide.grid as SheetGrid);
  const geometry = slideGeometry(format);
  const titleRect = titlePlateRect(slide.view.title, slide.grid, geometry.w - 2 * geometry.edge, slide.style, false, format);
  const selectedCellIndex = editable && !thumbnail && selection?.kind === "sheetCell" ? selection.cell : null;
  const selectedCellRect = selectedCellIndex !== null ? cellRects[selectedCellIndex] ?? null : null;
  const sheetActionPosition = selectedCellRect
    ? placeActionBar(
        { x: selectedCellRect.x * unit, y: selectedCellRect.y * unit, w: selectedCellRect.w * unit, h: selectedCellRect.h * unit },
        { w: geometry.w * unit, h: geometry.h * unit },
        [{ x: titleRect.x * unit, y: titleRect.y * unit, w: titleRect.w * unit, h: titleRect.h * unit }],
        260,
      )
    : null;
  const emptyCellPanels = { title: { x: 0, y: 0, w: 0, h: 0 }, summary: null, legend: null };
  return (
    <>
      <div className={styles.sheetSlide}>
        <ReportTitlePanel color={slide.view.color} title={slide.view.title} kind={slide.grid} rect={titleRect} unit={unit} style={slide.style} />
        <div className={styles.sheetGrid}>
          {cellRects.map((rect, index) => {
            const cell = slide.cells[index] ?? null;
            if (!rect) return null;
            if (!cell) return (
              <div className={styles.sheetCell + " " + styles.sheetCellEmpty} style={rectStyle(rect, unit)} key={`empty-${index}`}>
                <span style={fontStyle(12, unit)}>타일 선택</span>
                {onCellActivate && !thumbnail && <button type="button" className={styles.sheetCellButton} data-sheet-cell-index={index} aria-label={`${index + 1}번째 칸 타일 선택`} onClick={() => onCellActivate(index)} />}
              </div>
            );
            const model = cell.view.map ?? cell.view.backdrop;
            const width = Math.max(1, Math.round(rect.w * unit));
            const height = Math.max(1, Math.round(rect.h * unit));
            const chart = cell.face === "back" && !!cell.view.chart;
            const cellScaleOptions = cell.reportFrame ? scaleOptionsForFrame(rect.w * 25.4, { width, height, siteX: 0.5, fill: 0.8 }) : null;
            const cellStyle = cell.reportFrame && model ? {
              ...(cell.style ?? slide.style),
              zoomDelta: cell.reportFrame.scaleDenominator === null ? cell.reportFrame.zoomDelta : zoomForScale(cell.reportFrame.scaleDenominator, model, cellScaleOptions!),
              offsetM: cell.reportFrame.offsetM,
              ...(cell.panels ? { panels: cell.panels } : {}),
            } : { ...(cell.style ?? slide.style), ...(cell.panels ? { panels: cell.panels } : {}) };
            const cellViewport = model ? slideViewport(model, cellStyle, { width, height, siteX: 0.5, fill: 0.8 }) : null;
            const cellNorthBox = cell.reportFrame?.decorations.north ? northArrowBox(width, height, 0, 24) : null;
            const cellScaleBox = cell.reportFrame?.decorations.scaleBar && cellViewport ? scaleBarBox(width, height, metersPerPixel(cellViewport.center[1], cellViewport.zoom)) : null;
            const cellLocatorBox = locatorBox(width, height, unit, [
              ...(cellNorthBox ? [cellNorthBox] : []),
              ...(cellScaleBox ? [cellScaleBox] : []),
            ]);
             const mapSelection = selection?.kind === "map" || selection?.kind === "mapElement" || selection?.kind === "mapLabel" || selection?.kind === "decoration";
             const selectionCell = mapSelection ? selection.cell : undefined;
             const cellSelection = selection?.kind === "sheetCell" && selection.cell === index;
             const cellSelected = cellSelection || (mapSelection && (selectionCell === index || (selectionCell === undefined && index === 0)));
            const cellElementKey = cellSelected && selection?.kind === "mapElement" ? selection.key : null;
             const cellLabelKey = cellSelected && selection?.kind === "mapLabel" ? selection.key : null;
             const cellDecorationKey = cellSelected && selection?.kind === "decoration" ? selection.key : null;
            const cellMapActive = cellSelected && selection?.kind === "map" && mapActive && !cell.reportFrame?.locked;
            const cellEditableMap = editable && !thumbnail && !!onSelect && !!onFrame && !!cell.reportFrame && cellSelected && mapSelection;
            const cellMapPatch = (patch: PreviewStylePatch) => {
              if (!cell.reportFrame || (cell.reportFrame.locked && (patch.zoomDelta !== undefined || patch.offsetM !== undefined))) return;
              onFrame?.(index, patch as Partial<MapFrameState>);
            };
            const cellDirectPatch = (patch: PreviewStylePatch) => {
              if (!cell.reportFrame) return;
              if (patch.panels && onCellPanels) onCellPanels(index, patch.panels as PagePanels);
              const labelPatch = labelFramePatch(cell.reportFrame, patch);
              if (labelPatch) onFrame?.(index, labelPatch);
            };
            const cellLabelBoxChange = (key: string, box: MapLabelBox) => {
              if (!cell.reportFrame) return;
              const patch = labelBoxFramePatch(cell.reportFrame, key, box);
              if (patch) onFrame?.(index, patch);
            };
            const cellLabelBoxReset = (key: string) => {
              if (!cell.reportFrame) return;
              const patch = resetLabelBoxFramePatch(cell.reportFrame, key);
              if (patch) onFrame?.(index, patch);
            };
            const cellMap = cellEditableMap ? (
              <MapLayer
                model={cell.reportFrame ? modelWithHiddenLayers(model, cell.reportFrame.hiddenLayers) : model}
                style={cellStyle}
                unit={unit}
                basemap={basemap}
                panels={emptyCellPanels}
                siteX={0.5}
                pinnedKeys={cell.reportFrame ? [...new Set([...(cell.pinnedKeys ?? []), ...cell.reportFrame.pinnedKeys])] : cell.pinnedKeys ?? cell.style?.pinnedKeys ?? slide.style.pinnedKeys ?? []}
                interactive={cellMapActive}
                pickable
                selectedElementKey={cellElementKey}
                selectedElementLabelVisible={cellSelected && selection?.kind === "mapElement" ? selection.labelVisible : undefined}
                 selectedLabelKey={cellLabelKey}
                 selectedDecorationKey={cellDecorationKey}
                 onMapElementSelect={(feature) => onSelect?.({ kind: "mapElement", key: feature.key, cell: index, labelVisible: feature.labelVisible })}
                 onMapLabelSelect={(feature) => onSelect?.({ kind: "mapLabel", key: feature.key, cell: index })}
                 onDecorationSelect={(key) => onSelect?.({ kind: "decoration", key, cell: index })}
                 onDecorationDelete={(key) => { onSelect?.({ kind: "decoration", key, cell: index }); onDecorationDelete?.(key); }}
                onLabelBoxChange={cellLabelBoxChange}
                onLabelBoxReset={cellLabelBoxReset}
                onDeleteElement={onMapElementDelete}
                onHideLabel={onMapLabelHide}
                mapEditEntry
                onMapMoveActive={cellSelected ? onMapMoveActive : undefined}
                thumbnail={thumbnail}
                onPatch={cellMapPatch}
                onDirectPatch={cellDirectPatch}
                label={cell.view.title + " 지도"}
                format={format}
                frame={rect}
                panelBasis="frame"
                contextCell={index}
                reportFrame={cell.reportFrame}
                fontHighlight={fontHighlight}
                onFontContextMenu={onFontContextMenu}
              />
            ) : model ? (
              <MapLayer
                model={cell.reportFrame ? modelWithHiddenLayers(model, cell.reportFrame.hiddenLayers) : model}
                basemap={basemap}
                unit={unit}
                style={cellStyle}
                panels={emptyCellPanels}
                siteX={0.5}
                interactive={false}
                thumbnail={thumbnail}
                onPatch={() => undefined}
                format={format}
                frame={rect}
                panelBasis="frame"
                contextCell={index}
                reportFrame={cell.reportFrame}
                scale={cell.reportFrame?.decorations.scaleBar ?? false}
                label={cell.view.title + " 지도"}
                pinnedKeys={cell.reportFrame ? [...new Set([...(cell.pinnedKeys ?? []), ...cell.reportFrame.pinnedKeys])] : cell.pinnedKeys ?? cell.style?.pinnedKeys ?? slide.style.pinnedKeys ?? []}
                onDirectPatch={undefined}
              />
            ) : null;
            return (
              <div
                className={styles.sheetCell + (cellEditableMap ? " " + styles.sheetCellInteractive : "")}
                data-map-cell-selected={cellSelected ? "true" : undefined}
                data-sheet-cell-recent={recentCell === index ? "true" : undefined}
                data-sheet-cell-index={index}
                title={editable && !thumbnail ? `${cell.view.title} · 눌러 선택, 두 번 눌러 크게 편집` : undefined}
                tabIndex={editable && !thumbnail ? 0 : undefined}
                style={rectStyle(rect, unit)}
                key={cell.mapKey}
                onDoubleClick={(event) => { if (!editable || thumbnail) return; event.preventDefault(); event.stopPropagation(); onCellEdit?.(index); }}
                onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && editable && !thumbnail) { event.preventDefault(); onCellEdit?.(index); } }}
                onContextMenu={(event) => { if (!editable || thumbnail || !onFontContextMenu) return; event.preventDefault(); event.stopPropagation(); onFontContextMenu({ kind: "sheetCell", cell: index }, event.clientX, event.clientY, event.currentTarget); }}
              >
                {chart ? <ChartPlaceholder view={cell.view} unit={unit} /> : model ? (
                  <div className={styles.sheetCellMap} data-surface-map="true" data-map-cell-index={index}>
                    {cellMap}
                    {cell.reportFrame?.decorations.locator && model.radiusM > 0 && <LocatorInset model={model} basemap={basemap} box={cellLocatorBox} />}
                  </div>
                ) : <VisualPlaceholder title={cell.view.title} message="이 장은 지도 대신 도판으로 표시됩니다." unit={unit} />}
                <span className={styles.sheetLabel} style={fontStyle(9, unit)}>{cell.view.title}</span>
                {onCellActivate && !thumbnail && (!cellEditableMap || !model) && <button type="button" className={styles.sheetCellButton} data-sheet-cell-index={index} aria-label={`${cell.view.title} 타일 선택`} onClick={() => onCellActivate(index)} />}
              </div>
            );
          })}
        </div>
        <div className={styles.elementActionLayer ?? styles.mapSelectionToolbar} data-element-action-layer="true">
          {selectedCellRect && selectedCellIndex !== null && sheetActionPosition && slide.cells[selectedCellIndex] && <ElementActionBar
            elementLabel={`${selectedCellIndex + 1}번째 칸`}
            left={sheetActionPosition.left}
            top={sheetActionPosition.top}
            actions={[{ key: "edit", label: "크게 편집", onClick: () => onCellEdit?.(selectedCellIndex) }, { key: "fit", label: "범위 맞추기", onClick: () => onCellFit?.(selectedCellIndex) }]}
            onDelete={() => onCellDelete?.(selectedCellIndex)}
          />}
        </div>
      </div>
      <SlideFooter slide={slide} unit={unit} fontHighlight={fontHighlight} onFontContextMenu={onFontContextMenu} interactive={!thumbnail && !!onFontContextMenu} />
    </>
  );
}

function LocatorInset({ model, basemap, box }: { model: NonNullable<ReturnType<typeof mapForSlide>>; basemap: BasemapChoice; box: { x0: number; y0: number; x1: number; y1: number } }) {
  const styles = useSurfaceStyles();
  const width = Math.max(1, Math.round(box.x1 - box.x0));
  const height = Math.max(1, Math.round(box.y1 - box.y0));
  const locatorModel = { ...model, radiusM: Math.max(model.radiusM * 3, model.radiusM + 1), features: [], polygons: [], lines: [], total: 0, base: null };
  return <div className={styles.locatorInset ?? styles.surfaceRoot} data-map-locator="true" aria-label="위치도" style={{ left: box.x0, top: box.y0, width, height, pointerEvents: "none" }}><MapFigure model={locatorModel} width={width} height={height} fixed basemap="none" layer={basemap} legend={false} north={false} scale={false} credit={false} showAutomaticLabels={false} viewport={slideViewport(locatorModel, undefined, { width, height, siteX: 0.5, siteY: 0.5, fill: 0.82 })} /></div>;
}

type SlideOpOptions = Record<string, any>;
type SlideOp =
  | { kind: "shape"; type: string; o: SlideOpOptions }
  | { kind: "text"; runs: { text: string; options?: SlideOpOptions }[]; o: SlideOpOptions };

/** A05·A06 설명선(점·지시선·카드·범례)은 PPT 렌더러 호출을 그대로 기록해 SVG로 다시 그린다 — 미리보기와 PPT가 같은 배치 함수를 쓴다. */
function recordCalloutOps(slide: Extract<PlannedSlide, { kind: "tile" }>): SlideOp[] {
  const ops: SlideOp[] = [];
  const recorder = {
    addShape: (type: string, o: SlideOpOptions) => { ops.push({ kind: "shape", type, o }); return recorder; },
    addText: (text: string | { text: string; options?: SlideOpOptions }[], o: SlideOpOptions) => { ops.push({ kind: "text", runs: typeof text === "string" ? [{ text }] : text, o }); return recorder; },
  };
  a05ReportModule.report.render({ slide: recorder as unknown as Slide, planned: slide, part: slide.callout && slide.callout.page > 0 ? "page" : "overview" });
  return ops;
}

const opacityOf = (transparency?: number) => 1 - (transparency ?? 0) / 100;

/** 지도에 붙는 조각(번호 점·지시선·나머지 작은 점) — 끄는 동안 지도 제스처 층과 함께 움직인다 */
const isAnchoredOp = (op: SlideOp): boolean => {
  const name = op.o.objectName;
  return typeof name === "string" ? /\|(dot(-halo|-no)?|leader-.*|mini)$/.test(name) : op.kind === "shape" && op.type === "ellipse";
};

function CalloutSlideOverlay({ slide, part, dragging = false }: { slide: Extract<PlannedSlide, { kind: "tile" }>; part: "anchored" | "fixed"; dragging?: boolean }) {
  const recorded = useMemo(() => recordCalloutOps(slide), [slide]);
  // 화면 타일(CalloutMap)처럼 끄는 동안 지시선은 숨긴다
  const ops = recorded.filter((op) => isAnchoredOp(op) === (part === "anchored") && !(dragging && /\|leader/.test(op.o.objectName ?? "")));
  const size = slideSize("wide");
  return (
    <svg viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }} aria-hidden data-callout-overlay={part}>
      {ops.map((op, i) => {
        const o = op.o;
        if (op.kind === "shape") {
          const fill = o.fill ? `#${o.fill.color}` : "none";
          const fillOpacity = o.fill ? opacityOf(o.fill.transparency) : 0;
          const stroke = o.line && o.line.width > 0 ? `#${o.line.color}` : "none";
          const stroke2 = { stroke, strokeOpacity: o.line ? opacityOf(o.line.transparency) : 0, strokeWidth: (o.line?.width ?? 0) / 72 };
          if (op.type === "line") {
            const [y0, y1] = o.flipV ? [o.y + o.h, o.y] : [o.y, o.y + o.h];
            return <line key={i} x1={o.x} y1={y0} x2={o.x + o.w} y2={y1} strokeLinecap="round" {...stroke2} />;
          }
          if (op.type === "ellipse") return <ellipse key={i} cx={o.x + o.w / 2} cy={o.y + o.h / 2} rx={o.w / 2} ry={o.h / 2} fill={fill} fillOpacity={fillOpacity} {...stroke2} />;
          const rx = op.type === "roundRect" ? Math.min(o.rectRadius ?? 0, o.w / 2, o.h / 2) : 0;
          return <rect key={i} x={o.x} y={o.y} width={o.w} height={o.h} rx={rx} fill={fill} fillOpacity={fillOpacity} {...stroke2} />;
        }
        const fontSize = (o.fontSize ?? 10) / 72;
        const lines = op.runs.length === 1 ? op.runs[0].text.split("\n") : [op.runs.map((r) => r.text).join("")];
        const lineH = fontSize * 1.2;
        const top = o.valign === "middle" ? o.y + (o.h - lines.length * lineH) / 2 : o.valign === "bottom" ? o.y + o.h - lines.length * lineH : o.y;
        const anchor = o.align === "center" ? "middle" : o.align === "right" ? "end" : "start";
        const x = anchor === "middle" ? o.x + o.w / 2 : anchor === "end" ? o.x + o.w : o.x;
        return (
          <text key={i} x={x} textAnchor={anchor} fontFamily={`"${o.fontFace ?? "Malgun Gothic"}","Noto Sans KR",sans-serif`} fontSize={fontSize} fontWeight={o.bold ? 700 : 400} fill={`#${o.color ?? "15171C"}`}>
            {op.runs.length === 1
              ? lines.map((line, li) => <tspan key={li} x={x} y={top + lineH * (li + 0.8)}>{line}</tspan>)
              : <tspan x={x} y={top + lineH * 0.8}>{op.runs.map((r, ri) => <tspan key={ri} fontSize={r.options?.fontSize ? r.options.fontSize / 72 : undefined} fontWeight={r.options?.bold ? 700 : undefined} fill={r.options?.color ? `#${r.options.color}` : undefined}>{r.text}</tspan>)}</tspan>}
          </text>
        );
      })}
    </svg>
  );
}

type CalloutCardTarget = { key: string; label: string; rect: Rect };
type CalloutPointTarget = { key: string; label: string; point: [number, number]; radius: number; mini: boolean };

function calloutCardTargets(slide: Extract<PlannedSlide, { kind: "tile" }>): CalloutCardTarget[] {
  return recordCalloutOps(slide).flatMap((op) => {
    if (op.kind !== "shape" || op.type !== "roundRect" || typeof op.o.objectName !== "string") return [];
    const match = /\|callout-key:([^|]+)\|([^|]+)\|card$/.exec(op.o.objectName);
    if (!match) return [];
    const key = calloutKeyFromTag(`callout-key:${match[1]}`);
    return key ? [{ key: calloutKeyTag(key), label: match[2] || "콜아웃", rect: { x: op.o.x, y: op.o.y, w: op.o.w, h: op.o.h } }] : [];
  });
}

function calloutPointTargets(slide: Extract<PlannedSlide, { kind: "tile" }>): CalloutPointTarget[] {
  return recordCalloutOps(slide).flatMap((op) => {
    if (op.kind !== "shape" || op.type !== "ellipse" || typeof op.o.objectName !== "string") return [];
    const match = /\|callout-key:([^|]+)\|([^|]+)\|(dot|mini)$/.exec(op.o.objectName);
    if (!match) return [];
    const key = calloutKeyFromTag(`callout-key:${match[1]}`);
    return key ? [{ key: calloutKeyTag(key), label: match[2] || "콜아웃", point: [op.o.x + op.o.w / 2, op.o.y + op.o.h / 2] as [number, number], radius: op.o.w / 2, mini: match[3] === "mini" }] : [];
  });
}

function CalloutSelectionLayer({ slide, unit, format, legendRect, selectedCardKey, selectedPanel, panelInteraction, onPanelSelect, onSelectCard, onHideLabel, onShowLabel, onFontContextMenu }: {
  slide: Extract<PlannedSlide, { kind: "tile" }>;
  unit: number;
  format: SlideFormat;
  legendRect: Rect | null;
  selectedCardKey: string | null;
  selectedPanel: boolean;
  panelInteraction?: (key: PanelKey) => PanelInteraction;
  onPanelSelect?: () => void;
  onSelectCard?: (key: string) => void;
  onHideLabel?: (key: string) => void;
  onShowLabel?: (key: string) => void;
  onFontContextMenu?: SurfaceContextMenuHandler;
}) {
  const styles = useSurfaceStyles();
  const cards = useMemo(() => calloutCardTargets(slide), [slide]);
  const pointTargets = useMemo(() => calloutPointTargets(slide), [slide]);
  const [hoveredPointKey, setHoveredPointKey] = useState<string | null>(null);
  const pointPointerType = useRef<string | null>(null);
  const hoveredPoint = pointTargets.find((target) => target.key === hoveredPointKey) ?? null;
  const hoveredComplex = hoveredPoint
    ? slide.callout?.model.complexes.find((complex) => calloutKeyTag(complex.key) === hoveredPoint.key) ?? null
    : null;
  const selectedCard = cards.find((card) => card.key === selectedCardKey) ?? null;
  const bounds = { w: slideSize(format).w * unit, h: slideSize(format).h * unit };
  const cardButton = (card: CalloutCardTarget) => {
    const selected = card.key === selectedCardKey;
    const width = Math.max(44, card.rect.w * unit);
    const height = Math.max(44, card.rect.h * unit);
    return <button
      key={card.key}
      type="button"
      className={styles.decorationHitTarget}
      data-callout-card={card.key}
      data-callout-selected={selected ? "true" : undefined}
      aria-label={card.label + " 선택"}
      aria-pressed={selected}
      style={{ left: card.rect.x * unit, top: card.rect.y * unit, width, height, pointerEvents: "auto" }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); onSelectCard?.(card.key); }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onFontContextMenu?.({ kind: "mapLabel", key: card.key }, event.clientX, event.clientY, event.currentTarget);
      }}
    />;
  };
  const legendTarget = legendRect ? (() => {
    const interaction = panelInteraction?.("legend");
    const selected = selectedPanel;
    return <button
      type="button"
      className={styles.decorationHitTarget}
      data-panel-key="legend"
      data-callout-panel="legend"
      data-panel-selected={selected ? "true" : "false"}
      data-font-highlight={interaction?.["data-font-highlight"]}
      aria-label={"범례" + (selected ? " 선택됨" : " 선택")}
      aria-pressed={selected}
      style={{ left: legendRect.x * unit, top: legendRect.y * unit, width: legendRect.w * unit, height: legendRect.h * unit, pointerEvents: "auto" }}
      onPointerDown={(event) => { event.stopPropagation(); onPanelSelect?.(); }}
      onClick={(event) => { event.stopPropagation(); onPanelSelect?.(); }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onFontContextMenu?.({ kind: "panel", key: "legend" }, event.clientX, event.clientY, event.currentTarget);
      }}
    />;
  })() : null;
  // 막대는 카드 안이 아니라 층 전체 기준으로 놓으므로 카드 원점 기준 offset을 되돌린다
  const selectedCardOffset = selectedCard ? actionBarOffsetForRect(selectedCard.rect, unit, bounds) : null;
  const selectedCardPosition = selectedCard && selectedCardOffset
    ? { left: selectedCard.rect.x * unit + selectedCardOffset.left, top: selectedCard.rect.y * unit + selectedCardOffset.top }
    : null;
  const pointTooltip = hoveredPoint && hoveredComplex ? (() => {
    const text = calloutHoverText(hoveredComplex);
    const fontSize = Math.max(9, 9 * unit / 72);
    const textWidth = [...text].reduce((sum, character) => sum + (character.charCodeAt(0) > 0x7f ? fontSize : fontSize * 0.55), 0);
    const width = Math.min(300, Math.max(72, textWidth + 16));
    const height = Math.max(22, fontSize * 1.7);
    const point = [hoveredPoint.point[0] * unit, hoveredPoint.point[1] * unit] as const;
    const left = Math.max(4, Math.min(bounds.w - width - 4, point[0] + 10));
    const top = Math.max(4, Math.min(bounds.h - height - 4, point[1] - height - 10));
    const ringRadius = Math.max(12, hoveredPoint.radius * unit + 7);
    return <>
      <span data-callout-hover-ring="true" aria-hidden="true" style={{ position: "absolute", left: point[0] - ringRadius, top: point[1] - ringRadius, width: ringRadius * 2, height: ringRadius * 2, boxSizing: "border-box", border: "2.4px solid #111827", borderRadius: "50%", pointerEvents: "none", zIndex: 98 }} />
      <span data-callout-hover-tooltip="true" style={{ position: "absolute", left, top, width, maxWidth: Math.max(40, bounds.w - 8), minHeight: height, boxSizing: "border-box", display: "flex", alignItems: "center", padding: "0 8px", background: "#111827", color: "#fff", opacity: 0.94, border: "0.8px solid rgba(255,255,255,.75)", borderRadius: 5, fontSize, fontWeight: 600, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none", zIndex: 99 }}>{text}</span>
    </>;
  })() : null;
  const pointButton = (target: CalloutPointTarget) => {
    const size = 44;
    return <button
      key={target.key}
      type="button"
      className={styles.decorationHitTarget}
      data-callout-point="true"
      data-callout-mini={target.mini ? target.key : undefined}
      aria-label={target.mini ? `${target.label} 라벨 켜기` : `${target.label} 정보 보기`}
      style={{ left: target.point[0] * unit - size / 2, top: target.point[1] * unit - size / 2, width: size, height: size, pointerEvents: "auto" }}
      onPointerDown={(event) => { event.stopPropagation(); pointPointerType.current = event.pointerType; }}
      onPointerEnter={(event) => { pointPointerType.current = event.pointerType; if (event.pointerType !== "touch") setHoveredPointKey(target.key); }}
      onPointerLeave={(event) => { if (event.pointerType !== "touch") setHoveredPointKey(null); pointPointerType.current = null; }}
      onFocus={() => { if (pointPointerType.current !== "touch") setHoveredPointKey(target.key); }}
      onBlur={() => { pointPointerType.current = null; setHoveredPointKey(null); }}
      onClick={(event) => { event.stopPropagation(); if (target.mini) onShowLabel?.(target.key); }}
    />;
  };
  return <div className={styles.elementActionLayer ?? styles.mapSelectionToolbar} data-element-action-layer="true">
    {legendTarget}
    {pointTargets.map(pointButton)}
    {cards.map(cardButton)}
    {selectedCard && selectedCardPosition && <ElementActionBar elementLabel={selectedCard.label} left={selectedCardPosition.left} top={selectedCardPosition.top} onDelete={() => onHideLabel?.(selectedCard.key)} />}
    {pointTooltip}
  </div>;
}

function TileSurface({ slide, unit, basemap, panels, interactive, pickable = false, selection, mapEditEntry = false, onMapMoveActive, thumbnail = false, onPatch, onDirectPatch, panelInteraction, staticSurface = false, onText, fontHighlight, onFontContextMenu, onMapElementSelect, onMapLabelSelect, onLabelBoxChange, onLabelBoxReset, onDeleteElement, onHideLabel, onShowLabel, onPanelDelete, onDecorationSelect, onDecorationDelete }: { slide: Extract<PlannedSlide, { kind: "tile" }>; unit: number; basemap: BasemapChoice; panels: { title: Rect; summary: Rect | null; legend: Rect | null; source: Rect }; interactive: boolean; thumbnail?: boolean; pickable?: boolean; selection?: SurfaceSelection; mapEditEntry?: boolean; onMapMoveActive?: (active: boolean) => void; onPatch: (patch: PreviewStylePatch) => void; onDirectPatch?: (patch: PreviewStylePatch) => void; panelInteraction?: (key: PanelKey) => PanelInteraction; staticSurface?: boolean; onText?: (kind: "title" | "summary") => void; fontHighlight?: FontTargetKey | null; onFontContextMenu?: SurfaceContextMenuHandler; onMapElementSelect?: (feature: MapFigureElementPick) => void; onMapLabelSelect?: (feature: MapFigureElementPick) => void; onLabelBoxChange?: (key: string, box: MapLabelBox) => void; onLabelBoxReset?: (key: string) => void; onDeleteElement?: (key: string) => void; onHideLabel?: (key: string) => void; onShowLabel?: (key: string) => void; onPanelDelete?: (key: PanelKey) => void; onDecorationSelect?: (key: SurfaceDecorationKey) => void; onDecorationDelete?: (key: SurfaceDecorationKey) => void }) {
  const format = (slide.format ?? "wide") as SlideFormat;
  const styles = useSurfaceStyles();
  const selectSurface = useContext(SurfaceSelectContext);
  const model = slide.map;
  const reportFrame = slide.page?.kind === "tile" ? slide.page.frame : undefined;
  const layoutName = slide.page?.layout;
  const displayModel = model && reportFrame ? modelWithHiddenLayers(model, reportFrame.hiddenLayers) : model;
  const chart = !model && !slide.mass && !slide.rose && slide.body.face !== "single";
  const terrainShown = slide.view.code === "D17" && !!slide.view.terrainSections && !!slide.terrainSection;
  const terrainLayout = terrainShown ? terrainSectionLayout(panels, slideLayout(format), format) : null;
  const geometry = slideGeometry(format);
  const mapLayout = slide.page?.layout === "numbers-first" || slide.page?.layout === "side-by-side" ? layoutRects(slide.page.layout, format).map : null;
  const mapFrame = mapLayout ? { x: mapLayout.x * geometry.w, y: mapLayout.y * geometry.h, w: mapLayout.w * geometry.w, h: mapLayout.h * geometry.h } : null;
  const width = Math.max(1, Math.round((mapFrame?.w ?? geometry.w) * unit));
  const height = Math.max(1, Math.round((mapFrame?.h ?? geometry.h) * unit));
  // 설명선(A05·A06) 점·카드는 16:9 전체 지도 장 기준으로만 그린다(PPT 렌더러와 같은 전제)
  const callout = slide.callout && slide.body.kind === "result" && format === "wide" && !mapFrame ? slide : undefined;
  // 설명선 장의 지도 프레임은 PPT(map-pptx)와 같게: 개요는 SLIDE_OVERVIEW_FILL, 설명표 장은 두 칸 사이 프레임
  const calloutDetailFrame = callout && callout.callout!.page > 0 ? slideCalloutFrame(4) : null;
  const mapFill = terrainLayout?.mapFill ?? calloutDetailFrame?.fill ?? (callout ? SLIDE_OVERVIEW_FILL : 0.8);
  const mapSiteY = terrainLayout?.mapSiteY ?? 0.5;
  const mapSiteX = calloutDetailFrame?.siteX ?? slideSiteX(slide.style, panels.summary !== null, format);
  const scaleOptions = reportFrame && model
    ? mapFrameScaleOptions(format, layoutName ?? "map-summary", { width, height, siteX: mapSiteX, siteY: mapSiteY, fill: mapFill })
    : null;
  const mapStyle: PageStyle = reportFrame && model ? {
    ...slide.style,
    zoomDelta: reportFrame.scaleDenominator === null ? reportFrame.zoomDelta : zoomForScale(reportFrame.scaleDenominator, model, scaleOptions!),
    offsetM: [...reportFrame.offsetM] as [number, number],
    pinnedKeys: [...new Set([...(slide.style.pinnedKeys ?? []), ...reportFrame.pinnedKeys])],
    hiddenKeys: [...new Set([...(slide.style.hiddenKeys ?? []), ...reportFrame.hiddenLabelKeys])],
  } : slide.style;
  const calloutEntries = slide.callout ? calloutLegendEntries(slide.callout.model, reportFrame?.legend) : [];
  const calloutAlignment = model ? slideCalloutAvoidance(panels, calloutEntries, slideLayout(format), format, fontSizeForStyle(slide.style, "legend") / DEFAULT_REPORT_FONT_SIZES.legend) : null;
  const resolvedCalloutLegend = callout ? panels.legend : calloutAlignment?.calloutLegend;
  const northUnit = 1.5 * (unit / (960 / geometry.w));
  const northRightInset = panels.summary
    ? Math.max(0, width - panels.summary.x * unit + geometry.edge * unit * 0.5)
    : geometry.edge * unit;
  const northCalloutTop = (calloutAlignment?.calloutTop ?? panels.title.y + panels.title.h + geometry.edge * 0.5) * unit;
  const northAvoid = model ? northArrowBox(width, height, northRightInset, northCalloutTop + 13 * northUnit, northUnit) : null;
  const [hoverLegend, setHoverLegend] = useState<string | null>(null);
  const onLegendPin = useCallback((key: string) => {
    if (!model || !onDirectPatch) return;
    const target = legendItemsOf(model).find((entry) => entry.key === key);
    if (!target) return;
    const focusLabel = legendLabelOf(model, slide.style.legendFocus);
    const currentKey = focusLabel ? legendItemsOf(model).find((entry) => entry.label === focusLabel)?.key ?? null : null;
    onDirectPatch({ legendFocus: toggleLegendFocus(currentKey, target.key) });
  }, [model, onDirectPatch, slide.style.legendFocus]);
  return (
    <>
       {displayModel ? <div className={styles.mapLayerHost} data-surface-map={mapFrame ? "true" : undefined} style={mapFrame ? { position: "absolute", left: String(Number((mapLayout!.x * 100).toFixed(2))) + "%", top: String(Number((mapLayout!.y * 100).toFixed(2))) + "%", width: String(Number((mapLayout!.w * 100).toFixed(2))) + "%", height: String(Number((mapLayout!.h * 100).toFixed(2))) + "%" } : undefined}><MapLayer model={displayModel} style={mapStyle} unit={unit} basemap={basemap} panels={panels} siteX={calloutDetailFrame?.siteX ?? slideSiteX(mapStyle, panels.summary !== null, format)} fill={callout ? mapFill : undefined} callout={callout} pinnedKeys={mapStyle.pinnedKeys} interactive={interactive} pickable={pickable} selectedElementKey={selection?.kind === "mapElement" ? selection.key : null} selectedElementLabelVisible={selection?.kind === "mapElement" ? selection.labelVisible : undefined} selectedLabelKey={selection?.kind === "mapLabel" ? selection.key : null} selectedPanelKey={selection?.kind === "panel" ? selection.key : null} selectedDecorationKey={selection?.kind === "decoration" ? selection.key : null} onMapElementSelect={onMapElementSelect} onMapLabelSelect={onMapLabelSelect} onDecorationSelect={onDecorationSelect} onDecorationDelete={onDecorationDelete} onLabelBoxChange={onLabelBoxChange} onLabelBoxReset={onLabelBoxReset} onDeleteElement={onDeleteElement} onHideLabel={onHideLabel} onShowLabel={onShowLabel} onPanelDelete={onPanelDelete} mapEditEntry={mapEditEntry} onMapMoveActive={onMapMoveActive} thumbnail={thumbnail} onPatch={onPatch} onDirectPatch={onDirectPatch} hoverLegend={hoverLegend} onMapHoverLegend={setHoverLegend} terrainSection={slide.view.code === "D17" ? slide.terrainSection ?? "A" : undefined} terrainLayout={terrainLayout} calloutLegend={resolvedCalloutLegend} calloutTop={calloutAlignment ? calloutAlignment.calloutTop * unit : undefined} calloutLeftBottom={calloutAlignment?.calloutLeftBottom ? calloutAlignment.calloutLeftBottom * unit : undefined} northAvoid={northAvoid} scale={!(slide.callout && slide.callout.page > 0)} frame={mapFrame ?? undefined} format={format} label={slide.view.title + " 지도"} reportFrame={reportFrame} preserveShortCalloutLabels={staticSurface && !thumbnail} fontHighlight={fontHighlight} onFontContextMenu={onFontContextMenu} /></div> : slide.mass ? <VisualPlaceholder title={slide.view.title} message="3D 매스 미리보기는 내보내기와 같은 페이지 위치로 표시됩니다." unit={unit} /> : slide.rose ? <VisualPlaceholder title={slide.view.title} message="바람장미 도판 미리보기" unit={unit} /> : chart ? <ChartPlaceholder view={slide.view} unit={unit} /> : <VisualPlaceholder title={slide.view.title} message={slide.body.kind === "state" ? slide.body.message : "표시할 지도 결과가 없습니다."} unit={unit} />}
       {terrainShown && <TerrainSectionPreview slide={slide} unit={unit} layout={terrainLayout} />}
      {slide.body.kind === "state" && <div className={styles.slidePanel} style={{ left: unit * 4, top: unit * 2.7, width: unit * 5.1, height: unit * 1.15 }}><div className={styles.slideText + " " + styles.slideTextStrong} style={fontStyle(16, unit)}>{slide.body.message}</div></div>}
       {!slide.page?.deletedElementKeys?.includes("title") && <div onDoubleClick={() => onText?.("title")}><TitlePanel slide={slide} rect={panels.title} unit={unit} interaction={panelInteraction?.("title")} /></div>}
       {panels.summary && hasSummaryPanel(slide) && !slide.page?.deletedElementKeys?.includes("summary") && <div onDoubleClick={() => onText?.("summary")}><SummaryPanel slide={slide} rect={terrainLayout?.summary ?? panels.summary} unit={unit} terrainSectionShown={terrainShown} interaction={panelInteraction?.("summary")} /></div>}
       {panels.legend && !callout && <LegendPanel slide={{ ...slide, map: model } as Extract<PlannedSlide, { kind: "tile" }>} rect={panels.legend} unit={unit} format={format} hoverLabel={hoverLegend} onLegendHover={setHoverLegend} onLegendPin={staticSurface || thumbnail ? undefined : onLegendPin} onLegendMenu={staticSurface || thumbnail || !onFontContextMenu ? undefined : (x, y, opener) => onFontContextMenu({ kind: "panel", key: "legend" }, x, y, opener)} interaction={panelInteraction?.("legend")} legendOptions={reportFrame?.legend} />}
        <SlideFooter slide={slide} rect={panels.source} unit={unit} fontHighlight={fontHighlight} onFontContextMenu={onFontContextMenu} interactive={interactive && !thumbnail && !!onFontContextMenu} hidden={slide.page?.deletedElementKeys?.includes("source")} selected={selection?.kind === "element" && selection.key === "source"} onSelect={selectSurface} onDelete={() => onPanelDelete?.("source")} interaction={panelInteraction?.("source")} />
    </>
  );
}

type PanelTransformFrameProps = {
  panelKey: PanelKey;
  rect: Rect;
  unit: number;
  bounds: { w: number; h: number };
  xGuides: number[];
  yGuides: number[];
  onResizeStart: (direction: ResizeDirection, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDelete: () => void;
  onDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
  actions?: ElementAction[];
  directions?: ResizeDirection[];
};

function PanelTransformFrame({ panelKey, rect, unit, bounds, xGuides, yGuides, onDragStart, onResizeStart, onResizeMove, onResizeEnd, onDelete, onContextMenu, actions = [], directions = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] }: PanelTransformFrameProps) {
  const styles = useSurfaceStyles();
  const actionBar = actionBarOffsetForRect(rect, unit, bounds);
  return <>
    <div className={styles.snapGuides} aria-hidden="true">
      {xGuides.map((x) => <span className={styles.snapGuideX} style={{ left: x * unit }} key={`x-${x}`} />)}
      {yGuides.map((y) => <span className={styles.snapGuideY} style={{ top: y * unit }} key={`y-${y}`} />)}
    </div>
    <div className={styles.panelSelectionFrame} data-panel-frame={panelKey} style={rectStyle(rect, unit)} aria-label={`${panelLabelFor(panelKey)} 선택됨`} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onContextMenu?.(event); }}>
      <ElementActionBar elementLabel={PANEL_LABEL[panelKey]} left={actionBar.left} top={actionBar.top} actions={actions} onDelete={onDelete} />
      {directions.map((direction) => <button
        key={direction}
        type="button"
        tabIndex={-1}
        className={styles.panelHandle + " " + styles["panelHandle" + direction.toUpperCase() as keyof typeof styles]}
        data-panel-handle={direction}
        aria-label={`${panelLabelFor(panelKey)} ${direction} 모서리 크기 조절`}
        title={`${panelLabelFor(panelKey)} ${direction} 크기 조절`}
        onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); if (!isResizeAnchorHit(direction, event)) { onDragStart(event); return; } onResizeStart(direction, event); }}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
      ><span aria-hidden="true" /></button>)}
    </div>
  </>;
}

function SlidePreview({ slide, basemap, editable, format: requestedFormat, mapActive, staticSurface = false, selection, fontHighlight, onFontContextMenu, onSelect, onMapMoveActive, onMapElementSelect, onMapLabelSelect, onLabelBoxChange, onLabelBoxReset, onDeleteElement, onHideLabel, onShowLabel, onPanelDelete, onDecorationSelect, onDecorationDelete, onFrame, onCellPanels, onTextBox, onText, textBoxEditingId, textBoxPlacement, onTextBoxPlacementMove, onTextBoxPlacementCommit, onTextBoxEditingChange, thumbnail = false, onSheetCellActivate, sheetCellEditing, sheetCellRecent, onSheetCellEdit, onSheetCellFit, onSheetCellDelete, onSheetCellDone, onSheetCellNavigate, onPatch, onMapPatch, onDirectPatch }: { slide: PlannedSlide; basemap: BasemapChoice; editable: boolean; format?: SlideFormat; staticSurface?: boolean; mapActive?: boolean; selection?: SurfaceSelection; fontHighlight?: FontTargetKey | null; onFontContextMenu?: SurfaceContextMenuHandler; onSelect?: (selection: SurfaceSelection) => void; onMapMoveActive?: (active: boolean) => void; onMapElementSelect?: (feature: MapFigureElementPick) => void; onMapLabelSelect?: (feature: MapFigureElementPick) => void; onLabelBoxChange?: (key: string, box: MapLabelBox) => void; onLabelBoxReset?: (key: string) => void; onDeleteElement?: (key: string) => void; onHideLabel?: (key: string) => void; onShowLabel?: (key: string) => void; onPanelDelete?: (key: PanelKey) => void; onDecorationSelect?: (key: SurfaceDecorationKey) => void; onDecorationDelete?: (key: SurfaceDecorationKey, cell?: number) => void; onFrame?: (cell: number | undefined, patch: Partial<MapFrameState>) => void; onCellPanels?: (cell: number, panels: PagePanels) => void; onTextBox?: (box: TextBox | { id: string; remove: true }) => void; onText?: (kind: "title" | "summary") => void; textBoxEditingId?: string | null; textBoxPlacement?: TextBoxPlacement | null; onTextBoxPlacementMove?: (x: number, y: number) => void; onTextBoxPlacementCommit?: (x: number, y: number) => void; onTextBoxEditingChange?: (id: string | null) => void; thumbnail?: boolean; onSheetCellActivate?: (index: number) => void; sheetCellEditing?: number | null; sheetCellRecent?: number | null; onSheetCellEdit?: (index: number) => void; onSheetCellFit?: (index: number) => void; onSheetCellDelete?: (index: number) => void; onSheetCellDone?: () => void; onSheetCellNavigate?: (direction: -1 | 1) => void; onPatch: (patch: PreviewStylePatch) => void; onMapPatch: (patch: PreviewStylePatch) => void; onDirectPatch?: (patch: PreviewStylePatch) => void }) {
  const format = (requestedFormat ?? (slide.format as SlideFormat | undefined) ?? "wide");
  const styles = useSurfaceStyles();
  const slotRef = useRef<HTMLDivElement>(null);
  const frameSize = useContainFrameSize(slotRef, format);
  const unit = frameSize.width > 0 ? frameSize.width / slideSize(format).w : 1;
  const [draftStyle, setDraftStyle] = useState<PreviewStylePatch>({});
  const [selectedPanel, setSelectedPanel] = useState<PanelKey | null>(null);
  const [snapGuides, setSnapGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const panelDrag = useRef<{ pointerId: number; key: PanelKey; x: number; y: number; rect: Rect } | null>(null);
  const panelResize = useRef<{ pointerId: number; key: PanelKey; direction: ResizeDirection; x: number; y: number; rect: Rect } | null>(null);
  const panelLongPress = useRef<{ pointerId: number; key: PanelKey; x: number; y: number; target: HTMLElement; timer: number } | null>(null);
  const displaySlide = Object.keys(draftStyle).length > 0 ? { ...slide, style: { ...slide.style, ...draftStyle } } : slide;
  const mapSelectable = reportPageMapSelectable(displaySlide.page);
  const displayModel = mapForSlide(displaySlide);
  const mapPickable = editable && mapSelectable && !thumbnail && (!!displayModel || displaySlide.kind === "sheet");
  const hasSummary = hasSummaryPanel(displaySlide);
  const terrainSectionShown = displaySlide.kind === "tile" && displaySlide.view.code === "D17" && !!displaySlide.view.terrainSections && !!displaySlide.terrainSection;
  const reportLegend = displaySlide.kind === "tile" && displaySlide.page?.kind === "tile" ? displaySlide.page.frame?.legend : undefined;
  const baseLegend = displayModel && displaySlide.kind === "tile" ? slideLegend(displayModel, !displaySlide.muted, undefined, hasSummary, format, reportLegend).rect : null;
  const legacyPanels = slidePanelRects(displaySlide.style, hasSummary, baseLegend, format);
  const calloutSlide = displaySlide.kind === "tile" ? displaySlide.callout : undefined;
  const calloutLegendScale = fontSizeForStyle(displaySlide.style, "legend") / DEFAULT_REPORT_FONT_SIZES.legend;
  const calloutLegendEntriesForSlide = calloutSlide ? calloutLegendEntries(calloutSlide.model, reportLegend) : [];
  const calloutLegendRect = calloutSlide
    ? calloutSlide.page > 0
      ? (() => {
          const calloutFrame = slideCalloutFrame(4);
          return slideCalloutLegendLayout(calloutLegendEntriesForSlide, calloutFrame.left.x1 + 0.35, slideLayout(format).legendBottom, calloutFrame.right.x0 - calloutFrame.left.x1 - 0.7, calloutLegendScale)?.rect ?? null;
        })()
      : slideCalloutAvoidance({ ...legacyPanels, legend: null }, calloutLegendEntriesForSlide, slideLayout(format), format, calloutLegendScale).calloutLegend
    : null;
  const layoutName = displaySlide.page?.layout ?? "map-summary";
  const customLayout = layoutName === "numbers-first" || layoutName === "side-by-side";
  const size = slideSize(format);
  const layout = customLayout ? layoutRects(layoutName, format) : null;
  const toRect = (rect: { x: number; y: number; w: number; h: number } | null) => rect ? { x: rect.x * size.w, y: rect.y * size.h, w: rect.w * size.w, h: rect.h * size.h } : null;
  const panels = calloutSlide
    ? { ...legacyPanels, legend: calloutLegendRect }
    : layout
      ? { title: toRect(layout.title)!, summary: toRect(layout.summary), legend: reportLegend?.placement === "hidden" ? null : toRect(layout.legend) }
      : legacyPanels;
  const existingPanels = ((displaySlide.style as PageStyle & { panels?: PagePanels }).panels ?? {});
  const sourceRect = existingPanels.source
    ? toRect(existingPanels.source)!
    : slideLayout(format).strip;
  const panelRects: Partial<Record<PanelKey, Rect>> = { title: panels.title, summary: panels.summary ?? undefined, legend: panels.legend ?? undefined, source: sourceRect };

  useEffect(() => {
    setSelectedPanel(null);
    setDraftStyle({});
    setSnapGuides({ x: [], y: [] });
    panelDrag.current = null;
    panelResize.current = null;
  }, [slide.key]);
  useEffect(() => {
    if (selection?.kind === "panel") setSelectedPanel(selection.key);
    else if (selection?.kind === "element" && selection.key === "source") setSelectedPanel("source");
    else setSelectedPanel(null);
  }, [selection]);
  useEffect(() => {
    if (!hasSummary && selectedPanel === "summary") setSelectedPanel(null);
    if (!panelRects[selectedPanel ?? "title"] && selectedPanel !== null) setSelectedPanel(null);
  }, [hasSummary, panels.summary, panels.legend, sourceRect, selectedPanel]);
  useEffect(() => () => {
    if (panelLongPress.current) window.clearTimeout(panelLongPress.current.timer);
  }, []);
  useEffect(() => {
    const element = slotRef.current;
    if (!element) return;
    const onDeselect = () => setSelectedPanel(null);
    element.addEventListener("v2-preview-deselect-panel", onDeselect);
    return () => element.removeEventListener("v2-preview-deselect-panel", onDeselect);
  }, []);

  const previewPatch = (patch: PreviewStylePatch) => setDraftStyle((current) => ({ ...current, ...patch }));
  const commitPatch = (patch: PreviewStylePatch) => {
    setDraftStyle({});
    onPatch(patch);
  };
  const commitPanel = (key: PanelKey, rect: Rect) => {
    setDraftStyle({});
    setSnapGuides({ x: [], y: [] });
    onDirectPatch?.(panelPatch(key, rect, existingPanels, format));
  };
  const resizeRect = (state: NonNullable<typeof panelResize.current>, event: ReactPointerEvent<HTMLButtonElement>): Rect => {
    const dx = (event.clientX - state.x) / Math.max(1, unit);
    const dy = (event.clientY - state.y) / Math.max(1, unit);
    let next = { ...state.rect };
    if (state.direction.includes("e")) next.w += dx;
    if (state.direction.includes("w")) { next.x += dx; next.w -= dx; }
    if (state.direction.includes("s")) next.h += dy;
    if (state.direction.includes("n")) { next.y += dy; next.h -= dy; }
    return next;
  };
  const onResizeStart = (direction: ResizeDirection, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!editable || !onDirectPatch || !selectedPanel) return;
    const rect = panelRects[selectedPanel];
    if (!rect) return;
    panelResize.current = { pointerId: event.pointerId, key: selectedPanel, direction, x: event.clientX, y: event.clientY, rect };
    event.currentTarget.setPointerCapture(event.pointerId);
    setSnapGuides({ x: [], y: [] });
  };
  const onResizeMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = panelResize.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const snapped = snapPanelRect(state.key, resizeRect(state, event), panelRects, format);
    previewPatch(panelPatch(state.key, snapped.rect, existingPanels, format));
    setSnapGuides({ x: snapped.xGuides, y: snapped.yGuides });
    event.preventDefault();
  };
  const onResizeEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = panelResize.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const next = snapPanelRect(state.key, resizeRect(state, event), panelRects, format);
    commitPanel(state.key, next.rect);
    panelResize.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onPanelMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pending = panelLongPress.current;
    if (pending && (pending.pointerId !== event.pointerId || Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 8)) {
      window.clearTimeout(pending.timer);
      panelLongPress.current = null;
    }
    const state = panelDrag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = (event.clientX - state.x) / Math.max(1, unit);
    const dy = (event.clientY - state.y) / Math.max(1, unit);
    const snapped = snapPanelRect(state.key, { ...state.rect, x: state.rect.x + dx, y: state.rect.y + dy }, panelRects, format);
    previewPatch(panelPatch(state.key, snapped.rect, existingPanels, format));
    setSnapGuides({ x: snapped.xGuides, y: snapped.yGuides });
    event.preventDefault();
  };
  const onPanelMoveEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pending = panelLongPress.current;
    if (pending && pending.pointerId === event.pointerId) {
      window.clearTimeout(pending.timer);
      panelLongPress.current = null;
    }
    const state = panelDrag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = (event.clientX - state.x) / Math.max(1, unit);
    const dy = (event.clientY - state.y) / Math.max(1, unit);
    const next = snapPanelRect(state.key, { ...state.rect, x: state.rect.x + dx, y: state.rect.y + dy }, panelRects, format);
    commitPanel(state.key, next.rect);
    panelDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onPanelMoveStart = (key: PanelKey, event: ReactPointerEvent<HTMLElement>) => {
    if (!editable || !onDirectPatch || selectedPanel !== key || event.button !== 0) return;
    const rect = panelRects[key];
    if (!rect) return;
    panelDrag.current = { pointerId: event.pointerId, key, x: event.clientX, y: event.clientY, rect };
    const captureTarget = event.currentTarget.matches("[data-panel-key]")
      ? event.currentTarget
      : event.currentTarget.closest<HTMLElement>("[data-slide-canvas]")?.querySelector<HTMLElement>(`[data-panel-key="${key}"]`) ?? event.currentTarget;
    captureTarget.setPointerCapture(event.pointerId);
    setSnapGuides({ x: [], y: [] });
  };
  const startPanelLongPress = (key: PanelKey, event: ReactPointerEvent<HTMLDivElement>) => {
    const previous = panelLongPress.current;
    if (previous) window.clearTimeout(previous.timer);
    panelLongPress.current = null;
    if (!onFontContextMenu || (event.pointerType !== "touch" && event.pointerType !== "pen") || event.button !== 0) return;
    const target = event.currentTarget;
    const x = event.clientX;
    const y = event.clientY;
    const timer = window.setTimeout(() => {
      panelLongPress.current = null;
      onFontContextMenu(key === "source" ? { kind: "element", key } : { kind: "panel", key }, x, y, target);
    }, 500);
    panelLongPress.current = { pointerId: event.pointerId, key, x: event.clientX, y: event.clientY, target, timer };
  };
  const onPanelKeyDown = (key: PanelKey, event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      onFontContextMenu?.(key === "source" ? { kind: "element", key } : { kind: "panel", key }, rect.left, rect.bottom + 8, event.currentTarget);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelectedPanel(key);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSelectedPanel(null);
      return;
    }
    if (!onDirectPatch || selectedPanel !== key || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const rect = panelRects[key];
    if (!rect) return;
    const stepX = size.w * 0.01;
    const stepY = size.h * 0.01;
    const moveX = event.shiftKey ? 0 : event.key === "ArrowRight" ? stepX : event.key === "ArrowLeft" ? -stepX : 0;
    const moveY = event.shiftKey ? 0 : event.key === "ArrowDown" ? stepY : event.key === "ArrowUp" ? -stepY : 0;
    const resizeW = event.shiftKey && event.key === "ArrowRight" ? stepX : event.shiftKey && event.key === "ArrowLeft" ? -stepX : 0;
    const resizeH = event.shiftKey && event.key === "ArrowDown" ? stepY : event.shiftKey && event.key === "ArrowUp" ? -stepY : 0;
    const next = snapPanelRect(key, { ...rect, x: rect.x + moveX, y: rect.y + moveY, w: rect.w + resizeW, h: rect.h + resizeH }, panelRects, format);
    event.preventDefault();
    event.stopPropagation();
    onDirectPatch(panelPatch(key, next.rect, existingPanels, format));
    setSnapGuides({ x: next.xGuides, y: next.yGuides });
  };
  const panelInteraction = (key: PanelKey): PanelInteraction => ({
    "data-panel-key": key,
    "data-panel-selected": selectedPanel === key ? "true" : "false",
    "data-font-highlight": fontHighlight === key ? "true" : "false",
    tabIndex: 0,
    role: "group",
    "aria-label": panelLabelFor(key) + (selectedPanel === key ? " 선택됨" : " 선택"),
    onPointerDown: (event) => {
      if ((event.target as HTMLElement).closest("[data-panel-action]")) return;
      startPanelLongPress(key, event);
      event.stopPropagation();
      if (selectedPanel !== key) {
        setSelectedPanel(key);
        if (key === "source") onSelect?.({ kind: "element", key: "source" });
        else onSelect?.({ kind: "panel", key });
        return;
      }
      onPanelMoveStart(key, event);
    },
    onPointerMove: onPanelMove,
    onPointerUp: onPanelMoveEnd,
    onPointerCancel: onPanelMoveEnd,
    onKeyDown: (event) => onPanelKeyDown(key, event),
    onContextMenu: (event) => {
      event.preventDefault();
      event.stopPropagation();
      onFontContextMenu?.(key === "source" ? { kind: "element", key } : { kind: "panel", key }, event.clientX, event.clientY, event.currentTarget);
    },
  });
  const resetPanel = (key: PanelKey) => {
    if (!onDirectPatch || !existingPanels[key]) return;
    const panels = Object.fromEntries(Object.entries(existingPanels).filter(([panelKey]) => panelKey !== key)) as PagePanels;
    onDirectPatch({ panels });
    setSelectedPanel(null);
  };
  const handles = editable && displaySlide.kind === "tile" && selectedPanel && panelRects[selectedPanel]
    ? <PanelTransformFrame panelKey={selectedPanel} rect={panelRects[selectedPanel]!} unit={unit} bounds={{ w: size.w * unit, h: size.h * unit }} xGuides={snapGuides.x} yGuides={snapGuides.y} onDragStart={(event) => onPanelMoveStart(selectedPanel, event)} onResizeStart={onResizeStart} onResizeMove={onResizeMove} onResizeEnd={onResizeEnd} onDelete={() => { onPanelDelete?.(selectedPanel); setSelectedPanel(null); }} onContextMenu={(event) => onFontContextMenu?.(selectedPanel === "source" ? { kind: "element", key: "source" } : { kind: "panel", key: selectedPanel }, event.clientX, event.clientY, event.currentTarget)} actions={existingPanels[selectedPanel] ? [{ key: "reset", label: "위치 초기화", onClick: () => resetPanel(selectedPanel) }] : []} directions={selectedPanel === "source" ? ["e", "w"] : displaySlide.callout && selectedPanel === "legend" ? [] : undefined} />
    : null;
  const mapCellFromTarget = (target: HTMLElement): number | undefined => {
    const raw = target.closest<HTMLElement>("[data-map-cell-index]")?.dataset.mapCellIndex;
    if (raw === undefined) return undefined;
    const index = Number(raw);
    return Number.isInteger(index) && index >= 0 ? index : undefined;
  };
  // 편집 중이 아닌 지도 층은 포인터를 받지 않으므로, 패널·글상자가 아닌 지도 영역 클릭을 좌표로 판단한다.
  const onMapArea = (event: React.MouseEvent<HTMLElement>): boolean => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-map-pick], [data-map-label-selection], [data-map-label-handle], [data-map-selection-toolbar], [data-element-action-bar], [data-report-decoration], [data-decoration-frame], [data-callout-card], [data-callout-point], [data-callout-mini], [data-callout-panel]")) return false;
    if (target.closest("[data-preview-map]")) return mapSelectable;
    if (!mapSelectable || !onSelect || target.closest("[data-panel-key], [data-panel-frame], [data-text-box]")) return false;
    const rect = event.currentTarget.querySelector<HTMLElement>("[data-preview-map]")?.getBoundingClientRect();
    return !!rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  };
  return (
    <SurfaceSelectContext.Provider value={onSelect}>
    <div ref={slotRef} className={styles.previewSlot} data-preview-slot="true">
      <div className={styles.previewFrame} data-preview-frame="true" data-frame-ready={frameSize.width > 0 ? "true" : "false"} data-slide-format={format} style={frameSize.width > 0 ? { width: frameSize.width, height: frameSize.height, ...(format === "wide" ? {} : { aspectRatio: String(size.w.toFixed(3)) + " / " + String(size.h.toFixed(3)) }) } : format === "wide" ? undefined : { aspectRatio: String(size.w.toFixed(3)) + " / " + String(size.h.toFixed(3)) }}>
        <div
          className={styles.slideCanvas}
          data-slide-canvas="true"
          data-map-editing={mapActive ? "true" : undefined}
          style={canvasStyle(unit)}
          onPointerDownCapture={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest("[data-map-pick], [data-map-label-selection], [data-map-label-handle], [data-map-selection-toolbar], [data-element-action-bar], [data-report-decoration], [data-decoration-frame], [data-callout-card], [data-callout-point], [data-callout-mini], [data-callout-panel]")) return;
            const sheetCellTarget = target.closest<HTMLElement>("[data-sheet-cell-index]");
            if (displaySlide.kind === "sheet" && sheetCellTarget && !mapActive && onSheetCellActivate) {
              const index = Number(sheetCellTarget.dataset.sheetCellIndex);
              if (Number.isInteger(index) && index >= 0) onSheetCellActivate(index);
              return;
            }
            if (onMapArea(event)) {
              target.closest<HTMLElement>("[data-preview-map]")?.focus({ preventScroll: true });
              const cell = mapCellFromTarget(target);
              onSelect?.({ kind: "map", ...(cell === undefined ? {} : { cell }) });
              return;
            }
            if (mapActive) {
              onMapMoveActive?.(false);
              return;
            }
            if (!target.closest("[data-panel-key]") && !target.closest("[data-panel-frame]") && !target.closest("[data-text-box]")) {
              setSelectedPanel(null);
              onSelect?.(null);
            }
          }}
          onDoubleClick={(event) => {
            const target = event.target as HTMLElement;
            const mapTarget = target.closest<HTMLElement>("[data-preview-map]");
            if (mapTarget && !target.closest("[data-map-selection-toolbar], [data-element-action-bar], [data-map-label-handle], [data-report-decoration], [data-decoration-frame]")) {
              if (mapActive) return;
              event.preventDefault();
              mapTarget.focus({ preventScroll: true });
              const cell = mapCellFromTarget(target);
              onSelect?.({ kind: "map", ...(cell === undefined ? {} : { cell }) });
              onMapMoveActive?.(true);
            }
          }}
          onDragStart={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setSelectedPanel(null);
            if (mapActive) onMapMoveActive?.(false);
            else onSelect?.(null);
          }}
          data-transforming={panelDrag.current || panelResize.current ? "true" : "false"}
          data-map-selected={selection?.kind === "map" || selection?.kind === "mapElement" || selection?.kind === "mapLabel" ? "true" : undefined}
        >
         {displaySlide.kind === "cover" && displaySlide.page?.kind !== "blank" && <CoverSurface slide={displaySlide} unit={unit} basemap={basemap} interactive={!!(mapSelectable && editable && (mapActive ?? editable) && !!displayModel)} thumbnail={thumbnail} onPatch={onMapPatch} onDirectPatch={onDirectPatch} fontHighlight={fontHighlight} onFontContextMenu={onFontContextMenu} />}
         {displaySlide.kind === "sources" && <SourcesSurface slide={displaySlide} unit={unit} basemap={basemap} thumbnail={thumbnail} fontHighlight={fontHighlight} onFontContextMenu={onFontContextMenu} />}
         {displaySlide.kind === "cover" && displaySlide.page?.kind === "blank" && <BlankSurface unit={unit} />}
         {displaySlide.kind === "sheet" && <SheetSurface slide={displaySlide} unit={unit} basemap={basemap} thumbnail={thumbnail} editable={editable} selection={selection} mapActive={!!mapActive} cellEditing={sheetCellEditing} recentCell={sheetCellRecent} onCellActivate={onSheetCellActivate} onCellEdit={onSheetCellEdit} onCellFit={onSheetCellFit} onCellDelete={onSheetCellDelete} onCellDone={onSheetCellDone} onCellNavigate={onSheetCellNavigate} onSelect={onSelect} onFrame={onFrame} onCellPanels={onCellPanels} onMapMoveActive={onMapMoveActive} onMapElementDelete={onDeleteElement} onMapLabelHide={onHideLabel} onDecorationDelete={onDecorationDelete} fontHighlight={fontHighlight} onFontContextMenu={onFontContextMenu} />}
         {displaySlide.kind === "tile" && <TileSurface slide={displaySlide} unit={unit} basemap={basemap} panels={{ ...panels, source: sourceRect }} interactive={!!(editable && (mapActive ?? editable) && !!displayModel)} pickable={mapPickable} selection={selection} mapEditEntry={editable && mapSelectable && !thumbnail} onMapMoveActive={onMapMoveActive} onMapElementSelect={(feature) => onSelect?.({ kind: "mapElement", key: feature.key, labelVisible: feature.labelVisible })} onMapLabelSelect={(feature) => onSelect?.({ kind: "mapLabel", key: feature.key })} onLabelBoxChange={onLabelBoxChange} onLabelBoxReset={onLabelBoxReset} onDeleteElement={onDeleteElement} onHideLabel={onHideLabel} onShowLabel={onShowLabel} onPanelDelete={onPanelDelete} onDecorationSelect={onDecorationSelect} onDecorationDelete={onDecorationDelete} thumbnail={thumbnail} onPatch={onMapPatch} onDirectPatch={onDirectPatch} panelInteraction={editable ? panelInteraction : undefined} staticSurface={staticSurface} onText={onText} fontHighlight={fontHighlight} onFontContextMenu={onFontContextMenu} />}
        {displaySlide.page?.textBoxes && <TextBoxSurface boxes={displaySlide.page.textBoxes} unit={unit} selectedId={selection?.kind === "textBox" ? selection.id : undefined} startEditingId={textBoxEditingId} maxWidth={size.w} maxHeight={size.h} editable={editable} onSelect={onSelect} onTextBox={onTextBox} onEditingChange={onTextBoxEditingChange} onContextMenu={onFontContextMenu} />}
        {editable && textBoxPlacement && onTextBoxPlacementMove && onTextBoxPlacementCommit && <TextBoxPlacementLayer placement={textBoxPlacement} unit={unit} maxWidth={size.w} maxHeight={size.h} onMove={onTextBoxPlacementMove} onCommit={onTextBoxPlacementCommit} />}
        {handles}
        </div>
      </div>
    </div>
    </SurfaceSelectContext.Provider>
  );
}

const noopPreviewPatch = (_patch: PreviewStylePatch): void => undefined;

const ThumbnailPreview = memo(function ThumbnailPreview({ slide, basemap }: { slide: PlannedSlide; basemap: BasemapChoice }) {
  const styles = useSurfaceStyles();
  const hostRef = useRef<HTMLSpanElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (typeof IntersectionObserver === "undefined") {
      setMounted(true);
      return;
    }
    const root = host.closest("[data-thumbnail-scroll]");
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry) setMounted(entry.isIntersecting);
    }, { root: root instanceof Element ? root : null, rootMargin: "0px" });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return (
    <span ref={hostRef} className={styles.thumbMini} data-preview-thumbnail="true" aria-hidden="true">
      {mounted
        ? <SlidePreview slide={slide} basemap={basemap} editable={false} thumbnail onPatch={noopPreviewPatch} onMapPatch={noopPreviewPatch} />
        : <span className={styles.thumbMiniText}>{slide.kind === "cover" ? "표지" : slide.kind === "sources" ? "출처" : slide.kind === "sheet" ? "조판" : slide.view.title}</span>}
    </span>
  );
});



export type SurfaceSelection =
  | { kind: "map"; cell?: number }
  | { kind: "mapElement"; key: string; cell?: number; labelVisible?: boolean }
  | { kind: "mapLabel"; key: string; cell?: number }
  | { kind: "panel"; key: "title" | "summary" | "legend" }
  | { kind: "element"; key: "source" }
  | { kind: "decoration"; key: SurfaceDecorationKey; cell?: number }
  | { kind: "sheetCell"; cell: number }
  | { kind: "textBox"; id: string }
  | null;

export type SlideSurfaceProps = {
  slide: PlannedSlide;
  basemap: BasemapChoice;
  /** 벡터 바탕 테마. 별도 React 루트(내보내기)처럼 보드의 컨텍스트가 닿지 않는 곳에서 넘긴다. */
  baseTheme?: BaseThemeId;
  mode: "edit" | "thumb" | "export";
  selection?: SurfaceSelection;
  fontHighlight?: FontTargetKey | null;
  onFontContextMenu?: SurfaceContextMenuHandler;
  onSelect?: (selection: SurfaceSelection) => void;
  onFrame?: (cell: number | undefined, patch: Partial<MapFrameState>) => void;
  onCellPanels?: (cell: number, panels: PagePanels) => void;
  onPanels?: (panels: PagePanels) => void;
  onTextBox?: (box: TextBox | { id: string; remove: true }) => void;
  onText?: (kind: "title" | "summary") => void;
  textBoxEditingId?: string | null;
  textBoxPlacement?: TextBoxPlacement | null;
  onTextBoxPlacementMove?: (x: number, y: number) => void;
  onTextBoxPlacementCommit?: (x: number, y: number) => void;
  onTextBoxEditingChange?: (id: string | null) => void;
  mapActive?: boolean;
  onMapMoveActive?: (active: boolean) => void;
  onStylePatch?: (patch: PreviewStylePatch) => void;
  onMapStylePatch?: (patch: PreviewStylePatch) => void;
  onDirectStylePatch?: (patch: PreviewStylePatch) => void;
  onSheetCellActivate?: (index: number) => void;
  sheetCellEditing?: number | null;
  sheetCellRecent?: number | null;
  onSheetCellEdit?: (index: number) => void;
  onSheetCellFit?: (index: number) => void;
  onSheetCellDelete?: (index: number) => void;
  onSheetCellDone?: () => void;
  onSheetCellNavigate?: (direction: -1 | 1) => void;
  onMapElementDelete?: (key: string) => void;
  onMapLabelHide?: (key: string) => void;
  onMapLabelShow?: (key: string) => void;
  onPanelDelete?: (key: PanelKey | "source") => void;
  onDecorationSelect?: (key: SurfaceDecorationKey) => void;
  onDecorationDelete?: (key: SurfaceDecorationKey) => void;
  classMap?: Record<string, string>;
};

export function SlideSurface({
  slide,
  basemap,
  baseTheme,
  mode,
  selection,
  fontHighlight,
  onFontContextMenu,
  onSelect,
  onFrame,
  onCellPanels,
  onPanels,
  onTextBox,
  onText,
  textBoxEditingId,
  textBoxPlacement,
  onTextBoxPlacementMove,
  onTextBoxPlacementCommit,
  onTextBoxEditingChange,
  mapActive,
  onMapMoveActive,
  onStylePatch,
  onMapStylePatch,
  onDirectStylePatch,
  onSheetCellActivate,
  onMapElementDelete,
  onMapLabelHide,
  onMapLabelShow,
  onPanelDelete,
  onDecorationSelect,
  onDecorationDelete,
  sheetCellEditing,
  sheetCellRecent,
  onSheetCellEdit,
  onSheetCellFit,
  onSheetCellDelete,
  onSheetCellDone,
  onSheetCellNavigate,
  classMap,
}: SlideSurfaceProps) {
  const inheritedBaseTheme = useContext(BaseThemeContext);
  const format = (slide.format ?? "wide") as SlideFormat;
  const size = slideSize(format);
  const safeBasemap = (basemap as string) === "none" ? "white" : basemap;
  const frame = slide.page?.kind === "tile" ? slide.page.frame : null;
  const locked = !!frame?.locked;
  const active = mapActive ?? mode === "edit";
  const staticSurface = mode !== "edit";
  const styles = classMap ?? FALLBACK_STYLES;
  const mapPatch = (patch: PreviewStylePatch) => {
    if (locked && (patch.zoomDelta !== undefined || patch.offsetM !== undefined)) return;
    if (patch.zoomDelta !== undefined || patch.offsetM !== undefined) onFrame?.(undefined, patch as Partial<MapFrameState>);
    if (onMapStylePatch) onMapStylePatch(patch);
    else onStylePatch?.(patch);
  };
  const directPatch = (patch: PreviewStylePatch) => {
    if (patch.panels && onPanels) onPanels(patch.panels as unknown as PagePanels);
    const labelPatch = frame ? labelFramePatch(frame, patch) : null;
    if (labelPatch) onFrame?.(undefined, labelPatch);
    if (onDirectStylePatch) onDirectStylePatch(patch);
    else onStylePatch?.(patch);
  };
  const mapLabelBoxChange = (key: string, box: MapLabelBox) => {
    if (!frame || !onFrame) return;
    const patch = labelBoxFramePatch(frame, key, box);
    if (patch) onFrame(undefined, patch);
  };
  const mapLabelBoxReset = (key: string) => {
    if (!frame || !onFrame) return;
    const patch = resetLabelBoxFramePatch(frame, key);
    if (patch) onFrame(undefined, patch);
  };
  const cellActivate = (index: number) => onSheetCellActivate?.(index);
  return (
    <SurfaceStyleContext.Provider value={styles}>
    <BaseThemeContext.Provider value={baseTheme ?? inheritedBaseTheme}>
      <div
        className={styles.surfaceRoot}
        data-slide-surface="true"
        data-surface-mode={mode}
        data-surface-format={format}
        style={{ position: "relative", width: "100%", height: "100%", minWidth: 0, minHeight: 0, overflow: "hidden", aspectRatio: String(size.w.toFixed(3)) + " / " + String(size.h.toFixed(3)) }}
      >
        {mode === "thumb"
          ? <ThumbnailPreview slide={slide} basemap={safeBasemap} />
          : <SlidePreview
              slide={slide}
              basemap={safeBasemap}
              editable={mode === "edit"}
              mapActive={active && !locked}
              staticSurface={staticSurface}
              format={format}
              selection={selection}
              fontHighlight={fontHighlight}
              onFontContextMenu={onFontContextMenu}
              onSelect={onSelect}
              onMapMoveActive={onMapMoveActive}
              onLabelBoxChange={mapLabelBoxChange}
              onLabelBoxReset={mapLabelBoxReset}
              onDeleteElement={onMapElementDelete}
              onHideLabel={onMapLabelHide}
              onShowLabel={onMapLabelShow}
              onPanelDelete={onPanelDelete}
              onDecorationSelect={onDecorationSelect}
              onDecorationDelete={onDecorationDelete}
              onFrame={onFrame}
              onCellPanels={onCellPanels}
              onTextBox={onTextBox}
              onText={onText}
              textBoxEditingId={textBoxEditingId}
              textBoxPlacement={textBoxPlacement}
              onTextBoxPlacementMove={onTextBoxPlacementMove}
              onTextBoxPlacementCommit={onTextBoxPlacementCommit}
              onTextBoxEditingChange={onTextBoxEditingChange}
              onSheetCellActivate={mode === "edit" ? cellActivate : undefined}
              sheetCellEditing={mode === "edit" ? sheetCellEditing : null}
              sheetCellRecent={mode === "edit" ? sheetCellRecent : null}
              onSheetCellEdit={mode === "edit" ? onSheetCellEdit : undefined}
              onSheetCellFit={mode === "edit" ? onSheetCellFit : undefined}
              onSheetCellDelete={mode === "edit" ? onSheetCellDelete : undefined}
              onSheetCellDone={mode === "edit" ? onSheetCellDone : undefined}
              onSheetCellNavigate={mode === "edit" ? onSheetCellNavigate : undefined}
              onPatch={mapPatch}
              onMapPatch={mapPatch}
              onDirectPatch={directPatch}
            />}
        {locked && (active || selection?.kind === "map") && <span className={styles.surfaceLockedMessage} data-map-locked="true">지도 위치 고정됨</span>}
      </div>
    </BaseThemeContext.Provider>
    </SurfaceStyleContext.Provider>
  );
}
