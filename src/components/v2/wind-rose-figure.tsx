import React, { memo, useEffect, useRef, useState } from "react";
import { DIR16_NAMES, roseWedges, SPEED_BIN_LABELS, type RoseModel } from "@/lib/v2/ui/wind-rose";
import { ROSE_SEASON_LABELS, type RoseSeason } from "@/lib/v2/ui/rose-season";

export type WindRoseFigureProps = {
  model: RoseModel;
  width: number;
  height: number;
  fixed?: boolean;
  label?: string;
  /** 보고서·화면 호출부가 선택한 계절. 모델 자체는 호출부가 roses에서 고른다. */
  season?: RoseSeason;
  /** standalone은 자체 제목·출처를 포함하고, tile/slide은 외부 오버레이 자리를 예약한다. */
  chrome?: WindRoseChrome;
};

export type WindRoseChrome = "standalone" | "tile" | "slide";
export type WindRoseBox = { x0: number; y0: number; x1: number; y1: number };
export type WindRoseTick = { value: number; ratio: number; label: string; box: WindRoseBox };
export type WindRoseLayout = {
  cx: number;
  cy: number;
  rMax: number;
  labelRadius: number;
  titleReserved: WindRoseBox | null;
  legend: WindRoseBox;
  legendX: number;
  legendY: number;
  legendScale: number;
  legendWidth: number;
  footerReserved: WindRoseBox | null;
  /** 1 = 16방위 글자, 2 = 8방위만 */
  labelStep: number;
  labels: WindRoseBox[];
  /** 최대 풍향 빈도에 맞춘 나이스 % 눈금. 낮은 카드에서는 2개만 표시한다. */
  ticks: WindRoseTick[];
  tickBoxes: WindRoseBox[];
  tickBearing: number;
  scaleMaxPct: number;
};

const INK = "#15171c";
const MUTED = "#5B606B";
const FONT = '"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif';
const LABEL_RADIUS_OFFSET = 8;
const LEGEND_EDGE_GAP = 8;
const LEGEND_CONTENT_WIDTH = 96;
const LEGEND_HEIGHT = 157;
/** 인쇄에서도 순서가 유지되는 따뜻한 회색 단일 명도 램프(약한 풍속 → 강한 풍속). */
const SPEED_BIN_RENDER_COLORS = ["#D8CDBE", "#B9AA9A", "#9B8979", "#76695D", "#453B33"] as const;

const hoursOf = (model: RoseModel): number =>
  model.dirs.reduce((sum, bins) => sum + bins.reduce((binSum, value) => binSum + (Number.isFinite(value) && value > 0 ? value : 0), 0), 0);
const pctOf = (value: number, total: number): string => {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
};

const box = (x0: number, y0: number, x1: number, y1: number): WindRoseBox => ({ x0, y0, x1, y1 });

const directionLabels = (cx: number, cy: number, rMax: number, frame: boolean): WindRoseBox[] => {
  const labelRadius = frame ? rMax + LABEL_RADIUS_OFFSET : rMax + 24;
  return DIR16_NAMES.map((name, dir) => {
    const angle = (dir * Math.PI) / 8;
    const x = cx + Math.sin(angle) * labelRadius;
    const y = cy - Math.cos(angle) * labelRadius;
    const halfWidth = Math.max(8, name.length * 4.4);
    return box(x - halfWidth, y - 10, x + halfWidth, y + 10);
  });
};

const overlaps = (a: WindRoseBox, b: WindRoseBox): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

const niceStep = (maxPct: number, targetCount: number): number => {
  const raw = maxPct / Math.max(1, targetCount);
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
};

const formatTickPct = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
};

function tickPlan(maxDirectionPct: number, compact: boolean): { scaleMaxPct: number; ticks: Array<{ value: number; ratio: number; label: string }> } {
  if (!(maxDirectionPct > 0) || !Number.isFinite(maxDirectionPct)) return { scaleMaxPct: 1, ticks: [] };
  const step = niceStep(maxDirectionPct, compact ? 2 : 4);
  const scaleMaxPct = Math.max(step, Math.ceil((maxDirectionPct / step) - 1e-9) * step);
  const ticks = Array.from({ length: Math.ceil(scaleMaxPct / step) }, (_, index) => (index + 1) * step).map((value) => ({
    value,
    ratio: value / scaleMaxPct,
    label: formatTickPct(value),
  }));
  return { scaleMaxPct, ticks };
}

