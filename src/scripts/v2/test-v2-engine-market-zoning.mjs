import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { a07, monthsBefore, quintileOf } = await import("../../lib/v2/tile/a07/engine.ts");
const { a09, sigunguMatches } = await import("../../lib/v2/tile/a09/engine.ts");
const { a12 } = await import("../../lib/v2/tile/a12/engine.ts");
const { simplifyRing } = await import("../../lib/v2/engine/tiles/geo.ts");
const { capPolygons } = await import("../../lib/v2/engine/tiles/common.ts");
const { buildSummary } = await import("../../lib/v2/engine/summary.ts");
const { parseTileResult, MAX_MAP_POLYGONS, MAX_POLYGON_VERTICES } = await import("../../lib/v2/tile-result.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

const make = async (options) => {
  const dir = mkdtempSync(join(tmpdir(), "v2-eng-mz-"));
  await buildEngineFixture(dir, "v1", options);
  const manifest = M.readManifest(dir);
  return (radiusM = 800, analysisDate = "2026-09-30") => new EngineContext(dir, manifest, "an-1", { address: "경기도 남양주시 다산동 100", center: CENTER, radiusM, analysisDate });
};
const metric = (t, id) => t.metrics.find((m) => m.id === id);
const val = (t, id) => metric(t, id)?.value;
const FORBIDDEN = /도보|\d\s*분|종합/;
const clean = (t) => {
  parseTileResult(t);
  assert.doesNotMatch(JSON.stringify(t), FORBIDDEN, `${t.tileCode}: 금지 표현`);
  assert.doesNotMatch(JSON.stringify(toTileView(t)), FORBIDDEN, `${t.tileCode}: 화면 문자열 금지 표현`);
  assert.equal(t.judgment?.level ?? null, null, `${t.tileCode}: 등급 없음`);
  assert.match(t.judgment.sentence, / → .+ → /, `${t.tileCode}: 사실→의미→확인할 것`);
};
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// ── 순수 함수 ──
assert.equal(monthsBefore("2026-09-30", 12), "2025-09-30");
assert.equal(monthsBefore("2026-08-31", 6), "2026-02-28", "말일 보정");
assert.equal(monthsBefore("2026-02-15", 6), "2025-08-15");
assert.deepEqual([10, 20, 30, 40, 50].map((v) => quintileOf(v, [10, 20, 30, 40, 50])), [1, 2, 3, 4, 5]);
assert.deepEqual([5, 5, 5].map((v) => quintileOf(v, [5, 5, 5])), [1, 1, 1], "같은 값은 같은 구간");
assert.ok(sigunguMatches("경기도 수원시 팔달구", "수원시") && sigunguMatches("서울특별시 송파구", "송파구") && !sigunguMatches("서울특별시 송파구", "강동구"));
{
  const n = 5000;
  const ring = Array.from({ length: n + 1 }, (_, i) => [1000 * Math.cos((2 * Math.PI * (i % n)) / n), 1000 * Math.sin((2 * Math.PI * (i % n)) / n)]);
  const s = simplifyRing(ring, MAX_POLYGON_VERTICES);
  assert.ok(s.length <= MAX_POLYGON_VERTICES && s.length >= 4, `단순화 ${s.length}`);
  assert.deepEqual(s[0], s.at(-1), "닫힌 고리 유지");
  assert.ok(s.every((p) => ring.some((q) => q[0] === p[0] && q[1] === p[1])), "원래 정점의 부분집합");
  const area = (r) => Math.abs(r.slice(1).reduce((a, p, i) => a + r[i][0] * p[1] - p[0] * r[i][1], 0)) / 2;
  near(area(s) / area(ring), 1, 0.02, "면적 보존");
  const small = ring.slice(0, 50);
  assert.equal(simplifyRing(small, 200), small, "이미 작으면 그대로");
}
{
  const mk = (i) => ({ id: i, areaM2: i, p: { layer: "zone:주거", rings: [[[0, 0], [1, 0], [1, 1], [0, 0]]], label: null } });
  const c = capPolygons(Array.from({ length: 200 }, (_, i) => mk(i + 1)));
  assert.equal(c.polygons.length, Math.min(200, MAX_MAP_POLYGONS));
  assert.equal(c.total, 200);
}

// ── A07 ──
{
  const ctxFor = await make({ trades: true });
  const ctx = ctxFor(800);
  const t = a07(ctx);
  clean(t);
  assert.equal(t.status, "partial", "위치 미확인 거래가 있어 부분");
  // 기간 (2025-09-30, 2026-09-30] · 아파트 매매 · 취소 제외 · 위치 확인 · 반경 800: A 24 + B 4(면적 없는 1건 포함) + C 1
  assert.equal(val(t, "valid_trades"), 29, "창 경계·유형·반경 밖·취소 제외");
  assert.equal(val(t, "cancelled_trades"), 1, "취소는 별도");
  assert.equal(metric(t, "median_price_per_m2").numerator, 28, "면적 없는 건은 단가에서 빠짐");
  assert.equal(val(t, "median_price_per_m2"), 1015);
  assert.equal(val(t, "price_q1_per_m2"), 967.5);
  assert.equal(val(t, "price_q3_per_m2"), 1082.5);
  assert.equal(val(t, "median_price_per_3_3m2"), 3349.5, "3.3㎡ 환산은 보조");
  // 최근 반기 16건 중앙값 1075, 이전 반기 12건 중앙값 955
  assert.equal(val(t, "median_change_pct"), 12.6);
  assert.equal(val(t, "latest_trade_days"), 29, "2026-09-01 → 2026-09-30");
  assert.equal(t.judgment.level, null);
  assert.match(t.judgment.sentence, /29건, ㎡당 중앙값 1,015만원\(중간 절반 968~1,083만원\), 직전 6개월 대비 중앙값 \+12\.6%/);
  assert.match(t.judgment.sentence, /시세·감정가가 아니고/);
  // 지도: 필지 3곳 = 점 3개, weight = 건수(A 24, B 3, C 1), 색은 점별 중앙 단가 5분위
  const f = t.presentation.features;
  assert.equal(f.length, 3);
  const byW = Object.fromEntries(f.map((x) => [x.weight, x]));
  assert.deepEqual(Object.keys(byW).sort(), ["1", "24", "3"]);
  assert.ok(f.every((x) => /^trade_q[1-5]$/.test(x.layer)));
  assert.equal(f.find((x) => x.weight === 24).layer, "trade_q1", "A 중앙 단가가 가장 낮다");
  assert.equal(f.find((x) => x.weight === 3).layer, "trade_q5", "B 중앙 단가가 가장 높다");
  assert.equal(f.filter((x) => x.label).length, 3, "건수 상위 3곳에 라벨");
  assert.match(f.find((x) => x.weight === 24).label, /^24건 \d[\d,]*만원\/㎡$/);
  assert.ok(t.presentation.layers.includes("trade_q5"));
  // 한계
  const notes = t.limitations.map((l) => l.note).join("\n");
  assert.match(notes, /위치를 확인하지 못한 거래 2건/);
  assert.match(notes, /동·호를 공개하지 않아/);
  assert.match(notes, /전용면적이 없는 1건/);
  assert.deepEqual(t.provenance.sources.map((s) => s.sourceId), ["rtms_apt_trade"]);
  ctx.close();

  // 반경 500: 송파(600m~)가 걸치지 않아 A·B만
  const c5 = ctxFor(500);
  const t5 = a07(c5);
  assert.equal(val(t5, "valid_trades"), 28);
  assert.equal(metric(t5, "median_change_pct").status, "observed");
  c5.close();

  // 변화율 최소 표본: 분석일을 옮기면 최근 반기 6건(<10) → 변화 판단 유보, 사유가 남는다
  const late = ctxFor(800, "2026-11-20");
  const tl = a07(late);
  const ch = metric(tl, "median_change_pct");
  assert.equal(ch.status, "missing");
  assert.match(ch.formulaVersion, /10건 미만\(최근 6건, 이전 12건\)/);
  assert.match(tl.judgment.sentence, /변화는 판단하지 않음/);
  assert.ok(!/직전 6개월 대비 중앙값 [+-]/.test(tl.judgment.sentence));
  clean(tl);
  late.close();
}
{
  // 송파 거래 자료가 없는 버전: 반경이 걸친 시군구 자료 없음을 밝힌다
  const t = a07((await make({ trades: "41360only" }))(800));
  assert.equal(t.status, "partial");
  assert.ok(t.limitations.some((l) => l.kind === "incomplete" && l.note.includes("서울특별시 송파구")));
  assert.equal(val(t, "valid_trades"), 28);
}
{
  const ctx = (await make({}))(800);
  assert.equal(a07(ctx).status, "not_provided", "실거래 원천이 없는 버전");
  ctx.close();
}
{
  // 반경 안 거래가 없으면 0건을 그대로(단가는 미확인), 지도 지물 없음
  const c = (await make({ trades: true }))(500, "2027-12-31");
  const t = a07(c);
  assert.equal(val(t, "valid_trades"), 0);
  assert.equal(metric(t, "median_price_per_m2").status, "missing");
  assert.equal(t.presentation.features.length, 0);
  clean(t);
  c.close();
}

// ── A09 ──
{
  const ctxFor = await make({ maint: "roster" });
  const ctx = ctxFor(800);
  const t = a09(ctx);
  clean(t);
  assert.equal(t.status, "partial");
  assert.equal(val(t, "roster_projects"), 3, "남양주 2 + 송파 1 (수원·강동은 반경 시군구 밖)");
  assert.equal(val(t, "stage_0"), 1);
  assert.equal(val(t, "stage_2"), 1);
  assert.equal(val(t, "stage_4"), 1);
  assert.equal(val(t, "planned_households"), 1500, "세대수가 있는 두 사업만 합산");
  assert.equal(metric(t, "planned_households").numerator, 2);
  assert.match(metric(t, "planned_households").label, /알려진 사업만/);
  assert.ok(t.limitations.some((l) => l.note === "경계 없음 — 반경 내 여부 미확인, 시군구 단위 목록"));
  assert.match(t.judgment.sentence, /경계가 없어 반경 안에 있는지는 확인되지 않은 시군구 단위 목록/);
  assert.equal(t.presentation.polygons, undefined);
  assert.equal(t.presentation.features, undefined, "위치가 없어 지도에 그리지 않음");
  ctx.close();

  const c5 = ctxFor(500);
  assert.equal(val(a09(c5), "roster_projects"), 2, "송파가 걸치지 않는 반경");
  c5.close();
}
{
  const ctx = (await make({ maint: "zones" }))(800);
  const t = a09(ctx);
  clean(t);
  assert.equal(val(t, "zones_in_radius"), 2, "먼구역 제외");
  assert.equal(val(t, "projects_in_radius"), 2);
  assert.equal(val(t, "stage_2"), 1, "za: 사업 연결의 이벤트 중 가장 나중 단계(조합)");
  assert.equal(val(t, "stage_0"), 1, "zb: 구역 속성(구역지정)");
  assert.equal(val(t, "planned_households"), 1300, "연결 이벤트 1000 + 구역 속성 300");
  assert.equal(metric(t, "type_1").label, "유형: 재개발");
  assert.match(t.judgment.sentence, /정비구역 2곳\(사업 2건: 구역지정 1건, 조합 1건\)/);
  // 지도는 흡수된 D23의 반경으로 자른 단계 면 하나만(사용자 결정 11) — A09 엔진은 면·대표점을 내지 않는다
  assert.equal((t.presentation.polygons ?? []).length, 0);
  assert.equal((t.presentation.features ?? []).filter((x) => x.layer.startsWith("maint_zone")).length, 0);
  assert.ok(t.limitations.some((l) => l.note.includes("경계가 확보된 사업만")));
  ctx.close();
}
{
  const ctx = (await make({}))(800);
  assert.equal(a09(ctx).status, "not_provided");
  ctx.close();
}

// ── A12 ──
const halfArea = (d, r) => (r * r * Math.acos(-d / r) + d * Math.sqrt(r * r - d * d)) / (Math.PI * r * r);
{
  const ctxFor = await make({ zoning: true });
  const ctx = ctxFor(800);
  const t = a12(ctx);
  clean(t);
  assert.equal(t.status, "partial");
  assert.equal(val(t, "site_zoning_count"), 1, "우산 도형은 세지 않음");
  const left = halfArea(200, 800) * 100;
  near(val(t, "share_class_1"), left, 0.6, "주거 구성비");
  assert.equal(metric(t, "share_class_1").label, "구성비: 주거");
  near(val(t, "share_class_2"), 100 - left, 0.6, "상업 구성비");
  assert.equal(val(t, "share_class_3"), 0, "고정 분류 번호의 공업 슬롯은 0%로 유지");
  assert.equal(metric(t, "share_class_3").label, "구성비: 공업");
  assert.equal(metric(t, "share_raw_1").label, "세분: 제2종일반주거지역");
  near(val(t, "share_sum"), 100, 0.8, "합계");
  assert.equal(metric(t, "land_price").status, "missing");
  assert.ok(t.limitations.some((l) => l.kind === "suppressed" && l.note.includes("“도시지역”")), "우산 제외 명시");
  assert.ok(!t.limitations.some((l) => l.note.includes("100%를 넘")), "겹침 없음");
  assert.ok(t.limitations.some((l) => l.kind === "incomplete" && l.note.includes("zoning_management")), "미적재 레이어 표시");
  assert.match(t.judgment.sentence, /^대지 중심점은 제2종일반주거지역, 반경 안 구성은 주거 \d+(\.\d)?%·상업/);
  const site = t.presentation.features.find((f) => f.layer === "zoning_site");
  assert.deepEqual([site.name, site.highlight, site.labelPriority], ["제2종일반주거지역", true, 2]);
  assert.deepEqual(t.presentation.polygons.map((p) => p.layer).sort(), ["zone:상업", "zone:주거"]);
  assert.equal(t.presentation.features.filter((f) => f.layer.startsWith("zone_center:")).length, 0, "면이 있으면 대표점을 내지 않는다");
  // 대지 요약이 A12의 대지 용도지역을 쓴다
  const s = buildSummary({ address: "x", jimok: null }, 800, [t]);
  assert.equal(s.zoning, "제2종일반주거지역");
  const explicitSiteName = {
    ...t,
    presentation: {
      ...t.presentation,
      features: t.presentation.features.map((f) => f.layer === "zoning_site" ? { ...f, name: "명시 용도지역", label: "옛 지도 라벨" } : f),
    },
  };
  assert.equal(buildSummary({ address: "x", jimok: null }, 800, [explicitSiteName]).zoning, "명시 용도지역", "요약은 지도 label보다 명시 name을 우선");
  ctx.close();
}
{
  // 겹침: 관리지역 전체 도형과 곡선 녹지 도형을 더하면 합이 100%를 넘고, 그렇다고 적는다
  const ctx = (await make({ zoning: "overlap" }))(800);
  const t = a12(ctx);
  clean(t);
  assert.ok(val(t, "share_sum") > 150, `합 ${val(t, "share_sum")}`);
  assert.ok(t.limitations.some((l) => l.kind === "estimated" && l.note.includes("100%를 넘")));
  assert.equal(val(t, "site_zoning_count"), 2);
  assert.match(t.judgment.sentence, /제2종일반주거지역, 계획관리지역\(복수 지정\)/);
  assert.ok(t.limitations.some((l) => l.note.includes("복수의 용도지역")));
  assert.ok(t.presentation.polygons.every((p) => p.rings.every((r) => r.length <= MAX_POLYGON_VERTICES && r.length >= 4)), "고리마다 200점 이하");
  const green = t.presentation.polygons.find((p) => p.layer === "zone:녹지");
  assert.ok(green.rings[0].length > 30 && green.rings[0].length <= MAX_POLYGON_VERTICES, `녹지 원 ${green.rings[0].length}점`);
  assert.equal(buildSummary({ address: "x", jimok: null }, 800, [t]).zoning, "제2종일반주거지역, 계획관리지역");
  ctx.close();
}
{
  const ctx = (await make({ zoning: "umbrella" }))(800);
  const t = a12(ctx);
  clean(t);
  assert.equal(val(t, "site_zoning_count"), 0);
  const classMetrics = t.metrics.filter((m) => m.id.startsWith("share_class"));
  assert.equal(classMetrics.length, 8, "고정 분류 슬롯은 자료가 없어도 유지");
  assert.ok(classMetrics.every((m) => m.value === 0), "우산 도형만 있으면 고정 분류 슬롯은 0%로 표시");
  assert.equal(t.presentation.features.find((f) => f.layer === "zoning_site").name, "도시지역(세분 미확인)");
  ctx.close();
}
{
  const ctx = (await make({}))(800);
  const t = a12(ctx);
  assert.equal(t.status, "not_provided");
  assert.equal(buildSummary({ address: "x", jimok: null }, 800, [t]).zoning, null, "용도지역 미확인 유지");
  ctx.close();
}

console.log("v2 engine market/maintenance/zoning: ok");
