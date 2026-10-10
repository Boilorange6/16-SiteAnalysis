/**
 * 정비사업 적재 테스트. 통합 픽스처는 실제 원천처럼 EUC-KR, 표준은 UTF-8.
 * 실제 전체 건수는 maint-dryrun.mjs로 본다.
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildMaintenance, normalizeStage, normalizeType, projectId } = await import("../../lib/v2/ingest/sources/maintenance.ts");
const { csvRecords } = await import("../../lib/v2/a0/measure.ts");

const fx = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const rel = (db, id) => insertRelease(db, { sourceId: id, provider: "test", sourceUrl: "https://www.data.go.kr", sourceAsOf: "2026-09-29", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "UNRESTRICTED" });

// 단계·유형 정규화
assert.equal(normalizeStage("6)관리처분인가", "integrated"), "관리처분");
assert.equal(normalizeStage("17)사업시행자지정", "integrated"), "미확인");
assert.equal(normalizeStage("", "integrated"), "미확인");
assert.equal(normalizeStage("해산 및 청산", "std"), "준공");
assert.equal(normalizeStage("추진위원회 승인", "std"), "추진위");
assert.equal(normalizeType("2)재개발(도시정비)"), "재개발");
assert.equal(normalizeType("4)재건축(단독주택)"), "재건축");
assert.equal(normalizeType("6)기타"), "미상");
// id: 결정적이고 공백·단계와 무관
assert.equal(projectId("11", "강남구", "개포 주공4단지", "재건축"), projectId("11", "강남구", "개포주공4단지", "재건축"));
assert.notEqual(projectId("11", "강남구", "a", "재건축"), projectId("11", "강남구", "a", "재개발"));

async function run() {
  const db = new Database(":memory:");
  initDataFileSchema(db, "market");
  const stats = await buildMaintenance(db, {
    integrated: (await csvRecords(fx("maintenance-integrated-sample.csv"))).records,
    integratedReleaseId: rel(db, "maintenance_integrated"),
    std: (await csvRecords(fx("maintenance-std-sample.csv"))).records,
    stdReleaseId: rel(db, "maintenance_std"),
  });
  return { db, stats };
}
const { db, stats } = await run();
const [integ, std] = stats;
for (const s of stats) assert.equal(s.received, s.accepted + s.unlocated + s.rejected, `${s.sourceId} invariant`);
// 통합: 9행 = 반복 1 + 시도 없음 1 reject, 7 accept
assert.deepEqual([integ.received, integ.accepted, integ.rejected], [9, 7, 2]);
assert.deepEqual(integ.byRegion, { 11: 3, 41: 2, 51: 2 });
assert.deepEqual(integ.byType, { 재개발: 3, 재건축: 2, 주거환경개선: 1, 미상: 1 });
assert.deepEqual(integ.expectedRegions.sort(), ["11", "41", "51"]);
const ev = (id) => db.prepare("SELECT * FROM development_event WHERE event_id = ?").get(id);
const gaepo = projectId("11", "강남구", "개포 주공4단지", "재건축");
assert.equal(ev(gaepo).stage, "사업시행", "따옴표 속 줄바꿈 이름");
assert.equal(ev(gaepo).units, 1970, "천 단위 쉼표");
assert.equal(ev(gaepo).event_type, "maintenance_stage");
assert.equal(ev(gaepo).effective_date, null, "통합에는 단계 날짜가 없다 — 만들지 않는다");
assert.equal(ev(gaepo).planned_date_precision, "unknown");
assert.equal(ev(projectId("11", "종로구", "사업자지정구역", "주거환경개선")).stage, "미확인");
assert.equal(ev(projectId("11", "종로구", "이상한단계", "미상")).stage, "미확인");
assert.equal(ev(projectId("41", "성남시", "정자동 1구역", "재개발")).units, null, "세대수 없음");
// 표준: 5행 = 중복 1 reject; 군자주공5단지는 통합(안산시 상록구)에 연결, 나머지 3은 단독
assert.deepEqual([std.received, std.accepted, std.rejected], [5, 4, 1]);
assert.deepEqual(std.byType, { linked: 1, std_only: 3 });
const linked = ev(`${projectId("41", "안산시 상록구", "군자주공5단지", "재건축")}:designated`);
assert.equal(linked.effective_date, "2009-09-28");
assert.equal(linked.stage, "구역지정");
assert.equal(db.prepare("SELECT stage FROM development_event WHERE event_id = ?").pluck().get(projectId("41", "안산시 상록구", "군자주공5단지", "재건축")), "조합", "연결돼도 통합의 현재 단계 유지");
const jung = projectId("41", "안산시", "중앙주공1단지", "미상");
assert.equal(ev(jung).stage, "준공");
assert.equal(ev(`${jung}:designated`).effective_date, "2008-01-28");
assert.equal(ev(projectId("26", "영도구", "영도구역", "미상")).stage, "관리처분");
assert.equal(db.prepare("SELECT count(*) FROM development_event WHERE event_id = ?").pluck().get(`${projectId("27", "서구", "서구구역", "미상")}:designated`), 0, "불가능한 날짜(13월)는 버린다");
assert.equal(ev(projectId("27", "서구", "서구구역", "미상")).stage, "착공");
// 위치 feature는 없고, 명부·시도별 집계는 coverage에 남는다
assert.equal(db.prepare("SELECT count(*) FROM feature").pluck().get(), 0);
const cov = JSON.parse(db.prepare("SELECT coverage_json FROM source_release WHERE source_id = 'maintenance_integrated'").pluck().get());
assert.equal(cov.unlocated, 7);
assert.equal(cov.byRegion["11"].accepted, 3);
assert.equal(cov.projects.find((p) => p.name === "개포 주공4단지").rawStage, "5)사업시행인가");
assert.equal(JSON.parse(db.prepare("SELECT rights_json FROM source_release WHERE source_id = 'maintenance_std'").pluck().get()).license, "이용허락범위 제한 없음");
// 결정성: 다시 만들면 같은 id 집합
const again = await run();
const ids = (d) => d.prepare("SELECT event_id FROM development_event ORDER BY event_id").pluck().all().join();
assert.equal(ids(again.db), ids(db));
console.log("v2 maintenance tests passed");
