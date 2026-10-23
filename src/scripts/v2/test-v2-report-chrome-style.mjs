import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../components/v2/report/report-mode.tsx", import.meta.url), "utf8");
const drawerMapSource = readFileSync(new URL("../../components/v2/report/drawer-map.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../components/v2/report/report-mode.module.css", import.meta.url), "utf8");
const boardStyles = readFileSync(new URL("../../components/v2/board.module.css", import.meta.url), "utf8");
const logic = readFileSync(new URL("../../lib/v2/ui/report-mode-logic.ts", import.meta.url), "utf8");
const notes = readFileSync(new URL("../../components/v2/report/notes-field.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../../components/v2/report/layout-switcher.tsx", import.meta.url), "utf8");
const drawerPages = readFileSync(new URL("../../components/v2/report/drawer-pages.tsx", import.meta.url), "utf8");
const drawerTiles = readFileSync(new URL("../../components/v2/report/drawer-tiles.tsx", import.meta.url), "utf8");
const slideSurfaceStyles = readFileSync(new URL("../../components/v2/report/slide-surface.module.css", import.meta.url), "utf8");

const reportBodyRule = styles.match(/\.reportBody\s*\{[^}]*\}/)?.[0] ?? "";
const stageFitRule = styles.match(/\.stageFit\s*\{[^}]*\}/)?.[0] ?? "";
const stageSlideRule = styles.match(/\.stageSlide\s*\{[^}]*\}/)?.[0] ?? "";
const floatCardRule = styles.match(/\.floatCard\s*\{[^}]*\}/)?.[0] ?? "";
const anchoredCardRule = styles.match(/\.anchoredCard\s*\{[^}]*\}/)?.[0] ?? "";
const drawerCardRule = styles.match(/\.drawerCard\s*\{[^}]*\}/)?.[0] ?? "";
const activeRailRule = styles.match(/\.railButtonActive\s*\{[^}]*\}/)?.[0] ?? "";
const layoutActiveRule = styles.match(/\.layoutOptionActive\s*\{[^}]*\}/g)?.find((rule) => /border:\s*2px/.test(rule)) ?? "";
const mobileRules = styles.match(/@media\s*\(max-width:\s*639px\)\s*\{([\s\S]*)/)?.[1] ?? "";
const desktopStyles = styles.slice(0, styles.indexOf("@media (max-width: 639px)"));
const reducedMotionRules = styles.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
const toolPillStart = source.indexOf("styles.toolPill");
const pageDockStart = source.indexOf("styles.pageDock");
const toolPillBlock = toolPillStart >= 0 && pageDockStart > toolPillStart ? source.slice(toolPillStart, pageDockStart) : "";
const pageDockBlock = pageDockStart >= 0 ? source.slice(pageDockStart, source.indexOf("</main>", pageDockStart)) : "";
const fontPopoverSource = source.slice(source.indexOf("const FONT_SIZE_LABELS"), source.indexOf("function pageTitleForToast"));

assert.doesNotMatch(reportBodyRule, /grid-template-columns/, "reportBody는 3열 grid를 예약하지 않는다");
assert.match(styles, /\.stageFit\s*\{[\s\S]*container-type:\s*size;/, "stageFit은 크기 컨테이너다");
assert.doesNotMatch(stageFitRule, /background\s*:|border\s*:|padding\s*:/, "stageFit은 앱 배경 위에 카드 chrome을 깔지 않는다");
assert.match(stageSlideRule, /width:\s*min\(100cqw,\s*calc\(100cqh\s*\*/, "stageSlide는 가로·세로 중 먼저 닿는 쪽에 contain한다");
assert.match(styles, /\.floatCard\s*\{[\s\S]*border-radius:\s*12px;/, "떠 있는 카드는 공통 12px 모서리를 쓴다");
assert.match(floatCardRule, /background:\s*#fff;/, "공통 떠 있는 카드는 흰 카드다");
assert.match(floatCardRule, /border:\s*1px solid #e1e4e9;/, "공통 떠 있는 카드는 지정 테두리를 쓴다");
assert.match(floatCardRule, /box-shadow:\s*[^;]+rgba\(/, "공통 떠 있는 카드는 강화된 그림자를 쓴다");
assert.match(mobileRules, /\.drawerCard[^{]*\{[\s\S]*bottom:\s*0;/, "모바일 drawerCard는 아래 시트다");
assert.match(mobileRules, /\.settingsCard[^{]*\{[\s\S]*bottom:\s*0;/, "모바일 settingsCard는 아래 시트 자리다");
assert.match(reducedMotionRules, /\.floatCard[^{]*\{[\s\S]*transform:\s*none;/, "감소된 동작에서는 카드 transform을 끈다");
assert.match(styles, /180ms\s+cubic-bezier\(\.23,1,\.32,1\)/, "카드 나타남 속도와 easing");
assert.match(styles, /\.reportStage\s*\{[\s\S]*--stage-left:\s*88px[\s\S]*--stage-right:\s*24px[\s\S]*--stage-bottom:\s*140px;/, "무대 기본 여백 변수");
assert.doesNotMatch(styles, /--stage-left:\s*418px;/, "서랍을 열어도 무대 왼쪽 여백을 늘리지 않는다");
assert.doesNotMatch(styles, /\.reportStage\[data-drawer-open="true"\][^{]*\{[^}]*--stage-left:/, "서랍 상태는 stage-left를 바꾸지 않는다");
assert.match(styles, /@media\s*\(max-width:\s*1023px\)/, "1023px 이하 기존 지도 미디어쿼리를 보존한다");
assert.match(anchoredCardRule, /position:\s*absolute;/, "데스크톱 연결 카드는 무대 위에 뜬다");
assert.match(drawerCardRule, /bottom:\s*(?:var\(--stage-bottom\)|calc\([^;]*var\(--stage-bottom\)[^;]*\));/, "서랍 아래 끝은 페이지 띠 무대 여백을 따른다");
assert.match(styles, /\.reportStage\[data-settings-open="true"\]\s*\{[^}]*--stage-right:\s*328px;/, "설정 열림 무대 여백");
assert.match(styles, /\.stageFit\s*\{[\s\S]*inset:\s*16px\s+var\(--stage-right\)\s+var\(--stage-bottom\)\s+var\(--stage-left\);/, "stageFit은 카드 여백 안쪽에 맞춘다");
assert.match(styles, /@media\s*\(min-width:\s*640px\)\s*and\s*\(max-width:\s*1024px\)[\s\S]*\.secondaryButton[\s\S]*::after[\s\S]*content:\s*"▶";[\s\S]*\.headerFormat select[\s\S]*width:\s*120px;[\s\S]*max-width:\s*120px;/, "1024px report topbar는 발표 아이콘과 선택된 판형을 보여 줄 select를 쓴다");
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

for (const className of ["toolPill", "drawerCard", "pageDock", "railButton"]) {
  assert.match(source, new RegExp(`styles\\.${className}\\b`), `${className} JSX 계약`);
}
assert.doesNotMatch(source, /styles\.(dockLead|dockPopover|dockButton)\b/, "페이지 독의 옛 레이아웃·팝오버 클래스가 제거된다");
assert.doesNotMatch(desktopStyles, /\.(dockLead|dockPopover|dockButton)\b/, "활성 데스크톱 CSS에서 페이지 독의 옛 계약이 제거된다");
assert.doesNotMatch(source, /styles\.(reportRail|drawerColumn|editorSide|reportWorkspace)\b/, "옛 3열 레이아웃 클래스가 JSX에 남지 않는다");
assert.match(source, /data-drawer-open=/, "무대에 서랍 열림 상태가 있다");
assert.match(source, /data-settings-open=\{settingsOpen \? "true" : "false"\}/, "설정 카드 상태를 settingsOpen에 연결한다");
assert.match(toolPillBlock, /role=["']separator["']|styles\.toolDivider/, "도구 막대에 페이지·요소와 설정 도구를 가르는 구분선이 있다");
assert.match(toolPillBlock, /레이아웃/, "레이아웃은 도구 막대에 있다");
assert.match(toolPillBlock, /메모/, "메모는 도구 막대에 있다");
assert.match(toolPillBlock, /styles\.railButton/, "레이아웃·메모는 railButton 계약을 쓴다");
for (const state of ["drawerOpen", "fontSizePopoverOpen", "layoutPopoverOpen", "notesPopoverOpen"]) {
  assert.match(toolPillBlock, new RegExp(`${state}[\\s\\S]*styles\\.railButtonActive`), `${state}는 열린 도구 active 상태를 쓴다`);
}
assert.match(source, /aria-expanded=\{rail === "pages" && drawerOpen\}/, "페이지 도구 버튼은 서랍 펼침 상태를 알린다");
assert.match(source, /aria-haspopup=["']dialog["'][^>]*aria-expanded=\{layoutPopoverOpen\}/, "레이아웃 팝오버 트리거가 dialog임을 알린다");
assert.match(source, /id="report-layout-menu"[\s\S]*role="dialog"/, "레이아웃 팝오버가 dialog 의미를 알린다");
assert.match(source, /document\.activeElement[\s\S]*#report-drawer, \[role=\\"dialog\\"\]/, "페이지 키 탐색은 포커스된 서랍·대화상자를 건너뛴다");
assert.match(source, /data-has-notes/, "메모가 있는 페이지의 점 표시 계약");
assert.match(source, /data-has-notes=\{selectedPage\?\.notes\.trim\(\)/, "메모 점은 선택 페이지의 메모 유무를 반영한다");
assert.match(source, /selectedPage\?\.notes\.trim\(\)\s*&&\s*<span className=\{styles\.noteDot\}/, "메모가 있을 때만 점을 표시한다");
assert.match(activeRailRule, /color:\s*#fff;[\s\S]*background:\s*#2f6fdb;/, "열린 도구는 파란 배경과 흰 아이콘·글자를 쓴다");
assert.match(source, /--tail-y/, "열린 창은 공통 tail 위치 변수를 계산한다");
assert.match(source, /styles\.(?:anchoredCard|popoverTail)/, "서랍·팝오버는 공통 연결 카드 계약을 쓴다");
assert.match(styles, /(?:\.anchoredCard|\.popoverTail)[^{]*(?:::before|::after)?\s*\{[\s\S]*var\(--tail-y\)/, "연결 카드에는 트리거를 가리키는 tail 스타일이 있다");
for (const id of ["report-drawer", "report-font-size-popover", "report-layout-menu", "report-notes-popover"]) {
  const start = source.indexOf(`id="${id}"`);
  const end = source.indexOf(">", start);
  const block = start >= 0 ? source.slice(Math.max(0, start - 180), source.indexOf("</", end)) : "";
  assert.match(block, /styles\.(?:anchoredCard|popoverTail)/, `${id}는 tail 연결 카드를 쓴다`);
  assert.match(block, /style=\{|--tail-y|popoverTail/, `${id}는 공통 tail 위치를 받는다`);
}
assert.match(source, /document\.addEventListener\("pointerdown"/, "서랍·팝오버는 바깥 클릭으로 닫힌다");
assert.match(source, /closeDrawer\(true\)/, "서랍 닫기는 opener 포커스를 복귀시킨다");
assert.match(source, /requestAnimationFrame\(\(\) => opener\?\.focus\(\)\)/, "팝오버 닫기도 opener 포커스를 복귀시킨다");
assert.match(styles, /\.iconButton\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/, "닫기 아이콘 버튼은 44px 누름 영역이다");
assert.match(drawerPages, /closeLabel="페이지 추가 창 닫기"/, "페이지 서랍은 공통 머리 닫기 버튼을 이름 붙인다");
assert.match(drawerPages, /페이지 추가/, "페이지 서랍 머리 제목");
assert.match(drawerTiles, /closeLabel="분석 타일 창 닫기"/, "타일 서랍은 공통 머리 닫기 버튼을 이름 붙인다");
assert.match(drawerPages, /afterPage[\s\S]*(?:쪽 뒤에|맨 뒤에)/, "페이지 서랍 머리는 추가 위치를 보여 준다");
assert.match(drawerPages, /추천 구성으로 다시 시작/, "페이지 서랍의 추천 구성 링크 액션");
assert.match(drawerPages, /hasLegacy\s*&&/, "legacy 불러오기는 있을 때만 보인다");
assert.match(drawerTiles, /context=\{mode === "compare" \? `\$\{compareSelected\.length\}개`/, "타일 비교 서랍은 선택 개수를 머리에 보여 준다");
assert.match(styles, /\.pageCardGrid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/, "페이지 추가 카드는 2열이다");
assert.match(drawerPages, /viewBox="0 0 120 90"/, "페이지 추가 카드 미리보기는 4:3 viewBox다");
assert.match(styles, /\.pageCardBlank\s*\{[^}]*border:\s*1px dashed/, "빈 페이지 미리보기는 점선이다");
assert.match(styles, /\.tileList\s*\{[^}]*grid-template-columns:\s*repeat\(2,/, "분석 타일은 2열 카드 목록이다");
assert.match(styles, /\.filterChipActive\s*\{[^}]*color:\s*#fff;[^}]*background:\s*#15171c;/, "선택된 타일 필터는 검정 바탕·흰 글자다");
assert.match(drawerTiles, /pagesUsingTile[\s\S]*쪽/, "사용 중 타일은 사용 중인 페이지 수를 표시한다");
assert.match(drawerTiles, /draggable=\{mode === "single"\}/, "타일 단일 모드는 기존 끌기 의미를 보존한다");
assert.match(drawerTiles, /mode === "single" \? onAdd\(/, "타일 단일 모드는 클릭 추가 의미를 보존한다");
assert.match(drawerTiles, /onToggleCompare|onCreateCompare/, "타일 비교 모드 의미를 보존한다");
assert.match(drawerTiles, /SlideSurface[\s\S]*mode=["']thumb["']/, "타일 카드는 실제 SlideSurface thumb 미리보기를 쓴다");
assert.match(drawerTiles, /IntersectionObserver/, "타일 미리보기는 보이는 카드만 실제 렌더한다");
assert.match(styles, /\.tileCard\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*3/, "타일 미리보기 카드는 4:3이다");
assert.doesNotMatch(source, /TextBoxDrawer/, "글상자는 별도 서랍 없이 공통 팝오버를 쓴다");
assert.match(source, /const addTextBoxFromRail = useCallback\(\(opener\?[^)]*\) =>[\s\S]*toggleTextBoxPopover/, "글상자 버튼은 종류 팝오버를 연다");
assert.match(toolPillBlock, /textBoxPopoverOpen|textBoxPlacement/, "글상자 도구는 팝오버·놓기 active 상태를 가진다");
assert.match(slideSurfaceStyles, /\.textBox \[data-text-box-content\]:empty::before[\s\S]*글을 입력하세요/, "글상자 빈 상태 자리표시자 계약은 슬라이드 CSS에 남아 있다");
assert.doesNotMatch(fontPopoverSource, /<select/, "글자 크기 팝오버에는 범위 select가 없다");
assert.match(fontPopoverSource, /제목[\s\S]*요약[\s\S]*범례[\s\S]*지도 라벨[\s\S]*출처/, "글자 크기 팝오버는 5개 요소를 표시한다");
assert.match(layout, /pageNumber[\s\S]*레이아웃[\s\S]*쪽/, "레이아웃 팝오버 머리는 레이아웃·N쪽이다");
assert.match(layout, /<svg|viewBox=|<rect/, "레이아웃 선택지는 실제 미니어처 도형을 쓴다");
assert.match(styles, /\.layoutOptions\s*\{[^}]*grid-template-columns:\s*repeat\(2,/, "레이아웃 선택지는 2×2 격자다");
assert.match(layoutActiveRule, /border:\s*2px solid #2f6fdb;/, "선택 레이아웃은 2px 파란 테두리다");
assert.match(layoutActiveRule, /background:\s*#(?:e0eafa|eaf2ff|edf4ff|eef3fb);/, "선택 레이아웃은 연한 파랑 바탕이다");
assert.match(source, /SidePanelHeader title="발표 메모"[\s\S]*context=\{`\$\{selectedPageNumber/, "메모 팝오버 머리는 공통 제목·N쪽이다");
assert.match(source, /저장됨/, "메모 팝오버는 저장 상태를 보인다");
assert.match(styles, /\.railPopover, \.notesPopover, \.fontSizePopover, \.textBoxPopover \{[^}]*width:\s*240px;/, "메모 팝오버 폭은 240px이다");
assert.match(styles, /\.notesFieldCompact textarea\s*\{[^}]*height:\s*150px/, "메모 textarea는 150px이다");
assert.match(notes, /compact\?:\s*boolean/, "NotesField compact prop");
assert.match(layout, /compact\?:\s*boolean/, "LayoutSwitcher compact prop");

const detailsCount = drawerMapSource.match(/<details\b/g)?.length ?? 0;
assert.ok(detailsCount >= 5, "지도 설정의 자주 쓰지 않는 묶음은 native details로 접는다");
assert.match(drawerMapSource, /scaleError\s*&&\s*<p[\s\S]*role=["']alert["']/, "축척 범위 오류는 scaleError일 때만 보인다");
assert.match(drawerMapSource, /setScaleError\("1:500부터 1:50,000까지 입력합니다"\)/, "축척 오류 문구는 요구한 값을 유지한다");
assert.match(drawerMapSource, /aria-pressed=\{frame\.locked\}/, "지도 고정은 카드 머리의 aria-pressed 토글이다");
assert.doesNotMatch(drawerMapSource, /checked=\{frame\.locked\}/, "지도 고정 체크박스는 카드 본문에 중복하지 않는다");
assert.match(drawerMapSource, />\s*고정\s*<\/button>/, "지도 고정 토글 글자는 상태와 무관하게 고정이다");
assert.doesNotMatch(drawerMapSource, /지도가 잠겨 있어 드래그|잠금 해제 후 이동 가능/, "잠금 설명 문장은 상태 토글과 중복하지 않는다");
assert.doesNotMatch(drawerMapSource, /<fieldset\b|mapFieldset/, "지도 설정 묶음은 겹친 fieldset 테두리를 쓰지 않는다");
assert.match(styles, /\.mapSummary\s*\{[\s\S]*min-height:\s*44px;/, "details summary는 44px 누름 영역이다");
assert.match(styles, /\.legendPlacement\s*\{[\s\S]*repeat\(3,\s*minmax\(0,\s*1fr\)\)/, "범례 위치는 3칸 분할 버튼이다");
assert.match(styles, /\.settingsCard\s*\{[\s\S]*overflow-x:\s*hidden;[\s\S]*overflow-y:\s*auto;/, "설정 카드는 가로 넘침을 숨기고 세로만 스크롤한다");
assert.match(styles, /\.mapScaleChip\[data-open="true"\]\s*\{[^}]*color:\s*#102e60;[^}]*border-color:\s*#2f6fdb;/, "축척 칩 열린 상태는 파란 테두리와 대비되는 글자를 쓴다");
assert.match(mobileRules, /\.reportStage\[data-settings-open="true"\]\s+\.stageFit\s*\{[\s\S]*justify-content:\s*flex-start;/, "390 설정 시트가 열리면 슬라이드를 시트 위쪽에 둔다");
assert.match(mobileRules, /\.settingsCard\s*\{[\s\S]*max-height:\s*min\(60dvh,\s*calc\(100dvh - 16px\)\);[\s\S]*overflow-y:\s*auto;/, "390 설정 시트는 최대 60dvh이고 안쪽만 스크롤한다");
assert.match(mobileRules, /\.settingsCard\s*\{[\s\S]*height:\s*min\(42dvh,\s*calc\(100dvh - 16px\)\);/, "390 설정 시트의 초기 높이는 슬라이드를 가리지 않는 범위다");
assert.match(mobileRules, /\.pageDock\s*\{[\s\S]*grid-template-rows:\s*auto auto;[\s\S]*min-height:\s*0;[\s\S]*height:\s*auto;/, "390 페이지 줄은 지도 막대와 썸네일을 자동 행으로 쌓는다");
assert.match(styles, /@media\s*\(min-width:\s*640px\)\s*and\s*\(max-width:\s*1024px\)[\s\S]*\.headerFormat select\s*\{[^}]*width:\s*120px;[^}]*max-width:\s*120px;/, "1024px 판형 select는 선택된 이름을 보여 줄 폭을 확보한다");
assert.match(boardStyles, /\.demoTag\s*\{[\s\S]*font-size:\s*12px;/, "데모 데이터 표시는 편집기 12px 단계다");
assert.match(styles, /\.compareGridChoices\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(84px,\s*1fr\)\);/, "비교 칸 구성 칩은 한 줄 우선으로 놓고 좁으면 줄바꿈한다");
assert.match(styles, /\.compareGridChoices\s+\.sectionLabel\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/, "비교 칸 구성 제목은 칩 그리드의 전체 열을 쓴다");

const { initialReportRail, isTypingTarget } = await import("../../lib/v2/ui/report-mode-logic.ts");
assert.equal(initialReportRail(true), null, "페이지가 있는 보고서의 초기 rail은 닫혀 있다");
assert.equal(initialReportRail(false), "pages", "페이지가 없는 보고서는 페이지 서랍으로 시작한다");
assert.equal(isTypingTarget({ tagName: "TEXTAREA" }), true, "메모 textarea는 페이지 키보드 탐색 대상이 아니다");
assert.equal(isTypingTarget({ tagName: "BUTTON" }), false, "버튼은 페이지 키보드 탐색 대상이다");
assert.match(styles, /\.settingsCard \{ position: fixed;[^}]*padding: max\(8px, env\(safe-area-inset-top\)\) 12px/, "390 설정 시트는 서랍 시트와 같은 좌우 여백을 둔다");

const css = styles;
const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
assert.deepEqual([...new Set(sizes)].filter((s) => ![10, 11, 12, 13, 14, 16, 20].includes(s)), [], "편집기 글자 단계");
assert.doesNotMatch(css, /font-weight:\s*(800|900)/, "굵기 400/500/700");
assert.match(css, /\.reportRoot\s*\{[^}]*word-break:\s*keep-all/s);
for (const [file, text] of [
  ["drawer-pages.tsx", "한 타일을 크게 배치합니다"], ["drawer-pages.tsx", "보고서 구성"],
  ["drawer-tiles.tsx", "비교할 타일을 2개 이상"], ["notes-field.tsx", "PPT 발표자 메모에 저장됩니다"],
  ["layout-switcher.tsx", "배치만 바꿉니다"],
]) assert.doesNotMatch(readFileSync(new URL(`../../components/v2/report/${file}`, import.meta.url), "utf8"), new RegExp(text), `${file}: ${text}`);
assert.match(boardStyles, /@media \(min-width: 640px\) and \(max-width: 1359px\) \{\s*\.page\.reportPage > \.topbar > \.topoHeaderButton \{[^}]*font-size: 0;/, "1360 px 미만 보고서 머리 줄의 수치지형도 버튼은 아이콘만");
assert.match(styles, /color: transparent;\s*font-size: 0;\s*\}\s*\.reportHeaderActions \.secondaryButton::after \{ content: "발표"/, "줄인 발표 버튼은 숨긴 원래 글자 폭을 차지하지 않는다");
const tilesSource = readFileSync(new URL("../../components/v2/report/drawer-tiles.tsx", import.meta.url), "utf8");
assert.doesNotMatch(tilesSource, /\? styles\.filterChipActive : styles\.filterChip/, "선택된 칸 구성 칩도 기본 칩 모양을 유지한다");
assert.match(tilesSource, /className=\{styles\.tileCardButton\}[\s\S]*tileCompareToggle[\s\S]*<input/, "비교 모드 카드는 썸네일·체크박스를 함께 제공한다");
assert.match(styles, /\.scaleInput \{ display: flex; align-items: center; flex: 1; gap: 0;/, "축척 입력도 1:13,120처럼 접두와 숫자를 붙여 보인다");

console.log("v2 report chrome style tests passed");
