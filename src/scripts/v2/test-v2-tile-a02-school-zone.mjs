/** D26 도형·대지 강조·뒷면 집계와 A02 배정 학교/학교군 보고. */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { toLngLat, toUtmk } = await import("../../lib/v2/crs.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const { insertRelease, buildAndPublish } = await import("../../lib/v2/ingest/build.ts");
const { buildPointSource } = await import("../../lib/v2/ingest/sources/points.ts");
const { buildSchoolZoneLinks, SCHOOL_SPEC } = await import("../../lib/v2/ingest/sources/school-kapt.ts");
const { buildSchoolZones, readSchoolZoneGeoJson, SCHOOL_ZONE_RIGHTS } = await import("../../lib/v2/ingest/sources/school-zones.ts");
const { csvRecords } = await import("../../lib/v2/a0/measure.ts");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { a02 } = await import("../../lib/v2/tile/a02/engine.ts");
const { TILES } = await import("../../lib/v2/engine/run.ts");
const a02WithSchoolZones = TILES.find(([code]) => code === "A02")[1];
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { a02ClientModule } = await import("../../lib/v2/tile/a02/view.ts");
const { filterMapForLayer } = await import("../../lib/v2/ui/tile-layers.ts");
const { formatDistanceM } = await import("../../lib/v2/ui/tile-view.ts");
const { layerStyle } = await import("../../lib/v2/ui/map-layers.ts");

const fx = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const CENTER = [128.5978756, 35.8808955];
const [cx, cy] = toUtmk(CENTER);
const at = (dx, dy) => toLngLat([cx + dx, cy + dy]);
const around = (id, name, edu, dx, dy, objectid) => ({
  type: "Feature",
  properties: { objectid, hakgudo_id: id, hakgudo_nm: name, hakgudo_gb: "0", sd_cd: "27", sgg_cd: "230", edu_up_nm: edu, edu_nm: "테스트교육지원청", base_dt: "2026-03-20" },
  geometry: { type: "Polygon", coordinates: [[at(dx - 400, dy - 300), at(dx + 400, dy - 300), at(dx + 400, dy + 300), at(dx - 400, dy + 300), at(dx - 400, dy - 300)]] },
});

const dataDir = mkdtempSync(join(tmpdir(), "v2-d26-"));
const versionDir = join(dataDir, "versions", "v1");
mkdirSync(versionDir, { recursive: true });
const referencePath = join(versionDir, "reference.sqlite");
const db = new Database(referencePath);
initDataFileSchema(db, "reference");
const rel = (sourceId, rights = {}) => insertRelease(db, { sourceId, provider: "test", sourceUrl: "https://example.invalid", sourceAsOf: "2026-03-20", fetchedAt: "2026-10-01T00:00:00Z", checksum: sourceId, licenseCode: "TEST", rights });
const zoneRelease = rel("school_zone", SCHOOL_ZONE_RIGHTS);
const sourceFeatures = readSchoolZoneGeoJson(fx("school-zone-vworld-sample.json"));
await buildSchoolZones(db, [
  { layer: "elem", releaseId: zoneRelease, records: [...sourceFeatures.filter((f) => String(f.properties?.hakgudo_id).startsWith("Z0001")), around("Z000100999", "비대상초등학구", "대구광역시교육청", 600, 0, "1002")] },
  { layer: "middle", releaseId: zoneRelease, records: [around("Z000200001", "테스트중학교군", "대구광역시교육청", 0, 0, "2001")] },
  { layer: "high", releaseId: zoneRelease, records: [around("Z000300001", "테스트고등학교군", "대구광역시교육청", 0, 0, "3001")] },
]);
const schoolRelease = rel("school");
await buildPointSource(db, SCHOOL_SPEC, (await csvRecords(fx("school-sample.csv"))).records, schoolRelease);
insertFeature(db, { stableId: "school:test-middle", kind: "school", sourceKey: "test-middle", releaseId: schoolRelease, geometry: { type: "Point", coordinates: at(200, 0) }, name: "테스트중학교", properties: { schoolId: "test-middle", level: "중학교", operatingStatus: "운영" } });
insertFeature(db, { stableId: "school:test-high", kind: "school", sourceKey: "test-high", releaseId: schoolRelease, geometry: { type: "Point", coordinates: at(300, 0) }, name: "테스트고등학교", properties: { schoolId: "test-high", level: "고등학교", operatingStatus: "운영" } });
const linkRelease = rel("school_zone_link");
const attrRelease = rel("school_zone_elem");
const zoneIds = new Set(db.prepare("SELECT stable_id FROM feature WHERE kind LIKE 'school_zone_%'").pluck().all());
await buildSchoolZoneLinks(db, {
  link: (await csvRecords(fx("school-zone-link-sample.csv"))).records,
  elem: (await csvRecords(fx("school-zone-elem-sample.csv"))).records,
  linkReleaseId: linkRelease,
  elemReleaseId: attrRelease,
  zoneIds,
});
db.close();

const manifest = {
  version: "v1",
  createdAt: "2026-10-01T00:00:00Z",
  files: { reference: { path: "versions/v1/reference.sqlite", sha256: await M.sha256File(referencePath), kind: "reference", schemaVersion: 2 } },
};
assert.equal((await M.publishManifest(dataDir, manifest, () => ({ ok: true, failures: [] }))).published, true);
const ctx = new EngineContext(dataDir, M.readManifest(dataDir), "d26-test", { address: "대구광역시 북구 칠성동2가 395-1", center: CENTER, radiusM: 800, analysisDate: "2026-10-01" });

const d = parseTileResult(a02WithSchoolZones(ctx));
const metric = (id) => d.metrics.find((m) => m.id === id);
assert.equal(d.tileCode, "A02");
assert.equal(d.status, "partial", "A02의 직선거리·배정 한계를 포함한 통합 타일");
assert.deepEqual([metric("back_elem_count").value, metric("back_middle_count").value, metric("back_high_count").value], [2, 1, 1]);
assert.deepEqual([metric("site_elem_zone").value, metric("site_middle_group").value, metric("site_high_group").value], [1, 1, 1]);
assert.equal(d.presentation.polygons.length, 5, "세 급별 반경 폴리곤 파트와 비대상 학구");
assert.deepEqual(d.presentation.polygons.map((p) => p.layer).sort(), ["school_zone_elem", "school_zone_elem_site", "school_zone_elem_site", "school_zone_high_site", "school_zone_middle_site"]);
const siteZonePolygons = d.presentation.polygons.filter((p) => p.layer.endsWith("_site"));
assert.ok(siteZonePolygons.every((p) => p.label === null && p.name && p.sublabel === null && p.labelPriority === 2), "대상 학구만 원천 구역명·priority 2");
assert.ok(siteZonePolygons.every((p) => !p.name.includes("교육청")), "대상 학구 name에 교육청을 반복하지 않음");
const nonSiteZonePolygons = d.presentation.polygons.filter((p) => p.layer === "school_zone_elem");
assert.equal(nonSiteZonePolygons.length, 1);
assert.deepEqual(
  { label: nonSiteZonePolygons[0].label, name: nonSiteZonePolygons[0].name, sublabel: nonSiteZonePolygons[0].sublabel, labelPriority: nonSiteZonePolygons[0].labelPriority },
  { label: null, name: null, sublabel: null, labelPriority: 0 },
  "비대상 학구는 자동·호버 라벨을 내지 않음",
);
for (const [layer, expectedName] of [["school_nearest", "대구옥산초등학교"], ["school_middle", "테스트중학교"], ["school_high", "테스트고등학교"]]) {
  const nearest = d.presentation.features.filter((f) => f.layer === layer && f.highlight);
  assert.equal(nearest.length, 1, `${layer} 최근접 highlight`);
  assert.equal(nearest[0].name, expectedName);
  assert.equal(nearest[0].sublabel, formatDistanceM(nearest[0].distanceM), `${layer} 거리 sublabel`);
  assert.equal(nearest[0].labelPriority, 2, `${layer} 최근접 priority`);
}
assert.equal(layerStyle("school_elem").label, "초등학교");
assert.equal(layerStyle("school_zone_elem_site").label, "대상 초등 통학구역");
const zoneSource = d.provenance.sources.find((source) => source.sourceId === "school_zone");
assert.ok(zoneSource, "A02 통합 결과에 D26 학구도 출처 보존");
assert.equal(zoneSource.sourceAsOf, "2026-03-20");
assert.ok(toTileView(d).chart.some((row) => row.label === "반경 내 초등 통학구역" && row.value === 2));
assert.deepEqual(a02ClientModule.layers.baseExcludes, ["school_zone"], "A02 기본 보기에서 흡수 학구 레이어 제외");
const a02BaseMap = filterMapForLayer(d.presentation, "A02", "all");
assert.ok(a02BaseMap);
assert.equal(a02BaseMap.polygons?.some((polygon) => polygon.layer.startsWith("school_zone")), false, "A02 기본 보기에는 학구 면을 중복 표시하지 않음");

const a = parseTileResult(a02(ctx));
const am = (id) => a.metrics.find((m) => m.id === id);
assert.equal(am("in_school_zone").value, 1);
assert.equal(am("assigned_elem_schools").value, 1);
assert.deepEqual([am("middle_school_groups").value, am("high_school_groups").value], [1, 1]);
assert.match(a.judgment.sentence, /대구옥산초등학교/);
assert.match(a.judgment.sentence, /테스트중학교군/);
assert.match(a.judgment.sentence, /테스트고등학교군/);
assert.doesNotMatch(JSON.stringify(a), /통학구역 도형 미확보/);
assert.doesNotMatch(JSON.stringify(toTileView(a)), /도보|\d\s*분|종합/);

// counted: 그래프 학교 수 = 엔진이 반경 안에서 센 학교 수(초·중·고 합). 250 m는 고등학교(300 m)가 반경 밖이라 지도에서 빠진다.
{
  const { viewWithLayer } = await import("../../lib/v2/ui/tile-view.ts");
  const { analysisCharts } = await import("../../lib/v2/report/analysis-charts.ts");
  for (const radiusM of [800, 250]) {
    const countCtx = new EngineContext(dataDir, M.readManifest(dataDir), `a02-counted-${radiusM}`, { address: "대구광역시 북구 칠성동2가 395-1", center: CENTER, radiusM, analysisDate: "2026-10-01" });
    const tile = parseTileResult(a02WithSchoolZones(countCtx));
    const engineSchools = ["elem_schools", "middle_schools", "high_schools"].reduce((sum, id) => sum + tile.metrics.find((m) => m.id === id).value, 0);
    const schools = tile.presentation.features.filter((f) => f.layer.startsWith("school_"));
    assert.ok(schools.length > 0 && schools.every((f) => f.counted === true), `${radiusM} m: 그린 학교는 모두 counted`);
    const view = toTileView(tile);
    const chart = analysisCharts(viewWithLayer(view, view.defaultLayer).map);
    assert.ok(chart, `${radiusM} m: A02는 학교·곳을 밝혀 그래프가 나온다`);
    assert.equal(chart.total, engineSchools, `${radiusM} m: 그래프 학교 수 = 엔진 학교 수(${engineSchools})`);
    assert.equal(chart.subject + chart.countUnit, "학교곳");
    countCtx.close();
  }
}
ctx.close();
console.log("✓ v2 D26/A02 school-zone engine");
