"use client";

import * as React from "react";
import { createContext, memo, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { BasemapChoice } from "@/lib/v2/ui/map-projection";
import { metersPerPixel, slideViewport, zoomViewAt, type MapView } from "@/lib/v2/ui/map-projection";
import { zoomForScale } from "@/lib/v2/ui/report-scale";
import { layoutRects, slideCalloutAvoidance, slideGeometry, slideLayout, slideLegend, slidePanelRects, slideReserved, slideSize, slideSiteX, terrainSectionLayout, type Rect, type SlideFormat, type TerrainSectionLayout } from "@/lib/v2/ui/overlay-layout";
import { coverLayout, fitBlock, fitFooterText, sourceLayout, titlePlateRect } from "@/lib/v2/report/pptx-kit";
import { layerStyle, legendItemsOf, legendLabelOf } from "@/lib/v2/ui/map-layers";
import { reportSummaryNotes, terrainCrossingLayer, terrainElevationLabel, terrainSectionAxisStops, terrainSectionBands, terrainSectionElevationAt, terrainSectionMarkerGeometry, terrainSectionPosition, terrainSectionTotal, sortTerrainCrossings, TERRAIN_CROSSING_LABELS, TERRAIN_SECTION_LABELS, TERRAIN_SECTION_TABLE_MAX_ROWS } from "@/lib/v2/ui/terrain-section";
import MapFigure from "../map-figure";
import { northArrowBox, scaleBarBox } from "@/lib/v2/ui/map-scene";
import type { PageStyle } from "@/lib/v2/ui/board-state";
import type { PagePanels, MapFrameState, ReportLayout, TextBox } from "@/lib/v2/report/report-doc";
import type { PlannedSlide } from "@/lib/v2/report/report-plan";
import type { TileView } from "@/lib/v2/ui/tile-view";
import { sheetCells, type SheetGrid } from "@/lib/v2/ui/sheet";
import { mixedValue, toggleLabelVisibility, toggleLegendFocus } from "@/lib/v2/ui/report-preview-logic";

type SurfaceStyles = Record<string, string>;
const FALLBACK_STYLES: SurfaceStyles = new Proxy<SurfaceStyles>({} as SurfaceStyles, { get: (_target, key) => String(key) });
const SurfaceStyleContext = createContext<SurfaceStyles>(FALLBACK_STYLES);
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

type PanelKey = "title" | "summary" | "legend";
type PanelRatio = { x: number; y: number; w: number; h: number };
type ResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const PANEL_LABEL: Record<PanelKey, string> = { title: "제목", summary: "요약", legend: "범례" };
const PANEL_MIN: Record<PanelKey, { w: number; h: number }> = {
  title: { w: 1.1, h: 0.46 },
  summary: { w: 1.8, h: 1.1 },
  legend: { w: 1.3, h: 0.52 },
};
const SHEET_GRID_OPTIONS: readonly { grid: SheetGrid; label: string }[] = [
  { grid: "2x2", label: "2×2 · 4칸" },
  { grid: "3x2", label: "3×2 · 6칸" },
  { grid: "3x1", label: "3×1 · 3칸" },
];

type PanelInteraction = {
  "data-panel-key": PanelKey;
  "data-panel-selected": "true" | "false";
  tabIndex: 0;
  role: "group";
  "aria-label": string;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
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

function safePanelBounds(format: SlideFormat = "wide"): { left: number; top: number; right: number; bottom: number } {
  const geometry = slideGeometry(format);
  return {
    left: geometry.edge,
    top: geometry.edge,
    right: geometry.w - geometry.edge,
    bottom: geometry.h - geometry.stripH - geometry.edge * 0.6,
  };
}

function clampPanelRect(key: PanelKey, rect: Rect, format: SlideFormat = "wide"): Rect {
  const bounds = safePanelBounds(format);
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
  const bounds = safePanelBounds(format);
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
  label: string;
  format?: SlideFormat;
  frame?: Rect;
  reportFrame?: MapFrameState;
};

const EMPTY_PAGE_KEYS: readonly string[] = [];

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

function mapWidthMmFor(format: SlideFormat, layout: ReportLayout | undefined): number {
  const base = format === "wide" ? 240 : format === "a3" ? 270 : 190;
  return layout === "numbers-first" || layout === "side-by-side" ? base * 0.45 : base;
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

function MapLayer({ model, style, unit, basemap, panels, siteX, pinnedKeys, interactive, thumbnail = false, onPatch, onDirectPatch, hoverLegend, terrainSection, terrainLayout, calloutLegend, calloutTop, calloutLeftBottom, northAvoid, scale = true, label, format = "wide", frame, reportFrame }: MapLayerProps) {
  const styles = useSurfaceStyles();
  const geometry = slideGeometry(format);
  const frameWidth = frame?.w ?? geometry.w;
  const frameHeight = frame?.h ?? geometry.h;
  const width = Math.max(1, Math.round(frameWidth * unit));
  const height = Math.max(1, Math.round(frameHeight * unit));
  const [dragging, setDragging] = useState(false);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const mapInteractionRef = useRef<HTMLDivElement>(null);
  const gestureLayerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; offset: [number, number]; dx: number; dy: number; moved: boolean } | null>(null);
  const suppressFeatureClick = useRef(false);
  const panDeltaRef = useRef<[number, number] | null>(null);
  const wheelDeltaRef = useRef(0);
  const wheelBaseViewRef = useRef<MapView | null>(null);
  const wheelPreviewViewRef = useRef<MapView | null>(null);
  const wheelOriginRef = useRef<[number, number] | null>(null);
  const wheelTimerRef = useRef<number | null>(null);
  const labelToggleStartedRef = useRef<number | null>(null);
  const styleRef = useRef(style);
  const patchRef = useRef(onPatch);
  styleRef.current = style;
  patchRef.current = onPatch;
  const mapFill = terrainLayout?.mapFill ?? 0.8;
  const mapSiteY = terrainLayout?.mapSiteY ?? 0.5;
  const rightInset = panels.summary
    ? Math.max(0, width - panels.summary.x * unit + geometry.edge * unit * 0.5)
    : geometry.edge * unit;
  const bottomInset = unit * (geometry.stripH + (calloutLegend ? calloutLegend.h + 0.18 : 0));
  const layoutUnit = 1.5 * (unit / (960 / geometry.w));
  const showNorth = reportFrame?.decorations.north ?? false;
  const showScale = reportFrame?.decorations.scaleBar ?? scale;
  const displayBasemap: BasemapChoice = reportFrame?.basemap === "air" ? "Satellite" : reportFrame?.basemap === "none" ? "white" : reportFrame?.basemap === "road" || reportFrame?.basemap === "base" ? "Base" : basemap;
  const baseViewport = useMemo(() => slideViewport(model, undefined, { width, height, siteX, siteY: mapSiteY, fill: mapFill }), [height, mapFill, mapSiteY, model, siteX, width]);
  const viewport = useMemo(() => slideViewport(model, style, { width, height, siteX, siteY: mapSiteY, fill: mapFill }), [height, mapFill, mapSiteY, model, siteX, style, width]);
  const focusedLabel = useMemo(() => legendLabelOf(model, style.legendFocus), [model, style.legendFocus]);
  const activeLegendLabel = hoverLegend ?? focusedLabel;
  const avoid = useMemo(() => {
    const reserved = slideReserved(unit, {
      info: panels.summary !== null,
      titleRect: panels.title,
      infoRect: panels.summary,
      legend: panels.legend,
      calloutLegend,
      terrainSection: terrainLayout?.rect,
      format,
    });
    const scaleAvoid = scaleBarBox(width, height, metersPerPixel(viewport.center[1], viewport.zoom), bottomInset, rightInset, false, undefined, layoutUnit);
    return [...reserved, ...(showScale ? [scaleAvoid] : []), ...(showNorth && northAvoid ? [northAvoid] : [])];
  }, [bottomInset, calloutLegend, format, height, layoutUnit, northAvoid, panels.legend, panels.summary, panels.title, rightInset, showNorth, showScale, terrainLayout?.rect, unit, viewport, width]);
  const onFeatureHover = useCallback((key: string | null) => {
    if (!interactive) return;
    setHoverKey((current) => current === key ? current : key);
  }, [interactive]);
  const onFeaturePin = useCallback((feature: { key: string; labelVisible?: boolean }) => {
    if (!onDirectPatch || suppressFeatureClick.current) return;
    const currentStyle = styleRef.current;
    const next = toggleLabelVisibility(
      currentStyle.pinnedKeys ?? pinnedKeys ?? EMPTY_PAGE_KEYS,
      currentStyle.hiddenKeys ?? EMPTY_PAGE_KEYS,
      feature.key,
      feature.labelVisible ?? false,
    );
    labelToggleStartedRef.current = typeof performance === "undefined" ? null : performance.now();
    recordPreviewMetric("labelToggleDispatches");
    onDirectPatch({ pinnedKeys: next.pinnedKeys, hiddenKeys: next.hiddenKeys });
  }, [onDirectPatch, pinnedKeys]);
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
  useEffect(() => () => {
    if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current);
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
        fixed
        layoutUnit={layoutUnit}
        basemap={thumbnail ? "none" : "tiles"}
        layer={displayBasemap}
        legend={false}
        north={showNorth ? (northAvoid ? northAvoid.y0 + 13 * layoutUnit : undefined) : false}
        credit={false}
        label={label}
        viewport={viewport}
        avoid={avoid}
        pinnedKeys={style.pinnedKeys ?? pinnedKeys ?? EMPTY_PAGE_KEYS}
        hiddenKeys={style.hiddenKeys ?? EMPTY_PAGE_KEYS}
        legendFocus={focusedLabel}
        highlightLabel={activeLegendLabel}
        highlightPinnedLabel={focusedLabel}
        terrainSection={terrainSection}
        fill={mapFill}
        siteY={mapSiteY}
        bottomInset={bottomInset}
        rightInset={rightInset}
        scale={showScale}
        calloutTop={calloutTop}
        calloutLeftBottom={calloutLeftBottom ?? (terrainLayout?.calloutLeftBottom ? terrainLayout.calloutLeftBottom * unit : undefined)}
        showAutomaticLabels={reportFrame?.labelRule !== "off"}
        previewInteraction={interactive}
        hoverKey={interactive ? hoverKey : null}
        onFeatureHover={interactive ? onFeatureHover : undefined}
        onFeaturePin={onFeaturePin}
        dragging={dragging}
      />
    </div>
  );
  if (!interactive) return <div className={styles.slideMap} data-preview-map="true">{map}</div>;
  const mapKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Home") {
      event.preventDefault();
      patchRef.current({ offsetM: [0, 0] });
    }
  };
  return (
    <div
      ref={mapInteractionRef}
      className={styles.mapInteraction}
      data-preview-map="true"
      data-dragging={dragging ? "true" : "false"}
      tabIndex={0}
      role="application"
      aria-label={label + " 지도. 드래그하여 이동하고 휠로 확대합니다."}
      onPointerDown={startPointer}
      onPointerMove={movePointer}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onKeyDown={mapKeyDown}
      onDragStart={(event) => event.preventDefault()}
    >
      {map}
    </div>
  );
}

