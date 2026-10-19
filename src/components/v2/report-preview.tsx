"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type Dispatch, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { BasemapChoice } from "@/lib/v2/ui/map-projection";
import { metersPerPixel, slideViewport, zoomViewAt, type MapView } from "@/lib/v2/ui/map-projection";
import { SLIDE, slideLegend, slidePanelRects, slideSiteX, type Rect } from "@/lib/v2/ui/overlay-layout";
import { coverLayout, fitBlock, fitFooterText, sourceLayout, titlePlateRect } from "@/lib/v2/report/pptx-kit";
import { layerStyle, legendItemsOf, legendLabelOf } from "@/lib/v2/ui/map-layers";
import { terrainCrossingLayer, terrainElevationLabel, terrainSectionAxisStops, terrainSectionElevationAt, terrainSectionMarkerGeometry, terrainSectionPosition, terrainSectionTotal, sortTerrainCrossings, TERRAIN_CROSSING_LABELS, TERRAIN_SECTION_LABELS } from "@/lib/v2/ui/terrain-section";
import MapFigure from "./map-figure";
import { useFocusTrap } from "./use-focus-trap";
import { extraPageKey, type BoardAction, type BoardState, type PageKey, type PageStyle } from "@/lib/v2/ui/board-state";
import type { PlannedSlide } from "@/lib/v2/report/report-plan";
import type { TileView } from "@/lib/v2/ui/tile-view";
import { sheetCapacity, sheetCells, type SheetGrid } from "@/lib/v2/ui/sheet";
import { mixedValue, movePageSelection, neighborPageKey, nextExtraPageId, pageKeyAfterInsertion, selectPageKeys, toggleLabelVisibility, toggleLegendFocus, type PageNavigationKey, type PageSelectionModifiers } from "@/lib/v2/ui/report-preview-logic";
import styles from "./report-preview.module.css";

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
const SNAP_THRESHOLD = SLIDE.w * 0.01;
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

function ratioOfRect(rect: Rect): PanelRatio {
  return {
    x: clampNumber(rect.x / SLIDE.w, 0, 1),
    y: clampNumber(rect.y / SLIDE.h, 0, 1),
    w: clampNumber(rect.w / SLIDE.w, 0, 1),
    h: clampNumber(rect.h / SLIDE.h, 0, 1),
  };
}

function panelPatch(key: PanelKey, rect: Rect, existing: Partial<Record<PanelKey, PanelRatio>> = {}): PreviewStylePatch {
  return { panels: { ...existing, [key]: ratioOfRect(rect) } } as unknown as PreviewStylePatch;
}

function safePanelBounds(): { left: number; top: number; right: number; bottom: number } {
  return {
    left: SLIDE.edge,
    top: SLIDE.edge,
    right: SLIDE.w - SLIDE.edge,
    bottom: SLIDE.h - SLIDE.stripH - SLIDE.edge * 0.6,
  };
}

function clampPanelRect(key: PanelKey, rect: Rect): Rect {
  const bounds = safePanelBounds();
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

function snapPanelRect(key: PanelKey, proposed: Rect, all: Partial<Record<PanelKey, Rect>>): { rect: Rect; xGuides: number[]; yGuides: number[] } {
  const bounds = safePanelBounds();
  let rect = clampPanelRect(key, proposed);
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
        if (Math.abs(delta) <= SNAP_THRESHOLD && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, target };
      }
    }
    return best;
  };
  const xSnap = nearest(xEdges, xCandidates);
  const ySnap = nearest(yEdges, yCandidates);
  if (xSnap) rect = clampPanelRect(key, { ...rect, x: rect.x + xSnap.delta });
  if (ySnap) rect = clampPanelRect(key, { ...rect, y: rect.y + ySnap.delta });
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

function useContainFrameSize(ref: React.RefObject<HTMLDivElement | null>): ContainFrameSize {
  const [size, setSize] = useState<ContainFrameSize>({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const maxWidth = element.clientWidth;
      const maxHeight = element.clientHeight;
      if (maxWidth <= 0 || maxHeight <= 0) return;
      const width = Math.floor(Math.min(maxWidth, maxHeight * SLIDE.w / SLIDE.h));
      const height = Math.floor(width * SLIDE.h / SLIDE.w);
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
  }, [ref]);
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
  label: string;
};

const EMPTY_PAGE_KEYS: readonly string[] = [];

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

function MapLayer({ model, style, unit, basemap, panels, siteX, pinnedKeys, interactive, thumbnail = false, onPatch, onDirectPatch, hoverLegend, terrainSection, label }: MapLayerProps) {
  const width = Math.max(1, Math.round(SLIDE.w * unit));
  const height = Math.max(1, Math.round(SLIDE.h * unit));
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
  const baseViewport = useMemo(() => slideViewport(model, undefined, { width, height, siteX, fill: 0.8 }), [height, model, siteX, width]);
  const viewport = useMemo(() => slideViewport(model, style, { width, height, siteX, fill: 0.8 }), [height, model, siteX, style, width]);
  const focusedLabel = useMemo(() => legendLabelOf(model, style.legendFocus), [model, style.legendFocus]);
  const activeLegendLabel = hoverLegend ?? focusedLabel;
  const avoid = useMemo(() => [panels.title, panels.summary, panels.legend]
    .filter((rect): rect is Rect => !!rect)
    .map((rect) => ({ x0: rect.x * unit, y0: rect.y * unit, x1: (rect.x + rect.w) * unit, y1: (rect.y + rect.h) * unit })), [panels.legend, panels.summary, panels.title, unit]);
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
        basemap={thumbnail ? "none" : "tiles"}
        layer={basemap}
        legend={false}
        north={false}
        credit={false}
        scale
        bottomInset={unit * SLIDE.stripH}
        label={label}
        viewport={viewport}
        avoid={avoid}
        pinnedKeys={style.pinnedKeys ?? pinnedKeys ?? EMPTY_PAGE_KEYS}
        hiddenKeys={style.hiddenKeys ?? EMPTY_PAGE_KEYS}
        legendFocus={focusedLabel}
        highlightLabel={activeLegendLabel}
        highlightPinnedLabel={focusedLabel}
        terrainSection={terrainSection}
        showAutomaticLabels
        previewInteraction={interactive}
        hoverKey={interactive ? hoverKey : null}
        onFeatureHover={interactive ? onFeatureHover : undefined}
        onFeaturePin={onFeaturePin}
        dragging={dragging}
      />
    </div>
  );
  if (!interactive) return <div className={styles.slideMap}>{map}</div>;
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
  const footer = fitFooterText(slide.footer, slide.kind !== "sheet" && !!slide.map);
  return (
    <div className={styles.slideFooter}>
      <span className={styles.slideFooterText} style={fontStyle(footer.fontSize, unit)}>{footer.text}</span>
      <span className={styles.slideFooterPage}>{slide.no} / {slide.total}</span>
    </div>
  );
}

