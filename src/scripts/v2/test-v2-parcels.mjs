/**
 * 필지 대표점 테스트. 대장·입주예정처럼 좌표가 없는 원천은 PNU로 이 표를 찾아 위치를 얻는다.
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { makePnu, lookupParcelPoint } = await import("../../lib/v2/data/parcels.ts");
const { buildParcelPoints, jimokOf } = await import("../../lib/v2/ingest/sources/parcels.ts");

// ─── 1. PNU 만들기 ─────────────────────────────────────────────────────────
assert.equal(makePnu("3611011100", false, "0640", "0000"), "3611011100106400000");
assert.equal(makePnu("3611011100", true, 12, 3), "3611011100200120003");
assert.equal(makePnu("361101110", false, 1, 0), null, "법정동 코드는 10자리");
assert.equal(makePnu("3611011100", false, 0, 0), null, "본번 0은 없다");
assert.equal(makePnu("3611011100", false, "12a", 0), null);
assert.equal(makePnu("3611011100", false, 10000, 0), null);

// ─── 2. 지목 ──────────────────────────────────────────────────────────────
assert.equal(jimokOf("203-24전"), "전");
assert.equal(jimokOf("930 공"), "공");
assert.equal(jimokOf("산12-3임"), "임");
assert.equal(jimokOf("930"), null);
assert.equal(jimokOf(null), null);

// ─── 3. 적재와 조회 ───────────────────────────────────────────────────────
{
  const db = new Database(":memory:");
  initDataFileSchema(db, "core");
  const rel = insertRelease(db, { sourceId: "parcel", provider: "국토교통부", sourceUrl: "https://www.vworld.kr", sourceAsOf: "2026-09-08", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "CC-BY" });
  async function* recs() {
    yield { properties: { A1: "3611010100102030024", A5: "203-24전" }, point: [127.28, 36.48] };
    yield { properties: { A1: "3611010100102030024", A5: "203-24전" }, point: [127.28, 36.48] }; // 중복
    yield { properties: { A1: "36110101001", A5: "1대" }, point: [127.2, 36.4] }; // PNU 형식 오류
    yield { properties: { A1: "3611010100109300000", A5: "930 공" }, point: null }; // 도형 없음
    yield { properties: { A1: "1168010100100010000", A5: "1대" }, point: [127.05, 37.49] };
  }
  const s = await buildParcelPoints(db, recs(), rel);
  assert.equal(s.received, 5);
  assert.equal(s.accepted, 2);
  assert.equal(s.rejected, 3);
  assert.deepEqual(s.byRegion, { 36: 1, 11: 1 });
  assert.deepEqual(lookupParcelPoint(db, "3611010100102030024"), [127.28, 36.48]);
  assert.equal(lookupParcelPoint(db, "3611010100109300000"), null);
  assert.equal(db.prepare("SELECT jimok FROM parcel_point WHERE pnu='1168010100100010000'").pluck().get(), "대");
  assert.equal(s.sourceId, "parcel");
  async function* one() { yield { properties: { A1: "4136011200144360000", A5: null }, point: [127.2, 37.6] }; }
  assert.equal((await buildParcelPoints(db, one(), rel, "parcel_building")).sourceId, "parcel_building");
}

console.log("✓ v2 parcels");
