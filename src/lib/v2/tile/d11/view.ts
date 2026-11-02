import type { TileResult } from "../../tile-result";
import { countText, haText, statList } from "../key-figure";
import type { KeyFigure, TileClientModule } from "../types";

const AREA_PREFIX = "back_area_";
const DISTRICT_PLAN = "지구단위계획";

/**
 * 결과에 「대지에 걸친 구역」은 없다. 지구단위계획이 반경에 있으면 그 반경 교차면적이 큰 답이다(km², 1 km² 미만은 ha).
 * 없으면 반경과 겹치는 구역·지구 수가 큰 답이다. 분류별 교차면적은 서로 겹쳐 합이 반경 원보다 클 수 있어 큰 답·보조 숫자로 쓰지 않는다.
 * 수도 없으면 카드를 그리지 않는다("none" — null이면 headline이 `반경 교차면적: 기타 …`로 새어 나온다).
 */
function d11KeyFigure(result: TileResult): KeyFigure | "none" {
  const areas = result.metrics.filter((metric) => metric.id.startsWith(AREA_PREFIX) && metric.value !== null);
  const plan = areas.find((metric) => metric.id === AREA_PREFIX + DISTRICT_PLAN);
  const count = result.metrics.find((metric) => metric.id === "fill_code_pct")?.denominator;
  const classes = areas.length === 0 ? null : countText(areas.length, "종");
  if (plan) {
    const m2 = plan.value as number;
    return {
      question: "반경 구역·지구 교차면적",
      answer: { pre: DISTRICT_PLAN, value: m2 >= 1_000_000 ? `${(m2 / 1_000_000).toFixed(2)} km²` : haText(m2 / 10_000), kind: "number" },
      stats: statList([[count == null ? null : countText(count, "건"), "반경 교차 구역·지구"], [classes, "구역·지구 분류"]]),
    };
  }
  if (!count) return "none";
  return {
    question: "반경 구역·지구",
    answer: { pre: "구역·지구", value: countText(count, "건"), kind: "number" },
    stats: statList([[classes, "구역·지구 분류"]]),
  };
}

export const d11ClientModule = {
  code: "D11",
  headline: { maxPrefix: "back_area_" },
  keyFigureFor: d11KeyFigure,
} satisfies TileClientModule;
