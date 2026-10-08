import type { TileClientModule } from "../types";

export const d01ClientModule = {
  code: "D01",
  headline: { ids: ["imagery_capture_date", "imagery_zoom_max"] },
  mapNote: "VWorld 항공영상 · 촬영시기 미확인",
} satisfies TileClientModule;
