/** 타일 공통: 지표 생성기와 TileResult 조립. 결과는 항상 parseTileResult를 통과한다. */
import { toLngLat } from "../../crs";
import type { FeatureHit } from "../../data/features";
import { MAX_LINE_VERTICES, MAX_MAP_FEATURES, MAX_MAP_LINES, MAX_MAP_POLYGONS, MAX_POLYGON_VERTICES, parseTileResult, type MapFeature, type MapLine, type MapPolygon, type TileResult } from "../../tile-result";
import { layerStyle } from "../../ui/map-layers";
import { isSiteParcelLayer } from "../../ui/site-parcel";
import { sourceName } from "../../ui/tile-catalog";
import type { EngineContext, Limitation, SourceRef } from "../context";
import { simplifyRing } from "./geo";
import { maxOf, minOf } from "../../extent";

export const ENGINE_VERSION = "v2-p4-ext-1";

/**
 * Per-tile cache revision: bumping one entry invalidates only that tile's cross-analysis cache (the cache key mixes
 * the engine version in) without touching the other tiles' cached results or the global ENGINE_VERSION pinned by tests.
 * s04-r2: raster u8 scale 0.5/offset -50, 10 UTCI classes, wind clamped to 0.5–17 m/s, S03 solid-halo fix.
 */
const TILE_CACHE_REVISION: Readonly<Record<string, string>> = {
  // site-r1 is carried by conditions.parcelSnapshotHash/cacheKeyFor. Keep the
  // public per-tile engine version contract unchanged for existing consumers.
  A01: "w3-merge-r1+w2b-r1+w3-r1+entrance-color-r1+transit-presentation-r1+rail-data-r3",
  A02: "w3-merge-r1+w2b-r1+clip-r1+chart-count-r1",
  A03: "w2b-r1+composition-r1",
  A04: "w3-merge-r1+w2b-r1+clip-r1",
  A05: "w2b-r1+composition-r1+chart-count-r1",
  A06: "w2b-r1+composition-r1",
  A07: "w3-merge-r1+w2b-r1+w2-trade-modes-r1+price-size-r1+chart-value-r1+chart-count-r1",
  A08: "w2b-r1+w2-trade-modes-r1+w6-building-modes-r1",
  A09: "w3-merge-r1+w2b-r1+clip-r1+chart-count-r1",
  A10: "w3-merge-r1+w2b-r1",
  A11: "w3-merge-r1+w2b-r1+clip-r1",
  A12: "w3-merge-r1+w2b-r1+clip-r1+provenance-r1",
  D02: "w2b-r1+w4-names-r1+clip-r1",
  D03: "w2b-r1+w4-names-r1+clip-r1+chart-count-r1",
  D04: "w2b-r1+w4-names-r1+clip-r1+chart-value-r1",
  D05: "height3-r1+w3-merge-r1+w2b-r1+w4-names-r1+d05-nearest-cap-r1+clip-r1+chart-value-r1",
  D10: "w2b-r1+clip-r1+composition-r1",
  D11: "w2b-r1+clip-r1",
  D12: "w2b-r1+clip-r1+chart-count-r2",
  D13: "w2b-r1",
  D15: "w2b-r1+clip-r1+chart-count-r1",
  D16: "height3-r1+w2b-r1+clip-r1",
  D17: "w2b-r1+clip-r1+terrain-section-r1",
  D18: "w2b-r1+clip-r1",
  D19: "w3-merge-r1+w2b-r1+clip-r1",
  D28: "w2b-r1+clip-r1+composition-r1",
  D29: "height3-r1+w2b-r1+w4-names-r1",
  S01: "height3-r1+w3-r1+composition-r1",
  S02: "height3-r1+w3-merge-r1+w3-r1+provenance-r1",
  S03: "height3-r1+w2b-r1",
  S04: "s04-r2+height3-r1+w2b-r1+clip-r1+provenance-r1",
};
// A topo-free analysis must retain its historical cache key byte-for-byte. D17
// has a second representation only when the analysis carries topo data, so the
// new revision is selected by cacheKeyForConditions rather than globally.
const NO_TOPO_CACHE_REVISION: Readonly<Record<string, string>> = {
  D17: "w2b-r1+clip-r1",
};
export const cacheEngineVersion = (code: string, base: string = ENGINE_VERSION, hasTopo = true): string => {
  const revision = hasTopo ? TILE_CACHE_REVISION[code] : (NO_TOPO_CACHE_REVISION[code] ?? TILE_CACHE_REVISION[code]);
  return revision ? `${base}+${revision}` : base;
};

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
  return ds.length ? roundM(minOf(ds)) : null;
};

