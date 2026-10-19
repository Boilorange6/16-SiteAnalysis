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
  [/WGS[ _-]?84|GCS_WGS_1984/i, "EPSG:4326"],
  [/Korea_2000_Korea_Central_Belt_2010/i, "EPSG:5186"],
  [/KGD2002_Central_Belt_2010/i, "EPSG:5186"],
  [/Korea_2000_Korea_Unified_Coordinate_System/i, UTMK],
  [/Korean_1985_Modified_Korea_Central_Belt/i, "EPSG:5174"],
];

// [semi-major, lat0, lon0, k, FE, FN]
const PRJ_PARAMS: ReadonlyArray<readonly [string, readonly number[]]> = [
  ["EPSG:5186", [6378137, 38, 127, 1, 200000, 600000]],
  [UTMK, [6378137, 38, 127.5, 0.9996, 1000000, 2000000]],
  ["EPSG:5174", [6377397.155, 38, 127.0028902777778, 1, 200000, 500000]],
];

const UNSUPPORTED_PRJ_PARAMS: ReadonlyArray<readonly [string, readonly number[]]> = [
  ["EPSG:5185", [6378137, 38, 125, 1, 200000, 600000]],
  ["EPSG:5187", [6378137, 38, 129, 1, 200000, 600000]],
  ["EPSG:5188", [6378137, 38, 131, 1, 200000, 600000]],
];

function prjParams(text: string): number[] | null {
  const num = (re: RegExp) => {
    const m = re.exec(text);
    return m ? Number(m[1]) : NaN;
  };
  const p = (k: string) => num(new RegExp(`PARAMETER\\["${k}",\\s*([-+0-9.eE]+)`, "i"));
  const v = [num(/SPHEROID\["[^"]*",\s*([-+0-9.eE]+)/i), p("Latitude_Of_Origin"), p("Central_Meridian"), p("Scale_Factor"), p("False_Easting"), p("False_Northing")];
  return v.some(Number.isNaN) ? null : v;
}

export function crsFromPrj(prjText: string): string {
  const v = prjParams(prjText);
  if (v) {
    for (const [crs, ref] of UNSUPPORTED_PRJ_PARAMS) {
      const tol = [0.5, 1e-6, 1e-6, 1e-6, 0.5, 0.5];
      if (ref.every((r, i) => Math.abs(r - v[i]) <= tol[i])) throw new Error(`unsupported .prj: ${crs}`);
    }
    for (const [crs, ref] of PRJ_PARAMS) {
      // 반경은 0.5 m, 각도·축척은 1e-6, 동/북거리는 0.5 m
      const tol = [0.5, 1e-6, 1e-6, 1e-6, 0.5, 0.5];
      if (ref.every((r, i) => Math.abs(r - v[i]) <= tol[i])) return crs;
    }
  }
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

/** keep: 정리 전 원본 속성(문자열에 NUL 채움이 남아 있음)으로 레코드를 거른다. 걸러진 레코드는 재투영하지 않아 시군구 하나만 읽을 때 빠르다. */
export async function* readShp(shpPath: string, opts: { crs?: string; encoding?: string; keep?: (props: Record<string, unknown>) => boolean; native?: boolean } = {}): AsyncGenerator<ShpRecord> {
  const { crs, encoding } = detect(shpPath, opts);
  const source = await openShapefile(shpPath, undefined, { encoding });
  for (let r = await source.read(); !r.done; r = await source.read()) {
    const f = r.value;
    if (opts.keep && !opts.keep((f.properties ?? {}) as Record<string, unknown>)) continue;
    // native: 원천 좌표 그대로(재투영 없음). 원천이 이미 EPSG:5179면 저장 좌표와 같아 왕복 변환을 건너뛴다.
    yield { properties: cleanProps((f.properties ?? {}) as Record<string, unknown>), geometry: f.geometry ? (opts.native ? f.geometry : reprojectToWgs84(f.geometry, crs)) : null };
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
