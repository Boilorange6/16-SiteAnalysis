/** 보드 상태 reducer 테스트: 제거·되돌리기(순서 복원), 이동 경계, 보고서 포함, 출력 면, 장수. */
import assert from "node:assert/strict";

const { GODEOK_RESULTS } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { initBoard, boardReducer, reportPages, demoPhase, demoFinished, serializeBoardState, restoreBoardState } = await import("../../lib/v2/ui/board-state.ts");

const ids = GODEOK_RESULTS.map((r) => r.tileId);
let s = initBoard(GODEOK_RESULTS);
assert.deepEqual(s.order, ids);
assert.deepEqual(s.results, GODEOK_RESULTS);
assert.equal(s.included["t-A01"], true);
assert.equal(s.included["t-S02"], false); // not_provided
assert.equal(s.included["t-S03"], false); // failed

// 백그라운드 폴링 결과 교체는 편집 상태를 건드리지 않는다.
{
  let edited = boardReducer(s, { type: "move", id: "t-A02", dir: 1 });
  edited = boardReducer(edited, { type: "include", id: "t-A01", value: false });
  edited = boardReducer(edited, { type: "face", id: "t-D04", face: "both" });
  const refreshed = GODEOK_RESULTS.map((result) => ({ ...result, status: "running" }));
  const next = boardReducer(edited, { type: "replaceResults", results: refreshed });
  assert.deepEqual(next.results, refreshed);
  assert.deepEqual(next.order, edited.order);
  assert.deepEqual(next.included, edited.included);
  assert.deepEqual(next.faces, edited.faces);
}

// 제거 → 되돌리기: 순서까지 복원, 여러 번도 역순으로
const s0 = s;
s = boardReducer(s, { type: "remove", id: "t-A05" });
s = boardReducer(s, { type: "remove", id: "t-A01" });
assert.equal(s.order.length, ids.length - 2);
assert.ok(!s.order.includes("t-A05"));
s = boardReducer(s, { type: "undo" });
assert.equal(s.order[0], "t-A01");
s = boardReducer(s, { type: "undo" });
assert.deepEqual(s.order, s0.order);
assert.equal(boardReducer(s, { type: "undo" }), s); // 더 없음
assert.equal(boardReducer(s, { type: "remove", id: "nope" }), s);

// 이동: 위/아래, 경계는 그대로
s = boardReducer(s, { type: "move", id: "t-A02", dir: -1 });
assert.deepEqual(s.order.slice(0, 2), ["t-A02", "t-A01"]);
s = boardReducer(s, { type: "move", id: "t-A02", dir: -1 });
assert.equal(s.order[0], "t-A02");
const last = ids[ids.length - 1];
assert.equal(boardReducer(s, { type: "move", id: last, dir: 1 }), s);
s = boardReducer(s, { type: "move", id: "t-A02", dir: 1 });
assert.deepEqual(s.order.slice(0, 2), ["t-A01", "t-A02"]);

// 보고서: 표지 1 + 포함 타일(10) + 출처 1 = 12, both는 2장
assert.deepEqual(reportPages(s), { tiles: 10, pages: 12 });
s = boardReducer(s, { type: "include", id: "t-A01", value: false });
assert.deepEqual(reportPages(s), { tiles: 9, pages: 11 });
s = boardReducer(s, { type: "face", id: "t-D04", face: "both" });
assert.equal(s.faces["t-D04"], "both");
assert.deepEqual(reportPages(s), { tiles: 9, pages: 12 });
// 제거된 타일은 장수에서 빠진다
s = boardReducer(s, { type: "remove", id: "t-D04" });
assert.deepEqual(reportPages(s), { tiles: 8, pages: 10 });
s = boardReducer(s, { type: "undo" });
assert.deepEqual(reportPages(s), { tiles: 9, pages: 12 }); // 포함·면 설정 유지

