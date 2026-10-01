/** S02 일조·그림자 — 대지 수광면과 정시 그림자를 만들고 D21과 계산을 공유한다. */
import type BetterSqlite3 from "better-sqlite3";
import type { Geometry, Position } from "geojson";
import { toUtmk, type LngLat } from "../../crs";
import type { FeatureHit } from "../../data/features";
import { parseTileResult, type TileResult } from "../../tile-result";
import { buildingShadow, pointInRings, type Building, type XY } from "../../sim/shadow";
import { kst, sunPosition } from "../../sim/sun";
import { computeSunlight, shadowSourcesFor, type SunlightResult } from "../../sim/sunlight";
import { buildS02TileResult, type S02Input, type S02Presentation, type S02ShadowParts } from "../../sim/s02-tile";
import type { EngineContext, SourceRef } from "../context";
import { areaInCircle, polygonArea } from "./geo";
import { hitPoint } from "./common";
import { notProvided } from "./not-provided";

const BUILDING_SOURCES = ["building", "gis_bldg"] as const;
const PARCEL_SOURCES = ["parcel_polygon"] as const;
const FEATURE_COLUMNS = ["feature_id", "stable_id", "kind", "release_id", "geom_json", "name", "pnu", "legal_code", "properties_json"] as const;
/** 기존 시뮬레이터의 성능 검증 범위에 맞춘 엔진 입력 상한. */
export const S02_MAX_BUILDINGS = 200;
export const S02_INFLUENCE_M = 300;
export const S02_SITE_HALF_M = 30;
const S02_MIN_QUERY_RADIUS_M = 350;
const CUT_HOURS = ["09", "12", "15"] as const;

export interface SunlightShared {
  result: SunlightResult;
  site: XY[];
  siteKind: "parcel" | "box";
  sources: SourceRef[];
  shadows: S02ShadowParts;
}

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

function openRing(ring: readonly XY[]): XY[] {
  const out = [...ring];
  if (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) out.pop();
  }
  return out;
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
      // floors_above is deliberately not converted here. The ingest builder already materializes
      // its floors×3m estimate in height_m; otherwise the simulator must count the height as unknown.
      ring,
      heightM: heightOf(facts.get(hit.featureId)),
    })),
  );
}

function siteAround(center: LngLat): XY[] {
  const [cx, cy] = toUtmk(center);
  const h = S02_SITE_HALF_M;
  return [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]];
}

function parcelSite(ctx: EngineContext): { site: XY[]; siteKind: "parcel" | "box"; sources: SourceRef[] } {
  const db = ctx.db("parcels");
  const sources = db ? ctx.sources("parcels", PARCEL_SOURCES) : [];
  if (!db || !ctx.input.pnu || sources.length === 0) return { site: siteAround(ctx.input.center), siteKind: "box", sources: [] };

  const hit = ctx.hits("parcels", ["parcel"]).find((candidate) => candidate.pnu === ctx.input.pnu);
  if (!hit) return { site: siteAround(ctx.input.center), siteKind: "box", sources: [] };
  const rings = outerRings(hit.geometry).map(openRing).filter((ring) => ring.length >= 3);
  const site = rings.sort((a, b) => polygonArea([b.map(([x, y]) => [x, y])]) - polygonArea([a.map(([x, y]) => [x, y])]))[0];
  return site ? { site, siteKind: "parcel", sources } : { site: siteAround(ctx.input.center), siteKind: "box", sources: [] };
}

function queryRadiusFor(center: LngLat, site: readonly XY[]): number {
  const [cx, cy] = toUtmk(center);
  const outerRadius = site.reduce((best, [x, y]) => Math.max(best, Math.hypot(x - cx, y - cy)), 0);
  // queryFeaturesInRadius accepts at most 5km; the input radius itself is already bounded by the engine.
  return Math.min(5000, Math.max(S02_MIN_QUERY_RADIUS_M, outerRadius + S02_INFLUENCE_M));
}

