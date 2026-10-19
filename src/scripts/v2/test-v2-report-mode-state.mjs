import assert from "node:assert/strict";
import { defaultFrame } from "../../lib/v2/report/report-doc.ts";
import {
  insertIndexAfter,
  moveByKey,
  pagesUsingTile,
} from "../../lib/v2/ui/report-mode-logic.ts";

const doc = {
  v: 1,
  format: "wide",
  pages: [
    { id: "p1", layout: "map-summary", panels: {}, textBoxes: [], notes: "", kind: "blank" },
    {
      id: "p2",
      layout: "map-summary",
      panels: {},
      textBoxes: [],
      notes: "",
      kind: "tile",
      tileId: "S02",
      part: 0,
      settings: {},
      frame: defaultFrame(),
    },
    {
      id: "p3",
      layout: "map-full",
      panels: {},
      textBoxes: [],
      notes: "",
      kind: "compare",
      grid: 2,
      sameExtent: true,
      cells: [
        { tileId: "S02", frame: defaultFrame(), settings: {} },
        { tileId: "S03", frame: defaultFrame(), settings: {} },
      ],
    },
  ],
};

assert.equal(insertIndexAfter(doc, null), 3);
assert.equal(insertIndexAfter(doc, "p2"), 2);
assert.deepEqual(pagesUsingTile(doc, "S02"), [2, 3]);
assert.deepEqual(pagesUsingTile(doc, "S99"), []);
assert.equal(moveByKey(doc, "p1", "ArrowLeft"), null);
assert.deepEqual(moveByKey(doc, "p1", "ArrowRight"), { type: "move", id: "p1", to: 1 });
assert.deepEqual(moveByKey(doc, "p2", "Home"), { type: "move", id: "p2", to: 0 });
assert.deepEqual(moveByKey(doc, "p2", "End"), { type: "move", id: "p2", to: 2 });

console.log("report mode state: PASS");
