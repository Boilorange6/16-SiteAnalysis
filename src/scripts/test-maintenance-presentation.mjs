import assert from "node:assert/strict";
import {
  MAINTENANCE_BOUNDARY_LEGEND,
  MAINTENANCE_LEGAL_FOOTER,
  MAINTENANCE_PRESENTATION_COLUMNS,
  MAINTENANCE_PRESENTATION_SOURCES,
  buildMaintenancePresentationRows,
  projectMaintenanceBoundaries,
} from "../lib/maintenance-presentation.ts";
import { maintenanceSourceStatusLines, sourceStatusLines } from "../lib/source-status-text.ts";

const project = {
  id: "presentation-1",
  name: "테스트 재개발구역",
  lat: 37.5,
  lng: 127,
  category: "maintenance",
  type: "재개발",
  stage: "조합설립",
  address: "서울특별시 테스트구",
  area_sqm: 50_000,
  distance_m: 300,
  planned_households: 1_234,
  implementer: "테스트 재개발 조합",
  source: "molit_integrated",
  source_updated_at: "2026-07-20",
  boundary_status: "confirmed",
};

const [row] = buildMaintenancePresentationRows([project], 6);
assert.deepEqual(Object.keys(row), [
  "name", "typeStage", "implementer", "households",
  "areaDistance", "boundary", "sourceDate",
]);
assert.match(row.typeStage, /재개발.*조합설립/);
assert.match(row.implementer, /조합/);
assert.match(row.households, /1,234/);
assert.match(row.areaDistance, /5\.0+만㎡.*300m/);
assert.match(row.boundary, /공식 경계 확인/);
assert.match(row.sourceDate, /국토부.*2026-07-20/);

assert.deepEqual(MAINTENANCE_PRESENTATION_COLUMNS, [
  "구역명", "유형·단계", "시행자", "예정세대수", "면적·거리", "경계", "출처·기준일",
]);
assert.equal(MAINTENANCE_BOUNDARY_LEGEND, "정비사업 공식 경계(참고용)");
assert.equal(MAINTENANCE_LEGAL_FOOTER, "법적 효력 없는 참고자료");
assert.deepEqual(
  MAINTENANCE_PRESENTATION_SOURCES.map((source) => source.id),
  ["molit_integrated", "public_standard", "molit_spatial", "seoul_open_data", "busan_data_go_kr"],
);

const projects = [
  { ...project, id: "far", name: "가장 먼 사업", distance_m: 900 },
  { ...project, id: "same-unmatched", name: "가 사업", distance_m: 200, boundary_status: "unmatched" },
  { ...project, id: "same-confirmed-z", name: "하 사업", distance_m: 200, boundary_status: "confirmed" },
  { ...project, id: "same-confirmed-a", name: "나 사업", distance_m: 200, boundary_status: "confirmed" },
  { ...project, id: "nearest", name: "최근접 사업", distance_m: 10 },
  { ...project, id: "middle", name: "중간 사업", distance_m: 400 },
  { ...project, id: "sixth", name: "여섯째 사업", distance_m: 500 },
  { ...project, id: "seventh", name: "일곱째 사업", distance_m: 600 },
];
const rows = buildMaintenancePresentationRows(projects, 6);
assert.equal(rows.length, 6);
assert.deepEqual(rows.slice(0, 4).map((item) => item.name), [
  "최근접 사업", "나 사업", "하 사업", "가 사업",
]);
assert.equal(rows.some((item) => item.name === "가장 먼 사업"), false);

const incompleteRow = buildMaintenancePresentationRows([{
  ...project,
  implementer: undefined,
  planned_households: undefined,
  area_sqm: 0,
  distance_m: undefined,
  source_updated_at: undefined,
  boundary_status: "unavailable",
}], 1)[0];
assert.equal(incompleteRow.implementer, "미확인");
assert.equal(incompleteRow.households, "미확인");
assert.match(incompleteRow.areaDistance, /미확인/);
assert.equal(incompleteRow.boundary, "경계 미확인");
assert.match(incompleteRow.sourceDate, /기준일 미확인/);

const sourceStatuses = [
  { source: "maintenance_attributes", status: "fresh", fetchedAt: Date.UTC(2026, 6, 20) },
  { source: "maintenance_boundaries", status: "cached", fetchedAt: Date.UTC(2026, 6, 19) },
  { source: "maintenance_seoul", status: "failed", fetchedAt: null },
  { source: "maintenance_busan", status: "fresh", fetchedAt: Date.UTC(2026, 6, 18) },
];
const statusLines = sourceStatusLines(sourceStatuses);
assert.equal(statusLines.length, 4);
assert.match(statusLines[0], /국토부 전국 정비사업/);
assert.match(statusLines[1], /국토부 정비구역 경계/);
assert.match(statusLines[2], /서울 정비사업 상세.*수집 실패/);
assert.match(statusLines[3], /부산 정비사업 상세/);

const independentMaintenanceLines = maintenanceSourceStatusLines(sourceStatuses.slice(0, 2));
assert.equal(independentMaintenanceLines.length, 4);
assert.match(independentMaintenanceLines[0], /국토부 정비구역 경계/);
assert.match(independentMaintenanceLines[1], /국토부 전국 정비사업/);
assert.match(independentMaintenanceLines[2], /서울 정비사업 상세.*상태 미제공/);
assert.match(independentMaintenanceLines[3], /부산 정비사업 상세.*상태 미제공/);

const projectionConfig = { centerName: "경계 투영", centerLat: 37.5, centerLng: 127, radiusKm: 1 };
const radiusPosition = { centerNx: 0.5, centerNy: 0.5, radiusNx: 0.2, radiusNy: 0.3 };
const polygonWithHole = {
  ...project,
  id: "hole",
  boundary_status: "confirmed",
  boundary: {
    type: "Polygon",
    coordinates: [
      [[126.995, 37.495], [127.005, 37.495], [127.005, 37.505], [126.995, 37.495]],
      [[126.999, 37.499], [127.001, 37.499], [127.001, 37.501], [126.999, 37.499]],
    ],
  },
};
const multiPolygonBoundary = {
  ...project,
  id: "multi",
  boundary_status: "unmatched",
  boundary: {
    type: "MultiPolygon",
    coordinates: [
      [[[126.996, 37.496], [126.998, 37.496], [126.998, 37.498], [126.996, 37.496]]],
      [[[127.002, 37.502], [127.004, 37.502], [127.004, 37.504], [127.002, 37.502]]],
    ],
  },
};
const projected = projectMaintenanceBoundaries([
  polygonWithHole,
  multiPolygonBoundary,
  { ...project, id: "no-boundary", boundary_status: "unavailable", boundary: undefined },
], projectionConfig, radiusPosition);
assert.equal(projected.length, 2);
assert.equal(projected[0].polygons.length, 1);
assert.equal(projected[0].polygons[0].length, 2);
assert.equal(projected[1].polygons.length, 2);
assert.equal(projected[1].status, "unmatched");
assert.equal(projected.flatMap((item) => item.polygons).flatMap((polygon) => polygon).every((ring) => ring.length >= 4), true);
assert.equal(projected.flatMap((item) => item.polygons).flatMap((polygon) => polygon).flat().every((point) => Number.isFinite(point.nx) && Number.isFinite(point.ny)), true);

console.log("maintenance presentation: all tests passed");
