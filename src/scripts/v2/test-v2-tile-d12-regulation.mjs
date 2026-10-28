import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { DISTRICT_RIGHTS } = await import("../../lib/v2/ingest/sources/districts.ts");
const { toUtmk } = await import("../../lib/v2/crs.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { lineCandidate } = await import("../../lib/v2/engine/tiles/common.ts");
const { d12 } = await import("../../lib/v2/tile/d12/engine.ts");
const { d12ClientModule } = await import("../../lib/v2/tile/d12/view.ts");

const CENTER = [127.1506, 37.6245];
const [cx, cy] = toUtmk(CENTER);
const manifest = {
  version: "test",
  createdAt: "2026-09-30T00:00:00Z",
  files: { reference: { path: "reference.sqlite", sha256: "", kind: "reference", schemaVersion: 2 } },
};
const input = {
  address: "경기도 남양주시 다산동",
  center: CENTER,
  radiusM: 800,
  analysisDate: "2026-09-30",
  pnu: null,
};

const metric = (tile, id) => {
  const found = tile.metrics.find((item) => item.id === id);
  assert.ok(found, `${tile.tileCode}.${id}`);
  return found;
};

const line = {
  type: "LineString",
  coordinates: [[cx - 1600, cy], [cx + 1600, cy]],
};
const shortLine = {
  type: "LineString",
  coordinates: [[cx + 100, cy + 100]],
};
const facilityPolygon = {
  type: "Polygon",
  coordinates: [[
    [cx - 100, cy - 100],
    [cx + 100, cy - 100],
    [cx + 100, cy + 100],
    [cx - 100, cy + 100],
    [cx - 100, cy - 100],
  ]],
};
const point = { type: "Point", coordinates: [cx + 200, cy + 200] };

const db = new Database(":memory:");
initDataFileSchema(db, "reference");
insertRelease(db, {
  sourceId: "facility_transport",
  provider: "test",
  sourceUrl: "https://example.invalid",
  sourceAsOf: "2026-09-01",
  fetchedAt: "2026-09-30T00:00:00Z",
  checksum: "test",
  licenseCode: "TEST",
  rights: DISTRICT_RIGHTS,
});

const hit = (featureId, geometry, shapeKind, cls = "교통") => ({
  featureId,
  stableId: `facility:${featureId}`,
  kind: "plan_facility",
  releaseId: "facility_transport@2026-09-01",
  geometry,
  name: null,
  pnu: null,
  legalCode: null,
  properties: { cls, typeLabel: cls, shapeKind },
  distanceM: null,
});

const contextFor = (facilityHits) => {
  const ctx = new EngineContext("", manifest, "d12-regulation", input, { reference: db });
  // Source discovery and result parsing stay real; only the hit set is deterministic for this tile test.
  ctx.hits = () => facilityHits;
  return ctx;
};

assert.equal(d12ClientModule.headline.maxPrefix, "back_area_", "D12 headline uses the area metric family");
assert.equal(lineCandidate(99, "facility:교통", [[cx, cy]], 0), null, "a one-point clipped path is not a MapLine");

const facilityContext = contextFor([
  hit(1, line, "line"),
  hit(2, shortLine, "line"),
  hit(3, facilityPolygon, "polygon", "공간"),
  hit(4, point, "point"),
]);
const facility = d12(facilityContext);
const sentence = facility.judgment?.sentence ?? "";
assert.match(sentence, /도시계획시설 4건\([^)]*4ha[^)]*1,600m[^)]*1개\)/, "D12 sentence groups area, length, and count values");
assert.equal(metric(facility, "back_length_교통").value, 1600);
assert.equal(facility.presentation.lines?.length, 1, "a clipped facility line becomes one MapLine");
assert.equal(facility.presentation.lines?.[0]?.points.length >= 2, true);
assert.equal(facility.presentation.lines?.[0]?.layer, "facility:교통");
assert.equal(facility.presentation.features?.length, 1, "only actual point facilities remain in features");
assert.equal(facility.presentation.features?.some((feature) => feature.fid === "1"), false, "line facilities do not produce a sampled feature chain");
assert.equal(facility.presentation.features?.some((feature) => feature.fid === "3"), false, "polygon facilities do not produce representative-point features");
assert.equal(facility.presentation.features?.some((feature) => feature.fid === "4"), true, "the real point facility remains in features");
const polygonFacility = facility.presentation.polygons?.find((polygon) => polygon.fid === "3");
assert.equal(polygonFacility?.name, "공간", "D12 polygon name is the source facility type");
assert.equal(polygonFacility?.sublabel, "4ha", "D12 polygon sublabel is the formatted area");
assert.equal(polygonFacility?.labelPriority, 1, "D12 named polygons are automatic-label candidates");
const lineFacility = facility.presentation.lines?.find((candidate) => candidate.fid === "1");
assert.equal(lineFacility?.name, "교통", "D12 line name is the source facility type");
assert.equal(lineFacility?.sublabel, "1,600m", "D12 line sublabel is the formatted length");
assert.equal(lineFacility?.labelPriority, 1, "D12 named lines are automatic-label candidates");
const pointFacility = facility.presentation.features?.find((feature) => feature.fid === "4");
assert.equal(pointFacility?.name, "교통", "D12 point name is the source facility type");
assert.equal(pointFacility?.sublabel, null, "D12 point has no value sublabel");
assert.equal(pointFacility?.labelPriority, 1, "D12 named points are automatic-label candidates");
assert.equal(new Set(facility.presentation.polygons?.map((polygon) => polygon.fid) ?? []).has("1"), false, "D12 line fid is not duplicated as a polygon");
assert.equal(new Set(facility.presentation.features?.map((feature) => feature.fid) ?? []).has("3"), false, "D12 polygon fid is not duplicated as a point");
for (const [lng, lat] of facility.presentation.lines?.[0]?.points ?? []) {
  const [x, y] = toUtmk([lng, lat]);
  assert.ok(Math.hypot(x - cx, y - cy) <= 801, "MapLine endpoints stay within the analysis radius");
}

