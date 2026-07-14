// 순수 로직 테스트 — 고정 POI 입력 → 기대 팩트 검증
// 실행: npx tsx src/scripts/test-fact-summary.mjs
import assert from "node:assert/strict";
import { buildFactSummary, buildFactSheetRows, buildCategoryInsight } from "../lib/fact-summary.ts";
import { haversineDistance } from "../lib/geo.ts";

const config = { centerName: "테스트 입지", centerLat: 37.5, centerLng: 127.0, radiusKm: 1 };

const subwayStations = [
  { id: "s1", name: "가까운역", lat: 37.5010, lng: 127.0000, category: "subway", line: "2호선", lineColor: "#00A651" },
  { id: "s2", name: "먼역", lat: 37.5050, lng: 127.0000, category: "subway", line: "5호선", lineColor: "#996CAC" },
  { id: "s3", name: "같은노선역", lat: 37.5030, lng: 127.0000, category: "subway", line: "2호선", lineColor: "#00A651" },
];
const schools = [
  { id: "e1", name: "인근초등학교", lat: 37.4995, lng: 127.0005, category: "school", level: "elementary" },
  { id: "e2", name: "먼중학교", lat: 37.5080, lng: 127.0010, category: "school", level: "middle" },
];
const parks = [
  { id: "p1", name: "동네공원", lat: 37.5005, lng: 126.9995, category: "park", area_sqm: 1000, type: "neighborhood" },
];
const mountains = [
  { id: "m1", name: "뒷산", lat: 37.51, lng: 127.02, category: "mountain", elevation_m: 120 },
];
const residentials = [
  { id: "a1", name: "테스트아파트", lat: 37.5008, lng: 127.0008, category: "apartment", units: 500, parking_count: 400, sale_date: "2024-01", distance_m: 100, status: "existing", source: "ledger" },
  { id: "o1", name: "테스트오피스텔", lat: 37.5012, lng: 126.9992, category: "officetel", units: 200, parking_count: 100, sale_date: "2024-02", distance_m: 150, status: "existing", source: "ledger" },
  { id: "r1", name: "테스트생활형", lat: 37.4998, lng: 127.0002, category: "residential", units: 50, parking_count: 30, sale_date: "2024-03", distance_m: 200, status: "existing", source: "ledger" },
];
const maintenanceProjects = [
  {
    id: "mt1", name: "테스트정비구역", lat: 37.5020, lng: 127.0010, category: "maintenance",
    type: "재건축", stage: "조합설립", address: "서울시 어딘가 1", area_sqm: 5000,
    source: "seoul_open_data", boundary_status: "confirmed", distance_m: 300,
  },
];

const allPois = [...subwayStations, ...schools, ...parks, ...mountains, ...residentials, ...maintenanceProjects];

const summary = buildFactSummary({ config, allPois });

// ── transit ──────────────────────────────────────────────────────────────
const expectedNearestSubway = subwayStations.reduce((best, s) => {
  const d = haversineDistance(config.centerLat, config.centerLng, s.lat, s.lng);
  return !best || d < best.d ? { s, d } : best;
}, null);
assert.equal(summary.transit.nearestStationName, expectedNearestSubway.s.name);
assert.equal(summary.transit.distanceM, Math.round(expectedNearestSubway.d));
assert.equal(summary.transit.walkMin, Math.ceil(expectedNearestSubway.d / 80));
assert.equal(summary.transit.stationCount, 3);
assert.equal(summary.transit.lineCount, 2); // 2호선/5호선 중복 제거

// ── education ────────────────────────────────────────────────────────────
const expectedNearestSchool = schools.reduce((best, s) => {
  const d = haversineDistance(config.centerLat, config.centerLng, s.lat, s.lng);
  return !best || d < best.d ? { s, d } : best;
}, null);
assert.equal(summary.education.schoolCount, 2);
assert.equal(summary.education.nearestSchoolName, expectedNearestSchool.s.name);
assert.equal(summary.education.distanceM, Math.round(expectedNearestSchool.d));

// ── nature ───────────────────────────────────────────────────────────────
assert.equal(summary.nature.parkCount, 1);
assert.equal(summary.nature.mountainCount, 1);
assert.equal(summary.nature.nearestParkName, "동네공원");
const expectedParkDist = haversineDistance(config.centerLat, config.centerLng, parks[0].lat, parks[0].lng);
assert.equal(summary.nature.nearestParkDistanceM, Math.round(expectedParkDist));

// ── housing ──────────────────────────────────────────────────────────────
assert.equal(summary.housing.complexCount, 3);
assert.equal(summary.housing.totalHouseholds, 750);

