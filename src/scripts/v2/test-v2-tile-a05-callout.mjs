/** 설명선 배치: 좌우 배정·넘침, 칸 안 순서, 무교차(속성 테스트 200건), 간격, 번호=순위, 페이지, 확인필요, 장수 계산 */
import assert from "node:assert/strict";

const C = await import("../../lib/v2/ui/callout-layout.ts");
const O = await import("../../lib/v2/ui/overlay-layout.ts");

const feat = (o) => ({ layer: "apt", lng: 127, lat: 37, ...o });

// ── 번호 = 세대수 순위 (미상은 뒤, 같으면 가까운 순), id 결정적 ──
{
  const list = C.rankComplexes([
    feat({ name: "가", households: 300, distanceM: 500 }),
    feat({ name: "나", households: null, distanceM: 100 }),
    feat({ name: "다", households: 900, distanceM: 800 }),
    feat({ name: "라", households: 300, distanceM: 200 }),
    feat({ name: "마", weight: 50, households: undefined }),
  ]);
  assert.deepEqual(list.map((c) => c.name), ["다", "라", "가", "마", "나"]);
  assert.deepEqual(list.map((c) => c.rank), [1, 2, 3, 4, 5]);
  assert.equal(list[3].households, 50, "households가 없으면 weight");
  assert.deepEqual(C.rankComplexes([feat({ name: "x" }), feat({ name: "y" })]).map((c) => c.id), ["c1", "c2"]);
  const dupKeys = C.rankComplexes([feat({ name: "같은" }), feat({ name: "같은" }), feat({ name: "같은" })]).map((c) => c.key);
  assert.equal(new Set(dupKeys).size, 3, "같은 층·좌표·이름이 여러 건이어도 키는 겹치지 않는다");
  const sortable = C.rankComplexes([
    feat({ name: "연식", households: 100, approvalYear: 1990, floorsMax: 12, distanceM: 100 }),
    feat({ name: "최신", households: 50, approvalYear: 2020, floorsMax: 30, distanceM: 200 }),
    feat({ name: "미상", households: 900, approvalYear: null, floorsMax: null, distanceM: 50 }),
  ]);
  assert.deepEqual(C.sortComplexes(sortable, "year").map((c) => c.name), ["최신", "연식", "미상"], "준공연대는 최신 먼저·미상 뒤");
  assert.deepEqual(C.sortComplexes(sortable, "households").map((c) => c.name), ["미상", "연식", "최신"], "세대수는 큰 값 먼저");
  assert.deepEqual(C.sortComplexes(sortable, "floors").map((c) => c.name), ["최신", "연식", "미상"], "최고층수는 큰 값 먼저·미상 뒤");
}

// ── 점: 색 = 준공 연대(D04 팔레트), 크기 = √세대수 ──
{
  assert.deepEqual([1970, 1979, 1980, 1995, 2000, 2015, 2020, null].map(C.decadeLayer), ["bldg_pre1980", "bldg_pre1980", "bldg_1980s", "bldg_1990s", "bldg_2000s", "bldg_2010s", "bldg_2020s", "bldg_unknown"]);
  assert.equal(C.dotRadius(1000, 1000, 8, 15), 15);
  assert.equal(C.dotRadius(250, 1000, 8, 16), 12, "√(1/4)=1/2");
  assert.equal(C.dotRadius(null, 1000, 8, 15), 8);
  assert.equal(C.inkOn("#5b2a12"), "#ffffff");
  assert.equal(C.inkOn("#f7d76a"), "#16181d");
  assert.deepEqual(C.STOCK_LEGEND.items.map((item) => item.label), [
    "1970년대 이전",
    "1980년대",
    "1990년대",
    "2000년대",
    "2010년대",
    "2020년 이후",
    "미상",
  ], "준공 연대 범례는 의미가 끊기지 않는 실제 연대 문구를 사용");
}

