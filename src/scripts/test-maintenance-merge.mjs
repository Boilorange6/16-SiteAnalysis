import assert from "node:assert/strict";

import { mergeMaintenanceData } from "../lib/server/maintenance/merge.ts";

const geometry = {
  type: "Polygon",
  coordinates: [[[127, 37.5], [127.01, 37.5], [127.01, 37.51], [127, 37.5]]],
};
const region = { sido: "서울특별시", sigungu: "중구" };

function attribute(overrides = {}) {
  return {
    source_record_id: "ATTR-1", source: "molit_integrated",
    sido: region.sido, sigungu: region.sigungu, name: "청계 재개발구역",
    type: "재개발", stage: "구역지정/변경", area_sqm: 100,
    ...overrides,
  };
}

function boundary(overrides = {}) {
  const properties = {
    source_feature_id: "BOUNDARY-1", source_dataset_id: "30335", source_layer: "UD602",
    name: "청계 정비구역", sido: region.sido, sigungu: region.sigungu, area_sqm: 100,
    notice_ids: [], original_crs: "EPSG:5186", source_url: "https://example.test/spatial",
    retrieved_at: "2026-07-20T00:00:00Z", bbox: [127, 37.5, 127.01, 37.51],
    ...overrides,
  };
  return { type: "Feature", geometry, properties };
}

function merge(overrides = {}) {
  return mergeMaintenanceData({
    attributes: [attribute()], boundaries: [boundary()], regional: [], selectedRegions: [region],
    ...overrides,
  });
}

// Given a common official identifier / When records are merged / Then the boundary is confirmed.
{
  const result = merge({
    attributes: [attribute({ source_record_id: "  official-7  " })],
    boundaries: [boundary({ source_feature_id: "OFFICIAL-7", name: "다른 명칭" })],
  });
  assert.equal(result.projects[0]?.boundary_status, "confirmed");
  assert.deepEqual(result.projects[0]?.boundary, geometry);
}

// Given a Seoul notice identifier / When case and surrounding spaces differ / Then exact normalized ID confirms.
{
  const result = merge({
    attributes: [],
    regional: [{
      source_record_id: "SEOUL-1", official_ids: [" ntfc-77 "], source: "seoul_open_data",
      sido: region.sido, sigungu: region.sigungu, name: "세운구역", type: "재개발", stage: "조합설립",
    }],
    boundaries: [boundary({ notice_ids: ["NTFC-77"], name: "별도 표기" })],
  });
  assert.equal(result.projects[0]?.boundary_status, "confirmed");
  assert.equal(result.projects[0]?.source, "seoul_open_data");
}

// Given unique normalized region/name and exactly 5% area difference / When merged / Then it confirms.
{
  const result = merge({
    attributes: [attribute({ source_record_id: "A", name: "청계-재개발구역", area_sqm: 95 })],
    boundaries: [boundary({ source_feature_id: "B", name: "청계 정비구역", area_sqm: 100 })],
  });
  assert.equal(result.projects[0]?.boundary_status, "confirmed");
}

// Given area difference above 5% / When merge is attempted / Then records stay unmatched.
{
  const result = merge({ attributes: [attribute({ area_sqm: 94 })] });
  assert.equal(result.projects[0]?.boundary_status, "unmatched");
  assert.equal(result.catalog.length, 1);
  assert.equal(result.diagnostics.some(({ reason }) => reason === "area_mismatch"), true);
}

// Given duplicate normalized names on either candidate side / When merged / Then each side is ambiguous.
{
  const duplicateAttribute = merge({ attributes: [attribute({ source_record_id: "A1" }), attribute({ source_record_id: "A2" })] });
  assert.equal(duplicateAttribute.projects[0]?.boundary_status, "unmatched");
  assert.equal(duplicateAttribute.diagnostics.some(({ reason }) => reason === "ambiguous"), true);

  const duplicateBoundary = merge({
    boundaries: [boundary({ source_feature_id: "B1" }), boundary({ source_feature_id: "B2" })],
  });
  assert.equal(duplicateBoundary.projects.every(({ boundary_status }) => boundary_status === "unmatched"), true);
  assert.equal(duplicateBoundary.diagnostics.some(({ reason }) => reason === "ambiguous"), true);
}

// Given different sigungu values / When names agree / Then admin mismatch prevents merging.
{
  const result = merge({ boundaries: [boundary({ sigungu: "종로구" })] });
  assert.equal(result.projects[0]?.boundary_status, "unmatched");
  assert.equal(result.diagnostics.some(({ reason }) => reason === "admin_mismatch"), true);
}

