import assert from "node:assert/strict";
import {
  MAINTENANCE_BOUNDARY_LEGEND,
  MAINTENANCE_LEGAL_FOOTER,
  MAINTENANCE_PRESENTATION_COLUMNS,
  MAINTENANCE_PRESENTATION_SOURCES,
  GENERAL_PRESENTATION_SOURCES,
  GENERAL_SOURCE_CAUTIONS,
  MAINTENANCE_PRESENTATION_TYPOGRAPHY,
  SYNTHETIC_REPORT_NOTICE,
  buildMaintenancePresentationRows,
  formatMaintenanceTableName,
  formatMaintenanceMapBullet,
  formatReportPoiCount,
  projectMaintenanceBoundaries,
  syntheticReportNotice,
} from "../lib/maintenance-presentation.ts";
import {
  generalSourceStatusLines,
  maintenanceSourceStatusLines,
  reportPoisForSourceStatuses,
  sourceStatusLines,
} from "../lib/source-status-text.ts";
import { buildMaintenanceDetailLines, summarizeMaintenanceProjects } from "../lib/maintenance-analysis.ts";
import { computeAnalysisScores } from "../lib/analysis-engine.ts";

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
assert.match(row.typeStage, /재개발[\s\S]*조합설립/);
assert.match(row.typeStage, /\n/);
assert.equal(row.name, "테스트 재개발구역");
assert.equal(formatMaintenanceTableName("종로 가로주택정비"), "종로\n가로주택정비");
assert.equal(formatMaintenanceTableName("서울 구조검증 홀"), "서울 구조검증 홀");
assert.doesNotMatch(formatMaintenanceTableName("종로 가로주택정비"), /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/);
assert.equal(formatReportPoiCount([project, { ...project, id: "second" }]), "2개 POI");
assert.match(row.implementer, /조합/);
assert.match(row.households, /1,234/);
assert.match(row.areaDistance, /5\.0+만㎡[\s\S]*300m/);
assert.equal(row.boundary, "경계 확인");
assert.match(row.sourceDate, /국토부[\s\S]*2026-07-20/);
assert.match(row.sourceDate, /\n/);

assert.deepEqual(MAINTENANCE_PRESENTATION_COLUMNS, [
  "구역명", "유형·단계", "시행자", "예정세대수", "면적·거리", "경계", "출처·기준일",
]);
assert.equal(MAINTENANCE_BOUNDARY_LEGEND, "정비사업 공식 경계(참고용)");
assert.equal(MAINTENANCE_LEGAL_FOOTER, "법적 효력 없는 참고자료");
assert.deepEqual(
  MAINTENANCE_PRESENTATION_SOURCES.map((source) => source.id),
  ["molit_integrated", "public_standard", "molit_spatial", "seoul_open_data", "busan_data_go_kr"],
);
assert.equal(GENERAL_PRESENTATION_SOURCES.length, 6);
assert.equal(GENERAL_PRESENTATION_SOURCES.length + MAINTENANCE_PRESENTATION_SOURCES.length, 11);
assert.ok(MAINTENANCE_PRESENTATION_TYPOGRAPHY.mapBulletPt >= 14);
assert.ok(MAINTENANCE_PRESENTATION_TYPOGRAPHY.insightPt >= 13);
assert.ok(MAINTENANCE_PRESENTATION_TYPOGRAPHY.tableHeaderPt >= 12);
assert.ok(MAINTENANCE_PRESENTATION_TYPOGRAPHY.tableBodyPt >= 12);
assert.ok(MAINTENANCE_PRESENTATION_TYPOGRAPHY.sourceLabelPt >= 11);
assert.ok(MAINTENANCE_PRESENTATION_TYPOGRAPHY.cautionPt >= 11);
assert.ok(MAINTENANCE_PRESENTATION_TYPOGRAPHY.legalFooterPt >= 9);
assert.equal(GENERAL_SOURCE_CAUTIONS.length, 4);
assert.equal(GENERAL_SOURCE_CAUTIONS.every((line) => line.includes("\n")), true);
assert.equal(syntheticReportNotice({ centerName: "실데이터 보고서", centerLat: 0, centerLng: 0, radiusKm: 1 }), null);
assert.equal(
  syntheticReportNotice({ centerName: "합성 구조검증 데이터 · 실데이터 아님", centerLat: 0, centerLng: 0, radiusKm: 1 }),
  SYNTHETIC_REPORT_NOTICE,
);

