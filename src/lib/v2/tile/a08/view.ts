import type { TileClientModule } from "../types";
import type { TileResult } from "../../tile-result";

const layerOptions = (result: TileResult) => [
  { id: "all", label: "건물" },
  ...(result.presentation.polygons?.some((polygon) => polygon.layer.startsWith("rent_district_jeonse_")) ? [{ id: "district_jeonse", label: "행정구역 · 전세" }] : []),
  ...(result.presentation.polygons?.some((polygon) => polygon.layer.startsWith("rent_district_monthly_")) ? [{ id: "district_monthly", label: "행정구역 · 월세" }] : []),
];

export const a08ClientModule = {
  code: "A08",
  headline: { ids: ["jeonse_to_trade_ratio_pct", "jeonse_deposit_per_m2", "monthly_rent_median", "jeonse_count", "monthly_count"] },
  layers: {
    options: layerOptions,
    baseExcludes: ["rent_district"],
  },
} satisfies TileClientModule;
