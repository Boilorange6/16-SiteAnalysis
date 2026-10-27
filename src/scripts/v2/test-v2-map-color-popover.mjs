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

const { default: MapColorPopover, appPaletteColors, sameBaseRef, samePaletteRef, mergeMine, boardPosition, canJoinMapColorEdit } = await import("../../components/v2/map-colors/map-color-popover.tsx");
const { reportDocReducer } = await import("../../lib/v2/report/report-doc.ts");
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
  assert.doesNotMatch(html, /role="list"|role="listitem"/, "목록 역할은 목록 항목만 담을 때 쓴다(머리글·구분선이 섞여 있어 쓰지 않음)");
  assert.match(html, /role="group"[^>]*aria-label="바탕 테마"/, "행 묶음에 이름");
  const popSrc = read("../../components/v2/map-colors/map-color-popover.tsx");
  assert.doesNotMatch(popSrc, /error\.message/, "서버·네트워크 영문 오류 문구를 그대로 보이지 않는다");
  assert.match(popSrc, /close\(false\);\s*\n\s*\};\s*\n\s*document\.addEventListener\("pointerdown"/, "바깥 클릭으로 닫을 때는 포커스를 뺏지 않는다");
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

  assert.ok(!html.includes("보드 색 따르기"), "보고서 전체 색이 없으면 보드 색 따르기 버튼 없음");
  const docOver = pop({ scope: scope({ documentOverridden: true }) });
  const followBoard = tags(docOver, /<button[^>]*>보드 색 따르기<\/button>/g);
  assert.equal(followBoard.length, 1, "보고서 전체에 색이 있으면 보드 색 따르기 버튼");
  assert.ok(followBoard[0].includes('class="secondary"'), "보고서 전체 색으로 버튼과 같은 보조 단추 모양");
  assert.ok(!pop({ scope: scope({ value: "page", documentOverridden: true }) }).includes("보드 색 따르기"), "이 쪽만 범위에서는 숨김");
  const reportSrc = read("../../components/v2/report/report-mode.tsx");
  assert.match(reportSrc, /apply\(\{ type: "mapColors", scope: "document", patch: null \}\)/, "보드 색 따르기는 되돌릴 수 있는 문서 동작");
  assert.match(reportSrc, /documentOverridden: !!history\.present\.mapColors/);
  const clearedDoc = reportDocReducer(reportDocReducer({ v: 1, format: "wide", pages: [] }, { type: "mapColors", scope: "document", patch: { base: "cool" } }), { type: "mapColors", scope: "document", patch: null });
  assert.equal(clearedDoc.mapColors, undefined, "patch null은 보고서 전체 색을 지운다");

  // 표지에도 「이 쪽만」(지도가 있는 표지)
  assert.match(reportSrc, /selectedSlide\?\.kind === "tile" \|\| selectedSlide\?\.kind === "cover"\s*\?\s*!!selectedSlide\.map/, "표지 지도도 이 쪽만을 쓸 수 있다");

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
  const maker = (over = {}) => renderToStaticMarkup(createElement(MapColorMaker, { kind: "base", value: baseValue, onApply: noop, onSaved: noop, onClose: noop, ...over }));
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
  const html = renderToStaticMarkup(createElement(MapColorMaker, { kind: "palette", value: { ...baseValue, palette: "soft" }, onApply: noop, onSaved: noop, onClose: noop }));
  assert.match(html, /다이어그램 색 만들기/);
  assert.equal(tags(html, /data-color-row="[^"]*"/g).length, 9, "범주 8줄 + 순서형 1줄");
  assert.equal(tags(html, /<button[^>]*data-eye=/g).length, 0, "다이어그램 카드에는 눈이 없다");
  assert.match(html, /순서형/);
  assert.match(html, /(?:✓|!)\s*(?:색 구분 충분|비슷한 색|녹색약)/, "팔레트 경고 줄");
}

