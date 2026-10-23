import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { defaultFrame, normalizeMapLabelBox } from "../../lib/v2/report/report-doc.ts";
import {
  deleteElementFramePatch,
  labelBoxFramePatch,
  labelFramePatch,
  mapElementKindLabel,
  mapLabelSwitchState,
  resetLabelBoxFramePatch,
  restoreAllDeletedElementFramePatch,
} from "../../lib/v2/ui/report-mode-logic.ts";
import { restoreReportDoc } from "../../lib/v2/ui/board-state.ts";
import { buildMapScene, mapFeatureKey, mapTextWidth, wrapMapText } from "../../lib/v2/ui/map-scene.ts";
import { slideLegend } from "../../lib/v2/ui/overlay-layout.ts";
import { GODEOK_RESULTS } from "../../lib/v2/ui/fixtures/godeok.ts";
import { toTileView } from "../../lib/v2/ui/tile-view.ts";

const frame = defaultFrame();

assert.deepEqual(frame.hiddenLabelKeys, []);
assert.deepEqual(frame.deletedElementKeys, []);
assert.deepEqual(frame.labelBoxes, {});

assert.deepEqual(
  labelFramePatch(frame, { hiddenKeys: ["feature|station|1"] }),
  { hiddenLabelKeys: ["feature|station|1"] },
);
assert.deepEqual(
  deleteElementFramePatch(frame, "polygon|park|1"),
  { deletedElementKeys: ["polygon|park|1"] },
);
assert.deepEqual(
  restoreAllDeletedElementFramePatch({ ...frame, deletedElementKeys: ["polygon|park|1", "line|road|2"] }),
  { deletedElementKeys: [] },
);
assert.deepEqual(
  labelBoxFramePatch(frame, "feature|station|1", { x: -0.2, y: 0.2, w: 0.4, h: 0.3 }),
  { labelBoxes: { "feature|station|1": { x: 0, y: 0.2, w: 0.4, h: 0.3 } } },
);
assert.deepEqual(
  resetLabelBoxFramePatch({ ...frame, labelBoxes: { "feature|station|1": { x: 0.1, y: 0.2, w: 0.3, h: 0.2 } } }, "feature|station|1"),
  { labelBoxes: {} },
);
assert.deepEqual(
  normalizeMapLabelBox({ x: 0.9, y: 0.9, w: 0.4, h: 0.4 }),
  { x: 0.6, y: 0.6, w: 0.4, h: 0.4 },
);
assert.equal(mapElementKindLabel("polygon|park|1"), "영역");
assert.equal(mapElementKindLabel("line|road|1"), "선");
assert.equal(mapElementKindLabel("feature|station|1"), "지점");
assert.equal(mapLabelSwitchState("feature|station|1", [], false), false, "toolbar label switch follows the rendered label state");
assert.equal(mapLabelSwitchState("feature|station|1", [], true), true, "toolbar label switch can follow a rendered label");

const mapFigureSource = readFileSync(new URL("../../components/v2/map-figure.tsx", import.meta.url), "utf8");
assert.match(mapFigureSource, /const labelInteractive = canSelectLabel && \(fixedLabel \|\| !!onLabelSelect\)/, "all visible callout variants are selectable in the report surface");
assert.doesNotMatch(mapFigureSource, /candidate\.text} · 라벨 \$\{/, "hover labels do not append label visibility state");

const legacyFrame = defaultFrame();
delete legacyFrame.hiddenLabelKeys;
delete legacyFrame.deletedElementKeys;
delete legacyFrame.labelBoxes;
legacyFrame.legend.hidden = ["feature|station|1", "park"];
const restoredLegacy = restoreReportDoc(
  {
    v: 1,
    format: "wide",
    pages: [{ id: "p1", layout: "map-summary", panels: {}, textBoxes: [], notes: "", kind: "tile", tileId: "t-A01", part: { type: "single" }, settings: {}, frame: legacyFrame }],
  },
  new Set(["t-A01"]),
);
assert.deepEqual(restoredLegacy.pages[0].frame.hiddenLabelKeys, ["feature|station|1"]);
assert.deepEqual(restoredLegacy.pages[0].frame.legend.hidden, ["park"]);

