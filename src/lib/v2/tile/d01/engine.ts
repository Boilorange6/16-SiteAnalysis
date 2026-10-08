/** D01 항공사진 — VWorld WMTS 항공 배경을 타일 결과에 고정한다. */
import { MAX_Z } from "../../tiles";
import { parseTileResult, type TileResult } from "../../tile-result";
import type { EngineContext, SourceRef } from "../../engine/context";
import { makeTile, missing, obs } from "../../engine/tiles/common";

/** WMTS는 분석 DB에 적재하는 날짜 고정 원천이 아니라 요청 시 조회하는 배경이다. */
export const VWORLD_WMTS_SOURCE: SourceRef = {
  sourceId: "vworld_wmts",
  releaseId: "vworld_wmts@runtime",
  sourceAsOf: null,
  fetchedAt: "runtime",
};

export function d01(ctx: EngineContext): TileResult {
  const tile = makeTile(ctx, {
    code: "D01",
    type: "diagram",
    status: "complete",
    metrics: [
      obs("imagery_zoom_max", "항공영상 WMTS 최대 줌", MAX_Z, "z", "d01-imagery-zoom@1:tiles.ts MAX_Z"),
      missing("imagery_capture_date", "항공영상 촬영시기", "날짜", "d01-imagery-capture-date@1:VWorld WMTS 촬영시기 메타데이터 미확보"),
    ],
    judgment: {
      ruleId: "D01-aerial-imagery@1",
      basisMetricIds: ["imagery_zoom_max"],
      sentence: `VWorld WMTS 항공영상 최대 줌 ${MAX_Z}로 항공 배경을 제공하고 촬영시기는 미확인 → 주변 지물의 배치와 현재 색·형태를 항공사진으로 확인할 수 있음 → 촬영일과 현장 현재 상태는 원본·현장에서 확인할 것`,
      level: null,
      criteria: null,
    },
    sources: [VWORLD_WMTS_SOURCE],
    layers: [],
    limitations: [{ kind: "unknown", note: "VWorld 항공영상 · 촬영시기 미확인" }],
  });

  // D01은 보드에서 사용자가 고른 일반/지도 배경으로 바뀌지 않는다.
  return parseTileResult({ ...tile, presentation: { ...tile.presentation, basemap: "Satellite" } });
}
