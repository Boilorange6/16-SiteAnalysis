/**
 * verify-subway-coords.mjs
 * 지하철 좌표 검증 스크립트
 *
 * 정적 public/data 시드가 동적 API/Overpass 기반 데이터로 리팩터링되었기
 * 때문에, 현재 산출물 JSON과 동적 노선 공급자 계약을 함께 검증한다.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.join(__dirname, '../..');
const RESULTS_DIR = path.join(__dirname, '../../output');
const ANALYSIS_PATH = path.join(RESULTS_DIR, 'cheongwadae-analysis.json');
const ROUTE_PROVIDER_PATH = path.join(PROJECT_ROOT, 'src/lib/overpass-subway-routes.ts');

const CENTER = { lat: 37.5866, lng: 126.9748 };
const SEOUL_BOUNDS = { latMin: 37.4, latMax: 37.7, lngMin: 126.7, lngMax: 127.2 };

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

function verifyAnalysisSubwayLayer(analysis) {
  const radiusKm = Number(analysis.radiusKm);
  const maxDistM = (radiusKm + 3) * 1000;
  const subwayLayer = analysis.layers?.find((layer) => layer.type === 'subways');
  const stations = Array.isArray(subwayLayer?.items) ? subwayLayer.items : [];

  addCheck(
    'analysis/V01',
    'V01 중심 좌표',
    '청와대 중심 좌표 고정',
    Math.abs(Number(analysis.center?.lat) - CENTER.lat) < 0.000001 &&
      Math.abs(Number(analysis.center?.lng) - CENTER.lng) < 0.000001,
    `center=${JSON.stringify(analysis.center)}`,
  );

  addCheck(
    'analysis/V02',
    'V02 역 개수',
    'subways.count와 items 길이 일치',
    Number(subwayLayer?.count) === stations.length && stations.length > 0,
    `count=${subwayLayer?.count}, items=${stations.length}`,
  );

  const duplicateKeys = stations
    .map((s) => `${Number(s.lat).toFixed(5)},${Number(s.lng).toFixed(5)}`);
  const duplicateCounts = duplicateKeys.reduce((acc, key) => {
    acc.set(key, (acc.get(key) ?? 0) + 1);
    return acc;
  }, new Map());

  stations.forEach((station, idx) => {
    const label = `subway-${String(idx + 1).padStart(2, '0')}`;
    const hasCoordinates = typeof station?.lat === 'number' && typeof station?.lng === 'number';
    addCheck(
      `analysis/V03/${label}`,
      'V03 좌표 형식',
      `${label} 숫자 좌표 보유`,
      hasCoordinates,
      hasCoordinates ? `(${station.lat}, ${station.lng})` : JSON.stringify(station),
    );

    const key = duplicateKeys[idx];
    const isUnique = (duplicateCounts.get(key) ?? 0) === 1;
    addCheck(
      `analysis/V04/${label}`,
      'V04 좌표 중복',
      `${label} 좌표 고유성`,
      hasCoordinates && isUnique,
      hasCoordinates && isUnique ? `${key} 고유` : `${key} 중복`,
    );

    const inBounds =
      hasCoordinates &&
      station.lat >= SEOUL_BOUNDS.latMin &&
      station.lat <= SEOUL_BOUNDS.latMax &&
      station.lng >= SEOUL_BOUNDS.lngMin &&
      station.lng <= SEOUL_BOUNDS.lngMax;
    addCheck(
      `analysis/V05/${label}`,
      'V05 서울 경계',
      `${label} 서울 경계 내 위치`,
      inBounds,
      hasCoordinates ? `(${station.lat}, ${station.lng})` : JSON.stringify(station),
    );

    const distanceM = hasCoordinates
      ? haversineDistance(analysis.center.lat, analysis.center.lng, station.lat, station.lng)
      : Infinity;
    const inRange = distanceM <= maxDistM;
    addCheck(
      `analysis/V06/${label}`,
      'V06 반경 버퍼',
      `${label} 반경 ${radiusKm + 3}km 이내`,
      inRange,
      Number.isFinite(distanceM)
        ? `거리 ${(distanceM / 1000).toFixed(2)}km`
        : '좌표 없음',
    );
  });
}

function verifyDynamicRouteProvider() {
  const source = fs.readFileSync(ROUTE_PROVIDER_PATH, 'utf-8');
  const usesOverpassRelations =
    source.includes('relation["route"="subway"]') && source.includes('out geom');
  const acceptsDynamicCoordinates =
    source.includes('coordinates') && !source.includes('public/data') && !source.includes('seed/');
  const hasGapGuard = source.includes('const GAP = 0.005');

  addCheck(
    'provider/V07',
    'V07 동적 노선 소스',
    'Overpass relation geometry 기반 노선 공급자 사용',
    usesOverpassRelations && acceptsDynamicCoordinates && hasGapGuard,
    `usesOverpassRelations=${usesOverpassRelations}, acceptsDynamicCoordinates=${acceptsDynamicCoordinates}, hasGapGuard=${hasGapGuard}`,
  );
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------
function main() {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const analysis = JSON.parse(fs.readFileSync(ANALYSIS_PATH, 'utf-8'));
  verifyAnalysisSubwayLayer(analysis);
  verifyDynamicRouteProvider();

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
