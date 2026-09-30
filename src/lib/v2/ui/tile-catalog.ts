/** 타일 코드 → 화면용 제목·종류·색 (카탈로그 2026-09-29). */
export type TileKind = "analysis" | "diagram" | "simulation";

export const TILE_CATALOG = {
  A01: { title: "입지·대중교통", kind: "analysis", color: "#6A50D3" },
  A02: { title: "학교·통학구역", kind: "analysis", color: "#E5A11C" },
  A03: { title: "생활편의·상가", kind: "analysis", color: "#3F9E6B" },
  A04: { title: "공원·녹지", kind: "analysis", color: "#5C9A3C" },
  A05: { title: "기존 주거 공급", kind: "analysis", color: "#8C6D5A" },
  A06: { title: "분양·입주예정 공급", kind: "analysis", color: "#7A7E87" },
  A07: { title: "매매 실거래", kind: "analysis", color: "#2F6FDB" },
  A09: { title: "정비사업", kind: "analysis", color: "#D6478A" },
  A10: { title: "계획 철도", kind: "analysis", color: "#8A5BC7" },
  A11: { title: "인구·가구", kind: "analysis", color: "#2B7A78" },
  A12: { title: "토지·용도지역", kind: "analysis", color: "#C9A227" },
  D04: { title: "준공 연대", kind: "diagram", color: "#A0522D" },
  S02: { title: "일조·그림자", kind: "simulation", color: "#F08A24" },
  S03: { title: "바람 흐름 탐색", kind: "simulation", color: "#2B9CBF" },
} as const satisfies Record<string, { title: string; kind: TileKind; color: string }>;

export type TileCode = keyof typeof TILE_CATALOG;
export const TILE_CODES = Object.keys(TILE_CATALOG) as TileCode[];

/** 원천 id → 화면용 이름. 목록에 없는 id는 그대로 보인다. */
export const SOURCE_NAMES: Record<string, string> = {
  store: "소상공인 상가정보",
  bus_stop: "전국 버스정류장",
  park: "전국 도시공원",
  osm_subway: "OSM 철도(역·출입구·노선)",
  planned_rail: "계획 철도 공개 목록",
  sgis_grid: "SGIS 인구·가구 1km 격자",
  school: "학교 위치",  ledger_recap: "건축물대장 총괄표제부",
  ledger_title: "건축물대장 표제부",
  applyhome: "청약홈",
  move_in: "입주예정",
  parcel: "연속지적도",
  legal_areas: "법정구역",
  rtms_apt_trade: "국토부 아파트 매매 실거래",
  maintenance_integrated: "정비사업 현황(통합)",
  maintenance_std: "정비사업 현황(표준데이터)",
  maintenance_zone: "정비구역 경계",
  zoning_urban: "용도지역(도시지역)",
  zoning_management: "용도지역(관리지역)",
  zoning_agri_forest: "용도지역(농림지역)",
  zoning_nature: "용도지역(자연환경보전지역)",
  zoning_other: "용도지역(기타)",
};
export const sourceName = (id: string) => SOURCE_NAMES[id] ?? id;

export function catalogEntry(code: string): { title: string; kind: TileKind; color: string } {
  return (TILE_CATALOG as Record<string, { title: string; kind: TileKind; color: string }>)[code] ?? { title: code, kind: "analysis", color: "#7A7E87" };
}
