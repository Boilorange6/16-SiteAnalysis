/**
 * manifest 게시 테스트 (spec §3.4).
 * 어떤 실패에서도 현재 manifest는 직전 정상본이어야 하고,
 * 저장된 프로젝트가 쓰는 옛 버전 파일은 지워지면 안 된다.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
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
async function buildVersion(dataDir, version, { wal = false } = {}) {
  const rel = `versions/${version}/core.sqlite`;
  const abs = join(dataDir, rel);
  mkdirSync(join(dataDir, "versions", version), { recursive: true });
  const db = new Database(abs);
  if (wal) db.pragma("journal_mode = WAL");
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
  await M.rollbackManifest(dir);
  assert.deepEqual(M.readManifest(dir), v1);

  const fresh = makeDataDir();
  await assert.rejects(M.rollbackManifest(fresh), (e) => e.code === "NO_PREVIOUS");
}

// ─── 4b. 롤백은 깨진/불완전한 이전본을 설치하지 않는다 ───────────────────────
{
  const dir = makeDataDir();
  await M.publishManifest(dir, await buildVersion(dir, "v1"), OK);
  const v2 = await buildVersion(dir, "v2");
  await M.publishManifest(dir, v2, OK);
  const prevPath = join(dir, M.PREVIOUS_MANIFEST_FILE);
  const good = readFileSync(prevPath, "utf8");
  writeFileSync(prevPath, good.slice(0, 20));
  await assert.rejects(M.rollbackManifest(dir), (e) => e.code === "NO_PREVIOUS");
  assert.deepEqual(M.readManifest(dir), v2, "깨진 prev면 현재본 유지");
  writeFileSync(prevPath, good);
  rmSync(join(dir, "versions/v1/core.sqlite"));
  await assert.rejects(M.rollbackManifest(dir), (e) => e.code === "MISSING_FILE");
  assert.deepEqual(M.readManifest(dir), v2, "파일이 없는 prev면 현재본 유지");
}

// ─── 4c. 같은 manifest 재게시는 prev를 덮어쓰지 않는다 ───────────────────────
{
  const dir = makeDataDir();
  const v1 = await buildVersion(dir, "v1");
  await M.publishManifest(dir, v1, OK);
  const v2 = await buildVersion(dir, "v2");
  await M.publishManifest(dir, v2, OK);
  await M.publishManifest(dir, v2, OK);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, M.PREVIOUS_MANIFEST_FILE), "utf8")), v1);
}

// ─── 4d. 정규형이 아닌 경로는 거부 (GC가 살아 있는 파일을 지우던 문제) ─────────
{
  const dir = makeDataDir();
  const v1 = await buildVersion(dir, "v1");
  for (const p of ["versions/v1/./core.sqlite", "versions/v1//core.sqlite", "versions/x/../v1/core.sqlite", "versions/v1\\core.sqlite"]) {
    const m = { ...v1, files: { core: { ...v1.files.core, path: p } } };
    await assert.rejects(M.publishManifest(dir, m, OK), (e) => e.code === "PATH_ESCAPE", p);
  }
  assert.equal(M.readManifest(dir), null);
}

// ─── 4e. 잠금 ─────────────────────────────────────────────────────────────
{
  const dir = makeDataDir();
  const v1 = await buildVersion(dir, "v1");
  await M.publishManifest(dir, v1, OK);
  assert.equal(existsSync(join(dir, ".lock")), false, "게시 후 잠금 없음");
  const v2 = await buildVersion(dir, "v2");
  mkdirSync(join(dir, "versions", "orphan"), { recursive: true });
  writeFileSync(join(dir, "versions", "orphan", "core.sqlite"), "junk");

  writeFileSync(join(dir, ".lock"), "other");
  await assert.rejects(M.publishManifest(dir, v2, OK), (e) => e.code === "LOCKED" && e.message.includes(".lock"));
  await assert.rejects(M.collectGarbage(dir, new Set()), (e) => e.code === "LOCKED");
  assert.deepEqual(M.readManifest(dir), v1);
  assert.ok(existsSync(join(dir, "versions", "orphan", "core.sqlite")));
  assert.ok(existsSync(join(dir, "versions/v2/core.sqlite")));
  assert.equal(readFileSync(join(dir, ".lock"), "utf8"), "other", "남의 잠금은 건드리지 않는다");
  rmSync(join(dir, ".lock"));

  await M.collectGarbage(dir, new Set());
  assert.equal(existsSync(join(dir, ".lock")), false, "GC 후 잠금 없음");
  await assert.rejects(M.withDataDirLock(dir, () => { throw new Error("boom"); }), /boom/);
  assert.equal(existsSync(join(dir, ".lock")), false, "실패해도 잠금 해제");
}

// ─── 4f. 검사 도중 파일이 사라지면 게시하지 않는다 ───────────────────────────
{
  const dir = makeDataDir();
  const v1 = await buildVersion(dir, "v1");
  await M.publishManifest(dir, v1, OK);
  const v2 = await buildVersion(dir, "v2");
  const deleting = () => { rmSync(join(dir, v2.files.core.path)); return { ok: true, failures: [] }; };
  await assert.rejects(M.publishManifest(dir, v2, deleting), (e) => e.code === "MISSING_FILE");
  assert.deepEqual(M.readManifest(dir), v1);
  assert.equal(existsSync(join(dir, M.PREVIOUS_MANIFEST_FILE)), false);
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
  await assert.rejects(M.collectGarbage(dir, new Set(["f".repeat(64)])), (e) => e.code === "MISSING_PINNED_MANIFEST");
  await assert.rejects(M.collectGarbage(dir, new Set(["../manifest"])), (e) => e.code === "MISSING_PINNED_MANIFEST");
  assert.ok(existsSync(join(dir, "versions", "orphan", "core.sqlite")));

  const kept = await M.collectGarbage(dir, new Set([h1]));
  assert.ok(existsSync(join(dir, v1.files.core.path)), "핀 고정된 v1 유지");
  assert.ok(existsSync(join(dir, "versions/v2/core.sqlite")), "이전본 v2 유지");
  assert.ok(existsSync(join(dir, "versions/v3/core.sqlite")), "현재본 v3 유지");
  assert.deepEqual(kept.deleted, ["versions/orphan/core.sqlite"]);

  const swept = await M.collectGarbage(dir, new Set());
  assert.ok(!existsSync(join(dir, v1.files.core.path)), "핀 해제된 v1 삭제");
  assert.ok(swept.deleted.includes("versions/v1/core.sqlite"));
  assert.ok(swept.deleted.includes(`manifests/${h1}.json`));
}

// ─── 7. WAL 모드 파일은 게시 거부 (읽기 전용 open이 -wal/-shm을 만든다) ────────
{
  const dir = makeDataDir();
  const v1 = await buildVersion(dir, "v1");
  await M.publishManifest(dir, v1, OK);
  const w = await buildVersion(dir, "v2", { wal: true });
  assert.equal(existsSync(join(dir, w.files.core.path) + "-wal"), false, "닫으면 -wal은 없지만 헤더는 WAL");
  await assert.rejects(M.publishManifest(dir, w, OK), (e) => e.code === "WAL_MODE");
  assert.deepEqual(M.readManifest(dir), v1);
}

// ─── 8. 빌더는 잠금 안에서 게시하고, 바깥 GC는 LOCKED ───────────────────────
{
  const dir = makeDataDir();
  await M.publishManifest(dir, await buildVersion(dir, "v1"), OK);
  let gcError;
  let v2;
  await M.withDataDirLock(dir, async () => {
    v2 = await buildVersion(dir, "v2");
    await assert.rejects(M.publishManifest(dir, v2, OK), (e) => e.code === "LOCKED", "잠금 안에서 잠그는 publish는 LOCKED");
    await M.collectGarbage(dir, new Set()).catch((e) => { gcError = e; });
    const r = await M.publishManifestLocked(dir, v2, OK);
    assert.equal(r.published, true);
  });
  assert.equal(gcError?.code, "LOCKED", "빌드 중 바깥 GC는 LOCKED");
  assert.deepEqual(M.readManifest(dir), v2);
  assert.ok(existsSync(join(dir, v2.files.core.path)));
  await M.withDataDirLock(dir, () => M.rollbackManifestLocked(dir));
  assert.equal(M.readManifest(dir).version, "v1");
  await assert.rejects(M.withDataDirLock(dir, () => M.rollbackManifest(dir)), (e) => e.code === "LOCKED");
}

// ─── 9. 열려 있는 파일은 skipped로 보고하고 GC는 계속한다 (Windows 파일 잠금) ──
{
  const dir = makeDataDir();
  await M.publishManifest(dir, await buildVersion(dir, "v1"), OK);
  await M.publishManifest(dir, await buildVersion(dir, "v2"), OK);
  await M.publishManifest(dir, await buildVersion(dir, "v3"), OK); // v1은 수집 대상
  mkdirSync(join(dir, "versions", "zz"), { recursive: true });
  writeFileSync(join(dir, "versions", "zz", "core.sqlite"), "junk");
  const held = new Database(join(dir, "versions/v1/core.sqlite"), { readonly: true });
  try {
    const r = await M.collectGarbage(dir, new Set());
    if (process.platform === "win32") {
      assert.deepEqual(r.skipped, ["versions/v1/core.sqlite"], "열린 v1은 건너뜀");
      assert.ok(r.deleted.includes("versions/zz/core.sqlite"), "뒤 파일은 계속 지운다");
    } else {
      assert.deepEqual(r.skipped, []);
    }
  } finally {
    held.close();
  }
  const again = await M.collectGarbage(dir, new Set());
  assert.deepEqual(again.skipped, []);
  assert.ok(!existsSync(join(dir, "versions/v1/core.sqlite")), "닫은 뒤 다음 GC가 지운다");
}

// ─── 10. POST_PUBLISH_MISMATCH: 게시 전 상태로 복원 ─────────────────────────
{
  // 이전본 없음(첫 게시): manifest.json을 남기지 않는다
  const dir = makeDataDir();
  const v1 = await buildVersion(dir, "v1");
  await assert.rejects(M.publishManifest(dir, v1, OK, { reread: () => null }), (e) => e.code === "POST_PUBLISH_MISMATCH");
  assert.equal(M.readManifest(dir), null);

  // 이전본 있음: 직전 정상본으로 복원
  await M.publishManifest(dir, v1, OK);
  const v2 = await buildVersion(dir, "v2");
  await assert.rejects(M.publishManifest(dir, v2, OK, { reread: () => v1 }), (e) => e.code === "POST_PUBLISH_MISMATCH");
  assert.deepEqual(M.readManifest(dir), v1);
  assert.equal(existsSync(join(dir, M.PREVIOUS_MANIFEST_FILE)), false, "prev도 게시 전 상태(없음)로");

  // 같은 해시 재게시 불일치: 옛 버전이 아니라 게시 전 현재본(v2)으로 복원, prev는 v1 그대로
  await M.publishManifest(dir, v2, OK);
  await assert.rejects(M.publishManifest(dir, v2, OK, { reread: () => v1 }), (e) => e.code === "POST_PUBLISH_MISMATCH");
  assert.deepEqual(M.readManifest(dir), v2);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, M.PREVIOUS_MANIFEST_FILE), "utf8")), v1);
}

// ─── 11. P0 이월: 핀은 잠금 안에서 계산, 손으로 고친 경로 거부, 깨진 현재본 ──
{
  // (a) 핀 함수는 잠금을 쥔 상태에서 불린다 → 저장과 GC 사이 경합이 없다
  const dir = makeDataDir();
  await M.publishManifest(dir, await buildVersion(dir, "v1"), OK);
  let lockSeen = null;
  await M.collectGarbage(dir, () => {
    lockSeen = existsSync(join(dir, ".lock"));
    return new Set();
  });
  assert.equal(lockSeen, true, "핀 함수는 잠금 안에서 평가된다");
  assert.equal(existsSync(join(dir, ".lock")), false);
}
{
  // (b) 손으로 고친 manifest.json의 비정규 경로 → GC는 아무것도 지우지 않고 거부
  const dir = makeDataDir();
  const v1 = await buildVersion(dir, "v1");
  await M.publishManifest(dir, v1, OK);
  const edited = { ...v1, files: { core: { ...v1.files.core, path: "versions/v1/./core.sqlite" } } };
  writeFileSync(join(dir, M.MANIFEST_FILE), JSON.stringify(edited));
  await assert.rejects(M.collectGarbage(dir, new Set()), (e) => e.code === "PATH_ESCAPE");
  assert.ok(existsSync(join(dir, "versions/v1/core.sqlite")), "살아 있는 파일을 지우지 않는다");
}
{
  // (c) 현재 manifest.json이 깨져 있으면 prev를 덮지 않는다(유일한 롤백 대상 보존)
  const dir = makeDataDir();
  const v1 = await buildVersion(dir, "v1");
  const v2 = await buildVersion(dir, "v2");
  await M.publishManifest(dir, v1, OK);
  await M.publishManifest(dir, v2, OK); // prev = v1
  const prevBefore = readFileSync(join(dir, M.PREVIOUS_MANIFEST_FILE), "utf8");
  writeFileSync(join(dir, M.MANIFEST_FILE), "{ broken");
  const v3 = await buildVersion(dir, "v3");
  const r = await M.publishManifest(dir, v3, OK);
  assert.equal(r.published, true);
  assert.equal(readFileSync(join(dir, M.PREVIOUS_MANIFEST_FILE), "utf8"), prevBefore, "prev는 v1 그대로");
  assert.deepEqual(M.readManifest(dir), v3);
}

console.log("✓ v2 manifest");
