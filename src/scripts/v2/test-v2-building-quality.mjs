/** 건물 수 기준·철거 잔존 후보·PNU 준공일 보충의 회귀 단언. */
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
const { buildScene } = await import("../../lib/v2/engine/scene.ts");
const { d04 } = await import("../../lib/v2/engine/tiles/d04.ts");
const { s01 } = await import("../../lib/v2/engine/tiles/s01.ts");
const {
  BUILDING_SOURCES,
  buildingRetirementLimitations,
  buildingRetirementInfo,
  buildingRows,
  filterRetiredRows,
  isCounted,
} = await import("../../lib/v2/engine/tiles/buildings-shared.ts");

const CENTER = [127.1506, 37.6245];
const [CX, CY] = toUtmk(CENTER);
const at = (x, y) => toLngLat([CX + x, CY + y]);
const rectangle = (x0, x1, y0, y1) => ({
  type: "Polygon",
  coordinates: [[at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)]],
});
const utmRectangle = (x0, x1, y0, y1) => ({
  type: "Polygon",
  coordinates: [[[CX + x0, CY + y0], [CX + x1, CY + y0], [CX + x1, CY + y1], [CX + x0, CY + y1], [CX + x0, CY + y0]]],
});
const PNU = "4136011800101000000";
const REPARCEL_OLD_PNU = "4136011800102000001";
const REPARCEL_CURRENT_PNU = "4136011800102000002";
const SAME_PNU = "4136011800103000001";
const SMALL_GAP_OLD_PNU = "4136011800104000001";
const SMALL_GAP_CURRENT_PNU = "4136011800104000002";
const NO_PNU_CURRENT_PNU = "4136011800105000001";

const dataDir = mkdtempSync(join(tmpdir(), "v2-building-quality-"));
const versionDir = join(dataDir, "versions", "v1");
mkdirSync(versionDir, { recursive: true });

const corePath = join(versionDir, "core.sqlite");
const core = new Database(corePath);
initDataFileSchema(core, "core");
const ledgerRelease = insertRelease(core, {
  sourceId: "ledger_recap",
  provider: "테스트 대장",
  sourceUrl: "https://example.invalid/ledger",
  sourceAsOf: "2026-10-01",
  fetchedAt: "2026-10-01T00:00:00Z",
  checksum: "quality-core",
  licenseCode: "TEST",
});
insertFeature(core, {
  stableId: "recap:quality",
  kind: "housing_complex",
  sourceKey: "quality",
  releaseId: ledgerRelease,
  geometry: { type: "Point", coordinates: at(0, 0) },
  pnu: PNU,
  name: "신단지",
  properties: { source: "recap", approvalDate: "2020-01-01" },
});
const addCoreApproval = (pnu, x, approvalDate, kind = "housing_complex") => insertFeature(core, {
  stableId: `recap:current-${pnu}`,
  kind,
  sourceKey: pnu,
  releaseId: ledgerRelease,
  geometry: { type: "Point", coordinates: [CX + x, CY] },
  geometryIsUtmk: true,
  pnu,
  name: "현재 단지",
  properties: { source: "recap", approvalDate },
});
// 현재 필지 규칙의 네 회귀 경우: 재구획·동일 PNU·10년 미만 차이·GIS PNU 없음.
addCoreApproval(REPARCEL_CURRENT_PNU, -250, "2019-09-27");
addCoreApproval(SAME_PNU, -450, "2019-09-27", "officetel");
addCoreApproval(SMALL_GAP_CURRENT_PNU, 350, "1993-12-28");
addCoreApproval(NO_PNU_CURRENT_PNU, 550, "2019-09-27");
core.close();

