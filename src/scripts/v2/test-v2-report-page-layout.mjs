/** 보고서 장 기하(reportPageGeometry)와 핵심 숫자 카드 맞춤(keyFigureFit): 화면·PPT·그림·축척이 같은 값을 읽는 순수 함수. */
import assert from "node:assert/strict";

const { reportPageGeometry, frameChromeUnit, keyCardBox } = await import("../../lib/v2/ui/report-page-layout.ts");
const { keyFigureFit } = await import("../../lib/v2/report/key-figure-fit.ts");
const { textIn } = await import("../../lib/v2/report/pptx-kit.ts");

const near = (a, b, msg, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≈ ${b}`);
const right = (r) => r.x + r.w;
const bottom = (r) => r.y + r.h;
const hit = (a, b) => a.x < right(b) - 1e-6 && b.x < right(a) - 1e-6 && a.y < bottom(b) - 1e-6 && b.y < bottom(a) - 1e-6;
const inside = (r, f) => r.x >= f.x - 1e-6 && r.y >= f.y - 1e-6 && right(r) <= right(f) + 1e-6 && bottom(r) <= bottom(f) + 1e-6;
const area = (r) => r.w * r.h;

const base = { format: "wide", summaryDeleted: false, titleSize: { w: 4.2, h: 0.5 }, keyCardHeight: 2.4, legendSize: { w: 2.2, h: 1.4 }, chartSlots: 2, sentenceHeight: 0.5 };
const geo = (extra) => reportPageGeometry({ ...base, ...extra });

// ── 불변식(Ruling 17): 저장 자리를 어떻게 줘도 모든 쌍 겹침 0, 모든 부속·카드·칩이 지도 틀 안
const invariants = (g, layout, tag, notes = true) => {
  const items = { title: g.title, legend: g.legend, north: g.north, scaleBar: g.scaleBar, keyNotesChip: g.keyNotesChip };
  if (layout === "map-key") items.keyCard = g.keyCard;
  const names = Object.keys(items).filter((n) => items[n]);
  for (const n of names) assert.ok(inside(items[n], g.map), `${tag} ${n} 지도 틀 안 ${JSON.stringify(items[n])}`);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) assert.ok(!hit(items[names[i]], items[names[j]]), `${tag} ${names[i]}·${names[j]} 겹침 ${JSON.stringify(items[names[i]])} ${JSON.stringify(items[names[j]])}`);
  if (g.column) {
    const c = g.column;
    for (const n of ["key", "chart1", "chart2", "sentence", "notesChip"]) if (c[n]) assert.ok(inside(c[n], c.rect), `${tag} column.${n} 열 안`);
    if (notes) for (const n of ["key", "chart1", "chart2", "sentence"]) if (c[n] && c[n].h > 0) assert.ok(!hit(c.notesChip, c[n]), `${tag} 열 칩·${n} 겹침`);
  }
};
{
  const W = 13.333;
  const H = 7.5;
  const pr = (x, y, w, h) => ({ x: x / W, y: y / H, w: w / W, h: h / H });
  let seed = 20261102;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  // 재현값 표(라운드 1·2 지적)
  const dKey = reportPageGeometry({ ...base, layout: "map-key" });
  const table = [
    ["north(1,6)", { north: pr(1, 6, 0.9, 0.9) }],
    ["scale(.5,6.3)", { scaleBar: pr(0.5, 6.3, 1.8, 0.4) }],
    ["A legend(10.27,5.47)", { legend: pr(10.27, 5.47, 2.2, 1.4) }],
    ["A legend(10.77,0.14)", { legend: pr(10.77, 0.14, 2.2, 1.4) }],
    ["C card(5,4.9,3.4×2.3)", { summary: pr(5, 4.9, 3.4, 2.3) }],
    ["C card above scale", { summary: pr(dKey.scaleBar.x, dKey.scaleBar.y - 2.05, dKey.scaleBar.w, 2) }],
    ["D title(0.5,6.5)", { title: pr(0.5, 6.5, 4.2, 0.5) }],
    ["D title(0.3,3.295)", { title: pr(0.3, 3.295, 4.2, 0.5) }],
  ];
  for (const format of ["wide", "a3", "a4"]) for (const layout of ["map-key", "map-charts"]) for (const [name, panels] of table) {
    for (const notes of [true, false]) invariants(reportPageGeometry({ ...base, format, layout, panels, notes }), layout, `${format} ${layout} ${name}`, notes);
  }
  // 시드 고정 난수: 카드·제목·범례·방위표·축척을 틀 안팎 임의 위치에(기본 자리 근처 포함)
  for (const format of ["wide", "a3", "a4"]) for (const layout of ["map-key", "map-charts"]) for (const notes of [true, false]) {
    const d0 = reportPageGeometry({ ...base, format, layout, notes });
    const size = { w: d0.footer.w, h: d0.footer.y + d0.footer.h };
    const anchors = [d0.title, d0.keyCard, d0.keyNotesChip, d0.legend, d0.north, d0.scaleBar].filter(Boolean);
    const place = (w, h) => {
      let x;
      let y;
      if (rnd() < 0.5) { x = rnd() * size.w * 1.1 - 0.1 * size.w; y = rnd() * size.h * 1.1 - 0.1 * size.h; } else { const a = pick(anchors); x = a.x + (rnd() - 0.5) * 0.8; y = a.y + (rnd() - 0.5) * 0.8; }
      return { x: Math.max(0, x) / size.w, y: Math.max(0, y) / size.h, w: w / size.w, h: h / size.h };
    };
    for (let i = 0; i < 400; i++) {
      const panels = {};
      if (rnd() < 0.7) panels.summary = place(2 + rnd() * 2.5, 1 + rnd() * 3);
      if (rnd() < 0.7) panels.title = place(1, 1);
      if (rnd() < 0.7) panels.legend = place(1, 1);
      if (rnd() < 0.7) panels.north = place(1, 1);
      if (rnd() < 0.7) panels.scaleBar = place(1, 1);
      const g = reportPageGeometry({ ...base, format, layout, notes, panels, keyCardHeight: pick([1.2, 2.4, 3.4]), legendSize: pick([null, { w: 1.4, h: 0.9 }, { w: 2.2, h: 1.4 }]), sentenceHeight: pick([0, 0.17, 0.5]), chartSlots: pick([0, 1, 2]) });
      invariants(g, layout, `${format} ${layout} notes=${notes} #${i} ${JSON.stringify(panels)}`, notes);
    }
  }
}

// ── wide map-key
{
  const g = geo({ layout: "map-key" });
  assert.deepEqual([g.map.x, g.map.y], [0, 0]);
  near(g.map.w, 13.333, "map.w");
  near(g.map.h, 7.21, "map.h");
  near(g.footer.y, 7.21, "footer.y");
  near(g.footer.h, 0.29, "footer.h");
  assert.equal(g.column, null);
  assert.equal(g.keyCard.x, 0.25);
  assert.equal(g.keyCard.y, 0.875);
  assert.equal(g.keyCard.w, 3.125);
  assert.equal(g.keyCard.h, 2.4);
  near(g.scenePxPerInch, 960 / 13.333, "scenePxPerInch");
}

// ── wide map-charts
{
  const g = geo({ layout: "map-charts" });
  near(g.map.w, 9.067, "map.w");
  near(g.column.rect.x, g.map.w + 0.21, "column.x");
  near(right(g.column.rect), 13.333 - 0.25, "column 오른쪽");
  near(g.column.key.y, 0.25, "key.y");
  assert.deepEqual(g.keyCard, g.column.key, "② keyCard는 column.key");
  near(g.column.chart1.y - bottom(g.column.key), 0.125, "카드 간격 key→chart1");
  near(g.column.chart2.y - bottom(g.column.chart1), 0.125, "카드 간격 chart1→chart2");
  near(g.column.sentence.y - bottom(g.column.chart2), 0.125, "chart2→sentence");
  near(bottom(g.column.sentence), g.footer.y - 0.21, "sentence 아래 끝");
  near(g.column.sentence.h, 0.5, "sentenceHeight");
}

