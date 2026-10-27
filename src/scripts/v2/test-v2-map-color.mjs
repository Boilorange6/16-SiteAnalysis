/** 지도 색 계산: 생성기 결정성·잠금·한 칸 다시, 경고. */
import assert from "node:assert/strict";

const { MOODS, generateBaseColors, baseThemeWarnings, contrast, shiftL } = await import("../../lib/v2/ui/map-color.ts");
const { BASE_THEMES, themeFromColors } = await import("../../lib/v2/ui/map-theme.ts");

const HEX = /^#[0-9a-f]{6}$/i;
const cur = { bg: "#f6f4ef", building: "#e4ddd0", parcel: "#d6cebf", road: "#ffffff", green: "#dfe8d2", water: "#cfe1ea", site: "#f2b6b8" };
const half = () => 0.5;

assert.equal(MOODS.length, 8);
assert.equal(MOODS[0], "자동");
assert.equal(contrast("#000000", "#ffffff"), 21);
assert.equal(shiftL("#808080", 0), "#808080");
assert.ok(shiftL("#808080", 10) > "#808080");

for (const mood of MOODS) {
  const a = generateBaseColors(mood, cur, {}, undefined, half);
  assert.deepEqual(a, generateBaseColors(mood, cur, {}, undefined, half), `${mood} 결정적`);
  for (const [k, v] of Object.entries(a)) assert.match(v, HEX, `${mood}.${k}`);
  const r = generateBaseColors(mood, cur, {});
  for (const v of Object.values(r)) assert.match(v, HEX, `${mood} 무작위`);
}
assert.ok(generateBaseColors("어둡게", cur, {}, undefined, half).bg < "#404040", "어둡게는 어두운 바탕");

// 잠금·한 칸
{
  const locked = generateBaseColors("차갑게", cur, { bg: true }, undefined, half);
  assert.equal(locked.bg, cur.bg);
  assert.notEqual(locked.building, cur.building);
  const one = generateBaseColors("차갑게", cur, {}, "water", half);
  assert.notEqual(one.water, cur.water);
  for (const k of Object.keys(cur)) if (k !== "water") assert.equal(one[k], cur[k], `only water: ${k} 그대로`);
}

// 경고
{
  assert.deepEqual(baseThemeWarnings(BASE_THEMES.warm).map((w) => w.level), ["ok"]);
  for (const t of Object.values(BASE_THEMES)) assert.ok(baseThemeWarnings(t).every((w) => w.level === "ok"), `${t.id} 경고 없음`);
  const same = themeFromColors("같은색", { ...cur, building: cur.bg });
  const warns = baseThemeWarnings(same);
  assert.ok(warns.some((w) => w.level === "bad" && w.text.includes("건물")));
}

console.log("v2 map color tests passed");
