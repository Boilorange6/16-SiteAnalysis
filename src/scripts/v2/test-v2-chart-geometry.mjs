/** 분석 장 그래프 기하: 구성비·산점도·구간 막대가 box 안에 있고 값→좌표 변환이 맞다. */
import assert from "node:assert/strict";

const { compositionShapes, distanceShapes } = await import("../../lib/v2/report/chart-geometry.ts");

const EPS = 1e-9;
const BOX = { x: 8.4, y: 3.1, w: 4.2, h: 2.3 };
const SCALES = [1, 2];

const bounds = (s) => {
  if (s.kind === "line") return { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) };
  if (s.kind === "dots") {
    const xs = s.points.map((p) => p[0]);
    const ys = s.points.map((p) => p[1]);
    const e = s.r + (s.stroke ? s.strokeWidth / 144 : 0); // 테두리는 pt, 반쪽이 바깥으로 나온다
    return { x: Math.min(...xs) - e, y: Math.min(...ys) - e, w: Math.max(...xs) - Math.min(...xs) + 2 * e, h: Math.max(...ys) - Math.min(...ys) + 2 * e };
  }
  return s;
};
const assertInside = (shapes, box, label) => {
  for (const s of shapes) {
    const b = bounds(s);
    assert.ok(b.x >= box.x - EPS && b.y >= box.y - EPS && b.x + b.w <= box.x + box.w + EPS && b.y + b.h <= box.y + box.h + EPS, `${label}: ${s.name} 이(가) box 밖 ${JSON.stringify(b)}`);
  }
};
const texts = (shapes) => shapes.filter((s) => s.kind === "text");
const assertNoTextOverlap = (shapes, label) => {
  const ts = texts(shapes);
  for (let i = 0; i < ts.length; i++)
    for (let j = i + 1; j < ts.length; j++) {
      const a = ts[i];
      const b = ts[j];
      const overlap = a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
      assert.ok(!overlap, `${label}: 글자 겹침 ${a.name}「${a.text}」 ↔ ${b.name}「${b.text}」`);
    }
};
const assertNoLatin = (shapes, label) => {
  for (const s of texts(shapes)) assert.ok(!/[A-Za-z]/.test(s.text.replace(/ m$/, "")), `${label}: 영문 ${s.text}`);
};
const byName = (shapes, name) => {
  const s = shapes.find((x) => x.name === name);
  assert.ok(s, `${name} 없음`);
  return s;
};

// ── 구성비
const items = [
  { label: "1~4층", color: "#C9D6EA", count: 40, share: 0.5 },
  { label: "5~8층", color: "#F2F2F2", count: 20, share: 0.25 },
  { label: "26층 이상", color: "#1F3A6B", count: 19, share: 0.2375 },
  { label: "층수가 아직 정해지지 않은 아주 긴 이름", color: "#B9BDC6", count: 1, share: 0.0125 },
];
for (const scale of SCALES) {
  const shapes = compositionShapes(items, BOX, scale);
  assertInside(shapes, BOX, `구성비 x${scale}`);
  assertNoTextOverlap(shapes, `구성비 x${scale}`);
  assertNoLatin(shapes, `구성비 x${scale}`);
  const track = byName(shapes, "chart-composition-track-0");
  const widths = items.map((_, i) => byName(shapes, `chart-composition-bar-${i}`).w);
  assert.ok(Math.abs(widths[0] - track.w) < EPS, "최대 항목 = 트랙 전체");
  for (let i = 1; i < 3; i++) assert.ok(Math.abs(widths[i] / widths[0] - items[i].count / items[0].count) < 1e-9, `막대 폭 비 = count 비 (${i})`);
  assert.equal(shapes.filter((s) => s.name.startsWith("chart-composition-bar-")).length, items.length);
  assert.equal(byName(shapes, "chart-composition-value-0").text, "50%");
  assert.equal(byName(shapes, "chart-composition-value-3").text, "1%");
  assert.ok(byName(shapes, "chart-composition-label-3").text.endsWith("…"), "긴 이름은 줄임표로 자른다");
  assert.equal(byName(shapes, "chart-composition-bar-1").stroke, "#b9b4aa", "밝은 색 막대는 테두리");
  assert.equal(byName(shapes, "chart-composition-bar-0").stroke, undefined);
  const label0 = byName(shapes, "chart-composition-label-0");
  assert.ok(Math.abs(track.x - (BOX.x + BOX.w * 0.3)) < EPS && label0.w <= BOX.w * 0.3, "이름 열 = 상자 폭 × 0.3");
  assert.ok(byName(shapes, "chart-composition-value-0").bold === true);
}
assert.equal(compositionShapes([], BOX, 1).length, 0);
assert.equal(compositionShapes([{ label: "작음", color: "#112233", count: 1, share: 0.001 }], BOX, 1).find((s) => s.name === "chart-composition-value-0").text, "<1%");
// 행이 많아 좁은 상자: 글자가 행 높이에 맞춰 줄어든다
const tight = { x: 0, y: 0, w: 3, h: 0.7 };
assertInside(compositionShapes(items, tight, 1), tight, "좁은 구성비");

