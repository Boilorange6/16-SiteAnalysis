import { toUtmk } from "../crs";
import type { FeatureHit } from "../data/features";
import {
  SCENE_VERSION,
  SCENE_MAX_BUILDINGS,
  SCENE_MAX_PARCELS,
  parseScene,
  toLocalRing,
  type Ring,
  type Scene,
  type SceneBuilding,
  type SceneParcel,
} from "../scene";
import type { EngineContext, SourceRef } from "./context";
import { buildingRows, BUILDING_SOURCES } from "./tiles/buildings-shared";
import { polygonParts } from "./tiles/geo";
import { hitPoint } from "./tiles/common";

function localRings(hit: FeatureHit, origin: { x: number; y: number }): Ring[] {
  return polygonParts(hit.geometry).flatMap((rings) => rings.map((ring) => toLocalRing(ring, origin)));
}

function hitDistanceM(hit: FeatureHit, center: readonly [number, number]): number {
  const [x, y] = toUtmk(hitPoint(hit));
  const [cx, cy] = toUtmk(center);
  return Math.hypot(x - cx, y - cy);
}

function finiteArea(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function parcelArea(hit: FeatureHit): number {
  return finiteArea(hit.properties.areaM2);
}

function sourceKey(source: SourceRef): string {
  return `${source.sourceId}:${source.releaseId}`;
}

function uniqueSources(...groups: SourceRef[][]): SourceRef[] {
  const out: SourceRef[] = [];
  const seen = new Set<string>();
  for (const source of groups.flat()) {
    const key = sourceKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
}

function makeBuilding(row: NonNullable<ReturnType<typeof buildingRows>>[number], origin: { x: number; y: number }): SceneBuilding {
  return {
    id: row.hit.stableId,
    rings: localRings(row.hit, origin),
    heightM: row.heightM,
    heightMethod: row.heightMethod,
    floorsAbove: row.floorsAbove,
    useCode: row.useCode,
    approvalDate: row.approvalDate,
  };
}

function makeParcel(hit: FeatureHit, origin: { x: number; y: number }, sitePnu: string | null): SceneParcel | null {
  if (!hit.pnu) return null;
  const jimok = typeof hit.properties.jimok === "string" ? hit.properties.jimok : null;
  const areaM2 = typeof hit.properties.areaM2 === "number" && Number.isFinite(hit.properties.areaM2) && hit.properties.areaM2 >= 0
    ? hit.properties.areaM2
    : null;
  return {
    pnu: hit.pnu,
    rings: localRings(hit, origin),
    jimok,
    areaM2,
    isSite: hit.pnu === sitePnu,
  };
}

/** 건물·필지 도형을 내보내기와 S01이 함께 쓰는 대지 중심 로컬 장면으로 만든다. */
export function buildScene(ctx: EngineContext): Scene | null {
  const rows = buildingRows(ctx);
  if (!rows) return null;

  const [originX, originY] = toUtmk(ctx.input.center);
  const origin = { x: originX, y: originY };
  const buildingsByDistance = [...rows].sort((a, b) =>
    hitDistanceM(a.hit, ctx.input.center) - hitDistanceM(b.hit, ctx.input.center) || a.hit.featureId - b.hit.featureId,
  );
  const buildingHits = buildingsByDistance.slice(0, SCENE_MAX_BUILDINGS);
  const buildings = buildingHits.map((row) => makeBuilding(row, origin));

  const parcelsDb = ctx.db("parcels");
  const parcelHits = parcelsDb ? ctx.hits("parcels", ["parcel"]) : [];
  const parcelsByArea = [...parcelHits].sort((a, b) => parcelArea(b) - parcelArea(a) || a.featureId - b.featureId);
  const parcelHitsIncluded = parcelsByArea.slice(0, SCENE_MAX_PARCELS);
  const parcels = parcelHitsIncluded.map((hit) => makeParcel(hit, origin, ctx.input.pnu)).filter((parcel): parcel is SceneParcel => parcel !== null);
  const siteHit = parcelHits.find((hit) => hit.pnu === ctx.input.pnu);

  const limitations: Scene["limitations"] = [];
  if (rows.length > SCENE_MAX_BUILDINGS) {
    limitations.push({ kind: "partial", note: `건물 도형은 가까운 ${SCENE_MAX_BUILDINGS.toLocaleString()}동까지 장면에 포함했습니다.` });
  }
  if (parcelHits.length > SCENE_MAX_PARCELS) {
    limitations.push({ kind: "partial", note: `필지 도형은 면적이 큰 ${SCENE_MAX_PARCELS.toLocaleString()}필지까지 장면에 포함했습니다.` });
  }
  const unknownHeightCount = buildings.filter((building) => building.heightM === null).length;
  if (unknownHeightCount > 0) {
    limitations.push({ kind: "incomplete", note: `높이 미상 건물 ${unknownHeightCount.toLocaleString()}동은 바닥 모양만 포함했습니다.` });
  }
  if (!parcelsDb) {
    limitations.push({ kind: "not_provided", note: "필지 도형 미적재" });
  }

  const scene = {
    version: SCENE_VERSION,
    analysisId: ctx.analysisId,
    manifestHash: ctx.manifestHash,
    origin: { epsg: "EPSG:5179" as const, x: originX, y: originY, lng: ctx.input.center[0], lat: ctx.input.center[1] },
    radiusM: ctx.input.radiusM,
    groundZ: 0 as const,
    site: siteHit ? localRings(siteHit, origin) : null,
    buildings,
    parcels,
    counts: {
      buildingsTotal: rows.length,
      buildingsIncluded: buildings.length,
      parcelsTotal: parcelHits.length,
      parcelsIncluded: parcels.length,
    },
    sources: uniqueSources(
      ctx.sources("buildings", BUILDING_SOURCES),
      parcelsDb ? ctx.sources("parcels", ["parcel_polygon"]) : [],
    ),
    limitations,
  } satisfies Scene;
  return parseScene(scene);
}
