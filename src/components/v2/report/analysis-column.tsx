"use client";

import * as React from "react";
import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { analysisStatLine, type AnalysisCharts } from "@/lib/v2/report/analysis-charts";
import { compositionShapes, distanceShapes, type ChartBox, type ChartShape } from "@/lib/v2/report/chart-geometry";
import { DEFAULT_REPORT_FONT_SIZES } from "@/lib/v2/report/report-doc";
import { fitBlock, textIn } from "@/lib/v2/report/pptx-kit";
import { chartsColumnLayout, type Rect } from "@/lib/v2/ui/overlay-layout";
import type { TileView } from "@/lib/v2/ui/tile-view";

/** 「지도 + 그래프」 요약 칸: 배지 → 큰 숫자 → 한 줄 통계 → 구성비 → 거리 → 해석 문장 → 주석 칩. 칸 배치는 PPT와 같은 chartsColumnLayout. */

type Styles = Record<string, string>;

// render-pptx의 CHIP과 같은 색
const CHIP = {
  status: { background: "#FCE9C7", color: "#7A4B00" },
  limit: { background: "#F0E8DC", color: "#5B4A2F" },
  model: { background: "#E6E1F7", color: "#3D2E8C" },
} as const;

const fontPx = (pt: number, unit: number): CSSProperties => ({ fontSize: (pt / 72) * unit });
const LINE = 1.25; // fitBlock이 줄 높이로 가정하는 값

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

/** `주석 N` 칩: 올리거나 포커스하면 각주 목록 팝오버(흰 카드 288 px). Esc·포커스를 잃음·포인터가 벗어남으로 닫는다. */
function NotesChip({ notes, rect, panel, unit, styles }: { notes: string[]; rect: Rect; panel: Rect; unit: number; styles: Styles }) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className={styles.analysisNotes} style={{ position: "absolute", left: (rect.x - panel.x) * unit, top: (rect.y - panel.y) * unit, width: rect.w * unit, height: rect.h * unit }}>
      <button
        type="button"
        className={styles.analysisNotesChip}
        aria-expanded={open}
        {...(open ? { "aria-controls": popoverId, "aria-describedby": popoverId } : {})}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
      >주석 {notes.length}</button>
      {open && (
        <div id={popoverId} role="tooltip" className={styles.analysisNotesPopover}>
          <ul>{notes.map((note) => <li key={note}>{note}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

export function AnalysisColumn({ styles, charts, view, sentence, rect, unit, summaryPt, showNotes }: { styles: Styles; charts: AnalysisCharts; view: TileView; sentence: string | null; rect: Rect; unit: number; summaryPt: number; showNotes: boolean }) {
  const scale = summaryPt / DEFAULT_REPORT_FONT_SIZES.summary;
  const col = useMemo(() => chartsColumnLayout({ x: rect.x, y: rect.y, w: rect.w, h: rect.h }, scale), [rect.x, rect.y, rect.w, rect.h, scale]);
  const compShapes = useMemo(() => compositionShapes(charts.composition, col.composition, scale), [charts, col.composition, scale]);
  const distShapes = useMemo(() => distanceShapes(charts.distance, charts.radiusM, col.distance, scale), [charts, col.distance, scale]);
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
  const statText = analysisStatLine(charts);
  const statPt = fitBlock([statText], { w: col.stat.w, h: col.stat.h }, 10 * scale, 7);
  const sentPt = fitBlock([sentence ?? ""], { w: col.sentence.w, h: col.sentence.h }, summaryPt, 10);
  const sentLines = Math.max(1, Math.floor(col.sentence.h / ((sentPt / 72) * LINE) + 1e-9));
  const notes = [...new Set([...view.caveats, ...view.notes])];
  const pct = (item: AnalysisCharts["composition"][number]) => (item.share > 0 && Math.round(item.share * 100) === 0 ? "1% 미만" : `${Math.round(item.share * 100)}%`);
  const compLabel = `${charts.subject} 구성비 막대 그래프. ${charts.composition.map((item) => `${item.label} ${pct(item)}`).join(", ")}`;
  const distLabel = charts.distance.kind === "scatter"
    ? `대지에서 거리와 ${charts.distance.axis.label} 산점도. ${statText}`
    : `대지에서 거리대별 ${charts.subject} 수 막대 그래프. ${statText}`;

  return (
    <div data-analysis-column="true">
      {(badges.length > 0 || headline) && (
        <div style={{ ...at(hr), display: "flex", flexDirection: "column" }}>
          {badges.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: `${0.06 * e * unit}px ${0.08 * e * unit}px`, marginBottom: 0.04 * e * unit }}>
              {badges.map((b) => (
                <span key={b.text} style={{ ...fontPx(Math.max(7, 9 * e), unit), ...CHIP[b.tone], fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap", padding: `${0.03 * e * unit}px ${0.12 * e * unit}px`, borderRadius: 0.15 * e * unit }}>{b.text}</span>
              ))}
            </div>
          )}
          {headline && (
            <>
              <div className={styles.slideMetricLabel} style={fontPx(fitBlock([headline.label], { w: hr.w, h: 0.24 * e }, 11 * e, 7), unit)}>{headline.label}</div>
              <div className={styles.slideMetricValue} style={{ ...fontPx(fitBlock([headline.value], { w: hr.w, h: 0.66 * e }, 36 * e, 7), unit), textAlign: "left" }}>{headline.value}</div>
            </>
          )}
        </div>
      )}
      <div className={styles.slideText} style={{ ...at(col.stat), ...fontPx(statPt, unit), lineHeight: LINE }}>{statText}</div>
      <ChartSvg shapes={compShapes} box={col.composition} panel={rect} unit={unit} kind="composition" label={compLabel} styles={styles} />
      <ChartSvg shapes={distShapes} box={col.distance} panel={rect} unit={unit} kind="distance" label={distLabel} styles={styles} />
      {sentence && <div className={styles.slideText + " " + styles.slideTextStrong} style={{ ...at(col.sentence), ...fontPx(sentPt, unit), lineHeight: LINE, display: "-webkit-box", WebkitLineClamp: sentLines, WebkitBoxOrient: "vertical" }}>{sentence}</div>}
      {showNotes && notes.length > 0 && <NotesChip notes={notes} rect={col.notesChip} panel={rect} unit={unit} styles={styles} />}
    </div>
  );
}
