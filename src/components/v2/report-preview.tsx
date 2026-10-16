"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type Dispatch, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { BasemapChoice } from "@/lib/v2/ui/map-projection";
import { metersPerPixel, slideViewport } from "@/lib/v2/ui/map-projection";
import { SLIDE, slideLegend, slidePanelRects, slideSiteX, type Rect } from "@/lib/v2/ui/overlay-layout";
import { coverLayout, fitBlock, fitFooterText, sourceLayout, titlePlateRect } from "@/lib/v2/report/pptx-kit";
import { legendItemsOf, legendLabelOf } from "@/lib/v2/ui/map-layers";
import MapFigure from "./map-figure";
import { useFocusTrap } from "./use-focus-trap";
import { extraPageKey, type BoardAction, type BoardState, type PageKey, type PageStyle } from "@/lib/v2/ui/board-state";
import type { PlannedSlide } from "@/lib/v2/report/report-plan";
import type { TileView } from "@/lib/v2/ui/tile-view";
import { sheetCells, type SheetGrid } from "@/lib/v2/ui/sheet";
import { mixedValue, movePageSelection, nextExtraPageId, pageKeyAfterInsertion, selectPageKeys, toggleLegendFocus, togglePinnedKey, type PageSelectionModifiers } from "@/lib/v2/ui/report-preview-logic";
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
  onPatch: (patch: PreviewStylePatch) => void;
  onDirectPatch?: (patch: PreviewStylePatch) => void;
  hoverLegend?: string | null;
  label: string;
};