function SlideFooter({ slide, unit }: { slide: PlannedSlide; unit: number }) {
  const styles = useSurfaceStyles();
  const footer = fitFooterText(slide.footer, slide.kind !== "sheet" && !!slide.map);
  return (
    <div className={styles.slideFooter}>
      <span className={styles.slideFooterText} style={fontStyle(footer.fontSize, unit)}>{footer.text}</span>
      <span className={styles.slideFooterPage}>{slide.no} / {slide.total}</span>
    </div>
  );
}

function ReportTitlePanel({ color, code, title, kind, rect, unit, interaction }: { color: string; code: string; title: string; kind: string; rect: Rect; unit: number; interaction?: PanelInteraction }) {
  const styles = useSurfaceStyles();
  const titleBox = { w: Math.max(0.2, rect.w - 0.58), h: Math.max(0.16, rect.h - 0.08) };
  const titlePt = fitBlock([title], titleBox, 18, 7);
  const metaPt = fitBlock([[code, kind].filter(Boolean).join("  ")], titleBox, 10, 7);
  return (
    <div className={styles.slidePanel + " " + styles.titlePanel} style={rectStyle(rect, unit)} {...interaction}>
      <span className={styles.titleDot} style={{ background: color }} aria-hidden="true" />
      {code && <span className={styles.slideMeta} style={fontStyle(metaPt, unit)}>{code}</span>}
      <h3 className={styles.slideTitle} style={fontStyle(titlePt, unit)}>{title}</h3>
      {kind && <span className={styles.slideKind} style={fontStyle(metaPt, unit)}>{kind}</span>}
    </div>
  );
}

