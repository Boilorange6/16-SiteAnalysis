/** D21 동지 일조시간 — S02의 전 반경 래스터를 참조한다. */
import { parseTileResult, type RasterRef, type TileResult } from "../../tile-result";
import type { RasterData } from "../../raster-store";
import { S02_LIMITATION, s02RasterData, sunHoursLegend } from "../../sim/s02-tile";
import type { SunFieldResult } from "../../sim/sun-field";
import type { EngineContext } from "../context";
import { notProvided } from "./not-provided";
import { SEASON_LABEL, SUN_INFLUENCE_M, horizonFor, sunBuildingReady, sunDateValue, sunFieldFor, sunGridFor, sunSources } from "./sun-shared";

const round1 = (value: number) => Math.round(value * 10) / 10;
const pct100 = (value: number) => round1(value * 100);
const PARCEL_SOURCES = ["parcel_polygon"] as const;

function metric(id: string, label: string, unit: string, value: number, formulaVersion: string, numerator: number | null = null, denominator: number | null = null): TileResult["metrics"][number] {
  const finite = Number.isFinite(value);
  return { id, label, unit, value: finite ? value : null, formulaVersion, numerator, denominator, status: finite ? "estimated" : "missing" };
}

function winterMetrics(field: SunFieldResult, cellM: number): TileResult["metrics"] {
  const receivers = field.stats.receivers;
  return [
    metric("day_length_h_winter", "동지 낮 길이", "시간", round1(field.dayLengthMin / 60), "sun-day-length@1"),
    metric("mean_sun_h_winter", "동지 평균 일조시간", "시간", round1(field.stats.meanHours), "sun-mean-hours@1", receivers * field.stats.meanHours, receivers),
    metric("share_lt1h_pct_winter", "동지 1시간 미만 일조 면적률", "%", pct100(field.stats.shareLt1h), "sun-share-lt1h@1", receivers * field.stats.shareLt1h, receivers),
    metric("share_cont2h_0915_pct_winter", "동지 진태양시 09~15 연속 2시간 확보", "%", pct100(field.stats.shareCont2h), "sun-share-cont2h@1", receivers * field.stats.shareCont2h, receivers),
    metric("share_total4h_0816_pct_winter", "동지 진태양시 08~16 총 4시간 확보", "%", pct100(field.stats.shareTotal4h), "sun-share-total4h@1", receivers * field.stats.shareTotal4h, receivers),
    metric("tst_0915_kst_winter", "진태양시 09~15 = KST 09:" + String(Math.round(field.tstOffsetMin)).padStart(2, "0") + "~15:" + String(Math.round(field.tstOffsetMin)).padStart(2, "0"), "분", round1(field.tstOffsetMin), "sun-tst-offset@1"),
    metric("receivers_winter", "동지 수광 셀", "셀", receivers, "sun-receivers@1"),
    metric("buildings_used", "그림자에 사용한 건물 수", "동", field.obstacles.buildings - field.obstacles.excludedNoHeight, "sun-buildings-used@1"),
    metric("buildings_no_height", "높이 미상 건물 수", "동", field.obstacles.excludedNoHeight, "sun-buildings-no-height@1"),
    metric("cell_m", "일조 격자 셀 크기", "m", cellM, "sun-grid@1"),
    metric("influence_m", "그림자 영향 반경", "m", SUN_INFLUENCE_M, "sun-influence@1"),
  ];
}

function rasterFor(ctx: EngineContext, field: SunFieldResult, grid: NonNullable<ReturnType<typeof sunGridFor>>): RasterRef {
  const stored = ctx.rasterReader?.("S02", "sun_hours_winter");
  if (stored) {
    const { bytes: _bytes, sha256: _sha256, ...ref } = stored.ref;
    return ctx.emitRaster("D21", { ref, values: stored.values } as RasterData);
  }
  const item = s02RasterData([{ key: "winter", date: sunDateValue(ctx, "winter"), field }], grid)[0];
  return ctx.emitRaster("D21", item);
}

