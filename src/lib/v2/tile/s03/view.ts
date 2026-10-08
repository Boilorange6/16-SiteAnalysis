import type { TileClientModule } from "../types";

export const s03ClientModule = {
  code: "S03",
  headline: { ids: ["rel_wind_median", "rel_wind_high_share"] },
  mapNote: "조기설계 참고용 · 풍동 검증 없음 · 주풍향 1방향",
  caveat: "브라우저 탐색용 바람 모형입니다. 보행 안전·구조설계·인허가·검증된 CFD 결과로 사용할 수 없습니다.",
  modelBadge: "탐색용 · 검증 CFD 아님",
} satisfies TileClientModule;
