/** G3 도판 상세 조회 계약. 목록·지도 선택·CSV가 같은 행/카드 계산을 공유한다. */
import { inflateRawSync } from "node:zlib";
import type BetterSqlite3 from "better-sqlite3";
import { getAnalysisRun } from "../../app-db";
import { readArchivedManifest, readManifest, manifestHash, type Manifest } from "../../data/manifest";
import { parseTileResult, type RasterRef } from "../../tile-result";
import { loadTileRaster } from "../../raster-store";
import type { RasterValues } from "../context";
import { EngineContext } from "../context";
import type { TileCode } from "../../ui/tile-catalog";
import { catalogEntry } from "../../ui/tile-catalog";
import { BUILDING_SPECS } from "./buildings";
import { ZONE_SPECS } from "./zones";
import { PARCEL_SPECS } from "./parcels";
import { NETWORK_SPECS } from "./network";
import { RASTER_SPECS } from "./raster";
import { WEATHER_SPECS } from "./weather";

export type DetailValue = string | number | null;

export interface DetailColumn {
  key: string;
  label: string;
  unit?: string;
  kind: "text" | "number" | "date" | "category";
  csvOnly?: boolean;
}

export interface DetailRow {
  fid: string;
  lng: number;
  lat: number;
  cells: Record<string, DetailValue>;
}

export interface DetailCard {
  title: string;
  subtitle?: string;
  chip?: { label: string; color: string };
  fields: Array<{ label: string; value: string | null }>;
  missing?: string[];
  source: string;
}

export interface DetailControl {
  key: string;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  default: string;
}

export type DetailAt = {
  card: DetailCard;
  fid?: string;
  path?: Array<[number, number]>;
};

export type DetailContext = EngineContext & {
  detailControls?: Readonly<Record<string, string>>;
};

export interface DetailSpec {
  columns: DetailColumn[];
  summary(ctx: DetailContext): DetailCard;
  rows(ctx: DetailContext): DetailRow[];
  at(ctx: DetailContext, lng: number, lat: number): DetailAt | null;
  controls?: DetailControl[];
}

export interface DetailPayload {
  analysisId: string;
  code: TileCode;
  title: string;
  columns: DetailColumn[];
  csvColumns: DetailColumn[];
  controls: DetailControl[];
  card: DetailCard;
  rows: DetailRow[];
  total: number;
  exportFileName: string;
}

export interface DetailListQuery {
  controls?: Record<string, string | undefined>;
  q?: string;
  sort?: string;
  dir?: "asc" | "desc";
  offset?: number;
  limit?: number;
}

export interface DetailApiReply {
  status: 200 | 404 | 500;
  body: Record<string, unknown>;
}

type DetailCsvReply = { status: 200 | 404 | 500; body: string; fileName?: string };

const ALL_SPECS: Array<Partial<Record<TileCode, DetailSpec>>> = [
  BUILDING_SPECS,
  ZONE_SPECS,
  PARCEL_SPECS,
  NETWORK_SPECS,
  RASTER_SPECS,
  WEATHER_SPECS,
];

export const DETAIL_SPECS: Partial<Record<TileCode, DetailSpec>> = Object.assign({}, ...ALL_SPECS);

const CONTROL_KEYS = new Set(["season", "bandwidth", "metric"]);
const DETAIL_CACHE_LIMIT = 32;
const detailCache = new Map<string, DetailPayload>();

function controlsFor(spec: DetailSpec, raw: Record<string, string | undefined> | undefined): Record<string, string> {
  const output: Record<string, string> = {};
  for (const control of spec.controls ?? []) {
    const requested = raw?.[control.key];
    output[control.key] = control.options.some((option) => option.value === requested) ? requested! : control.default;
  }
  return output;
}

function setControls(ctx: DetailContext, controls: Record<string, string>): void {
  ctx.detailControls = Object.freeze({ ...controls });
}

function controlList(spec: DetailSpec): DetailControl[] {
  return (spec.controls ?? []).map((control) => ({
    ...control,
    options: control.options.map((option) => ({ ...option })),
  }));
}

function cacheKey(ctx: DetailContext, code: TileCode, controls: Record<string, string>): string {
  return JSON.stringify([
    ctx.analysisId,
    ctx.manifestHash,
    code,
    ctx.input.center,
    ctx.input.radiusM,
    ctx.input.analysisDate,
    controls,
  ]);
}

function remember(key: string, value: DetailPayload): DetailPayload {
  detailCache.delete(key);
  detailCache.set(key, value);
  while (detailCache.size > DETAIL_CACHE_LIMIT) detailCache.delete(detailCache.keys().next().value!);
  return value;
}

function safeText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeFilePart(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").replace(/\s+/g, " ").slice(0, 120) || "분석";
}

