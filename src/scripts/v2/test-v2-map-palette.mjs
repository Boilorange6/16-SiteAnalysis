/** 다이어그램 팔레트: 모델 기준 레이어 색, 범례 연동, 생성기·경고. */
import assert from "node:assert/strict";

const P = await import("../../lib/v2/ui/map-palette.ts");
const { LAYER_STYLES, layerStyle, legendItemsForModel, legendItemsOf, modelLayerStyle } = await import("../../lib/v2/ui/map-layers.ts");
const { generatePaletteColors, paletteWarnings, MOODS } = await import("../../lib/v2/ui/map-color.ts");
const { BASE_TOGGLE_LAYERS, isBaseToggleLayer } = await import("../../lib/v2/ui/map-theme.ts");

const HEX = /^#[0-9a-f]{6}$/i;
const { paletteLayerStyle, paletteColors } = P;
const vivid = paletteColors("vivid");

// 기본 팔레트
assert.deepEqual([...P.PALETTE_IDS], ["app", "soft", "vivid", "earth", "pastel", "safe", "sea", "gray"]);
assert.equal(P.paletteName("app"), "지금 앱 색");
assert.equal(P.paletteName("gray"), "먹 단계");
assert.equal(P.paletteName({ name: "내 색", colors: vivid }), "내 색");
assert.equal(paletteColors("app"), null);
for (const id of P.PALETTE_IDS.filter((x) => x !== "app")) {
  const c = paletteColors(id);
  assert.equal(c.cat.length, 8, `${id} cat 8`);
  assert.equal(c.seq.length, 5, `${id} seq 5`);
  for (const v of [...c.cat, ...c.seq]) assert.match(v, HEX, id);
  assert.ok(P.isPaletteRef(id));
}
assert.ok(P.isPaletteRef("app"));
assert.ok(P.isPaletteRef({ name: "x", colors: vivid }));
assert.ok(!P.isPaletteRef("nope"));
assert.ok(!P.isPaletteRef({ name: "x", colors: { cat: vivid.cat, seq: vivid.seq.slice(1) } }));
assert.ok(!P.isPaletteRef({ name: "x", colors: { cat: vivid.cat.slice(1), seq: vivid.seq } }));
assert.ok(!P.isPaletteRef(null));

// 바탕 토글 레이어
assert.deepEqual([...BASE_TOGGLE_LAYERS], ["building", "parcel", "road", "green", "water"]);
assert.ok(isBaseToggleLayer("road") && !isBaseToggleLayer("site") && !isBaseToggleLayer(3));

// app/없음은 같은 객체
{
  const s = layerStyle("use:주거");
  assert.equal(paletteLayerStyle("use:주거", s, "app"), s);
  assert.equal(paletteLayerStyle("use:주거", s, undefined), s);
  assert.equal(paletteLayerStyle("use:주거", s, null), s);
  assert.equal(modelLayerStyle(undefined, "use:주거"), s);
  assert.equal(modelLayerStyle({}, "use:주거"), s);
  assert.equal(modelLayerStyle({ palette: "app" }, "use:주거"), s);
}

// 범주형: 접두사별 기타·미상 아닌 n번째 → cat[n % 8]
const SKIP = /(기타|미상|other)$/;
for (const prefix of ["use", "store", "zone", "zone_center", "jimok", "district", "facility"]) {
  const keys = Object.keys(LAYER_STYLES).filter((k) => k.startsWith(`${prefix}:`) && !SKIP.test(k));
  assert.ok(keys.length > 0, prefix);
  keys.forEach((k, n) => {
    const out = paletteLayerStyle(k, LAYER_STYLES[k], "vivid");
    assert.equal(out.color, vivid.cat[n % 8], `${k} color`);
    if (LAYER_STYLES[k].fill !== undefined) assert.equal(out.fill, vivid.cat[n % 8], `${k} fill`);
    assert.equal(out.label, LAYER_STYLES[k].label);
  });
}
assert.equal(paletteLayerStyle("use:주거", LAYER_STYLES["use:주거"], "vivid").color, vivid.cat[0]);
assert.equal(paletteLayerStyle("use:공업", LAYER_STYLES["use:공업"], "vivid").color, vivid.cat[7]);

// 기타·미상 및 범주·순서형이 아닌 레이어는 그대로
for (const k of ["use:기타", "use:미상", "jimok:기타", "district:기타", "zone:기타", "facility:기타", "store:other", "jimok:other",
  "floors_unknown", "floors_assumed_1f_est", "bldg_unknown", "trade_district_missing",
  "bus_stop", "rail_line", "park", "school_elem"]) {
  assert.equal(paletteLayerStyle(k, LAYER_STYLES[k], "vivid"), LAYER_STYLES[k], `${k} 그대로`);
}

