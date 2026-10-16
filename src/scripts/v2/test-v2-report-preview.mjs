import assert from "node:assert/strict";

const {
  mixedValue,
  movePageSelection,
  nextExtraPageId,
  pageKeyAfterInsertion,
  selectPageKeys,
  toggleLegendFocus,
  toggleLabelVisibility,
  togglePinnedKey,
} = await import("../../lib/v2/ui/report-preview-logic.ts");

const pages = ["cover", "A01:front", "A02:front", "sources:0"];

// plain은 기존 다중 선택을 버리고 한 장만 남긴다.
assert.deepEqual(
  selectPageKeys(pages, "A01:front", "sources:0"),
  ["sources:0"],
);

// Ctrl/Meta 토글은 plan 순서를 유지하고, 이미 선택된 장은 제거한다.
assert.deepEqual(
  selectPageKeys(pages, "A02:front", "A01:front", { ctrlKey: true, selectedKeys: ["A02:front"] }),
  ["A01:front", "A02:front"],
);
assert.deepEqual(
  selectPageKeys(pages, "A01:front", "A01:front", { metaKey: true, selectedKeys: ["A01:front", "A02:front"] }),
  ["A02:front"],
);

// Shift 클릭은 anchor와 target을 포함하며 양방향 모두 plan 순서로 정렬된다.
assert.deepEqual(
  selectPageKeys(pages, "A02:front", "cover", { shiftKey: true }),
  ["cover", "A01:front", "A02:front"],
);
assert.deepEqual(
  selectPageKeys(pages, "A01:front", "sources:0", { shiftKey: true }),
  ["A01:front", "A02:front", "sources:0"],
);
assert.deepEqual(
  selectPageKeys(pages, null, "A02:front", { shiftKey: true }),
  ["A02:front"],
  "anchor가 없으면 클릭 장만 선택",
);

// Shift+방향은 active를 한 칸 움직인 범위이며 목록 경계에서 넘지 않는다.
assert.deepEqual(
  movePageSelection(pages, "A01:front", "A02:front", 1, true),
  ["A01:front", "A02:front", "sources:0"],
);
assert.deepEqual(
  movePageSelection(pages, "A01:front", "A02:front", -1, true),
  ["A01:front"],
);
assert.deepEqual(
  movePageSelection(pages, "cover", "cover", -1, true),
  ["cover"],
  "첫 장에서 위로 이동해도 범위를 벗어나지 않음",
);
assert.deepEqual(
  movePageSelection(pages, "A01:front", "A01:front", 1, false),
  ["A02:front"],
  "Shift가 없으면 이동한 한 장만 선택",
);

// 공통값은 같은 값·all-undefined fallback·mixed(undefined)를 구분한다.
assert.equal(mixedValue([1, 1, 1], 0), 1);
assert.equal(mixedValue([undefined, undefined], 0), 0);
assert.equal(mixedValue([], 0), 0);
assert.equal(mixedValue([0.7, 1.2], 1), undefined);
assert.equal(mixedValue([null, null], false), null);

// 보드 라벨에서 시작해 새 라벨을 추가하고, 같은 지도 요소를 다시 눌러 제거한다.
const boardPinnedKeys = ["site", "road", "site"];
const pagePinnedKeys = togglePinnedKey(boardPinnedKeys, "station");
assert.deepEqual(pagePinnedKeys, ["site", "road", "station"]);
assert.deepEqual(
  togglePinnedKey(pagePinnedKeys, "station"),
  ["site", "road"],
  "같은 라벨 재클릭은 중복 없이 해당 라벨을 제거",
);
assert.deepEqual(
  togglePinnedKey(["road", "road", "site"], "road"),
  ["site"],
  "기존 중복 라벨도 토글 시 모두 제거",
);

// 자동 라벨도 현재 표시 상태를 기준으로 숨김↔고정 표시를 왕복한다.
assert.deepEqual(
  toggleLabelVisibility(["station"], [], "station", true),
  { pinnedKeys: [], hiddenKeys: ["station"] },
);
assert.deepEqual(
  toggleLabelVisibility([], ["station", "station"], "station", false),
  { pinnedKeys: ["station"], hiddenKeys: [] },
);
assert.deepEqual(
  toggleLabelVisibility(["road", "road"], ["station", "station"], "", true),
  { pinnedKeys: ["road"], hiddenKeys: ["station"] },
  "빈 key는 기존 상태만 정규화",
);

// 범례 항목은 첫 클릭으로 focus하고 같은 항목을 다시 누르면 null로 돌아간다.
assert.equal(toggleLegendFocus(null, "road"), "road");
assert.equal(toggleLegendFocus("road", "road"), null);
assert.equal(toggleLegendFocus("road", "station"), "station");

// after key는 현재 plan에 있는 key만 통과시키고, stale key는 첫 장 앞(null)으로 보낸다.
assert.equal(pageKeyAfterInsertion(pages, null), null);
assert.equal(pageKeyAfterInsertion(pages, "A01:front"), "A01:front");
assert.equal(pageKeyAfterInsertion(pages, "stale"), null);

// 같은 타일의 중복은 결정적 suffix로 구분한다. extra: key도 비교 대상으로 받는다.
const firstId = nextExtraPageId([], "t-A01");
assert.equal(firstId, "preview-5-t-A01");
assert.equal(
  nextExtraPageId([firstId, "extra:preview-5-t-A01-2"], "t-A01"),
  "preview-5-t-A01-3",
);

console.log("v2 report preview pure logic tests passed");
