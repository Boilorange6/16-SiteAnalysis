import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { buildEngineFixture, at, CENTER, PARCEL_PNUS, SITE_PNUS } = await import("./engine-fixture.mjs");
const { toUtmk } = await import("../../lib/v2/crs.ts");
const { feature, booleanPointInPolygon, point } = await import("@turf/turf");
const { resolveSiteGeometry, restoreSiteFromParameters, siteSnapshotHash } = await import("../../lib/v2/engine/site.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { d19 } = await import("../../lib/v2/tile/d19/engine.ts");
const { s02 } = await import("../../lib/v2/tile/s02/engine.ts");
const { a12 } = await import("../../lib/v2/tile/a12/engine.ts");
const { cacheKeyFor } = await import("../../lib/v2/engine/run.ts");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { findParcelAt, findParcelsInBbox, validateParcelBbox, MAX_PARCEL_BBOX_FEATURES } = await import("../../lib/v2/data/parcels.ts");
const { openV2AppDb } = await import("../../lib/v2/app-db.ts");
const { postAnalysis } = await import("../../lib/v2/engine/api.ts");
const M = await import("../../lib/v2/data/manifest.ts");

const dir = mkdtempSync(join(tmpdir(), "v2-site-selection-"));
await buildEngineFixture(dir, "v1", { parcels: true, siteSelection: true, zoning: "overlap", buildings: true });
const manifest = M.readManifest(dir);
const core = M.openDataFile(dir, manifest, "core");
const parcels = M.openDataFile(dir, manifest, "parcels");
const reference = new Database(M.resolveDataPath(dir, manifest.files.reference.path));
const landPriceRelease = insertRelease(reference, { sourceId: "land_price", provider: "테스트", sourceUrl: "https://example.invalid/land-price", sourceAsOf: "2026-09-30", fetchedAt: "2026-09-30T00:00:00Z", checksum: "site-selection-land-price", licenseCode: "TEST" });
const insertLandPrice = reference.prepare("INSERT INTO land_price (pnu, base_year, base_month, price_krw_per_m2, is_standard) VALUES (?, 2026, 1, ?, 0)");
insertLandPrice.run(SITE_PNUS[0], 1_000_000);
insertLandPrice.run(SITE_PNUS[1], 3_000_000);
reference.close();
const ctxFor = (site) => new EngineContext(dir, manifest, `site-${site.kind}`, {
  address: site.kind === "polygon" ? "직접 그린 구역" : "101-1대 외 1필지",
  center: site.center,
  radiusM: 800,
  analysisDate: "2026-09-30",
  pnu: site.pnu,
  site: site.site,
}, { core: M.openDataFile(dir, manifest, "core"), parcels: M.openDataFile(dir, manifest, "parcels") });

try {
  const merged = resolveSiteGeometry(core, parcels, { address: "무시할 주소", center: CENTER, site: { pnus: SITE_PNUS } });
  assert.equal(merged.ok, true);
  assert.equal(merged.site.kind, "parcels");
  assert.deepEqual(merged.site.pnus, SITE_PNUS);
  assert.equal(merged.label, "경기도 남양주시 다산동 101-1 외 1필지", "지번 앞에 시군구·읍면동 이름");
  const centerPoint = toUtmk(merged.center);
  assert.equal(booleanPointInPolygon(point(centerPoint), feature(merged.site.geometry)), true, "합필 중심은 합집합 안");
  assert.equal(merged.jimok, "대", "대표 필지는 가장 큰 필지(동률은 feature_id 순)");
  assert.deepEqual(merged.jimokList, ["대", "전"]);

  const single = resolveSiteGeometry(core, parcels, { site: { pnus: [SITE_PNUS[0]] } });
  assert.equal(single.ok, true, "단일 필지도 union 없이 대지로 확정");
  assert.equal(single.site.kind, "parcels");
  assert.deepEqual(single.site.pnus, [SITE_PNUS[0]]);
  assert.equal(single.site.geometry?.type, "Polygon");

  const disconnected = resolveSiteGeometry(core, parcels, { site: { pnus: [PARCEL_PNUS[0], PARCEL_PNUS[1]] } });
  assert.deepEqual([disconnected.ok, disconnected.reason], [false, "site_disconnected"]);
  const missing = resolveSiteGeometry(core, parcels, { site: { pnus: ["4136011800101999999"] } });
  assert.deepEqual([missing.ok, missing.reason], [false, "site_missing_pnu"]);

  const apiDb = openV2AppDb(join(dir, "app.sqlite"));
  const apiReply = postAnalysis(apiDb, dir, {
    address: "경기도 남양주시 없는동 999",
    center: CENTER,
    site: { pnus: SITE_PNUS },
    radiusM: 500,
    analysisDate: "2026-09-30",
  }, "site-user");
  assert.equal(apiReply.status, 202, "site가 주소·좌표보다 우선");
  assert.match(apiReply.body.summary.address, /^경기도 남양주시 다산동 101-1 외 1필지$/);
  apiDb.close();

  const bowTie = [at(-30, -30), at(30, 30), at(30, -30), at(-30, 30), at(-30, -30)];
  const selfCrossing = resolveSiteGeometry(core, parcels, { site: { polygon: bowTie } });
  assert.deepEqual([selfCrossing.ok, selfCrossing.reason], [false, "site_geometry_invalid"]);

  // 오목 ㄷ자: centroid가 빈 공간에 걸릴 수 있어 pointOnFeature 결과가 경계 안이어야 한다.
  const concave = [at(-50, -50), at(50, -50), at(50, -25), at(-10, -25), at(-10, 25), at(50, 25), at(50, 50), at(-50, 50), at(-50, -50)];
  const concaveResult = resolveSiteGeometry(core, parcels, { site: { polygon: concave } });
  assert.equal(concaveResult.ok, true);
  assert.equal(booleanPointInPolygon(point(toUtmk(concaveResult.center)), feature(concaveResult.site.geometry)), true, "오목 대지 중심은 도형 안");
  const polygonCtx = ctxFor(concaveResult);
  const polygonA12 = a12(polygonCtx);
  assert.equal(polygonA12.metrics.find((metric) => metric.id === "parcel_area_m2")?.status, "estimated");
  assert.ok((polygonA12.metrics.find((metric) => metric.id === "site_parcels")?.value ?? 0) > 0);
  polygonCtx.close();

  const siteCtx = ctxFor(merged);
  const d19Tile = d19(siteCtx);
  assert.equal(d19Tile.presentation.polygons.filter((polygon) => polygon.layer === "parcel_site").length, 2);
  const a12Tile = a12(siteCtx);
  const a12Metric = (id) => a12Tile.metrics.find((metric) => metric.id === id);
  assert.equal(a12Metric("site_parcels").value, 2);
  assert.equal(a12Metric("parcel_area_m2").value, 1600);
  assert.equal(a12Metric("land_price").value, 1_750_000, "필지 공부면적 가중 평균 공시지가");
  siteCtx.close();

  const s02Ctx = ctxFor(merged);
  const s02Tile = s02(s02Ctx);
  const sunFaces = s02Tile.presentation.polygons.filter((polygon) => polygon.layer === "sun_face");
  assert.equal(sunFaces.length, 1, "합집합 대지의 수광면은 한 도형");
  s02Ctx.close();

  const oldSite = restoreSiteFromParameters({ pnu: SITE_PNUS[0] });
  assert.deepEqual(oldSite, { pnus: [SITE_PNUS[0]], geometry: null, kind: "address" });
  const mergedHash = siteSnapshotHash(merged.site);
  const sameHash = siteSnapshotHash({ ...merged.site, pnus: [...merged.site.pnus].reverse() });
  const shiftedCoordinates = (value) => Array.isArray(value) && typeof value[0] === "number" ? [value[0] + 1, value[1]] : value.map(shiftedCoordinates);
  const differentHash = siteSnapshotHash({ ...merged.site, geometry: { ...merged.site.geometry, coordinates: shiftedCoordinates(merged.site.geometry.coordinates) } });
  assert.equal(mergedHash, sameHash, "PNU 순서가 달라도 같은 대지 캐시");
  assert.notEqual(mergedHash, differentHash, "geometry가 다르면 대지 캐시가 다름");
  const cacheCtx = ctxFor(merged);
  const shifted = { ...merged, site: { ...merged.site, geometry: { ...merged.site.geometry, coordinates: shiftedCoordinates(merged.site.geometry.coordinates) } } };
  const shiftedCtx = ctxFor(shifted);
  for (const code of ["D19", "S02", "A12"]) assert.notEqual(cacheKeyFor(cacheCtx, code), cacheKeyFor(shiftedCtx, code), `${code}: geometry가 다르면 캐시 키가 다름`);
  assert.equal(cacheKeyFor(cacheCtx, "S02"), cacheKeyFor(cacheCtx, "S02"));
  cacheCtx.close();
  shiftedCtx.close();

  const centerAt = at(230, 0);
  const atRecord = findParcelAt(parcels, centerAt[0], centerAt[1]);
  assert.equal(atRecord?.pnu, SITE_PNUS[0]);
  assert.ok(atRecord.geometry.coordinates.flat(Infinity).every((value) => typeof value === "number" && String(value).split(".")[1]?.length <= 6));
  const west = at(180, -100);
  const east = at(300, 100);
  const bbox = findParcelsInBbox(parcels, { w: west[0], s: west[1], e: east[0], n: east[1] });
  assert.equal(bbox.parcels.filter((parcel) => SITE_PNUS.includes(parcel.pnu)).length, 2);
  assert.equal(bbox.truncated, false);
  assert.match(validateParcelBbox({ w: 124, s: 33, e: 132, n: 39 }), /2도/);

  // cap/truncated: published fixture DB is only read by the engine, so use a separate writable copy for this pure query test.
  const writable = new Database(M.resolveDataPath(dir, manifest.files.parcels.path));
  const release = writable.prepare("SELECT release_id FROM source_release LIMIT 1").pluck().get();
  for (let i = 0; i < MAX_PARCEL_BBOX_FEATURES + 1; i++) {
    const pnu = `413601180099${String(i).padStart(7, "0")}`;
    insertFeature(writable, { stableId: `cap:${i}`, kind: "parcel", sourceKey: pnu, releaseId: release, geometry: { type: "Polygon", coordinates: [[at(0, 0), at(1, 0), at(1, 1), at(0, 1), at(0, 0)]] }, pnu, properties: { jibun: `cap-${i}`, jimok: "대", areaM2: 1 }, roundM: 0.01 });
  }
  const capped = findParcelsInBbox(writable, { w: at(-10, -10)[0], s: at(-10, -10)[1], e: at(10, 10)[0], n: at(10, 10)[1] });
  writable.close();
  assert.equal(capped.parcels.length, MAX_PARCEL_BBOX_FEATURES);
  assert.equal(capped.truncated, true);
} finally {
  parcels.close();
  core.close();
}

console.log("v2 site selection/parcels: ok");