// ── 방위표 지름(틀 폭 기준 d2 A)
{
  const d = (g) => (46 * g.unit * g.map.w) / 960;
  const key = geo({ layout: "map-key" });
  near(d(key), 0.92, "wide map-key 방위표");
  near(key.north.w, 0.92, "north.w");
  near(d(geo({ layout: "map-charts" })), 0.65, "wide map-charts 방위표");
  near((46 * frameChromeUnit(5.6, 5.4) * 5.6) / 960, 0.40, "5.6×5.4 틀 방위표");
  near(frameChromeUnit(13.333, 7.21), 1.442, "frameChromeUnit", 0.001);
  assert.equal(frameChromeUnit(10, 1), 1);
  assert.equal(frameChromeUnit(1, 10), 1.5);
}

// ── 모든 판형 × 두 배치
for (const format of ["wide", "a3", "a4"]) {
  for (const layout of ["map-key", "map-charts"]) {
    const g = geo({ format, layout });
    const tag = `${format} ${layout}`;
    const pageRect = { x: 0, y: 0, w: g.footer.w, h: g.footer.y + g.footer.h };
    const named = { title: g.title, keyCard: g.keyCard, legend: g.legend, north: g.north, scaleBar: g.scaleBar, footer: g.footer, pageNo: g.pageNo, map: g.map };
    if (g.column) Object.assign(named, { column: g.column.rect, chart1: g.column.chart1, chart2: g.column.chart2, sentence: g.column.sentence, notesChip: g.column.notesChip });
    for (const [name, r] of Object.entries(named)) {
      if (!r) continue;
      assert.ok(inside(r, pageRect), `${tag} ${name} 장 안`);
      if (name !== "map") assert.ok(area(g.map) > area(r), `${tag} map이 ${name}보다 큼`);
    }
    for (const name of ["north", "scaleBar", "legend"]) if (g[name]) assert.ok(inside(g[name], g.map), `${tag} ${name} 틀 안`);
    const pairs = ["title", "keyCard", "legend", "north", "scaleBar", "footer"].filter((n) => g[n]).map((n) => [n, g[n]]);
    if (g.column) pairs.push(["column", g.column.rect]);
    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) {
        const [an, ar] = pairs[i];
        const [bn, br] = pairs[j];
        if (g.column && an === "keyCard" && bn === "column") continue; // ②: keyCard는 column 안의 key와 같다
        assert.ok(!hit(ar, br), `${tag} ${an}·${bn} 겹침`);
      }
    }
    if (g.column) {
      for (const n of ["key", "chart1", "chart2", "sentence"]) assert.ok(inside(g.column[n], g.column.rect), `${tag} column.${n} 열 안`);
      assert.ok(!hit(g.column.key, g.column.chart1) && !hit(g.column.chart2, g.column.sentence) && !hit(g.column.chart1, g.column.chart2), `${tag} 열 카드 겹침`);
    }
  }
}

// ── 열 높이 모자람: chart2 → chart1 → 둘 다 없음. key·sentence는 남는다
{
  const some = geo({ layout: "map-charts", keyCardHeight: 4.0 }).column;
  assert.equal(some.chart2, null);
  assert.notEqual(some.chart1, null);
  const none = geo({ layout: "map-charts", keyCardHeight: 5.4 }).column;
  assert.equal(none.chart1, null);
  assert.equal(none.chart2, null);
  assert.ok(none.key.h === 5.4 && none.sentence.h === 0.5, "key·sentence는 줄지 않는다");
  near(bottom(none.sentence), 7.21 - 0.21, "sentence는 열 맨 아래");
  const one = geo({ layout: "map-charts", chartSlots: 1 }).column;
  assert.notEqual(one.chart1, null);
  assert.equal(one.chart2, null);
  assert.equal(geo({ layout: "map-charts", chartSlots: 0 }).column.chart1, null);
}

// ── N1: 구성비 카드가 내용(막대 줄 수)보다 크면 내용 높이로 줄이고 남는 높이는 거리 카드가 가진다. 내용이 더 크면 그대로.
{
  const full = geo({ layout: "map-charts" }).column;
  const capped = geo({ layout: "map-charts", chart1Content: 1.1 }).column;
  near(capped.chart1.h, 1.1, "구성비 카드 높이 = 내용 높이");
  near(capped.chart2.y - bottom(capped.chart1), 0.125, "카드 간격 chart1→chart2");
  near(bottom(capped.chart2), bottom(full.chart2), "거리 카드 아래 끝은 그대로");
  assert.ok(full.chart1.h > 1.1, "전제: 몫이 내용보다 크다");
  near(capped.chart2.h, full.chart2.h + (full.chart1.h - 1.1), "거리 카드가 남는 높이만큼 커진다");
  const big = geo({ layout: "map-charts", chart1Content: 9 }).column;
  near(big.chart1.h, full.chart1.h, "내용이 더 크면 몫 그대로");
}

// ── 숫자 카드 지움
{
  const k = geo({ layout: "map-key", summaryDeleted: true });
  assert.equal(k.keyCard, null);
  assert.equal(k.column, null);
  const c = geo({ layout: "map-charts", summaryDeleted: true });
  assert.equal(c.column, null);
  assert.equal(c.keyCard, null);
  assert.equal(c.map.w, 13.333);
}

// ── ① 카드가 커서 범례(왼쪽 아래)와 세로로 겹치면 범례를 카드 오른쪽으로 민다. 카드는 줄이지 않는다
{
  const small = geo({ layout: "map-key" });
  near(small.legend.x, 0.25, "범례 기본 x");
  near(bottom(small.legend), small.map.h - 0.25, "범례 기본 아래");
  const tall = geo({ layout: "map-key", keyCardHeight: 5.6 });
  assert.equal(tall.keyCard.h, 5.6);
  near(tall.legend.x, right(tall.keyCard) + 0.125, "범례는 카드 오른쪽 끝 + 0.125");
  near(bottom(tall.legend), small.map.h - 0.25, "y는 그대로");
  assert.ok(!hit(tall.legend, tall.keyCard) && inside(tall.legend, tall.map), "겹침 없이 틀 안");
  assert.equal(tall.legend.w, 2.2);
  assert.equal(geo({ layout: "map-key", legendSize: null }).legend, null);
}

// ── ① 저장 panels.summary: 틀 안·겹침 없음이면 카드를 그 자리에, 아니면 기본 자리. map-charts는 무시
{
  const W = 13.333;
  const H = 7.5;
  const toPanel = (x, y, w, h) => ({ x: x / W, y: y / H, w: w / W, h: h / H });
  const moved = geo({ layout: "map-key", panels: { summary: toPanel(5, 1.5, 3.4, 2.2) } });
  near(moved.keyCard.x, 5, "옮긴 x");
  near(moved.keyCard.y, 1.5, "옮긴 y");
  near(moved.keyCard.w, 3.4, "옮긴 w");
  near(moved.keyCard.h, 2.2, "옮긴 h");
  const overTitle = geo({ layout: "map-key", panels: { summary: toPanel(0.3, 0.3, 3.4, 2.2) } });
  assert.deepEqual(overTitle.keyCard, geo({ layout: "map-key" }).keyCard, "제목과 겹치면 기본 자리");
  const outside = geo({ layout: "map-key", panels: { summary: toPanel(11, 5, 4, 3) } });
  assert.ok(outside.keyCard.w === 3.125 && outside.keyCard.x === 0.25, "틀 밖이면 기본 자리");
  const ignored = geo({ layout: "map-charts", panels: { summary: toPanel(5, 1.5, 3.4, 2.2) } });
  assert.deepEqual(ignored.keyCard, geo({ layout: "map-charts" }).keyCard, "map-charts는 summary 무시");
}

