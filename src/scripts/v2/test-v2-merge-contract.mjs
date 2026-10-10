/** C7 merge 계약 RED→GREEN 테스트: totals·judgment·dropMetricIds·기본 보기 우선. */
import assert from "node:assert/strict";

const { mergeTileResults, capByLayer } = await import("../../lib/v2/engine/tiles/merge.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");

const center = [127.15, 37.62];
const base = {
  analysisId: "merge-contract",
  status: "partial",
  engineVersion: "test",
  conditions: { address: "a", center, radiusM: 500, analysisDate: "2026-10-09", timezone: "Asia/Seoul", filters: {}, simulation: null, parcelSnapshotHash: null },
  metrics: [],
  judgment: null,
  provenance: { manifestHash: "a".repeat(64), sources: [] },
  limitations: [],
};

const metric = (id, value) => ({ id, label: id, value, unit: "건", formulaVersion: "test", numerator: value, denominator: 1, status: "observed" });
const feature = (fid, layer) => ({ fid, layer, lng: center[0], lat: center[1] });
const result = (code, metrics, features, featuresTotal, sentence) => parseTileResult({
  ...base,
  tileId: `${base.analysisId}-${code}`,
  tileType: "analysis",
  tileCode: code,
  metrics,
  judgment: sentence ? { ruleId: "rule", basisMetricIds: [metrics[0].id], sentence, level: "good", criteria: "test" } : null,
  presentation: { legend: [], camera: null, layers: [...new Set(features.map((item) => item.layer))], outputFace: "front", features, featuresTotal },
});

const baseResult = result("A01", [metric("base_metric", 1), metric("drop_me", 2)], [feature("same", "base"), feature("base-only", "base")], 5, "기본 판정");
const extraResult = result("A01", [metric("extra_metric", 3), metric("drop_me", 4)], [feature("same", "base"), feature("extra-only", "extra")], 4, "흡수 판정");

const merged = mergeTileResults(baseResult, extraResult, { dropMetricIds: ["drop_me"] });
assert.deepEqual(merged.metrics.map((item) => item.id), ["base_metric", "extra_metric"]);
assert.equal(merged.presentation.features.length, 3, "fid dedupe 뒤 표시 수");
assert.equal(merged.presentation.featuresTotal, 8, "(각 total-각 표시 수) 합 + dedupe 표시 수");
assert.equal(merged.judgment.sentence, "기본 판정", "기본 judgment가 기본값");

const concatenated = mergeTileResults(baseResult, extraResult, { judgment: "concat" });
assert.match(concatenated.judgment.sentence, /기본 판정 · 흡수 판정/);

const preferred = capByLayer([
  { layer: "extra", id: 1 },
  { layer: "base", id: 2 },
  { layer: "extra", id: 3 },
  { layer: "base", id: 4 },
], 2, ["base", "extra"]);
assert.deepEqual(preferred.map((item) => item.id), [2, 4], "기본 보기 레이어를 먼저 유지");

console.log("✓ v2 merge contract");
