import { TILE_CATALOG, TILE_CODES, type TileCatalogEntry, type TileCode, type TileKind } from "./tile-catalog";

export type GuideTile = TileCatalogEntry & { code: TileCode };
export type GuideTileGroup = { kind: TileKind; label: string; note: string; tiles: GuideTile[] };

const GROUPS: ReadonlyArray<Pick<GuideTileGroup, "kind" | "label" | "note">> = [
  { kind: "analysis", label: "입지 분석", note: "주소 주변의 교통·생활·주거·개발 조건을 읽습니다." },
  { kind: "diagram", label: "도시 형태 도판", note: "지도와 구성비로 주변 공간의 모양과 분포를 확인합니다." },
  { kind: "simulation", label: "시뮬레이션", note: "같은 조건 안에서 일조·바람·열쾌적을 상대 비교합니다." },
];

/** 가이드 타일 목록은 단일 카탈로그의 순서·메타데이터를 그대로 소비한다. */
export function guideTiles(): GuideTile[] {
  return TILE_CODES.map((code) => ({ code, ...TILE_CATALOG[code] }));
}

export function guideTileGroups(): GuideTileGroup[] {
  const tiles = guideTiles();
  return GROUPS.map((group) => ({
    ...group,
    tiles: tiles.filter((tile) => tile.kind === group.kind),
  }));
}
