import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { GC_STATE_FILE, recordGcSkipped } = await import("../../lib/v2/data/gc-state.ts");

const dir = mkdtempSync(join(tmpdir(), "v2-gc-state-"));
try {
  const item = "versions/old/buildings.sqlite";
  assert.deepEqual(recordGcSkipped(dir, [item], { now: () => "2026-10-06T00:00:00Z" }), []);
  assert.deepEqual(recordGcSkipped(dir, [item], { now: () => "2026-10-06T00:01:00Z" }), []);
  assert.deepEqual(recordGcSkipped(dir, [item], { now: () => "2026-10-06T00:02:00Z" }), [{ path: item, consecutive: 3 }]);
  const state = JSON.parse(readFileSync(join(dir, GC_STATE_FILE), "utf8"));
  assert.equal(state.items[item].consecutive, 3);
  assert.equal(state.items[item].lastSkippedAt, "2026-10-06T00:02:00Z");

  // A run where the item is no longer skipped breaks its consecutive streak.
  assert.deepEqual(recordGcSkipped(dir, [], { now: () => "2026-10-06T00:03:00Z" }), []);
  assert.deepEqual(recordGcSkipped(dir, [item], { now: () => "2026-10-06T00:04:00Z" }), []);
  assert.equal(JSON.parse(readFileSync(join(dir, GC_STATE_FILE), "utf8")).items[item].consecutive, 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("✓ v2 GC skipped state");
