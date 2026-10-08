import React, { memo, useEffect, useRef, useState } from "react";
import { DIR16_NAMES, roseWedges, SPEED_BIN_LABELS, type RoseModel } from "@/lib/v2/ui/wind-rose";
import type { RoseSeason } from "@/lib/v2/tile-result";

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
export type WindRoseLayout = {
  cx: number;
  cy: number;
  rMax: number;
  labelRadius: number;
  titleReserved: WindRoseBox | null;
  legend: WindRoseBox;
  footerReserved: WindRoseBox | null;
  labels: WindRoseBox[];
};

const INK = "#15171c";
const MUTED = "#5B606B";
const FONT = '"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif';
/** 인쇄에서도 순서가 유지되는 따뜻한 회색 단일 명도 램프(약한 풍속 → 강한 풍속). */
const SPEED_BIN_RENDER_COLORS = ["#D8CDBE", "#B9AA9A", "#9B8979", "#76695D", "#453B33"] as const;

const hoursOf = (model: RoseModel): number =>
  model.dirs.reduce((sum, bins) => sum + bins.reduce((binSum, value) => binSum + (Number.isFinite(value) && value > 0 ? value : 0), 0), 0);
const pctOf = (value: number, total: number): string => {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
};

const SEASON_LABEL: Record<RoseSeason, string> = { annual: "연간", spring: "봄", summer: "여름", autumn: "가을", winter: "겨울" };

const box = (x0: number, y0: number, x1: number, y1: number): WindRoseBox => ({ x0, y0, x1, y1 });

/** 낮은 카드(1칸 지도 면)에서는 범례를 줄이고 위로 올려 아래로 잘리지 않게 한다. 슬라이드·단독 도판은 그대로. */
function fitLegend(height: number, chrome: WindRoseChrome, y0: number) {
  if (chrome !== "tile") return { scale: 1, y: y0 };
  const scale = Math.max(0.6, Math.min(1, (height - 28 - y0) / 145));
  return { scale, y: Math.max(12 * scale + 4, Math.min(y0, height - 28 - 145 * scale)) };
}

/** WindRoseFigure의 실제 장식 위치와 외부 오버레이 예약 자리를 함께 계산한다. */
export function windRoseLayout(width: number, height: number, chrome: WindRoseChrome = "tile"): WindRoseLayout {
  const frame = chrome !== "standalone";
  const cx = width * 0.39;
  const cy = frame ? height * 0.53 : height * 0.47;
  const rMax = frame ? Math.min(width * 0.33, height * 0.389) : Math.min(width * 0.33, height * 0.4);
  const labelRadius = frame ? rMax + 8 : rMax + 24;
  const legendX = frame && chrome === "slide" ? 16 : frame ? width * 0.66 : width * 0.7;
  const legendFit = fitLegend(height, chrome, frame && chrome === "slide" ? height - 185 : frame ? height * 0.22 : height * 0.23);
  const legendY = legendFit.y;
  const legendScale = legendFit.scale;
  const legendWidth = frame && chrome === "slide" ? 110 : width * 0.28;
  const legendHeight = 157;
  const labels = DIR16_NAMES.map((name, dir) => {
    const angle = (dir * Math.PI) / 8;
    const x = cx + Math.sin(angle) * labelRadius;
    const y = cy - Math.cos(angle) * labelRadius;
    const halfWidth = Math.max(8, name.length * 4.4);
    return box(x - halfWidth, y - 10, x + halfWidth, y + 10);
  });
  return {
    cx,
    cy,
    rMax,
    labelRadius,
    titleReserved: frame ? box(0, 0, Math.min(width * 0.375, 360), Math.min(height * 0.133, 72)) : null,
    legend: box(legendX - 10 * legendScale, legendY - 12 * legendScale, legendX + (legendWidth + 4) * legendScale, legendY + legendHeight * legendScale),
    footerReserved: frame ? box(0, Math.max(0, height - 24), width, height) : null,
    labels,
  };
}

function WindRoseSvg({ model, width, height, fixed = false, label = "D22 바람장미", season = "annual", chrome = "tile" }: WindRoseFigureProps) {
  const layout = windRoseLayout(width, height, chrome);
  const { cx, cy, rMax, labelRadius } = layout;
  const frame = chrome !== "standalone";
  const observedHours = hoursOf(model);
  const directionPcts = model.dirs.map((bins) => (bins.reduce((sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0), 0) / Math.max(1, observedHours)) * 100);
  const maxDirectionPct = Math.max(0, ...directionPcts);
  const wedges = roseWedges(model, cx, cy, rMax);
  const ticks = [0.25, 0.5, 0.75, 1];
  const tickBearing = (3 * Math.PI) / 16;
  const accessibleLabel = season === "annual" ? label : `${label} · ${SEASON_LABEL[season]}`;
  const legendX = frame && chrome === "slide" ? 16 : frame ? width * 0.66 : width * 0.7;
  const legendFit = fitLegend(height, chrome, frame && chrome === "slide" ? height - 185 : frame ? height * 0.22 : height * 0.23);
  const legendY = legendFit.y;
  const legendScale = legendFit.scale;
  const legendWidth = frame && chrome === "slide" ? 110 : width * 0.28;

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
      <title>{`${SEASON_LABEL[season]} 바람장미`}</title>
      {!frame && (
        <text x={16} y={26} fontSize="18" fontWeight="700" fill={INK}>
          {SEASON_LABEL[season]} 바람장미
        </text>
      )}
      <g aria-label="풍향 빈도">
        {ticks.map((ratio) => {
          const radius = rMax * ratio;
          return <circle key={ratio} cx={cx} cy={cy} r={radius} fill="none" stroke="#C8CDD4" strokeWidth="1" />;
        })}
        <line data-north-tick="true" x1={cx} y1={cy - rMax - 2} x2={cx} y2={cy - rMax - 11} stroke={INK} strokeWidth="1.5" />
        {wedges.map((wedge) => (
          <path key={`${wedge.dir}-${wedge.bin}`} d={wedge.path} fill={SPEED_BIN_RENDER_COLORS[wedge.bin]} fillOpacity="0.9" stroke="#FFFFFF" strokeWidth="1.1" strokeLinejoin="round" data-rose-dir={wedge.dir} data-rose-bin={wedge.bin} data-pct={wedge.pct} />
        ))}
        {ticks.map((ratio) => {
          const value = maxDirectionPct * ratio;
          const radius = rMax * ratio;
          const x = cx + Math.sin(tickBearing) * (radius + 8);
          const y = cy - Math.cos(tickBearing) * (radius + 8);
          return (
            <text key={`tick-${ratio}`} x={x} y={y} dominantBaseline="middle" textAnchor="start" fontSize="10" fontWeight="600" fill={MUTED} stroke="#F2F2EF" strokeWidth="4" paintOrder="stroke" strokeLinejoin="round">
              {value.toFixed(value >= 10 ? 0 : 1)}%
            </text>
          );
        })}
        {DIR16_NAMES.map((name, dir) => {
          const angle = (dir * Math.PI) / 8;
          const [x, y] = [cx + Math.sin(angle) * labelRadius, cy - Math.cos(angle) * labelRadius];
          return (
            <text key={name} x={x} y={y + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill={INK}>
              {name}
            </text>
          );
        })}
        <circle cx={cx} cy={cy} r="30" fill="#F2F2EF" stroke="#FFFFFF" strokeWidth="1" />
        <text x={cx} y={cy + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill={INK}>
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