// ── 산점도(층수)
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const COLORS = ["#C9D6EA", "#7A9CCB", "#1F3A6B"];
const points = Array.from({ length: 300 }, (_, i) => ({ d: rand() * 1000, v: 1 + Math.floor(rand() * 20), color: COLORS[i % 3] }));
points.push({ d: 400, v: 69, color: COLORS[2] }, { d: 0, v: 3, color: COLORS[0] });
const floors = { kind: "scatter", axis: { label: "지상 층수", unit: "층" }, points, median: 4, mean: 6.2, max: 69, site: 17, sampled: false };
const tickValues = (shapes) => shapes.filter((s) => s.name.startsWith("chart-distance-ytick-")).map((s) => s.text);

for (const scale of SCALES) {
  const shapes = distanceShapes(floors, 1000, BOX, scale);
  assertInside(shapes, BOX, `산점도 x${scale}`);
  assertNoTextOverlap(shapes, `산점도 x${scale}`);
  assertNoLatin(shapes, `산점도 x${scale}`);
  assert.equal(shapes.filter((s) => s.name.startsWith("chart-distance-grid-")).length, 8, "격자선은 0~70, 10 단위 8줄");
  if (scale === 1) assert.deepEqual(tickValues(shapes), ["0", "10", "20", "30", "40", "50", "60", "70"], "층수 y 눈금 0~70, 10 단위");
  else assert.deepEqual(tickValues(shapes), ["0", "20", "40", "60"], "배율이 커서 글자가 겹치면 한 칸씩 건너뛴다");
  assert.deepEqual(texts(shapes).filter((s) => s.name.startsWith("chart-distance-xtick-")).map((s) => s.text), ["0", "250", "500", "750", "1,000 m"]);

  // 중앙값·평균 선의 y = 값→좌표 변환 (눈금 0과 70 격자선으로 되짚는다)
  const y0 = byName(shapes, "chart-distance-grid-0").y1;
  const y70 = byName(shapes, "chart-distance-grid-7").y1;
  const yOf = (v) => y0 + ((y70 - y0) * v) / 70;
  const med = byName(shapes, "chart-distance-median");
  const mean = byName(shapes, "chart-distance-mean");
  assert.ok(Math.abs(med.y1 - yOf(4)) < EPS && med.y1 === med.y2, "중앙값 선 y");
  assert.ok(Math.abs(mean.y1 - yOf(6.2)) < EPS, "평균 선 y");
  assert.equal(med.dash, undefined, "중앙값은 실선");
  assert.equal(mean.dash, true, "평균은 점선");

  // 점: 색마다 한 묶음, 처음 나온 순서, 입력 순서 유지, x = 거리 비
  const dots = shapes.filter((s) => s.kind === "dots" && s.name.startsWith("chart-distance-dots-"));
  assert.deepEqual(dots.map((s) => s.color), COLORS, "서로 다른 색 수 = 묶음 수");
  assert.deepEqual(dots.map((s) => s.name), ["chart-distance-dots-0", "chart-distance-dots-1", "chart-distance-dots-2"]);
  assert.equal(dots.reduce((sum, s) => sum + s.points.length, 0), points.length);
  assert.ok(dots.every((s) => s.opacity === 0.45 && Math.abs(s.r - 0.018 * scale) < EPS));
  const gx0 = byName(shapes, "chart-distance-grid-0").x1;
  const gx1 = byName(shapes, "chart-distance-grid-0").x2;
  const first = points.find((p) => p.color === COLORS[0]);
  assert.ok(Math.abs(dots[0].points[0][0] - (gx0 + ((gx1 - gx0) * first.d) / 1000)) < EPS && Math.abs(dots[0].points[0][1] - yOf(first.v)) < EPS);

  // 대지 점: 도형 하나(분홍 속, 진한 테두리), 글자 `대지 평균 17층`
  const site = byName(shapes, "chart-distance-site");
  assert.equal(site.kind, "dots");
  assert.equal(site.color, "#f2b6b8");
  assert.equal(site.stroke, "#c9404a");
  assert.ok(site.strokeWidth > 0 && site.points.length === 1 && site.opacity === 1);
  assert.equal(shapes.filter((s) => s.name.startsWith("chart-distance-site") && s.kind !== "text").length, 1, "대지 점 도형은 하나");
  assert.equal(byName(shapes, "chart-distance-site-label").text, "대지 평균 17층");
  assert.equal(byName(shapes, "chart-distance-median-label").text, "중앙값 4층");
  assert.equal(byName(shapes, "chart-distance-mean-label").text, "평균 6.2층");
}
assert.ok(!distanceShapes({ ...floors, site: null }, 1000, BOX, 1).some((s) => s.name.startsWith("chart-distance-site")), "대지가 없으면 대지 점·글자 없음");

