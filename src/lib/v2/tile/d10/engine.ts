/** D10 수관·녹지 — VWorld 항공영상 수관 검출과 OSM 보조층. */
import type { Feature, MultiPolygon as GeoMultiPolygon, Polygon as GeoPolygon, Position } from "geojson";
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../../engine/context";
import { featureCollection, multiPolygon, polygon, union } from "@turf/turf";
import { VWORLD_WMTS_SOURCE } from "../d01/engine";
import { areaInCircle, polygonArea } from "../../engine/tiles/geo";
import { canopyCellStats, canopyFor, CANOPY_ASSUMED_HEIGHT_M, type CanopyForOptions } from "../../engine/tiles/canopy-shared";
import { est, makeTile, missing, obs, polygonCandidate, type PolygonCandidate } from "../../engine/tiles/common";
import { notProvided } from "../../engine/tiles/not-provided";

const circleArea = (radiusM: number) => Math.PI * radiusM ** 2;
const percent = (part: number, whole: number) => whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

type OsmLayer = "osm_green" | "osm_water";

const OSM_CLASS_LABELS: Readonly<Record<string, string>> = {
  forest: "산림",
  wood: "산림",
  park: "공원",
  nature_reserve: "공원",
  recreation_ground: "공원",
  garden: "공원",
  grass: "초지",
  meadow: "초지",
  heath: "초지",
  scrub: "초지",
  orchard: "과수원",
  vineyard: "과수원",
  allotments: "과수원",
  water: "수역",
  reservoir: "수역",
  river: "수역",
  riverbank: "수역",
  basin: "수역",
  wetland: "습지",
};

function osmLabel(hit: { name: string | null; properties: Record<string, unknown> }, _kind: "landuse" | "water"): string | null {
  const cls = typeof hit.properties.cls === "string" ? hit.properties.cls.trim().toLowerCase() : "";
  const name = typeof hit.name === "string" ? hit.name.trim() : "";
  return name || OSM_CLASS_LABELS[cls] || null;
}

type ClippedParts = number[][][][];

function osmPolygons(ctx: EngineContext, sourceId: "osm_landuse" | "osm_water", kind: "landuse" | "water", layer: OsmLayer): { polygons: PolygonCandidate[]; areaM2: number; hits: number; parts: ClippedParts } {
  const sources = ctx.sources("reference", [sourceId]);
  if (sources.length === 0) return { polygons: [], areaM2: 0, hits: 0, parts: [] };
  const polygons: PolygonCandidate[] = [];
  const parts: ClippedParts = [];
  let areaM2 = 0;
  const hits = ctx.hits("reference", [kind]);
  for (const hit of hits) {
    const clipped = areaInCircle(ctx.input.center, ctx.input.radiusM, hit.geometry);
    if (!clipped || clipped.areaM2 <= 0) continue;
    areaM2 += clipped.areaM2;
    parts.push(...clipped.parts);
    for (const rings of clipped.parts) {
      const area = polygonArea(rings);
      const candidate = polygonCandidate(hit.featureId, layer, rings, area, null, {
        name: osmLabel(hit, kind),
        sublabel: null,
        labelPriority: 0,
      });
      if (candidate) polygons.push(candidate);
    }
  }
  return { polygons, areaM2, hits: hits.length, parts };
}

function topoWaterPolygons(ctx: EngineContext): { polygons: PolygonCandidate[]; parts: ClippedParts; applied: boolean } {
  if (!ctx.topo) return { polygons: [], parts: [], applied: false };
  const polygons: PolygonCandidate[] = [];
  const parts: ClippedParts = [];
  for (const hit of ctx.topo.hits(["topo_water"])) {
    const clipped = areaInCircle(ctx.input.center, ctx.input.radiusM, hit.geometry);
    if (!clipped || clipped.areaM2 <= 0) continue;
    let added = false;
    for (const rings of clipped.parts) {
      const candidate = polygonCandidate(hit.featureId, "water", rings, polygonArea(rings), null, {
        name: osmLabel(hit, "water"),
        sublabel: null,
        labelPriority: 0,
      });
      if (candidate) {
        polygons.push(candidate);
        added = true;
      }
    }
    if (added) parts.push(...clipped.parts);
  }
  return { polygons, parts, applied: polygons.length > 0 };
}

