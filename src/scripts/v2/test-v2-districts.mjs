/** D11/D12: dsId 24 레이어 적재 계약과 면·선·점 도판. */
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease, SourceStats } = await import("../../lib/v2/ingest/build.ts");
const { buildDistricts, DISTRICT_LAYERS, DISTRICT_RIGHTS, districtLayerFiles } = await import("../../lib/v2/ingest/sources/districts.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { d11 } = await import("../../lib/v2/engine/tiles/d11.ts");
const { d12 } = await import("../../lib/v2/engine/tiles/d12.ts");

assert.deepEqual(DISTRICT_LAYERS, [], "Q1 레이어 제목 확정 전에는 임의의 레이어를 등록하지 않는다");
assert.match(DISTRICT_RIGHTS.basis, /15045898/);
assert.equal(districtLayerFiles(["/r/AL_D999_00_20260101.shp"], "AL_D999").size, 1);

const center = [127.1506, 37.6245];
const square = (x0, x1, y0, y1) => ({ type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
const rows = (...items) => (async function* () { yield* items; })();
const record = (id, geometry, extra = {}) => ({
  properties: { A1: id, A3: "20260901", A4: "41360", A5: "DUMMY", A6: "시설/구역", A7: "20240115", A8: "비고A8", A9: "비고A9", ...extra },
  geometry,
});

const db = new Database(":memory:");
initDataFileSchema(db, "reference");
const release = (sourceId) => insertRelease(db, {
  sourceId,
  provider: "test",
  sourceUrl: "https://example.invalid",
  sourceAsOf: "2026-09-01",
  fetchedAt: "2026-09-30T00:00:00Z",
  checksum: "test",
  licenseCode: "TEST",
  rights: DISTRICT_RIGHTS,
});
const districtRelease = release("district_unit");
const facilityRelease = release("facility_transport");
const stats = await buildDistricts(db, [
  {
    layer: { key: "unit", sourceId: "district_unit", title: "미정 구역", kind: "district_area", cls: "지구단위계획" },
    releaseId: districtRelease,
    records: rows(
      record("Z1", square(127.149, 127.152, 37.623, 37.626), { A6: "지구단위계획" }),
      record("Z-invalid", { type: "LineString", coordinates: [[127.149, 37.624], [127.152, 37.624]] }, { A6: "잘못된 구역" }),
    ),
  },
  {
    layer: { key: "transport", sourceId: "facility_transport", title: "미정 교통시설", kind: "plan_facility", cls: "교통" },
    releaseId: facilityRelease,
    records: rows(
      record("F-area", square(127.1495, 127.1505, 37.624, 37.625), { A6: "도로" }),
      record("F-line", { type: "LineString", coordinates: [[127.140, 37.6245], [127.160, 37.6245]] }, { A6: "철도" }),
      record("F-point", { type: "Point", coordinates: [127.1507, 37.6245] }, { A6: "역" }),
    ),
  },
]);
assert.ok(stats.every((s) => s instanceof SourceStats));
assert.deepEqual(stats.map((s) => [s.sourceId, s.received, s.accepted, s.rejected]), [
  ["district_unit", 2, 1, 1],
  ["facility_transport", 3, 3, 0],
]);
assert.equal(stats[0].snapshot().fillRates.announcedDate, 1);
const stored = db.prepare("SELECT kind, name, legal_code, properties_json FROM feature ORDER BY feature_id").all();
assert.equal(stored[0].kind, "district_area");
assert.equal(stored[0].legal_code, "4136000000");
assert.equal(JSON.parse(stored[0].properties_json).shapeKind, "polygon");
assert.equal(JSON.parse(stored[1].properties_json).shapeKind, "polygon");
assert.equal(JSON.parse(stored[3].properties_json).shapeKind, "point");

const manifest = {
  version: "test",
  createdAt: "2026-09-30T00:00:00Z",
  files: { reference: { path: "reference.sqlite", sha256: "", kind: "reference", schemaVersion: 2 } },
};
const makeContext = (handle) => new EngineContext("", manifest, "district-test", {
  address: "경기도 남양주시 다산동",
  center,
  radiusM: 800,
  analysisDate: "2026-09-30",
}, { reference: handle });

const district = d11(makeContext(db));
assert.equal(district.status, "partial");
assert.equal(district.tileType, "diagram");
assert.equal(district.provenance.sources[0].sourceId, "district_unit");
assert.ok(district.metrics.some((m) => m.id === "back_area_지구단위계획" && m.value > 0));
assert.ok(district.metrics.some((m) => m.id === "fill_code_pct" && m.value > 0));
assert.ok(district.presentation.polygons.some((p) => p.layer === "district:지구단위계획"));

const facility = d12(makeContext(db));
assert.equal(facility.status, "partial");
assert.equal(facility.provenance.sources[0].sourceId, "facility_transport");
assert.ok(facility.metrics.some((m) => m.id === "back_area_교통" && m.value > 0));
assert.ok(facility.metrics.some((m) => m.id === "back_length_교통" && m.value > 0));
assert.ok(facility.metrics.some((m) => m.id === "back_count_교통" && m.value === 1));
assert.ok(facility.presentation.polygons.some((p) => p.layer === "facility:교통"));
assert.ok(facility.presentation.features.some((f) => f.layer === "facility:교통"));
assert.ok(facility.limitations.some((l) => l.kind === "unknown" && l.note.includes("운영")));

const empty = new Database(":memory:");
initDataFileSchema(empty, "reference");
const missingD11 = d11(makeContext(empty));
const missingD12 = d12(makeContext(empty));
assert.equal(missingD11.status, "not_provided");
assert.equal(missingD12.status, "not_provided");
assert.ok(missingD11.limitations.some((l) => l.note.includes("dsId 24 다운로드 필요")));
assert.ok(missingD12.limitations.some((l) => l.note.includes("dsId 24 다운로드 필요")));

empty.close();
db.close();
console.log("v2 districts: ok");
