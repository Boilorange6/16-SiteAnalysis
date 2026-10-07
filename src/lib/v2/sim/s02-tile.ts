/**
 * S02 일조·그림자 타일 결과. 화면 없이 계산 결과를 TileResult 계약으로 옮긴다.
 * 등급(level)은 매기지 않고, 법적 일조 판정 표현은 어디에도 쓰지 않는다.
 */
import { parseTileResult, type RasterRef, type TileResult } from "../tile-result";
import type { RasterData } from "../raster-store";
import { toLngLat } from "../crs";
import { polygonArea } from "../engine/tiles/geo";
import { polygonCandidate } from "../engine/tiles/common";
import { computeSunlight, type SunlightInput, type SunlightResult } from "./sunlight";
import type { SunFieldResult, SunGrid } from "./sun-field";
import { SEASON_LABEL, type SunDateKey } from "../engine/tiles/sun-shared";
import { siteRings, type SiteRings, type XY } from "./shadow";
import { FLOOR_HEIGHT_M } from "../ingest/sources/buildings";

export const S02_LIMITATION = "건물·지형 모델에 의한 기하학적 일조 추정입니다. 구름·실제 기상·창면 조건 및 법적 일조 판정을 포함하지 않습니다.";
export const S02_ENGINE_VERSION = "v2-sim-sun@2";

export interface S02Input extends SunlightInput {
  analysisId: string;
  tileId?: string;
  address: string;
  /** 표시 중심 [경도, 위도] */
  center: readonly [number, number];
  /** 표시 반경(m). 계산 영향 영역(influenceM)과 별개 */
  radiusM: number;
  manifestHash: string;
  sources: readonly { sourceId: string; releaseId: string; sourceAsOf: string | null; fetchedAt: string }[];
  siteKind?: "parcel" | "polygon" | "box";
  parcelSnapshotHash?: string | null;
}

export type S02ShadowParts = Record<"09" | "12" | "15", number[][][][]>;

export interface S02Presentation {
  site: SiteRings;
  shadows: S02ShadowParts;
}

type Metric = TileResult["metrics"][number];
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;
const pct = (x: number) => Math.round(x * 1000) / 10;

function metric(id: string, label: string, unit: string, value: number | null, numerator: number | null, denominator: number | null, formulaVersion: string): Metric {
  return { id, label, value, unit, formulaVersion, numerator, denominator, status: value === null ? "missing" : "estimated" };
}

