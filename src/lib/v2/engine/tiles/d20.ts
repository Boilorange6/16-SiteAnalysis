/** D20 필지 규모 — 필지 원래 도형 면적과 반경 교차 면적을 분리해 표시한다. */
import type { FeatureHit } from "../../data/features";
import type { TileResult } from "../../tile-result";
import type { EngineContext, Limitation } from "../context";
import { makeTile, missing, obs, polygonCandidate } from "./common";
import { areaInCircle, polygonArea } from "./geo";
import { notProvided } from "./not-provided";

const PARCEL_SOURCES = ["parcel_polygon"] as const;
const ROAD_WATER_JIMOK = new Set(["도", "천", "구", "유", "제", "철", "구거", "철도", "제방"]);
const LOT_CLASSES = [
  { layer: "lot_lt100", label: "100㎡ 미만", matches: (area: number) => area < 100 },
  { layer: "lot_100_300", label: "100~300㎡", matches: (area: number) => area >= 100 && area < 300 },
  { layer: "lot_300_1000", label: "300~1,000㎡", matches: (area: number) => area >= 300 && area < 1000 },
  { layer: "lot_1000_3000", label: "1,000~3,000㎡", matches: (area: number) => area >= 1000 && area < 3000 },
  { layer: "lot_ge3000", label: "3,000㎡ 이상", matches: (area: number) => area >= 3000 },
  { layer: "lot_road_water", label: "도로·하천 지목", matches: (_area: number) => false },
] as const;

type Metric = TileResult["metrics"][number];
type MeasuredParcel = { areaM2: number; parts: number[][][][] };
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

function jimokOf(hit: FeatureHit): string {
  const value = hit.properties.jimok;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "";
}

