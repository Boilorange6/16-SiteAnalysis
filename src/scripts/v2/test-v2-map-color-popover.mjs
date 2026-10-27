/**
 * 지도 색 팝오버(C안)와 색 만들기 카드: 서버 렌더 구조 검사 + 배선 검사.
 * 이벤트·포커스·미리보기 타이머는 브라우저 QA에서 본다.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { createElement } from "react";

// CSS 모듈은 클래스 이름을 그대로 돌려주는 가짜로 대신한다.
register("data:text/javascript," + encodeURIComponent("export async function load(url, ctx, next){ if(url.endsWith('.css')) return {format:'module', source:'export default new Proxy({}, {get:(_,k)=>String(k)})', shortCircuit:true}; return next(url, ctx);}"));
globalThis.React = React;

const { default: MapColorPopover, appPaletteColors, sameBaseRef, samePaletteRef } = await import("../../components/v2/map-colors/map-color-popover.tsx");
const { default: MapColorMaker } = await import("../../components/v2/map-colors/map-color-maker.tsx");
const { BASE_THEMES, BASE_THEME_IDS } = await import("../../lib/v2/ui/map-theme.ts");
const { PALETTE_IDS, paletteColors } = await import("../../lib/v2/ui/map-palette.ts");
const { LAYER_STYLES } = await import("../../lib/v2/ui/map-layers.ts");

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const noop = () => {};
const baseValue = { base: "warm", palette: "app", hide: [] };
const mine = {
  base: [{ id: 7, name: "내 테마 1", colors: { bg: "#f6f4ef", building: "#e4ddd0", parcel: "#d6cebf", road: "#ffffff", green: "#dfe8d2", water: "#cfe1ea", site: "#f2b6b8" } }],
  palette: [],
};

const pop = (extra = {}) => renderToStaticMarkup(createElement(MapColorPopover, { value: baseValue, onPreview: noop, onApply: noop, onClose: noop, makerSide: "left", initialMine: mine, ...extra }));
const tags = (html, re) => html.match(re) ?? [];
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const rowButtons = (html) => tags(html, /<button[^>]*data-row="[^"]*"[^>]*>/g);
const stripCells = (html, nth = 0) => {
  const strips = tags(html, /<span[^>]*data-strip[^>]*>(?:<i[^>]*><\/i>)+<\/span>/g);
  return (strips[nth].match(/<i/g) ?? []).length;
};

// ── 바탕 탭 ──
{
  const html = pop();
  assert.equal(tags(html, /<button[^>]*data-tab="[^"]*"[^>]*>/g).length, 2, "탭은 바탕·다이어그램 2개");
  assert.match(text(html), /바탕\s+다이어그램/, "탭 문구");
  const rows = rowButtons(html);
  assert.equal(rows.filter((r) => r.includes('data-row="preset"')).length, BASE_THEME_IDS.length, "바탕 프리셋 8줄");
  assert.equal(BASE_THEME_IDS.length, 8);
  assert.equal(rows.filter((r) => r.includes('data-row="mine"')).length, 1, "내 테마 1줄");
  assert.equal(rows.filter((r) => r.includes('aria-pressed="true"')).length, 1, "현재 값 줄은 하나");
  assert.ok(rows.find((r) => r.includes('aria-pressed="true"')).includes('data-name="따뜻한 베이지"'), "현재 값은 warm 줄");
  assert.ok(html.indexOf('data-row="mine"') < html.indexOf('data-row="preset"'), "내 테마가 프리셋보다 먼저");
  assert.equal(stripCells(html, 0), 6, "바탕 색 띠는 6칸(내 테마 줄)");
  assert.equal(stripCells(html, 1), 6, "바탕 색 띠는 6칸(프리셋 줄)");
  assert.ok(!html.includes("보고서 전체"), "보드에는 적용 범위 없음");
  assert.ok(!html.includes("이 쪽만"), "보드에는 적용 범위 없음");
  assert.match(html, /색 만들기…/, "색 만들기 버튼");
  assert.match(html, /aria-expanded="false"/, "색 만들기는 펼침 상태를 알린다");
  // 화면 글자·접근성 이름·툴팁에 영문 식별자가 없다.
  const visible = text(html) + " " + tags(html, /(?:aria-label|title|data-name)="[^"]*"/g).join(" ");
  assert.doesNotMatch(visible, /\b(warm|cool|paper|sage|sand|blue|mono|ink|app|soft|vivid|earth|pastel|safe|sea|gray)\b/, "영문 id가 보이지 않는다");
  // 첫 줄은 각 프리셋 색 띠와 같은 색이다.
  const warm = BASE_THEMES.warm;
  assert.match(html, new RegExp(`background:${warm.road.fill}`), "도로 칸 색");
}

// ── 내 테마를 불러오는 중 ──
{
  const html = renderToStaticMarkup(createElement(MapColorPopover, { value: baseValue, onPreview: noop, onApply: noop, onClose: noop, makerSide: "left" }));
  assert.equal(tags(html, /data-loading="mine"/g).length, 1, "불러오는 동안 회색 줄 1개");
  assert.equal(rowButtons(html).filter((r) => r.includes('data-row="mine"')).length, 0);
}

// ── 다이어그램 탭 ──
{
  const html = pop({ initialTab: "palette", value: { ...baseValue, palette: "vivid" } });
  const rows = rowButtons(html);
  assert.equal(rows.filter((r) => r.includes('data-row="preset"')).length, PALETTE_IDS.length, "팔레트 프리셋 8줄");
  assert.equal(rows.filter((r) => r.includes('data-row="mine"')).length, 0, "저장한 팔레트 없음");
  assert.equal(stripCells(html, 0), 5, "다이어그램 색 띠는 5칸");
  assert.ok(rows.find((r) => r.includes('aria-pressed="true"')).includes('data-name="선명"'), "현재 값 줄");
  assert.match(html, /타일 카드의 주제 색에 적용됩니다/, "보드에서는 적용 위치를 밝힌다");
  // 「지금 앱 색」 띠는 앱의 용도 색 앞 5칸이다.
  const app = appPaletteColors();
  assert.equal(app.cat.length, 8);
  assert.equal(app.seq.length, 5);
  const use = Object.entries(LAYER_STYLES).filter(([k]) => k.startsWith("use:")).slice(0, 5).map(([, s]) => s.color.toLowerCase());
  assert.deepEqual(app.cat.slice(0, 5).map((c) => c.toLowerCase()), use);
  const appRow = pop({ initialTab: "palette" });
  for (const c of use) assert.ok(appRow.toLowerCase().includes(`background:${c}`), `지금 앱 색 띠에 ${c}`);
  assert.deepEqual(paletteColors("vivid").cat.slice(0, 5).length, 5);
}

// ── 보고서: 적용 범위 ──
{
  const scope = (over = {}) => ({ value: "document", pageAvailable: true, pageOverridden: false, onChange: noop, onClearPage: noop, ...over });
  const html = pop({ scope: scope() });
  assert.match(html, /보고서 전체/);
  assert.match(html, /이 쪽만/);
  assert.ok(!html.includes('aria-disabled="true"'), "지도가 있는 쪽은 이 쪽만을 쓸 수 있다");
  assert.ok(!html.includes("보고서 전체 색으로"), "덮어쓰기 없으면 되돌림 버튼 없음");
  assert.ok(!html.includes("타일 카드의 주제 색"), "보고서에는 보드 안내 없음");

  const off = pop({ scope: scope({ pageAvailable: false }) });
  const pageBtn = tags(off, /<button[^>]*data-scope="page"[^>]*>/g)[0];
  assert.ok(pageBtn.includes('aria-disabled="true"'), "지도 없는 쪽은 aria-disabled");
  assert.ok(pageBtn.includes('title="이 쪽에는 지도가 없습니다"'), "지도 없는 쪽 안내");

  const over = pop({ scope: scope({ value: "page", pageOverridden: true }) });
  assert.match(over, /보고서 전체 색으로/, "덮어쓴 쪽에는 전체 색으로 되돌리는 버튼");
  assert.ok(tags(over, /<button[^>]*data-scope="page"[^>]*>/g)[0].includes('aria-pressed="true"'));
}

// ── 비교 함수 ──
{
  assert.ok(sameBaseRef("warm", "warm"));
  assert.ok(!sameBaseRef("warm", "cool"));
  assert.ok(sameBaseRef({ name: "a", colors: mine.base[0].colors }, { name: "b", colors: { ...mine.base[0].colors } }), "만든 색은 색 값으로 비교");
  assert.ok(!sameBaseRef("warm", { name: "a", colors: mine.base[0].colors }));
  assert.ok(samePaletteRef("app", "app"));
  const v = paletteColors("soft");
  assert.ok(samePaletteRef({ name: "x", colors: { cat: [...v.cat], seq: [...v.seq] } }, { name: "y", colors: { cat: [...v.cat], seq: [...v.seq] } }));
}

// ── 만들기 카드: 바탕 ──
{
  const maker = (over = {}) => renderToStaticMarkup(createElement(MapColorMaker, { kind: "base", value: baseValue, side: "left", onApply: noop, onSaved: noop, onClose: noop, ...over }));
  const html = maker();
  assert.match(html, /바탕 색 만들기/);
  assert.equal(tags(html, /<button[^>]*data-mood="[^"]*"[^>]*>/g).length, 8, "분위기 칩 8개");
  assert.equal(tags(html, /data-color-row="[^"]*"/g).length, 7, "바탕 색 줄 7개");
  const eyes = tags(html, /<button[^>]*data-eye="[^"]*"[^>]*>/g);
  assert.equal(eyes.length, 5, "눈 토글 5개");
  assert.deepEqual(eyes.map((e) => e.match(/data-eye="([^"]*)"/)[1]), ["building", "parcel", "road", "green", "water"], "건물·필지선·도로·녹지·물");
  assert.ok(eyes.every((e) => e.includes('aria-pressed="false"') && /aria-label="[^"]+ 숨기기"/.test(e)), "켜진 층은 숨기기 라벨");
  assert.ok(!/aria-label="(바탕|대지) (숨기기|보이기)"/.test(html), "바탕색·대지 줄에는 눈이 없다");
  const road = maker({ value: { ...baseValue, hide: ["road"] } });
  const roadEye = tags(road, /<button[^>]*data-eye="road"[^>]*>/g)[0];
  assert.ok(roadEye.includes('aria-pressed="true"') && roadEye.includes('aria-label="도로 보이기"'), "숨긴 도로는 pressed + 도로 보이기");
  assert.ok(tags(road, /<button[^>]*data-eye="building"[^>]*>/g)[0].includes('aria-label="건물 숨기기"'));
  // 줄마다 고정·섞기·어둡게·밝게·직접 고르기
  assert.equal(tags(html, /<input[^>]*type="color"[^>]*>/g).length, 7, "직접 고르기 색 입력 7개");
  assert.equal(tags(html, /<button[^>]*aria-label="도로 (고정|섞기|어둡게|밝게|직접 고르기)"/g).length, 5);
  // 아이콘 버튼은 모두 접근성 이름이 있다.
  const buttons = tags(html, /<button[^>]*>[\s\S]*?<\/button>/g);
  for (const b of buttons) assert.ok(/aria-label="[^"]+"/.test(b) || text(b).trim().length > 0, `이름 없는 버튼: ${b.slice(0, 80)}`);
  assert.match(html, /만들기/);
  assert.match(html, /aria-label="되돌리기"[^>]*disabled/, "처음엔 되돌리기 비활성");
  assert.match(html, /aria-label="다시"[^>]*disabled/, "처음엔 다시 비활성");
  assert.match(html, /내 테마로 저장/);
  assert.match(html, /(?:✓|!)\s*라벨 글자 대비/, "경고 줄");
  assert.match(html, /role="dialog"/);
  assert.doesNotMatch(text(html), /\b(bg|building|parcel|road|green|water|site)\b/, "영문 키가 보이지 않는다");
}

// ── 만들기 카드: 다이어그램 ──
{
  const html = renderToStaticMarkup(createElement(MapColorMaker, { kind: "palette", value: { ...baseValue, palette: "soft" }, side: "right", onApply: noop, onSaved: noop, onClose: noop }));
  assert.match(html, /다이어그램 색 만들기/);
  assert.equal(tags(html, /data-color-row="[^"]*"/g).length, 9, "범주 8줄 + 순서형 1줄");
  assert.equal(tags(html, /<button[^>]*data-eye=/g).length, 0, "다이어그램 카드에는 눈이 없다");
  assert.match(html, /순서형/);
  assert.match(html, /(?:✓|!)\s*(?:색 구분 충분|비슷한 색|녹색약)/, "팔레트 경고 줄");
}

// ── 배선 ──
{
  const page = read("../../app/v2/page.tsx");
  assert.match(page, /기본 지도 ▾/, "눌린 기본 지도 바탕 칩에 ▾");
  assert.match(page, /aria-haspopup=\{mapColorTrigger \? "dialog" : undefined\}/, "눌린 기본 지도 칩은 팝오버를 연다고 알린다");
  assert.match(page, /aria-expanded=\{mapColorTrigger \? mapColorOpen : undefined\}/);
  assert.match(page, /previewColors/, "보드 미리보기 상태");
  assert.match(page, /type: "baseTheme"/);
  assert.match(page, /type: "palette"/);
  assert.match(page, /type: "baseHide"/);
  const report = read("../../components/v2/report/report-mode.tsx");
  assert.match(report, /aria-label="지도 색"/);
  assert.match(report, /type: "mapColors"/);
  assert.match(report, /MapColorPopover/);
  const notes = report.indexOf('aria-label={selectedPage?.notes.trim() ? "발표 메모 있음" : "발표 메모"}');
  const color = report.indexOf('aria-label="지도 색"');
  assert.ok(notes > 0 && color > notes, "지도 색 버튼은 발표 메모 다음");
  const css = read("../../components/v2/map-colors/map-colors.module.css");
  assert.match(css, /width:\s*288px/, "팝오버·카드 폭 288");
  assert.match(css, /height:\s*34px/, "행 높이 34");
  assert.match(css, /width:\s*13px/, "색 칸 13");
  assert.match(css, /overscroll-behavior:\s*contain/);
  const docs = read("../../../docs/design/v2-design-language.md");
  assert.match(docs, /## 9-11\. 지도 색/);
}

console.log("map color popover tests passed");
