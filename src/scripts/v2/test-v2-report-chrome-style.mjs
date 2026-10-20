import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../components/v2/report/report-mode.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../components/v2/report/report-mode.module.css", import.meta.url), "utf8");
const notes = readFileSync(new URL("../../components/v2/report/notes-field.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../../components/v2/report/layout-switcher.tsx", import.meta.url), "utf8");

const reportBodyRule = styles.match(/\.reportBody\s*\{[^}]*\}/)?.[0] ?? "";
const mobileRules = styles.match(/@media\s*\(max-width:\s*639px\)\s*\{([\s\S]*)/)?.[1] ?? "";
const reducedMotionRules = styles.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

assert.doesNotMatch(reportBodyRule, /grid-template-columns/, "reportBody는 3열 grid를 예약하지 않는다");
assert.match(styles, /\.stageFit\s*\{[\s\S]*container-type:\s*size;/, "stageFit은 크기 컨테이너다");
assert.match(styles, /\.floatCard\s*\{[\s\S]*border-radius:\s*12px;/, "떠 있는 카드는 공통 12px 모서리를 쓴다");
assert.match(mobileRules, /\.drawerCard[^{]*\{[\s\S]*bottom:\s*0;/, "모바일 drawerCard는 아래 시트다");
assert.match(mobileRules, /\.settingsCard[^{]*\{[\s\S]*bottom:\s*0;/, "모바일 settingsCard는 아래 시트 자리다");
assert.match(reducedMotionRules, /\.floatCard[^{]*\{[\s\S]*transform:\s*none;/, "감소된 동작에서는 카드 transform을 끈다");
assert.match(styles, /180ms\s+cubic-bezier\(\.23,1,\.32,1\)/, "카드 나타남 속도와 easing");
assert.match(styles, /\.reportStage\s*\{[\s\S]*--stage-left:\s*88px[\s\S]*--stage-right:\s*24px[\s\S]*--stage-bottom:\s*100px;/, "무대 기본 여백 변수");
assert.match(styles, /\.reportStage\[data-drawer-open="true"\]\s*\{[^}]*--stage-left:\s*418px;/, "서랍 열림 무대 여백");
assert.match(styles, /\.reportStage\[data-settings-open="true"\]\s*\{[^}]*--stage-right:\s*328px;/, "설정 열림 무대 여백");
assert.match(styles, /\.stageFit\s*\{[\s\S]*inset:\s*16px\s+var\(--stage-right\)\s+var\(--stage-bottom\)\s+var\(--stage-left\);/, "stageFit은 카드 여백 안쪽에 맞춘다");

for (const className of ["toolPill", "drawerCard", "pageDock", "dockLead"]) {
  assert.match(source, new RegExp(`styles\\.${className}\\b`), `${className} JSX 계약`);
}
assert.doesNotMatch(source, /styles\.(reportRail|drawerColumn|editorSide|reportWorkspace)\b/, "옛 3열 레이아웃 클래스가 JSX에 남지 않는다");
assert.match(source, /data-drawer-open=/, "무대에 서랍 열림 상태가 있다");
assert.match(source, /data-settings-open=["']false["']/, "이번 Task의 설정 카드 상태는 false다");
assert.match(source, /aria-expanded=\{rail === "pages" && drawerOpen\}/, "도구 막대 버튼은 서랍 펼침 상태를 알린다");
assert.match(source, /aria-haspopup=["']menu["']/, "레이아웃 메뉴 트리거가 menu임을 알린다");
assert.match(source, /data-has-notes/, "메모가 있는 페이지의 점 표시 계약");
assert.match(source, /<LayoutSwitcher[\s\S]*compact/, "페이지 줄 레이아웃 메뉴는 compact다");
assert.match(source, /<NotesField[\s\S]*compact/, "페이지 줄 메모 popover는 compact다");
assert.match(notes, /compact\?:\s*boolean/, "NotesField compact prop");
assert.match(layout, /compact\?:\s*boolean/, "LayoutSwitcher compact prop");

const { isTypingTarget } = await import("../../lib/v2/ui/report-mode-logic.ts");
assert.equal(isTypingTarget({ tagName: "TEXTAREA" }), true, "메모 textarea는 페이지 키보드 탐색 대상이 아니다");
assert.equal(isTypingTarget({ tagName: "BUTTON" }), false, "버튼은 페이지 키보드 탐색 대상이다");

console.log("v2 report chrome style tests passed");
