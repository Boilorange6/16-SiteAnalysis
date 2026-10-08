import type { TileClientModule } from "../types";

export const a07ClientModule = {
  code: "A07",
  headline: { ids: ["median_price_per_m2", "valid_trades"] },
  layers: {
    options: [{ id: "all", label: "기본 거래" }, { id: "trade_location", label: "가격 구간" }],
  },
} satisfies TileClientModule;