function makePayload(ctx: DetailContext, code: TileCode, spec: DetailSpec, controls: Record<string, string>): DetailPayload {
  setControls(ctx, controls);
  const columns = spec.columns.filter((column) => !column.csvOnly);
  const csvColumns = [...spec.columns];
  const rows = spec.rows(ctx);
  const card = spec.summary(ctx);
  return {
    analysisId: ctx.analysisId,
    code,
    title: catalogEntry(code).title,
    columns,
    csvColumns,
    controls: controlList(spec),
    card,
    rows,
    total: rows.length,
    exportFileName: `${safeFilePart(ctx.input.address)}_${safeFilePart(catalogEntry(code).title)}_${Math.round(ctx.input.radiusM)}m.csv`,
  };
}

export function collectDetail(ctx: DetailContext, code: string, rawControls?: Record<string, string>): DetailPayload {
  const spec = DETAIL_SPECS[code as TileCode];
  if (!spec) throw new Error(`DETAIL_NOT_AVAILABLE: ${code}`);
  const typedCode = code as TileCode;
  const controls = controlsFor(spec, rawControls);
  const key = cacheKey(ctx, typedCode, controls);
  const cached = detailCache.get(key);
  if (cached) {
    setControls(ctx, controls);
    return cached;
  }
  return remember(key, makePayload(ctx, typedCode, spec, controls));
}

export function detailAt(ctx: DetailContext, code: string, lng: number, lat: number, rawControls?: Record<string, string>): DetailAt | null {
  const spec = DETAIL_SPECS[code as TileCode];
  if (!spec || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const controls = controlsFor(spec, rawControls);
  setControls(ctx, controls);
  return spec.at(ctx, lng, lat);
}

function csvCell(value: DetailValue): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "number" ? String(value) : value;
  return /[",\r\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

export function detailCsv(payload: DetailPayload): string {
  const lines = [payload.csvColumns.map((column) => csvCell(column.label)).join(",")];
  for (const row of payload.rows) lines.push(payload.csvColumns.map((column) => csvCell(row.cells[column.key] ?? null)).join(","));
  return `\ufeff${lines.join("\r\n")}\r\n`;
}

function rowMatches(row: DetailRow, query: string): boolean {
  const lowered = query.trim().toLocaleLowerCase("ko-KR");
  if (lowered === "") return true;
  return Object.values(row.cells).some((value) => String(value ?? "").toLocaleLowerCase("ko-KR").includes(lowered));
}

function compareValues(a: DetailValue, b: DetailValue): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "ko-KR", { numeric: true, sensitivity: "base" });
}

function visibleRows(payload: DetailPayload, query: DetailListQuery | undefined): { rows: DetailRow[]; total: number } {
  let rows = query?.q ? payload.rows.filter((row) => rowMatches(row, query.q!)) : [...payload.rows];
  const sort = query?.sort && payload.csvColumns.some((column) => column.key === query.sort) ? query.sort : null;
  if (sort) {
    const direction = query?.dir === "desc" ? -1 : 1;
    rows.sort((a, b) => direction * (compareValues(a.cells[sort], b.cells[sort]) || a.fid.localeCompare(b.fid, "en")));
  }
  const total = rows.length;
  const offset = Math.max(0, Math.floor(query?.offset ?? 0));
  const limit = Math.min(5000, Math.max(1, Math.floor(query?.limit ?? 5000)));
  return { rows: rows.slice(offset, offset + limit), total };
}

function readable(run: { userId?: string | number | null }, userId?: string | number | null): boolean {
  return run.userId == null || (userId != null && String(run.userId) === String(userId));
}

function runManifest(dataDir: string, run: ReturnType<typeof getAnalysisRun>): Manifest | null {
  if (!run) return null;
  const archived = readArchivedManifest(dataDir, run.manifestHash);
  const current = archived ?? readManifest(dataDir);
  return current && manifestHash(current) === run.manifestHash ? current : null;
}

function valuesFromStored(ref: RasterRef, blob: Buffer): RasterValues {
  const raw = inflateRawSync(blob);
  const bytes = ref.cols * ref.rows * ref.bands * (ref.dtype === "u16" || ref.dtype === "i16" ? 2 : 1);
  if (raw.byteLength !== bytes) throw new Error(`RASTER_RAW_LENGTH_MISMATCH: ${ref.name}`);
  if (ref.dtype === "u8" || ref.dtype === "bits") return new Uint8Array(raw);
  if (ref.dtype === "u16") return new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  return new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
}

