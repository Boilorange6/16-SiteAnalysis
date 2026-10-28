"use client";

import * as React from "react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { analysisStatLine, type AnalysisCharts } from "@/lib/v2/report/analysis-charts";
import { compositionShapes, distanceShapes, type ChartBox, type ChartShape } from "@/lib/v2/report/chart-geometry";
import { DEFAULT_REPORT_FONT_SIZES } from "@/lib/v2/report/report-doc";
import { CHIP, fitBlock, textIn } from "@/lib/v2/report/pptx-kit";
import { chartsColumnLayout, type Rect } from "@/lib/v2/ui/overlay-layout";
import type { TileView } from "@/lib/v2/ui/tile-view";
import { fontStyle } from "./surface-style";

/** 「지도 + 그래프」 요약 칸: 배지 → 큰 숫자 → 한 줄 통계(+필터 줄) → 구성비 → 거리 → 해석 문장 → 주석 칩. 칸 배치는 PPT와 같은 chartsColumnLayout. */

type Styles = Record<string, string>;

const LINE = 1.25; // fitBlock이 줄 높이로 가정하는 값
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
        if (s.kind === "rect") return <rect key={s.name} x={n(X(s.x))} y={n(Y(s.y))} width={n(s.w * unit)} height={n(s.h * unit)} fill={s.fill} {...(s.stroke ? { stroke: s.stroke, strokeWidth: 0.75 * ptPx } : {})} />;
        if (s.kind === "line") {
          const w = s.width * ptPx;
          return <line key={s.name} x1={n(X(s.x1))} y1={n(Y(s.y1))} x2={n(X(s.x2))} y2={n(Y(s.y2))} stroke={s.stroke} strokeWidth={w} {...(s.dash ? { strokeDasharray: `${n(w * 4)} ${n(w * 3)}` } : {})} />;
        }
        if (s.kind === "dots") {
          const r = s.r * unit;
          const d = s.points.map(([x, y]) => `M${n(X(x) - r)} ${n(Y(y))}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0`).join("");
          return <path key={s.name} d={d} fill={s.color} fillOpacity={s.opacity} {...(s.stroke ? { stroke: s.stroke, strokeWidth: (s.strokeWidth ?? 0.75) * ptPx } : {})} />;
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
function NotesChip({ notes, rect, panel, unit, styles }: { notes: string[]; rect: Rect; panel: Rect; unit: number; styles: Styles }) {
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
      style={{ position: "absolute", left: (rect.x - panel.x) * unit, top: (rect.y - panel.y) * unit, width: rect.w * unit, height: Math.max(24, rect.h * unit) }}
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

export function AnalysisColumn({ styles, charts, view, sentence, rect, unit, summaryPt, showNotes }: { styles: Styles; charts: AnalysisCharts; view: TileView; sentence: string | null; rect: Rect; unit: number; summaryPt: number; showNotes: boolean }) {
  const scale = summaryPt / DEFAULT_REPORT_FONT_SIZES.summary;
  const col = useMemo(() => chartsColumnLayout({ x: rect.x, y: rect.y, w: rect.w, h: rect.h }, scale), [rect.x, rect.y, rect.w, rect.h, scale]);
  const compShapes = useMemo(() => compositionShapes(charts.composition, col.composition, scale, charts.titles.composition), [charts, col.composition, scale]);
  const distShapes = useMemo(() => distanceShapes(charts.distance, charts.radiusM, col.distance, scale, charts.titles.distance), [charts, col.distance, scale]);
  const at = (r: Rect): CSSProperties => ({ position: "absolute", left: (r.x - rect.x) * unit, top: (r.y - rect.y) * unit, width: r.w * unit, height: r.h * unit, overflow: "hidden" });

  // 큰 숫자 칸: 배지 줄 + 라벨 + 값. 칸 높이를 넘으면 배율을 줄여 맞춘다.
  const badges = view.badges;
  const headline = view.headline;
  const hr = col.headline;
  const chipRows = (e: number) => {
    let rows = badges.length ? 1 : 0;
    let x = 0;
    for (const b of badges) {
      const w = Math.min(hr.w, textIn(b.text, 9 * e) + 0.24 * e);
      if (x > 0 && x + w > hr.w) { rows += 1; x = 0; }
      x += w + 0.08 * e;
    }
    return rows;
  };
  const needed = (e: number) => chipRows(e) * 0.32 * e + (headline ? 0.9 * e : 0);
  let e = scale;
  while (e > 0.4 && needed(e) > hr.h) e -= 0.05;

  // 한 줄 통계 칸: 통계 + (있으면) 필터 줄. 같은 글자 크기로 칸에 맞추고, 그래도 넘치면 줄 수를 묶는다(필터 줄은 한 줄).
  const statText = analysisStatLine(charts);
  const filterLine = view.filterLine;
  const statPt = fitBlock(filterLine ? [statText, filterLine] : [statText], { w: col.stat.w, h: col.stat.h }, 10 * scale, 7);
  const statRows = Math.max(1, Math.floor(col.stat.h / ((statPt / 72) * LINE) + 1e-9));
  const statClamp = Math.max(1, statRows - (filterLine ? 1 : 0));
  const clamp = (lines: number): CSSProperties => ({ display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: LINE });

  // 해석 문장 칸: 요약 크기에서 시작해 10 pt까지 줄이고, 그래도 넘치면 줄 수를 묶는다.
  const sentPt = fitBlock([sentence ?? ""], { w: col.sentence.w, h: col.sentence.h }, summaryPt, 10);
  const sentLines = Math.max(1, Math.floor(col.sentence.h / ((sentPt / 72) * LINE) + 1e-9));
  const notes = [...new Set([...view.caveats, ...view.notes])];
  const pct = (item: AnalysisCharts["composition"][number]) => (item.share > 0 && Math.round(item.share * 100) === 0 ? "1% 미만" : `${Math.round(item.share * 100)}%`);
  const compLabel = `${charts.titles.composition} 막대 그래프. ${charts.composition.map((item) => `${item.label} ${pct(item)}`).join(", ")}`;
  const distLabel = `${charts.titles.distance} ${charts.distance.kind === "scatter" ? "산점도" : "막대 그래프"}. ${statText}`;

  return (
    <div data-analysis-column="true">
      {(badges.length > 0 || headline) && (
        <div style={{ ...at(hr), display: "flex", flexDirection: "column" }}>
          {badges.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: `${0.06 * e * unit}px ${0.08 * e * unit}px`, marginBottom: 0.04 * e * unit }}>
              {badges.map((b) => (
                <span key={b.text} style={{ ...fontStyle(Math.max(7, 9 * e), unit), background: `#${CHIP[b.tone].fill}`, color: `#${CHIP[b.tone].color}`, fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap", padding: `${0.03 * e * unit}px ${0.12 * e * unit}px`, borderRadius: 0.15 * e * unit }}>{b.text}</span>
              ))}
            </div>
          )}
          {headline && (
            <>
              <div className={styles.slideMetricLabel} style={fontStyle(fitBlock([headline.label], { w: hr.w, h: 0.24 * e }, 11 * e, 7), unit)}>{headline.label}</div>
              <div className={styles.slideMetricValue} style={fontStyle(fitBlock([headline.value], { w: hr.w, h: 0.66 * e }, 36 * e, 7), unit, { textAlign: "left" })}>{headline.value}</div>
            </>
          )}
        </div>
      )}
      <div style={{ ...at(col.stat), ...fontStyle(statPt, unit), lineHeight: LINE }}>
        <div className={styles.slideText} style={clamp(statClamp)}>{statText}</div>
        {filterLine && <div className={styles.slideText} style={clamp(1)}>{filterLine}</div>}
      </div>
      <ChartSvg shapes={compShapes} box={col.composition} panel={rect} unit={unit} kind="composition" label={compLabel} styles={styles} />
      <ChartSvg shapes={distShapes} box={col.distance} panel={rect} unit={unit} kind="distance" label={distLabel} styles={styles} />
      {sentence && <div className={styles.slideText + " " + styles.slideTextStrong} style={{ ...at(col.sentence), ...fontStyle(sentPt, unit), lineHeight: LINE, ...clamp(sentLines) }}>{sentence}</div>}
      {showNotes && notes.length > 0 && <NotesChip notes={notes} rect={col.notesChip} panel={rect} unit={unit} styles={styles} />}
    </div>
  );
}
