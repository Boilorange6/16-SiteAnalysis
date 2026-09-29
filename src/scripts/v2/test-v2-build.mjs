/**
 * 적재 틀 테스트. 빌드와 게시가 한 잠금 안에서 끝나고,
 * 품질 검사에 걸리면 현재 manifest는 그대로여야 한다.
 */
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { toUtmk, toLngLat } = await import("../../lib/v2/crs.ts");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const M = await import("../../lib/v2/data/manifest.ts");
const B = await import("../../lib/v2/ingest/build.ts");
const { REVIEW_SITES } = await import("../../lib/v2/a0/review-sites.ts");

const dasan = REVIEW_SITES.find((s) => s.id === "dasan").center;
const [cx, cy] = toUtmk(dasan);
const at = (dx, dy) => [...toLngLat([cx + dx, cy + dy])];

const release = (db, sourceId) => B.insertRelease(db, { sourceId, provider: "test", sourceUrl: "https://example.invalid", sourceAsOf: "2026-09-01", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "TEST" });

/** n개의 building feature를 다산 근처에 넣는 core 빌더 */
const coreBuilder = (n, { received = n } = {}) => async (db) => {
  const rel = release(db, "bld");
  const s = new B.SourceStats("bld", rel, ["height"]);
  await B.batched(db, Array.from({ length: received }, (_, i) => i), (i) => {
    s.read();
    if (i >= n) return s.reject();
    insertFeature(db, { stableId: `b${i}`, kind: "building", sourceKey: `b${i}`, releaseId: rel, geometry: { type: "Point", coordinates: at(i * 10, 0) } });
    s.accept({ height: i % 2 ? 10 : null }, "41", "building");
  });
  return [s];
};
const refBuilder = (assertCore) => async (db, ctx) => {
  if (assertCore) assertCore(ctx.core);
  const rel = release(db, "stops");
  const s = new B.SourceStats("stops", rel, []);
  s.read();
  insertFeature(db, { stableId: "s1", kind: "bus_stop", sourceKey: "s1", releaseId: rel, geometry: { type: "Point", coordinates: at(5, 5) } });
  s.accept({}, "41", "bus_stop");
  return [s];
};

const dataDir = mkdtempSync(join(tmpdir(), "v2-build-"));

// ─── 1. 첫 빌드·게시 ────────────────────────────────────────────────────────
const a = await B.buildAndPublish({ dataDir, version: "a", builders: { core: coreBuilder(10), reference: refBuilder() } });
assert.equal(a.published, true, JSON.stringify(a.failures));
assert.deepEqual(Object.keys(M.readManifest(dataDir).files).sort(), ["core", "reference"]);
assert.equal(a.files.core.path, "versions/a/core.sqlite");
{
  const db = M.openDataFile(dataDir, M.readManifest(dataDir), "core");
  const run = db.prepare("SELECT * FROM ingest_run WHERE source_id='bld'").get();
  assert.equal(run.status, "succeeded");
  assert.equal(run.accepted_count, 10);
  assert.equal(JSON.parse(run.snapshot_json).total, 10);
  assert.equal(JSON.parse(run.snapshot_json).fillRates.height, 0.5);
  assert.equal(db.pragma("journal_mode", { simple: true }), "delete");
  assert.equal(db.prepare("SELECT release_id FROM source_release").pluck().get(), "bld@2026-09-01");
  db.close();
}
assert.equal(existsSync(join(dataDir, ".lock")), false);

// ─── 2. 급감 → 게시 거부, 현재본 유지 ──────────────────────────────────────
const before = M.manifestHash(M.readManifest(dataDir));
const b = await B.buildAndPublish({ dataDir, version: "b", builders: { core: coreBuilder(3) } });
assert.equal(b.published, false);
assert.ok(b.failures.some((f) => f.code === "TOTAL_DROP" && f.detail.startsWith("bld:")), JSON.stringify(b.failures));
assert.equal(M.manifestHash(M.readManifest(dataDir)), before);

// ─── 3. reference만 다시 빌드 → core는 이전 파일 유지, ctx.core는 현재 core ──
const c = await B.buildAndPublish({
  dataDir, version: "c",
  builders: { reference: refBuilder((core) => assert.equal(core.prepare("SELECT count(*) FROM feature").pluck().get(), 10)) },
});
assert.equal(c.published, true, JSON.stringify(c.failures));
assert.equal(M.readManifest(dataDir).files.core.path, "versions/a/core.sqlite");
assert.equal(M.readManifest(dataDir).files.reference.path, "versions/c/reference.sqlite");

// ─── 4. 같은 버전 이름 재사용 거부 ─────────────────────────────────────────
await assert.rejects(B.buildAndPublish({ dataDir, version: "c", builders: { reference: refBuilder() } }), /already exists/);

// ─── 5. 빌더 예외 → 현재본 유지, 잠금 해제 ─────────────────────────────────
const cur = M.manifestHash(M.readManifest(dataDir));
await assert.rejects(B.buildAndPublish({ dataDir, version: "d", builders: { core: async () => { throw new Error("boom"); } } }), /boom/);
assert.equal(M.manifestHash(M.readManifest(dataDir)), cur);
assert.equal(existsSync(join(dataDir, ".lock")), false);

// ─── 6. 읽었는데 하나도 못 받음 → PARSED_ZERO_WITH_ROWS ─────────────────────
const e = await B.buildAndPublish({ dataDir, version: "e", builders: { core: coreBuilder(0, { received: 5 }) } });
assert.equal(e.published, false);
assert.ok(e.failures.some((f) => f.code === "PARSED_ZERO_WITH_ROWS"));

// ─── 7. 고정 지점 기대치 ───────────────────────────────────────────────────
const f = await B.buildAndPublish({ dataDir, version: "f", builders: { core: coreBuilder(10) }, expectations: [{ siteId: "dasan", kind: "building", minCount: 50 }] });
assert.equal(f.published, false);
assert.ok(f.failures.some((x) => x.code === "EXPECTATION_BELOW" && /dasan building: 10 < 50/.test(x.detail)));
const g = await B.buildAndPublish({ dataDir, version: "g", builders: { core: coreBuilder(10) }, expectations: [{ siteId: "dasan", kind: "building", minCount: 10 }] });
assert.equal(g.published, true, JSON.stringify(g.failures));

console.log("✓ v2 build");