function TitlePanel({ slide, rect, unit, interaction, onText }: { slide: Extract<PlannedSlide, { kind: "tile" }>; rect: Rect; unit: number; interaction?: PanelInteraction; onText?: () => void }) {
  return <ReportTitlePanel color={slide.view.color} code={slide.view.code} title={slide.page?.titleOverride ?? slide.view.title} kind={slide.view.kindLabel} rect={rect} unit={unit} interaction={interaction} />;
}

function SummaryPanel({ slide, rect, unit, terrainSectionShown = false, interaction, onText }: { slide: Extract<PlannedSlide, { kind: "tile" }>; rect: Rect; unit: number; terrainSectionShown?: boolean; interaction?: PanelInteraction; onText?: () => void }) {
  const styles = useSurfaceStyles();
  const view = slide.view;
  const innerW = Math.max(0.2, rect.w - 0.44);
  const children: React.ReactNode[] = [];
  if (view.headline) {
    const valuePt = fitBlock([view.headline.value], { w: innerW, h: 0.66 }, 36, 7);
    const labelPt = fitBlock([view.headline.label], { w: innerW, h: 0.24 }, 11, 7);
    children.push(
      <div className={styles.summaryLineFull} key="headline">
        <div className={styles.slideMetricLabel} style={fontStyle(labelPt, unit)}>{view.headline.label}</div>
        <div className={styles.slideMetricValue} style={fontStyle(valuePt, unit, { textAlign: "left" })}>{view.headline.value}</div>
      </div>,
    );
  }
  const sentence = slide.page?.summaryOverride ?? view.sentence;
  if (sentence) {
    const pt = fitBlock([sentence], { w: innerW, h: 0.66 }, 12.5, 7);
    children.push(<div className={styles.summaryLineFull} key="sentence"><div className={styles.slideText + " " + styles.slideTextStrong} style={fontStyle(pt, unit)}>{sentence}</div></div>);
  }
  if (view.filterLine) {
    const pt = fitBlock([view.filterLine], { w: innerW, h: 0.4 }, 10, 7);
    children.push(<div className={styles.summaryLineFull} key="filter"><div className={styles.slideText} style={fontStyle(pt, unit)}>{view.filterLine}</div></div>);
  }
  if (slide.body.face === "single") {
    view.rows.slice(0, 5).forEach((row, index) => {
      const value = [row.value, row.aux, row.tag].filter(Boolean).join(" · ");
      const labelPt = fitBlock([row.label], { w: innerW * 0.55, h: 0.28 }, 11, 7);
      const valuePt = fitBlock([value], { w: innerW * 0.45, h: 0.28 }, 11, 7);
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
    const pt = fitBlock([note], { w: innerW, h: 0.44 }, 9, 7);
    children.push(<div className={styles.summaryLineFull} key={"note-" + index}><div className={styles.slideText} style={fontStyle(pt, unit)}>{note}</div></div>);
  });
  return <div className={styles.slidePanel + " " + styles.summaryPanel} style={rectStyle(rect, unit)} {...interaction}>
    {children}
  </div>;
}

function LegendPanel({ slide, rect, unit, format = (slide.format ?? "wide") as SlideFormat, hoverLabel, onLegendHover, onLegendPin, interaction, legendOptions }: { slide: Extract<PlannedSlide, { kind: "tile" }>; rect: Rect; unit: number; format?: SlideFormat; hoverLabel?: string | null; onLegendHover?: (label: string | null) => void; onLegendPin?: (label: string) => void; interaction?: PanelInteraction; legendOptions?: MapFrameState["legend"] }) {
  const styles = useSurfaceStyles();
  if (!slide.map) return null;
  const legend = slideLegend(slide.map, !slide.muted, undefined, true, format, legendOptions);
  const focus = legendLabelOf(slide.map, slide.style.legendFocus);
  const legendKeys = new Map(legendItemsOf(slide.map).map((entry) => [entry.label, entry.key]));
  const activeLabel = hoverLabel ?? focus;
  return (
    <div className={styles.slidePanel + " " + styles.legendPanel} style={rectStyle(rect, unit)} {...interaction}>
      {legend.items.map((item, index) => {
        const focused = !item.site && focus !== null && item.label === focus;
        const hovered = !item.site && hoverLabel !== null && hoverLabel !== undefined && item.label === hoverLabel;
        const dimmed = activeLabel !== null && activeLabel !== undefined && !item.site && !focused && !hovered;
        const pt = fitBlock([item.label], { w: Math.max(0.2, rect.w - 0.55), h: 0.25 }, 10, 7);
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
        const pt = fitBlock([note], { w: Math.max(0.2, rect.w - 0.3), h: 0.22 }, 8.5, 7);
        return <div className={styles.legendNote} style={fontStyle(pt, unit)} key={"note-" + index}>{note}</div>;
      })}
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

function TextBoxSurface({ boxes, unit, selectedId, onSelect, onTextBox }: { boxes: readonly TextBox[]; unit: number; selectedId?: string; onSelect?: (selection: SurfaceSelection) => void; onTextBox?: (box: TextBox | { id: string; remove: true }) => void }) {
  const styles = useSurfaceStyles();
  const [draft, setDraft] = useState<{ mode: "move" | "resize"; pointerId: number; startX: number; startY: number; box: TextBox } | null>(null);
  const [draftBox, setDraftBox] = useState<TextBox | null>(null);
  const updateDraft = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!draft || draft.pointerId !== event.pointerId) return;
    const dx = (event.clientX - draft.startX) / Math.max(1, unit);
    const dy = (event.clientY - draft.startY) / Math.max(1, unit);
    const next = draft.mode === "move"
      ? { ...draft.box, x: Math.max(0, draft.box.x + dx), y: Math.max(0, draft.box.y + dy) }
      : { ...draft.box, w: Math.max(1, draft.box.w + dx), h: Math.max(0.45, draft.box.h + dy) };
    setDraftBox(next);
    event.preventDefault();
  };
  const endDraft = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!draft || draft.pointerId !== event.pointerId) return;
    onTextBox?.(draftBox ?? draft.box);
    setDraft(null);
    setDraftBox(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const beginDraft = (mode: "move" | "resize", box: TextBox, event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDraft({ mode, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, box });
    setDraftBox(box);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  return <>{boxes.map((box) => {
    const selected = selectedId === box.id;
    const visibleBox = draftBox?.id === box.id ? draftBox : box;
    return <div
      key={box.id}
      className={styles.textBox ?? styles.slidePanel}
      data-text-box={box.id}
      tabIndex={selected ? 0 : -1}
      style={{ position: "absolute", left: visibleBox.x * unit, top: visibleBox.y * unit, width: visibleBox.w * unit, height: visibleBox.h * unit, padding: 0.08 * unit, color: "#16181d", background: selected ? "rgba(255,255,255,.78)" : "transparent", fontSize: (visibleBox.pt / 72) * unit, lineHeight: 1.25, whiteSpace: "pre-wrap", overflow: "hidden", outline: selected ? `${Math.max(1, unit * 0.02)}px solid #164e9b` : undefined }}
      onClick={() => onSelect?.({ kind: "textBox", id: box.id })}
      contentEditable={selected}
      suppressContentEditableWarning
      onBlur={(event) => {
        const text = event.currentTarget.textContent ?? "";
        if (text !== box.text) onTextBox?.({ ...box, text });
      }}
      onKeyDown={(event) => {
        if (event.key === "Delete" && selected) {
          event.preventDefault();
          onTextBox?.({ id: box.id, remove: true });
        }
        if (selected && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault();
          const dx = event.key === "ArrowRight" ? 0.08 : event.key === "ArrowLeft" ? -0.08 : 0;
          const dy = event.key === "ArrowDown" ? 0.08 : event.key === "ArrowUp" ? -0.08 : 0;
          onTextBox?.({ ...box, x: Math.max(0, box.x + dx), y: Math.max(0, box.y + dy) });
        }
      }}
    >{visibleBox.text}{selected && <><button type="button" className={styles.textBoxMoveHandle} aria-label="글상자 이동" onPointerDown={(event) => beginDraft("move", visibleBox, event)} onPointerMove={updateDraft} onPointerUp={endDraft} onPointerCancel={endDraft}>↕</button><button type="button" className={styles.textBoxResizeHandle} aria-label="글상자 크기 조절" onPointerDown={(event) => beginDraft("resize", visibleBox, event)} onPointerMove={updateDraft} onPointerUp={endDraft} onPointerCancel={endDraft}>↘</button></>}</div>;
  })}</>;
}

function CoverSurface({ slide, unit, basemap, interactive, thumbnail = false, onPatch, onDirectPatch }: { slide: Extract<PlannedSlide, { kind: "cover" }>; unit: number; basemap: BasemapChoice; interactive: boolean; thumbnail?: boolean; onPatch: (patch: PreviewStylePatch) => void; onDirectPatch?: (patch: PreviewStylePatch) => void }) {
  const format = (slide.format ?? "wide") as SlideFormat;
  const styles = useSurfaceStyles();
  const map = slide.map;
  const layout = coverLayout({ address: slide.address, metricCount: slide.metrics.length, lineCount: slide.lines.length, incomplete: !!slide.incomplete }, format);
  const mapPanels = { title: layout.left, summary: layout.right, legend: null };
  return (
    <>
      {map && <MapLayer model={map} style={slide.style} unit={unit} basemap={basemap} panels={mapPanels} siteX={0.5} interactive={interactive} thumbnail={thumbnail} onPatch={onPatch} onDirectPatch={onDirectPatch} format={format} label="표지 지도" />}
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
      <SlideFooter slide={slide} unit={unit} />
    </>
  );
}

function SourcesSurface({ slide, unit, basemap, thumbnail = false }: { slide: Extract<PlannedSlide, { kind: "sources" }>; unit: number; basemap: BasemapChoice; thumbnail?: boolean }) {
  const format = (slide.format ?? "wide") as SlideFormat;
  const styles = useSurfaceStyles();
  const layout = sourceLayout(slide.rows.length, slide.style, format);
  const mapPanels = { title: layout.title, summary: null, legend: null };
  const map = slide.map;
  const kind = layout.dense;
  return (
    <>
      {map && <MapLayer model={map} style={slide.style} unit={unit} basemap={basemap} panels={mapPanels} siteX={0.5} interactive={false} thumbnail={thumbnail} onPatch={() => undefined} format={format} label="출처 장 배경 지도" />}
      <div className={styles.sourceSlide}>
        <ReportTitlePanel color="#7A7E87" code="" title="자료 출처와 기준일" kind="" rect={layout.title} unit={unit} />
        <div className={styles.sourceTableWrap} style={rectStyle(layout.table, unit)}>
          <table className={styles.sourceTable}>
            <colgroup><col style={{ width: "24%" }} /><col style={{ width: "14%" }} /><col style={{ width: "16%" }} /><col style={{ width: "25%" }} /><col style={{ width: "21%" }} /></colgroup>
            <thead><tr><th style={fontStyle(kind ? 9 : 11, unit)}>제공처·자료</th><th style={fontStyle(kind ? 9 : 11, unit)}>기준일</th><th style={fontStyle(kind ? 9 : 11, unit)}>이용조건</th><th style={fontStyle(kind ? 9 : 11, unit)}>원문 확인</th><th style={fontStyle(kind ? 9 : 11, unit)}>사용한 타일</th></tr></thead>
            <tbody>{slide.rows.map((row) => <tr key={row.source + "|" + row.asOf}><td className={styles.sourceCell} style={fontStyle(kind ? 9 : 11, unit)}><b>{row.provider || "제공처 미기록"}</b><br />{row.source}</td><td className={styles.sourceCell} style={fontStyle(kind ? 9 : 11, unit)}>{row.asOf}</td><td className={styles.sourceCell} style={fontStyle(kind ? 9 : 11, unit)}>{row.license || "미기록"}</td><td className={styles.sourceCell} style={fontStyle(kind ? 9 : 11, unit)}>{row.url ? <a href={row.url}>원문 확인</a> : "원문 링크 미기록"}</td><td className={styles.sourceCell} style={fontStyle(kind ? 9 : 11, unit)}>{row.tiles}</td></tr>)}</tbody>
          </table>
        </div>
        <p className={styles.sourceAsOf} style={{ ...rectStyle(layout.footer, unit), ...fontStyle(9, unit) }}>분석 생성일 {slide.analysisDate} · 기준일은 원천 자료 날짜{slide.rows.length > 12 ? ` · 원천 ${slide.rows.length}건` : ""}</p>
      </div>
      <SlideFooter slide={slide} unit={unit} />
    </>
  );
}

function SheetSurface({ slide, unit, basemap, thumbnail = false, onCellActivate }: { slide: Extract<PlannedSlide, { kind: "sheet" }>; unit: number; basemap: BasemapChoice; thumbnail?: boolean; onCellActivate?: (index: number) => void }) {
  const format = (slide.format ?? "wide") as SlideFormat;
  const styles = useSurfaceStyles();
  const cellRects = sheetCells(slide.grid as SheetGrid);
  const geometry = slideGeometry(format);
  const titleRect = titlePlateRect("SHEET", slide.view.title, slide.grid, geometry.w - 2 * geometry.edge, slide.style, false, format);
  return (
    <>
      <div className={styles.sheetSlide}>
        <ReportTitlePanel color={slide.view.color} code="SHEET" title={slide.view.title} kind={slide.grid} rect={titleRect} unit={unit} />
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
            return (
              <div className={styles.sheetCell} style={rectStyle(rect, unit)} key={cell.mapKey}>
                {chart ? <ChartPlaceholder view={cell.view} unit={unit} /> : model ? (
                  <div className={styles.sheetCellMap}>
                    <MapFigure
                      model={cell.reportFrame ? modelWithHiddenLayers(model, cell.reportFrame.hiddenLayers) : model}
                      width={width}
                      height={height}
                      fixed
                      basemap={thumbnail ? "none" : "tiles"}
                      layer={cell.reportFrame?.basemap === "air" ? "Satellite" : cell.reportFrame?.basemap === "none" ? "white" : cell.reportFrame?.basemap === "road" || cell.reportFrame?.basemap === "base" ? "Base" : basemap}
                      legend={false}
                      north={cell.reportFrame?.decorations.north ? 24 : false}
                      credit={false}
                      scale={cell.reportFrame?.decorations.scaleBar ?? false}
                      viewport={slideViewport(model, cell.reportFrame ? { ...(cell.style ?? slide.style), zoomDelta: cell.reportFrame.scaleDenominator === null ? cell.reportFrame.zoomDelta : zoomForScale(cell.reportFrame.scaleDenominator, mapWidthMmFor(format, slide.page?.layout), model.radiusM), offsetM: cell.reportFrame.offsetM } : cell.style ?? slide.style, { width, height, siteX: 0.5, fill: 0.8 })}
                      pinnedKeys={cell.reportFrame ? [...new Set([...(cell.pinnedKeys ?? []), ...cell.reportFrame.pinnedKeys])] : cell.pinnedKeys ?? cell.style?.pinnedKeys ?? slide.style.pinnedKeys ?? []}
                      hiddenKeys={cell.reportFrame?.legend.hidden}
                      legendFocus={legendLabelOf(model, cell.style?.legendFocus ?? slide.style.legendFocus)}
                      highlightLabel={legendLabelOf(model, cell.style?.legendFocus ?? slide.style.legendFocus)}
                      showAutomaticLabels
                    />
                    {cell.reportFrame?.decorations.locator && <LocatorInset model={model} unit={unit} basemap={basemap} />}
                  </div>
                ) : <VisualPlaceholder title={cell.view.title} message="이 장은 지도 대신 도판으로 표시됩니다." unit={unit} />}
                <span className={styles.sheetLabel} style={fontStyle(9, unit)}>{cell.view.code} · {cell.view.title}</span>
                {onCellActivate && !thumbnail && <button type="button" className={styles.sheetCellButton} data-sheet-cell-index={index} aria-label={`${cell.view.code} ${cell.view.title} 타일 선택`} onClick={() => onCellActivate(index)} />}
              </div>
            );
          })}
        </div>
      </div>
      <SlideFooter slide={slide} unit={unit} />
    </>
  );
}