// ── maintenance ──────────────────────────────────────────────────────────
assert.equal(summary.maintenance.count, 1);
assert.equal(summary.maintenance.boundaryConfirmedCount, 1);
assert.equal(summary.maintenance.totalAreaSqm, 5000);

// ── empty input → 모든 nearest/distance 필드 null, count 0 ─────────────────
const empty = buildFactSummary({ config, allPois: [] });
assert.equal(empty.transit.nearestStationName, null);
assert.equal(empty.transit.distanceM, null);
assert.equal(empty.transit.walkMin, null);
assert.equal(empty.transit.stationCount, 0);
assert.equal(empty.transit.lineCount, 0);
assert.equal(empty.education.schoolCount, 0);
assert.equal(empty.education.nearestSchoolName, null);
assert.equal(empty.education.distanceM, null);
assert.equal(empty.nature.parkCount, 0);
assert.equal(empty.nature.mountainCount, 0);
assert.equal(empty.nature.nearestParkName, null);
assert.equal(empty.nature.nearestParkDistanceM, null);
assert.equal(empty.housing.complexCount, 0);
assert.equal(empty.housing.totalHouseholds, 0);
assert.equal(empty.maintenance.count, 0);
assert.equal(empty.maintenance.boundaryConfirmedCount, 0);
assert.equal(empty.maintenance.totalAreaSqm, 0);

// ── buildFactSheetRows: 8행 구조 + 핵심 수치 accent 표기 확인 ────────────────
const rows = buildFactSheetRows(config, summary, new Date(2026, 6, 13));
assert.equal(rows.length, 8);
assert.equal(rows[0].label, "분석 대상");
assert.equal(rows[0].value[0].text, config.centerName);
assert.equal(rows[1].value.some((seg) => seg.accent && seg.text.includes("1km")), true);
assert.equal(rows[2].value[0].text, new Date(2026, 6, 13).toLocaleDateString("ko-KR"));
// 최근접 역 행: 거리·도보분 세그먼트가 accent로 표시되는지
const transitRow = rows[3];
assert.ok(transitRow.value.some((seg) => seg.accent && seg.text.endsWith("m")));
assert.ok(transitRow.value.some((seg) => seg.accent && seg.text.endsWith("분")));
// 빈 데이터 케이스: accent 없는 안내 문구 1개
const emptyRows = buildFactSheetRows(config, empty, new Date(2026, 6, 13));
assert.deepEqual(emptyRows[3].value, [{ text: "반경 내 확인된 역 없음" }]);

// ── buildCategoryInsight (Task 5): 카테고리별 2-4줄 인사이트 카드 문장 ─────────────
const transitInsight = buildCategoryInsight("transit", summary);
assert.equal(transitInsight.length, 2);
assert.ok(transitInsight[0].includes(expectedNearestSubway.s.name));
assert.ok(transitInsight[0].includes(`${summary.transit.walkMin}분`));
assert.ok(transitInsight[0].includes(`${summary.transit.distanceM}m`));
assert.ok(transitInsight[1].includes(`${summary.transit.stationCount}개`));
assert.ok(transitInsight[1].includes(`${summary.transit.lineCount}개 노선`));
assert.deepEqual(buildCategoryInsight("transit", empty), []);

const educationInsight = buildCategoryInsight("education", summary);
assert.ok(educationInsight.some((line) => line.includes(expectedNearestSchool.s.name)));
assert.ok(educationInsight.some((line) => line.includes(`${summary.education.schoolCount}개`)));
assert.deepEqual(buildCategoryInsight("education", empty), []);

const natureInsight = buildCategoryInsight("nature", summary);
assert.ok(natureInsight.some((line) => line.includes("동네공원")));
assert.ok(natureInsight.some((line) => line.includes(`산 ${summary.nature.mountainCount}개`)));
assert.deepEqual(buildCategoryInsight("nature", empty), []);

const housingInsight = buildCategoryInsight("housing", summary);
assert.ok(housingInsight.some((line) => line.includes("3개")));
assert.ok(housingInsight.some((line) => line.includes("750")));
assert.deepEqual(buildCategoryInsight("housing", empty), []);

const maintenanceInsight = buildCategoryInsight("maintenance", summary);
assert.ok(maintenanceInsight.some((line) => line.includes("1건")));
assert.ok(maintenanceInsight.some((line) => line.includes("경계 확인 1건")));
assert.deepEqual(buildCategoryInsight("maintenance", empty), []);

console.log("fact-summary: all tests passed");
