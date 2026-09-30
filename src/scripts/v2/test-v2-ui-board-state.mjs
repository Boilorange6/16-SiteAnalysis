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

// 보고서: 표지 1 + 포함 타일(8) = 9, both는 2장
assert.deepEqual(reportPages(s), { tiles: 8, pages: 9 });
s = boardReducer(s, { type: "include", id: "t-A01", value: false });
assert.deepEqual(reportPages(s), { tiles: 7, pages: 8 });
s = boardReducer(s, { type: "face", id: "t-D04", face: "both" });
assert.equal(s.faces["t-D04"], "both");
assert.deepEqual(reportPages(s), { tiles: 7, pages: 9 });
// 제거된 타일은 장수에서 빠진다
s = boardReducer(s, { type: "remove", id: "t-D04" });
assert.deepEqual(reportPages(s), { tiles: 6, pages: 7 });
s = boardReducer(s, { type: "undo" });
assert.deepEqual(reportPages(s), { tiles: 7, pages: 9 }); // 포함·면 설정 유지

// 데모
assert.deepEqual([0, 1, 2, 3].map((st) => demoPhase(1, st)), ["pending", "pending", "running", "done"]);
assert.equal(demoFinished(10, 0), 0);
assert.equal(demoFinished(10, 8), 7);
assert.equal(demoFinished(10, 99), 10);

console.log("v2 ui board-state tests passed");
