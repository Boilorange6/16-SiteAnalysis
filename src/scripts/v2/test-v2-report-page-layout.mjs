/** 보고서 장 기하(reportPageGeometry)와 핵심 숫자 카드 맞춤(keyFigureFit): 화면·PPT·그림·축척이 같은 값을 읽는 순수 함수. */
import assert from "node:assert/strict";

const { reportPageGeometry, frameChromeUnit } = await import("../../lib/v2/ui/report-page-layout.ts");
const { keyFigureFit } = await import("../../lib/v2/report/key-figure-fit.ts");

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
  const mid = keyFigureFit(mk({ figure: { ...a01, answer: { pre: "도보", value: "6분", target: "대치역", kind: "number" } }, width: 3.5, columns: 2 }));
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

console.log("report-page-layout ok");