function rasterReader(appDb: BetterSqlite3.Database, analysisId: string) {
  return (code: string, name: string): { ref: RasterRef; values: RasterValues } | null => {
    const row = appDb.prepare("SELECT cache_key, result_json FROM tile_result WHERE analysis_id = ? AND tile_code = ? AND status IN ('complete','partial')").get(analysisId, code) as { cache_key: string; result_json: string } | undefined;
    if (!row) return null;
    const result = parseTileResult(JSON.parse(row.result_json));
    if (!result.presentation.rasters?.some((candidate) => candidate.name === name)) return null;
    const stored = loadTileRaster(appDb, row.cache_key, name);
    return stored ? { ref: stored.ref, values: valuesFromStored(stored.ref, stored.blob) } : null;
  };
}

function makeContext(appDb: BetterSqlite3.Database, dataDir: string, analysisId: string): { ctx: DetailContext; run: NonNullable<ReturnType<typeof getAnalysisRun>> } | null {
  const run = getAnalysisRun(appDb, analysisId);
  const manifest = runManifest(dataDir, run);
  if (!run || !manifest) return null;
  return {
    run,
    ctx: new EngineContext(dataDir, manifest, analysisId, {
      address: run.address,
      center: [run.center[0], run.center[1]],
      radiusM: run.radiusM,
      analysisDate: run.analysisDate,
      pnu: typeof run.parameters.pnu === "string" ? run.parameters.pnu : null,
    }, {}, { rasterReader: rasterReader(appDb, analysisId) }),
  };
}

export function getDetailList(
  appDb: BetterSqlite3.Database,
  dataDir: string,
  analysisId: string,
  code: string,
  userId?: string | number | null,
  query?: DetailListQuery,
): DetailApiReply {
  const setup = makeContext(appDb, dataDir, analysisId);
  if (!setup) return { status: 404, body: { error: "상세 자료를 찾을 수 없습니다" } };
  if (!readable(setup.run, userId)) {
    setup.ctx.close();
    return { status: 404, body: { error: "상세 자료를 찾을 수 없습니다" } };
  }
  try {
    if (!DETAIL_SPECS[code as TileCode]) return { status: 404, body: { error: "상세 자료를 찾을 수 없습니다" } };
    const payload = collectDetail(setup.ctx, code, query?.controls as Record<string, string> | undefined);
    const visible = visibleRows(payload, query);
    return { status: 200, body: { ...payload, rows: visible.rows, total: visible.total, rowCount: payload.rows.length } };
  } catch {
    return { status: 500, body: { error: "상세 자료를 계산하지 못했습니다" } };
  } finally {
    setup.ctx.close();
  }
}

export function getDetailAt(
  appDb: BetterSqlite3.Database,
  dataDir: string,
  analysisId: string,
  code: string,
  lng: number,
  lat: number,
  userId?: string | number | null,
  controls?: Record<string, string>,
): DetailApiReply {
  const setup = makeContext(appDb, dataDir, analysisId);
  if (!setup) return { status: 404, body: { error: "상세 자료를 찾을 수 없습니다" } };
  if (!readable(setup.run, userId)) {
    setup.ctx.close();
    return { status: 404, body: { error: "상세 자료를 찾을 수 없습니다" } };
  }
  try {
    if (!DETAIL_SPECS[code as TileCode]) return { status: 404, body: { error: "상세 자료를 찾을 수 없습니다" } };
    const result = detailAt(setup.ctx, code, lng, lat, controls);
    return result ? { status: 200, body: result as unknown as Record<string, unknown> } : { status: 404, body: { error: "선택한 지물을 찾을 수 없습니다" } };
  } catch {
    return { status: 500, body: { error: "상세 지물을 계산하지 못했습니다" } };
  } finally {
    setup.ctx.close();
  }
}

export function getDetailCsv(
  appDb: BetterSqlite3.Database,
  dataDir: string,
  analysisId: string,
  code: string,
  userId?: string | number | null,
  controls?: Record<string, string>,
): DetailCsvReply {
  const setup = makeContext(appDb, dataDir, analysisId);
  if (!setup) return { status: 404, body: "상세 자료를 찾을 수 없습니다" };
  if (!readable(setup.run, userId)) {
    setup.ctx.close();
    return { status: 404, body: "상세 자료를 찾을 수 없습니다" };
  }
  try {
    if (!DETAIL_SPECS[code as TileCode]) return { status: 404, body: "상세 자료를 찾을 수 없습니다" };
    const payload = collectDetail(setup.ctx, code, controls);
    return { status: 200, body: detailCsv(payload), fileName: payload.exportFileName };
  } catch {
    return { status: 500, body: "상세 CSV를 생성하지 못했습니다" };
  } finally {
    setup.ctx.close();
  }
}

export function allowedDetailControls(searchParams: URLSearchParams): Record<string, string> {
  const controls: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) if (CONTROL_KEYS.has(key) && value.trim() !== "") controls[key] = value;
  return controls;
}
