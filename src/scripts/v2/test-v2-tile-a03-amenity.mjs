import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const Database = (await import("better-sqlite3")).default;
const { buildEngineFixture, at, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { a03 } = await import("../../lib/v2/tile/a03/engine.ts");
const { formatDistanceM } = await import("../../lib/v2/ui/tile-view.ts");
const { layerStyle } = await import("../../lib/v2/ui/map-layers.ts");

const dataDir = await mkdtemp(join(tmpdir(), "v2-a03-w2a-"));
let ctx = null;
try {
  await buildEngineFixture(dataDir, "v1");
  const manifest = M.readManifest(dataDir);
  assert.ok(manifest);
  const reference = new Database(M.resolveDataPath(dataDir, manifest.files.reference.path));
  const storeRelease = reference.prepare("SELECT release_id FROM source_release WHERE source_id = 'store'").pluck().get();
  insertFeature(reference, {
    stableId: "store:grocery-far",
    kind: "store",
    sourceKey: "grocery-far",
    releaseId: storeRelease,
    geometry: { type: "Point", coordinates: at(500, 0) },
    name: "먼 식료품점",
    properties: { majorCategory: "소매", midCategory: "종합 소매", minorCategory: "x", categoryCode: "G20405", floor: null, address: null },
  });
  reference.close();
  ctx = new EngineContext(dataDir, manifest, "a03-w2a", {
    address: "테스트 대지",
    center: CENTER,
    radiusM: 800,
    analysisDate: "2026-10-01",
  });
  const tile = a03(ctx);
  const nearest = tile.metrics.filter((metric) => metric.id.startsWith("nearest_"));
  assert.deepEqual(
    nearest.map((metric) => metric.id),
    ["nearest_grocery_m", "nearest_clinic_m", "nearest_pharmacy_m", "nearest_life_service_m"],
    "요약 최근접 거리는 기초 생활시설 4군만 노출",
  );
  assert.equal(tile.metrics.some((metric) => metric.id === "nearest_eatery_m"), false, "음식·카페 최근접은 4군 요약에 섞지 않음");
  assert.equal(tile.metrics.find((metric) => metric.id === "nearest_grocery_m")?.value, 100);
  assert.equal(tile.metrics.find((metric) => metric.id === "nearest_clinic_m")?.value, 300);
  assert.equal(tile.metrics.find((metric) => metric.id === "nearest_life_service_m")?.value, 50);
  assert.equal(tile.metrics.find((metric) => metric.id === "nearest_pharmacy_m")?.status, "missing");

  const highlightedLayers = tile.presentation.features.filter((feature) => feature.highlight).map((feature) => feature.layer).sort();
  assert.deepEqual(highlightedLayers, ["store:clinic", "store:eatery", "store:grocery", "store:life_service", "store:other"], "지도 강조는 각 업종군의 최근접 히트를 재사용");
  const storeFeatures = tile.presentation.features.filter((feature) => feature.layer.startsWith("store:"));
  assert.ok(storeFeatures.every((feature) => typeof feature.name === "string" && feature.name.length > 0), "상가 feature는 원천 상호명을 name으로 전달");
  const nearestFeatures = storeFeatures.filter((feature) => feature.highlight);
  assert.ok(nearestFeatures.every((feature) => typeof feature.distanceM === "number" && feature.labelPriority === 2 && feature.sublabel === formatDistanceM(feature.distanceM) && feature.label === undefined), "업종군 최근접만 formatted 거리·priority 2");
  const nonNearest = storeFeatures.find((feature) => feature.name === "먼 식료품점");
  assert.equal(nonNearest?.highlight, undefined);
  assert.equal(nonNearest?.labelPriority, 0, "비최근접 priority 0");
  assert.equal(nonNearest?.sublabel, null, "비최근접 sublabel 없음");
  assert.equal(layerStyle("store:grocery").label, "식료품");
  const shares = tile.metrics.filter((metric) => metric.id.startsWith("share_"));
  assert.deepEqual(shares.map((metric) => metric.id), ["share_grocery", "share_clinic", "share_eatery", "share_life_service", "share_other"], "A03 구성비 순서는 실제 업종 범례와 같다");
  assert.deepEqual(shares.map((metric) => metric.label), tile.presentation.legend.map((entry) => `구성비: ${entry.label}`));
  assert.ok(Math.abs(Math.round(shares.reduce((sum, metric) => sum + metric.value, 0) * 10) / 10 - 100) <= 0.1, "A03 업종 수 구성비 합계");
  assert.ok(shares.every((metric) => metric.unit === "%" && metric.formulaVersion.startsWith("a03-share-count@1:")));
  ctx.close();
  ctx = null;

  const source = readFileSync(new URL("../../lib/v2/tile/a03/engine.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /nearestHit|nearestM/, "A03은 nearest 재계산 helper를 중복 호출하지 않음");
} finally {
  ctx?.close();
  try {
    await rm(dataDir, { recursive: true, force: true });
  } catch (error) {
    if (error?.code !== "EBUSY") throw error;
  }
}

console.log("✓ v2 A03 W2a amenity summary");