const outsideContext = contextFor([hit(5, {
  type: "LineString",
  coordinates: [[cx + 1200, cy], [cx + 1600, cy]],
}, "line")]);
const outside = d12(outsideContext);
assert.equal(outside.presentation.lines, undefined, "a line wholly outside the radius has no zero-length MapLine");
assert.equal(outside.metrics.some((item) => item.id === "back_length_교통"), false, "out-of-radius zero fill stays missing rather than observed 0");

// ── counted: 그래프 시설 수 = 엔진이 센 시설 수(문장의 「N건」). 북쪽 반경 가장자리(799.7~800 m)에 0.3 m만 걸친 면은 엔진(UTM-K)에선 안이지만
//    그래프(구 모양 웹 메르카토르)는 남북 거리를 0.3 % 길게 재 802.6 m로 밖에 둔다 — counted를 떼면 5건이 4건으로 줄어든다(음성 대조).
{
  const { toTileView, viewWithLayer } = await import("../../lib/v2/ui/tile-view.ts");
  const { analysisCharts } = await import("../../lib/v2/report/analysis-charts.ts");
  const box = (x0, x1, y0, y1) => ({ type: "Polygon", coordinates: [[[cx + x0, cy + y0], [cx + x1, cy + y0], [cx + x1, cy + y1], [cx + x0, cy + y1], [cx + x0, cy + y0]]] });
  const countCtx = contextFor([
    hit(11, box(-100, 100, -100, 100), "polygon", "공간"),
    hit(12, box(-20, 20, 799.7, 900), "polygon", "교통"), // 북쪽 반경 가장자리에 걸친 가는 조각
    hit(13, line, "line", "교통"),
    hit(14, point, "point", "교통"),
    hit(15, { type: "LineString", coordinates: [[cx - 300, cy + 300], [cx + 300, cy + 300]] }, "line", "공간"),
  ]);
  const counted = d12(countCtx);
  const engineCount = Number(/도시계획시설 (\d+)건/.exec(counted.judgment.sentence)?.[1]);
  assert.equal(engineCount, 5, "문장의 건수(전제)");
  assert.ok([...(counted.presentation.polygons ?? []), ...(counted.presentation.features ?? []), ...(counted.presentation.lines ?? [])].every((item) => item.counted === true), "그린 시설은 모두 counted");
  const view = toTileView(counted);
  const chart = analysisCharts(viewWithLayer(view, view.defaultLayer).map);
  assert.ok(chart, "D12는 도시계획시설·건을 밝혀 그래프가 나온다");
  assert.equal(chart.total, engineCount, "그래프 시설 수 = 엔진 시설 수(면·선·점 합)");
  assert.equal(chart.subject + chart.countUnit, "도시계획시설건");
  countCtx.close();
}

facilityContext.close();
outsideContext.close();
db.close();
console.log("✓ v2 D12 regulation MapLine and zero-fill contract");
