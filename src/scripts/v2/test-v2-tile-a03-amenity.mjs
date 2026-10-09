import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { a03 } = await import("../../lib/v2/tile/a03/engine.ts");

const dataDir = await mkdtemp(join(tmpdir(), "v2-a03-w2a-"));
let ctx = null;
try {
  await buildEngineFixture(dataDir, "v1");
  const manifest = M.readManifest(dataDir);
  assert.ok(manifest);
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
  assert.deepEqual(highlightedLayers, ["store:clinic", "store:eatery", "store:grocery", "store:life_service"], "지도 강조는 계산한 최근접 히트를 재사용");
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