// ── 저장 panels.north·legend
{
  const W = 13.333;
  const H = 7.5;
  const defNorth = geo({ layout: "map-key" }).north;
  const at = (x, y) => ({ x: x / W, y: y / H, w: defNorth.w / W, h: defNorth.h / H });
  const moved = geo({ layout: "map-key", panels: { north: at(6, 2) } });
  near(moved.north.x, 6, "옮긴 north x");
  near(moved.north.y, 2, "옮긴 north y");
  near(moved.north.w, defNorth.w, "north 크기는 unit에서");
  // ② 열 위에 놓인 north·legend는 기본 자리로
  const def = geo({ layout: "map-charts" });
  const col = def.column.rect;
  const stray = geo({ layout: "map-charts", panels: { north: at(col.x + 0.5, 3), legend: { x: (col.x + 0.3) / W, y: 3 / H, w: 0.1, h: 0.1 } } });
  assert.deepEqual(stray.north, def.north, "열 위 north는 기본 자리");
  assert.deepEqual(stray.legend, def.legend, "열 위 legend는 기본 자리");
  // legend 저장값의 w·h는 무시하고 legendSize를 쓴다
  const lg = geo({ layout: "map-key", panels: { legend: { x: 5 / W, y: 5 / H, w: 0.05, h: 0.02 } } });
  near(lg.legend.x, 5, "옮긴 legend x");
  near(lg.legend.y, 5, "옮긴 legend y");
  assert.equal(lg.legend.w, 2.2);
  assert.equal(lg.legend.h, 1.4);
  // 카드와 겹치는 저장 north는 기본 자리
  const onCard = geo({ layout: "map-key", panels: { north: at(1, 2) } });
  assert.deepEqual(onCard.north, defNorth, "카드와 겹치는 north는 기본 자리");
}

// ── keyFigureFit
{
  const a01 = { question: "가장 가까운 지하철역", answer: { pre: "도보", value: "6분", target: "대치역", kind: "number" }, sub: "3호선 · 보행망 498m", stats: [{ value: "4분", label: "정류장까지 도보" }, { value: "5곳", label: "1km 안 지하철역" }, { value: "106곳", label: "1km 안 정류장" }] };
  const mk = (extra = {}) => ({ figure: a01, badges: [], grades: [], filterLine: null, sentence: "역세권에 가깝습니다", width: 3.806, columns: 3, summaryPt: 13, ...extra });
  const f = keyFigureFit(mk());
  near(f.valuePt, 43.5, "valuePt", 0.01);
  near(f.questionPt, 9.4, "questionPt", 0.01);
  near(f.sentencePt, 9.75, "sentencePt", 0.01);
  near(f.prePt, 18, "prePt");
  near(f.targetPt, 21, "targetPt");
  near(f.subPt, 9.4, "subPt");
  near(f.statValuePt, 15, "statValuePt");
  near(f.statLabelPt, 8.25, "statLabelPt");
  assert.equal(f.targetOnSub, false);

  // 요약 글자 1.2배 → 모든 pt가 1.2배 (카드 폭도 1.2배)
  const big = keyFigureFit(mk({ summaryPt: 15.6, width: 3.806 * 1.2 }));
  for (const k of ["questionPt", "prePt", "valuePt", "targetPt", "subPt", "statValuePt", "statLabelPt", "sentencePt"]) near(big[k], f[k] * 1.2, `1.2배 ${k}`, 0.01);

  // 이름 답은 23 pt
  const zone = { question: "용도지역", answer: { value: "제2종일반주거지역", kind: "name" }, stats: [] };
  near(keyFigureFit(mk({ figure: zone, width: 5 })).valuePt, 23, "이름 답 23");

  // 긴 대상: 숫자는 24 pt 아래로 줄지 않고, 그래도 넘치면 대상을 보조 줄로 내린다
  const longName = { ...a01, answer: { pre: "도보", value: "6분", target: "제2종일반주거지역 · 아주긴역이름역", kind: "number" } };
  const lf = keyFigureFit(mk({ figure: longName, width: 2.4, columns: 2 }));
  assert.equal(lf.targetOnSub, true);
  assert.ok(lf.valuePt >= 24, `valuePt ${lf.valuePt}`);
  assert.ok(lf.subLines.join("").includes("제2종"), "대상이 보조 줄에 있다");
  // 숫자만 줄여서 들어가면 대상은 그대로 둔다
  const mid = keyFigureFit(mk({ figure: { ...a01, answer: { pre: "도보", value: "6분", target: "대치역", kind: "number" } }, width: 3.0, columns: 2 }));
  assert.equal(mid.targetOnSub, false);
  assert.ok(mid.valuePt >= 24 && mid.valuePt < 43.5, `줄인 숫자 ${mid.valuePt}`);

  // 배지
  const four = keyFigureFit(mk({ badges: ["추정", "미확인", "일부 자료만 집계", "모델"] }));
  assert.equal(four.badgesShown.length, 2);
  assert.equal(four.badgesMore, 2);
  assert.deepEqual(keyFigureFit(mk({ badges: ["추정"] })).badgesShown, ["추정"]);

  // 필터 줄·등급 칩·보조 줄·해석이 높이에 든다
  assert.ok(keyFigureFit(mk({ filterLine: "적용 필터: 용도 = 주거" })).height > f.height, "필터 줄");
  assert.ok(keyFigureFit(mk({ grades: ["철도 좋음"], figure: { ...a01, sub: undefined } })).height > keyFigureFit(mk({ figure: { ...a01, sub: undefined } })).height, "등급 칩 줄");
  assert.ok(f.height > keyFigureFit(mk({ figure: { ...a01, sub: undefined } })).height, "보조 줄");

  // 칸 수: 보조 숫자 3개는 2칸이면 두 줄, 3칸이면 한 줄
  assert.ok(keyFigureFit(mk({ columns: 2 })).height > f.height, "2칸이 더 높다");
  assert.equal(keyFigureFit(mk({ figure: { ...a01, stats: [] } })).height < f.height, true, "보조 숫자 없음");

  // 해석: ①(columns 2)만 카드 높이에 든다. 줄 수는 2 이하
  const one = keyFigureFit(mk({ columns: 2, width: 3.125 }));
  const noSent = keyFigureFit(mk({ columns: 2, width: 3.125, sentence: null }));
  assert.ok(one.height > noSent.height, "① 해석 한 줄");
  assert.equal(keyFigureFit(mk({ sentence: "가나다 ".repeat(60) })).sentenceLines.length, 3);
  assert.match(keyFigureFit(mk({ sentence: "가나다 ".repeat(60) })).sentenceLines[2], /…$/);
  // ①(columns 2)에서도 3줄까지, 넘치면 끝이 …
  const longOne = keyFigureFit(mk({ columns: 2, width: 3.125, sentence: "가나다 ".repeat(60) }));
  assert.equal(longOne.sentenceLines.length, 3);
  assert.match(longOne.sentenceLines[2], /…$/);
  assert.equal(keyFigureFit(mk({ columns: 3 })).height, keyFigureFit(mk({ columns: 3, sentence: null })).height, "② 해석은 카드 밖");

  // 구성 막대(A12): 보조 숫자 대신 막대 + 항목 목록
  const parts = Array.from({ length: 6 }, (_, i) => ({ label: `구역${i}`, share: 0.1, color: "#888" }));
  const withParts = keyFigureFit(mk({ figure: { ...a01, parts } }));
  const noStats = keyFigureFit(mk({ figure: { ...a01, stats: [] } }));
  assert.ok(withParts.height > noStats.height + 6 * 0.1, "구성 막대 높이");
  assert.equal(keyFigureFit(mk({ figure: { ...a01, parts: parts.slice(0, 2) } })).height < withParts.height, true, "항목 수가 높이에 든다");
}