function ReportTitlePanel({ color, code, title, kind, rect, unit, interaction }: { color: string; code: string; title: string; kind: string; rect: Rect; unit: number; interaction?: PanelInteraction }) {
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

function TitlePanel({ slide, rect, unit, interaction }: { slide: Extract<PlannedSlide, { kind: "tile" }>; rect: Rect; unit: number; interaction?: PanelInteraction }) {
  return <ReportTitlePanel color={slide.view.color} code={slide.view.code} title={slide.view.title} kind={slide.view.kindLabel} rect={rect} unit={unit} interaction={interaction} />;
}

function SummaryPanel({ slide, rect, unit, interaction }: { slide: Extract<PlannedSlide, { kind: "tile" }>; rect: Rect; unit: number; interaction?: PanelInteraction }) {
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
  if (view.sentence) {
    const pt = fitBlock([view.sentence], { w: innerW, h: 0.66 }, 12.5, 7);
    children.push(<div className={styles.summaryLineFull} key="sentence"><div className={styles.slideText + " " + styles.slideTextStrong} style={fontStyle(pt, unit)}>{view.sentence}</div></div>);
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
  const notes = [...view.caveats, ...view.notes].slice(0, 4);
  notes.forEach((note, index) => {
    const pt = fitBlock([note], { w: innerW, h: 0.44 }, 9, 7);
    children.push(<div className={styles.summaryLineFull} key={"note-" + index}><div className={styles.slideText} style={fontStyle(pt, unit)}>{note}</div></div>);
  });
  return <div className={styles.slidePanel + " " + styles.summaryPanel} style={rectStyle(rect, unit)} {...interaction}>
    {children}
  </div>;
}

function LegendPanel({ slide, rect, unit, hoverLabel, onLegendHover, onLegendPin, interaction }: { slide: Extract<PlannedSlide, { kind: "tile" }>; rect: Rect; unit: number; hoverLabel?: string | null; onLegendHover?: (label: string | null) => void; onLegendPin?: (label: string) => void; interaction?: PanelInteraction }) {
  if (!slide.map) return null;
  const legend = slideLegend(slide.map, !slide.muted);
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
        if (!onLegendPin) return (
          <div className={styles.legendRow} key={key + "-" + index}>
            <span className={styles.legendSwatch} style={{ background: item.color }} aria-hidden="true" />
            <span className={styles.legendText} style={fontStyle(pt, unit)}>{item.label}</span>
          </div>
        );
          return (
          <button key={key + "-" + index} type="button" className={rowClass} data-panel-action="legend-item" data-preview-legend={item.label} aria-label={`${item.label} 범례 강조`} aria-pressed={focused} title={instruction} onClick={() => onLegendPin?.(key)} onPointerEnter={(event) => { if (event.pointerType !== "touch") onLegendHover?.(item.label); }} onPointerLeave={() => onLegendHover?.(null)} onFocus={() => onLegendHover?.(item.label)} onBlur={() => onLegendHover?.(null)}>
            <span className={styles.legendSwatch} style={{ background: item.color }} aria-hidden="true" />
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

const TERRAIN_CAVEAT = "등고선·표고점 보간값(추정)입니다. 현장 실측을 대신하지 않습니다.";

function TerrainSectionPreview({ slide, unit, panels }: { slide: Extract<PlannedSlide, { kind: "tile" }>; unit: number; panels: { summary: Rect | null } }) {
  const sections = slide.view.terrainSections;
  if (!sections || !slide.terrainSection) return null;
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
  const previewW = Math.max(4.2, Math.min(6.5, (panels.summary?.x ?? SLIDE.w) - 0.55));
  const preview = { left: 0.32, top: 3.05, width: previewW, height: 2.22 };
  return (
    <section className={styles.terrainPreview} style={{ left: preview.left * unit, top: preview.top * unit, width: preview.width * unit, height: preview.height * unit }} aria-label={`${TERRAIN_SECTION_LABELS[slide.terrainSection]} 보고서 미리보기`}>
      <div className={styles.terrainPreviewHeader}>
        <strong style={fontStyle(9.5, unit)}>{TERRAIN_SECTION_LABELS[slide.terrainSection]} · 지형 단면</strong>
        <span style={fontStyle(7.5, unit)}>대지 음영 · 단차 시설 표식</span>
      </div>
      <div className={styles.terrainPreviewGraphShell}>
        <div className={styles.terrainPreviewYAxis} aria-hidden="true">
          <span style={fontStyle(8.5, unit)}>{terrainElevationLabel(maxZ)}</span>
          <span style={fontStyle(8.5, unit)}>{terrainElevationLabel(minZ)}</span>
        </div>
        <div className={styles.terrainPreviewGraphMain}>
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
        <tbody>{crossings.slice(0, 2).map((crossing, index) => <tr key={`${crossing.d}-${crossing.kind}-${index}`}><td>{TERRAIN_CROSSING_LABELS[crossing.kind]}</td><td>{terrainSectionPosition(section, crossing.d)}</td><td>{crossing.heightM === null ? "높이 미확인" : `${crossing.heightM.toFixed(1)}m`}</td></tr>)}</tbody>
      </table>
      <div className={styles.terrainPreviewSummary} style={fontStyle(7.4, unit)}>{`대지 고저차 ${format(range, "m")} · 대지 평균 경사 ${format(slope, "°")} · 반경 내 단차 시설 수 ${facilityCount}개`}</div>
      <div className={styles.terrainPreviewCaveat} style={fontStyle(6.5, unit)}>{TERRAIN_CAVEAT}</div>
    </section>
  );
}

function VisualPlaceholder({ title, message, unit }: { title: string; message: string; unit: number }) {
  return (
    <div className={styles.chartPlaceholder}>
      <strong className={styles.slideTitle} style={fontStyle(18, unit)}>{title}</strong>
      <span className={styles.slideText} style={fontStyle(11, unit)}>{message}</span>
    </div>
  );
}

function CoverSurface({ slide, unit, basemap, interactive, thumbnail = false, onPatch, onDirectPatch }: { slide: Extract<PlannedSlide, { kind: "cover" }>; unit: number; basemap: BasemapChoice; interactive: boolean; thumbnail?: boolean; onPatch: (patch: PreviewStylePatch) => void; onDirectPatch?: (patch: PreviewStylePatch) => void }) {
  const map = slide.map;
  const layout = coverLayout({ address: slide.address, metricCount: slide.metrics.length, lineCount: slide.lines.length, incomplete: !!slide.incomplete });
  const mapPanels = { title: layout.left, summary: layout.right, legend: null };
  return (
    <>
      {map && <MapLayer model={map} style={slide.style} unit={unit} basemap={basemap} panels={mapPanels} siteX={0.5} interactive={interactive} thumbnail={thumbnail} onPatch={onPatch} onDirectPatch={onDirectPatch} label="표지 지도" />}
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
  const layout = sourceLayout(slide.rows.length, slide.style);
  const mapPanels = { title: layout.title, summary: null, legend: null };
  const map = slide.map;
  const kind = layout.dense;
  return (
    <>
      {map && <MapLayer model={map} style={slide.style} unit={unit} basemap={basemap} panels={mapPanels} siteX={0.5} interactive={false} thumbnail={thumbnail} onPatch={() => undefined} label="출처 장 배경 지도" />}
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
  const cellRects = sheetCells(slide.grid as SheetGrid);
  const titleRect = titlePlateRect("SHEET", slide.view.title, slide.grid, SLIDE.w - 2 * SLIDE.edge, slide.style, false);
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
                      model={model}
                      width={width}
                      height={height}
                      fixed
                      basemap={thumbnail ? "none" : "tiles"}
                      layer={basemap}
                      legend={false}
                      north={false}
                      credit={false}
                      scale={false}
                      viewport={slideViewport(model, cell.style ?? slide.style, { width, height, siteX: 0.5, fill: 0.8 })}
                      pinnedKeys={cell.pinnedKeys ?? cell.style?.pinnedKeys ?? slide.style.pinnedKeys ?? []}
                      legendFocus={legendLabelOf(model, cell.style?.legendFocus ?? slide.style.legendFocus)}
                      highlightLabel={legendLabelOf(model, cell.style?.legendFocus ?? slide.style.legendFocus)}
                      showAutomaticLabels
                    />
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

function TileSurface({ slide, unit, basemap, panels, interactive, thumbnail = false, onPatch, onDirectPatch, panelInteraction }: { slide: Extract<PlannedSlide, { kind: "tile" }>; unit: number; basemap: BasemapChoice; panels: { title: Rect; summary: Rect | null; legend: Rect | null }; interactive: boolean; thumbnail?: boolean; onPatch: (patch: PreviewStylePatch) => void; onDirectPatch?: (patch: PreviewStylePatch) => void; panelInteraction?: (key: PanelKey) => PanelInteraction }) {
  const model = slide.map;
  const chart = !model && !slide.mass && !slide.rose && slide.body.face !== "single";
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
      {model ? <MapLayer model={model} style={slide.style} unit={unit} basemap={basemap} panels={panels} siteX={slideSiteX(slide.style, panels.summary !== null)} pinnedKeys={slide.pinnedKeys} interactive={interactive} thumbnail={thumbnail} onPatch={onPatch} onDirectPatch={onDirectPatch} hoverLegend={hoverLegend} terrainSection={slide.view.code === "D17" ? slide.terrainSection ?? "A" : undefined} label={slide.view.title + " 지도"} /> : slide.mass ? <VisualPlaceholder title={slide.view.title} message="3D 매스 미리보기는 내보내기와 같은 페이지 위치로 표시됩니다." unit={unit} /> : slide.rose ? <VisualPlaceholder title={slide.view.title} message="바람장미 도판 미리보기" unit={unit} /> : chart ? <ChartPlaceholder view={slide.view} unit={unit} /> : <VisualPlaceholder title={slide.view.title} message={slide.body.kind === "state" ? slide.body.message : "표시할 지도 결과가 없습니다."} unit={unit} />}
      {slide.view.code === "D17" && <TerrainSectionPreview slide={slide} unit={unit} panels={panels} />}
      {slide.body.kind === "state" && <div className={styles.slidePanel} style={{ left: unit * 4, top: unit * 2.7, width: unit * 5.1, height: unit * 1.15 }}><div className={styles.slideText + " " + styles.slideTextStrong} style={fontStyle(16, unit)}>{slide.body.message}</div></div>}
      <TitlePanel slide={slide} rect={panels.title} unit={unit} interaction={panelInteraction?.("title")} />
      {panels.summary && hasSummaryPanel(slide) && <SummaryPanel slide={slide} rect={panels.summary} unit={unit} interaction={panelInteraction?.("summary")} />}
      {panels.legend && <LegendPanel slide={slide} rect={panels.legend} unit={unit} hoverLabel={hoverLegend} onLegendHover={setHoverLegend} onLegendPin={thumbnail ? undefined : onLegendPin} interaction={panelInteraction?.("legend")} />}
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

function SlidePreview({ slide, basemap, editable, thumbnail = false, onSheetCellActivate, onPatch, onMapPatch, onDirectPatch }: { slide: PlannedSlide; basemap: BasemapChoice; editable: boolean; thumbnail?: boolean; onSheetCellActivate?: (index: number) => void; onPatch: (patch: PreviewStylePatch) => void; onMapPatch: (patch: PreviewStylePatch) => void; onDirectPatch?: (patch: PreviewStylePatch) => void }) {
  const slotRef = useRef<HTMLDivElement>(null);
  const frameSize = useContainFrameSize(slotRef);
  const unit = frameSize.width > 0 ? frameSize.width / SLIDE.w : 1;
  const [draftStyle, setDraftStyle] = useState<PreviewStylePatch>({});
  const [selectedPanel, setSelectedPanel] = useState<PanelKey | null>(null);
  const [snapGuides, setSnapGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const panelDrag = useRef<{ pointerId: number; key: PanelKey; x: number; y: number; rect: Rect } | null>(null);
  const panelResize = useRef<{ pointerId: number; key: PanelKey; direction: ResizeDirection; x: number; y: number; rect: Rect } | null>(null);
  const displaySlide = Object.keys(draftStyle).length > 0 ? { ...slide, style: { ...slide.style, ...draftStyle } } : slide;
  const displayModel = mapForSlide(displaySlide);
  const hasSummary = hasSummaryPanel(displaySlide);
  // PPT도 D17 단면이 있으면 범례 대신 단면을 그린다(render-pptx).
  const terrainSectionShown = displaySlide.kind === "tile" && displaySlide.view.code === "D17" && !!displaySlide.view.terrainSections && !!displaySlide.terrainSection;
  const baseLegend = displayModel && displaySlide.kind === "tile" ? slideLegend(displayModel, !displaySlide.muted).rect : null;
  const slideRects = slidePanelRects(displaySlide.style, hasSummary, baseLegend);
  const panels = terrainSectionShown ? { ...slideRects, legend: null } : slideRects;
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
    onDirectPatch?.(panelPatch(key, rect, existingPanels));
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
    const snapped = snapPanelRect(state.key, resizeRect(state, event), panelRects);
    previewPatch(panelPatch(state.key, snapped.rect, existingPanels));
    setSnapGuides({ x: snapped.xGuides, y: snapped.yGuides });
    event.preventDefault();
  };
  const onResizeEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = panelResize.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const next = snapPanelRect(state.key, resizeRect(state, event), panelRects);
    commitPanel(state.key, next.rect);
    panelResize.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onPanelMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = panelDrag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = (event.clientX - state.x) / Math.max(1, unit);
    const dy = (event.clientY - state.y) / Math.max(1, unit);
    const snapped = snapPanelRect(state.key, { ...state.rect, x: state.rect.x + dx, y: state.rect.y + dy }, panelRects);
    previewPatch(panelPatch(state.key, snapped.rect, existingPanels));
    setSnapGuides({ x: snapped.xGuides, y: snapped.yGuides });
    event.preventDefault();
  };
  const onPanelMoveEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = panelDrag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = (event.clientX - state.x) / Math.max(1, unit);
    const dy = (event.clientY - state.y) / Math.max(1, unit);
    const next = snapPanelRect(state.key, { ...state.rect, x: state.rect.x + dx, y: state.rect.y + dy }, panelRects);
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
    const stepX = SLIDE.w * 0.01;
    const stepY = SLIDE.h * 0.01;
    const moveX = event.shiftKey ? 0 : event.key === "ArrowRight" ? stepX : event.key === "ArrowLeft" ? -stepX : 0;
    const moveY = event.shiftKey ? 0 : event.key === "ArrowDown" ? stepY : event.key === "ArrowUp" ? -stepY : 0;
    const resizeW = event.shiftKey && event.key === "ArrowRight" ? stepX : event.shiftKey && event.key === "ArrowLeft" ? -stepX : 0;
    const resizeH = event.shiftKey && event.key === "ArrowDown" ? stepY : event.shiftKey && event.key === "ArrowUp" ? -stepY : 0;
    const next = snapPanelRect(key, { ...rect, x: rect.x + moveX, y: rect.y + moveY, w: rect.w + resizeW, h: rect.h + resizeH }, panelRects);
    event.preventDefault();
    event.stopPropagation();
    onDirectPatch(panelPatch(key, next.rect, existingPanels));
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
      <div className={styles.previewFrame} data-preview-frame="true" style={frameSize.width > 0 ? { width: frameSize.width, height: frameSize.height } : undefined}>
        <div
          className={styles.slideCanvas}
          data-slide-canvas="true"
          style={canvasStyle(unit)}
          onPointerDownCapture={(event) => {
            const target = event.target as HTMLElement;
            if (!target.closest("[data-panel-key]") && !target.closest("[data-panel-frame]")) setSelectedPanel(null);
          }}
          onDragStart={(event) => event.preventDefault()}
          onKeyDown={(event) => { if (event.key === "Escape") setSelectedPanel(null); }}
          data-transforming={panelDrag.current || panelResize.current ? "true" : "false"}
        >
        {displaySlide.kind === "cover" && <CoverSurface slide={displaySlide} unit={unit} basemap={basemap} interactive={editable && !!displayModel} thumbnail={thumbnail} onPatch={onMapPatch} onDirectPatch={onDirectPatch} />}
        {displaySlide.kind === "sources" && <SourcesSurface slide={displaySlide} unit={unit} basemap={basemap} thumbnail={thumbnail} />}
        {displaySlide.kind === "sheet" && <SheetSurface slide={displaySlide} unit={unit} basemap={basemap} thumbnail={thumbnail} onCellActivate={onSheetCellActivate} />}
        {displaySlide.kind === "tile" && <TileSurface slide={displaySlide} unit={unit} basemap={basemap} panels={panels} interactive={editable && !!displayModel} thumbnail={thumbnail} onPatch={onMapPatch} onDirectPatch={onDirectPatch} panelInteraction={editable ? panelInteraction : undefined} />}
        {handles}
        </div>
      </div>
    </div>
  );
}

const noopPreviewPatch = (_patch: PreviewStylePatch): void => undefined;

const ThumbnailPreview = memo(function ThumbnailPreview({ slide, basemap }: { slide: PlannedSlide; basemap: BasemapChoice }) {
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

type PageToolbarProps = {
  selectedSlides: PlannedSlide[];
  current: PlannedSlide | null;
  applyPatch: (patch: PreviewStylePatch) => void;
  resetScales: () => void;
  resetLabels: () => void;
  exportStatusRef: RefObject<HTMLParagraphElement | null>;
  exportEnabled: boolean;
  exporting: boolean;
  makingKind: string | null;
  exportProblem: string | null;
  onExport: () => void;
};

function PageToolbar({ selectedSlides, current, applyPatch, resetScales, resetLabels, exportStatusRef, exportEnabled, exporting, makingKind, exportProblem, onExport }: PageToolbarProps) {
  const resetMenuRef = useRef<HTMLDivElement>(null);
  const resetMenuId = useId().replace(/:/g, "");
  const [resetMenuOpen, setResetMenuOpen] = useState(false);
  const targets = selectedSlides.length > 0 ? selectedSlides : current ? [current] : [];
  const mapEnabled = !!(current && mapForSlide(current));
  const summaryEnabled = current?.kind === "tile" && !(current.callout && current.callout.page > 0);
  const zoom = mixedField(targets, (slide) => slide.style.zoomDelta ?? 0, 0);
  const summary = mixedField(targets, (slide) => slide.style.summary !== false, true);

  useEffect(() => {
    if (!resetMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && resetMenuRef.current?.contains(target)) return;
      setResetMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [resetMenuOpen]);

  return (
    <div className={styles.pageToolbar} role="toolbar" aria-label="페이지 직접 조작 도구">
      {targets.length > 1 && <div className={styles.toolbarContext}><strong className={styles.selectionChip}>{targets.length}장에 적용</strong></div>}
      <div className={styles.toolbarActions}>
        <div className={styles.toolbarGroup} aria-label="지도 확대">
          <button type="button" className={styles.smallButton + " " + styles.toolbarIconButton} disabled={!mapEnabled || targets.length === 0} onClick={() => applyPatch({ zoomDelta: clampNumber((zoom.mixed ? 0 : zoom.value) - 0.5, -3, 3) })} aria-label="지도 축소" title="지도 축소" data-tooltip="지도 축소"><InlineIcon name="zoomOut" /></button>
          <span className={styles.toolbarLabel}>{zoom.mixed ? "—" : formatZoom(zoom.value)}</span>
          <button type="button" className={styles.smallButton + " " + styles.toolbarIconButton} disabled={!mapEnabled || targets.length === 0} onClick={() => applyPatch({ zoomDelta: clampNumber((zoom.mixed ? 0 : zoom.value) + 0.5, -3, 3) })} aria-label="지도 확대" title="지도 확대" data-tooltip="지도 확대"><InlineIcon name="zoomIn" /></button>
          <button type="button" className={styles.centerButton + " " + styles.toolbarIconButton} disabled={!mapEnabled || targets.length === 0} onClick={() => applyPatch({ offsetM: [0, 0] })} aria-label="대지 중앙 정렬" title="대지 중앙 정렬" data-tooltip="대지 중앙 정렬"><InlineIcon name="center" /></button>
        </div>
        <button type="button" className={styles.toolbarToggle + " " + styles.toolbarIconButton} disabled={!summaryEnabled || targets.length === 0} aria-pressed={summary.value} aria-label={summary.value ? "요약 탭 숨기기" : "요약 탭 켜기"} title={summary.value ? "요약 탭 숨기기" : "요약 탭 켜기"} data-tooltip={summary.value ? "요약 탭 숨기기" : "요약 탭 켜기"} onClick={() => applyPatch({ summary: !summary.value })}><InlineIcon name="summary" /></button>
        <div ref={resetMenuRef} className={styles.toolbarResetWrap}>
          <button type="button" className={styles.toolbarReset} disabled={targets.length === 0} aria-haspopup="menu" aria-expanded={resetMenuOpen} aria-controls={resetMenuId} onClick={() => setResetMenuOpen((open) => !open)}>초기화 <InlineIcon name="chevronDown" size={14} /></button>
          {resetMenuOpen && <div id={resetMenuId} className={styles.toolbarResetMenu} role="menu" aria-label="초기화">
            <button type="button" role="menuitem" className={styles.toolbarResetMenuItem} disabled={targets.length === 0} onClick={() => { resetScales(); setResetMenuOpen(false); }}>탭 배치 초기화</button>
            <button type="button" role="menuitem" className={styles.toolbarResetMenuItem} disabled={!mapEnabled || !current} onClick={() => { resetLabels(); setResetMenuOpen(false); }}>라벨 초기화</button>
          </div>}
        </div>
        <button type="button" className={styles.toolbarExport} disabled={!exportEnabled || exporting} aria-busy={exporting} onClick={onExport}>내보내기</button>
      </div>
      <p ref={exportStatusRef} className={styles.toolbarStatus + (exportProblem ? " " + styles.footerError : "")} role={exportProblem ? "alert" : "status"} aria-live="polite" aria-busy={exporting} tabIndex={-1}>{exportProblem ?? (exporting ? (makingKind ?? "PPT") + " 내보내는 중…" : "")}</p>
    </div>
  );
}

type Props = {
  board: BoardState;
  dispatch: Dispatch<BoardAction>;
  views: ReadonlyMap<string, TileView>;
  plan: PlannedSlide[];
  basemap: BasemapChoice;
  onClose: () => void;
  onExport: () => void | Promise<void>;
  exportEnabled: boolean;
  exporting: boolean;
  makingKind: string | null;
  exportProblem: string | null;
};

export default function ReportPreview({ board, dispatch, views, plan, basemap, onClose, onExport, exportEnabled, exporting, makingKind, exportProblem }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const thumbnailRefs = useRef(new Map<PageKey, HTMLButtonElement>());
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const addPopoverRef = useRef<HTMLDivElement>(null);
  const sheetCellPopoverRef = useRef<HTMLDivElement>(null);
  const sheetCellFocusRef = useRef<number | null>(null);
  const pendingAddedPageRef = useRef<PageKey | null>(null);
  const addAfterKeyRef = useRef<PageKey | null>(null);
  const sheetCellIndexRef = useRef<number | null>(null);
  const exportStatusRef = useRef<HTMLParagraphElement>(null);
  const exportFocusRequestedRef = useRef(false);
  const headingId = useId().replace(/:/g, "");
  const addPopoverId = useId().replace(/:/g, "");
  const sheetCellPopoverId = useId().replace(/:/g, "");
  const [activeKey, setActiveKey] = useState<PageKey | null>(plan[0]?.key ?? null);
  const [selectedKeys, setSelectedKeys] = useState<PageKey[]>(plan[0]?.key ? [plan[0].key] : []);
  const [anchorKey, setAnchorKey] = useState<PageKey | null>(plan[0]?.key ?? null);
  const [filmstripOpen, setFilmstripOpen] = useState(false);
  const [addAfterKey, setAddAfterKey] = useState<PageKey | null>(null);
  const [addPopoverStyle, setAddPopoverStyle] = useState<CSSProperties | null>(null);
  const [addSearch, setAddSearch] = useState("");
  const [thumbnailMenuKey, setThumbnailMenuKey] = useState<PageKey | null>(null);
  const [sheetCellIndex, setSheetCellIndex] = useState<number | null>(null);
  const [sheetCellPopoverStyle, setSheetCellPopoverStyle] = useState<CSSProperties | null>(null);
  const [sheetCellSearch, setSheetCellSearch] = useState("");
  addAfterKeyRef.current = addAfterKey;
  sheetCellIndexRef.current = sheetCellIndex;

  const closeAddPopover = useCallback((restoreFocus = false) => {
    setAddAfterKey(null);
    setAddPopoverStyle(null);
    setAddSearch("");
    if (restoreFocus) addButtonRef.current?.focus({ preventScroll: true });
  }, []);

  const closeSheetCellPopover = useCallback((restoreFocus = false) => {
    const focusIndex = sheetCellFocusRef.current;
    setSheetCellIndex(null);
    setSheetCellPopoverStyle(null);
    setSheetCellSearch("");
    sheetCellFocusRef.current = null;
    if (restoreFocus) window.requestAnimationFrame(() => {
      if (focusIndex === null) return;
      dialogRef.current?.querySelector<HTMLElement>(`[data-sheet-cell-index="${focusIndex}"]`)?.focus({ preventScroll: true });
    });
  }, []);

  const updateSheetCellPopoverPosition = useCallback(() => {
    if (sheetCellIndex === null) return;
    const anchor = dialogRef.current?.querySelector<HTMLElement>(`[data-sheet-cell-index="${sheetCellIndex}"]`);
    const popover = sheetCellPopoverRef.current;
    if (!anchor || !popover) return;
    const anchorRect = anchor.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const viewportWidth = Math.max(document.documentElement.clientWidth, window.innerWidth);
    const viewportHeight = Math.max(document.documentElement.clientHeight, window.innerHeight);
    const margin = 12;
    const left = Math.max(margin, Math.min(anchorRect.left, viewportWidth - popoverRect.width - margin));
    let top = anchorRect.bottom + 8;
    if (top + popoverRect.height > viewportHeight - margin) top = anchorRect.top - popoverRect.height - 8;
    top = Math.max(margin, Math.min(top, viewportHeight - popoverRect.height - margin));
    setSheetCellPopoverStyle((currentStyle) => currentStyle?.left === left && currentStyle?.top === top ? currentStyle : { left, top });
  }, [sheetCellIndex]);

  useEffect(() => {
    if (sheetCellIndex === null) {
      setSheetCellPopoverStyle(null);
      return;
    }
    const frame = window.requestAnimationFrame(updateSheetCellPopoverPosition);
    const onViewportChange = () => window.requestAnimationFrame(updateSheetCellPopoverPosition);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [sheetCellIndex, updateSheetCellPopoverPosition]);

  const updateAddPopoverPosition = useCallback(() => {
    if (!addAfterKey) return;
    const anchor = addButtonRef.current;
    const popover = addPopoverRef.current;
    if (!anchor || !popover) return;
    const anchorRect = anchor.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const viewportWidth = Math.max(document.documentElement.clientWidth, window.innerWidth);
    const viewportHeight = Math.max(document.documentElement.clientHeight, window.innerHeight);
    const margin = 12;
    const left = Math.max(margin, Math.min(anchorRect.right + 8, viewportWidth - popoverRect.width - margin));
    let top = anchorRect.bottom + 8;
    if (top + popoverRect.height > viewportHeight - margin) top = anchorRect.top - popoverRect.height - 8;
    top = Math.max(margin, Math.min(top, viewportHeight - popoverRect.height - margin));
    setAddPopoverStyle((current) => current?.left === left && current?.top === top ? current : { left, top });
  }, [addAfterKey]);

  useEffect(() => {
    if (!addAfterKey) {
      setAddPopoverStyle(null);
      return;
    }
    const frame = window.requestAnimationFrame(updateAddPopoverPosition);
    const onViewportChange = () => window.requestAnimationFrame(updateAddPopoverPosition);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [addAfterKey, updateAddPopoverPosition]);

  useFocusTrap({
    ref: dialogRef,
    onClose,
    onEscape: () => {
      if (sheetCellIndexRef.current !== null) {
        closeSheetCellPopover(true);
        return true;
      }
      if (addAfterKeyRef.current !== null) {
        closeAddPopover(true);
        return true;
      }
      const resetMenu = dialogRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"][aria-expanded="true"]');
      if (resetMenu) {
        resetMenu.click();
        return true;
      }
      const selectedPanel = dialogRef.current?.querySelector<HTMLElement>('[data-panel-selected="true"]');
      if (selectedPanel) {
        selectedPanel.dispatchEvent(new Event("v2-preview-deselect-panel", { bubbles: true }));
        return true;
      }
      return false;
    },
  });

  useEffect(() => {
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target;
      if (target instanceof Node && dialogRef.current?.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      if (addAfterKeyRef.current !== null) closeAddPopover(true);
      else onClose();
    };
    document.addEventListener("keydown", onDocumentKeyDown, true);
    return () => document.removeEventListener("keydown", onDocumentKeyDown, true);
  }, [closeAddPopover, onClose]);

  const planKeys = useMemo(() => plan.map((slide) => slide.key), [plan]);
  useEffect(() => {
    const available = new Set(planKeys);
    setActiveKey((key) => key && available.has(key) ? key : planKeys[0] ?? null);
    setSelectedKeys((keys) => {
      const kept = keys.filter((key) => available.has(key));
      return kept.length > 0 ? kept : (planKeys[0] ? [planKeys[0]] : []);
    });
    setAnchorKey((key) => key && available.has(key) ? key : planKeys[0] ?? null);
    setAddAfterKey((key) => key && available.has(key) ? key : null);
    setThumbnailMenuKey((key) => key && available.has(key) ? key : null);
  }, [planKeys]);

  useEffect(() => {
    const key = pendingAddedPageRef.current;
    if (!key || !planKeys.includes(key)) return;
    pendingAddedPageRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      const element = thumbnailRefs.current.get(key);
      element?.scrollIntoView({ block: "nearest", inline: "nearest" });
      element?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [planKeys]);

  const current = plan.find((slide) => slide.key === activeKey) ?? plan[0] ?? null;
  const previousPageKey = neighborPageKey(planKeys, current?.key ?? "", "ArrowLeft");
  const nextPageKey = neighborPageKey(planKeys, current?.key ?? "", "ArrowRight");
  const selectedSlides = plan.filter((slide) => selectedKeys.includes(slide.key));
  const applyPatch = useCallback((patch: PreviewStylePatch) => {
    const keys = selectedKeys.length > 0 ? selectedKeys : (current ? [current.key] : []);
    if (keys.length > 0) dispatch({ type: "pageStyle", keys, patch });
  }, [current, dispatch, selectedKeys]);
  const select = useCallback((key: PageKey, modifiers: PageSelectionModifiers = {}) => {
    const next = selectPageKeys(planKeys, anchorKey, key, { ...modifiers, selectedKeys });
    setActiveKey(key);
    setSelectedKeys(next);
    if (!modifiers.shiftKey) setAnchorKey(key);
  }, [anchorKey, planKeys, selectedKeys]);
  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable || target.getAttribute("role") === "textbox") return;
    if (target.closest("[data-preview-map]")) return;
    if (target.closest("[data-panel-selected=\"true\"]")) return;
    if (target.closest("[role=\"menu\"], [role=\"listbox\"], [role=\"region\"], [aria-haspopup=\"menu\"][aria-expanded=\"true\"]")) return;
    if (addAfterKey !== null || sheetCellIndex !== null || thumbnailMenuKey !== null) return;
    if (!(event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "PageUp" || event.key === "PageDown" || event.key === "Home" || event.key === "End")) return;
    const currentKey = current?.key ?? planKeys[0] ?? "";
    const nextKey = neighborPageKey(planKeys, currentKey, event.key as PageNavigationKey);
    if (!nextKey || nextKey === currentKey) return;
    event.preventDefault();
    select(nextKey);
  };
  const onThumbnailKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, key: PageKey) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const anchorForMove = anchorKey;
      const direction = event.key === "ArrowUp" ? -1 : 1;
      const currentIndex = planKeys.indexOf(key);
      const nextIndex = Math.max(0, Math.min(planKeys.length - 1, currentIndex + direction));
      const nextActiveKey = planKeys[nextIndex] ?? key;
      const nextSelectedKeys = movePageSelection(planKeys, anchorForMove, key, direction, event.shiftKey);
      setActiveKey(nextActiveKey);
      setSelectedKeys(nextSelectedKeys);
      setAnchorKey(event.shiftKey ? (anchorForMove ?? nextActiveKey) : nextActiveKey);
      window.requestAnimationFrame(() => thumbnailRefs.current.get(nextActiveKey)?.focus({ preventScroll: false }));
    } else if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      setActiveKey(key);
      setSelectedKeys((keys) => keys.includes(key) ? keys.filter((candidate) => candidate !== key) : [...keys, key]);
      setAnchorKey(key);
    }
  };
  const addOptions = [...new Set([...board.order, ...Array.from(views.keys())])]
    .map((id) => ({ id, view: views.get(id) }))
    .filter((entry): entry is { id: string; view: TileView } => !!entry.view);
  const filteredAddOptions = addOptions.filter(({ id, view }) => {
    const query = addSearch.trim().toLocaleLowerCase();
    return !query || [id, view.code, view.title, view.kindLabel].some((value) => value.toLocaleLowerCase().includes(query));
  });
  const addGroups = [...new Map(filteredAddOptions.map((entry) => [entry.view.kindLabel, filteredAddOptions.filter((candidate) => candidate.view.kindLabel === entry.view.kindLabel)])).entries()];
  const filteredSheetOptions = addOptions.filter(({ id, view }) => {
    const query = sheetCellSearch.trim().toLocaleLowerCase();
    return !query || [id, view.code, view.title, view.kindLabel].some((value) => value.toLocaleLowerCase().includes(query));
  });
  const openAddPopover = (key: PageKey) => {
    closeSheetCellPopover();
    setThumbnailMenuKey(null);
    setAddSearch("");
    setAddPopoverStyle(null);
    setAddAfterKey((currentKey) => currentKey === key ? null : key);
  };
  const addSheetPage = (grid: SheetGrid) => {
    if (!addAfterKey) return;
    const id = nextExtraPageId(board.report.extra.map((page) => page.id), `sheet-${grid}`);
    const after = pageKeyAfterInsertion(planKeys, addAfterKey);
    dispatch({ type: "addPage", id, after, tileId: "", face: "front", sheet: { grid, tiles: Array.from({ length: sheetCapacity(grid) }, () => "") } });
    const key = extraPageKey(id);
    pendingAddedPageRef.current = key;
    setActiveKey(key);
    setSelectedKeys([key]);
    setAnchorKey(key);
    closeAddPopover();
  };
  const addPage = (tileId: string, face: "front" | "back") => {
    if (!addAfterKey) return;
    const id = nextExtraPageId(board.report.extra.map((page) => page.id), tileId);
    const after = pageKeyAfterInsertion(planKeys, addAfterKey);
    dispatch({ type: "addPage", id, after, tileId, face });
    const key = extraPageKey(id);
    pendingAddedPageRef.current = key;
    setActiveKey(key);
    setSelectedKeys([key]);
    setAnchorKey(key);
    closeAddPopover();
  };
  const openSheetCellPopover = (index: number) => {
    if (current?.kind !== "sheet") return;
    sheetCellFocusRef.current = index;
    closeAddPopover();
    setThumbnailMenuKey(null);
    setSheetCellSearch("");
    setSheetCellPopoverStyle(null);
    setSheetCellIndex(index);
  };
  const setSheetCell = (tileId: string) => {
    if (!current?.key.startsWith("extra:") || sheetCellIndex === null) return;
    dispatch({ type: "setSheetCell", id: current.key.slice("extra:".length), index: sheetCellIndex, tileId });
    closeSheetCellPopover(true);
  };

  const handleExport = useCallback(() => {
    if (!exportEnabled || exporting) return;
    exportFocusRequestedRef.current = true;
    exportStatusRef.current?.focus({ preventScroll: true });
    void onExport();
  }, [exportEnabled, exporting, onExport]);

  useEffect(() => {
    if (!exportFocusRequestedRef.current) return;
    exportStatusRef.current?.focus({ preventScroll: true });
  }, [exportProblem, exporting]);
  const removeExtra = (key: PageKey) => {
    if (!key.startsWith("extra:")) return;
    dispatch({ type: "removePage", id: key.slice("extra:".length) });
  };
  const onLargeMapPatch = (patch: PreviewStylePatch) => {
    const keys = selectedKeys.includes(current?.key ?? "") ? selectedKeys : (current ? [current.key] : []);
    if (keys.length > 0) dispatch({ type: "pageStyle", keys, patch });
  };
  const onDirectPagePatch = useCallback((patch: PreviewStylePatch) => {
    if (current) dispatch({ type: "pageStyle", keys: [current.key], patch });
  }, [current, dispatch]);
  const resetScales = useCallback(() => {
    applyPatch({ titleScale: undefined, summaryScale: undefined, legendScale: undefined, panels: undefined } as unknown as PreviewStylePatch);
  }, [applyPatch]);
  const resetLabels = useCallback(() => {
    onDirectPagePatch({ pinnedKeys: undefined, hiddenKeys: undefined });
  }, [onDirectPagePatch]);

  return (
    <div className={styles.backdrop}>
      <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1} onKeyDown={onDialogKeyDown}>
        <h1 id={headingId} className={styles.visuallyHidden}>페이지 미리보기</h1>
        <button type="button" className={styles.dialogClose} aria-label="미리보기 닫기" title="미리보기 닫기" onClick={onClose}><InlineIcon name="close" /></button>
        <div className={styles.body + (!filmstripOpen ? " " + styles.bodyFilmstripCollapsed : "")}>
          <nav className={styles.thumbRail + (!filmstripOpen ? " " + styles.thumbRailCollapsed : "")} aria-label="보고서 페이지 목록">
            <div className={styles.railHeading}>
              <h2>페이지</h2>
              <span className={styles.railHint + " " + styles.filmstripCount}>{current?.no ?? 0} / {plan.length}</span>
              <button type="button" className={styles.filmstripToggle} aria-label="페이지 목록 펼치기/접기" title="페이지 목록 펼치기/접기" aria-expanded={filmstripOpen} onClick={() => setFilmstripOpen((open) => !open)}><InlineIcon name="grid" /></button>
            </div>
            {filmstripOpen && <ol className={styles.thumbList} data-thumbnail-scroll="true">
              {plan.map((slide) => {
                const selected = selectedKeys.includes(slide.key);
                const extra = slide.key.startsWith("extra:");
                return (
                  <li className={styles.thumbItem} key={slide.key}>
                    <button type="button" ref={(element) => {
                      if (element) thumbnailRefs.current.set(slide.key, element);
                      else thumbnailRefs.current.delete(slide.key);
                    }} className={styles.thumbButton} aria-current={activeKey === slide.key ? "true" : undefined} aria-selected={selected} onClick={(event) => select(slide.key, { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey })} onKeyDown={(event) => onThumbnailKeyDown(event, slide.key)}>
                       <ThumbnailPreview slide={slide} basemap={basemap} />
                       <span className={styles.thumbCopy}><span className={styles.thumbNumber}>{slide.no} / {slide.total}</span><span className={styles.thumbTitle}>{slideTitle(slide)}{extra && <span className={styles.extraBadge}>추가</span>}</span><span className={styles.thumbKind}>{slide.kind === "tile" ? slide.view.kindLabel : slide.kind === "sheet" ? "타일 조판" : slide.kind === "sources" ? "출처" : "표지"}</span></span>
                     </button>
                     <button type="button" className={styles.thumbMenuButton} aria-label={slideTitle(slide) + " 페이지 메뉴"} aria-expanded={thumbnailMenuKey === slide.key} onClick={(event) => { event.stopPropagation(); setThumbnailMenuKey((key) => key === slide.key ? null : slide.key); }} title="페이지 메뉴">⋯</button>
                     {thumbnailMenuKey === slide.key && <div className={styles.thumbMenu} role="menu" aria-label={slideTitle(slide) + " 페이지 메뉴"}>
                       <button type="button" role="menuitem" onClick={() => openAddPopover(slide.key)}>이 페이지 뒤에 추가</button>
                       {extra && <button type="button" role="menuitem" className={styles.thumbMenuDanger} onClick={() => { setThumbnailMenuKey(null); removeExtra(slide.key); }}>페이지 삭제</button>}
                     </div>}
                   </li>
                 );
               })}
             </ol>}
             <button ref={addButtonRef} type="button" className={styles.addPageButton} disabled={!current} aria-label="현재 페이지 뒤에 페이지 추가" title="현재 페이지 뒤에 페이지 추가" aria-expanded={!!addAfterKey} aria-controls={addAfterKey ? addPopoverId : undefined} onClick={() => current && openAddPopover(current.key)}><InlineIcon name="plus" /></button>
           </nav>
           {addAfterKey && <div ref={addPopoverRef} id={addPopoverId} className={styles.addPopover} style={addPopoverStyle ?? undefined} role="region" aria-label="페이지 추가">
             <p className={styles.addPopoverHeading}>현재 페이지 뒤에 추가{plan.find((slide) => slide.key === addAfterKey) ? ` · ${slideTitle(plan.find((slide) => slide.key === addAfterKey)!)}` : ""}</p>
             <label className={styles.addSearchLabel}>타일 검색<input type="search" value={addSearch} onChange={(event) => setAddSearch(event.target.value)} placeholder="타일 이름·코드·분류" aria-label="추가할 타일 검색" /></label>
             <section className={styles.sheetGridOptions} aria-label="여러 타일 페이지">
               <h3>여러 타일 페이지</h3>
               <div className={styles.sheetGridOptionList}>
                 {SHEET_GRID_OPTIONS.map((option) => <button key={option.grid} type="button" className={styles.sheetGridOption} onClick={() => addSheetPage(option.grid)} aria-label={`${option.label} 페이지 추가`}>{option.label}</button>)}
               </div>
             </section>
             <div className={styles.addTileList}>
               {addGroups.map(([group, entries]) => <section className={styles.addTileGroup} key={group}>
                 <h3>{group}</h3>
                 {entries.map((entry) => <div className={styles.addTileButton} key={entry.id}>
                   <span className={styles.addTileName}><b>{entry.view.code}</b> · {entry.view.title}</span>
                   <span className={styles.faceOptions}>
                     <button type="button" className={styles.faceButton} aria-label={`${entry.view.title} 앞면 지도 추가`} onClick={() => addPage(entry.id, "front")}>앞면 · 지도</button>
                     {entry.view.hasFace && <button type="button" className={styles.faceButton} aria-label={`${entry.view.title} 뒷면 요약 추가`} onClick={() => addPage(entry.id, "back")}>뒷면 · 요약</button>}
                   </span>
                 </div>)}
               </section>)}
               {addGroups.length === 0 && <p className={styles.addEmpty}>검색 결과가 없습니다.</p>}
             </div>
           </div>}
           {sheetCellIndex !== null && <div ref={sheetCellPopoverRef} id={sheetCellPopoverId} className={styles.sheetCellPicker} style={sheetCellPopoverStyle ?? undefined} role="region" aria-label="타일 선택">
             <div className={styles.sheetCellPickerHeading}>타일 선택</div>
             <label className={styles.addSearchLabel}>검색<input type="search" value={sheetCellSearch} onChange={(event) => setSheetCellSearch(event.target.value)} placeholder="타일 이름·코드" aria-label="타일 검색" /></label>
             <div className={styles.sheetCellPickerList}>
               {filteredSheetOptions.map((entry) => <button key={entry.id} type="button" className={styles.sheetCellPickerOption} onClick={() => setSheetCell(entry.id)} aria-label={`${entry.view.code} ${entry.view.title} 선택`}><b>{entry.view.code}</b><span>{entry.view.title}</span></button>)}
               {filteredSheetOptions.length === 0 && <p className={styles.addEmpty}>검색 결과가 없습니다.</p>}
             </div>
             <button type="button" className={styles.sheetCellClear} onClick={() => setSheetCell("")}>칸 비우기</button>
           </div>}
           <main className={styles.stageColumn} aria-label="현재 페이지 미리보기">
             {current ? <>
               <PageToolbar selectedSlides={selectedSlides} current={current} applyPatch={applyPatch} resetScales={resetScales} resetLabels={resetLabels} exportStatusRef={exportStatusRef} exportEnabled={exportEnabled} exporting={exporting} makingKind={makingKind} exportProblem={exportProblem} onExport={handleExport} />
               <div className={styles.pageStage}>
                 <button type="button" className={styles.toolbarIconButton + " " + styles.pageNavButton + " " + styles.pageNavPrevious} disabled={!previousPageKey || previousPageKey === current.key} aria-label="이전 페이지" title="이전 페이지" data-tooltip="이전 페이지" onClick={() => previousPageKey && select(previousPageKey)}><InlineIcon name="chevronLeft" /></button>
                 <SlidePreview slide={current} basemap={basemap} editable={current.kind === "tile"} onSheetCellActivate={current.kind === "sheet" && current.key.startsWith("extra:") ? openSheetCellPopover : undefined} onPatch={applyPatch} onMapPatch={onLargeMapPatch} onDirectPatch={onDirectPagePatch} />
                 <button type="button" className={styles.toolbarIconButton + " " + styles.pageNavButton + " " + styles.pageNavNext} disabled={!nextPageKey || nextPageKey === current.key} aria-label="다음 페이지" title="다음 페이지" data-tooltip="다음 페이지" onClick={() => nextPageKey && select(nextPageKey)}><InlineIcon name="chevronRight" /></button>
               </div>
             </> : <p className={styles.emptyState}>표시할 페이지가 없습니다.</p>}
           </main>
         </div>
       </div>
    </div>
  );
}
