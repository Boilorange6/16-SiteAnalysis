/**
 * 공간 객체 적재·반경 조회 (spec §3.3).
 * R*Tree로 bbox 후보를 추린 뒤 원과의 실제 교차를 판정한다.
 * 저장·반환 도형은 EPSG:5179 미터 좌표다.
 */
import type BetterSqlite3 from "better-sqlite3";
import type { Geometry, Position } from "geojson";
import { booleanIntersects, polygon } from "@turf/turf";
import { toUtmk, type LngLat } from "../crs";
import { maxOf, minOf } from "../extent";

type Db = BetterSqlite3.Database;
type Statement = BetterSqlite3.Statement;

interface FeatureStatements {
  insertFeature: Statement;
  insertRtree: Statement;
}

interface FeatureBulkState {
  insertPendingRtree: Statement;
}

// The feature path is hot for national building and parcel imports. Keep the
// statements attached to the database instead of preparing them for every
// record. WeakMap also lets better-sqlite3 release the statements with the DB.
const statementCache = new WeakMap<Db, FeatureStatements>();
const queryStatementCache = new WeakMap<Db, Map<string, Statement>>();
const bulkState = new WeakMap<Db, FeatureBulkState>();

export const MAX_RADIUS_M = 5000;
const CIRCLE_SEGMENTS = 64;

