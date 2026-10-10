/** S03 바람 흐름 — 사례 래스터를 만들고 브라우저 WebGPU 결과를 기다린다. */
import { parseTileResult, type TileResult } from "../../tile-result";
import type { EngineContext } from "../../engine/context";
import { notProvided } from "../../engine/tiles/not-provided";
import { lineCandidate, makeTile } from "../../engine/tiles/common";
import { DIR16_KO_NAMES, DIR16_NAMES } from "../d22/engine";
import { buildWindCase, windCaseSimulation, type WindInflow } from "../../engine/wind-metrics";

const WIND_LEGEND = [
  { label: "U/U유입 · 0~0.5", min: 0, max: 0.5 },
  { label: "U/U유입 · 0.5~0.8", min: 0.5, max: 0.8 },
  { label: "U/U유입 · 0.8~1.2", min: 0.8, max: 1.2 },
  { label: "U/U유입 · 1.2 이상", min: 1.2, max: null },
] as const;

function inflowLabel(inflow: WindInflow): string {
  const namedIndex = DIR16_NAMES.indexOf(inflow.name);
  const index = namedIndex >= 0 ? namedIndex : Math.round(inflow.deg / 22.5) % DIR16_NAMES.length;
  const korean = DIR16_KO_NAMES[index] ?? inflow.name;
  return `주풍향 ${korean}(${inflow.name}) 유입`;
}

export const s03 = (ctx: EngineContext): TileResult => {
  if (!ctx.db("weather") || ctx.sources("weather", ["asos"]).length === 0) {
    return notProvided(ctx, "S03", "기상(ASOS) 자료를 확인하지 못해 유입 풍향이 없습니다.");
  }
  const windCase = buildWindCase(ctx);
  if (!windCase) return notProvided(ctx, "S03", "건축물 자료 또는 유입 풍향이 없어 바람 사례를 만들 수 없습니다");

  const obstacle = ctx.emitRaster("S03", { ref: windCase.ref, values: windCase.obstacleValues });
  const annual = windCase.inflow.annual;
  const inflowLine = annual
    ? lineCandidate(0, "wind_inflow", [
        [windCase.centerX + Math.sin((annual.deg * Math.PI) / 180) * Math.max(40, Math.min(ctx.input.radiusM * 0.6, 220)), windCase.centerY + Math.cos((annual.deg * Math.PI) / 180) * Math.max(40, Math.min(ctx.input.radiusM * 0.6, 220))],
        [windCase.centerX, windCase.centerY],
      ], Math.max(40, Math.min(ctx.input.radiusM * 0.6, 220)), null, {
        name: inflowLabel(annual),
        sublabel: null,
        labelPriority: 1,
        emphasis: "major",
      })
    : null;
  const tile = makeTile(ctx, {
    code: "S03",
    type: "simulation",
    status: "pending",
    metrics: [],
    judgment: null,
    sources: windCase.sources,
    layers: ["wind_inflow", "wind_ratio"],
    limitations: windCase.limitations,
  });
  return parseTileResult({
    ...tile,
    conditions: { ...tile.conditions, simulation: windCaseSimulation(windCase) },
    presentation: {
      ...tile.presentation,
      rasters: [obstacle],
      legend: [...WIND_LEGEND],
      ...(inflowLine ? { lines: [inflowLine.l], linesTotal: 1 } : {}),
    },
  });
};
