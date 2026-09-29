/**
 * 반경 조회 테스트.
 * 대표점만 보고 거르면 경계가 반경에 걸친 필지·구역이 빠진다(spec §3.3).
 * bbox만 보고 거르면 원 밖 모서리 객체가 들어온다.
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { toUtmk, toLngLat } = await import("../../lib/v2/crs.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertFeature, queryFeaturesInRadius, MAX_RADIUS_M } = await import("../../lib/v2/data/features.ts");

const CENTER = [127.0592, 37.4869]; // 구룡역 부근
const [cx, cy] = toUtmk(CENTER);
const at = (dx, dy) => { const [lng, lat] = toLngLat([cx + dx, cy + dy]); return [lng, lat]; };
const square = (dx, dy, size) => ({
  type: "Polygon",
  coordinates: [[at(dx, dy), at(dx + size, dy), at(dx + size, dy + size), at(dx, dy + size), at(dx, dy)]],
});

function freshDb() {
  const db = new Database(":memory:");
  initDataFileSchema(db, "core");
  db.prepare(`INSERT INTO source_release (release_id, source_id, provider, source_url, fetched_at, checksum, schema_version, license_code)
    VALUES ('r1','test','test','https://example.invalid','2026-09-29T00:00:00+09:00','x',1,'TEST')`).run();
  return db;
}
const base = { sourceKey: "k", releaseId: "r1" };

const db = freshDb();
insertFeature(db, { ...base, stableId: "p-in", kind: "station", geometry: { type: "Point", coordinates: at(0, 990) } });
insertFeature(db, { ...base, stableId: "p-out", kind: "station", geometry: { type: "Point", coordinates: at(0, 1010) } });
// 중심(대표점)은 1,200m 밖이지만 가장 가까운 변은 950m — 반드시 포함
insertFeature(db, { ...base, stableId: "straddle", kind: "parcel", pnu: "1168010100100010000", geometry: square(950, -250, 500) });
// bbox는 겹치지만 원과는 안 겹치는 NE 모서리(가장 가까운 꼭짓점 ≈ 1,273m) — 제외
insertFeature(db, { ...base, stableId: "corner", kind: "parcel", geometry: square(900, 900, 50) });
insertFeature(db, { ...base, stableId: "bld", kind: "building", geometry: square(10, 10, 20) });

// ─── 1. 점: 정확한 거리 ─────────────────────────────────────────────────────
{
  const hits = queryFeaturesInRadius(db, CENTER, 1000, ["station"]);
  assert.deepEqual(hits.map((h) => h.stableId), ["p-in"]);
  assert.ok(Math.abs(hits[0].distanceM - 990) < 0.01, `distance=${hits[0].distanceM}`);
}

// ─── 2. 면: 교차 판정 ───────────────────────────────────────────────────────
{
  const ids = queryFeaturesInRadius(db, CENTER, 1000, ["parcel"]).map((h) => h.stableId).sort();
  assert.deepEqual(ids, ["straddle"], "경계가 걸친 필지는 포함, bbox만 겹친 모서리는 제외");
  const hit = queryFeaturesInRadius(db, CENTER, 1000, ["parcel"])[0];
  assert.equal(hit.pnu, "1168010100100010000", "PNU 문자열 보존");
  assert.equal(hit.distanceM, null, "면의 distanceM은 null");
  assert.equal(hit.geometry.type, "Polygon");
  assert.ok(hit.geometry.coordinates[0][0][0] > 100000, "반환 도형은 미터 좌표(EPSG:5179)");
}

// ─── 3. 종류 필터·빈 목록 ──────────────────────────────────────────────────
{
  assert.deepEqual(queryFeaturesInRadius(db, CENTER, 1000, ["building"]).map((h) => h.stableId), ["bld"]);
  assert.deepEqual(queryFeaturesInRadius(db, CENTER, 1000, []), []);
}

// ─── 4. 반경 검증 ──────────────────────────────────────────────────────────
{
  assert.equal(MAX_RADIUS_M, 5000);
  for (const bad of [0, -1, Number.NaN, 5001]) {
    assert.throws(() => queryFeaturesInRadius(db, CENTER, bad, ["station"]), RangeError, `radius ${bad}`);
  }
}

// ─── 5. PNU·법정동 코드를 숫자로 넘기면 거부 ──────────────────────────────
{
  assert.throws(
    () => insertFeature(db, { ...base, stableId: "bad-pnu", kind: "parcel", pnu: 1168010100100010000, geometry: square(0, 0, 10) }),
    /pnu must be a string/,
  );
  assert.throws(
    () => insertFeature(db, { ...base, stableId: "bad-legal", kind: "parcel", legalCode: 1168010100, geometry: square(0, 0, 10) }),
    /legalCode must be a string/,
  );
  assert.throws(
    () => insertFeature(db, { ...base, stableId: "gc", kind: "x", geometry: { type: "GeometryCollection", geometries: [] } }),
    /GeometryCollection/,
  );
}

console.log("✓ v2 features");