const buildingsPath = join(versionDir, "buildings.sqlite");
const buildings = new Database(buildingsPath);
initDataFileSchema(buildings, "buildings");
const gisRelease = insertRelease(buildings, {
  sourceId: "building",
  provider: "테스트 GIS",
  sourceUrl: "https://example.invalid/gis",
  sourceAsOf: "2026-10-01",
  fetchedAt: "2026-10-01T00:00:00Z",
  checksum: "quality-gis",
  licenseCode: "TEST",
});
const jusoRelease = insertRelease(buildings, {
  sourceId: "building_juso",
  provider: "테스트 도로명주소",
  sourceUrl: "https://example.invalid/juso",
  sourceAsOf: "2026-10-01",
  fetchedAt: "2026-10-01T00:00:00Z",
  checksum: "quality-juso",
  licenseCode: "TEST",
});
const fact = buildings.prepare("INSERT INTO building_fact (feature_id, ledger_pk, height_m, height_method, floors_above, floors_below, use_code, approval_date, gross_floor_area_m2, footprint_area_m2, field_provenance_json) VALUES (?, NULL, 10, 'source', 3, NULL, '01000', ?, NULL, ?, '{}')");
const add = ({ stableId, releaseId, geometry, name, pnu = null, approvalDate = null }) => {
  const featureId = insertFeature(buildings, {
    stableId,
    kind: "building",
    sourceKey: stableId,
    releaseId,
    geometry,
    name,
    pnu,
  });
  fact.run(featureId, approvalDate, 400);
};
// 30% overlap, old name and older GIS date: the only excluded row.
add({ stableId: "building:retired", releaseId: gisRelease, geometry: rectangle(-10, 10, -10, 10), name: "옛단지", pnu: PNU, approvalDate: "1983-12-29" });
add({ stableId: "juso:replacement", releaseId: jusoRelease, geometry: rectangle(4, 24, -10, 10), name: "신단지", pnu: PNU });
// Same overlap and newer ledger date, but unchanged name: conservative keep.
add({ stableId: "building:same-name", releaseId: gisRelease, geometry: rectangle(-100, -80, -10, 10), name: "같은건물", pnu: PNU, approvalDate: "1983-12-29" });
add({ stableId: "juso:same-name", releaseId: jusoRelease, geometry: rectangle(-94, -74, -10, 10), name: "같은건물", pnu: PNU });
// Missing current name: conservative keep even though the geometry is partial.
add({ stableId: "building:unnamed-current", releaseId: gisRelease, geometry: rectangle(100, 120, -10, 10), name: "옛이름", pnu: PNU, approvalDate: "1983-12-29" });
add({ stableId: "juso:unnamed-current", releaseId: jusoRelease, geometry: rectangle(106, 126, -10, 10), name: null, pnu: PNU });
// 90% overlap is outside the documented 20% inclusive to 50% exclusive band.
add({ stableId: "building:high-overlap", releaseId: gisRelease, geometry: rectangle(200, 220, -10, 10), name: "옛고층", pnu: PNU, approvalDate: "1983-12-29" });
add({ stableId: "juso:high-overlap", releaseId: jusoRelease, geometry: rectangle(202, 222, -10, 10), name: "새고층", pnu: PNU });
// Intersects the radius but its centroid is outside: it remains available to scene/3D.
add({ stableId: "juso:edge", releaseId: jusoRelease, geometry: rectangle(795, 835, -10, 10), name: "경계건물" });
// 현재 필지 규칙 fixture. 이름·juso 겹침이 없어도 PNU 재구획 근거만으로 판정되어야 한다.
add({ stableId: "building:current-parcel-replot", releaseId: gisRelease, geometry: rectangle(-260, -240, -10, 10), name: null, pnu: REPARCEL_OLD_PNU, approvalDate: "1983-12-29" });
add({ stableId: "building:current-parcel-same-pnu", releaseId: gisRelease, geometry: rectangle(-460, -440, -10, 10), name: "같은 필지 옛 건물", pnu: SAME_PNU, approvalDate: "1983-12-29" });
add({ stableId: "building:current-parcel-small-gap", releaseId: gisRelease, geometry: rectangle(340, 360, -10, 10), name: "간격 작은 옛 건물", pnu: SMALL_GAP_OLD_PNU, approvalDate: "1983-12-29" });
add({ stableId: "building:current-parcel-no-pnu", releaseId: gisRelease, geometry: rectangle(540, 560, -10, 10), name: "PNU 없는 옛 건물", approvalDate: "1983-12-29" });
buildings.close();

const parcelsPath = join(versionDir, "parcels.sqlite");
const parcels = new Database(parcelsPath);
initDataFileSchema(parcels, "parcels");
const parcelRelease = insertRelease(parcels, {
  sourceId: "parcel_polygon",
  provider: "테스트 연속지적도",
  sourceUrl: "https://example.invalid/parcels",
  sourceAsOf: "2026-10-01",
  fetchedAt: "2026-10-01T00:00:00Z",
  checksum: "quality-parcels",
  licenseCode: "TEST",
});
const addParcel = (pnu, x) => insertFeature(parcels, {
  stableId: `parcel:${pnu}`,
  kind: "parcel",
  sourceKey: pnu,
  releaseId: parcelRelease,
  geometry: utmRectangle(x - 40, x + 40, -40, 40),
  geometryIsUtmk: true,
  pnu,
  legalCode: "4136011800",
  properties: { jimok: "대", areaM2: 6400 },
});
addParcel(REPARCEL_CURRENT_PNU, -250);
addParcel(SAME_PNU, -450);
addParcel(SMALL_GAP_CURRENT_PNU, 350);
addParcel(NO_PNU_CURRENT_PNU, 550);
parcels.close();