// ── 지도 표시용 지물 ──
export type MapCandidate = { id: number; f: MapFeature };

const hitPointCache = new WeakMap<FeatureHit, [number, number]>();

/** 대표점(WGS84). 점은 그대로, 다른 도형은 좌표 범위의 중심. */
export function hitPoint(h: FeatureHit): [number, number] {
  const cached = hitPointCache.get(h);
  if (cached) return [cached[0], cached[1]];
  const flat: number[][] = [];
  const walk = (c: unknown) => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number") flat.push(c as number[]);
    else c.forEach(walk);
  };
  walk((h.geometry as { coordinates?: unknown }).coordinates);
  const xs = flat.map((p) => p[0]);
  const ys = flat.map((p) => p[1]);
  const [lng, lat] = toLngLat([(minOf(xs) + maxOf(xs)) / 2, (minOf(ys) + maxOf(ys)) / 2]);
  const value: [number, number] = [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
  hitPointCache.set(h, value);
  return [value[0], value[1]];
}

export function candidate(h: FeatureHit, layer: string, extra: Partial<Omit<MapFeature, "layer" | "lng" | "lat">> = {}): MapCandidate {
  const [lng, lat] = hitPoint(h);
  return { id: h.featureId, f: { layer, lng, lat, name: h.name ?? null, ...extra } };
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
  return { features: [...picked, ...hl].map((c) => ({ ...c.f, fid: c.f.fid ?? String(c.id) })), total: items.length };
}

// ── 면 지물 ──
export type PolygonCandidate = { id: number; areaM2: number; p: MapPolygon };

const polygonRingCache = new WeakMap<number[][], Array<[number, number]>>();

function projectedRing(ring: number[][]): Array<[number, number]> {
  const cached = polygonRingCache.get(ring);
  if (cached) return cached;
  const value = simplifyRing(ring, MAX_POLYGON_VERTICES).map((xy) => {
    const [lng, lat] = toLngLat([xy[0], xy[1]]);
    return [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6] as [number, number];
  });
  polygonRingCache.set(ring, value);
  return value;
}

/** EPSG:5179 미터 폴리곤([바깥, 구멍…]) → 지도용 후보. 고리마다 200점 이하로 줄이고 WGS84로 바꾼다. */
export function polygonCandidate(id: number, layer: string, rings: number[][][], areaM2: number, label: string | null = null, extra: Partial<Omit<MapPolygon, "layer" | "rings">> = {}): PolygonCandidate | null {
  const out = rings
    .map((r) => projectedRing(r))
    .filter((r) => r.length >= 4)
    .map((r) => r);
  return out.length === 0 || rings[0].length < 4 ? null : { id, areaM2, p: { layer, rings: out, label, ...extra } };
}

function d05CandidateBuildingKey(candidate: PolygonCandidate): string {
  const fid = candidate.p.fid?.trim() ?? "";
  if (/^-?\d+$/.test(fid)) return `feature:${Math.floor(Number(fid) / 1000)}`;
  if (Number.isFinite(candidate.id)) return `feature:${Math.floor(candidate.id / 1000)}`;
  return `fid:${fid || candidate.p.rings[0]?.[0]?.join(",") || candidate.id}`;
}

/** WGS84 외곽 고리 꼭짓점 평균을 쓰는 D05용 대표점 거리(m). */
export function d05RepresentativeDistanceM(center: readonly [number, number], polygon: MapPolygon): number {
  const ring = polygon.rings[0] ?? [];
  const points = ring.length > 1 && ring[0]?.[0] === ring.at(-1)?.[0] && ring[0]?.[1] === ring.at(-1)?.[1] ? ring.slice(0, -1) : ring;
  if (points.length === 0) return Number.POSITIVE_INFINITY;
  const [lng, lat] = points.reduce(([lngSum, latSum], [pointLng, pointLat]) => [lngSum + pointLng, latSum + pointLat], [0, 0]).map((value) => value / points.length) as [number, number];
  const latScaleM = 110_540;
  const lngScaleM = 111_320 * Math.cos((center[1] * Math.PI) / 180);
  return Math.hypot((lng - center[0]) * lngScaleM, (lat - center[1]) * latScaleM);
}

