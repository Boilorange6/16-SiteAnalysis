/**
 * manifest 게시 테스트 (spec §3.4).
 * 어떤 실패에서도 현재 manifest는 직전 정상본이어야 하고,
 * 저장된 프로젝트가 쓰는 옛 버전 파일은 지워지면 안 된다.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const M = await import("../../lib/v2/data/manifest.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const OK = () => ({ ok: true, failures: [] });

function makeDataDir() {
  return mkdtempSync(join(tmpdir(), "v2-manifest-"));
}

/** versions/<version>/core.sqlite 를 만들고 manifest를 돌려준다 */
async function buildVersion(dataDir, version) {
  const rel = `versions/${version}/core.sqlite`;
  const abs = join(dataDir, rel);
  mkdirSync(join(dataDir, "versions", version), { recursive: true });
  const db = new Database(abs);
  initDataFileSchema(db, "core");
  db.close();
  return {
    version,
    createdAt: `2026-09-29T00:00:0${version.slice(-1)}+09:00`,
    files: { core: { path: rel, sha256: await M.sha256File(abs), kind: "core", schemaVersion: 1 } },
  };
}

// ─── 1. 첫 게시 ────────────────────────────────────────────────────────────
{
  const dir = makeDataDir();
  assert.equal(M.readManifest(dir), null);
  const v1 = await buildVersion(dir, "v1");
  const r = await M.publishManifest(dir, v1, OK);
  assert.deepEqual(r, { published: true, hash: M.manifestHash(v1), failures: [] });
  assert.deepEqual(M.readManifest(dir), v1);
  assert.deepEqual(M.readArchivedManifest(dir, r.hash), v1);
  assert.equal(existsSync(join(dir, M.PREVIOUS_MANIFEST_FILE)), false);
  assert.equal(M.manifestHash(v1), M.manifestHash(JSON.parse(JSON.stringify({ files: v1.files, createdAt: v1.createdAt, version: v1.version }))), "키 순서 무관");
}

// ─── 2. 실패 시 현재본 유지 ─────────────────────────────────────────────────
{
  const dir = makeDataDir();
  const v1 = await buildVersion(dir, "v1");
  await M.publishManifest(dir, v1, OK);

  const v2 = await buildVersion(dir, "v2");
  const tampered = { ...v2, files: { core: { ...v2.files.core, sha256: "0".repeat(64) } } };
  await assert.rejects(M.publishManifest(dir, tampered, OK), (e) => e.code === "HASH_MISMATCH");
  assert.deepEqual(M.readManifest(dir), v1, "해시 불일치 후 v1 유지");

  const missing = { ...v2, files: { core: { ...v2.files.core, path: "versions/nope/core.sqlite" } } };
  await assert.rejects(M.publishManifest(dir, missing, OK), (e) => e.code === "MISSING_FILE");

  const escape = { ...v2, files: { core: { ...v2.files.core, path: "../outside.sqlite" } } };
  await assert.rejects(M.publishManifest(dir, escape, OK), (e) => e.code === "PATH_ESCAPE");

  writeFileSync(join(dir, v2.files.core.path) + "-wal", "x");
  await assert.rejects(M.publishManifest(dir, v2, OK), (e) => e.code === "WAL_PRESENT");
  assert.deepEqual(M.readManifest(dir), v1);
}

// ─── 3. 품질 검사 실패 → 게시 안 함 ─────────────────────────────────────────
{
  const dir = makeDataDir();
  const v1 = await buildVersion(dir, "v1");
  await M.publishManifest(dir, v1, OK);
  const v2 = await buildVersion(dir, "v2");
  const r = await M.publishManifest(dir, v2, () => ({ ok: false, failures: [{ code: "EXPECTATION_BELOW", detail: "dasan apartment: 50 < 56" }] }));
  assert.equal(r.published, false);
  assert.equal(r.failures[0].code, "EXPECTATION_BELOW");
  assert.deepEqual(M.readManifest(dir), v1);
}

// ─── 4. 두 번째 게시 → 이전본 보관, 롤백 ─────────────────────────────────────
{
  const dir = makeDataDir();
  const v1 = await buildVersion(dir, "v1");
  await M.publishManifest(dir, v1, OK);
  const v2 = await buildVersion(dir, "v2");
  await M.publishManifest(dir, v2, OK);
  assert.deepEqual(M.readManifest(dir), v2);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, M.PREVIOUS_MANIFEST_FILE), "utf8")), v1);
  M.rollbackManifest(dir);
  assert.deepEqual(M.readManifest(dir), v1);

  const fresh = makeDataDir();
  assert.throws(() => M.rollbackManifest(fresh), (e) => e.code === "NO_PREVIOUS");
}

// ─── 5. 데이터 파일은 읽기 전용으로 열린다 ─────────────────────────────────
{
  const dir = makeDataDir();
  const v1 = await buildVersion(dir, "v1");
  await M.publishManifest(dir, v1, OK);
  const db = M.openDataFile(dir, v1, "core");
  assert.throws(() => db.prepare("INSERT INTO data_file_meta (key, value) VALUES ('x','y')").run(), /readonly/);
  db.close();
  assert.throws(() => M.openDataFile(dir, v1, "market"), (e) => e.code === "UNKNOWN_FILE_KEY");
}

// ─── 6. 가비지 수집: 핀 고정본은 남긴다 ─────────────────────────────────────
{
  const dir = makeDataDir();
  const v1 = await buildVersion(dir, "v1");
  const h1 = (await M.publishManifest(dir, v1, OK)).hash;
  await M.publishManifest(dir, await buildVersion(dir, "v2"), OK);
  await M.publishManifest(dir, await buildVersion(dir, "v3"), OK); // 현재 v3, 이전 v2
  mkdirSync(join(dir, "versions", "orphan"), { recursive: true });
  writeFileSync(join(dir, "versions", "orphan", "core.sqlite"), "junk");

  // 모르는 핀 → 아무것도 지우지 않고 중단
  assert.throws(() => M.collectGarbage(dir, new Set(["f".repeat(64)])), (e) => e.code === "MISSING_PINNED_MANIFEST");
  assert.ok(existsSync(join(dir, "versions", "orphan", "core.sqlite")));

  const kept = M.collectGarbage(dir, new Set([h1]));
  assert.ok(existsSync(join(dir, v1.files.core.path)), "핀 고정된 v1 유지");
  assert.ok(existsSync(join(dir, "versions/v2/core.sqlite")), "이전본 v2 유지");
  assert.ok(existsSync(join(dir, "versions/v3/core.sqlite")), "현재본 v3 유지");
  assert.deepEqual(kept.deleted, ["versions/orphan/core.sqlite"]);

  const swept = M.collectGarbage(dir, new Set());
  assert.ok(!existsSync(join(dir, v1.files.core.path)), "핀 해제된 v1 삭제");
  assert.ok(swept.deleted.includes("versions/v1/core.sqlite"));
  assert.ok(swept.deleted.includes(`manifests/${h1}.json`));
}

console.log("✓ v2 manifest");
