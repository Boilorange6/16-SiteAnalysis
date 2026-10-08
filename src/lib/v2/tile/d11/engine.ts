/** D11 구역·지구 — VWorld dsId 24 지구·구역 면 도형. */
import type { TileResult } from "../../tile-result";
import type { EngineContext, SourceRef } from "../../engine/context";
import { candidate, fmt, makeTile, obs, polygonCandidate, type MapCandidate, type PolygonCandidate } from "../../engine/tiles/common";
import { clipToCircle, polygonArea } from "../../engine/tiles/geo";

const SOURCE_PREFIX = "district_";
const FEATURE_KIND = "district_area";
const MISSING_NOTE = "구역·지구 자료를 확인할 수 없습니다. 최신 자료 확인이 필요합니다.";

type DistrictHit = ReturnType<EngineContext["hits"]>[number];

function sourceRefs(ctx: EngineContext): SourceRef[] {
  const db = ctx.db("reference");
  if (!db) return [];
  const rows = db.prepare("SELECT source_id FROM source_release ORDER BY source_id").all() as Array<{ source_id: string }>;
  const ids = rows.map((r) => r.source_id).filter((id) => id.startsWith(SOURCE_PREFIX));
  return ctx.sources("reference", ids);
}

function classOf(h: DistrictHit): string {
  const p = h.properties;
  const configured = [p.cls, p.class, p.typeLabel, p.layer].find((value): value is string => typeof value === "string" && value.trim() !== "")?.trim() ?? "기타";
  // 표의 레이어 묶음은 원천 cls로 보존하되, 지도·범례는 기존 D11 canonical 키를 사용한다.
  if (p.cls === "구역" || p.layer === "area") {
    const subKind = typeof p.typeLabel === "string" ? p.typeLabel.trim() : "";
    return subKind.includes("지구단위계획") ? "지구단위계획" : "기타";
  }
  return ({
    개발제한구역: "개발제한",
    택지개발예정지구: "택지·도시개발",
    도시개발구역: "택지·도시개발",
  } as Record<string, string>)[configured] ?? configured;
}

function labelOf(h: DistrictHit, cls: string): string {
  return h.name?.trim() || (typeof h.properties.typeLabel === "string" && h.properties.typeLabel.trim() !== "" ? h.properties.typeLabel.trim() : cls);
}

function missingTile(ctx: EngineContext): TileResult {
  return makeTile(ctx, {
    code: "D11",
    type: "diagram",
    status: "not_provided",
    metrics: [],
    sources: [],
    limitations: [{ kind: "not_provided", note: MISSING_NOTE }],
  });
}

function clippedDistricts(ctx: EngineContext, hits: DistrictHit[]): {
  areas: Map<string, number>;
  polygons: PolygonCandidate[];
  points: MapCandidate[];
  validCode: number;
  failed: number;
} {
  const areas = new Map<string, number>();
  const polygons: PolygonCandidate[] = [];
  const points: MapCandidate[] = [];
  let validCode = 0;
  let failed = 0;
  for (const h of hits) {
    const cls = classOf(h);
    const label = labelOf(h, cls);
    if (typeof h.properties.typeCode === "string" && h.properties.typeCode.trim() !== "") validCode++;
    const parts = clipToCircle(ctx.input.center, ctx.input.radiusM, h.geometry);
    if (parts === null) {
      failed++;
      continue;
    }
    const area = parts.reduce((sum, rings) => sum + Math.max(0, polygonArea(rings)), 0);
    if (area <= 0) continue;
    areas.set(cls, (areas.get(cls) ?? 0) + area);
    for (const rings of parts) {
      const poly = polygonCandidate(h.featureId, `district:${cls}`, rings, polygonArea(rings), label);
      if (poly) polygons.push(poly);
    }
    // 면을 그릴 수 없는 화면에서도 같은 도형을 확인할 수 있게 대표점을 함께 보낸다.
    const clipped: DistrictHit = { ...h, geometry: { type: "MultiPolygon", coordinates: parts } };
    points.push(candidate(clipped, `district:${cls}`, { label }));
  }
  return { areas, polygons, points, validCode, failed };
}

export function d11(ctx: EngineContext): TileResult {
  const sources = sourceRefs(ctx);
  if (sources.length === 0) return missingTile(ctx);

  const hits = ctx.hits("reference", [FEATURE_KIND]);
  const clipped = clippedDistricts(ctx, hits);
  const fillPct = hits.length === 0 ? 0 : Math.round((clipped.validCode / hits.length) * 1000) / 10;
  const classes = [...clipped.areas.keys()].sort((a, b) => a.localeCompare(b));
  const metrics = [
    ...classes.map((cls) => {
      const area = Math.round(clipped.areas.get(cls)!);
      return obs(`back_area_${cls}`, `반경 교차면적: ${cls}`, area, "㎡", "d11-area@1:반경과 구역·지구 도형의 교차면적", area, null);
    }),
    obs("fill_code_pct", "유효 구역·지구 코드 채움률", fillPct, "%", "d11-fill-code@1:유효 typeCode가 있는 반경 교차 객체÷반경 교차 객체", clipped.validCode, hits.length),
  ];
  const areaText = classes.length === 0 ? "분류별 면적을 산출하지 못함" : classes.map((cls) => `${cls} ${Math.round(clipped.areas.get(cls)!)}㎡`).join("·");
  const sentence = hits.length === 0
    ? "반경과 교차하는 구역·지구 도형이 확인되지 않음 → 자료 범위가 없거나 아직 확인되지 않을 수 있음 → VWorld 최신 자료와 고시 원문 확인 필요"
    : `반경과 교차하는 구역·지구 ${fmt(hits.length)}건(${areaText}) → 확인된 도형의 교차면적이며 규제 적용 여부나 운영 상태를 뜻하지 않음 → 지정 내용과 행위 제한은 토지이용계획확인서·고시 원문 확인 필요`;
  const limitations: TileResult["limitations"] = [
    { kind: "unknown", note: "원천에 지정·운영 상태의 구분이 없어 현재 효력이나 실제 운영 여부는 판단하지 않습니다." },
    { kind: "unknown", note: "구역·지구는 서로 중첩될 수 있어 뒷면 면적 막대 합계 100% 아님(분류별 교차면적 합이 반경 원 면적과 일치하지 않을 수 있음)." },
    ...(clipped.validCode < hits.length ? [{ kind: "partial" as const, note: `반경 교차 객체 ${hits.length}건 중 유효 코드가 있는 ${clipped.validCode}건만 코드 채움률에 반영했습니다.` }] : []),
    ...(clipped.failed > 0 ? [{ kind: "partial" as const, note: `도형 오류로 반경 교차면적을 계산하지 못한 ${clipped.failed}건은 면적 지표에서 제외했습니다.` }] : []),
    ...ctx.coverage("reference", sources.map((s) => s.sourceId)),
  ];
  return makeTile(ctx, {
    code: "D11",
    type: "diagram",
    status: "partial",
    metrics,
    judgment: { ruleId: "d11-district-area@1", basisMetricIds: ["fill_code_pct"], sentence, level: null, criteria: null },
    sources,
    layers: classes.map((cls) => `district:${cls}`),
    map: clipped.points,
    polygons: clipped.polygons,
    limitations,
  });
}
