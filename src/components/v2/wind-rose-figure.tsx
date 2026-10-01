import React from "react";
import { DIR16_NAMES, roseWedges, SPEED_BIN_COLORS, SPEED_BIN_LABELS, type RoseModel } from "@/lib/v2/ui/wind-rose";

export type WindRoseFigureProps = {
  model: RoseModel;
  width: number;
  height: number;
  fixed?: boolean;
  label?: string;
};

const INK = "#15171c";
const MUTED = "#5B606B";
const FONT = '"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif';

const hoursOf = (model: RoseModel): number =>
  model.dirs.reduce((sum, bins) => sum + bins.reduce((binSum, value) => binSum + (Number.isFinite(value) && value > 0 ? value : 0), 0), 0);
const pctOf = (value: number, total: number): string => {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
};

function WindRoseFigure({ model, width, height, fixed = false, label = "D22 바람장미" }: WindRoseFigureProps) {
  const cx = width * 0.38;
  const cy = height * 0.47;
  const rMax = Math.min(width * 0.27, height * 0.34);
  const observedHours = hoursOf(model);
  const directionPcts = model.dirs.map((bins) => (bins.reduce((sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0), 0) / Math.max(1, observedHours)) * 100);
  const maxDirectionPct = Math.max(0, ...directionPcts);
  const wedges = roseWedges(model, cx, cy, rMax);
  const ticks = [0.25, 0.5, 0.75, 1];
  const labelRadius = rMax + 24;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      {...(fixed ? { width, height } : { width: "100%", height: "100%" })}
      role="img"
      aria-label={label}
      fontFamily={FONT}
      style={{ display: "block" }}
    >
      <rect width={width} height={height} fill="#F2F2EF" />
      <g aria-label="풍향 빈도">
        {ticks.map((ratio) => {
          const radius = rMax * ratio;
          return <circle key={ratio} cx={cx} cy={cy} r={radius} fill="none" stroke="#C8CDD4" strokeWidth="1" />;
        })}
        {ticks.map((ratio) => {
          const value = maxDirectionPct * ratio;
          const radius = rMax * ratio;
          return (
            <text key={`tick-${ratio}`} x={cx + 4} y={cy - radius - 3} fontSize="10" fill={MUTED}>
              {value.toFixed(value >= 10 ? 0 : 1)}%
            </text>
          );
        })}
        {wedges.map((wedge) => (
          <path key={`${wedge.dir}-${wedge.bin}`} d={wedge.path} fill={SPEED_BIN_COLORS[wedge.bin]} fillOpacity="0.9" stroke="#FFFFFF" strokeWidth="0.7" data-rose-dir={wedge.dir} data-rose-bin={wedge.bin} data-pct={wedge.pct} />
        ))}
        {DIR16_NAMES.map((name, dir) => {
          const angle = (dir * Math.PI) / 8;
          const [x, y] = [cx + Math.sin(angle) * labelRadius, cy - Math.cos(angle) * labelRadius];
          return (
            <text key={name} x={x} y={y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill={INK}>
              {name}
            </text>
          );
        })}
        <circle cx={cx} cy={cy} r="24" fill="#F2F2EF" stroke="#FFFFFF" strokeWidth="1" />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill={INK}>
          정온 {pctOf(model.calmHours, model.totalHours)}%
        </text>
      </g>
      <g aria-label="풍속 구간" transform={`translate(${width * 0.7} ${height * 0.23})`}>
        <text x="0" y="0" fontSize="12" fontWeight="700" fill={INK}>
          풍속
        </text>
        {SPEED_BIN_LABELS.map((name, index) => (
          <g key={name} transform={`translate(0 ${20 + index * 22})`}>
            <rect width="12" height="12" rx="2" fill={SPEED_BIN_COLORS[index]} />
            <text x="20" y="10" fontSize="11" fill={INK}>
              {name}
            </text>
          </g>
        ))}
      </g>
      <text x={16} y={height - 18} fontSize="11" fill={MUTED}>
        결측 {pctOf(model.missingHours, model.totalHours)}% · 지점 {model.station}
      </text>
    </svg>
  );
}

export { WindRoseFigure };
export default WindRoseFigure;
