import assert from "node:assert/strict";

const { TILE_CODES } = await import("../../lib/v2/ui/tile-catalog.ts");
const { guideTileGroups } = await import("../../lib/v2/ui/guide-catalog.ts");

assert.deepEqual(
  guideTileGroups().flatMap((group) => group.tiles.map((tile) => tile.code)),
  TILE_CODES,
  "가이드 카탈로그 목록은 TILE_CATALOG 전체와 같은 순서·개수여야 한다",
);
console.log(`v2 guide catalog ok (${TILE_CODES.length} tiles)`);
