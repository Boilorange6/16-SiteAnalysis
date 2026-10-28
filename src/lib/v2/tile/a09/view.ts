import type { TileClientModule } from "../types";

export const a09ClientModule = {
  code: "A09",
  chart: { subject: "정비구역", countUnit: "곳" },
  headline: { ids: ["projects_in_radius", "zones_in_radius", "roster_projects"] },
  layers: {
    options: [{ id: "all", label: "기본 정비" }, { id: "maintenance_stage", label: "사업 단계" }],
  },
} satisfies TileClientModule;