// 순서형: legendOrder 순으로 seq를 구간 선형 보간
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (r) => "#" + r.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const at = (seq, t) => {
  const x = t * (seq.length - 1);
  const i = Math.min(seq.length - 2, Math.floor(x));
  const a = rgb(seq[i]);
  const b = rgb(seq[i + 1]);
  return hex(a.map((v, j) => v + (b[j] - v) * (x - i)));
};
{
  const color = (k) => paletteLayerStyle(k, LAYER_STYLES[k], "vivid").color;
  ["trade_q1", "trade_q2", "trade_q3", "trade_q4", "trade_q5"].forEach((k, i) => assert.equal(color(k), vivid.seq[i], k));
  ["trade_district_q1", "trade_district_q5"].forEach((k, i) => assert.equal(color(k), vivid.seq[i * 4], k));
  assert.equal(paletteLayerStyle("trade_district_q3", LAYER_STYLES.trade_district_q3, "vivid").fill, vivid.seq[2]);
  ["floors_1_4", "floors_5_8", "floors_9_14", "floors_15_25", "floors_26p"].forEach((k, i) => assert.equal(color(k), vivid.seq[i], k));
  const d04 = ["bldg_pre1980", "bldg_1980s", "bldg_1990s", "bldg_2000s", "bldg_2010s", "bldg_2020s"];
  d04.forEach((k, i) => assert.equal(color(k), at(vivid.seq, i / 5), k));
  assert.equal(color("bldg_pre1980"), vivid.seq[0]);
  assert.equal(color("bldg_2020s"), vivid.seq[4]);
}

// 사용자 팔레트(객체)도 같은 규칙
{
  const mine = { name: "내 색", colors: { cat: vivid.cat.map((_, i) => `#0000${(i + 16).toString(16)}`), seq: vivid.seq } };
  assert.equal(paletteLayerStyle("use:업무", LAYER_STYLES["use:업무"], mine).color, mine.colors.cat[2]);
}

// 범례는 같은 색을 쓴다
{
  const model = {
    center: [127.15, 37.62], radiusM: 1000, total: 0, notes: [],
    features: ["use:주거", "use:근린생활", "use:기타", "trade_q1", "trade_q5", "bus_stop"].map((layer) => ({ layer, lng: 127.15, lat: 37.62 })),
  };
  const base = legendItemsForModel(model);
  assert.equal(base.find((i) => i.layer === "use:주거").color, LAYER_STYLES["use:주거"].color, "팔레트 없으면 기존 색");
  const items = legendItemsForModel({ ...model, palette: "vivid" });
  assert.equal(items.length, base.length);
  for (const item of items) {
    assert.equal(item.color, modelLayerStyle({ palette: "vivid" }, item.layer).color, `${item.layer} 범례 색`);
  }
  assert.equal(items.find((i) => i.layer === "use:주거").color, vivid.cat[0]);
  assert.equal(items.find((i) => i.layer === "trade_q5").color, vivid.seq[4]);
  assert.equal(items.find((i) => i.layer === "bus_stop").color, LAYER_STYLES.bus_stop.color);
  assert.deepEqual(legendItemsOf({ ...model, palette: "vivid" }).map((i) => i.label), legendItemsOf(model).map((i) => i.label));
}

// 생성기: 결정성·잠금·한 칸
{
  const half = () => 0.5;
  const cur = paletteColors("soft");
  for (const mood of MOODS) {
    const a = generatePaletteColors(mood, cur, {}, undefined, half);
    assert.deepEqual(a, generatePaletteColors(mood, cur, {}, undefined, half), `${mood} 결정적`);
    assert.equal(a.cat.length, 8);
    assert.equal(a.seq.length, 5);
    for (const v of [...a.cat, ...a.seq]) assert.match(v, HEX, mood);
    const r = generatePaletteColors(mood, cur, {});
    for (const v of [...r.cat, ...r.seq]) assert.match(v, HEX, `${mood} 무작위`);
  }
  const locked = generatePaletteColors("선명하게", cur, { 0: true, 3: true, seq: true }, undefined, half);
  assert.equal(locked.cat[0], cur.cat[0]);
  assert.equal(locked.cat[3], cur.cat[3]);
  assert.deepEqual(locked.seq, cur.seq);
  assert.notEqual(locked.cat[1], cur.cat[1]);
  const one = generatePaletteColors("선명하게", cur, {}, 2, half);
  assert.notEqual(one.cat[2], cur.cat[2]);
  cur.cat.forEach((c, i) => { if (i !== 2) assert.equal(one.cat[i], c); });
  assert.deepEqual(one.seq, cur.seq);
  const seqOnly = generatePaletteColors("선명하게", cur, {}, "seq", half);
  assert.deepEqual(seqOnly.cat, cur.cat);
  assert.notDeepEqual(seqOnly.seq, cur.seq);
  // seq는 밝음→어두움
  const L = (h) => rgb(h).reduce((s, v) => s + v, 0);
  const s = generatePaletteColors("자동", cur, {}, undefined, half).seq;
  for (let i = 1; i < 5; i++) assert.ok(L(s[i]) < L(s[i - 1]), "seq 어두워짐");
}

// 경고
{
  const gray = paletteWarnings(paletteColors("gray"));
  assert.ok(gray.some((w) => w.level === "bad" && w.text.includes("비슷한 색")), "gray 비슷한 색");
  const safe = paletteWarnings(paletteColors("safe"));
  assert.ok(!safe.some((w) => w.text.includes("녹색약")), "safe 녹색약 경고 없음");
  const vv = paletteWarnings(paletteColors("vivid"));
  assert.ok(vv.length >= 1 && vv.every((w) => w.level === "bad" || w.level === "ok"));
}

console.log("v2 map-palette ok");
