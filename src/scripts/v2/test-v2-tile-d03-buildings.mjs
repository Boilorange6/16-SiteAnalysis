import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { d03, USE_CLASSES, useClassOf } = await import("../../lib/v2/tile/d03/engine.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

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
assert.equal(tile.engineVersion, "v2-p4-ext-1");
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
assert.match(tile.judgment.sentence, /확인된 주용도 중 최다는 주거/, "판정 문장에 확인된 최다 용도를 포함");
assert.doesNotMatch(JSON.stringify(tile), /도보|\d\s*분|종합/);
ctx.close();

// 2) 미상이 확인된 용도보다 많아도 헤더 후보에서는 제외하되 수치·도형은 보존.
const unknownDominantDir = mkdtempSync(join(tmpdir(), "v2-d03-unknown-dominant-"));
await buildEngineFixture(unknownDominantDir, "v1", { buildings: true });
const unknownDominantDb = new Database(join(unknownDominantDir, "versions", "v1", "buildings.sqlite"));
unknownDominantDb.prepare(`UPDATE building_fact SET use_code = NULL WHERE feature_id IN (
  SELECT feature_id FROM feature WHERE stable_id IN ('building:b_apt', 'building:b_tower')
)`).run();
unknownDominantDb.close();
const unknownDominantCtx = context(unknownDominantDir, "d03-unknown-dominant");
const unknownDominant = d03(unknownDominantCtx);
parseTileResult(unknownDominant);
const unknownDominantView = toTileView(unknownDominant);
assert.equal(metric(unknownDominant, "share_use_10").value, 66.7);
assert.notEqual(unknownDominantView.headlineMetricId, "share_use_10", "미상 구성비는 헤더 후보에서 제외");
assert.notEqual(unknownDominantView.headline?.label, "구성비: 미상", "미상 용도는 헤더 최우선으로 표시하지 않음");
assert.equal(unknownDominant.presentation.polygons.length, 6, "헤더 정책 변경이 도형을 제거하지 않음");
unknownDominantCtx.close();

// 3) 적재 단계 retired 제외가 coverage 없이도 타일 상태를 partial로 만든다.
const retirementDir = mkdtempSync(join(tmpdir(), "v2-d03-retirement-"));
await buildEngineFixture(retirementDir, "v1", { buildings: true });
const retirementDb = new Database(join(retirementDir, "versions", "v1", "buildings.sqlite"));
retirementDb.prepare("UPDATE feature SET properties_json = ? WHERE stable_id = ?").run(JSON.stringify({ retired: true }), "building:b_unknown");
retirementDb.close();
const retirementCtx = context(retirementDir, "d03-retirement");
retirementCtx.coverage = () => [];
const retired = d03(retirementCtx);
parseTileResult(retired);
assert.equal(retired.status, "partial", "retired 건물 제외는 타일 상태에 반영");
assert.ok(retired.limitations.some((limitation) => /retired/.test(limitation.note)), "retired 제외 근거를 limitation에 보존");
retirementCtx.close();

// 4) 반경 절단이 불가능한 도형도 타일 상태를 partial로 만든다.
const invalidGeometryCtx = context(dataDir, "d03-invalid-geometry");
const originalHits = invalidGeometryCtx.hits.bind(invalidGeometryCtx);
invalidGeometryCtx.hits = (key, kinds, radiusM) => originalHits(key, kinds, radiusM).map((hit) => hit.stableId === "building:b_unknown"
  ? { ...hit, geometry: { type: "GeometryCollection", geometries: [] } }
  : hit);
invalidGeometryCtx.coverage = () => [];
const invalidGeometry = d03(invalidGeometryCtx);
parseTileResult(invalidGeometry);
assert.equal(invalidGeometry.status, "partial", "invalid geometry는 타일 상태에 반영");
assert.ok(invalidGeometry.limitations.some((limitation) => /도형 오류/.test(limitation.note)), "invalid geometry 근거를 limitation에 보존");
assert.equal(invalidGeometry.presentation.polygons.length, 5, "invalid geometry만 도형에서 제외");
invalidGeometryCtx.close();

// 5) 건물 파일이 게시되지 않으면 D03만 안전하게 미제공.
const absentDir = mkdtempSync(join(tmpdir(), "v2-d03-absent-"));
await buildEngineFixture(absentDir, "v1", { buildings: false });
const absentCtx = context(absentDir, "d03-absent");
const absent = d03(absentCtx);
parseTileResult(absent);
assert.equal(absent.status, "not_provided");
assert.equal(absent.limitations[0].kind, "not_provided");
absentCtx.close();

console.log("✓ v2 D03 engine tile");