function MapLayer({ model, style, unit, basemap, panels, siteX, pinnedKeys, interactive, onPatch, onDirectPatch, hoverLegend, label }: MapLayerProps) {
  const width = Math.max(1, Math.round(SLIDE.w * unit));
  const height = Math.max(1, Math.round(SLIDE.h * unit));
  const [draftOffset, setDraftOffset] = useState<[number, number] | null>(null);
  const [dragging, setDragging] = useState(false);
  const draftOffsetRef = useRef<[number, number] | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; offset: [number, number]; moved: boolean } | null>(null);
  const suppressFeatureClick = useRef(false);
  const renderStyle = draftOffset ? { ...style, offsetM: draftOffset } : style;
  const viewport = slideViewport(model, renderStyle, { width, height, siteX, fill: 0.8 });
  const focusedLabel = legendLabelOf(model, renderStyle.legendFocus);
  const activeLegendLabel = hoverLegend ?? focusedLabel;
  const onFeaturePin = onDirectPatch ? (feature: { key: string }) => {
    if (suppressFeatureClick.current) return;
    const currentKeys = renderStyle.pinnedKeys ?? pinnedKeys ?? [];
    onDirectPatch({ pinnedKeys: togglePinnedKey(currentKeys, feature.key) });
  } : undefined;
  useEffect(() => {
    draftOffsetRef.current = null;
    setDraftOffset(null);
  }, [style.offsetM?.[0], style.offsetM?.[1], style.zoomDelta]);
  const avoid = [panels.title, panels.summary, panels.legend]
    .filter((rect): rect is Rect => !!rect)
    .map((rect) => ({ x0: rect.x * unit, y0: rect.y * unit, x1: (rect.x + rect.w) * unit, y1: (rect.y + rect.h) * unit }));
  const startPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!interactive || event.button !== 0) return;
    const sourceOffset = renderStyle.offsetM ?? [0, 0];
    const offset: [number, number] = [sourceOffset[0], sourceOffset[1]];
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, offset, moved: false };
  };
  const movePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const mpp = metersPerPixel(viewport.center[1], viewport.zoom);
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.moved && Math.hypot(dx, dy) < 4) return;
    if (!state.moved) {
      state.moved = true;
      suppressFeatureClick.current = true;
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const next: [number, number] = [state.offset[0] - dx * mpp, state.offset[1] + dy * mpp];
    draftOffsetRef.current = next;
    setDraftOffset(next);
    event.preventDefault();
  };
  const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    if (!state.moved) {
      drag.current = null;
      return;
    }
    const next = draftOffsetRef.current ?? draftOffset ?? state.offset;
    onPatch({ offsetM: [next[0], next[1]] });
    drag.current = null;
    setDragging(false);
    draftOffsetRef.current = null;
    setDraftOffset(null);
    window.setTimeout(() => { suppressFeatureClick.current = false; }, 0);
  };
  const map = (
    <MapFigure
      model={model}
      width={width}
      height={height}
      fixed
      basemap="tiles"
      layer={basemap}
      legend={false}
      north={false}
      credit={false}
      scale
      bottomInset={unit * SLIDE.stripH}
      label={label}
      viewport={viewport}
      avoid={avoid}
      pinnedKeys={renderStyle.pinnedKeys ?? pinnedKeys ?? []}
      legendFocus={focusedLabel}
      highlightLabel={activeLegendLabel}
      highlightPinnedLabel={focusedLabel}
      showAutomaticLabels
      onFeaturePin={onFeaturePin}
      dragging={dragging}
    />
  );
  if (!interactive) return <div className={styles.slideMap}>{map}</div>;
  const zoomByWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    onPatch({ zoomDelta: clampNumber((style.zoomDelta ?? 0) + (event.deltaY < 0 ? 0.5 : -0.5), -3, 3) });
  };
  const mapKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Home") {
      event.preventDefault();
      onPatch({ offsetM: [0, 0] });
    }
  };
  return (
    <div
      className={styles.mapInteraction}
      data-dragging={dragging ? "true" : "false"}
      tabIndex={0}
      role="application"
      aria-label={label + " 지도. 드래그하여 이동하고 휠로 확대합니다."}
      onPointerDown={startPointer}
      onPointerMove={movePointer}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onWheel={zoomByWheel}
      onKeyDown={mapKeyDown}
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

function VisualPlaceholder({ title, message, unit }: { title: string; message: string; unit: number }) {
  return (
    <div className={styles.chartPlaceholder}>
      <strong className={styles.slideTitle} style={fontStyle(18, unit)}>{title}</strong>
      <span className={styles.slideText} style={fontStyle(11, unit)}>{message}</span>
    </div>
  );
}

function CoverSurface({ slide, unit, basemap, interactive, onPatch, onDirectPatch }: { slide: Extract<PlannedSlide, { kind: "cover" }>; unit: number; basemap: BasemapChoice; interactive: boolean; onPatch: (patch: PreviewStylePatch) => void; onDirectPatch?: (patch: PreviewStylePatch) => void }) {
  const map = slide.map;
  const layout = coverLayout({ address: slide.address, metricCount: slide.metrics.length, lineCount: slide.lines.length, incomplete: !!slide.incomplete });
  const mapPanels = { title: layout.left, summary: layout.right, legend: null };
  return (
    <>
      {map && <MapLayer model={map} style={slide.style} unit={unit} basemap={basemap} panels={mapPanels} siteX={0.5} interactive={interactive} onPatch={onPatch} onDirectPatch={onDirectPatch} label="표지 지도" />}
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

function SourcesSurface({ slide, unit, basemap }: { slide: Extract<PlannedSlide, { kind: "sources" }>; unit: number; basemap: BasemapChoice }) {
  const layout = sourceLayout(slide.rows.length, slide.style);
  const mapPanels = { title: layout.title, summary: null, legend: null };
  const map = slide.map;
  const kind = layout.dense;
  return (
    <>
      {map && <MapLayer model={map} style={slide.style} unit={unit} basemap={basemap} panels={mapPanels} siteX={0.5} interactive={false} onPatch={() => undefined} label="출처 장 배경 지도" />}
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

function SheetSurface({ slide, unit, basemap }: { slide: Extract<PlannedSlide, { kind: "sheet" }>; unit: number; basemap: BasemapChoice }) {
  const cellRects = sheetCells(slide.grid as SheetGrid);
  const titleRect = titlePlateRect("SHEET", slide.view.title, slide.grid, SLIDE.w - 2 * SLIDE.edge, slide.style, false);
  return (
    <>
      <div className={styles.sheetSlide}>
        <ReportTitlePanel color={slide.view.color} code="SHEET" title={slide.view.title} kind={slide.grid} rect={titleRect} unit={unit} />
        <div className={styles.sheetGrid}>
          {slide.cells.map((cell, index) => {
            const rect = cellRects[index];
            if (!rect) return null;
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
                      basemap="tiles"
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
              </div>
            );
          })}
        </div>
      </div>
      <SlideFooter slide={slide} unit={unit} />
    </>
  );
}

function TileSurface({ slide, unit, basemap, panels, interactive, onPatch, onDirectPatch, panelInteraction }: { slide: Extract<PlannedSlide, { kind: "tile" }>; unit: number; basemap: BasemapChoice; panels: { title: Rect; summary: Rect | null; legend: Rect | null }; interactive: boolean; onPatch: (patch: PreviewStylePatch) => void; onDirectPatch?: (patch: PreviewStylePatch) => void; panelInteraction?: (key: PanelKey) => PanelInteraction }) {
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
      {model ? <MapLayer model={model} style={slide.style} unit={unit} basemap={basemap} panels={panels} siteX={slideSiteX(slide.style, panels.summary !== null)} pinnedKeys={slide.pinnedKeys} interactive={interactive} onPatch={onPatch} onDirectPatch={onDirectPatch} hoverLegend={hoverLegend} label={slide.view.title + " 지도"} /> : slide.mass ? <VisualPlaceholder title={slide.view.title} message="3D 매스 미리보기는 내보내기와 같은 페이지 위치로 표시됩니다." unit={unit} /> : slide.rose ? <VisualPlaceholder title={slide.view.title} message="바람장미 도판 미리보기" unit={unit} /> : chart ? <ChartPlaceholder view={slide.view} unit={unit} /> : <VisualPlaceholder title={slide.view.title} message={slide.body.kind === "state" ? slide.body.message : "표시할 지도 결과가 없습니다."} unit={unit} />}
      {slide.body.kind === "state" && <div className={styles.slidePanel} style={{ left: unit * 4, top: unit * 2.7, width: unit * 5.1, height: unit * 1.15 }}><div className={styles.slideText + " " + styles.slideTextStrong} style={fontStyle(16, unit)}>{slide.body.message}</div></div>}
      <TitlePanel slide={slide} rect={panels.title} unit={unit} interaction={panelInteraction?.("title")} />
      {panels.summary && hasSummaryPanel(slide) && <SummaryPanel slide={slide} rect={panels.summary} unit={unit} interaction={panelInteraction?.("summary")} />}
      {panels.legend && <LegendPanel slide={slide} rect={panels.legend} unit={unit} hoverLabel={hoverLegend} onLegendHover={setHoverLegend} onLegendPin={onLegendPin} interaction={panelInteraction?.("legend")} />}
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
      {panelKey === "summary" && <button type="button" className={styles.panelRemove} data-panel-action="remove" aria-label="요약 탭 숨기기" title="요약 탭 숨기기" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemove(); }}>×</button>}
    </div>
  </>;
}

function SlidePreview({ slide, basemap, editable, onPatch, onMapPatch, onDirectPatch }: { slide: PlannedSlide; basemap: BasemapChoice; editable: boolean; onPatch: (patch: PreviewStylePatch) => void; onMapPatch: (patch: PreviewStylePatch) => void; onDirectPatch?: (patch: PreviewStylePatch) => void }) {
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
  const baseLegend = displayModel && displaySlide.kind === "tile" ? slideLegend(displayModel, !displaySlide.muted).rect : null;
  const panels = slidePanelRects(displaySlide.style, hasSummary, baseLegend);
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
          onKeyDown={(event) => { if (event.key === "Escape") setSelectedPanel(null); }}
          data-transforming={panelDrag.current || panelResize.current ? "true" : "false"}
        >
        {displaySlide.kind === "cover" && <CoverSurface slide={displaySlide} unit={unit} basemap={basemap} interactive={editable && !!displayModel} onPatch={onMapPatch} onDirectPatch={onDirectPatch} />}
        {displaySlide.kind === "sources" && <SourcesSurface slide={displaySlide} unit={unit} basemap={basemap} />}
        {displaySlide.kind === "sheet" && <SheetSurface slide={displaySlide} unit={unit} basemap={basemap} />}
        {displaySlide.kind === "tile" && <TileSurface slide={displaySlide} unit={unit} basemap={basemap} panels={panels} interactive={editable && !!displayModel} onPatch={onMapPatch} onDirectPatch={onDirectPatch} panelInteraction={editable ? panelInteraction : undefined} />}
        {handles}
        </div>
      </div>
    </div>
  );
}

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
  onClose: () => void;
};

