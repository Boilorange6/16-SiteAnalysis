import type { TileClientModule } from "../types";

export const d15ClientModule = {
  code: "D15",
  chart: { subject: "폐합 블록", countUnit: "개" },
  headline: { ids: ["median_block_ha", "blocks"] },
  mapNote: "OSM 도로로 폐합된 블록 · 반경 밖 500m까지 읽음",
} satisfies TileClientModule;