// 중앙값·평균이 가까울 때: 글자 상자가 겹치지 않고 같은 줄에 나란히
for (const scale of SCALES) {
  for (const mean of [4, 4.05, 4.4, 5, 6.2]) {
    const shapes = distanceShapes({ ...floors, mean, median: 4 }, 1000, BOX, scale);
    assertNoTextOverlap(shapes.filter((s) => s.name.endsWith("-label") && !s.name.includes("site")), `가까운 선 x${scale} 평균 ${mean}`);
    assertInside(shapes, BOX, `가까운 선 x${scale}`);
  }
  const near = distanceShapes({ ...floors, mean: 4.1 }, 1000, BOX, scale);
  const m = byName(near, "chart-distance-median-label");
  const a = byName(near, "chart-distance-mean-label");
  assert.equal(m.y, a.y, "가까우면 같은 줄");
  assert.ok(a.x + a.w <= m.x + EPS, "평균 글자는 중앙값 글자 왼쪽");
  const far = distanceShapes({ ...floors, mean: 30 }, 1000, BOX, scale);
  assert.ok(byName(far, "chart-distance-mean-label").y < byName(far, "chart-distance-median-label").y, "멀면 각자 선 위");
}
// 평균 소수는 한 자리, 중앙값은 정수면 정수·아니면 한 자리
assert.equal(byName(distanceShapes({ ...floors, median: 3.5, mean: 6 }, 1000, BOX, 1), "chart-distance-median-label").text, "중앙값 3.5층");
assert.equal(byName(distanceShapes({ ...floors, median: 3.5, mean: 6 }, 1000, BOX, 1), "chart-distance-mean-label").text, "평균 6.0층");

