/**
 * S02 일조·그림자 타일 결과. 화면 없이 계산 결과를 TileResult 계약으로 옮긴다.
 * 등급(level)은 매기지 않고, 법적 일조 판정 표현은 어디에도 쓰지 않는다.
 */
import { parseTileResult, type TileResult } from "../tile-result";
import { polygonArea } from "../engine/tiles/geo";
import { polygonCandidate } from "../engine/tiles/common";
import { computeSunlight, type SunlightInput, type SunlightResult } from "./sunlight";
import type { XY } from "./shadow";

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
  siteKind?: "parcel" | "box";
}

export type S02ShadowParts = Record<"09" | "12" | "15", number[][][][]>;

export interface S02Presentation {
  site: readonly XY[];
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
  const limitations: TileResult["limitations"] = [{ kind: "estimated", note: S02_LIMITATION }];
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
    const site = [...visual.site];
    if (site.length >= 3) {
      const ring = site.map(([x, y]) => [x, y] as number[]);
      if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push([...ring[0]]);
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
      parcelSnapshotHash: null,
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
