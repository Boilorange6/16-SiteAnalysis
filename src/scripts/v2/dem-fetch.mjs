/**
 * AWS Terrain Tiles(Skadi) SRTM 1 arc-second HGT 수집기.
 * 기본은 전국 48타일이며, 테스트·부분 수집은 --tiles N37E126,N37E127로 제한한다.
 * 이 스크립트는 raw/dem만 쓰고 .cache/v2/data에는 쓰지 않는다.
 */
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const { KOREA_HGT_TILES } = await import("../../lib/v2/ingest/sources/dem.ts");

const args = process.argv.slice(2);
const option = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};

if (args.includes("--help") || args.includes("-h")) {
  console.log("usage: npx tsx src/scripts/v2/dem-fetch.mjs [--raw .cache/v2/raw] [--tiles N37E126,N37E127]");
  process.exit(0);
}

const rawDir = option("--raw", ".cache/v2/raw");
const demDir = join(rawDir, "dem");
const selected = String(option("--tiles", KOREA_HGT_TILES.join(","))).split(",").map((tile) => tile.trim().toUpperCase()).filter(Boolean);
const invalid = selected.filter((tile) => !KOREA_HGT_TILES.includes(tile));
if (invalid.length > 0 || selected.length === 0) {
  console.error(`invalid --tiles; choose from KOREA_HGT_TILES (invalid: ${invalid.join(", ") || "empty"})`);
  process.exit(2);
}

mkdirSync(demDir, { recursive: true });
let skipped = 0;
let downloaded = 0;
let failed = 0;
for (const tile of selected) {
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/skadi/${tile.slice(0, 3)}/${tile}.hgt.gz`;
  const target = join(demDir, `${tile}.hgt.gz`);
  if (existsSync(target)) {
    skipped++;
    console.log(`skip ${basename(target)}`);
    continue;
  }
  const temp = `${target}.part-${process.pid}`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    writeFileSync(temp, Buffer.from(await response.arrayBuffer()), { flag: "wx" });
    renameSync(temp, target);
    downloaded++;
    console.log(`download ${tile}`);
  } catch (error) {
    failed++;
    if (existsSync(temp)) unlinkSync(temp);
    console.error(`failed ${tile}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`DEM fetch: selected ${selected.length} · downloaded ${downloaded} · skipped ${skipped} · failed ${failed}`);
if (failed > 0) process.exitCode = 1;
