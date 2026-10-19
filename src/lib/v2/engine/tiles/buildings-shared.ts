import type BetterSqlite3 from "better-sqlite3";
import type { Geometry, MultiPolygon, Polygon } from "geojson";
import { normalizeBuildingName, overlapArea, planarArea, RETIRED_GIS_MAX_APPROVAL_YEAR } from "../../ingest/sources/juso-buildings";
import { FLOOR_HEIGHT_M } from "../../ingest/sources/buildings";
import { toUtmk } from "../../crs";
import { queryFeaturesInBboxes, type FeatureHit } from "../../data/features";
import type { EngineContext } from "../context";

export const BUILDING_SOURCES = ["building", "building_juso", "gis_bldg"] as const;
export const RETIRED_MIN_OVERLAP_RATIO = 0.2;
export const RETIRED_MAX_OVERLAP_RATIO = 0.5;
/** 재구획으로 PNU가 바뀐 경우에도 단순 보수적 날짜 보정과 구분할 최소 승인일 간격. */
export const RETIRED_MIN_APPROVAL_GAP_YEARS = 10;
const RETIREMENT_CELL_M = 64;
/** parcel 후보는 큰 필지의 bbox 셀 열거를 막기 위한 별도 coarse index다. */
const RETIREMENT_PARCEL_CELL_M = 256;
/** 오래된 중심점 셀을 묶어 parcels R*Tree 왕복을 줄인다. 도형 판정은 뒤에서 다시 한다. */
const RETIREMENT_PARCEL_QUERY_CELL_M = 128;
/** 수치지형도 건물 후보를 기존 건물과 비교할 때의 bbox 격자 크기. 실제 교차는 후보에만 한다. */
const TOPO_BUILDING_CELL_M = 64;
const fallbackTopoBuildingSupplementByRadius = new WeakMap<object, Map<number, boolean>>();

const FEATURE_COLUMNS = ["feature_id", "stable_id", "kind", "release_id", "geom_json", "name", "pnu", "legal_code", "properties_json"] as const;
const FACT_COLUMNS = ["feature_id", "height_m", "height_method", "floors_above", "use_code", "approval_date", "gross_floor_area_m2", "footprint_area_m2"] as const;

export type StoredBuildingHeightMethod = "source" | "ledger_height" | "floors_estimate" | "ledger_floors_estimate" | "user" | "unknown";
export type BuildingHeightMethod = "source" | "ledger_height" | "floors_estimate" | "user" | "unknown" | "assumed_one_floor";

export interface BuildingRow {
  hit: FeatureHit;
  heightM: number | null;
  heightMethod: BuildingHeightMethod;
  floorsAbove: number | null;
  /** 엔진 가정 전 building_fact 원천값. 원천 사실 보존·검증용이며 계산값과 다를 수 있다. */
  rawHeightM: number | null;
  rawFloorsAbove: number | null;
  rawHeightMethod: StoredBuildingHeightMethod;
  useCode: string | null;
  approvalDate: string | null;
  approvalDateSource: "building_fact" | "ledger_title" | "core_ledger_pnu" | null;
  grossFloorM2: number | null;
  footprintM2: number | null;
}

type SupplementStateContext = EngineContext & { topoBuildingSupplementByRadius?: Map<number, boolean>; topoBuildingSupplementApplied?: boolean };

function supplementState(ctx: EngineContext): Map<number, boolean> {
  const state = ctx as SupplementStateContext;
  if (state.topoBuildingSupplementByRadius) return state.topoBuildingSupplementByRadius;
  let fallback = fallbackTopoBuildingSupplementByRadius.get(ctx);
  if (!fallback) {
    fallback = new Map<number, boolean>();
    fallbackTopoBuildingSupplementByRadius.set(ctx, fallback);
  }
  return fallback;
}

export function isConfirmedHeightMethod(method: BuildingHeightMethod): boolean {
  return method === "source" || method === "ledger_height";
}