// 가격: 0에서 시작, 보기 좋은 단위, 천 단위 쉼표
const priceFixture = { kind: "scatter", axis: { label: "㎡당 가격", unit: "만원" }, points: [{ d: 100, v: 500, color: COLORS[0] }, { d: 600, v: 8000, color: COLORS[1] }, { d: 300, v: 2400, color: COLORS[0] }], median: 2400, mean: 3633.3, max: 8000, site: 1500, sampled: false };
for (const scale of SCALES) {
  const shapes = distanceShapes(priceFixture, 500, BOX, scale);
  assertInside(shapes, BOX, `가격 x${scale}`);
  if (scale === 1) assertNoTextOverlap(shapes, `가격 x${scale}`); // x2는 긴 글자 세 개가 이 작은 상자에 다 안 들어간다(안쪽 판정만)
  assertNoLatin(shapes, `가격 x${scale}`);
  const ticks = tickValues(shapes);
  assert.equal(ticks[0], "0");
  assert.ok(ticks.length <= 6 && ticks.includes("8,000"), `가격 눈금 ${ticks}`);
  assert.equal(byName(shapes, "chart-distance-mean-label").text, "평균 3,633.3만원");
  assert.deepEqual(texts(shapes).filter((s) => s.name.startsWith("chart-distance-xtick-")).map((s) => s.text), ["0", "125", "250", "375", "500 m"]);
}

// 연도: 최솟값 근처에서 시작, 쉼표·소수 없음
const yearFixture = { kind: "scatter", axis: { label: "사용승인 연도", unit: "년" }, points: [{ d: 100, v: 1964, color: COLORS[0] }, { d: 500, v: 2024, color: COLORS[1] }, { d: 300, v: 1995, color: COLORS[0] }], median: 1995, mean: 1994.3, max: 2024, site: 1990, sampled: false };
for (const scale of SCALES) {
  const shapes = distanceShapes(yearFixture, 1000, BOX, scale);
  assertInside(shapes, BOX, `연도 x${scale}`);
  if (scale === 1) assertNoTextOverlap(shapes, `연도 x${scale}`);
  const ticks = tickValues(shapes);
  assert.equal(ticks[0], "1960");
  assert.ok(ticks.length <= 8 && ticks.every((s) => !s.includes(",")), `연도 눈금 ${ticks}`);
  if (scale === 1) assert.equal(ticks.at(-1), "2030", "1960부터 10년 단위로 최댓값을 덮는 2030까지");
  assert.equal(byName(shapes, "chart-distance-mean-label").text, "평균 1994년");
  assert.equal(byName(shapes, "chart-distance-site-label").text, "대지 평균 1990년");
}
// 연도 범위가 넓으면 단위를 키워 눈금을 6개 이하로
const wideYears = tickValues(distanceShapes({ ...yearFixture, points: [{ d: 1, v: 1910, color: COLORS[0] }, { d: 2, v: 2024, color: COLORS[1] }], median: 1990, mean: 1990, site: null }, 1000, BOX, 1));
assert.ok(wideYears.length <= 6 && Number(wideYears[0]) <= 1910 && Number(wideYears.at(-1)) >= 2024, `넓은 연도 눈금 ${wideYears}`);

// 연도 1950–2020: 올림 대신 최댓값 그대로 끝나는 10년 눈금 8개
const y1950 = distanceShapes({ ...yearFixture, points: [{ d: 10, v: 1950, color: COLORS[0] }, { d: 20, v: 2020, color: COLORS[1] }], median: 1990, mean: 1985, max: 2020, site: null }, 1000, BOX, 1);
assert.deepEqual(tickValues(y1950), ["1950", "1960", "1970", "1980", "1990", "2000", "2010", "2020"]);

