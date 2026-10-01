/** D16 건물 밀도 — 건물 대표점의 정규화 KDE와 20백분위 면. */
import { toUtmk } from "../../crs";
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { buildingRows, BUILDING_SOURCES } from "./buildings-shared";
import { est, hitPoint, makeTile, missing, obs, type TileDraft } from "./common";
import { gridQuantiles, localGrid, bandPolygons } from "./raster-grid";
import { notProvided } from "./not-provided";

const KDE_BANDWIDTH_M = 100;
const INPUT_BUFFER_M = 300;
const ZERO_THRESHOLD = 0.5;
const DENSITY_LAYERS = ["dens_0", "dens_q1", "dens_q2", "dens_q3", "dens_q4", "dens_q5"] as const;

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const pct = (part: number, whole: number) => Math.round((part / whole) * 1000) / 10;

/** Number.EPSILON보다 큰 값에서도 가장 작은 실수 간격을 만들어 밴드 경계를 단조롭게 한다. */
function nextUp(value: number): number {
  const step = Math.max(Number.EPSILON, Math.abs(value) * Number.EPSILON);
  return value + step;
}

/** 같은 KDE 값이 반복돼도 isobands가 요구하는 엄격한 오름차순 경계를 유지한다. */
function displayBreaks(quantiles: number[], hasPositive: boolean): number[] {
  if (!hasPositive) return [ZERO_THRESHOLD, 1, 2, 3, 4];
  const out: number[] = [ZERO_THRESHOLD];
  for (const value of quantiles) {
    const previous = out[out.length - 1];
    out.push(value > previous ? value : nextUp(previous));
  }
  return out;
}

function kdeValue(x: number, y: number, points: Array<[number, number]>): number {
  const normalizer = 1 / (2 * Math.PI * KDE_BANDWIDTH_M ** 2);
  const value = points.reduce((sum, [px, py]) => {
    const distanceSquared = (x - px) ** 2 + (y - py) ** 2;
    return sum + Math.exp(-distanceSquared / (2 * KDE_BANDWIDTH_M ** 2)) * normalizer;
  }, 0);
  return value * 1e6;
}

export function d16(ctx: EngineContext): TileResult {
  const radiusM = ctx.input.radiusM;
  const rows = buildingRows(ctx, Math.min(5000, radiusM + INPUT_BUFFER_M));
  if (rows === null) return notProvided(ctx, "D16", "건물 자료가 적재되지 않았습니다.");

  const cellM = Math.max(20, Math.ceil((2 * radiusM) / 80));
  const points = rows
    .map((row) => toUtmk(hitPoint(row.hit)))
    .filter((point): point is [number, number] => point.every(Number.isFinite));
  const grid = localGrid(ctx.input.center, radiusM, cellM, (x, y) => {
    const value = kdeValue(x, y, points);
    return value < ZERO_THRESHOLD ? 0 : value;
  });
  const positiveGrid = {
    ...grid,
    values: Float64Array.from(grid.values, (value) => value > 0 ? value : Number.NaN),
  };
  const quantiles = gridQuantiles(positiveGrid, radiusM, [0.2, 0.4, 0.6, 0.8]);
  const hasPositive = quantiles.every(Number.isFinite);
  const breaks = displayBreaks(quantiles, hasPositive);
  const bands = bandPolygons(ctx.input.center, radiusM, grid, breaks, [...DENSITY_LAYERS], null);
  const circleAreaM2 = Math.round(Math.PI * radiusM ** 2);
  const shares = bands.areaM2.map((area) => ({
    value: pct(area, circleAreaM2),
    numerator: Math.round(area),
    denominator: circleAreaM2,
  }));
  const finiteGridValues = Array.from(grid.values).filter(Number.isFinite);
  const maxDensity = finiteGridValues.length > 0 ? Math.max(...finiteGridValues) : 0;
  const coverage = ctx.coverage("buildings", BUILDING_SOURCES);
  const limitations: TileDraft["limitations"] = [
    { kind: "estimated", note: "커널 밀도 추정 — 동수 기준, 연면적·용적률과 혼합 안 함 · 반경 밖 300m 건물 포함" },
    ...coverage,
  ];
  const status: TileResult["status"] = limitations.some((limitation) => limitation.kind === "partial" || limitation.kind === "incomplete") ? "partial" : "complete";
  const metrics: TileDraft["metrics"] = [
    obs("kde_bandwidth_m", "KDE 대역폭", KDE_BANDWIDTH_M, "m", "d16-kde-config@1:가우시안 커널 대역폭"),
    obs("kde_cell_m", "KDE 격자 간격", cellM, "m", "d16-kde-config@1:cellM=max(20,ceil(2r÷80))"),
    obs("buildings_input", "KDE 입력 건물", rows.length, "동", "d16-kde-input@1:반경과 300m 버퍼 안 발자국 대표점"),
    ...quantiles.map((value, index) => Number.isFinite(value)
      ? est(`dens_break_${index + 1}`, `밀도 경계 ${index + 1}`, round3(value), "동/㎢", "d16-kde-quantile@1:원 안 유효 KDE 값 중 양수값의 백분위", null, null)
      : missing(`dens_break_${index + 1}`, `밀도 경계 ${index + 1}`, "동/㎢", "d16-kde-quantile@1:양수 KDE 값 없음")),
    est("dens_max", "최대 건물 밀도", round3(maxDensity), "동/㎢", "d16-kde-max@1:원 안 KDE 값의 최대값"),
    ...shares.map((share, index) => est(`share_dens_${index}`, `건물 밀도 구간 ${index}`, share.value, "%", "d16-share@1:KDE 구간 원 교차 면적÷π·r²", share.numerator, share.denominator)),
  ];
  const sentence = rows.length === 0
    ? `반경 ${radiusM.toLocaleString("en-US")}m와 바깥 300m를 합친 KDE 입력 건물 0동 → 관측된 건물 대표점이 없어 밀도 면은 모두 0으로 표시 → 최신 건물 도형과 현장 확인 필요`
    : `반경 ${radiusM.toLocaleString("en-US")}m와 바깥 300m를 합친 ${rows.length.toLocaleString("en-US")}동의 대표점으로 대역폭 100m KDE를 계산함 → 동수 기반 밀도 구간과 절대 경계값을 표시 → 연면적 기반 밀도는 별도 자료로 확인 필요`;

  return makeTile(ctx, {
    code: "D16",
    type: "diagram",
    status,
    metrics,
    judgment: { ruleId: "D16-kde@1", basisMetricIds: ["buildings_input", "dens_max"], sentence, level: null, criteria: null },
    sources: ctx.sources("buildings", BUILDING_SOURCES),
    layers: [...DENSITY_LAYERS],
    polygons: bands.polygons,
    limitations,
  });
}