export function isAssumedOneFloor(row: Pick<BuildingRow, "heightMethod">): boolean {
  return row.heightMethod === "assumed_one_floor";
}

export function assumedOneFloorCount(rows: readonly Pick<BuildingRow, "heightMethod">[]): number {
  return rows.filter(isAssumedOneFloor).length;
}

/** 1층 가정은 다른 추정 층수와 섞이지 않도록 별도 한계 문장으로 남긴다. */
export function assumedOneFloorLimitation(
  rows: readonly Pick<BuildingRow, "heightMethod">[],
  denominator = rows.length,
): { kind: "estimated"; note: string } | null {
  const count = assumedOneFloorCount(rows);
  if (count === 0 || denominator <= 0) return null;
  const share = Math.round((count / denominator) * 1000) / 10;
  return {
    kind: "estimated",
    note: `높이·층수 자료가 없는 건물 ${count.toLocaleString("en-US")}동(${share}%)은 1층(${FLOOR_HEIGHT_M} m)으로 가정했습니다.`,
  };
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
const storedHeightMethod = (value: unknown): StoredBuildingHeightMethod =>
  value === "source" || value === "ledger_height" || value === "floors_estimate" || value === "ledger_floors_estimate" || value === "user" ? value : "unknown";
const heightMethod = (value: unknown): BuildingHeightMethod => {
  const stored = storedHeightMethod(value);
  return stored === "ledger_floors_estimate" ? "floors_estimate" : stored;
};

function validApprovalDate(value: unknown, analysisDate: string): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + "T00:00:00Z");
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return value <= analysisDate ? value : null;
}

function approvalThresholdAfter(earlier: string, years: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(earlier)) return null;
  const threshold = new Date(earlier + "T00:00:00Z");
  if (Number.isNaN(threshold.getTime())) return null;
  threshold.setUTCFullYear(threshold.getUTCFullYear() + years);
  return threshold.toISOString().slice(0, 10);
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

interface BboxIndex {
  boxes: Array<[number, number, number, number]>;
  rowIndexes: number[];
  cells: Map<string, number[]>;
}

function visitCells(box: readonly [number, number, number, number], visit: (key: string) => void): void {
  for (let ix = Math.floor(box[0] / TOPO_BUILDING_CELL_M); ix <= Math.floor(box[2] / TOPO_BUILDING_CELL_M); ix += 1) {
    for (let iy = Math.floor(box[1] / TOPO_BUILDING_CELL_M); iy <= Math.floor(box[3] / TOPO_BUILDING_CELL_M); iy += 1) visit(`${ix}:${iy}`);
  }
}

function boxesOverlap(a: readonly [number, number, number, number], b: readonly [number, number, number, number]): boolean {
  return a[2] >= b[0] && a[0] <= b[2] && a[3] >= b[1] && a[1] <= b[3];
}

function buildingBboxIndex(rows: readonly BuildingRow[]): BboxIndex {
  const index: BboxIndex = { boxes: [], rowIndexes: [], cells: new Map() };
  for (const [rowIndex, row] of rows.entries()) {
    if (!areal(row.hit.geometry)) continue;
    const box = bbox(row.hit.geometry);
    const boxIndex = index.boxes.length;
    index.boxes.push(box);
    index.rowIndexes.push(rowIndex);
    visitCells(box, (key) => {
      const values = index.cells.get(key);
      if (values) values.push(boxIndex);
      else index.cells.set(key, [boxIndex]);
    });
  }
  return index;
}

function buildingCandidates(index: BboxIndex, box: readonly [number, number, number, number]): number[] {
  const candidates = new Set<number>();
  visitCells(box, (key) => {
    for (const rowIndex of index.cells.get(key) ?? []) candidates.add(rowIndex);
  });
  return [...candidates].filter((rowIndex) => boxesOverlap(index.boxes[rowIndex]!, box));
}

