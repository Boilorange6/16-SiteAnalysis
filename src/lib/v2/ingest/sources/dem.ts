/** AWS Terrain Tiles(Skadi) HGT 파일을 terrain.sqlite에 적재한다. */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { gunzipSync } from "node:zlib";
import type BetterSqlite3 from "better-sqlite3";
import { DEM_NODATA, DEM_SOURCE_ID, hgtMeta, insertDemTile } from "../../data/terrain";
import { SourceStats } from "../build";

type Db = BetterSqlite3.Database;

const HGT_BYTES = 3601 * 3601 * 2;

export const KOREA_HGT_TILES: readonly string[] = Object.freeze(
  Array.from({ length: 6 }, (_, lat) => Array.from({ length: 8 }, (_, lon) => `N${String(33 + lat).padStart(2, "0")}E${String(124 + lon).padStart(3, "0")}`)).flat(),
);

function isHgt(file: string): boolean {
  return /\.hgt(?:\.gz)?$/i.test(file);
}

/** `.hgt` 또는 `.hgt.gz` 파일을 읽어 타일별 행 BLOB으로 적재한다. */
export async function buildDemTiles(db: Db, files: string[], releaseId: string): Promise<SourceStats> {
  const stats = new SourceStats(DEM_SOURCE_ID, releaseId, ["vertical", "resolutionM"]);
  stats.expectedRegions = [...KOREA_HGT_TILES];
  const seen = new Set<string>();
  for (const file of [...files].filter(isHgt).sort()) {
    stats.read();
    const meta = hgtMeta(basename(file));
    if (!KOREA_HGT_TILES.includes(meta.tile)) throw new Error(`HGT tile outside Korea coverage: ${meta.tile}`);
    if (seen.has(meta.tile)) throw new Error(`duplicate HGT tile: ${meta.tile}`);
    seen.add(meta.tile);
    const compressed = await readFile(file);
    const content = file.toLowerCase().endsWith(".gz") ? gunzipSync(compressed) : compressed;
    if (content.length !== HGT_BYTES) throw new Error(`${basename(file)} has ${content.length} bytes; expected ${HGT_BYTES}`);
    const rows = Array.from({ length: meta.rows }, (_, row) => ({ row, data: content.subarray(row * meta.cols * 2, (row + 1) * meta.cols * 2) }));
    insertDemTile(db, { ...meta, nodata: DEM_NODATA }, releaseId, rows);
    stats.accept({ tile: meta.tile, vertical: meta.vertical, resolutionM: meta.resolutionM }, meta.tile, "hgt");
  }
  return stats;
}
