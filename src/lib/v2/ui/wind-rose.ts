/** D22 바람장미의 화면·보고서 공통 순수 모델. */
export type RoseModel = {
  station: string;
  dirs: number[][];
  calmHours: number;
  missingHours: number;
  totalHours: number;
};

export const DIR16_NAMES = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"] as const;
export const SPEED_BIN_LABELS = ["0.5~2", "2~4", "4~6", "6~8", "8m/s 이상"] as const;
/** 매스 그림과 같은 차분한 파랑·황토·회색 계열의 풍속 구간 색. */
export const SPEED_BIN_COLORS = ["#5E83B3", "#7C9BC2", "#9EA5AF", "#C58B2B", "#8C5A3C"] as const;

const finiteHours = (value: number | undefined): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

function point(cx: number, cy: number, radius: number, angle: number): [number, number] {
  return [cx + Math.sin(angle) * radius, cy - Math.cos(angle) * radius];
}

function sectorPath(cx: number, cy: number, inner: number, outer: number, start: number, end: number): string {
  const [sx, sy] = point(cx, cy, outer, start);
  const [ex, ey] = point(cx, cy, outer, end);
  if (outer <= 0) return `M${cx} ${cy}Z`;
  const outerArc = `A${outer} ${outer} 0 0 1 ${ex} ${ey}`;
  if (inner <= 0) return `M${cx} ${cy}L${sx} ${sy}${outerArc}Z`;
  const [ix, iy] = point(cx, cy, inner, start);
  const [jx, jy] = point(cx, cy, inner, end);
  return `M${sx} ${sy}${outerArc}L${jx} ${jy}A${inner} ${inner} 0 0 0 ${ix} ${iy}Z`;
}

/** 16방위 × 5구간 누적 쐐기 path. 모든 pct의 합은 정온·결측을 제외한 100이다. */
export function roseWedges(m: RoseModel, cx: number, cy: number, rMax: number): Array<{ dir: number; bin: number; path: string; pct: number }> {
  const hours = DIR16_NAMES.map((_, dir) => Array.from({ length: 5 }, (_, bin) => finiteHours(m.dirs?.[dir]?.[bin])));
  const directionHours = hours.map((bins) => bins.reduce((sum, value) => sum + value, 0));
  const observedHours = directionHours.reduce((sum, value) => sum + value, 0);
  const directionPct = directionHours.map((value) => (observedHours > 0 ? (value / observedHours) * 100 : 0));
  const maxDirectionPct = Math.max(0, ...directionPct);
  const radius = Number.isFinite(rMax) && rMax > 0 ? rMax : 0;
  const halfSector = Math.PI / 16;

  return hours.flatMap((bins, dir) => {
    let previousPct = 0;
    const centerAngle = (dir * Math.PI) / 8;
    return bins.map((value, bin) => {
      const pct = observedHours > 0 ? (value / observedHours) * 100 : 0;
      const outerPct = previousPct + pct;
      const innerRadius = maxDirectionPct > 0 ? (radius * previousPct) / maxDirectionPct : 0;
      const outerRadius = maxDirectionPct > 0 ? (radius * outerPct) / maxDirectionPct : 0;
      previousPct = outerPct;
      return {
        dir,
        bin,
        path: sectorPath(cx, cy, innerRadius, outerRadius, centerAngle - halfSector, centerAngle + halfSector),
        pct,
      };
    });
  });
}