export interface FeatureInput {
  stableId: string;
  kind: string;
  sourceKey: string;
  releaseId: string;
  /** WGS84 경위도. geometryIsUtmk면 이미 EPSG:5179 미터 좌표 */
  geometry: Geometry;
  geometryIsUtmk?: boolean;
  name?: string | null;
  pnu?: string | null;
  legalCode?: string | null;
  properties?: Record<string, unknown>;
  /** 좌표 반올림 간격(미터). 큰 폴리곤 레이어의 파일 크기를 줄일 때만 쓴다 */
  roundM?: number;
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

function statementsFor(db: Db): FeatureStatements {
  const cached = statementCache.get(db);
  if (cached) return cached;
  const statements = {
    insertFeature: db.prepare(`INSERT INTO feature (stable_id, kind, source_key, release_id, geom_json, name, pnu, legal_code, properties_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    insertRtree: db.prepare("INSERT INTO feature_rtree (feature_id, min_x, max_x, min_y, max_y) VALUES (?, ?, ?, ?, ?)"),
  };
  statementCache.set(db, statements);
  return statements;
}

/**
 * Start the build-only feature bulk path. The published schema is unchanged:
 * the two secondary indexes are rebuilt after the feature rows, and R*Tree
 * rows are inserted in feature_id order after the source has been consumed.
 */
export function beginFeatureBulk(db: Db): void {
  if (bulkState.has(db)) throw new Error("feature bulk mode is already active");
  db.exec(`
    DROP INDEX IF EXISTS idx_feature_kind;
    DROP INDEX IF EXISTS idx_feature_pnu;
    CREATE TABLE IF NOT EXISTS feature_rtree_pending (
      feature_id INTEGER PRIMARY KEY,
      min_x REAL NOT NULL,
      max_x REAL NOT NULL,
      min_y REAL NOT NULL,
      max_y REAL NOT NULL
    );
  `);
  bulkState.set(db, {
    insertPendingRtree: db.prepare("INSERT INTO feature_rtree_pending (feature_id, min_x, max_x, min_y, max_y) VALUES (?, ?, ?, ?, ?)"),
  });
}

/** Finish the build-only feature bulk path and restore the published indexes. */
export function finishFeatureBulk(db: Db, options: { dropPending?: boolean } = {}): void {
  const state = bulkState.get(db);
  if (!state) return;
  if (db.inTransaction) throw new Error("finishFeatureBulk must run outside a transaction");
  db.transaction(() => {
    // DELETE makes a retry after a crash during deferred work idempotent.
    db.exec(`
      DELETE FROM feature_rtree;
      INSERT INTO feature_rtree (feature_id, min_x, max_x, min_y, max_y)
        SELECT feature_id, min_x, max_x, min_y, max_y
        FROM feature_rtree_pending
        ORDER BY feature_id;
      CREATE INDEX IF NOT EXISTS idx_feature_kind ON feature (kind);
      CREATE INDEX IF NOT EXISTS idx_feature_pnu ON feature (pnu);
    `);
    if (options.dropPending !== false) db.exec("DROP TABLE feature_rtree_pending");
  })();
  bulkState.delete(db);
}

/** Remove persistent bbox staging after the finalization marker is committed. */
export function dropFeatureBulkStaging(db: Db): void {
  db.exec("DROP TABLE IF EXISTS feature_rtree_pending");
}

/** Best-effort cleanup when a build is abandoned before finalization. */
export function abortFeatureBulk(db: Db): void {
  if (!bulkState.has(db)) return;
  try {
    // A resumable build must retain committed bboxes from completed files. An
    // active file transaction has already been rolled back by the source
    // helper, so leaving this table intact is safe and restartable.
  } finally {
    bulkState.delete(db);
  }
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

/** roundM: 좌표를 이 간격(미터)으로 반올림해 JSON을 줄인다. 없으면 반올림하지 않는다. */
export function projectGeometry(geometry: Geometry, roundM?: number, alreadyUtmk = false): Geometry {
  if (geometry.type === "GeometryCollection") throw new TypeError("GeometryCollection is not supported");
  const snap = (v: number) => (roundM ? Math.round(v / roundM) * roundM : v);
  const fix = (v: number) => (roundM ? Number(snap(v).toFixed(Math.max(0, Math.ceil(-Math.log10(roundM))))) : v);
  return { type: geometry.type, coordinates: mapPositions(geometry.coordinates, (p) => { const [x, y] = alreadyUtmk ? p : toUtmk(p); return [fix(x), fix(y)] as const; }) } as Geometry;
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
  const projected = projectGeometry(input.geometry, input.roundM, input.geometryIsUtmk);
  const [minX, minY, maxX, maxY] = bboxOf(projected);
  const statements = statementsFor(db);
  const write = () => {
    const info = statements.insertFeature.run(
      input.stableId, input.kind, input.sourceKey, input.releaseId, JSON.stringify(projected),
      input.name ?? null, input.pnu ?? null, input.legalCode ?? null, JSON.stringify(input.properties ?? {}),
    );
    const featureId = Number(info.lastInsertRowid);
    const bulk = bulkState.get(db);
    if (bulk) {
      bulk.insertPendingRtree.run(featureId, minX, maxX, minY, maxY);
    } else {
      // SQLite R*Tree stores 32-bit floats and rounds outward — candidates are not lost.
      statements.insertRtree.run(featureId, minX, maxX, minY, maxY);
    }
    return featureId;
  };
  // Source builders use batched(), so avoid a nested savepoint for every row.
  // Direct callers retain the original per-feature atomicity.
  return db.inTransaction ? write() : db.transaction(write)();
}

// ponytail: 원에 외접하는 64각형 — 교차 판정이 원보다 최대 r·(1/cos(π/64)−1) ≈ 0.12% 넓다(1km에서 1.2m).
// 경계 1m 안쪽 정밀도가 필요해지면 선분–원 거리 판정으로 바꾼다.
export function circlePolygon(cx: number, cy: number, r: number) {
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
  min_x: number;
  max_x: number;
  min_y: number;
  max_y: number;
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
  const sortedKinds = [...kinds].sort();
  const statementKey = sortedKinds.join("\u0000");
  let queries = queryStatementCache.get(db);
  if (!queries) {
    queries = new Map();
    queryStatementCache.set(db, queries);
  }
  let query = queries.get(statementKey);
  if (!query) {
    query = db.prepare(`SELECT f.feature_id, f.stable_id, f.kind, f.release_id, f.geom_json, f.name, f.pnu, f.legal_code, f.properties_json,
        r.min_x, r.max_x, r.min_y, r.max_y
      FROM feature_rtree r CROSS JOIN feature f ON f.feature_id = r.feature_id
      WHERE r.max_x >= ? AND r.min_x <= ? AND r.max_y >= ? AND r.min_y <= ?
        AND f.kind IN (${sortedKinds.map(() => "?").join(",")})
      `);
    queries.set(statementKey, query);
  }
  const rows = query.all(cx - radiusM, cx + radiusM, cy - radiusM, cy + radiusM, ...sortedKinds) as FeatureRow[];

  const circle = circlePolygon(cx, cy, radiusM);
  const candidateRadius = radiusM / Math.cos(Math.PI / CIRCLE_SEGMENTS);
  const candidateRadiusSquared = candidateRadius * candidateRadius;
  const radiusSquared = radiusM * radiusM;
  const hits: FeatureHit[] = [];
  for (const row of rows) {
    const dx = cx < row.min_x ? row.min_x - cx : cx > row.max_x ? cx - row.max_x : 0;
    const dy = cy < row.min_y ? row.min_y - cy : cy > row.max_y ? cy - row.max_y : 0;
    if (dx * dx + dy * dy > candidateRadiusSquared) continue;
    // The R*Tree bbox is rounded outward. If all four corners of that
    // conservative bbox are inside the true circle, every possible feature
    // geometry is inside the circle polygon as well, so Turf cannot reject it.
    // Boundary/intersecting candidates still take the exact existing path.
    let bboxInsideCircle = false;
    if (row.kind === "parcel") {
      const minDx = row.min_x - cx;
      const maxDx = row.max_x - cx;
      const minDy = row.min_y - cy;
      const maxDy = row.max_y - cy;
      bboxInsideCircle = Math.max(
        minDx * minDx + minDy * minDy,
        minDx * minDx + maxDy * maxDy,
        maxDx * maxDx + minDy * minDy,
        maxDx * maxDx + maxDy * maxDy,
      ) <= radiusSquared;
    }
    const geometry = JSON.parse(row.geom_json) as Geometry;
    let distanceM: number | null = null;
    if (geometry.type === "Point" || geometry.type === "MultiPoint") {
      distanceM = minOf([...positions(geometry.coordinates)].map(([x, y]) => Math.hypot(x - cx, y - cy)));
      if (distanceM > radiusM) continue;
    } else if (!bboxInsideCircle && !booleanIntersects(circle, geometry)) {
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
  // R*Tree traversal does not promise feature_id order. Sorting the already
  // exact-filtered hits in JS preserves deterministic output without making
  // SQLite materialize a temporary B-tree for every spatial query.
  hits.sort((a, b) => a.featureId - b.featureId);
  return hits;
}
