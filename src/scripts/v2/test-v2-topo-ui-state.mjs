import assert from "node:assert/strict";

const { topoReducer, coveragePct } = await import("../../lib/v2/ui/topo-state.ts");

const summary = {
  crs: "EPSG:5179",
  bboxUtmk: [955000, 1888500, 956000, 1889500],
  coverageWgs84: [
    [127, 37],
    [127.01, 37],
    [127.01, 37.01],
    [127, 37.01],
    [127, 37],
  ],
  counts: {},
  demCells: 100,
  buildingFloorsOnePct: null,
};

let state = { s: "idle" };
state = topoReducer(state, { type: "pick", fileName: "sample.zip" });
assert.deepEqual(state, { s: "preparing" });

state = topoReducer(state, { type: "progress", loaded: 5, total: 10 });
assert.deepEqual(state, { s: "uploading", loaded: 5, total: 10 });

state = topoReducer(state, {
  type: "done",
  topoId: "topo-1",
  fileName: "sample.zip",
  summary,
  center: [127, 37],
  radiusM: 500,
});
assert.equal(state.s, "ready");
assert.equal(state.topoId, "topo-1");
assert.equal(state.fileName, "sample.zip");
assert.equal(state.coveragePct, coveragePct(summary, [127, 37], 500));
assert.ok(state.coveragePct > 0);

state = topoReducer({ s: "idle" }, {
  type: "done",
  topoId: "topo-pending",
  fileName: "sample.zip",
  summary,
  center: null,
  radiusM: 500,
});
assert.deepEqual(state, {
  s: "ready",
  topoId: "topo-pending",
  fileName: "sample.zip",
  summary,
  coveragePct: null,
});
state = topoReducer(state, {
  type: "recheck",
  center: [127, 37],
  radiusM: 500,
});
assert.equal(state.s, "ready");
assert.equal(state.coveragePct, coveragePct(summary, [127, 37], 500));

state = topoReducer(state, {
  type: "recheck",
  center: [128, 38],
  radiusM: 500,
});
assert.deepEqual(state, { s: "error", code: "topo_outside" });

state = topoReducer(state, { type: "remove" });
assert.deepEqual(state, { s: "idle" });

console.log("v2 topo ui state: PASS");
