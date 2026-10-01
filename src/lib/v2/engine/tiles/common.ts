/** 타일 공통: 지표 생성기와 TileResult 조립. 결과는 항상 parseTileResult를 통과한다. */
import { toLngLat } from "../../crs";
import type { FeatureHit } from "../../data/features";
import { MAX_MAP_FEATURES, MAX_MAP_POLYGONS, MAX_POLYGON_VERTICES, parseTileResult, type MapFeature, type MapPolygon, type TileResult } from "../../tile-result";
import { layerStyle } from "../../ui/map-layers";
import { sourceName } from "../../ui/tile-catalog";
import type { EngineContext, Limitation, SourceRef } from "../context";
import { simplifyRing } from "./geo";

export const ENGINE_VERSION = "v2-p2-spatial-2";

type Metric = TileResult["metrics"][number];

export function obs(id: string, label: string, value: number, unit: string, formulaVersion: string, numerator: number | null = null, denominator: number | null = null): Metric {
  return { id, label, value, unit, formulaVersion, numerator, denominator, status: "observed" };
}
export function est(id: string, label: string, value: number, unit: string, formulaVersion: string, numerator: number | null = null, denominator: number | null = null): Metric {
  return { ...obs(id, label, value, unit, formulaVersion, numerator, denominator), status: "estimated" };
}
export function missing(id: string, label: string, unit: string, formulaVersion: string): Metric {
  return { id, label, value: null, unit, formulaVersion, numerator: null, denominator: null, status: "missing" };
}

export const roundM = (m: number) => Math.round(m);
export const nearestM = (distances: Array<number | null>): number | null => {
  const ds = distances.filter((d): d is number => d !== null);
  return ds.length ? roundM(Math.min(...ds)) : null;
};

// ── 지도 표시용 지물 ──
export type MapCandidate = { id: number; f: MapFeature };

/** 대표점(WGS84). 점은 그대로, 다른 도형은 좌표 범위의 중심. */
export function hitPoint(h: FeatureHit): [number, number] {
  const flat: number[][] = [];
  const walk = (c: unknown) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number") flat.push(c as number[]);
    else c.forEach(walk);
  };
  walk((h.geometry as { coordinates?: unknown }).coordinates);
  const xs = flat.map((p) => p[0]);
  const ys = flat.map((p) => p[1]);
  const [lng, lat] = toLngLat([(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]);
  return [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
}

export function candidate(h: FeatureHit, layer: string, extra: Partial<Omit<MapFeature, "layer" | "lng" | "lat">> = {}): MapCandidate {
  const [lng, lat] = hitPoint(h);
  return { id: h.featureId, f: { layer, lng, lat, ...extra } };
}

/** 거리 최소인 히트(같으면 featureId 작은 쪽). 거리 없는 히트는 제외. */
export function nearestHit<T extends FeatureHit>(hits: T[]): T | null {
  let best: T | null = null;
  for (const h of hits) {
    if (h.distanceM === null) continue;
    if (best === null || h.distanceM < best.distanceM! || (h.distanceM === best.distanceM && h.featureId < best.featureId)) best = h;
  }
  return best;
}

/** 상한을 넘으면 highlight는 모두 두고 나머지를 feature_id 순으로 등간격 추린다. 결정적. */
export function capFeatures(items: MapCandidate[]): { features: MapFeature[]; total: number } {
  const hl = items.filter((c) => c.f.highlight).sort((a, b) => a.id - b.id);
  const rest = items.filter((c) => !c.f.highlight).sort((a, b) => a.id - b.id);
  const keep = Math.max(0, MAX_MAP_FEATURES - hl.length);
  const picked = rest.length <= keep ? rest : Array.from({ length: keep }, (_, i) => rest[Math.floor((i * rest.length) / keep)]);
  return { features: [...picked, ...hl].map((c) => c.f), total: items.length };
}

// ── 면 지물 ──
export type PolygonCandidate = { id: number; areaM2: number; p: MapPolygon };

/** EPSG:5179 미터 폴리곤([바깥, 구멍…]) → 지도용 후보. 고리마다 200점 이하로 줄이고 WGS84로 바꾼다. */
export function polygonCandidate(id: number, layer: string, rings: number[][][], areaM2: number, label: string | null = null): PolygonCandidate | null {
  const out = rings
    .map((r) => simplifyRing(r, MAX_POLYGON_VERTICES))
    .filter((r) => r.length >= 4)
    .map((r) => r.map((xy) => { const [lng, lat] = toLngLat([xy[0], xy[1]]); return [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6] as [number, number]; }));
  return out.length === 0 || rings[0].length < 4 ? null : { id, areaM2, p: { layer, rings: out, label } };
}

/** 상한을 넘으면 면적이 큰 것부터 남긴다. 결정적. */
export function capPolygons(items: PolygonCandidate[]): { polygons: MapPolygon[]; total: number } {
  const sorted = [...items].sort((a, b) => b.areaM2 - a.areaM2 || a.id - b.id);
  return { polygons: sorted.slice(0, MAX_MAP_POLYGONS).map((c) => c.p), total: items.length };
}

export interface TileDraft {
  code: string;
  type?: TileResult["tileType"];
  status: TileResult["status"];
  metrics: Metric[];
  judgment?: TileResult["judgment"];
  sources: SourceRef[];
  limitations: Limitation[];
  layers?: string[];
  /** 지도에 그릴 지물 후보. 상한 처리·범례는 makeTile이 한다. */
  map?: MapCandidate[];
  /** 지도에 그릴 면 후보(선택). 같은 정보의 대표점은 map에 함께 넣어 면을 못 그리는 화면이 대신 쓴다. */
  polygons?: PolygonCandidate[];
}

export function makeTile(ctx: EngineContext, d: TileDraft): TileResult {
  const capped = d.map ? capFeatures(d.map) : null;
  const cappedPoly = d.polygons ? capPolygons(d.polygons) : null;
  const legendLayers = [...(capped?.features.map((f) => f.layer) ?? []), ...(cappedPoly?.polygons.map((p) => p.layer) ?? [])];
  const legend = [...new Set(legendLayers.map((l) => layerStyle(l).label))].map((label) => ({ label, min: null, max: null }));
  return parseTileResult({
    tileId: `${ctx.analysisId}-${d.code}`,
    analysisId: ctx.analysisId,
    tileType: d.type ?? "analysis",
    tileCode: d.code,
    status: d.status,
    engineVersion: ENGINE_VERSION,
    conditions: ctx.conditions,
    metrics: d.metrics,
    judgment: d.judgment ?? null,
    presentation: {
      legend,
      camera: null,
      layers: d.layers ?? [],
      outputFace: "front",
      ...(capped ? { features: capped.features, featuresTotal: capped.total } : {}),
      ...(cappedPoly && cappedPoly.total > 0 ? { polygons: cappedPoly.polygons, polygonsTotal: cappedPoly.total } : {}),
    },
    provenance: { manifestHash: ctx.manifestHash, sources: d.sources },
    limitations: d.limitations,
  });
}

/** 필요한 원천이 하나라도 적재돼 있지 않으면 자료 없음 타일 */
export function noDataTile(ctx: EngineContext, code: string, missingSources: string[]): TileResult {
  return makeTile(ctx, {
    code,
    status: "no_data",
    metrics: [],
    sources: [],
    limitations: [{ kind: "not_provided", note: `${missingSources.map(sourceName).join(", ")} 자료가 적재되지 않았습니다.` }],
  });
}

/** 한국어 ‘n곳’ 같은 단위 문장에 쓰는 천 단위 쉼표 */
export const fmt = (n: number) => n.toLocaleString("en-US");
