import type { TileClientModule } from "../types";

export const a07ClientModule = {
  code: "A07",
  headline: { ids: ["median_price_per_m2", "valid_trades"] },
  layers: {
    // 옛 D25 저장값(trade_location)은 복원할 수 있게 유지하되, 선택지가 하나라 표현 칩은 노출하지 않는다.
    options: [{ id: "trade_location", label: "기본 거래" }],
  },
} satisfies TileClientModule;
