import type { TileClientModule } from "../types";

export const d12ClientModule = {
  code: "D12",
  chart: { subject: "도시계획시설", countUnit: "건" },
  autoLabels: false,
  headline: { maxPrefix: "back_area_" },
} satisfies TileClientModule;
