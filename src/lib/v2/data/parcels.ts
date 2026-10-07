/**
 * PNU(필지고유번호) 도우미. PNU = 법정동 10 + 산 구분(1 일반·2 산) + 본번 4 + 부번 4, 항상 문자열.
 */
import type BetterSqlite3 from "better-sqlite3";
import type { Geometry, Position } from "geojson";
import { booleanIntersects, booleanPointInPolygon, feature, point, polygon } from "@turf/turf";
import { toLngLat, toUtmk, type LngLat } from "../crs";
import { queryFeaturesInBboxes, type FeatureHit } from "./features";

type Db = BetterSqlite3.Database;

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

export function makePnu(legalCode: string, mountain: boolean, bun: string | number, ji: string | number): string | null {
  if (!/^\d{10}$/.test(legalCode)) return null;
  const b = typeof bun === "number" ? bun : /^\d+$/.test(String(bun).trim()) ? Number(bun) : NaN;
  const j = typeof ji === "number" ? ji : /^\d*$/.test(String(ji ?? "").trim()) ? Number(String(ji ?? "").trim() || 0) : NaN;
  if (!Number.isInteger(b) || !Number.isInteger(j) || b <= 0 || b > 9999 || j < 0 || j > 9999) return null;
  return `${legalCode}${mountain ? "2" : "1"}${String(b).padStart(4, "0")}${String(j).padStart(4, "0")}`;
}

const stmtCache = new WeakMap<Db, BetterSqlite3.Statement>();

export function lookupParcelPoint(db: Db, pnu: string): LngLat | null {
  let stmt = stmtCache.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT lng, lat FROM parcel_point WHERE pnu = ?");
    stmtCache.set(db, stmt);
  }
  const row = stmt.get(pnu) as { lng: number; lat: number } | undefined;
  return row ? [row.lng, row.lat] : null;
}

/** 여러 PNU의 대표점을 한 번에 읽는다. SQLite 변수 상한을 피하려고 500개씩 나눈다. */
export function lookupParcelPoints(db: Db, pnus: readonly string[]): Map<string, LngLat> {
  const out = new Map<string, LngLat>();
  const unique = [...new Set(pnus.filter((pnu) => pnu !== ""))];
  for (let offset = 0; offset < unique.length; offset += 500) {
    const batch = unique.slice(offset, offset + 500);
    const rows = db
      .prepare(`SELECT pnu, lng, lat FROM parcel_point WHERE pnu IN (${batch.map(() => "?").join(",")})`)
      .all(...batch) as Array<{ pnu: string; lng: number; lat: number }>;
    for (const row of rows) out.set(row.pnu, [row.lng, row.lat]);
  }
  return out;
}

export const MAX_PARCEL_BBOX_FEATURES = 1500;
export const MAX_PARCEL_BBOX_SPAN_DEG = 2;

export interface ParcelMapRecord {
  pnu: string;
  label: string;
  jimok: string | null;
  areaM2: number | null;
  geometry: Geometry;
}