function LocatorInset({ model, unit, basemap }: { model: NonNullable<ReturnType<typeof mapForSlide>>; unit: number; basemap: BasemapChoice }) {
  const styles = useSurfaceStyles();
  const width = Math.max(80, Math.round(unit * 2.2));
  const height = Math.max(52, Math.round(unit * 1.35));
  const locatorModel = { ...model, radiusM: Math.max(model.radiusM * 3, model.radiusM + 1), features: [], polygons: [], lines: [], total: 0 };
  return <div className={styles.locatorInset ?? styles.surfaceRoot} data-map-locator="true" aria-label="위치도" style={{ width, height }}><MapFigure model={locatorModel} width={width} height={height} fixed basemap="none" layer={basemap} legend={false} north={false} scale={false} credit={false} showAutomaticLabels={false} viewport={slideViewport(locatorModel, undefined, { width, height, siteX: 0.5, siteY: 0.5, fill: 0.82 })} /></div>;
}

function TileSurface({ slide, unit, basemap, panels, interactive, thumbnail = false, onPatch, onDirectPatch, panelInteraction, staticSurface = false, onText }: { slide: Extract<PlannedSlide, { kind: "tile" }>; unit: number; basemap: BasemapChoice; panels: { title: Rect; summary: Rect | null; legend: Rect | null }; interactive: boolean; thumbnail?: boolean; onPatch: (patch: PreviewStylePatch) => void; onDirectPatch?: (patch: PreviewStylePatch) => void; panelInteraction?: (key: PanelKey) => PanelInteraction; staticSurface?: boolean; onText?: (kind: "title" | "summary") => void }) {
  const format = (slide.format ?? "wide") as SlideFormat;
  const styles = useSurfaceStyles();
  const model = slide.map;
  const reportFrame = slide.page?.kind === "tile" ? slide.page.frame : undefined;
  const layoutName = slide.page?.layout;
  const mapWidthMm = mapWidthMmFor(format, layoutName);
  const mapStyle: PageStyle = reportFrame && model ? {
    ...slide.style,
    zoomDelta: reportFrame.scaleDenominator === null ? reportFrame.zoomDelta : zoomForScale(reportFrame.scaleDenominator, mapWidthMm, model.radiusM),
    offsetM: [...reportFrame.offsetM] as [number, number],
    pinnedKeys: [...new Set([...(slide.style.pinnedKeys ?? []), ...reportFrame.pinnedKeys])],
    hiddenKeys: [...new Set([...(slide.style.hiddenKeys ?? []), ...reportFrame.legend.hidden])],
  } : slide.style;
  const displayModel = model && reportFrame ? modelWithHiddenLayers(model, reportFrame.hiddenLayers) : model;
  const chart = !model && !slide.mass && !slide.rose && slide.body.face !== "single";
  const terrainShown = slide.view.code === "D17" && !!slide.view.terrainSections && !!slide.terrainSection;
  const terrainLayout = terrainShown ? terrainSectionLayout(panels, slideLayout(format), format) : null;
  const calloutEntries = slide.callout?.page === 0
    ? [
        { text: slide.callout.model.legend.title },
        ...slide.callout.model.legend.items.map((item) => ({ text: item.label, color: item.color, hollow: item.hollow === true })),
        { text: slide.callout.model.legend.sizeLabel },
      ]
    : [];
  const calloutAlignment = model ? slideCalloutAvoidance(panels, calloutEntries, slideLayout(format), format) : null;
  const geometry = slideGeometry(format);
  const width = Math.max(1, Math.round(geometry.w * unit));
  const height = Math.max(1, Math.round(geometry.h * unit));
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
  const mapLayout = slide.page?.layout === "numbers-first" || slide.page?.layout === "side-by-side" ? layoutRects(slide.page.layout, format).map : null;
  const mapFrame = mapLayout ? { x: mapLayout.x * geometry.w, y: mapLayout.y * geometry.h, w: mapLayout.w * geometry.w, h: mapLayout.h * geometry.h } : null;
  return (
    <>
      {displayModel ? <div data-surface-map={mapFrame ? "true" : undefined} style={mapFrame ? { position: "absolute", left: String(Number((mapLayout!.x * 100).toFixed(2))) + "%", top: String(Number((mapLayout!.y * 100).toFixed(2))) + "%", width: String(Number((mapLayout!.w * 100).toFixed(2))) + "%", height: String(Number((mapLayout!.h * 100).toFixed(2))) + "%" } : undefined}><MapLayer model={displayModel} style={mapStyle} unit={unit} basemap={basemap} panels={panels} siteX={slideSiteX(mapStyle, panels.summary !== null, format)} pinnedKeys={mapStyle.pinnedKeys} interactive={interactive} thumbnail={thumbnail} onPatch={onPatch} onDirectPatch={onDirectPatch} hoverLegend={hoverLegend} terrainSection={slide.view.code === "D17" ? slide.terrainSection ?? "A" : undefined} terrainLayout={terrainLayout} calloutLegend={calloutAlignment?.calloutLegend} calloutTop={calloutAlignment ? calloutAlignment.calloutTop * unit : undefined} calloutLeftBottom={calloutAlignment?.calloutLeftBottom ? calloutAlignment.calloutLeftBottom * unit : undefined} northAvoid={northAvoid} scale={!(slide.callout && slide.callout.page > 0)} frame={mapFrame ?? undefined} format={format} label={slide.view.title + " 지도"} reportFrame={reportFrame} /></div> : slide.mass ? <VisualPlaceholder title={slide.view.title} message="3D 매스 미리보기는 내보내기와 같은 페이지 위치로 표시됩니다." unit={unit} /> : slide.rose ? <VisualPlaceholder title={slide.view.title} message="바람장미 도판 미리보기" unit={unit} /> : chart ? <ChartPlaceholder view={slide.view} unit={unit} /> : <VisualPlaceholder title={slide.view.title} message={slide.body.kind === "state" ? slide.body.message : "표시할 지도 결과가 없습니다."} unit={unit} />}
      {model && reportFrame?.decorations.locator && model.radiusM > 0 && <LocatorInset model={model} unit={unit} basemap={basemap} />}
      {terrainShown && <TerrainSectionPreview slide={slide} unit={unit} layout={terrainLayout} />}
      {slide.body.kind === "state" && <div className={styles.slidePanel} style={{ left: unit * 4, top: unit * 2.7, width: unit * 5.1, height: unit * 1.15 }}><div className={styles.slideText + " " + styles.slideTextStrong} style={fontStyle(16, unit)}>{slide.body.message}</div></div>}
      <div onDoubleClick={() => onText?.("title")}><TitlePanel slide={slide} rect={panels.title} unit={unit} interaction={panelInteraction?.("title")} /></div>
      {panels.summary && hasSummaryPanel(slide) && <div onDoubleClick={() => onText?.("summary")}><SummaryPanel slide={slide} rect={terrainLayout?.summary ?? panels.summary} unit={unit} terrainSectionShown={terrainShown} interaction={panelInteraction?.("summary")} /></div>}
      {panels.legend && <LegendPanel slide={{ ...slide, map: model } as Extract<PlannedSlide, { kind: "tile" }>} rect={panels.legend} unit={unit} format={format} hoverLabel={hoverLegend} onLegendHover={setHoverLegend} onLegendPin={staticSurface || thumbnail ? undefined : onLegendPin} interaction={panelInteraction?.("legend")} legendOptions={reportFrame?.legend} />}
      <SlideFooter slide={slide} unit={unit} />
    </>
  );
}