function positiveTopoFloors(hit: FeatureHit): number | null {
  const value = hit.properties.floorsAbove ?? hit.properties.nmly;
  const floors = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(floors) && floors > 0 ? Math.round(floors) : null;
}

function topoBuildingRow(hit: FeatureHit, floors: number | null): BuildingRow {
  const estimated = floors !== null && floors >= 2;
  const effectiveFloors = estimated ? floors : 1;
  return {
    hit,
    heightM: estimated ? effectiveFloors * FLOOR_HEIGHT_M : FLOOR_HEIGHT_M,
    heightMethod: estimated ? "floors_estimate" : "assumed_one_floor",
    floorsAbove: effectiveFloors,
    rawHeightM: null,
    rawFloorsAbove: floors,
    rawHeightMethod: "unknown",
    useCode: null,
    approvalDate: null,
    approvalDateSource: null,
    grossFloorM2: null,
    footprintM2: planarArea(hit.geometry),
  };
}

/**
 * GIS 건물과 수치지형도 건물을 bbox 격자로 먼저 좁힌 뒤 교차면적을
 * 계산한다. topo hit 자체는 이미 topo SQLite R*Tree 반경 조회를 거친다.
 */
function supplementTopoBuildings(ctx: EngineContext, rows: BuildingRow[], radiusM: number): BuildingRow[] {
  if (!ctx.topo) {
    supplementState(ctx).set(radiusM, false);
    return rows;
  }
  const topoHits = ctx.topo.hits(["topo_building"], radiusM).filter((hit): hit is FeatureHit & { geometry: ArealGeometry } => areal(hit.geometry));
  if (topoHits.length === 0) {
    supplementState(ctx).set(radiusM, false);
    return rows;
  }

  const index = buildingBboxIndex(rows);
  const supplemented = rows.slice();
  let applied = false;
  for (const topoHit of topoHits) {
    const topoArea = planarArea(topoHit.geometry);
    if (!(topoArea > 0)) continue;
    const topoBox = bbox(topoHit.geometry);
    const floors = positiveTopoFloors(topoHit);
    let overlapsExisting = false;
    for (const candidateIndex of buildingCandidates(index, topoBox)) {
      const existing = supplemented[index.rowIndexes[candidateIndex]!];
      if (!existing || !areal(existing.hit.geometry)) continue;
      const existingArea = planarArea(existing.hit.geometry);
      if (!(existingArea > 0)) continue;
      const intersection = overlapArea(existing.hit.geometry, topoHit.geometry);
      if (intersection / topoArea >= 0.2) overlapsExisting = true;
      if (existing.floorsAbove === null && floors !== null && floors >= 2 && intersection / existingArea >= 0.5) {
        supplemented[index.rowIndexes[candidateIndex]!] = {
          ...existing,
          heightM: floors * FLOOR_HEIGHT_M,
          heightMethod: "floors_estimate",
          floorsAbove: floors,
        };
        applied = true;
      }
    }
    if (!overlapsExisting) {
      supplemented.push(topoBuildingRow(topoHit, floors));
      applied = true;
    }
  }
  supplementState(ctx).set(radiusM, applied);
  return supplemented;
}

export interface BuildingRetirementInfo {
  candidatePairs: number;
  /** 적재 단계에서 retired=true로 직접 표시된 GIS 행 수 */
  ingestMarkedCount: number;
  /** 적재 표시가 없는 구버전 DB에서 질의 시점 규칙으로 찾은 pair 수 */
  legacyCandidatePairs: number;
  /** legacy pair 규칙으로 제외한 서로 다른 옛 GIS 행 수 */
  legacyExcludedCount: number;
  /** 현재 필지 도형·core 승인일·PNU 변경이 모두 맞아 제외한 옛 GIS-필지 pair 수 */
  currentParcelCandidatePairs: number;
  /** 현재 필지 근거로 제외한 서로 다른 옛 GIS 행 수 */
  currentParcelExcludedCount: number;
  excludedCount: number;
  excludedStableIds: string[];
}

