import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { a05 } = await import("../../lib/v2/tile/a05/engine.ts");
const { a06 } = await import("../../lib/v2/tile/a06/engine.ts");
const { reaggregateA05 } = await import("../../lib/v2/engine/a05-filter.ts");
const { calloutForA05, a05ClientModule } = await import("../../lib/v2/tile/a05/view.ts");
const { a06ClientModule } = await import("../../lib/v2/tile/a06/view.ts");
const { isHollowComplexMarker } = await import("../../lib/v2/ui/callout-layout.ts");

const a05Result = {
  status: "complete",
  conditions: { center: [127, 37], radiusM: 800, analysisDate: "2026-09-30" },
  metrics: [],
  presentation: {
    features: [
      { layer: "apt", lng: 127, lat: 37, name: "확인 단지", households: 300, approvalYear: 2010 },
      { layer: "apt", lng: 127.001, lat: 37, name: "미상 단지", households: 100, approvalYear: null },
      { layer: "officetel", lng: 127.002, lat: 37, name: "오피스텔", households: 80, approvalYear: 2015 },
      { layer: "other_housing", lng: 127.003, lat: 37, weight: 40 },
    ],
  },
};

const model = calloutForA05(a05Result, "출처");
assert.ok(model);
const filteredA05 = reaggregateA05(a05Result, { types: ["apt", "officetel"] });
const filteredShares = filteredA05.metrics.filter((metric) => metric.id.startsWith("share_"));
assert.deepEqual(filteredShares.map((metric) => metric.id), ["share_pre1980", "share_1980s", "share_1990s", "share_2000s", "share_2010s", "share_2020s", "share_unknown"]);
assert.ok(Math.abs(Math.round(filteredShares.reduce((sum, metric) => sum + metric.value, 0) * 10) / 10 - 100) <= 0.1, "A05 필터 후 준공연대 구성비 합계");
assert.deepEqual(model.stats.map(({ value, unit, label }) => ({ value, unit, label })), [
  { value: "2", unit: "단지", label: "반경 안 아파트" },
  { value: "1", unit: "단지", label: "반경 안 오피스텔" },
  { value: "400", unit: "세대", label: "확인 세대(아파트)" },
]);
assert.ok(model.legend.items.some((item) => item.label === "기타 공동주택"), "기타 공동주택도 콜아웃 범례에 설명한다");
assert.equal(isHollowComplexMarker(model.complexes.find((complex) => complex.name === "미상 단지")), true);
assert.equal(isHollowComplexMarker(model.complexes.find((complex) => complex.name === "확인 단지")), false);
assert.equal(isHollowComplexMarker({ approvalYear: null, supply: { timing: "unscheduled" } }), false, "입주예정 일정 미상은 준공 미상 hollow가 아님");
assert.equal(a05ClientModule.mapNote, "원 크기 = 확인 세대·호실 · 색 = 준공 연대 · 속 빈 원 = 준공 연대 미상");

assert.deepEqual(a06ClientModule.headline.ids, ["applyhome_units", "move_in_units"]);
assert.equal(a06ClientModule.metricFilter({ id: "applyhome_total" }), false, "현재 공용 fixture의 합계 행은 숨긴다");
assert.equal(a06ClientModule.metricFilter({ id: "applyhome_units" }), true);
assert.equal(a06ClientModule.mapNote, "색 = 원천(청약홈·입주예정) · 원 크기 = 공급 세대 · 같은 사업 중복 가능");

{
  const dataDir = mkdtempSync(join(tmpdir(), "v2-market-labels-"));
  await buildEngineFixture(dataDir, "v1", { kapt: true });
  const ctx = new EngineContext(dataDir, M.readManifest(dataDir), "market-labels", {
    address: "경기도 남양주시 다산동 100",
    center: CENTER,
    radiusM: 800,
    analysisDate: "2026-09-30",
  });
  const tile = a05(ctx);
  const stockShares = tile.metrics.filter((metric) => metric.id.startsWith("share_"));
  assert.deepEqual(stockShares.map((metric) => metric.id), ["share_pre1980", "share_1980s", "share_1990s", "share_2000s", "share_2010s", "share_2020s", "share_unknown", "share_other_housing"]);
  assert.equal(stockShares.reduce((sum, metric) => sum + metric.value, 0), 100, "A05 준공연대·기타 공동주택 구성비 합계");
  const feature = (name) => tile.presentation.features.find((item) => item.name === name);
  assert.deepEqual(
    [feature("recap:apt1")?.name, feature("recap:apt1")?.sublabel, feature("recap:apt1")?.labelPriority],
    ["recap:apt1", "500세대", 1],
    "A05 아파트는 원천 단지명·세대수·이름 우선순위를 낸다",
  );
  assert.deepEqual(
    [feature("recap:apt3")?.name, feature("recap:apt3")?.sublabel, feature("recap:apt3")?.labelPriority],
    ["recap:apt3", null, 1],
    "A05 준공·세대수 미상은 대체 문구 없이 sublabel을 비운다",
  );
  assert.deepEqual(
    [feature("title:off1")?.name, feature("title:off1")?.sublabel, feature("title:off1")?.labelPriority],
    ["title:off1", "100호", 1],
    "A05 오피스텔은 호실 단위를 사용한다",
  );
  assert.ok(tile.presentation.features.every((item) => !Object.hasOwn(item, "label")), "A05는 옛 label을 내지 않는다");
  ctx.close();
}

{
  const dataDir = mkdtempSync(join(tmpdir(), "v2-market-labels-"));
  await buildEngineFixture(dataDir, "v1");
  const ctx = new EngineContext(dataDir, M.readManifest(dataDir), "market-labels", {
    address: "경기도 남양주시 다산동 100",
    center: CENTER,
    radiusM: 800,
    analysisDate: "2026-09-30",
  });
  const tile = a06(ctx);
  const timingShares = tile.metrics.filter((metric) => metric.id.startsWith("share_timing_"));
  assert.deepEqual(timingShares.map((metric) => metric.id), ["share_timing_past", "share_timing_m0_12", "share_timing_m13_24", "share_timing_later", "share_timing_unscheduled"]);
  assert.ok(Math.abs(Math.round(timingShares.reduce((sum, metric) => sum + metric.value, 0) * 10) / 10 - 100) <= 0.1, "A06 입주 시기 구성비 합계");
  const feature = (name) => tile.presentation.features.find((item) => item.name === name);
  assert.deepEqual(
    [feature("applyhome:1")?.name, feature("applyhome:1")?.sublabel, feature("applyhome:1")?.labelPriority],
    ["applyhome:1", "2026년 12월 입주 · 800세대", 1],
    "A06은 입주월·공급세대를 원천 단지명 뒤에 낸다",
  );
  assert.deepEqual(
    [feature("movein:2")?.name, feature("movein:2")?.sublabel, feature("movein:2")?.labelPriority],
    ["movein:2", "200세대", 1],
    "A06 일정 미상은 일정 대체 문구 없이 확인 세대만 낸다",
  );
  assert.ok(tile.presentation.features.every((item) => !Object.hasOwn(item, "label")), "A06는 옛 label을 내지 않는다");
  ctx.close();
}

console.log("v2 market A05/A06 view contracts: ok");
