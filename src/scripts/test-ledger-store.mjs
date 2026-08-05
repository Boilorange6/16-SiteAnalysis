/**
 * 건축물대장 법정동 단위 저장소 테스트.
 *
 * 전국 3,500여 법정동을 매번 통째로 교체하는 건 비현실적이라
 * 법정동 단위로 적재하고, 검색 시 신선하면 DB를 쓰고 아니면 API로 채운다(read-through).
 * 급감 방어도 법정동 단위로 건다.
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { initDatasetSchema } = await import("../lib/server/dataset-store.ts");
const {
  LEDGER_DONG_TTL_MS,
  shouldRejectDongUpdate,
  readLedgerDong,
  upsertLedgerDong,
  readLedgerInBbox,
} = await import("../lib/server/ledger-store.ts");

function freshDb() {
  const db = new Database(":memory:");
  initDatasetSchema(db);
  return db;
}

const building = (id, name, lat, lng, units = 100) => ({
  id,
  name,
  address: `경기도 남양주시 다산동 ${id}`,
  units,
  parking: 50,
  maxFloor: 20,
  useAprDay: "20200101",
  lat,
  lng,
});

const DASAN = ["41360", "11200"];
const DONONG = ["41360", "10600"];
const T0 = 1_700_000_000_000;

// ─── 급감 판별은 법정동 단위 규칙을 따른다 ──────────────────────────────────
{
  assert.equal(shouldRejectDongUpdate(0, 0), false, "원래 공동주택이 없는 법정동은 0건이 정상이다");
  assert.equal(shouldRejectDongUpdate(0, 10), false, "첫 적재는 통과다");
  assert.equal(shouldRejectDongUpdate(56, 0), true, "56건이던 법정동이 0건이 되면 거부한다");
  assert.equal(shouldRejectDongUpdate(56, 50), false, "소폭 감소는 정상 변동이다");
  assert.equal(shouldRejectDongUpdate(56, 20), true, "60% 급감은 거부한다");
}

// ─── 없는 법정동 / 적재 후 조회 ─────────────────────────────────────────────
{
  const db = freshDb();
  assert.equal(readLedgerDong(db, ...DASAN, T0), null, "적재된 적 없으면 null(=API로 채우라)");

  upsertLedgerDong(db, ...DASAN, [building("a", "휴먼시아", 37.605, 127.154)], T0);
  const rows = readLedgerDong(db, ...DASAN, T0 + 1000);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "휴먼시아");
  db.close();
}

// ─── 공동주택이 없는 법정동도 "조회했음"으로 기억한다 ───────────────────────
{
  const db = freshDb();
  const result = upsertLedgerDong(db, ...DONONG, [], T0);
  assert.equal(result.status, "ok");
  assert.deepEqual(readLedgerDong(db, ...DONONG, T0 + 1000), [], "빈 법정동은 빈 배열이지 null이 아니다");
  db.close();
}

// ─── TTL이 지나면 다시 채우게 한다 ──────────────────────────────────────────
{
  const db = freshDb();
  upsertLedgerDong(db, ...DASAN, [building("a", "휴먼시아", 37.605, 127.154)], T0);
  assert.equal(readLedgerDong(db, ...DASAN, T0 + LEDGER_DONG_TTL_MS - 1).length, 1);
  assert.equal(readLedgerDong(db, ...DASAN, T0 + LEDGER_DONG_TTL_MS + 1), null, "TTL 경과 후엔 재적재 대상이다");
  db.close();
}

// ─── 급감은 거부하고 기존 법정동 데이터를 지킨다 ────────────────────────────
{
  const db = freshDb();
  const many = Array.from({ length: 20 }, (_, i) => building(`b${i}`, `단지${i}`, 37.605, 127.154));
  upsertLedgerDong(db, ...DASAN, many, T0);

  const result = upsertLedgerDong(db, ...DASAN, [], T0 + 1000);
  assert.equal(result.status, "rejected", "20건 → 0건은 거부한다");
  assert.ok(result.message && result.message.length > 0, "거부 사유가 있어야 한다");
  assert.equal(readLedgerDong(db, ...DASAN, T0 + 2000).length, 20, "기존 20건이 그대로 남아야 한다");
  db.close();
}

// ─── 한 법정동 갱신이 다른 법정동을 건드리면 안 된다 ────────────────────────
{
  const db = freshDb();
  upsertLedgerDong(db, ...DASAN, [building("a", "다산단지", 37.605, 127.154)], T0);
  upsertLedgerDong(db, ...DONONG, [building("c", "도농단지", 37.609, 127.161)], T0);

  upsertLedgerDong(db, ...DASAN, [building("a2", "다산단지2", 37.606, 127.155)], T0 + 1000);

  assert.deepEqual(readLedgerDong(db, ...DASAN, T0 + 2000).map((r) => r.name), ["다산단지2"]);
  assert.deepEqual(readLedgerDong(db, ...DONONG, T0 + 2000).map((r) => r.name), ["도농단지"], "옆 법정동은 그대로다");
  db.close();
}

// ─── bbox 조회 ─────────────────────────────────────────────────────────────
{
  const db = freshDb();
  upsertLedgerDong(db, ...DASAN, [
    building("in", "반경안", 37.62, 127.15),
    building("out", "부산", 35.10, 129.03),
    building("nogeo", "좌표없음", null, null),
  ], T0);

  const found = readLedgerInBbox(db, { minLat: 37.6, maxLat: 37.7, minLng: 127.1, maxLng: 127.2 });
  assert.deepEqual(found.map((r) => r.name), ["반경안"], "bbox 밖과 좌표 없는 행은 빠진다");
  db.close();
}

console.log("test-ledger-store: 통과");
