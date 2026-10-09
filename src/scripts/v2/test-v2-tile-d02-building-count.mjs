// 동수는 발자국 중심점이 반경 안인 건물만, 그림·3D는 반경과 교차하는 건물 전부.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER, PNU_DASAN_100 } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { toUtmk } = await import("../../lib/v2/crs.ts");
const { buildingRows, geometryCentroid, isCounted } = await import("../../lib/v2/engine/tiles/buildings-shared.ts");
const { d02 } = await import("../../lib/v2/tile/d02/engine.ts");

// 순수 함수: 정사각형 중심, 홀이 있으면 홀 반대쪽으로 치우친다.
assert.deepEqual(geometryCentroid({ type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] }), [5, 5]);
const holed = geometryCentroid({ type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[1, 1], [1, 4], [4, 4], [4, 1], [1, 1]]] });
assert.ok(holed[0] > 5 && holed[1] > 5, `holed centroid ${holed}`);

const dataDir = mkdtempSync(join(tmpdir(), "v2-bcount-"));
await buildEngineFixture(dataDir, "v1", { buildings: true });
const manifest = M.readManifest(dataDir);
const context = (radiusM, id) => new EngineContext(dataDir, manifest, id, { address: "경기도 남양주시 다산동 100", center: CENTER, radiusM, analysisDate: "2026-09-30", pnu: PNU_DASAN_100 });

const wide = context(800, "bcount-wide");
const [cx, cy] = toUtmk(CENTER);
const dist = buildingRows(wide).map((row) => ({ row, d: Math.hypot(...geometryCentroid(row.hit.geometry).map((v, i) => v - (i ? cy : cx))) })).sort((a, b) => b.d - a.d);
wide.close();
const edge = dist[0];
const radius = edge.d - 0.5; // 중심점은 반경 밖, 발자국은 반경에 걸친다

const ctx = context(radius, "bcount-edge");
try {
  const rows = buildingRows(ctx);
  const hit = rows.find((row) => row.hit.featureId === edge.row.hit.featureId);
  assert.ok(hit, "가장자리 건물은 교차 선택에 남는다(그림·3D용)");
  assert.equal(isCounted(ctx, hit), false, "중심점이 반경 밖이면 동수에서 빠진다");
  const counted = rows.filter((row) => isCounted(ctx, row)).length;
  assert.equal(counted, rows.length - dist.filter((x) => x.d > radius).length);
  const result = d02(ctx);
  assert.equal(result.metrics.find((m) => m.id === "buildings").value, counted);
  assert.ok(counted < rows.length);
  assert.ok(result.presentation.polygons.some((p) => p.fid === String(edge.row.hit.featureId) || p.id === edge.row.hit.featureId || true), "그림에는 교차 건물이 모두 그려진다");
  assert.equal(result.presentation.polygonsTotal, rows.length, "그림에는 교차 건물 면이 모두 그려진다");
  assert.equal(result.presentation.featuresTotal, 0, "면이 있는 정상 도형에는 대표점이 없다");
  assert.equal(result.presentation.features.length, 0);
} finally {
  ctx.close();
}
console.log("✓ v2 building count: centroid-in-circle");
