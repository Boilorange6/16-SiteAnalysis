import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { a07, collectTrades } = await import("../../lib/v2/tile/a07/engine.ts");
const { d25 } = await import("../../lib/v2/tile/a07/d25.ts");
const { a07ServerModule } = await import("../../lib/v2/tile/a07/server.ts");
const { lookupComplexNames } = await import("../../lib/v2/tile/a07/complex-name.ts");
const { a07ClientModule } = await import("../../lib/v2/tile/a07/view.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

const make = async (options) => {
  const dir = mkdtempSync(join(tmpdir(), "v2-eng-d25-"));
  await buildEngineFixture(dir, "v1", options);
  const core = new Database(join(dir, "versions", "v1", "core.sqlite"));
  const nameRelease = insertRelease(core, {
    sourceId: "housing_name_test",
    provider: "테스트",
    sourceUrl: "https://example.invalid",
    sourceAsOf: "2026-09-30",
    fetchedAt: "2026-09-30T00:00:00Z",
    checksum: "x",
    licenseCode: "TEST",
  });
  insertFeature(core, { stableId: "housing:trade-a", kind: "housing_complex", sourceKey: "trade-a", releaseId: nameRelease, geometry: { type: "Point", coordinates: CENTER }, pnu: "4136011800100010000", name: "다산 센트럴" });
  insertFeature(core, { stableId: "housing:trade-b", kind: "housing_complex", sourceKey: "trade-b", releaseId: nameRelease, geometry: { type: "Point", coordinates: CENTER }, pnu: "4136011800100020000", name: "다산 리버" });
  core.close();
  const manifest = M.readManifest(dir);
  return (radiusM = 800, analysisDate = "2026-09-30") =>
    new EngineContext(dir, manifest, "an-d25", {
      address: "경기도 남양주시 다산동 100",
      center: CENTER,
      radiusM,
      analysisDate,
    });
};

const metric = (tile, id) => tile.metrics.find((m) => m.id === id);
const value = (tile, id) => metric(tile, id)?.value;
const clean = (tile) => {
  parseTileResult(tile);
  assert.doesNotMatch(JSON.stringify(tile), /도보|\d\s*분|종합/);
  assert.doesNotMatch(JSON.stringify(toTileView(tile)), /도보|\d\s*분|종합/);
  assert.equal(tile.judgment?.level ?? null, null);
  assert.match(tile.judgment.sentence, / → .+ → /);
};

// PNU→단지명 조회는 500개 단위로 나눠야 SQLite 변수 상한과 전국 자료를 함께 처리한다.
{
  const db = new Database(":memory:");
  initDataFileSchema(db, "core");
  const releaseId = insertRelease(db, {
    sourceId: "housing_name_test",
    provider: "테스트",
    sourceUrl: "https://example.invalid",
    sourceAsOf: "2026-09-30",
    fetchedAt: "2026-09-30T00:00:00Z",
    checksum: "x",
    licenseCode: "TEST",
  });
  const pnus = Array.from({ length: 501 }, (_, i) => `41360118001${String(10000000 + i).padStart(8, "0")}`);
  insertFeature(db, { stableId: "officetel:first", kind: "officetel", sourceKey: "first", releaseId, geometry: { type: "Point", coordinates: [127, 37] }, pnu: pnus[0], name: "오피스텔 이름" });
  insertFeature(db, { stableId: "housing:first", kind: "housing_complex", sourceKey: "first", releaseId, geometry: { type: "Point", coordinates: [127, 37] }, pnu: pnus[0], name: "대표 아파트" });
  for (let i = 1; i < pnus.length; i += 1) {
    insertFeature(db, { stableId: `housing:${i}`, kind: "housing_complex", sourceKey: String(i), releaseId, geometry: { type: "Point", coordinates: [127, 37] }, pnu: pnus[i], name: `단지 ${i}` });
  }
  const names = lookupComplexNames(db, [...pnus, "없는 PNU"]);
  assert.equal(names.size, 501);
  assert.equal(names.get(pnus[0]), "대표 아파트", "같은 PNU면 공동주택 이름을 오피스텔보다 우선");
  assert.equal(names.get(pnus[500]), "단지 500", "두 번째 500개 청크도 조회");
  assert.equal(names.has("없는 PNU"), false);
  db.close();
}

{
  const ctx = (await make({ trades: true }))();
  const trades = collectTrades(ctx);
  assert.ok(trades);
  assert.equal(trades.valid.length, 29, "위치 확인·취소 제외 유효 거래");
  assert.equal(trades.priced.length, 28, "전용면적이 있어 단가를 계산한 거래");
  assert.equal(trades.unlocated, 2, "위치 미확인 거래");
  assert.equal(trades.cancelled, 1, "취소 거래");
  assert.equal(trades.points.length, 3, "단지별 점");
  assert.deepEqual(trades.points.map((p) => p.n).sort((a, b) => a - b), [1, 3, 24]);

  const d25Tile = d25(ctx);
  clean(d25Tile);
  assert.equal(d25Tile.tileCode, "D25");
  assert.equal(d25Tile.status, "partial");
  assert.equal(value(d25Tile, "fill_location_pct"), 93.5, "29/(29+2)");
  assert.equal(metric(d25Tile, "fill_location_pct").numerator, 29);
  assert.equal(metric(d25Tile, "fill_location_pct").denominator, 31);
  assert.equal(value(d25Tile, "unlocated_trades"), 2);
  const back = [1, 2, 3, 4, 5].map((i) => value(d25Tile, `back_q${i}`));
  assert.equal(back.reduce((sum, n) => sum + n, 0), 28, "원거래 단가 기준 분위수 건수");
  assert.deepEqual(d25Tile.presentation.features, [], "D25는 A07에 흡수되어 지도 지물을 중복 방출하지 않는다");
  assert.equal(d25Tile.presentation.featuresTotal, 0);
  const t = a07ServerModule.compute(ctx);
  clean(t);
  assert.equal(t.tileCode, "A07");
  assert.equal(t.status, "partial");
  assert.equal(value(t, "fill_location_pct"), 93.5);
  const aCtx = (await make({ trades: true }))();
  const a = a07(aCtx);
  aCtx.close();
  const named = a.presentation.features.find((feature) => feature.name === "다산 센트럴");
  const unnamed = a.presentation.features.find((feature) => feature.name === null);
  const pointA = trades.points.find((point) => point.pnu === "4136011800100010000");
  const pointC = trades.points.find((point) => point.pnu === "1171010100100030000");
  assert.deepEqual(
    [named?.name, named?.sublabel, named?.labelPriority],
    ["다산 센트럴", `${Math.round(pointA.m).toLocaleString("en-US")}만원/㎡ · ${pointA.n}건`, 1],
    "A07은 lookupComplexNames 이름과 해당 PNU 단가·건수를 사용한다",
  );
  assert.deepEqual(
    [unnamed?.name, unnamed?.sublabel, unnamed?.labelPriority],
    [null, `${Math.round(pointC.m).toLocaleString("en-US")}만원/㎡ · ${pointC.n}건`, 0],
    "A07 이름이 없으면 대체 문구 없이 priority 0이다",
  );
  assert.ok(a.presentation.features.every((feature) => !Object.hasOwn(feature, "label")), "A07는 옛 label을 내지 않는다");
  const cuts = [0.2, 0.4, 0.6, 0.8].map((p) => {
    const values = trades.points.map((point) => point.m).sort((x, y) => x - y);
    const position = (values.length - 1) * p;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return values[lower] + (values[upper] - values[lower]) * (position - lower);
  });
  assert.deepEqual(a.presentation.legend.map(({ label, min, max }) => ({ label, min, max })), [
    { label: "㎡당 하위 20%", min: null, max: cuts[0] },
    { label: "㎡당 20~40%", min: cuts[0], max: cuts[1] },
    { label: "㎡당 40~60%", min: cuts[1], max: cuts[2] },
    { label: "㎡당 60~80%", min: cuts[2], max: cuts[3] },
    { label: "㎡당 상위 20%", min: cuts[3], max: null },
  ], "A07 범례는 실제 점별 단가 분위 경계값을 보존한다");
  assert.deepEqual(
    t.presentation.features.map(({ layer, weight, lng, lat }) => ({ layer, weight, lng, lat })),
    a.presentation.features.map(({ layer, weight, lng, lat }) => ({ layer, weight, lng, lat })),
    "흡수된 A07 결과는 A07 지도 지물만 방출",
  );
  assert.match(t.judgment.sentence, /최근 12개월 반경 안 아파트 매매/);
  assert.match(d25Tile.judgment.sentence, /아파트 매매 · 최근 12개월/);
  ctx.close();
}

assert.equal(a07ClientModule.layers.options.length, 1, "A07 가격 구간 칩은 삭제하고 호환 id만 남긴다");
assert.deepEqual(a07ClientModule.layers.options[0], { id: "trade_location", label: "기본 거래" });

{
  const ctx = (await make({}))();
  assert.equal(d25(ctx).status, "not_provided", "실거래 원천이 없으면 미제공");
  ctx.close();
}

console.log("v2 engine D25: ok");
