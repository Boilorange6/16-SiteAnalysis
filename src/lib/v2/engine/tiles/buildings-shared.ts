import type BetterSqlite3 from "better-sqlite3";
import type { Geometry, MultiPolygon, Polygon } from "geojson";
import { overlapArea, planarArea } from "../../ingest/sources/juso-buildings";
import { toUtmk } from "../../crs";
import type { FeatureHit } from "../../data/features";
import type { EngineContext } from "../context";

export const BUILDING_SOURCES = ["building", "building_juso", "gis_bldg"] as const;
export const RETIRED_GIS_MAX_APPROVAL_YEAR = 2010;
export const RETIRED_MIN_OVERLAP_RATIO = 0.2;
export const RETIRED_MAX_OVERLAP_RATIO = 0.5;
const RETIREMENT_CELL_M = 64;

const FEATURE_COLUMNS = ["feature_id", "stable_id", "kind", "release_id", "geom_json", "name", "pnu", "legal_code", "properties_json"] as const;
const FACT_COLUMNS = ["feature_id", "height_m", "height_method", "floors_above", "use_code", "approval_date", "gross_floor_area_m2", "footprint_area_m2"] as const;

export interface BuildingRow {
  hit: FeatureHit;
  heightM: number | null;
  heightMethod: "source" | "floors_estimate" | "user" | "unknown";
  floorsAbove: number | null;
  useCode: string | null;
  approvalDate: string | null;
  approvalDateSource: "building_fact" | "core_ledger_pnu" | null;
  grossFloorM2: number | null;
  footprintM2: number | null;
}

/** 발자국의 면적 가중 중심(EPSG:5179 m). 홀은 뺀다. 면적이 0이면 꼭짓점 평균. */
export function geometryCentroid(geometry: Geometry): [number, number] | null {
  if (geometry.type === "Point") return [geometry.coordinates[0]!, geometry.coordinates[1]!];
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : null;
  if (!polygons) return null;
  const ox = polygons[0]?.[0]?.[0]?.[0] ?? 0;
  const oy = polygons[0]?.[0]?.[0]?.[1] ?? 0; // 큰 좌표값끼리의 곱 오차를 줄이려고 첫 꼭짓점을 원점으로 옮긴다
  let total = 0;
  let sx = 0;
  let sy = 0;
  let vx = 0;
  let vy = 0;
  let vn = 0;
  for (const rings of polygons) {
    rings.forEach((ring, ringIndex) => {
      let a = 0;
      let rx = 0;
      let ry = 0;
      for (let i = 0; i + 1 < ring.length; i += 1) {
        const x0 = ring[i]![0]! - ox;
        const y0 = ring[i]![1]! - oy;
        const x1 = ring[i + 1]![0]! - ox;
        const y1 = ring[i + 1]![1]! - oy;
        const cross = x0 * y1 - x1 * y0;
        a += cross;
        rx += (x0 + x1) * cross;
        ry += (y0 + y1) * cross;
        if (ringIndex === 0) {
          vx += x0;
          vy += y0;
          vn += 1;
        }
      }
      if (a === 0) return;
      const area = Math.abs(a / 2) * (ringIndex === 0 ? 1 : -1);
      total += area;
      sx += (rx / (3 * a)) * area;
      sy += (ry / (3 * a)) * area;
    });
  }
  if (Math.abs(total) > 1e-9) return [ox + sx / total, oy + sy / total];
  return vn > 0 ? [ox + vx / vn, oy + vy / vn] : null;
}

/**
 * 동수 집계용 반경 판정: 발자국의 중심점이 반경 원 안에 있는 건물만 센다(벤치마크와 같은 정의).
 * 반경에 걸친 건물까지 넣는 "교차" 선택(buildingRows)은 그림·3D·그림자가 그대로 쓴다.
 */
export function isCounted(ctx: EngineContext, row: { hit: { geometry: Geometry } }): boolean {
  return isCountedWithin(ctx, row, ctx.input.radiusM);
}

/** 대표점 기준을 반경 버퍼 타일에도 적용한다. */
export function isCountedWithin(ctx: EngineContext, row: { hit: { geometry: Geometry } }, radiusM: number): boolean {
  const [cx, cy] = ctx.memo("buildings:center-utmk", () => toUtmk(ctx.input.center));
  const c = geometryCentroid(row.hit.geometry);
  if (!c) return true; // 중심을 못 구하는 도형은 빼지 않는다(교차로 선택된 그대로 센다)
  return Math.hypot(c[0] - cx, c[1] - cy) <= radiusM;
}

function columns(db: BetterSqlite3.Database, table: string): Set<string> {
  try {
    return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));
  } catch {
    return new Set();
  }
}

/** buildings 파일·필수 열이 없으면 false(호출자가 notProvided). */
export function buildingsReady(ctx: EngineContext): boolean {
  const db = ctx.db("buildings");
  if (!db || ctx.sources("buildings", BUILDING_SOURCES).length === 0) return false;
  const featureColumns = columns(db, "feature");
  const factColumns = columns(db, "building_fact");
  return FEATURE_COLUMNS.every((column) => featureColumns.has(column)) && FACT_COLUMNS.every((column) => factColumns.has(column));
}

const positiveNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);
const heightMethod = (value: unknown): BuildingRow["heightMethod"] =>
  value === "source" || value === "floors_estimate" || value === "user" ? value : "unknown";

function validApprovalDate(value: unknown, analysisDate: string): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + "T00:00:00Z");
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return value <= analysisDate ? value : null;
}

function ledgerApprovalByPnu(ctx: EngineContext, pnus: readonly string[]): Map<string, string | null> {
  const cache = ctx.memo("buildings:ledger-approval-by-pnu", () => new Map<string, string | null>());
  const missing = [...new Set(pnus.filter((pnu) => pnu !== ""))].filter((pnu) => !cache.has(pnu));
  if (missing.length === 0) return cache;
  const db = ctx.db("core");
  if (!db) {
    for (const pnu of missing) cache.set(pnu, null);
    return cache;
  }
  try {
    for (let offset = 0; offset < missing.length; offset += 500) {
      const chunk = missing.slice(offset, offset + 500);
      const sql = "SELECT pnu, properties_json FROM feature WHERE pnu IN (" + chunk.map(() => "?").join(",") + ") AND kind IN ('housing_complex', 'officetel')";
      const rows = db.prepare(sql).all(...chunk) as Array<{ pnu: string; properties_json: string }>;
      const dates = new Map<string, string>();
      for (const row of rows) {
        let value: unknown;
        try {
          value = (JSON.parse(row.properties_json) as { approvalDate?: unknown }).approvalDate;
        } catch {
          value = null;
        }
        const date = validApprovalDate(value, ctx.input.analysisDate);
        if (date && (!dates.has(row.pnu) || date < dates.get(row.pnu)!)) dates.set(row.pnu, date);
      }
      for (const pnu of chunk) cache.set(pnu, dates.get(pnu) ?? null);
    }
  } catch {
    for (const pnu of missing) cache.set(pnu, null);
  }
  return cache;
}

type ArealGeometry = Polygon | MultiPolygon;

function areal(geometry: Geometry): geometry is ArealGeometry {
  return geometry.type === "Polygon" || geometry.type === "MultiPolygon";
}

function bbox(geometry: ArealGeometry): [number, number, number, number] {
  const points: number[][] = [];
  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number") points.push(value as number[]);
    else value.forEach(visit);
  };
  visit(geometry.coordinates);
  return [
    Math.min(...points.map((point) => point[0]!)),
    Math.min(...points.map((point) => point[1]!)),
    Math.max(...points.map((point) => point[0]!)),
    Math.max(...points.map((point) => point[1]!)),
  ];
}

function compactName(value: string | null): string | null {
  const name = value?.trim();
  return name ? name.replace(/[\s()·,.-]/g, "") : null;
}

export interface BuildingRetirementInfo {
  candidatePairs: number;
  excludedCount: number;
  excludedStableIds: string[];
}

function filterRetiredRows(rows: BuildingRow[]): { rows: BuildingRow[]; retirement: BuildingRetirementInfo } {
  const gis = rows.filter((row) => row.hit.stableId.startsWith("building:"));
  const juso = rows.filter((row) => row.hit.stableId.startsWith("juso:") && areal(row.hit.geometry));
  const byCell = new Map<string, BuildingRow[]>();
  for (const row of juso) {
    const box = bbox(row.hit.geometry as ArealGeometry);
    for (let ix = Math.floor(box[0] / RETIREMENT_CELL_M); ix <= Math.floor(box[2] / RETIREMENT_CELL_M); ix++) {
      for (let iy = Math.floor(box[1] / RETIREMENT_CELL_M); iy <= Math.floor(box[3] / RETIREMENT_CELL_M); iy++) {
        const key = ix + ":" + iy;
        const cell = byCell.get(key);
        if (cell) cell.push(row);
        else byCell.set(key, [row]);
      }
    }
  }

  const excluded = new Set<number>();
  let candidatePairs = 0;
  for (const old of gis) {
    if (!areal(old.hit.geometry)) continue;
    const oldYear = old.approvalDate ? Number(old.approvalDate.slice(0, 4)) : NaN;
    const oldName = compactName(old.hit.name);
    if (!oldName || !Number.isInteger(oldYear) || oldYear > RETIRED_GIS_MAX_APPROVAL_YEAR) continue;
    const oldArea = planarArea(old.hit.geometry);
    if (!(oldArea > 0)) continue;
    const oldBox = bbox(old.hit.geometry);
    const candidates = new Map<number, BuildingRow>();
    for (let ix = Math.floor(oldBox[0] / RETIREMENT_CELL_M); ix <= Math.floor(oldBox[2] / RETIREMENT_CELL_M); ix++) {
      for (let iy = Math.floor(oldBox[1] / RETIREMENT_CELL_M); iy <= Math.floor(oldBox[3] / RETIREMENT_CELL_M); iy++) {
        for (const current of byCell.get(ix + ":" + iy) ?? []) candidates.set(current.hit.featureId, current);
      }
    }
    for (const current of candidates.values()) {
      const currentName = compactName(current.hit.name);
      if (!currentName || currentName === oldName || !current.approvalDate || current.approvalDate <= old.approvalDate!) continue;
      const overlapRatio = overlapArea(old.hit.geometry, current.hit.geometry as ArealGeometry) / oldArea;
      if (overlapRatio < RETIRED_MIN_OVERLAP_RATIO || overlapRatio >= RETIRED_MAX_OVERLAP_RATIO) continue;
      candidatePairs += 1;
      excluded.add(old.hit.featureId);
    }
  }
  const excludedStableIds = rows.filter((row) => excluded.has(row.hit.featureId)).map((row) => row.hit.stableId);
  return {
    rows: rows.filter((row) => !excluded.has(row.hit.featureId)),
    retirement: { candidatePairs, excludedCount: excludedStableIds.length, excludedStableIds },
  };
}