// ── 카드 행: 타입 행을 포함하고, 값 없으면 확인필요, 주차는 있을 때만 추가 ──
{
  const [c] = C.rankComplexes([feat({ name: "A", households: 1234, approvalYear: 1998, distanceM: 420, floorsMax: 25, buildingCount: 8 })]);
  const rows = C.cardRows(c, 2026);
  assert.deepEqual(rows.map((r) => r.label), ["세대수", "타입", "준공", "직선거리", "층·동"]);
  assert.deepEqual(rows.map((r) => r.value), ["1,234세대", "타입 미확인", "1998년 · 28년차", "420m", "최고 25층 · 8동"]);
  assert.equal(C.calloutHoverText(c), "A · 1,234세대 · 1998년 · 최고 25층", "A05 점 hover 요약");
  assert.equal(rows[1].unitType, true);
  assert.equal(rows.filter((r) => r.missing).length, 1);
  const [e] = C.rankComplexes([feat({})]);
  const er = C.cardRows(e, 2026);
  assert.equal(er.length, 5);
  assert.deepEqual(er.map((r) => r.value), ["확인필요", "타입 미확인", "확인필요", "확인필요", "확인필요"]);
  assert.equal(er.filter((r) => r.missing).length, 5, "값 없음 → 확인필요");
  assert.equal(C.cardName(e), "이름 확인필요");
  const part = C.cardRows(C.rankComplexes([feat({ floorsMax: 12 })])[0], 2026)[4];
  assert.equal(part.value, "최고 12층 · 동 확인필요");
  const [p] = C.rankComplexes([feat({ parking: 900 })]);
  assert.equal(C.cardRows(p, 2026).length, 6);
  assert.equal(C.rowsFor([c]), 5);
  assert.equal(C.rowsFor([c, p]), 6);
  // 요약: 확인 세대 합계·준공 중앙값(하위 중앙)
  const s = C.summarize(C.rankComplexes([feat({ households: 100, approvalYear: 1990 }), feat({ households: 200, approvalYear: 2000 }), feat({ approvalYear: 2010 }), feat({}), feat({ layer: "officetel", households: 500 })]));
  assert.deepEqual(s, { count: 5, apartments: 4, households: 300, householdsKnown: 2, medianYear: 2000 }, "오피스텔 호실은 세대 합계에 넣지 않는다");
  assert.equal(C.cardRows(C.rankComplexes([feat({ layer: "officetel", households: 500 })])[0], 2026)[0].value, "500호");
  const [typed] = C.rankComplexes([feat({ unitTypes: [{ typeM2: 84, units: 2840 }, { typeM2: 59, units: 1210 }, { typeM2: 114, units: 520 }, { typeM2: 49, units: 10 }, { typeM2: 74, units: 200 }] })]);
  assert.equal(C.cardRows(typed, 2026)[1].value, "59㎡ 1,210 · 84㎡ 2,840 · 114㎡ 520 외 2타입");
  assert.equal(C.summarize([]).medianYear, null);
}

