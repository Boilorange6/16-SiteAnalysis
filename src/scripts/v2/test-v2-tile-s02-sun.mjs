/**
 * S02 일조 엔진 테스트. 화면 없이 계산만 검증한다.
 * 태양 기준값: 서울(37.5665N, 126.9780E) 남중고도 = 90 - 위도 + 적위.
 *   동지 90-37.5665-23.44 = 28.99, 하지 90-37.5665+23.44 = 75.87, 춘·추분 ≈ 52.4 (허용 ±0.5).
 * 일출·일몰: 한국천문연구원(KASI) 서울 2026-12-22 값을 기억으로 07:43 / 17:17로 적었다. 이 환경에서 원문을 확인하지 못했으므로
 *   "기억 기반, 미검증" 값이며 허용오차 ±3분으로만 비교한다. (구현 값은 07:44 / 17:18)
 */
import assert from "node:assert/strict";

const { sunPosition, kst, sunriseSunsetKstMin } = await import("../../lib/v2/sim/sun.ts");
const { buildingShadow } = await import("../../lib/v2/sim/shadow.ts");
const { computeSunlight } = await import("../../lib/v2/sim/sunlight.ts");
const { buildS02TileResult, S02_LIMITATION } = await import("../../lib/v2/sim/s02-tile.ts");

const LAT = 37.5665, LON = 126.978;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

/** 하루 중 최대 고도(태양 남중) */
function noon(y, mo, d) {
  let best = { altitudeDeg: -90 }, bestMin = 0;
  for (let m = 11 * 60; m < 14 * 60; m++) {
    const p = sunPosition(LAT, LON, kst(y, mo, d, 0, m));
    if (p.altitudeDeg > best.altitudeDeg) { best = p; bestMin = m; }
  }
  return { ...best, minute: bestMin };
}

// 1) 태양
const winter = noon(2026, 12, 22), summer = noon(2026, 6, 21), equinox = noon(2026, 3, 20);
near(winter.altitudeDeg, 29.0, 0.5, "동지 남중고도");
near(summer.altitudeDeg, 75.9, 0.5, "하지 남중고도");
near(equinox.altitudeDeg, 52.4, 0.5, "춘분 남중고도");
for (const s of [winter, summer, equinox]) near(s.azimuthDeg, 180, 1, "남중 방위각");
// 오전은 동쪽, 오후는 서쪽
assert.ok(sunPosition(LAT, LON, kst(2026, 12, 22, 9)).azimuthDeg < 180);
assert.ok(sunPosition(LAT, LON, kst(2026, 12, 22, 15)).azimuthDeg > 180);
const rs = sunriseSunsetKstMin(LAT, LON, 2026, 12, 22);
near(rs.sunrise, 7 * 60 + 43, 3, "동지 일출");
near(rs.sunset, 17 * 60 + 17, 3, "동지 일몰");
assert.ok(sunPosition(LAT, LON, kst(2026, 12, 22, 3)).altitudeDeg < 0, "새벽엔 지평선 아래");

// 2) 그림자 길이·방향: 30m 건물, 동지 남중
const box = (x, y, w, d, heightM, id = "b") => ({ id, ring: [[x, y], [x + w, y], [x + w, y + d], [x, y + d]], heightM });
{
  const sun = sunPosition(LAT, LON, kst(2026, 12, 22, 0, winter.minute));
  const b = box(0, 0, 10, 10, 30);
  const s = buildingShadow(b, sun);
  const coords = (s.geometry.type === "Polygon" ? [s.geometry.coordinates] : s.geometry.coordinates).flatMap((p) => p[0]);
  const maxY = Math.max(...coords.map((c) => c[1]));
  const minY = Math.min(...coords.map((c) => c[1]));
  const expected = 30 / Math.tan((sun.altitudeDeg * Math.PI) / 180);
  near((maxY - 10) / expected, 1, 0.02, "그림자 길이(북쪽 연장)");
  assert.equal(minY, 0, "그림자는 남쪽(건물 뒤)이 아닌 북쪽으로만 뻗는다");
  assert.equal(buildingShadow(box(0, 0, 10, 10, null), sun), null, "높이 모르면 그림자 없음");
}

