import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import Database from "better-sqlite3";

const { buildEngineFixture, CENTER, at } = await import("./engine-fixture.mjs");
const { toUtmk } = await import("../../lib/v2/crs.ts");
const { readManifest } = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { DETAIL_SPECS, collectDetail, detailAt, detailCsv, getDetailList } = await import("../../lib/v2/engine/detail/registry.ts");
const { TILES } = await import("../../lib/v2/engine/run.ts");
const a12WithZoning = TILES.find(([code]) => code === "A12")[1];
const { createAnalysisRun, openV2AppDb } = await import("../../lib/v2/app-db.ts");

const dataDir = mkdtempSync(join(tmpdir(), "v2-detail-data-"));
const appDbPath = join(dataDir, "app.sqlite");
const appDb = openV2AppDb(appDbPath);
let ctx = null;

try {
  const manifestHash = await buildEngineFixture(dataDir, "detail", {
    buildings: true,
    parcels: true,
    roads: true,
    trades: true,
    weather: true,
    zoning: true,
  });
  const manifest = readManifest(dataDir);
  assert.ok(manifest);
  ctx = new EngineContext(dataDir, manifest, "detail-test", {
    address: "경기도 남양주시 다산동 100",
    center: CENTER,
    radiusM: 800,
    analysisDate: "2026-09-30",
    pnu: null,
  });

  const expectedCodes = [
    "A01", "A02", "A04", "A07", "A09", "A10", "A11", "A12",
    "D02", "D03", "D04", "D05", "D10", "D11", "D12", "D13", "D16", "D17", "D18", "D19", "D22", "D28", "D29", "S02",
  ];
  for (const code of expectedCodes) assert.ok(DETAIL_SPECS[code], `${code} detail spec`);
  assert.equal(DETAIL_SPECS.D15, undefined, "가구 도판은 sitedia 상세 대상이 아님");

  // 목록 예산은 디스크·네트워크가 아닌 상세 계산 자체를 1,500동·3,000필지로 검증한다.
  const [cx, cy] = toUtmk(CENTER);
  const fakeSources = [{ sourceId: "building", releaseId: "fixture", sourceAsOf: "2026-09-30", fetchedAt: "2026-09-30" }];
  const fakeColumns = (names) => ({ all: () => names.map((name) => ({ name })) });
  const syntheticBuildingHits = Array.from({ length: 1500 }, (_, index) => ({
    featureId: index + 1,
    stableId: `synthetic-building:${index}`,
    kind: "building",
    releaseId: "fixture",
    name: `building-${index}`,
    pnu: null,
    legalCode: null,
    properties: {},
    geometry: { type: "Point", coordinates: [cx + ((index % 50) - 25) * 20, cy + (Math.floor(index / 50) - 15) * 20] },
    distanceM: null,
  }));
  const syntheticBuildingDb = {
    prepare(sql) {
      if (sql.includes("PRAGMA table_info(feature)")) return fakeColumns(["feature_id", "stable_id", "kind", "release_id", "geom_json", "name", "pnu", "legal_code", "properties_json"]);
      if (sql.includes("PRAGMA table_info(building_fact)")) return fakeColumns(["feature_id", "height_m", "height_method", "floors_above", "use_code", "approval_date", "gross_floor_area_m2", "footprint_area_m2"]);
      return { all: (...ids) => ids.map((featureId) => ({ feature_id: featureId, height_m: 10, height_method: "source", floors_above: 3, use_code: "02000", approval_date: null, gross_floor_area_m2: 100, footprint_area_m2: 25 })) };
    },
  };
  const makeFakeContext = (file, hits, db, controls = {}) => {
    const memo = new Map();
    const hitKey = file === "reference" ? "parcels" : file;
    return {
      analysisId: "synthetic-detail",
      input: { address: "합성", center: CENTER, radiusM: 800, analysisDate: "2026-10-01", pnu: null },
      detailControls: controls,
      memo(key, compute) { if (!memo.has(key)) memo.set(key, compute()); return memo.get(key); },
      db(key) { return key === file ? db : null; },
      sources(key) { return key === file ? fakeSources : []; },
      hits(key) { return key === hitKey ? hits : []; },
    };
  };

  const housingHit = {
    featureId: 901,
    stableId: "housing:901",
    kind: "housing_complex",
    releaseId: "fixture",
    name: "타입 회귀 단지",
    pnu: "PNU-901",
    legalCode: null,
    properties: { mainUse: "공동주택", otherUse: "아파트", households: null, units: 4932, unitTypes: [{ typeM2: 59, units: 1964 }] },
    geometry: { type: "Point", coordinates: [cx, cy] },
    distanceM: 10,
  };
  const housingRows = DETAIL_SPECS.A05.rows(makeFakeContext("core", [housingHit], syntheticBuildingDb));
  assert.equal(housingRows[0].cells.households, 4932, "null households falls back to units instead of becoming zero");
  assert.equal(housingRows[0].cells.unit_types, "59 1,964", "A05 detail keeps the exclusive-area type summary");

  const densityStarted = performance.now();
  const densityRows = DETAIL_SPECS.D16.rows(makeFakeContext("buildings", syntheticBuildingHits, syntheticBuildingDb, { metric: "buildings", bandwidth: "100" }));
  const densityElapsed = performance.now() - densityStarted;
  assert.equal(densityRows.length, 1500);
  assert.ok(densityElapsed < 250, `D16 1,500동 KDE must be <= 250ms, got ${densityElapsed.toFixed(1)}ms`);

  const syntheticParcelHits = Array.from({ length: 3000 }, (_, index) => ({
    featureId: index + 1,
    stableId: `synthetic-parcel:${index}`,
    kind: "parcel",
    releaseId: "fixture",
    name: `${index + 1}대`,
    pnu: `PNU-${index}`,
    legalCode: null,
    properties: { jimok: "대" },
    geometry: { type: "Polygon", coordinates: [[[cx + (index % 60) * 5, cy + Math.floor(index / 60) * 5], [cx + (index % 60) * 5 + 4, cy + Math.floor(index / 60) * 5], [cx + (index % 60) * 5 + 4, cy + Math.floor(index / 60) * 5 + 4], [cx + (index % 60) * 5, cy + Math.floor(index / 60) * 5 + 4], [cx + (index % 60) * 5, cy + Math.floor(index / 60) * 5]]] },
    distanceM: null,
  }));
  const syntheticParcelDb = {
    prepare(sql) {
      if (sql.includes("sqlite_master")) return { get: () => ({}) };
      return { all: (...pnus) => pnus.map((pnu) => ({ pnu, base_year: 2026, base_month: 1, price_krw_per_m2: 100000 })) };
    },
  };
  const parcelStarted = performance.now();
  const parcelRows = DETAIL_SPECS.D19.rows(makeFakeContext("reference", syntheticParcelHits, syntheticParcelDb));
  const parcelElapsed = performance.now() - parcelStarted;
  assert.equal(parcelRows.length, 3000);
  assert.ok(parcelElapsed < 1000, `parcel detail must be <= 1s, got ${parcelElapsed.toFixed(1)}ms`);

  const started = performance.now();
  const buildings = collectDetail(ctx, "D03");
  const elapsed = performance.now() - started;
  // fixture의 b_far는 중심에서 3km라 800m 상세 목록에서 제외한다.
  assert.equal(buildings.rows.length, 6);
  assert.ok(elapsed < 1000, `building detail must be <= 1s, got ${elapsed.toFixed(1)}ms`);
  assert.deepEqual(
    ["이름", "주소", "주용도", "용도 분류", "지상층", "지하층", "높이(m)", "연면적(㎡)", "건축면적(㎡)", "대지면적(㎡)", "건폐율(%)", "용적률(%)", "구조", "사용승인일", "용도지역", "PNU", "비고"]
      .every((label) => buildings.csvColumns.some((column) => column.label === label)),
    true,
  );
  assert.ok(buildings.card.source.includes("GIS건물통합정보"));
  const buildingAt = detailAt(ctx, "D03", CENTER[0], CENTER[1]);
  assert.ok(buildingAt?.fid, "building point lookup returns fid");
  assert.ok(buildingAt?.card.fields.some((field) => field.label === "지상 / 지하"));

  const zones = collectDetail(ctx, "A12");
  assert.equal(zones.rows.length, 3);
  assert.ok(zones.rows.every((row) => row.fid && Array.isArray(row.fids) && row.fids.length >= 1 && typeof row.cells.area_m2 === "number"));
  const zoningTile = a12WithZoning(ctx);
  assert.ok(zoningTile.presentation.polygons?.every((polygon) => polygon.fid), "zoning polygons keep detail fids");
  const zoneAt = detailAt(ctx, "A12", CENTER[0], CENTER[1]);
  assert.ok(zoneAt?.fid, "zone point lookup returns fid");
  assert.ok(zoneAt?.fids?.includes(zoneAt.fid), "zone point lookup returns every aggregate fid");

  const sameZone = (featureId, x0) => ({
    featureId,
    stableId: `same-zone:${featureId}`,
    kind: "zoning_area",
    releaseId: "fixture-zone",
    name: "같은 용도지역",
    pnu: null,
    legalCode: null,
    properties: { zoningName: "같은 용도지역", zoningClass: "주거" },
    geometry: { type: "Polygon", coordinates: [[[cx + x0, cy - 100], [cx + x0 + 100, cy - 100], [cx + x0 + 100, cy], [cx + x0, cy], [cx + x0, cy - 100]]] },
    distanceM: null,
  });
  const zoneFixtureMemo = new Map();
  const zoneFixtureContext = {
    analysisId: "zone-aggregate-fixture",
    input: { address: "합성", center: CENTER, radiusM: 800, analysisDate: "2026-10-01", pnu: null },
    detailControls: {},
    memo(key, compute) { if (!zoneFixtureMemo.has(key)) zoneFixtureMemo.set(key, compute()); return zoneFixtureMemo.get(key); },
    db() { return null; },
    sources() { return []; },
    hits() { return [sameZone(1, -200), sameZone(2, 0)]; },
  };
  const aggregateRows = DETAIL_SPECS.A12.rows(zoneFixtureContext);
  assert.equal(aggregateRows.length, 1, "same name and source aggregate into one row");
  assert.deepEqual(aggregateRows[0].fids, ["1", "2"]);
  assert.equal(aggregateRows[0].cells.pieces, 2);
  assert.ok(aggregateRows[0].cells.area_m2 > 0);

  const parcels = collectDetail(ctx, "D19");
  // fixture의 100-9 필지는 중심에서 2km라 800m 상세 목록에서 제외한다.
  assert.equal(parcels.rows.length, 8);
  assert.ok(parcels.columns.some((column) => column.label.includes("공시지가")));
  const parcelAt = detailAt(ctx, "D19", CENTER[0], CENTER[1]);
  assert.ok(parcelAt?.fid, "parcel point lookup returns fid");

  const walk = collectDetail(ctx, "D28");
  // fixture의 세 번째 버스 정류장은 1.5km라 800m 목록에서 제외한다.
  assert.equal(walk.rows.length, 2);
  assert.ok(walk.columns.findIndex((column) => column.key === "walk_min") < walk.columns.findIndex((column) => column.key === "straight_m"));
  assert.ok(walk.rows.every((row) => row.cells.within_10_min === "예" || row.cells.within_10_min === "아니오" || row.cells.within_10_min === null));
  const walkMinutes = walk.rows.map((row) => row.cells.walk_min).filter((value) => typeof value === "number");
  assert.deepEqual(walkMinutes, [...walkMinutes].sort((a, b) => a - b));
  const firstUnroutable = walk.rows.findIndex((row) => row.cells.walk_min === null);
  assert.ok(firstUnroutable < 0 || walk.rows.slice(firstUnroutable).every((row) => row.cells.walk_min === null), "unroutable transit rows sort last");
  assert.match(walk.card.subtitle, /역 \d+곳 · 정류장 \d+곳 \(걸어서 10분 안\)/);
  const walkStarted = performance.now();
  const walkAt = detailAt(ctx, "D28", ...at(-100, -200));
  const walkElapsed = performance.now() - walkStarted;
  assert.ok(walkAt?.path && walkAt.path.length >= 2, "walking detail returns a WGS84 route");
  assert.equal(walkAt?.card.fields.some((field) => field.label.includes("걸어서")), true);
  assert.ok(walkElapsed < 300, `walking detail must be <= 300ms, got ${walkElapsed.toFixed(1)}ms`);

  const transit = collectDetail(ctx, "A01");
  assert.ok(transit.rows.every((row) => typeof row.cells.walk_min === "number" || row.cells.walk_min === null));
  assert.match(transit.card.subtitle, /걸어서 10분 안/);
  const transitAt = detailAt(ctx, "A01", CENTER[0], CENTER[1]);
  assert.ok(transitAt?.card.fields.some((field) => field.label === "걸어서"));

  const tradeStarted = performance.now();
  const trades = collectDetail(ctx, "A07");
  const tradeElapsed = performance.now() - tradeStarted;
  assert.equal(trades.rows.length, 29, "A07 상세는 최근 12개월 반경 내 위치 확인·미취소 아파트 매매만 표시");
  assert.ok(tradeElapsed < 1000, `trade detail must be <= 1s, got ${tradeElapsed.toFixed(1)}ms`);
  assert.ok(trades.csvColumns.some((column) => column.key === "property_type_raw"), "A07 CSV keeps the raw property code");
  assert.ok(trades.csvColumns.some((column) => column.key === "contract_type_raw"), "A07 CSV keeps the raw contract code");
  const tradeCsv = detailCsv(trades);
  assert.match(tradeCsv, /아파트/);
  assert.match(tradeCsv, /매매/);
  assert.match(tradeCsv, /apt/);
  assert.match(tradeCsv, /trade/);
  const tradeAt = detailAt(ctx, "A07", CENTER[0], CENTER[1]);
  assert.deepEqual(tradeAt?.card.fields.slice(0, 3).map((field) => field.label), ["계약일", "유형", "계약"]);
  assert.deepEqual(tradeAt?.card.fields.slice(1, 3).map((field) => field.value), ["아파트", "매매"]);

  const noWalkMemo = new Map();
  const noWalkContext = {
    analysisId: "no-walk-graph",
    input: { address: "합성", center: CENTER, radiusM: 800, analysisDate: "2026-10-01", pnu: null },
    detailControls: {},
    memo(key, compute) { if (!noWalkMemo.has(key)) noWalkMemo.set(key, compute()); return noWalkMemo.get(key); },
    db() { return null; },
    sources() { return []; },
    hits(key, kinds) {
      if (kinds.includes("bus_stop")) return [{ featureId: 1, stableId: "bus:1", kind: "bus_stop", releaseId: "fixture", name: "정류장", pnu: null, legalCode: null, properties: {}, geometry: { type: "Point", coordinates: [cx, cy] }, distanceM: 0 }];
      return [];
    },
  };
  assert.match(DETAIL_SPECS.A01.summary(noWalkContext).subtitle, /보행망 없음/);

  const densityNarrow = collectDetail(ctx, "D16", { bandwidth: "57", metric: "buildings" });
  const densityWide = collectDetail(ctx, "D16", { bandwidth: "160", metric: "buildings" });
  assert.notDeepEqual(densityNarrow.rows.map((row) => row.cells.value), densityWide.rows.map((row) => row.cells.value));

  const weather = collectDetail(ctx, "D22", { season: "summer" });
  assert.equal(weather.rows.length, 16);
  assert.ok(weather.controls.some((control) => control.key === "season"));
  assert.ok(weather.rows.every((row) => typeof row.cells.frequency_pct === "number"));

  const csv = detailCsv(buildings);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.split("\n")[0].includes("이름"));
  assert.equal(csv.trimEnd().split("\n").length, buildings.rows.length + 1);

  createAnalysisRun(appDb, {
    analysisId: "owned-detail",
    address: "경기도 남양주시 다산동 100",
    center: CENTER,
    radiusM: 800,
    analysisDate: "2026-09-30",
    manifestHash,
    engineVersion: "test",
    parameters: { pnu: null },
    userId: "owner-1",
  });
  assert.equal(getDetailList(appDb, dataDir, "owned-detail", "D03", "other-user").status, 404);
  assert.equal(getDetailList(appDb, dataDir, "owned-detail", "D03", "owner-1").status, 200);
  assert.equal(getDetailList(appDb, dataDir, "owned-detail", "not-a-tile", "owner-1").status, 404);
  const within10 = getDetailList(appDb, dataDir, "owned-detail", "A01", "owner-1", { within10: true });
  assert.equal(within10.status, 200);
  assert.ok(within10.body.rows.every((row) => row.cells.within_10_min === "예"));

  ctx.close();
  ctx = null;
  console.log(`✓ v2 detail (building ${elapsed.toFixed(1)}ms, D16/parcel/walk/trade ${densityElapsed.toFixed(1)}/${parcelElapsed.toFixed(1)}/${walkElapsed.toFixed(1)}/${tradeElapsed.toFixed(1)}ms, rows ${buildings.rows.length}/${zones.rows.length}/${parcels.rows.length}/${walk.rows.length}/${trades.rows.length})`);
} finally {
  ctx?.close();
  appDb.close();
  rmSync(dataDir, { recursive: true, force: true });
}
