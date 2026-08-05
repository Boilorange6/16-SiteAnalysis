/**
 * 지오코딩 캐시 테스트.
 *
 * 성공은 이미 geocode_cache에 영구 저장되고 있었다. 새는 곳은 두 군데였다.
 *   - 실패는 캐시되지 않아 매 분석마다 다시 왕복한다 (후보 폴백 도입 후 주소당 최대 3회)
 *   - 역지오코딩(좌표→법정동)은 단지마다 호출되는데 캐시가 없다
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { initDatasetSchema } = await import("../lib/server/dataset-store.ts");
const {
  MISS_TTL_MS,
  readGeocode,
  writeGeocode,
  isRecentMiss,
  recordGeocodeMiss,
  readLegalCode,
  writeLegalCode,
} = await import("../lib/server/geocode-cache.ts");

function freshDb() {
  const db = new Database(":memory:");
  initDatasetSchema(db);
  return db;
}

const ADDR = "경기도 남양주시 다산동 6056";
const T0 = 1_700_000_000_000;

// ─── 성공 캐시 ─────────────────────────────────────────────────────────────
{
  const db = freshDb();
  assert.equal(readGeocode(db, ADDR), null, "모르는 주소는 null이다");

  writeGeocode(db, ADDR, 37.6241557, 127.1497762, T0);
  assert.deepEqual(readGeocode(db, ADDR), { lat: 37.6241557, lng: 127.1497762 });
  db.close();
}

// ─── 실패 캐시 ─────────────────────────────────────────────────────────────
{
  const db = freshDb();
  const bad = "경기도 남양주시 진접2 공공주택지구 S1BL";

  assert.equal(isRecentMiss(db, bad, T0), false, "실패 이력이 없으면 시도해야 한다");

  recordGeocodeMiss(db, bad, T0);
  assert.equal(isRecentMiss(db, bad, T0 + 60_000), true, "최근 실패한 주소는 다시 왕복하지 않는다");
  assert.equal(
    isRecentMiss(db, bad, T0 + MISS_TTL_MS + 1),
    false,
    "TTL이 지나면 다시 시도한다 (주소 파서가 개선될 수 있으므로)",
  );
  db.close();
}

// ─── 성공은 실패 이력을 지운다 ──────────────────────────────────────────────
{
  const db = freshDb();
  const addr = "경기도 남양주시 다산신도시 상업 2BL";
  recordGeocodeMiss(db, addr, T0);
  assert.equal(isRecentMiss(db, addr, T0 + 1000), true);

  writeGeocode(db, addr, 37.61, 127.16, T0 + 2000);
  assert.equal(isRecentMiss(db, addr, T0 + 3000), false, "성공하면 실패 이력은 무효가 돼야 한다");
  assert.deepEqual(readGeocode(db, addr), { lat: 37.61, lng: 127.16 });
  db.close();
}

// ─── 역지오코딩(법정동) 캐시 ───────────────────────────────────────────────
{
  const db = freshDb();
  assert.equal(readLegalCode(db, 37.6241557, 127.1497762), null, "모르는 좌표는 null이다");

  writeLegalCode(db, 37.6241557, 127.1497762, { sigunguCd: "41360", bjdongCd: "11200", areaName: "경기" }, T0);
  assert.deepEqual(readLegalCode(db, 37.6241557, 127.1497762), {
    sigunguCd: "41360",
    bjdongCd: "11200",
    areaName: "경기",
  });

  // 좌표는 소수 4자리(약 11m)로 뭉쳐 적중률을 높인다 — 법정동 경계에 비하면 무시할 오차
  assert.deepEqual(
    readLegalCode(db, 37.62415, 127.14977),
    { sigunguCd: "41360", bjdongCd: "11200", areaName: "경기" },
    "11m 안쪽 좌표는 같은 법정동 캐시를 써야 한다",
  );

  assert.equal(readLegalCode(db, 35.1, 129.03), null, "먼 좌표는 캐시가 걸리면 안 된다");
  db.close();
}

console.log("test-geocode-cache: 통과");
