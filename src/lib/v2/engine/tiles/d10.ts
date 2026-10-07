/** D10 수관·녹지 — VWorld 항공영상 수관 검출과 OSM 보조층. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { VWORLD_WMTS_SOURCE } from "./d01";
import { areaInCircle, polygonArea } from "./geo";
import { canopyCellStats, canopyFor, CANOPY_ASSUMED_HEIGHT_M, type CanopyForOptions } from "./canopy-shared";
import { est, makeTile, missing, obs, polygonCandidate, type PolygonCandidate } from "./common";
import { notProvided } from "./not-provided";

const circleArea = (radiusM: number) => Math.PI * radiusM ** 2;
const percent = (part: number, whole: number) => whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

type OsmLayer = "osm_green" | "osm_water";

function osmPolygons(ctx: EngineContext, sourceId: "osm_landuse" | "osm_water", kind: "landuse" | "water", layer: OsmLayer): { polygons: PolygonCandidate[]; areaM2: number; hits: number } {
  const sources = ctx.sources("reference", [sourceId]);
  if (sources.length === 0) return { polygons: [], areaM2: 0, hits: 0 };
  const polygons: PolygonCandidate[] = [];
  let areaM2 = 0;
  const hits = ctx.hits("reference", [kind]);
  for (const hit of hits) {
    const clipped = areaInCircle(ctx.input.center, ctx.input.radiusM, hit.geometry);
    if (!clipped || clipped.areaM2 <= 0) continue;
    areaM2 += clipped.areaM2;
    for (const rings of clipped.parts) {
      const area = polygonArea(rings);
      const candidate = polygonCandidate(hit.featureId, layer, rings, area, hit.name);
      if (candidate) polygons.push(candidate);
    }
  }
  return { polygons, areaM2, hits: hits.length };
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
  const siteHit = ctx.siteParcelHits()[0];
  const geometry = ctx.input.site.geometry ?? siteHit?.geometry;
  if (!geometry || !canopy) return missing("canopy_site_pct", "대지 수관 면적률", "%", "d10-canopy-site@2:대상 대지와 유효 항공영상이 없어 계산하지 않음");
  const clipped = areaInCircle(ctx.input.center, ctx.input.radiusM, geometry);
  if (!clipped || clipped.areaM2 <= 0) return missing("canopy_site_pct", "대지 수관 면적률", "%", "d10-canopy-site@1:대상 필지 도형 교차면적을 계산하지 못함");
  let canopyCells = 0;
  for (let row = 0; row < canopy.grid.rows; row++) {
    for (let col = 0; col < canopy.grid.cols; col++) {
      const value = canopy.grid.values[row * canopy.grid.cols + col];
      if (value < 0.5 || !Number.isFinite(value)) continue;
      const x = canopy.grid.x0 + col * canopy.grid.cellM;
      const y = canopy.grid.y0 + row * canopy.grid.cellM;
      if (Math.hypot(x - canopy.grid.cx, y - canopy.grid.cy) > ctx.input.radiusM) continue;
      if (pointInParts([x, y], clipped.parts)) canopyCells += 1;
    }
  }
  return est("canopy_site_pct", "대지 수관 면적률", percent(canopyCells * canopy.grid.cellM ** 2, clipped.areaM2), "%", `d10-canopy-site@2:${ctx.input.site.kind === "polygon" ? "직접 그린 구역" : "대지"} 안 수관 셀 면적÷대지 반경 교차면적`, Math.round(canopyCells * canopy.grid.cellM ** 2), Math.round(clipped.areaM2));
}

export function d10(ctx: EngineContext, options: CanopyForOptions = {}): TileResult {
  const green = osmPolygons(ctx, "osm_landuse", "landuse", "osm_green");
  const water = osmPolygons(ctx, "osm_water", "water", "osm_water");
  const greenSources = ctx.sources("reference", ["osm_landuse"]);
  const waterSources = ctx.sources("reference", ["osm_water"]);
  const canopy = canopyFor(ctx, options);
  const hasOsm = greenSources.length > 0 || waterSources.length > 0;
  if (!canopy && !hasOsm) return notProvided(ctx, "D10", "VWorld 항공영상과 OSM 녹지·수계 보조 자료를 확인하지 못했습니다.");

  const imagerySources = canopy ? [VWORLD_WMTS_SOURCE] : [];
  const validAreaM2 = canopy ? canopyCellStats(canopy.grid, ctx.input.radiusM).valid * canopy.grid.cellM ** 2 : 0;
  const canopyAreaM2 = canopy ? canopyCellStats(canopy.grid, ctx.input.radiusM).canopy * canopy.grid.cellM ** 2 : 0;
  const imageryFill = canopy && canopy.totalTiles > 0 ? percent(canopy.totalTiles - canopy.missingTiles, canopy.totalTiles) : null;
  const canopyMetric = canopy
    ? est("canopy_pct", "반경 수관 면적률", percent(canopyAreaM2, validAreaM2), "%", "d10-canopy-share@1:유효 항공영상 수관 셀 면적÷유효 반경 셀 면적", Math.round(canopyAreaM2), Math.round(validAreaM2))
    : missing("canopy_pct", "반경 수관 면적률", "%", "d10-canopy-share@1:유효 항공영상 없음");
  const siteMetric = siteCanopyPct(ctx, canopy);
  const metrics: TileResult["metrics"] = [
    canopyMetric,
    siteMetric,
    imageryFill === null
      ? missing("fill_imagery_pct", "항공영상 타일 채움률", "%", "d10-imagery-fill@1:VWorld WMTS 타일을 받지 못함")
      : canopy && imageryFill !== null
        ? obs("fill_imagery_pct", "항공영상 타일 채움률", imageryFill, "%", "d10-imagery-fill@1:성공 타일÷요청 타일", canopy.totalTiles - canopy.missingTiles, canopy.totalTiles)
        : missing("fill_imagery_pct", "항공영상 타일 채움률", "%", "d10-imagery-fill@1:VWorld WMTS 타일을 받지 못함"),
    greenSources.length > 0
      ? obs("osm_green_pct", "OSM 녹지 면적률", Math.min(100, percent(green.areaM2, circleArea(ctx.input.radiusM))), "%", "d10-osm-green@1:OSM landuse 반경 교차면적÷π·r²", Math.round(green.areaM2), Math.round(circleArea(ctx.input.radiusM)))
      : missing("osm_green_pct", "OSM 녹지 면적률", "%", "d10-osm-green@1:OSM 토지이용 자료 확인 불가"),
    waterSources.length > 0
      ? obs("osm_water_pct", "OSM 수계 면적률", Math.min(100, percent(water.areaM2, circleArea(ctx.input.radiusM))), "%", "d10-osm-water@1:OSM water 반경 교차면적÷π·r²", Math.round(water.areaM2), Math.round(circleArea(ctx.input.radiusM)))
      : missing("osm_water_pct", "OSM 수계 면적률", "%", "d10-osm-water@1:OSM 수계 자료 확인 불가"),
    canopy
      ? est("exg_threshold", "ExG 검출 임계값", Math.round(canopy.threshold * 1000) / 1000, "ExG", "d10-exg-threshold@1:유효 항공영상 ExG Otsu 임계값(0.04~0.20)")
      : missing("exg_threshold", "ExG 검출 임계값", "ExG", "d10-exg-threshold@1:유효 항공영상 없음"),
  ];

  const status: TileResult["status"] = canopy && canopy.missingTiles === 0 ? "complete" : "partial";
  const sources = [...imagerySources, ...greenSources, ...waterSources];
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
  if (waterSources.length === 0) limitations.push({ kind: "not_provided", note: "OSM 수계 면 자료를 확인하지 못해 항공사진 수관과 별도인 보조층을 표시하지 않았습니다." });

  const polygonCandidates: PolygonCandidate[] = [];
  if (canopy) {
    for (const [index, rings] of canopy.polygons.entries()) {
      const candidate = polygonCandidate(index + 1, "canopy", rings, polygonArea(rings));
      if (candidate) polygonCandidates.push(candidate);
    }
  }
  polygonCandidates.push(...green.polygons, ...water.polygons);
  const basisMetricIds = metrics.filter((metric) => metric.status === "estimated" || metric.status === "observed").map((metric) => metric.id);
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
    layers: ["canopy", "osm_green", "osm_water"],
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
        x0: canopy.grid.x0,
        y0: canopy.grid.y0,
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
