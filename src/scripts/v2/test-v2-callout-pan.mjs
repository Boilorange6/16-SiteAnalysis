/** A05/A06 카드 설명선 지도도 공용 지도 뷰포트 계약을 사용하고 카드 배치를 재투영하는지 확인한다. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const calloutSource = readFileSync(new URL("../../components/v2/callout-map.tsx", import.meta.url), "utf8");
const tileCardSource = readFileSync(new URL("../../components/v2/tile-card.tsx", import.meta.url), "utf8");
const { TILE_CATALOG } = await import("../../lib/v2/ui/tile-catalog.ts");
const { calloutScene } = await import("../../lib/v2/ui/callout-scene.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { GODEOK_RESULTS } = await import("../../lib/v2/ui/fixtures/godeok.ts");

assert.match(calloutSource, /const controller = useMapView\(/, "CalloutMap은 공용 useMapView를 사용");
assert.match(calloutSource, /<div \{\.\.\.controller\.bind\} ref=\{setViewportRef\}/, "CalloutMap 카드 지도에 입력 바인딩을 연결");
assert.match(calloutSource, /calloutScene\(model, kind, size\.w, size\.h, page, 0, controller\.view, showMapLabels\)/, "줌·팬 뷰와 카드 라벨 상태로 설명선 장면을 재계산");
assert.match(calloutSource, /!controller\.dragging && <polyline/, "제스처 중 설명선을 숨김");
assert.match(tileCardSource, /const mapInteractive = !state && view\.code !== "S01" && view\.code !== "D22" && \(frame !== "card" \|\| mapZoom\?\.card !== false\)/, "카드 지도 상호작용은 타일 정책으로만 끔");

for (const code of ["A05", "A06"]) {
  assert.notEqual(TILE_CATALOG[code].mapZoom?.card, false, `${code} 카드 지도 상호작용이 켜져 있음`);
  const result = GODEOK_RESULTS.find((item) => item.tileCode === code);
  const model = toTileView(result).callout;
  assert.ok(model, `${code} callout fixture`);

  const base = calloutScene(model, "card", 1000, 500, 0, 0);
  const zoomed = calloutScene(model, "card", 1000, 500, 0, 0, { zoomDelta: 1, offsetM: [0, 0] });
  const baseById = new Map(base.placed.map((placed) => [placed.id, placed]));
  const changed = zoomed.placed.filter((placed) => {
    const before = baseById.get(placed.id);
    return before && (Math.abs(before.dot[0] - placed.dot[0]) > 1 || Math.abs(before.dot[1] - placed.dot[1]) > 1);
  });
  assert.ok(changed.length > 0, `${code} 줌 후 점 투영이 바뀜`);
  assert.ok(changed.some((placed) => {
    const before = baseById.get(placed.id);
    return before && (Math.abs(before.x - placed.x) > 1 || Math.abs(before.y - placed.y) > 1);
  }), `${code} 줌 후 카드 배치가 새 점 투영으로 바뀜`);
  for (const placed of zoomed.placed) assert.deepEqual(placed.dot, zoomed.pos.get(placed.id), `${code} 카드 지시선 점이 새 투영과 일치`);
}

console.log("v2 callout card zoom/pan contracts passed");
