import type { TileClientModule } from "../types";

export const d10ClientModule = {
  code: "D10",
  headline: { ids: ["canopy_pct", "canopy_site_pct", "osm_green_pct"] },
  mapNote: "항공사진 색 기반 수관 검출 · 재현율 미검증 · OSM 녹지 보조",
} satisfies TileClientModule;
