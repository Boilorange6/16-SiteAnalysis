/** A06 분양·입주예정 설명선: 행·정렬·버킷·중복 칩, 모바일 띠 모델, 등급(grades) 스키마와 A01 방출 */
import assert from "node:assert/strict";

const C = await import("../../lib/v2/ui/callout-layout.ts");
const { markOverlaps, bucketOf } = await import("../../lib/v2/tile/a06/engine.ts");
const { a01Grades, gradeRail } = await import("../../lib/v2/tile/a01/engine.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { GODEOK_RESULTS } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { calloutScene } = await import("../../lib/v2/ui/callout-scene.ts");

const sup = (o) => ({ layer: "applyhome", lng: 127.15, lat: 37.55, households: 100, plannedMonth: "2027-03", distanceM: 500, name: "가", overlap: false, ...o });

// ── 중복 가능 표시: 다른 원천의 같은 이름·같은 주소만, 같은 원천끼리는 아님, 합치지 않음 ──
{
  const flags = markOverlaps([
    { source: "applyhome", name: "고덕강일 대성베르힐", address: "서울특별시 강동구 상일동 43번지 일원(서울고덕강일 공공주택지구 12블럭)" },
    { source: "move_in", name: "고덕강일 대성베르힐", address: "서울특별시 강동구 상일동 43-0" },
    { source: "applyhome", name: "더샵 강동센트럴시티", address: "서울특별시 강동구 천호동 410-100번지 일원" },
    { source: "applyhome", name: "더샵 강동센트럴시티", address: "서울특별시 강동구 천호동 410-100" },
    { source: "move_in", name: "다른 단지", address: "서울특별시 강동구 암사동 447-8" },
    { source: "move_in", name: "이름 다름", address: "서울특별시 강동구 천호동 410-100" },
  ]);
  assert.deepEqual(flags, [true, true, true, true, false, true], "이름 또는 주소가 같은 다른 원천 쌍만 (천호동 410-100 두 건은 입주예정 쪽 주소와 맞음)");
  assert.deepEqual(markOverlaps([{ source: "applyhome", name: "더샵", address: "천호동 1" }, { source: "applyhome", name: "더샵", address: "천호동 1" }]), [false, false], "같은 원천끼리는 아님");
  assert.deepEqual(markOverlaps([{ source: "applyhome", name: null, address: null }, { source: "move_in", name: null, address: null }]), [false, false], "이름·주소가 없으면 짝짓지 않는다");
  assert.deepEqual(markOverlaps([{ source: "applyhome", name: "A아파트", address: "" }, { source: "move_in", name: "A", address: "" }]), [true, true], "'아파트' 접미사·괄호 무시");
}

// ── 버킷 (엔진과 같은 함수) ──
{
  assert.equal(bucketOf, C.timingBucket);
  assert.deepEqual(["2026-08", "2026-09", "2027-09", "2027-10", "2028-09", "2028-10", null, "202612"].map((m) => C.timingBucket(m, "2026-09-30")), ["past", "m0_12", "m0_12", "m13_24", "m13_24", "later", "unscheduled", "unscheduled"]);
  assert.deepEqual(Object.keys(C.TIMING_STYLE), C.TIMING_ORDER);
  assert.equal(new Set(Object.values(C.TIMING_STYLE).map((s) => s.color)).size, 5, "버킷마다 다른 색");
}

// ── 순서: 다가오는 달 오름차순 → 이미 입주(최근 먼저) → 일정 미확인. 번호 = 순서 ──
const list = C.rankSupply(
  [
    sup({ name: "먼 미래", plannedMonth: "2029-01" }),
    sup({ name: "지난 오래", plannedMonth: "2022-02" }),
    sup({ name: "일정 없음", plannedMonth: null }),
    sup({ name: "곧B", plannedMonth: "2026-10", households: 50 }),
    sup({ name: "곧A", plannedMonth: "2026-10", households: 300 }),
    sup({ name: "지난 최근", plannedMonth: "2026-05", layer: "move_in" }),
    sup({ name: "중복", plannedMonth: "2027-11", overlap: true }),
    { layer: "apt", lng: 127, lat: 37 },
  ],
  "2026-09-30",
);
assert.deepEqual(list.map((c) => c.name), ["곧A", "곧B", "중복", "먼 미래", "지난 최근", "지난 오래", "일정 없음"], "A05 층은 제외");
assert.deepEqual(list.map((c) => c.rank), [1, 2, 3, 4, 5, 6, 7]);
assert.deepEqual(list.map((c) => c.supply.timing), ["m0_12", "m0_12", "m13_24", "later", "past", "past", "unscheduled"]);
assert.ok(list.every((c) => c.supply.plannedMonth === null || /^\d{4}-\d{2}$/.test(c.supply.plannedMonth)), "일자를 만들지 않는다");
assert.deepEqual(C.rankSupply(list.map(() => sup({})), "2026-09-30").map((c) => c.id), ["c1", "c2", "c3", "c4", "c5", "c6", "c7"]);

// ── 카드 행: 입주(예정) 시기 / 세대수 / 타입 / 원천 / 직선거리 ──
{
  const four = C.rankSupply(
    [sup({ plannedMonth: "2027-03", households: 1305 }), sup({ name: "n", plannedMonth: null, layer: "move_in" }), sup({ name: "b", plannedMonth: "2027-04", overlap: true }), sup({ name: "h", plannedMonth: "2027-05", households: null, weight: null })],
    "2026-09-30",
  );
  const [a, none, both, noHh] = ["가", "n", "b", "h"].map((n) => four.find((c) => c.name === n));
  assert.deepEqual(C.cardRows(a, 2026).map((r) => r.label), ["입주(예정) 시기", "세대수", "타입", "원천", "직선거리"]);
  assert.deepEqual(C.cardRows(a, 2026).map((r) => r.value), ["2027년 3월", "1,305세대", "타입 미확인", "청약홈", "500m"]);
  assert.deepEqual([C.cardRows(none, 2026)[0].value, C.cardRows(none, 2026)[0].missing, C.cardRows(none, 2026)[3].value], ["일정 확인필요", true, "입주예정"]);
  assert.equal(C.cardRows(both, 2026)[3].value, "청약홈 · 입주예정", "중복 가능이면 두 원천");
  assert.deepEqual([C.overlapChip(both), C.overlapChip(a)], ["중복 가능", null]);
  assert.deepEqual([C.cardRows(noHh, 2026)[1].value, C.cardRows(noHh, 2026)[1].missing], ["확인필요", true]);
  assert.equal(C.rowsFor([a, both]), 5, "A06은 타입 포함 5행 고정");
  assert.equal(C.fmtMonth("2027-10"), "2027년 10월");

  const typed = C.rankSupply([sup({ unitTypes: [{ typeM2: 84, units: 2840 }, { typeM2: 59, units: 1210 }, { typeM2: 114, units: 520 }, { typeM2: 74, units: 200 }, { typeM2: 49, units: 10 }] })], "2026-09-30")[0];
  assert.equal(C.cardRows(typed, 2026)[2].value, "59㎡ 1,210 · 84㎡ 2,840 · 114㎡ 520 외 2타입");
  assert.equal(C.cardRows(typed, 2026)[2].unitType, true);
}

// ── 점 색·크기, 페이지 10건, 장수, 값 카드(원천별, 합계 없음) ──
{
  assert.equal(C.dotColor(list[0]), C.TIMING_STYLE.m0_12.color);
  assert.equal(C.dotColor(list[4]), C.TIMING_STYLE.past.color);
  assert.equal(C.calloutLegendMatches(list[0], C.TIMING_STYLE.m0_12.color), true, "선택한 A06 범례 색 점·카드 유지");
  assert.equal(C.calloutLegendMatches(list[4], C.TIMING_STYLE.m0_12.color), false, "선택하지 않은 A06 범례 색은 흐림 대상");
  assert.equal(C.calloutLegendMatches(list[0], null), true, "범례 강조 전에는 모든 색 표시");
  assert.equal(C.dotRadius(250, 1000, 8, 16), 12, "√세대수");
  const many = C.rankSupply(Array.from({ length: 25 }, (_, i) => sup({ name: `p${i}`, plannedMonth: `2027-${String((i % 12) + 1).padStart(2, "0")}`, lng: 127 + i * 1e-4 })), "2026-09-30");
  assert.deepEqual([1, 2, 3].map((p) => C.pageItems(many, p).length), [10, 10, 5]);
  assert.match(C.pageRange(3, 25, undefined, true), /^입주 시기순 21–25 \/ 전체 25곳$/);
  assert.deepEqual([C.calloutReportPages("overview", 25), C.calloutReportPages("top10", 25), C.calloutReportPages("all", 25), C.calloutReportPages("top10", 0)], [1, 2, 4, 1]);
  const st = C.supplyStats(list);
  assert.deepEqual(st.stats.map((s) => s.unit), ["곳", "세대", "세대"]);
  assert.ok(!st.stats.some((s) => /합계/.test(s.label)) && /합계는 내지 않음/.test(st.note) && /중복 가능 1곳/.test(st.note));
}

// ── 모바일 띠 모델 ──
{
  const cards = C.stripCards(C.pageItems(list, 1), 2026);
  assert.deepEqual(cards.map((c) => c.rank), [1, 2, 3, 4, 5, 6, 7], "번호 = 페이지 순서");
  assert.deepEqual(cards[2].chip, "중복 가능");
  assert.deepEqual(cards[0].lines, ["2026년 10월 · 300세대", "타입 미확인", "청약홈 · 500m"]);
  assert.equal(cards[0].color, C.TIMING_STYLE.m0_12.color);
  assert.ok(cards.every((c) => c.name.length > 0 && c.lines.every((l) => l.length > 0)));
  const longName = { ...list[0], name: "래미안힐스테이트 고덕" };
  assert.equal(C.displayComplexName(longName, []), "래미안힐스테이트 고덕", "긴 단지명도 원문을 두 줄까지 표시");
  assert.equal(C.compactNameNeedsExtraHeight(longName, [], 84), true, "좁은 카드의 2줄 이름은 값 줄 여유를 예약");
  assert.deepEqual([C.isMobileWidth(390), C.isMobileWidth(520), C.isMobileWidth(521)], [true, true, false]);
  const f = C.stripFrame(390, 844, C.PX_NARROW, 100, 380);
  assert.deepEqual([f.cardW, f.perSide, f.left.x1 === f.left.x0, f.siteX], [0, 0, true, 0.5], "좌우 칸 없음");
  assert.ok(f.diameter >= 0.9 * (380 - 100) && f.diameter <= 390, "반경 원은 크게");
  // 장면: 모바일 상세는 지시선 없이 띠 자리를 비우고, 데스크톱은 지시선을 그린다
  const model = toTileView(GODEOK_RESULTS.find((r) => r.tileCode === "A06")).callout;
  assert.ok(model && model.kind === "supply" && model.complexes.length === 25);
  const mob = calloutScene(model, "detail", 390, 844, 1);
  assert.deepEqual([mob.strip, mob.placed.length, mob.withCards.length], [true, 0, 10]);
  assert.ok(mob.stripTop > 300 && mob.stripTop + C.STRIP_H < 844 - 0.4 * 844 - 20, "띠는 지도 아래·시트 위");
  assert.ok(mob.frame.diameter > 230, `모바일 반경 원 ${mob.frame.diameter}`);
  const desk = calloutScene(model, "detail", 1280, 800, 1);
  assert.deepEqual([desk.strip, desk.placed.length, desk.overflow.length], [false, 10, 0]);
  const a05 = toTileView(GODEOK_RESULTS.find((r) => r.tileCode === "A05")).callout;
  assert.equal(calloutScene(a05, "detail", 390, 844, 1).strip, true, "A05도 같은 띠");
  assert.equal(calloutScene(a05, "card", 390, 300, 0).strip, false, "보드 카드는 띠 없음");
  assert.ok(calloutScene(model, "card", 390, 300, 0).frame.diameter >= 132, "390px 보드 중앙 반경원 최소 지름을 보장");
  assert.ok(calloutScene(model, "card", 360, 300, 0).frame.diameter > 125, "모바일 보드 중앙 반경원이 카드 폭 때문에 줄지 않음");
}

// ── 보드 compact 카드: 번호·카드 1:1, 실제 수용량 밖에서는 낮은 순위만 제외 ──
{
  const a05Model = toTileView(GODEOK_RESULTS.find((r) => r.tileCode === "A05")).callout;
  assert.ok(a05Model && a05Model.kind === "stock");
  for (const [W, H] of [[600, 195], [420, 195], [800, 195]]) {
    const scene = calloutScene(a05Model, "card", W, H, 0);
    const cardIds = new Set(scene.placed.map((p) => p.id));
    const lowestNumberedRank = Math.max(...scene.numbered.map((c) => c.rank));
    assert.ok(
      scene.overflow.length === 0 || scene.overflow.every((id) => id === `c${lowestNumberedRank}`),
      `${W}x${H}: overflow는 최하위 순위만 가능 (${scene.overflow.join(",")})`,
    );
    assert.equal(scene.numbered.length, scene.placed.length, `${W}x${H}: 번호 점과 그려진 카드 수가 같다`);
    assert.ok(a05Model.complexes.slice(0, 3).every((c) => cardIds.has(c.id)), `${W}x${H}: 상위 3순위 카드가 모두 있다`);
  }

  // 직접 layoutCallouts를 호출해도 y 위치가 아니라 순위가 낮은 c5를 먼저 버린다.
  const f = C.calloutFrame({ W: 600, H: 195, m: C.PX, edge: 12, top: 12, bottom: 187, perSide: 2, rows: 4, variant: "compact" });
  const over = C.layoutCallouts(
    f,
    Array.from({ length: 5 }, (_, i) => ({ id: `c${i + 1}`, rank: i + 1, x: f.centerX - 120, y: 80 + i * 7 })),
  );
  assert.deepEqual(over.overflow, ["c5"], "초과 시 화면 아래 점이 아니라 낮은 순위부터 버린다");
  assert.deepEqual(new Set(over.placed.map((p) => p.id)), new Set(["c1", "c2", "c3", "c4"]));
}

// ── 등급(grades): 스키마, A01 방출, 다른 타일에는 없음 ──
{
  assert.deepEqual([gradeRail(500), gradeRail(501), gradeRail(1000), gradeRail(1001)], ["good", "fair", "fair", "caution"], "철도 500/1,000m");
  const both = a01Grades(480, 340);
  assert.deepEqual(both.grades.map((g) => [g.metricId, g.level]), [["nearest_rail_m", "good"], ["nearest_bus_m", "fair"]]);
  assert.equal(both.level, "fair", "level = 나쁜 쪽");
  assert.match(both.grades[0].criteria, /500m 이하 좋음 · 1,000m 이하 보통/);
  assert.match(both.grades[1].criteria, /300m 이하 좋음 · 600m 이하 보통/);
  assert.deepEqual(a01Grades(null, 700).grades.map((g) => g.metricId), ["nearest_bus_m"], "근거 거리가 없으면 그 등급은 만들지 않는다");
  assert.deepEqual(a01Grades(null, null), { grades: [], level: null });

  const a01 = structuredClone(GODEOK_RESULTS.find((r) => r.tileCode === "A01"));
  assert.equal(parseTileResult(a01).judgment.grades.length, 2, "하위 호환: grades 없이도 통과, 있으면 통과");
  const noGrades = structuredClone(a01);
  delete noGrades.judgment.grades;
  assert.equal(parseTileResult(noGrades).judgment.grades, undefined);
  const bad = structuredClone(a01);
  bad.metrics.find((m) => m.id === "nearest_rail_m").status = "missing";
  bad.metrics.find((m) => m.id === "nearest_rail_m").value = null;
  assert.throws(() => parseTileResult(bad), /cannot grade on nearest_rail_m/, "근거 지표가 관측되지 않으면 등급 불가");
  const unknown = structuredClone(a01);
  unknown.judgment.grades[0].metricId = "nope";
  assert.throws(() => parseTileResult(unknown), /cannot grade on nope/);
  const wrongTile = structuredClone(GODEOK_RESULTS.find((r) => r.tileCode === "A07"));
  wrongTile.judgment.level = "good";
  wrongTile.judgment.criteria = "x";
  wrongTile.judgment.basisMetricIds = ["median_price_m2"];
  wrongTile.judgment.grades = [{ metricId: "median_price_m2", level: "good", criteria: "x" }];
  assert.throws(() => parseTileResult(wrongTile), /only A01\/A02 may carry grades/);

  const chips = toTileView(parseTileResult(a01)).grades;
  assert.deepEqual(chips.map((g) => g.label), ["철도 좋음", "버스 보통"]);
  assert.ok(chips.every((g) => g.criteria.startsWith("내부 제안 기준: ")));
  for (const r of GODEOK_RESULTS.filter((r) => r.tileCode !== "A01")) assert.deepEqual(toTileView(r).grades, [], `${r.tileCode} 칩 없음`);
  const forced = structuredClone(GODEOK_RESULTS.find((r) => r.tileCode === "A05"));
  assert.deepEqual(toTileView(forced).grades, []);
}

console.log("v2 a06 callout tests passed");