// ── 보고서 범례·라벨 계약: 숨김/순서/placement와 A05 도형 배율 ──
{
  const { GODEOK_RESULTS } = await import("../../lib/v2/ui/fixtures/godeok.ts");
  const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
  const { defaultFrame } = await import("../../lib/v2/report/report-doc.ts");
  const { a05ReportModule } = await import("../../lib/v2/tile/a05/report.ts");
  const model = toTileView(GODEOK_RESULTS.find((result) => result.tileCode === "A05")).callout;
  assert.ok(model, "A05 콜아웃 모델");
  const hiddenLegend = model.legend.items[0].label;
  const orderedLegend = model.legend.items[2].label;
  const entries = O.calloutLegendEntries(model, { hidden: [hiddenLegend], order: [orderedLegend], placement: "below" });
  assert.equal(entries[0].text, model.legend.title);
  assert.equal(entries[1].text, orderedLegend, "콜아웃 범례 순서 계약");
  assert.equal(entries.some((entry) => entry.text === hiddenLegend), false, "콜아웃 범례 숨김 계약");
  assert.deepEqual(O.calloutLegendEntries(model, { placement: "hidden" }), [], "placement hidden이면 콜아웃 범례 없음");
  const baseLegendLayout = O.slideCalloutLegendLayout([{ text: "범례" }], 0, 1, 4, 1);
  const scaledLegendLayout = O.slideCalloutLegendLayout([{ text: "범례" }], 0, 1, 4, 1.4);
  assert.ok(scaledLegendLayout.rect.w > baseLegendLayout.rect.w, "범례 글자 배율이 폭 계산에도 반영");

  const capture = (style = {}, framePatch = {}, calloutPatch = {}) => {
    const shapes = [];
    const texts = [];
    const slide = {
      addShape: (kind, options) => shapes.push({ kind, options }),
      addText: (value, options) => texts.push({ value, options }),
    };
    const frame = { ...defaultFrame(), ...framePatch, legend: { ...defaultFrame().legend, ...(framePatch.legend ?? {}) } };
    a05ReportModule.report.render({
      slide,
      part: "page",
      planned: {
        kind: "tile",
        style,
        callout: { model, page: 1, pages: C.calloutReportPages("all", model.complexes.length), ...calloutPatch },
        page: { kind: "tile", frame },
      },
    });
    return { shapes, texts };
  };
  const base = capture();
  const scaled = capture({ fontSizes: { legend: 14, labels: 14 } });
  const baseLegendText = base.texts.find((item) => item.options.objectName?.includes("panel-callout-legend"));
  const scaledLegendText = scaled.texts.find((item) => item.options.objectName?.includes("panel-callout-legend"));
  assert.equal(baseLegendText.options.fontSize, 9, "기본 범례 글자 크기는 기존 9pt");
  assert.equal(scaledLegendText.options.fontSize, 12.6, "범례 14pt는 기존 설명선 기준의 1.4배");
  const baseCardNumber = base.texts.find((item) => item.options.objectName?.endsWith("|card-no"));
  const scaledCardNumber = scaled.texts.find((item) => item.options.objectName?.endsWith("|card-no"));
  const baseDotNumber = base.texts.find((item) => item.options.objectName?.endsWith("|dot-no"));
  const scaledDotNumber = scaled.texts.find((item) => item.options.objectName?.endsWith("|dot-no"));
  assert.equal(baseCardNumber.options.fontSize, 8, "기본 카드 번호 글자 크기는 기존 8pt");
  assert.ok(scaledCardNumber.options.fontSize > baseCardNumber.options.fontSize, "labels 배율이 카드 글자에 반영");
  assert.ok(scaledDotNumber.options.fontSize > baseDotNumber.options.fontSize, "labels 배율이 번호 점 글자에 반영");
  const hMax = Math.max(...model.complexes.map((complex) => complex.households ?? 0));
  const shownKeys = [model.complexes[2].key, model.complexes[0].key];
  const selected = capture({}, {}, { shownKeys });
  const selectedCards = selected.shapes.filter((item) => item.options.objectName?.endsWith("|card"));
  assert.equal(selectedCards.length, 2, "shownKeys만 카드로 그린다");
  assert.ok(selectedCards[0].options.objectName.includes(encodeURIComponent(shownKeys[0])), "shownKeys 배열 순서가 첫 카드 순서가 된다");
  assert.deepEqual(selected.texts.filter((item) => item.options.objectName?.endsWith("|card-no")).map((item) => item.value), ["1", "2"], "shownKeys 순서대로 카드 번호를 1부터 다시 매긴다");
  const mini = selected.shapes.filter((item) => item.options.objectName?.endsWith("|mini"));
  assert.equal(mini.length, model.complexes.length - shownKeys.length, "나머지는 작은 점으로 유지한다");
  assert.ok(mini.every((item) => item.options.objectName.includes("callout-key:")), "작은 점에도 안정 키 태그가 있다");
  const blank = capture({}, {}, { shownKeys: [] });
  assert.equal(blank.shapes.some((item) => item.options.objectName?.endsWith("|card")), false, "shownKeys=[]는 카드 없는 빈 장");
  assert.equal(blank.shapes.filter((item) => item.options.objectName?.endsWith("|mini")).length, model.complexes.length, "빈 장은 모든 단지를 작은 점으로 둔다");
  const overview = [];
  const overviewSlide = { addShape: (kind, options) => overview.push({ kind, options }), addText: (value, options) => overview.push({ value, options }) };
  a05ReportModule.report.render({ slide: overviewSlide, part: "overview", planned: { kind: "tile", style: {}, callout: { model, page: 0, pages: 2 } } });
  assert.equal(overview.some((item) => item.options?.objectName?.endsWith("|dot-no")), false, "개요 점에는 번호를 쓰지 않는다");
  const overviewDotShape = overview.find((item) => item.options?.objectName?.endsWith("|dot"));
  assert.equal(overviewDotShape.options.w / 2, C.dotRadius(model.complexes[0].households, hMax, C.INCH.rMin / 2, C.INCH.rMax / 2), "개요 점 반지름은 설명 장의 절반");
  const detailDotShape = base.shapes.find((item) => item.options.objectName?.includes(C.calloutKeyTag(model.complexes[0].key)) && item.options.objectName?.endsWith("|dot"));
  assert.equal(detailDotShape.options.w / 2, C.dotRadius(model.complexes[0].households, hMax, C.INCH.rMin, C.INCH.rMax), "설명 장 번호 점 반지름은 유지");
  const continued = capture({}, {}, { shownKeys, numberStart: 9 });
  assert.deepEqual(continued.texts.filter((item) => item.options.objectName?.endsWith("|card-no")).map((item) => item.value), ["9", "10"], "numberStart가 카드 번호에 이어진다");
  const hiddenLegendRender = capture({}, { legend: { placement: "hidden" } });
  assert.equal(hiddenLegendRender.shapes.some((item) => item.options.objectName?.includes("panel-callout-legend")), false, "범례 placement hidden은 PPT 도형도 숨김");
}

