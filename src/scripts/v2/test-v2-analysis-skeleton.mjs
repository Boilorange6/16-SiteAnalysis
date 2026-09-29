/**
 * 끝에서 끝: 데이터 파일 → manifest 게시 → 분석 → tile_result → 저장 → 새 버전 게시 → 옛 결과 복원 → 가비지 수집.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { toUtmk, toLngLat } = await import("../../lib/v2/crs.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const M = await import("../../lib/v2/data/manifest.ts");
const A = await import("../../lib/v2/app-db.ts");
const { runSkeletonAnalysis } = await import("../../lib/v2/analysis-skeleton.ts");

const CENTER = [127.1506, 37.6245];
const [cx, cy] = toUtmk(CENTER);
const at = (dx, dy) => [...toLngLat([cx + dx, cy + dy])];
const box = (dx, dy) => ({ type: "Polygon", coordinates: [[at(dx, dy), at(dx + 10, dy), at(dx + 10, dy + 10), at(dx, dy + 10), at(dx, dy)]] });

async function buildCore(dataDir, version, offsets) {
  const rel = `versions/${version}/core.sqlite`;
  mkdirSync(join(dataDir, "versions", version), { recursive: true });
  const db = new Database(join(dataDir, rel));
  initDataFileSchema(db, "core");
  if (offsets.length > 0) {
    db.prepare(`INSERT INTO source_release (release_id, source_id, provider, source_url, source_as_of, fetched_at, checksum, schema_version, license_code)
      VALUES (?, 'gis_building', '국토교통부', 'https://www.data.go.kr/data/15083092/fileData.do', '2026-09-01', '2026-09-29T00:00:00+09:00', 'x', 1, 'KOGL-1')`).run(`rel-${version}`);
  }
  offsets.forEach(([dx, dy], i) => insertFeature(db, { stableId: `${version}-b${i}`, kind: "building", sourceKey: `b${i}`, releaseId: `rel-${version}`, geometry: box(dx, dy) }));
  db.close();
  const manifest = { version, createdAt: "2026-09-29T00:00:00+09:00", files: { core: { path: rel, sha256: await M.sha256File(join(dataDir, rel)), kind: "core", schemaVersion: 1 } } };
  const r = await M.publishManifest(dataDir, manifest, () => ({ ok: true, failures: [] }));
  assert.equal(r.published, true);
  return r.hash;
}

const dataDir = mkdtempSync(join(tmpdir(), "v2-e2e-data-"));
const appDb = A.openV2AppDb(join(mkdtempSync(join(tmpdir(), "v2-e2e-app-")), "app.sqlite"));
const input = { address: "경기도 남양주시 다산동", center: CENTER, radiusM: 800, analysisDate: "2026-09-29" };

try {
  // 데이터 없음 → 분석 거부
  assert.throws(() => runSkeletonAnalysis(appDb, dataDir, input), /no published manifest/);

  // v1: 반경 안 2동, 밖 1동
  const h1 = await buildCore(dataDir, "v1", [[0, 0], [300, 300], [2000, 0]]);
  const r1 = runSkeletonAnalysis(appDb, dataDir, input);
  assert.equal(r1.manifestHash, h1);
  assert.equal(r1.tiles.length, 1);
  const d02 = r1.tiles[0];
  assert.equal(d02.tileCode, "D02");
  assert.equal(d02.status, "complete");
  assert.equal(d02.metrics[0].value, 2);
  assert.equal(d02.provenance.manifestHash, h1, "타일이 분석과 같은 데이터 버전");
  assert.equal(d02.provenance.sources[0].releaseId, "rel-v1");
  assert.equal(d02.provenance.sources[0].sourceAsOf, "2026-09-01");
  assert.equal(A.getAnalysisRun(appDb, r1.analysisId).status, "complete");
  await A.saveProject(appDb, dataDir, { projectId: "p1", name: "다산", analysisId: r1.analysisId, board: { tiles: ["D02"] } });

  // v2 게시(5동) → 새 분석은 새 버전, 옛 분석은 그대로
  const h2 = await buildCore(dataDir, "v2", [[0, 0], [100, 0], [200, 0], [300, 0], [400, 0]]);
  const r2 = runSkeletonAnalysis(appDb, dataDir, input);
  assert.equal(r2.manifestHash, h2);
  assert.equal(r2.tiles[0].metrics[0].value, 5);
  assert.deepEqual(A.loadTileResults(appDb, r1.analysisId), r1.tiles, "저장된 분석은 옛 결과 그대로 복원");

  // v3 게시(건물 없음) → 0동이 아니라 no_data (출처가 없으므로)
  await buildCore(dataDir, "v3", []);
  const r3 = runSkeletonAnalysis(appDb, dataDir, input);
  assert.equal(r3.tiles[0].status, "no_data");
  assert.equal(r3.tiles[0].metrics[0].status, "missing");
  assert.equal(r3.tiles[0].metrics[0].value, null);

  // 같은 입력·같은 manifest 재실행: 새 analysisId, 같은 해시·같은 값
  const r3b = runSkeletonAnalysis(appDb, dataDir, input);
  assert.notEqual(r3b.analysisId, r3.analysisId);
  assert.equal(r3b.manifestHash, r3.manifestHash);
  assert.equal(r3b.tiles[0].metrics[0].value, r3.tiles[0].metrics[0].value);

  // 진행 중 분석의 버전은 GC가 지우지 않는다 (v5 게시 후 v4 분석을 running으로 둔다)
  // v4 게시 → 현재 v4, 이전 v3. v2는 현재·이전·핀 어디에도 없어 삭제 대상, v1은 핀으로 유지.
  await buildCore(dataDir, "v4", [[0, 0]]);
  const { deleted } = await M.collectGarbage(dataDir, A.pinnedManifestHashes(appDb));
  assert.ok(existsSync(join(dataDir, "versions/v1/core.sqlite")), "핀 고정된 v1 유지");
  assert.ok(!existsSync(join(dataDir, "versions/v2/core.sqlite")), "핀 없는 v2 삭제");
  assert.ok(deleted.includes("versions/v2/core.sqlite"));
  assert.ok(!deleted.includes("versions/v1/core.sqlite"));

  // 실행 중 분석의 버전 유지, 수집된 버전으로는 저장 불가하지만 GC는 계속 동작
  const h5 = await buildCore(dataDir, "v5", [[0, 0], [50, 50]]);
  A.createAnalysisRun(appDb, { analysisId: "run-live", address: "x", center: CENTER, radiusM: 800, analysisDate: "2026-09-29", manifestHash: h5, engineVersion: "v2-p0", parameters: {} });
  await buildCore(dataDir, "v6", [[0, 0]]);
  await buildCore(dataDir, "v7", [[0, 0]]); // 현재 v7, 이전 v6 — v5는 running 핀으로만 산다
  await M.collectGarbage(dataDir, A.pinnedManifestHashes(appDb));
  assert.ok(existsSync(join(dataDir, "versions/v5/core.sqlite")), "running 분석의 v5 유지");
  A.finishAnalysisRun(appDb, "run-live", "complete");
  await M.collectGarbage(dataDir, A.pinnedManifestHashes(appDb));
  assert.ok(!existsSync(join(dataDir, "versions/v5/core.sqlite")), "끝난 뒤 v5 수집");
  await assert.rejects(A.saveProject(appDb, dataDir, { projectId: "p2", name: "x", analysisId: "run-live", board: {} }), /DATA_VERSION_GONE/);
  await M.collectGarbage(dataDir, A.pinnedManifestHashes(appDb)); // 저장 거부 덕에 GC가 막히지 않는다
} finally {
  appDb.close();
}

console.log("✓ v2 analysis skeleton (end to end)");
