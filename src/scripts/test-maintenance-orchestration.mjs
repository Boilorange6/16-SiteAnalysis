import assert from "node:assert/strict";

import { applyMaintenanceRetryResult } from "../lib/maintenance-retry-state.ts";
import { searchMaintenanceProjects } from "../lib/server/maintenance-project-search.ts";
import { fetchBusanMaintenanceRecords, fetchSeoulMaintenanceRecords } from "../lib/server/maintenance/regional-provider.ts";
import { mergeMaintenanceData } from "../lib/server/maintenance/merge.ts";

const center = { lat: 37.5, lng: 127 };
const query = { center, radiusM: 3_000, refresh: false };

function boundary(id, name, sido = "서울특별시", sigungu = "강남구") {
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[[126.99, 37.49], [127.01, 37.49], [127.01, 37.51], [126.99, 37.51], [126.99, 37.49]]] },
    properties: {
      source_feature_id: id, source_dataset_id: "30335", source_layer: "UD602", name, sido, sigungu,
      notice_ids: [], original_crs: "EPSG:5186", source_url: "https://example.test/boundary",
      retrieved_at: "2026-07-20T00:00:00Z", bbox: [126.99, 37.49, 127.01, 37.51],
    },
  };
}

function attribute(id, name, sido = "서울특별시", sigungu = "강남구") {
  return { source_record_id: id, source: "molit_integrated", sido, sigungu, name, type: "재개발", stage: "구역지정/변경" };
}

function resolved(value, status = "fresh") {
  return { value, status, fetchedAt: status === "failed" ? null : 123 };
}

function dependencies(overrides = {}) {
  return {
    resolveBoundaries: async () => resolved([]),
    resolveAttributes: async () => resolved({ integrated: [], standard: [] }),
    resolveSeoul: async () => resolved([]),
    resolveBusan: async () => resolved([]),
    reverseGeocodeAdmin: async () => null,
    ...overrides,
  };
}

function fakeKy(responses) {
  let index = 0;
  return {
    get() {
      const response = responses[index++];
      return { json: async () => response };
    },
  };
}

{
  let geocodeCalls = 0;
  await assert.rejects(fetchSeoulMaintenanceRecords({
    query: { center, radiusM: 3_000, regions: [{ sido: "서울특별시", sigungu: "강남구" }] },
    serviceKey: "",
  }), /SEOUL_OPEN_API_KEY/);
  const records = await fetchSeoulMaintenanceRecords({
    query: { center, radiusM: 3_000, regions: [{ sido: "서울특별시", sigungu: "강남구" }] },
    serviceKey: "seoul-test-key",
    httpClient: fakeKy([{ upisRebuild: {
      list_total_count: 2, RESULT: { CODE: "INFO-000" },
      row: [
        { RPT_MNG_CD: "S-1", PRJC_CD: "PROJECT-1", RGN_NM: "변경된 서울상세", PSTN_NM: "강남구 역삼동", RPT_TYPE: "정비사업", MCLSF: "조합설립", SCLSF: "재건축", DCSN_ANCMNT_MNG_CD: "고시-1", NTFC_SN: "NOTICE-1", WTNNC_SN: "WT-1" },
        { RPT_MNG_CD: "S-OUT", RGN_NM: "타구 서울상세", PSTN_NM: "송파구 잠실동", SCLSF: "재건축" },
      ],
    } }]),
    geocoder: async () => {
      geocodeCalls += 1;
      return center;
    },
  });
  assert.equal(records.length, 1);
  assert.equal(geocodeCalls, 1);
  assert.equal(records[0].sigungu, "강남구");
  assert.equal(records[0].stage, "조합설립");
  assert.deepEqual(records[0].official_ids, ["S-1", "PROJECT-1", "고시-1", "NOTICE-1", "WT-1"]);
  assert.equal(records[0].notice_code, "고시-1");
  assert.match(records[0].notice_url, /data\.seoul\.go\.kr/);

  const renamedJoin = mergeMaintenanceData({
    boundaries: [{ ...boundary("unrelated-id", "원래 경계명"), properties: {
      ...boundary("unrelated-id", "원래 경계명").properties, notice_ids: ["NOTICE-1"],
    } }],
    attributes: [], regional: records, selectedRegions: [{ sido: "서울특별시", sigungu: "강남구" }],
  });
  assert.equal(renamedJoin.projects.length, 1);
  assert.equal(renamedJoin.projects[0].boundary_status, "confirmed");
  assert.equal(renamedJoin.projects[0].source, "seoul_open_data");
}

