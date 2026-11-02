import type { TileResult } from "../../tile-result";
import { metricCount, statList } from "../key-figure";
import type { KeyFigure, TileClientModule } from "../types";

/** 대지 밀도는 엔진이 내지 않아 싣지 않는다. */
function d16KeyFigure(result: TileResult): KeyFigure | null {
  const density = metricCount(result, "dens_max", "동");
  if (density === null) return null;
  return {
    question: "최대 건물 밀도",
    answer: { value: density, post: "/㎢", kind: "number" },
    sub: "건물이 가장 몰린 곳의 밀도",
    stats: statList([[metricCount(result, "buildings_input", "동"), "밀도 계산에 쓴 건물(반경 밖 포함)"]]),
  };
}

export const d16ClientModule = {
  code: "D16",
  headline: { ids: ["dens_max", "gfa_per_ha"] },
  keyFigureFor: d16KeyFigure,
  parameterBadges: [
    { metricId: "kde_bandwidth_m", prefix: "KDE 대역폭", note: "건물 밀도 추정에 사용한 계산 설정값입니다. 지역 결론 수치가 아닙니다." },
  ],
  mapNote: "건물 수 KDE · 대역폭 100m · 20백분위 구간",
} satisfies TileClientModule;
