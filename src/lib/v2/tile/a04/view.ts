import type { TileClientModule } from "../types";

export const a04ClientModule = {
  code: "A04",
  headline: { ids: ["parks", "nearest_park_point_m"] },
  mapNote: "대표점·원천 면적·녹지·수면 레이어 (경계 아님)",
  layers: {
    options: [{ id: "all", label: "기본 공원" }, { id: "green_space", label: "녹지·수면" }],
  },
} satisfies TileClientModule;
