import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { DISTRICT_RIGHTS } = await import("../../lib/v2/ingest/sources/districts.ts");
const { toUtmk } = await import("../../lib/v2/crs.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { d11 } = await import("../../lib/v2/tile/d11/engine.ts");

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

const districtPolygon = {
  type: "Polygon",
  coordinates: [[
    [cx - 60, cy - 60],
    [cx + 60, cy - 60],
    [cx + 60, cy + 60],
    [cx - 60, cy + 60],
    [cx - 60, cy - 60],
  ]],
};

const db = new Database(":memory:");
initDataFileSchema(db, "reference");
insertRelease(db, {
  sourceId: "district_area",
  provider: "test",
  sourceUrl: "https://example.invalid",
  sourceAsOf: "2026-09-01",
  fetchedAt: "2026-09-30T00:00:00Z",
  checksum: "test",
  licenseCode: "TEST",
  rights: DISTRICT_RIGHTS,
});

const hits = Array.from({ length: 1234 }, (_, index) => ({
  featureId: index + 1,
  stableId: `district:${index + 1}`,
  kind: "district_area",
  releaseId: "district_area@2026-09-01",
  geometry: districtPolygon,
  name: null,
  pnu: null,
  legalCode: null,
  properties: {
    cls: "구역",
    typeLabel: "지구단위계획구역",
    typeCode: "UQQ300",
    remarkA8: "고덕지구단위계획구역",
    announcedDate: "2024-01-15",
    announcedRaw: "20240115",
  },
  distanceM: null,
}));

const contextFor = (districtHits) => {
  const ctx = new EngineContext("", manifest, "d11-regulation", input, { reference: db });
  // Keep source/conditions handling real while isolating the tile-local presentation cases.
  ctx.hits = () => districtHits;
  return ctx;
};

const formattedContext = contextFor(hits);
const formatted = d11(formattedContext);
const sentence = formatted.judgment?.sentence ?? "";
assert.match(sentence, /구역·지구 1,234건\([^)]*ha\)/, "D11 sentence uses grouped counts and a compact hectare area");
assert.doesNotMatch(sentence, /1234건/, "D11 sentence does not expose an ungrouped count");
assert.equal(metric(formatted, "fill_code_pct").status, "observed");
assert.equal(metric(formatted, "fill_code_pct").value, 100);
assert.equal(formatted.presentation.polygons?.length, 1234, "polygon output remains while representative-point features are removed");
assert.equal(formatted.presentation.features, undefined, "W0 removes polygon representative-point fallback features");
assert.ok(formatted.presentation.polygons.every((polygon) => polygon.name === "고덕지구단위계획구역"), "D11 polygon name comes from remark");
assert.ok(formatted.presentation.polygons.every((polygon) => polygon.sublabel === "2024 고시"), "D11 sublabel contains only the announcement year");
assert.ok(formatted.presentation.polygons.every((polygon) => polygon.labelPriority === 1), "D11 named polygons are automatic-label candidates");

const emptyContext = contextFor([]);
const empty = d11(emptyContext);
const emptyFill = metric(empty, "fill_code_pct");
assert.equal(emptyFill.status, "missing", "zero intersecting objects mean unknown code fill, not observed 0%");
assert.equal(emptyFill.value, null);
assert.equal(emptyFill.numerator, null);
assert.equal(emptyFill.denominator, null);
assert.match(empty.judgment?.sentence ?? "", /교차하는 구역·지구 도형이 확인되지 않음/);

formattedContext.close();
emptyContext.close();
db.close();
console.log("✓ v2 D11 regulation presentation and zero-fill contract");