type PanelTransformFrameProps = {
  panelKey: PanelKey;
  rect: Rect;
  unit: number;
  xGuides: number[];
  yGuides: number[];
  onResizeStart: (direction: ResizeDirection, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onRemove: () => void;
};

function PanelTransformFrame({ panelKey, rect, unit, xGuides, yGuides, onResizeStart, onResizeMove, onResizeEnd, onRemove }: PanelTransformFrameProps) {
  const styles = useSurfaceStyles();
  const directions: ResizeDirection[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  return <>
    <div className={styles.snapGuides} aria-hidden="true">
      {xGuides.map((x) => <span className={styles.snapGuideX} style={{ left: x * unit }} key={`x-${x}`} />)}
      {yGuides.map((y) => <span className={styles.snapGuideY} style={{ top: y * unit }} key={`y-${y}`} />)}
    </div>
    <div className={styles.panelSelectionFrame} data-panel-frame={panelKey} style={rectStyle(rect, unit)} aria-label={`${panelLabelFor(panelKey)} 선택됨`}>
      {directions.map((direction) => <button
        key={direction}
        type="button"
        tabIndex={-1}
        className={styles.panelHandle + " " + styles["panelHandle" + direction.toUpperCase() as keyof typeof styles]}
        data-panel-handle={direction}
        aria-label={`${panelLabelFor(panelKey)} ${direction} 모서리 크기 조절`}
        title={`${panelLabelFor(panelKey)} ${direction} 크기 조절`}
        onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); onResizeStart(direction, event); }}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
      ><span aria-hidden="true" /></button>)}
      {panelKey === "summary" && <button type="button" className={styles.panelRemove} data-panel-action="remove" aria-label="요약 탭 숨기기" title="요약 탭 숨기기" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemove(); }}><InlineIcon name="close" size={14} /></button>}
    </div>
  </>;
}