// 끌어 놓기 reorder: 앞으로/뒤로/제자리/범위 밖
{
  let b = initBoard(GODEOK_RESULTS);
  const o0 = b.order;
  b = boardReducer(b, { type: "reorder", from: 2, to: 0 });
  assert.deepEqual(b.order.slice(0, 3), [o0[2], o0[0], o0[1]]);
  assert.equal(b.order.length, o0.length);
  b = boardReducer(b, { type: "undo" });
  assert.deepEqual(b.order, o0);
  b = boardReducer(b, { type: "reorder", from: 0, to: o0.length - 1 });
  assert.equal(b.order[o0.length - 1], o0[0]);
  b = boardReducer(b, { type: "undo" });
  for (const [from, to] of [[3, 3], [-1, 0], [0, o0.length], [o0.length, 0]]) {
    assert.equal(boardReducer(b, { type: "reorder", from, to }), b); // 변화 없음, undo 안 쌓임
  }
  assert.equal(b.undoStack.length, 0);

  // 크기: 기본 1, 같은 값·없는 타일 무시, undo
  assert.equal(b.sizes["t-A01"], 1);
  assert.equal(boardReducer(b, { type: "resize", id: "t-A01", size: 1 }), b);
  assert.equal(boardReducer(b, { type: "resize", id: "nope", size: 2 }), b);
  b = boardReducer(b, { type: "resize", id: "t-A01", size: 2 });
  assert.equal(b.sizes["t-A01"], 2);
  b = boardReducer(b, { type: "undo" });
  assert.equal(b.sizes["t-A01"], 1);

  // 더하기: 끝에 붙고, 없는 것·이미 있는 것 무시, undo하면 다시 트레이로
  b = boardReducer(b, { type: "remove", id: "t-A05" });
  b = boardReducer(b, { type: "remove", id: "t-A07" });
  assert.equal(boardReducer(b, { type: "add", id: "t-A01" }), b);
  assert.equal(boardReducer(b, { type: "add", id: "nope" }), b);
  const beforeAdd = b;
  b = boardReducer(b, { type: "add", id: "t-A05" });
  assert.equal(b.order[b.order.length - 1], "t-A05");
  assert.deepEqual(b.removed.map((r) => r.id), ["t-A07"]);
  b = boardReducer(b, { type: "undo" });
  assert.deepEqual(b.order, beforeAdd.order);
  assert.deepEqual(b.removed.map((r) => r.id), ["t-A05", "t-A07"]);

  // 여러 종류 섞인 되돌리기는 역순으로 모두 원상 복구
  const base = initBoard(GODEOK_RESULTS);
  let m = base;
  m = boardReducer(m, { type: "reorder", from: 4, to: 1 });
  m = boardReducer(m, { type: "resize", id: "t-A02", size: 2 });
  m = boardReducer(m, { type: "remove", id: "t-A09" });
  m = boardReducer(m, { type: "add", id: "t-A09" });
  m = boardReducer(m, { type: "move", id: "t-A09", dir: -1 }); // 위/아래 버튼도 되돌릴 수 있다
  assert.equal(m.undoStack.length, 5);
  while (m.undoStack.length) m = boardReducer(m, { type: "undo" });
  assert.deepEqual(m.order, base.order);
  assert.deepEqual(m.sizes, base.sizes);
  assert.deepEqual(m.removed, []);

  // 보고서 장수는 순서·크기와 무관
  const p0 = reportPages(base);
  const shuffled = boardReducer(boardReducer(base, { type: "reorder", from: 0, to: 5 }), { type: "resize", id: "t-A01", size: 2 });
  assert.deepEqual(reportPages(shuffled), p0);
}

// 카드 면(요약/지도): 기본은 모두 요약면, 전체 전환은 카드별 뒤집기를 지우고, 카드별 뒤집기는 다음 전체 전환까지 따로 간다
{
  const { viewOf, SUMMARY_ID } = await import("../../lib/v2/ui/board-state.ts");
  let b = initBoard(GODEOK_RESULTS);
  assert.equal(b.viewAll, "summary");
  assert.ok([...b.order, SUMMARY_ID].every((id) => viewOf(b, id) === "summary"), "기본 = 요약면");
  const undo0 = b.undoStack.length;
  b = boardReducer(b, { type: "view", id: "t-A01", face: "map" });
  assert.deepEqual([viewOf(b, "t-A01"), viewOf(b, "t-A02"), viewOf(b, SUMMARY_ID)], ["map", "summary", "summary"], "카드 하나만 뒤집힘");
  b = boardReducer(b, { type: "viewAll", face: "map" });
  assert.ok([...b.order, SUMMARY_ID].every((id) => viewOf(b, id) === "map"), "전체 전환 = 모든 카드(대지 요약 포함)");
  b = boardReducer(b, { type: "view", id: "t-A03", face: "summary" });
  assert.deepEqual([viewOf(b, "t-A03"), viewOf(b, "t-A04"), b.viewAll], ["summary", "map", "map"], "카드별 뒤집기는 전체 설정을 덮어쓴다");
  b = boardReducer(b, { type: "viewAll", face: "map" });
  assert.equal(viewOf(b, "t-A03"), "map", "다음 전체 전환이 카드별 덮어쓰기를 지운다");
  b = boardReducer(b, { type: "viewAll", face: "summary" });
  assert.ok(b.order.every((id) => viewOf(b, id) === "summary") && Object.keys(b.view).length === 0);
  // 면은 되돌리기 기록·보고서에 들어가지 않는다
  assert.equal(b.undoStack.length, undo0);
  assert.deepEqual(reportPages(b), reportPages(boardReducer(b, { type: "view", id: "t-A05", face: "map" })));
  assert.equal(boardReducer(boardReducer(b, { type: "view", id: "t-A05", face: "map" }), { type: "undo" }).view["t-A05"], "map", "undo는 면을 건드리지 않는다");
  // 타일을 빼고 다시 더해도 면은 전체 설정을 따른다
  const c = boardReducer(boardReducer(boardReducer(b, { type: "viewAll", face: "map" }), { type: "remove", id: "t-A02" }), { type: "add", id: "t-A02" });
  assert.equal(viewOf(c, "t-A02"), "map");
  // 설명선 타일의 보고서 장수 설정
  assert.equal(b.callout["t-A05"], "top10");
  assert.equal(boardReducer(b, { type: "callout", id: "t-A05", mode: "all" }).callout["t-A05"], "all");
  assert.equal(reportPages(b, { "t-A05": 25 }).pages, reportPages(b).pages + 1, "A05: 개요 + 상위 10 = 2장 (기본 1장 대신)");
  assert.equal(reportPages(boardReducer(b, { type: "callout", id: "t-A05", mode: "all" }), { "t-A05": 25 }).pages, reportPages(b).pages + 3);
}

