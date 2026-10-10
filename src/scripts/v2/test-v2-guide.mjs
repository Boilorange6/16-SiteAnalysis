import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { TILE_CODES } = await import("../../lib/v2/ui/tile-catalog.ts");
const { guideTileGroups } = await import("../../lib/v2/ui/guide-catalog.ts");

assert.deepEqual(
  guideTileGroups().flatMap((group) => group.tiles.map((tile) => tile.code)),
  TILE_CODES,
  "가이드 카탈로그 목록은 TILE_CATALOG 전체와 같은 순서·개수여야 한다",
);
const { RADIUS_CAPTION, RADIUS_OPTIONS } = await import("../../lib/v2/ui/radius-options.ts");
assert.equal(RADIUS_CAPTION, "역세권 500m · 도보권 800m · 생활권 1km · 생활권 2km · 생활권·광역 3km");
assert.equal(RADIUS_OPTIONS.length, 5);
const pageSource = readFileSync(new URL("../../app/v2/page.tsx", import.meta.url), "utf8");
const guideSource = readFileSync(new URL("../../app/v2/guide/page.tsx", import.meta.url), "utf8");
assert.match(pageSource, /RADIUS_CAPTION/);
assert.match(pageSource, /aria-describedby="v2-radius-help"/);
assert.match(guideSource, /from "@\/lib\/v2\/ui\/radius-options"/);
console.log(`v2 guide catalog ok (${TILE_CODES.length} tiles)`);