function SlidePreview({ slide, basemap, editable, format: requestedFormat, mapActive, staticSurface = false, selection, onSelect, onTextBox, onText, thumbnail = false, onSheetCellActivate, onPatch, onMapPatch, onDirectPatch }: { slide: PlannedSlide; basemap: BasemapChoice; editable: boolean; format?: SlideFormat; mapActive?: boolean; staticSurface?: boolean; selection?: SurfaceSelection; onSelect?: (selection: SurfaceSelection) => void; onTextBox?: (box: TextBox | { id: string; remove: true }) => void; onText?: (kind: "title" | "summary") => void; thumbnail?: boolean; onSheetCellActivate?: (index: number) => void; onPatch: (patch: PreviewStylePatch) => void; onMapPatch: (patch: PreviewStylePatch) => void; onDirectPatch?: (patch: PreviewStylePatch) => void }) {
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
  const displaySlide = Object.keys(draftStyle).length > 0 ? { ...slide, style: { ...slide.style, ...draftStyle } } : slide;
  const displayModel = mapForSlide(displaySlide);
  const hasSummary = hasSummaryPanel(displaySlide);
  const terrainSectionShown = displaySlide.kind === "tile" && displaySlide.view.code === "D17" && !!displaySlide.view.terrainSections && !!displaySlide.terrainSection;
  const baseLegend = displayModel && displaySlide.kind === "tile" ? slideLegend(displayModel, !displaySlide.muted, undefined, hasSummary, format).rect : null;
  const legacyPanels = slidePanelRects(displaySlide.style, hasSummary, baseLegend, format);
  const layoutName = displaySlide.page?.layout ?? "map-summary";
  const customLayout = layoutName === "numbers-first" || layoutName === "side-by-side";
  const size = slideSize(format);
  const layout = customLayout ? layoutRects(layoutName, format) : null;
  const toRect = (rect: { x: number; y: number; w: number; h: number } | null) => rect ? { x: rect.x * size.w, y: rect.y * size.h, w: rect.w * size.w, h: rect.h * size.h } : null;
  const panels = layout
    ? { title: toRect(layout.title)!, summary: toRect(layout.summary), legend: toRect(layout.legend) }
    : legacyPanels;
  const panelRects: Partial<Record<PanelKey, Rect>> = { title: panels.title, summary: panels.summary ?? undefined, legend: panels.legend ?? undefined };
  const existingPanels = ((displaySlide.style as PageStyle & { panels?: Partial<Record<PanelKey, PanelRatio>> }).panels ?? {});

  useEffect(() => {
    setSelectedPanel(null);
    setDraftStyle({});
    setSnapGuides({ x: [], y: [] });
    panelDrag.current = null;
    panelResize.current = null;
  }, [slide.key]);
  useEffect(() => {
    if (selection?.kind === "panel") setSelectedPanel(selection.key);
    else if (selection === null) setSelectedPanel(null);
  }, [selection]);
  useEffect(() => {
    if (!hasSummary && selectedPanel === "summary") setSelectedPanel(null);
    if (!panelRects[selectedPanel ?? "title"] && selectedPanel !== null) setSelectedPanel(null);
  }, [hasSummary, panels.summary, panels.legend, selectedPanel]);
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
    const state = panelDrag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = (event.clientX - state.x) / Math.max(1, unit);
    const dy = (event.clientY - state.y) / Math.max(1, unit);
    const next = snapPanelRect(state.key, { ...state.rect, x: state.rect.x + dx, y: state.rect.y + dy }, panelRects, format);
    commitPanel(state.key, next.rect);
    panelDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onPanelMoveStart = (key: PanelKey, event: ReactPointerEvent<HTMLDivElement>) => {
    if (!editable || !onDirectPatch || selectedPanel !== key || event.button !== 0) return;
    const rect = panelRects[key];
    if (!rect) return;
    panelDrag.current = { pointerId: event.pointerId, key, x: event.clientX, y: event.clientY, rect };
    event.currentTarget.setPointerCapture(event.pointerId);
    setSnapGuides({ x: [], y: [] });
  };
  const onPanelKeyDown = (key: PanelKey, event: React.KeyboardEvent<HTMLDivElement>) => {
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
    tabIndex: 0,
    role: "group",
    "aria-label": panelLabelFor(key) + (selectedPanel === key ? " 선택됨" : " 선택"),
    onPointerDown: (event) => {
      if ((event.target as HTMLElement).closest("[data-panel-action]")) return;
      event.stopPropagation();
      if (selectedPanel !== key) {
        setSelectedPanel(key);
        onSelect?.({ kind: "panel", key });
        return;
      }
      onPanelMoveStart(key, event);
    },
    onPointerMove: onPanelMove,
    onPointerUp: onPanelMoveEnd,
    onPointerCancel: onPanelMoveEnd,
    onKeyDown: (event) => onPanelKeyDown(key, event),
  });
  const handles = editable && displaySlide.kind === "tile" && selectedPanel && panelRects[selectedPanel]
    ? <PanelTransformFrame panelKey={selectedPanel} rect={panelRects[selectedPanel]!} unit={unit} xGuides={snapGuides.x} yGuides={snapGuides.y} onResizeStart={onResizeStart} onResizeMove={onResizeMove} onResizeEnd={onResizeEnd} onRemove={() => { if (selectedPanel === "summary") { setSelectedPanel(null); onDirectPatch?.({ summary: false }); } }} />
    : null;
  return (
    <div ref={slotRef} className={styles.previewSlot} data-preview-slot="true">
      <div className={styles.previewFrame} data-preview-frame="true" style={frameSize.width > 0 ? { width: frameSize.width, height: frameSize.height, ...(format === "wide" ? {} : { aspectRatio: String(size.w.toFixed(3)) + " / " + String(size.h.toFixed(3)) }) } : format === "wide" ? undefined : { aspectRatio: String(size.w.toFixed(3)) + " / " + String(size.h.toFixed(3)) }}>
        <div
          className={styles.slideCanvas}
          data-slide-canvas="true"
          style={canvasStyle(unit)}
          onPointerDownCapture={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest("[data-preview-map]")) {
              onSelect?.({ kind: "map" });
              return;
            }
            if (!target.closest("[data-panel-key]") && !target.closest("[data-panel-frame]") && !target.closest("[data-text-box]")) {
              setSelectedPanel(null);
              onSelect?.(null);
            }
          }}
          onDragStart={(event) => event.preventDefault()}
          onKeyDown={(event) => { if (event.key === "Escape") { setSelectedPanel(null); onSelect?.(null); } }}
          data-transforming={panelDrag.current || panelResize.current ? "true" : "false"}
          data-map-selected={selection?.kind === "map" ? "true" : undefined}
        >
        {displaySlide.kind === "cover" && displaySlide.page?.kind !== "blank" && <CoverSurface slide={displaySlide} unit={unit} basemap={basemap} interactive={!!(editable && (mapActive ?? editable) && !!displayModel)} thumbnail={thumbnail} onPatch={onMapPatch} onDirectPatch={onDirectPatch} />}
        {displaySlide.kind === "sources" && <SourcesSurface slide={displaySlide} unit={unit} basemap={basemap} thumbnail={thumbnail} />}
        {displaySlide.kind === "cover" && displaySlide.page?.kind === "blank" && <BlankSurface unit={unit} />}
        {displaySlide.kind === "sheet" && <SheetSurface slide={displaySlide} unit={unit} basemap={basemap} thumbnail={thumbnail} onCellActivate={onSheetCellActivate} />}
        {displaySlide.kind === "tile" && <TileSurface slide={displaySlide} unit={unit} basemap={basemap} panels={panels} interactive={!!(editable && (mapActive ?? editable) && !!displayModel)} thumbnail={thumbnail} onPatch={onMapPatch} onDirectPatch={onDirectPatch} panelInteraction={editable ? panelInteraction : undefined} staticSurface={staticSurface} onText={onText} />}
        {displaySlide.page?.textBoxes && <TextBoxSurface boxes={displaySlide.page.textBoxes} unit={unit} selectedId={selection?.kind === "textBox" ? selection.id : undefined} onSelect={onSelect} onTextBox={onTextBox} />}
        {handles}
        </div>
      </div>
    </div>
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
        : <span className={styles.thumbMiniText}>{slide.kind === "cover" ? "표지" : slide.kind === "sources" ? "출처" : slide.kind === "sheet" ? "조판" : slide.view.code}</span>}
    </span>
  );
});



