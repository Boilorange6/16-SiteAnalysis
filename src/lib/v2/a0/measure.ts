/**
 * A0 검증표용 측정 (spec §6 P0, §7).
 * 원천 파일의 행 수, 필드별 채움률, 시도별 행 수, 검수지 반경 내 행 수·채움률을 잰다.
 */
import { open as openShapefile } from "shapefile";
import proj4 from "proj4";
import { toUtmk, UTMK, type LngLat } from "../crs";
import type { ReviewSite } from "./review-sites";

export function decodeText(buf: Uint8Array): { text: string; encoding: "utf-8" | "euc-kr" } {
  const bytes = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("euc-kr").decode(bytes), encoding: "euc-kr" };
  }
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const EMPTY_MARKERS = new Set(["", "none", "null", "-", "nan"]);

export function isFilled(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  return !EMPTY_MARKERS.has(String(v).trim().toLowerCase());
}

export interface MeasureRecord {
  properties: Record<string, unknown>;
  point: LngLat | null;
}

export interface FieldReport {
  field: string;
  filled: number;
  total: number;
  /** 분모가 0이면 산정 불가(null) */
  fillRate: number | null;
}

export interface MeasureReport {
  rows: number;
  fields: FieldReport[];
  byRegion: Record<string, number>;
  bySite: Record<string, { rows: number; fields: FieldReport[] }>;
}

export interface MeasureOptions {
  regionField?: string;
  regionDigits?: number;
  sites?: readonly ReviewSite[];
  siteRadiusM?: number;
}

class Tally {
  rows = 0;
  filled = new Map<string, number>();
  constructor(private readonly fieldNames: readonly string[]) {}
  add(props: Record<string, unknown>) {
    this.rows++;
    for (const f of this.fieldNames) if (isFilled(props[f])) this.filled.set(f, (this.filled.get(f) ?? 0) + 1);
  }
  report(): FieldReport[] {
    return this.fieldNames.map((field) => {
      const filled = this.filled.get(field) ?? 0;
      return { field, filled, total: this.rows, fillRate: this.rows === 0 ? null : filled / this.rows };
    });
  }
}

export async function measureRecords(
  records: Iterable<MeasureRecord> | AsyncIterable<MeasureRecord>,
  fieldNames: readonly string[],
  options: MeasureOptions = {},
): Promise<MeasureReport> {
  const all = new Tally(fieldNames);
  const byRegion: Record<string, number> = {};
  const sites = (options.sites ?? []).map((s) => ({ site: s, xy: toUtmk(s.center), tally: new Tally(fieldNames) }));
  const radius = options.siteRadiusM ?? 1000;

  for await (const r of records) {
    all.add(r.properties);
    if (options.regionField) {
      const code = String(r.properties[options.regionField] ?? "").slice(0, options.regionDigits ?? 2);
      const key = code === "" ? "(없음)" : code;
      byRegion[key] = (byRegion[key] ?? 0) + 1;
    }
    if (r.point && sites.length > 0) {
      const [x, y] = toUtmk(r.point);
      for (const s of sites) if (Math.hypot(x - s.xy[0], y - s.xy[1]) <= radius) s.tally.add(r.properties);
    }
  }
  const bySite: MeasureReport["bySite"] = {};
  for (const s of sites) bySite[s.site.id] = { rows: s.tally.rows, fields: s.tally.report() };
  return { rows: all.rows, fields: all.report(), byRegion, bySite };
}

export function csvRecords(buf: Uint8Array, opts: { lngField?: string; latField?: string } = {}) {
  const { text, encoding } = decodeText(buf);
  const [header = [], ...rows] = parseCsv(text).filter((r) => !(r.length === 1 && r[0] === ""));
  const records: MeasureRecord[] = rows.map((cells) => {
    const properties = Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
    const lng = opts.lngField ? Number(properties[opts.lngField]) : Number.NaN;
    const lat = opts.latField ? Number(properties[opts.latField]) : Number.NaN;
    const hasPoint = isFilled(properties[opts.lngField ?? ""]) && isFilled(properties[opts.latField ?? ""]) && Number.isFinite(lng) && Number.isFinite(lat);
    return { properties, point: hasPoint ? ([lng, lat] as LngLat) : null };
  });
  return { encoding, fieldNames: header, records };
}

/** SHP 첫 좌표를 대표점으로 쓴다(검수지 반경 집계용 근사). crs는 "EPSG:5186"처럼 준다. */
export async function shpRecords(shpPath: string, opts: { encoding: string; crs: string }) {
  if (opts.crs !== "EPSG:4326" && !proj4.defs(opts.crs)) {
    throw new Error(`unknown CRS ${opts.crs} — define it with proj4.defs first (UTM-K is ${UTMK})`);
  }
  const source = await openShapefile(shpPath, undefined, { encoding: opts.encoding });
  const first = await source.read();
  const fieldNames = first.done ? [] : Object.keys(first.value.properties ?? {});
  const toLngLat = (xy: number[]): LngLat => {
    const [lng, lat] = opts.crs === "EPSG:4326" ? xy : proj4(opts.crs, "EPSG:4326", xy);
    return [lng, lat];
  };
  const firstPosition = (coords: unknown): number[] | null => {
    let c: unknown = coords;
    while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
    return Array.isArray(c) && typeof c[0] === "number" ? (c as number[]) : null;
  };
  async function* records(): AsyncGenerator<MeasureRecord> {
    let next = first;
    while (!next.done) {
      const f = next.value;
      const pos = f.geometry && "coordinates" in f.geometry ? firstPosition(f.geometry.coordinates) : null;
      yield { properties: (f.properties ?? {}) as Record<string, unknown>, point: pos ? toLngLat(pos) : null };
      next = await source.read();
    }
  }
  return { fieldNames, records: records() };
}