/** D05 원본 타일도 병합 전 면적순 삭제가 아니라 가까운 건물 단위로만 줄인다. */
export function capD05BuildingCandidates(items: PolygonCandidate[], center: readonly [number, number], max = MAX_MAP_POLYGONS): PolygonCandidate[] {
  const groups = new Map<string, { candidate: PolygonCandidate; first: number; distanceM: number }>();
  items.forEach((candidate, index) => {
    const key = d05CandidateBuildingKey(candidate);
    if (groups.has(key)) return;
    groups.set(key, { candidate, first: index, distanceM: d05RepresentativeDistanceM(center, candidate.p) });
  });
  const selected = [...groups.entries()]
    .sort(([, a], [, b]) => a.distanceM - b.distanceM || a.first - b.first)
    .slice(0, max)
    .map(([key]) => key);
  const selectedKeys = new Set(selected);
  return items.filter((candidate, index) => {
    const key = d05CandidateBuildingKey(candidate);
    const group = groups.get(key);
    return selectedKeys.has(key) && group?.first === index;
  });
}

/** 상한을 넘으면 면적이 큰 것부터 남긴다. 결정적. 일반 타일 기본값은 3,000이다. */
export function capPolygons(items: PolygonCandidate[], max = MAX_MAP_POLYGONS): { polygons: MapPolygon[]; total: number } {
  const sorted = [...items].sort((a, b) => Number(isSiteParcelLayer(b.p.layer)) - Number(isSiteParcelLayer(a.p.layer)) || b.areaM2 - a.areaM2 || a.id - b.id);
  return { polygons: sorted.slice(0, max).map((c) => ({ ...c.p, fid: c.p.fid ?? String(c.id) })), total: items.length };
}

// ── 선 지물 ──
export type LineCandidate = { id: number; lengthM: number; l: MapLine };

const pointSegmentDistance = (p: number[], a: number[], b: number[]) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};

/** 열린 선의 끝점을 보존하는 Douglas–Peucker 단순화. */
function simplifyOpenLine(points: number[][], maxVertices: number): number[][] {
  if (points.length <= maxVertices) return points;
  const keepAt = (tolerance: number): number[] => {
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack: Array<[number, number]> = [[0, points.length - 1]];
    while (stack.length > 0) {
      const [from, to] = stack.pop()!;
      let far = -1;
      let farDistance = tolerance;
      for (let i = from + 1; i < to; i++) {
        const distance = pointSegmentDistance(points[i], points[from], points[to]);
        if (distance > farDistance) {
          farDistance = distance;
          far = i;
        }
      }
      if (far >= 0) {
        keep[far] = 1;
        stack.push([from, far], [far, to]);
      }
    }
    return Array.from(keep.keys()).filter((i) => keep[i] === 1);
  };

  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  let low = 0;
  let high = Math.hypot(maxOf(xs) - minOf(xs), maxOf(ys) - minOf(ys));
  for (let i = 0; i < 40; i++) {
    const middle = (low + high) / 2;
    if (keepAt(middle).length <= maxVertices) high = middle;
    else low = middle;
  }
  let indexes = keepAt(high);
  if (indexes.length > maxVertices) {
    indexes = Array.from({ length: maxVertices }, (_, i) => Math.round((i * (points.length - 1)) / (maxVertices - 1)));
  }
  return indexes.map((i) => points[i]);
}

