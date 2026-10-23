import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const reportMode = readFileSync(new URL("../../components/v2/report/report-mode.tsx", import.meta.url), "utf8");
const surface = readFileSync(new URL("../../components/v2/report/slide-surface.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../components/v2/report/report-mode.module.css", import.meta.url), "utf8");
const surfaceStyles = readFileSync(new URL("../../components/v2/report/slide-surface.module.css", import.meta.url), "utf8");

const desktopStyles = styles.slice(styles.indexOf("@media (min-width: 1024px)"));
const fontPopover = reportMode.slice(reportMode.indexOf("const FONT_SIZE_LABELS"), reportMode.indexOf("function pageTitleForToast"));
const contextMenu = reportMode.slice(reportMode.indexOf("function FontScopeSwitch"), reportMode.indexOf("function pageTitleForToast"));

assert.match(reportMode, /글자 크기/, "도구 막대 이름과 팝오버 제목은 글자 크기다");
assert.doesNotMatch(reportMode, /ThemePopover|report-theme-popover|>테마</, "옛 테마 팝오버·라벨이 제거된다");
assert.match(fontPopover, /모든 페이지[\s\S]*이 페이지만|모든 페이지[\s\S]*쪽만/, "F1은 모든 페이지·현재 페이지 2칸 범위다");
assert.match(fontPopover, /제목[\s\S]*요약[\s\S]*범례[\s\S]*지도 라벨[\s\S]*출처/, "F1은 5개 요소를 표시한다");
assert.match(fontPopover, /1pt|step.*1|\+ 1|minus/, "F1 증감은 1pt 단위다");
assert.match(fontPopover, /pt/, "F1 값은 화면에서 pt로 표시한다");
assert.match(fontPopover, /모든 페이지 값으로/, "F1은 현재 페이지 값을 문서 값으로 되돌릴 수 있다");
assert.match(contextMenu, /role=["']menu["']|role=\{["']menu["']\}/, "H1은 menu role을 쓴다");
assert.match(contextMenu, /모든 페이지[\s\S]*이 페이지만|모든 페이지[\s\S]*쪽만/, "H1 메뉴는 범위 2칸을 메뉴 안에 둔다");
assert.match(contextMenu, /모든 페이지 값으로 되돌리기/, "H1은 요소별 페이지 값을 되돌린다");
assert.match(contextMenu, /위치·크기 처음대로/, "H1은 패널 위치·크기 리셋을 제공한다");
assert.match(reportMode, /onFontContextMenu|onContextMenu/, "보고서 모드는 요소 우클릭 콜백을 연결한다");
assert.match(surface, /Shift\+F10|ContextMenu|contextmenu/i, "요소는 Shift+F10/ContextMenu를 지원한다");
assert.match(surface, /500|long|press/i, "요소는 길게 누르기 계약을 가진다");
assert.match(styles, /\.fontSizePopover\s*\{/, "F1 팝오버 스타일이 있다");
assert.match(styles, /\.fontContextMenu\s*\{/, "H1 우클릭 메뉴 스타일이 있다");
assert.match(desktopStyles, /\.fontSizePopover[^{]*\{[\s\S]*background:\s*#fff;/, "F1 카드는 흰 바탕이다");
assert.match(desktopStyles, /\.fontContextMenu[^{]*\{[\s\S]*background:\s*#fff;/, "H1 카드는 흰 바탕이다");
assert.doesNotMatch(fontPopover, /<select/, "F1 범위 선택은 드롭다운이 아니다");
assert.doesNotMatch(contextMenu, /<select/, "H1 범위 선택은 드롭다운이 아니다");
assert.match(surfaceStyles, /fontSizeHighlight|data-font-highlight/, "슬라이드 요소의 2px 점선 강조 스타일이 있다");

console.log("v2 report font-size UI contracts passed");
