/**
 * SRTM HGT를 행 단위 BLOB으로 보관하고 조회하는 최소 DEM 계약.
 * HGT의 row 0은 북쪽, 각 표본은 big-endian signed int16(m)이다.
 */
import { basename } from "node:path";
import type BetterSqlite3 from "better-sqlite3";

type Db = BetterSqlite3.Database;

export const DEM_SOURCE_ID = "terrain_tiles";
export const DEM_NODATA = -32768;
const HGT_SIDE = 3601;
const HGT_CELL_DEG = 1 / 3600;

export interface DemTileMeta {
  tile: string;
  lat0: number;
  lon0: number;
  rows: number;
  cols: number;
  cellDeg: number;
  nodata: number;
  vertical: "EGM96";
  resolutionM: number;
}

function signedCoordinate(prefix: string, digits: string): number {
  const value = Number(digits);
  return prefix === "S" || prefix === "W" ? -value : value;
}

/** `N37E127` 또는 `.hgt(.gz)` 확장자가 붙은 이름을 HGT 타일 메타로 바꾼다. */
export function hgtMeta(name: string): DemTileMeta {
  const file = basename(name).replace(/\.hgt(?:\.gz)?$/i, "");
  const match = /^([NS])(\d{2})([EW])(\d{3})$/i.exec(file);
  if (!match) throw new Error(`invalid HGT tile name: ${name}`);
  const ns = match[1].toUpperCase();
  const ew = match[3].toUpperCase();
  const lat0 = signedCoordinate(ns, match[2]);
  const lon0 = signedCoordinate(ew, match[4]);
  if (lat0 < -90 || lat0 >= 90 || lon0 < -180 || lon0 >= 180) throw new RangeError(`HGT tile coordinate out of range: ${name}`);
  return {
    tile: `${ns}${match[2]}${ew}${match[4]}`,
    lat0,
    lon0,
    rows: HGT_SIDE,
    cols: HGT_SIDE,
    cellDeg: HGT_CELL_DEG,
    nodata: DEM_NODATA,
    vertical: "EGM96",
    resolutionM: 30,
  };
}

function validateMeta(meta: DemTileMeta): void {
  if (!meta.tile || !Number.isInteger(meta.rows) || meta.rows < 2 || !Number.isInteger(meta.cols) || meta.cols < 2) throw new RangeError(`invalid DEM dimensions for ${meta.tile}`);
  if (![meta.lat0, meta.lon0, meta.cellDeg, meta.nodata, meta.resolutionM].every(Number.isFinite) || meta.cellDeg <= 0 || meta.resolutionM <= 0) {
    throw new RangeError(`invalid DEM metadata for ${meta.tile}`);
  }
  if (meta.vertical !== "EGM96") throw new Error(`unsupported DEM vertical datum for ${meta.tile}: ${meta.vertical}`);
}

/** 타일 메타와 각 북쪽→남쪽 행을 한 트랜잭션에 넣는다. */
export function insertDemTile(db: Db, meta: DemTileMeta, releaseId: string, rows: Iterable<{ row: number; data: Buffer }>): void {
  validateMeta(meta);
  const insertRow = db.prepare("INSERT INTO dem_row (tile, row, data) VALUES (?, ?, ?)");
  db.transaction(() => {
    db.prepare("DELETE FROM dem_row WHERE tile = ?").run(meta.tile);
    db.prepare(`INSERT INTO dem_tile (tile, lat0, lon0, rows, cols, cell_deg, nodata, vertical, resolution_m, release_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tile) DO UPDATE SET lat0=excluded.lat0, lon0=excluded.lon0, rows=excluded.rows, cols=excluded.cols,
        cell_deg=excluded.cell_deg, nodata=excluded.nodata, vertical=excluded.vertical, resolution_m=excluded.resolution_m,
        release_id=excluded.release_id`).run(
      meta.tile, meta.lat0, meta.lon0, meta.rows, meta.cols, meta.cellDeg, meta.nodata, meta.vertical, meta.resolutionM, releaseId,
    );
    const seen = new Set<number>();
    for (const item of rows) {
      if (!Number.isInteger(item.row) || item.row < 0 || item.row >= meta.rows) throw new RangeError(`DEM row out of range for ${meta.tile}: ${item.row}`);
      if (!Buffer.isBuffer(item.data) || item.data.length !== meta.cols * 2) throw new RangeError(`DEM row ${item.row} has ${item.data?.length ?? 0} bytes; expected ${meta.cols * 2}`);
      if (seen.has(item.row)) throw new Error(`duplicate DEM row ${item.row} for ${meta.tile}`);
      seen.add(item.row);
      insertRow.run(meta.tile, item.row, item.data);
    }
    if (seen.size !== meta.rows) throw new Error(`DEM tile ${meta.tile} has ${seen.size} rows; expected ${meta.rows}`);
  })();
}