const tickBoxAt = (cx: number, cy: number, rMax: number, tick: { ratio: number; label: string }, bearing: number): WindRoseBox => {
  const radius = rMax * tick.ratio;
  const x = cx + Math.sin(bearing) * radius;
  const y = cy - Math.cos(bearing) * radius;
  const width = Math.max(16, tick.label.length * 5.2);
  return box(x - width / 2 - 2, y - 8, x + width / 2 + 2, y + 8);
};

function chooseTickLayout(
  cx: number,
  cy: number,
  rMax: number,
  labels: WindRoseBox[],
  legend: WindRoseBox,
  titleReserved: WindRoseBox | null,
  footerReserved: WindRoseBox | null,
  plan: { scaleMaxPct: number; ticks: Array<{ value: number; ratio: number; label: string }> },
  compact: boolean,
): { ticks: WindRoseTick[]; tickBoxes: WindRoseBox[]; tickBearing: number; labelStep: number } {
  const adjacentOverlap = labels.some((label, index) => overlaps(label, labels[(index + 1) % labels.length]!));
  if (plan.ticks.length === 0) return { ticks: [], tickBoxes: [], tickBearing: compact ? Math.PI / 8 : Math.PI / 16, labelStep: compact && adjacentOverlap ? 2 : 1 };
  const bearings = Array.from({ length: 8 }, (_, index) => (2 * index + 1) * (compact ? Math.PI / 8 : Math.PI / 16));
  let best: { score: number; bearing: number; boxes: WindRoseBox[]; labelStep: number } | null = null;
  for (const bearing of bearings) {
    const boxes = plan.ticks.map((tick) => tickBoxAt(cx, cy, rMax, tick, bearing));
    const labelStep = compact && (adjacentOverlap || boxes.some((tickBox) => labels.some((label) => overlaps(tickBox, label)))) ? 2 : 1;
    const visibleLabels = labels.filter((_, index) => index % labelStep === 0);
    let score = 0;
    for (let index = 0; index < boxes.length; index += 1) {
      for (let other = index + 1; other < boxes.length; other += 1) if (overlaps(boxes[index]!, boxes[other]!)) score += 100_000;
      if (overlaps(boxes[index]!, legend)) score += 10_000;
      if (titleReserved && overlaps(boxes[index]!, titleReserved)) score += 1_000;
      if (footerReserved && overlaps(boxes[index]!, footerReserved)) score += 1_000;
      for (const label of visibleLabels) if (overlaps(boxes[index]!, label)) score += 100;
    }
    if (best === null || score < best.score) best = { score, bearing, boxes, labelStep };
  }
  const chosen = best!;
  const ticks = plan.ticks.map((tick, index) => ({ ...tick, box: chosen.boxes[index]! }));
  return { ticks, tickBoxes: chosen.boxes, tickBearing: chosen.bearing, labelStep: chosen.labelStep };
}

/** 낮은 카드(1칸 지도 면)에서는 범례를 줄이고 위로 올려 아래로 잘리지 않게 한다. 슬라이드·단독 도판은 그대로. */
function fitLegend(height: number, chrome: WindRoseChrome, y0: number) {
  if (chrome !== "tile") return { scale: 1, y: y0 };
  const scale = Math.max(0.6, Math.min(1, (height - 28 - y0) / 145));
  return { scale, y: Math.max(12 * scale + 4, Math.min(y0, height - 28 - 145 * scale)) };
}

