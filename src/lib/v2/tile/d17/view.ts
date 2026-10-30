import type { TileResult } from "../../tile-result";
import { countText, metricNumber, statList } from "../key-figure";
import type { KeyFigure, TileClientModule } from "../types";

/** 표고·고저차는 음수가 나올 수 있다. 거리용 서식(`formatDistanceM`)은 음수를 미확인으로 쓰므로 쓰지 않는다. */
const meters = (result: TileResult, id: string): string | null => {
  const value = metricNumber(result, id);
  return value === null ? null : countText(value, "m");
};

function d17KeyFigure(result: TileResult): KeyFigure | null {
  const elevation = meters(result, "center_elevation_m");
  if (elevation === null) return null;
  return {
    question: "대지 표고",
    answer: { value: elevation, kind: "number" },
    sub: "대지 중심점의 표면모델(DSM 30m) 표고",
    stats: statList([[meters(result, "relief_max_m"), "중심 대비 최고 고저차"], [meters(result, "relief_median_m"), "중심 대비 고저차 중앙값"]]),
  };
}

export const d17ClientModule = {
  code: "D17",
  headline: { ids: ["relief_median_m", "center_elevation_m"] },
  keyFigureFor: d17KeyFigure,
  mapNote: "Copernicus GLO-30 표면모델(DSM, 30 m) · EGM2008 · 중심 상대고",
} satisfies TileClientModule;
