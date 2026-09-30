/** 타일 코드 → 화면용 제목·종류·색 (카탈로그 2026-09-29). */
export type TileKind = "analysis" | "diagram" | "simulation";

export const TILE_CATALOG = {
  A01: { title: "입지·대중교통", kind: "analysis", color: "#6A50D3" },
  A02: { title: "학교·통학구역", kind: "analysis", color: "#E5A11C" },
  A05: { title: "기존 주거 공급", kind: "analysis", color: "#8C6D5A" },
  A06: { title: "분양·입주예정 공급", kind: "analysis", color: "#7A7E87" },
  A07: { title: "매매 실거래", kind: "analysis", color: "#2F6FDB" },
  A09: { title: "정비사업", kind: "analysis", color: "#D6478A" },
  A12: { title: "토지·용도지역", kind: "analysis", color: "#C9A227" },
  D04: { title: "준공 연대", kind: "diagram", color: "#A0522D" },
  S02: { title: "일조·그림자", kind: "simulation", color: "#F08A24" },
  S03: { title: "바람 흐름 탐색", kind: "simulation", color: "#2B9CBF" },
} as const satisfies Record<string, { title: string; kind: TileKind; color: string }>;

export type TileCode = keyof typeof TILE_CATALOG;
export const TILE_CODES = Object.keys(TILE_CATALOG) as TileCode[];

export function catalogEntry(code: string): { title: string; kind: TileKind; color: string } {
  return (TILE_CATALOG as Record<string, { title: string; kind: TileKind; color: string }>)[code] ?? { title: code, kind: "analysis", color: "#7A7E87" };
}
