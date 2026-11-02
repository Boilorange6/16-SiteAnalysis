"use client";

import * as React from "react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes } from "react";
import { analysisStatLine, type AnalysisCharts } from "@/lib/v2/report/analysis-charts";
import { RECT_STROKE_PT, compositionShapes, distanceShapes, type ChartBox, type ChartShape } from "@/lib/v2/report/chart-geometry";
import { SENTENCE_BAR, BAR_W } from "@/lib/v2/report/key-figure-fit";
import type { ReportPageFrame } from "@/lib/v2/report/report-page-frame";
import type { Rect } from "@/lib/v2/ui/overlay-layout";
import type { TileView } from "@/lib/v2/ui/tile-view";
import { KeyFigureCard } from "./key-figure-card";
import { fontStyle } from "./surface-style";

/**
 * 「지도 + 그래프」 오른쪽 분석 열(spec §3-3): 핵심 숫자 카드 → 그래프 카드 둘(구성비·거리) → 열 맨 아래 해석 한 줄 + 주석 칩.
 * 모든 사각형은 `reportPageGeometry`의 `column`, 카드 안은 `keyFigureFit`의 `rows`다. 열은 떠 있는 판이 아니라 배치의 한 영역이라
 * 고르고 지울 수만 있다(옮기기·크기 없음). 열 바탕 띠는 호출하는 쪽(TileSurface)이 깐다.
 */

type Styles = Record<string, string>;

const POPOVER_WIDTH = 288;
const POPOVER_GAP = 6;
const VIEWPORT_MARGIN = 8;

/** 도형 목록(슬라이드 inch·pt)을 SVG로 그린다. 좌표는 unit(px/in)을 곱하고, pt는 unit/72 px. 글자는 한 줄이며 줄바꿈하지 않는다. */
export function ChartSvg({ shapes, box, panel, unit, kind, label, styles }: { shapes: ChartShape[]; box: ChartBox; panel: Rect; unit: number; kind: "composition" | "distance"; label: string; styles: Styles }) {
  const ptPx = unit / 72;
  const X = (x: number) => (x - box.x) * unit;
  const Y = (y: number) => (y - box.y) * unit;
  const n = (v: number) => Number(v.toFixed(3));
  return (
    <svg
      className={styles.analysisChart}
      data-chart={kind}
      role="img"
      aria-label={label}
      width={box.w * unit}
      height={box.h * unit}
      viewBox={`0 0 ${n(box.w * unit)} ${n(box.h * unit)}`}
      style={{ position: "absolute", left: (box.x - panel.x) * unit, top: (box.y - panel.y) * unit }}
    >
      {shapes.map((s) => {
        if (s.kind === "rect") return <rect key={s.name} x={n(X(s.x))} y={n(Y(s.y))} width={n(s.w * unit)} height={n(s.h * unit)} fill={s.fill} {...(s.stroke ? { stroke: s.stroke, strokeWidth: RECT_STROKE_PT * ptPx } : {})} />;
        if (s.kind === "line") {
          const w = s.width * ptPx;
          return <line key={s.name} x1={n(X(s.x1))} y1={n(Y(s.y1))} x2={n(X(s.x2))} y2={n(Y(s.y2))} stroke={s.stroke} strokeWidth={w} {...(s.dash ? { strokeDasharray: `${n(w * 4)} ${n(w * 3)}` } : {})} />;
        }
        if (s.kind === "dots") {
          const r = s.r * unit;
          const d = s.points.map(([x, y]) => `M${n(X(x) - r)} ${n(Y(y))}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0`).join("");
          return <path key={s.name} d={d} fill={s.color} fillOpacity={s.opacity} {...(s.stroke ? { stroke: s.stroke, strokeWidth: (s.strokeWidth ?? RECT_STROKE_PT) * ptPx } : {})} />;
        }
        const anchor = s.align === "left" ? "start" : s.align === "right" ? "end" : "middle";
        const x = s.align === "left" ? s.x : s.align === "right" ? s.x + s.w : s.x + s.w / 2;
        return <text key={s.name} x={n(X(x))} y={n(Y(s.y + s.h / 2))} textAnchor={anchor} dominantBaseline="central" fontSize={s.pt * ptPx} fontWeight={s.bold ? 700 : 400} fill={s.color} style={{ whiteSpace: "pre" }}>{s.text}</text>;
      })}
    </svg>
  );
}