function dateParts(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`invalid analysis date: ${value}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function emptyShadows(): S02ShadowParts {
  return { "09": [], "12": [], "15": [] };
}

function distanceToSegment(point: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2));
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}

function withinInfluence(ring: readonly XY[], site: readonly XY[], radiusM: number): boolean {
  if (ring.some(([x, y]) => pointInRings(x, y, [site]))) return true;
  if (site.some(([x, y]) => pointInRings(x, y, [ring]))) return true;
  for (const point of ring) {
    for (let i = 0; i < site.length; i++) {
      if (distanceToSegment(point, site[i], site[(i + 1) % site.length]) <= radiusM) return true;
    }
  }
  return false;
}

function shadowsAtHours(buildings: readonly Building[], site: readonly XY[], center: LngLat, radiusM: number, latDeg: number, lonDeg: number, date: string, removeBuildingsInSite: boolean): S02ShadowParts {
  const { year, month, day } = dateParts(date);
  const shadows = emptyShadows();
  const shadowBuildings = shadowSourcesFor(buildings, site, removeBuildingsInSite);
  for (const hour of CUT_HOURS) {
    const sun = sunPosition(latDeg, lonDeg, kst(year, month, day, Number(hour)));
    for (const building of shadowBuildings) {
      if (!withinInfluence(building.ring, site, S02_INFLUENCE_M)) continue;
      const shadow = buildingShadow(building, sun);
      if (!shadow) continue;
      const clipped = areaInCircle(center, radiusM, shadow.geometry);
      if (clipped && clipped.parts.length > 0) shadows[hour].push(...clipped.parts);
    }
  }
  return shadows;
}

function computeShared(ctx: EngineContext): SunlightShared | null {
  const buildingSources = ctx.sources("buildings", BUILDING_SOURCES);
  const db = ctx.db("buildings");
  if (buildingSources.length === 0 || !db) return null;
  const featureColumns = columns(db, "feature");
  const factColumns = columns(db, "building_fact");
  if (!FEATURE_COLUMNS.every((column) => featureColumns.has(column)) || !factColumns.has("feature_id") || !factColumns.has("height_m")) return null;

  const parcel = parcelSite(ctx);
  const queryRadius = queryRadiusFor(ctx.input.center, parcel.site);
  const allHits = ctx.hits("buildings", ["building"], queryRadius);
  const hits = allHits
    .map((hit) => ({ hit, distance: distanceToCenter(hit, ctx.input.center) }))
    .sort((a, b) => a.distance - b.distance || a.hit.featureId - b.hit.featureId)
    .slice(0, S02_MAX_BUILDINGS)
    .map(({ hit }) => hit);
  const facts = factByFeature(db, hits.map((h) => h.featureId));
  const buildings = toSimBuildings(hits, facts);
  const date = dateParts(ctx.input.analysisDate);
  const sources = [...buildingSources, ...parcel.sources];
  const input: S02Input = {
    analysisId: ctx.analysisId,
    tileId: `${ctx.analysisId}-S02`,
    address: ctx.input.address,
    center: [ctx.input.center[0], ctx.input.center[1]],
    radiusM: ctx.input.radiusM,
    manifestHash: ctx.manifestHash,
    sources,
    site: parcel.site,
    siteKind: parcel.siteKind,
    buildings,
    latDeg: ctx.input.center[1],
    lonDeg: ctx.input.center[0],
    date,
    windowStartMin: 540,
    windowEndMin: 900,
    stepMin: 10,
    gridM: 2,
    influenceM: S02_INFLUENCE_M,
    removeBuildingsInSite: true,
    minContinuousHours: 2,
  };
  const result = computeSunlight(input);
  return {
    result,
    site: parcel.site,
    siteKind: parcel.siteKind,
    sources,
    shadows: shadowsAtHours(buildings, parcel.site, ctx.input.center, ctx.input.radiusM, ctx.input.center[1], ctx.input.center[0], ctx.input.analysisDate, true),
  };
}

/** ctx.memo("s02:sunlight") — D21(T13)이 같은 계산 결과를 그대로 쓴다. */
export function sunlightFor(ctx: EngineContext): SunlightShared | null {
  return ctx.memo("s02:sunlight", () => computeShared(ctx));
}

export function s02(ctx: EngineContext): TileResult {
  const shared = sunlightFor(ctx);
  if (!shared) return notProvided(ctx, "S02");

  const input: S02Input = {
    analysisId: ctx.analysisId,
    tileId: `${ctx.analysisId}-S02`,
    address: ctx.input.address,
    center: [ctx.input.center[0], ctx.input.center[1]],
    radiusM: ctx.input.radiusM,
    manifestHash: ctx.manifestHash,
    sources: shared.sources,
    site: shared.site,
    siteKind: shared.siteKind,
    // precomputed is supplied below; this field is not read when assembling the shared result.
    buildings: [],
    latDeg: ctx.input.center[1],
    lonDeg: ctx.input.center[0],
    date: dateParts(ctx.input.analysisDate),
    windowStartMin: 540,
    windowEndMin: 900,
    stepMin: 10,
    gridM: 2,
    influenceM: S02_INFLUENCE_M,
    removeBuildingsInSite: true,
    minContinuousHours: 2,
  };
  const visual: S02Presentation = { site: shared.site, shadows: shared.shadows };
  const result = buildS02TileResult(input, shared.result, visual);
  const parcelSources = shared.siteKind === "parcel" ? ctx.sources("parcels", PARCEL_SOURCES) : [];
  const queryRadius = queryRadiusFor(ctx.input.center, shared.site);
  const allHits = ctx.hits("buildings", ["building"], queryRadius);
  const coverage = [
    ...ctx.coverage("buildings", BUILDING_SOURCES),
    ...(parcelSources.length > 0 ? ctx.coverage("parcels", PARCEL_SOURCES) : []),
  ];
  const limitations: TileResult["limitations"] = [
    ...result.limitations,
    shared.siteKind === "parcel"
      ? { kind: "estimated" as const, note: "대상 필지 도형을 수광면으로 사용했습니다(지붕·창면 아님)." }
      : { kind: "estimated" as const, note: `대상 필지 도형이 없어 중심점 주변 ${S02_SITE_HALF_M * 2}×${S02_SITE_HALF_M * 2}m 계산 영역을 사용했습니다.` },
    { kind: "estimated", note: `계산 영향 영역은 수광면에서 ${S02_INFLUENCE_M}m 안으로 제한했습니다.` },
    ...(allHits.length > S02_MAX_BUILDINGS ? [{ kind: "partial" as const, note: `성능을 위해 영향 영역 건물 ${allHits.length}개 중 가까운 ${S02_MAX_BUILDINGS}개만 계산했습니다.` }] : []),
    ...coverage,
  ];
  const partial = allHits.length > S02_MAX_BUILDINGS || coverage.some((limitation) => limitation.kind === "partial" || limitation.kind === "incomplete");
  const status: TileResult["status"] = partial && result.status === "complete" ? "partial" : result.status;
  return parseTileResult({ ...result, status, limitations });
}
