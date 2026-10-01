/**
 * 적재 틀 (spec §3.4~3.5).
 * 한 번의 데이터 디렉터리 잠금 안에서 새 버전 파일을 만들고, 원천별 적재 이력과 스냅샷을 남기고,
 * 품질 검사를 통과하면 게시한다. 검사에 걸리면 새 파일은 참조되지 않은 채 남고 다음 GC가 치운다.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { isFilled } from "../a0/measure";
import { REVIEW_SITES } from "../a0/review-sites";
import { abortFeatureBulk, beginFeatureBulk, finishFeatureBulk, queryFeaturesInRadius } from "../data/features";
import {
  openDataFile,
  publishManifestLocked,
  readManifest,
  resolveDataPath,
  sha256File,
  VERSIONS_DIR,
  withDataDirLock,
  type Manifest,
  type ManifestFile,
} from "../data/manifest";
import { checkExpectations, evaluateIngest, type GateFailure, type GateResult, type IngestSnapshot, type SiteExpectation } from "../data/quality-gate";
import { DATA_FILE_KINDS, DATA_SCHEMA_VERSION, initDataFileSchema, type DataFileKind } from "../data/schema";

type Db = BetterSqlite3.Database;

const PROGRESS_EVERY_ROWS = 250_000;
const BUILD_CACHE_SIZE_KIB = 1_048_576; // 1 GiB; negative SQLite values are KiB.
const progressTotals = new Map<string, number>();

interface RestoredPragmas {
  journalMode: string;
  synchronous: number;
  tempStore: number;
  cacheSize: number;
}

/** data-build supplies cheap DBF header totals for ETA without changing gate semantics. */
export function registerIngestProgressTotal(sourceId: string, total: number): void {
  if (!sourceId || !Number.isSafeInteger(total) || total <= 0) throw new RangeError(`invalid progress total for ${sourceId}: ${total}`);
  progressTotals.set(sourceId, total);
}

function duration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "-";
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return `${minutes}m${String(rest).padStart(2, "0")}s`;
}

function buildPragmas(db: Db): RestoredPragmas {
  const original: RestoredPragmas = {
    journalMode: String(db.pragma("journal_mode", { simple: true })),
    synchronous: Number(db.pragma("synchronous", { simple: true })),
    tempStore: Number(db.pragma("temp_store", { simple: true })),
    cacheSize: Number(db.pragma("cache_size", { simple: true })),
  };
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = OFF");
  db.pragma("synchronous = OFF");
  db.pragma("temp_store = MEMORY");
  db.pragma(`cache_size = -${BUILD_CACHE_SIZE_KIB}`);
  return original;
}

function restorePragmas(db: Db, original: RestoredPragmas): void {
  db.pragma(`synchronous = ${original.synchronous}`);
  db.pragma(`temp_store = ${original.tempStore}`);
  db.pragma(`cache_size = ${original.cacheSize}`);
  const journalMode = original.journalMode.toUpperCase();
  if (!["DELETE", "TRUNCATE", "PERSIST", "MEMORY", "OFF", "WAL"].includes(journalMode)) {
    throw new Error(`cannot restore unknown journal_mode ${original.journalMode}`);
  }
  db.pragma(`journal_mode = ${journalMode}`);
}

export interface ReleaseInput {
  sourceId: string;
  provider: string;
  sourceUrl: string;
  sourceAsOf: string | null;
  fetchedAt: string;
  checksum: string;
  licenseCode: string;
  rights?: Record<string, unknown>;
  coverage?: Record<string, unknown>;
}

