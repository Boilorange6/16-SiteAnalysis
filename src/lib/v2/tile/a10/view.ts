import type { TileClientModule } from "../types";

export const a10ClientModule = {
  code: "A10",
  headline: { ids: ["planned_projects"] },
  layers: {
    options: [{ id: "all", label: "기본 계획" }, { id: "planned_detail", label: "노선·계획역" }],
  },
} satisfies TileClientModule;