// ── 수정 1 라운드: 저장 부속·제목, 주석 칩 자리, 카드 폭
{
  const W = 13.333;
  const H = 7.5;
  const p = (x, y, w = 0.05, h = 0.05) => ({ x: x / W, y: y / H, w: w / W, h: h / H });
  // 기본 범례(왼쪽 아래)가 옮겨 둔 방위표·축척과 겹치면 기본 자리로 돌아간다(① ②)
  for (const layout of ["map-key", "map-charts"]) {
    const n = geo({ layout, panels: { north: p(1, 6) } });
    assert.ok(!hit(n.north, n.legend), `${layout} 방위표가 기본 범례와 겹침`);
    assert.deepEqual(n.north, geo({ layout }).north, `${layout} 겹치면 기본 방위표`);
    const s = geo({ layout, panels: { scaleBar: p(0.5, 6.3) } });
    assert.ok(!hit(s.scaleBar, s.legend), `${layout} 축척이 기본 범례와 겹침`);
    assert.deepEqual(s.scaleBar, geo({ layout }).scaleBar);
    const ok = geo({ layout, panels: { scaleBar: p(5, 3) } });
    near(ok.scaleBar.x, 5, `${layout} 저장 축척 x`);
    near(ok.scaleBar.y, 3, `${layout} 저장 축척 y`);
    near(ok.scaleBar.w, geo({ layout }).scaleBar.w, "축척 크기는 기하가 정한다");
    // 저장 범례가 있으면 그 범례와만 겹치지 않으면 된다
    const withLegend = geo({ layout, panels: { legend: p(5, 5), north: p(1, 6) } });
    near(withLegend.north.x, 1, "저장 범례가 있으면 기본 범례 자리는 비켜 준다");
  }
  // 저장 제목 칩: 틀 안이고 겹치지 않으면 쓰고, 크기는 titleSize. 카드 기본 y는 기본 제목 자리 기준
  const t = geo({ layout: "map-key", panels: { title: p(6, 0.3) } });
  near(t.title.x, 6, "옮긴 제목 x");
  near(t.title.y, 0.3, "옮긴 제목 y");
  near(t.title.w, 4.2, "제목 크기는 titleSize");
  assert.equal(t.keyCard.y, 0.875, "카드 기본 y는 기본 제목 자리 기준");
  assert.deepEqual(geo({ layout: "map-key", panels: { title: p(0.5, 1) } }).title, geo({ layout: "map-key" }).title, "카드와 겹치는 제목은 기본 자리");
  const col = geo({ layout: "map-charts" }).column.rect;
  assert.deepEqual(geo({ layout: "map-charts", panels: { title: p(col.x + 0.2, 3) } }).title, geo({ layout: "map-charts" }).title, "열 위 제목은 기본 자리");
  // 주석 칩: ②는 열 맨 아래 오른쪽(해석 줄은 칩을 비킨다), ①은 카드 바로 아래 오른쪽
  const c = geo({ layout: "map-charts" }).column;
  near(right(c.notesChip), right(c.rect), "칩 오른쪽 끝");
  near(bottom(c.notesChip), bottom(c.rect), "칩 아래 끝");
  assert.ok(!hit(c.notesChip, c.sentence), "해석 줄이 칩과 겹치지 않는다");
  near(c.sentence.w, c.rect.w - 0.8 - 0.1, "해석 줄 폭에서 칩 자리를 뺀다");
  for (const chartSlots of [2, 1]) {
    const nc = geo({ layout: "map-charts", sentenceHeight: 0, chartSlots }).column;
    assert.ok(nc.chart1 && !hit(nc.notesChip, nc.chart1) && (!nc.chart2 || !hit(nc.notesChip, nc.chart2)), `해석이 없어도 칩이 그래프 카드와 겹치지 않는다 (slots ${chartSlots})`);
  }
  for (const n of ["key", "chart1", "chart2"]) assert.ok(!hit(c.notesChip, c[n]), `칩이 ${n}와 겹치지 않는다`);
  near(geo({ layout: "map-charts", notes: false }).column.sentence.w, c.rect.w, "주석이 없으면 해석 줄은 열 폭 전체");
  assert.equal(geo({ layout: "map-charts" }).keyNotesChip, null, "② 숫자 카드 아래 칩은 없다");
  const k = geo({ layout: "map-key", keyCardHeight: 2.4 });
  near(right(k.keyNotesChip), right(k.keyCard), "① 칩은 카드 오른쪽 정렬");
  assert.ok(k.keyNotesChip.y >= bottom(k.keyCard) && k.keyNotesChip.y - bottom(k.keyCard) < 0.2, "① 칩은 카드 바로 아래");
  assert.equal(geo({ layout: "map-key", notes: false }).keyNotesChip, null);
  assert.equal(geo({ layout: "map-key", summaryDeleted: true }).keyNotesChip, null);
  // 범례 밀기 판정은 카드 + 칩 아래 끝
  const edge = geo({ layout: "map-key", keyCardHeight: 4.5 });
  near(edge.legend.x, right(edge.keyCard) + 0.125, "칩까지 겹치면 범례를 민다");
  near(geo({ layout: "map-key", keyCardHeight: 4.5, notes: false }).legend.x, 0.25, "칩이 없으면 그대로");
  assert.ok(!hit(edge.legend, edge.keyNotesChip));
  // 카드 폭을 먼저 얻는다
  const t4 = { w: 4.2, h: 0.5 };
  const box = (layout, format, panels, extra = {}) => keyCardBox({ layout, format, panels, summaryDeleted: false, titleSize: t4, legendSize: { w: 2.2, h: 1.4 }, ...extra });
  assert.deepEqual(box("map-key", "wide"), { w: 3.125, h: null });
  near(box("map-charts", "wide").w, geo({ layout: "map-charts" }).column.key.w, "② 폭 = 열 폭");
  near(box("map-charts", "a4").w, geo({ layout: "map-charts", format: "a4" }).column.key.w, "a4 ② 폭");
  assert.equal(box("map-charts", "wide").h, null);
  const ok = box("map-key", "wide", { summary: p(5, 1.5, 3.4, 2.2) });
  near(ok.w, 3.4, "저장 카드 폭을 따른다");
  near(ok.h, 2.2, "저장 카드 높이(maxHeight로 넘길 값)");
  assert.deepEqual(box("map-key", "wide", { summary: p(0.3, 0.3, 3.4, 2.2) }), { w: 3.125, h: null }, "겹치면 기본 폭·높이 없음");
  assert.deepEqual(box("map-key", "wide", { summary: p(5, 4.9, 3.4, 2.3) }), { w: 3.125, h: null }, "칩이 틀 밖으로 나가면 기각");
  assert.deepEqual(box("map-charts", "wide", { summary: p(5, 1.5, 3.4, 2.2) }), box("map-charts", "wide"), "② 저장 summary 무시");
  // 채택 판정은 reportPageGeometry와 같다
  for (const panels of [{ summary: p(5, 1.5, 3.4, 2.2) }, { summary: p(0.3, 0.3, 3.4, 2.2) }, { summary: p(5, 1.5, 3.4, 2.2), title: p(6, 2, 4.2, 0.5) }, { summary: p(9, 0.05, 3.4, 2.2) }]) {
    const b = box("map-key", "wide", panels);
    const gk = geo({ layout: "map-key", panels }).keyCard;
    near(gk.w, b.w, "카드 폭 일치");
    if (b.h !== null) near(gk.h, b.h, "저장 높이 일치");
    else assert.equal(gk.h, base.keyCardHeight, "기각이면 기본 높이");
  }
}

