/** 바탕 테마 토큰: 색 형식, 기본값, 라벨 대비 4.5:1, 보드 선택 왕복. */
import assert from "node:assert/strict";

const { BASE_THEMES, BASE_THEME_IDS, DEFAULT_BASE_THEME, baseTheme, themeFromColors, isBaseThemeRef } = await import("../../lib/v2/ui/map-theme.ts");
const { GODEOK_RESULTS } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { initBoard, boardReducer, serializeBoardState, restoreBoardState } = await import("../../lib/v2/ui/board-state.ts");

const HEX = /^#[0-9a-f]{6}$/i;
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const colorsOf = (v) => (typeof v === "string" ? (HEX.test(v) ? [v] : []) : v && typeof v === "object" ? Object.values(v).flatMap(colorsOf) : []);

assert.deepEqual(Object.keys(BASE_THEMES), ["warm", "cool", "paper", "sage", "sand", "blue", "mono", "ink"]);
assert.deepEqual([...BASE_THEME_IDS], Object.keys(BASE_THEMES));
assert.equal(DEFAULT_BASE_THEME, "warm");
assert.equal(baseTheme("x").id, "warm");
assert.equal(baseTheme(null).id, "warm");
assert.equal(baseTheme().id, "warm");
assert.equal(baseTheme("cool").id, "cool");

for (const [id, t] of Object.entries(BASE_THEMES)) {
  assert.equal(t.id, id);
  assert.ok(t.name.length > 0, `${id} 표시명`);
  for (const [key, value] of [["bg", t.bg], ["water", t.water]]) assert.match(value, HEX, `${id}.${key}`);
  // 색 문자열 필드는 모두 #rrggbb (dash 같은 비색 문자열은 제외)
  const colorKeys = { building: ["fill", "line"], parcel: ["line"], road: ["fill", "casing"], green: ["forest", "park", "grass"], station: ["fill", "line"], label: ["road", "place", "park", "station", "halo"], site: ["fill", "line"] };
  for (const [group, keys] of Object.entries(colorKeys)) for (const k of keys) assert.match(t[group][k], HEX, `${id}.${group}.${k}`);
  assert.ok(colorsOf(t).length === 20, `${id} 색 개수(ring 포함)`);
  assert.match(t.ring, HEX, `${id}.ring`);
  assert.equal(t.dark, id === "ink", `${id}.dark`);
  assert.equal(t.ring, id === "ink" ? "#cfcfcf" : "#16181d", `${id}.ring`);
  assert.equal(t.label.halo, t.bg, `${id} halo = bg`);
  for (const k of ["road", "place", "park", "station"]) {
    const ratio = contrast(t.label[k], t.bg);
    assert.ok(ratio >= 4.5, `${id}.label.${k} 대비 ${ratio.toFixed(2)} < 4.5`);
  }
  assert.notEqual(t.building.fill.toLowerCase(), t.bg.toLowerCase(), `${id} 건물 fill이 bg와 다름`);
}

// 공통 값과 테마별 값 표본
assert.equal(BASE_THEMES.warm.site.fillOpacity, 0.35);
assert.equal(BASE_THEMES.cool.site.haloPx, 5);
assert.equal(BASE_THEMES.paper.road.fill, "#f0eee9");
assert.equal(BASE_THEMES.paper.parcel.maxMPerPx, 2.5);
assert.equal(BASE_THEMES.cool.rail.dash, "6 5");
assert.equal(BASE_THEMES.warm.label.fontPx, 11);

assert.ok(contrast(BASE_THEMES.ink.ring, BASE_THEMES.ink.bg) >= 3, "ink ring 대비 3:1");
assert.equal(BASE_THEMES.ink.label.road, "#bdb7ac");
assert.equal(BASE_THEMES.ink.label.station, "#f2f2f2");
assert.equal(BASE_THEMES.sage.bg, "#eef1ea");
assert.equal(BASE_THEMES.mono.site.fillOpacity, 0.08);
// 기존 3개 값 고정
assert.equal(BASE_THEMES.warm.bg, "#f6f4ef");
assert.equal(BASE_THEMES.cool.site.line, "#111111");
assert.equal(BASE_THEMES.paper.green.park, "#e6eddc");

// 만든 색
{
  const colors = { bg: "#f6f4ef", building: "#e4ddd0", parcel: "#d6cebf", road: "#ffffff", green: "#dfe8d2", water: "#cfe1ea", site: "#f2b6b8" };
  const made = themeFromColors("내 테마 1", colors);
  assert.equal(made.name, "내 테마 1");
  assert.equal(made.dark, false);
  assert.equal(made.site.line, "#c9404a", "알려진 대지색은 프리셋 선");
  assert.equal(made.green.park, colors.green);
  assert.equal(made.label.halo, colors.bg);
  assert.deepEqual(baseTheme({ name: "내 테마 1", colors }), made);
  assert.ok(isBaseThemeRef({ name: "x", colors }));
  assert.ok(isBaseThemeRef("ink"));
  assert.ok(!isBaseThemeRef("nope"));
  assert.ok(!isBaseThemeRef({ name: "x", colors: { ...colors, bg: "red" } }));
  const dark = themeFromColors("어둠", { ...colors, bg: "#22252a" });
  assert.equal(dark.dark, true);
  assert.equal(dark.ring, "#cfcfcf");
  assert.equal(dark.label.road, "#bdb7ac");
  assert.equal(made.ring, "#16181d");
  assert.equal(baseTheme("nope").id, "warm");
  assert.equal(baseTheme({ colors: { bg: "red" } }).id, "warm");
  assert.equal(baseTheme("ink").id, "ink");
}

// 보드 선택: 액션 → 직렬화 → 복원 왕복, 없거나 모르는 값은 기본
{
  let s = initBoard(GODEOK_RESULTS);
  assert.equal(s.baseTheme, undefined, "초기 보드는 선택 없음(기본 warm)");
  assert.equal(baseTheme(s.baseTheme).id, "warm");
  s = boardReducer(s, { type: "baseTheme", id: "paper" });
  assert.equal(s.baseTheme, "paper");
  const snap = serializeBoardState(s);
  assert.equal(snap.baseTheme, "paper");
  const restored = restoreBoardState(GODEOK_RESULTS, JSON.parse(JSON.stringify(snap)));
  assert.equal(restored.baseTheme, "paper");
  assert.equal(serializeBoardState(restored).baseTheme, "paper");
  assert.equal(boardReducer(s, { type: "baseTheme", id: "nope" }), s, "모르는 id는 무시");
  const legacy = { ...JSON.parse(JSON.stringify(snap)) };
  delete legacy.baseTheme;
  assert.equal(restoreBoardState(GODEOK_RESULTS, legacy).baseTheme, undefined);
  assert.equal(restoreBoardState(GODEOK_RESULTS, { ...legacy, baseTheme: "zzz" }).baseTheme, undefined);
}

console.log("v2 map theme tests passed");
