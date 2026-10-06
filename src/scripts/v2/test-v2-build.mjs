/**
 * 적재 틀 테스트. 빌드와 게시가 한 잠금 안에서 끝나고,
 * 품질 검사에 걸리면 현재 manifest는 그대로여야 한다.
 */
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
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
const measuredIntegrity = B.checkSqliteIntegrity(join(dataDir, a.files.core.path));
assert.equal(measuredIntegrity.ok, true, JSON.stringify(measuredIntegrity.failures));
assert.equal(measuredIntegrity.rtreeMode, "rtreecheck");
assert.ok(measuredIntegrity.elapsedMs >= 0);
console.log(`integrity fixture: ${measuredIntegrity.sizeBytes} bytes/${measuredIntegrity.pageCount} pages/${measuredIntegrity.elapsedMs.toFixed(1)}ms; rtree=${measuredIntegrity.rtreeMode}`);
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


// ─── 8. 게이트 도달성 ──────────────────────────────────────────────────────
const tweak = (n, fn) => async (db, ctx) => { const l = await coreBuilder(n)(db, ctx); fn(l[0]); return l; };
const h = await B.buildAndPublish({ dataDir, version: "h", builders: { core: tweak(10, (s) => { s.expectedRegions = ["41", "11"]; }) } });
assert.equal(h.published, false);
assert.ok(h.failures.some((x) => x.code === "REGION_MISSING"), JSON.stringify(h.failures));
const i = await B.buildAndPublish({ dataDir, version: "i", builders: { core: tweak(10, (s) => { s.pageLimitHit = true; }) } });
assert.equal(i.published, false);
assert.ok(i.failures.some((x) => x.code === "INCOMPLETE_FETCH"), JSON.stringify(i.failures));
const j = await B.buildAndPublish({ dataDir, version: "j", builders: { core: tweak(10, (s) => { s.totalCountReported = 99; }) } });
assert.equal(j.published, false);
assert.ok(j.failures.some((x) => x.code === "INCOMPLETE_FETCH"), JSON.stringify(j.failures));
// totalCount는 읽은 행(received)과 견준다: 위치 미확인 행도 읽은 행이다
const k = await B.buildAndPublish({ dataDir, version: "k", builders: { core: tweak(10, (s) => { s.read(); s.unlocate(); s.totalCountReported = 11; }) } });
assert.equal(k.published, true, JSON.stringify(k.failures));
const k2 = await B.buildAndPublish({ dataDir, version: "k2", builders: { core: async (db, ctx) => { const l = await coreBuilder(10, { received: 12 })(db, ctx); l[0].totalCountReported = 10; return l; } } });
assert.equal(k2.published, false, "accepted(10)와 같아도 received(12)와 다르면 불완전");
assert.ok(k2.failures.some((x) => x.code === "INCOMPLETE_FETCH" && /received 12/.test(x.detail)), JSON.stringify(k2.failures));
{
  const db = M.openDataFile(dataDir, M.readManifest(dataDir), "core");
  const run = db.prepare("SELECT * FROM ingest_run WHERE source_id='bld'").get();
  assert.equal(run.expected_count, 11);
  assert.equal(JSON.parse(run.snapshot_json).unlocated, 1);
  db.close();
}

// ─── 9. 버전 가드: 다른 종류 파일만 있는 디렉터리도 거부 ────────────────────
await B.buildAndPublish({ dataDir, version: "m", builders: { core: coreBuilder(1) } }); // 게이트에 걸려 미게시, versions/m/core.sqlite만 남음
await assert.rejects(B.buildAndPublish({ dataDir, version: "m", builders: { reference: refBuilder() } }), /already exists/);

// ─── 10. 빌더 예외 뒤 파일 핸들이 닫혀 있다 ────────────────────────────────
rmSync(join(dataDir, "versions", "d", "core.sqlite"));