// ── 수정 1 라운드: 큰 답 (post·이름 답·여유 0), maxHeight, rows
{
  const mkIn = (figure, extra = {}) => ({ figure, badges: [], grades: [], filterLine: null, sentence: "역세권에 가까운 입지입니다", width: 3.806, columns: 3, summaryPt: 13, ...extra });
  const answerW = (f, a) => textIn(a.pre ? `${a.pre} ` : "", f.prePt) + textIn(a.value, f.valuePt) + textIn(a.post ?? "", f.postPt) + (a.target && !f.targetOnSub ? textIn(` · ${a.target}`, f.targetPt) : 0);
  // post(A07 /㎡, D16 /㎢)
  for (const [name, value, post, width, columns] of [["A07", "3,826만원", "/㎡", 3.806, 3], ["D16", "3,066동", "/㎢", 3.125, 2]]) {
    const a = { value, post, kind: "number" };
    const f = keyFigureFit(mkIn({ question: "q", answer: a, stats: [] }, { width, columns }));
    near(f.postPt, f.targetPt, `${name} postPt`);
    assert.ok(answerW(f, a) <= width - 0.375 + 1e-6, `${name} 큰 답 폭 ${answerW(f, a)}`);
  }
  const d16 = { value: "3,066동", post: "/㎢", kind: "number" };
  const withPost = keyFigureFit(mkIn({ question: "q", answer: d16, stats: [] }, { width: 3.125, columns: 2 }));
  const noPost = keyFigureFit(mkIn({ question: "q", answer: { value: "3,066동", kind: "number" }, stats: [] }, { width: 3.125, columns: 2 }));
  assert.ok(withPost.valuePt < noPost.valuePt, "post가 숫자 크기에 든다");
  // 이름 답: 23 pt에서 시작해 맞을 때까지 줄인다(F1이 커도 카드 밖으로 나가지 않는다)
  const a12 = { value: "제3종일반주거지역", kind: "name" };
  near(keyFigureFit(mkIn({ question: "대지 용도지역", answer: a12, stats: [] }, { width: 3.125, columns: 2 })).valuePt, 23, "A12 ① 이름 답", 0.01);
  const longName = { pre: "대지는", value: "제3종일반주거지역 · 제2종일반주거지역 혼재", kind: "name" };
  for (const summaryPt of [13, 18, 24]) {
    for (const [answer, width] of [[a12, 3.125], [longName, 3.125], [longName, 2.4], [{ value: "6분", post: "/㎢㎢㎢㎢㎢㎢㎢㎢", kind: "number" }, 2.0]]) {
      const f = keyFigureFit(mkIn({ question: "q", answer, stats: [] }, { width, columns: 2, summaryPt }));
      assert.ok(answerW(f, answer) <= width - 0.375 + 1e-6, `summaryPt ${summaryPt} ${answer.value} 큰 답 폭 ${answerW(f, answer).toFixed(2)} > ${width - 0.375}`);
    }
  }
  // 숫자 24 pt 하한은 number에만 적용: 숫자는 넘치면 대상을 내리고 24 pt 아래로는 최후에만
  const num = keyFigureFit(mkIn({ question: "q", answer: { value: "12,345,678명", kind: "number" }, stats: [] }, { width: 2.4, columns: 2 }));
  assert.ok(num.valuePt < 24, "맞는 값이 24 pt 아래뿐이면 그래도 맞춘다");
  // maxHeight: 있으면 height <= maxHeight가 될 때까지 배율을 줄인다
  const fig = { question: "가장 가까운 지하철역", answer: { pre: "도보", value: "6분", target: "대치역", kind: "number" }, sub: "3호선 · 보행망 498m", stats: [{ value: "4분", label: "정류장까지 도보" }, { value: "5곳", label: "1km 안 지하철역" }], };
  const free = keyFigureFit(mkIn(fig, { columns: 2, width: 3.125 }));
  const squeezed = keyFigureFit(mkIn(fig, { columns: 2, width: 3.125, maxHeight: free.height * 0.8 }));
  assert.ok(squeezed.height <= free.height * 0.8 + 1e-6, `maxHeight ${squeezed.height} <= ${free.height * 0.8}`);
  assert.ok(squeezed.valuePt < free.valuePt && squeezed.statLabelPt < free.statLabelPt, "배율이 줄었다");
  assert.equal(keyFigureFit(mkIn(fig, { columns: 2, width: 3.125, maxHeight: free.height + 1 })).valuePt, free.valuePt, "넉넉하면 그대로");
  const bigF1 = keyFigureFit(mkIn(fig, { columns: 2, width: 3.125, summaryPt: 24 }));
  assert.ok(keyFigureFit(mkIn(fig, { columns: 2, width: 3.125, summaryPt: 24, maxHeight: free.height })).height <= free.height + 1e-6, "F1을 키워도 저장 높이에 다시 맞춘다");
  assert.ok(bigF1.height > free.height);
  // rows: 모든 칸이 카드 안, 맨 아래 + 안쪽 여백 = height
  const rects = (value, out = []) => {
    if (Array.isArray(value)) value.forEach((v) => rects(v, out));
    else if (value && typeof value === "object") {
      if (["x", "y", "w", "h"].every((key) => typeof value[key] === "number")) out.push(value);
      else Object.values(value).forEach((v) => rects(v, out));
    }
    return out;
  };
  const parts = Array.from({ length: 6 }, (_, i) => ({ label: `제${i}종일반주거지역`, share: 0.1 + i * 0.01, color: "#888", site: i === 1 }));
  const full = { ...fig, stats: [...fig.stats, { value: "106곳", label: "1km 안 정류장" }] };
  const cases = [
    mkIn(full, { columns: 2, width: 3.125, badges: ["추정", "일부 자료만 집계", "모델"], grades: ["철도 좋음", "버스 보통"], filterLine: "적용 필터: ".repeat(8) }),
    mkIn(full, { columns: 3, width: 3.806, grades: ["철도 좋음"] }),
    mkIn({ ...fig, parts, stats: [] }, { columns: 2, width: 3.125 }),
    mkIn({ question: "q", answer: { value: "제3종일반주거지역", kind: "name" }, stats: [] }, { columns: 2, width: 3.125, sentence: null }),
  ];
  for (const [i, c] of cases.entries()) {
    const f = keyFigureFit(c);
    const all = rects(f.rows);
    assert.ok(all.length >= 3, `case ${i} rows`);
    for (const r of all) assert.ok(r.x >= -1e-6 && r.y >= -1e-6 && r.x + r.w <= c.width + 1e-6 && r.y + r.h <= f.height + 1e-6 && r.w >= 0 && r.h >= 0, `case ${i} 칸이 카드 안 ${JSON.stringify(r)}`);
    const lowest = Math.max(...all.map((r) => r.y + r.h));
    near(lowest + 0.1667, f.height, `case ${i} 맨 아래 + 안쪽 여백 = height`);
    assert.ok(f.rows.question.y < f.rows.answer.y && f.rows.answer.y + f.rows.answer.h > f.rows.answerBaseline && f.rows.answerBaseline > f.rows.answer.y, `case ${i} 답 baseline`);
  }
  const f0 = keyFigureFit(cases[0]);
  // 질문(10자) + 배지 둘 + 「+1」은 ① 안쪽 폭 2.75 in를 넘으므로(Task 6 위험) 뒤에서부터 접는다.
  assert.deepEqual(f0.rows.badges.map((b) => b.text), ["추정", "+2"], "질문 줄과 함께 안쪽 폭에 들도록 배지를 접는다");
  assert.equal(f0.rows.grades.length, 2);
  assert.equal(f0.filterLines.length, 2, "긴 필터는 두 줄까지");
  assert.equal(f0.filterClipped, true);
  assert.match(f0.filterLines[1], /…$/);
  for (const l of f0.filterLines) assert.ok(textIn(l, f0.subPt) <= 3.125 - 0.375 + 1e-6, `필터 줄이 안쪽 폭에 든다: ${l}`);
  assert.ok(f0.rows.filter && f0.rows.divider && f0.rows.stats.length === 3 && f0.rows.sentence, "①은 필터·구분선·보조 숫자 3칸·해석 줄");
  near(f0.sentenceHeight, f0.sentenceLines.length * (f0.sentencePt / 72) * 1.25, "sentenceHeight");
  const f1 = keyFigureFit(cases[1]);
  assert.equal(f1.rows.sentence, null, "② 해석은 카드 밖");
  assert.ok(f1.sentenceHeight > 0);
  const pf = keyFigureFit(cases[2]);
  assert.equal(pf.rows.parts.length, 6);
  assert.equal(pf.rows.partsSegments.length, 6);
  near(pf.rows.partsSegments.reduce((s, seg) => s + seg.rect.w, 0), pf.rows.partsBar.w, "막대 조각 폭 합 = 막대 폭");
  assert.equal(pf.rows.stats.length, 0);
  assert.deepEqual(keyFigureFit(cases[3]).filterLines, []);
  assert.equal(keyFigureFit(cases[3]).filterClipped, false);
}

