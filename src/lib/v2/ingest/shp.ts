/**
 * SHP 읽기. VWorld·국토부 SHP는 대부분 EPSG:5186 + EUC-KR, 속성 이름은 A0…An이다.
 * 문자열 속성에는 NUL(\u0000) 채움이 섞여 있어 정리해서 넘긴다.
 */
import { existsSync, readFileSync } from "node:fs";
import type { Geometry, Position } from "geojson";
import proj4 from "proj4";
import { open as openShapefile } from "shapefile";
import { PROJ4_DEFINITIONS } from "../../server/maintenance/boundary-crs";
import { UTMK, type LngLat } from "../crs";
import { normalizeEncoding } from "../a0/measure";

for (const [name, def] of Object.entries(PROJ4_DEFINITIONS)) proj4.defs(name, def);

export interface ShpRecord {
  properties: Record<string, unknown>;
  geometry: Geometry | null;
}

export interface ShpPointRecord {
  properties: Record<string, unknown>;
  point: LngLat | null;
}

const PRJ_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/Korea_2000_Korea_Central_Belt_2010/i, "EPSG:5186"],
  [/Korea_2000_Korea_Unified_Coordinate_System/i, UTMK],
  [/Korean_1985_Modified_Korea_Central_Belt/i, "EPSG:5174"],
];

export function crsFromPrj(prjText: string): string {
  for (const [re, crs] of PRJ_RULES) if (re.test(prjText)) return crs;
  throw new Error(`unsupported .prj: ${prjText.slice(0, 80)}`);
}

export function cleanProps(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p ?? {})) {
    if (typeof v === "string") {
      const s = v.replace(/\u0000/g, "").trim();
      out[k] = s === "" ? null : s;
    } else if (v instanceof Date) {
      out[k] = Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
    } else {
      out[k] = v ?? null;
    }
  }
  return out;
}

function mapPositions(coords: unknown, fn: (p: Position) => Position): unknown {
  if (!Array.isArray(coords)) throw new TypeError("invalid coordinates");
  if (typeof coords[0] === "number") return fn(coords as Position);
  return coords.map((c) => mapPositions(c, fn));
}

export function reprojectToWgs84(g: Geometry, crs: string): Geometry {
  if (g.type === "GeometryCollection") throw new TypeError("GeometryCollection is not supported");
  if (crs === "EPSG:4326") return g;
  const t = proj4(crs, "EPSG:4326");
  return { type: g.type, coordinates: mapPositions(g.coordinates, (p) => t.forward([p[0], p[1]])) } as Geometry;
}

function detect(shpPath: string, opts: { crs?: string; encoding?: string }) {
  const prj = shpPath.replace(/\.shp$/i, ".prj");
  const cpg = shpPath.replace(/\.shp$/i, ".cpg");
  const crs = opts.crs ?? (existsSync(prj) ? crsFromPrj(readFileSync(prj, "utf8")) : undefined);
  if (!crs) throw new Error(`no CRS for ${shpPath}: pass opts.crs or provide a .prj`);
  const encoding = normalizeEncoding(opts.encoding ?? (existsSync(cpg) ? readFileSync(cpg, "utf8").trim() : "euc-kr"));
  return { crs, encoding };
}

export async function* readShp(shpPath: string, opts: { crs?: string; encoding?: string } = {}): AsyncGenerator<ShpRecord> {
  const { crs, encoding } = detect(shpPath, opts);
  const source = await openShapefile(shpPath, undefined, { encoding });
  for (let r = await source.read(); !r.done; r = await source.read()) {
    const f = r.value;
    yield { properties: cleanProps((f.properties ?? {}) as Record<string, unknown>), geometry: f.geometry ? reprojectToWgs84(f.geometry, crs) : null };
  }
}

export async function* readShpPoints(shpPath: string, opts: { crs?: string; encoding?: string } = {}): AsyncGenerator<ShpPointRecord> {
  const { crs, encoding } = detect(shpPath, opts);
  const t = proj4(crs, "EPSG:4326");
  const source = await openShapefile(shpPath, undefined, { encoding });
  for (let r = await source.read(); !r.done; r = await source.read()) {
    const f = r.value;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    if (f.geometry && f.geometry.type !== "GeometryCollection") {
      mapPositions(f.geometry.coordinates, (p) => {
        if (p[0] < minX) minX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] > maxY) maxY = p[1];
        return p;
      });
    }
    const point = minX === Infinity ? null : (t.forward([(minX + maxX) / 2, (minY + maxY) / 2]) as unknown as LngLat);
    yield { properties: cleanProps((f.properties ?? {}) as Record<string, unknown>), point };
  }
}
