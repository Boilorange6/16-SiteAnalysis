"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type Dispatch, type PointerEvent as ReactPointerEvent } from "react";
import type { BasemapChoice } from "@/lib/v2/ui/map-projection";
import { metersPerPixel, slideViewport } from "@/lib/v2/ui/map-projection";
import { SLIDE, slideLegend, slidePanelRects, slideSiteX, type Rect } from "@/lib/v2/ui/overlay-layout";
import { coverLayout, fitBlock, fitFooterText, sourceLayout, titlePlateRect } from "@/lib/v2/report/pptx-kit";
import { legendItemsOf, legendLabelOf } from "@/lib/v2/ui/map-layers";
import { mapLabelEntries } from "./map-figure";
import MapFigure from "./map-figure";
import { useFocusTrap } from "./use-focus-trap";
import { extraPageKey, type BoardAction, type BoardState, type PageKey, type PageStyle } from "@/lib/v2/ui/board-state";
import type { PlannedSlide } from "@/lib/v2/report/report-plan";
import type { TileView } from "@/lib/v2/ui/tile-view";
import { sheetCells, type SheetGrid } from "@/lib/v2/ui/sheet";
import { mixedValue, movePageSelection, nextExtraPageId, pageKeyAfterInsertion, selectPageKeys, type PageSelectionModifiers } from "@/lib/v2/ui/report-preview-logic";
import styles from "./report-preview.module.css";

type PreviewStylePatch = Partial<PageStyle>;

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
  return { ...extra, fontSize: Math.max(7, (pt / 72) * unit) };
}

function canvasStyle(unit: number): CSSProperties {
  return { "--slide-unit": String(unit) + "px" } as CSSProperties;
}

function useCanvasUnit(ref: React.RefObject<HTMLDivElement | null>): number {
  const [unit, setUnit] = useState(1);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      if (element.clientWidth > 0) setUnit(element.clientWidth / SLIDE.w);
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
  return unit;
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
  label: string;
};

function MapLayer({ model, style, unit, basemap, panels, siteX, pinnedKeys, interactive, onPatch, label }: MapLayerProps) {
  const width = Math.max(1, Math.round(SLIDE.w * unit));
  const height = Math.max(1, Math.round(SLIDE.h * unit));
  const [draftOffset, setDraftOffset] = useState<[number, number] | null>(null);
  const [dragging, setDragging] = useState(false);
  const draftOffsetRef = useRef<[number, number] | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; offset: [number, number] } | null>(null);
  const renderStyle = draftOffset ? { ...style, offsetM: draftOffset } : style;
  const viewport = slideViewport(model, renderStyle, { width, height, siteX, fill: 0.8 });
  const focusedLabel = legendLabelOf(model, renderStyle.legendFocus);
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
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, offset };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const movePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const mpp = metersPerPixel(viewport.center[1], viewport.zoom);
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    const next: [number, number] = [state.offset[0] - dx * mpp, state.offset[1] + dy * mpp];
    draftOffsetRef.current = next;
    setDraftOffset(next);
  };
  const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const next = draftOffsetRef.current ?? draftOffset ?? state.offset;
    onPatch({ offsetM: [next[0], next[1]] });
    drag.current = null;
    setDragging(false);
    draftOffsetRef.current = null;
    setDraftOffset(null);
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
      highlightLabel={focusedLabel}
      showAutomaticLabels
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

function ReportTitlePanel({ color, code, title, kind, rect, unit }: { color: string; code: string; title: string; kind: string; rect: Rect; unit: number }) {
  const titleBox = { w: Math.max(0.2, rect.w - 0.58), h: Math.max(0.16, rect.h - 0.08) };
  const titlePt = fitBlock([title], titleBox, 18, 7);
  const metaPt = fitBlock([[code, kind].filter(Boolean).join("  ")], titleBox, 10, 7);
  return (
    <div className={styles.slidePanel + " " + styles.titlePanel} style={rectStyle(rect, unit)}>
      <span className={styles.titleDot} style={{ background: color }} aria-hidden="true" />
      {code && <span className={styles.slideMeta} style={fontStyle(metaPt, unit)}>{code}</span>}
      <h3 className={styles.slideTitle} style={fontStyle(titlePt, unit)}>{title}</h3>
      {kind && <span className={styles.slideKind} style={fontStyle(metaPt, unit)}>{kind}</span>}
    </div>
  );
}