export type SurfaceSelection =
  | { kind: "map"; cell?: number }
  | { kind: "panel"; key: "title" | "summary" | "legend" }
  | { kind: "textBox"; id: string }
  | null;

export type SlideSurfaceProps = {
  slide: PlannedSlide;
  basemap: BasemapChoice;
  mode: "edit" | "thumb" | "export";
  selection?: SurfaceSelection;
  onSelect?: (selection: SurfaceSelection) => void;
  onFrame?: (cell: number | undefined, patch: Partial<MapFrameState>) => void;
  onPanels?: (panels: PagePanels) => void;
  onTextBox?: (box: TextBox | { id: string; remove: true }) => void;
  onText?: (kind: "title" | "summary") => void;
  mapActive?: boolean;
  onMapActive?: (active: boolean) => void;
  onStylePatch?: (patch: PreviewStylePatch) => void;
  onMapStylePatch?: (patch: PreviewStylePatch) => void;
  onDirectStylePatch?: (patch: PreviewStylePatch) => void;
  onSheetCellActivate?: (index: number) => void;
  classMap?: Record<string, string>;
};

export function SlideSurface({
  slide,
  basemap,
  mode,
  selection,
  onSelect,
  onFrame,
  onPanels,
  onTextBox,
  onText,
  mapActive,
  onMapActive,
  onStylePatch,
  onMapStylePatch,
  onDirectStylePatch,
  onSheetCellActivate,
  classMap,
}: SlideSurfaceProps) {
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
    if (onDirectStylePatch) onDirectStylePatch(patch);
    else onStylePatch?.(patch);
  };
  const cellActivate = (index: number) => onSheetCellActivate?.(index);
  void onMapActive;
  return (
    <SurfaceStyleContext.Provider value={styles}>
      <div
        className={styles.surfaceRoot}
        data-slide-surface="true"
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
              onSelect={onSelect}
              onTextBox={onTextBox}
              onText={onText}
              onSheetCellActivate={mode === "edit" ? cellActivate : undefined}
              onPatch={mapPatch}
              onMapPatch={mapPatch}
              onDirectPatch={directPatch}
            />}
        {locked && active && <span className={styles.surfaceLockedMessage} data-map-locked="true">지도 위치 고정됨</span>}
      </div>
    </SurfaceStyleContext.Provider>
  );
}
