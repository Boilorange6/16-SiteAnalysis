/** 높이 보강 2단계: 필지 공간 조인·표제부 동별 보수 매칭 픽스처. */
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const { buildAndPublish, insertRelease, SourceStats } = await import("../../lib/v2/ingest/build.ts");
const { readManifest } = await import("../../lib/v2/data/manifest.ts");
const { buildBuildings, finalizeLedgerMatches } = await import("../../lib/v2/ingest/sources/buildings.ts");
const { createLedgerTitleIndex, insertLedgerTitleIndexRow, ledgerTitleLookup } = await import("../../lib/v2/ingest/sources/ledger.ts");
const { createParcelSpatialLookup } = await import("../../lib/v2/ingest/sources/parcel-spatial.ts");

const square = (x, y, w = 0.001, h = w) => ({ type: "Polygon", coordinates: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]] });
const record = (id, geometry, properties = {}) => ({ geometry, properties: { A1: id, A3: "1111000000", A16: 0, A26: 0, A27: 0, ...properties } });
const release = (db, sourceId) => insertRelease(db, { sourceId, provider: "test", sourceUrl: "https://example.invalid", sourceAsOf: "2026-09-01", fetchedAt: "2026-10-07T00:00:00Z", checksum: sourceId, licenseCode: "TEST" });
async function* rows(values) { yield* values; }
const fact = (db, id) => db.prepare("SELECT b.*, f.pnu, f.name FROM building_fact b JOIN feature f USING (feature_id) WHERE f.stable_id = ?").get(`building:${id}`);

// ── 건물→필지 PNU: 원천 PNU 우선, 내부점, 경계 최대교차, 동률 보류 ───────
{
  const parcels = new Database(":memory:");
  initDataFileSchema(parcels, "parcels");
  const parcelRel = release(parcels, "parcel_polygon");
  insertFeature(parcels, { stableId: "parcel:P1", kind: "parcel", sourceKey: "P1", releaseId: parcelRel, geometry: square(127, 37), pnu: "1111010100100010000", properties: {} });
  insertFeature(parcels, { stableId: "parcel:P2", kind: "parcel", sourceKey: "P2", releaseId: parcelRel, geometry: square(127.001, 37), pnu: "1111010100100020000", properties: {} });
  const spatial = createParcelSpatialLookup(parcels, "2026-10-07-parcels");
  assert.ok(spatial);

  const buildings = new Database(":memory:");
  initDataFileSchema(buildings, "buildings");
  const buildingRel = release(buildings, "building");
  const stats = await buildBuildings(buildings, rows([
    record("SPATIAL", square(127.0002, 37.0002, 0.0004), { A2: "" }),
    record("BOUNDARY", square(127.0008, 37.0002, 0.0006), { A2: "" }),
    record("SOURCE-WINS", square(127.0012, 37.0002, 0.0004), { A2: "1111010100100010000" }),
  ]), buildingRel, { spatial, parcelVersion: "2026-10-07-parcels" });
  assert.equal(stats.accepted, 3);
  assert.equal(fact(buildings, "SPATIAL").pnu, "1111010100100010000");
  assert.equal(fact(buildings, "SPATIAL").pnu_method, "spatial");
  assert.equal(JSON.parse(fact(buildings, "SPATIAL").field_provenance_json).pnu.parcelVersion, "2026-10-07-parcels");
  assert.equal(fact(buildings, "BOUNDARY").pnu, "1111010100100020000", "경계 건물은 교차 면적이 큰 필지");
  assert.equal(fact(buildings, "SOURCE-WINS").pnu, "1111010100100010000", "원천 A2 PNU 우선");
  assert.equal(fact(buildings, "SOURCE-WINS").pnu_method, "source");
  buildings.close();
  parcels.close();
}

