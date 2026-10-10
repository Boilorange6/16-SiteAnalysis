import type { Season, WindSeason } from "../ui/board-state";

export const CUT_SEASONS = ["spring", "summer", "autumn", "winter"] as const satisfies readonly Season[];
export const CUT_WIND_SEASONS = ["annual", ...CUT_SEASONS] as const satisfies readonly WindSeason[];
export const CUT_SEASON_LABEL: Record<WindSeason, string> = {
  annual: "연간",
  spring: "봄",
  summer: "여름",
  autumn: "가을",
  winter: "겨울",
};