export function d21(ctx: EngineContext): TileResult {
  if (!sunBuildingReady(ctx)) return notProvided(ctx, "D21", "건물 자료 또는 building_fact 높이 열이 없어 S02 동지 래스터를 계산하지 못했습니다.");
  const grid = sunGridFor(ctx);
  const field = sunFieldFor(ctx, "winter");
  if (!grid || !field) return notProvided(ctx, "D21", "S02 동지 일조장을 계산하지 못했습니다.");

  const ref = rasterFor(ctx, field, grid);
  const coverage: TileResult["limitations"] = [
    ...ctx.coverage("buildings", ["building", "gis_bldg"]),
    ...(ctx.db("parcels") && ctx.input.pnu ? ctx.coverage("parcels", PARCEL_SOURCES) : []),
  ];
  const limitations: TileResult["limitations"] = [
    { kind: "estimated", note: S02_LIMITATION },
    { kind: "estimated", note: "반경 밖 400 m까지 건물 그림자를 포함했습니다." },
    { kind: "estimated", note: "경사면 법선은 반영하지 않고 수평 수광면으로 계산했습니다." },
    { kind: horizonFor(ctx) ? "estimated" : "unknown", note: horizonFor(ctx) ? "Copernicus DEM GLO-30 지형 지평선을 반영했습니다." : "게시된 DEM이 없어 지형 지평선을 반영하지 않았습니다." },
    ...(field.obstacles.excludedNoHeight > 0 ? [{ kind: "incomplete" as const, note: "높이 미상 " + field.obstacles.excludedNoHeight + "동은 그림자에서 제외하고 지붕 셀도 제외했습니다." }] : []),
    ...coverage,
  ];
  const status: TileResult["status"] = field.stats.receivers === 0 ? "no_data" : limitations.some((limitation) => limitation.kind === "partial" || limitation.kind === "incomplete") ? "partial" : "complete";
  const sentence = "동지 반경 안 지면의 평균 일조 " + round1(field.stats.meanHours) + "시간, 진태양시 09~15 연속 2시간 확보 " + pct100(field.stats.shareCont2h) + "%, 08~16 총 4시간 " + pct100(field.stats.shareTotal4h) + "% → 건물·지형 모델의 기하학적 추정이며 창면·기상·법적 판정이 아님 → 세대 창 위치 기준 정밀 일조 검토로 확인할 것";
  const sources = [
    ...sunSources(ctx),
    ...(ctx.db("parcels") && ctx.input.pnu ? ctx.sources("parcels", PARCEL_SOURCES) : []),
  ];
  const simulation = {
    model: "sun-raster@1",
    date: sunDateValue(ctx, "winter"),
    dateLabel: SEASON_LABEL.winter,
    stepMin: 10,
    cellM: grid.cellM,
    influenceM: SUN_INFLUENCE_M,
    terrain: horizonFor(ctx) ? "glo30-horizon" : "none",
    tstWindows: { continuous: "09-15", total: "08-16" },
    hourlyMinAltDeg: 5,
    receivers: field.stats.receivers,
    buildings: field.obstacles,
  };
  return parseTileResult({
    tileId: ctx.analysisId + "-D21",
    analysisId: ctx.analysisId,
    tileType: "diagram",
    tileCode: "D21",
    status,
    engineVersion: "v2-sun-raster@1",
    conditions: {
      ...ctx.conditions,
      simulation,
    },
    metrics: winterMetrics(field, grid.cellM),
    judgment: { ruleId: "D21-sunlight-hours@2", basisMetricIds: ["mean_sun_h_winter", "share_cont2h_0915_pct_winter"], sentence, level: null, criteria: null },
    presentation: {
      legend: sunHoursLegend("동지 일조시간"),
      camera: null,
      layers: [],
      outputFace: "front",
      rasters: [ref],
    },
    provenance: { manifestHash: ctx.manifestHash, sources: sources.map((source) => ({ ...source })) },
    limitations,
  });
}