/** EPSG:5179 열린 선형 → 지도용 선. 200점을 넘으면 끝점을 보존해 단순화한다. */
export function lineCandidate(id: number, layer: string, pathM: number[][], lengthM: number, label?: string | null, extra: Partial<Omit<MapLine, "layer" | "points">> = {}): LineCandidate | null {
  if (pathM.length < 2 || pathM.some((point) => point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) return null;
  const points = simplifyOpenLine(pathM, MAX_LINE_VERTICES).map((point) => {
    const [lng, lat] = toLngLat([point[0], point[1]]);
    return [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6] as [number, number];
  });
  return { id, lengthM, l: { layer, points, label: label ?? null, ...extra } };
}

/** 상한을 넘으면 긴 선부터 남긴다. 결정적. */
export function capLines(items: LineCandidate[]): { lines: MapLine[]; total: number } {
  const sorted = [...items].sort((a, b) => (b.l.capPriority ?? 0) - (a.l.capPriority ?? 0) || b.lengthM - a.lengthM || a.id - b.id);
  return { lines: sorted.slice(0, MAX_MAP_LINES).map((candidate) => ({ ...candidate.l, fid: candidate.l.fid ?? String(candidate.id) })), total: items.length };
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
  /** 면 후보의 타일 전용 상한. 생략하면 일반 타일 상한 3,000을 쓴다. */
  polygonCap?: number;
  /** 원본 후보를 D05 최근접 사전 선택으로 줄였을 때의 선택 전 개수. */
  polygonTotal?: number;
  /** 지도에 그릴 선 후보(선택). 상한 처리·범례는 makeTile이 한다. */
  lines?: LineCandidate[];
  /** 타일이 값·범주까지 완성한 범례. 없으면 현재 레이어의 기본 범례를 만든다. */
  legend?: TileResult["presentation"]["legend"];
  /** D17 수치지형도 단면. topo가 없는 결과에는 생략한다. */
  terrainSections?: NonNullable<TileResult["presentation"]["terrainSections"]>;
  /** 지물 `value`의 뜻(그래프 축). 값을 싣는 타일만 둔다. */
  valueAxis?: TileResult["presentation"]["valueAxis"];
}

function warnOverlappingFeatureGeometry(code: string, features: MapFeature[], polygons: MapPolygon[]): void {
  const pointFids = new Set(features.map((feature) => feature.fid).filter((fid): fid is string => !!fid));
  const overlaps = [...new Set(polygons.map((polygon) => polygon.fid).filter((fid): fid is string => !!fid && pointFids.has(fid)))];
  if (overlaps.length > 0) console.warn(`[v2 map] ${code}: 같은 fid의 점+면이 함께 들어왔습니다: ${overlaps.join(", ")}`);
}

export function makeTile(ctx: EngineContext, d: TileDraft): TileResult {
  const capped = d.map ? capFeatures(d.map) : null;
  const cappedPoly = d.polygons ? capPolygons(d.polygons, d.polygonCap) : null;
  const cappedLine = d.lines ? capLines(d.lines) : null;
  warnOverlappingFeatureGeometry(d.code, capped?.features ?? [], cappedPoly?.polygons ?? []);
  const legendLabels = [
    ...(capped?.features.map((feature) => layerStyle(feature.layer).label) ?? []),
    ...(cappedPoly?.polygons.map((polygon) => layerStyle(polygon.layer).label) ?? []),
    ...(cappedLine?.lines.flatMap((line) => line.legendLabel ? [line.legendLabel] : [layerStyle(line.layer).label]) ?? []),
  ];
  const legend = d.legend ?? [...new Set(legendLabels)].map((label) => ({ label, min: null, max: null }));
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
      ...(cappedPoly && cappedPoly.total > 0 ? { polygons: cappedPoly.polygons, polygonsTotal: d.polygonTotal ?? cappedPoly.total } : {}),
      ...(cappedLine && cappedLine.total > 0 ? { lines: cappedLine.lines, linesTotal: cappedLine.total } : {}),
      ...(d.terrainSections ? { terrainSections: d.terrainSections } : {}),
      ...(d.valueAxis ? { valueAxis: d.valueAxis } : {}),
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
    limitations: [{ kind: "not_provided", note: `${missingSources.map(sourceName).join(", ")} 자료를 확인할 수 없습니다.` }],
  });
}

/** 한국어 ‘n곳’ 같은 단위 문장에 쓰는 천 단위 쉼표 */
export const fmt = (n: number) => n.toLocaleString("en-US");