// ─── 11. 이전 스냅샷이 깨졌으면 조용히 넘기지 않고 빌드 실패 ────────────────
{
  const m = M.readManifest(dataDir);
  const w = new Database(join(dataDir, m.files.core.path));
  w.prepare("UPDATE ingest_run SET snapshot_json = '{bad'").run();
  w.close();
  const snap = M.manifestHash(M.readManifest(dataDir));
  await assert.rejects(B.buildAndPublish({ dataDir, version: "n", builders: { core: coreBuilder(10) } }));
  assert.equal(M.manifestHash(M.readManifest(dataDir)), snap);
  assert.equal(existsSync(join(dataDir, ".lock")), false);
}

// ─── 12. resetBaseline: 지정한 원천만 이전 스냅샷 비교를 건너뛴다 ───────────
{
  const dir = mkdtempSync(join(tmpdir(), "v2-build-reset-"));
  const two = (nA, nB, regionA = "41") => async (db) => {
    const rel = release(db, "sa");
    const out = [];
    for (const [id, n, region] of [["sa", nA, regionA], ["sb", nB, "41"]]) {
      const s = new B.SourceStats(id, rel, []);
      await B.batched(db, Array.from({ length: n }, (_, i) => i), (i) => {
        s.read();
        insertFeature(db, { stableId: `${id}${i}`, kind: "building", sourceKey: `${id}${i}`, releaseId: rel, geometry: { type: "Point", coordinates: at(i * 10, 0) } });
        s.accept({}, region, "building");
      });
      out.push(s);
    }
    return out;
  };
  const v1 = await B.buildAndPublish({ dataDir: dir, version: "v1", builders: { core: two(10, 10) } });
  assert.equal(v1.published, true, JSON.stringify(v1.failures));
  assert.deepEqual(v1.baselineReset, []);
  const drop = await B.buildAndPublish({ dataDir: dir, version: "v2", builders: { core: two(3, 3, "11") } });
  assert.equal(drop.published, false);
  assert.ok(drop.failures.some((f) => f.code === "TOTAL_DROP" && f.detail.startsWith("sa:")) && drop.failures.some((f) => f.code === "REGION_MISSING" && f.detail.startsWith("sa:")), JSON.stringify(drop.failures));
  // sa만 리셋: sb의 급감은 여전히 잡힌다
  const bad = await B.buildAndPublish({ dataDir: dir, version: "v3", builders: { core: two(3, 3, "11") }, resetBaseline: ["sa"] });
  assert.equal(bad.published, false);
  assert.deepEqual(bad.baselineReset, ["sa"]);
  assert.ok(bad.failures.length > 0 && bad.failures.every((f) => f.detail.startsWith("sb:")), JSON.stringify(bad.failures));
  // sb는 멀쩡하면 sa의 TOTAL_DROP·REGION_MISSING이 있어도 게시된다
  const ok = await B.buildAndPublish({ dataDir: dir, version: "v4", builders: { core: two(3, 10, "11") }, resetBaseline: ["sa"] });
  assert.equal(ok.published, true, JSON.stringify(ok.failures));
  assert.deepEqual(ok.baselineReset, ["sa"]);
}

// ─── 13. 게시 전 FK 무결성 실패는 gate에서 막고 이유를 남긴다 ───────────────
{
  const dir = mkdtempSync(join(tmpdir(), "v2-build-integrity-fk-"));
  const corrupt = await B.buildAndPublish({
    dataDir: dir,
    version: "corrupt",
    builders: {
      core: async (db, ctx) => {
        const stats = await coreBuilder(1)(db, ctx);
        db.pragma("foreign_keys = OFF");
        db.prepare(`INSERT INTO feature_link (from_stable_id, to_stable_id, relation_type, method, confidence, release_id)
          VALUES ('missing-from', 'missing-to', 'test', 'fixture', NULL, 'missing-release')`).run();
        db.pragma("foreign_keys = ON");
        return stats;
      },
    },
  });
  assert.equal(corrupt.published, false, JSON.stringify(corrupt.failures));
  assert.ok(corrupt.failures.some((failure) => failure.code === "FOREIGN_KEY" && failure.detail.startsWith("core:")), JSON.stringify(corrupt.failures));
  assert.equal(M.readManifest(dir), null, "FK 무결성 실패는 첫 게시도 막는다");
  rmSync(dir, { recursive: true, force: true });
}

console.log("✓ v2 build");
