import type { TileClientModule } from "../types";

export const d28ClientModule = {
  code: "D28",
  headline: { ids: ["area_10min_km2", "reach_ratio_10min_pct"] },
  sentenceFor: (_result, sentence, rows) => {
    const area = rows.find((row) => row.label === "도보 10분 도달 면적")?.value;
    return area ? sentence.replace(/(도보 10분(?:\([^)]*\))? 도달 면적 )[^ (]+(?:\s*(?:㎢|km²))?/, `$1${area}`) : sentence;
  },
  mapNote: "OSM 보행망 · 80 m/분 · 내부 제안 기준",
} satisfies TileClientModule;
