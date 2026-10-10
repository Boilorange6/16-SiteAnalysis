import type { TileClientModule } from "../types";

export const d19ClientModule = {
  code: "D19",
  headline: { ids: ["median_parcel_m2", "parcels"] },
  mapNote: "연속지적 · 지목·필지 규모 레이어 · 참조용",
  layers: {
    options: [{ id: "all", label: "지목 기본" }, { id: "parcel_size", label: "필지 규모" }],
    baseExcludes: ["parcel_size"],
  },
} satisfies TileClientModule;
