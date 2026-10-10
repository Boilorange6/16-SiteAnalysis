/** D12 도시계획시설 — VWorld dsId 24 시설 면·선·점 도형. */
import type { TileResult } from "../../tile-result";
import type { EngineContext, SourceRef } from "../../engine/context";
import { candidate, fmt, lineCandidate, makeTile, obs, polygonCandidate, type LineCandidate, type MapCandidate, type PolygonCandidate } from "../../engine/tiles/common";
import { clipLineToCircle, clipToCircle, linePathLength, polygonArea } from "../../engine/tiles/geo";

const SOURCE_PREFIX = "facility_";
const FEATURE_KIND = "plan_facility";
const MISSING_NOTE = "도시계획시설 자료를 확인할 수 없습니다. 최신 자료 확인이 필요합니다.";

type FacilityHit = ReturnType<EngineContext["hits"]>[number];
type FacilityShape = "polygon" | "line" | "point";

/** 문장용 면적: 작은 면은 ㎡, 만㎡ 이상은 한 자리 ha로 줄여 수치를 빠르게 읽게 한다. */
function formatAreaM2(areaM2: number): string {
  const rounded = Math.max(0, Math.round(areaM2));
  if (rounded >= 10_000) return `${fmt(Math.round((rounded / 10_000) * 10) / 10)}ha`;
  return `${fmt(rounded)}㎡`;
}

function formatLengthM(lengthM: number): string {
  return `${fmt(Math.round(lengthM * 10) / 10)}m`;
}

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

function textValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" || trimmed === "-" ? null : trimmed;
}

/** D12 name은 시설 종류명(A6/typeLabel) 원천값이다. 분류(cls)는 이름 대체값으로 쓰지 않는다. */
function nameOf(h: FacilityHit): string | null {
  return textValue(h.properties.typeLabel) ?? textValue(h.name);
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

export function d12(ctx: EngineContext): TileResult {
  const sources = sourceRefs(ctx);
  if (sources.length === 0) return missingTile(ctx);

  const hits = ctx.hits("reference", [FEATURE_KIND]);
  const areas = new Map<string, number>();
  const lengths = new Map<string, number>();
  const counts = new Map<string, number>();
  const polygons: PolygonCandidate[] = [];
  const lines: LineCandidate[] = [];
  const map: MapCandidate[] = [];
  const shapeByFeature = new Map<number, FacilityShape>();
  let failed = 0;
  for (const h of hits) {
    const cls = classOf(h);
    const name = nameOf(h);
    // 기존 소비자에는 짧은 원천 이름만 남기고, 값은 새 sublabel 계약으로 보낸다.
    const legacyLabel = textValue(h.name) ?? name;
    const shape = shapeOf(h);
    const previousShape = shapeByFeature.get(h.featureId);
    if (previousShape && previousShape !== shape) continue;
    shapeByFeature.set(h.featureId, shape);
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
        const poly = polygonCandidate(h.featureId, layer, rings, polygonArea(rings), legacyLabel, {
          name,
          sublabel: formatAreaM2(polygonArea(rings)),
          labelPriority: name === null ? 0 : 1,
        });
        if (poly) polygons.push(poly);
      }
    } else if (shape === "line") {
      let length = 0;
      for (const path of clipLineToCircle(ctx.input.center, ctx.input.radiusM, h.geometry)) {
        const lengthM = linePathLength(path);
        const line = lineCandidate(h.featureId, layer, path, lengthM, legacyLabel, {
          name,
          sublabel: formatLengthM(lengthM),
          labelPriority: name === null ? 0 : 1,
        });
        if (!line) continue;
        length += line.lengthM;
        lines.push(line);
      }
      if (length <= 0) continue;
      lengths.set(cls, (lengths.get(cls) ?? 0) + length);
    } else {
      counts.set(cls, (counts.get(cls) ?? 0) + 1);
      map.push(candidate(h, layer, {
        label: legacyLabel,
        name,
        sublabel: null,
        labelPriority: name === null ? 0 : 1,
      }));
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
    ...areaClasses.map((cls) => `${cls} ${formatAreaM2(areas.get(cls)!)}`),
    ...lengthClasses.map((cls) => `${cls} ${formatLengthM(lengths.get(cls)!)}`),
    ...countClasses.map((cls) => `${cls} ${fmt(counts.get(cls)!)}개`),
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
    lines,
    limitations,
  });
}
