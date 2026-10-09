import assert from "node:assert/strict";

const { getRovingTargetIndex } = await import("../../lib/v2/ui/roving-grid.ts");

const item = (id, navigable = true) => ({ id, navigable });
const visible = (items) => items.filter((candidate) => candidate.navigable !== false);
const targetId = (items, currentId, key, columns) => {
  const list = visible(items);
  const index = getRovingTargetIndex(items, currentId, key, columns);
  return index < 0 ? null : list[index]?.id ?? null;
};

// 4열: 좌우는 같은 줄, 위아래는 열 수만큼 이동한다.
{
  const items = ["A", "B", "C", "D", "E", "F", "G", "H", "I"].map((id) => item(id));
  assert.equal(targetId(items, "A", "ArrowRight", 4), "B");
  assert.equal(targetId(items, "D", "ArrowLeft", 4), "C");
  assert.equal(targetId(items, "B", "ArrowDown", 4), "F");
  assert.equal(targetId(items, "F", "ArrowUp", 4), "B");
  assert.equal(targetId(items, "G", "Home", 4), "A");
  assert.equal(targetId(items, "A", "End", 4), "I");
}

// 실제 보드 선택지 2~6열 모두에서 아래 이동은 같은 열을 따른다.
for (const columns of [2, 3, 4, 5, 6]) {
  const items = Array.from({ length: columns * 2 + 1 }, (_, index) => item(String(index)));
  assert.equal(targetId(items, "0", "ArrowDown", columns), String(columns));
  assert.equal(targetId(items, String(columns), "ArrowUp", columns), "0");
}

// 마지막 줄이 짧으면 같은 열을 유지할 수 없을 때 그 줄의 마지막 카드로 고정한다.
{
  const items = ["A", "B", "C", "D", "E", "F", "G", "H"].map((id) => item(id));
  assert.equal(targetId(items, "C", "ArrowDown", 3), "F");
  assert.equal(targetId(items, "F", "ArrowDown", 3), "H");
  assert.equal(targetId(items, "H", "ArrowUp", 3), "E");
  assert.equal(targetId(items, "H", "ArrowDown", 3), "H");
}

// 숨김 카드는 건너뛰고, 스택 카드는 하나의 보드 항목으로 이동한다.
{
  const items = [item("A"), item("hidden-1", false), item("B"), item("STACK"), item("hidden-2", false), item("C")];
  assert.equal(targetId(items, "B", "ArrowDown", 2), "C");
  assert.equal(targetId(items, "STACK", "ArrowLeft", 2), "STACK");
  assert.equal(targetId(items, "hidden-1", "Home", 2), "A");
  assert.equal(targetId(items, "A", "End", 2), "C");
}

// 숨김 항목이 앞에 있어도 보이는 항목만으로 행·열을 계산한다.
{
  const items = [item("hidden-0", false), item("A"), item("B"), item("C"), item("D")];
  assert.equal(targetId(items, "A", "ArrowRight", 2), "B");
  assert.equal(targetId(items, "A", "ArrowDown", 2), "C");
  assert.equal(targetId(items, "D", "ArrowUp", 2), "B");
}

assert.equal(getRovingTargetIndex([], null, "ArrowRight", 4), -1);
console.log("v2 roving grid tests passed");
