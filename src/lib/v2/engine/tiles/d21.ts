/** D21 일조시간 — S02가 계산한 수광면 셀을 시간 구간별 면으로 표현한다. */
import { toUtmk } from "../../crs";
import { parseTileResult, type TileResult } from "../../tile-result";
import { S02_LIMITATION } from "../../sim/s02-tile";
import type { SunlightCell } from "../../sim/sunlight";
import { sunlightFor } from "./s02";
import { bandPolygons, type LocalGrid } from "./raster-grid";
import { est, makeTile, missing, type TileDraft } from "./common";
import type { EngineContext } from "../context";
import { notProvided } from "./not-provided";

const SUN_LAYERS = ["sun_0", "sun_0_2", "sun_2_4", "sun_4_6", "sun_6_8", "sun_ge8"] as const;
const SUN_LABELS = ["0시간", "0 초과~2시간", "2~4시간", "4~6시간", "6~8시간", "8시간 이상"] as const;
const SUN_UNCALC = "sun_uncalc";
const HOUR_EPSILON = 1e-9;

const pct = (part: number, whole: number) => whole <= 0 ? null : Math.round((part / whole) * 1000) / 10;

function hourBucket(hours: number): number {
  if (hours <= HOUR_EPSILON) return 0;
  if (hours < 2) return 1;
  if (hours < 4) return 2;
  if (hours < 6) return 3;
  if (hours < 8) return 4;
  return 5;
}

