import type { TileClientModule } from "../types";

export const a01ClientModule = {
  code: "A01",
  headline: { ids: ["nearest_rail_m", "nearest_bus_m"] },
  layers: {
    options: [{ id: "all", label: "기본 교통" }, { id: "transit", label: "철도·출입구" }],
  },
} satisfies TileClientModule;