/** 반경 안 building 히트와 building_fact를 결합한다. 파일·필수 열이 없으면 null. */
function buildingRowsUncached(ctx: EngineContext, radiusM: number): { rows: BuildingRow[]; retirement: BuildingRetirementInfo } | null {
  if (!buildingsReady(ctx)) return null;
  const db = ctx.db("buildings");
  if (!db) return null;

  const hits = ctx.hits("buildings", ["building"], radiusM);
  const ledgerPnus = hits.filter((hit) => hit.stableId.startsWith("juso:") && hit.pnu).map((hit) => hit.pnu!);
  const ledgerApproval = ledgerApprovalByPnu(ctx, ledgerPnus);
  const out: BuildingRow[] = [];
  for (let i = 0; i < hits.length; i += 500) {
    const chunk = hits.slice(i, i + 500);
    const rows = db
      .prepare(`SELECT feature_id, height_m, height_method, floors_above, use_code, approval_date, gross_floor_area_m2, footprint_area_m2 FROM building_fact WHERE feature_id IN (${chunk.map(() => "?").join(",")})`)
      .all(...chunk.map((hit) => hit.featureId)) as Array<Record<string, unknown>>;
    const byFeature = new Map(rows.map((row) => [row.feature_id as number, row]));
    for (const hit of chunk) {
      const row = byFeature.get(hit.featureId);
      const factApproval = typeof row?.approval_date === "string" ? row.approval_date : null;
      const ledgerDate = hit.stableId.startsWith("juso:") && hit.pnu ? ledgerApproval.get(hit.pnu) ?? null : null;
      out.push({
        hit,
        heightM: positiveNumber(row?.height_m),
        heightMethod: heightMethod(row?.height_method),
        floorsAbove: positiveNumber(row?.floors_above),
        useCode: typeof row?.use_code === "string" ? row.use_code : null,
        approvalDate: factApproval ?? ledgerDate,
        approvalDateSource: factApproval ? "building_fact" : ledgerDate ? "core_ledger_pnu" : null,
        grossFloorM2: positiveNumber(row?.gross_floor_area_m2),
        footprintM2: positiveNumber(row?.footprint_area_m2),
      });
    }
  }
  return filterRetiredRows(out);
}

/** 한 분석에서 같은 반경의 건물 행·fact 결합을 여러 타일이 공유한다. */
export function buildingRows(ctx: EngineContext, radiusM = ctx.input.radiusM): BuildingRow[] | null {
  return ctx.memo("buildings:selection:" + radiusM, () => buildingRowsUncached(ctx, radiusM))?.rows ?? null;
}

/** 철거 잔존 후보를 제외한 사실을 타일 limitations에 공통으로 남긴다. */
export function buildingRetirementLimitations(ctx: EngineContext, radiusM = ctx.input.radiusM): Array<{ kind: "partial"; note: string }> {
  const selection = ctx.memo("buildings:selection:" + radiusM, () => buildingRowsUncached(ctx, radiusM));
  const info = selection?.retirement;
  if (!info || info.excludedCount === 0) return [];
  return [{
    kind: "partial",
    note: "현행 도로명주소 보충 도형과 " + RETIRED_MIN_OVERLAP_RATIO * 100 + "% 이상 " + RETIRED_MAX_OVERLAP_RATIO * 100 + "% 미만 겹치고 GIS 사용승인일이 " + RETIRED_GIS_MAX_APPROVAL_YEAR + "년 이하인 옛 건물 중, 대장 PNU 준공일이 더 최신이고 건물명이 다른 " + info.excludedCount + "동을 철거 잔존 후보로 제외했습니다. 조인·이름 근거가 없는 후보는 오탐 방지를 위해 유지했습니다.",
  }];
}

export function buildingRetirementInfo(ctx: EngineContext, radiusM = ctx.input.radiusM): BuildingRetirementInfo | null {
  return ctx.memo("buildings:selection:" + radiusM, () => buildingRowsUncached(ctx, radiusM))?.retirement ?? null;
}
