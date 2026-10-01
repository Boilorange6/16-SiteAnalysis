import type { TileView } from "./tile-view";

export type SheetGrid = "2x2" | "3x2" | "3x1";
export type SheetRect = { x: number; y: number; w: number; h: number };

const SLIDE = { w: 13.333, h: 7.5, edge: 0.3, titleH: 0.66, stripH: 0.36 } as const;
const GAP = 0.15;

/** 16:9 슬라이드의 제목 띠 아래부터 출처 띠 위까지 겹치지 않는 셀을 만든다. */
export function sheetCells(grid: SheetGrid): SheetRect[] {
  if (grid === "3x1") {
    const top = SLIDE.edge + SLIDE.titleH;
    const bottom = SLIDE.h - SLIDE.stripH - 0.03;
    const columns = 3;
    const cellW = (SLIDE.w - 2 * SLIDE.edge - (columns - 1) * GAP) / columns;
    const cellH = cellW * (9 / 16);
    const y = top + (bottom - top - cellH) / 2;
    return Array.from({ length: columns }, (_, column) => ({ x: SLIDE.edge + column * (cellW + GAP), y, w: cellW, h: cellH }));
  }
  const columns = grid === "2x2" ? 2 : 3;
  const rows = 2;
  const top = SLIDE.edge + SLIDE.titleH;
  const bottom = SLIDE.h - SLIDE.stripH - 0.03;
  const cellH = (bottom - top - GAP) / rows;
  const cellW = grid === "2x2" ? cellH * (16 / 9) : 4.2;
  const totalW = columns * cellW + (columns - 1) * GAP;
  const startX = grid === "2x2" ? (SLIDE.w - totalW) / 2 : SLIDE.edge;
  return Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return { x: startX + column * (cellW + GAP), y: top + row * (cellH + GAP), w: cellW, h: cellH };
  });
}

const unique = <T>(items: T[]): T[] => [...new Set(items)];

function sourceUnion(tiles: TileView[]): string {
  const sources = unique(tiles.flatMap((tile) => tile.sourceLine.split(" · ")).filter((source) => source && source !== "출처 없음"));
  return sources.length > 0 ? sources.join(" · ") : "출처 없음";
}

/** 선택한 타일을 보고서 전용 조판 뷰로 만든다. 실제 셀 렌더링은 report-plan이 담당한다. */
export function sheetView(id: string, tiles: TileView[], grid: SheetGrid): TileView {
  const first = tiles[0];
  const status = tiles.length > 0 && tiles.every((tile) => tile.status === "complete") ? "complete" : "partial";
  return {
    tileId: id,
    code: "SHEET",
    title: "조판",
    color: first?.color ?? "#7A7E87",
    status,
    badges: unique(tiles.flatMap((tile) => tile.badges.map((badge) => badge.text))).map((text) => {
      const badge = tiles.flatMap((tile) => tile.badges).find((candidate) => candidate.text === text)!;
      return badge;
    }),
    headline: { value: `${tiles.length}칸`, label: grid },
    rows: [],
    sentence: null,
    grade: null,
    grades: [],
    caveats: unique(tiles.flatMap((tile) => tile.caveats)),
    notes: unique(tiles.map((tile) => tile.title)),
    sourceLine: sourceUnion(tiles),
    chart: null,
    hasFace: false,
    retryable: false,
    map: null,
    backdrop: first?.backdrop ?? { center: [0, 0] as const, radiusM: 1, features: [], total: 0, notes: [] },
    kindLabel: "조판",
    callout: null,
    mass: null,
    stackLayers: null,
    sheetTiles: tiles.map((tile) => tile.tileId),
    sheetGrid: grid,
  };
}
