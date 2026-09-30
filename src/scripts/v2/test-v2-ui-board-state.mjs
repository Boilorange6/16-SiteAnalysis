/** 보드 상태 reducer 테스트: 제거·되돌리기(순서 복원), 이동 경계, 보고서 포함, 출력 면, 장수. */
import assert from "node:assert/strict";

const { GODEOK_RESULTS } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { initBoard, boardReducer, reportPages, demoPhase, demoFinished } = await import("../../lib/v2/ui/board-state.ts");

const ids = GODEOK_RESULTS.map((r) => r.tileId);
let s = initBoard(GODEOK_RESULTS);
assert.deepEqual(s.order, ids);
assert.equal(s.included["t-A01"], true);
assert.equal(s.included["t-S02"], false); // not_provided
assert.equal(s.included["t-S03"], false); // failed

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

// 데모
assert.deepEqual([0, 1, 2, 3].map((st) => demoPhase(1, st)), ["pending", "pending", "running", "done"]);
assert.equal(demoFinished(10, 0), 0);
assert.equal(demoFinished(10, 8), 7);
assert.equal(demoFinished(10, 99), 10);

console.log("v2 ui board-state tests passed");