// ── 만들기 카드 줄 글자 대비: 모든 프리셋 범주색에서 4.5:1 이상 ──
{
  const { rowInk } = await import("../../components/v2/map-colors/map-color-maker.tsx");
  const { contrast } = await import("../../lib/v2/ui/map-color.ts");
  const makerSrc = read("../../components/v2/map-colors/map-color-maker.tsx");
  assert.match(makerSrc, /badgeTextColor\(hex\)/, "만들기 카드 줄 글자색은 badgeTextColor에서 시작한다");
  assert.equal((makerSrc.match(/color: [^}]*rowInk\(hex\)/g) ?? []).length, 2, "두 줄 모두 rowInk를 쓴다");
  assert.doesNotMatch(makerSrc, /inkOn/, "옛 명도 문턱 함수는 쓰지 않는다");
  const cats = [...PALETTE_IDS.flatMap((id) => (paletteColors(id) ?? appPaletteColors()).cat), ...appPaletteColors().cat];
  assert.ok(cats.length >= 48);
  for (const c of cats) assert.ok(contrast(rowInk(c), c) >= 4.5, `${c} 위 글자 대비 ${contrast(rowInk(c), c).toFixed(2)}`);
  const css = read("../../components/v2/map-colors/map-colors.module.css");
  assert.doesNotMatch(css.slice(css.indexOf(".crow button {"), css.indexOf(".crow button:hover")), /opacity/, "줄 아이콘 단추는 흐리게 하지 않는다");
}

// ── 내 테마 목록 합치기(늦게 온 불러오기가 방금 저장을 덮지 않는다) ──
{
  const colors = mine.base[0].colors;
  const loaded = { base: [{ id: 3, name: "내 테마 1", colors }, { id: 2, name: "내 테마 0", colors }], palette: [] };
  assert.deepEqual(mergeMine(null, loaded), loaded, "저장 전이면 불러온 목록 그대로");
  const saved = { id: 9, name: "내 테마 2", colors };
  const merged = mergeMine({ base: [saved], palette: [] }, loaded);
  assert.deepEqual(merged.base.map((s) => s.id), [9, 3, 2], "그 사이 저장한 테마가 남고 id 내림차순");
  const dup = mergeMine({ base: [saved], palette: [] }, { base: [saved, ...loaded.base], palette: [] });
  assert.deepEqual(dup.base.map((s) => s.id), [9, 3, 2], "같은 id는 한 번만");
}

// ── 되돌리기 묶음 규칙 ──
{
  const stamp = { group: "pick:road", scope: "document", id: "p1", at: 1000 };
  const next = { group: "pick:road", scope: "document", id: "p1" };
  assert.ok(canJoinMapColorEdit(stamp, next, 1300, true), "같은 줄의 끌기는 합친다");
  assert.ok(!canJoinMapColorEdit(stamp, next, 1700, true), "0.6초가 지나면 새 단계");
  assert.ok(!canJoinMapColorEdit(stamp, { ...next, group: "pick:bg" }, 1300, true), "다른 줄은 따로");
  assert.ok(!canJoinMapColorEdit(stamp, { ...next, group: undefined }, 1300, true), "묶음 이름 없는 적용(프리셋·눈·카드 되돌리기)은 따로");
  assert.ok(!canJoinMapColorEdit(stamp, { ...next, scope: "page" }, 1300, true), "범위가 바뀌면 따로");
  assert.ok(!canJoinMapColorEdit(stamp, { ...next, id: "p2" }, 1300, true), "쪽이 바뀌면 따로");
  assert.ok(!canJoinMapColorEdit(null, next, 1300, true), "이전 표식 없음");
  assert.ok(!canJoinMapColorEdit(stamp, next, 1300, false), "되돌릴 기록이 없으면 합치지 않는다");
}

// ── 보드 창 자리: 접힌 머리 줄의 메뉴 단추 아래·위·가장자리 ──
{
  const btn = (left, top, w = 74, h = 44) => ({ left, right: left + w, top, bottom: top + h });
  const wide = boardPosition(btn(1098, 18), 440, 1440, 900);
  assert.equal(wide.above, false);
  assert.equal(wide.edge, 18 + 44 + 8, "단추 아래 8 px");
  assert.equal(wide.side, "left");
  assert.ok(Math.abs(wide.left + wide.tail + 6.5 - (1098 + 37)) < 0.01, "꼬리가 단추 가운데");
  // 1024 폭 메뉴: 단추가 오른쪽 끝 가까이 → 창은 화면 안으로 밀고 카드는 왼쪽(화면 안)
  const narrow = boardPosition(btn(930, 260, 70), 440, 1024, 768);
  assert.ok(narrow.left + 288 <= 1024 - 12, "창이 오른쪽으로 넘치지 않음");
  assert.ok(narrow.side === "left" ? narrow.left - 12 - 288 >= 8 : narrow.left + 288 + 12 + 288 <= 1024, "만들기 카드도 화면 안");
  // 왼쪽 끝 단추: 카드를 오른쪽으로
  const left = boardPosition(btn(20, 100, 70), 440, 1024, 768);
  assert.equal(left.left, 12);
  assert.equal(left.side, "right");
  assert.ok(left.left + 288 + 12 + 288 <= 1024, "오른쪽 카드도 화면 안");
  // 아래가 모자라고 위가 넉넉하면 뒤집는다
  const flipped = boardPosition(btn(500, 500, 70), 440, 1024, 768);
  assert.equal(flipped.above, true);
  assert.equal(flipped.edge, 768 - (500 - 8), "화면 아래 끝에서 단추 위 8 px");
  assert.ok(flipped.tail !== null);
  // 둘 다 모자라면 화면 안으로만 민다(꼬리 없음)
  const squeezed = boardPosition(btn(500, 200, 70), 600, 1024, 700);
  assert.equal(squeezed.tail, null);
  assert.ok(squeezed.edge >= 12 && squeezed.edge + 600 <= 700 || squeezed.edge === 12);
}