function areaOf(hit: FeatureHit): number | null {
  const value = hit.properties.areaM2;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function classIndex(hit: FeatureHit, areaM2: number | null): number | null {
  if (ROAD_WATER_JIMOK.has(jimokOf(hit))) return LOT_CLASSES.length - 1;
  if (areaM2 === null) return null;
  const index = LOT_CLASSES.findIndex((item) => item.matches(areaM2));
  return index >= 0 ? index : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function d20(ctx: EngineContext): TileResult {
  const sources = ctx.sources("parcels", PARCEL_SOURCES);
  if (sources.length === 0) return notProvided(ctx, "D20");

  const hits = ctx.hits("parcels", ["parcel"]);
  const measured = new Map<number, MeasuredParcel>();
  let failed = 0;
  for (const hit of hits) {
    const result = areaInCircle(ctx.input.center, ctx.input.radiusM, hit.geometry);
    if (result === null) {
      failed++;
      continue;
    }
    measured.set(hit.featureId, { areaM2: result.areaM2, parts: result.parts });
  }

  const counts = LOT_CLASSES.map(() => 0);
  const crossAreas = LOT_CLASSES.map(() => 0);
  const originalAreas: number[] = [];
  let areaKnown = 0;
  for (const hit of hits) {
    const originalArea = areaOf(hit);
    if (originalArea !== null) {
      areaKnown++;
      originalAreas.push(originalArea);
    }
    const index = classIndex(hit, originalArea);
    if (index === null) continue;
    counts[index]++;
    crossAreas[index] += measured.get(hit.featureId)?.areaM2 ?? 0;
  }

  const circleAreaM2 = Math.PI * ctx.input.radiusM ** 2;
  const circleAreaRounded = Math.round(circleAreaM2);
  const metrics: Metric[] = [
    obs("parcels", "교차 필지", hits.length, "필지", "d20-parcels@1:반경과 실제 교차하는 parcel 도형 수"),
    hits.length === 0
      ? missing("fill_area_pct", "필지 도형 면적 확인률", "%", "d20-fill-area@1:areaM2가 있는 필지÷교차 필지")
      : obs("fill_area_pct", "필지 도형 면적 확인률", pct(areaKnown, hits.length), "%", "d20-fill-area@1:areaM2가 있는 필지÷교차 필지; 공부면적 아님", areaKnown, hits.length),
  ];
  for (let i = 0; i < LOT_CLASSES.length; i++) {
    const item = LOT_CLASSES[i];
    if (hits.length === 0) {
      metrics.push(missing(`share_count_${i + 1}`, `${item.label} (필지 수)`, "%", "d20-share-count@1:필지 수÷교차 필지 수"));
      metrics.push(missing(`share_area_${i + 1}`, `${item.label} (면적)`, "%", "d20-share-area@1:반경 교차면적÷π·r²"));
    } else {
      metrics.push(obs(`share_count_${i + 1}`, `${item.label} (필지 수)`, pct(counts[i], hits.length), "%", "d20-share-count@1:필지 수÷교차 필지 수", counts[i], hits.length));
      metrics.push(obs(`share_area_${i + 1}`, `${item.label} (면적)`, pct(crossAreas[i], circleAreaM2), "%", "d20-share-area@1:반경 교차면적÷π·r²", Math.round(crossAreas[i]), circleAreaRounded));
    }
  }
  const medianM2 = median(originalAreas);
  metrics.push(medianM2 === null
    ? missing("median_parcel_m2", "필지 도형 면적 중앙값", "㎡", "d20-median-area@1:areaM2의 중앙값; 공부면적 아님")
    : obs("median_parcel_m2", "필지 도형 면적 중앙값", medianM2, "㎡", "d20-median-area@1:교차 필지 전체 도형 면적 areaM2의 중앙값; 공부면적 아님"));

  const polygons = [];
  for (const hit of hits) {
    const originalArea = areaOf(hit);
    const index = classIndex(hit, originalArea);
    const layer = index === null ? "parcel" : LOT_CLASSES[index].layer;
    const result = measured.get(hit.featureId);
    if (!result) continue;
    for (const rings of result.parts) {
      const polygon = polygonCandidate(hit.featureId, layer, rings, polygonArea(rings), null);
      if (polygon) polygons.push(polygon);
    }
  }

  const coverage = ctx.coverage("parcels", PARCEL_SOURCES);
  const limitations: Limitation[] = [
    { kind: "unknown", note: "필지 면적은 공부면적이 아닌 연속지적 도형 계산 면적입니다." },
    ...(areaKnown < hits.length ? [{ kind: "partial" as const, note: `areaM2가 없는 ${hits.length - areaKnown}필지는 규모 구간과 중앙값에서 제외했습니다.` }] : []),
    ...(failed > 0 ? [{ kind: "partial" as const, note: `도형 오류로 반경 교차 면적을 계산하지 못한 ${failed}건은 면적 구성에서 제외했습니다.` }] : []),
    ...coverage,
  ];
  const status: TileResult["status"] = limitations.some((item) => item.kind === "partial" || item.kind === "incomplete") ? "partial" : "complete";
  const medianText = medianM2 === null ? "중앙값 미상" : `도형 면적 중앙값 ${medianM2.toLocaleString("en-US")}㎡`;
  const sentence = hits.length === 0
    ? `반경 ${ctx.input.radiusM.toLocaleString("en-US")}m 안에서 필지가 확인되지 않음 → 필지 규모를 산출하지 못함 → 연속지적 도형과 토지대장 확인 필요`
    : `반경 ${ctx.input.radiusM.toLocaleString("en-US")}m 안 교차 필지 ${hits.length}개의 전체 도형 면적을 구간화하고 ${medianText} → 도형 면적 기준의 규모 분포이며 공부면적·법적 지목 판단은 아님 → 토지대장과 지적도 확인 필요`;

  return makeTile(ctx, {
    code: "D20",
    type: "diagram",
    status,
    metrics,
    judgment: { ruleId: "D20-lot-size@1", basisMetricIds: ["parcels"], sentence, level: null, criteria: null },
    sources,
    layers: [...LOT_CLASSES.map((item) => item.layer), "parcel"],
    polygons,
    limitations,
  });
}