// Given conflicting designation dates / When merged / Then date mismatch prevents merging.
{
  const result = merge({
    attributes: [attribute({ designation_date: "2024-01-01" })],
    boundaries: [boundary({ designation_date: "2024-01-02" })],
  });
  assert.equal(result.projects[0]?.boundary_status, "unmatched");
  assert.equal(result.diagnostics.some(({ reason }) => reason === "date_mismatch"), true);
}

// Given regional, standard, and integrated fields / When one boundary joins / Then field priority retains provenance.
{
  const common = { source_record_id: "COMMON", sido: region.sido, sigungu: region.sigungu, name: "청계구역", type: "재개발", stage: "추진위" };
  const result = merge({
    attributes: [
      { ...common, source: "molit_integrated", implementer: "통합 시행자", management_agency: "통합 기관", planned_households: 500 },
      { ...common, source: "public_standard", implementer: "표준 시행자", planned_households: 550 },
    ],
    regional: [{ ...common, source: "seoul_open_data", official_ids: ["COMMON"], implementer: "지역 시행자" }],
    boundaries: [boundary({ source_feature_id: "COMMON" })],
  });
  const project = result.projects[0];
  const provenance = result.internalProjects[0]?.field_provenance;
  assert.equal(project?.implementer, "지역 시행자");
  assert.equal(project?.planned_households, 550);
  assert.equal(project?.management_agency, "통합 기관");
  assert.equal(provenance?.implementer?.source, "seoul_open_data");
  assert.equal(provenance?.planned_households?.source, "public_standard");
  assert.equal(provenance?.management_agency?.source, "molit_integrated");
  assert.equal("field_provenance" in project, false);
}

// Given a named unmatched polygon / When projected / Then it remains a safe spatial-only project.
{
  const result = merge({ attributes: [] });
  const project = result.projects[0];
  assert.equal(project?.source, "molit_spatial");
  assert.equal(project?.type, "정비구역");
  assert.equal(project?.stage, "미확인");
  assert.equal(project?.boundary_status, "unmatched");
  assert.deepEqual(project?.boundary, geometry);
  assert.equal(project?.lat > 37 && project?.lng > 126, true);
}

// Given an unnamed unmatched polygon / When projected / Then it is excluded with a diagnostic.
{
  const result = merge({ attributes: [], boundaries: [boundary({ name: undefined })] });
  assert.equal(result.projects.length, 0);
  assert.equal(result.diagnostics[0]?.reason, "unnamed_boundary");
}

// Given an unmatched selected-region attribute / When projected / Then its catalog entry has no coordinates.
{
  const result = merge({ boundaries: [] });
  assert.equal(result.catalog[0]?.spatial_status, "not_located");
  assert.equal("lat" in result.catalog[0], false);
  assert.equal("lng" in result.catalog[0], false);
}

// Given an unmatched attribute outside the selected region / When projected / Then it stays out of this response.
{
  const outside = attribute({ sido: "부산광역시", sigungu: "중구" });
  const result = merge({ attributes: [outside], boundaries: [] });
  assert.equal(result.catalog.length, 0);
  assert.equal(outside.sido, "부산광역시");
}

// Given the same name/address in distinct regions / When merged / Then address similarity cannot cross-merge.
{
  const result = merge({
    attributes: [attribute({ sido: "부산광역시", sigungu: "중구", name: "청계구역", address: "중앙로 1" })],
    boundaries: [boundary({ name: "청계구역" })],
    selectedRegions: [region, { sido: "부산광역시", sigungu: "중구" }],
  });
  assert.equal(result.projects[0]?.boundary_status, "unmatched");
  assert.equal(result.catalog.length, 1);
}

// Given a stale candidate record / When merged / Then its own incompatible dates reject it.
{
  const stale = merge({
    attributes: [attribute({ designation_date: "2024-02-01", source_updated_at: "2024-01-31" })],
  });
  assert.equal(stale.projects[0]?.boundary_status, "unmatched");
  assert.equal(stale.diagnostics.some(({ reason }) => reason === "date_mismatch"), true);
}

// Given a substring-only official ID / When names differ / Then substring similarity is ignored.
{
  const result = merge({
    attributes: [attribute({ source_record_id: "PREFIX-ABC-SUFFIX", name: "별도" })],
    boundaries: [boundary({ source_feature_id: "ABC", name: "다른 이름" })],
  });
  assert.equal(result.projects[0]?.boundary_status, "unmatched");
  assert.equal(result.catalog.length, 1);
}

console.log("maintenance merge: ok");
