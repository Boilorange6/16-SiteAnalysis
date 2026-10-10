import type { TileClientModule } from "../types";

export const d05ClientModule = {
  code: "D05",
  headline: { maxPrefix: "share_floors_" },
  mapNote: "지상층수 기본 · 35m·12m 기준 레이어 · [추정]은 층수×3m",
  layers: {
    options: [
      { id: "all", label: "층수 기본" },
      { id: "height_tall", label: "35m 이상" },
      { id: "height_low", label: "12m 이하" },
    ],
    baseExcludes: ["height_tall", "height_low"],
  },
} satisfies TileClientModule;
