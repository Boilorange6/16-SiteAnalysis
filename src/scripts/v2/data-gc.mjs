/**
 * 게시 데이터 GC: 현재·이전 매니페스트와 앱 DB가 고정한 버전 밖의 파일을 지운다.
 *   V2_DATA_DIR=<데이터 디렉터리> npx tsx src/scripts/v2/data-gc.mjs [--app-db a.sqlite,b.sqlite]
 * 같은 데이터 디렉터리를 쓰는 앱 DB가 여럿이면 모두 넘긴다(핀 합집합). 기본은 현재 작업 폴더의 앱 DB.
 * 빌드가 잠금을 쥐고 있으면 LOCKED로 끝난다(기다리지 않는다).
 */
const { collectGarbageLocked, withDataDirLock } = await import("../../lib/v2/data/manifest.ts");
const { openV2AppDb, pinnedManifestHashes } = await import("../../lib/v2/app-db.ts");
const { v2DataDir } = await import("../../lib/v2/paths.ts");
const { recordGcSkipped } = await import("../../lib/v2/data/gc-state.ts");

const args = process.argv.slice(2);
const paths = args.includes("--app-db") ? args[args.indexOf("--app-db") + 1].split(",") : [undefined];
const dbs = paths.map((p) => openV2AppDb(p));
try {
  const dataDir = v2DataDir();
  const { deleted, skipped, warnings } = await withDataDirLock(dataDir, () => {
    const pins = new Set(dbs.flatMap((db) => [...pinnedManifestHashes(db)]));
    const result = collectGarbageLocked(dataDir, pins);
    const warningItems = recordGcSkipped(dataDir, result.skipped);
    return { ...result, warnings: warningItems };
  });
  for (const f of deleted) console.log("deleted", f);
  for (const f of skipped) console.log("skipped (in use)", f);
  for (const warning of warnings) console.warn(`warning: GC skipped ${warning.path} for ${warning.consecutive} consecutive runs`);
  console.log(`gc: deleted ${deleted.length} · skipped ${skipped.length}`);
} finally {
  for (const db of dbs) db.close();
}