// ── 실제 크기 상자(3.9 x 1.9 in)에서 층수·가격·연도 차트 900개를 무작위(고정 시드)로: 큰 글자(1.85)까지 글자끼리 안 겹치고 box 안
const REAL = { x: 8.6, y: 3.2, w: 3.9, h: 1.9 };
const { chartsColumnLayout, slidePanelRects } = await import("../../lib/v2/ui/overlay-layout.ts");
const COLUMN_BOXES = ["wide", "a4"].map((format) => chartsColumnLayout(slidePanelRects({}, true, undefined, format).summary, 1).distance); // 3.91×1.92 · 3.38×2.17 (칸 크기는 글자 배율과 무관)
let bseed = 11;
const brand = () => ((bseed = (bseed * 1103515245 + 12345) % 2147483648) / 2147483648);
const medianOf = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const genScatter = (kind) => {
  const n = 20 + Math.floor(brand() * 300);
  const vs = Array.from({ length: n }, () => (kind === "floors" ? 1 + Math.floor(Math.pow(brand(), 3) * 40) : kind === "price" ? Math.round(300 + Math.pow(brand(), 2) * 15000) : Math.round(1965 + brand() * 59)));
  return {
    kind: "scatter",
    axis: { label: "값", unit: kind === "floors" ? "층" : kind === "price" ? "만원" : "년" },
    points: vs.map((v, i) => ({ d: brand() * 1000, v, color: COLORS[i % 3] })),
    median: medianOf(vs),
    mean: vs.reduce((a, b) => a + b, 0) / n,
    max: Math.max(...vs),
    site: brand() < 0.7 ? vs[Math.floor(brand() * n)] : null,
    sampled: false,
  };
};
const failures = [];
for (const kind of ["floors", "price", "year"]) {
  for (let k = 0; k < 300; k++) {
    const fx = genScatter(kind);
    for (const box of [REAL, { x: 8.6, y: 3.2, w: 3.4, h: 2.0 }, ...COLUMN_BOXES]) // 둘째는 A4 폭에 가까운 더 좁은 상자, 나머지는 chartsColumnLayout의 실제 칸(16:9·A4)
      for (const scale of [1, 1.85]) {
        for (const title of ["", `대지에서 거리와 ${kind === "floors" ? "지상 층수" : kind === "price" ? "㎡당 가격" : "사용승인 연도"}`]) {
          const shapes = distanceShapes(fx, 1000, box, scale, title);
          try {
            assertInside(shapes, box, `${kind} #${k} ${box.w.toFixed(2)}x${scale} 제목 ${title ? "있음" : "없음"}`);
            assertNoTextOverlap(shapes, `${kind} #${k} ${box.w.toFixed(2)}x${scale} 제목 ${title ? "있음" : "없음"}`);
            if (title) {
              const shown = byName(shapes, "chart-distance-title").text;
              assert.ok(shown === title || (shown.endsWith("…") && title.startsWith(shown.slice(0, -1))), `제목은 그대로이거나 줄임표로 자른다: ${shown}`);
            }
          } catch (e) {
            failures.push(e.message);
          }
        }
      }
  }
}
assert.deepEqual(failures, [], `무작위 차트 ${failures.length}개에서 글자 겹침·상자 밖`);