function polygonAreaOfParts(parts: ClippedParts): number {
  if (parts.length === 0) return 0;
  try {
    const features = parts.map((rings) => rings.length === 1 ? polygon(rings as Position[][]) : multiPolygon(rings as unknown as Position[][][])) as Array<Feature<GeoPolygon | GeoMultiPolygon>>;
    const merged = union(featureCollection(features as never) as never) as Feature<GeoPolygon | GeoMultiPolygon> | null;
    if (!merged) return parts.reduce((sum, rings) => sum + polygonArea(rings), 0);
    if (merged.geometry.type === "Polygon") return polygonArea(merged.geometry.coordinates);
    if (merged.geometry.type === "MultiPolygon") return merged.geometry.coordinates.reduce((sum, rings) => sum + polygonArea(rings), 0);
  } catch {
    // Invalid source geometry should not make D10 fail; retain the pre-union area as a bounded fallback.
  }
  return parts.reduce((sum, rings) => sum + polygonArea(rings), 0);
}

function pointInRing(point: [number, number], ring: number[][]): boolean {
  let inside = false;
  for (let i = 1, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i];
    const [px, py] = ring[j];
    const intersects = (y > point[1]) !== (py > point[1]) && point[0] < ((px - x) * (point[1] - y)) / (py - y) + x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInParts(point: [number, number], parts: number[][][][]): boolean {
  return parts.some((rings) => pointInRing(point, rings[0]) && !rings.slice(1).some((hole) => pointInRing(point, hole)));
}

function siteCanopyPct(ctx: EngineContext, canopy: ReturnType<typeof canopyFor>): ReturnType<typeof est> | ReturnType<typeof missing> {
  if (!canopy) return missing("canopy_site_pct", "대지 수관 면적률", "%", "d10-canopy-site@2:대상 대지와 유효 항공영상이 없어 계산하지 않음");
  const geometries = ctx.input.site.geometry ? [ctx.input.site.geometry] : ctx.siteParcelHits().map((hit) => hit.geometry);
  const clips: Array<NonNullable<ReturnType<typeof areaInCircle>>> = [];
  for (const geometry of geometries) {
    const clipped = areaInCircle(ctx.input.center, ctx.input.radiusM, geometry);
    if (clipped && clipped.areaM2 > 0) clips.push(clipped);
  }
  const siteAreaM2 = clips.reduce((sum, clip) => sum + clip.areaM2, 0);
  if (clips.length === 0 || siteAreaM2 <= 0) return missing("canopy_site_pct", "대지 수관 면적률", "%", "d10-canopy-site@2:대상 필지 도형 교차면적을 계산하지 못함");
  let canopyCells = 0;
  for (let row = 0; row < canopy.grid.rows; row++) {
    for (let col = 0; col < canopy.grid.cols; col++) {
      const value = canopy.grid.values[row * canopy.grid.cols + col];
      if (value < 0.5 || !Number.isFinite(value)) continue;
      const x = canopy.grid.x0 + col * canopy.grid.cellM;
      const y = canopy.grid.y0 + row * canopy.grid.cellM;
      if (Math.hypot(x - canopy.grid.cx, y - canopy.grid.cy) > ctx.input.radiusM) continue;
      if (clips.some((clip) => pointInParts([x, y], clip.parts))) canopyCells += 1;
    }
  }
  return est("canopy_site_pct", "대지 수관 면적률", percent(canopyCells * canopy.grid.cellM ** 2, siteAreaM2), "%", "d10-canopy-site@2:대지 안 수관 셀 면적÷대지 반경 교차면적", Math.round(canopyCells * canopy.grid.cellM ** 2), Math.round(siteAreaM2));
}

export function d10(ctx: EngineContext, options: CanopyForOptions = {}): TileResult {
  const green = osmPolygons(ctx, "osm_landuse", "landuse", "osm_green");
  const water = osmPolygons(ctx, "osm_water", "water", "osm_water");
  const topoWater = topoWaterPolygons(ctx);
  const greenSources = ctx.sources("reference", ["osm_landuse"]);
  const waterSources = ctx.sources("reference", ["osm_water"]);
  const canopy = canopyFor(ctx, options);
  const hasOsm = greenSources.length > 0 || waterSources.length > 0;
  if (!canopy && !hasOsm && !topoWater.applied) return notProvided(ctx, "D10", "VWorld 항공영상과 OSM 녹지·수계 보조 자료를 확인하지 못했습니다.");

  const imagerySources = canopy ? [VWORLD_WMTS_SOURCE] : [];
  const canopyStats = canopy ? canopyCellStats(canopy.grid, ctx.input.radiusM) : null;
  const validAreaM2 = canopyStats ? canopyStats.valid * canopy!.grid.cellM ** 2 : 0;
  const canopyAreaM2 = canopyStats ? canopyStats.canopy * canopy!.grid.cellM ** 2 : 0;
  const canopyMetric = canopy
    ? est("canopy_pct", "반경 수관 면적률", percent(canopyAreaM2, validAreaM2), "%", "d10-canopy-share@1:유효 항공영상 수관 셀 면적÷유효 반경 셀 면적", Math.round(canopyAreaM2), Math.round(validAreaM2))
    : missing("canopy_pct", "반경 수관 면적률", "%", "d10-canopy-share@1:유효 항공영상 없음");
  const circleAreaM2 = circleArea(ctx.input.radiusM);
  const waterAreaM2 = topoWater.applied ? polygonAreaOfParts([...water.parts, ...topoWater.parts]) : water.areaM2;
  const waterAvailable = waterSources.length > 0 || topoWater.applied;
  const siteMetric = siteCanopyPct(ctx, canopy);
  const imageryFillMetric = canopy && canopy.totalTiles > 0
    ? obs("fill_imagery_pct", "항공영상 타일 채움률", percent(canopy.totalTiles - canopy.missingTiles, canopy.totalTiles), "%", "d10-imagery-fill@1:성공 타일÷요청 타일", canopy.totalTiles - canopy.missingTiles, canopy.totalTiles)
    : missing("fill_imagery_pct", "항공영상 타일 채움률", "%", "d10-imagery-fill@1:VWorld WMTS 타일을 받지 못함");
  const metrics: TileResult["metrics"] = [
    canopyMetric,
    siteMetric,
    imageryFillMetric,
    greenSources.length > 0
      ? obs("osm_green_pct", "OSM 녹지 면적률", Math.min(100, percent(green.areaM2, circleArea(ctx.input.radiusM))), "%", "d10-osm-green@1:OSM landuse 반경 교차면적÷π·r²", Math.round(green.areaM2), Math.round(circleArea(ctx.input.radiusM)))
      : missing("osm_green_pct", "OSM 녹지 면적률", "%", "d10-osm-green@1:OSM 토지이용 자료 확인 불가"),
    waterAvailable
      ? obs("osm_water_pct", "OSM 수계 면적률", Math.min(100, percent(waterAreaM2, circleArea(ctx.input.radiusM))), "%", "d10-osm-water@1:OSM water 반경 교차면적÷π·r²", Math.round(waterAreaM2), Math.round(circleArea(ctx.input.radiusM)))
      : missing("osm_water_pct", "OSM 수계 면적률", "%", "d10-osm-water@1:OSM 수계 자료 확인 불가"),
    canopy
      ? est("share_canopy_pct", "구성비: 수관", percent(canopyAreaM2, circleAreaM2), "%", "d10-share-layer@1:유효 항공영상 수관 셀의 반경 교차면적÷π·r²", Math.round(canopyAreaM2), Math.round(circleAreaM2))
      : missing("share_canopy_pct", "구성비: 수관", "%", "d10-share-layer@1:유효 항공영상 없음"),
    greenSources.length > 0
      ? obs("share_osm_green_pct", "구성비: OSM 녹지", percent(green.areaM2, circleAreaM2), "%", "d10-share-layer@1:OSM landuse 반경 교차면적÷π·r²", Math.round(green.areaM2), Math.round(circleAreaM2))
      : missing("share_osm_green_pct", "구성비: OSM 녹지", "%", "d10-share-layer@1:OSM 녹지 자료 확인 불가"),
    waterAvailable
      ? obs("share_osm_water_pct", "구성비: OSM 수계", percent(waterAreaM2, circleAreaM2), "%", "d10-share-layer@1:OSM water 반경 교차면적÷π·r²", Math.round(waterAreaM2), Math.round(circleAreaM2))
      : missing("share_osm_water_pct", "구성비: OSM 수계", "%", "d10-share-layer@1:OSM 수계 자료 확인 불가"),
    canopy
      ? est("exg_threshold", "ExG 검출 임계값", Math.round(canopy.threshold * 1000) / 1000, "ExG", "d10-exg-threshold@1:유효 항공영상 ExG Otsu 임계값(0.04~0.20)")
      : missing("exg_threshold", "ExG 검출 임계값", "ExG", "d10-exg-threshold@1:유효 항공영상 없음"),
  ];

  const status: TileResult["status"] = canopy && canopy.missingTiles === 0 ? "complete" : "partial";
  const sources = [...imagerySources, ...greenSources, ...waterSources, ...(topoWater.applied ? [ctx.topo!.source] : [])];
  const limitations: TileResult["limitations"] = [
    { kind: "estimated", note: "항공사진 색 지수(ExG) 기반 수관 검출 · 재현율 미검증(sitedia 공개 재현율 약 70% 수준 예상)" },
    { kind: "estimated", note: `수관 높이 ${CANOPY_ASSUMED_HEIGHT_M}m 가정(그림자·SVF 연결용)` },
    { kind: "unknown", note: "그림자 속 수목·잔디는 놓치거나 섞일 수 있음" },
    { kind: "unknown", note: "촬영시기 미확인" },
    { kind: "unknown", note: "VWorld 이용 허가 범위 안 분석·PPT 삽입 · © VWorld(국토교통부)" },
  ];
  if (!canopy) limitations.push({ kind: "not_provided", note: "VWorld 항공영상을 받지 못해 수관 래스터·수관 면을 계산하지 않았습니다." });
  if (canopy && canopy.missingTiles > 0) limitations.push({ kind: "partial", note: `VWorld 항공영상 ${canopy.missingTiles}/${canopy.totalTiles}개 타일을 받지 못해 유효 영역만 표시했습니다.` });
  if (greenSources.length === 0) limitations.push({ kind: "not_provided", note: "OSM 녹지 면 자료를 확인하지 못해 항공사진 수관과 별도인 보조층을 표시하지 않았습니다." });
  if (!waterAvailable) limitations.push({ kind: "not_provided", note: "OSM 수계 면 자료를 확인하지 못해 항공사진 수관과 별도인 보조층을 표시하지 않았습니다." });
  limitations.push({ kind: "unknown", note: "수관·OSM 녹지·OSM 수계는 독립 레이어라 서로 겹칠 수 있어 구성비 합이 100%가 아닐 수 있습니다. 수관 구성비의 분모는 π·반경²이며 항공영상 결측 영역은 분자에서 제외합니다." });

  const polygonCandidates: PolygonCandidate[] = [];
  if (canopy) {
    for (const [index, rings] of canopy.polygons.entries()) {
      const candidate = polygonCandidate(index + 1, "canopy", rings, polygonArea(rings));
      if (candidate) polygonCandidates.push(candidate);
    }
  }
  polygonCandidates.push(...green.polygons, ...water.polygons, ...topoWater.polygons);
  const basisMetricIds = metrics.filter((metric) => (metric.status === "estimated" || metric.status === "observed") && !metric.id.startsWith("share_")).map((metric) => metric.id);
  const canopyText = canopy ? `항공사진 검출 수관 ${canopyMetric.value?.toFixed(1)}%` : "항공사진 수관 자료 미확인";
  const greenText = greenSources.length > 0 ? `OSM 녹지 ${metrics.find((metric) => metric.id === "osm_green_pct")?.value?.toFixed(1)}%` : "OSM 녹지 자료 미확인";
  const sentence = `${canopyText}, ${greenText} → 항공사진 색 기반 수관과 OSM 녹지·수계를 분리해 표시한 현황 → 촬영시기·현장 수관과 녹지 경계는 원본과 현장에서 확인할 것`;
  const tile = makeTile(ctx, {
    code: "D10",
    type: "diagram",
    status,
    metrics,
    judgment: { ruleId: "D10-canopy@1", basisMetricIds, sentence, level: null, criteria: null },
    sources,
    layers: ["canopy", "osm_green", "osm_water", ...(topoWater.applied ? ["water"] : [])],
    polygons: polygonCandidates,
    limitations,
  });
  if (canopy) {
    const values = new Uint8Array(canopy.grid.values.length);
    values.fill(255);
    for (let index = 0; index < canopy.grid.values.length; index++) {
      const row = Math.floor(index / canopy.grid.cols);
      const col = index - row * canopy.grid.cols;
      const x = canopy.grid.x0 + col * canopy.grid.cellM;
      const y = canopy.grid.y0 + row * canopy.grid.cellM;
      if (Math.hypot(x - canopy.grid.cx, y - canopy.grid.cy) <= ctx.input.radiusM && Number.isFinite(canopy.grid.values[index])) {
        values[index] = canopy.grid.values[index] >= 0.5 ? 1 : 0;
      }
    }
    const ref = ctx.emitRaster("D10", {
      ref: {
        name: "canopy",
        kind: "mask",
        crs: "EPSG:5179",
        // canopy grid coordinates describe cell centers; RasterRef x0/y0 are
        // the outer edge of the first cell so the mask aligns with vectors.
        x0: canopy.grid.x0 - canopy.grid.cellM / 2,
        y0: canopy.grid.y0 - canopy.grid.cellM / 2,
        cellM: canopy.grid.cellM,
        cols: canopy.grid.cols,
        rows: canopy.grid.rows,
        dtype: "u8",
        bands: 1,
        scale: 1,
        offset: 0,
        nodata: 255,
        palette: "canopy",
        label: "수관 · 1m 격자",
      },
      values,
    });
    return { ...tile, presentation: { ...tile.presentation, basemap: "Satellite", rasters: [ref] } };
  }
  return tile;
}
