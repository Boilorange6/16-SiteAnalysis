import type { TileClientModule } from "../types";
import type { TileResult } from "../../tile-result";

const layerOptions = (result: TileResult) => [
  ...(result.presentation.polygons?.some((polygon) => polygon.layer.startsWith("trade_district_"))
    ? [{ id: "all", label: "건물" }, { id: "district", label: "행정구역" }]
    : [{ id: "all", label: "기본 거래" }]),
];

export const a07ClientModule = {
  code: "A07",
  headline: { ids: ["median_price_per_m2", "valid_trades"] },
  mapNote: "색 구간은 반경 전체 기준",
  layers: {
    // 옛 D25 저장값(trade_location)은 tile-layers의 all fallback으로 복원한다.
    options: layerOptions,
    baseExcludes: ["district"],
  },
} satisfies TileClientModule;