const manifest = {
  version: "v1",
  createdAt: "2026-10-01T00:00:00Z",
  files: {
    core: { path: "versions/v1/core.sqlite", kind: "core", schemaVersion: 2 },
    buildings: { path: "versions/v1/buildings.sqlite", kind: "buildings", schemaVersion: 2 },
    parcels: { path: "versions/v1/parcels.sqlite", kind: "parcels", schemaVersion: 2 },
  },
};
manifest.files.core.sha256 = await M.sha256File(corePath);
manifest.files.buildings.sha256 = await M.sha256File(buildingsPath);
manifest.files.parcels.sha256 = await M.sha256File(parcelsPath);
const published = await M.publishManifest(dataDir, manifest, () => ({ ok: true, failures: [] }));
assert.equal(published.published, true);

const ctx = new EngineContext(dataDir, M.readManifest(dataDir), "building-quality", {
  address: "테스트",
  center: CENTER,
  radiusM: 800,
  analysisDate: "2026-10-06",
  pnu: null,
});
const rows = buildingRows(ctx);
assert.ok(rows);
assert.deepEqual(BUILDING_SOURCES, ["building", "building_juso", "gis_bldg"]);
assert.equal(buildingRetirementInfo(ctx).candidatePairs, 1);
assert.equal(buildingRetirementInfo(ctx).legacyExcludedCount, 1);
assert.equal(buildingRetirementInfo(ctx).currentParcelCandidatePairs, 1);
assert.equal(buildingRetirementInfo(ctx).currentParcelExcludedCount, 1);
assert.equal(buildingRetirementInfo(ctx).excludedCount, 2);
assert.ok(buildingRetirementInfo(ctx).excludedStableIds.includes("building:current-parcel-replot"));
const markedFixture = { ...rows.find((row) => row.hit.stableId === "building:same-name"), hit: { ...rows.find((row) => row.hit.stableId === "building:same-name").hit, properties: { retired: true, replacedBy: "juso:replacement" } } };
const markedSelection = filterRetiredRows([markedFixture]);
assert.equal(markedSelection.retirement.ingestMarkedCount, 1, "적재 retired 표시는 질의 시점에서 바로 제외");
assert.deepEqual(markedSelection.rows, []);
assert.deepEqual(rows.filter((row) => row.hit.stableId.includes("retired")), []);
assert.equal(rows.filter((row) => row.hit.stableId === "building:same-name").length, 1);
assert.equal(rows.filter((row) => row.hit.stableId === "building:current-parcel-same-pnu").length, 1, "같은 PNU면 유지");
assert.equal(rows.filter((row) => row.hit.stableId === "building:current-parcel-small-gap").length, 1, "승인일 차이가 10년 미만이면 유지");
assert.equal(rows.filter((row) => row.hit.stableId === "building:current-parcel-no-pnu").length, 1, "GIS PNU가 없으면 유지");
assert.equal(rows.filter((row) => row.hit.stableId === "building:current-parcel-replot").length, 0, "재구획된 현재 필지의 옛 GIS는 제외");
assert.equal(rows.filter((row) => row.hit.stableId === "juso:unnamed-current").length, 1);
assert.equal(rows.filter((row) => row.approvalDateSource === "core_ledger_pnu").length, 4);
assert.equal(rows.find((row) => row.hit.stableId === "juso:replacement").approvalDate, "2020-01-01");
assert.equal(rows.find((row) => row.hit.stableId === "juso:edge").approvalDate, null);
assert.equal(rows.filter((row) => isCounted(ctx, row)).length, 10);
assert.equal(isCounted(ctx, rows.find((row) => row.hit.stableId === "juso:edge")), false);
assert.ok(buildScene(ctx).buildings.some((building) => building.id === "juso:edge"), "교차 건물은 3D 장면에 남는다");
assert.ok(buildingRetirementLimitations(ctx)[0].note.includes("현재 필지"));
assert.equal(s01(ctx).metrics.find((metric) => metric.id === "buildings").value, 10);
const d04Tile = d04(ctx);
assert.equal(d04Tile.metrics.find((metric) => metric.id === "share_2020s").numerator, 4);
assert.ok(d04Tile.limitations.some((limitation) => limitation.note.includes("PNU")));
ctx.close();

console.log("✓ v2 building quality rules");
