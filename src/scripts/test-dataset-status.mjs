/**
 * 적재 신뢰 표시 테스트.
 *
 * 배치로 옮기면 상류 장애가 조용해진다. 마지막 성공 시각과 거부 사유가
 * 화면까지 올라와야 "이 동네엔 원래 없나 보다"로 넘어가지 않는다.
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { initDatasetSchema, PLANNED_HOUSING_SPEC, beginStaging, appendStaging, commitStaging } =
  await import("../lib/server/dataset-store.ts");
const { upsertLedgerDong } = await import("../lib/server/ledger-store.ts");
const { plannedHousingStatus, ledgerBuildingStatus, isDatasetStale } =
  await import("../lib/server/dataset-status.ts");

function freshDb() {
  const db = new Database(":memory:");
  initDatasetSchema(db);
  return db;
}

const plannedRow = (id) => ({
  id, name: `단지${id}`, address: "주소", area_name: "경기", kind: "apartment",
  units: 100, sale_date: "2026-01-01", move_in_month: "202803",
  homepage_url: "", notice_url: "", lat: 37.62, lng: 127.15,
});

const T0 = 1_700_000_000_000;

// ─── 적재 전에는 표시할 게 없다 ─────────────────────────────────────────────
{
  const db = freshDb();
  assert.equal(plannedHousingStatus(db), null, "적재 이력이 없으면 null이다");
  assert.equal(ledgerBuildingStatus(db), null, "적재된 법정동이 없으면 null이다");
  db.close();
}

// ─── 정상 적재 ─────────────────────────────────────────────────────────────
{
  const db = freshDb();
  beginStaging(db, PLANNED_HOUSING_SPEC);
  appendStaging(db, PLANNED_HOUSING_SPEC, ["a", "b", "c"].map(plannedRow));
  commitStaging(db, PLANNED_HOUSING_SPEC, T0);

  const status = plannedHousingStatus(db);
  assert.equal(status.status, "ok");
  assert.equal(status.rowCount, 3);
  assert.equal(status.lastSuccessAt, T0);
  assert.equal(status.message, "", "정상이면 경고 문구가 없다");
  db.close();
}

// ─── 거부된 적재는 사유와 함께 드러나야 한다 ────────────────────────────────
{
  const db = freshDb();
  const many = Array.from({ length: 20 }, (_, i) => plannedRow(`m${i}`));
  beginStaging(db, PLANNED_HOUSING_SPEC);
  appendStaging(db, PLANNED_HOUSING_SPEC, many);
  commitStaging(db, PLANNED_HOUSING_SPEC, T0);

  beginStaging(db, PLANNED_HOUSING_SPEC);
  appendStaging(db, PLANNED_HOUSING_SPEC, many.slice(0, 1));
  commitStaging(db, PLANNED_HOUSING_SPEC, T0 + 86_400_000);

  const status = plannedHousingStatus(db);
  assert.equal(status.status, "rejected", "거부 상태가 그대로 올라와야 한다");
  assert.ok(status.message.includes("급감"), `거부 사유가 담겨야 한다 (실제: ${status.message})`);
  assert.equal(status.lastSuccessAt, T0, "마지막 성공 시각은 거부 이전 값을 유지한다");
  assert.equal(status.rowCount, 20, "실제로 서비스 중인 건수를 보여준다");
  db.close();
}

// ─── 건축물대장은 법정동 커버리지로 표시한다 ────────────────────────────────
{
  const db = freshDb();
  upsertLedgerDong(db, "41360", "11200", [
    { id: "a", name: "휴먼시아", address: "", units: 100, parking: 10, maxFloor: 20, useAprDay: "", lat: 37.6, lng: 127.1 },
  ], T0);
  upsertLedgerDong(db, "41310", "10100", [], T0 + 1000);

  const status = ledgerBuildingStatus(db);
  assert.equal(status.status, "ok");
  assert.equal(status.rowCount, 1, "적재된 건물 수");
  assert.equal(status.dongCount, 2, "공동주택이 없는 법정동도 조회 완료로 센다");
  assert.equal(status.lastSuccessAt, T0 + 1000, "가장 최근 적재 시각");
  db.close();
}

// ─── 신선도 판정 ───────────────────────────────────────────────────────────
{
  const day = 24 * 60 * 60 * 1000;
  assert.equal(isDatasetStale({ lastSuccessAt: T0 }, T0 + day, 7 * day), false);
  assert.equal(isDatasetStale({ lastSuccessAt: T0 }, T0 + 8 * day, 7 * day), true);
  assert.equal(isDatasetStale({ lastSuccessAt: null }, T0, 7 * day), true, "성공한 적 없으면 stale이다");
  assert.equal(isDatasetStale(null, T0, 7 * day), true, "상태 자체가 없으면 stale이다");
}

console.log("test-dataset-status: 통과");
