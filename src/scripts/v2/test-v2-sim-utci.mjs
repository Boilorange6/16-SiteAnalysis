/**
 * T12 복사·UTCI 엔진 테스트. 화면/네트워크 없이 published UTCI 절차와
 * 합성 여름·야간 조건을 검증한다.
 */
import assert from "node:assert/strict";

const radiation = await import("../../lib/v2/sim/radiation.ts");
const { erbsSplit, skyEmissivity, tmrt } = radiation;
const { UTCI_BREAKS, UTCI_WIND_RANGE, utci, vapourPressureHpa } = await import("../../lib/v2/sim/utci.ts");
const { maxOf } = await import("../../lib/v2/extent.ts");

const near = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected} (±${tolerance})`);
};

// 1) 공개된 6차 UTCI operational procedure의 경계와 입력 단위
assert.deepEqual(UTCI_WIND_RANGE, [0.5, 17]);
assert.deepEqual(UTCI_BREAKS, [9, 26, 32, 38, 46]);
near(vapourPressureHpa(25, 50), 15.84, 0.08, "Magnus 수증기압");

// 2) UTCI 기준값/단조성. 25°C, Tmrt=Ta, RH 50%, 1m/s는 공개 계산기 예시 범위.
const neutral = utci(25, 25, 1, 50);
near(neutral.value, 24.6, 0.1, "UTCI 중립 기준값");
assert.equal(neutral.inRange, true);
near(utci(20, 20, 0.5, 50).value, 20, 0.5, "UTCI 저풍 기준값");
assert.ok(utci(25, 35, 1, 50).value > neutral.value, "Tmrt 증가 시 UTCI 증가");
assert.ok(utci(25, 25, 5, 50).value < neutral.value, "풍속 증가 시 UTCI 감소");
assert.equal(utci(25, 25, 0.3, 50).inRange, false);
assert.equal(utci(25, 25, 20, 50).inRange, false);
assert.ok(Number.isFinite(utci(25, 25, 0.3, 50).value), "범위 밖에서도 값을 자르지 않고 계산");

// Bröde et al. (2012) operational procedure reference: rounded outputs from
// the public COST Action 730 UTCI_a002 reference program (RH input path).
// Our interface intentionally uses Magnus RH conversion, while the reference
// program uses its bundled saturation-pressure routine; compare at 0.1°C.
const publishedCases = [
  { input: [25, 25, 1, 50], expected: 24.6 },
  { input: [20, 20, 0.5, 50], expected: 19.8 },
  { input: [35, 45, 0.5, 70], expected: 42.2 },
  { input: [-10, -15, 10, 80], expected: -40.7 },
  { input: [30, 35, 2, 60], expected: 31.7 },
  { input: [0, 0, 5, 80], expected: -14.0 },
  { input: [40, 60, 1, 40], expected: 46.6 },
];
let maxPublishedError = 0;
for (const testCase of publishedCases) {
  const actual = utci(...testCase.input).value;
  const error = Math.abs(actual - testCase.expected);
  maxPublishedError = Math.max(maxPublishedError, error);
  assert.ok(error <= 0.1, `published UTCI ${testCase.input.join(",")}: ${actual} vs ${testCase.expected}`);
}
console.log(`UTCI published reference max error: ${maxPublishedError.toFixed(4)}°C (${publishedCases.length} cases)`);

// 3) Erbs 직·산란 분리의 세 구간과 야간 처리
const solarConstantHorizontal = (dayOfYear, sunAltDeg) =>
  1367 * (1 + 0.033 * Math.cos((2 * Math.PI * (dayOfYear - 3)) / 365)) * Math.sin((sunAltDeg * Math.PI) / 180);
const low = erbsSplit(solarConstantHorizontal(172, 45) * 0.1, 45, 172);
const mid = erbsSplit(solarConstantHorizontal(172, 45) * 0.5, 45, 172);
const high = erbsSplit(solarConstantHorizontal(172, 45) * 0.9, 45, 172);
assert.ok(low.kt < 0.22 && mid.kt > 0.22 && mid.kt < 0.8 && high.kt > 0.8, "Erbs kt 세 구간");
assert.ok(low.dhi / (low.dhi + low.dni * Math.sin(45 * Math.PI / 180)) > mid.dhi / (mid.dhi + mid.dni * Math.sin(45 * Math.PI / 180)), "Erbs 저운량 diffuse 비율");
assert.ok(high.dhi < high.dni * 0.3, "Erbs 고운량 direct 우세");
assert.deepEqual(erbsSplit(0, -2, 172), { dni: 0, dhi: 0, kt: 0 });

// 4) 하늘 방사율: 완전 운량은 1, 맑은 하늘은 0~1.
assert.equal(skyEmissivity(20, 50, 10), 1);
assert.ok(skyEmissivity(20, 50, 0) > 0 && skyEmissivity(20, 50, 0) < 1);

// 5) Tmrt 합성 장면: 햇볕/그늘 대비·야간 안정성.
const summerSun = tmrt({ taC: 31, rhPct: 60, ghiWm2: 850, cloud10: 2, sunAltDeg: 75, dayOfYear: 172, svf: 1, sunlit: true, groundSunlit: true });
const summerShade = tmrt({ taC: 31, rhPct: 60, ghiWm2: 850, cloud10: 2, sunAltDeg: 75, dayOfYear: 172, svf: 0.3, sunlit: false, groundSunlit: false });
const night = tmrt({ taC: 20, rhPct: 50, ghiWm2: 0, cloud10: 0, sunAltDeg: -5, dayOfYear: 172, svf: 1, sunlit: false, groundSunlit: false });
assert.ok(summerSun - 31 >= 25 && summerSun - 31 <= 40, `여름 햇볕 Tmrt 대비: ${summerSun - 31}`);
assert.ok(summerShade - 31 >= 0 && summerShade - 31 <= 10, `여름 그늘 Tmrt 대비: ${summerShade - 31}`);
assert.ok(night < 22, `야간 Tmrt: ${night}`);
assert.ok(summerSun > summerShade + 15, "햇볕/그늘 Tmrt 대비");

// 6) UTCI 다항식은 셀당 상수 시간이어야 한다. 4계절×3시각 규모보다 큰 합성 배치.
function measureUtciBatch() {
  const t0 = performance.now();
  let checksum = 0;
  for (let i = 0; i < 100_000; i++) checksum += utci(20 + (i % 20) * 0.5, 25 + (i % 15), 0.5 + (i % 100) * 0.1, 40 + (i % 50)).value;
  return { elapsedMs: performance.now() - t0, checksum };
}

const warmupRuns = 2;
const sampleRuns = 5;
for (let i = 0; i < warmupRuns; i += 1) measureUtciBatch();
const perfSamples = Array.from({ length: sampleRuns }, () => measureUtciBatch());
const ordered = perfSamples.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
const medianMs = ordered[Math.floor(ordered.length / 2)];
const maxMs = maxOf(ordered);
const checksum = perfSamples[0].checksum;
console.log(`T12 UTCI perf: 100000 cells -> ${ordered.map((value) => value.toFixed(1)).join(" / ")} ms; median ${medianMs.toFixed(1)} ms, max ${maxMs.toFixed(1)} ms (checksum ${checksum.toFixed(2)})`);
assert.ok(medianMs < 1000, `UTCI 100000셀 중앙값 성능 초과: ${medianMs.toFixed(1)} ms`);

console.log(`v2 sim-utci: ok (sun ${summerSun.toFixed(2)}°C, shade ${summerShade.toFixed(2)}°C, night ${night.toFixed(2)}°C)`);
