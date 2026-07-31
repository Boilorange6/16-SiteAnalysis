import assert from "node:assert/strict";

import {
  buildingDedupeKey,
  sampleDongPoints,
} from "../lib/server/residential/complex-identity.ts";
import { haversineDistance } from "../lib/geo.ts";

function building(overrides = {}) {
  return {
    bldNm: "개포현대아파트", sigunguCd: "11680", bjdongCd: "10300",
    bun: "0653", ji: "0000", lat: 37.4824, lng: 127.0512,
    ...overrides,
  };
}

// ── 같은 지번의 동별 건물은 하나의 단지로 병합된다 ────────────────────────
{
  const a = buildingDedupeKey(building({ bldNm: "개포현대아파트 101동" }));
  const b = buildingDedupeKey(building({ bldNm: "개포현대아파트 102동" }));
  assert.equal(a, b, "같은 지번의 동별 건물은 같은 키여야 한다");
}

// ── 이름이 같아도 지번이 다르면 다른 단지다 (핵심 회귀) ───────────────────
{
  // 개포동 653 현대아파트(416세대)와 654 현대아파트(557세대)는 실제로 다른 단지다
  const a = buildingDedupeKey(building({ bldNm: "현대아파트", bun: "0653" }));
  const b = buildingDedupeKey(building({ bldNm: "현대아파트", bun: "0654" }));
  assert.notEqual(a, b, "지번이 다르면 동명 단지라도 분리되어야 한다");
}

// ── 법정동이 다르면 본번이 같아도 다른 단지다 ─────────────────────────────
{
  const a = buildingDedupeKey(building({ bldNm: "주공아파트", bjdongCd: "10300" }));
  const b = buildingDedupeKey(building({ bldNm: "주공아파트", bjdongCd: "10800" }));
  assert.notEqual(a, b, "법정동이 다르면 분리되어야 한다");
}

// ── 부번까지 구분한다 ─────────────────────────────────────────────────────
{
  const a = buildingDedupeKey(building({ bun: "0660", ji: "0001" }));
  const b = buildingDedupeKey(building({ bun: "0660", ji: "0004" }));
  assert.notEqual(a, b, "부번이 다르면 분리되어야 한다");
}

// ── 지번 코드가 비면 이름+좌표 격자로 폴백한다 ────────────────────────────
{
  const a = buildingDedupeKey(building({ bun: "", ji: "", lat: 37.48240, lng: 127.05120 }));
  const b = buildingDedupeKey(building({ bun: "", ji: "", lat: 37.48241, lng: 127.05121 }));
  assert.equal(a, b, "지번이 없으면 이름+근접 좌표로 같은 단지로 본다");
  const far = buildingDedupeKey(building({ bun: "", ji: "", lat: 37.5100, lng: 127.0900 }));
  assert.notEqual(a, far, "지번이 없고 좌표가 멀면 다른 단지다");
}

// ── 앞자리 0 표기 차이를 흡수한다 ─────────────────────────────────────────
{
  assert.equal(
    buildingDedupeKey(building({ bun: "0653", ji: "0000" })),
    buildingDedupeKey(building({ bun: "653", ji: "0" })),
    "본번/부번의 zero padding 차이는 같은 지번으로 취급해야 한다",
  );
}

// ── 법정동 샘플 지점: 경도에 cos(위도) 보정이 적용된다 ────────────────────
{
  const centerLat = 37.5;
  const centerLng = 127.0;
  const radiusM = 3000;
  const points = sampleDongPoints(centerLat, centerLng, radiusM);

  assert.ok(points.length >= 9, "중심 + 8방향 이상을 샘플링해야 한다");
  assert.deepEqual(points[0], { lat: centerLat, lng: centerLng }, "첫 점은 중심이어야 한다");

  // 가장 동쪽 지점은 중심에서 반경만큼 떨어져 있어야 한다.
  // cos(위도) 보정 전에는 서울 위도에서 약 21% 짧았다.
  const east = points.reduce((far, p) => (p.lng > far.lng ? p : far), points[0]);
  const eastDistance = haversineDistance(centerLat, centerLng, east.lat, east.lng);
  assert.ok(Math.abs(eastDistance - radiusM) < radiusM * 0.05,
    `동쪽 최외곽 샘플 거리가 반경에 근접해야 한다 (실제 ${Math.round(eastDistance)}m, 기대 ${radiusM}m)`);

  // 남북 방향도 동일 기준
  const north = points.reduce((far, p) => (p.lat > far.lat ? p : far), points[0]);
  const northDistance = haversineDistance(centerLat, centerLng, north.lat, north.lng);
  assert.ok(Math.abs(northDistance - radiusM) < radiusM * 0.05,
    `북쪽 최외곽 샘플 거리가 반경에 근접해야 한다 (실제 ${Math.round(northDistance)}m)`);
}

// ── 반경이 커지면 샘플 밀도를 높여 좁은 법정동 누락을 줄인다 ──────────────
{
  const small = sampleDongPoints(37.5, 127.0, 1000);
  const large = sampleDongPoints(37.5, 127.0, 10000);
  assert.ok(large.length > small.length,
    "반경이 크면 더 많은 지점을 샘플링해야 한다 (좁은 법정동 누락 방지)");
}

// ── 모든 샘플 지점은 반경 안에 있어야 한다 (반경 밖 법정동 오수집 방지) ───
{
  const radiusM = 3000;
  for (const point of sampleDongPoints(37.5, 127.0, radiusM)) {
    const distance = haversineDistance(37.5, 127.0, point.lat, point.lng);
    assert.ok(distance <= radiusM * 1.001,
      `샘플 지점이 반경을 벗어났다 (${Math.round(distance)}m > ${radiusM}m)`);
  }
}

console.log("test-complex-identity: all assertions passed");
