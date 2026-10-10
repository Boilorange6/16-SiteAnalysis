/** HGT와 Copernicus DEM GLO-30 COG를 terrain.sqlite 행 BLOB으로 적재한다. */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { gunzipSync } from "node:zlib";
import { fromFile } from "geotiff";
import type BetterSqlite3 from "better-sqlite3";
import {
  DEM_NODATA,
  DEM_SOURCE_ID,
  GLO30_NODATA,
  hgtMeta,
  insertDemTile,
  type DemTileMeta,
} from "../../data/terrain";
import { SourceStats } from "../build";

type Db = BetterSqlite3.Database;

const HGT_BYTES = 3601 * 3601 * 2;

export const KOREA_HGT_TILES: readonly string[] = Object.freeze(
  Array.from({ length: 6 }, (_, lat) => Array.from({ length: 8 }, (_, lon) => `N${String(33 + lat).padStart(2, "0")}E${String(124 + lon).padStart(3, "0")}`)).flat(),
);
export const KOREA_GLO30_TILES = KOREA_HGT_TILES;

type GeoTiffImage = {
  getWidth(): number;
  getHeight(): number;
  getBoundingBox(): number[];
  getResolution(): number[];
  getOrigin(): number[];
  getGDALNoData(): number | null;
  pixelIsArea(): boolean;
  getGeoKeys(): Record<string, unknown> | null;
  readRasters(options: { samples: number[]; interleave: false }): Promise<unknown[]>;
};

function isHgt(file: string): boolean {
  return /\.hgt(?:\.gz)?$/i.test(file);
}

function isGlo30(file: string): boolean {
  return /\.tif(?:f)?$/i.test(file);
}

function parseGlo30Tile(name: string): { tile: string; lat0: number; lon0: number } {
  const file = basename(name);
  const match = /^Copernicus_DSM_COG_10_([NS])(\d{2})_00_([EW])(\d{3})_00_DEM\.tiff?$/i.exec(file);
  if (!match) throw new Error(`invalid GLO-30 tile name: ${name}`);
  const ns = match[1].toUpperCase();
  const ew = match[3].toUpperCase();
  const lat0 = (ns === "S" ? -1 : 1) * Number(match[2]);
  const lon0 = (ew === "W" ? -1 : 1) * Number(match[4]);
  if (lat0 < -90 || lat0 >= 90 || lon0 < -180 || lon0 >= 180) throw new RangeError(`GLO-30 tile coordinate out of range: ${name}`);
  return { tile: `${ns}${match[2]}${ew}${match[4]}`, lat0, lon0 };
}

/**
 * Build metadata from the actual first-image dimensions and georeferencing.
 * GLO-30 is normally 3600×3600, but the reader deliberately retains the
 * width/height reported by the image instead of assuming a square raster.
 */
export function glo30Meta(name: string, image: GeoTiffImage): DemTileMeta {
  const named = parseGlo30Tile(name);
  const width = image.getWidth();
  const height = image.getHeight();
  const bbox = image.getBoundingBox();
  const resolution = image.getResolution();
  if (!Number.isInteger(width) || width < 2 || !Number.isInteger(height) || height < 2) throw new Error(`${basename(name)} has invalid raster dimensions ${width}x${height}`);
  if (bbox.length < 4 || !bbox.slice(0, 4).every(Number.isFinite)) throw new Error(`${basename(name)} has invalid GeoTIFF bounding box`);
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const extentLng = maxLng - minLng;
  const extentLat = maxLat - minLat;
  if (!(extentLng > 0) || !(extentLat > 0)) throw new Error(`${basename(name)} has invalid GeoTIFF extent ${bbox.slice(0, 4).join(",")}`);
  const cellLonDeg = Math.abs(resolution[0] ?? 0) || extentLng / width;
  const cellLatDeg = Math.abs(resolution[1] ?? 0) || extentLat / height;
  if (!(cellLonDeg > 0) || !(cellLatDeg > 0)) throw new Error(`${basename(name)} has invalid GeoTIFF resolution`);
  const coordinateTolerance = Math.max(cellLonDeg, cellLatDeg) * 2;
  if (Math.abs(minLng - named.lon0) > coordinateTolerance || Math.abs(minLat - named.lat0) > coordinateTolerance) {
    throw new Error(`${basename(name)} georeference ${bbox.slice(0, 4).join(",")} does not match ${named.tile}`);
  }
  const noData = image.getGDALNoData();
  const geoKeys = image.getGeoKeys();
  const geographicType = geoKeys?.GeographicTypeGeoKey;
  if (geographicType !== undefined && geographicType !== 4326) throw new Error(`${basename(name)} is not EPSG:4326 (GeographicTypeGeoKey=${String(geographicType)})`);
  const gridModel = image.pixelIsArea() ? "area" : "point";
  const origin = image.getOrigin();
  const lon0 = gridModel === "area" ? minLng : origin[0];
  const lat0 = gridModel === "area" ? minLat : origin[1] - (height - 1) * cellLatDeg;
  if (!Number.isFinite(lon0) || !Number.isFinite(lat0)) throw new Error(`${basename(name)} has invalid GeoTIFF origin`);
  return {
    tile: named.tile,
    lat0,
    lon0,
    rows: height,
    cols: width,
    cellDeg: cellLatDeg,
    cellLonDeg,
    cellLatDeg,
    nodata: Number.isFinite(noData) ? noData as number : GLO30_NODATA,
    vertical: "EGM2008",
    resolutionM: 30,
    sampleFormat: "float32le",
    gridModel,
  };
}

