/** D12 도시계획시설 — VWorld dsId 24 시설 면·선·점 도형. */
import type { Geometry } from "geojson";
import { toUtmk } from "../../crs";
import type { TileResult } from "../../tile-result";
import type { EngineContext, SourceRef } from "../../engine/context";
import { candidate, fmt, makeTile, obs, polygonCandidate, type MapCandidate, type PolygonCandidate } from "../../engine/tiles/common";
import { clipToCircle, polygonArea, sampleLine } from "../../engine/tiles/geo";

const SOURCE_PREFIX = "facility_";
const FEATURE_KIND = "plan_facility";
const MISSING_NOTE = "도시계획시설 자료를 확인할 수 없습니다. 최신 자료 확인이 필요합니다.";

type FacilityHit = ReturnType<EngineContext["hits"]>[number];
type FacilityShape = "polygon" | "line" | "point";

function sourceRefs(ctx: EngineContext): SourceRef[] {
  const db = ctx.db("reference");
  if (!db) return [];
  const rows = db.prepare("SELECT source_id FROM source_release ORDER BY source_id").all() as Array<{ source_id: string }>;
  const ids = rows.map((r) => r.source_id).filter((id) => id.startsWith(SOURCE_PREFIX));
  return ctx.sources("reference", ids);
}

function classOf(h: FacilityHit): string {
  const p = h.properties;
  for (const value of [p.cls, p.class, p.typeLabel, p.layer]) {
    if (typeof value === "string" && value.trim() !== "") {
      const cls = value.trim();
      // 표의 읽기 좋은 분류명은 보존하되, 화면 범례의 기존 canonical 키로 내보낸다.
      return ({ "유통·공급": "유통공급", "공공·문화체육": "공공문화체육" } as Record<string, string>)[cls] ?? cls;
    }
  }
  return "기타";
}

function shapeOf(h: FacilityHit): FacilityShape {
  const declared = h.properties.shapeKind;
  if (declared === "polygon" || declared === "line" || declared === "point") return declared;
  if (h.geometry.type === "Polygon" || h.geometry.type === "MultiPolygon") return "polygon";
  if (h.geometry.type === "LineString" || h.geometry.type === "MultiLineString") return "line";
  return "point";
}

function labelOf(h: FacilityHit, cls: string): string {
  return h.name?.trim() || (typeof h.properties.typeLabel === "string" && h.properties.typeLabel.trim() !== "" ? h.properties.typeLabel.trim() : cls);
}

function missingTile(ctx: EngineContext): TileResult {
  return makeTile(ctx, {
    code: "D12",
    type: "diagram",
    status: "not_provided",
    metrics: [],
    sources: [],
    limitations: [{ kind: "not_provided", note: MISSING_NOTE }],
  });
}

function lineParts(g: Geometry): number[][][] {
  if (g.type === "LineString") return [g.coordinates as number[][]];
  if (g.type === "MultiLineString") return g.coordinates as number[][][];
  return [];
}

/** EPSG:5179 선분 중 반경 원 안에 들어온 길이. 선분이 원을 가로지르는 경우도 분할한다. */
function lineLengthInCircle(center: readonly [number, number], radiusM: number, g: Geometry): number {
  const [cx, cy] = toUtmk(center);
  let total = 0;
  for (const part of lineParts(g)) {
    for (let i = 1; i < part.length; i++) {
      const ax = part[i - 1][0] - cx;
      const ay = part[i - 1][1] - cy;
      const dx = part[i][0] - part[i - 1][0];
      const dy = part[i][1] - part[i - 1][1];
      const len = Math.hypot(dx, dy);
      if (len === 0) continue;
      const a = dx * dx + dy * dy;
      const b = 2 * (ax * dx + ay * dy);
      const c = ax * ax + ay * ay - radiusM * radiusM;
      const disc = b * b - 4 * a * c;
      const ts = [0, 1];
      if (disc > 0) {
        const root = Math.sqrt(disc);
        ts.push((-b - root) / (2 * a), (-b + root) / (2 * a));
      }
      ts.sort((x, y) => x - y);
      for (let j = 1; j < ts.length; j++) {
        const lo = Math.max(0, ts[j - 1]);
        const hi = Math.min(1, ts[j]);
        if (hi <= lo) continue;
        const t = (lo + hi) / 2;
        const x = ax + t * dx;
        const y = ay + t * dy;
        if (x * x + y * y <= radiusM * radiusM + 1e-7) total += (hi - lo) * len;
      }
    }
  }
  return total;
}