export interface RetirementEvidence {
  /** parcels 원천의 반경 R*Tree hit. 호출자가 parcel_polygon 원천인지 확인한다. */
  currentParcels?: readonly FeatureHit[];
  /** 중심점-필지 도형을 먼저 판정한 GIS별 후보. 있으면 filterRetiredRows가 다시 공간검사를 하지 않는다. */
  currentParcelMatches?: ReadonlyMap<number, readonly FeatureHit[]>;
  /** core housing_complex/officetel의 PNU별 가장 이른 유효 승인일. */
  approvalByPnu?: ReadonlyMap<string, string | null>;
}

interface ParcelGeometryCandidate {
  hit: FeatureHit;
  box: [number, number, number, number];
}

interface CurrentParcelCandidate extends ParcelGeometryCandidate {
  approvalDate: string;
}

interface LegacyJusoCandidate {
  row: BuildingRow;
  box: [number, number, number, number];
  name: string | null;
}

function cellKeys(box: [number, number, number, number], cellM = RETIREMENT_CELL_M): string[] {
  const keys: string[] = [];
  for (let ix = Math.floor(box[0] / cellM); ix <= Math.floor(box[2] / cellM); ix++) {
    for (let iy = Math.floor(box[1] / cellM); iy <= Math.floor(box[3] / cellM); iy++) keys.push(ix + ":" + iy);
  }
  return keys;
}

