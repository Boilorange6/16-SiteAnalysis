import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { a07, collectTrades } = await import("../../lib/v2/tile/a07/engine.ts");
const { TILES } = await import("../../lib/v2/engine/run.ts");
const d25 = TILES.find(([code]) => code === "A07")[1];
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

const make = async (options) => {
  const dir = mkdtempSync(join(tmpdir(), "v2-eng-d25-"));
  await buildEngineFixture(dir, "v1", options);
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

  const t = d25(ctx);
  clean(t);
  assert.equal(t.tileCode, "A07");
  assert.equal(t.status, "partial");
  assert.equal(value(t, "fill_location_pct"), 93.5, "29/(29+2)");
  assert.equal(metric(t, "fill_location_pct").numerator, 29);
  assert.equal(metric(t, "fill_location_pct").denominator, 31);
  assert.equal(value(t, "unlocated_trades"), 2);
  const back = [1, 2, 3, 4, 5].map((i) => value(t, `back_q${i}`));
  assert.equal(back.reduce((sum, n) => sum + n, 0), 28, "원거래 단가 기준 분위수 건수");
  assert.ok(t.presentation.features.every((feature) => /^trade_q[1-5]$/.test(feature.layer)));
  const aCtx = (await make({ trades: true }))();
  const a = a07(aCtx);
  aCtx.close();
  assert.deepEqual(
    t.presentation.features.map(({ layer, weight, lng, lat }) => ({ layer, weight, lng, lat })),
    a.presentation.features.map(({ layer, weight, lng, lat }) => ({ layer, weight, lng, lat })),
    "앞면 점은 A07과 동일",
  );
  assert.match(t.judgment.sentence, /아파트 매매 · 최근 12개월/);
  ctx.close();
}

{
  const ctx = (await make({}))();
  assert.equal(d25(ctx).status, "not_provided", "실거래 원천이 없으면 미제공");
  ctx.close();
}

console.log("v2 engine D25: ok");
