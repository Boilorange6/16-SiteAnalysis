import type { TileClientModule } from "../types";

export const a04ClientModule = {
  code: "A04",
  headline: { ids: ["parks", "nearest_park_point_m"] },
  mapNote: "공원 지물·원천 면적·녹지·수면 레이어 (공원 경계 아님·입구 자료 한계)",
  layers: {
    options: [{ id: "all", label: "기본 공원" }, { id: "green_space", label: "녹지·수면" }],
    baseExcludes: ["green_space"],
  },
} satisfies TileClientModule;
