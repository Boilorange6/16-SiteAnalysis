/** 앱 DB의 타일별 압축 래스터 저장소. 결과 계약에는 메타데이터만 넣는다. */
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import type BetterSqlite3 from "better-sqlite3";
import { RasterRefSchema, type RasterRef } from "./tile-result";

type Db = BetterSqlite3.Database;
type RasterValues = Uint8Array | Uint16Array | Int16Array;

export const MAX_RASTER_BYTES = 8 * 1024 * 1024;
export const MAX_TILE_RASTER_BYTES = 32 * 1024 * 1024;

export interface RasterData {
  ref: Omit<RasterRef, "bytes" | "sha256">;
  values: RasterValues;
}

const byteLengthFor = (dtype: RasterRef["dtype"]) => (dtype === "u16" || dtype === "i16" ? 2 : 1);

function rawBuffer(r: RasterData): Buffer {
  const expected = r.ref.cols * r.ref.rows * r.ref.bands;
  if (r.values.length !== expected) throw new Error(`RASTER_LENGTH_MISMATCH: ${r.ref.name} expected ${expected}, got ${r.values.length}`);
  if (r.ref.dtype === "u8" || r.ref.dtype === "bits") {
    if (!(r.values instanceof Uint8Array) || r.values instanceof Uint16Array || r.values instanceof Int16Array) {
      throw new Error(`RASTER_DTYPE_MISMATCH: ${r.ref.name} needs Uint8Array`);
    }
  } else if (r.ref.dtype === "u16") {
    if (!(r.values instanceof Uint16Array)) throw new Error(`RASTER_DTYPE_MISMATCH: ${r.ref.name} needs Uint16Array`);
  } else if (!(r.values instanceof Int16Array)) {
    throw new Error(`RASTER_DTYPE_MISMATCH: ${r.ref.name} needs Int16Array`);
  }
  const rawBytes = expected * byteLengthFor(r.ref.dtype);
  if (r.values.byteLength !== rawBytes) throw new Error(`RASTER_BYTE_LENGTH_MISMATCH: ${r.ref.name}`);
  return Buffer.from(r.values.buffer, r.values.byteOffset, r.values.byteLength);
}

export function encodeRaster(r: RasterData): { ref: RasterRef; blob: Buffer } {
  const parsed = RasterRefSchema.omit({ bytes: true, sha256: true }).parse(r.ref);
  const blob = deflateRawSync(rawBuffer({ ref: parsed, values: r.values }));
  if (blob.length === 0 || blob.length > MAX_RASTER_BYTES) throw new Error(`RASTER_TOO_LARGE: ${parsed.name} ${blob.length} bytes`);
  const sha256 = createHash("sha256").update(blob).digest("hex");
  return { ref: RasterRefSchema.parse({ ...parsed, bytes: blob.length, sha256 }), blob };
}

function ensureRasterTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tile_raster (
      cache_key TEXT NOT NULL,
      name TEXT NOT NULL,
      meta_json TEXT NOT NULL,
      data BLOB NOT NULL,
      PRIMARY KEY (cache_key, name)
    );
  `);
}

function validateBlob(ref: RasterRef, blob: Buffer): void {
  if (ref.bytes !== blob.length) throw new Error(`RASTER_SIZE_MISMATCH: ${ref.name}`);
  const sha256 = createHash("sha256").update(blob).digest("hex");
  if (ref.sha256 !== sha256) throw new Error(`RASTER_SHA256_MISMATCH: ${ref.name}`);
}

export function saveTileRasters(db: Db, cacheKey: string, items: Array<{ ref: RasterRef; blob: Buffer }>): void {
  ensureRasterTable(db);
  const seen = new Set<string>();
  let total = 0;
  for (const item of items) {
    const ref = RasterRefSchema.parse(item.ref);
    if (seen.has(ref.name)) throw new Error(`DUPLICATE_RASTER: ${ref.name}`);
    seen.add(ref.name);
    if (item.blob.length === 0 || item.blob.length > MAX_RASTER_BYTES) throw new Error(`RASTER_TOO_LARGE: ${ref.name} ${item.blob.length} bytes`);
    validateBlob(ref, item.blob);
    total += item.blob.length;
  }
  if (total > MAX_TILE_RASTER_BYTES) throw new Error(`TILE_RASTERS_TOO_LARGE: ${total} bytes`);
  const insert = db.prepare(`
    INSERT INTO tile_raster (cache_key, name, meta_json, data) VALUES (?, ?, ?, ?)
    ON CONFLICT(cache_key, name) DO UPDATE SET meta_json = excluded.meta_json, data = excluded.data
  `);
  const write = db.transaction((rows: Array<{ ref: RasterRef; blob: Buffer }>) => {
    for (const row of rows) insert.run(cacheKey, row.ref.name, JSON.stringify(row.ref), row.blob);
  });
  write(items.map((item) => ({ ref: RasterRefSchema.parse(item.ref), blob: item.blob })));
}

type RasterRow = { meta_json: string; data: Buffer };

export function loadTileRaster(db: Db, cacheKey: string, name: string): { ref: RasterRef; blob: Buffer } | null {
  ensureRasterTable(db);
  const row = db.prepare("SELECT meta_json, data FROM tile_raster WHERE cache_key = ? AND name = ?").get(cacheKey, name) as RasterRow | undefined;
  if (!row) return null;
  const ref = RasterRefSchema.parse(JSON.parse(row.meta_json));
  const blob = Buffer.from(row.data);
  validateBlob(ref, blob);
  return { ref, blob };
}