/** WindRoseFigure의 실제 장식 위치와 외부 오버레이 예약 자리를 함께 계산한다. */
export function windRoseLayout(width: number, height: number, chrome: WindRoseChrome = "tile", maxDirectionPct = 0): WindRoseLayout {
  const frame = chrome !== "standalone";
  let cx = width * 0.39;
  const cy = frame ? height * 0.53 : height * 0.47;
  let rMax = frame ? Math.min(width * 0.33, height * 0.389) : Math.min(width * 0.33, height * 0.4);
  const legendX0 = frame && chrome === "slide" ? 16 : frame ? width * 0.66 : width * 0.7;
  const legendFit = fitLegend(height, chrome, frame && chrome === "slide" ? height - 185 : frame ? height * 0.22 : height * 0.23);
  const legendY = legendFit.y;
  const legendScale = legendFit.scale;
  const legendWidth = frame && chrome === "slide" ? 110 : width * 0.28;
  const legendVisualWidth = (chrome === "tile" ? Math.max(legendWidth + 14, LEGEND_CONTENT_WIDTH) : legendWidth + 14) * legendScale;
  const legendBox = (x: number): WindRoseBox => box(x - 10 * legendScale, legendY - 12 * legendScale, x - 10 * legendScale + legendVisualWidth, legendY + LEGEND_HEIGHT * legendScale);
  let legendX = legendX0;
  let labels = directionLabels(cx, cy, rMax, frame);
  let legend = legendBox(legendX);

  const compactTile = chrome === "tile" && height < LEGEND_HEIGHT * 4;
  if (compactTile && (labels.some((label) => overlaps(label, legend)) || overlaps(legend, box(cx - rMax, cy - rMax, cx + rMax, cy + rMax)))) {
    const rightLegendX = width - LEGEND_EDGE_GAP - legendVisualWidth + 10 * legendScale;
    legendX = rightLegendX;
    legend = legendBox(legendX);
    labels = directionLabels(cx, cy, rMax, frame);

    if (labels.some((label) => overlaps(label, legend)) || overlaps(legend, box(cx - rMax, cy - rMax, cx + rMax, cy + rMax))) {
      const roseLeft = LEGEND_EDGE_GAP;
      const roseRight = legend.x0 - LEGEND_EDGE_GAP;
      const roseCenter = (roseLeft + roseRight) / 2;
      const radialLimits = DIR16_NAMES.map((name, dir) => {
        const sin = Math.abs(Math.sin((dir * Math.PI) / 8));
        if (sin < 0.001) return Number.POSITIVE_INFINITY;
        const halfWidth = Math.max(8, name.length * 4.4);
        const side = dir < 8 ? roseRight - roseCenter : roseCenter - roseLeft;
        return (side - halfWidth) / sin - LABEL_RADIUS_OFFSET;
      });
      const fittedRMax = Math.min(...radialLimits);
      if (Number.isFinite(fittedRMax) && fittedRMax > 0) {
        cx = roseCenter;
        rMax = Math.min(rMax, fittedRMax);
        labels = directionLabels(cx, cy, rMax, frame);
      }
    }
  }

  const titleReserved = frame ? box(0, 0, Math.min(width * 0.375, 360), Math.min(height * 0.133, 72)) : null;
  const footerReserved = frame ? box(0, Math.max(0, height - 24), width, height) : null;
  const axis = tickPlan(maxDirectionPct, compactTile);
  const tickLayout = chooseTickLayout(cx, cy, rMax, labels, legend, titleReserved, footerReserved, axis, compactTile);
  // 좁은 카드에서 16방위 글자끼리 겹치거나 눈금과 충돌하면 8방위만 적는다(쐐기는 16개 그대로).
  const labelRadius = frame ? rMax + LABEL_RADIUS_OFFSET : rMax + 24;
  return {
    cx,
    cy,
    rMax,
    labelRadius,
    titleReserved,
    legend,
    legendX,
    legendY,
    legendScale,
    legendWidth,
    footerReserved,
    labelStep: tickLayout.labelStep,
    labels: labels.filter((_, dir) => dir % tickLayout.labelStep === 0),
    ticks: tickLayout.ticks,
    tickBoxes: tickLayout.tickBoxes,
    tickBearing: tickLayout.tickBearing,
    scaleMaxPct: axis.scaleMaxPct,
  };
}

