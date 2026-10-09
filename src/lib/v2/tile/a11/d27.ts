/** D27 인구 — 1km 격자 밀도 구간과 원∩격자 면적비 도판. */
import type { Geometry } from "geojson";
import type { FeatureHit } from "../../data/features";
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../../engine/context";
import { populationCells, SGIS_GRID_LIMITATION } from "./engine";
import { est, makeTile, missing, polygonCandidate, type PolygonCandidate, type TileDraft } from "../../engine/tiles/common";
import { areaInCircle, polygonArea } from "../../engine/tiles/geo";
import { notProvided } from "../../engine/tiles/not-provided";
import { formatMetricValue } from "../../ui/tile-view";

const DENSITY_LAYERS = ["pop_dens_0", "pop_dens_1", "pop_dens_2", "pop_dens_3", "pop_dens_4", "pop_dens_5"] as const;
const LAYERS = [...DENSITY_LAYERS, "pop_grid_na"] as const;

interface Cell {
  hit: FeatureHit;
  overlapM2: number;
  population: number | null;
  densityBand: number | null;
}

function densityBand(population: number, cellSizeM: number): number {
  const density = population / ((cellSizeM * cellSizeM) / 1e6);
  if (density <= 0) return 0;
  if (density < 1000) return 1;
  if (density < 5000) return 2;
  if (density < 10000) return 3;
  if (density < 20000) return 4;
  return 5;
}

const DENSITY_LABELS = ["0명/㎢", "0~1,000명/㎢", "1,000~5,000명/㎢", "5,000~10,000명/㎢", "10,000~20,000명/㎢", "20,000명/㎢ 이상"] as const;

const pct = (part: number, whole: number) => Math.round((part / whole) * 1000) / 10;

function squareFor(hit: FeatureHit, sizeM: number): { geometry: Geometry; center: [number, number] } | null {
  if (hit.geometry.type !== "Point") return null;
  const [x, y] = hit.geometry.coordinates;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const half = sizeM / 2;
  return {
    center: [x, y],
    geometry: {
      type: "Polygon",
      coordinates: [[
        [x - half, y - half],
        [x + half, y - half],
        [x + half, y + half],
        [x - half, y + half],
        [x - half, y - half],
      ]],
    },
  };
}

export function d27(ctx: EngineContext): TileResult {
  const sources = ctx.sources("reference", ["sgis_grid"]);
  if (sources.length === 0) return notProvided(ctx, "D27");

  const radiusM = ctx.input.radiusM;
  const circleM2 = Math.PI * radiusM * radiusM;
  const cells: Cell[] = [];
  const polygons: PolygonCandidate[] = [];
  let clipFailed = 0;

  for (const sourceCell of populationCells(ctx)) {
    const { hit, sizeM, overlapM2, population } = sourceCell;
    const square = squareFor(hit, sizeM);
    if (!square) continue;
    const cell: Cell = {
      hit,
      overlapM2,
      population,
      densityBand: population === null ? null : densityBand(population, sizeM),
    };
    cells.push(cell);

    const layer = cell.densityBand === null ? "pop_grid_na" : DENSITY_LAYERS[cell.densityBand];
    const clipped = areaInCircle(ctx.input.center, radiusM, square.geometry);
    if (clipped === null) {
      clipFailed++;
      continue;
    }
    for (const rings of clipped.parts) {
      const areaM2 = polygonArea(rings);
      const polygon = areaM2 > 0
        ? polygonCandidate(hit.featureId, layer, rings, areaM2, null, {
            name: null,
            sublabel: population === null ? null : `${formatMetricValue(population, "명")}명`,
            labelPriority: 0,
          })
        : null;
      if (polygon) polygons.push(polygon);
    }
  }

  cells.sort((a, b) => a.hit.featureId - b.hit.featureId);
  const publicCells = cells.filter((cell) => cell.population !== null);
  const suppressedCells = cells.filter((cell) => cell.population === null);
  const publicM2 = publicCells.reduce((sum, cell) => sum + cell.overlapM2, 0);
  const suppressedM2 = suppressedCells.reduce((sum, cell) => sum + cell.overlapM2, 0);
  const coveredM2 = publicM2 + suppressedM2;
  const byBand = DENSITY_LAYERS.map((_, band) => cells.filter((cell) => cell.densityBand === band).reduce((sum, cell) => sum + cell.overlapM2, 0));

  const fillFormula = "d27-fill-public@1:공개 격자 원∩격자 면적÷π·r²";
  const shareFormula = "d27-share-density@1:밀도 구간별 원∩격자 면적÷π·r²";
  const naFormula = "d27-back-na@1:비공개 격자 원∩격자 면적÷π·r²";
  const metrics: TileDraft["metrics"] = cells.length === 0
    ? [
        missing("fill_public_pct", "공개 격자 면적 채움률", "%", fillFormula),
        ...DENSITY_LAYERS.map((_, band) => missing(`share_dens_${band}`, `인구밀도 ${DENSITY_LABELS[band]} 면적 구성비`, "%", shareFormula)),
        missing("back_na_pct", "비공개 격자 면적", "%", naFormula),
      ]
    : [
        est("fill_public_pct", "공개 격자 면적 채움률", pct(publicM2, circleM2), "%", fillFormula, publicM2, circleM2),
        ...DENSITY_LAYERS.map((_, band) => est(`share_dens_${band}`, `인구밀도 ${DENSITY_LABELS[band]} 면적 구성비`, pct(byBand[band], circleM2), "%", shareFormula, byBand[band], circleM2)),
        est("back_na_pct", "비공개 격자 면적", pct(suppressedM2, circleM2), "%", naFormula, suppressedM2, circleM2),
      ];

  const coverage = ctx.coverage("reference", ["sgis_grid"]);
  const status: TileResult["status"] = cells.length === 0 || suppressedCells.length > 0 || coverage.some((l) => l.kind === "partial" || l.kind === "incomplete") ? "partial" : "complete";

  const limitations: TileDraft["limitations"] = [
    SGIS_GRID_LIMITATION,
  ];
  if (suppressedCells.length > 0) {
    limitations.push({ kind: "suppressed", note: `원과 겹친 격자 ${cells.length}개 중 ${suppressedCells.length}개는 인구가 비공개(N/A)라 밀도 구간에서 제외했습니다(원 면적의 ${pct(suppressedM2, circleM2)}%). 0명이 아니므로 공개 자료만으로는 실제 분포를 알 수 없습니다.` });
  }
  if (cells.length > 0 && coveredM2 < circleM2 * 0.99) {
    limitations.push({ kind: "unknown", note: `원 면적의 ${pct(circleM2 - coveredM2, circleM2)}%는 자료에 격자가 없는 곳입니다(무인 지역과 자료 없음을 구분할 수 없어 밀도 구간을 더하지 않았습니다).` });
  }
  if (clipFailed > 0) limitations.push({ kind: "unknown", note: `격자 ${clipFailed}개의 도형은 반경 절단에 실패해 지도 면에서 제외했습니다.` });
  limitations.push(...coverage);

  return makeTile(ctx, {
    code: "D27",
    type: "diagram",
    status,
    metrics,
    sources,
    layers: [...LAYERS],
    polygons,
    limitations,
  });
}