// ── Ruling 28: 필터 줄은 두 줄까지. 다 들어가면 잘리지 않고, 줄 수만큼 카드가 자라며, 다른 칸과 겹치지 않는다.
{
  const fig = { question: "반경 확인 세대", answer: { value: "21,549세대", kind: "number" }, sub: "세대 수를 알 수 없는 단지 3곳은 합계에서 제외", stats: [{ value: "1곳", label: "아파트 단지" }, { value: "2곳", label: "오피스텔" }] };
  const mk = (filterLine, extra = {}) => keyFigureFit({ figure: fig, badges: [], grades: ["철도 좋음"], filterLine, sentence: "해석 한 줄", width: 3.806, columns: 3, summaryPt: 13, ...extra });
  const none = mk(null);
  const shortLine = "적용 필터: 거리 900m";
  const twoLine = "적용 필터: 거리 900m 이하 · 정보 없음 포함 30건";
  const year = "적용 필터: 준공연도 2000년 이상 · 정보 없음 포함 12건";
  const long = "적용 필터: 준공연도 1990~2010년, 세대수 100~3000세대, 거리 1000m 이하, 층수 10~40층, 난방 지역난방 · 정보 없음 포함 12건";
  const one = mk(shortLine);
  const two = mk(twoLine);
  assert.deepEqual(one.filterLines, [shortLine], "짧은 필터는 한 줄");
  assert.equal(two.filterLines.length, 2, "거리 필터는 두 줄");
  assert.equal(two.filterLines.join(" "), twoLine, "거리 필터 전문이 두 줄 안에 있다");
  assert.equal(mk(year).filterLines.join(" "), year, "준공연도 필터 전문이 두 줄 안에 있다");
  assert.equal(two.filterClipped, false);
  near(two.rows.filter.h, 2 * (two.subPt / 72) * 1.25, "필터 칸 높이 = 두 줄");
  near(two.height - one.height, one.rows.filter.h, "한 줄 늘면 카드도 그만큼 는다");
  assert.ok(one.height > none.height, "필터 줄만큼 카드가 는다");
  const clipped = mk(long);
  assert.equal(clipped.filterClipped, true);
  assert.equal(clipped.filterLines.length, 2);
  assert.match(clipped.filterLines[1], /…$/);
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const f of [one, two, clipped, mk(long, { summaryPt: 24 }), mk(long, { columns: 2, width: 3.125 })]) {
    const r = f.rows;
    const others = [r.question, r.answer, r.sub, r.divider, r.sentence, ...r.grades.map((g) => g.rect), ...r.stats.map((s) => s.cell)].filter(Boolean);
    for (const o of others) assert.ok(!overlap(r.filter, o), `필터 칸이 다른 칸과 겹친다 ${JSON.stringify(o)}`);
    assert.ok(r.filter.x >= 0 && r.filter.y >= 0 && r.filter.y + r.filter.h <= f.height, "필터 칸은 카드 안");
  }
  // 저장 카드(maxHeight): 두 줄이 된 만큼 글자를 줄여 상한 안에 맞춘다
  const capped = mk(twoLine, { maxHeight: one.height });
  assert.ok(capped.height <= one.height + 1e-9 && capped.subPt < two.subPt, `상한 안으로 줄인다 ${capped.height} ≤ ${one.height}`);
  assert.equal(capped.filterLines.join(" "), twoLine, "줄인 뒤에도 전문");
}

// ── Ruling 30: 범례 판. 계산이 곧 그리는 값이다(항목 칸·주석 줄이 판 안, 폭 ≤ 5 in, 주석 ≤ 2줄, 높이 = 계산 합). 입력은 대치동 503 실제 항목·주석.
{
  const { legendLayout } = await import("../../lib/v2/report/report-page-frame.ts");
  const row = (label) => ({ label, color: "#888" });
  const site = { label: "대지", color: "#111", site: true };
  const table = {
    A10: { labels: ["㎡당 하위 20% · ~1,935.5만원/㎡", "㎡당 20~40% · 1,935.5~2,790.2만원/㎡", "㎡당 40~60% · 2,790.2~3,475.9만원/㎡", "㎡당 60~80% · 3,475.9~4,051.1만원/㎡", "㎡당 상위 20% · 4,051.1만원/㎡ 이상"], notes: ["색 구간은 반경 전체 기준"] },
    A11: { labels: ["전세 ㎡당 하위 20% · ~887.6만원/㎡", "전세 ㎡당 20~40% · 887.6~1,050.2만원/㎡", "전세 ㎡당 40~60% · 1,050.2~1,239.8만원/㎡", "전세 ㎡당 60~80% · 1,239.8~1,603만원/㎡", "전세 ㎡당 상위 20% · 1,603만원/㎡ 이상"], notes: [] },
    A08: { labels: ["정비사업 · 추진위", "정비사업 · 사업시행", "정비사업 · 미확인", "정비사업 · 정비계획", "정비사업 · 관리처분", "정비사업 · 준공", "정비사업 · 조합"], notes: [] },
    D01: { labels: [], notes: ["VWorld 항공영상 · 촬영시기 미확인"] },
    D10: { labels: ["OSM 녹지", "OSM 수계"], notes: ["항공사진 색 기반 수관 검출 · 재현율 미검증 · OSM 녹지 보조"] },
    도로: { labels: ["보행·자전거", "보조간선·집산", "국지", "간선 이상"], notes: ["도로 중심선 · 실제 폭·공식 도로대장 아님 · © OpenStreetMap contributors"] },
    D16: { labels: ["−5~5m", "5~20m", "20m 이상", "−20~−5m", "등고선"], notes: ["Copernicus GLO-30 표면모델(DSM, 30 m) · EGM2008 · 중심 상대고"] },
    도보권: { labels: ["도보 15분", "도보 10분", "도보 5분", "보행망"], notes: ["OSM 보행망 · 80 m/분 · 내부 제안 기준"] },
    S04: { labels: ["대지 일조"], notes: ["동지 일조시간 · 계절 레이어 · 건물·지형 그림자 반영"] },
    "아주 긴 주석": { labels: ["항목"], notes: ["아주 긴 주석 ".repeat(30).trim()] },
    "1열도 넘는 항목": { labels: ["아주 긴 항목 이름 ".repeat(12).trim(), "짧은 항목"], notes: [] },
  };
  const within = (r, f) => r.x >= -1e-6 && r.y >= -1e-6 && r.x + r.w <= f.size.w + 1e-6 && r.y + r.h <= f.size.h + 1e-6;
  // 항목 칸 안 글 자리: 칸 - 견본 - 간격 - 칸 테두리(1 px 양쪽). 실제 글꼴이 어림보다 넓은 만큼을 여유로 받는다.
  const room = (f, r) => r.w - f.iconW - f.iconGap;
  for (const scale of [1, 1.4]) for (const [name, { labels, notes }] of Object.entries(table)) {
    const f = legendLayout([...labels.map(row), site], notes, scale);
    const tag = `${name} 배율 ${scale}`;
    assert.ok(f.size.w <= 5 + 1e-6, `${tag} 판 폭 ${f.size.w} ≤ 5 in`);
    assert.equal(f.itemRects.length, labels.length + 1, `${tag} 항목 칸 수`);
    for (const r of [...f.itemRects, ...f.noteRects]) assert.ok(within(r, f), `${tag} 칸이 판 안 ${JSON.stringify(r)} / ${JSON.stringify(f.size)}`);
    f.noteLines.forEach((lines, i) => {
      assert.ok(lines.length >= 1 && lines.length <= 2, `${tag} 주석 줄 수 ${lines.length}`);
      for (const l of lines) assert.ok(textIn(l, f.notePt) <= f.noteRects[i].w + 1e-6, `${tag} 주석 줄이 칸 폭 안: ${l}`);
      near(f.noteRects[i].h, lines.length * f.noteH, `${tag} 주석 칸 높이 = 줄 수`);
      assert.equal(f.noteClipped[i], lines.join(" ") !== notes[i], `${tag} 주석 잘림 표시`);
      if (f.noteClipped[i]) assert.match(lines.at(-1), /…$/);
    });
    near(f.size.h, f.padding.top + f.rowHeights.reduce((sum, h) => sum + h, 0) + f.noteLines.reduce((sum, l) => sum + l.length * f.noteH, 0) + (notes.length ? f.noteGap : 0) + f.padding.bottom, `${tag} 높이 = 계산 합`);
    f.labelLines.forEach((lines, i) => {
      assert.ok(lines.length >= 1 && lines.length <= 2, `${tag} 항목 줄 수 ${lines.length}`);
      for (const l of lines) assert.ok(textIn(l, f.labelPt) * 1.1 + 0.05 * scale <= room(f, f.itemRects[i]) + 1e-6, `${tag} 항목 글이 칸 안: ${l}`);
      assert.ok(f.itemRects[i].h >= f.rowH + (lines.length - 1) * f.labelLineH - 1e-6, `${tag} 항목 칸 높이는 줄 수를 따른다`);
      assert.equal(f.labels[i], lines.join("\n"), `${tag} labels = 줄 합`);
      assert.equal(f.labelClipped[i], lines.at(-1).endsWith("…"), `${tag} 항목 잘림 표시`);
      if (!f.labelClipped[i]) assert.equal(lines.join(" ").replace(/ ·? ?/g, ""), [...labels, "대지"][i].replace(/ ·? ?/g, ""), `${tag} 접기만 하고 글은 그대로`);
    });
    for (let i = 0; i < f.itemRects.length; i++) for (let j = i + 1; j < f.itemRects.length; j++) assert.ok(!hit(f.itemRects[i], f.itemRects[j]), `${tag} 항목 칸 겹침`);
  }
  const at = (name, scale = 1) => legendLayout([...table[name].labels.map(row), site], table[name].notes, scale);
  // Ruling 31: 2열이 5 in를 넘으면 2열을 유지하고 항목 이름을 열 폭에 맞춰 최대 2줄로 접는다(` · ` 앞에서 먼저). A07·A08 범례.
  for (const name of ["A10", "A11", "A08"]) {
    const f = at(name);
    assert.equal(f.cols, 2, `${name} 2열 유지`);
    assert.ok(f.size.w <= 5 + 1e-6, `${name} 판 폭 ${f.size.w}`);
    assert.deepEqual(f.labelClipped, Array(f.items.length).fill(false), `${name} 접기만 하고 자르지 않는다`);
  }
  const a07 = at("A10");
  assert.deepEqual(a07.labelLines[0], ["㎡당 하위 20%", "~1,935.5만원/㎡"], "` · ` 앞에서 먼저 끊는다");
  assert.ok(a07.labelLines.some((lines) => lines.length === 2), "A07 항목은 접힌다");
  assert.equal(a07.labelLines.at(-1).length, 1, "대지는 한 줄");
  assert.ok(a07.rowHeights[0] > a07.rowH, "접힌 행 높이는 줄 수를 따른다");
  // 2줄로도 안 들어가는 항목이 있으면 그때만 1열로 내린다
  const unfoldable = legendLayout([...["아주긴이름".repeat(40), "가", "나", "다", "라"].map(row), site], [], 1);
  assert.equal(unfoldable.cols, 1, "접어도 안 되면 1열");
  assert.equal(unfoldable.labelClipped[0], true);
  // 판 폭의 뼈대는 항목이다: 도로 주석은 2.6 in로 접어 두 줄, 판이 주석 한 줄 길이로 벌어지지 않는다.
  const road = at("도로");
  assert.equal(road.noteLines[0].length, 2);
  assert.ok(road.size.w <= 2.6 + road.padding.left + road.padding.right + 1e-6, `도로 판 폭 ${road.size.w}`);
  // 항목이 넓으면 주석은 항목 폭으로 접고, 짧은 주석은 판을 2.6 in까지 벌리지 않는다.
  assert.equal(at("A10").noteLines[0].length, 1);
  const short = legendLayout([row("국지"), site], ["짧은 주석"], 1);
  assert.ok(short.size.w < 1.5, `짧은 주석 판 폭 ${short.size.w}`);
  assert.deepEqual(short.noteLines, [["짧은 주석"]]);
  // 항목 이름은 판 폭이 남아 있으면 자르지 않는다(D10·D16). 1열로도 넘는 항목만 …
  for (const name of ["D10", "D16"]) assert.ok(at(name).labelClipped.every((c) => !c), `${name} 항목은 잘리지 않는다`);
  const over = at("1열도 넘는 항목");
  assert.deepEqual(over.labelClipped, [true, false, false]);
  assert.match(over.labels[0], /…$/);
  assert.equal(at("아주 긴 주석").noteClipped[0], true);
  // 주석만 있는 쪽·아무것도 없는 입력
  assert.equal(legendLayout([], ["주석"], 1).itemRects.length, 0);
}