/** S02 cell centers를 그대로 row-major 격자로 재구성한다. 값이 없는 셀은 NaN으로 유지한다. */
function gridFromCells(center: readonly [number, number], cellM: number, cells: readonly SunlightCell[]): LocalGrid | null {
  if (!Array.isArray(cells) || cells.length === 0 || !Number.isFinite(cellM) || cellM <= 0) return null;
  const xs = cells.map((cell) => cell.x);
  const ys = cells.map((cell) => cell.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const cols = Math.round((Math.max(...xs) - x0) / cellM) + 1;
  const rows = Math.round((Math.max(...ys) - y0) / cellM) + 1;
  if (cols < 2 || rows < 2 || !Number.isInteger(cols) || !Number.isInteger(rows)) return null;

  const values = new Float64Array(cols * rows);
  values.fill(Number.NaN);
  for (const cell of cells) {
    const col = Math.round((cell.x - x0) / cellM);
    const row = Math.round((cell.y - y0) / cellM);
    if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
    // removed 셀과 uncalculated 셀은 모두 NaN으로 남겨 sun_0에 섞지 않는다.
    if (cell.state !== "calculated" || cell.hours === null || !Number.isFinite(cell.hours)) continue;
    values[row * cols + col] = cell.hours;
  }
  const [cx, cy] = toUtmk(center);
  return { cx, cy, cellM, cols, rows, x0, y0, values };
}

function missingMetrics(): TileDraft["metrics"] {
  const formula = "d21-hours@1:S02 계산 셀 기준";
  return [
    missing("fill_calculated_pct", "일조시간 계산 채움률", "%", "d21-fill-calculated@1:계산 셀÷(계산 셀+미계산 셀)"),
    missing("median_sun_hours", "기하학적 일조시간 중앙값", "시간", formula),
    ...SUN_LABELS.map((label, index) => missing(`share_sun_${index + 1}`, `일조시간 구성: ${label}`, "%", formula)),
    missing("back_uncalculated_pct", "미계산 면적률", "%", "d21-uncalculated@1:미계산 셀÷(계산 셀+미계산 셀)"),
  ];
}

function conditionsFor(ctx: EngineContext, shared: NonNullable<ReturnType<typeof sunlightFor>>): TileResult["conditions"] {
  return {
    ...ctx.conditions,
    simulation: {
      site: shared.siteKind,
      window: "09:00–15:00",
      stepMin: shared.result.params.stepMin,
      gridM: shared.result.params.gridM,
      cells: shared.result.counts,
    },
  };
}

export function d21(ctx: EngineContext): TileResult {
  const shared = sunlightFor(ctx);
  if (!shared) return notProvided(ctx, "D21", "건물 자료가 없어 S02 일조 셀을 계산하지 못했습니다.");

  const result = shared.result;
  const calculated = result.counts.calculated;
  const uncalculated = result.counts.uncalculated;
  const calcDenominator = calculated + uncalculated;
  const baseLimitations: TileDraft["limitations"] = [
    { kind: "estimated", note: S02_LIMITATION },
    { kind: "estimated", note: "시간창 09~15시(09:00–15:00)라 최대 6시간 — 8시간 이상 구간은 시간창을 넓혀야 채워짐" },
    ...(uncalculated > 0 ? [{ kind: "partial" as const, note: `높이 미상 건물이 덮은 ${uncalculated}개 셀은 0시간이 아니라 미계산으로 분리했습니다.` }] : []),
    ...(result.buildings.excludedNoHeight > 0 ? [{ kind: "incomplete" as const, note: `영향 영역 안 높이 미상 건물 ${result.buildings.excludedNoHeight}개는 그림자 계산에서 제외했습니다.` }] : []),
    ...ctx.coverage("buildings", ["building", "gis_bldg"]),
    ...(shared.siteKind === "parcel" ? ctx.coverage("parcels", ["parcel_polygon"]) : []),
  ];

  if (result.counts.cells === 0 || calculated === 0) {
    const tile = makeTile(ctx, {
      code: "D21",
      type: "diagram",
      status: "no_data",
      metrics: missingMetrics(),
      judgment: { ruleId: "D21-sunlight-hours@1", basisMetricIds: ["fill_calculated_pct"], sentence: "S02 수광면에 계산된 셀이 없어 일조시간을 산출하지 못함 → 건물 높이 또는 수광면 자료가 부족함 → 필지 도형과 건물 높이 자료를 확인할 것", level: null, criteria: null },
      sources: shared.sources,
      layers: [...SUN_LAYERS, SUN_UNCALC],
      limitations: [...baseLimitations, { kind: "unknown", note: "계산 가능한 수광면 셀이 없어 구간별 일조시간 면을 만들지 못했습니다." }],
    });
    return parseTileResult({ ...tile, conditions: conditionsFor(ctx, shared) });
  }

  const cellGrid = gridFromCells(ctx.input.center, result.params.gridM, result.cells);
  let polygons: NonNullable<TileDraft["polygons"]> = [];
  if (cellGrid) {
    try {
      polygons = bandPolygons(ctx.input.center, ctx.input.radiusM, cellGrid, [HOUR_EPSILON, 2, 4, 6, 8], [...SUN_LAYERS], SUN_UNCALC).polygons;
    } catch {
      baseLimitations.push({ kind: "partial", note: "S02 셀 격자를 일조시간 면으로 변환하지 못했습니다." });
    }
  } else {
    baseLimitations.push({ kind: "partial", note: "S02 셀 좌표가 규칙 격자로 재구성되지 않아 일조시간 면을 만들지 못했습니다." });
  }

  const counts = Array.from({ length: SUN_LAYERS.length }, () => 0);
  for (const cell of result.cells) {
    if (cell.state !== "calculated" || cell.hours === null || !Number.isFinite(cell.hours)) continue;
    counts[hourBucket(cell.hours)] += 1;
  }
  const cellArea = result.params.gridM ** 2;
  const shareFormula = "d21-share-hours@1:구간별 계산 셀 면적÷계산 셀 면적(미계산·철거 제외)";
  const metrics: TileDraft["metrics"] = [
    est("fill_calculated_pct", "일조시간 계산 채움률", pct(calculated, calcDenominator) as number, "%", "d21-fill-calculated@1:계산 셀÷(계산 셀+미계산 셀)", calculated, calcDenominator),
    result.medianHours === null
      ? missing("median_sun_hours", "기하학적 일조시간 중앙값", "시간", "d21-median-hours@1:S02 계산 셀의 일조시간 중앙값")
      : est("median_sun_hours", "기하학적 일조시간 중앙값", result.medianHours, "시간", "d21-median-hours@1:S02 계산 셀의 일조시간 중앙값"),
    ...SUN_LAYERS.map((_, index) => est(
      `share_sun_${index + 1}`,
      `일조시간 구성: ${SUN_LABELS[index]}`,
      pct(counts[index], calculated) as number,
      "%",
      shareFormula,
      counts[index] * cellArea,
      calculated * cellArea,
    )),
    est("back_uncalculated_pct", "미계산 면적률", pct(uncalculated, calcDenominator) as number, "%", "d21-uncalculated@1:미계산 셀÷(계산 셀+미계산 셀)", uncalculated, calcDenominator),
  ];

  const coveragePartial = baseLimitations.some((limitation) => limitation.kind === "partial" || limitation.kind === "incomplete");
  const status: TileResult["status"] = coveragePartial ? "partial" : "complete";
  const medianText = result.medianHours === null ? "중앙값 미상" : `중앙값 ${result.medianHours}시간`;
  const sentence = `09:00–15:00 시간창의 계산 셀 ${calculated.toLocaleString("en-US")}개에서 일조시간 ${medianText} → 미계산·철거 셀을 0시간과 분리한 기하학적 추정 → 필지 범위·건물 높이와 창 위치는 정밀 검토로 확인할 것`;
  const tile = makeTile(ctx, {
    code: "D21",
    type: "diagram",
    status,
    metrics,
    judgment: { ruleId: "D21-sunlight-hours@1", basisMetricIds: ["median_sun_hours", "fill_calculated_pct"], sentence, level: null, criteria: null },
    sources: shared.sources,
    layers: [...SUN_LAYERS, SUN_UNCALC],
    polygons,
    limitations: baseLimitations,
  });
  return parseTileResult({ ...tile, conditions: conditionsFor(ctx, shared) });
}
