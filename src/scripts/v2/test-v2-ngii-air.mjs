import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const { mosaic, tileAt, levelFor } = require("../../lib/v2/engine/ngii-air-worker.cjs");
const { canopyFor } = await import("../../lib/v2/engine/tiles/canopy-shared.ts");
const { toUtmk } = await import("../../lib/v2/crs.ts");
const { sourceDetailsFor } = await import("../../lib/v2/ui/source-details.ts");
const { sourceLineOf } = await import("../../lib/v2/ui/tile-view.ts");
const { sourceNotices } = await import("../../lib/v2/report/pptx-kit.ts");
assert.deepEqual(tileAt(953900, 1952000, 18), { col: 17676, row: 31372 });
assert.deepEqual(tileAt(953900, 1952000, 16), { col: 4419, row: 7843 });
assert.deepEqual([levelFor(1000), levelFor(1001), levelFor(2000), levelFor(2001)], [18, 17, 17, 16]);
const root = mkdtempSync(join(tmpdir(), "ngii-air-test-"));
try {
  let calls = [];
  const jpeg = await sharp({ create: { width: 256, height: 256, channels: 3, background: { r: 50, g: 140, b: 40 } } }).jpeg().toBuffer();
  const mock = async (url) => {
    calls.push(String(url));
    if (String(url).includes("airMapApiUseLog")) return new Response(JSON.stringify({ success: "success" }));
    if (String(url).includes("AirPhotoYear")) throw Error("offline");
    return new Response(jpeg, { headers: { "content-type": "image/jpeg" } });
  };
  assert.equal(await mosaic({ center: [953900, 1952000], radiusM: 2, cacheRoot: root }, { fetch: mock }), null);
  assert.equal(calls.length, 0);
  const priorKey = process.env.NGII_API_KEY;
  delete process.env.NGII_API_KEY;
  assert.equal(canopyFor({ input: { center: [126.9779, 37.5663], radiusM: 2 }, memo: (_key, fn) => fn() }), null);
  if (priorKey !== undefined) process.env.NGII_API_KEY = priorKey;
  mkdirSync(join(root, "2024")); mkdirSync(join(root, "2025"));
  const output = await mosaic({ key: "fixture", center: [953900, 1952000], radiusM: 2, cacheRoot: root }, { fetch: mock });
  assert.equal(output.header.year, 2025);
  assert.equal(output.header.missingTiles, 0);
  assert.equal(calls.filter((url) => url.includes("airMapApiUseLog")).length, 1);
  assert.equal(calls.filter((url) => url.includes("AirPhotoYear")).length, 1);
  assert.ok(calls.filter((url) => url.includes("GetTile")).every((url) => new URL(url).searchParams.get("LAYER") === "mapprime:air_2025"));
  calls = [];
  await mosaic({ key: "fixture", cachedYear: 2025, center: [953900, 1952000], radiusM: 2, cacheRoot: root }, { fetch: mock });
  assert.equal(calls.filter((url) => url.includes("airMapApiUseLog")).length, 1, "cache hits still record one use");
  assert.equal(calls.filter((url) => url.includes("GetTile") || url.includes("AirPhotoYear")).length, 0);
  let active = 0, peak = 0, attempts = 0;
  const limited = async (url, options) => {
    assert.ok(options.signal, "each request has an abort timeout");
    if (String(url).includes("airMapApiUseLog")) return new Response(JSON.stringify({ success: "success" }));
    active++; peak = Math.max(peak, active); const attempt = ++attempts;
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return attempt === 1 ? new Response("missing", { status: 404 }) : new Response(jpeg, { headers: { "content-type": "image/jpeg" } });
  };
  const partial = await mosaic({ key: "fixture", cachedYear: 2025, center: [953900, 1952000], radiusM: 100, cacheRoot: join(root, "other") }, { fetch: limited });
  assert.ok(peak <= 8 && peak > 1);
  assert.ok(partial.header.totalTiles > 1);
  assert.equal(partial.header.missingTiles, 1);

  // An offset patch must land at the same EPSG:5179 coordinates in the vector output.
  const center = [126.9779, 37.5663], [cx, cy] = toUtmk(center);
  const width = 80, height = 80, rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3, green = x >= 48 && x < 60 && y >= 25 && y < 37;
    rgb.set(green ? [30, 150, 30] : [140, 120, 110], i);
  }
  const injected = { z: 18, x0Px: 0, y0Px: 0, utmkOrigin: [cx - 40, cy + 40], year: 2025, width, height, rgb, mPerPx: 1, missingTiles: 0, totalTiles: 1 };
  const ctx = { input: { center, radiusM: 30 }, memo: (_key, fn) => fn() };
  const result = canopyFor(ctx, { mosaic: injected });
  assert.ok(result.polygons.length > 0);
  const pts = result.polygons.flat(3);
  const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
  assert.ok(Math.min(...xs) > cx + 5 && Math.max(...xs) < cx + 22);
  assert.ok(Math.min(...ys) > cy + 1 && Math.max(...ys) < cy + 18);
  const source = { sourceId: "ngii_air", releaseId: "ngii_air@2025", sourceAsOf: "2025", fetchedAt: "runtime" };
  const rows = sourceDetailsFor({ code: "D10", tileType: "diagram", provenance: { sources: [source] } }, new Map()).rows;
  assert.match(rows[0].provider, /국토지리정보원 국토정보플랫폼 오픈API/);
  assert.ok(rows[0].notices.includes("국토포털(국토정보플랫폼) 오픈API의 결과물"));
  assert.match(sourceLineOf([source]), /국토지리정보원 국토정보플랫폼 오픈API/);
  assert.deepEqual(sourceNotices(rows), ["국토포털(국토정보플랫폼) 오픈API의 결과물"]);
  console.log("✓ NGII imagery grid, offline fetching, attribution, and polygon alignment");
} finally { rmSync(root, { recursive: true, force: true }); }
