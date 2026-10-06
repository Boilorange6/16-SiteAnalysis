import type BetterSqlite3 from "better-sqlite3";
import type { Geometry } from "geojson";
import { toUtmk } from "../../crs";
import type { FeatureHit } from "../../data/features";
import type { EngineContext } from "../context";

export const BUILDING_SOURCES = ["building", "gis_bldg"] as const;

const FEATURE_COLUMNS = ["feature_id", "stable_id", "kind", "release_id", "geom_json", "name", "pnu", "legal_code", "properties_json"] as const;
const FACT_COLUMNS = ["feature_id", "height_m", "height_method", "floors_above", "use_code", "approval_date", "gross_floor_area_m2", "footprint_area_m2"] as const;

export interface BuildingRow {
  hit: FeatureHit;
  heightM: number | null;
  heightMethod: "source" | "floors_estimate" | "user" | "unknown";
  floorsAbove: number | null;
  useCode: string | null;
  approvalDate: string | null;
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
  const [cx, cy] = ctx.memo("buildings:center-utmk", () => toUtmk(ctx.input.center));
  const c = geometryCentroid(row.hit.geometry);
  if (!c) return true; // 중심을 못 구하는 도형은 빼지 않는다(교차로 선택된 그대로 센다)
  return Math.hypot(c[0] - cx, c[1] - cy) <= ctx.input.radiusM;
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

/** 반경 안 building 히트와 building_fact를 결합한다. 파일·필수 열이 없으면 null. */
function buildingRowsUncached(ctx: EngineContext, radiusM: number): BuildingRow[] | null {
  if (!buildingsReady(ctx)) return null;
  const db = ctx.db("buildings");
  if (!db) return null;

  const hits = ctx.hits("buildings", ["building"], radiusM);
  const out: BuildingRow[] = [];
  for (let i = 0; i < hits.length; i += 500) {
    const chunk = hits.slice(i, i + 500);
    const rows = db
      .prepare(`SELECT feature_id, height_m, height_method, floors_above, use_code, approval_date, gross_floor_area_m2, footprint_area_m2 FROM building_fact WHERE feature_id IN (${chunk.map(() => "?").join(",")})`)
      .all(...chunk.map((hit) => hit.featureId)) as Array<Record<string, unknown>>;
    const byFeature = new Map(rows.map((row) => [row.feature_id as number, row]));
    for (const hit of chunk) {
      const row = byFeature.get(hit.featureId);
      out.push({
        hit,
        heightM: positiveNumber(row?.height_m),
        heightMethod: heightMethod(row?.height_method),
        floorsAbove: positiveNumber(row?.floors_above),
        useCode: typeof row?.use_code === "string" ? row.use_code : null,
        approvalDate: typeof row?.approval_date === "string" ? row.approval_date : null,
        grossFloorM2: positiveNumber(row?.gross_floor_area_m2),
        footprintM2: positiveNumber(row?.footprint_area_m2),
      });
    }
  }
  return out;
}

/** 한 분석에서 같은 반경의 건물 행·fact 결합을 여러 타일이 공유한다. */
export function buildingRows(ctx: EngineContext, radiusM = ctx.input.radiusM): BuildingRow[] | null {
  return ctx.memo(`buildings:rows:${radiusM}`, () => buildingRowsUncached(ctx, radiusM));
}
