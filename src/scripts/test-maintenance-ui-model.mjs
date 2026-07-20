import assert from "node:assert/strict";
import {
  boundaryToLeafletLatLngs,
  buildMaintenancePopupHtml,
  maintenanceBoundaryLabel,
  maintenanceSourceLabel,
} from "../lib/maintenance-map-utils.ts";
import { summarizeMaintenanceProjects } from "../lib/maintenance-analysis.ts";

const polygonWithHole = {
  type: "Polygon",
  coordinates: [
    [[127, 37.5], [127.02, 37.5], [127.02, 37.52], [127, 37.5]],
    [[127.005, 37.505], [127.01, 37.505], [127.01, 37.51], [127.005, 37.505]],
  ],
};
assert.deepEqual(boundaryToLeafletLatLngs(polygonWithHole)[1][0], [37.505, 127.005]);

const multiPolygon = {
  type: "MultiPolygon",
  coordinates: [polygonWithHole.coordinates, [[
    [129.0, 35.1], [129.01, 35.1], [129.01, 35.11], [129.0, 35.1],
  ]]],
};
assert.deepEqual(boundaryToLeafletLatLngs(multiPolygon)[1][0][0], [35.1, 129]);
assert.equal(maintenanceBoundaryLabel("confirmed"), "공식 경계 확인");
assert.equal(maintenanceBoundaryLabel("unmatched"), "공식 경계 · 사업정보 미결합");
assert.equal(maintenanceBoundaryLabel("unavailable"), "경계 미확인");

assert.deepEqual(
  ["molit_integrated", "public_standard", "molit_spatial", "seoul_open_data", "busan_data_go_kr"].map(maintenanceSourceLabel),
  ["국토부 전국 정비사업", "공공데이터 표준 정비사업", "국토부 정비구역 경계", "서울 열린데이터광장", "부산 정비사업 API"],
);

const projects = [
  {
    id: "a", name: "A", lat: 37.5, lng: 127, category: "maintenance",
    type: "재개발", stage: "조합설립", address: "", area_sqm: 1000,
    planned_households: 200, source: "molit_integrated", boundary_status: "confirmed",
  },
  {
    id: "b", name: "B", lat: 37.51, lng: 127, category: "maintenance",
    type: "재건축", stage: "미확인", address: "", area_sqm: 0,
    planned_households: 300, source: "molit_spatial", boundary_status: "unmatched",
  },
  {
    id: "c", name: "C", lat: 35.1, lng: 129, category: "maintenance",
    type: "재개발", stage: "착공", address: "", area_sqm: 2000,
    source: "busan_data_go_kr", boundary_status: "unavailable",
  },
];
const summary = summarizeMaintenanceProjects(projects);
assert.equal(summary.totalPlannedHouseholds, 500);
assert.equal(summary.boundaryConfirmedCount, 1);
assert.equal(summary.boundaryUnmatchedCount, 1);
assert.equal(summary.boundaryUnavailableCount, 1);
assert.deepEqual(summary.typeCounts, { 재개발: 2, 재건축: 1 });

const manyProjects = Array.from({ length: 12 }, (_, index) => ({
  ...projects[0],
  id: `many-${index}`,
  name: `전체 표시 사업 ${index + 1}`,
  area_sqm: 12_000 - index,
}));
assert.equal(summarizeMaintenanceProjects(manyProjects).topProjects.length, 12);

const popup = buildMaintenancePopupHtml({
  ...projects[0],
  name: '<img src=x onerror="alert(1)">',
  implementer: "A&B <script>",
  designation_date: "2026-07-20",
  source_updated_at: "2026-07-19",
  notice_url: "https://example.test/notice?a=1&b=2",
});
assert.equal(popup.includes("<script>"), false);
assert.equal(popup.includes("<img"), false);
assert.match(popup, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
assert.match(popup, /A&amp;B &lt;script&gt;/);
assert.match(popup, /rel="noopener noreferrer"/);
assert.match(popup, /법적 효력 없는 참고자료/);
assert.match(popup, /font-size:12px[^>]*>법적 효력 없는 참고자료/);
assert.match(popup, /국토부 전국 정비사업/);

console.log("maintenance UI model tests passed");
