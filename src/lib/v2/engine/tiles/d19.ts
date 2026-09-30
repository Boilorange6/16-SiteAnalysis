/** D19 지적 — 반경과 교차하는 연속지적 도형과 지목 구성을 참조용으로 표시한다. */
import type { FeatureHit } from "../../data/features";
import type { TileResult } from "../../tile-result";
import type { EngineContext, Limitation } from "../context";
import { candidate, makeTile, obs, polygonCandidate } from "./common";
import { areaInCircle, polygonArea } from "./geo";
import { notProvided } from "./not-provided";

const PARCEL_SOURCES = ["parcel_polygon"] as const;
const TOP_JIMOKS = 8;
type Metric = TileResult["metrics"][number];
type MeasuredParcel = { areaM2: number; parts: number[][][][] };

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

function notApplicable(id: string, label: string, unit: string, formulaVersion: string): Metric {
  return { id, label, value: null, unit, formulaVersion, numerator: null, denominator: null, status: "not_applicable" };
}

function jimokOf(hit: FeatureHit): string {
  const value = hit.properties.jimok;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "미상";
}

function jibunOf(hit: FeatureHit): string | null {
  const value = hit.properties.jibun;
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return hit.name ?? null;
}

function measure(hits: FeatureHit[], center: EngineContext["input"]["center"], radiusM: number): { byFeature: Map<number, MeasuredParcel>; failed: number } {
  const byFeature = new Map<number, MeasuredParcel>();
  let failed = 0;
  for (const hit of hits) {
    const result = areaInCircle(center, radiusM, hit.geometry);
    if (result === null) {
      failed++;
      continue;
    }
    byFeature.set(hit.featureId, { areaM2: result.areaM2, parts: result.parts });
  }
  return { byFeature, failed };
}

function groupedJimok(hits: FeatureHit[], byFeature: Map<number, MeasuredParcel>): Array<[string, { count: number; areaM2: number }]> {
  const grouped = new Map<string, { count: number; areaM2: number }>();
  for (const hit of hits) {
    const key = jimokOf(hit);
    const current = grouped.get(key) ?? { count: 0, areaM2: 0 };
    current.count++;
    current.areaM2 += byFeature.get(hit.featureId)?.areaM2 ?? 0;
    grouped.set(key, current);
  }
  const ordered = [...grouped.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0], "ko"));
  const top = ordered.slice(0, TOP_JIMOKS);
  const rest = ordered.slice(TOP_JIMOKS);
  if (rest.length > 0) {
    const other = rest.reduce((sum, [, value]) => ({ count: sum.count + value.count, areaM2: sum.areaM2 + value.areaM2 }), { count: 0, areaM2: 0 });
    top.push(["기타", other]);
  }
  return top;
}

export function d19(ctx: EngineContext): TileResult {
  const sources = ctx.sources("parcels", PARCEL_SOURCES);
  if (sources.length === 0) return notProvided(ctx, "D19");

  const hits = ctx.hits("parcels", ["parcel"]);
  const { byFeature, failed } = measure(hits, ctx.input.center, ctx.input.radiusM);
  const circleAreaM2 = Math.PI * ctx.input.radiusM ** 2;
  const circleAreaRounded = Math.round(circleAreaM2);
  const validAreaM2 = [...byFeature.values()].reduce((sum, value) => sum + value.areaM2, 0);
  const siteFound = ctx.input.pnu !== null && hits.some((hit) => hit.pnu === ctx.input.pnu);
  const grouped = groupedJimok(hits, byFeature);

  const metrics: Metric[] = [
    obs("parcels", "교차 필지", hits.length, "필지", "d19-parcels@1:반경과 실제 교차하는 parcel 도형 수"),
    ctx.input.pnu === null
      ? notApplicable("site_parcel_found", "대상 필지 도형 확인", "여부", "d19-site-parcel@1:pnu 입력이 없는 좌표 분석")
      : obs("site_parcel_found", "대상 필지 도형 확인", siteFound ? 1 : 0, "여부", "d19-site-parcel@1:입력 pnu가 반경 교차 필지의 pnu와 일치하는지", siteFound ? 1 : 0, 1),
    obs("fill_geometry_pct", "확보 도형 면적률(대상 분모 미확보)", pct(validAreaM2, circleAreaM2), "%", "d19-fill-geometry@1:유효 도형 교차면적÷π·r²; 원천 지적 대상 면적 분모 미확보", Math.round(validAreaM2), circleAreaRounded),
  ];

  for (const [i, [jimok, values]] of grouped.entries()) {
    metrics.push(obs(`share_jimok_${i + 1}`, `지목: ${jimok}`, pct(values.count, hits.length), "%", "d19-jimok-share@1:지목별 교차 필지 수÷교차 필지 수", values.count, hits.length));
    metrics.push(obs(`share_count_${i + 1}`, `${jimok} (필지 수)`, pct(values.count, hits.length), "%", "d19-share-count@1:지목별 교차 필지 수÷교차 필지 수", values.count, hits.length));
    metrics.push(obs(`share_area_${i + 1}`, `${jimok} (면적)`, pct(values.areaM2, circleAreaM2), "%", "d19-share-area@1:지목별 유효 도형 교차면적÷π·r²", Math.round(values.areaM2), circleAreaRounded));
  }

  const polygons = [];
  const map = [];
  for (const hit of hits) {
    const measured = byFeature.get(hit.featureId);
    if (!measured) continue;
    const isSite = ctx.input.pnu !== null && hit.pnu === ctx.input.pnu;
    const layer = isSite ? "parcel_site" : "parcel";
    const label = isSite ? jibunOf(hit) : null;
    if (isSite) map.push(candidate(hit, layer, { highlight: true, label }));
    for (const rings of measured.parts) {
      const polygon = polygonCandidate(hit.featureId, layer, rings, polygonArea(rings), label);
      if (polygon) polygons.push(polygon);
    }
  }

  const coverage = ctx.coverage("parcels", PARCEL_SOURCES);
  const limitations: Limitation[] = [
    { kind: "unknown", note: "확보 도형 면적률의 분모는 반경 원 면적이며, 원천 지적 대상 면적 분모는 확보하지 못했습니다." },
    { kind: "unknown", note: "연속지적 도형과 지목은 참조용이며 법적 경계·공부면적의 확정 자료가 아닙니다." },
    ...(failed > 0 ? [{ kind: "partial" as const, note: `도형 오류로 반경 교차 면적을 계산하지 못한 ${failed}건은 면적 구성에서 제외했습니다.` }] : []),
    ...coverage,
  ];
  const status: TileResult["status"] = limitations.some((item) => item.kind === "partial" || item.kind === "incomplete") ? "partial" : "complete";
  const sentence = hits.length === 0
    ? `반경 ${ctx.input.radiusM.toLocaleString("en-US")}m 안에서 연속지적 필지가 확인되지 않음 → 지적 도형 공백과 무필지를 구분할 수 없음 → 지적도와 토지대장 확인 필요`
    : `반경 ${ctx.input.radiusM.toLocaleString("en-US")}m 안 연속지적 필지 ${hits.length}개를 확인 → 지목별 필지 수와 교차 도형 면적을 참조용으로 표시 → 대상 필지와 경계는 지적도·토지대장 확인 필요`;

  return makeTile(ctx, {
    code: "D19",
    type: "diagram",
    status,
    metrics,
    judgment: { ruleId: "D19-parcels@1", basisMetricIds: ["parcels"], sentence, level: null, criteria: null },
    sources,
    layers: ["parcel", "parcel_site"],
    map,
    polygons,
    limitations,
  });
}
