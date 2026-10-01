import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { d03, USE_CLASSES, useClassOf } = await import("../../lib/v2/engine/tiles/d03.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");

const metric = (tile, id) => {
  const found = tile.metrics.find((item) => item.id === id);
  assert.ok(found, `${tile.tileCode}: metric ${id}`);
  return found;
};

const context = (dataDir, analysisId = "d03-test") => new EngineContext(
  dataDir,
  M.readManifest(dataDir),
  analysisId,
  { address: "경기도 남양주시 다산동 100", center: CENTER, radiusM: 800, analysisDate: "2026-09-30", pnu: null },
);

assert.deepEqual(USE_CLASSES, ["주거", "근린생활", "업무", "판매", "숙박", "문화집회", "교육복지", "공업", "기타", "미상"]);
assert.deepEqual(
  [useClassOf("02000"), useClassOf(null), useClassOf("99000"), useClassOf(" 14000 ")],
  ["주거", "미상", "미상", "업무"],
);

// 1) 픽스처의 반경 내 6동: 주거 2, 업무 1, 근린생활 1, 미상 2.
const dataDir = mkdtempSync(join(tmpdir(), "v2-d03-"));
await buildEngineFixture(dataDir, "v1", { buildings: true });
const ctx = context(dataDir);
const tile = d03(ctx);
parseTileResult(tile);

assert.equal(tile.status, "partial");
assert.equal(tile.engineVersion, "v2-p2-spatial-2");
assert.deepEqual(tile.provenance.sources.map((source) => source.sourceId), ["building"]);
assert.equal(metric(tile, "fill_use_pct").value, 66.7);
assert.deepEqual([metric(tile, "fill_use_pct").numerator, metric(tile, "fill_use_pct").denominator], [4, 6]);
assert.deepEqual(
  USE_CLASSES.map((_, index) => [metric(tile, `share_use_${index + 1}`).value, metric(tile, `share_use_${index + 1}`).numerator, metric(tile, `share_use_${index + 1}`).status]),
  [[33.3, 2, "observed"], [16.7, 1, "observed"], [16.7, 1, "observed"], [0, 0, "observed"], [0, 0, "observed"], [0, 0, "observed"], [0, 0, "observed"], [0, 0, "observed"], [0, 0, "observed"], [33.3, 2, "observed"]],
);
assert.deepEqual(
  [metric(tile, "area_share_1").numerator, metric(tile, "area_share_1").denominator],
  [325, 1069],
);
assert.deepEqual(tile.presentation.layers, USE_CLASSES.map((useClass) => `use:${useClass}`));
assert.equal(tile.presentation.polygons.length, 6);
assert.equal(tile.presentation.polygonsTotal, 6);
assert.equal(tile.judgment.level, null);
assert.doesNotMatch(JSON.stringify(tile), /도보|\d\s*분|종합/);
ctx.close();

// 2) 건물 파일이 게시되지 않으면 D03만 안전하게 미제공.
const absentDir = mkdtempSync(join(tmpdir(), "v2-d03-absent-"));
await buildEngineFixture(absentDir, "v1", { buildings: false });
const absentCtx = context(absentDir, "d03-absent");
const absent = d03(absentCtx);
parseTileResult(absent);
assert.equal(absent.status, "not_provided");
assert.equal(absent.limitations[0].kind, "not_provided");
absentCtx.close();

console.log("✓ v2 D03 engine tile");
