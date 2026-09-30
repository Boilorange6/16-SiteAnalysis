/**
 * 공간 객체 적재·반경 조회 (spec §3.3).
 * R*Tree로 bbox 후보를 추린 뒤 원과의 실제 교차를 판정한다.
 * 저장·반환 도형은 EPSG:5179 미터 좌표다.
 */
import type BetterSqlite3 from "better-sqlite3";
import type { Geometry, Position } from "geojson";
import { booleanIntersects, polygon } from "@turf/turf";
import { toUtmk, type LngLat } from "../crs";

type Db = BetterSqlite3.Database;

export const MAX_RADIUS_M = 5000;
const CIRCLE_SEGMENTS = 64;

export interface FeatureInput {
  stableId: string;
  kind: string;
  sourceKey: string;
  releaseId: string;
  /** WGS84 경위도 */
  geometry: Geometry;
  name?: string | null;
  pnu?: string | null;
  legalCode?: string | null;
  properties?: Record<string, unknown>;
  /** 저장 좌표(EPSG:5179 미터)를 소수 이 자리까지 반올림. 생략하면 그대로(수천만 건 도형의 파일 크기용) */
  coordDecimals?: number;
}

export interface FeatureHit {
  featureId: number;
  stableId: string;
  kind: string;
  releaseId: string;
  name: string | null;
  pnu: string | null;
  legalCode: string | null;
  properties: Record<string, unknown>;
  /** EPSG:5179 미터 좌표 */
  geometry: Geometry;
  /** Point/MultiPoint만 값이 있다 */
  distanceM: number | null;
}

function mapPositions(coords: unknown, fn: (p: LngLat) => readonly [number, number]): unknown {
  if (!Array.isArray(coords)) throw new TypeError("invalid coordinates");
  if (typeof coords[0] === "number") return [...fn([coords[0] as number, coords[1] as number])];
  return coords.map((c) => mapPositions(c, fn));
}

function* positions(coords: unknown): Generator<Position> {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number") {
    yield coords as Position;
    return;
  }
  for (const c of coords) yield* positions(c);
}

export function projectGeometry(geometry: Geometry): Geometry {
  if (geometry.type === "GeometryCollection") throw new TypeError("GeometryCollection is not supported");
  return { type: geometry.type, coordinates: mapPositions(geometry.coordinates, toUtmk) } as Geometry;
}

function bboxOf(geometry: Geometry): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  if (geometry.type === "GeometryCollection") throw new TypeError("GeometryCollection is not supported");
  for (const [x, y] of positions(geometry.coordinates)) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError("non-finite coordinate");
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (minX === Infinity) throw new TypeError("empty geometry");
  return [minX, minY, maxX, maxY];
}

export function insertFeature(db: Db, input: FeatureInput): number {
  for (const [field, value] of [["pnu", input.pnu], ["legalCode", input.legalCode]] as const) {
    if (value != null && typeof value !== "string") throw new TypeError(`${field} must be a string (got ${typeof value})`);
  }
  let projected = projectGeometry(input.geometry);
  if (input.coordDecimals !== undefined) {
    const k = 10 ** input.coordDecimals;
    projected = { type: projected.type, coordinates: mapPositions((projected as { coordinates: unknown }).coordinates, ([x, y]) => [Math.round(x * k) / k, Math.round(y * k) / k]) } as Geometry;
  }
  const [minX, minY, maxX, maxY] = bboxOf(projected);
  return db.transaction(() => {
  const info = db
    .prepare(`INSERT INTO feature (stable_id, kind, source_key, release_id, geom_json, name, pnu, legal_code, properties_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      input.stableId, input.kind, input.sourceKey, input.releaseId, JSON.stringify(projected),
      input.name ?? null, input.pnu ?? null, input.legalCode ?? null, JSON.stringify(input.properties ?? {}),
    );
  const featureId = Number(info.lastInsertRowid);
  // SQLite R*Tree는 32비트 실수로 저장하되 바깥쪽으로 반올림한다 — 후보가 빠지지 않는다.
  db.prepare("INSERT INTO feature_rtree (feature_id, min_x, max_x, min_y, max_y) VALUES (?, ?, ?, ?, ?)").run(featureId, minX, maxX, minY, maxY);
  return featureId;
  })();
}

// ponytail: 원에 외접하는 64각형 — 교차 판정이 원보다 최대 r·(1/cos(π/64)−1) ≈ 0.12% 넓다(1km에서 1.2m).
// 경계 1m 안쪽 정밀도가 필요해지면 선분–원 거리 판정으로 바꾼다.
function circlePolygon(cx: number, cy: number, r: number) {
  const outer = r / Math.cos(Math.PI / CIRCLE_SEGMENTS);
  const ring: [number, number][] = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const a = (2 * Math.PI * i) / CIRCLE_SEGMENTS;
    ring.push([cx + outer * Math.cos(a), cy + outer * Math.sin(a)]);
  }
  ring.push(ring[0]);
  return polygon([ring]);
}

interface FeatureRow {
  feature_id: number;
  stable_id: string;
  kind: string;
  release_id: string;
  geom_json: string;
  name: string | null;
  pnu: string | null;
  legal_code: string | null;
  properties_json: string;
}

export function queryFeaturesInRadius(db: Db, center: LngLat, radiusM: number, kinds: readonly string[]): FeatureHit[] {
  if (!Number.isFinite(radiusM) || radiusM <= 0 || radiusM > MAX_RADIUS_M) {
    throw new RangeError(`radiusM must be in (0, ${MAX_RADIUS_M}], got ${radiusM}`);
  }
  if (kinds.length === 0) return [];
  if (!center.every(Number.isFinite)) throw new RangeError(`center must be finite, got ${center}`);
  const [cx, cy] = toUtmk(center);
  // CROSS JOIN은 R*Tree를 바깥 루프로 고정한다. 그냥 JOIN이면 플래너가 kind 인덱스로 수백만 행을 훑으며
  // 행마다 R*Tree를 찾아(전국 파일에서 반경 1km 상가 조회가 5초) 느려진다.
  const rows = db
    .prepare(`SELECT f.feature_id, f.stable_id, f.kind, f.release_id, f.geom_json, f.name, f.pnu, f.legal_code, f.properties_json
      FROM feature_rtree r CROSS JOIN feature f ON f.feature_id = r.feature_id
      WHERE r.max_x >= ? AND r.min_x <= ? AND r.max_y >= ? AND r.min_y <= ?
        AND f.kind IN (${kinds.map(() => "?").join(",")})
      ORDER BY f.feature_id`)
    .all(cx - radiusM, cx + radiusM, cy - radiusM, cy + radiusM, ...kinds) as FeatureRow[];

  const circle = circlePolygon(cx, cy, radiusM);
  const hits: FeatureHit[] = [];
  for (const row of rows) {
    const geometry = JSON.parse(row.geom_json) as Geometry;
    let distanceM: number | null = null;
    if (geometry.type === "Point" || geometry.type === "MultiPoint") {
      distanceM = Math.min(...[...positions(geometry.coordinates)].map(([x, y]) => Math.hypot(x - cx, y - cy)));
      if (distanceM > radiusM) continue;
    } else if (!booleanIntersects(circle, geometry)) {
      continue;
    }
    hits.push({
      featureId: row.feature_id,
      stableId: row.stable_id,
      kind: row.kind,
      releaseId: row.release_id,
      name: row.name,
      pnu: row.pnu,
      legalCode: row.legal_code,
      properties: JSON.parse(row.properties_json) as Record<string, unknown>,
      geometry,
      distanceM,
    });
  }
  return hits;
}
