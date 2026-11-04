import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEngineFixture, CENTER } from "./engine-fixture.mjs";
import { readManifest } from "../../lib/v2/data/manifest.ts";
import { EngineContext } from "../../lib/v2/engine/context.ts";
import { canopyFor } from "../../lib/v2/engine/tiles/canopy-shared.ts";
import { d10 } from "../../lib/v2/tile/d10/engine.ts";
import { toUtmk } from "../../lib/v2/crs.ts";

delete process.env.NGII_API_KEY;
const data = mkdtempSync(join(tmpdir(), "canopy-building-"));
let ctx;
try {
  await buildEngineFixture(data, "v1", { buildings: true });
  const manifest = readManifest(data);
  const [cx, cy] = toUtmk(CENTER);
  const width = 100, rgb = new Uint8Array(width * width * 3);
  for (let i = 0; i < width * width; i++) rgb.set([40, 150, 40], i * 3);
  const valid = new Uint8Array(width * width).fill(1);
  // Missing imagery inside the building must stay missing rather than become valid zero.
  for (let y = 48; y <= 52; y++) for (let x = 48; x <= 52; x++) valid[y * width + x] = 0;
  const mosaic = { z: 18, x0Px: 0, y0Px: 0, utmkOrigin: [cx - 50, cy + 50], width, height: width, rgb, valid, mPerPx: 1, missingTiles: 0, totalTiles: 1 };
  ctx = new EngineContext(data, manifest, "mask", { address: "fixture", center: CENTER, radiusM: 30, analysisDate: "2026-10-01", pnu: null }, {}, {});
  const tile = d10(ctx, { mosaic, resultCacheDir: join(data, "cache") });
  const result = canopyFor(ctx);
  const value = (dx, dy) => result.grid.values[Math.round((cy + dy - result.grid.y0) / result.grid.cellM) * result.grid.cols + Math.round((cx + dx - result.grid.x0) / result.grid.cellM)];
  assert.equal(result.buildingMaskApplied, true);
  assert.equal(value(3, 3), 0, "green roof inside fixture building is excluded");
  assert.equal(value(10, 10), 1, "nearby green pixels remain canopy");
  assert.ok(Number.isNaN(value(0, 0)), "missing imagery remains missing");
  assert.ok(tile.limitations.some(({ note }) => note === "건물 바닥 면 안쪽은 수관에서 제외(옥상 녹화 포함)"));
  const noBuildings = new EngineContext(data, manifest, "without-buildings", { address: "fixture", center: CENTER, radiusM: 30, analysisDate: "2026-10-01", pnu: null }, {}, {});
  const originalDb = noBuildings.db.bind(noBuildings);
  noBuildings.db = (key) => key === "buildings" ? null : originalDb(key);
  try {
    const unmasked = canopyFor(noBuildings, { mosaic, resultCacheDir: join(data, "cache") });
    const index = Math.round((cy + 3 - unmasked.grid.y0) / unmasked.grid.cellM) * unmasked.grid.cols + Math.round((cx + 3 - unmasked.grid.x0) / unmasked.grid.cellM);
    assert.equal(unmasked.buildingMaskApplied, false);
    assert.equal(unmasked.grid.values[index], 1, "result cache varies with building inputs");
  } finally { noBuildings.close(); }
  console.log("✓ canopy building mask, nearby trees, missing pixels, and limitation");
} finally { ctx?.close(); rmSync(data, { recursive: true, force: true }); }
