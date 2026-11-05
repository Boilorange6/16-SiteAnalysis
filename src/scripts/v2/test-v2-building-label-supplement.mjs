/** 라벨용 보충: 잡음 이름 판정과 같은 PNU core 단지의 이름·단일 단지 승인일(원천 값은 그대로 둔다). */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { toLngLat, toUtmk } = await import("../../lib/v2/crs.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { isLabelNoiseName } = await import("../../lib/v2/ingest/sources/building-names.ts");
const { buildingLabelName, buildingRetirementInfo, buildingRows } = await import("../../lib/v2/engine/tiles/buildings-shared.ts");

// ① 잡음 이름
for (const name of ["6", "102", "108동", "A동", "가동", "에이동", "상가동", "공동주택", "창고", "다세대주택", "157-1", "R1952", "380105_4_0002", "2.5mx1.5m", "대치동 507 제2종근린생활시설", "개포동 157-9 공동주택 (김해옥)", "우성희 건물", "제2종근린생활시설", null]) {
  assert.equal(isLabelNoiseName(name), true, `잡음이어야 함: ${name}`);
}
for (const name of ["은마아파트", "개포1차우성아파트6동", "동하빌딩", "대치 클래시아", "예일빌라(다동)", "서울대치초등학교", "래미안대치팰리스 101동"]) {
  assert.equal(isLabelNoiseName(name), false, `이름이어야 함: ${name}`);
}

const CENTER = [127.1506, 37.6245];
const [CX, CY] = toUtmk(CENTER);
const at = (x, y) => toLngLat([CX + x, CY + y]);
const rectangle = (x0, x1, y0, y1) => ({ type: "Polygon", coordinates: [[at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)]] });
const pnuOf = (n) => `41360118001${String(n).padStart(8, "0")}`;

const CORE = [
  // P1: 단일 title-housing + kapt(별칭)
  { stableId: "title-housing:P1", kind: "housing_complex", pnu: pnuOf(1), name: "은마아파트", properties: { source: "title", buildingCount: 1, approvalDate: "1983-05-01" } },
  { stableId: "kapt:P1", kind: "kapt_complex", pnu: pnuOf(1), name: "은마", properties: {} },
  // P2: 04000 건물용 같은 구성
  { stableId: "title-housing:P2", kind: "housing_complex", pnu: pnuOf(2), name: "은마아파트", properties: { source: "title", buildingCount: 1, approvalDate: "1983-05-01" } },
  // P3: 포함 관계가 아닌 두 이름
  { stableId: "title-housing:P3", kind: "housing_complex", pnu: pnuOf(3), name: "은마아파트", properties: { source: "title", buildingCount: 1, approvalDate: "1983-05-01" } },
  { stableId: "recap:P3", kind: "housing_complex", pnu: pnuOf(3), name: "선경상가", properties: { source: "recap", approvalDate: "1990-01-01" } },
  // P4: 동 2개짜리 title-housing
  { stableId: "title-housing:P4", kind: "housing_complex", pnu: pnuOf(4), name: "래미안", properties: { source: "title", buildingCount: 2, approvalDate: "2001-02-03" } },
  // P5: recap 단지 하나
  { stableId: "recap:P5", kind: "housing_complex", pnu: pnuOf(5), name: "푸르지오", properties: { source: "recap", approvalDate: "1999-09-09" } },
  // P6: 오피스텔 하나뿐
  { stableId: "title:P6", kind: "officetel", pnu: pnuOf(6), name: "오피스텔빌", properties: { source: "title", approvalDate: "2010-10-10" } },
  // P7: 단지 + 오피스텔
  { stableId: "title-housing:P7", kind: "housing_complex", pnu: pnuOf(7), name: "복합단지", properties: { source: "title", buildingCount: 1, approvalDate: "2005-05-05" } },
  { stableId: "title:P7", kind: "officetel", pnu: pnuOf(7), name: "복합오피스텔", properties: { source: "title", approvalDate: "2006-06-06" } },
  // P8: 건물 쪽에 승인일이 이미 있다
  { stableId: "recap:P8", kind: "housing_complex", pnu: pnuOf(8), name: "한솔", properties: { source: "recap", approvalDate: "1998-08-08" } },
  // P9: 이름이 공동주택인 건물
  { stableId: "recap:P9", kind: "housing_complex", pnu: pnuOf(9), name: "대치단지", properties: { source: "recap", approvalDate: "1997-07-07" } },
];

const BUILDINGS = [
  { id: "b1", pnu: 1, use: "02000" },
  { id: "b2", pnu: 2, use: "04000" },
  { id: "b3", pnu: 3, use: "02000" },
  { id: "b4", pnu: 4, use: "02000" },
  { id: "b5", pnu: 5, use: "02000" },
  { id: "b6", pnu: 6, use: "02000" },
  { id: "b7", pnu: 7, use: "02000" },
  { id: "b8", pnu: 8, use: "02000", approvalDate: "1998-01-01" },
  { id: "b9", pnu: 9, use: "02000", name: "공동주택" },
  { id: "b10", pnu: null, use: "02000", name: "공동주택" },
  { id: "b11", pnu: 1, use: "02000", name: "개포1차우성아파트6동" },
];