function PageToolbar({ selectedSlides, current, applyPatch, resetScales, resetLabels, exportStatusRef, exportEnabled, exporting, makingKind, exportProblem, onExport, onClose }: PageToolbarProps) {
  const targets = selectedSlides.length > 0 ? selectedSlides : current ? [current] : [];
  const mapEnabled = !!(current && mapForSlide(current));
  const summaryEnabled = current?.kind === "tile" && !(current.callout && current.callout.page > 0);
  const zoom = mixedField(targets, (slide) => slide.style.zoomDelta ?? 0, 0);
  const summary = mixedField(targets, (slide) => slide.style.summary !== false, true);
  const directHint = current?.kind === "tile" && !!current.map && (
    current.style.pinnedKeys === undefined
    || current.style.legendFocus === undefined
    || ((current.style.pinnedKeys?.length ?? 0) === 0 && current.style.legendFocus === null)
  );
  const targetLabel = targets.length > 1 ? `${targets.length}장에 적용` : targets.length === 1 ? "현재 1장" : "페이지를 선택하세요";
  return (
    <div className={styles.pageToolbar} role="toolbar" aria-label="페이지 직접 조작 도구">
      <div className={styles.toolbarContext}>
        <strong>{targetLabel}</strong>
        {targets.length > 1 && <span>라벨·범례는 현재 장만</span>}
        {directHint && <span className={styles.interactionHint}>지도 요소를 누르면 라벨, 범례를 누르면 강조</span>}
      </div>
      <div className={styles.toolbarActions}>
        <div className={styles.toolbarGroup} aria-label="지도 확대">
          <span className={styles.toolbarLabel}>지도 {zoom.mixed ? "여러 값" : formatZoom(zoom.value)}</span>
          <button type="button" className={styles.smallButton} disabled={!mapEnabled || targets.length === 0} onClick={() => applyPatch({ zoomDelta: clampNumber((zoom.mixed ? 0 : zoom.value) - 0.5, -3, 3) })} aria-label="지도 축소">−</button>
          <button type="button" className={styles.smallButton} disabled={!mapEnabled || targets.length === 0} onClick={() => applyPatch({ zoomDelta: clampNumber((zoom.mixed ? 0 : zoom.value) + 0.5, -3, 3) })} aria-label="지도 확대">+</button>
          <button type="button" className={styles.centerButton} disabled={!mapEnabled || targets.length === 0} onClick={() => applyPatch({ offsetM: [0, 0] })}><span className={styles.toolbarLongLabel}>대지 중앙 정렬</span><span className={styles.toolbarShortLabel}>정렬</span></button>
        </div>
        <button type="button" className={styles.toolbarToggle} disabled={!summaryEnabled || targets.length === 0} aria-pressed={summary.value} onClick={() => applyPatch({ summary: !summary.value })}><span className={styles.toolbarLongLabel}>{summary.value ? "요약 탭 숨기기" : "요약 탭 켜기"}{summary.mixed ? " · 여러 값" : ""}</span><span className={styles.toolbarShortLabel}>요약</span></button>
        <button type="button" className={styles.toolbarReset} disabled={targets.length === 0} onClick={resetScales} aria-label="탭 배치 초기화"><span className={styles.toolbarLongLabel}>탭 배치 초기화</span><span className={styles.toolbarShortLabel}>초기화</span></button>
        <button type="button" className={styles.toolbarReset} disabled={!mapEnabled || !current} onClick={resetLabels} aria-label="라벨 초기화"><span className={styles.toolbarLongLabel}>라벨 초기화</span><span className={styles.toolbarShortLabel}>라벨</span></button>
        <button type="button" className={styles.toolbarExport} disabled={!exportEnabled || exporting} onClick={onExport}>{exporting ? "내보내는 중…" : "내보내기"}</button>
        <button type="button" className={styles.toolbarClose} onClick={onClose}>닫기</button>
      </div>
      <p ref={exportStatusRef} className={styles.toolbarStatus + (exportProblem ? " " + styles.footerError : "")} role={exportProblem ? "alert" : "status"} aria-live="polite" aria-busy={exporting} tabIndex={-1}>{exportProblem ?? (exporting ? (makingKind ?? "PPT") + " 내보내는 중…" : "탭을 누르면 선택하고, 안쪽을 끌어 이동합니다")}</p>
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
  const pendingAddedPageRef = useRef<PageKey | null>(null);
  const addAfterKeyRef = useRef<PageKey | null>(null);
  const exportStatusRef = useRef<HTMLParagraphElement>(null);
  const exportFocusRequestedRef = useRef(false);
  const headingId = useId().replace(/:/g, "");
  const addPopoverId = useId().replace(/:/g, "");
  const [activeKey, setActiveKey] = useState<PageKey | null>(plan[0]?.key ?? null);
  const [selectedKeys, setSelectedKeys] = useState<PageKey[]>(plan[0]?.key ? [plan[0].key] : []);
  const [anchorKey, setAnchorKey] = useState<PageKey | null>(plan[0]?.key ?? null);
  const [filmstripOpen, setFilmstripOpen] = useState(false);
  const [addAfterKey, setAddAfterKey] = useState<PageKey | null>(null);
  const [addPopoverStyle, setAddPopoverStyle] = useState<CSSProperties | null>(null);
  const [addSearch, setAddSearch] = useState("");
  const [thumbnailMenuKey, setThumbnailMenuKey] = useState<PageKey | null>(null);
  addAfterKeyRef.current = addAfterKey;

  const closeAddPopover = useCallback((restoreFocus = false) => {
    setAddAfterKey(null);
    setAddPopoverStyle(null);
    setAddSearch("");
    if (restoreFocus) addButtonRef.current?.focus({ preventScroll: true });
  }, []);

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
      if (addAfterKeyRef.current !== null) {
        closeAddPopover(true);
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
  const openAddPopover = (key: PageKey) => {
    setThumbnailMenuKey(null);
    setAddSearch("");
    setAddPopoverStyle(null);
    setAddAfterKey((currentKey) => currentKey === key ? null : key);
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
    onDirectPagePatch({ pinnedKeys: undefined });
  }, [onDirectPagePatch]);

  return (
    <div className={styles.backdrop}>
      <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1}>
        <header className={styles.header}>
          <div className={styles.headingGroup}>
            <p className={styles.eyebrow}>PPT 내보내기</p>
            <h1 id={headingId} className={styles.heading}>페이지 미리보기</h1>
          </div>
          <span className={styles.selectionCount}>{selectedKeys.length}장 선택</span>
          <span className={styles.headerSpacer} />
        </header>
        <div className={styles.body + (!filmstripOpen ? " " + styles.bodyFilmstripCollapsed : "")}>
          <nav className={styles.thumbRail + (!filmstripOpen ? " " + styles.thumbRailCollapsed : "")} aria-label="보고서 페이지 목록">
            <div className={styles.railHeading}>
              <h2>페이지</h2>
              {filmstripOpen && <span className={styles.railHint}>{plan.length}장</span>}
              <button type="button" className={styles.filmstripToggle} aria-expanded={filmstripOpen} onClick={() => setFilmstripOpen((open) => !open)}>{filmstripOpen ? "목록 접기" : "페이지 목록"}</button>
            </div>
            {filmstripOpen && <ol className={styles.thumbList}>
              {plan.map((slide) => {
                const selected = selectedKeys.includes(slide.key);
                const extra = slide.key.startsWith("extra:");
                return (
                  <li className={styles.thumbItem} key={slide.key}>
                    <button type="button" ref={(element) => {
                      if (element) thumbnailRefs.current.set(slide.key, element);
                      else thumbnailRefs.current.delete(slide.key);
                    }} className={styles.thumbButton} aria-current={activeKey === slide.key ? "true" : undefined} aria-selected={selected} onClick={(event) => select(slide.key, { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey })} onKeyDown={(event) => onThumbnailKeyDown(event, slide.key)}>
                       <span className={styles.thumbMini}><span className={styles.thumbMiniText}>{slide.kind === "cover" ? "표지" : slide.kind === "sources" ? "출처" : slide.kind === "sheet" ? "조판" : slide.view.code}</span></span>
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
             <button ref={addButtonRef} type="button" className={styles.addPageButton} disabled={!current} aria-label="현재 페이지 뒤에 페이지 추가" title="현재 페이지 뒤에 페이지 추가" aria-expanded={!!addAfterKey} aria-controls={addAfterKey ? addPopoverId : undefined} onClick={() => current && openAddPopover(current.key)}><span aria-hidden="true">＋</span><span className={styles.addPageLabel}>페이지</span></button>
           </nav>
           {addAfterKey && <div ref={addPopoverRef} id={addPopoverId} className={styles.addPopover} style={addPopoverStyle ?? undefined} role="region" aria-label="페이지 추가">
             <p className={styles.addPopoverHeading}>현재 페이지 뒤에 추가{plan.find((slide) => slide.key === addAfterKey) ? ` · ${slideTitle(plan.find((slide) => slide.key === addAfterKey)!)}` : ""}</p>
             <label className={styles.addSearchLabel}>타일 검색<input type="search" value={addSearch} onChange={(event) => setAddSearch(event.target.value)} placeholder="타일 이름·코드·분류" aria-label="추가할 타일 검색" /></label>
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
           <main className={styles.stageColumn} aria-label="현재 페이지 미리보기">
             {current ? <>
               <div className={styles.stageHeading}><h2>{current.no}장 · {slideTitle(current)}</h2><span>{current.kind === "tile" ? current.view.kindLabel : current.kind === "sheet" ? "타일 조판" : current.kind === "sources" ? "출처" : "표지"}</span></div>
               <PageToolbar selectedSlides={selectedSlides} current={current} applyPatch={applyPatch} resetScales={resetScales} resetLabels={resetLabels} exportStatusRef={exportStatusRef} exportEnabled={exportEnabled} exporting={exporting} makingKind={makingKind} exportProblem={exportProblem} onExport={handleExport} onClose={onClose} />
               <SlidePreview slide={current} basemap={basemap} editable={current.kind === "tile"} onPatch={applyPatch} onMapPatch={onLargeMapPatch} onDirectPatch={onDirectPagePatch} />
             </> : <p className={styles.emptyState}>표시할 페이지가 없습니다.</p>}
           </main>
         </div>
       </div>
    </div>
  );
}
