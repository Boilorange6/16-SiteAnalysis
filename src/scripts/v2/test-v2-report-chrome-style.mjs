import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../components/v2/report/report-mode.tsx", import.meta.url), "utf8");
const drawerMapSource = readFileSync(new URL("../../components/v2/report/drawer-map.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../components/v2/report/report-mode.module.css", import.meta.url), "utf8");
const boardStyles = readFileSync(new URL("../../components/v2/board.module.css", import.meta.url), "utf8");
const logic = readFileSync(new URL("../../lib/v2/ui/report-mode-logic.ts", import.meta.url), "utf8");
const notes = readFileSync(new URL("../../components/v2/report/notes-field.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../../components/v2/report/layout-switcher.tsx", import.meta.url), "utf8");

const reportBodyRule = styles.match(/\.reportBody\s*\{[^}]*\}/)?.[0] ?? "";
const stageFitRule = styles.match(/\.stageFit\s*\{[^}]*\}/)?.[0] ?? "";
const stageSlideRule = styles.match(/\.stageSlide\s*\{[^}]*\}/)?.[0] ?? "";
const mobileRules = styles.match(/@media\s*\(max-width:\s*639px\)\s*\{([\s\S]*)/)?.[1] ?? "";
const reducedMotionRules = styles.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

assert.doesNotMatch(reportBodyRule, /grid-template-columns/, "reportBody는 3열 grid를 예약하지 않는다");
assert.match(styles, /\.stageFit\s*\{[\s\S]*container-type:\s*size;/, "stageFit은 크기 컨테이너다");
assert.doesNotMatch(stageFitRule, /background\s*:|border\s*:|padding\s*:/, "stageFit은 앱 배경 위에 카드 chrome을 깔지 않는다");
assert.match(stageSlideRule, /width:\s*min\(100cqw,\s*calc\(100cqh\s*\*/, "stageSlide는 가로·세로 중 먼저 닿는 쪽에 contain한다");
assert.match(styles, /\.floatCard\s*\{[\s\S]*border-radius:\s*12px;/, "떠 있는 카드는 공통 12px 모서리를 쓴다");
assert.match(mobileRules, /\.drawerCard[^{]*\{[\s\S]*bottom:\s*0;/, "모바일 drawerCard는 아래 시트다");
assert.match(mobileRules, /\.settingsCard[^{]*\{[\s\S]*bottom:\s*0;/, "모바일 settingsCard는 아래 시트 자리다");
assert.match(reducedMotionRules, /\.floatCard[^{]*\{[\s\S]*transform:\s*none;/, "감소된 동작에서는 카드 transform을 끈다");
assert.match(styles, /180ms\s+cubic-bezier\(\.23,1,\.32,1\)/, "카드 나타남 속도와 easing");
assert.match(styles, /\.reportStage\s*\{[\s\S]*--stage-left:\s*88px[\s\S]*--stage-right:\s*24px[\s\S]*--stage-bottom:\s*100px;/, "무대 기본 여백 변수");
assert.match(styles, /\.reportStage\[data-drawer-open="true"\]\s*\{[^}]*--stage-left:\s*418px;/, "서랍 열림 무대 여백");
assert.match(styles, /\.reportStage\[data-settings-open="true"\]\s*\{[^}]*--stage-right:\s*328px;/, "설정 열림 무대 여백");
assert.match(styles, /\.stageFit\s*\{[\s\S]*inset:\s*16px\s+var\(--stage-right\)\s+var\(--stage-bottom\)\s+var\(--stage-left\);/, "stageFit은 카드 여백 안쪽에 맞춘다");
assert.match(styles, /@media\s*\(min-width:\s*640px\)\s*and\s*\(max-width:\s*1024px\)[\s\S]*\.secondaryButton[\s\S]*::after[\s\S]*content:\s*"▶";[\s\S]*\.headerFormat select[\s\S]*max-width:\s*88px;/, "1024px report topbar는 발표 아이콘과 좁은 판형 select를 쓴다");
assert.match(boardStyles, /@media\s*\(min-width:\s*640px\)\s*and\s*\(max-width:\s*1024px\)[\s\S]*\.reportPage > \.topbar[\s\S]*flex-wrap:\s*nowrap;/, "1024px report topbar는 한 줄을 유지한다");
assert.match(boardStyles, /\.reportPage > \.topbar > \.topTitle\s*\{[^}]*display:\s*none;/, "좁은 report topbar는 주소 제목을 숨긴다");
assert.match(boardStyles, /\.reportPage > \.topbar > \.topoHeaderButton\s*\{[^}]*width:\s*44px[^}]*min-width:\s*44px[^}]*padding:\s*0;/, "좁은 report topbar는 수치지형도 버튼을 44px 아이콘으로 줄인다");
assert.match(boardStyles, /\.reportPage > \.topbar > \.topoHeaderButton::before\s*\{[^}]*content:\s*"\+";/, "좁은 report topbar 수치지형도 아이콘");
assert.match(boardStyles, /@media\s*\(min-width:\s*640px\)\s*and\s*\(max-width:\s*900px\)/, "900px report topbar 보조 상태 미디어쿼리");
assert.match(boardStyles, /\.page\.reportPage > \.topbar > \.pill\[href="\/site\/v2\/guide"\],/, "900px report topbar는 가이드 링크를 접는다");
assert.match(boardStyles, /\.page\.reportPage > \.topbar > \.demoTag\s*\{[^}]*display:\s*none;/, "900px report topbar는 데모 상태를 숨긴다");
assert.match(source, /useState<RailKey \| null>\(\(\) => initialReportRail\(board\.reportDoc\.pages\.length > 0\)\)/, "페이지가 있으면 rail을 닫고 빈 보고서에서만 연다");
assert.match(logic, /export function initialReportRail\(hasPages: boolean\)/, "초기 rail 계약은 페이지 존재 여부를 받는다");
assert.match(mobileRules, /\.toolPill\s*\{[\s\S]*position:\s*static;[\s\S]*order:\s*1;/, "모바일 도구 막대는 무대 위 가로줄이다");
assert.match(mobileRules, /\.pageDock\s*\{[\s\S]*position:\s*static;[\s\S]*order:\s*3;/, "모바일 페이지 줄은 viewport 흐름 안에 있다");

for (const className of ["toolPill", "drawerCard", "pageDock", "dockLead"]) {
  assert.match(source, new RegExp(`styles\\.${className}\\b`), `${className} JSX 계약`);
}
assert.doesNotMatch(source, /styles\.(reportRail|drawerColumn|editorSide|reportWorkspace)\b/, "옛 3열 레이아웃 클래스가 JSX에 남지 않는다");
assert.match(source, /data-drawer-open=/, "무대에 서랍 열림 상태가 있다");
assert.match(source, /data-settings-open=\{settingsOpen \? "true" : "false"\}/, "설정 카드 상태를 settingsOpen에 연결한다");
assert.match(source, /aria-expanded=\{rail === "pages" && drawerOpen\}/, "도구 막대 버튼은 서랍 펼침 상태를 알린다");
assert.match(source, /aria-haspopup=["']menu["']/, "레이아웃 메뉴 트리거가 menu임을 알린다");
assert.match(source, /data-has-notes/, "메모가 있는 페이지의 점 표시 계약");
assert.match(source, /<LayoutSwitcher[\s\S]*compact/, "페이지 줄 레이아웃 메뉴는 compact다");
assert.match(source, /<NotesField[\s\S]*compact/, "페이지 줄 메모 popover는 compact다");
assert.match(notes, /compact\?:\s*boolean/, "NotesField compact prop");
assert.match(layout, /compact\?:\s*boolean/, "LayoutSwitcher compact prop");

const detailsCount = drawerMapSource.match(/<details\b/g)?.length ?? 0;
assert.ok(detailsCount >= 5, "지도 설정의 자주 쓰지 않는 묶음은 native details로 접는다");
assert.match(drawerMapSource, /scaleError\s*&&\s*<p[\s\S]*role=["']alert["']/, "축척 범위 오류는 scaleError일 때만 보인다");
assert.match(drawerMapSource, /setScaleError\("1:500부터 1:50,000까지 입력합니다"\)/, "축척 오류 문구는 요구한 값을 유지한다");
assert.match(drawerMapSource, /aria-pressed=\{frame\.locked\}/, "지도 고정은 카드 머리의 aria-pressed 토글이다");
assert.doesNotMatch(drawerMapSource, /checked=\{frame\.locked\}/, "지도 고정 체크박스는 카드 본문에 중복하지 않는다");
assert.doesNotMatch(drawerMapSource, /지도가 잠겨 있어 드래그|잠금 해제 후 이동 가능/, "잠금 설명 문장은 상태 토글과 중복하지 않는다");
assert.doesNotMatch(drawerMapSource, /<fieldset\b|mapFieldset/, "지도 설정 묶음은 겹친 fieldset 테두리를 쓰지 않는다");
assert.match(styles, /\.mapSummary\s*\{[\s\S]*min-height:\s*44px;/, "details summary는 44px 누름 영역이다");
assert.match(styles, /\.legendPlacement\s*\{[\s\S]*repeat\(3,\s*minmax\(0,\s*1fr\)\)/, "범례 위치는 3칸 분할 버튼이다");
assert.match(styles, /\.settingsCard\s*\{[\s\S]*overflow-x:\s*hidden;[\s\S]*overflow-y:\s*auto;/, "설정 카드는 가로 넘침을 숨기고 세로만 스크롤한다");

const { initialReportRail, isTypingTarget } = await import("../../lib/v2/ui/report-mode-logic.ts");
assert.equal(initialReportRail(true), null, "페이지가 있는 보고서의 초기 rail은 닫혀 있다");
assert.equal(initialReportRail(false), "pages", "페이지가 없는 보고서는 페이지 서랍으로 시작한다");
assert.equal(isTypingTarget({ tagName: "TEXTAREA" }), true, "메모 textarea는 페이지 키보드 탐색 대상이 아니다");
assert.equal(isTypingTarget({ tagName: "BUTTON" }), false, "버튼은 페이지 키보드 탐색 대상이다");

console.log("v2 report chrome style tests passed");
