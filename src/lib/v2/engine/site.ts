/**
 * 입력(지번 주소 또는 좌표) → 분석 중심점. 도로명 주소는 받지 않는다(지번만).
 * 확신이 없으면 실패 이유를 돌려준다 — 비슷한 곳에 찍지 않는다.
 */
import type BetterSqlite3 from "better-sqlite3";
import { createHash } from "node:crypto";
import type { Geometry, MultiPolygon, Polygon } from "geojson";
import { booleanIntersects, booleanPointInPolygon, centroid, feature, featureCollection, kinks, pointOnFeature, union } from "@turf/turf";
import type { LngLat } from "../crs";
import { toLngLat, toUtmk } from "../crs";
import { queryFeaturesByPnus, type FeatureHit } from "../data/features";
import { resolveJibunDetailed } from "../data/jibun";
import { lookupParcelPoint } from "../data/parcels";
import { isRoadAddress, ROAD_ADDRESS_UNSUPPORTED_MESSAGE } from "../site";
import { canonicalJson } from "../canonical-json";
import { SITE_DEPENDENT_TILE_CODES } from "../tile/server";

export { SITE_DEPENDENT_TILE_CODES };

export type SiteKind = "address" | "parcels" | "polygon";
export type SiteGeometry = Polygon | MultiPolygon;

export interface EngineSite {
  pnus: string[];
  /** EPSG:5179. A legacy coordinate-only/address run may have no parcel geometry. */
  geometry: SiteGeometry | null;
  kind: SiteKind;
}

export type SiteFailure =
  | "parse_failed"
  | "not_found"
  | "ambiguous"
  | "no_point"
  | "road_address_unsupported"
  | "site_invalid"
  | "site_missing_pnu"
  | "site_disconnected"
  | "site_geometry_invalid"
  | "site_data_missing";
export type SiteResult =
  | { ok: true; center: LngLat; pnu: string | null; legalCode: string | null; jimok: string | null; label: string }
  | { ok: false; reason: SiteFailure };

export type SiteGeometryResult =
  | (Extract<SiteResult, { ok: true }> & { site: EngineSite; jimokList: string[] })
  | Extract<SiteResult, { ok: false }> & { missingPnus?: string[] };

const MIN_POLYGON_AREA_M2 = 100;
const MAX_POLYGON_AREA_M2 = 2_000_000;
const ADJACENCY_TOLERANCE_M = 0.5;