{
  let geocodeCalls = 0;
  const records = await fetchBusanMaintenanceRecords({
    query: { center, radiusM: 3_000, regions: [{ sido: "부산광역시", sigungu: "해운대구" }] },
    serviceKey: "busan-test-key",
    httpClient: fakeKy([
      { response: { header: { resultCode: "00", resultMsg: "NORMAL SERVICE" }, body: { totalCount: 3, items: { item: [
        { zoneNo: "B-1", zoneNm: "부산상세1", addr: "해운대구", zoneArea: "1200", houseHolds: "30", floorAreaRatio: "240", buildingCoverageRatio: "60", constructor: "시공사", architect: "설계사", unionMembers: "20" },
        { zoneNo: "B-OUT", zoneNm: "타구 부산상세", addr: "수영구" },
      ] } } } },
      { response: { header: { resultCode: "00", resultMsg: "NORMAL SERVICE" }, body: { totalCount: 3, items: { item: [{ zoneNo: "B-2", zoneNm: "부산상세2", addr: "해운대구" }] } } } },
    ]),
    geocoder: async () => {
      geocodeCalls += 1;
      return center;
    },
  });
  assert.equal(records.length, 2);
  assert.equal(geocodeCalls, 2);
  assert.equal(records[0].area_sqm, 1200);
  assert.equal(records[0].planned_households, 30);
  assert.equal(records[0].floor_area_ratio, 240);
  assert.equal(records[0].building_coverage_ratio, 60);
  assert.equal(records[0].contractor, "시공사");
  assert.equal(records[0].architect, "설계사");
  assert.equal(records[0].union_members, 20);

  await assert.rejects(fetchBusanMaintenanceRecords({
    query: { center, radiusM: 3_000, regions: [{ sido: "부산광역시", sigungu: "해운대구" }] },
    serviceKey: "SECRET-SERVICE-KEY",
    httpClient: fakeKy([{ response: {
      header: { resultCode: "30", resultMsg: "SERVICE KEY SECRET-SERVICE-KEY rejected at https://keyed.example.test" },
      body: { totalCount: 0, items: { item: [] } },
    } }]),
  }), (error) => {
    assert.equal(String(error).includes("SECRET-SERVICE-KEY"), false);
    assert.equal(String(error).includes("https://"), false);
    return true;
  });
}

{
  const result = await searchMaintenanceProjects(query, dependencies({
    resolveBoundaries: async () => resolved([boundary("b-1", "독립구역")]),
    resolveAttributes: async () => resolved(null, "failed"),
    resolveSeoul: async () => resolved(null, "failed"),
  }));
  assert.deepEqual(result.sources.map(({ source, status }) => ({ source, status })), [
    { source: "maintenance_boundaries", status: "fresh" },
    { source: "maintenance_attributes", status: "failed" },
    { source: "maintenance_seoul", status: "failed" },
    { source: "maintenance_busan", status: "fresh" },
  ]);
  assert.equal(result.projects[0].source, "molit_spatial");
  assert.equal(result.projects[0].boundary_status, "unmatched");
}

{
  const result = await searchMaintenanceProjects(query, dependencies({
    resolveBoundaries: async () => resolved(null, "failed"),
    resolveAttributes: async () => resolved({ integrated: [attribute("a-1", "목록구역")], standard: [] }),
    reverseGeocodeAdmin: async () => ({ sido: "서울특별시", sigungu: "강남구" }),
  }));
  assert.equal(result.catalog.length, 1);
  assert.equal(result.catalog[0].name, "목록구역");
  assert.equal(result.sources[0].status, "failed");
  assert.equal(result.sources[1].status, "fresh");
}