function TitlePanel({ slide, rect, unit }: { slide: Extract<PlannedSlide, { kind: "tile" }>; rect: Rect; unit: number }) {
  return <ReportTitlePanel color={slide.view.color} code={slide.view.code} title={slide.view.title} kind={slide.view.kindLabel} rect={rect} unit={unit} />;
}

function SummaryPanel({ slide, rect, unit }: { slide: Extract<PlannedSlide, { kind: "tile" }>; rect: Rect; unit: number }) {
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
  return <div className={styles.slidePanel + " " + styles.summaryPanel} style={rectStyle(rect, unit)}>{children}</div>;
}

function LegendPanel({ slide, rect, unit }: { slide: Extract<PlannedSlide, { kind: "tile" }>; rect: Rect; unit: number }) {
  if (!slide.map) return null;
  const legend = slideLegend(slide.map, !slide.muted);
  const focus = legendLabelOf(slide.map, slide.style.legendFocus);
  return (
    <div className={styles.slidePanel + " " + styles.legendPanel} style={rectStyle(rect, unit)}>
      {legend.items.map((item, index) => {
        const focused = !item.site && focus !== null && item.label === focus;
        const dimmed = focus !== null && !item.site && !focused;
        const pt = fitBlock([item.label], { w: Math.max(0.2, rect.w - 0.55), h: 0.25 }, 10, 7);
        return (
          <div className={styles.legendRow} key={item.label + "-" + index}>
            <span className={item.site ? styles.legendSwatchSite : styles.legendSwatch} style={item.site ? undefined : { background: item.color }} aria-hidden="true" />
            <span className={styles.legendText + (dimmed ? " " + styles.legendDimmed : "") + (focused ? " " + styles.legendFocused : "")} style={fontStyle(pt, unit)}>{item.label}</span>
          </div>
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

function CoverSurface({ slide, unit, basemap, interactive, onPatch }: { slide: Extract<PlannedSlide, { kind: "cover" }>; unit: number; basemap: BasemapChoice; interactive: boolean; onPatch: (patch: PreviewStylePatch) => void }) {
  const map = slide.map;
  const layout = coverLayout({ address: slide.address, metricCount: slide.metrics.length, lineCount: slide.lines.length, incomplete: !!slide.incomplete });
  const mapPanels = { title: layout.left, summary: layout.right, legend: null };
  return (
    <>
      {map && <MapLayer model={map} style={slide.style} unit={unit} basemap={basemap} panels={mapPanels} siteX={0.5} interactive={interactive} onPatch={onPatch} label="표지 지도" />}
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

function TileSurface({ slide, unit, basemap, panels, interactive, onPatch }: { slide: Extract<PlannedSlide, { kind: "tile" }>; unit: number; basemap: BasemapChoice; panels: { title: Rect; summary: Rect | null; legend: Rect | null }; interactive: boolean; onPatch: (patch: PreviewStylePatch) => void }) {
  const model = slide.map;
  const chart = !model && !slide.mass && !slide.rose && slide.body.face !== "single";
  return (
    <>
      {model ? <MapLayer model={model} style={slide.style} unit={unit} basemap={basemap} panels={panels} siteX={slideSiteX(slide.style, panels.summary !== null)} pinnedKeys={slide.pinnedKeys} interactive={interactive} onPatch={onPatch} label={slide.view.title + " 지도"} /> : slide.mass ? <VisualPlaceholder title={slide.view.title} message="3D 매스 미리보기는 내보내기와 같은 페이지 위치로 표시됩니다." unit={unit} /> : slide.rose ? <VisualPlaceholder title={slide.view.title} message="바람장미 도판 미리보기" unit={unit} /> : chart ? <ChartPlaceholder view={slide.view} unit={unit} /> : <VisualPlaceholder title={slide.view.title} message={slide.body.kind === "state" ? slide.body.message : "표시할 지도 결과가 없습니다."} unit={unit} />}
      {slide.body.kind === "state" && <div className={styles.slidePanel} style={{ left: unit * 4, top: unit * 2.7, width: unit * 5.1, height: unit * 1.15 }}><div className={styles.slideText + " " + styles.slideTextStrong} style={fontStyle(16, unit)}>{slide.body.message}</div></div>}
      <TitlePanel slide={slide} rect={panels.title} unit={unit} />
      {panels.summary && hasSummaryPanel(slide) && <SummaryPanel slide={slide} rect={panels.summary} unit={unit} />}
      {panels.legend && <LegendPanel slide={slide} rect={panels.legend} unit={unit} />}
      <SlideFooter slide={slide} unit={unit} />
    </>
  );
}

function SlidePreview({ slide, basemap, editable, onPatch }: { slide: PlannedSlide; basemap: BasemapChoice; editable: boolean; onPatch: (patch: PreviewStylePatch) => void }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const unit = useCanvasUnit(canvasRef);
  const model = mapForSlide(slide);
  const hasSummary = hasSummaryPanel(slide);
  const baseLegend = model && slide.kind === "tile" ? slideLegend(model, !slide.muted).rect : null;
  const panels = slidePanelRects(slide.style, hasSummary, baseLegend);
  return (
    <div className={styles.previewFrame}>
      <div ref={canvasRef} className={styles.slideCanvas} style={canvasStyle(unit)}>
        {slide.kind === "cover" && <CoverSurface slide={slide} unit={unit} basemap={basemap} interactive={editable && !!model} onPatch={onPatch} />}
        {slide.kind === "sources" && <SourcesSurface slide={slide} unit={unit} basemap={basemap} />}
        {slide.kind === "sheet" && <SheetSurface slide={slide} unit={unit} basemap={basemap} />}
        {slide.kind === "tile" && <TileSurface slide={slide} unit={unit} basemap={basemap} panels={panels} interactive={editable && !!model} onPatch={onPatch} />}
      </div>
    </div>
  );
}

type SettingsProps = {
  board: BoardState;
  selectedSlides: PlannedSlide[];
  current: PlannedSlide | null;
  applyPatch: (patch: PreviewStylePatch) => void;
  resetStyles: () => void;
};

function SettingsPanel({ board, selectedSlides, current, applyPatch, resetStyles }: SettingsProps) {
  const mapModel = current ? mapForSlide(current) : null;
  const mapEnabled = !!mapModel;
  const oneTileMap = selectedSlides.length === 1 && current?.kind === "tile" && !!current.map && selectedSlides[0]?.key === current.key;
  const summaryEnabled = current?.kind === "tile" && !(current.callout && current.callout.page > 0);
  const zoom = mixedField(selectedSlides, (slide) => slide.style.zoomDelta ?? 0, 0);
  const titleScale = mixedField(selectedSlides, (slide) => slide.style.titleScale ?? 1, 1);
  const summaryScale = mixedField(selectedSlides, (slide) => slide.style.summaryScale ?? 1, 1);
  const legendScale = mixedField(selectedSlides, (slide) => slide.style.legendScale ?? 1, 1);
  const summary = mixedField(selectedSlides, (slide) => slide.style.summary !== false, true);
  const currentPinned = current && current.kind === "tile" ? (current.style.pinnedKeys ?? current.pinnedKeys ?? []) : [];
  const labelEntries = oneTileMap && current?.map ? mapLabelEntries(current.map) : [];
  const legendEntries = oneTileMap && current?.map ? legendItemsOf(current.map) : [];
  const focusKey = oneTileMap ? current?.style.legendFocus ?? null : null;
  const updateScale = (field: "titleScale" | "summaryScale" | "legendScale", value: number) => applyPatch({ [field]: clampNumber(value, 0.7, 1.5) });
  const mapReason = !selectedSlides.length ? "페이지를 먼저 선택하세요." : !mapEnabled ? "현재 장은 지도 설정을 지원하지 않습니다." : undefined;
  return (
    <aside className={styles.settings} aria-label="페이지 설정">
      <div className={styles.settingsHeader}>
        <h2>페이지 설정</h2>
        <span className={styles.railHint}>{selectedSlides.length}장</span>
      </div>
      <section className={styles.settingsSection} aria-labelledby="preview-map-settings">
        <h3 id="preview-map-settings">지도</h3>
        {mapReason && <p className={styles.disabledReason}>{mapReason}</p>}
        <div aria-disabled={!mapEnabled || !selectedSlides.length} style={!mapEnabled || !selectedSlides.length ? { opacity: 0.55 } : undefined}>
          <div className={styles.controlRow}>
            <div className={styles.controlRowInline}>
              <span className={styles.controlLabel}>지도 확대</span>
              <span className={styles.rangeValue}>{zoom.mixed ? "여러 값" : formatZoom(zoom.value)}</span>
            </div>
            <div className={styles.zoomActions}>
              <button type="button" className={styles.smallButton} disabled={!mapEnabled || !selectedSlides.length} onClick={() => applyPatch({ zoomDelta: clampNumber((zoom.mixed ? 0 : zoom.value) - 0.5, -3, 3) })} aria-label="지도 축소">−</button>
              <input className={styles.range} type="range" min="-3" max="3" step="0.5" value={zoom.mixed ? 0 : zoom.value} disabled={!mapEnabled || !selectedSlides.length} onChange={(event) => applyPatch({ zoomDelta: Number(event.currentTarget.value) })} aria-label="지도 확대" aria-valuetext={zoom.mixed ? "여러 값" : formatZoom(zoom.value)} />
              <button type="button" className={styles.smallButton} disabled={!mapEnabled || !selectedSlides.length} onClick={() => applyPatch({ zoomDelta: clampNumber((zoom.mixed ? 0 : zoom.value) + 0.5, -3, 3) })} aria-label="지도 확대">+</button>
            </div>
          </div>
          <button type="button" className={styles.centerButton} disabled={!mapEnabled || !selectedSlides.length} onClick={() => applyPatch({ offsetM: [0, 0] })}>대지 중앙 정렬</button>
        </div>
        <p className={styles.helper}>큰 페이지에서 지도를 드래그하거나 휠로 이동·확대할 수 있습니다.</p>
      </section>
      <section className={styles.settingsSection} aria-labelledby="preview-panel-settings">
        <h3 id="preview-panel-settings">패널</h3>
        <label className={styles.switchRow}>
          <input type="checkbox" checked={summary.value} disabled={!summaryEnabled || !selectedSlides.length} onChange={(event) => applyPatch({ summary: event.currentTarget.checked })} />
          <span className={styles.switchText}>요약 탭 표시{summary.mixed ? " · 여러 값" : ""}</span>
        </label>
        <div className={styles.controlRow}>
          <div className={styles.controlRowInline}><span className={styles.controlLabel}>제목 탭 크기</span><span className={styles.rangeValue}>{titleScale.mixed ? "여러 값" : formatScale(titleScale.value)}</span></div>
          <input className={styles.range} type="range" min="0.7" max="1.5" step="0.1" value={titleScale.mixed ? 1 : titleScale.value} disabled={!selectedSlides.length} onChange={(event) => updateScale("titleScale", Number(event.currentTarget.value))} aria-label="제목 탭 크기" aria-valuetext={titleScale.mixed ? "여러 값" : formatScale(titleScale.value)} />
        </div>
        <div className={styles.controlRow}>
          <div className={styles.controlRowInline}><span className={styles.controlLabel}>요약 탭 크기</span><span className={styles.rangeValue}>{summaryScale.mixed ? "여러 값" : formatScale(summaryScale.value)}</span></div>
          <input className={styles.range} type="range" min="0.7" max="1.5" step="0.1" value={summaryScale.mixed ? 1 : summaryScale.value} disabled={!summaryEnabled || !selectedSlides.length} onChange={(event) => updateScale("summaryScale", Number(event.currentTarget.value))} aria-label="요약 탭 크기" aria-valuetext={summaryScale.mixed ? "여러 값" : formatScale(summaryScale.value)} />
        </div>
        <div className={styles.controlRow}>
          <div className={styles.controlRowInline}><span className={styles.controlLabel}>범례 탭 크기</span><span className={styles.rangeValue}>{legendScale.mixed ? "여러 값" : formatScale(legendScale.value)}</span></div>
          <input className={styles.range} type="range" min="0.7" max="1.5" step="0.1" value={legendScale.mixed ? 1 : legendScale.value} disabled={!mapEnabled || !selectedSlides.length} onChange={(event) => updateScale("legendScale", Number(event.currentTarget.value))} aria-label="범례 탭 크기" aria-valuetext={legendScale.mixed ? "여러 값" : formatScale(legendScale.value)} />
        </div>
        <button type="button" className={styles.resetButton} disabled={!selectedSlides.length} onClick={resetStyles}>선택 장 기본값</button>
      </section>
      <section className={styles.settingsSection} aria-labelledby="preview-label-settings">
        <h3 id="preview-label-settings">지도 라벨</h3>
        {!oneTileMap ? <p className={styles.disabledReason}>한 장의 지도 페이지를 선택하면 라벨을 설정할 수 있습니다.</p> : labelEntries.length === 0 ? <p className={styles.disabledReason}>이 지도에는 고정할 라벨 후보가 없습니다.</p> : (
          <>
            <div className={styles.checkList}>
              {labelEntries.map((entry) => (
                <label className={styles.checkOption} key={entry.key}>
                  <input type="checkbox" checked={currentPinned.includes(entry.key)} onChange={(event) => {
                    const next = new Set(currentPinned);
                    if (event.currentTarget.checked) next.add(entry.key);
                    else next.delete(entry.key);
                    applyPatch({ pinnedKeys: [...next] });
                  }} />
                  <span className={styles.optionText}>{entry.text}</span>
                </label>
              ))}
            </div>
            <button type="button" className={styles.resetButton} onClick={() => applyPatch({ pinnedKeys: undefined })}>보드 라벨 따르기</button>
          </>
        )}
      </section>
      <section className={styles.settingsSection} aria-labelledby="preview-legend-settings">
        <h3 id="preview-legend-settings">범례 강조</h3>
        {!oneTileMap ? <p className={styles.disabledReason}>한 장의 지도 페이지를 선택하면 범례를 설정할 수 있습니다.</p> : legendEntries.length === 0 ? <p className={styles.disabledReason}>표시할 범례가 없습니다.</p> : (
          <div className={styles.radioList}>
            <label className={styles.radioOption}>
              <input type="radio" name="preview-legend-focus" checked={focusKey === null} onChange={() => applyPatch({ legendFocus: null })} />
              <span className={styles.optionText}>강조 없이 전체 표시</span>
            </label>
            {legendEntries.map((entry) => (
              <label className={styles.radioOption} key={entry.key}>
                <input type="radio" name="preview-legend-focus" checked={focusKey === entry.key} onChange={() => applyPatch({ legendFocus: entry.key })} />
                <span className={styles.optionText}>{entry.label}</span>
              </label>
            ))}
          </div>
        )}
      </section>
      {board.report.extra.length > 0 && <p className={styles.helper}>추가 페이지 {board.report.extra.length}장은 보드에 저장됩니다.</p>}
    </aside>
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
  const addButtonRefs = useRef(new Map<PageKey, HTMLButtonElement>());
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
  const [addAfterKey, setAddAfterKey] = useState<PageKey | null>(null);
  const [addPopoverStyle, setAddPopoverStyle] = useState<CSSProperties | null>(null);
  addAfterKeyRef.current = addAfterKey;

  const closeAddPopover = useCallback((restoreFocus = false) => {
    const key = addAfterKeyRef.current;
    setAddAfterKey(null);
    setAddPopoverStyle(null);
    if (restoreFocus && key) addButtonRefs.current.get(key)?.focus({ preventScroll: true });
  }, []);

  const updateAddPopoverPosition = useCallback(() => {
    if (!addAfterKey) return;
    const anchor = addButtonRefs.current.get(addAfterKey);
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
      if (addAfterKeyRef.current === null) return false;
      closeAddPopover(true);
      return true;
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
  const resetStyles = useCallback(() => {
    const keys = selectedKeys.length > 0 ? selectedKeys : (current ? [current.key] : []);
    if (keys.length > 0) dispatch({ type: "pageStyleReset", keys });
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
  const addOptions = board.order.map((id) => ({ id, view: views.get(id) })).filter((entry): entry is { id: string; view: TileView } => !!entry.view);
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
          <button type="button" className={styles.closeButton} onClick={onClose}>닫기</button>
        </header>
        <div className={styles.body}>
          <nav className={styles.thumbRail} aria-label="보고서 페이지 목록">
            <div className={styles.railHeading}><h2>페이지</h2><span className={styles.railHint}>{plan.length}장</span></div>
            <ol className={styles.thumbList}>
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
                    {extra && <button type="button" className={styles.deleteExtra} onClick={() => removeExtra(slide.key)}>추가 페이지 삭제</button>}
                    <button type="button" ref={(element) => {
                      if (element) addButtonRefs.current.set(slide.key, element);
                      else addButtonRefs.current.delete(slide.key);
                    }} className={styles.addButton} aria-label={slideTitle(slide) + " 뒤에 페이지 추가"} aria-expanded={addAfterKey === slide.key} aria-controls={addAfterKey === slide.key ? addPopoverId : undefined} onClick={() => {
                      setAddPopoverStyle(null);
                      setAddAfterKey((key) => key === slide.key ? null : slide.key);
                    }}>+</button>
                    {addAfterKey === slide.key && (
                      <div ref={addPopoverRef} id={addPopoverId} className={styles.addPopover} style={addPopoverStyle ?? undefined} role="region" aria-label="페이지 추가">
                        <p className={styles.addPopoverHeading}>이 페이지 뒤에 타일 추가</p>
                        <div className={styles.addTileList}>
                          {addOptions.map((entry) => (
                            <div className={styles.addTileButton} key={entry.id}>
                              <span className={styles.addTileName}>{entry.view.title}</span>
                              {entry.view.hasFace ? <span className={styles.faceOptions}><button type="button" className={styles.faceButton} aria-label={entry.view.title + " 앞면 추가"} onClick={() => addPage(entry.id, "front")}>앞면</button><button type="button" className={styles.faceButton} aria-label={entry.view.title + " 뒷면 추가"} onClick={() => addPage(entry.id, "back")}>뒷면</button></span> : <button type="button" className={styles.faceButton} aria-label={entry.view.title + " 페이지 추가"} onClick={() => addPage(entry.id, "front")}>추가</button>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
          <main className={styles.stageColumn} aria-label="현재 페이지 미리보기">
            {current ? <><div className={styles.stageHeading}><h2>{current.no}장 · {slideTitle(current)}</h2><span>{current.kind === "tile" ? current.view.kindLabel : current.kind === "sheet" ? "타일 조판" : current.kind === "sources" ? "출처" : "표지"}</span></div><SlidePreview slide={current} basemap={basemap} editable={!!mapForSlide(current)} onPatch={onLargeMapPatch} /></> : <p className={styles.emptyState}>표시할 페이지가 없습니다.</p>}
          </main>
          <SettingsPanel board={board} selectedSlides={selectedSlides} current={current} applyPatch={applyPatch} resetStyles={resetStyles} />
        </div>
        <footer className={styles.footer}>
          <p ref={exportStatusRef} className={styles.footerStatus + " " + (exportProblem ? styles.footerError : "")} role={exportProblem ? "alert" : "status"} aria-live="polite" aria-busy={exporting} tabIndex={-1}>{exportProblem ?? (exporting ? (makingKind ?? "PPT") + " 내보내는 중…" : "설정은 보드에 자동 저장됩니다.")}</p>
          <button type="button" className={styles.exportButton} onClick={handleExport} disabled={!exportEnabled || exporting}>{exporting ? "내보내는 중…" : "PPT 내보내기"}</button>
        </footer>
      </div>
    </div>
  );
}