export function d12(ctx: EngineContext): TileResult {
  const sources = sourceRefs(ctx);
  if (sources.length === 0) return missingTile(ctx);

  const hits = ctx.hits("reference", [FEATURE_KIND]);
  const areas = new Map<string, number>();
  const lengths = new Map<string, number>();
  const counts = new Map<string, number>();
  const polygons: PolygonCandidate[] = [];
  const map: MapCandidate[] = [];
  let failed = 0;
  for (const h of hits) {
    const cls = classOf(h);
    const label = labelOf(h, cls);
    const shape = shapeOf(h);
    const layer = `facility:${cls}`;
    if (shape === "polygon") {
      const parts = clipToCircle(ctx.input.center, ctx.input.radiusM, h.geometry);
      if (parts === null) {
        failed++;
        continue;
      }
      const area = parts.reduce((sum, rings) => sum + Math.max(0, polygonArea(rings)), 0);
      if (area <= 0) continue;
      areas.set(cls, (areas.get(cls) ?? 0) + area);
      for (const rings of parts) {
        const poly = polygonCandidate(h.featureId, layer, rings, polygonArea(rings), label);
        if (poly) polygons.push(poly);
      }
      const clipped = { ...h, geometry: { type: "MultiPolygon", coordinates: parts } } as FacilityHit;
      map.push(candidate(clipped, layer, { label }));
    } else if (shape === "line") {
      const length = lineLengthInCircle(ctx.input.center, ctx.input.radiusM, h.geometry);
      if (length <= 0) continue;
      lengths.set(cls, (lengths.get(cls) ?? 0) + length);
      map.push(...sampleLine(ctx.input.center, h.geometry, ctx.input.radiusM, Math.max(20, Math.min(100, ctx.input.radiusM / 20)), h.featureId, layer));
    } else {
      counts.set(cls, (counts.get(cls) ?? 0) + 1);
      map.push(candidate(h, layer, { label }));
    }
  }

  const areaClasses = [...areas.keys()].sort((a, b) => a.localeCompare(b));
  const lengthClasses = [...lengths.keys()].sort((a, b) => a.localeCompare(b));
  const countClasses = [...counts.keys()].sort((a, b) => a.localeCompare(b));
  const metrics = [
    ...areaClasses.map((cls) => {
      const area = Math.round(areas.get(cls)!);
      return obs(`back_area_${cls}`, `반경 교차면적: ${cls}`, area, "㎡", "d12-area@1:반경과 도시계획시설 면 도형의 교차면적", area, null);
    }),
    ...lengthClasses.map((cls) => {
      const length = Math.round(lengths.get(cls)! * 10) / 10;
      return obs(`back_length_${cls}`, `반경 교차길이: ${cls}`, length, "m", "d12-length@1:반경과 도시계획시설 선 도형의 교차길이", length, null);
    }),
    ...countClasses.map((cls) => obs(`back_count_${cls}`, `반경 안 점 시설: ${cls}`, counts.get(cls)!, "개", "d12-count@1:반경 안 도시계획시설 점 개수", counts.get(cls)!, null)),
  ];
  const summary = [
    ...areaClasses.map((cls) => `${cls} ${Math.round(areas.get(cls)!)}㎡`),
    ...lengthClasses.map((cls) => `${cls} ${Math.round(lengths.get(cls)! * 10) / 10}m`),
    ...countClasses.map((cls) => `${cls} ${counts.get(cls)}개`),
  ].join("·");
  const sentence = hits.length === 0
    ? "반경과 교차하는 도시계획시설 도형이 확인되지 않음 → 자료 범위가 없거나 아직 확인되지 않을 수 있음 → 도시계획시설 결정·고시와 현장 운영 상태 확인 필요"
    : `반경과 교차하는 도시계획시설 ${fmt(hits.length)}건${summary ? `(${summary})` : ""} → 면·선·점 도형을 원천 형상별로 집계했으며 계획 결정이 곧 운영을 뜻하지 않음 → 시설 결정·고시와 실제 운영 여부 확인 필요`;
  const limitations: TileResult["limitations"] = [
    { kind: "unknown", note: "원천에 지정·운영 상태의 구분이 없어 계획시설 결정만으로 현재 운영 여부는 판단하지 않습니다." },
    { kind: "unknown", note: "시설 분류와 형상은 원천 속성 기준이며, 면적·길이·점 개수는 서로 합산하지 않습니다." },
    ...(failed > 0 ? [{ kind: "partial" as const, note: `도형 오류로 교차면적을 계산하지 못한 ${failed}건은 면적 지표에서 제외했습니다.` }] : []),
    ...ctx.coverage("reference", sources.map((s) => s.sourceId)),
  ];
  return makeTile(ctx, {
    code: "D12",
    type: "diagram",
    status: "partial",
    metrics,
    judgment: { ruleId: "d12-plan-facility@1", basisMetricIds: metrics.length ? [metrics[0].id] : [], sentence, level: null, criteria: null },
    sources,
    layers: [...new Set([...areaClasses, ...lengthClasses, ...countClasses].map((cls) => `facility:${cls}`))],
    map,
    polygons,
    limitations,
  });
}