{
  const result = await searchMaintenanceProjects(query, dependencies({
    resolveBoundaries: async () => resolved([boundary("safe-id", "안전구역")]),
    resolveAttributes: async () => resolved({ integrated: [attribute("safe-id", "안전구역")], standard: [] }),
  }));
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].boundary_status, "confirmed");
  assert.equal(result.projects[0].source, "molit_integrated");
}

{
  const result = await searchMaintenanceProjects(query, dependencies({
    resolveBoundaries: async () => resolved([boundary("b-2", "지역구역", "부산광역시", "해운대구")]),
    resolveSeoul: async () => resolved(null, "failed"),
    resolveBusan: async () => resolved([]),
  }));
  assert.deepEqual(result.sources.map(({ source, status }) => ({ source, status })), [
    { source: "maintenance_boundaries", status: "fresh" },
    { source: "maintenance_attributes", status: "fresh" },
    { source: "maintenance_seoul", status: "failed" },
    { source: "maintenance_busan", status: "fresh" },
  ]);
}

{
  const oldKey = process.env.SEOUL_OPEN_API_KEY;
  delete process.env.SEOUL_OPEN_API_KEY;
  try {
    const result = await searchMaintenanceProjects(query, dependencies({
      resolveBoundaries: async () => resolved([boundary("b-3", "서울구역")]),
      resolveSeoul: undefined,
    }));
    assert.equal(result.sources.find(({ source }) => source === "maintenance_seoul")?.status, "failed");
    assert.equal(result.projects.some(({ id }) => id.includes("sample")), false);
  } finally {
    if (oldKey) process.env.SEOUL_OPEN_API_KEY = oldKey;
  }
}

{
  const seoul = { ...attribute("seoul-id", "동일명", "서울특별시", "강남구"), source: "seoul_open_data", official_ids: ["seoul-id"] };
  const busan = { ...attribute("busan-id", "동일명", "부산광역시", "해운대구"), source: "busan_data_go_kr", official_ids: ["busan-id"] };
  const result = await searchMaintenanceProjects(query, dependencies({
    resolveBoundaries: async () => resolved([
      boundary("seoul-id", "동일명", "서울특별시", "강남구"),
      boundary("busan-id", "동일명", "부산광역시", "해운대구"),
    ]),
    resolveAttributes: async () => resolved({ integrated: [], standard: [] }),
    resolveSeoul: async () => resolved([seoul]),
    resolveBusan: async () => resolved([busan]),
  }));
  assert.equal(result.projects.length, 2);
  assert.deepEqual(new Set(result.projects.map(({ source }) => source)), new Set(["seoul_open_data", "busan_data_go_kr"]));
}

{
  const base = {
    maintenanceProjects: [{ category: "maintenance", id: "old" }], maintenanceCatalog: [{ id: "old-catalog" }],
    sourceStatuses: [
      { source: "osm", status: "fresh", fetchedAt: 1 },
      { source: "maintenance_boundaries", status: "cached", fetchedAt: 1 },
      { source: "maintenance_attributes", status: "cached", fetchedAt: 1 },
      { source: "maintenance_seoul", status: "cached", fetchedAt: 1 },
      { source: "maintenance_busan", status: "cached", fetchedAt: 1 },
    ],
  };
  const allSources = ["maintenance_boundaries", "maintenance_attributes", "maintenance_seoul", "maintenance_busan"]
    .map((source) => ({ source, status: "fresh", fetchedAt: 2 }));
  const next = applyMaintenanceRetryResult(base, {
    pois: [{ category: "maintenance", id: "new" }], status: allSources[0], allSources,
    maintenanceCatalog: [{ id: "new-catalog" }],
  });
  assert.deepEqual(next.maintenanceProjects.map(({ id }) => id), ["new"]);
  assert.deepEqual(next.maintenanceCatalog.map(({ id }) => id), ["new-catalog"]);
  assert.deepEqual(next.sourceStatuses.map(({ source }) => source), ["osm", ...allSources.map(({ source }) => source)]);
}

console.log("maintenance orchestration tests passed");