// 3) 건물 없는 대지: 100% 일조, 6시간
const site = [[1000, 2000], [1060, 2000], [1060, 2060], [1000, 2060]];
const base = { site, latDeg: LAT, lonDeg: LON, date: { year: 2026, month: 12, day: 22 } };
{
  const r = computeSunlight({ ...base, buildings: [] });
  assert.equal(r.counts.cells, 900);
  assert.equal(r.steps.length, 36);
  assert.equal(r.medianHours, 6);
  assert.equal(r.shareAtLeastN, 1);
  assert.equal(r.uncalculatedRatio, 0);
  assert.ok(r.steps.every((s) => s.shadedRatio === 0));
  assert.ok(r.cells.every((c) => c.hours === 6 && c.longestRunHours === 6));
}

// 4) 남중 무렵(12:20~12:40): 북쪽 건물은 대지를 가리지 않고, 남쪽 건물은 가린다
const noonWin = { ...base, windowStartMin: 12 * 60 + 20, windowEndMin: 12 * 60 + 40 };
{
  const north = computeSunlight({ ...noonWin, buildings: [box(1000, 2070, 60, 10, 30, "north")] });
  assert.ok(north.steps.every((s) => s.shadedRatio === 0), "북쪽 건물이 남중에 그림자를 드리움");
  assert.equal(north.buildings.used, 1);
  const south = computeSunlight({ ...noonWin, buildings: [box(1010, 1980, 40, 10, 30, "south")] });
  assert.ok(south.steps.every((s) => s.shadedRatio > 0.3), `남쪽 건물 그림자 비율 ${south.steps[0].shadedRatio}`);
  assert.ok(south.medianHours < south.sunUpHours);
  // 영향 영역 밖(300m 초과) 건물은 후보가 아니다
  const far = computeSunlight({ ...noonWin, buildings: [box(1010, 1500, 40, 10, 300, "far")] });
  assert.equal(far.buildings.inInfluence, 0);
}

// 5) 높이 없는 건물: 제외하고 세며, 0으로 취급하지 않는다
{
  const clean = computeSunlight({ ...base, buildings: [] });
  const r = computeSunlight({ ...base, buildings: [box(1010, 1980, 40, 10, null, "nh")] });
  assert.equal(r.buildings.excludedNoHeight, 1);
  assert.equal(r.buildings.used, 0);
  assert.equal(r.medianHours, clean.medianHours);
}

// 6) 미계산 셀: 대지 안 높이 모르는 건물 10x10 = 25셀
{
  const r = computeSunlight({ ...base, buildings: [box(1010, 2010, 10, 10, null, "hole")] });
  assert.equal(r.counts.uncalculated, 25);
  assert.equal(r.counts.calculated, 875);
  near(r.uncalculatedRatio, 25 / 900, 1e-12, "미계산 면적률");
  const cell = r.cells.find((c) => c.state === "uncalculated");
  assert.equal(cell.hours, null, "미계산 셀은 0시간이 아니라 값 없음");
  assert.equal(r.medianHours, 6, "미계산 셀이 중앙값을 끌어내리지 않는다");
  assert.equal(r.shareAtLeastN, 1);
}

