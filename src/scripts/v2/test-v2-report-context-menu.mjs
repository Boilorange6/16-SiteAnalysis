import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const mode = readFileSync(new URL("../../components/v2/report/report-mode.tsx", import.meta.url), "utf8");
const surface = readFileSync(new URL("../../components/v2/report/slide-surface.tsx", import.meta.url), "utf8");

assert.match(mode, /function ElementContextMenu\(/, "모든 보고서 대상은 하나의 공통 메뉴를 사용한다");
assert.doesNotMatch(mode, /function FontContextMenu\(/, "글자 전용 메뉴가 남아 있지 않다");
assert.match(surface, /type SurfaceContextTarget =/, "메뉴 대상 계약이 요소 종류별로 선언된다");
for (const kind of ["panel", "element", "textBox", "decoration", "mapElement", "mapLabel", "sheetCell"]) {
  assert.match(surface, new RegExp(`kind: "${kind}"`), `${kind} 대상이 공통 메뉴에 연결된다`);
}

const menuStart = mode.indexOf("function ElementContextMenu(");
const menuSource = mode.slice(menuStart, mode.indexOf("\nfunction pageTitleForToast", menuStart));
const nameIndex = menuSource.indexOf("contextTargetLabel(state.target");
const fontIndex = menuSource.indexOf("<FontSizeStepRow");
const actionIndex = menuSource.indexOf("actions.map");
const positionIndex = menuSource.indexOf("위치·크기 초기화");
const dividerIndex = menuSource.indexOf("fontContextDivider", positionIndex);
const deleteIndex = menuSource.indexOf("지우기 Delete");
assert.ok(nameIndex >= 0 && nameIndex < fontIndex, "메뉴 첫 항목은 요소 이름이다");
assert.ok(fontIndex < actionIndex, "글자 조절은 요소별 항목보다 먼저다");
assert.ok(actionIndex < positionIndex, "요소별 항목은 위치 초기화보다 먼저다");
assert.ok(positionIndex < dividerIndex && dividerIndex < deleteIndex, "위치 초기화 뒤 구분선과 삭제 순서를 지킨다");
assert.match(mode, /mapLabelEntries\(mapModel\)/, "지도 요소 메뉴 이름은 지도 라벨 값에서 만든다");
assert.match(mode, /onDelete=\{deleteContextElement\}/, "공통 메뉴의 삭제는 현재 대상 삭제 경로를 사용한다");
assert.match(mode, /scale: "축척"/, "F1 글자 크기 창에 축척 행이 있다");
assert.match(mode, /target\.kind === "decoration" && target\.key === "scaleBar"\) return "scale"/, "축척 막대 컨텍스트는 축척 글자 값을 사용한다");
assert.doesNotMatch(surface, /onFontContextMenu\(\"|onFontContextMenu\?\.\(\"/, "표면의 공통 메뉴 입구는 문자열 대신 요소 대상을 전달한다");

console.log("v2 report context menu contracts passed");
