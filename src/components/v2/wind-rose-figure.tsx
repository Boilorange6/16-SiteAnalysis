import React from "react";
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
};

const INK = "#15171c";
const MUTED = "#5B606B";
const FONT = '"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif';
/** 인쇄에서도 순서가 유지되는 따뜻한 회색 단일 명도 램프(약한 풍속 → 강한 풍속). */
const SPEED_BIN_RENDER_COLORS = ["#EDE6DA", "#D1C6B7", "#B0A395", "#817568", "#4C433A"] as const;

const hoursOf = (model: RoseModel): number =>
  model.dirs.reduce((sum, bins) => sum + bins.reduce((binSum, value) => binSum + (Number.isFinite(value) && value > 0 ? value : 0), 0), 0);
const pctOf = (value: number, total: number): string => {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
};

const SEASON_LABEL: Record<RoseSeason, string> = { annual: "연간", spring: "봄", summer: "여름", autumn: "가을", winter: "겨울" };

function WindRoseFigure({ model, width, height, fixed = false, label = "D22 바람장미", season = "annual" }: WindRoseFigureProps) {
  const cx = width * 0.38;
  const cy = height * 0.47;
  const rMax = Math.min(width * 0.33, height * 0.4);
  const observedHours = hoursOf(model);
  const directionPcts = model.dirs.map((bins) => (bins.reduce((sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0), 0) / Math.max(1, observedHours)) * 100);
  const maxDirectionPct = Math.max(0, ...directionPcts);
  const wedges = roseWedges(model, cx, cy, rMax);
  const ticks = [0.25, 0.5, 0.75, 1];
  const labelRadius = rMax + 24;
  const tickBearing = (3 * Math.PI) / 16;
  const accessibleLabel = season === "annual" ? label : `${label} · ${SEASON_LABEL[season]}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      {...(fixed ? { width, height } : { width: "100%", height: "100%" })}
      role="img"
      aria-label={accessibleLabel}
      data-season={season}
      fontFamily={FONT}
      style={{ display: "block" }}
    >
      <rect width={width} height={height} fill="#F2F2EF" />
      <title>{`${SEASON_LABEL[season]} 바람장미`}</title>
      <text x={16} y={26} fontSize="18" fontWeight="700" fill={INK}>
        {SEASON_LABEL[season]} 바람장미
      </text>
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
      <g aria-label="풍속 구간" transform={`translate(${width * 0.7} ${height * 0.23})`}>
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
      <text x={16} y={height - 18} fontSize="12" fill={MUTED}>
        결측 {pctOf(model.missingHours, model.totalHours)}% · 지점 {model.station}
      </text>
    </svg>
  );
}

export { WindRoseFigure };
export default WindRoseFigure;
