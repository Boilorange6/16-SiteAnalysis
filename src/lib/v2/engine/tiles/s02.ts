/** S02 일조·그림자 — buildings 파일을 기존 기하학적 일조 계산기로 연결한다. */
import type BetterSqlite3 from "better-sqlite3";
import type { Geometry, Position } from "geojson";
import { toUtmk, type LngLat } from "../../crs";
import type { FeatureHit } from "../../data/features";
import { parseTileResult, type TileResult } from "../../tile-result";
import { buildS02TileResult, type S02Input } from "../../sim/s02-tile";
import type { Building, XY } from "../../sim/shadow";
import type { EngineContext } from "../context";
import { hitPoint } from "./common";
import { notProvided } from "./not-provided";

const BUILDING_SOURCES = ["building", "gis_bldg"] as const;
const FEATURE_COLUMNS = ["feature_id", "stable_id", "kind", "release_id", "geom_json", "name", "pnu", "legal_code", "properties_json"] as const;
/** 기존 시뮬레이터의 성능 검증 범위에 맞춘 엔진 입력 상한. */
export const S02_MAX_BUILDINGS = 200;
export const S02_INFLUENCE_M = 300;
export const S02_SITE_HALF_M = 30;
const S02_QUERY_RADIUS_M = 350;

interface BuildingFactRow {
  feature_id: number;
  height_m: unknown;
}

function columns(db: BetterSqlite3.Database, table: string): Set<string> {
  try {
    return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name));
  } catch {
    return new Set();
  }
}

function factByFeature(db: BetterSqlite3.Database, featureIds: number[]): Map<number, BuildingFactRow> {
  if (featureIds.length === 0) return new Map();
  const rows = db
    .prepare(`SELECT feature_id, height_m FROM building_fact WHERE feature_id IN (${featureIds.map(() => "?").join(",")})`)
    .all(...featureIds) as BuildingFactRow[];
  return new Map(rows.map((row) => [row.feature_id, row]));
}

function outerRings(geometry: Geometry): XY[][] {
  const ring = (positions: readonly Position[] | undefined): XY[] => {
    if (!positions) return [];
    return positions
      .filter((p): p is Position & [number, number] => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map((p) => [p[0], p[1]] as XY);
  };
  if (geometry.type === "Polygon") {
    const outer = ring(geometry.coordinates[0]);
    return outer.length >= 3 ? [outer] : [];
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.map((polygon) => ring(polygon[0])).filter((outer) => outer.length >= 3);
  }
  return [];
}

function heightOf(row: BuildingFactRow | undefined): number | null {
  return typeof row?.height_m === "number" && Number.isFinite(row.height_m) && row.height_m > 0 ? row.height_m : null;
}

function distanceToCenter(hit: FeatureHit, center: LngLat): number {
  const [x, y] = toUtmk(hitPoint(hit));
  const [cx, cy] = toUtmk(center);
  return Math.hypot(x - cx, y - cy);
}

function toSimBuildings(hits: FeatureHit[], facts: Map<number, BuildingFactRow>): Building[] {
  return hits.flatMap((hit) =>
    outerRings(hit.geometry).map((ring, index) => ({
      id: `${hit.stableId}#${index}`,
      ring,
      // floors_above is deliberately not converted here. The ingest builder already materializes
      // its floors×3m estimate in height_m; otherwise the simulator must count the height as unknown.
      heightM: heightOf(facts.get(hit.featureId)),
    })),
  );
}

function siteAround(center: LngLat): XY[] {
  const [cx, cy] = toUtmk(center);
  const h = S02_SITE_HALF_M;
  return [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]];
}

function dateParts(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`invalid analysis date: ${value}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function s02(ctx: EngineContext): TileResult {
  const sources = ctx.sources("buildings", BUILDING_SOURCES);
  const db = ctx.db("buildings");
  if (sources.length === 0 || !db) return notProvided(ctx, "S02");
  const featureColumns = columns(db, "feature");
  const factColumns = columns(db, "building_fact");
  if (!FEATURE_COLUMNS.every((column) => featureColumns.has(column)) || !factColumns.has("feature_id") || !factColumns.has("height_m")) return notProvided(ctx, "S02");

  const allHits = ctx.hits("buildings", ["building"], S02_QUERY_RADIUS_M);
  const ordered = allHits
    .map((hit) => ({ hit, distance: distanceToCenter(hit, ctx.input.center) }))
    .sort((a, b) => a.distance - b.distance || a.hit.featureId - b.hit.featureId);
  const hits = ordered.slice(0, S02_MAX_BUILDINGS).map(({ hit }) => hit);
  const facts = factByFeature(db, hits.map((h) => h.featureId));
  const date = dateParts(ctx.input.analysisDate);
  const input: S02Input = {
    analysisId: ctx.analysisId,
    tileId: `${ctx.analysisId}-S02`,
    address: ctx.input.address,
    center: [ctx.input.center[0], ctx.input.center[1]],
    radiusM: ctx.input.radiusM,
    manifestHash: ctx.manifestHash,
    sources,
    site: siteAround(ctx.input.center),
    buildings: toSimBuildings(hits, facts),
    latDeg: ctx.input.center[1],
    lonDeg: ctx.input.center[0],
    date,
    windowStartMin: 540,
    windowEndMin: 900,
    stepMin: 10,
    gridM: 2,
    influenceM: S02_INFLUENCE_M,
    removeBuildingsInSite: false,
    minContinuousHours: 2,
  };
  const result = buildS02TileResult(input);
  const coverage = ctx.coverage("buildings", BUILDING_SOURCES);
  const limitations: TileResult["limitations"] = [
    ...result.limitations,
    { kind: "estimated", note: `대지 경계 도형이 없어 중심점 주변 ${S02_SITE_HALF_M * 2}×${S02_SITE_HALF_M * 2}m 계산 영역을 사용했습니다.` },
    { kind: "estimated", note: `계산 영향 영역은 대지 경계에서 ${S02_INFLUENCE_M}m 안으로 제한했습니다.` },
    ...(allHits.length > hits.length ? [{ kind: "partial" as const, note: `성능을 위해 영향 영역 건물 ${allHits.length}개 중 가까운 ${hits.length}개만 계산했습니다.` }] : []),
    ...coverage,
  ];
  const status: TileResult["status"] = allHits.length > hits.length && result.status === "complete" ? "partial" : result.status;
  return parseTileResult({ ...result, status, limitations });
}
