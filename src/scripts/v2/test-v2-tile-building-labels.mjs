/** D03·D04·D05 라벨 규칙: 범주별 최근접 1동만 우선순위 2, 이름 없으면 용도 이름, 잡음 이름 제외, 같은 필지 단지명·승인일 보충. */
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
const { d03, useLabelOf } = await import("../../lib/v2/tile/d03/engine.ts");
const { d04 } = await import("../../lib/v2/tile/d04/engine.ts");
const { d05 } = await import("../../lib/v2/tile/d05/engine.ts");
const { d06 } = await import("../../lib/v2/tile/d05/d06.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { toTileView, viewWithLayer } = await import("../../lib/v2/ui/tile-view.ts");
const { analysisCharts } = await import("../../lib/v2/report/analysis-charts.ts");

const CENTER = [127.1506, 37.6245];
const [CX, CY] = toUtmk(CENTER);
const at = (x, y) => toLngLat([CX + x, CY + y]);
const rect = (x0, x1, y0, y1) => ({ type: "Polygon", coordinates: [[at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)]] });
const pnuOf = (n) => `41360118001${String(n).padStart(8, "0")}`;

async function makeContext(label, buildings, coreRows = []) {
  const dataDir = mkdtempSync(join(tmpdir(), `v2-building-labels-${label}-`));
  const versionDir = join(dataDir, "versions", "v1");
  mkdirSync(versionDir, { recursive: true });
  const corePath = join(versionDir, "core.sqlite");
  const core = new Database(corePath);
  initDataFileSchema(core, "core");
  const coreRelease = insertRelease(core, { sourceId: "ledger_recap", provider: "테스트 대장", sourceUrl: "https://example.invalid/ledger", sourceAsOf: "2026-10-01", fetchedAt: "2026-10-01T00:00:00Z", checksum: `core-${label}`, licenseCode: "TEST" });
  coreRows.forEach((row, index) => insertFeature(core, { stableId: row.stableId, kind: row.kind, sourceKey: row.stableId, releaseId: coreRelease, geometry: { type: "Point", coordinates: at(index * 3, 900) }, pnu: row.pnu, name: row.name, properties: row.properties }));
  core.close();

  const buildingsPath = join(versionDir, "buildings.sqlite");
  const db = new Database(buildingsPath);
  initDataFileSchema(db, "buildings");
  const release = insertRelease(db, { sourceId: "building", provider: "테스트 GIS", sourceUrl: "https://example.invalid/gis", sourceAsOf: "2026-10-01", fetchedAt: "2026-10-01T00:00:00Z", checksum: `gis-${label}`, licenseCode: "TEST" });
  const fact = db.prepare("INSERT INTO building_fact (feature_id, ledger_pk, height_m, height_method, floors_above, floors_below, use_code, approval_date, gross_floor_area_m2, footprint_area_m2, field_provenance_json) VALUES (?, NULL, ?, ?, ?, NULL, ?, ?, NULL, 400, '{}')");
  for (const b of buildings) {
    const featureId = insertFeature(db, { stableId: `building:${b.id}`, kind: "building", sourceKey: b.id, releaseId: release, geometry: b.geometry, name: b.name ?? null, pnu: b.pnu === undefined ? null : pnuOf(b.pnu) });
    fact.run(featureId, b.heightM === undefined ? 10 : b.heightM, b.heightMethod ?? "source", b.floors === undefined ? 3 : b.floors, b.use === undefined ? "02000" : b.use, b.approvalDate ?? null);
  }
  db.close();

  const manifest = { version: "v1", createdAt: "2026-10-01T00:00:00Z", files: { core: { path: "versions/v1/core.sqlite", kind: "core", schemaVersion: 2 }, buildings: { path: "versions/v1/buildings.sqlite", kind: "buildings", schemaVersion: 2 } } };
  manifest.files.core.sha256 = await M.sha256File(corePath);
  manifest.files.buildings.sha256 = await M.sha256File(buildingsPath);
  assert.equal((await M.publishManifest(dataDir, manifest, () => ({ ok: true, failures: [] }))).published, true);
  return new EngineContext(dataDir, M.readManifest(dataDir), `labels-${label}`, { address: "테스트", center: CENTER, radiusM: 800, analysisDate: "2026-10-06", pnu: null });
}

