import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const Database = (await import("better-sqlite3")).default;
const { buildEngineFixture, at, CENTER, SITE_PNUS } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { d10 } = await import("../../lib/v2/tile/d10/engine.ts");
const { d10ClientModule } = await import("../../lib/v2/tile/d10/view.ts");

const CENTER_Z = 18;
const TILE_SIZE = 256;
function worldPixel([lng, lat], z) {
  const size = TILE_SIZE * 2 ** z;
  const sin = Math.sin((lat * Math.PI) / 180);
  return [
    ((lng + 180) / 360) * size,
    (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  ];
}

function syntheticMosaic(center = CENTER, radiusM = 800) {
  const mPerPx = 0.6;
  const [centerPxX, centerPxY] = worldPixel(center, CENTER_Z);
  const width = Math.ceil((radiusM * 2) / mPerPx) + 8;
  const height = width;
  const x0Px = Math.floor(centerPxX - width / 2);
  const y0Px = Math.floor(centerPxY - height / 2);
  const rgb = new Uint8Array(width * height * 3);
  const valid = new Uint8Array(width * height).fill(1);
  const canopyRadiusPx = Math.max(2, (radiusM * 0.28) / mPerPx);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const offset = index * 3;
      const dx = x0Px + x + 0.5 - centerPxX;
      const dy = y0Px + y + 0.5 - centerPxY;
      const canopy = Math.hypot(dx, dy) <= canopyRadiusPx;
      rgb[offset] = canopy ? 42 : 132;
      rgb[offset + 1] = canopy ? 145 : 119;
      rgb[offset + 2] = canopy ? 40 : 78;
    }
  }
  return { z: CENTER_Z, x0Px, y0Px, width, height, rgb, mPerPx, missingTiles: 0, totalTiles: 1, valid };
}

function rectangle(x0, x1, y0, y1) {
  return { type: "Polygon", coordinates: [[at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)]] };
}

function input(site) {
  return {
    address: "101-1대 외 1필지",
    center: CENTER,
    radiusM: 800,
    analysisDate: "2026-10-01",
    pnu: site.pnus?.[0] ?? null,
    site,
  };
}

const dataDir = await mkdtemp(join(tmpdir(), "v2-d10-w2a-"));
try {
  await buildEngineFixture(dataDir, "v1", { landuse: true, parcels: true, siteSelection: true });
  const manifest = M.readManifest(dataDir);
  assert.ok(manifest);

  const referencePath = M.resolveDataPath(dataDir, manifest.files.reference.path);
  const reference = new Database(referencePath);
  const landuseRelease = reference.prepare("SELECT release_id FROM source_release WHERE source_id = 'osm_landuse'").pluck().get();
  insertFeature(reference, {
    stableId: "osm:unnamed-forest",
    kind: "landuse",
    sourceKey: "unnamed-forest",
    releaseId: landuseRelease,
    geometry: rectangle(450, 500, 450, 500),
    name: null,
    properties: { osmId: "unnamed-forest", fclass: "forest", cls: "forest", layer: "test" },
  });
  reference.close();

  const source = readFileSync(new URL("../../lib/v2/tile/d10/engine.ts", import.meta.url), "utf8");
  assert.equal((source.match(/canopyCellStats\(/g) ?? []).length, 1, "D10 엔진에서 canopyCellStats를 한 번만 계산");
  assert.doesNotMatch(source, /canopy && imageryFill !== null/, "D10의 도달할 수 없는 채움률 분기 제거");
  assert.doesNotMatch(source, /d10-canopy-site@1/, "D10 대지 수관 formulaVersion을 최신 계약으로 통일");

  const parcelCtx = new EngineContext(dataDir, manifest, "d10-w2a-parcels", input({ pnus: SITE_PNUS, geometry: null, kind: "parcels" }));
  const parcelTile = d10(parcelCtx, { mosaic: syntheticMosaic() });
  const siteMetric = parcelTile.metrics.find((metric) => metric.id === "canopy_site_pct");
  assert.equal(siteMetric?.status, "estimated");
  assert.equal(siteMetric?.denominator, 1600, "다필지 대지 면적을 모두 분모에 합산");
  assert.match(siteMetric?.formulaVersion ?? "", /^d10-canopy-site@2:/);
  const unnamed = parcelTile.presentation.polygons.find((polygon) => polygon.label === "산림");
  assert.ok(unnamed, "OSM 이름 없는 면은 cls의 한글 라벨을 사용");
  parcelCtx.close();

  const farGeometry = rectangle(5000, 5050, 5000, 5050);
  const farCtx = new EngineContext(dataDir, manifest, "d10-w2a-far-site", input({ pnus: [], geometry: farGeometry, kind: "polygon" }));
  const farTile = d10(farCtx, { mosaic: syntheticMosaic() });
  const farMetric = farTile.metrics.find((metric) => metric.id === "canopy_site_pct");
  assert.equal(farMetric?.status, "missing");
  assert.match(farMetric?.formulaVersion ?? "", /^d10-canopy-site@2:/);
  farCtx.close();

  assert.ok(d10ClientModule.headline.ids.includes("canopy_site_pct"), "D10 요약에 대지 수관률 포함");
} finally {
  try {
    await rm(dataDir, { recursive: true, force: true });
  } catch (error) {
    if (error?.code !== "EBUSY") throw error;
  }
}

console.log("✓ v2 D10 W2a canopy and OSM labels");
