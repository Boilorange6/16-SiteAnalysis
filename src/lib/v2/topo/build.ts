import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import type { Geometry, Position } from "geojson";
import { initDataFileSchema } from "../data/schema";
import { geometryBbox, insertFeature } from "../data/features";
import { UTMK, toLngLat, toUtmk } from "../crs";
import { crsFromPrj, readShp, reprojectToWgs84 } from "../ingest/shp";
import { interpolateTopoDem, type TopoDemGrid } from "./dem";
import { TOPO_LAYERS, type TopoKind } from "./layers";

type Db = BetterSqlite3.Database;
type Bbox = [number, number, number, number];

export interface TopoSummary {
  crs: string;
  bboxUtmk: Bbox;
  coverageWgs84: [number, number][];
  counts: Partial<Record<TopoKind, number>>;
  demCells: number;
  buildingFloorsOnePct: number | null;
}

export type TopoErrorCode = "topo_not_topo" | "topo_crs" | "topo_empty";

export class TopoError extends Error {
  readonly code: TopoErrorCode;

  constructor(code: TopoErrorCode, message: string = code) {
    super(message);
    this.name = "TopoError";
    this.code = code;
  }
}

interface LayerFile {
  base: string;
  shpPath: string;
  kind: TopoKind;
  geometry: "line" | "point" | "polygon";
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function propertyValue(properties: Record<string, unknown>, name: string): unknown {
  if (Object.prototype.hasOwnProperty.call(properties, name)) return properties[name];
  const key = Object.keys(properties).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? properties[key] : undefined;
}

function propertyNumber(properties: Record<string, unknown>, name: string): number | null {
  return finiteNumber(propertyValue(properties, name));
}

function propertyString(properties: Record<string, unknown>, name: string): string | null {
  const value = propertyValue(properties, name);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function mapPositions(coords: unknown, map: (position: Position) => Position): unknown {
  if (!Array.isArray(coords)) throw new TypeError("invalid coordinates");
  if (typeof coords[0] === "number") return map(coords as Position);
  return coords.map((child) => mapPositions(child, map));
}

function mapGeometry(geometry: Geometry, map: (position: Position) => Position): Geometry {
  if (geometry.type === "GeometryCollection") throw new TypeError("GeometryCollection is not supported");
  return { type: geometry.type, coordinates: mapPositions(geometry.coordinates, map) } as Geometry;
}

function positions(coords: unknown): Array<[number, number]> {
  if (!Array.isArray(coords)) throw new TypeError("invalid coordinates");
  if (typeof coords[0] === "number") return [[Number(coords[0]), Number(coords[1])]];
  return coords.flatMap((child) => positions(child));
}

function lineParts(geometry: Geometry): Array<Array<[number, number]>> {
  if (geometry.type === "LineString") return [positions(geometry.coordinates)];
  if (geometry.type === "MultiLineString") return geometry.coordinates.map((line) => positions(line));
  return [];
}

function addContourPoints(target: number[], geometry: Geometry, elevation: number): void {
  for (const line of lineParts(geometry)) {
    if (line.length === 0) continue;
    target.push(line[0][0], line[0][1], elevation);
    for (let i = 1; i < line.length; i += 1) {
      const [x0, y0] = line[i - 1];
      const [x1, y1] = line[i];
      const distance = Math.hypot(x1 - x0, y1 - y0);
      const steps = Math.max(1, Math.ceil(distance / 5));
      for (let step = 1; step <= steps; step += 1) {
        const ratio = step / steps;
        target.push(x0 + (x1 - x0) * ratio, y0 + (y1 - y0) * ratio, elevation);
      }
    }
  }
}

function addPointElevations(target: number[], geometry: Geometry, elevation: number): void {
  if (geometry.type === "GeometryCollection") throw new TypeError("GeometryCollection is not supported");
  for (const [x, y] of positions(geometry.coordinates)) target.push(x, y, elevation);
}

function transformGeometryToUtmk(geometry: Geometry, crs: string): Geometry {
  if (crs === UTMK) return geometry;
  const wgs84 = reprojectToWgs84(geometry, crs);
  return mapGeometry(wgs84, (position) => {
    const [x, y] = toUtmk([position[0], position[1]]);
    return [x, y];
  });
}

function geometryForStorage(geometry: Geometry, crs: string): { geometry: Geometry; geometryIsUtmk: boolean } {
  if (crs === UTMK) return { geometry, geometryIsUtmk: true };
  return { geometry: reprojectToWgs84(geometry, crs), geometryIsUtmk: false };
}

function updateBbox(target: Bbox, bbox: Bbox): void {
  target[0] = Math.min(target[0], bbox[0]);
  target[1] = Math.min(target[1], bbox[1]);
  target[2] = Math.max(target[2], bbox[2]);
  target[3] = Math.max(target[3], bbox[3]);
}

function layerFiles(srcDir: string): LayerFile[] {
  const files = new Map<string, string>();
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".shp")) {
      const base = entry.name.slice(0, -4);
      files.set(base, join(srcDir, entry.name));
    }
  }
  return Object.entries(TOPO_LAYERS)
    .filter(([base]) => files.has(base))
    .map(([base, layer]) => ({ base, shpPath: files.get(base)!, kind: layer.kind, geometry: layer.geometry }));
}

