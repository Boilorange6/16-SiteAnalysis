/** 보드 → PPT 보고서 테스트: 슬라이드 계획(장수·순서·표지/출처)과 실제 pptx XML(출처·기준일 줄, 금지어, 고정 문구). */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import JSZip from "jszip";

const { GODEOK_RESULTS, GODEOK_SUMMARY, RECOVERED } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { initBoard, boardReducer, reportPages } = await import("../../lib/v2/ui/board-state.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { sheetView } = await import("../../lib/v2/ui/sheet.ts");
const { buildReportPlan, reportFileName, sourcePageCountForViews } = await import("../../lib/v2/report/report-plan.ts");
const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");
const { SOURCE_NAMES } = await import("../../lib/v2/ui/tile-catalog.ts");
const { withLegacyTileState, withLegacyTileStates } = await import("./legacy-report-fixture.mjs");

const { complexCounts } = await import("../../lib/v2/report/report-plan.ts");
const counts = complexCounts(new Map(GODEOK_RESULTS.map((r) => [r.tileId, toTileView(r)])));
assert.deepEqual(counts, { "t-A05": 25, "t-A06": 25 }, "설명선 타일(A05·A06)만 단지·사업 수를 가진다");

const build = (results, board) =>
  buildReportPlan({
    summary: toSummaryView(GODEOK_SUMMARY, results),
    views: new Map(results.map((r) => [r.tileId, toTileView(r)])),
    board,
    analysisDate: "2026-09-30",
  });

let board = initBoard(GODEOK_RESULTS);
const allViews = new Map(GODEOK_RESULTS.map((r) => [r.tileId, toTileView(r)]));
assert.equal(sourcePageCountForViews([...allViews.values()]), 1, "fixture source rows fit one source slide");
const boards = [board];
board = withLegacyTileStates(board, [["t-A01", { included: false }], ["t-D04", { face: "both" }]]);
boards.push(board);
board = boardReducer(boardReducer(board, { type: "move", id: "t-A09", dir: -1 }), { type: "remove", id: "t-A12" });
boards.push(board);
boards.push(withLegacyTileStates(initBoard(GODEOK_RESULTS), [["t-S02", { included: true }], ["t-S03", { included: true }]])); // 상태 슬라이드 포함
boards.push(withLegacyTileState(initBoard(GODEOK_RESULTS), "t-D04", { face: "back" }));
for (const b of boards) {
  const plan = build(GODEOK_RESULTS, b);
  assert.equal(plan.length, reportPages(b, counts).pages);
  assert.equal(plan[0].kind, "cover");
  assert.equal(plan.at(-1).kind, "sources");
  assert.deepEqual(plan.map((p) => p.no), plan.map((_, i) => i + 1));
  const tileIds = plan.filter((p) => p.kind === "tile").map((p) => p.view.tileId);
  // A05는 기본 "상위 10" = 개요 + 설명표 1장 = 2장
  const expected = b.order.filter((id) => b.included[id]).flatMap((id) => (b.faces[id] === "both" || id === "t-A05" || id === "t-A06" ? [id, id] : [id]));
  assert.deepEqual(tileIds, expected); // 보드 순서 그대로, both는 연속 2장
}
// 순서 이동이 반영되고, both는 도판 → 구성비 순
const p2 = build(GODEOK_RESULTS, boards[2]);
const ids2 = p2.filter((p) => p.kind === "tile").map((p) => p.view.code);
assert.ok(ids2.indexOf("A09") < ids2.indexOf("A07") && !ids2.includes("A12") && !ids2.includes("A01"));
assert.deepEqual(p2.filter((p) => p.kind === "tile" && p.view.code === "D04").map((p) => p.body.face), ["front", "back"]);
// 출처 슬라이드는 포함된 타일의 원천만, 기준일 미확인도 표시
const src = p2.at(-1).rows;
assert.ok(src.some((r) => r.source === SOURCE_NAMES.kapt && r.asOf === "기준일 미확인"));
assert.ok(!src.some((r) => r.source === SOURCE_NAMES.land_price)); // A12 제외됨
assert.ok(src.every((r) => !/\b[A-Z]\d{2}\b/.test(r.tiles)), "출처 장의 사용 타일은 내부 코드가 아니라 타일 이름이다");
assert.equal(reportFileName("서울특별시 강동구 고덕동 123 외 2필지", "2026-09-30"), "사이트분석_서울특별시_강동구_고덕동_123_외_2필지_20260930.pptx");

// W2a: 보드에서 켜 둔 라벨만 일반 타일 슬라이드·조판 셀로 전달하고, A05/A06 설명선에는 고정 라벨을 넣지 않는다.
{
  let labelBoard = initBoard(GODEOK_RESULTS);
  labelBoard = boardReducer(labelBoard, { type: "toggleLabel", id: "t-D04", key: "bldg_2000s|4" });
  labelBoard = boardReducer(labelBoard, { type: "toggleLabel", id: "t-D04", key: "bldg_2010s|8" });
  labelBoard = boardReducer(labelBoard, { type: "toggleLabel", id: "t-A05", key: "apt|0" });
  const labelPlan = build(GODEOK_RESULTS, labelBoard);
  const d04Slides = labelPlan.filter((slide) => slide.kind === "tile" && slide.view.tileId === "t-D04");
  assert.ok(d04Slides.length > 0 && d04Slides.every((slide) => slide.pinnedKeys?.join(",") === "bldg_2000s|4,bldg_2010s|8"));
  assert.ok(labelPlan.filter((slide) => slide.kind === "tile" && slide.callout).every((slide) => !slide.pinnedKeys), "A05/A06 PPT 설명선에는 고정 라벨 없음");
  labelBoard = boardReducer(labelBoard, { type: "sheet", tiles: ["t-A01", "t-A03"], grid: "2x2" });
  labelBoard = boardReducer(labelBoard, { type: "toggleLabel", id: "t-A03", key: "bus_stop|0" });
  const sheetBaseViews = new Map(GODEOK_RESULTS.map((result) => [result.tileId, toTileView(result)]));
  const sheetSpec = labelBoard.sheets["sheet:1"];
  sheetBaseViews.set("sheet:1", sheetView("sheet:1", [sheetBaseViews.get("t-A01"), sheetBaseViews.get("t-A03")].filter(Boolean), sheetSpec.grid));
  const sheetPlan = buildReportPlan({ summary: toSummaryView(GODEOK_SUMMARY, GODEOK_RESULTS), views: sheetBaseViews, board: labelBoard, analysisDate: "2026-09-30" });
  const sheet = sheetPlan.find((slide) => slide.kind === "sheet" && slide.view.code === "SHEET");
  assert.ok(sheet?.cells.some((cell) => cell.view.tileId === "t-A03" && cell.pinnedKeys?.includes("bus_stop|0")), "조판 셀에도 켜 둔 라벨 전달");
}

// S01 카메라는 Board가 만든 뷰에 들어온 값을 보고서 계획과 동일하게 보존한다.
{
  const s01Result = structuredClone(GODEOK_RESULTS.find((r) => r.tileCode === "D04"));
  s01Result.tileId = "t-S01";
  s01Result.tileCode = "S01";
  s01Result.tileType = "simulation";
  s01Result.presentation = { ...s01Result.presentation, camera: { azimuthDeg: 315, elevationDeg: 35, radiusM: 1000 } };
  const s01View = toTileView(s01Result);
  const s01Board = initBoard([s01Result]);
  const s01Plan = buildReportPlan({ summary: toSummaryView(GODEOK_SUMMARY, [s01Result]), views: new Map([["t-S01", s01View]]), board: s01Board, analysisDate: "2026-09-30" });
  const s01Slide = s01Plan.find((p) => p.kind === "tile" && p.view.code === "S01");
  assert.ok(s01Slide?.mass);
  assert.equal(s01Slide.mass.camera.azimuthDeg, 315);
}

// 실제 렌더: 상태 슬라이드(S02 미제공·S03 실패)와 D04 두 면을 포함한 덱
const deckBoard = withLegacyTileStates(initBoard(GODEOK_RESULTS), [["t-S02", { included: true }], ["t-S03", { included: true }], ["t-D04", { face: "both" }]]);
const plan = build(GODEOK_RESULTS, deckBoard);
const bytes = await renderReportPptx(plan);
// 기본은 임시 폴더. 추적되는 견본(docs/design/p1c0/report-sample.pptx)은 V2_REPORT_SAMPLE_PATH로 지정할 때만 갱신한다.
const reportSamplePath = process.env.V2_REPORT_SAMPLE_PATH ?? join(tmpdir(), "v2-report-sample.pptx");
mkdirSync(dirname(reportSamplePath), { recursive: true });
writeFileSync(reportSamplePath, bytes);

const zip = await JSZip.loadAsync(bytes);
const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
assert.equal(names.length, plan.length);
const text = (xml) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join("|"); // 공백이 아닌 구분자: 텍스트 조각 경계가 "숫자 분" 오탐을 만들지 않게
// A05 필터 결과와 한 줄 문구가 보고서 계획·PPT까지 전달된다.
{
  const a05Result = GODEOK_RESULTS.find((result) => result.tileCode === "A05");
  const a05Board = initBoard([a05Result]);
  const a05View = toTileView(a05Result, null, null, { types: ["apt"], year: { min: 2010 } });
  const filteredPlan = buildReportPlan({
    summary: toSummaryView(GODEOK_SUMMARY, [a05Result]),
    views: new Map([[a05Result.tileId, a05View]]),
    board: a05Board,
    analysisDate: "2026-10-06",
  });
  const filteredSlides = filteredPlan.filter((slide) => slide.kind === "tile");
  assert.ok(filteredSlides.length > 0 && filteredSlides.every((slide) => slide.view.filterLine?.startsWith("적용 필터:")));
  assert.ok(filteredSlides.every((slide) => slide.footer.includes("적용 필터:") && slide.footer.includes("정보 없음 포함")));
  const filteredZip = await JSZip.loadAsync(await renderReportPptx(filteredPlan));
  const filteredXml = await filteredZip.file("ppt/slides/slide2.xml").async("string");
  assert.match(text(filteredXml), /적용 필터: .*정보 없음 포함/);
  assert.match(text(filteredXml), /필터 적용/);
}
for (const [i, n] of names.entries()) {
  const t = text(await zip.file(n).async("string"));
  assert.match(t, /출처|기준일/, `slide ${i + 1} 출처/기준일 줄 없음`);
  assert.ok(!t.includes("도보"), `slide ${i + 1} 도보`);
  assert.ok(!/\d\s*분/.test(t), `slide ${i + 1} 숫자+분`);
  assert.ok(!t.includes("종합"), `slide ${i + 1} 종합`);
  assert.ok(!/배정\s*[○ㅇ]/.test(t) && !/배정\s+\S+초/.test(t), `slide ${i + 1} 배정 확정 문구`);
  assert.match(t, new RegExp(`${i + 1} / ${names.length}`));
  if (plan[i].kind === "tile" && plan[i].view.code === "S02") {
    assert.ok(t.includes("그림자 추정 · 법적 판정 아님"));
    assert.ok(t.includes("법적 일조 판정을 포함하지 않습니다"));
  }
  if (plan[i].kind === "tile" && plan[i].view.code === "S03") assert.ok(t.includes("탐색용") && t.includes("계산 실패"));
}
const a01Index = plan.findIndex((p) => p.kind === "tile" && p.view.code === "A01");
if (a01Index >= 0) {
  const a01Xml = await zip.file(names[a01Index]).async("string");
  assert.doesNotMatch(text(a01Xml), /\bA01\b/, "PPT A01 제목에 내부 코드가 없다");
  const legendTextRows = [...a01Xml.matchAll(/<p:sp>[\s\S]*?name="GRP\|panel-legend\|범례\|plate"[\s\S]*?<a:off x="\d+" y="(\d+)"\s*\/>[\s\S]*?<a:t>([^<]+)<\/a:t>[\s\S]*?<\/p:sp>/g)]
    .map((match) => ({ y: Number(match[1]), text: match[2] }))
    .filter((row) => row.text.trim());
  assert.ok(legendTextRows.length >= 2, "PPT A01 범례에 두 개 이상의 텍스트 행이 있다");
  for (let i = 1; i < legendTextRows.length; i += 1) assert.ok(legendTextRows[i].y - legendTextRows[i - 1].y >= Math.round(0.29 * 914400), "PPT 범례 행 좌표가 겹치지 않는다");
}
// S02 상태 슬라이드도 고정 문구를 가진다 / S03 복구 결과(정상 슬라이드)도 탐색용
const s02 = plan.findIndex((p) => p.kind === "tile" && p.view.code === "S02");
assert.ok(s02 > 0 && plan[s02].body.kind === "state");
const rec = withLegacyTileState(initBoard([RECOVERED.S03]), "t-S03", { included: true });
const recPlan = build([RECOVERED.S03], rec);
const recText = text(await (await JSZip.loadAsync(await renderReportPptx(recPlan))).file("ppt/slides/slide2.xml").async("string"));
assert.ok(recText.includes("탐색용") && recText.includes("검증된 CFD 결과로 사용할 수 없습니다"));
// D04 두 면이 서로 다른 슬라이드: 도판(지도)엔 구성비 수치가 없고 구성비(전면 차트)엔 있다. 도판은 지도 전면.
const d04 = plan.map((p, i) => [p, i]).filter(([p]) => p.kind === "tile" && p.view.code === "D04");
assert.equal(d04.length, 2);
assert.ok(d04[0][0].map && !d04[1][0].map, "도판=지도 전면, 구성비=차트 전면(지도 없음)");
const [x0, x1] = await Promise.all(d04.map(([, i]) => zip.file(names[i]).async("string")));
assert.ok(!text(x0).includes("31%") && text(x1).includes("31%"));
// 지도 몰입형: 결과·상태 장 모두 전면 지도 자리가 있고 구성비 면만 예외 / 표지·출처 장도 지도 배경
for (const p of plan) {
  if (p.kind === "tile") assert.ok(p.map || (p.view.code === "D04" && p.body.face === "back"), `${p.view.code} 전면 지도`);
  else assert.ok(p.map, `${p.kind} 장 지도 배경`);
}
assert.ok(plan.filter((p) => p.kind === "tile" && p.body.kind === "state").every((p) => p.muted), "상태 장은 흐린 지도");

// ── 설명선 장: 개요 + 설명표, 편집 가능한 도형(단지별 그룹 callout-<id>), 확인필요, 모드별 장수, 빈 상태 ──
{
  const a05 = (mode) => {
    let b = withLegacyTileState(initBoard(GODEOK_RESULTS), "t-A05", { callout: mode });
    b = withLegacyTileStates(b, b.order.filter((id) => id !== "t-A05").map((id) => [id, { included: false }]));
    const p = build(GODEOK_RESULTS, b);
    assert.equal(p.length, reportPages(b, counts).pages, mode);
    return { b, p };
  };
  assert.deepEqual(["overview", "top10", "all"].map((m) => a05(m).p.length), [3, 4, 6], "표지 + A05 장(1 / 2 / 1+3) + 출처");
  const { p: plan5 } = a05("all");
  const co = plan5.filter((p) => p.kind === "tile");
  assert.deepEqual(co.map((p) => [p.callout.page, p.callout.pages]), [[0, 3], [1, 3], [2, 3], [3, 3]]);
  assert.ok(co.every((p) => p.map && p.map.features.length === 0), "지도 이미지에는 단지가 없다 (점은 도형)");
  const { mapKeyOf } = await import("../../lib/v2/report/report-plan.ts");
  assert.deepEqual(co.map(mapKeyOf), ["t-A05", "t-A05:cp", "t-A05:cp", "t-A05:cp"], "설명표 장은 지도 범위를 공유");
  const z = await JSZip.loadAsync(await renderReportPptx(plan5));
  const xmls = await Promise.all(Object.keys(z.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/))).map((n) => z.file(n).async("string")));
  const page1 = xmls[2]; // 표지, 개요, 설명표 1
  const groups = [...page1.matchAll(/<p:grpSp><p:nvGrpSpPr><p:cNvPr id="\d+" name="(콜아웃 [^"]*)"/g)].map((m) => m[1]);
  assert.equal(groups.length, 10, "설명표 장 = 단지 10곳이 각각 그룹");
  assert.ok(groups.some((g) => g.includes("고덕그라시움")) && groups[0].startsWith("콜아웃 "));
  assert.match(text(page1), /라벨 10개 \/ 전체 25단지/);
  assert.match(text(xmls[1]), /개요 · 전체 25단지/);
  assert.match(text(xmls[1]), /확인 세대\(아파트\)/);
  // 마지막 설명표 장(21–25)에는 값이 없는 단지의 "확인필요"가 나온다
  const last = text(xmls[4]);
  assert.match(last, /라벨 5개 \/ 전체 25단지/);
  assert.ok(text(xmls.slice(1, 5).join("")).includes("확인필요"));
  for (const x of xmls.slice(1, 5)) assert.match(text(x), /출처/);
  // 빈 상태: 단지 0 → 개요 1장만, 상태 판 문구
  const empty = structuredClone(GODEOK_RESULTS.find((r) => r.tileCode === "A05"));
  empty.presentation.features = [];
  empty.presentation.featuresTotal = 0;
  const eb = initBoard([empty]);
  const ev = new Map([[empty.tileId, toTileView(empty)]]);
  const ep = buildReportPlan({ summary: toSummaryView(GODEOK_SUMMARY, [empty]), views: ev, board: eb, analysisDate: "2026-09-30" });
  assert.equal(ep.filter((p) => p.kind === "tile").length, 1);
  assert.equal(ep.length, reportPages(eb, complexCounts(ev)).pages);
  const ez = await JSZip.loadAsync(await renderReportPptx(ep));
  assert.match(text(await ez.file("ppt/slides/slide2.xml").async("string")), /반경 안 확인된 단지 0/);
}

console.log(`v2 report tests passed (${plan.length} slides in sample deck)`);
