/**
 * 청약홈 분양 전국 적재 테스트.
 *
 * 네트워크는 주입 지점(fetchComplexes / geocode)으로 갈아끼운다.
 * 적재 로직 자체 — 행 변환, 좌표 실패 처리, 급감 거부 — 만 검증한다.
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { initDatasetSchema, readIngestRun, queryDatasetInBbox, PLANNED_HOUSING_SPEC } = await import(
  "../lib/server/dataset-store.ts"
);
const { APPLYHOME_AREA_NAMES, complexToDatasetRow, ingestPlannedHousing } = await import(
  "../lib/server/planned-housing-ingest.ts"
);

function freshDb() {
  const db = new Database(":memory:");
  initDatasetSchema(db);
  return db;
}

const complex = (id, name, address, extra = {}) => ({
  houseManageNo: id,
  pblancNo: id,
  name,
  address,
  units: 100,
  saleDate: "2026-01-01",
  moveInMonth: "202803",
  homepageUrl: "",
  noticeUrl: "",
  kind: "apartment",
  housingTypes: [],
  ...extra,
});

// ─── 전 지역이 대상이어야 한다 ──────────────────────────────────────────────
{
  assert.equal(APPLYHOME_AREA_NAMES.length, 17, "청약홈 공급지역 17개 시도를 모두 돌아야 한다");
  for (const must of ["서울", "경기", "부산", "제주", "세종"]) {
    assert.ok(APPLYHOME_AREA_NAMES.includes(must), `${must}가 빠졌다`);
  }
}

// ─── 행 변환 ───────────────────────────────────────────────────────────────
{
  const row = complexToDatasetRow(complex("2023000445", "다산 유보라 마크뷰", "경기도 남양주시 다산동 4133"), "경기", {
    lat: 37.6053885,
    lng: 127.1543556,
  });
  assert.equal(row.id, "2023000445:2023000445", "주택관리번호:공고번호가 기본키다");
  assert.equal(row.name, "다산 유보라 마크뷰");
  assert.equal(row.area_name, "경기");
  assert.equal(row.lat, 37.6053885);
  assert.equal(row.kind, "apartment");

  const noCoord = complexToDatasetRow(complex("x", "이름", "주소"), "경기", null);
  assert.equal(noCoord.lat, null, "좌표를 못 구하면 null로 적재한다");
}

// ─── 적재 전 과정 ──────────────────────────────────────────────────────────
{
  const db = freshDb();
  const complexes = {
    경기: [
      complex("1", "다산 유보라 마크뷰", "경기도 남양주시 다산동 4133"),
      complex("2", "구리역 롯데캐슬", "경기도 구리시 인창동 289-29"),
      complex("3", "지오코딩실패단지", "경기도 남양주시 왕숙2 공공주택지구 A-3BL"),
    ],
    서울: [complex("4", "서울단지", "서울특별시 강남구 대치동 1")],
  };
  const geocoded = {
    "경기도 남양주시 다산동 4133": { lat: 37.6053885, lng: 127.1543556 },
    "경기도 구리시 인창동 289-29": { lat: 37.6032, lng: 127.1379 },
    "서울특별시 강남구 대치동 1": { lat: 37.4979, lng: 127.0629 },
  };

  const calls = [];
  const result = await ingestPlannedHousing({
    db,
    now: 5000,
    areaNames: ["경기", "서울"],
    fetchComplexes: async (area) => {
      calls.push(area);
      return complexes[area] ?? [];
    },
    geocode: async (address) => geocoded[address] ?? null,
  });

  assert.deepEqual(calls, ["경기", "서울"], "지정한 지역을 모두 조회해야 한다");
  assert.equal(result.status, "ok");
  assert.equal(result.rowCount, 4, "좌표를 못 구한 단지도 적재 대상이다");

  const run = readIngestRun(db, PLANNED_HOUSING_SPEC.dataset);
  assert.equal(run.status, "ok");
  assert.equal(run.lastSuccessAt, 5000);

  const nearDasan = queryDatasetInBbox(db, PLANNED_HOUSING_SPEC, {
    minLat: 37.55, maxLat: 37.70, minLng: 127.05, maxLng: 127.25,
  });
  assert.equal(nearDasan.length, 2, "다산 주변 bbox에는 경기 2건만 잡혀야 한다");
  db.close();
}

// ─── 상류가 망가져 급감하면 기존 데이터를 지킨다 ────────────────────────────
{
  const db = freshDb();
  const many = Array.from({ length: 50 }, (_, i) => complex(`m${i}`, `단지${i}`, `주소${i}`));
  const geocode = async () => ({ lat: 37.62, lng: 127.15 });

  await ingestPlannedHousing({
    db, now: 1000, areaNames: ["경기"],
    fetchComplexes: async () => many,
    geocode,
  });

  const broken = await ingestPlannedHousing({
    db, now: 2000, areaNames: ["경기"],
    fetchComplexes: async () => many.slice(0, 2),
    geocode,
  });

  assert.equal(broken.status, "rejected", "50건 → 2건은 거부해야 한다");
  const kept = queryDatasetInBbox(db, PLANNED_HOUSING_SPEC, {
    minLat: 37.5, maxLat: 37.7, minLng: 127.0, maxLng: 127.3,
  });
  assert.equal(kept.length, 50, "거부되면 기존 50건이 그대로 남아야 한다");
  assert.equal(readIngestRun(db, PLANNED_HOUSING_SPEC.dataset).lastSuccessAt, 1000);
  db.close();
}

// ─── 지역 간 중복 공고는 한 번만 적재한다 ───────────────────────────────────
{
  const db = freshDb();
  const dup = complex("same", "경계단지", "경기도 하남시 위례");
  const result = await ingestPlannedHousing({
    db, now: 1000, areaNames: ["경기", "서울"],
    fetchComplexes: async () => [dup],
    geocode: async () => ({ lat: 37.48, lng: 127.14 }),
  });
  assert.equal(result.rowCount, 1, "같은 공고번호는 지역이 달라도 1건이다");
  db.close();
}

console.log("test-planned-housing-ingest: 통과");