function coverageForBbox(bbox: Bbox): [number, number][] {
  const [minX, minY, maxX, maxY] = bbox;
  return [[...toLngLat([minX, minY])], [...toLngLat([maxX, minY])], [...toLngLat([maxX, maxY])], [...toLngLat([minX, maxY])], [...toLngLat([minX, minY])]];
}

function gridBounds(bbox: Bbox): Bbox {
  const [minX, minY, maxX, maxY] = bbox;
  const padX = minX === maxX ? 2.5 : 0;
  const padY = minY === maxY ? 2.5 : 0;
  return [minX - padX, minY - padY, maxX + padX, maxY + padY];
}

function finiteCellCount(grid: TopoDemGrid): number {
  let count = 0;
  for (const value of grid.values) if (Number.isFinite(value)) count += 1;
  return count;
}

function writeDem(db: Db, grid: TopoDemGrid): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS topo_dem (
      x0 REAL NOT NULL,
      y0 REAL NOT NULL,
      cell_m REAL NOT NULL,
      cols INTEGER NOT NULL,
      rows INTEGER NOT NULL,
      data BLOB NOT NULL
    );
    DELETE FROM topo_dem;
  `);
  const data = Buffer.from(grid.values.buffer, grid.values.byteOffset, grid.values.byteLength);
  db.prepare("INSERT INTO topo_dem (x0, y0, cell_m, cols, rows, data) VALUES (?, ?, ?, ?, ?, ?)")
    .run(grid.x0, grid.y0, grid.cellM, grid.cols, grid.rows, data);
}

function readLayerCrs(layer: LayerFile): string {
  const prjPath = layer.shpPath.replace(/\.shp$/i, ".prj");
  if (!existsSync(prjPath)) throw new TopoError("topo_crs", `no CRS for ${layer.base}: missing .prj`);
  try {
    return crsFromPrj(readFileSync(prjPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TopoError("topo_crs", `${layer.base}: ${message}`);
  }
}

function normalizedProperties(kind: TopoKind, source: Record<string, unknown>): { properties: Record<string, unknown>; name: string | null } {
  const name = propertyString(source, "name");
  const kindValue = propertyString(source, "kind");
  switch (kind) {
    case "topo_road":
    case "topo_road_surface":
      return { properties: { widthM: propertyNumber(source, "rvwd"), lanes: propertyNumber(source, "rdln") }, name };
    case "topo_building":
      return { properties: { floorsAbove: propertyNumber(source, "nmly"), name, kind: kindValue }, name };
    case "topo_retaining":
    case "topo_cut_fill":
    case "topo_fence":
      return { properties: { heightM: (propertyNumber(source, "heig") ?? 0) > 0 ? propertyNumber(source, "heig") : null, kind: kindValue }, name };
    case "topo_contour":
      return { properties: { elevationM: propertyNumber(source, "cont") }, name };
    case "topo_spot":
      return { properties: { elevationM: propertyNumber(source, "nume") }, name };
    case "topo_water":
      return { properties: { kind: kindValue }, name };
  }
}

export async function buildTopoDb(srcDir: string, outPath: string, opts: { releaseId: string }): Promise<TopoSummary> {
  const layers = layerFiles(srcDir);
  if (layers.length === 0) throw new TopoError("topo_not_topo", "no supported topo layers");
  if (!opts.releaseId) throw new TypeError("releaseId is required");
  mkdirSync(dirname(outPath), { recursive: true });

  const db = new Database(outPath);
  const bbox: Bbox = [Infinity, Infinity, -Infinity, -Infinity];
  const counts: Partial<Record<TopoKind, number>> = {};
  const demPoints: number[] = [];
  let sourceCrs: string | null = null;
  let insertedFeatures = 0;
  let buildingCount = 0;
  let buildingFloorsOne = 0;

  try {
    initDataFileSchema(db, "reference");
    db.prepare(`INSERT INTO source_release
      (release_id, source_id, provider, source_url, source_as_of, fetched_at, checksum, schema_version, license_code, rights_json, coverage_json)
      VALUES (?, 'ngii_topo', '국토지리정보원', 'https://www.ngii.go.kr/', NULL, ?, ?, 2, 'unknown', '{}', '{}')`)
      .run(opts.releaseId, new Date().toISOString(), opts.releaseId);

    for (const layer of layers) {
      const crs = readLayerCrs(layer);
      if (sourceCrs === null) sourceCrs = crs;
      else if (sourceCrs !== crs) throw new TopoError("topo_crs", `mixed CRS: ${sourceCrs} and ${crs}`);
      let layerIndex = 0;
      db.exec("BEGIN");
      try {
        for await (const record of readShp(layer.shpPath, { native: true })) {
          if (!record.geometry) continue;
          const storage = geometryForStorage(record.geometry, crs);
          const geometryUtmk = transformGeometryToUtmk(record.geometry, crs);
          const properties = normalizedProperties(layer.kind, record.properties);
          const stableId = `ngii_topo:${layer.base}:${layerIndex}`;
          insertFeature(db, {
            stableId,
            kind: layer.kind,
            sourceKey: `${layer.base}:${layerIndex}`,
            releaseId: opts.releaseId,
            geometry: storage.geometry,
            geometryIsUtmk: storage.geometryIsUtmk,
            name: properties.name,
            properties: properties.properties,
          });
          updateBbox(bbox, geometryBbox(geometryUtmk));
          counts[layer.kind] = (counts[layer.kind] ?? 0) + 1;
          insertedFeatures += 1;
          if (layer.kind === "topo_building") {
            buildingCount += 1;
            if (propertyNumber(record.properties, "nmly") === 1) buildingFloorsOne += 1;
          }
          if (layer.kind === "topo_contour") {
            const elevation = propertyNumber(record.properties, "cont");
            if (elevation !== null) addContourPoints(demPoints, geometryUtmk, elevation);
          } else if (layer.kind === "topo_spot") {
            const elevation = propertyNumber(record.properties, "nume");
            if (elevation !== null) addPointElevations(demPoints, geometryUtmk, elevation);
          }
          layerIndex += 1;
        }
        db.exec("COMMIT");
      } catch (error) {
        if (db.inTransaction) db.exec("ROLLBACK");
        if (error instanceof TopoError) throw error;
        throw new TopoError("topo_empty", `${layer.base}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (insertedFeatures === 0 || sourceCrs === null || !bbox.every(Number.isFinite)) {
      throw new TopoError("topo_empty", "supported topo layers contain no features");
    }
    const bounds = gridBounds(bbox);
    const grid = interpolateTopoDem(new Float64Array(demPoints), bounds, 5);
    writeDem(db, grid);
    const coverageWgs84 = coverageForBbox(bbox);
    db.prepare("UPDATE source_release SET coverage_json = ? WHERE release_id = ?")
      .run(JSON.stringify({ bboxUtmk: bbox, coverageWgs84 }), opts.releaseId);
    const summary: TopoSummary = {
      crs: sourceCrs,
      bboxUtmk: bbox,
      coverageWgs84,
      counts,
      demCells: finiteCellCount(grid),
      buildingFloorsOnePct: buildingCount === 0 ? null : (buildingFloorsOne / buildingCount) * 100,
    };
    return summary;
  } finally {
    db.close();
  }
}
