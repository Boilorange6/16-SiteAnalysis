/**
 * DEM 타일을 행 단위 BLOB으로 보관하고 조회하는 계약.
 *
 * HGT는 int16 big-endian 표본점 격자이고, Copernicus GLO-30은 Float32
 * GeoTIFF 픽셀 격자다. 두 형식 모두 dem_row의 행 BLOB을 사용하되 행의
 * 실제 폭·높이와 표본 형식·픽셀 모델을 dem_tile에 함께 기록한다.
 */
import { basename } from "node:path";
import type BetterSqlite3 from "better-sqlite3";

type Db = BetterSqlite3.Database;

export const DEM_SOURCE_ID = "terrain_tiles";
export const DEM_NODATA = -32768;
export const GLO30_NODATA = -9999;
export const GLO30_PROVIDER = "Copernicus DEM GLO-30";
export const GLO30_SOURCE_URL = "https://copernicus-dem-30m.s3.amazonaws.com/";
export const GLO30_RIGHTS = "Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved";

export type DemVertical = "EGM96" | "EGM2008";
export type DemSampleFormat = "int16be" | "float32le";
export type DemGridModel = "point" | "area";

export interface DemTileMeta {
  tile: string;
  lat0: number;
  lon0: number;
  /** Raster height. This is independent from cols; GLO-30 metadata is not assumed square. */
  rows: number;
  /** Raster width. This is read from the GeoTIFF image rather than assumed to be 3600. */
  cols: number;
  /** Backward-compatible nominal angular cell size. */
  cellDeg: number;
  /** Optional independent longitude/latitude spacing for rectangular rasters. */
  cellLonDeg?: number;
  cellLatDeg?: number;
  nodata: number;
  vertical: DemVertical;
  resolutionM: number;
  sampleFormat?: DemSampleFormat;
  gridModel?: DemGridModel;
}

interface NormalizedDemTileMeta extends DemTileMeta {
  cellLonDeg: number;
  cellLatDeg: number;
  sampleFormat: DemSampleFormat;
  gridModel: DemGridModel;
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
    rows: 3601,
    cols: 3601,
    cellDeg: 1 / 3600,
    nodata: DEM_NODATA,
    vertical: "EGM96",
    resolutionM: 30,
  };
}

function normalizeMeta(meta: DemTileMeta): NormalizedDemTileMeta {
  return {
    ...meta,
    cellLonDeg: meta.cellLonDeg ?? meta.cellDeg,
    cellLatDeg: meta.cellLatDeg ?? meta.cellDeg,
    sampleFormat: meta.sampleFormat ?? "int16be",
    gridModel: meta.gridModel ?? "point",
  };
}

function validateMeta(meta: DemTileMeta): asserts meta is NormalizedDemTileMeta {
  const normalized = normalizeMeta(meta);
  if (!normalized.tile || !Number.isInteger(normalized.rows) || normalized.rows < 2 || !Number.isInteger(normalized.cols) || normalized.cols < 2) {
    throw new RangeError(`invalid DEM dimensions for ${normalized.tile}`);
  }
  if (![normalized.lat0, normalized.lon0, normalized.cellDeg, normalized.cellLonDeg, normalized.cellLatDeg, normalized.nodata, normalized.resolutionM]
    .every(Number.isFinite) || normalized.cellDeg <= 0 || normalized.cellLonDeg <= 0 || normalized.cellLatDeg <= 0 || normalized.resolutionM <= 0) {
    throw new RangeError(`invalid DEM metadata for ${normalized.tile}`);
  }
  if (normalized.vertical !== "EGM96" && normalized.vertical !== "EGM2008") {
    throw new Error(`unsupported DEM vertical datum for ${normalized.tile}: ${normalized.vertical}`);
  }
  if (normalized.sampleFormat !== "int16be" && normalized.sampleFormat !== "float32le") {
    throw new Error(`unsupported DEM sample format for ${normalized.tile}: ${normalized.sampleFormat}`);
  }
  if (normalized.gridModel !== "point" && normalized.gridModel !== "area") {
    throw new Error(`unsupported DEM grid model for ${normalized.tile}: ${normalized.gridModel}`);
  }
  Object.assign(meta, normalized);
}