// ── 페이지: 10단지씩, 제목 문구, 보고서 장수 ──
{
  const all = C.rankComplexes(Array.from({ length: 25 }, (_, i) => feat({ name: `n${i}`, households: 1000 - i })));
  assert.equal(C.pageCount(25), 3);
  assert.deepEqual(C.pageItems(all, 3).map((c) => c.rank), [21, 22, 23, 24, 25]);
  assert.deepEqual(C.calloutPageItems(all, 3).map((c) => c.rank), [21, 22, 23, 24, 25], "옛 설명 장 번호는 이중으로 밀지 않는다");
  const continuedKeys = all.slice(8, 12).map((complex) => complex.key);
  assert.deepEqual(C.calloutPageItems(all, 2, continuedKeys, 9).map((c) => c.rank), [9, 10, 11, 12]);
  assert.equal(C.calloutPageTitleTail(all, 2, "단지", continuedKeys, 9), "9–12번 / 전체 25단지");
  assert.equal(C.calloutPageTitleTail(all, 2, "단지", [], 9), "라벨 0개 / 전체 25단지");
  assert.equal(C.pageRange(1, 25), "세대수 상위 1–10 / 전체 25단지");
  assert.equal(C.pageRange(3, 25), "세대수 상위 21–25 / 전체 25단지");
  assert.deepEqual([C.calloutReportPages("overview", 25), C.calloutReportPages("top10", 25), C.calloutReportPages("all", 25), C.calloutReportPages("all", 10), C.calloutReportPages("top10", 0), C.calloutReportPages("all", 0)], [1, 2, 4, 2, 1, 1]);
}