// ── Task 6 위험: 질문 줄과 배지 폭. 긴 배지가 카드 밖으로 나가거나 질문 칸을 덮으면 뒤에서부터 `+n`으로 접는다.
{
  const fig = { question: "가장 가까운 지하철역", answer: { value: "6분", kind: "number" }, stats: [] };
  for (const summaryPt of [13, 18, 24]) for (const width of [3.125, 3.806]) for (const badges of [["일부 자료만 집계", "미확인"], ["일부 자료만 집계", "미확인", "추정"], ["추정"]]) {
    const f = keyFigureFit({ figure: fig, badges, grades: [], filterLine: null, sentence: null, width, columns: 2, summaryPt });
    const tag = `pt ${summaryPt} 폭 ${width} 배지 ${badges.length}`;
    assert.ok(f.rows.question.w >= 0, `${tag} 질문 칸 폭 ≥ 0`);
    for (const b of f.rows.badges) {
      assert.ok(b.rect.x >= f.rows.question.x + f.rows.question.w - 1e-6, `${tag} 배지 ${b.text}가 질문 칸을 덮음`);
      assert.ok(b.rect.x + b.rect.w <= width - 0.1875 + 1e-6, `${tag} 배지 ${b.text}가 카드 오른쪽 안쪽 여백 밖`);
      assert.ok(b.rect.x >= 0, `${tag} 배지가 카드 왼쪽 밖`);
    }
    assert.equal(f.badgesShown.length + f.badgesMore, badges.length, `${tag} 접힌 수가 맞는다`);
  }
  // 넉넉한 폭에서는 접지 않는다
  const roomy = keyFigureFit({ figure: { ...fig, question: "지하철역" }, badges: ["추정", "미확인"], grades: [], filterLine: null, sentence: null, width: 3.806, columns: 2, summaryPt: 13 });
  assert.deepEqual(roomy.badgesShown, ["추정", "미확인"]);
  assert.equal(roomy.badgesMore, 0);
  // 질문+배지가 모자라면 접힌 만큼 +n 칩이 있다(배지 하나도 못 넣어도 +n은 남는다)
  const tight = keyFigureFit({ figure: fig, badges: ["일부 자료만 집계", "미확인", "추정"], grades: [], filterLine: null, sentence: null, width: 3.125, columns: 2, summaryPt: 24 });
  assert.ok(tight.badgesMore > 0 && tight.rows.badges.at(-1).text === `+${tight.badgesMore}`, "접힌 배지는 +n 칩");
}

// ── Ruling 24: 정직성 배지(첫 배지)는 기본 F1에서 접히지 않는다. 대신 질문이 말줄임을 받고, 접힌 글은 fit이 내놓는다.
{
  const mk = (question, badges, extra = {}) => keyFigureFit({ figure: { question, answer: { value: "6분", kind: "number" }, stats: [] }, badges, grades: [], filterLine: null, sentence: null, width: 3.125, columns: 2, summaryPt: 13, ...extra });
  for (const [question, badges] of [
    ["도보 10분 도달 면적", ["일부 자료만 집계", "미확인"]],
    ["주변 건물 높이 중앙값", ["일부 자료만 집계", "미확인"]],
    ["반경 구역·지구 교차면적", ["일부 자료만 집계"]],
    ["가장 가까운 지하철역", ["일부 자료만 집계", "미확인", "추정"]],
  ]) {
    const f = mk(question, badges);
    assert.equal(f.badgesShown[0], "일부 자료만 집계", `${question}: 첫 배지가 남는다`);
    assert.deepEqual(f.badgesFolded, badges.slice(f.badgesShown.length), "접힌 글 목록");
    assert.equal(f.badgesShown.length + f.badgesFolded.length, badges.length);
    assert.equal(f.rows.badges[0].text, "일부 자료만 집계");
    for (const b of f.rows.badges) assert.ok(b.rect.x >= f.rows.question.x + f.rows.question.w - 1e-6 && b.rect.x + b.rect.w <= 3.125 - 0.1875 + 1e-6, `${question}: 배지 ${b.text}가 질문 칸·안쪽 여백 안`);
    assert.ok(f.rows.question.w > 0.5, `${question}: 질문 칸이 남는다`);
    assert.equal(f.questionClipped, textIn(question, f.questionPt) > f.rows.question.w, "질문 말줄임 판정");
  }
  assert.equal(mk("반경 구역·지구 교차면적", ["일부 자료만 집계"]).questionClipped, true, "긴 질문은 말줄임을 받는다");
  assert.equal(mk("지하철역", ["일부 자료만 집계"]).questionClipped, false, "짧은 질문은 그대로");
  // 첫 배지가 안쪽 폭의 절반을 넘으면(F1 24 pt) 접는다
  const big = mk("가장 가까운 지하철역", ["일부 자료만 집계", "미확인"], { summaryPt: 24 });
  assert.equal(big.badgesShown.length, 0);
  assert.deepEqual(big.badgesFolded, ["일부 자료만 집계", "미확인"]);
}