export function buildS02TileResult(input: S02Input, precomputed?: SunlightResult, visual?: S02Presentation): TileResult {
  const r = precomputed ?? computeSunlight(input);
  const calc = r.counts.calculated;
  const N = r.params.minContinuousHours;
  const metrics: Metric[] = [];

  // 시각별 음영 면적률: 창 안의 정시(09, 10, …)에 가장 가까운 간격
  for (let h = Math.ceil(r.params.windowStartMin / 60); h * 60 <= r.params.windowEndMin; h++) {
    const step = r.steps.reduce<(typeof r.steps)[number] | null>((best, s) => (best === null || Math.abs(s.minuteKst - h * 60) < Math.abs(best.minuteKst - h * 60) ? s : best), null);
    if (!step) continue;
    const id = `shaded_ratio_h${String(h).padStart(2, "0")}`;
    const label = `${hhmm(h * 60)} 무렵 음영 면적률`;
    if (step.shadedRatio === null || calc === 0) {
      metrics.push({ id, label, value: null, unit: "%", formulaVersion: "s02-shaded-ratio@1", numerator: null, denominator: null, status: step.sunUp ? "missing" : "not_applicable" });
    } else {
      metrics.push(metric(id, label, "%", pct(step.shadedRatio), Math.round(step.shadedRatio * calc), calc, "s02-shaded-ratio@1"));
    }
  }
  metrics.push(metric("median_sun_hours", "기하학적 일조시간 중앙값", "시간", r.medianHours, null, null, "s02-median-hours@1"));
  const shareId = `share_ge_${N}h_continuous`;
  metrics.push(
    metric(shareId, `연속 ${N}시간 이상 일조 면적률`, "%", r.shareAtLeastN === null ? null : pct(r.shareAtLeastN), r.shareAtLeastN === null ? null : Math.round(r.shareAtLeastN * calc), calc || null, "s02-share-continuous@1"),
  );
  metrics.push(
    metric("uncalculated_ratio", "미계산 면적률", "%", r.uncalculatedRatio === null ? null : pct(r.uncalculatedRatio), r.counts.uncalculated, calc + r.counts.uncalculated || null, "s02-uncalculated@1"),
  );

  const incomplete = r.buildings.excludedNoHeight;
  const assumed = r.buildings.assumedOneFloor;
  const limitations: TileResult["limitations"] = [{ kind: "estimated", note: S02_LIMITATION }];
  if (assumed > 0) limitations.push({ kind: "estimated", note: `높이·층수 자료가 없는 건물 ${assumed}동(${pct(assumed / Math.max(1, r.buildings.inInfluence))}%)은 1층(${FLOOR_HEIGHT_M} m)으로 가정했습니다.` });
  if (incomplete > 0) limitations.push({ kind: "incomplete", note: `영향 영역 안 건물 ${incomplete}개는 높이 정보가 없어 그림자 계산에서 제외했습니다. 불완전 장면 기준의 결과입니다.` });
  if (r.counts.uncalculated > 0) limitations.push({ kind: "partial", note: `높이를 모르는 건물이 덮은 수광면 ${r.counts.uncalculated}개 셀은 일조시간 0으로 세지 않고 미계산으로 분리했습니다.` });
  if (r.params.removeBuildingsInSite) limitations.push({ kind: "estimated", note: `대지 안 건물이 덮은 ${r.counts.removed}개 셀은 수광면에서 제외했습니다(기존 건물 철거 가정).` });

  const hasValue = r.medianHours !== null && r.shareAtLeastN !== null;
  const sentence = hasValue
    ? `${hhmm(r.params.windowStartMin)}~${hhmm(r.params.windowEndMin)} 대지의 기하학적 일조시간 중앙값은 ${r.medianHours}시간, 연속 ${N}시간 이상 일조 면적은 ${pct(r.shareAtLeastN as number)}% → 건물 모델만 반영한 추정이며 창면·기상·법적 판정은 포함하지 않음 → 세대 창 위치와 정밀 일조 검토로 확인할 것`
    : "수광면에 계산된 셀이 없어 일조시간을 산출하지 못함 → 대지 도형이나 건물 높이 자료가 부족함 → 대지 범위와 건물 높이 자료를 확인할 것";

  const status: TileResult["status"] = calc === 0 ? "no_data" : incomplete > 0 || r.counts.uncalculated > 0 || input.sources.length === 0 ? "partial" : "complete";

  const polygons: NonNullable<TileResult["presentation"]["polygons"]> = [];
  const layers = ["shadow_09", "shadow_12", "shadow_15", "sun_face"];
  const legend = ["shadow_09", "shadow_12", "shadow_15", "sun_face"].map((layer) => ({
    label: ({ shadow_09: "09:00 그림자", shadow_12: "12:00 그림자", shadow_15: "15:00 그림자", sun_face: "수광면" } as Record<string, string>)[layer],
    min: null,
    max: null,
  }));
  if (visual) {
    for (const site of siteRings(visual.site)) {
      if (site.length < 3) continue;
      const ring = site.map(([x, y]) => [x, y] as number[]);
      if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ring.push([...ring[0]]);
      const siteCandidate = polygonCandidate(0, "sun_face", [ring], polygonArea([ring]), "수광면");
      if (siteCandidate) polygons.push(siteCandidate.p);
    }
    let id = 1;
    for (const [hour, layer] of [["09", "shadow_09"], ["12", "shadow_12"], ["15", "shadow_15"]] as const) {
      for (const rings of visual.shadows[hour]) {
        const candidate = polygonCandidate(id++, layer, rings, polygonArea(rings));
        if (candidate) polygons.push(candidate.p);
      }
    }
  }

  return parseTileResult({
    tileId: input.tileId ?? `${input.analysisId}:S02`,
    analysisId: input.analysisId,
    tileType: "simulation",
    tileCode: "S02",
    status,
    engineVersion: S02_ENGINE_VERSION,
    conditions: {
      address: input.address,
      center: [input.center[0], input.center[1]],
      radiusM: input.radiusM,
      analysisDate: r.params.date,
      timezone: "Asia/Seoul",
      filters: {},
      simulation: {
        date: r.params.date,
        window: `${hhmm(r.params.windowStartMin)}-${hhmm(r.params.windowEndMin)}`,
        stepMin: r.params.stepMin,
        gridM: r.params.gridM,
        influenceRadiusM: r.params.influenceM,
        removeBuildingsInSite: r.params.removeBuildingsInSite,
        minContinuousHours: N,
        site: input.siteKind ?? "box",
        cuts: ["09:00", "12:00", "15:00"],
        buildings: r.buildings,
        cells: r.counts,
      },
      parcelSnapshotHash: input.parcelSnapshotHash ?? null,
    },
    metrics,
    judgment: { ruleId: "S02-sunlight-summary@1", basisMetricIds: ["median_sun_hours", shareId], sentence, level: null, criteria: null },
    presentation: {
      legend: visual ? legend : [],
      camera: null,
      layers: visual ? layers : ["shadow", "sunlight_hours"],
      outputFace: "front",
      ...(visual ? { polygons, polygonsTotal: polygons.length } : {}),
    },
    provenance: { manifestHash: input.manifestHash, sources: input.sources.map((s) => ({ ...s })) },
    limitations,
  });
}

