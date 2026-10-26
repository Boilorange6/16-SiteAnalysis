import assert from "node:assert/strict";
import { SOURCE_DETAIL_DEFINITIONS, sourceOps } from "../../lib/v2/ui/source-details.ts";

const rows = [
  ["legal_areas", "수동 파일", "수시"],
  ["parcel", "수동 파일", "월간", "연속지적도형정보"],
  ["parcel_polygon", "수동 파일", "월간", "연속지적도형정보"],
  ["ledger_recap", "수동 파일", "월간", "건축물대장 3종"],
  ["ledger_title", "수동 파일", "월간", "건축물대장 3종"],
  ["ledger_exclusive_area", "수동 파일", "월간", "건축물대장 3종"],
  ["kapt", "수동 파일", "수시"],
  ["school", "수동 파일", "반기", "학교·학구도 4종"],
  ["school_zone_link", "수동 파일", "반기", "학교·학구도 4종"],
  ["school_zone_elem", "수동 파일", "반기", "학교·학구도 4종"],
  ["school_zone", "수동 API 배치", "반기", "학교·학구도 4종"],
  ["osm_subway", "수동 API 배치", "수시"],
  ["planned_rail", "수동 정리", "수시"],
  ["store", "수동 파일", "분기"],
  ["bus_stop", "수동 파일", "연간"],
  ["park", "수동 파일", "연간"],
  ["sgis_grid", "수동 파일", "연간"],
  ["osm_roads", "수동 파일", "일별", "OSM(Geofabrik)"],
  ["osm_landuse", "수동 파일", "일별", "OSM(Geofabrik)"],
  ["osm_water", "수동 파일", "일별", "OSM(Geofabrik)"],
  ["zoning_urban", "수동 파일", "일별", "용도지역 5종"],
  ["zoning_management", "수동 파일", "일별", "용도지역 5종"],
  ["zoning_agri_forest", "수동 파일", "일별", "용도지역 5종"],
  ["zoning_nature", "수동 파일", "일별", "용도지역 5종"],
  ["zoning_other", "수동 파일", "일별", "용도지역 5종"],
  ["land_price", "수동 파일", "연 1회"],
  ["mzone_zone", "수동 파일", "일별", "정비구역 5종"],
  ["mzone_redevelopment", "수동 파일", "일별", "정비구역 5종"],
  ["mzone_promotion", "수동 파일", "일별", "정비구역 5종"],
  ["mzone_planned", "수동 파일", "일별", "정비구역 5종"],
  ["mzone_improvement", "수동 파일", "일별", "정비구역 5종"],
  ["district_area", "수동 파일", "일별", "구역·지구 5종"],
  ["district_greenbelt", "수동 파일", "일별", "구역·지구 5종"],
  ["district_land_development", "수동 파일", "일별", "구역·지구 5종"],
  ["district_urban_development", "수동 파일", "일별", "구역·지구 5종"],
  ["district_industrial", "수동 파일", "일별", "구역·지구 5종"],
  ["facility_transport", "수동 파일", "일별", "도시계획시설 8종"],
  ["facility_space", "수동 파일", "일별", "도시계획시설 8종"],
  ["facility_distribution_supply", "수동 파일", "일별", "도시계획시설 8종"],
  ["facility_public_culture_sports", "수동 파일", "일별", "도시계획시설 8종"],
  ["facility_disaster_prevention", "수동 파일", "일별", "도시계획시설 8종"],
  ["facility_health_hygiene", "수동 파일", "일별", "도시계획시설 8종"],
  ["facility_environmental_basic", "수동 파일", "일별", "도시계획시설 8종"],
  ["facility_other_infrastructure", "수동 파일", "일별", "도시계획시설 8종"],
  ["applyhome", "기존 앱 적재본", "일", "청약·입주예정"],
  ["applyhome_types", "수동 파일", "수시", "청약·입주예정"],
  ["move_in", "수동 파일", "반기", "청약·입주예정"],
  ["maintenance_integrated", "수동 파일", "연 1회", "정비사업 명부"],
  ["maintenance_std", "수동 파일", "수시", "정비사업 명부"],
  ["rtms_apt_trade", "수동 API 배치", "수시 신고", "RTMS 아파트"],
  ["rtms_apt_rent", "수동 API 배치", "수시 신고", "RTMS 아파트"],
  ["rtms_offi_trade", "수동 API 배치", "수시 신고", "RTMS 오피스텔"],
  ["rtms_offi_rent", "수동 API 배치", "수시 신고", "RTMS 오피스텔"],
  ["building", "수동 파일", "수시"],
  ["gis_bldg", "수동 파일", "수시"],
  ["building_juso", "수동 파일", "월간"],
  ["terrain_tiles", "수동 파일", "갱신 없음"],
  ["asos", "수동 API 배치", "시간(10년 집계)"],
  ["vworld_wmts", "실시간", "—"],
  ["ngii_topo", "사용자 업로드", "분석별"],
  ["browser_lbm", "앱 계산", "—"],
  ["fallback_d2q9", "앱 계산", "—"],
];

for (const [sourceId, collect, cycle, group] of rows) {
  assert.deepEqual(sourceOps(sourceId), { collect, cycle, group: group ?? null }, sourceId);
}

assert.equal(sourceOps("zoning_urban").group, "용도지역 5종");
assert.deepEqual(sourceOps("없는id"), { collect: null, cycle: null, group: null });
assert.equal(SOURCE_DETAIL_DEFINITIONS.building_juso.role, "보강");
assert.equal(SOURCE_DETAIL_DEFINITIONS.building_juso.usedFor, "GIS에 없는 건물과 층수·건물명 보강");

console.log("✓ admin source operations");