// ── N4: 보조 숫자 이름은 fit이 줄을 미리 나눈다(화면·PPT가 같은 줄). 닫는 괄호 한 글자만 다음 줄로 넘어가지 않는다.
{
  const label = "높이 확인(원천+층수 추정)";
  const fig = { question: "건물 높이", answer: { value: "26.4m", kind: "number" }, stats: [{ value: "73%", label }, { value: "27%", label: "1층 가정 비율" }] };
  for (const [width, columns] of [[3.125, 2], [3.806, 3], [2.4, 2], [2.0, 2], [3.3, 3], [4.2, 3]]) {
    for (const summaryPt of [13, 11, 16]) {
      const f = keyFigureFit({ figure: fig, badges: [], grades: [], filterLine: null, sentence: null, width, columns, summaryPt });
      const lines = f.statLabelLines[0];
      assert.ok(lines.length >= 1 && lines.length <= 2, `${width}/${columns}/${summaryPt}: 이름은 최대 2줄`);
      const joined = lines.join("").replace(/…$/, "").replace(/ /g, "");
      assert.equal(joined, label.replace(/ /g, "").slice(0, joined.length), `${width}/${columns}/${summaryPt}: 줄을 이으면 앞부분 전문`);
      for (const line of lines) assert.ok(!/^[)\]」』,.%·:;!?]/.test(line), `${width}/${columns}/${summaryPt}: 닫는 기호로 줄이 시작 「${line}」`);
      for (const line of lines) assert.ok(textIn(line, f.statLabelPt) * 1.1 <= f.rows.stats[0].label.w + 1e-6, `${width}/${columns}/${summaryPt}: 줄이 칸 폭 안 「${line}」`);
      assert.equal(f.statLabelClipped[0], lines.at(-1).endsWith("…"), "잘림 표시 = 마지막 줄 …");
    }
  }
}

// ── M-8: fit이 질문·보조 숫자 값·구성 이름을 미리 자르고(…Text·…Clipped) 보조 줄·해석 줄의 잘림도 알린다. 화면·PPT는 그 글을 그린다.
{
  const longQ = "반경 안에서 지금 가장 가까운 지하철역과 그 역까지 걸어서 가는 데 걸리는 시간은 얼마인가";
  const fig = { question: longQ, answer: { value: "26.4m", kind: "number" }, sub: "원천 높이와 층수 추정을 함께 쓴 값이라 실제와 다를 수 있고 확인되지 않은 건물은 3 m 가정이 적용되었습니다 그래서 크게 다를 수 있습니다", stats: [{ value: "1,234,567,890,123,456,789만원", label: "값" }, { value: "73%", label: "비율" }] };
  const f = keyFigureFit({ figure: fig, badges: ["일부 자료만 집계"], grades: [], filterLine: null, sentence: "짧은 해석", width: 3.125, columns: 2, summaryPt: 13 });
  assert.equal(f.questionClipped, true);
  assert.ok(f.questionText.endsWith("…") && longQ.startsWith(f.questionText.slice(0, -1)), "질문은 …로 미리 자른다");
  assert.ok(textIn(f.questionText, f.questionPt) <= f.rows.question.w + 1e-6, "자른 질문이 칸 안");
  assert.equal(f.statValueClipped[0], true);
  assert.ok(f.statValueText[0].endsWith("…") && textIn(f.statValueText[0], f.statValuePt) * 1.1 <= f.rows.stats[0].value.w + 1e-6, "보조 숫자 값은 칸 안에서 …로 닫는다");
  assert.equal(f.statValueClipped[1], false);
  assert.equal(f.statValueText[1], "73%");
  assert.equal(f.subClipped, true, "보조 줄이 두 줄을 넘어 …로 닫혔다");
  assert.equal(f.subFull, fig.sub);
  assert.equal(f.sentenceClipped, false);
  const longSentence = keyFigureFit({ figure: fig, badges: [], grades: [], filterLine: null, sentence: "이 문장은 아주 길어서 세 줄에 다 들어가지 않습니다 ".repeat(8), width: 3.125, columns: 2, summaryPt: 13 });
  assert.equal(longSentence.sentenceClipped, true);
  assert.ok(longSentence.sentenceLines.at(-1).endsWith("…"));
  assert.equal(keyFigureFit({ figure: { question: "짧은 질문", answer: { value: "6분", kind: "number" }, stats: [{ value: "4분", label: "도보" }] }, badges: [], grades: [], filterLine: null, sentence: null, width: 3.125, columns: 2, summaryPt: 13 }).subClipped, false);
  // 구성 이름
  const zoneParts = [{ label: "제3종일반주거지역과 그 주변의 아주 긴 이름을 가진 지구단위계획구역", share: 60, color: "#F2C94C", site: true }, { label: "일반상업지역", share: 40, color: "#E2574C" }];
  const z = keyFigureFit({ figure: { question: "대지 용도지역", answer: { value: "제3종일반주거지역", kind: "name" }, stats: [{ value: "60.0%", label: "같은 용도지역" }, { value: "95.0%", label: "주거지역" }], parts: zoneParts }, badges: [], grades: [], filterLine: null, sentence: null, width: 3.125, columns: 2, summaryPt: 13 });
  assert.equal(z.rows.parts[0].labelClipped, true);
  assert.ok(z.rows.parts[0].labelText.endsWith("…") && textIn(z.rows.parts[0].labelText, z.partPt) * 1.1 <= z.rows.parts[0].label.w + 1e-6, "구성 이름은 칸 안에서 …로 닫는다");
  assert.equal(z.rows.parts[1].labelClipped, false);
  assert.equal(z.rows.parts[1].labelFull, "일반상업지역");
}

// ── 구성 막대(A12): 보조 숫자 칸 대신 큰 % + 두 줄 설명이 막대 위에 있다(Ruling 6)
{
  const parts = [{ label: "제3종일반주거지역", share: 50, color: "#F2C94C", site: true }, { label: "제2종일반주거지역", share: 24.9, color: "#F2C94C" }, { label: "일반상업지역", share: 5, color: "#E05A47" }];
  const fig = { question: "대지 용도지역", answer: { value: "제3종일반주거지역", kind: "name" }, stats: [{ value: "50.0%", label: "반경 1km 중 같은 용도지역" }, { value: "95.0%", label: "반경 1km 중 주거지역" }], parts };
  const f = keyFigureFit({ figure: fig, badges: [], grades: [], filterLine: null, sentence: null, width: 3.125, columns: 2, summaryPt: 13 });
  assert.ok(f.rows.lead, "lead 행");
  assert.equal(f.rows.lead.text, "50.0%");
  assert.deepEqual(f.rows.lead.lines, ["반경 1km 중 같은 용도지역", "주거지역 전체 95.0%"]);
  assert.equal(f.rows.stats.length, 0, "보조 숫자 칸은 없다");
  near(f.leadPt, 24, "큰 %는 시안 32 px(24 pt)");
  assert.ok(f.rows.lead.value.y + f.rows.lead.value.h <= f.rows.partsBar.y + 1e-6, "큰 %는 구성 막대 위");
  assert.ok(f.rows.lead.desc.x >= f.rows.lead.value.x + f.rows.lead.value.w, "설명은 큰 % 오른쪽");
  assert.ok(f.rows.lead.desc.x + f.rows.lead.desc.w <= 3.125 - 0.1875 + 1e-6, "설명이 카드 안");
  assert.equal(keyFigureFit({ figure: { ...fig, stats: [] }, badges: [], grades: [], filterLine: null, sentence: null, width: 3.125, columns: 2, summaryPt: 13 }).rows.lead, null, "보조 숫자가 없으면 lead도 없다");
}

console.log("report-page-layout ok");