function WindRoseSvg({ model, width, height, fixed = false, label = "D22 바람장미", season = "annual", chrome = "tile" }: WindRoseFigureProps) {
  const observedHours = hoursOf(model);
  const directionPcts = model.dirs.map((bins) => (bins.reduce((sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0), 0) / Math.max(1, observedHours)) * 100);
  const maxDirectionPct = Math.max(0, ...directionPcts);
  const layout = windRoseLayout(width, height, chrome, maxDirectionPct);
  const { cx, cy, rMax, labelRadius, legendX, legendY, legendScale, legendWidth } = layout;
  const frame = chrome !== "standalone";
  const wedges = roseWedges(model, cx, cy, rMax, layout.scaleMaxPct);
  const accessibleLabel = season === "annual" ? label : `${label} · ${ROSE_SEASON_LABELS[season]}`;
  const calmRadius = Math.min(22, Math.max(16, rMax * 0.3));
  const calmFontSize = rMax < 70 ? 10 : 12;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      {...(fixed ? { width, height } : { width: "100%", height: "100%" })}
      role="img"
      aria-label={accessibleLabel}
      data-season={season}
      data-wind-rose-chrome={chrome}
      fontFamily={FONT}
      style={{ display: "block" }}
    >
      <rect width={width} height={height} fill="#F2F2EF" />
      <title>{`${ROSE_SEASON_LABELS[season]} 바람장미`}</title>
      {!frame && (
        <text x={16} y={26} fontSize="18" fontWeight="700" fill={INK}>
          {ROSE_SEASON_LABELS[season]} 바람장미
        </text>
      )}
      <g aria-label="풍향 빈도">
        {layout.ticks.map((tick) => {
          const radius = rMax * tick.ratio;
          return <circle key={`ring-${tick.value}`} cx={cx} cy={cy} r={radius} fill="none" stroke="#C8CDD4" strokeWidth="1" />;
        })}
        {layout.ticks.length === 0 && <circle cx={cx} cy={cy} r={rMax} fill="none" stroke="#C8CDD4" strokeWidth="1" />}
        <line data-north-tick="true" x1={cx} y1={cy - rMax - 2} x2={cx} y2={cy - rMax - 11} stroke={INK} strokeWidth="1.5" />
        {wedges.map((wedge) => (
          <path key={`${wedge.dir}-${wedge.bin}`} d={wedge.path} fill={SPEED_BIN_RENDER_COLORS[wedge.bin]} fillOpacity="0.9" stroke="#FFFFFF" strokeWidth="1.1" strokeLinejoin="round" data-rose-dir={wedge.dir} data-rose-bin={wedge.bin} data-pct={wedge.pct} />
        ))}
        {layout.ticks.map((tick) => {
          const radius = rMax * tick.ratio;
          const x = cx + Math.sin(layout.tickBearing) * radius;
          const y = cy - Math.cos(layout.tickBearing) * radius;
          return (
            <text key={`tick-${tick.value}`} data-wind-rose-tick="true" data-tick-value={tick.value} x={x} y={y} dominantBaseline="middle" textAnchor="middle" fontSize="10" fontWeight="600" fill={MUTED} stroke="#F2F2EF" strokeWidth="4" paintOrder="stroke" strokeLinejoin="round">
              {tick.label}
            </text>
          );
        })}
        {DIR16_NAMES.map((name, dir) => {
          if (dir % layout.labelStep !== 0) return null;
          const angle = (dir * Math.PI) / 8;
          const [x, y] = [cx + Math.sin(angle) * labelRadius, cy - Math.cos(angle) * labelRadius];
          return (
            <text key={name} x={x} y={y + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill={INK}>
              {name}
            </text>
          );
        })}
        <circle data-calm-circle="true" cx={cx} cy={cy} r={calmRadius} fill="#F2F2EF" stroke="#FFFFFF" strokeWidth="1" />
        <text x={cx} y={cy + calmFontSize * 0.36} textAnchor="middle" fontSize={calmFontSize} fontWeight="700" fill={INK}>
          정온 {pctOf(model.calmHours, model.totalHours)}%
        </text>
      </g>
      <g aria-label="풍속 구간" data-wind-rose-legend="true" transform={`translate(${legendX} ${legendY}) scale(${legendScale})`}>
        {frame && <rect x="-10" y="-12" width={legendWidth + 14} height="157" rx="8" fill="#FFFFFF" fillOpacity="0.88" stroke="#D9DCE2" strokeWidth="0.8" />}
        <text x="0" y="0" fontSize="14" fontWeight="700" fill={INK}>
          풍속
        </text>
        {SPEED_BIN_LABELS.map((name, index) => (
          <g key={name} transform={`translate(0 ${22 + index * 25})`}>
            <rect width="15" height="15" rx="2" fill={SPEED_BIN_RENDER_COLORS[index]} stroke="#FFFFFF" strokeWidth="0.8" />
            <text x="23" y="12" fontSize="13" fill={INK}>
              {name}
            </text>
          </g>
        ))}
      </g>
      {!frame && (
        <text x={16} y={height - 18} fontSize="12" fill={MUTED}>
          결측 {pctOf(model.missingHours, model.totalHours)}% · 지점 {model.station}
        </text>
      )}
    </svg>
  );
}

function ResponsiveWindRoseFigure(props: WindRoseFigureProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: props.width, height: props.height });
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const read = () => {
      const width = Math.max(1, Math.round(host.clientWidth || props.width));
      const height = Math.max(1, Math.round(host.clientHeight || props.height));
      setSize((current) => current.width === width && current.height === height ? current : { width, height });
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(host);
    return () => observer.disconnect();
  }, [props.width, props.height]);
  return (
    <div ref={hostRef} style={{ width: "100%", height: "100%" }}>
      <WindRoseSvg {...props} width={size.width} height={size.height} fixed={false} />
    </div>
  );
}

function WindRoseFigure(props: WindRoseFigureProps) {
  return props.fixed ? <WindRoseSvg {...props} /> : <ResponsiveWindRoseFigure {...props} />;
}

const MemoWindRoseFigure = memo(WindRoseFigure);
export { MemoWindRoseFigure as WindRoseFigure };
export default MemoWindRoseFigure;
