/**
 * 전국 배치 적재 인프라 테스트.
 *
 * 실시간 API 조회를 DB 적재로 바꾸면, 상류가 조용히 0건을 주기 시작해도
 * 사용자는 "이 동네엔 원래 없나 보다"로 넘어간다.
 * 그래서 적재는 (1) 원자적으로 교체되고 (2) 급감하면 거부되고 (3) 이력이 남아야 한다.
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const {
  DROP_REJECT_RATIO,
  shouldRejectIngest,
  initDatasetSchema,
  beginStaging,
  appendStaging,
  commitStaging,
  readIngestRun,
  queryDatasetInBbox,
  PLANNED_HOUSING_SPEC,
} = await import("../lib/server/dataset-store.ts");

function freshDb() {
  const db = new Database(":memory:");
  initDatasetSchema(db);
  return db;
}

const row = (id, lat, lng, extra = {}) => ({
  id,
  name: `단지${id}`,
  address: `경기도 남양주시 다산동 ${id}`,
  area_name: "경기",
  kind: "apartment",
  units: 100,
  sale_date: "2026-01-01",
  move_in_month: "202803",
  homepage_url: "",
  notice_url: "",
  lat,
  lng,
  ...extra,
});

// ─── 1. 급감 판별 ──────────────────────────────────────────────────────────
{
  assert.equal(DROP_REJECT_RATIO, 0.3, "급감 기준은 30%다");
  assert.equal(shouldRejectIngest(1000, 650), true, "35% 급감은 거부한다");
  assert.equal(shouldRejectIngest(1000, 700), false, "정확히 30% 감소는 통과시킨다(경계)");
  assert.equal(shouldRejectIngest(1000, 800), false, "20% 감소는 정상 변동으로 본다");
  assert.equal(shouldRejectIngest(1000, 1500), false, "증가는 언제나 통과다");
  assert.equal(shouldRejectIngest(1000, 0), true, "전량 소실은 반드시 거부한다");
  assert.equal(shouldRejectIngest(0, 5), false, "첫 적재는 비교 대상이 없으므로 통과다");
  assert.equal(shouldRejectIngest(0, 0), true, "빈 상태에서 빈 적재는 실패로 본다");
}

// ─── 2. 첫 적재 ────────────────────────────────────────────────────────────
{
  const db = freshDb();
  beginStaging(db, PLANNED_HOUSING_SPEC);
  appendStaging(db, PLANNED_HOUSING_SPEC, [row("a", 37.62, 127.15), row("b", 37.63, 127.16)]);
  const result = commitStaging(db, PLANNED_HOUSING_SPEC, 1000);

  assert.equal(result.status, "ok");
  assert.equal(result.rowCount, 2);
  assert.equal(result.previousCount, 0);

  const run = readIngestRun(db, PLANNED_HOUSING_SPEC.dataset);
  assert.equal(run.status, "ok", "적재 이력이 남아야 한다");
  assert.equal(run.rowCount, 2);
  assert.equal(run.lastSuccessAt, 1000, "성공 시각이 기록돼야 한다");

  const found = queryDatasetInBbox(db, PLANNED_HOUSING_SPEC, {
    minLat: 37.6, maxLat: 37.7, minLng: 127.1, maxLng: 127.2,
  });
  assert.equal(found.length, 2, "적재된 행을 bbox로 읽을 수 있어야 한다");
  db.close();
}

// ─── 3. 정상 갱신은 완전히 교체한다 ─────────────────────────────────────────
{
  const db = freshDb();
  beginStaging(db, PLANNED_HOUSING_SPEC);
  appendStaging(db, PLANNED_HOUSING_SPEC, ["a", "b", "c", "d"].map((id) => row(id, 37.62, 127.15)));
  commitStaging(db, PLANNED_HOUSING_SPEC, 1000);

  beginStaging(db, PLANNED_HOUSING_SPEC);
  appendStaging(db, PLANNED_HOUSING_SPEC, ["c", "d", "e"].map((id) => row(id, 37.62, 127.15)));
  const result = commitStaging(db, PLANNED_HOUSING_SPEC, 2000);

  assert.equal(result.status, "ok");
  const ids = queryDatasetInBbox(db, PLANNED_HOUSING_SPEC, {
    minLat: 37.6, maxLat: 37.7, minLng: 127.1, maxLng: 127.2,
  }).map((r) => r.id).sort();
  assert.deepEqual(ids, ["c", "d", "e"], "지난 적재분(a, b)은 남으면 안 된다");
  db.close();
}

// ─── 4. 급감 적재는 거부하고 기존 데이터를 지킨다 ───────────────────────────
{
  const db = freshDb();
  const many = Array.from({ length: 100 }, (_, i) => row(`x${i}`, 37.62, 127.15));
  beginStaging(db, PLANNED_HOUSING_SPEC);
  appendStaging(db, PLANNED_HOUSING_SPEC, many);
  commitStaging(db, PLANNED_HOUSING_SPEC, 1000);

  // 상류가 망가져 5건만 들어온 상황
  beginStaging(db, PLANNED_HOUSING_SPEC);
  appendStaging(db, PLANNED_HOUSING_SPEC, many.slice(0, 5));
  const result = commitStaging(db, PLANNED_HOUSING_SPEC, 2000);

  assert.equal(result.status, "rejected", "95% 급감은 거부해야 한다");
  assert.equal(result.previousCount, 100);
  assert.ok(result.message && result.message.length > 0, "거부 사유가 있어야 한다");

  const kept = queryDatasetInBbox(db, PLANNED_HOUSING_SPEC, {
    minLat: 37.6, maxLat: 37.7, minLng: 127.1, maxLng: 127.2,
  });
  assert.equal(kept.length, 100, "거부되면 기존 100건이 그대로 남아야 한다");

  const run = readIngestRun(db, PLANNED_HOUSING_SPEC.dataset);
  assert.equal(run.status, "rejected");
  assert.equal(run.lastSuccessAt, 1000, "거부는 마지막 성공 시각을 갱신하면 안 된다");
  assert.equal(run.lastAttemptAt, 2000, "시도 시각은 갱신돼야 한다");
  db.close();
}

// ─── 5. bbox 밖 행은 읽히지 않는다 ─────────────────────────────────────────
{
  const db = freshDb();
  beginStaging(db, PLANNED_HOUSING_SPEC);
  appendStaging(db, PLANNED_HOUSING_SPEC, [
    row("in", 37.62, 127.15),
    row("out", 35.10, 129.03), // 부산
  ]);
  commitStaging(db, PLANNED_HOUSING_SPEC, 1000);

  const found = queryDatasetInBbox(db, PLANNED_HOUSING_SPEC, {
    minLat: 37.6, maxLat: 37.7, minLng: 127.1, maxLng: 127.2,
  });
  assert.deepEqual(found.map((r) => r.id), ["in"], "bbox 밖은 제외돼야 한다");
  db.close();
}

// ─── 6. 좌표 없는 행은 적재되지만 bbox 조회에서 빠진다 ──────────────────────
{
  const db = freshDb();
  beginStaging(db, PLANNED_HOUSING_SPEC);
  appendStaging(db, PLANNED_HOUSING_SPEC, [
    row("geo", 37.62, 127.15),
    row("nogeo", null, null),
  ]);
  const result = commitStaging(db, PLANNED_HOUSING_SPEC, 1000);
  assert.equal(result.rowCount, 2, "지오코딩 실패 행도 적재는 해서 재시도 대상으로 남긴다");

  const found = queryDatasetInBbox(db, PLANNED_HOUSING_SPEC, {
    minLat: 37.6, maxLat: 37.7, minLng: 127.1, maxLng: 127.2,
  });
  assert.deepEqual(found.map((r) => r.id), ["geo"], "좌표 없는 행은 지도 조회에 섞이면 안 된다");
  db.close();
}

console.log("test-dataset-store: 통과");