function sampleBytes(format: DemSampleFormat): number {
  return format === "float32le" ? 4 : 2;
}

/** 타일 메타와 각 북쪽→남쪽 행을 한 트랜잭션에 넣는다. */
export function insertDemTile(db: Db, input: DemTileMeta, releaseId: string, rows: Iterable<{ row: number; data: Buffer }>): void {
  const meta = normalizeMeta(input);
  validateMeta(meta);
  const insertRow = db.prepare("INSERT INTO dem_row (tile, row, data) VALUES (?, ?, ?)");
  db.transaction(() => {
    db.prepare("DELETE FROM dem_row WHERE tile = ?").run(meta.tile);
    db.prepare(`INSERT INTO dem_tile (tile, lat0, lon0, rows, cols, cell_deg, cell_lon_deg, cell_lat_deg, nodata, vertical, sample_format, grid_model, resolution_m, release_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tile) DO UPDATE SET lat0=excluded.lat0, lon0=excluded.lon0, rows=excluded.rows, cols=excluded.cols,
        cell_deg=excluded.cell_deg, cell_lon_deg=excluded.cell_lon_deg, cell_lat_deg=excluded.cell_lat_deg,
        nodata=excluded.nodata, vertical=excluded.vertical, sample_format=excluded.sample_format,
        grid_model=excluded.grid_model, resolution_m=excluded.resolution_m, release_id=excluded.release_id`).run(
      meta.tile, meta.lat0, meta.lon0, meta.rows, meta.cols, meta.cellDeg, meta.cellLonDeg, meta.cellLatDeg,
      meta.nodata, meta.vertical, meta.sampleFormat, meta.gridModel, meta.resolutionM, releaseId,
    );
    const seen = new Set<number>();
    const expectedBytes = meta.cols * sampleBytes(meta.sampleFormat);
    for (const item of rows) {
      if (!Number.isInteger(item.row) || item.row < 0 || item.row >= meta.rows) throw new RangeError(`DEM row out of range for ${meta.tile}: ${item.row}`);
      if (!Buffer.isBuffer(item.data) || item.data.length !== expectedBytes) throw new RangeError(`DEM row ${item.row} has ${item.data?.length ?? 0} bytes; expected ${expectedBytes}`);
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
  cell_lon_deg: number | null;
  cell_lat_deg: number | null;
  nodata: number;
  vertical: string;
  sample_format: string | null;
  grid_model: string | null;
  resolution_m: number;
}

type Tile = NormalizedDemTileMeta;

/** DEM 타일을 메모리에 인덱싱하고 행만 필요할 때 읽는 조회기. */
export class DemReader {
  private readonly tiles = new Map<string, Tile>();
  private readonly rows = new Map<string, Int16Array | Float32Array | null>();
  private readonly rowQuery;

  constructor(private readonly db: Db) {
    const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'dem_tile'").get();
    if (table) {
      const columns = new Set((db.prepare("PRAGMA table_info(dem_tile)").all() as Array<{ name: string }>).map((column) => column.name));
      const optional = (name: string, fallback: string) => columns.has(name) ? name : `${fallback} AS ${name}`;
      const records = db.prepare(`SELECT tile, lat0, lon0, rows, cols, cell_deg,
        ${optional("cell_lon_deg", "NULL")}, ${optional("cell_lat_deg", "NULL")}, nodata, vertical,
        ${optional("sample_format", "'int16be'")}, ${optional("grid_model", "'point'")}, resolution_m
        FROM dem_tile`).all() as TileRow[];
      for (const record of records) {
        const tile = normalizeMeta({
          tile: record.tile,
          lat0: record.lat0,
          lon0: record.lon0,
          rows: record.rows,
          cols: record.cols,
          cellDeg: record.cell_deg,
          cellLonDeg: record.cell_lon_deg ?? undefined,
          cellLatDeg: record.cell_lat_deg ?? undefined,
          nodata: record.nodata,
          vertical: record.vertical as DemVertical,
          sampleFormat: record.sample_format as DemSampleFormat | undefined,
          gridModel: record.grid_model as DemGridModel | undefined,
          resolutionM: record.resolution_m,
        });
        validateMeta(tile);
        this.tiles.set(`${record.lat0}:${record.lon0}`, tile);
      }
    }
    this.rowQuery = db.prepare("SELECT data FROM dem_row WHERE tile = ? AND row = ?");
  }

  ready(): boolean {
    return this.tiles.size > 0;
  }

  /** A scene/export can retain the datum actually present in the published file. */
  verticalDatum(): DemVertical | null {
    const values = new Set([...this.tiles.values()].map((tile) => tile.vertical));
    return values.size === 1 ? [...values][0] : null;
  }

  resolution(): number | null {
    const values = new Set([...this.tiles.values()].map((tile) => tile.resolutionM));
    return values.size === 1 ? [...values][0] : null;
  }

  private tileFor(lng: number, lat: number): Tile | null {
    // A GLO-30 image may have a width different from its height. Use the
    // stored x/y spacing and image dimensions independently.
    for (const tile of this.tiles.values()) {
      const maxLng = tile.lon0 + (tile.gridModel === "area" ? tile.cols * tile.cellLonDeg : (tile.cols - 1) * tile.cellLonDeg);
      const maxLat = tile.lat0 + (tile.gridModel === "area" ? tile.rows * tile.cellLatDeg : (tile.rows - 1) * tile.cellLatDeg);
      if (lng >= tile.lon0 && lng <= maxLng && lat >= tile.lat0 && lat <= maxLat) return tile;
    }
    return null;
  }

  private row(tile: Tile, row: number): Int16Array | Float32Array | null {
    const key = `${tile.tile}:${row}`;
    if (this.rows.has(key)) return this.rows.get(key) ?? null;
    const found = this.rowQuery.get(tile.tile, row) as { data?: Buffer } | undefined;
    const expectedBytes = tile.cols * sampleBytes(tile.sampleFormat);
    if (!found?.data || found.data.length !== expectedBytes) {
      this.rows.set(key, null);
      return null;
    }
    if (tile.sampleFormat === "float32le") {
      const values = new Float32Array(tile.cols);
      for (let col = 0; col < tile.cols; col++) values[col] = found.data.readFloatLE(col * 4);
      this.rows.set(key, values);
      return values;
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
    return !Number.isFinite(value) || value === tile.nodata ? null : value;
  }

  /** 타일 밖 또는 nodata 이웃이 있으면 null, 그 외에는 네 표본의 쌍선형 보간값. */
  elevation(lng: number, lat: number): number | null {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    const tile = this.tileFor(lng, lat);
    if (!tile) return null;

    const colRaw = (lng - tile.lon0) / tile.cellLonDeg;
    const rowRaw = (tile.lat0 + (tile.gridModel === "area" ? tile.rows * tile.cellLatDeg : (tile.rows - 1) * tile.cellLatDeg) - lat) / tile.cellLatDeg;
    const colF = tile.gridModel === "area" ? colRaw - 0.5 : colRaw;
    const rowF = tile.gridModel === "area" ? rowRaw - 0.5 : rowRaw;
    if (colRaw < 0 || rowRaw < 0 || colRaw > (tile.gridModel === "area" ? tile.cols : tile.cols - 1) || rowRaw > (tile.gridModel === "area" ? tile.rows : tile.rows - 1)) return null;

    const boundedCol = Math.max(0, Math.min(tile.cols - 1, colF));
    const boundedRow = Math.max(0, Math.min(tile.rows - 1, rowF));
    const col0 = Math.floor(boundedCol);
    const row0 = Math.floor(boundedRow);
    const col1 = Math.min(tile.cols - 1, col0 + 1);
    const row1 = Math.min(tile.rows - 1, row0 + 1);
    const a = this.value(tile, row0, col0);
    const b = this.value(tile, row0, col1);
    const c = this.value(tile, row1, col0);
    const d = this.value(tile, row1, col1);
    if (a === null || b === null || c === null || d === null) return null;
    const tx = boundedCol - col0;
    const ty = boundedRow - row0;
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  }
}