// ── 저장 경합: 서버를 기다리는 동안의 다른 편집이 되돌려지지 않는다 ──
{
  const page = { id: "p1", layout: "map-summary", panels: {}, textBoxes: [], notes: "", kind: "blank" };
  const d0 = { v: 1, format: "wide", pages: [page] };
  // 저장 시작(d0 화면) → 그 사이 발표 메모 편집(d1) → 저장 끝
  const d1 = reportDocReducer(d0, { type: "notes", id: "p1", notes: "그 사이 쓴 메모" });
  const mapColors = (doc) => reportDocReducer(doc, { type: "mapColors", scope: "document", patch: { base: "cool" } });
  const fromLatest = mapColors(d1);
  assert.equal(fromLatest.pages[0].notes, "그 사이 쓴 메모", "최신 문서에서 계산하면 다른 편집이 남는다");
  assert.equal(fromLatest.mapColors.base, "cool");
  assert.equal(mapColors(d0).pages[0].notes, "", "(옛 화면의 문서에서 계산하면 메모가 사라진다 — 이전 구현의 결함)");

  const report = read("../../components/v2/report/report-mode.tsx");
  const applyBody = report.slice(report.indexOf("const applyMapColors = useCallback"), report.indexOf("const previewMapColors"));
  assert.match(applyBody, /historyRef\.current/, "적용은 가장 최근 기록에서 계산한다");
  assert.doesNotMatch(applyBody, /history\.present|history\.past/, "렌더 때의 history를 읽지 않는다");
  const makerSrc = read("../../components/v2/map-colors/map-color-maker.tsx");
  const saveBody = makerSrc.slice(makerSrc.indexOf("const save = async"), makerSrc.indexOf("const title ="));
  assert.ok(saveBody.indexOf("if (!mounted.current) return;") < saveBody.indexOf("latest.current.onSaved"), "닫힌 카드는 저장 결과를 적용하지 않고, 열려 있으면 최신 콜백을 부른다");
  assert.doesNotMatch(saveBody, /[^.]onSaved\(kind/, "클릭 때의 옛 onSaved를 부르지 않는다");
}

// ── 배선 ──
{
  const page = read("../../app/v2/page.tsx");
  assert.match(page, /기본 지도 ▾/, "눌린 기본 지도 바탕 칩에 ▾");
  assert.match(page, /aria-haspopup=\{mapColorTrigger \? "dialog" : undefined\}/, "눌린 기본 지도 칩은 팝오버를 연다고 알린다");
  assert.match(page, /aria-expanded=\{mapColorTrigger \? mapColorFrom === from : undefined\}/);
  // 머리 줄이 접힌 폭(1024~1280)에서는 「더 보기」 메뉴 안 사본이 진입점이다: 두 곳 모두 같은 버튼 규칙을 쓴다.
  assert.match(page, /BASEMAPS\.map\(\(b\) => basemapButton\(b, "bar"\)\)/, "머리 줄 기본 지도 버튼");
  assert.match(page, /BASEMAPS\.map\(\(b\) => basemapButton\(b, "menu"\)\)/, "더 보기 메뉴 안 기본 지도 버튼");
  assert.match(page, /triggerRef=\{mapColorFrom === "menu" \? mapColorMenuRef : mapColorBarRef\}/, "연 쪽 버튼에 붙인다");
  assert.match(page, /onClose=\{closeMapColor\}/, "닫기 함수는 안정된 참조");
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
