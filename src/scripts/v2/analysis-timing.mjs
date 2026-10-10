/**
 * 게시본과 임시 앱 DB만 사용해 가벼운 타일 합계·무거운 타일별 콜드/웜 시간을 표로 낸다.
 *
 *   V2_DATA_DIR=<게시 데이터> npx tsx src/scripts/v2/analysis-timing.mjs \
 *     --address "서울특별시 강동구 고덕동 250" --radius 800
 *
 * 첫 실행은 무거운 타일 작업자를 직접 실행하고, 두 번째 실행은 같은 앱 DB에서
 * 캐시를 재사용한다. 데이터 디렉터리에는 쓰지 않는다.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { openV2AppDb } = await import("../../lib/v2/app-db.ts");
const { manifestHash, readManifest } = await import("../../lib/v2/data/manifest.ts");
const { closeDataFilePool } = await import("../../lib/v2/data/file-pool.ts");
const { runAnalysis } = await import("../../lib/v2/engine/run.ts");
const { HEAVY_TILES, runHeavyTiles } = await import("../../lib/v2/engine/jobs.ts");
const { TILE_CODES } = await import("../../lib/v2/ui/tile-catalog.ts");
const { listJobs } = await import("../../lib/v2/engine/jobs-store.ts");
const { measureElapsed, sumTimings } = await import("../../lib/v2/engine/timing.ts");
const { v2DataDir } = await import("../../lib/v2/paths.ts");

const args = process.argv.slice(2);
const option = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};
const address = String(option("address", "서울특별시 강동구 고덕동 250")).trim();
const radiusM = Number(option("radius", "800"));
if (!address) throw new Error("--address가 필요합니다");
if (!Number.isFinite(radiusM) || radiusM <= 0) throw new Error("--radius는 양수여야 합니다");

const dataDir = v2DataDir();
const manifest = readManifest(dataDir);
if (!manifest) throw new Error(`no published manifest in ${dataDir}`);
const publishedHash = manifestHash(manifest);
const temporaryDir = mkdtempSync(join(tmpdir(), "v2-analysis-timing-"));
const appDb = openV2AppDb(join(temporaryDir, "app.sqlite"));
const input = { address, radiusM, analysisDate: new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }) };
const lightCodes = TILE_CODES.filter((code) => !HEAVY_TILES.includes(code));

function requireOutcome(outcome, phase) {
  if (!outcome.ok) throw new Error(`${phase}: 분석 실패(${outcome.reason})`);
  return outcome;
}

function jobElapsed(analysisId, code) {
  const job = listJobs(appDb, analysisId).find((candidate) => candidate.code === code);
  return { elapsedMs: job?.elapsedMs ?? null, status: job?.status ?? "not_queued" };
}

try {
  const cold = requireOutcome(measureElapsed(() => runAnalysis(appDb, dataDir, input)).value, "cold POST");
  const coldWorker = measureElapsed(() => runHeavyTiles(appDb, dataDir, cold.analysisId));
  const coldHeavy = new Map(HEAVY_TILES.map((code) => [code, jobElapsed(cold.analysisId, code)]));

  const warmMeasured = measureElapsed(() => runAnalysis(appDb, dataDir, input));
  const warm = requireOutcome(warmMeasured.value, "warm POST");
  // A missing warm cache can only happen when the first worker failed or a future
  // tile was added; execute those queued jobs so the table remains truthful.
  if (warm.queued.length > 0) runHeavyTiles(appDb, dataDir, warm.analysisId);
  const warmHeavy = new Map(HEAVY_TILES.map((code) => {
    const job = jobElapsed(warm.analysisId, code);
    return [code, job.status === "not_queued" ? { elapsedMs: warm.timingsMs.tiles[code] ?? null, status: "cached" } : job];
  }));

  const currentManifest = readManifest(dataDir);
  if (!currentManifest || manifestHash(currentManifest) !== publishedHash) {
    throw new Error("측정 중 게시 manifest가 바뀌어 동일 데이터 비교를 중단했습니다");
  }

  const rows = [
    {
      group: "light",
      code: "합계",
      coldMs: sumTimings(cold.timingsMs.tiles, lightCodes),
      warmMs: sumTimings(warm.timingsMs.tiles, lightCodes),
      coldStatus: `${cold.computed.length}개 계산`,
      warmStatus: `${warm.reused.filter((code) => lightCodes.includes(code)).length}개 캐시`,
    },
    ...HEAVY_TILES.map((code) => {
      const coldSample = coldHeavy.get(code);
      const warmSample = warmHeavy.get(code);
      return {
        group: "heavy",
        code,
        coldMs: coldSample?.elapsedMs ?? null,
        warmMs: warmSample?.elapsedMs ?? null,
        coldStatus: coldSample?.status ?? "unknown",
        warmStatus: warmSample?.status ?? "unknown",
      };
    }),
  ];
  const text = [
    "# v2 analysis timing",
    "",
    `address=${address} · radius_m=${radiusM} · manifest=${publishedHash.slice(0, 12)}`,
    "cold = 새 임시 앱 DB에서 POST 후 무거운 타일 작업자 직접 실행, warm = 같은 앱 DB에서 캐시 재사용",
    `cold worker wall_ms=${coldWorker.elapsedMs}`,
    "",
    "| 구분 | 타일 | cold_ms | warm_ms | cold 상태 | warm 상태 |",
    "|---|---|---:|---:|---|---|",
    ...rows.map((row) => `| ${row.group} | ${row.code} | ${row.coldMs ?? "-"} | ${row.warmMs ?? "-"} | ${row.coldStatus} | ${row.warmStatus} |`),
    "",
    `cold_analysis=${cold.analysisId} · warm_analysis=${warm.analysisId}`,
  ].join("\n");
  console.log(text);
} finally {
  appDb.close();
  closeDataFilePool();
  rmSync(temporaryDir, { recursive: true, force: true });
}
