import type { TileClientModule } from "../types";
import { d22CutModule } from "./cut";

export const d22ClientModule = {
  code: "D22",
  headline: { ids: ["prevailing_dir_deg", "station_distance_m"] },
  mapNote: "ASOS 최근접 관측소 · 연간·계절 16방위 바람장미",
  cut: d22CutModule,
} satisfies TileClientModule;
