import type { TileResult } from "../../tile-result";
import { metricPercent, metricText, statList } from "../key-figure";
import type { KeyFigure, TileClientModule, TileHeadlineHelpers } from "../types";

const SHARE_PREFIX = "구성비: ";

function d13KeyFigure(result: TileResult, helpers: TileHeadlineHelpers): KeyFigure | null {
  const length = metricText(result, "road_length_in_radius_m", helpers);
  if (length === null) return null;
  // 도로 위계 구성비: 2 간선, 3 보조간선(이름은 지표 이름에서 읽는다)
  const share = (id: string): [string | null, string] => {
    const name = result.metrics.find((metric) => metric.id === id)?.label.replace(SHARE_PREFIX, "");
    return [metricPercent(result, id), `${name ?? ""} 비율`.trim()];
  };
  return {
    question: "반경 도로 총길이",
    answer: { value: length, kind: "number" },
    sub: "OSM 도로 중심선 길이 합",
    stats: statList([share("share_road_2"), share("share_road_3")]),
  };
}

export const d13ClientModule = {
  code: "D13",
  baseSuppress: ["road"],
  headline: { ids: ["road_length_in_radius_m", "nearest_arterial_or_higher_m"] },
  keyFigureFor: d13KeyFigure,
  mapNote: "도로 중심선 · 실제 폭·공식 도로대장 아님 · © OpenStreetMap contributors",
} satisfies TileClientModule;
