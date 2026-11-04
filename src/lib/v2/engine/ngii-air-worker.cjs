/* NGIS_AIR fetcher. Exported dependencies permit completely offline tests. */
const fs = require("node:fs");
const path = require("node:path");
const TILE = 256;
const resolution = (level) => 66846.72 / 2 ** level;
const tileAt = (x, y, level) => ({ col: Math.floor((x + 200000) / (resolution(level) * TILE)), row: Math.floor((4000000 - y) / (resolution(level) * TILE)) });
const levelFor = (radius) => radius <= 1000 ? 18 : radius <= 2000 ? 17 : 16;

async function mosaic(input, deps = {}) {
  const fetcher = deps.fetch || fetch;
  if (!input.key) return null;
  const request = (url) => fetcher(url, { signal: AbortSignal.timeout(8000) });
  // The official client records use once per mosaic, including cache hits.
  try {
    const response = await request("https://map.ngii.go.kr/openapi/airMapApiUseLog.do?apikey=" + encodeURIComponent(input.key));
    if (!response.ok || (await response.json()).success !== "success") return null;
  } catch { return null; }
  let year = input.cachedYear || null;
  let yearFetched = false;
  if (!year) {
    try {
      const response = await request("https://map.ngii.go.kr/openapi/AirPhotoYear.do");
      const body = await response.json();
      if (response.ok && body.SUCCESS === true && Number.isInteger(body.RESULT) && body.RESULT >= 1900 && body.RESULT <= 2100) { year = body.RESULT; yearFetched = true; }
    } catch { /* use the newest cached year */ }
    if (!year) {
      try { year = fs.readdirSync(input.cacheRoot, { withFileTypes: true }).filter((d) => d.isDirectory() && /^(19|20)\d{2}$/.test(d.name)).map((d) => Number(d.name)).sort((a, b) => b - a)[0] || null; } catch { /* no cache */ }
    }
  }
  if (!year) return null;
  const z = levelFor(input.radiusM), res = resolution(z);
  const [cx, cy] = input.center;
  const x0 = Math.floor((cx - input.radiusM + 200000) / res);
  const y0 = Math.floor((4000000 - cy - input.radiusM) / res);
  const x1 = Math.ceil((cx + input.radiusM + 200000) / res);
  const y1 = Math.ceil((4000000 - cy + input.radiusM) / res);
  const width = x1 - x0, height = y1 - y0;
  const rgb = Buffer.alloc(width * height * 3), valid = Buffer.alloc(width * height);
  const coords = [];
  for (let row = Math.floor(y0 / TILE); row <= Math.floor((y1 - 1) / TILE); row++)
    for (let col = Math.floor(x0 / TILE); col <= Math.floor((x1 - 1) / TILE); col++) coords.push({ row, col });
  const sharp = deps.sharp || require("sharp");
  let next = 0, missing = 0;
  async function worker() {
    while (next < coords.length) {
      const { row, col } = coords[next++];
      const file = path.join(input.cacheRoot, String(year), String(z), String(row), col + ".jpg");
      try {
        let bytes;
        try { bytes = fs.readFileSync(file); } catch {
          const url = new URL("https://map.ngii.go.kr/airmapprime/map/wmts");
          const params = { SERVICE: "WMTS", VERSION: "1.0.0", REQUEST: "GetTile", LAYER: `mapprime:air_${year}`, STYLE: "", TILEMATRIXSET: "NGIS_AIR", TILEMATRIX: z, TILEROW: row, TILECOL: col, FORMAT: "image/jpeg" };
          for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
          const response = await request(url.toString());
          if (!response.ok || !(response.headers.get("content-type") || "").startsWith("image/")) throw Error("tile unavailable");
          bytes = Buffer.from(await response.arrayBuffer());
          // Only cache successfully decoded JPEGs.
        }
        const decoded = await sharp(bytes).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
        if (decoded.info.width !== TILE || decoded.info.height !== TILE || decoded.info.channels !== 3) throw Error("invalid tile");
        try { if (!fs.existsSync(file)) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + "." + process.pid + ".tmp"; fs.writeFileSync(tmp, bytes); fs.renameSync(tmp, file); } } catch { /* cache is optional */ }
        const left = Math.max(x0, col * TILE), right = Math.min(x1, (col + 1) * TILE);
        const top = Math.max(y0, row * TILE), bottom = Math.min(y1, (row + 1) * TILE);
        for (let y = top; y < bottom; y++) {
          const dst = (y - y0) * width + left - x0;
          decoded.data.copy(rgb, dst * 3, ((y - row * TILE) * TILE + left - col * TILE) * 3, ((y - row * TILE) * TILE + right - col * TILE) * 3);
          valid.fill(1, dst, dst + right - left);
        }
      } catch { missing++; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, coords.length) }, worker));
  return { header: { z, x0Px: 0, y0Px: 0, utmkOrigin: [x0 * res - 200000, 4000000 - y0 * res], year, yearFetched, width, height, mPerPx: res, missingTiles: missing, totalTiles: coords.length, rgbBytes: rgb.length, workerMaxRssKb: process.resourceUsage().maxRSS }, rgb, valid };
}

module.exports = { mosaic, resolution, tileAt, levelFor };
if (require.main === module) {
  const input = JSON.parse(process.argv[2]);
  input.key = process.env.NGII_API_KEY;
  mosaic(input).then((result) => {
    if (!result) return;
    const header = Buffer.from(JSON.stringify(result.header));
    const length = Buffer.alloc(4); length.writeUInt32LE(header.length);
    process.stdout.write(length); process.stdout.write(header); process.stdout.write(result.rgb); process.stdout.write(result.valid);
  }).catch(() => { process.exitCode = 1; });
}
