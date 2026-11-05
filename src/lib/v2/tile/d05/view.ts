import type { TileResult } from "../../tile-result";
import { countText, metricPercent, percentText, statList } from "../key-figure";
import type { KeyFigure, TileClientModule } from "../types";

const FLOORS_PREFIX = "층수 구성: ";
/** 층수대 구성(1~4층 … 26층 이상). 층수 미상(share_floors_6)과 1층 가정(추정)은 층수대가 아니다. */
const FLOOR_BAND = /^share_floors_[1-5]$/;

/** 큰 답은 층수가 확인된 건물의 최다 층수대다. 층수를 모르는 건물(높이는 1층 3m 가정)의 비율을 보조 숫자로 함께 싣는다(저장소 규칙). */
function d05KeyFigure(result: TileResult): KeyFigure | null {
  const top = result.metrics
    .filter((metric) => FLOOR_BAND.test(metric.id) && metric.value !== null)
    .sort((a, b) => (b.value as number) - (a.value as number))[0];
  if (!top) return null;
  const assumed = result.metrics.find((metric) => (metric.id === "share_floors_assumed_1f" || metric.id === "share_assumed_one_floor_pct") && metric.value !== null);
  const sub = top.numerator !== null && top.denominator !== null ? `반경 건물 ${countText(top.denominator, "동")} 중 ${countText(top.numerator, "동")}` : undefined;
  return {
    question: "가장 많은 층수대",
    answer: { pre: top.label.startsWith(FLOORS_PREFIX) ? top.label.slice(FLOORS_PREFIX.length) : top.label, value: percentText(top.value as number), kind: "number" },
    ...(sub ? { sub } : {}),
    stats: statList([
      [metricPercent(result, "fill_floors_pct"), "층수 확인률"],
      [metricPercent(result, "fill_height_m_pct"), "미터 높이 확인률"],
      [assumed ? percentText(assumed.value as number) : null, `1층 가정(추정)${assumed?.numerator == null ? "" : ` · ${countText(assumed.numerator, "동")}`}`],
    ]),
  };
}

export const d05ClientModule = {
  code: "D05",
  chart: { subject: "건물", countUnit: "동", missingLabel: "1층 가정·미상" },
  autoLabels: "top",
  headline: { maxPrefix: "share_floors_" },
  keyFigureFor: d05KeyFigure,
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
