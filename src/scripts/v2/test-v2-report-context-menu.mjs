import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const mode = readFileSync(new URL("../../components/v2/report/report-mode.tsx", import.meta.url), "utf8");
const surface = readFileSync(new URL("../../components/v2/report/slide-surface.tsx", import.meta.url), "utf8");
const mapFigure = readFileSync(new URL("../../components/v2/map-figure.tsx", import.meta.url), "utf8");

assert.match(mode, /function ElementContextMenu\(/, "모든 보고서 대상은 하나의 공통 메뉴를 사용한다");
assert.doesNotMatch(mode, /function FontContextMenu\(/, "글자 전용 메뉴가 남아 있지 않다");
assert.match(surface, /type SurfaceContextTarget =/, "메뉴 대상 계약이 요소 종류별로 선언된다");
for (const kind of ["panel", "element", "textBox", "decoration", "mapElement", "mapLabel", "sheetCell"]) {
  assert.match(surface, new RegExp(`kind: "${kind}"`), `${kind} 대상이 공통 메뉴에 연결된다`);
}

const menuStart = mode.indexOf("function ElementContextMenu(");
const menuSource = mode.slice(menuStart, mode.indexOf("\nfunction pageTitleForToast", menuStart));
const nameIndex = menuSource.indexOf("contextTargetLabel(state.target");
const scopeIndex = menuSource.indexOf("<FontScopeSwitch");
const fontIndex = menuSource.indexOf("<FontSizeStepRow");
const actionIndex = menuSource.indexOf("actions.map");
const positionIndex = menuSource.indexOf("위치·크기 초기화");
const dividerIndex = menuSource.indexOf("fontContextDivider", positionIndex);
const deleteIndex = menuSource.indexOf("지우기 Delete");
assert.ok(nameIndex >= 0 && nameIndex < fontIndex, "메뉴 첫 항목은 요소 이름이다");
assert.ok(nameIndex < scopeIndex && scopeIndex < fontIndex, "요소 이름 뒤 범위, 그 다음 글자 조절 순서다");
assert.ok(fontIndex < actionIndex, "글자 조절은 요소별 항목보다 먼저다");
assert.ok(actionIndex < positionIndex, "요소별 항목은 위치 초기화보다 먼저다");
assert.ok(positionIndex < dividerIndex && dividerIndex < deleteIndex, "위치 초기화 뒤 구분선과 삭제 순서를 지킨다");
assert.match(mode, /mapLabelEntries\(mapModel\)/, "지도 요소 메뉴 이름은 지도 라벨 값에서 만든다");
assert.match(mode, /onDelete=\{deleteContextElement\}/, "공통 메뉴의 삭제는 현재 대상 삭제 경로를 사용한다");
assert.match(mode, /scale: "축척"/, "F1 글자 크기 창에 축척 행이 있다");
assert.match(mode, /target\.kind === "decoration" && target\.key === "scaleBar"\) return "scale"/, "축척 막대 컨텍스트는 축척 글자 값을 사용한다");
assert.doesNotMatch(surface, /onFontContextMenu\(\"|onFontContextMenu\?\.\(\"/, "표면의 공통 메뉴 입구는 문자열 대신 요소 대상을 전달한다");
assert.match(surface, /data-element-action-bar\], \[data-report-decoration\], \[data-decoration-frame\]/, "장식 선택 프레임은 상위 지도 진입 포인터 경로를 차단한다");
assert.match(surface, /isResizeAnchorHit/, "작은 프레임의 핸들 겹침은 중앙 드래그로 라우팅한다");
assert.match(surface, /onContextMenu\?: \(event: React\.MouseEvent<HTMLDivElement>\) => void/, "선택 프레임이 컨텍스트 메뉴 핸들러를 받는다");
assert.match(surface, /data-panel-frame=\{panelKey\}[\s\S]*?onContextMenu=\{\(event\).*?onContextMenu\?\.\(event\)/s, "출처 선택 프레임이 우클릭을 공통 메뉴로 전달한다");
assert.match(surface, /!isResizeAnchorHit\(direction, event\)/, "핸들 중앙 겹침은 리사이즈를 시작하지 않는다");
assert.match(surface, /: slideLayout\(format\)\.strip;/, "기본 출처 줄은 절대 rect를 다시 배율 변환하지 않는다");
assert.match(surface, /const target = event\.target as HTMLElement;\s+if \(target\.closest\("\[data-map-pick\]/, "지도 요소 hit에서는 지도 이동을 시작하지 않는다");
assert.match(mapFigure, /onPointerDown: \(event: ReactPointerEvent<SVGElement>\) => \{[^}]*event\.stopPropagation\(\)/, "지도 SVG hit은 pointerdown을 지도 이동으로 버블링하지 않는다");

console.log("v2 report context menu contracts passed");