export const S02_RASTER_ENGINE_VERSION = "v2-sun-raster@1";
export const S02_DATE_KEYS = ["spring", "summer", "autumn", "winter", "analysis"] as const;

/** Map/report consumers need explicit one-hour bins; a single 0..13 range loses the 12+ cut. */
export function sunHoursLegend(prefix = "일조시간"): TileResult["presentation"]["legend"] {
  return Array.from({ length: 13 }, (_, index) => ({
    label: index === 12 ? `${prefix} · 12시간 이상` : `${prefix} · ${index}시간`,
    min: index,
    max: index === 12 ? null : index + 1,
  }));
}

export interface S02RasterField {
  key: SunDateKey;
  date: string;
  field: SunFieldResult;
}

export interface S02RasterTileInput {
  analysisId: string;
  address: string;
  center: readonly [number, number];
  radiusM: number;
  manifestHash: string;
  sources: readonly { sourceId: string; releaseId: string; sourceAsOf: string | null; fetchedAt: string }[];
  site: SiteRings;
  siteKind: "parcel" | "polygon" | "box";
  grid: SunGrid;
  fields: readonly S02RasterField[];
  rasterRefs: readonly RasterRef[];
  influenceM: number;
  terrain: "glo30-horizon" | "none";
  coverage: TileResult["limitations"];
  parcelSnapshotHash?: string | null;
}

function raster(
  name: string,
  grid: SunGrid,
  kind: RasterRef["kind"],
  dtype: RasterRef["dtype"],
  scale: number,
  offset: number,
  nodata: number | null,
  palette: string,
  label: string,
  values: Uint8Array | Uint16Array | Int16Array,
): RasterData {
  return {
    ref: {
      name,
      kind,
      crs: "EPSG:5179",
      x0: grid.x0,
      y0: grid.y0,
      cellM: grid.cellM,
      cols: grid.cols,
      rows: grid.rows,
      dtype,
      bands: 1,
      scale,
      offset,
      nodata,
      palette,
      label,
    },
    values,
  };
}

function unpackBits(bits: Uint8Array, size: number): Uint8Array {
  const values = new Uint8Array(size);
  for (let index = 0; index < size; index++) values[index] = (bits[index >> 3] & (1 << (index & 7))) !== 0 ? 1 : 0;
  return values;
}