// ── 구간 막대(10개 × 100 m)
const counts = [4, 12, 30, 18, 9, 7, 0, 3, 22, 1234];
const bands = { kind: "bands", bands: counts.map((count, i) => ({ from: i * 100, to: (i + 1) * 100, count })) };
for (const scale of SCALES) {
  const shapes = distanceShapes(bands, 1000, BOX, scale);
  assertInside(shapes, BOX, `구간 x${scale}`);
  assertNoTextOverlap(shapes, `구간 x${scale}`);
  assertNoLatin(shapes, `구간 x${scale}`);
  const rects = shapes.filter((s) => s.kind === "rect");
  assert.equal(rects.length, 10, "막대 수 = bands 수");
  const tall = byName(shapes, "chart-distance-band-9");
  const mid = byName(shapes, "chart-distance-band-2");
  assert.ok(Math.abs(mid.h / tall.h - 30 / 1234) < 1e-9, "막대 높이 비 = 개수 비");
  assert.equal(byName(shapes, "chart-distance-band-6").h, 0);
  assert.equal(new Set(rects.map((s) => s.fill)).size, 1, "막대는 한 색");
  assert.equal(byName(shapes, "chart-distance-count-9").text, "1,234", "위에 개수(천 단위 쉼표), 가장 많은 구간은 늘 남는다");
  assert.ok(texts(shapes).filter((s) => s.name.startsWith("chart-distance-count-")).every((s) => s.pt >= 7.5 * scale - EPS), "개수 글자는 눈금 글자보다 작지 않다");
  // 막대 바로 위에 있는 개수 글자(건너뛴 막대에는 없다)
  for (const s of texts(shapes).filter((x) => x.name.startsWith("chart-distance-count-"))) {
    const bar = byName(shapes, s.name.replace("count", "band"));
    assert.ok(s.y + s.h <= bar.y + EPS, `${s.name} 막대 위`);
  }
  if (scale === 1) assert.equal(texts(shapes).filter((s) => s.name.startsWith("chart-distance-count-")).length, 10, "들어가면 전부 쓴다");
  const xt = texts(shapes).filter((s) => s.name.startsWith("chart-distance-xtick-")).map((s) => s.text).reverse();
  if (scale === 1) assert.deepEqual(xt, ["0", "100", "200", "300", "400", "500", "600", "700", "800", "900", "1,000 m"], "구간 경계 글자");
  else assert.deepEqual(xt, ["0", "200", "400", "600", "800", "1,000 m"], "배율 2는 겹치지 않게 한 칸씩 건너뛰고 마지막은 남긴다");
}
// 구간이 아주 많으면 경계 글자를 건너뛰되 마지막(단위 포함)은 남긴다
const manyBands = { kind: "bands", bands: Array.from({ length: 30 }, (_, i) => ({ from: i * 100, to: (i + 1) * 100, count: i })) };
for (const scale of SCALES) {
  const shapes = distanceShapes(manyBands, 3000, BOX, scale);
  assertNoTextOverlap(shapes, `구간 30개 x${scale}`);
  assertInside(shapes, BOX, `구간 30개 x${scale}`);
  assert.equal(byName(shapes, "chart-distance-xtick-30").text, "3,000 m");
}
assert.equal(distanceShapes({ kind: "bands", bands: [] }, 1000, BOX, 1).length, 0);

// 반경 선택지(1.5·2·3 km)의 거리대 막대도 큰 글자(1.85)까지 안쪽·겹침 없음. 개수는 네 자리 쉼표 숫자.
const REAL_BOX = { x: 8.6, y: 3.2, w: 3.9, h: 1.9 };
const radiusBands = (radiusM) => {
  const bandM = Math.max(100, Math.ceil(radiusM / 10 / 100) * 100);
  const n = Math.ceil(radiusM / bandM);
  return { kind: "bands", bands: Array.from({ length: n }, (_, i) => ({ from: i * bandM, to: Math.min((i + 1) * bandM, radiusM), count: [1234, 987, 4567, 12, 0, 3456, 78, 2345, 9, 1500][i % 10] })) };
};
for (const radiusM of [500, 1000, 1500, 2000, 3000]) {
  for (const scale of [1, 1.85]) {
    const shapes = distanceShapes(radiusBands(radiusM), radiusM, REAL_BOX, scale);
    assertInside(shapes, REAL_BOX, `반경 ${radiusM} x${scale}`);
    assertNoTextOverlap(shapes, `반경 ${radiusM} x${scale}`);
    assertNoLatin(shapes, `반경 ${radiusM} x${scale}`);
    const counts = texts(shapes).filter((s) => s.name.startsWith("chart-distance-count-"));
    assert.ok(counts.length >= 1 && counts.every((s) => s.pt >= 7.5 * scale - EPS), `반경 ${radiusM} x${scale} 개수 글자 크기`);
    const tallest = shapes.filter((s) => s.kind === "rect").reduce((a, b) => (b.h > a.h ? b : a));
    assert.ok(counts.some((s) => s.name === tallest.name.replace("band", "count")), "가장 많은 구간 개수는 남는다");
  }
}

// 결정적
assert.deepEqual(distanceShapes(floors, 1000, BOX, 1), distanceShapes(structuredClone(floors), 1000, BOX, 1));

console.log("✓ v2 chart geometry");