async function makeContext(coreRows, label) {
  const dataDir = mkdtempSync(join(tmpdir(), `v2-label-supplement-${label}-`));
  const versionDir = join(dataDir, "versions", "v1");
  mkdirSync(versionDir, { recursive: true });
  const corePath = join(versionDir, "core.sqlite");
  const core = new Database(corePath);
  initDataFileSchema(core, "core");
  const coreRelease = insertRelease(core, { sourceId: "ledger_recap", provider: "테스트 대장", sourceUrl: "https://example.invalid/ledger", sourceAsOf: "2026-10-01", fetchedAt: "2026-10-01T00:00:00Z", checksum: `core-${label}`, licenseCode: "TEST" });
  coreRows.forEach((row, index) => insertFeature(core, { stableId: row.stableId, kind: row.kind, sourceKey: row.stableId, releaseId: coreRelease, geometry: { type: "Point", coordinates: at(index * 3, 300) }, pnu: row.pnu, name: row.name, properties: row.properties }));
  core.close();

  const buildingsPath = join(versionDir, "buildings.sqlite");
  const buildings = new Database(buildingsPath);
  initDataFileSchema(buildings, "buildings");
  const gisRelease = insertRelease(buildings, { sourceId: "building", provider: "테스트 GIS", sourceUrl: "https://example.invalid/gis", sourceAsOf: "2026-10-01", fetchedAt: "2026-10-01T00:00:00Z", checksum: `gis-${label}`, licenseCode: "TEST" });
  const fact = buildings.prepare("INSERT INTO building_fact (feature_id, ledger_pk, height_m, height_method, floors_above, floors_below, use_code, approval_date, gross_floor_area_m2, footprint_area_m2, field_provenance_json) VALUES (?, NULL, 10, 'source', 3, NULL, ?, ?, NULL, 400, '{}')");
  BUILDINGS.forEach((b, index) => {
    const featureId = insertFeature(buildings, { stableId: `building:${b.id}`, kind: "building", sourceKey: b.id, releaseId: gisRelease, geometry: rectangle(index * 40 - 200, index * 40 - 180, -10, 10), name: b.name ?? null, pnu: b.pnu === null ? null : pnuOf(b.pnu) });
    fact.run(featureId, b.use, b.approvalDate ?? null);
  });
  buildings.close();

  const manifest = {
    version: "v1",
    createdAt: "2026-10-01T00:00:00Z",
    files: {
      core: { path: "versions/v1/core.sqlite", kind: "core", schemaVersion: 2 },
      buildings: { path: "versions/v1/buildings.sqlite", kind: "buildings", schemaVersion: 2 },
    },
  };
  manifest.files.core.sha256 = await M.sha256File(corePath);
  manifest.files.buildings.sha256 = await M.sha256File(buildingsPath);
  const published = await M.publishManifest(dataDir, manifest, () => ({ ok: true, failures: [] }));
  assert.equal(published.published, true);
  return new EngineContext(dataDir, M.readManifest(dataDir), `label-supplement-${label}`, { address: "테스트", center: CENTER, radiusM: 800, analysisDate: "2026-10-06", pnu: null });
}

const ctx = await makeContext(CORE, "with");
const rows = buildingRows(ctx);
assert.ok(rows);
const rowOf = (id) => rows.find((row) => row.hit.stableId === `building:${id}`);

// ② 이름 없는 02000 + 단일 title-housing + kapt
assert.equal(buildingLabelName(rowOf("b1")), "은마아파트");
assert.equal(rowOf("b1").pnuSupplement.approvalDate, "1983-05-01");
assert.equal(rowOf("b1").hit.name, null, "원천 이름은 그대로");
assert.equal(rowOf("b1").approvalDate, null, "원천 승인일은 그대로");
assert.equal(rowOf("b1").pnuSupplement.hasComplex, true);
// ③ 04000은 이름 보충 없음, hasComplex는 true
assert.equal(buildingLabelName(rowOf("b2")), null);
assert.equal(rowOf("b2").pnuSupplement.name, null);
assert.equal(rowOf("b2").pnuSupplement.hasComplex, true);
// ④ 포함 관계가 아닌 이름
assert.equal(rowOf("b3").pnuSupplement.name, null);
assert.equal(buildingLabelName(rowOf("b3")), null);
// ⑤ 동 수·종류별 승인일
assert.equal(rowOf("b4").pnuSupplement.approvalDate, null);
assert.equal(rowOf("b4").pnuSupplement.name, "래미안");
assert.equal(rowOf("b5").pnuSupplement.approvalDate, "1999-09-09");
assert.equal(rowOf("b6").pnuSupplement.approvalDate, "2010-10-10");
assert.equal(rowOf("b6").pnuSupplement.name, null, "오피스텔 이름은 쓰지 않는다");
assert.equal(rowOf("b6").pnuSupplement.hasComplex, false);
assert.equal(rowOf("b7").pnuSupplement.approvalDate, null);
// ⑥ 빈 칸만
assert.equal(rowOf("b8").approvalDate, "1998-01-01");
assert.equal(rowOf("b8").pnuSupplement.approvalDate, null);
// ⑦ 이름이 공동주택
assert.equal(buildingLabelName(rowOf("b9")), "대치단지");
assert.equal(rowOf("b9").hit.name, "공동주택");
assert.equal(buildingLabelName(rowOf("b10")), null);
assert.equal(rowOf("b10").pnuSupplement, undefined, "PNU도 보충도 없으면 필드를 두지 않는다");
// 이름이 있는 건물은 그대로
assert.equal(buildingLabelName(rowOf("b11")), "개포1차우성아파트6동");

// ⑧ 철거 판정 불변: core 단지 행이 있든 없든 같다
const bare = await makeContext([], "without");
const bareRows = buildingRows(bare);
assert.equal(bareRows.length, rows.length);
assert.deepEqual(buildingRetirementInfo(bare), buildingRetirementInfo(ctx));
assert.ok(bareRows.every((row) => row.pnuSupplement === undefined), "core가 비면 보충 필드가 없다");
ctx.close();
bare.close();

console.log("✓ v2 building label supplement");