const compactMapBullet = formatMaintenanceMapBullet("서울 구조검증 홀 (조합설립, 4.20만㎡, 240m)");
assert.equal(compactMapBullet, "서울 구조검증 홀\n4.20만㎡·240m");
assert.equal(compactMapBullet.includes("조합설립"), false);
const generatedPresentationText = [
  ...MAINTENANCE_PRESENTATION_COLUMNS,
  ...GENERAL_SOURCE_CAUTIONS,
  compactMapBullet,
  ...Object.values(row),
].join("\n");
assert.doesNotMatch(generatedPresentationText, /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/);

const streetHousingProject = { ...project, id: "street-housing", type: "가로주택정비", planned_households: 321 };
const streetHousingSummary = summarizeMaintenanceProjects([streetHousingProject]);
assert.equal(streetHousingSummary.totalPlannedHouseholds, 321);
assert.deepEqual(streetHousingSummary.typeCounts, { 가로주택정비: 1 });
assert.match(buildMaintenanceDetailLines([streetHousingProject]).join("\n"), /가로주택정비 1건/);

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

const missingDistanceRows = buildMaintenancePresentationRows([
  { ...project, id: "missing-unmatched", name: "가 미결합", distance_m: undefined, boundary_status: "unmatched" },
  { ...project, id: "missing-confirmed-z", name: "하 확정", distance_m: undefined, boundary_status: "confirmed" },
  { ...project, id: "missing-confirmed-a", name: "나 확정", distance_m: undefined, boundary_status: "confirmed" },
], 6);
assert.deepEqual(missingDistanceRows.map((item) => item.name), ["나 확정", "하 확정", "가 미결합"]);

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
  { source: "park", status: "failed", fetchedAt: null },
  { source: "maintenance_attributes", status: "fresh", fetchedAt: Date.UTC(2026, 6, 20) },
  { source: "maintenance_boundaries", status: "cached", fetchedAt: Date.UTC(2026, 6, 19) },
  { source: "maintenance_seoul", status: "failed", fetchedAt: null },
  { source: "maintenance_busan", status: "fresh", fetchedAt: Date.UTC(2026, 6, 18) },
];
const statusLines = sourceStatusLines(sourceStatuses);
assert.equal(statusLines.length, 5);
assert.match(statusLines[0], /공원.*수집 실패/);
assert.match(statusLines[1], /국토부 전국 정비사업/);
assert.match(statusLines[2], /국토부 정비구역 경계/);
assert.match(statusLines[3], /서울 정비사업 상세.*수집 실패/);
assert.match(statusLines[4], /부산 정비사업 상세/);

const generalLines = generalSourceStatusLines(sourceStatuses);
assert.equal(generalLines.length, 1);
assert.match(generalLines[0], /공원.*수집 실패.*누락/);

const stalePark = {
  id: "stale-park",
  name: "수집 실패 이전 공원",
  lat: 37.501,
  lng: 127.001,
  category: "park",
  area_sqm: 12_000,
  distance_m: 120,
};
assert.deepEqual(
  reportPoisForSourceStatuses([project, stalePark], sourceStatuses),
  [project],
);
assert.deepEqual(
  reportPoisForSourceStatuses([project, stalePark], [{ source: "park", status: "fresh", fetchedAt: Date.UTC(2026, 6, 20) }]),
  [project, stalePark],
);
const scoreConfig = { centerName: "공원 점수", centerLat: 37.5, centerLng: 127, radiusKm: 1 };
const freshNatureScore = computeAnalysisScores(scoreConfig, [project, stalePark]).items.find(({ key }) => key === "nature")?.score;
const failedNatureScore = computeAnalysisScores(scoreConfig, reportPoisForSourceStatuses([project, stalePark], sourceStatuses)).items.find(({ key }) => key === "nature")?.score;
assert.ok((freshNatureScore ?? 0) > 0);
assert.equal(failedNatureScore, 0);

const independentMaintenanceLines = maintenanceSourceStatusLines(sourceStatuses.slice(1, 3));
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
assert.equal(projected.filter((item) => item.status === "confirmed").flatMap((item) => item.polygons).flatMap((polygon) => polygon).length, 2);
assert.equal(projected.filter((item) => item.status === "unmatched").flatMap((item) => item.polygons).flatMap((polygon) => polygon).length, 2);
assert.equal(projected.flatMap((item) => item.polygons).flatMap((polygon) => polygon).every((ring) => ring.length >= 4), true);
assert.equal(projected.flatMap((item) => item.polygons).flatMap((polygon) => polygon).flat().every((point) => Number.isFinite(point.nx) && Number.isFinite(point.ny)), true);

console.log("maintenance presentation: all tests passed");
