import type { TileClientModule } from "../types";

export const a01ClientModule = {
  code: "A01",
  headline: { ids: ["nearest_rail_m", "nearest_bus_m"] },
  mapNotesFor: (result) => result.metrics.some((metric) => metric.id === "nearest_rail_m" && metric.status === "missing")
    ? ["철도 자료를 확인하지 못해 버스정류장만 표시"]
    : [],
  layers: {
    options: [{ id: "all", label: "기본 교통" }, { id: "transit", label: "철도·출입구" }],
  },
} satisfies TileClientModule;
