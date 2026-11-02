/** 보고서 장 기하(reportPageGeometry)와 핵심 숫자 카드 맞춤(keyFigureFit): 화면·PPT·그림·축척이 같은 값을 읽는 순수 함수. */
import assert from "node:assert/strict";

const { reportPageGeometry, frameChromeUnit, keyCardWidth } = await import("../../lib/v2/ui/report-page-layout.ts");
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
  assert.equal(keyFigureFit(mk({ sentence: "가나다 ".repeat(60) })).sentenceLines.length, 2);
  assert.match(keyFigureFit(mk({ sentence: "가나다 ".repeat(60) })).sentenceLines[1], /…$/);
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
  assert.equal(keyCardWidth("map-key", "wide", undefined, t4), 3.125);
  near(keyCardWidth("map-charts", "wide", undefined, t4), geo({ layout: "map-charts" }).column.key.w, "② 폭 = 열 폭");
  near(keyCardWidth("map-charts", "a4", undefined, t4), geo({ layout: "map-charts", format: "a4" }).column.key.w, "a4 ② 폭");
  near(keyCardWidth("map-key", "wide", { summary: p(5, 1.5, 3.4, 2.2) }, t4), 3.4, "저장 카드 폭을 따른다");
  assert.equal(keyCardWidth("map-key", "wide", { summary: p(0.3, 0.3, 3.4, 2.2) }, t4), 3.125, "겹치면 기본 폭");
  assert.equal(keyCardWidth("map-charts", "wide", { summary: p(5, 1.5, 3.4, 2.2) }, t4), keyCardWidth("map-charts", "wide", undefined, t4), "② 저장 summary 무시");
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
  assert.equal(f0.rows.badges.length, 3, "배지 2개 + +n");
  assert.equal(f0.rows.badges[2].text, "+1");
  assert.equal(f0.rows.grades.length, 2);
  assert.match(f0.filterText, /…$/);
  assert.ok(textIn(f0.filterText, f0.subPt) <= 3.125 - 0.375 + 1e-6, "필터 줄은 한 줄에 든다");
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
  assert.equal(keyFigureFit(cases[3]).filterText, null);
}

console.log("report-page-layout ok");