// 7) removeBuildingsInSite: 대지 안 건물 셀 제외
{
  const inSite = [box(1010, 2010, 10, 10, 90, "in")];
  const kept = computeSunlight({ ...base, buildings: inSite });
  assert.equal(kept.counts.removed, 0);
  assert.ok(kept.cells.filter((c) => c.hours === 0).length >= 25, "지붕 셀은 자기 그림자 안");
  const removed = computeSunlight({ ...base, buildings: inSite, removeBuildingsInSite: true });
  assert.equal(removed.counts.removed, 25);
  assert.equal(removed.params.removeBuildingsInSite, true);
  assert.equal(removed.buildings.used, 0, "철거 가정 건물은 그림자 원천에서도 제외");
  assert.ok(removed.steps.every((step) => step.shadedRatio === 0), "철거 가정 건물이 이웃 셀을 가리지 않음");
  assert.equal(removed.cells.filter((cell) => cell.state === "calculated" && cell.hours === 0).length, 0, "이웃 셀에 잔여 그림자가 없음");
}

// 8) S02 TileResult
{
  const sources = [{ sourceId: "osm_buildings", releaseId: "r1", sourceAsOf: "2026-08-01", fetchedAt: "2026-09-30T09:00:00+09:00" }];
  const ctx = { analysisId: "a1", address: "서울특별시 중구 세종대로 110", center: [LON, LAT], radiusM: 500, manifestHash: "c".repeat(64), sources };
  const full = buildS02TileResult({ ...ctx, ...base, buildings: [box(1010, 1980, 40, 10, 30, "s")] });
  assert.equal(full.tileCode, "S02");
  assert.equal(full.tileType, "simulation");
  assert.equal(full.status, "complete");
  assert.equal(full.judgment.level, null);
  assert.ok(full.limitations.some((l) => l.kind === "estimated" && l.note === S02_LIMITATION));
  assert.ok(!full.limitations.some((l) => l.kind === "incomplete"));
  assert.equal(full.conditions.simulation.stepMin, 10);
  assert.equal(full.conditions.simulation.gridM, 2);
  assert.equal(full.conditions.simulation.influenceRadiusM, 300);
  assert.equal(full.conditions.simulation.removeBuildingsInSite, false);
  assert.ok(full.metrics.find((m) => m.id === "shaded_ratio_h12").denominator > 0);
  assert.ok(full.metrics.every((m) => m.status === "estimated"));

  const partial = buildS02TileResult({ ...ctx, ...base, buildings: [box(1010, 1980, 40, 10, null, "a"), box(1010, 2100, 40, 10, null, "b")] });
  assert.equal(partial.status, "partial");
  const inc = partial.limitations.find((l) => l.kind === "incomplete");
  assert.ok(inc && inc.note.includes("2개") && inc.note.includes("불완전 장면 기준"));

  const holed = buildS02TileResult({ ...ctx, ...base, buildings: [box(1010, 2010, 10, 10, null, "hole")] });
  assert.equal(holed.metrics.find((m) => m.id === "uncalculated_ratio").numerator, 25);
  assert.ok(holed.limitations.some((l) => l.kind === "partial"));

  for (const t of [full, partial, holed]) {
    const text = JSON.stringify(t);
    assert.ok(!text.includes("법적 적합") && !text.includes("적합"), "적합 표현 금지");
  }
}

// 9) 성능: 60x60m 대지, 2m 격자, 주변 건물 200개, 하루 09~15시 10분 간격
{
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const many = [];
  for (let i = 0; i < 200; i++) {
    const x = 1030 + (rnd() - 0.5) * 560, y = 2030 + (rnd() - 0.5) * 560;
    if (x > 985 && x < 1075 && y > 1985 && y < 2075) continue; // 대지 위는 비움
    many.push(box(x, y, 12 + rnd() * 20, 12 + rnd() * 20, 9 + rnd() * 60, `p${i}`));
  }
  const t0 = performance.now();
  const r = computeSunlight({ ...base, buildings: many });
  const ms = performance.now() - t0;
  console.log(`S02 perf: ${many.length} buildings (${r.buildings.inInfluence} in influence), ${r.counts.cells} cells, ${r.steps.length} steps -> ${ms.toFixed(0)} ms, median ${r.medianHours} h`);
  assert.ok(ms < 2000, `너무 느림: ${ms} ms`);
}

console.log("v2 sim-sun: ok");
