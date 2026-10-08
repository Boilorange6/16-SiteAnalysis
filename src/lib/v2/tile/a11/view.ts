import type { TileClientModule } from "../types";

export const a11ClientModule = {
  code: "A11",
  headline: { ids: ["density_per_km2", "pop_est", "hh_est"] },
  layers: {
    options: [{ id: "all", label: "기본 인구" }, { id: "density_detail", label: "밀도 구간" }],
  },
} satisfies TileClientModule;