type Edges = { left: number; top: number; right: number; bottom: number };
export type NotesPlacement = { up: boolean; width: number; maxHeight: number };

/**
 * 주석 팝오버 자리. 칩의 왼쪽 가장자리에 붙이고, 폭은 288 px와 슬라이드 오른쪽 끝까지 남은 폭 중 작은 쪽,
 * 열리는 쪽은 위·아래 중 여유가 큰 쪽이며 최대 높이는 그 여유(슬라이드 표면과 화면이 겹치는 영역 안)다.
 */
export function placeNotesPopover(chip: Edges, bounds: Edges): NotesPlacement {
  const width = Math.max(96, Math.min(POPOVER_WIDTH, bounds.right - chip.left - VIEWPORT_MARGIN));
  const above = chip.top - bounds.top - POPOVER_GAP - VIEWPORT_MARGIN;
  const below = bounds.bottom - chip.bottom - POPOVER_GAP - VIEWPORT_MARGIN;
  const up = above >= below;
  return { up, width, maxHeight: Math.max(48, up ? above : below) };
}

/** `주석 N` 칩: 올리거나 포커스하면 각주 목록 팝오버(흰 카드). Esc·포커스를 잃음·포인터가 벗어남으로 닫는다. */
export function NotesChip({ notes, rect, panel, unit, styles, growUp = false }: { notes: string[]; rect: Rect; panel: Rect; unit: number; styles: Styles; /** 칩은 손가락 크기(24 px)보다 작아지지 않는다. true면 모자란 높이를 위로 키워 열 아래 끝을 넘지 않는다. */ growUp?: boolean }) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<NotesPlacement>({ up: true, width: POPOVER_WIDTH, maxHeight: 320 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  useEffect(() => {
    if (!open) return;
    // 캡처 단계에서 가로채 한 번의 Esc가 보고서의 서랍·선택 해제까지 닫지 않게 한다.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const button = buttonRef.current;
      if (!button) return;
      const chip = button.getBoundingClientRect();
      const surface = button.closest("[data-slide-surface]")?.getBoundingClientRect();
      setPlacement(placeNotesPopover(chip, {
        left: Math.max(0, surface?.left ?? 0),
        top: Math.max(0, surface?.top ?? 0),
        right: Math.min(window.innerWidth, surface?.right ?? window.innerWidth),
        bottom: Math.min(window.innerHeight, surface?.bottom ?? window.innerHeight),
      }));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, notes.length]);
  return (
    <div
      className={styles.analysisNotes}
      data-part="notes-chip"
      style={{ position: "absolute", left: (rect.x - panel.x) * unit, top: growUp ? (rect.y + rect.h - panel.y) * unit - Math.max(24, rect.h * unit) : (rect.y - panel.y) * unit, width: rect.w * unit, height: Math.max(24, rect.h * unit) }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        className={styles.analysisNotesChip}
        aria-expanded={open}
        aria-controls={popoverId}
        aria-describedby={popoverId}
        onPointerDown={(event) => event.stopPropagation()}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
      >주석 {notes.length}</button>
      <div
        id={popoverId}
        role="tooltip"
        hidden={!open}
        className={styles.analysisNotesPopover}
        data-placement={placement.up ? "up" : "down"}
        style={{ width: placement.width, maxHeight: placement.maxHeight + POPOVER_GAP, ...(placement.up ? { bottom: "100%", paddingBottom: POPOVER_GAP } : { top: "100%", paddingTop: POPOVER_GAP }) }}
      >
        <div className={styles.analysisNotesCard}>
          <ul>{notes.map((note) => <li key={note}>{note}</li>)}</ul>
        </div>
      </div>
    </div>
  );
}

export function AnalysisColumn({ styles, frame, charts, view, unit, showNotes, interaction }: { styles: Styles; frame: ReportPageFrame; /** D17 단면 장은 그래프 자료가 없다(그래프 카드 자리는 호출하는 쪽이 단면을 그린다) */ charts: AnalysisCharts | null; view: TileView; unit: number; showNotes: boolean; interaction?: HTMLAttributes<HTMLDivElement> & Record<string, unknown> }) {
  const column = frame.geometry.column;
  const compShapes = useMemo(() => (charts && frame.chart1 ? compositionShapes(charts.composition, frame.chart1, frame.chartScale, charts.titles.composition) : []), [charts, frame.chart1, frame.chartScale]);
  const distShapes = useMemo(() => (charts && frame.chart2 ? distanceShapes(charts.distance, charts.radiusM, frame.chart2, frame.chartScale, charts.titles.distance) : []), [charts, frame.chart2, frame.chartScale]);
  if (!column) return null;
  const { rect } = column;
  // 열 왼쪽 위(= 열 상자)를 (0, 0)으로 한 inch
  const rel = (r: Rect): Rect => ({ x: r.x - rect.x, y: r.y - rect.y, w: r.w, h: r.h });
  const at = (r: Rect, extra: React.CSSProperties = {}): React.CSSProperties => ({ position: "absolute", left: (r.x - rect.x) * unit, top: (r.y - rect.y) * unit, width: r.w * unit, height: r.h * unit, ...extra });
  const pct = (item: AnalysisCharts["composition"][number]) => (item.share > 0 && Math.round(item.share * 100) === 0 ? "1% 미만" : `${Math.round(item.share * 100)}%`);
  const compLabel = charts ? `${charts.titles.composition} 막대 그래프. ${charts.composition.map((item) => `${item.label} ${pct(item)}`).join(", ")}` : "";
  const distLabel = charts ? `${charts.titles.distance} ${charts.distance.kind === "scatter" ? "산점도" : "막대 그래프"}. ${analysisStatLine(charts)}` : "";
  const card = (r: Rect, key: string, box: ChartBox | null, shapes: ChartShape[], kind: "composition" | "distance", label: string) => (
    <div key={key} className={styles.kfCard} data-part="chart-card" style={at(r, { borderRadius: 0.125 * unit })}>
      {box && <ChartSvg shapes={shapes} box={box} panel={r} unit={unit} kind={kind} label={label} styles={styles} />}
    </div>
  );
  // 해석 한 줄: 열 맨 아래, 카드 없음. 왼쪽 3 px 타일 색 막대 + 글(최대 3줄, 넘치면 …).
  const sentence = column.sentence;
  const fit = frame.fit;
  const sentenceInfo = frame.sentence;
  const sentenceLines = sentenceInfo?.lines ?? [];
  return (
    <div className={styles.kfColumn} data-part="analysis-column" data-analysis-column="true" style={{ position: "absolute", left: rect.x * unit, top: rect.y * unit, width: rect.w * unit, height: rect.h * unit }} {...interaction}>
      {fit && frame.figure && <KeyFigureCard styles={styles} view={view} fit={fit} rect={rel(column.key)} unit={unit} />}
      {charts && column.chart1 && card(column.chart1, "composition", frame.chart1, compShapes, "composition", compLabel)}
      {charts && column.chart2 && card(column.chart2, "distance", frame.chart2, distShapes, "distance", distLabel)}
      {sentenceLines.length > 0 && (
        <>
          <span className={styles.kfBar} style={at({ x: sentence.x, y: sentence.y, w: BAR_W, h: sentence.h }, { background: view.color })} />
          <div className={styles.kfText} data-part="column-sentence" style={{ ...at({ x: sentence.x + SENTENCE_BAR, y: sentence.y, w: sentence.w - SENTENCE_BAR, h: sentence.h }), ...fontStyle(sentenceInfo!.pt, unit), lineHeight: 1.25, color: "#15171c", fontWeight: 700, whiteSpace: "pre-line", overflow: "hidden" }}>{sentenceLines.join("\n")}</div>
        </>
      )}
      {showNotes && frame.notes.length > 0 && <NotesChip notes={frame.notes} rect={column.notesChip} panel={rect} unit={unit} styles={styles} growUp />}
    </div>
  );
}