const priority2 = (tile) => tile.presentation.polygons.filter((polygon) => polygon.labelPriority === 2);
const byName = (tile, name) => tile.presentation.polygons.find((polygon) => polygon.name === name);

// ── D03 ──
const d03Buildings = [
  { id: "res-near", use: "02000", name: "래미안대치", geometry: rect(25, 45, -10, 10) },
  { id: "res-far", use: "02000", name: "먼아파트", geometry: rect(300, 320, -10, 10) },
  { id: "shop-noise", use: "04000", name: "6", geometry: rect(-224, -204, -10, 10) },
  { id: "shop-far", use: "04000", name: null, geometry: rect(-520, -500, -10, 10) },
  { id: "office-near", use: "14000", name: "동하빌딩", geometry: rect(-10, 10, 195, 215) },
  { id: "office-far", use: "14000", name: "먼빌딩", geometry: rect(-10, 10, 600, 620) },
  { id: "unknown-named", use: null, name: "미상건물", geometry: rect(40, 60, 40, 60) },
  { id: "sales-inside", use: "07000", name: null, geometry: rect(-10, 10, -10, 10) },
  { id: "stay-east", use: "15000", name: "동쪽호텔", geometry: rect(100, 120, -10, 10) },
  { id: "stay-twin", use: "15000", name: "복제호텔", geometry: rect(100, 120, -10, 10) },
  { id: "code-name", use: "02000", name: "02000", geometry: rect(350, 370, 50, 70) },
];
const ctx3 = await makeContext("d03", d03Buildings);
const tile3 = d03(ctx3);
parseTileResult(tile3);
const targets3 = priority2(tile3);
assert.deepEqual(targets3.map((polygon) => polygon.layer).sort(), ["use:근린생활", "use:업무", "use:주거", "use:판매", "use:숙박"].sort(), "분류마다 정확히 하나, 미상은 없다");
assert.equal(new Set(targets3.map((polygon) => polygon.layer)).size, targets3.length);
// ① 이름 있는 주거(25 m), 이름 없는 근생(204 m, 잡음 이름), 이름 있는 업무(195 m)
const res = byName(tile3, "래미안대치");
assert.equal(res.labelPriority, 2);
assert.equal(res.sublabel, `${useLabelOf("02000")} · 직선 25m`);
const shop = targets3.find((polygon) => polygon.layer === "use:근린생활");
assert.equal(shop.name, null, "② 잡음 이름 `6`은 라벨 이름이 아니다");
assert.equal(shop.unnamedTitle, useLabelOf("04000"));
assert.equal(shop.sublabel, "직선 204m");
const office = byName(tile3, "동하빌딩");
assert.equal(office.labelPriority, 2);
assert.equal(office.sublabel, `${useLabelOf("14000")} · 직선 195m`);
assert.equal(tile3.presentation.polygons.filter((polygon) => polygon.layer === "use:미상").some((polygon) => polygon.labelPriority === 2), false);
for (const far of ["먼아파트", "먼빌딩"]) assert.equal(byName(tile3, far).labelPriority, 0, "그 밖은 이름이 있어도 0");
// ② 모든 면의 이름·대체 제목에 숫자·코드가 없다
for (const polygon of tile3.presentation.polygons) {
  for (const value of [polygon.name, polygon.unnamedTitle]) if (value) assert.ok(!/^\d+$/.test(value) && !/^\d{5}$/.test(value), `숫자 제목: ${value}`);
}
assert.equal(byName(tile3, "02000"), undefined, "코드 이름은 라벨 이름이 아니다");
// 대상이 아닌 이름 없는 면: 용도 이름 제목, sublabel null
const farShop = tile3.presentation.polygons.find((polygon) => polygon.layer === "use:근린생활" && polygon.labelPriority === 0);
assert.equal(farShop.unnamedTitle, useLabelOf("04000"));
assert.equal(farShop.sublabel, null);
// ⑥ 대지가 면 안: 거리 0, 같으면 featureId가 작은 건물
const inside = targets3.find((polygon) => polygon.layer === "use:판매");
assert.equal(inside.sublabel, "직선 0m");
const stay = targets3.find((polygon) => polygon.layer === "use:숙박");
assert.equal(stay.name, "동쪽호텔", "거리가 같으면 featureId가 작은(먼저 적재된) 건물");
// ⑦ 동수·그래프 동수는 그대로
const view3 = toTileView(tile3);
const chart3 = analysisCharts(viewWithLayer(view3, view3.defaultLayer).map);
assert.equal(chart3.total, tile3.metrics.find((metric) => metric.id === "fill_use_pct").denominator);
ctx3.close();