// ── 표제부 동별 인덱스: PK/name/area와 높이·승인일, 1:N 거부 ────────────
{
  const core = new Database(":memory:");
  initDataFileSchema(core, "core");
  const coreRel = release(core, "ledger_title");
  createLedgerTitleIndex(core, true);
  const title = (pk, pnu, dong, floors, height, area, approval = "20200102") => insertLedgerTitleIndexRow(core, {
    "관리_건축물대장_PK": pk, "시군구_코드": pnu.slice(0, 5), "법정동_코드": pnu.slice(5, 10), "대지_구분_코드": "0", "번": pnu.slice(11, 15), "지": pnu.slice(15, 19),
    "동_명": dong, "건물_명": "테스트", "주_부속_구분_코드_명": "주건축물", "지상_층_수": floors, "높이(m)": height, "건축_면적(㎡)": area, "연면적(㎡)": area * 5, "사용승인_일": approval, "주_용도_코드": "02000",
  });
  const pnuDirect = "1111010100100100000";
  const pnuNames = "1111010100100110000";
  const pnuArea = "1111010100100120000";
  const pnuAmbiguous = "1111010100100130000";
  const pnuOneToMany = "1111010100100140000";
  title("PK-DIRECT", pnuDirect, "1동", 8, 24.5, 100, "20100304");
  title("PK-101", pnuNames, "101동", 6, 18, 100);
  title("PK-102", pnuNames, "102동", 7, 21, 120);
  title("PK-AREA-A", pnuArea, "A동", 4, null, 100);
  title("PK-AREA-B", pnuArea, "B동", 5, null, 200);
  title("PK-AMB-A", pnuAmbiguous, "같은동", 4, 12, 100);
  title("PK-AMB-B", pnuAmbiguous, "같은동", 5, 15, 100);
  title("PK-1N", pnuOneToMany, "1동", 5, 15, 100);
  const lookup = ledgerTitleLookup(core);
  assert.ok(lookup);
  assert.equal(lookup.match({ pnu: pnuDirect, ledgerPk: "PK-DIRECT", name: null, grossFloorAreaM2: null, footprintAreaM2: null })?.method, "ledger_pk");
  assert.equal(lookup.match({ pnu: pnuNames, ledgerPk: null, name: "101", grossFloorAreaM2: null, footprintAreaM2: null })?.method, "pnu_name");
  assert.equal(lookup.match({ pnu: pnuArea, ledgerPk: null, name: "없는동", grossFloorAreaM2: null, footprintAreaM2: 210 })?.method, "pnu_area");
  assert.equal(lookup.match({ pnu: pnuAmbiguous, ledgerPk: null, name: "없는동", grossFloorAreaM2: null, footprintAreaM2: 100 }), null);

  const buildings = new Database(":memory:");
  initDataFileSchema(buildings, "buildings");
  const buildingRel = release(buildings, "building");
  const stats = await buildBuildings(buildings, rows([
    record("TITLE-HEIGHT", square(127, 37), { A2: pnuDirect, A21: "PK-DIRECT", A24: "1동", A12: 100, A13: "" }),
    record("TITLE-NAME", square(127, 37), { A2: pnuNames, A24: "101", A12: 100 }),
    record("TITLE-FLOORS", square(127, 37), { A2: pnuArea, A24: "없는동", A12: 210 }),
  ]), buildingRel, { ledger: lookup });
  assert.deepEqual([fact(buildings, "TITLE-HEIGHT").height_m, fact(buildings, "TITLE-HEIGHT").height_method, fact(buildings, "TITLE-HEIGHT").floors_above, fact(buildings, "TITLE-HEIGHT").approval_date], [24.5, "ledger_height", 8, "2010-03-04"]);
  assert.equal(fact(buildings, "TITLE-NAME").height_method, "ledger_height");
  assert.equal(fact(buildings, "TITLE-NAME").name, "101", "번호형 A24 이름도 보존하고 PNU+이름 매칭을 유지");
  assert.equal(fact(buildings, "TITLE-FLOORS").height_method, "ledger_floors_estimate");

  const oneToManyStats = await buildBuildings(buildings, rows([
    record("ONE-TO-MANY-A", square(127, 37), { A2: pnuOneToMany }),
    record("ONE-TO-MANY-B", square(127, 37), { A2: pnuOneToMany }),
  ]), buildingRel, { ledger: lookup, deferLedgerMatches: true });
  const jusoStats = new SourceStats("building_juso", buildingRel, ["heightM", "floorsAbove"]);
  jusoStats.read();
  jusoStats.accept({ heightM: 9, floorsAbove: 3 }, "11", "floors_estimate");
  const jusoBefore = JSON.stringify(jusoStats.snapshot());
  const finalized = finalizeLedgerMatches(buildings, [oneToManyStats, jusoStats]);
  assert.equal(finalized.rejectedOneToMany, 2);
  assert.equal(JSON.stringify(jusoStats.snapshot()), jusoBefore, "1:N 되돌림은 GIS 건물 통계만 바꾼다(도로명주소 채움률 보존)");
  assert.equal(fact(buildings, "ONE-TO-MANY-A").height_method, "unknown");
  assert.equal(fact(buildings, "ONE-TO-MANY-B").height_method, "unknown");
  buildings.close();
  core.close();
}

// ── build 순서와 manifest 의존성: parcels가 buildings보다 먼저 준비된다 ──
{
  const { mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dataDir = mkdtempSync(join(tmpdir(), "v2-height2-plan-"));
  const parcelPnu = "1111010100100200000";
  const result = await buildAndPublish({
    dataDir,
    version: "height2",
    builders: {
      parcels: async (db) => {
        const rel = release(db, "parcel_polygon");
        insertFeature(db, { stableId: `parcel:${parcelPnu}`, kind: "parcel", sourceKey: parcelPnu, releaseId: rel, geometry: square(127, 37), pnu: parcelPnu, properties: {} });
        const stats = new SourceStats("parcel_polygon", rel, []);
        stats.read(); stats.accept({}, "11", "parcel");
        return [stats];
      },
      buildings: async (db, ctx) => {
        assert.ok(ctx.parcels, "buildings receives parcels DB");
        assert.equal(ctx.parcelVersion, "height2");
        const rel = release(db, "building");
        const spatial = createParcelSpatialLookup(ctx.parcels, ctx.parcelVersion);
        return [await buildBuildings(db, rows([record("DEPENDENCY", square(127.0002, 37.0002, 0.0002), { A2: "" })]), rel, { spatial, parcelVersion: ctx.parcelVersion })];
      },
    },
  });
  assert.equal(result.published, true, JSON.stringify(result.failures));
  const manifest = readManifest(dataDir);
  assert.equal(manifest.files.buildings.dependsOn.parcels, "height2");
  assert.equal(manifest.files.parcels.path, "versions/height2/parcels.sqlite");
}

console.log("✓ v2 height2 spatial + ledger matching");