// ── 프레임: 두 칸 사이에 반경 원이 들어가고 같은 프레임이면 지도 범위가 같다 ──
const spec = (o = {}) => ({ W: 1200, H: 800, m: C.PX, edge: 12, top: 96, bottom: 764, perSide: 5, rows: 4, variant: "full", ...o });
{
  const f = C.calloutFrame(spec());
  assert.ok(f.left.x1 < f.right.x0);
  assert.ok(f.centerX - f.diameter / 2 >= f.left.x1 + f.m.stub, "원이 왼쪽 칸 꺾임점 안쪽");
  assert.ok(f.centerX + f.diameter / 2 <= f.right.x0 - f.m.stub, "원이 오른쪽 칸 꺾임점 안쪽");
  assert.ok(f.fill <= 0.8 + 1e-9);
  const g = C.calloutFrame(spec({ rightInset: 372 }));
  assert.equal(g.right.x1, 1200 - 372 - 12, "정보 판만큼 오른쪽 칸이 안쪽으로");
  assert.ok(g.siteX < f.siteX);
  assert.deepEqual([C.calloutFrame(spec()).fill, C.calloutFrame(spec()).siteX], [f.fill, f.siteX], "페이지가 달라도 같은 프레임 = 같은 범위");
}

// ── 좌우 배정 · 넘침은 중심에서 가까운 것부터 반대쪽 ──
{
  const f = C.calloutFrame(spec({ perSide: 2 }));
  const cx = f.centerX;
  const pts = [
    { id: "a", x: cx - 200, y: 300 },
    { id: "b", x: cx - 120, y: 400 },
    { id: "c", x: cx - 20, y: 500 },
    { id: "d", x: cx + 150, y: 350 },
  ];
  const { placed, overflow } = C.layoutCallouts(f, pts);
  assert.deepEqual(overflow, []);
  const side = Object.fromEntries(placed.map((p) => [p.id, p.side]));
  assert.deepEqual(side, { a: "L", b: "L", c: "R", d: "R" }, "왼쪽이 넘쳐 중심에 가장 가까운 c가 오른쪽으로");
  const only = C.layoutCallouts(C.calloutFrame(spec({ perSide: 5 })), pts.slice(0, 3));
  assert.deepEqual(only.placed.map((p) => p.side), ["L", "L", "L"], "여유가 있으면 자기 쪽");
  // 칸 용량을 넘는 점은 overflow로 돌려준다
  const many = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, x: cx - 100 + i, y: 300 + i * 10 }));
  const over = C.layoutCallouts(C.calloutFrame(spec({ perSide: 2 })), many);
  assert.equal(over.placed.length, 4);
  assert.equal(over.overflow.length, 2);
}

// ── 칸 안 순서 = 점 세로 순서 (점이 같은 세로줄에 있으면 교환 없이 그대로) ──
{
  const f = C.calloutFrame(spec());
  const x = f.centerX - 150;
  const pts = [{ id: "c", x, y: 500 }, { id: "a", x, y: 200 }, { id: "b", x, y: 350 }];
  const { placed } = C.layoutCallouts(f, pts);
  const order = placed.filter((p) => p.side === "L").sort((p, q) => p.y - q.y).map((p) => p.id);
  assert.deepEqual(order, ["a", "b", "c"]);
  // 카드가 점 높이에 가깝게: 겹치지 않을 때는 점 높이에 중심을 맞춘다
  const a = placed.find((p) => p.id === "a");
  assert.ok(Math.abs(a.y + f.cardH / 2 - 200) < 1e-6);
}

// ── 칸 넘침 시 최소 간격을 지키고 칸 안에 들어온다 ──
{
  const f = C.calloutFrame(spec());
  const x = f.centerX - 100;
  const pts = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, x, y: 780 + i })); // 모두 맨 아래 근처
  const { placed } = C.layoutCallouts(f, pts);
  const ys = placed.map((p) => p.y).sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= f.cardH + f.m.gap - 1e-9, "최소 간격");
  assert.ok(ys[0] >= f.left.top - 1e-9 && ys[4] + f.cardH <= f.left.bottom + 1e-9, "칸 안");
}