export interface ParcelBboxResult {
  parcels: ParcelMapRecord[];
  truncated: boolean;
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

function eachPosition(coords: unknown, out: Position[] = []): Position[] {
  if (!Array.isArray(coords)) return out;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") out.push(coords as Position);
  else for (const child of coords) eachPosition(child, out);
  return out;
}

function fromUtmGeometry(geometry: Geometry): Geometry {
  const map = (coords: unknown): unknown => {
    if (!Array.isArray(coords)) return coords;
    if (typeof coords[0] === "number") {
      const [lng, lat] = toLngLat([coords[0] as number, coords[1] as number]);
      return [round6(lng), round6(lat)];
    }
    return coords.map(map);
  };
  if (geometry.type === "GeometryCollection") throw new TypeError("GeometryCollection is not supported");
  return { ...geometry, coordinates: map(geometry.coordinates) } as Geometry;
}

function parcelLabel(hit: FeatureHit): string {
  const jibun = hit.properties.jibun;
  if (typeof jibun === "string" && jibun.trim()) return jibun.trim();
  return hit.name?.trim() || hit.pnu || "지번 미상";
}

function parcelArea(hit: FeatureHit): number | null {
  for (const key of ["studyAreaM2", "ledgerAreaM2", "officialAreaM2", "landAreaM2", "areaM2"]) {
    const value = hit.properties[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return round6(value);
  }
  const area = polygonParts(hit.geometry).reduce((sum, rings) => sum + polygonArea(rings), 0);
  return area > 0 && Number.isFinite(area) ? round6(area) : null;
}

function toMapRecord(hit: FeatureHit): ParcelMapRecord | null {
  if (!hit.pnu) return null;
  const jimok = hit.properties.jimok;
  return {
    pnu: hit.pnu,
    label: parcelLabel(hit),
    jimok: typeof jimok === "string" && jimok.trim() ? jimok.trim() : null,
    areaM2: parcelArea(hit),
    geometry: fromUtmGeometry(hit.geometry),
  };
}

/** 지도 점 선택용 순수 조회. 점은 WGS84, 필지 도형은 EPSG:5179에 저장되어 있다. */
export function findParcelAt(db: Db, lng: number, lat: number): ParcelMapRecord | null {
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  const [x, y] = toUtmk([lng, lat]);
  const candidates = queryFeaturesInBboxes(db, [[x, y, x, y]], ["parcel"]);
  const selected = candidates.filter((hit) => {
    try { return booleanPointInPolygon(point([lng, lat]), fromUtmGeometry(hit.geometry) as never); } catch { return false; }
  }).sort((a, b) => (parcelArea(a) ?? Infinity) - (parcelArea(b) ?? Infinity) || a.featureId - b.featureId)[0];
  return selected ? toMapRecord(selected) : null;
}

export function validateParcelBbox(bounds: { w: number; s: number; e: number; n: number }): string | null {
  if (![bounds.w, bounds.s, bounds.e, bounds.n].every(Number.isFinite)) return "범위 좌표가 올바르지 않습니다";
  if (bounds.w < -180 || bounds.e > 180 || bounds.s < -90 || bounds.n > 90 || bounds.w >= bounds.e || bounds.s >= bounds.n) return "서쪽·남쪽은 동쪽·북쪽보다 작아야 합니다";
  if (bounds.e - bounds.w > MAX_PARCEL_BBOX_SPAN_DEG || bounds.n - bounds.s > MAX_PARCEL_BBOX_SPAN_DEG) return `조회 범위는 위도·경도 각각 ${MAX_PARCEL_BBOX_SPAN_DEG}도 이내여야 합니다`;
  return null;
}

function intersectsBbox(hit: FeatureHit, bboxFeature: ReturnType<typeof polygon>, bounds: [number, number, number, number]): boolean {
  try {
    if (booleanIntersects(feature(hit.geometry) as never, bboxFeature as never)) return true;
    const [minX, minY, maxX, maxY] = bounds;
    const corners: Array<[number, number]> = [[minX, minY], [minX, maxY], [maxX, minY], [maxX, maxY]];
    if (corners.some(([x, y]) => {
      const [lng, lat] = toLngLat([x, y]);
      return booleanPointInPolygon(point([lng, lat]), fromUtmGeometry(hit.geometry) as never);
    })) return true;
    if (hit.geometry.type === "GeometryCollection") return false;
    return eachPosition(hit.geometry.coordinates).some(([x, y]) => x >= minX && x <= maxX && y >= minY && y <= maxY);
  } catch {
    return false;
  }
}

/** 지도 bbox 순수 조회. 최대 1,500개를 반환하고 초과 여부를 별도 계약으로 보존한다. */
export function findParcelsInBbox(db: Db, bounds: { w: number; s: number; e: number; n: number }): ParcelBboxResult {
  const error = validateParcelBbox(bounds);
  if (error) throw new RangeError(error);
  const projected = [toUtmk([bounds.w, bounds.s]), toUtmk([bounds.w, bounds.n]), toUtmk([bounds.e, bounds.s]), toUtmk([bounds.e, bounds.n])];
  const minX = Math.min(...projected.map(([x]) => x));
  const maxX = Math.max(...projected.map(([x]) => x));
  const minY = Math.min(...projected.map(([, y]) => y));
  const maxY = Math.max(...projected.map(([, y]) => y));
  const bboxFeature = polygon([[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]]]);
  const hits = queryFeaturesInBboxes(db, [[minX, minY, maxX, maxY]], ["parcel"])
    .filter((hit) => intersectsBbox(hit, bboxFeature, [minX, minY, maxX, maxY]))
    .sort((a, b) => a.featureId - b.featureId);
  const records = hits.map(toMapRecord).filter((record): record is ParcelMapRecord => record !== null);
  return { parcels: records.slice(0, MAX_PARCEL_BBOX_FEATURES), truncated: records.length > MAX_PARCEL_BBOX_FEATURES };
}
