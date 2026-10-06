/** S03 바람 흐름 — 사례 래스터를 만들고 브라우저 WebGPU 결과를 기다린다. */
import { parseTileResult, type TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { notProvided } from "./not-provided";
import { makeTile } from "./common";
import { buildWindCase, windCaseSimulation } from "../wind-metrics";

export const s03 = (ctx: EngineContext): TileResult => {
  if (!ctx.db("weather") || ctx.sources("weather", ["asos"]).length === 0) {
    return notProvided(ctx, "S03", "기상(ASOS) 자료를 확인하지 못해 유입 풍향이 없습니다.");
  }
  const windCase = buildWindCase(ctx);
  if (!windCase) return notProvided(ctx, "S03", "건축물 자료 또는 유입 풍향이 없어 바람 사례를 만들 수 없습니다");

  const obstacle = ctx.emitRaster("S03", { ref: windCase.ref, values: windCase.obstacleValues });
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
      legend: [{ label: "U/U유입", min: 0, max: 1.2 }],
    },
  });
};
