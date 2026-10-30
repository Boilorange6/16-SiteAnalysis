import type { TileResult } from "../../tile-result";
import { metricCount, metricText, statList } from "../key-figure";
import type { KeyFigure, TileClientModule, TileHeadlineHelpers } from "../types";

/** 대지 밀도는 엔진이 내지 않아 싣지 않는다. */
function d16KeyFigure(result: TileResult, helpers: TileHeadlineHelpers): KeyFigure | null {
  const density = metricCount(result, "dens_max", "동");
  if (density === null) return null;
  const bandwidth = metricText(result, "kde_bandwidth_m", helpers);
  return {
    question: "최대 건물 밀도",
    answer: { value: density, post: "/㎢", kind: "number" },
    sub: `건물 수 KDE 최댓값${bandwidth === null ? "" : ` · 대역폭 ${bandwidth}`}`,
    stats: statList([[metricCount(result, "buildings_input", "동"), "KDE 입력 건물"]]),
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
