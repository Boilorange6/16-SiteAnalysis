import type { TileClientModule } from "../types";

export const a04ClientModule = {
  code: "A04",
  headline: { ids: ["parks", "nearest_park_point_m"] },
  mapNote: "공원·그 밖의 녹지·하천·수면 평면 레이어 (공원 경계 아님·입구 자료 한계)",
  layers: {
    options: [
      { id: "all", label: "전체" },
      { id: "park_only", label: "공원만" },
      { id: "green_space", label: "녹지·수면" },
    ],
  },
} satisfies TileClientModule;
