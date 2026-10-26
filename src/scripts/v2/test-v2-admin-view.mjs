import assert from "node:assert/strict";

const { groupSources, filterTiles, sourceLinkForTile, tilesForSource } = await import("../../lib/v2/admin/admin-view.ts");

const source = (overrides = {}) => ({
  sourceId: "zoning_urban",
  name: "도시지역 용도지역",
  provider: "테스트 제공처",
  url: "",
  asOf: "2025-12-01",
  fetchedAt: null,
  ageDays: 321,
  license: "제한 없음",
  group: "용도지역 5종",
  collect: "수동 파일",
  cycle: "일별",
  expected: null,
  accepted: null,
  rejected: null,
  fileKey: null,
  runtime: false,
  usedBy: ["A12"],
  ...overrides,
});

const sources = [
  source({ sourceId: "zoning_urban", name: "도시지역" }),
  source({ sourceId: "zoning_management", name: "관리지역" }),
  source({ sourceId: "zoning_agri_forest", name: "농림지역" }),
  source({ sourceId: "zoning_nature", name: "자연환경보전지역" }),
  source({ sourceId: "zoning_other", name: "기타 용도지역" }),
  source({ sourceId: "parcel", name: "연속지적도형정보", group: null, asOf: null, ageDays: null, usedBy: ["A12"] }),
];

const rows = groupSources(sources);
const zoning = rows.find((row) => row.key === "용도지역 5종");
assert.ok(zoning);
assert.equal(zoning.label, "용도지역 5종");
assert.equal(zoning.sourceIds.length, 5);
assert.equal(zoning.warn, "stale");
assert.equal(rows.find((row) => row.key === "parcel")?.warn, "missing");

const tile = (overrides = {}) => ({
  code: "A12",
  title: "토지·용도지역",
  kind: "analysis",
  forms: ["vector"],
  declaredSources: ["parcel", "zoning_urban"],
  actualSources: ["parcel", "zoning_urban"],
  check: { status: "ok", missingFromCatalog: [], unusedInCatalog: [] },
  resultStatus: "complete",
  heavy: false,
  dateIndependent: false,
  siteDependent: true,
  cut: false,
  detail: true,
  reportHook: false,
  absorbs: [],
  cacheVersion: "test",
  files: [],
  orphan: false,
  ...overrides,
});

const tiles = [
  tile(),
  tile({ code: "D17", title: "지형·등고선", kind: "diagram", resultStatus: "pending", check: { status: "mismatch", missingFromCatalog: ["terrain_tiles"], unusedInCatalog: [] }, declaredSources: ["building"], actualSources: ["building", "terrain_tiles"] }),
  tile({ code: "S03", title: "바람 흐름 탐색", kind: "simulation", resultStatus: "failed", actualSources: null, check: { status: "unknown", missingFromCatalog: [], unusedInCatalog: [] }, declaredSources: ["building"] }),
];

assert.deepEqual(filterTiles(tiles, "mismatch", {}), [tiles[1]]);
assert.deepEqual(filterTiles(tiles, "pending", {}), [tiles[1], tiles[2]]);
assert.deepEqual(filterTiles(tiles, "requests", { A12: 0, D17: 2 }), [tiles[1]]);
assert.deepEqual(filterTiles(tiles, "analysis", {}), [tiles[0]]);
assert.deepEqual(filterTiles(tiles, "diagram", {}), [tiles[1]]);
assert.deepEqual(filterTiles(tiles, "simulation", {}), [tiles[2]]);

const usedRow = { ...zoning, sourceIds: ["building"] };
assert.equal(sourceLinkForTile(usedRow, tile({ declaredSources: ["building"], actualSources: ["building"] })), "used");
assert.equal(sourceLinkForTile(usedRow, tile({ declaredSources: [], actualSources: ["building"] })), "missingFromCatalog");
assert.equal(sourceLinkForTile(usedRow, tile({ declaredSources: ["building"], actualSources: [] })), "unusedInCatalog");
assert.equal(sourceLinkForTile(usedRow, tile({ declaredSources: ["parcel"], actualSources: ["parcel"] })), "none");
assert.deepEqual([...tilesForSource(usedRow, [
  tile({ code: "A01", declaredSources: ["building"], actualSources: [] }),
  tile({ code: "A02", declaredSources: ["parcel"], actualSources: ["building"] }),
  tile({ code: "A03", declaredSources: ["parcel"], actualSources: ["parcel"] }),
])], ["A01", "A02"]);

console.log("✓ admin view logic");