// ── 속성 테스트: 무작위 200 배치 → 같은 칸 지시선 교차 0, 카드 겹침 0, 칸 밖 0, 전부 배치 ──
{
  let seed = 20260930;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let ran = 0;
  let naiveCross = 0;
  for (let t = 0; t < 200; t++) {
    const W = 320 + Math.floor(rnd() * 1300);
    const H = 300 + Math.floor(rnd() * 700);
    const variant = rnd() < 0.3 ? "compact" : "full";
    const f = C.calloutFrame({ W, H, m: C.PX, edge: 12, top: 58 + rnd() * 50, bottom: H - 36, leftBottom: rnd() < 0.4 ? H - 36 - 40 : undefined, rightInset: rnd() < 0.5 ? 372 : 0, perSide: 3 + Math.floor(rnd() * 3), rows: rnd() < 0.2 ? 5 : 4, variant });
    const cap = C.capacityOf(f.left, f) + C.capacityOf(f.right, f);
    const n = Math.min(cap, 1 + Math.floor(rnd() * 12));
    const lo = f.left.x1 + f.m.stub + f.m.stub * 0.6;
    const hi = f.right.x0 - f.m.stub - f.m.stub * 0.6;
    if (hi <= lo) continue;
    const clustered = rnd() < 0.3;
    const pts = Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      x: lo + rnd() * (hi - lo),
      y: clustered ? H * 0.5 + (rnd() - 0.5) * 60 : H * 0.1 + rnd() * H * 0.8,
    }));
    const { placed, overflow } = C.layoutCallouts(f, pts);
    assert.deepEqual(overflow, [], `#${t} 용량 안: ${n}/${cap}`);
    assert.equal(placed.length, n);
    assert.equal(new Set(placed.map((p) => p.id)).size, n, "중복 배치 없음");
    assert.equal(C.countCrossings(placed), 0, `#${t} 같은 칸 지시선 교차 0`);
    for (const side of ["L", "R"]) {
      const col = side === "L" ? f.left : f.right;
      const cs = placed.filter((p) => p.side === side).sort((a, b) => a.y - b.y);
      for (let i = 0; i < cs.length; i++) {
        assert.ok(cs[i].y >= col.top - 1e-6 && cs[i].y + f.cardH <= col.bottom + 1e-6, `#${t} 카드가 칸 안`);
        assert.ok(cs[i].x === col.x0);
        if (i) assert.ok(cs[i].y - cs[i - 1].y >= f.cardH + f.m.gap - 1e-6, `#${t} 카드 겹침 없음`);
      }
    }
    ran += 1;
    // 세로 순서만으로 놓았다면 교차했을 칸 수 (교환이 실제로 일했는지 확인)
    for (const side of ["L", "R"]) {
      const col = side === "L" ? f.left : f.right;
      const arr = placed.filter((p) => p.side === side).map((p) => ({ dot: p.dot })).sort((a, b) => a.dot[1] - b.dot[1]);
      const tops = C.stackTops(arr.map((p) => p.dot[1]), f.cardH, f.m.gap, col.top, col.bottom);
      const kx = side === "L" ? col.x1 + f.m.stub : col.x0 - f.m.stub;
      const segs = arr.map((p, i) => [p.dot, [kx, tops[i] + f.cardH / 2]]);
      if (segs.some((a, i) => segs.slice(i + 1).some((b) => C.segCross(a[0], a[1], b[0], b[1])))) naiveCross += 1;
    }
  }
  assert.ok(ran >= 150, `속성 테스트 실행 수 ${ran}`);
  assert.ok(naiveCross > 0, "세로 순서만으로는 교차하는 배치가 있고, 그것도 풀렸다");
}

// ── 교환이 필요한 배치: 점 x가 크게 다르면 세로 순서만으로는 교차한다 → 풀린다 ──
{
  const f = C.calloutFrame(spec());
  const kx = f.left.x1 + f.m.stub;
  const A = { id: "A", x: f.centerX - 20, y: 300 }; // 멀리(오른쪽) 위
  const B = { id: "B", x: kx + 60, y: 310 }; // 가까이 아래
  const filler = [1, 2, 3].map((i) => ({ id: `f${i}`, x: kx + 80, y: 300 + i * 4 }));
  const { placed } = C.layoutCallouts(f, [A, B, ...filler]);
  assert.equal(C.countCrossings(placed), 0);
}

console.log("callout layout ok");