// ③ A-1: 이름 없는 02000 + PNU 단지명
const core3 = [
  { stableId: "title-housing:P1", kind: "housing_complex", pnu: pnuOf(1), name: "은마아파트", properties: { source: "title", buildingCount: 1, approvalDate: "1983-05-01" } },
  { stableId: "title-housing:P2", kind: "housing_complex", pnu: pnuOf(2), name: "은마아파트", properties: { source: "title", buildingCount: 1, approvalDate: "1983-05-01" } },
];
const ctxA = await makeContext("a1", [
  { id: "unnamed-apt", use: "02000", name: null, pnu: 1, geometry: rect(10, 30, -10, 10) },
  { id: "shop-on-complex", use: "04000", name: null, pnu: 2, geometry: rect(-60, -40, -10, 10) },
], core3);
const tileA = d03(ctxA);
const aptPolygon = tileA.presentation.polygons.find((polygon) => polygon.layer === "use:주거");
assert.equal(aptPolygon.name, "은마아파트");
assert.equal(aptPolygon.labelPriority, 2);
assert.ok(tileA.limitations.some((limitation) => limitation.note.includes("단지명")), "D03 한계 문구");
const shopOnComplex = tileA.presentation.polygons.find((polygon) => polygon.layer === "use:근린생활");
assert.equal(shopOnComplex.name, null, "04000은 단지명을 받지 않는다");
ctxA.close();

// ── D04 ──
const core4 = [
  ...core3,
  { stableId: "recap:P3", kind: "housing_complex", pnu: pnuOf(3), name: "푸르지오", properties: { source: "recap", approvalDate: "2003-03-03" } },
];
const d04Buildings = [
  { id: "y85-near", use: "02000", name: null, approvalDate: "1985-01-01", geometry: rect(100, 120, -10, 10) },
  { id: "y87-far", use: "02000", name: "먼단지", approvalDate: "1987-01-01", geometry: rect(300, 320, -10, 10) },
  { id: "y95", use: "02000", name: "구아파트", approvalDate: "1995-05-05", geometry: rect(-150, -130, -10, 10) },
  { id: "unknown-year", use: "02000", name: "연도미상", geometry: rect(20, 40, -10, 10) },
  { id: "shop-complex", use: "04000", name: null, pnu: 2, approvalDate: "1991-01-01", geometry: rect(-50, -30, -10, 10) },
  { id: "a1-date", use: "02000", name: null, pnu: 3, geometry: rect(400, 420, -10, 10) },
];
const ctx4 = await makeContext("d04", d04Buildings, core4);
const tile4 = d04(ctx4);
parseTileResult(tile4);
const targets4 = priority2(tile4);
assert.deepEqual(targets4.map((polygon) => polygon.layer).sort(), ["bldg_1980s", "bldg_1990s", "bldg_2000s"], "④ 연대마다 하나, 미상 연대는 없다");
const eighties = targets4.find((polygon) => polygon.layer === "bldg_1980s");
assert.equal(eighties.sublabel, "1985년 · 직선 100m");
assert.equal(eighties.unnamedTitle, useLabelOf("02000"));
assert.equal(byName(tile4, "먼단지").labelPriority, 1, "대상이 아닌 이름 있는 면은 기존대로 1");
const nineties = targets4.find((polygon) => polygon.layer === "bldg_1990s");
assert.equal(nineties.name, "구아파트", "04000 단지 필지 건물(1991)은 대상이 아니다");
// A-1 날짜: 연도가 생겨 2000년대에 들고 한계 문구가 센다
const a1 = targets4.find((polygon) => polygon.layer === "bldg_2000s");
assert.equal(a1.name, "푸르지오");
assert.equal(a1.sublabel, "2003년 · 직선 400m");
assert.ok(tile4.limitations.some((limitation) => limitation.kind === "estimated" && limitation.note === "같은 필지(PNU)의 단지가 하나뿐인 건물 1동은 그 단지의 사용승인일을 썼습니다."));
assert.ok(tile4.limitations.some((limitation) => limitation.note.includes("단지명")));
assert.ok(!tile4.presentation.polygons.some((polygon) => polygon.layer === "bldg_unknown" && polygon.labelPriority === 2));
ctx4.close();