export function insertRelease(db: Db, r: ReleaseInput): string {
  const releaseId = `${r.sourceId}@${r.sourceAsOf ?? r.fetchedAt.slice(0, 10)}`;
  db.prepare(`INSERT INTO source_release (release_id, source_id, provider, source_url, source_as_of, fetched_at, checksum, schema_version, license_code, rights_json, coverage_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(releaseId, r.sourceId, r.provider, r.sourceUrl, r.sourceAsOf, r.fetchedAt, r.checksum, DATA_SCHEMA_VERSION, r.licenseCode, JSON.stringify(r.rights ?? {}), JSON.stringify(r.coverage ?? {}));
  return releaseId;
}

export class SourceStats {
  received = 0;
  accepted = 0;
  rejected = 0;
  /** 읽었지만 위치를 확정하지 못해 feature로 넣지 않은 레코드 */
  unlocated = 0;
  /** 원천이 페이지 상한에서 잘렸음 (INCOMPLETE_FETCH) */
  pageLimitHit = false;
  /** 원천이 밝힌 전체 건수. 모르면 null */
  totalCountReported: number | null = null;
  readonly byRegion: Record<string, number> = {};
  readonly byType: Record<string, number> = {};
  /** 첫 적재에도 반드시 있어야 하는 지역 코드 (품질 검사 REGION_MISSING) */
  expectedRegions: string[] = [];
  readonly startedAt = new Date().toISOString();
  private readonly filled = new Map<string, number>();
  private readonly progressTotal: number | null;
  private progressNext = PROGRESS_EVERY_ROWS;
  private readonly progressStartedAt = Date.now();

  constructor(readonly sourceId: string, readonly releaseId: string, readonly fillFields: readonly string[]) {
    this.progressTotal = progressTotals.get(sourceId) ?? null;
    progressTotals.delete(sourceId);
  }

  read(): void {
    this.received++;
    if (this.received >= this.progressNext) {
      const elapsed = Math.max((Date.now() - this.progressStartedAt) / 1000, 0.001);
      const rowsPerSecond = this.received / elapsed;
      const total = this.progressTotal;
      const eta = total === null ? "" : ` ETA ${duration(Math.max(0, total - this.received) / Math.max(rowsPerSecond, 0.001))}`;
      console.log(`[ingest] source=${this.sourceId} rows=${this.received}${total === null ? "" : `/${total}`} rows/s=${rowsPerSecond.toFixed(0)} elapsed=${duration(elapsed)}${eta}`);
      this.progressNext += PROGRESS_EVERY_ROWS;
    }
  }

  accept(props: Record<string, unknown>, region: string, type: string): void {
    this.accepted++;
    this.byRegion[region] = (this.byRegion[region] ?? 0) + 1;
    this.byType[type] = (this.byType[type] ?? 0) + 1;
    for (const f of this.fillFields) if (isFilled(props[f])) this.filled.set(f, (this.filled.get(f) ?? 0) + 1);
  }

  reject(): void {
    this.rejected++;
  }

  unlocate(): void {
    this.unlocated++;
  }

  snapshot(): IngestSnapshot {
    const fillRates: Record<string, number> = {};
    for (const f of this.fillFields) fillRates[f] = this.accepted === 0 ? 0 : (this.filled.get(f) ?? 0) / this.accepted;
    return { total: this.accepted, byRegion: { ...this.byRegion }, byType: { ...this.byType }, fillRates };
  }
}

export async function batched<T>(db: Db, items: AsyncIterable<T> | Iterable<T>, fn: (item: T) => void, size = 50_000): Promise<void> {
  let n = 0;
  db.exec("BEGIN");
  try {
    for await (const item of items) {
      fn(item);
      if (++n % size === 0) {
        db.exec("COMMIT");
        db.exec("BEGIN");
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    if (db.inTransaction) db.exec("ROLLBACK");
    throw e;
  }
}

let runSeq = 0;

function recordRun(db: Db, s: SourceStats, finishedAt: string): void {
  db.prepare(`INSERT INTO ingest_run (run_id, source_id, partition_key, started_at, finished_at, status, expected_count, received_count, accepted_count, rejected_count, error_code, release_id, snapshot_json)
    VALUES (?, ?, '', ?, ?, 'succeeded', ?, ?, ?, ?, NULL, ?, ?)`)
    .run(`${s.sourceId}:${s.startedAt}:${runSeq++}`, s.sourceId, s.startedAt, finishedAt, s.totalCountReported, s.received, s.accepted, s.rejected + s.unlocated, s.releaseId, JSON.stringify({ ...s.snapshot(), unlocated: s.unlocated }));
}

export type KindBuilder = (db: Db, ctx: { core: Db | null }) => Promise<SourceStats[]>;

export interface BuildPlan {
  dataDir: string;
  version: string;
  builders: Partial<Record<DataFileKind, KindBuilder>>;
  expectations?: SiteExpectation[];
  /** 이 원천 id들은 이전 스냅샷과 비교하지 않는다(원천 구성이 바뀐 첫 재빌드용). 나머지 원천은 그대로 검사한다. */
  resetBaseline?: string[];
}

export interface BuildOutcome {
  published: boolean;
  /** 이전 스냅샷 비교를 건너뛴 원천 id */
  baselineReset: string[];
  hash: string;
  failures: GateFailure[];
  files: Record<string, ManifestFile>;
  stats: Record<string, SourceStats[]>;
}
function previousSnapshot(db: Db, sourceId: string): IngestSnapshot | null {

  const cols = db.prepare("PRAGMA table_info(ingest_run)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "snapshot_json")) return null; // 스키마 v1 파일
  const json = db
    .prepare("SELECT snapshot_json FROM ingest_run WHERE source_id = ? AND status = 'succeeded' ORDER BY finished_at DESC LIMIT 1")
    .pluck()
    .get(sourceId) as string | null | undefined;
  return json ? (JSON.parse(json) as IngestSnapshot) : null; // 오류는 전파한다
}

function countNearSite(dataDir: string, m: Manifest, siteId: string, kind: string): number {
  const site = REVIEW_SITES.find((s) => s.id === siteId);
  if (!site) throw new Error(`unknown review site ${siteId}`);
  let total = 0;
  for (const [key, file] of Object.entries(m.files)) {
    if (!(DATA_FILE_KINDS as readonly string[]).includes(file.kind)) continue;
    const db = openDataFile(dataDir, m, key);
    try {
      total += queryFeaturesInRadius(db, site.center, 1000, [kind]).length;
    } finally {
      db.close();
    }
  }
  return total;
}

function gate(plan: BuildPlan, previous: Manifest | null, stats: Record<string, SourceStats[]>, candidate: Manifest, baselineReset: string[]): GateResult {
  const failures: GateFailure[] = [];
  for (const [kind, list] of Object.entries(stats)) {
    const prevDb = previous?.files[kind] ? openDataFile(plan.dataDir, previous, kind) : null;
    try {
      for (const s of list) {
        const reset = plan.resetBaseline?.includes(s.sourceId) ?? false;
        if (reset) {
          console.log(`baseline reset: ${s.sourceId}`);
          baselineReset.push(s.sourceId);
        }
        const r = evaluateIngest({
          responseRowsReported: s.received,
          parsedRows: s.accepted,
          pageLimitHit: s.pageLimitHit,
          totalCountReported: null, // 아래에서 받은 행(received)과 직접 비교한다
          next: s.snapshot(),
          previous: prevDb && !reset ? previousSnapshot(prevDb, s.sourceId) : null,
          expectedRegions: s.expectedRegions,
        });
        for (const f of r.failures) failures.push({ code: f.code, detail: `${s.sourceId}: ${f.detail}` });
        // 원천이 밝힌 전체 건수는 읽은 행(received)과 견준다: accepted에는 reject·unlocated 행이 빠져 있다.
        // (quality-gate의 totalCountReported 검사는 parsedRows 기준이라 여기서는 쓰지 않는다.)
        if (s.totalCountReported !== null && s.totalCountReported !== s.received) {
          failures.push({ code: "INCOMPLETE_FETCH", detail: `${s.sourceId}: totalCount ${s.totalCountReported} != received ${s.received}` });
        }
      }
    } finally {
      prevDb?.close();
    }
  }
  if (plan.expectations && plan.expectations.length > 0) {
    failures.push(...checkExpectations(plan.expectations, (siteId, kind) => countNearSite(plan.dataDir, candidate, siteId, kind)).failures);
  }
  return { ok: failures.length === 0, failures };
}

// buildings·parcels는 core 다음: 같은 실행에서 core를 만들었으면 그 파일을, 아니면 매니페스트의 현재 core를 읽기 전용으로 받는다.
const BUILD_ORDER: readonly DataFileKind[] = ["core", "buildings", "parcels", "reference", "market", "osm", "terrain", "weather"];

export function buildAndPublish(plan: BuildPlan): Promise<BuildOutcome> {
  return withDataDirLock(plan.dataDir, async () => {
    const current = readManifest(plan.dataDir);
    const files: Record<string, ManifestFile> = {};
    const stats: Record<string, SourceStats[]> = {};
    const versionDir = resolveDataPath(plan.dataDir, `${VERSIONS_DIR}/${plan.version}`);
    if (existsSync(versionDir)) throw new Error(`${VERSIONS_DIR}/${plan.version} already exists; choose a new version name`);
    const handles: Db[] = [];
    let core: Db | null = null;
    try {
      if (!plan.builders.core && current?.files.core) {
        core = openDataFile(plan.dataDir, current, "core");
        handles.push(core);
      }
      for (const kind of BUILD_ORDER) {
        const builder = plan.builders[kind];
        if (!builder) continue;
        const rel = `${VERSIONS_DIR}/${plan.version}/${kind}.sqlite`;
        const abs = resolveDataPath(plan.dataDir, rel);
        mkdirSync(dirname(abs), { recursive: true });
        const db = new Database(abs);
        handles.push(db);
        const originalPragmas = buildPragmas(db);
        let bulkStarted = false;
        let pragmasRestored = false;
        try {
          initDataFileSchema(db, kind);
          beginFeatureBulk(db);
          bulkStarted = true;
          const kindStats = await builder(db, { core });
          finishFeatureBulk(db);
          bulkStarted = false;
          const finishedAt = new Date().toISOString();
          for (const s of kindStats) recordRun(db, s, finishedAt);
          stats[kind] = kindStats;
          files[kind] = { path: rel, sha256: "", kind, schemaVersion: DATA_SCHEMA_VERSION };
          restorePragmas(db, originalPragmas);
          pragmasRestored = true;
          if (kind === "core") core = db;
        } finally {
          if (bulkStarted) abortFeatureBulk(db);
          if (!pragmasRestored) restorePragmas(db, originalPragmas);
        }
      }
    } finally {
      for (const db of handles) db.close();
    }
    for (const f of Object.values(files)) f.sha256 = await sha256File(resolveDataPath(plan.dataDir, f.path));
    const candidate: Manifest = { version: plan.version, createdAt: new Date().toISOString(), files: { ...(current?.files ?? {}), ...files } };
    const baselineReset: string[] = [];
    const result = await publishManifestLocked(plan.dataDir, candidate, (m) => gate(plan, current, stats, m, baselineReset));
    return { ...result, files, stats, baselineReset };
  });
}
