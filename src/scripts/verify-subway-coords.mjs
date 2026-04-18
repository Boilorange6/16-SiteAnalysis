/**
 * verify-subway-coords.mjs
 * 지하철역 좌표 검증 스크립트 (COO-32)
 *
 * 검사 항목:
 *   V01 - 역 ID 중복 없음
 *   V02 - 노선 stationIds 존재 여부
 *   V03 - 역 좌표가 서울 경계 내 (위도 37.4~37.7, 경도 126.7~127.2)
 *   V04 - 역이 분석 반경 + 2km 버퍼 이내
 *   V05 - 인접 역 간 거리 ≤ 3km (동일 노선)
 *   V06 - 경로 좌표 연속성 (연속 세그먼트 ≤ 1km)
 *   V07 - 역 좌표가 해당 노선 경로 좌표에서 ≤ 500m 이내
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_ROOT = path.join(__dirname, '../../public/data');
const RESULTS_DIR = path.join(__dirname, '../../output');

// ---------------------------------------------------------------------------
// Haversine 거리 계산 (단위: m)
// ---------------------------------------------------------------------------
function haversineDistance(lat1, lng1, lat2, lng2) {
  const EARTH_RADIUS_M = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// 결과 누적
// ---------------------------------------------------------------------------
const checks = [];

function addCheck(id, category, label, passed, detail) {
  checks.push({ id, category, label, passed, detail });
}

// ---------------------------------------------------------------------------
// 지역별 검증
// ---------------------------------------------------------------------------
function verifyRegion(region) {
  const { regionCode, regionName, defaultConfig } = region;
  const { centerLat, centerLng, radiusKm } = defaultConfig;
  const maxDistM = (radiusKm + 2) * 1000; // 2km 버퍼

  const stationsPath = path.join(DATA_ROOT, 'seed', regionCode, 'subway-stations.json');
  const routesPath   = path.join(DATA_ROOT, 'seed', regionCode, 'subway-routes.json');

  const stations = JSON.parse(fs.readFileSync(stationsPath, 'utf-8'));
  const routes   = JSON.parse(fs.readFileSync(routesPath,   'utf-8'));

  const stationMap = new Map(stations.map((s) => [s.id, s]));
  const prefix = regionCode;

  // ------ V01: 역 ID 중복 -----------------------------------------------
  const idSet = new Set();
  const duplicates = [];
  for (const s of stations) {
    if (idSet.has(s.id)) duplicates.push(s.id);
    idSet.add(s.id);
  }
  addCheck(
    `${prefix}/V01`,
    'V01 역ID 중복',
    `[${regionName}] 역 ID 고유성`,
    duplicates.length === 0,
    duplicates.length === 0
      ? `총 ${stations.length}개 역 — 중복 없음`
      : `중복 ID: ${duplicates.join(', ')}`,
  );

  // ------ V02: stationIds 존재 여부 --------------------------------------
  for (const route of routes) {
    const missing = route.stationIds.filter((id) => !stationMap.has(id));
    addCheck(
      `${prefix}/V02/${route.line}`,
      'V02 stationId 존재',
      `[${regionName}] ${route.line} stationIds 유효성`,
      missing.length === 0,
      missing.length === 0
        ? '모든 stationId 정상'
        : `존재하지 않는 ID: ${missing.join(', ')}`,
    );
  }

  // ------ V03: 서울 경계 내 좌표 ----------------------------------------
  const SEOUL_BOUNDS = { latMin: 37.4, latMax: 37.7, lngMin: 126.7, lngMax: 127.2 };
  for (const s of stations) {
    const inBounds =
      s.lat >= SEOUL_BOUNDS.latMin && s.lat <= SEOUL_BOUNDS.latMax &&
      s.lng >= SEOUL_BOUNDS.lngMin && s.lng <= SEOUL_BOUNDS.lngMax;
    addCheck(
      `${prefix}/V03/${s.id}`,
      'V03 서울 경계',
      `[${regionName}] ${s.name} 서울 경계 내 위치`,
      inBounds,
      inBounds
        ? `(${s.lat}, ${s.lng}) — 정상`
        : `(${s.lat}, ${s.lng}) — 서울 경계 초과!`,
    );
  }

  // ------ V04: 분석 반경 버퍼 이내 ----------------------------------------
  for (const s of stations) {
    const distM = haversineDistance(centerLat, centerLng, s.lat, s.lng);
    const inRange = distM <= maxDistM;
    addCheck(
      `${prefix}/V04/${s.id}`,
      'V04 반경 버퍼',
      `[${regionName}] ${s.name} 반경 ${radiusKm + 2}km 이내`,
      inRange,
      `거리 ${(distM / 1000).toFixed(2)}km (한계 ${(maxDistM / 1000).toFixed(0)}km)`,
    );
  }

  // ------ V05: 인접 역 간 거리 ≤ 3km ------------------------------------
  const MAX_ADJACENT_M = 3000;
  for (const route of routes) {
    const validIds = route.stationIds.filter((id) => stationMap.has(id));
    for (let i = 1; i < validIds.length; i++) {
      const a = stationMap.get(validIds[i - 1]);
      const b = stationMap.get(validIds[i]);
      const distM = haversineDistance(a.lat, a.lng, b.lat, b.lng);
      const ok = distM <= MAX_ADJACENT_M;
      addCheck(
        `${prefix}/V05/${route.line}/${i}`,
        'V05 인접역 거리',
        `[${regionName}] ${route.line} ${a.name}→${b.name}`,
        ok,
        `${(distM / 1000).toFixed(2)}km ${ok ? '✓' : '⚠ 3km 초과!'}`,
      );
    }
  }

  // ------ V06: 경로 좌표 연속성 (세그먼트 ≤ 1km) -----------------------
  const MAX_SEGMENT_M = 1000;
  for (const route of routes) {
    if (!route.coordinates || route.coordinates.length < 2) {
      addCheck(
        `${prefix}/V06/${route.line}/coords`,
        'V06 경로 연속성',
        `[${regionName}] ${route.line} 좌표 배열`,
        false,
        'coordinates 누락 또는 점 부족',
      );
      continue;
    }
    let maxSeg = 0;
    let maxSegIdx = -1;
    for (let i = 1; i < route.coordinates.length; i++) {
      const [lat1, lng1] = route.coordinates[i - 1];
      const [lat2, lng2] = route.coordinates[i];
      const d = haversineDistance(lat1, lng1, lat2, lng2);
      if (d > maxSeg) { maxSeg = d; maxSegIdx = i; }
    }
    const ok = maxSeg <= MAX_SEGMENT_M;
    addCheck(
      `${prefix}/V06/${route.line}`,
      'V06 경로 연속성',
      `[${regionName}] ${route.line} 최대 세그먼트`,
      ok,
      `최대 세그먼트 ${(maxSeg / 1000).toFixed(3)}km (인덱스 ${maxSegIdx - 1}→${maxSegIdx}) ${ok ? '✓' : '⚠ 1km 초과!'}`,
    );
  }

  // ------ V07: 역 좌표 ↔ 노선 경로 일치 (≤ 500m) -----------------------
  const MAX_STATION_ROUTE_M = 500;
  for (const route of routes) {
    if (!route.coordinates || route.coordinates.length === 0) continue;
    for (const stationId of route.stationIds) {
      const s = stationMap.get(stationId);
      if (!s) continue;
      const minDist = Math.min(
        ...route.coordinates.map(([lat, lng]) =>
          haversineDistance(s.lat, s.lng, lat, lng),
        ),
      );
      const ok = minDist <= MAX_STATION_ROUTE_M;
      addCheck(
        `${prefix}/V07/${route.line}/${stationId}`,
        'V07 역↔경로 일치',
        `[${regionName}] ${s.name} ↔ ${route.line} 경로`,
        ok,
        `최소 거리 ${minDist.toFixed(0)}m ${ok ? '✓' : '⚠ 500m 초과!'}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------
function main() {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const regions = JSON.parse(
    fs.readFileSync(path.join(DATA_ROOT, 'regions.json'), 'utf-8'),
  );

  for (const region of regions) {
    verifyRegion(region);
  }

  // 결과 집계
  const passed  = checks.filter((c) => c.passed);
  const failed  = checks.filter((c) => !c.passed);

  // 카테고리별 집계
  const categoryMap = {};
  for (const c of checks) {
    if (!categoryMap[c.category]) categoryMap[c.category] = { pass: 0, fail: 0, items: [] };
    categoryMap[c.category][c.passed ? 'pass' : 'fail']++;
    if (!c.passed) categoryMap[c.category].items.push(c);
  }

  // 콘솔 출력
  console.log('\n=== 지하철역 좌표 검증 결과 ===');
  console.log(`총 ${checks.length}건  통과 ${passed.length}건  실패 ${failed.length}건\n`);

  for (const [cat, stat] of Object.entries(categoryMap)) {
    const mark = stat.fail === 0 ? '✓' : '✗';
    console.log(`${mark} ${cat}: ${stat.pass}pass / ${stat.fail}fail`);
    for (const f of stat.items) {
      console.log(`    FAIL  ${f.label}`);
      console.log(`          ${f.detail}`);
    }
  }

  // JSON 결과 저장
  const reportPath = path.join(RESULTS_DIR, 'subway-coord-verification.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        summary: { total: checks.length, passed: passed.length, failed: failed.length },
        byCategory: Object.fromEntries(
          Object.entries(categoryMap).map(([k, v]) => [
            k,
            { pass: v.pass, fail: v.fail, failures: v.items.map((i) => ({ id: i.id, label: i.label, detail: i.detail })) },
          ]),
        ),
        checks,
      },
      null,
      2,
    ),
  );
  console.log(`\n결과 저장: ${reportPath}`);

  process.exitCode = failed.length > 0 ? 1 : 0;
}

main();