interface TileRow {
  tile: string;
  lat0: number;
  lon0: number;
  rows: number;
  cols: number;
  cell_deg: number;
  nodata: number;
}

interface Tile extends TileRow {
  cellDeg: number;
}

/** DEM 타일을 메모리에 인덱싱하고 행만 필요할 때 읽는 조회기. */
export class DemReader {
  private readonly tiles = new Map<string, Tile>();
  private readonly rows = new Map<string, Int16Array | null>();
  private readonly rowQuery;

  constructor(private readonly db: Db) {
    const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'dem_tile'").get();
    if (table) {
      const records = db.prepare("SELECT tile, lat0, lon0, rows, cols, cell_deg, nodata FROM dem_tile").all() as TileRow[];
      for (const record of records) {
        const tile = { ...record, cellDeg: record.cell_deg };
        validateMeta({ ...tile, cellDeg: tile.cellDeg, vertical: "EGM96", resolutionM: 30 });
        this.tiles.set(`${record.lat0}:${record.lon0}`, tile);
      }
    }
    this.rowQuery = db.prepare("SELECT data FROM dem_row WHERE tile = ? AND row = ?");
  }

  ready(): boolean {
    return this.tiles.size > 0;
  }

  private tileFor(lng: number, lat: number): Tile | null {
    // 보통은 1도 타일이지만 fixture·후속 원천이 더 작은 격자를 쓸 수 있어
    // 정수 경위도 키로 가정하지 않고 메모리의 메타 범위를 직접 확인한다.
    for (const tile of this.tiles.values()) {
      if (lng >= tile.lon0 && lng <= tile.lon0 + (tile.cols - 1) * tile.cellDeg && lat >= tile.lat0 && lat <= tile.lat0 + (tile.rows - 1) * tile.cellDeg) return tile;
    }
    return null;
  }

  private row(tile: Tile, row: number): Int16Array | null {
    const key = `${tile.tile}:${row}`;
    if (this.rows.has(key)) return this.rows.get(key) ?? null;
    const found = this.rowQuery.get(tile.tile, row) as { data?: Buffer } | undefined;
    if (!found?.data || found.data.length !== tile.cols * 2) {
      this.rows.set(key, null);
      return null;
    }
    const values = new Int16Array(tile.cols);
    for (let col = 0; col < tile.cols; col++) values[col] = found.data.readInt16BE(col * 2);
    this.rows.set(key, values);
    return values;
  }

  private value(tile: Tile, row: number, col: number): number | null {
    const values = this.row(tile, row);
    if (!values) return null;
    const value = values[col];
    return value === tile.nodata ? null : value;
  }

  /** 타일 밖 또는 nodata 이웃이 있으면 null, 그 외에는 위·아래 네 표본의 쌍선형 보간값. */
  elevation(lng: number, lat: number): number | null {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    const tile = this.tileFor(lng, lat);
    if (!tile) return null;
    const colF = (lng - tile.lon0) / tile.cellDeg;
    const rowF = (tile.lat0 + (tile.rows - 1) * tile.cellDeg - lat) / tile.cellDeg;
    if (colF < 0 || rowF < 0 || colF > tile.cols - 1 || rowF > tile.rows - 1) return null;
    const col0 = Math.min(tile.cols - 1, Math.floor(colF));
    const row0 = Math.min(tile.rows - 1, Math.floor(rowF));
    const col1 = Math.min(tile.cols - 1, col0 + 1);
    const row1 = Math.min(tile.rows - 1, row0 + 1);
    const a = this.value(tile, row0, col0);
    const b = this.value(tile, row0, col1);
    const c = this.value(tile, row1, col0);
    const d = this.value(tile, row1, col1);
    if (a === null || b === null || c === null || d === null) return null;
    const tx = colF - col0;
    const ty = rowF - row0;
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  }
}
