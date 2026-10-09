import type { TileClientModule } from "../types";

export const d01ClientModule = {
  code: "D01",
  headline: { ids: ["imagery_capture_date"] },
  parameterBadges: [
    { metricId: "imagery_zoom_max", prefix: "최대 줌", note: "항공영상 배경의 표시 수준입니다. 촬영시기는 별도로 확인되지 않았습니다." },
  ],
  headlineFor: () => ({ headline: { value: "항공영상 제공", label: "배경 결론", aux: "촬영시기 미확인" }, metricId: "imagery_available" }),
  mapNote: "VWorld 항공영상 · 촬영시기 미확인",
} satisfies TileClientModule;