function polygonParts(geometry: Geometry): number[][][][] {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function polygonArea(rings: number[][][]): number {
  const ringArea = (ring: number[][]) => Math.abs(ring.reduce((sum, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0)) / 2;
  return rings.reduce((sum, ring, index) => sum + (index === 0 ? ringArea(ring) : -ringArea(ring)), 0);
}

function isSiteGeometry(value: unknown): value is SiteGeometry {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return type === "Polygon" || type === "MultiPolygon";
}

function segmentDistance(a: number[], b: number[], c: number[], d: number[]): number {
  const pointToSegment = (p: number[], u: number[], v: number[]) => {
    const dx = v[0] - u[0];
    const dy = v[1] - u[1];
    const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - u[0]) * dx + (p[1] - u[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p[0] - (u[0] + t * dx), p[1] - (u[1] + t * dy));
  };
  const cross = (u: number[], v: number[], w: number[]) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  const intersects = (u: number[], v: number[], w: number[], x: number[]) => {
    const a1 = cross(u, v, w);
    const a2 = cross(u, v, x);
    const a3 = cross(w, x, u);
    const a4 = cross(w, x, v);
    const on = (p: number[], q: number[], r: number[]) => Math.abs(cross(p, q, r)) <= 1e-7
      && r[0] >= Math.min(p[0], q[0]) - 1e-7 && r[0] <= Math.max(p[0], q[0]) + 1e-7
      && r[1] >= Math.min(p[1], q[1]) - 1e-7 && r[1] <= Math.max(p[1], q[1]) + 1e-7;
    return (a1 === 0 ? on(u, v, w) : false) || (a2 === 0 ? on(u, v, x) : false) || (a3 === 0 ? on(w, x, u) : false) || (a4 === 0 ? on(w, x, v) : false)
      || ((a1 > 0) !== (a2 > 0) && (a3 > 0) !== (a4 > 0));
  };
  if (intersects(a, b, c, d)) return 0;
  return Math.min(pointToSegment(a, c, d), pointToSegment(b, c, d), pointToSegment(c, a, b), pointToSegment(d, a, b));
}

function ringsOf(geometry: Geometry): number[][][] {
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

function geometryDistanceM(a: Geometry, b: Geometry): number {
  let best = Infinity;
  for (const ar of ringsOf(a)) {
    for (const br of ringsOf(b)) {
      for (let i = 1; i < ar.length; i++) {
        for (let j = 1; j < br.length; j++) {
          best = Math.min(best, segmentDistance(ar[i - 1], ar[i], br[j - 1], br[j]));
          if (best <= ADJACENCY_TOLERANCE_M) return best;
        }
      }
    }
  }
  return best;
}

function adjacent(a: FeatureHit, b: FeatureHit): boolean {
  try {
    if (booleanIntersects(feature(a.geometry as Polygon | MultiPolygon) as never, feature(b.geometry as Polygon | MultiPolygon) as never)) return true;
  } catch {
    // The exact edge-distance fallback below is authoritative for near-touching parcels.
  }
  try {
    if (geometryDistanceM(a.geometry, b.geometry) <= ADJACENCY_TOLERANCE_M) return true;
  } catch {
    return false;
  }
  return false;
}

function connected(hits: FeatureHit[]): boolean {
  if (hits.length <= 1) return true;
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length) {
    const i = queue.shift()!;
    for (let j = 0; j < hits.length; j++) {
      if (seen.has(j) || !adjacent(hits[i], hits[j])) continue;
      seen.add(j);
      queue.push(j);
    }
  }
  return seen.size === hits.length;
}

function jimokOf(hit: FeatureHit): string | null {
  const value = hit.properties.jimok;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function jibunOf(hit: FeatureHit): string | null {
  const value = hit.properties.jibun;
  return typeof value === "string" && value.trim() ? value.trim() : hit.name?.trim() || hit.pnu;
}

function areaOf(hit: FeatureHit): number {
  const geometryArea = polygonParts(hit.geometry).reduce((sum, rings) => sum + polygonArea(rings), 0);
  if (geometryArea > 0 && Number.isFinite(geometryArea)) return geometryArea;
  const propertyArea = hit.properties.areaM2;
  return typeof propertyArea === "number" && Number.isFinite(propertyArea) ? propertyArea : 0;
}

function centerOfGeometry(geometry: SiteGeometry): LngLat | null {
  try {
    const projected = feature(geometry);
    const candidate = centroid(projected as never);
    if (booleanPointInPolygon(candidate as never, projected as never)) return toLngLat([candidate.geometry.coordinates[0], candidate.geometry.coordinates[1]]);
    const inside = pointOnFeature(projected as never);
    return toLngLat([inside.geometry.coordinates[0], inside.geometry.coordinates[1]]);
  } catch {
    return null;
  }
}

function projectPolygonInput(polygonInput: readonly [number, number][]): SiteGeometryResult | SiteGeometry {
  const points = polygonInput.map(([lng, lat]) => toUtmk([lng, lat]));
  const ring = points.map(([x, y]) => [x, y] as [number, number]);
  if (ring.length < 4 || ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]) return { ok: false, reason: "site_invalid" };
  const geometry: Polygon = { type: "Polygon", coordinates: [ring] };
  try {
    if (kinks(feature(geometry) as never).features.length > 0) return { ok: false, reason: "site_geometry_invalid" };
  } catch {
    return { ok: false, reason: "site_geometry_invalid" };
  }
  const areaM2 = polygonArea([ring]);
  if (!Number.isFinite(areaM2) || areaM2 < MIN_POLYGON_AREA_M2 || areaM2 > MAX_POLYGON_AREA_M2) return { ok: false, reason: "site_geometry_invalid" };
  return geometry;
}

/** site geometry + sorted PNU의 정규화 해시. 좌표는 1mm로 반올림해 동일 대지 재요청을 안정적으로 적중시킨다. */
export function siteSnapshotHash(site: EngineSite | null | undefined): string | null {
  if (!site || (site.pnus.length === 0 && site.geometry === null)) return null;
  const round = (value: unknown): unknown => {
    if (typeof value === "number") return Math.round(value * 1000) / 1000;
    if (Array.isArray(value)) return value.map(round);
    return value;
  };
  const normalized = site.geometry ? { type: site.geometry.type, coordinates: round(site.geometry.coordinates) } : null;
  return createHash("sha256").update(canonicalJson({ revision: "site-geometry-r1", pnus: [...new Set(site.pnus)].sort(), geometry: normalized }), "utf8").digest("hex");
}

/** 저장된 parameters.site를 복원한다. 옛 저장 run은 pnu 하나만 읽어 주소 대지로 승격한다. */
export function restoreSiteFromParameters(parameters: Record<string, unknown>): EngineSite {
  const raw = parameters.site;
  if (raw && typeof raw === "object") {
    const value = raw as { pnus?: unknown; geometry?: unknown; kind?: unknown };
    const pnus = Array.isArray(value.pnus) ? value.pnus.filter((pnu): pnu is string => typeof pnu === "string" && pnu.trim() !== "") : [];
    const kind = value.kind === "parcels" || value.kind === "polygon" || value.kind === "address" ? value.kind : "address";
    const geometry = isSiteGeometry(value.geometry) ? value.geometry : null;
    if (pnus.length > 0 || geometry) return { pnus, geometry, kind };
  }
  const legacy = typeof parameters.pnu === "string" && parameters.pnu.trim() ? parameters.pnu.trim() : null;
  return { pnus: legacy ? [legacy] : [], geometry: null, kind: "address" };
}

/** API/직접 호출 경로의 대지 확정. 주소 경로의 old resolveSite 계약은 별도로 보존한다. */
export function resolveSiteGeometry(
  core: BetterSqlite3.Database,
  parcelsDb: BetterSqlite3.Database | null,
  input: { address?: string; center?: LngLat; site?: { pnus?: readonly string[]; polygon?: readonly [number, number][] } },
): SiteGeometryResult {
  if (input.site !== undefined) {
    const requestedPnus = input.site.pnus;
    const polygonInput = input.site.polygon;
    if ((requestedPnus !== undefined && polygonInput !== undefined) || (requestedPnus === undefined && polygonInput === undefined)) return { ok: false, reason: "site_invalid" };
    if (requestedPnus !== undefined) {
      const pnus = requestedPnus.map((pnu) => pnu.trim());
      if (pnus.length < 1 || pnus.length > 30 || pnus.some((pnu) => !/^\d{19}$/.test(pnu)) || new Set(pnus).size !== pnus.length) return { ok: false, reason: "site_invalid" };
      if (!parcelsDb) return { ok: false, reason: "site_data_missing", missingPnus: pnus };
      const hits = queryFeaturesByPnus(parcelsDb, pnus);
      const found = new Set(hits.map((hit) => hit.pnu).filter((pnu): pnu is string => pnu !== null));
      const missingPnus = pnus.filter((pnu) => !found.has(pnu));
      if (missingPnus.length > 0) return { ok: false, reason: "site_missing_pnu", missingPnus };
      if (!connected(hits)) return { ok: false, reason: "site_disconnected" };
      let geometry: SiteGeometry | null = null;
      try {
        // Turf 7의 union은 두 개 이상의 도형만 받는다. 단일 필지는
        // 합집합 호출 없이 원래 도형을 그대로 보존한다.
        if (hits.length === 1) {
          geometry = hits[0].geometry as SiteGeometry;
        } else {
          const merged = union(featureCollection(hits.map((hit) => feature(hit.geometry as Polygon | MultiPolygon))) as never);
          geometry = merged?.geometry as SiteGeometry | undefined ?? null;
        }
      } catch {
        geometry = null;
      }
      if (!geometry) return { ok: false, reason: "site_geometry_invalid" };
      const representative = [...hits].sort((a, b) => areaOf(b) - areaOf(a) || a.featureId - b.featureId)[0];
      const center = centerOfGeometry(geometry);
      if (!center) return { ok: false, reason: "site_geometry_invalid" };
      const jimokList = [...new Set(hits.map(jimokOf).filter((value): value is string => value !== null))];
      const jibun = jibunOf(representative) ?? representative.pnu ?? "선택 필지";
      // 지번만으로는 어느 동인지 알 수 없으므로 시군구·읍면동 이름을 붙인다("서울특별시 강동구 고덕동 249").
      const areaName = (code: string) => core.prepare("SELECT name FROM legal_area WHERE code = ?").pluck().get(code) as string | undefined;
      const repPnu = representative.pnu ?? "";
      const place = /^\d{19}$/.test(repPnu) ? [areaName(repPnu.slice(0, 5)), areaName(repPnu.slice(0, 8)), repPnu.slice(8, 10) !== "00" ? areaName(repPnu.slice(0, 10)) : undefined].filter(Boolean).join(" ") : "";
      const baseLabel = place && /^\d|^산/.test(jibun) ? `${place} ${jibun}` : jibun;
      return {
        ok: true,
        center,
        pnu: representative.pnu,
        legalCode: representative.legalCode ?? (typeof representative.properties.legalCode === "string" ? representative.properties.legalCode : null),
        jimok: jimokOf(representative),
        label: hits.length > 1 ? `${baseLabel} 외 ${hits.length - 1}필지` : baseLabel,
        site: { pnus, geometry, kind: "parcels" },
        jimokList,
      };
    }
    if (!Array.isArray(polygonInput) || polygonInput.length < 4 || polygonInput.length > 501) return { ok: false, reason: "site_invalid" };
    const uniqueVertices = polygonInput.slice(0, -1).map(([lng, lat]) => `${lng},${lat}`);
    if (new Set(uniqueVertices).size < 3) return { ok: false, reason: "site_invalid" };
    const projected = projectPolygonInput(polygonInput);
    if ("ok" in projected && projected.ok === false) return projected;
    const geometry = projected as SiteGeometry;
    const center = centerOfGeometry(geometry);
    if (!center) return { ok: false, reason: "site_geometry_invalid" };
    return { ok: true, center, pnu: null, legalCode: null, jimok: null, label: "직접 그린 구역", site: { pnus: [], geometry, kind: "polygon" }, jimokList: [] };
  }

  const resolved = resolveSite(core, input);
  if (!resolved.ok) return resolved;
  let geometry: SiteGeometry | null = null;
  if (resolved.pnu && parcelsDb) geometry = (queryFeaturesByPnus(parcelsDb, [resolved.pnu])[0]?.geometry as SiteGeometry | undefined) ?? null;
  const jimokList = resolved.jimok ? [resolved.jimok] : [];
  return { ...resolved, site: { pnus: resolved.pnu ? [resolved.pnu] : [], geometry, kind: "address" }, jimokList };
}

export function resolveSite(core: BetterSqlite3.Database, input: { address?: string; center?: LngLat }): SiteResult {
  const address = input.address?.trim().replace(/\s+/g, " ") ?? "";
  if (input.center) {
    const [lng, lat] = input.center;
    return { ok: true, center: [lng, lat], pnu: null, legalCode: null, jimok: null, label: address || `좌표 ${lng.toFixed(5)}, ${lat.toFixed(5)}` };
  }
  if (!address) return { ok: false, reason: "parse_failed" };
  if (isRoadAddress(address)) return { ok: false, reason: "road_address_unsupported" };
  const r = resolveJibunDetailed(core, address);
  if ("reason" in r) return { ok: false, reason: r.reason };
  const point = lookupParcelPoint(core, r.pnu);
  if (!point) return { ok: false, reason: "no_point" };
  const jimok = core.prepare("SELECT jimok FROM parcel_point WHERE pnu = ?").pluck().get(r.pnu) as string | null | undefined;
  return { ok: true, center: point, pnu: r.pnu, legalCode: r.legalCode, jimok: jimok ?? null, label: address };
}

/** 화면에 그대로 보여 줄 안내 문구 */
export const SITE_FAILURE_MESSAGE: Record<SiteFailure, string> = {
  road_address_unsupported: ROAD_ADDRESS_UNSUPPORTED_MESSAGE,
  parse_failed: "지번 주소로 입력해 주세요. 예: 서울 강동구 고덕동 123",
  not_found: "주소를 찾지 못했습니다. 시·도, 시·군·구, 동·리 이름을 확인해 주세요.",
  ambiguous: "동·리까지 입력해 주세요.",
  no_point: "필지 위치 미확보 — 이 필지의 위치 자료가 아직 적재되지 않았습니다.",
  site_invalid: "대지 선택 입력이 올바르지 않습니다. 필지 목록 또는 닫힌 다각형 하나만 입력해 주세요.",
  site_missing_pnu: "선택한 필지 도형을 찾지 못했습니다.",
  site_disconnected: "선택한 필지가 붙어 있지 않습니다. 서로 맞닿은 필지만 선택해 주세요.",
  site_geometry_invalid: "대지 도형이 유효하지 않습니다. 자기교차가 없고 100㎡~200만㎡인 구역을 입력해 주세요.",
  site_data_missing: "필지 도형 자료가 아직 게시되지 않았습니다.",
};