function hgtRows(content: Buffer, cols: number, rows: number): Iterable<{ row: number; data: Buffer }> {
  return Array.from({ length: rows }, (_, row) => ({ row, data: content.subarray(row * cols * 2, (row + 1) * cols * 2) }));
}

function floatRows(values: ArrayLike<number>, width: number, height: number): Iterable<{ row: number; data: Buffer }> {
  function* rows(): IterableIterator<{ row: number; data: Buffer }> {
    const typed = values instanceof Float32Array ? values : null;
    for (let row = 0; row < height; row++) {
      if (typed) {
        const offset = row * width * Float32Array.BYTES_PER_ELEMENT;
        yield { row, data: Buffer.from(typed.buffer as ArrayBuffer, typed.byteOffset + offset, width * Float32Array.BYTES_PER_ELEMENT) };
        continue;
      }
      const data = Buffer.alloc(width * Float32Array.BYTES_PER_ELEMENT);
      for (let col = 0; col < width; col++) data.writeFloatLE(Number(values[row * width + col]), col * Float32Array.BYTES_PER_ELEMENT);
      yield { row, data };
    }
  }
  return rows();
}

/** `.hgt` 또는 `.hgt.gz` 파일을 읽어 타일별 행 BLOB으로 적재한다. */
export async function buildHgtTiles(db: Db, files: string[], releaseId: string): Promise<SourceStats> {
  const stats = new SourceStats(DEM_SOURCE_ID, releaseId, ["vertical", "resolutionM", "sampleFormat"]);
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
    insertDemTile(db, { ...meta, nodata: DEM_NODATA }, releaseId, hgtRows(content, meta.cols, meta.rows));
    stats.accept({ tile: meta.tile, vertical: meta.vertical, resolutionM: meta.resolutionM, sampleFormat: "int16be" }, meta.tile, "hgt");
  }
  return stats;
}

/** Copernicus GLO-30 COG를 geotiff로 읽어 Float32 행 BLOB으로 적재한다. */
export async function buildGlo30Tiles(db: Db, files: string[], releaseId: string): Promise<SourceStats> {
  const gloFiles = [...files].filter(isGlo30).sort();
  const stats = new SourceStats(DEM_SOURCE_ID, releaseId, ["vertical", "resolutionM", "sampleFormat"]);
  // Fetch can record ocean-only 404s, so the quality gate expects every tile
  // that is actually present rather than inventing a zero-elevation tile.
  stats.expectedRegions = gloFiles.map((file) => parseGlo30Tile(file).tile);
  const seen = new Set<string>();
  for (const file of gloFiles) {
    stats.read();
    const tiff = await fromFile(file);
    try {
      const image = await tiff.getImage() as unknown as GeoTiffImage;
      const meta = glo30Meta(file, image);
      if (!KOREA_GLO30_TILES.includes(meta.tile)) throw new Error(`GLO-30 tile outside Korea coverage: ${meta.tile}`);
      if (seen.has(meta.tile)) throw new Error(`duplicate GLO-30 tile: ${meta.tile}`);
      seen.add(meta.tile);
      const raster = await image.readRasters({ samples: [0], interleave: false });
      const values = raster[0] as ArrayLike<number> | undefined;
      if (!values || values.length !== meta.rows * meta.cols) throw new Error(`${basename(file)} raster has ${values?.length ?? 0} samples; expected ${meta.rows * meta.cols}`);
      insertDemTile(db, meta, releaseId, floatRows(values, meta.cols, meta.rows));
      stats.accept({ tile: meta.tile, vertical: meta.vertical, resolutionM: meta.resolutionM, sampleFormat: meta.sampleFormat }, meta.tile, "glo30");
      console.log(`GLO-30 ${meta.tile}: ${meta.cols}x${meta.rows} ${meta.gridModel}`);
    } finally {
      await tiff.close();
    }
  }
  return stats;
}

/** Dispatch the legacy HGT or the new GLO-30 files without changing the DB contract. */
export async function buildDemTiles(db: Db, files: string[], releaseId: string): Promise<SourceStats> {
  const gloFiles = files.filter(isGlo30);
  const hgtFiles = files.filter(isHgt);
  if (gloFiles.length > 0 && hgtFiles.length > 0) throw new Error("DEM input mixes GLO-30 GeoTIFF and HGT files");
  if (gloFiles.length > 0) return buildGlo30Tiles(db, gloFiles, releaseId);
  return buildHgtTiles(db, hgtFiles, releaseId);
}
