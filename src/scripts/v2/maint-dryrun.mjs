/**
 * 실제 정비사업 원천 파일을 메모리 DB에 적재해 보는 점검(게시·디스크 쓰기 없음).
 *   npx tsx src/scripts/v2/maint-dryrun.mjs
 */
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildMaintenance } = await import("../../lib/v2/ingest/sources/maintenance.ts");
const { csvRecords } = await import("../../lib/v2/a0/measure.ts");

const RAW = process.env.V2_RAW ?? "D:/V-coding/16-SiteAnalysis/.cache/v2/raw";
const db = new Database(":memory:");
initDataFileSchema(db, "market");
const rel = (id) => insertRelease(db, { sourceId: id, provider: "x", sourceUrl: "x", sourceAsOf: "2026-09-29", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "UNRESTRICTED" });
const stats = await buildMaintenance(db, {
  integrated: (await csvRecords(`${RAW}/maintenance/maintenance-integrated-15160169.csv`)).records, integratedReleaseId: rel("maintenance_integrated"),
  std: (await csvRecords(`${RAW}/maintenance/maintenance-std-15155703.csv`)).records, stdReleaseId: rel("maintenance_std"),
});
for (const s of stats) {
  const cov = JSON.parse(db.prepare("SELECT coverage_json FROM source_release WHERE source_id = ?").pluck().get(s.sourceId));
  console.log(s.sourceId, { read: s.received, accepted: s.accepted, rejected: s.rejected, located: "0%", byRegion: s.byRegion, byType: s.byType }, cov.linkedToIntegrated !== undefined ? { linkedToIntegrated: cov.linkedToIntegrated } : "");
}
console.log("by stage (all events, current stage):", Object.fromEntries(db.prepare("SELECT stage, count(*) n FROM development_event WHERE event_id NOT LIKE '%:designated' GROUP BY stage").all().map((r) => [r.stage, r.n])));
console.log("projects:", db.prepare("SELECT count(DISTINCT project_id) FROM development_event").pluck().get(), "events:", db.prepare("SELECT count(*) FROM development_event").pluck().get());

// 검수지 주변(시군구 문자열 + 구역명 키워드로만 짐작 가능 — 위치가 없다)
const all = stats.flatMap((s) => JSON.parse(db.prepare("SELECT coverage_json FROM source_release WHERE source_id = ?").pluck().get(s.sourceId)).projects);
const show = (label, f) => { const hit = all.filter(f); console.log(label, hit.length, hit.map((p) => `${p.name}(${p.sigungu}/${p.stage})`).join(", ")); };
show("서울 강남구 전체:", (p) => p.sido === "11" && p.sigungu.startsWith("강남구"));
show("  이름에 개포/구룡:", (p) => p.sido === "11" && p.sigungu.startsWith("강남구") && /개포|구룡/.test(p.name));
show("성남 전체(원천 표기 '성남수정구' 등):", (p) => p.sido === "41" && p.sigungu.startsWith("성남"));
show("  분당(시군구 문자열):", (p) => p.sido === "41" && p.sigungu.startsWith("성남") && /분당/.test(p.sigungu));
show("  이름에 정자:", (p) => p.sido === "41" && p.sigungu.startsWith("성남") && /정자/.test(p.name));
