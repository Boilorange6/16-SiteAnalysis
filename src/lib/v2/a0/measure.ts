/**
 * A0 검증표용 측정 (spec §6 P0, §7).
 * 원천 파일의 행 수, 필드별 채움률, 시도별 행 수, 검수지 반경 내 행 수·채움률을 잰다.
 */
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { open as openShapefile } from "shapefile";
import proj4 from "proj4";
import { toUtmk, UTMK, type LngLat } from "../crs";
import type { ReviewSite } from "./review-sites";

export function decodeText(buf: Uint8Array): { text: string; encoding: "utf-8" | "euc-kr" } {
  const bytes = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch (e) {
    if (!(e instanceof TypeError)) throw e; // 잘못된 UTF-8만 EUC-KR로 넘긴다
    return { text: new TextDecoder("euc-kr").decode(bytes), encoding: "euc-kr" };
  }
}

/** 증분 RFC4180 파서: 청크 경계(따옴표, CRLF)를 넘어도 상태를 유지한다. */
class CsvParser {
  private row: string[] = [];
  private field = "";
  private quoted = false;
  private afterQuote = false; // 따옴표 안에서 `"`를 봤고 다음 글자로 `""`인지 닫힘인지 결정
  private skipLF = false;
  push(text: string): string[][] {
    const rows: string[][] = [];
    for (const ch of text) {
      if (this.skipLF) { this.skipLF = false; if (ch === "\n") continue; }
      if (this.afterQuote) {
        this.afterQuote = false;
        if (ch === '"') { this.field += '"'; continue; }
        this.quoted = false;
      }
      if (this.quoted) {
        if (ch === '"') this.afterQuote = true;
        else this.field += ch;
      } else if (ch === '"') this.quoted = true;
      else if (ch === ",") { this.row.push(this.field); this.field = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r") this.skipLF = true;
        this.row.push(this.field); rows.push(this.row); this.row = []; this.field = "";
      } else this.field += ch;
    }
    return rows;
  }
  end(): string[][] {
    const rows: string[][] = [];
    if (this.field !== "" || this.row.length > 0) { this.row.push(this.field); rows.push(this.row); }
    this.row = []; this.field = "";
    return rows;
  }
}

export function parseCsv(text: string): string[][] {
  const p = new CsvParser();
  return [...p.push(text), ...p.end()];
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
  /** 검수지 배정에 쓴 좌표의 근거 */
  pointBasis: PointBasis;
  /** 한국 범위(경도 124~132, 위도 33~39) 밖이라 검수지 배정에서 뺀 좌표 수 */
  outOfRangePoints: number;
}

export type PointBasis = "bbox-center" | "lnglat-columns" | "none";

export interface MeasureOptions {
  pointBasis?: PointBasis;
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

  let outOfRangePoints = 0;

  for await (const r of records) {
    all.add(r.properties);
    if (options.regionField) {
      const code = String(r.properties[options.regionField] ?? "").slice(0, options.regionDigits ?? 2);
      const key = code === "" ? "(없음)" : code;
      byRegion[key] = (byRegion[key] ?? 0) + 1;
    }
    if (r.point) {
      const [lng, lat] = r.point;
      if (lng < 124 || lng > 132 || lat < 33 || lat > 39) outOfRangePoints++;
      else if (sites.length > 0) {
        const [x, y] = toUtmk(r.point);
        for (const s of sites) if (Math.hypot(x - s.xy[0], y - s.xy[1]) <= radius) s.tally.add(r.properties);
      }
    }
  }
  const bySite: MeasureReport["bySite"] = {};
  for (const s of sites) bySite[s.site.id] = { rows: s.tally.rows, fields: s.tally.report() };
  return { rows: all.rows, fields: all.report(), byRegion, bySite, pointBasis: options.pointBasis ?? "none", outOfRangePoints };
}

const SNIFF_BYTES = 1 << 20;

/** 앞 1 MiB로 인코딩을 판별한다. 청크 끝에서 잘린 UTF-8 글자(최대 3바이트)는 버리고 시도한다. */
async function sniffEncoding(path: string): Promise<"utf-8" | "euc-kr"> {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await fh.read(buf, 0, SNIFF_BYTES, 0);
    const start = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0;
    const truncated = bytesRead === SNIFF_BYTES;
    for (let drop = 0; drop <= (truncated ? 3 : 0); drop++) {
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(start, bytesRead - drop));
        return "utf-8";
      } catch (e) {
        if (!(e instanceof TypeError)) throw e;
      }
    }
    return "euc-kr";
  } finally {
    await fh.close();
  }
}

async function* csvRows(path: string, encoding: "utf-8" | "euc-kr"): AsyncGenerator<string[]> {
  const decoder = new TextDecoder(encoding); // utf-8 BOM은 디코더가 첫 청크에서 벗긴다
  const parser = new CsvParser();
  for await (const chunk of createReadStream(path)) yield* parser.push(decoder.decode(chunk as Buffer, { stream: true }));
  yield* parser.push(decoder.decode());
  yield* parser.end();
}

const isBlankRow = (r: string[]) => r.length === 1 && r[0] === "";

/** 파일을 스트리밍한다. 행을 보관하지 않으므로 수 GB 파일도 메모리가 늘지 않는다. */
export async function csvRecords(
  path: string,
  opts: { lngField?: string; latField?: string; encoding?: "utf-8" | "euc-kr" } = {},
): Promise<{ encoding: "utf-8" | "euc-kr"; fieldNames: string[]; records: AsyncIterable<MeasureRecord> }> {
  const encoding = opts.encoding ?? (await sniffEncoding(path));
  const rows = csvRows(path, encoding);
  let fieldNames: string[] = [];
  for (;;) {
    const n = await rows.next();
    if (n.done) break;
    if (!isBlankRow(n.value)) { fieldNames = n.value; break; }
  }
  async function* records(): AsyncGenerator<MeasureRecord> {
    for await (const cells of rows) {
      if (isBlankRow(cells)) continue;
      const properties = Object.fromEntries(fieldNames.map((h, i) => [h, cells[i] ?? ""]));
      const lng = opts.lngField ? Number(properties[opts.lngField]) : Number.NaN;
      const lat = opts.latField ? Number(properties[opts.latField]) : Number.NaN;
      const hasPoint = isFilled(properties[opts.lngField ?? ""]) && isFilled(properties[opts.latField ?? ""]) && Number.isFinite(lng) && Number.isFinite(lat);
      yield { properties, point: hasPoint ? ([lng, lat] as LngLat) : null };
    }
  }
  return { encoding, fieldNames, records: records() };
}

/** SHP 지오메트리의 좌표 bbox 중심을 대표점으로 쓴다(검수지 반경 집계용 근사, pointBasis "bbox-center"). crs는 "EPSG:5186"처럼 준다. */
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
  const bboxCenter = (coords: unknown): number[] | null => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const walk = (c: unknown) => {
      if (!Array.isArray(c)) return;
      if (typeof c[0] === "number" && typeof c[1] === "number") {
        minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
        minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
      } else for (const x of c) walk(x);
    };
    walk(coords);
    return minX === Infinity ? null : [(minX + maxX) / 2, (minY + maxY) / 2];
  };
  async function* records(): AsyncGenerator<MeasureRecord> {
    let next = first;
    while (!next.done) {
      const f = next.value;
      const pos = f.geometry && "coordinates" in f.geometry ? bboxCenter(f.geometry.coordinates) : null;
      yield { properties: (f.properties ?? {}) as Record<string, unknown>, point: pos ? toLngLat(pos) : null };
      next = await source.read();
    }
  }
  return { fieldNames, records: records() };
}
