/** S02 반경 전체 일조·그림자 흐름. D21과 일조장은 sun-shared memo를 공유한다. */
import type { Geometry, Position } from "geojson";
import { toUtmk, type LngLat } from "../../crs";
import { parseTileResult, type TileResult } from "../../tile-result";
import { buildS02RasterTileResult, s02RasterData, type S02RasterField } from "../../sim/s02-tile";
import type { XY } from "../../sim/shadow";
import type { EngineContext, SourceRef } from "../context";
import {
  SUN_INFLUENCE_M,
  sunBuildingReady,
  sunDateValue,
  sunFieldsFor,
  sunGridFor,
  sunSources,
  horizonFor,
  type SunDateKey,
} from "./sun-shared";
import { polygonArea } from "./geo";
import { notProvided } from "./not-provided";

export const S02_INFLUENCE_M = SUN_INFLUENCE_M;
export const S02_SITE_HALF_M = 30;
const PARCEL_SOURCES = ["parcel_polygon"] as const;
const S02_DATE_KEYS = ["spring", "summer", "autumn", "winter", "analysis"] as const;

function ringPositions(positions: readonly Position[] | undefined): XY[] {
  if (!positions) return [];
  const ring = positions
    .filter((position): position is Position & [number, number] => position.length >= 2 && Number.isFinite(position[0]) && Number.isFinite(position[1]))
    .map((position) => [position[0], position[1]] as XY);
  if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
  return ring.length >= 3 ? ring : [];
}

function outerRings(geometry: Geometry): XY[][] {
  if (geometry.type === "Polygon") {
    const ring = ringPositions(geometry.coordinates[0]);
    return ring.length >= 3 ? [ring] : [];
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.map((polygon) => ringPositions(polygon[0])).filter((ring) => ring.length >= 3);
  }
  return [];
}

function siteAround(center: LngLat): XY[] {
  const [cx, cy] = toUtmk(center);
  const half = S02_SITE_HALF_M;
  return [[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half]];
}

function parcelSite(ctx: EngineContext): { site: XY[]; siteKind: "parcel" | "box"; sources: SourceRef[] } {
  const db = ctx.db("parcels");
  const sources = db ? ctx.sources("parcels", PARCEL_SOURCES) : [];
  if (!db || !ctx.input.pnu || sources.length === 0) return { site: siteAround(ctx.input.center), siteKind: "box", sources: [] };
  const hit = ctx.hits("parcels", ["parcel"]).find((candidate) => candidate.pnu === ctx.input.pnu);
  if (!hit) return { site: siteAround(ctx.input.center), siteKind: "box", sources: [] };
  const rings = outerRings(hit.geometry);
  const site = rings.sort((a, b) => polygonArea([b.map(([x, y]) => [x, y])]) - polygonArea([a.map(([x, y]) => [x, y])]))[0];
  return site ? { site, siteKind: "parcel", sources } : { site: siteAround(ctx.input.center), siteKind: "box", sources: [] };
}

function coverageFor(ctx: EngineContext, siteKind: "parcel" | "box"): TileResult["limitations"] {
  return [
    ...ctx.coverage("buildings", ["building", "gis_bldg"]),
    ...(siteKind === "parcel" ? ctx.coverage("parcels", PARCEL_SOURCES) : []),
  ];
}

export interface S02Shared {
  grid: NonNullable<ReturnType<typeof sunGridFor>>;
  fields: S02RasterField[];
  site: XY[];
  siteKind: "parcel" | "box";
  sources: SourceRef[];
  coverage: TileResult["limitations"];
}

export function sunFieldBundleFor(ctx: EngineContext): S02Shared | null {
  return ctx.memo("s02:sun-field-bundle", () => {
    if (!sunBuildingReady(ctx)) return null;
    const grid = sunGridFor(ctx);
    if (!grid) return null;
    const parcel = parcelSite(ctx);
    const fieldsByDate = sunFieldsFor(ctx);
    const fields: S02RasterField[] = [];
    for (const key of S02_DATE_KEYS) {
      const field = fieldsByDate.get(key as SunDateKey) ?? null;
      if (!field) return null;
      fields.push({ key: key as SunDateKey, date: sunDateValue(ctx, key as SunDateKey), field });
    }
    return {
      grid,
      fields,
      site: parcel.site,
      siteKind: parcel.siteKind,
      sources: [...sunSources(ctx), ...parcel.sources],
      coverage: coverageFor(ctx, parcel.siteKind),
    };
  });
}

export function s02(ctx: EngineContext): TileResult {
  const shared = sunFieldBundleFor(ctx);
  if (!shared) return notProvided(ctx, "S02", "건물 자료 또는 building_fact 높이 열이 없어 반경 전체 일조장을 계산하지 못했습니다.");
  const refs = s02RasterData(shared.fields, shared.grid).map((item) => ctx.emitRaster("S02", item));
  return parseTileResult(buildS02RasterTileResult({
    analysisId: ctx.analysisId,
    address: ctx.input.address,
    center: [ctx.input.center[0], ctx.input.center[1]],
    radiusM: ctx.input.radiusM,
    manifestHash: ctx.manifestHash,
    sources: shared.sources,
    site: shared.site,
    siteKind: shared.siteKind,
    grid: shared.grid,
    fields: shared.fields,
    rasterRefs: refs,
    influenceM: SUN_INFLUENCE_M,
    terrain: horizonFor(ctx) ? "glo30-horizon" : "none",
    coverage: shared.coverage,
  }));
}