function pointInRing(coordinate: [number, number], ring: readonly (readonly number[])[]): boolean {
  let inside = false;
  const [x, y] = coordinate;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    const onSegment = Math.abs(cross) <= 1e-7 && x >= Math.min(xi, xj) - 1e-7 && x <= Math.max(xi, xj) + 1e-7 && y >= Math.min(yi, yj) - 1e-7 && y <= Math.max(yi, yj) + 1e-7;
    if (onSegment) return true;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInParcel(coordinate: [number, number], parcel: ParcelGeometryCandidate): boolean {
  const [x, y] = coordinate;
  if (x < parcel.box[0] || x > parcel.box[2] || y < parcel.box[1] || y > parcel.box[3]) return false;
  const geometry = parcel.hit.geometry as ArealGeometry;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((rings) => pointInRing(coordinate, rings[0]!) && rings.slice(1).every((ring) => !pointInRing(coordinate, ring)));
}

interface EligibleCurrentParcelRow {
  row: BuildingRow;
  center: [number, number];
}

/** 현재 필지의 두 단계 공간 조회가 공유하는 옛 GIS 중심점 목록. */
function eligibleCurrentParcelRows(ctx: EngineContext, rows: readonly BuildingRow[], radiusM: number): EligibleCurrentParcelRow[] {
  return ctx.memo("buildings:current-parcel-rows:" + radiusM, () => {
    const [cx, cy] = toUtmk(ctx.input.center);
    const eligible: EligibleCurrentParcelRow[] = [];
    for (const row of rows) {
      if (!row.hit.stableId.startsWith("building:") || !row.hit.pnu || !areal(row.hit.geometry)) continue;
      const year = row.approvalDate ? Number(row.approvalDate.slice(0, 4)) : NaN;
      if (!Number.isInteger(year) || year > RETIRED_GIS_MAX_APPROVAL_YEAR) continue;
      const center = geometryCentroid(row.hit.geometry);
      if (center && Math.hypot(center[0] - cx, center[1] - cy) <= radiusM) eligible.push({ row, center });
    }
    return eligible;
  });
}

/** 오래된 GIS 중심점이 들어갈 수 있는 128m 셀만 parcels R*Tree에서 읽는다. */
function currentParcelHits(ctx: EngineContext, rows: readonly BuildingRow[], radiusM: number): FeatureHit[] {
  if (ctx.sources("parcels", ["parcel_polygon"]).length === 0) return [];
  const db = ctx.db("parcels");
  if (!db) return [];
  const cells = new Set<string>();
  for (const { center } of eligibleCurrentParcelRows(ctx, rows, radiusM)) cells.add(Math.floor(center[0] / RETIREMENT_PARCEL_QUERY_CELL_M) + ":" + Math.floor(center[1] / RETIREMENT_PARCEL_QUERY_CELL_M));
  if (cells.size === 0) return [];
  const boxes = [...cells].map((key) => {
    const [ix, iy] = key.split(":").map(Number);
    return [ix * RETIREMENT_PARCEL_QUERY_CELL_M, iy * RETIREMENT_PARCEL_QUERY_CELL_M, (ix + 1) * RETIREMENT_PARCEL_QUERY_CELL_M, (iy + 1) * RETIREMENT_PARCEL_QUERY_CELL_M] as [number, number, number, number];
  });
  return queryFeaturesInBboxes(db, boxes, ["parcel"]);
}

/** core 승인일을 읽기 전에 중심점과 PNU가 실제로 맞을 수 있는 parcel만 남긴다. */
function currentParcelCandidates(ctx: EngineContext, rows: readonly BuildingRow[], parcels: readonly FeatureHit[], radiusM: number): { parcels: FeatureHit[]; matches: Map<number, FeatureHit[]> } {
  const byCell = new Map<string, ParcelGeometryCandidate[]>();
  for (const hit of parcels) {
    if (!hit.pnu || !areal(hit.geometry)) continue;
    const candidate = { hit, box: bbox(hit.geometry) };
    for (const key of cellKeys(candidate.box, RETIREMENT_PARCEL_CELL_M)) {
      const cell = byCell.get(key);
      if (cell) cell.push(candidate);
      else byCell.set(key, [candidate]);
    }
  }
  const matched = new Map<number, FeatureHit>();
  const matches = new Map<number, FeatureHit[]>();
  for (const { row, center } of eligibleCurrentParcelRows(ctx, rows, radiusM)) {
    for (const current of byCell.get(Math.floor(center[0] / RETIREMENT_PARCEL_CELL_M) + ":" + Math.floor(center[1] / RETIREMENT_PARCEL_CELL_M)) ?? []) {
      if (current.hit.pnu === row.hit.pnu || !pointInParcel(center, current)) continue;
      matched.set(current.hit.featureId, current.hit);
      const oldMatches = matches.get(row.hit.featureId);
      if (oldMatches) oldMatches.push(current.hit);
      else matches.set(row.hit.featureId, [current.hit]);
    }
  }
  return { parcels: [...matched.values()], matches };
}

/**
 * 적재에서 표시한 retired 행은 즉시 제외하고, 표시가 없는 옛 DB에는 두 질의 시점 규칙을 적용한다.
 * 현재 필지 규칙은 이름·겹침이 없어도 중심점과 PNU 재구획 증거가 있으면 동작한다.
 */
export function filterRetiredRows(rows: BuildingRow[], evidence: RetirementEvidence = {}): { rows: BuildingRow[]; retirement: BuildingRetirementInfo } {
  const marked = rows.filter((row) => row.hit.properties.retired === true || row.hit.properties.retired === "true");
  const markedIds = new Set(marked.map((row) => row.hit.featureId));
  const active = rows.filter((row) => !markedIds.has(row.hit.featureId));
  const gis = active.filter((row) => row.hit.stableId.startsWith("building:"));
  const juso = active.filter((row) => row.hit.stableId.startsWith("juso:") && areal(row.hit.geometry));
  const byCell = new Map<string, LegacyJusoCandidate[]>();
  for (const row of juso) {
    const candidate = { row, box: bbox(row.hit.geometry as ArealGeometry), name: normalizeBuildingName(row.hit.name) };
    for (let ix = Math.floor(candidate.box[0] / RETIREMENT_CELL_M); ix <= Math.floor(candidate.box[2] / RETIREMENT_CELL_M); ix++) {
      for (let iy = Math.floor(candidate.box[1] / RETIREMENT_CELL_M); iy <= Math.floor(candidate.box[3] / RETIREMENT_CELL_M); iy++) {
        const key = ix + ":" + iy;
        const cell = byCell.get(key);
        if (cell) cell.push(candidate);
        else byCell.set(key, [candidate]);
      }
    }
  }

  const parcelsByCell = evidence.currentParcelMatches ? null : new Map<string, CurrentParcelCandidate[]>();
  if (parcelsByCell) {
    for (const hit of evidence.currentParcels ?? []) {
      if (!hit.pnu || !areal(hit.geometry)) continue;
      const approvalDate = evidence.approvalByPnu?.get(hit.pnu) ?? null;
      if (!approvalDate) continue;
      const candidate = { hit, box: bbox(hit.geometry), approvalDate };
      for (const key of cellKeys(candidate.box, RETIREMENT_PARCEL_CELL_M)) {
        const cell = parcelsByCell.get(key);
        if (cell) cell.push(candidate);
        else parcelsByCell.set(key, [candidate]);
      }
    }
  }
  const excluded = new Set<number>();
  const legacyExcluded = new Set<number>();
  const currentParcelExcluded = new Set<number>();
  let candidatePairs = 0;
  let currentParcelCandidatePairs = 0;
  for (const old of gis) {
    if (!areal(old.hit.geometry)) continue;
    const oldYear = old.approvalDate ? Number(old.approvalDate.slice(0, 4)) : NaN;
    const minCurrentApproval = old.approvalDate ? approvalThresholdAfter(old.approvalDate, RETIRED_MIN_APPROVAL_GAP_YEARS) : null;

    // 현재 필지는 GIS/juso 이름이나 footprint 겹침을 요구하지 않는다. 재건축으로
    // 건물 중심이 들어간 연속지적도 필지가 새 단지 필지로 바뀌었는지를 본다.
    if (old.hit.pnu && minCurrentApproval && Number.isInteger(oldYear) && oldYear <= RETIRED_GIS_MAX_APPROVAL_YEAR) {
      if (evidence.currentParcelMatches) {
        for (const current of evidence.currentParcelMatches.get(old.hit.featureId) ?? []) {
          const approvalDate = current.pnu ? evidence.approvalByPnu?.get(current.pnu) ?? null : null;
          if (current.pnu === old.hit.pnu || !approvalDate || approvalDate < minCurrentApproval) continue;
          currentParcelCandidatePairs += 1;
          currentParcelExcluded.add(old.hit.featureId);
          excluded.add(old.hit.featureId);
          break;
        }
      } else {
        const center = geometryCentroid(old.hit.geometry);
        if (center) {
          const candidates = parcelsByCell?.get(Math.floor(center[0] / RETIREMENT_PARCEL_CELL_M) + ":" + Math.floor(center[1] / RETIREMENT_PARCEL_CELL_M)) ?? [];
          for (const current of candidates) {
            if (current.hit.pnu === old.hit.pnu) continue;
            if (current.approvalDate < minCurrentApproval) continue;
            if (!pointInParcel(center, current)) continue;
            currentParcelCandidatePairs += 1;
            currentParcelExcluded.add(old.hit.featureId);
            excluded.add(old.hit.featureId);
            break;
          }
        }
      }
    }

    const oldName = normalizeBuildingName(old.hit.name);
    if (!oldName || !Number.isInteger(oldYear) || oldYear > RETIRED_GIS_MAX_APPROVAL_YEAR) continue;
    const oldArea = planarArea(old.hit.geometry);
    if (!(oldArea > 0)) continue;
    const oldBox = bbox(old.hit.geometry);
    const candidates = new Map<number, LegacyJusoCandidate>();
    for (const key of cellKeys(oldBox)) for (const current of byCell.get(key) ?? []) {
      candidates.set(current.row.hit.featureId, current);
    }
    for (const current of candidates.values()) {
      const currentName = current.name;
      if (!currentName || currentName === oldName || !current.row.approvalDate || current.row.approvalDate <= old.approvalDate!) continue;
      const intersectionMinX = Math.max(oldBox[0], current.box[0]);
      const intersectionMaxX = Math.min(oldBox[2], current.box[2]);
      const intersectionMinY = Math.max(oldBox[1], current.box[1]);
      const intersectionMaxY = Math.min(oldBox[3], current.box[3]);
      if (intersectionMaxX <= intersectionMinX || intersectionMaxY <= intersectionMinY || ((intersectionMaxX - intersectionMinX) * (intersectionMaxY - intersectionMinY)) / oldArea < RETIRED_MIN_OVERLAP_RATIO) continue;
      const overlapRatio = overlapArea(old.hit.geometry, current.row.hit.geometry as ArealGeometry) / oldArea;
      if (overlapRatio < RETIRED_MIN_OVERLAP_RATIO || overlapRatio >= RETIRED_MAX_OVERLAP_RATIO) continue;
      candidatePairs += 1;
      legacyExcluded.add(old.hit.featureId);
      excluded.add(old.hit.featureId);
    }
  }
  const excludedStableIds = rows.filter((row) => markedIds.has(row.hit.featureId) || excluded.has(row.hit.featureId)).map((row) => row.hit.stableId);
  return {
    rows: active.filter((row) => !excluded.has(row.hit.featureId)),
    retirement: {
      candidatePairs,
      ingestMarkedCount: marked.length,
      legacyCandidatePairs: candidatePairs,
      legacyExcludedCount: legacyExcluded.size,
      currentParcelCandidatePairs,
      currentParcelExcludedCount: currentParcelExcluded.size,
      excludedCount: excludedStableIds.length,
      excludedStableIds,
    },
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
      .prepare(`SELECT feature_id, height_m, height_method, floors_above, use_code, approval_date, gross_floor_area_m2, footprint_area_m2, field_provenance_json FROM building_fact WHERE feature_id IN (${chunk.map(() => "?").join(",")})`)
      .all(...chunk.map((hit) => hit.featureId)) as Array<Record<string, unknown>>;
    const byFeature = new Map(rows.map((row) => [row.feature_id as number, row]));
    for (const hit of chunk) {
      const row = byFeature.get(hit.featureId);
      const rawHeightM = positiveNumber(row?.height_m);
      const rawFloorsAbove = positiveNumber(row?.floors_above);
      const rawHeightMethod = storedHeightMethod(row?.height_method);
      const normalizedHeightMethod = heightMethod(row?.height_method);
      const assumed = rawHeightM === null && rawFloorsAbove === null && rawHeightMethod === "unknown";
      const factApproval = typeof row?.approval_date === "string" ? row.approval_date : null;
      const ledgerDate = hit.stableId.startsWith("juso:") && hit.pnu ? ledgerApproval.get(hit.pnu) ?? null : null;
      let factApprovalSource: "building_fact" | "ledger_title" = "building_fact";
      if (factApproval) {
        try {
          const provenance = JSON.parse(String((row as { field_provenance_json?: unknown })?.field_provenance_json ?? "{}")) as { approval_date?: { source?: unknown } };
          if (typeof provenance.approval_date?.source === "string" && provenance.approval_date.source.startsWith("ledger.title")) factApprovalSource = "ledger_title";
        } catch {
          // provenance is optional evidence; the date itself remains usable.
        }
      }
      out.push({
        hit,
        heightM: assumed ? FLOOR_HEIGHT_M : rawHeightM,
        heightMethod: assumed ? "assumed_one_floor" : normalizedHeightMethod,
        floorsAbove: assumed ? 1 : rawFloorsAbove,
        rawHeightM,
        rawFloorsAbove,
        rawHeightMethod,
        useCode: typeof row?.use_code === "string" ? row.use_code : null,
        approvalDate: factApproval ?? ledgerDate,
        approvalDateSource: factApproval ? factApprovalSource : ledgerDate ? "core_ledger_pnu" : null,
        grossFloorM2: positiveNumber(row?.gross_floor_area_m2),
        footprintM2: positiveNumber(row?.footprint_area_m2),
      });
    }
  }
  const currentParcelHitsForRadius = currentParcelHits(ctx, out, radiusM);
  const currentParcelEvidence = currentParcelCandidates(ctx, out, currentParcelHitsForRadius, radiusM);
  ledgerApprovalByPnu(ctx, currentParcelEvidence.parcels.filter((hit) => hit.pnu).map((hit) => hit.pnu!));
  const filtered = filterRetiredRows(out, { currentParcels: currentParcelEvidence.parcels, currentParcelMatches: currentParcelEvidence.matches, approvalByPnu: ledgerApproval });
  return { rows: supplementTopoBuildings(ctx, filtered.rows, radiusM), retirement: filtered.retirement };
}

/** 한 분석에서 같은 반경의 건물 행·fact 결합을 여러 타일이 공유한다. */
export function buildingRows(ctx: EngineContext, radiusM = ctx.input.radiusM): BuildingRow[] | null {
  const selection = ctx.memo("buildings:selection:" + radiusM, () => buildingRowsUncached(ctx, radiusM));
  (ctx as SupplementStateContext).topoBuildingSupplementApplied = supplementState(ctx).get(radiusM) ?? false;
  return selection?.rows ?? null;
}

/** 철거 잔존 후보를 제외한 사실을 타일 limitations에 공통으로 남긴다. */
export function buildingRetirementLimitations(ctx: EngineContext, radiusM = ctx.input.radiusM): Array<{ kind: "partial"; note: string }> {
  const selection = ctx.memo("buildings:selection:" + radiusM, () => buildingRowsUncached(ctx, radiusM));
  const info = selection?.retirement;
  if (!info || info.excludedCount === 0) return [];
  const notes: string[] = [];
  if (info.ingestMarkedCount > 0) {
    notes.push("적재 단계에서 core PNU 승인일·이름·겹침 근거로 대체됨(retired) 표시한 GIS " + info.ingestMarkedCount + "동을 제외했습니다");
  }
  if (info.legacyCandidatePairs > 0) {
    notes.push("retired 표시가 없는 구버전 DB에서는 도로명주소 보충 도형과 " + RETIRED_MIN_OVERLAP_RATIO * 100 + "% 이상 " + RETIRED_MAX_OVERLAP_RATIO * 100 + "% 미만 겹치고 GIS 사용승인일이 " + RETIRED_GIS_MAX_APPROVAL_YEAR + "년 이하인 옛 건물 중, 대장 PNU 준공일이 더 최신이고 건물명이 다른 " + info.legacyCandidatePairs + " pair(" + info.legacyExcludedCount + "동)를 호환 규칙으로 제외했습니다");
  }
  if (info.currentParcelCandidatePairs > 0) {
    notes.push("현재 필지(parcels) 안에 발자국 중심점이 있고 그 필지의 core 공동주택·오피스텔 승인일이 GIS 승인일보다 최소 " + RETIRED_MIN_APPROVAL_GAP_YEARS + "년 새로우며 GIS PNU와 달라 재구획 근거가 확인된 옛 건물 " + info.currentParcelExcludedCount + "동을 제외했습니다");
  }
  return [{
    kind: "partial",
    note: notes.join(". ") + ". 이름·PNU·겹침 또는 현재 필지 근거가 없는 후보는 오탐 방지를 위해 유지했습니다.",
  }];
}

export function buildingRetirementInfo(ctx: EngineContext, radiusM = ctx.input.radiusM): BuildingRetirementInfo | null {
  return ctx.memo("buildings:selection:" + radiusM, () => buildingRowsUncached(ctx, radiusM))?.retirement ?? null;
}
