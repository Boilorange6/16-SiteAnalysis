import type { TileResult } from "../../tile-result";
import type { TileView } from "../../ui/tile-view";
import type { TileClientModule } from "../types";
import { s03CutModule } from "./cut";

function windDirectionsOf(result: TileResult): Record<string, number> | undefined {
  if (!result.conditions.simulation) return undefined;
  const simulationCase = result.conditions.simulation.case;
  if (!simulationCase || typeof simulationCase !== "object") return undefined;
  const inflow = (simulationCase as Record<string, unknown>).inflow;
  if (!inflow || typeof inflow !== "object") return undefined;
  const directions: Record<string, number> = {};
  for (const season of ["annual", "spring", "summer", "autumn", "winter"]) {
    const candidate = (inflow as Record<string, unknown>)[season];
    if (!candidate || typeof candidate !== "object") continue;
    const degrees = (candidate as Record<string, unknown>).deg;
    if (typeof degrees !== "number" || !Number.isFinite(degrees)) continue;
    directions[season] = ((degrees % 360) + 360) % 360;
  }
  return Object.keys(directions).length > 0 ? directions : undefined;
}

function applyS03View(base: TileView, result?: TileResult): TileView {
  if (!result) return base;
  const windDirections = windDirectionsOf(result);
  return windDirections ? { ...base, windDirections } : base;
}

export const s03ClientModule = {
  code: "S03",
  headline: { ids: ["urel_median_annual", "share_wind_3_annual"] },
  mapNote: "조기설계 참고용 · 풍동 검증 없음 · 주풍향 1방향",
  caveat: "브라우저 탐색용 바람 모형입니다. 보행 안전·구조설계·인허가·검증된 CFD 결과로 사용할 수 없습니다.",
  modelBadge: "탐색용 · 검증 CFD 아님",
  view: applyS03View,
  cut: s03CutModule,
} satisfies TileClientModule;
