import type { TileClientModule } from "../types";

export const d13ClientModule = {
  code: "D13",
  headline: { ids: ["road_length_in_radius_m", "nearest_arterial_or_higher_m"] },
  mapNote: "도로 중심선 · 실제 폭·공식 도로대장 아님 · © OpenStreetMap contributors",
} satisfies TileClientModule;
