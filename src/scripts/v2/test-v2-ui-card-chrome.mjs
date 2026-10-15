/** v2 카드 ⋯ 메뉴 포털 위치·지도 컨트롤 크롬 계약. 브라우저 로그인 게이트 없이 순수 계산과 정적 렌더 구조를 검증한다. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const menuPositionSource = readFileSync(new URL("../../lib/v2/ui/menu-position.ts", import.meta.url), "utf8");
const tileCardSource = readFileSync(new URL("../../components/v2/tile-card.tsx", import.meta.url), "utf8");
const mapControlsSource = readFileSync(new URL("../../components/v2/map-controls.tsx", import.meta.url), "utf8");
const mapBoxSource = readFileSync(new URL("../../components/v2/map-box.tsx", import.meta.url), "utf8");
const calloutSource = readFileSync(new URL("../../components/v2/callout-map.tsx", import.meta.url), "utf8");
const detailSource = readFileSync(new URL("../../components/v2/detail-window.tsx", import.meta.url), "utf8");
const boardCss = readFileSync(new URL("../../components/v2/board.module.css", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../../app/v2/page.tsx", import.meta.url), "utf8");

assert.match(tileCardSource, /createPortal\(/, "⋯ 메뉴는 React portal로 렌더");
assert.match(tileCardSource, /document\.body/, "⋯ 메뉴 portal 대상은 body");
assert.match(tileCardSource, /floatingMenuPosition\(/, "⋯ 메뉴는 순수 viewport 위치 계산을 사용");
assert.match(tileCardSource, /document\.addEventListener\("scroll", update, true\)/, "⋯ 메뉴는 스크롤 뒤 위치를 갱신");
assert.match(tileCardSource, /window\.addEventListener\("resize", update\)/, "⋯ 메뉴는 리사이즈 뒤 위치를 갱신");
assert.match(calloutSource, /scaleLeft=\{kind === "card"\}/, "A05/A06 카드 축척은 우측 하단 줌 버튼과 겹치지 않게 왼쪽 아래");
for (const label of ["라벨 보기", "보고서에 포함", "펼치기", "복제", "상세 보기"]) {
  assert.match(tileCardSource, new RegExp(label), `⋯ 메뉴 항목 유지: ${label}`);
}
assert.match(tileCardSource, /function DragHandle/, "카드 재정렬 핸들은 공용 컴포넌트");
assert.equal((tileCardSource.match(/<DragHandle p=\{renderProps\} \/>/g) ?? []).length, 1, "요약·지도면은 카드 공용 핸들 하나를 사용");
assert.match(tileCardSource, /<div className=\{styles\.mfMenuHead\}>배치<\/div>/, "⋯ 메뉴의 현재 섹션 제목은 배치");
assert.match(boardCss, /\.handle\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*0;[\s\S]*?left:\s*0;[\s\S]*?width:\s*44px;/, "재정렬 핸들은 헤더 flex 공간 밖의 44px 절대 hit area");
assert.match(boardCss, /\.sfTop\s*\{[\s\S]*?flex-wrap:\s*nowrap;/, "요약 헤더는 한 줄");
assert.match(boardCss, /\.sfTop \.title\s*\{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/, "요약 제목은 좁을 때 말줄임");
assert.match(boardCss, /\.mfTitle\s*\{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/, "지도 제목은 좁을 때 말줄임");
assert.match(pageSource, /className=\{styles\.railSegments\}[\s\S]*?GRID_COLUMN_OPTIONS\.map\([\s\S]*?aria-pressed=\{columns === option\}/, "보드 열 선택은 기존 aria-pressed 계약을 유지");
assert.match(boardCss, /\.railSegments\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\);[\s\S]*?gap:\s*0;/, "보드 열 선택은 5분할 가로 세그먼트");
assert.match(boardCss, /\.railSegments button,[\s\S]*?min-height:\s*44px;/, "보드 열 세그먼트 버튼은 44px 높이");

const { floatingMenuPosition } = await import("../../lib/v2/ui/menu-position.ts");
assert.deepEqual(
  floatingMenuPosition(
    { top: 80, left: 600, right: 644, bottom: 124 },
    { width: 216, height: 180 },
    { width: 900, height: 700 },
  ),
  { top: 130, left: 428 },
  "일반 위치는 trigger 아래·우측 정렬",
);
assert.deepEqual(
  floatingMenuPosition(
    { top: 520, left: 700, right: 744, bottom: 564 },
    { width: 216, height: 180 },
    { width: 800, height: 600 },
  ),
  { top: 334, left: 528 },
  "하단 trigger는 위로 뒤집고 viewport 안으로 유지",
);
assert.deepEqual(
  floatingMenuPosition(
    { top: 10, left: 0, right: 44, bottom: 54 },
    { width: 216, height: 180 },
    { width: 220, height: 200 },
  ),
  { top: 12, left: 8 },
  "좁은 viewport에서도 가장자리 여백을 지킴",
);

const menuCss = boardCss.match(/\.mfMenu\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
assert.match(menuCss, /position:\s*fixed/, "⋯ 메뉴는 카드 쌓임 맥락 밖의 fixed popover");
assert.match(menuCss, /z-index:\s*1000/, "⋯ 메뉴는 최상위 popover z-index 사용");
assert.match(menuCss, /max-height:\s*calc\(100vh - 16px\)/, "좁은 화면에서는 메뉴 내부를 스크롤");
assert.match(menuCss, /overflow-y:\s*auto/, "좁은 화면에서도 메뉴 항목을 접근 가능하게 유지");
assert.match(boardCss, /\.mfMenu \.mfMenuCompact\s*\{\s*display:\s*flex;/, "포털 메뉴의 복제·보조 항목은 항상 표시");

const mapControlsCss = boardCss.match(/\.mapControls\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
const mapButtonCss = boardCss.match(/\.mapControlButton\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
const mapVisualCss = boardCss.match(/\.mapControlButton::before\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
assert.match(mapControlsCss, /right:\s*4px/);
assert.match(mapControlsCss, /bottom:\s*4px/);
assert.match(mapButtonCss, /width:\s*44px/);
assert.match(mapButtonCss, /height:\s*44px/);
assert.match(mapVisualCss, /width:\s*24px/);
assert.match(mapVisualCss, /height:\s*24px/);
assert.match(mapControlsSource, /aria-label="지도 확대"/);
assert.match(mapControlsSource, /aria-label="지도 축소"/);
assert.match(mapControlsSource, /aria-label="지도 시점 초기화"/);
assert.match(mapBoxSource, /styles\.mapControlsCard/);
assert.match(mapBoxSource, /styles\.mapControlsExpanded/);
assert.match(mapBoxSource, /data-map-empty/);
assert.match(boardCss, /\.mapEmptyState\s*\{[\s\S]*?pointer-events:\s*none;/, "빈 지도 안내는 지도 조작을 가리지 않음");
assert.match(boardCss, /\.dialog \.mapControlsExpanded\s*\{[\s\S]*?top:\s*auto;[\s\S]*?right:\s*max\(8px, env\(safe-area-inset-right\)\);[\s\S]*?bottom:\s*calc\(40% \+ 92px\);/, "모바일 상세 컨트롤은 정보 판과 범례 띠 위쪽에 배치");
assert.match(boardCss, /\.dialog\.dialogPanelOpen \.mapControlsExpanded\s*\{[\s\S]*?top:\s*58px;[\s\S]*?bottom:\s*auto;/, "모바일 고정 라벨 판을 열 때 컨트롤 배치를 유지");
assert.match(calloutSource, /className=\{styles\.calloutMapControls\}/);
assert.match(detailSource, /className="detail-map-controls"/);

console.log("v2 card chrome contracts ok");
