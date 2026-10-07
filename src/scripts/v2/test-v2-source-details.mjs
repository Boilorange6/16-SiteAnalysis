import assert from "node:assert/strict";
import { citationOf, sourceDetailsFor, UNKNOWN_AS_OF } from "../../lib/v2/ui/source-details.ts";
import { catalogEntry } from "../../lib/v2/ui/tile-catalog.ts";

const source = (sourceId, sourceAsOf = "2026-09-09", releaseId = `${sourceId}@2026-09-09`) => ({ sourceId, releaseId, sourceAsOf });
const tile = (code, tileType, sources) => ({ code, tileType, provenance: { sources } });
const meta = (sourceId, extra = {}) => new Map([[sourceId, {
  provider: "테스트 제공처",
  name: `자료 ${sourceId}`,
  sourceUrl: `https://example.test/${sourceId}`,
  sourceAsOf: "2099-01-01",
  licenseCode: "TEST",
  ...extra,
}]]);

{
  const details = sourceDetailsFor(tile("D04", "diagram", [source("building")]), meta("building", { name: "GIS 건물" }));
  assert.equal(details.calcMethod, null);
  assert.equal(details.rows.length, 1);
  assert.deepEqual(details.rows[0], {
    sourceId: "building",
    provider: "테스트 제공처",
    name: "GIS 건물",
    role: "주 원천",
    asOf: "2026-09-09",
    license: "TEST",
    url: "https://example.test/building",
    usedFor: "건물 도형·사용승인일·높이",
  });
  assert.equal(details.rows[0].asOf, "2026-09-09", "meta의 sourceAsOf나 fetchedAt이 provenance 기준일을 덮지 않는다");
}

{
  const details = sourceDetailsFor(tile("A05", "analysis", [source("ledger_recap"), source("ledger_title"), source("kapt")]), new Map([
    ["ledger_recap", { provider: "건축HUB", sourceUrl: "https://example.test/recap", licenseCode: "UNRESTRICTED" }],
    ["ledger_title", { provider: "건축HUB", sourceUrl: "https://example.test/title", licenseCode: "UNRESTRICTED" }],
    ["kapt", { provider: "한국부동산원", sourceUrl: "https://example.test/kapt", licenseCode: "UNRESTRICTED" }],
  ]));
  assert.deepEqual(details.rows.map((row) => [row.sourceId, row.role]), [
    ["ledger_recap", "주 원천"],
    ["ledger_title", "보강"],
    ["kapt", "보강"],
  ]);
}

{
  const details = sourceDetailsFor(tile("S02", "simulation", [source("building"), source("parcel_polygon")]), new Map([
    ["building", { provider: "건물", sourceUrl: "https://example.test/building", licenseCode: "TEST" }],
    ["parcel_polygon", { provider: "지적", sourceUrl: "https://example.test/parcel", licenseCode: "TEST" }],
  ]));
  assert.equal(details.calcMethod, catalogEntry("S02").calculation ?? catalogEntry("S02").description);
  assert.deepEqual(details.rows.map((row) => row.role), ["입력", "입력"]);
}

{
  const details = sourceDetailsFor(tile("D21", "diagram", [source("building"), source("parcel_polygon")]), new Map());
  assert.equal(details.calcMethod, catalogEntry("D21").calculation ?? catalogEntry("D21").description);
  assert.deepEqual(details.rows.map((row) => row.role), ["입력", "입력"]);
}

{
  const details = sourceDetailsFor(tile("D19", "diagram", [source("parcel_polygon", null)]), new Map([
    ["parcel_polygon", { provider: "국토교통부", sourceUrl: "https://example.test/parcel", licenseCode: "CC-BY" }],
    ["land_price", { provider: "국토교통부", sourceUrl: "https://example.test/land-price", licenseCode: "UNRESTRICTED" }],
  ]));
  assert.equal(details.rows.length, 1, "provenance에 없는 개별공시지가는 출처 상세에 넣지 않는다");
  assert.equal(details.rows[0].asOf, UNKNOWN_AS_OF);
  assert.equal(details.rows[0].license, "CC-BY");
  assert.equal(citationOf(details.rows[0]), "국토교통부, 「연속지적도(도형)」(기준일 미확인), CC-BY, https://example.test/parcel");
}

{
  const details = sourceDetailsFor(tile("D04", "diagram", [source("building", "2026-09-09", "building@2026-09-09")]), new Map([
    ["building:building@2026-09-09", { provider: "정확 릴리스", sourceUrl: "https://example.test/exact", licenseCode: "CC-BY" }],
    ["building", { provider: "기본 릴리스", sourceUrl: "https://example.test/default", licenseCode: "OLD" }],
  ]));
  assert.equal(details.rows[0].provider, "정확 릴리스");
  assert.equal(details.rows[0].url, "https://example.test/exact");
}

{
  const details = sourceDetailsFor(tile("D04", "diagram", [source("unmapped", null)]), new Map([
    ["unmapped", { provider: "", sourceUrl: "", licenseCode: "UNKNOWN" }],
  ]));
  assert.equal(details.rows[0].provider, "제공처 미기록");
  assert.equal(details.rows[0].name, "자료명 미기록");
  assert.equal(details.rows[0].license, "미기록");
  assert.equal(citationOf(details.rows[0]), "제공처 미기록, 「자료명 미기록」(기준일 미확인), 미기록, 원문 URL 미기록");
}

{
  const same = { provider: "국토교통부", name: "VWorld 도시계획시설", sourceUrl: "https://example.test/upis", licenseCode: "UNRESTRICTED" };
  const details = sourceDetailsFor(tile("D29", "diagram", [source("upis_a"), source("upis_b"), source("dem")]), new Map([
    ["upis_a", same],
    ["upis_b", same],
    ["dem", { provider: "Copernicus", name: "DEM", sourceUrl: "https://example.test/dem", licenseCode: "attribution" }],
  ]));
  assert.deepEqual(details.rows.map((row) => row.sourceId), ["upis_a", "dem"], "제공처·자료·기준일이 같은 레이어는 한 행");
  assert.deepEqual(details.rows.map((row) => row.license), ["이용허락범위 제한 없음", "출처 표시"]);
}

console.log("✓ source details model");
