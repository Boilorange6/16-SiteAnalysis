import type { TileResult } from "../../tile-result";
import { countText, haText, statList } from "../key-figure";
import type { KeyFigure, TileClientModule } from "../types";

const AREA_PREFIX = "back_area_";
const DISTRICT_PLAN = "지구단위계획";

/**
 * 결과에 「대지에 걸친 구역」은 없고 반경 교차면적만 있다. 그래서 반경 교차면적이 큰 답이다:
 * 지구단위계획이 있으면 그것, 없으면 가장 넓은 분류. 면적은 ㎡ 일곱 자리가 아니라 km²(1 km² 미만은 ha)로 쓴다.
 */
function d11KeyFigure(result: TileResult): KeyFigure | null {
  const areas = result.metrics
    .filter((metric) => metric.id.startsWith(AREA_PREFIX) && metric.value !== null)
    .map((metric) => ({ name: metric.id.slice(AREA_PREFIX.length), m2: metric.value as number }));
  const answer = areas.find((area) => area.name === DISTRICT_PLAN) ?? [...areas].sort((a, b) => b.m2 - a.m2)[0];
  if (!answer) return null;
  const count = result.metrics.find((metric) => metric.id === "fill_code_pct")?.denominator;
  return {
    question: "반경 구역·지구 교차면적",
    answer: { pre: answer.name, value: answer.m2 >= 1_000_000 ? `${(answer.m2 / 1_000_000).toFixed(2)} km²` : haText(answer.m2 / 10_000), kind: "number" },
    stats: statList([[count == null ? null : countText(count, "건"), "반경 교차 구역·지구"], [countText(areas.length, "종"), "구역·지구 분류"]]),
  };
}

export const d11ClientModule = {
  code: "D11",
  headline: { maxPrefix: "back_area_" },
  keyFigureFor: d11KeyFigure,
} satisfies TileClientModule;