const explicitFrame = defaultFrame();
explicitFrame.legend.hidden = ["park"];
explicitFrame.hiddenLabelKeys = ["feature|station|2"];
const restoredExplicit = restoreReportDoc(
  {
    v: 1,
    format: "wide",
    pages: [{ id: "p1", layout: "map-summary", panels: {}, textBoxes: [], notes: "", kind: "tile", tileId: "t-A01", part: { type: "single" }, settings: {}, frame: explicitFrame }],
  },
  new Set(["t-A01"]),
);
assert.deepEqual(restoredExplicit.pages[0].frame.hiddenLabelKeys, ["feature|station|2"]);
assert.deepEqual(restoredExplicit.pages[0].frame.legend.hidden, ["park"]);

const fixture = GODEOK_RESULTS.find((result) => result.tileCode === "A01");
assert.ok(fixture, "지도 삭제·라벨 상자 fixture가 필요하다");
const model = toTileView(fixture).map;
assert.ok(model, "A01 지도 모델이 필요하다");
const firstLegendLayer = slideLegend(model, true).items.find((item) => !item.site)?.layer;
assert.ok(firstLegendLayer, "범례 항목 fixture가 필요하다");
const hiddenLegend = slideLegend(model, true, undefined, true, "wide", { hidden: [firstLegendLayer], placement: "hidden" });
assert.equal(hiddenLegend.items.some((item) => item.layer === firstLegendLayer), false, "범례 숨김이 지도 요소 숨김과 섞였다");
assert.equal(hiddenLegend.rect, null, "범례 칸 숨김 placement가 레이아웃에 남았다");
const feature = model.features[0];
assert.ok(feature, "A01 지점 fixture가 필요하다");
const featureKey = mapFeatureKey(feature.layer, feature.fid, 0);
const sceneOptions = {
  model,
  width: 960,
  height: 540,
  activeLayer: "white",
  scale: false,
  showAutomaticLabels: true,
  pinnedKeys: [featureKey],
  avoid: [],
};
const deletedScene = buildMapScene({ ...sceneOptions, deletedElementKeys: [featureKey] });
assert.equal(deletedScene.features.some((entry) => entry.key === featureKey), false, "삭제 요소가 장면 지점에 남지 않는다");
assert.equal(deletedScene.labels.some((entry) => entry.key === featureKey), false, "삭제 요소 라벨이 장면에 남지 않는다");
const boxedScene = buildMapScene({
  ...sceneOptions,
  labelBoxes: { [featureKey]: { x: 0.62, y: 0.18, w: 0.2, h: 0.12 } },
});
const boxedPlacement = boxedScene.labelPlacements.find((placement) => placement.entry.key === featureKey);
assert.ok(boxedPlacement, "저장된 라벨 상자가 장면에 있어야 한다");
assert.ok(Math.abs(boxedPlacement.box.x0 - 0.62 * 960) < 1e-6, "저장 라벨 상자 x가 지도 비율과 같다");
assert.ok(Math.abs(boxedPlacement.box.y0 - 0.18 * 540) < 1e-6, "저장 라벨 상자 y가 지도 비율과 같다");
assert.equal(boxedPlacement.autoBox !== undefined, true, "저장 라벨 상자는 자동 위치를 함께 보존한다");

// 폭을 줄인 말풍선은 말줄임 대신 줄바꿈한다(미리보기·PPT가 같은 lines를 쓴다).
assert.deepEqual(wrapMapText("고덕 그라시움 정류장", 10, 35), ["고덕", "그라시", "움", "정류장"]);
assert.deepEqual(wrapMapText("버스정류장", 10, 1000), ["버스정류장"]);
const narrowScene = buildMapScene({ ...sceneOptions, labelBoxes: { [featureKey]: { x: 0.1, y: 0.1, w: 0.06, h: 0.2 } } });
const narrow = narrowScene.labelPlacements.find((placement) => placement.entry.key === featureKey);
assert.ok(narrow && narrow.text.lines.length > 1, "좁은 말풍선 글이 여러 줄로 나뉜다");
assert.ok(narrow.text.lines.every((line) => !line.text.includes("…")), "좁은 말풍선 글에 말줄임이 없다");
assert.ok(narrow.text.lines.every((line) => mapTextWidth(line.text, narrow.text.fontSize) <= 0.06 * 960), "줄마다 말풍선 폭 안에 들어간다");

console.log("report map selection contracts: PASS");
