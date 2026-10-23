import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const surface = readFileSync(new URL("../../components/v2/report/slide-surface.tsx", import.meta.url), "utf8");
const surfaceCss = readFileSync(new URL("../../components/v2/report/slide-surface.module.css", import.meta.url), "utf8");
const mapFigure = readFileSync(new URL("../../components/v2/map-figure.tsx", import.meta.url), "utf8");
const mapScene = readFileSync(new URL("../../lib/v2/ui/map-scene.ts", import.meta.url), "utf8");
const mapPptx = readFileSync(new URL("../../lib/v2/report/map-pptx.ts", import.meta.url), "utf8");

assert.match(surface, /selectedPanel === "source" \? \["e", "w"\]/, "출처 줄은 좌우 2개 핸들을 사용한다");
assert.match(surface, /const directions: DecorationResizeDirection\[\] = \["nw", "ne", "se", "sw"\]/, "방위표·축척·위치도는 네 모서리 핸들을 사용한다");
assert.match(surface, /event\.shiftKey/, "장식 크기 조절은 Shift 키 배율을 사용한다");
assert.match(surface, /data-decoration-handle=\{direction\}/, "장식 핸들은 실제 포인터 입력 대상을 표시한다");
assert.match(surface, /setDecorationSnapGuides/, "장식 이동·크기 조절은 스냅 가이드를 갱신한다");
assert.match(surfaceCss, /\.decorationSelectionFrame\s*\{[\s\S]*?z-index:\s*92/s, "장식 선택 프레임은 공통 최상위 층에 있다");
assert.match(mapFigure, /northScale\?: number/, "미리보기 방위표 크기 배율 입구");
assert.match(mapFigure, /scaleChromeScale\?: number/, "미리보기 축척 막대 크롬 배율 입구");
assert.match(mapFigure, /scene\.northUnit/, "미리보기 방위표 실제 크기가 저장 배율을 읽는다");
assert.match(mapFigure, /scene\.scaleChromeScale/, "미리보기 축척 막대 굵기·글자가 저장 배율을 읽는다");
assert.match(mapScene, /const northUnit = u \* northScale/, "공용 장면이 방위표 크기를 계산한다");
assert.match(mapScene, /scaleChromeScale,/, "공용 장면이 축척 막대 크롬 배율을 반환한다");
assert.match(mapPptx, /const u = scene\.northUnit/, "PPT 방위표가 미리보기와 같은 크기 단위를 쓴다");
assert.match(mapPptx, /const chrome = scene\.scaleChromeScale/, "PPT 축척 막대가 미리보기와 같은 크롬 배율을 쓴다");
assert.match(mapPptx, /bar\.px/, "축척 막대 길이는 지도 축척 계산값을 그대로 쓴다");

const { buildMapScene } = await import("../../lib/v2/ui/map-scene.ts");
const { GODEOK_RESULTS } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const fixture = GODEOK_RESULTS.find((result) => result.tileCode === "A01");
assert.ok(fixture, "장식 크기 회귀용 A01 fixture");
const model = toTileView(fixture).map;
assert.ok(model, "장식 크기 회귀용 지도 모델");
const base = buildMapScene({ model, width: 960, height: 540, activeLayer: "white", scale: true, north: 80, avoid: [] });
const resized = buildMapScene({
  model,
  width: 960,
  height: 540,
  activeLayer: "white",
  scale: true,
  north: 80,
  northScale: 1.8,
  scaleChromeScale: 1.7,
  scaleBoxOverride: { x0: base.scaleBox.x0, y0: base.scaleBox.y0, x1: base.scaleBox.x1 + 40, y1: base.scaleBox.y1 + 14 },
  avoid: [],
});
assert.ok(resized.northUnit > base.northUnit, "방위표 크기 핸들이 실제 장면 크기를 키운다");
assert.equal(resized.scale.px, base.scale.px, "축척 막대 길이는 크기 조절로 바뀌지 않는다");
assert.equal(resized.scaleChromeScale, 1.7, "축척 막대 크롬 배율이 장면에 보존된다");

console.log("v2 report element handle contracts passed");
