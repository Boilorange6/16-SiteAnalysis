import type { TileClientModule } from "../types";

export const a12ClientModule = {
  code: "A12",
  headline: { ids: ["share_class_1", "mixed_zone_share_pct", "site_zoning_count"] },
  layers: {
    options: [{ id: "all", label: "기본 토지" }, { id: "zoning_detail", label: "용도지역" }],
  },
} satisfies TileClientModule;