function sunHoursValues(field: SunFieldResult, grid: SunGrid): Uint8Array {
  const values = new Uint8Array(grid.receiver.length);
  for (let index = 0; index < values.length; index++) {
    if (grid.receiver[index] === 0) values[index] = 255;
    else if (grid.receiver[index] === 2) values[index] = 254;
    else values[index] = Math.max(0, Math.min(253, Math.round(field.sunMin[index] / 10)));
  }
  return values;
}

function flowValues(field: SunFieldResult, grid: SunGrid): Uint8Array {
  const values = new Uint8Array(grid.receiver.length);
  values.fill(255);
  for (let index = 0; index < grid.receiver.length; index++) {
    if (grid.receiver[index] === 2) values[index] = 254;
    else if (grid.receiver[index] === 1) values[index] = 0;
  }
  const count = Math.max(1, field.hourly.length);
  for (let hourIndex = 0; hourIndex < field.hourly.length; hourIndex++) {
    const mask = unpackBits(field.hourly[hourIndex].shade, grid.receiver.length);
    const rank = Math.max(1, Math.min(253, Math.round(((hourIndex + 1) / count) * 253)));
    for (let index = 0; index < values.length; index++) if (values[index] === 0 && mask[index]) values[index] = rank;
  }
  return values;
}

