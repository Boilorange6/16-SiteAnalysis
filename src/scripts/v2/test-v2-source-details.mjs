import assert from "node:assert/strict";
import { citationOf, licenseLabel, sourceDetailsFor, UNKNOWN_AS_OF } from "../../lib/v2/ui/source-details.ts";
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
  const details = sourceDetailsFor(tile("D17", "diagram", [
    source("ngii_topo", null, "ngii_topo@abcdef123456"),
    source("terrain_tiles", null),
  ]), new Map());
  assert.deepEqual(details.rows.map((row) => [row.sourceId, row.role]), [
    ["ngii_topo", "주 원천"],
    ["terrain_tiles", "보강"],
  ]);
  assert.equal(details.rows[0].provider, "국토지리정보원");
  assert.equal(details.rows[0].name, "연속수치지형도");
  assert.equal(details.rows[0].url, "https://map.ngii.go.kr");
  assert.equal(details.rows[0].license, "이용조건 확인 필요");
  assert.equal(details.rows[0].asOf, UNKNOWN_AS_OF);
}

{
  const details = sourceDetailsFor(tile("D02", "diagram", [
    source("building"),
    source("ngii_topo", null, "ngii_topo@abcdef123456"),
  ]), new Map());
  assert.deepEqual(details.rows.map((row) => [row.sourceId, row.role]), [
    ["building", "주 원천"],
    ["ngii_topo", "보강"],
  ]);
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
  const details = sourceDetailsFor(tile("D19", "diagram", [source("parcel_polygon", null)]), new Map([
    ["parcel_polygon", { provider: "국토교통부", sourceUrl: "https://example.test/parcel", licenseCode: "CC-BY" }],
    ["land_price", { provider: "국토교통부", sourceUrl: "https://example.test/land-price", licenseCode: "UNRESTRICTED" }],
  ]));
  assert.equal(details.rows.length, 1, "provenance에 없는 개별공시지가는 출처 상세에 넣지 않는다");
  assert.equal(details.rows[0].asOf, UNKNOWN_AS_OF);
  assert.equal(details.rows[0].license, "CC BY 2.0 KR(저작자표시)");
  assert.equal(citationOf(details.rows[0]), "국토교통부, 「연속지적도(도형)」(기준일 미확인), CC BY 2.0 KR(저작자표시), https://example.test/parcel");
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

// 이용조건 문구: 날것 코드는 한국어로 풀고, 정의의 표시 정정과 고지문이 manifest 값보다 먼저다.
{
  const one = (sourceId, raw) => sourceDetailsFor(tile("D04", "diagram", [source(sourceId)]), new Map([[sourceId, raw]])).rows[0];
  assert.equal(licenseLabel("KOGL-1"), "공공누리 제1유형(출처표시)");
  assert.equal(licenseLabel("KOGL_4"), "공공누리 제4유형(출처표시·상업적 이용금지·변경금지)");
  assert.equal(licenseLabel("CC-BY"), "CC BY 2.0 KR(저작자표시)");
  assert.equal(licenseLabel("ODbL-1.0"), "ODbL 1.0(출처표시·동일조건)");
  assert.equal(licenseLabel("KOGL_4+ODbL-1.0"), "공공누리 제4유형(출처표시·상업적 이용금지·변경금지) · ODbL 1.0(출처표시·동일조건)");
  assert.equal(licenseLabel("CC BY-NC-ND"), "CC BY-NC-ND", "이미 읽히는 값은 그대로");

  // 지금 dev manifest가 담고 있는 값(고치기 전) 그대로 넣어도 화면·PPT에는 정정된 값이 보인다.
  const planned = one("planned_rail", { provider: "기존 앱 계획 철도 공개 투영(공식 상태 + OSM 보조 선형)", sourceUrl: "https://news.seoul.go.kr/citybuild/city_railroad", licenseCode: "ODbL-1.0" });
  assert.equal(planned.license, "공공누리 제4유형(출처표시·상업적 이용금지·변경금지) · ODbL 1.0(선형)");
  assert.equal(planned.provider, "서울특별시(공식 상태)·OpenStreetMap contributors(선형)");
  assert.equal(one("seoul_plan_zone", { provider: "서울특별시", sourceUrl: "https://data.seoul.go.kr/x", licenseCode: "KOGL_4" }).license, "공공누리 제4유형(출처표시·상업적 이용금지·변경금지)");
  assert.equal(one("asos", { provider: "기상청 ASOS 시간자료", sourceUrl: "https://www.data.go.kr/data/15139432/openapi.do", licenseCode: "KOGL-1" }).license, "공공누리 제1유형(출처표시)");
  assert.equal(one("asos", { provider: "기상청 ASOS 시간자료", licenseCode: "KOGL-1" }).provider, "기상청");
  assert.equal(one("osm_subway", { provider: "OpenStreetMap contributors(Overpass API, 기존 앱 스냅샷)", sourceUrl: "https://overpass-api.de/", licenseCode: "ODbL-1.0" }).provider, "OpenStreetMap contributors(Overpass API)");
  assert.equal(one("applyhome", { provider: "한국부동산원 청약홈(기존 앱 적재본)", licenseCode: "UNRESTRICTED" }).provider, "한국부동산원");
  assert.match(one("school_zone", { provider: "국토교통부(VWorld Data API 학교 학구도·학교군)", licenseCode: "UNRESTRICTED" }).provider, /^한국교육시설안전원/);
  assert.equal(one("rtms_apt_rent", { provider: "국토교통부(실거래가 공개시스템)", sourceUrl: "https://www.data.go.kr/dataset/3050988/openapi.do", licenseCode: "UNRESTRICTED" }).url, "https://www.data.go.kr/data/15126474/openapi.do");
  assert.equal(one("parcel", { provider: "국토교통부", licenseCode: "CC-BY" }).license, "CC BY 2.0 KR(저작자표시)");

  // Copernicus: 이용조건 칸은 라이선스 이름, 제6조 고정 고지문(가공물 문구·무책임 문구)은 notices로 따라온다.
  const dem = one("terrain_tiles", { provider: "Copernicus DEM GLO-30", sourceUrl: "https://copernicus-dem-30m.s3.amazonaws.com/", licenseCode: "attribution" });
  assert.match(dem.license, /Copernicus WorldDEM-30 라이선스/);
  assert.equal(dem.notices.length, 2);
  assert.ok(dem.notices[0].startsWith("produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved"));
  assert.match(dem.notices[1], /책임을 지지 않습니다/);
  assert.ok(!dem.notices.join(" ").match(/후원|승인|endorse/i), "후원·승인으로 읽히는 표현 금지");
  assert.equal(one("building", { provider: "국토교통부", licenseCode: "CC-BY" }).notices, undefined);

  // 런타임 원천: manifest release가 없어도 제공처·이용조건·링크가 있다.
  const wmts = sourceDetailsFor(tile("D01", "diagram", [source("vworld_wmts", null, "vworld_wmts@runtime")]), new Map()).rows[0];
  assert.deepEqual([wmts.provider, wmts.license, wmts.url], ["국토교통부(VWorld 오픈플랫폼)", "VWorld 이용약관(오픈플랫폼 이용 표기)", "https://www.vworld.kr/dev/v4dv_wmtsguide_s001.do"]);
}

console.log("✓ source details model");