// S01 카메라 프리셋: 보드에 저장하지만 출력 면처럼 되돌리기에는 넣지 않고, 프리셋 밖 값은 무시한다.
{
  let b = initBoard(GODEOK_RESULTS);
  assert.deepEqual(b.cameras, {});
  b = boardReducer(b, { type: "camera", id: "t-S01", camera: { azimuthDeg: 315, elevationDeg: 35 } });
  assert.deepEqual(b.cameras["t-S01"], { azimuthDeg: 315, elevationDeg: 35 });
  assert.equal(b.undoStack.length, 0);
  const invalid = boardReducer(b, { type: "camera", id: "t-S01", camera: { azimuthDeg: 0, elevationDeg: 35 } });
  assert.equal(invalid, b, "프리셋 밖 방위는 무시");
  assert.equal(boardReducer(b, { type: "camera", id: "t-S01", camera: { azimuthDeg: 315, elevationDeg: 90 } }), b, "프리셋 밖 앙각은 무시");
}

// 데모
assert.deepEqual([0, 1, 2, 3].map((st) => demoPhase(1, st)), ["pending", "pending", "running", "done"]);
assert.equal(demoFinished(10, 0), 0);
assert.equal(demoFinished(10, 8), 7);
assert.equal(demoFinished(10, 99), 10);

// A05 필터는 결과와 분리된 보드 설정으로 저장·복원되고, 필드가 없던 옛 저장본도 연다.
{
  let b = initBoard(GODEOK_RESULTS);
  b = boardReducer(b, { type: "a05Filter", id: "t-A05", filter: { types: ["apt"], year: { min: 2010 } } });
  const snapshot = serializeBoardState(b);
  assert.equal(snapshot.version, 1);
  assert.deepEqual(snapshot.a05Filter["t-A05"], { types: ["apt"], year: { min: 2010, max: null } });
  const restored = restoreBoardState(GODEOK_RESULTS, JSON.stringify(snapshot));
  assert.deepEqual(restored.a05Filter, snapshot.a05Filter, "저장→불러오기 왕복으로 A05 필터 유지");
  const old = { ...snapshot };
  delete old.a05Filter;
  assert.deepEqual(restoreBoardState(GODEOK_RESULTS, old).a05Filter, {}, "a05Filter 없는 옛 저장본 호환");
  const refreshed = boardReducer(b, { type: "replaceResults", results: GODEOK_RESULTS.map((result) => ({ ...result })) });
  assert.deepEqual(refreshed.a05Filter, b.a05Filter, "재분석 결과 교체에도 필터 유지");
}

// W2a 지도 라벨: 토글·고정·삭제·전체 표시 상태와 저장 왕복, 현재 결과에 없는 타일 정리
{
  let b = initBoard(GODEOK_RESULTS);
  b = boardReducer(b, { type: "pinLabel", id: "t-D04", key: "bldg_2000s|b-1" });
  b = boardReducer(b, { type: "toggleLabel", id: "t-D04", key: "bldg_2000s|b-2" });
  b = boardReducer(b, { type: "toggleLabel", id: "t-D04", key: "bldg_2000s|b-1" });
  assert.deepEqual(b.labels["t-D04"], [{ key: "bldg_2000s|b-1", on: false }, { key: "bldg_2000s|b-2", on: true }]);
  b = boardReducer(b, { type: "setAllLabels", id: "t-D04", on: false });
  assert.ok(b.labels["t-D04"].every((label) => !label.on));
  b = boardReducer(b, { type: "setAllLabels", id: "t-D04", on: true });
  assert.ok(b.labels["t-D04"].every((label) => label.on));
  b = boardReducer(b, { type: "unpinLabel", id: "t-D04", key: "bldg_2000s|b-1" });
  assert.deepEqual(b.labels["t-D04"], [{ key: "bldg_2000s|b-2", on: true }]);
  const snapshot = serializeBoardState(b);
  const restored = restoreBoardState(GODEOK_RESULTS, { ...snapshot, labels: { ...snapshot.labels, "deleted-tile": [{ key: "x|0", on: true }], "t-D04": [...snapshot.labels["t-D04"], { key: "bldg_2000s|b-2", on: false }] } });
  assert.deepEqual(restored.labels["t-D04"], [{ key: "bldg_2000s|b-2", on: true }], "라벨 중복 제거 및 저장 왕복");
  assert.equal(restored.labels["deleted-tile"], undefined, "현재 결과에 없는 타일 라벨 정리");
  assert.deepEqual(restoreBoardState(GODEOK_RESULTS, JSON.stringify(snapshot)).labels, snapshot.labels, "labels 저장→불러오기 왕복");
}

console.log("v2 ui board-state tests passed");
