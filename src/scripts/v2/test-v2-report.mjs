/** 보드 → PPT 보고서 테스트: 슬라이드 계획(장수·순서·표지/출처)과 실제 pptx XML(출처·기준일 줄, 금지어, 고정 문구). */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import JSZip from "jszip";

const { GODEOK_RESULTS, GODEOK_SUMMARY, RECOVERED } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { initBoard, boardReducer, reportPages } = await import("../../lib/v2/ui/board-state.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { buildReportPlan, reportFileName } = await import("../../lib/v2/report/report-plan.ts");
const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");

const build = (results, board) =>
  buildReportPlan({
    summary: toSummaryView(GODEOK_SUMMARY, results),
    views: new Map(results.map((r) => [r.tileId, toTileView(r)])),
    board,
    analysisDate: "2026-09-30",
  });

let board = initBoard(GODEOK_RESULTS);
const boards = [board];
board = boardReducer(board, { type: "include", id: "t-A01", value: false });
board = boardReducer(board, { type: "face", id: "t-D04", face: "both" });
boards.push(board);
board = boardReducer(boardReducer(board, { type: "move", id: "t-A09", dir: -1 }), { type: "remove", id: "t-A12" });
boards.push(board);
boards.push(boardReducer(boardReducer(initBoard(GODEOK_RESULTS), { type: "include", id: "t-S02", value: true }), { type: "include", id: "t-S03", value: true })); // 상태 슬라이드 포함
boards.push(boardReducer(initBoard(GODEOK_RESULTS), { type: "face", id: "t-D04", face: "back" }));
for (const b of boards) {
  const plan = build(GODEOK_RESULTS, b);
  assert.equal(plan.length, reportPages(b).pages);
  assert.equal(plan[0].kind, "cover");
  assert.equal(plan.at(-1).kind, "sources");
  assert.deepEqual(plan.map((p) => p.no), plan.map((_, i) => i + 1));
  const tileIds = plan.filter((p) => p.kind === "tile").map((p) => p.view.tileId);
  const expected = b.order.filter((id) => b.included[id]).flatMap((id) => (b.faces[id] === "both" ? [id, id] : [id]));
  assert.deepEqual(tileIds, expected); // 보드 순서 그대로, both는 연속 2장
}
// 순서 이동이 반영되고, both는 도판 → 구성비 순
const p2 = build(GODEOK_RESULTS, boards[2]);
const ids2 = p2.filter((p) => p.kind === "tile").map((p) => p.view.code);
assert.ok(ids2.indexOf("A09") < ids2.indexOf("A07") && !ids2.includes("A12") && !ids2.includes("A01"));
assert.deepEqual(p2.filter((p) => p.kind === "tile" && p.view.code === "D04").map((p) => p.body.face), ["front", "back"]);
// 출처 슬라이드는 포함된 타일의 원천만, 기준일 미확인도 표시
const src = p2.at(-1).rows;
assert.ok(src.some((r) => r.source === "kapt" && r.asOf === "기준일 미확인"));
assert.ok(!src.some((r) => r.source === "land_price")); // A12 제외됨
assert.equal(reportFileName("서울특별시 강동구 고덕동 123 외 2필지", "2026-09-30"), "사이트분석_서울특별시_강동구_고덕동_123_외_2필지_20260930.pptx");

// 실제 렌더: 상태 슬라이드(S02 미제공·S03 실패)와 D04 두 면을 포함한 덱
const deckBoard = boardReducer(boardReducer(boardReducer(initBoard(GODEOK_RESULTS), { type: "include", id: "t-S02", value: true }), { type: "include", id: "t-S03", value: true }), { type: "face", id: "t-D04", face: "both" });
const plan = build(GODEOK_RESULTS, deckBoard);
const bytes = await renderReportPptx(plan);
mkdirSync("docs/design/p1c0", { recursive: true });
writeFileSync("docs/design/p1c0/report-sample.pptx", bytes);

const zip = await JSZip.loadAsync(bytes);
const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
assert.equal(names.length, plan.length);
const text = (xml) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join("|"); // 공백이 아닌 구분자: 텍스트 조각 경계가 "숫자 분" 오탐을 만들지 않게
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
// S02 상태 슬라이드도 고정 문구를 가진다 / S03 복구 결과(정상 슬라이드)도 탐색용
const s02 = plan.findIndex((p) => p.kind === "tile" && p.view.code === "S02");
assert.ok(s02 > 0 && plan[s02].body.kind === "state");
const rec = boardReducer(initBoard([RECOVERED.S03]), { type: "include", id: "t-S03", value: true });
const recPlan = build([RECOVERED.S03], rec);
const recText = text(await (await JSZip.loadAsync(await renderReportPptx(recPlan))).file("ppt/slides/slide2.xml").async("string"));
assert.ok(recText.includes("탐색용") && recText.includes("검증된 CFD 결과로 사용할 수 없습니다"));
// D04 두 면이 서로 다른 슬라이드: 도판엔 구성비 표가 없고 구성비엔 표가 있다
const d04 = plan.map((p, i) => [p, i]).filter(([p]) => p.kind === "tile" && p.view.code === "D04");
assert.equal(d04.length, 2);
const [x0, x1] = await Promise.all(d04.map(([, i]) => zip.file(names[i]).async("string")));
assert.ok(!x0.includes("<a:tbl>") && x1.includes("<a:tbl>"));

console.log(`v2 report tests passed (${plan.length} slides in sample deck)`);
