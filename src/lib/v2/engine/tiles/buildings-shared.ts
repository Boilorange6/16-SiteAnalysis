import type BetterSqlite3 from "better-sqlite3";
import type { FeatureHit } from "../../data/features";
import type { EngineContext } from "../context";

export const BUILDING_SOURCES = ["building", "gis_bldg"] as const;

const FEATURE_COLUMNS = ["feature_id", "stable_id", "kind", "release_id", "geom_json", "name", "pnu", "legal_code", "properties_json"] as const;
const FACT_COLUMNS = ["feature_id", "height_m", "height_method", "floors_above", "use_code", "approval_date", "footprint_area_m2"] as const;

export interface BuildingRow {
  hit: FeatureHit;
  heightM: number | null;
  heightMethod: "source" | "floors_estimate" | "user" | "unknown";
  floorsAbove: number | null;
  useCode: string | null;
  approvalDate: string | null;
  footprintM2: number | null;
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
export function buildingRows(ctx: EngineContext, radiusM = ctx.input.radiusM): BuildingRow[] | null {
  if (!buildingsReady(ctx)) return null;
  const db = ctx.db("buildings");
  if (!db) return null;

  const hits = ctx.hits("buildings", ["building"], radiusM);
  const out: BuildingRow[] = [];
  for (let i = 0; i < hits.length; i += 500) {
    const chunk = hits.slice(i, i + 500);
    const rows = db
      .prepare(`SELECT feature_id, height_m, height_method, floors_above, use_code, approval_date, footprint_area_m2 FROM building_fact WHERE feature_id IN (${chunk.map(() => "?").join(",")})`)
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
        footprintM2: positiveNumber(row?.footprint_area_m2),
      });
    }
  }
  return out;
}
