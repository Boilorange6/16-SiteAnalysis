/**
 * Korea DEM 수집기. 기본은 Copernicus DEM GLO-30 COG이며, --source hgt로
 * 기존 AWS Terrain Tiles(Skadi) HGT 수집도 유지한다.
 * 이 스크립트는 raw/dem만 쓰고 .cache/v2/data에는 쓰지 않는다.
 */
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const { KOREA_HGT_TILES } = await import("../../lib/v2/ingest/sources/dem.ts");

const args = process.argv.slice(2);
const option = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};

if (args.includes("--help") || args.includes("-h")) {
  console.log("usage: npx tsx src/scripts/v2/dem-fetch.mjs [--source glo30|hgt] [--raw .cache/v2/raw] [--tiles N37E126,N37E127] [--retries 3]");
  process.exit(0);
}

const source = String(option("--source", "glo30")).toLowerCase();
if (source !== "glo30" && source !== "hgt") {
  console.error(`invalid --source ${source}; choose glo30 or hgt`);
  process.exit(2);
}
const retryCount = Number(option("--retries", "3"));
if (!Number.isInteger(retryCount) || retryCount < 0 || retryCount > 10) {
  console.error("invalid --retries; choose an integer from 0 to 10");
  process.exit(2);
}

const rawDir = option("--raw", ".cache/v2/raw");
const demDir = join(rawDir, "dem", source === "glo30" ? "glo30" : "");
const selected = String(option("--tiles", KOREA_HGT_TILES.join(","))).split(",").map((tile) => tile.trim().toUpperCase()).filter(Boolean);
const invalid = selected.filter((tile) => !KOREA_HGT_TILES.includes(tile));
if (invalid.length > 0 || selected.length === 0) {
  console.error(`invalid --tiles; choose from KOREA_HGT_TILES (invalid: ${invalid.join(", ") || "empty"})`);
  process.exit(2);
}

mkdirSync(demDir, { recursive: true });
const startedAt = new Date();
let skipped = 0;
let downloaded = 0;
let missing = 0;
let failed = 0;
let bytes = 0;
const missingTiles = [];
const failedTiles = [];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const glo30Url = (tile) => {
  const match = /^N(\d{2})E(\d{3})$/.exec(tile);
  if (!match) throw new Error(`GLO-30 URL only supports the Korea tile naming contract: ${tile}`);
  const stem = `Copernicus_DSM_COG_10_N${match[1]}_00_E${match[2]}_00_DEM`;
  return `https://copernicus-dem-30m.s3.amazonaws.com/${stem}/${stem}.tif`;
};
const requestUrl = (tile) => source === "glo30"
  ? glo30Url(tile)
  : `https://s3.amazonaws.com/elevation-tiles-prod/skadi/${tile.slice(0, 3)}/${tile}.hgt.gz`;
const targetName = (tile) => source === "glo30"
  ? `Copernicus_DSM_COG_10_${tile.slice(0, 3)}_00_E${tile.slice(4)}_00_DEM.tif`
  : `${tile}.hgt.gz`;

async function download(tile, target) {
  const url = requestUrl(tile);
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      const response = await fetch(url);
      if (response.status === 404) return { kind: "missing", status: response.status };
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const content = Buffer.from(await response.arrayBuffer());
      const temp = `${target}.part-${process.pid}`;
      writeFileSync(temp, content, { flag: "wx" });
      renameSync(temp, target);
      return { kind: "downloaded", bytes: content.length, attempts: attempt + 1 };
    } catch (error) {
      const temp = `${target}.part-${process.pid}`;
      if (existsSync(temp)) unlinkSync(temp);
      if (attempt >= retryCount) return { kind: "failed", error: error instanceof Error ? error.message : String(error), attempts: attempt + 1 };
      await wait(1000 * 2 ** attempt);
    }
  }
  return { kind: "failed", error: "retry loop exhausted", attempts: retryCount + 1 };
}

for (const tile of selected) {
  const target = join(demDir, targetName(tile));
  if (existsSync(target)) {
    skipped++;
    bytes += statSync(target).size;
    console.log(`skip ${basename(target)}`);
    continue;
  }
  const result = await download(tile, target);
  if (result.kind === "downloaded") {
    downloaded++;
    bytes += result.bytes;
    console.log(`download ${tile} (${result.bytes.toLocaleString()} bytes, ${result.attempts} attempt${result.attempts === 1 ? "" : "s"})`);
  } else if (result.kind === "missing") {
    missing++;
    missingTiles.push({ tile, url: requestUrl(tile), status: result.status });
    console.log(`missing ${tile} (HTTP ${result.status}; recorded as ocean/unavailable)`);
  } else {
    failed++;
    failedTiles.push({ tile, url: requestUrl(tile), error: result.error, attempts: result.attempts });
    console.error(`failed ${tile} after ${result.attempts} attempt${result.attempts === 1 ? "" : "s"}: ${result.error}`);
  }
}

const endedAt = new Date();
const report = {
  source,
  selected,
  downloaded,
  skipped,
  missing,
  failed,
  bytes,
  startedAt: startedAt.toISOString(),
  endedAt: endedAt.toISOString(),
  elapsedMs: endedAt.getTime() - startedAt.getTime(),
  missingTiles,
  failedTiles,
};
writeFileSync(join(demDir, "fetch-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`DEM fetch (${source}): selected ${selected.length} · downloaded ${downloaded} · skipped ${skipped} · missing ${missing} · failed ${failed} · bytes ${bytes}`);
console.log(`recorded ${join(demDir, "fetch-report.json")}`);
if (failed > 0) process.exitCode = 1;
