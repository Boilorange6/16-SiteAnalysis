/** D11/D12: dsId 24 레이어 적재 계약과 면·선·점 도판. */
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease, SourceStats } = await import("../../lib/v2/ingest/build.ts");
const { buildDistricts, DISTRICT_LAYERS, DISTRICT_RIGHTS, districtLayerFiles } = await import("../../lib/v2/ingest/sources/districts.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { d11 } = await import("../../lib/v2/tile/d11/engine.ts");
const { d12 } = await import("../../lib/v2/tile/d12/engine.ts");

assert.deepEqual(DISTRICT_LAYERS.map(({ key, sourceId, title, kind, cls, fileTag }) => ({ key, sourceId, title, kind, cls, fileTag })), [
  { key: "area", sourceId: "district_area", title: "국토계획/구역", kind: "district_area", cls: "구역", fileTag: "AL_D140" },
  { key: "greenbelt", sourceId: "district_greenbelt", title: "개발제한구역지관리/개발제한구역", kind: "district_area", cls: "개발제한구역", fileTag: "AL_D032" },
  { key: "land_development", sourceId: "district_land_development", title: "택지개발/택지개발예정구역", kind: "district_area", cls: "택지개발예정지구", fileTag: "AL_D025" },
  { key: "urban_development", sourceId: "district_urban_development", title: "도시개발/도시개발구역", kind: "district_area", cls: "도시개발구역", fileTag: "AL_D033" },
  { key: "industrial", sourceId: "district_industrial", title: "산업입지/산업단지", kind: "district_area", cls: "산업단지", fileTag: "AL_D060" },
  { key: "transport", sourceId: "facility_transport", title: "국토계획/교통시설", kind: "plan_facility", cls: "교통", fileTag: "AL_D142" },
  { key: "space", sourceId: "facility_space", title: "국토계획/공간시설", kind: "plan_facility", cls: "공간", fileTag: "AL_D143" },
  { key: "distribution_supply", sourceId: "facility_distribution_supply", title: "국토계획/유통및공급시설", kind: "plan_facility", cls: "유통·공급", fileTag: "AL_D144" },
  { key: "public_culture_sports", sourceId: "facility_public_culture_sports", title: "국토계획/공공문화체육시설", kind: "plan_facility", cls: "공공·문화체육", fileTag: "AL_D145" },
  { key: "disaster_prevention", sourceId: "facility_disaster_prevention", title: "국토계획/방재시설", kind: "plan_facility", cls: "방재", fileTag: "AL_D146" },
  { key: "health_hygiene", sourceId: "facility_health_hygiene", title: "국토계획/보건위생시설", kind: "plan_facility", cls: "보건위생", fileTag: "AL_D147" },
  { key: "environmental_basic", sourceId: "facility_environmental_basic", title: "국토계획/환경기초시설", kind: "plan_facility", cls: "환경기초", fileTag: "AL_D148" },
  { key: "other_infrastructure", sourceId: "facility_other_infrastructure", title: "국토계획/기타기반시설", kind: "plan_facility", cls: "기타", fileTag: "AL_D149" },
]);
assert.match(DISTRICT_RIGHTS.basis, /15045898/);
assert.equal(districtLayerFiles(["/r/AL_D999_00_20260101.shp"], "AL_D999").size, 1);
const resolved = districtLayerFiles(DISTRICT_LAYERS.map((layer) => `/r/${layer.fileTag}_00_20260909.shp`));
assert.deepEqual([...resolved.keys()], DISTRICT_LAYERS.map((layer) => layer.key), "all 13 configured file tags resolve");
assert.deepEqual(resolved.get("other_infrastructure"), { date: "20260909", files: ["/r/AL_D149_00_20260909.shp"] });

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
const districtLayer = DISTRICT_LAYERS.find((layer) => layer.key === "area");
const facilityLayer = DISTRICT_LAYERS.find((layer) => layer.key === "transport");
const districtRelease = release(districtLayer.sourceId);
const facilityRelease = release(facilityLayer.sourceId);
const stats = await buildDistricts(db, [
  {
    layer: districtLayer,
    releaseId: districtRelease,
    records: rows(
      record("Z1", square(127.149, 127.152, 37.623, 37.626), { A5: "UQQ300", A6: "지구단위계획구역" }),
      record("Z2", square(127.1495, 127.1515, 37.6235, 37.6255), { A5: "UQQ200", A6: "시가화조정구역" }),
      record("Z-invalid", { type: "LineString", coordinates: [[127.149, 37.624], [127.152, 37.624]] }, { A6: "잘못된 구역" }),
    ),
  },
  {
    layer: facilityLayer,
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
  ["district_area", 3, 2, 1],
  ["facility_transport", 3, 3, 0],
]);
assert.equal(stats[0].snapshot().fillRates.announcedDate, 1);
const stored = db.prepare("SELECT kind, name, legal_code, properties_json FROM feature ORDER BY feature_id").all();
assert.equal(stored[0].kind, "district_area");
assert.equal(stored[0].legal_code, "4136000000");
assert.equal(stored[0].name, "지구단위계획구역");
assert.equal(JSON.parse(stored[0].properties_json).typeCode, "UQQ300");
assert.equal(JSON.parse(stored[0].properties_json).typeLabel, "지구단위계획구역");
assert.equal(JSON.parse(stored[0].properties_json).shapeKind, "polygon");
assert.equal(JSON.parse(stored[1].properties_json).shapeKind, "polygon");
assert.equal(JSON.parse(stored[4].properties_json).shapeKind, "point");

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
assert.equal(district.provenance.sources[0].sourceId, "district_area");
assert.ok(district.metrics.some((m) => m.id === "back_area_지구단위계획" && m.value > 0));
assert.ok(district.metrics.some((m) => m.id === "fill_code_pct" && m.value > 0));
assert.ok(district.presentation.polygons.some((p) => p.layer === "district:지구단위계획" && p.label === "지구단위계획구역"));
assert.ok(district.limitations.some((l) => l.note.includes("합계 100% 아님")));

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
assert.ok(missingD11.limitations.some((l) => l.note.includes("구역·지구 자료를 확인할 수 없습니다")));
assert.ok(missingD12.limitations.some((l) => l.note.includes("도시계획시설 자료를 확인할 수 없습니다")));

empty.close();
db.close();
console.log("v2 districts: ok");