// ── D05 ──
const d05Buildings = [
  { id: "fl-unknown", use: "02000", name: "층수미상", floors: null, heightM: 12, heightMethod: "source", geometry: rect(15, 35, -10, 10) },
  { id: "fl3-near", use: "02000", name: null, floors: 3, geometry: rect(50, 70, -10, 10) },
  { id: "fl3-far", use: "02000", name: "먼저층", floors: 3, geometry: rect(200, 220, -10, 10) },
  { id: "fl10", use: "02000", name: "열층빌딩", floors: 10, geometry: rect(-120, -100, -10, 10) },
  { id: "fl30", use: "02000", name: "고층타워", floors: 30, heightM: 90, geometry: rect(300, 320, -10, 10) },
  { id: "assumed", use: "04000", name: null, floors: null, heightM: null, heightMethod: "unknown", geometry: rect(120, 140, -10, 10) },
  { id: "tall-named", use: "02000", name: "높은타워", floors: 14, heightM: 40, heightMethod: "source", geometry: rect(-400, -380, -10, 10) },
];
const ctx5 = await makeContext("d05", d05Buildings);
const tile5 = d05(ctx5);
parseTileResult(tile5);
const targets5 = priority2(tile5);
assert.ok(targets5.length > 0 && targets5.every((polygon) => polygon.layer.startsWith("floors_")), "⑤ 층수대별 최근접만, 모두 floors_*");
assert.equal(new Set(targets5.map((polygon) => polygon.layer)).size, targets5.length);
assert.ok(!targets5.some((polygon) => polygon.layer === "floors_unknown"), "층수 미상에는 2가 없다");
const low = targets5.find((polygon) => polygon.layer === "floors_1_4");
assert.equal(low.sublabel, "3층 · 직선 50m");
assert.equal(low.unnamedTitle, useLabelOf("02000"));
const assumed = targets5.find((polygon) => polygon.layer === "floors_assumed_1f_est");
assert.equal(assumed.sublabel, "1층 가정(추정) · 직선 120m");
assert.ok(!/\d\s*m(\s|$)/.test(assumed.sublabel.replace(/직선 \d+m/, "")), "1층 가정에 높이 수치가 없다");
// 용도 없는 1층 가정: 대체 제목이 범례 이름 「1층 가정(추정)」이면 상세 줄은 거리만
{
  const ctxU = await makeContext("d05-unused", [{ id: "assumed-nouse", use: null, name: null, floors: null, heightM: null, heightMethod: "unknown", geometry: rect(120, 140, -10, 10) }]);
  const only = priority2(d05(ctxU)).find((polygon) => polygon.layer === "floors_assumed_1f_est");
  assert.equal(only.unnamedTitle, "1층 가정(추정)");
  assert.equal(only.sublabel, "직선 120m");
  ctxU.close();
}
// D06: 이름 있는 tall_ge35 면은 1이다(tall 규칙은 없어졌다)
const tile6 = d06(ctx5);
const tall = tile6.presentation.polygons.find((polygon) => polygon.layer === "tall_ge35" && polygon.name);
assert.ok(tall, "fixture에 이름 있는 35m 이상 건물");
assert.equal(tall.labelPriority, 1);
ctx5.close();

// 용도 이름 집합 동기화는 test-v2-building-label-supplement.mjs가 본다.
console.log("✓ v2 D03/D04/D05 building label rules");