/** S02의 모든 래스터를 같은 순서로 만든다. D21은 이 중 동지만 다시 방출한다. */
export function s02RasterData(fields: readonly S02RasterField[], grid: SunGrid): RasterData[] {
  const output: RasterData[] = [];
  for (const item of fields) {
    const label = SEASON_LABEL[item.key];
    output.push(raster(
      "sun_hours_" + item.key,
      grid,
      "scalar",
      "u8",
      1 / 6,
      0,
      255,
      "sun_hours",
      label + " 일조시간",
      sunHoursValues(item.field, grid),
    ));
    output.push(raster(
      "shade_" + item.key + "_flow",
      grid,
      "classes",
      "u8",
      1 / 255,
      0,
      255,
      "shade_flow",
      label + " 그림자 흐름",
      flowValues(item.field, grid),
    ));
    for (const hour of item.field.hourly) {
      const values = unpackBits(hour.shade, grid.receiver.length);
      output.push(raster(
        "shade_" + item.key + "_h" + String(hour.kstHour).padStart(2, "0"),
        grid,
        "mask",
        "bits",
        1,
        0,
        null,
        "shade_mask",
        label + " " + String(hour.kstHour).padStart(2, "0") + ":00",
        values,
      ));
    }
  }
  return output;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const pct100 = (value: number) => round1(value * 100);

function estimatedMetric(id: string, label: string, unit: string, value: number, formulaVersion: string, numerator: number | null = null, denominator: number | null = null): TileResult["metrics"][number] {
  return { id, label, unit, value: Number.isFinite(value) ? value : null, formulaVersion, numerator, denominator, status: Number.isFinite(value) ? "estimated" : "missing" };
}

function fieldConditions(fields: readonly S02RasterField[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((item) => [
    item.key,
    {
      date: item.date,
      dayLengthH: round1(item.field.dayLengthMin / 60),
      tstOffsetMin: round1(item.field.tstOffsetMin),
      receivers: item.field.stats.receivers,
      buildings: item.field.obstacles.buildings,
      buildingsNoHeight: item.field.obstacles.excludedNoHeight,
      buildingsAssumedOneFloor: item.field.obstacles.assumedOneFloor,
      hourly: item.field.hourly.map((hour) => ({ kstHour: hour.kstHour, altDeg: round1(hour.altDeg), azDeg: round1(hour.azDeg) })),
    },
  ]));
}

function sitePolygons(site: SiteRings): NonNullable<TileResult["presentation"]["polygons"]> {
  return siteRings(site).flatMap((part) => {
    if (part.length < 3) return [];
    const ring = part.map(([x, y]) => {
      const [lng, lat] = toLngLat([x, y]);
      return [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
    });
    if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ring.push([...ring[0]]);
    const candidate = polygonCandidate(0, "sun_face", [ring], polygonArea([part.map(([x, y]) => [x, y])]), "수광면");
    return candidate ? [candidate.p] : [];
  });
}

export function buildS02RasterTileResult(input: S02RasterTileInput): TileResult {
  const fields = input.fields;
  const winter = fields.find((item) => item.key === "winter") ?? fields[0];
  const receiverCount = winter?.field.stats.receivers ?? 0;
  const unknown = fields.reduce((max, item) => Math.max(max, item.field.obstacles.excludedNoHeight), 0);
  const assumed = fields.reduce((max, item) => Math.max(max, item.field.obstacles.assumedOneFloor), 0);
  const metrics: TileResult["metrics"] = [];
  for (const item of fields) {
    const field = item.field;
    const suffix = "_" + item.key;
    metrics.push(estimatedMetric("day_length_h" + suffix, SEASON_LABEL[item.key] + " 낮 길이", "시간", round1(field.dayLengthMin / 60), "sun-day-length@1"));
    metrics.push(estimatedMetric("mean_sun_h" + suffix, SEASON_LABEL[item.key] + " 평균 일조시간", "시간", round1(field.stats.meanHours), "sun-mean-hours@1", field.stats.receivers ? field.stats.meanHours * field.stats.receivers : null, field.stats.receivers || null));
    metrics.push(estimatedMetric("share_lt1h_pct" + suffix, SEASON_LABEL[item.key] + " 1시간 미만 일조 면적률", "%", pct100(field.stats.shareLt1h), "sun-share-lt1h@1", field.stats.receivers * field.stats.shareLt1h, field.stats.receivers));
    metrics.push(estimatedMetric("share_cont2h_0915_pct" + suffix, SEASON_LABEL[item.key] + " 진태양시 09~15 연속 2시간 확보", "%", pct100(field.stats.shareCont2h), "sun-share-cont2h@1", field.stats.receivers * field.stats.shareCont2h, field.stats.receivers));
    metrics.push(estimatedMetric("share_total4h_0816_pct" + suffix, SEASON_LABEL[item.key] + " 진태양시 08~16 총 4시간 확보", "%", pct100(field.stats.shareTotal4h), "sun-share-total4h@1", field.stats.receivers * field.stats.shareTotal4h, field.stats.receivers));
    metrics.push(estimatedMetric("tst_0915_kst" + suffix, "진태양시 09~15 = KST 09:" + String(Math.round(field.tstOffsetMin)).padStart(2, "0") + "~15:" + String(Math.round(field.tstOffsetMin)).padStart(2, "0"), "분", round1(field.tstOffsetMin), "sun-tst-offset@1"));
    metrics.push(estimatedMetric("receivers" + suffix, SEASON_LABEL[item.key] + " 수광 셀", "셀", field.stats.receivers, "sun-receivers@1"));
  }
  const common = winter?.field.obstacles;
  metrics.push(estimatedMetric("buildings_used", "그림자에 사용한 건물 수", "동", common ? common.buildings - common.excludedNoHeight : 0, "sun-buildings-used@1"));
  metrics.push(estimatedMetric("buildings_no_height", "높이 미상 건물 수", "동", common?.excludedNoHeight ?? 0, "sun-buildings-no-height@1"));
  metrics.push(estimatedMetric("buildings_assumed_one_floor", "1층 가정(추정) 건물 수", "동", common?.assumedOneFloor ?? 0, "sun-buildings-assumed-one-floor@1", common?.assumedOneFloor ?? 0, common?.buildings ?? null));
  metrics.push(estimatedMetric("cell_m", "일조 격자 셀 크기", "m", input.grid.cellM, "sun-grid@1"));
  metrics.push(estimatedMetric("influence_m", "그림자 영향 반경", "m", input.influenceM, "sun-influence@1"));

  const limitations: TileResult["limitations"] = [
    { kind: "estimated", note: S02_LIMITATION },
    { kind: "estimated", note: "반경 밖 400 m까지 건물 그림자를 포함했습니다." },
    { kind: "estimated", note: "경사면 법선은 반영하지 않고 수평 수광면으로 계산했습니다." },
    { kind: input.terrain === "glo30-horizon" ? "estimated" : "unknown", note: input.terrain === "glo30-horizon" ? "Copernicus GLO-30(표면모델 DSM, 2011~15년·30 m·평활화) 지형 지평선을 반영했습니다. 서울에서 건물 신호는 미미합니다." : "게시된 DEM이 없어 지형 지평선을 반영하지 않았습니다." },
    ...(unknown > 0 ? [{ kind: "incomplete" as const, note: "높이 미상 " + unknown + "동은 그림자에서 제외하고 지붕 셀도 제외했습니다." }] : []),
    ...(assumed > 0 && common ? [{ kind: "estimated" as const, note: `높이·층수 자료가 없는 건물 ${assumed}동(${pct(assumed / Math.max(1, common.buildings))}%)은 1층(${FLOOR_HEIGHT_M} m)으로 가정했습니다.` }] : []),
    ...input.coverage,
  ];
  const partial = unknown > 0 || limitations.some((limitation) => limitation.kind === "partial" || limitation.kind === "incomplete");
  const status: TileResult["status"] = receiverCount === 0 ? "no_data" : partial ? "partial" : "complete";
  const winterMean = winter?.field.stats.meanHours ?? NaN;
  const winterCont = winter?.field.stats.shareCont2h ?? NaN;
  const winterTotal = winter?.field.stats.shareTotal4h ?? NaN;
  const summer = fields.find((item) => item.key === "summer");
  // 카드 헤드라인(tile-view의 mean_sun_h_winter)과 같은 동지를 먼저 말한다.
  const lead = winter
    ? "동지 반경 안 지면의 평균 일조 " + round1(winterMean) + "시간" + (summer ? ", 하지 " + round1(summer.field.stats.meanHours) + "시간" : "")
    : "동지 반경 안 지면의 평균 일조를 계산하지 못함";
  const sentence = winter
    ? lead + ", 동지 진태양시 09~15 연속 2시간 확보 " + pct100(winterCont) + "%, 08~16 총 4시간 " + pct100(winterTotal) + "% → 건물·지형 모델의 기하학적 추정이며 창면·기상·법적 판정이 아님 → 세대 창 위치 기준 정밀 일조 검토로 확인할 것"
    : "동지 일조장을 계산하지 못함 → 건물·지형 자료를 확인할 것";
  const polygons = sitePolygons(input.site);
  return parseTileResult({
    tileId: input.analysisId + "-S02",
    analysisId: input.analysisId,
    tileType: "simulation",
    tileCode: "S02",
    status,
    engineVersion: S02_RASTER_ENGINE_VERSION,
    conditions: {
      address: input.address,
      center: [input.center[0], input.center[1]],
      radiusM: input.radiusM,
      analysisDate: input.fields.find((item) => item.key === "analysis")?.date ?? input.fields[0]?.date ?? "2000-01-01",
      timezone: "Asia/Seoul",
      filters: {},
      simulation: {
        model: "sun-raster@1",
        dates: fieldConditions(fields),
        stepMin: 10,
        cellM: input.grid.cellM,
        influenceM: input.influenceM,
        terrain: input.terrain,
        tstWindows: { continuous: "09-15", total: "08-16" },
        hourlyMinAltDeg: 5,
        site: input.siteKind,
      },
      parcelSnapshotHash: input.parcelSnapshotHash ?? null,
    },
    metrics,
    judgment: { ruleId: "S02-sunlight-summary@3", basisMetricIds: ["mean_sun_h_winter", "share_cont2h_0915_pct_winter", "share_total4h_0816_pct_winter", ...(summer ? ["mean_sun_h_summer"] : [])], sentence, level: null, criteria: null },
    presentation: {
      legend: [
        { label: "수광면", min: null, max: null },
        ...sunHoursLegend(),
        { label: "그림자", min: null, max: null },
        { label: "그림자 흐름", min: 0, max: 1 },
      ],
      camera: null,
      layers: ["sun_face"],
      outputFace: "front",
      ...(polygons.length > 0 ? { polygons, polygonsTotal: polygons.length } : {}),
      rasters: [...input.rasterRefs],
    },
    provenance: { manifestHash: input.manifestHash, sources: input.sources.map((source) => ({ ...source })) },
    limitations,
  });
}
