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

// ── purpose 컬럼: 오피스텔과 공동주택을 구분해 저장한다 ───────────────────────
// 오피스텔은 표제부에서 오고 공동주택은 총괄표제부에서 온다. 출처가 달라
// 이름 규칙(“오피스텔” 포함)만으로는 분류가 새므로 대장에서 온 사실을 그대로 남긴다.
{
  const db = new Database(":memory:");
  initDatasetSchema(db);
  const now = Date.now();
  upsertLedgerDong(db, "11680", "10100", [
    { id: "a", name: "래미안", address: "역삼동 1", units: 500, parking: 300, maxFloor: 20,
      useAprDay: "20200101", bun: "0001", ji: "0000", lat: 37.5, lng: 127.0, purpose: "공동주택" },
    { id: "b", name: "역삼 노블루체 언주", address: "역삼동 761", units: 129, parking: 80, maxFloor: 15,
      useAprDay: "20190315", bun: "0761", ji: "0000", lat: 37.5, lng: 127.0, purpose: "오피스텔" },
  ], now);

  const rows = readLedgerDong(db, "11680", "10100", now);
  assert.equal(rows.length, 2);
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(byName["래미안"].purpose, "공동주택");
  assert.equal(byName["역삼 노블루체 언주"].purpose, "오피스텔");
  assert.equal(byName["역삼 노블루체 언주"].units, 129, "오피스텔 규모는 호수 기준");
  db.close();
  console.log("ledger-store: purpose 왕복 확인");
}

// 기존 DB(컬럼 없음)에서 올라와도 깨지지 않고 공동주택으로 읽힌다
{
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE ledger_building (
    id TEXT PRIMARY KEY, sigungu_cd TEXT NOT NULL DEFAULT '', bjdong_cd TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', units INTEGER NOT NULL DEFAULT 0,
    parking INTEGER NOT NULL DEFAULT 0, max_floor INTEGER NOT NULL DEFAULT 0,
    use_apr_day TEXT NOT NULL DEFAULT '', bun TEXT NOT NULL DEFAULT '', ji TEXT NOT NULL DEFAULT '',
    lat REAL, lng REAL);`);
  db.prepare("INSERT INTO ledger_building (id, sigungu_cd, bjdong_cd, name, units) VALUES ('old','11680','10100','옛건물',100)").run();

  initDatasetSchema(db); // 마이그레이션이 컬럼을 채워야 한다
  db.prepare("INSERT INTO ledger_dong_sync (sigungu_cd,bjdong_cd,fetched_at,row_count) VALUES ('11680','10100',?,1)").run(Date.now());

  const rows = readLedgerDong(db, "11680", "10100", Date.now());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].purpose, "공동주택", "옛 행은 공동주택으로 읽혀야 한다");
  db.close();
  console.log("ledger-store: purpose 컬럼 마이그레이션 확인");
}
