/**
 * 적재 틀 (spec §3.4~3.5).
 * 한 번의 데이터 디렉터리 잠금 안에서 새 버전 파일을 만들고, 원천별 적재 이력과 스냅샷을 남기고,
 * 품질 검사를 통과하면 게시한다. 검사에 걸리면 새 파일은 참조되지 않은 채 남고 다음 GC가 치운다.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { isFilled } from "../a0/measure";
import { REVIEW_SITES } from "../a0/review-sites";
import {
  abortFeatureBulk,
  beginFeatureBulk,
  dropFeatureBulkStaging,
  finishFeatureBulk,
  queryFeaturesInRadius,
} from "../data/features";
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
import { checkExpectations, evaluateIngest, type GateFailure, type GateFailureCode, type GateResult, type IngestSnapshot, type SiteExpectation } from "../data/quality-gate";
import { DATA_FILE_KINDS, DATA_SCHEMA_VERSION, initDataFileSchema, type DataFileKind } from "../data/schema";

type Db = BetterSqlite3.Database;

type IntegrityFailure = { code: GateFailureCode; detail: string };

export interface SqliteIntegrityResult {
  ok: boolean;
  failures: IntegrityFailure[];
  elapsedMs: number;
  sizeBytes: number;
  pageCount: number | null;
  rtreeMode: "rtreecheck" | "sample" | "none";
}

function tableExists(db: Db, name: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE name = ? LIMIT 1").get(name) !== undefined;
}

function* geometryPositions(value: unknown): Generator<[number, number]> {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === "number" && typeof value[1] === "number") {
    yield [value[0], value[1]];
    return;
  }
  for (const child of value) yield* geometryPositions(child);
}

function geometryBbox(json: string): [number, number, number, number] {
  const geometry = JSON.parse(json) as { coordinates?: unknown };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of geometryPositions(geometry.coordinates)) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("geometry contains a non-finite coordinate");
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (minX === Infinity) throw new Error("geometry has no coordinates");
  return [minX, minY, maxX, maxY];
}

function checkRtreeSamples(db: Db, sampleLimit: number): IntegrityFailure[] {
  const failures: IntegrityFailure[] = [];
  const count = Number(db.prepare("SELECT COUNT(*) FROM feature").pluck().get());
  const rtreeCount = Number(db.prepare("SELECT COUNT(*) FROM feature_rtree").pluck().get());
  if (count !== rtreeCount) {
    failures.push({ code: "RTREE_INTEGRITY", detail: `feature rows ${count} != feature_rtree rows ${rtreeCount}` });
    return failures;
  }
  if (count === 0) return failures;

  const bounds = db.prepare("SELECT MIN(feature_id) AS minId, MAX(feature_id) AS maxId FROM feature").get() as { minId: number; maxId: number };
  const samples = Math.max(1, Math.min(sampleLimit, count));
  const targets = Array.from({ length: samples }, (_, index) =>
    samples === 1 ? bounds.minId : Math.round(bounds.minId + (bounds.maxId - bounds.minId) * (index / (samples - 1))),
  );
  const seen = new Set<number>();
  for (const target of targets) {
    const feature = db.prepare("SELECT feature_id, geom_json FROM feature WHERE feature_id >= ? ORDER BY feature_id LIMIT 1").get(target) as { feature_id: number; geom_json: string } | undefined;
    if (!feature || seen.has(feature.feature_id)) continue;
    seen.add(feature.feature_id);
    const rtree = db.prepare("SELECT min_x, max_x, min_y, max_y FROM feature_rtree WHERE feature_id = ?").get(feature.feature_id) as { min_x: number; max_x: number; min_y: number; max_y: number } | undefined;
    if (!rtree) {
      failures.push({ code: "RTREE_INTEGRITY", detail: `feature_id ${feature.feature_id} has no R*Tree row` });
      continue;
    }
    try {
      const [minX, minY, maxX, maxY] = geometryBbox(feature.geom_json);
      const tolerance = (value: number) => Math.max(0.01, Math.abs(value) * 1e-7);
      if (rtree.min_x > minX + tolerance(minX) || rtree.max_x < maxX - tolerance(maxX) || rtree.min_y > minY + tolerance(minY) || rtree.max_y < maxY - tolerance(maxY)) {
        failures.push({ code: "RTREE_INTEGRITY", detail: `feature_id ${feature.feature_id} bbox does not cover geometry` });
      }
    } catch (error) {
      failures.push({ code: "RTREE_INTEGRITY", detail: `feature_id ${feature.feature_id} bbox sample failed: ${String(error instanceof Error ? error.message : error)}` });
    }
  }
  return failures;
}

function checkRtree(db: Db): { failures: IntegrityFailure[]; mode: SqliteIntegrityResult["rtreeMode"] } {
  if (!tableExists(db, "feature") || !tableExists(db, "feature_rtree")) return { failures: [], mode: "none" };
  const failures: IntegrityFailure[] = [];
  const count = Number(db.prepare("SELECT COUNT(*) FROM feature").pluck().get());
  const rtreeCount = Number(db.prepare("SELECT COUNT(*) FROM feature_rtree").pluck().get());
  if (count !== rtreeCount) failures.push({ code: "RTREE_INTEGRITY", detail: `feature rows ${count} != feature_rtree rows ${rtreeCount}` });
  try {
    const row = db.prepare("SELECT rtreecheck('feature_rtree') AS result").get() as { result: unknown };
    if (String(row?.result ?? "") !== "ok") failures.push({ code: "RTREE_INTEGRITY", detail: `rtreecheck(feature_rtree) returned ${String(row?.result ?? "<empty>")}` });
    return { failures, mode: "rtreecheck" };
  } catch (error) {
    if (!/no such function\s*:\s*rtreecheck/i.test(String(error))) {
      failures.push({ code: "RTREE_INTEGRITY", detail: `rtreecheck(feature_rtree) failed: ${String(error instanceof Error ? error.message : error)}` });
      return { failures, mode: "rtreecheck" };
    }
    failures.push(...checkRtreeSamples(db, 32));
    return { failures, mode: "sample" };
  }
}

/** 게시 직전 SQLite 파일의 전체 무결성·FK·공간 인덱스를 검사한다. */
export function checkSqliteIntegrity(path: string): SqliteIntegrityResult {
  const started = process.hrtime.bigint();
  const failures: IntegrityFailure[] = [];
  let sizeBytes = 0;
  let pageCount: number | null = null;
  let rtreeMode: SqliteIntegrityResult["rtreeMode"] = "none";
  try {
    sizeBytes = statSync(path).size;
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try {
      db.pragma("foreign_keys = ON");
      pageCount = Number(db.pragma("page_count", { simple: true }));
      const integrityRows = db.prepare("PRAGMA integrity_check").all() as Array<Record<string, unknown>>;
      const integrityMessages = integrityRows.map((row) => String(Object.values(row)[0] ?? ""));
      if (integrityMessages.length !== 1 || integrityMessages[0] !== "ok") {
        failures.push({ code: "SQLITE_INTEGRITY", detail: `PRAGMA integrity_check: ${integrityMessages.join("; ") || "no result"}` });
      }
      const foreignRows = db.prepare("PRAGMA foreign_key_check").all() as Array<Record<string, unknown>>;
      if (foreignRows.length > 0) {
        failures.push({ code: "FOREIGN_KEY", detail: `PRAGMA foreign_key_check returned ${foreignRows.length} row(s): ${JSON.stringify(foreignRows.slice(0, 8))}` });
      }
      const rtree = checkRtree(db);
      failures.push(...rtree.failures);
      rtreeMode = rtree.mode;
    } finally {
      db.close();
    }
  } catch (error) {
    failures.push({ code: "SQLITE_INTEGRITY", detail: `SQLite integrity inspection failed: ${String(error instanceof Error ? error.message : error)}` });
  }
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  return { ok: failures.length === 0, failures, elapsedMs, sizeBytes, pageCount, rtreeMode };
}

const PROGRESS_EVERY_ROWS = 250_000;
const HEARTBEAT_MS = 60_000;
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

function clearIngestProgressTotal(sourceId: string): void {
  progressTotals.delete(sourceId);
}

// 셸이 죽어도 진행 상황이 남도록 로그 파일에 먼저 덧붙인다(stdout이 닫혀 있어도 빌드는 계속된다).
const logFiles = new Set<string>();
let stdoutGuarded = false;

/** 진행 로그를 이 파일에도 덧붙인다. 반환값은 해제 함수. */
export function addBuildLog(file: string): () => void {
  mkdirSync(dirname(file), { recursive: true });
  logFiles.add(file);
  return () => void logFiles.delete(file);
}

export function progressLog(message: string): void {
  const line = `${new Date().toISOString()} ${message}\n`;
  for (const file of logFiles) {
    try {
      appendFileSync(file, line);
    } catch {
      // 로그 때문에 빌드를 죽이지 않는다
    }
  }
  if (!stdoutGuarded) {
    stdoutGuarded = true;
    process.stdout.on("error", () => {});
  }
  try {
    process.stdout.write(`${message}\n`);
  } catch {
    // stdout이 닫힘
  }
}

function duration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "-";
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return `${minutes}m${String(rest).padStart(2, "0")}s`;
}

function buildPragmas(db: Db, resumable: boolean): RestoredPragmas {
  const original: RestoredPragmas = {
    journalMode: String(db.pragma("journal_mode", { simple: true })),
    synchronous: Number(db.pragma("synchronous", { simple: true })),
    tempStore: Number(db.pragma("temp_store", { simple: true })),
    cacheSize: Number(db.pragma("cache_size", { simple: true })),
  };
  db.pragma("foreign_keys = ON");
  // The ordinary one-shot build can use the faster unsafe mode. Resumable
  // builds must commit each source file atomically, so keep a rollback journal
  // while retaining the large cache/temp-store settings.
  db.pragma(`journal_mode = ${resumable ? "DELETE" : "OFF"}`);
  db.pragma(`synchronous = ${resumable ? "NORMAL" : "OFF"}`);
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(release_id) DO NOTHING`)
    .run(releaseId, r.sourceId, r.provider, r.sourceUrl, r.sourceAsOf, r.fetchedAt, r.checksum, DATA_SCHEMA_VERSION, r.licenseCode, JSON.stringify(r.rights ?? {}), JSON.stringify(r.coverage ?? {}));
  return releaseId;
}

export interface SourceStatsProgress {
  received: number;
  accepted: number;
  rejected: number;
  unlocated: number;
  pageLimitHit: boolean;
  totalCountReported: number | null;
  byRegion: Record<string, number>;
  byType: Record<string, number>;
  filled: Record<string, number>;
  expectedRegions: string[];
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
  private lastLogAt = Date.now();

  constructor(readonly sourceId: string, readonly releaseId: string, readonly fillFields: readonly string[]) {
    this.progressTotal = progressTotals.get(sourceId) ?? null;
    progressTotals.delete(sourceId);
  }

  read(): void {
    this.received++;
    if (this.received >= this.progressNext || ((this.received & 1023) === 0 && Date.now() - this.lastLogAt >= HEARTBEAT_MS)) {
      const elapsed = Math.max((Date.now() - this.progressStartedAt) / 1000, 0.001);
      const rowsPerSecond = this.received / elapsed;
      const total = this.progressTotal;
      const eta = total === null ? "" : ` ETA ${duration(Math.max(0, total - this.received) / Math.max(rowsPerSecond, 0.001))}`;
      progressLog(`[ingest] source=${this.sourceId} rows=${this.received}${total === null ? "" : `/${total}`} rows/s=${rowsPerSecond.toFixed(0)} elapsed=${duration(elapsed)}${eta}`);
      while (this.progressNext <= this.received) this.progressNext += PROGRESS_EVERY_ROWS;
      this.lastLogAt = Date.now();
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

  progressRecord(): SourceStatsProgress {
    return {
      received: this.received,
      accepted: this.accepted,
      rejected: this.rejected,
      unlocated: this.unlocated,
      pageLimitHit: this.pageLimitHit,
      totalCountReported: this.totalCountReported,
      byRegion: { ...this.byRegion },
      byType: { ...this.byType },
      filled: Object.fromEntries(this.filled),
      expectedRegions: [...this.expectedRegions],
    };
  }

  static fromProgress(sourceId: string, releaseId: string, fillFields: readonly string[], value: string): SourceStats {
    let record: SourceStatsProgress;
    try {
      record = JSON.parse(value) as SourceStatsProgress;
    } catch (error) {
      throw new Error(`invalid build progress stats for ${sourceId}`, { cause: error });
    }
    const stats = new SourceStats(sourceId, releaseId, fillFields);
    stats.received = Number(record.received ?? 0);
    stats.accepted = Number(record.accepted ?? 0);
    stats.rejected = Number(record.rejected ?? 0);
    stats.unlocated = Number(record.unlocated ?? 0);
    stats.pageLimitHit = record.pageLimitHit === true;
    stats.totalCountReported = record.totalCountReported === null || record.totalCountReported === undefined
      ? null
      : Number(record.totalCountReported);
    for (const [key, count] of Object.entries(record.byRegion ?? {})) stats.byRegion[key] = Number(count);
    for (const [key, count] of Object.entries(record.byType ?? {})) stats.byType[key] = Number(count);
    for (const [key, count] of Object.entries(record.filled ?? {})) stats.filled.set(key, Number(count));
    stats.expectedRegions = [...(record.expectedRegions ?? [])];
    return stats;
  }

  merge(other: SourceStats): void {
    this.received += other.received;
    this.accepted += other.accepted;
    this.rejected += other.rejected;
    this.unlocated += other.unlocated;
    this.pageLimitHit ||= other.pageLimitHit;
    if (this.totalCountReported !== null && other.totalCountReported !== null) {
      this.totalCountReported += other.totalCountReported;
    } else {
      this.totalCountReported = null;
    }
    for (const [key, count] of Object.entries(other.byRegion)) this.byRegion[key] = (this.byRegion[key] ?? 0) + count;
    for (const [key, count] of Object.entries(other.byType)) this.byType[key] = (this.byType[key] ?? 0) + count;
    for (const [key, count] of other.filled) this.filled.set(key, (this.filled.get(key) ?? 0) + count);
    for (const region of other.expectedRegions) {
      if (!this.expectedRegions.includes(region)) this.expectedRegions.push(region);
    }
  }

  snapshot(): IngestSnapshot {
    const fillRates: Record<string, number> = {};
    for (const f of this.fillFields) fillRates[f] = this.accepted === 0 ? 0 : (this.filled.get(f) ?? 0) / this.accepted;
    return { total: this.accepted, byRegion: { ...this.byRegion }, byType: { ...this.byType }, fillRates };
  }
}

export async function batched<T>(db: Db, items: AsyncIterable<T> | Iterable<T>, fn: (item: T) => void, size = 50_000): Promise<void> {
  let n = 0;
  const ownsTransaction = !db.inTransaction;
  if (ownsTransaction) db.exec("BEGIN");
  try {
    for await (const item of items) {
      fn(item);
      if (ownsTransaction && ++n % size === 0) {
        db.exec("COMMIT");
        db.exec("BEGIN");
      }
    }
    if (ownsTransaction) db.exec("COMMIT");
  } catch (e) {
    if (ownsTransaction && db.inTransaction) db.exec("ROLLBACK");
    throw e;
  }
}

export interface BuildSourceFile {
  /** Stable path relative to the raw source root. */
  path: string;
  size: number;
  mtimeMs: number;
  /** Cheap expected count, normally read from a DBF header. */
  rows: number;
}

export interface BuildProgressSpec {
  sourceId: string;
  /** Stable JSON/options string for the builder, excluding the file fingerprint. */
  parameters: string;
  files: readonly BuildSourceFile[];
}

interface ProgressRow extends BuildSourceFile {
  sourceId: string;
  finishedAt: string;
  statsJson: string;
}

interface IngestFileTransaction {
  sourceId: string;
  file: BuildSourceFile;
}

const ingestFileTransactions = new WeakMap<Db, IngestFileTransaction>();

function normalizeProgressSpec(spec: BuildProgressSpec): BuildProgressSpec {
  const files = [...spec.files]
    .map((file) => ({
      path: String(file.path).replaceAll("\\", "/"),
      size: Number(file.size),
      mtimeMs: Math.round(Number(file.mtimeMs)),
      rows: Number(file.rows),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  if (!spec.sourceId || !spec.parameters) throw new Error("build progress requires sourceId and parameters");
  const seen = new Set<string>();
  for (const file of files) {
    if (!file.path || seen.has(file.path)) throw new Error(`duplicate build progress file: ${file.path}`);
    if (!Number.isSafeInteger(file.size) || file.size < 0) throw new Error(`invalid build progress file size: ${file.path}`);
    if (!Number.isSafeInteger(file.mtimeMs) || file.mtimeMs < 0) throw new Error(`invalid build progress file mtime: ${file.path}`);
    if (!Number.isSafeInteger(file.rows) || file.rows < 0) throw new Error(`invalid build progress file rows: ${file.path}`);
    seen.add(file.path);
  }
  return { sourceId: spec.sourceId, parameters: spec.parameters, files };
}

function progressFingerprint(spec: BuildProgressSpec): string {
  const normalized = normalizeProgressSpec(spec);
  return JSON.stringify({
    sourceId: normalized.sourceId,
    parameters: normalized.parameters,
    files: normalized.files,
  });
}

export function ensureBuildProgressSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS build_progress_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS build_progress (
      source_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      file_mtime_ms INTEGER NOT NULL,
      rows INTEGER NOT NULL,
      finished_at TEXT NOT NULL,
      stats_json TEXT NOT NULL,
      PRIMARY KEY (source_id, file_path)
    );
    CREATE INDEX IF NOT EXISTS idx_build_progress_source ON build_progress (source_id, file_path);
  `);
}

function progressMeta(db: Db, key: string): string | undefined {
  return db.prepare("SELECT value FROM build_progress_meta WHERE key = ?").pluck().get(key) as string | undefined;
}

function progressRows(db: Db, sourceId: string): ProgressRow[] {
  return db.prepare(`SELECT source_id AS sourceId, file_path AS path, file_size AS size,
      file_mtime_ms AS mtimeMs, rows, finished_at AS finishedAt, stats_json AS statsJson
    FROM build_progress WHERE source_id = ? ORDER BY file_path`).all(sourceId) as ProgressRow[];
}

function validateProgressRows(db: Db, spec: BuildProgressSpec): void {
  const expected = new Map(spec.files.map((file) => [file.path, file]));
  for (const row of progressRows(db, spec.sourceId)) {
    const file = expected.get(row.path);
    if (!file || row.size !== file.size || row.mtimeMs !== file.mtimeMs) {
      throw new Error(`cannot resume ${spec.sourceId}: raw file set or file fingerprint mismatch (${row.path})`);
    }
  }
}

export function prepareBuildProgress(db: Db, specInput: BuildProgressSpec, resume: boolean): BuildProgressSpec {
  const spec = normalizeProgressSpec(specInput);
  ensureBuildProgressSchema(db);
  const expected = progressFingerprint(spec);
  const existing = progressMeta(db, "fingerprint");
  if (existing !== undefined && existing !== expected) {
    throw new Error(`cannot resume ${spec.sourceId}: build parameters or raw file set mismatch`);
  }
  if (resume && existing === undefined) {
    throw new Error(`cannot resume ${spec.sourceId}: unfinished build has no progress fingerprint`);
  }
  if (existing === undefined) {
    db.prepare("INSERT INTO build_progress_meta (key, value) VALUES (?, ?)").run("fingerprint", expected);
    db.prepare("INSERT INTO build_progress_meta (key, value) VALUES (?, ?)").run("finalized", "0");
  }
  validateProgressRows(db, spec);
  return spec;
}

function prepareBuilderKinds(db: Db, kinds: readonly string[], resume: boolean): void {
  const expected = JSON.stringify([...kinds].sort());
  const existing = progressMeta(db, "builder_kinds");
  if (existing !== undefined && existing !== expected) {
    throw new Error(`cannot resume: build kind set mismatch (expected ${expected}, found ${existing})`);
  }
  if (resume && existing === undefined) {
    throw new Error("cannot resume: unfinished build has no builder-kind fingerprint");
  }
  if (existing === undefined) {
    db.prepare("INSERT INTO build_progress_meta (key, value) VALUES (?, ?)").run("builder_kinds", expected);
  }
}

export function isBuildFinalized(db: Db): boolean {
  return progressMeta(db, "finalized") === "1";
}

function markBuildFinalized(db: Db): void {
  if (db.inTransaction) throw new Error("markBuildFinalized must run outside a transaction");
  db.transaction(() => {
    db.prepare(`INSERT INTO build_progress_meta (key, value) VALUES ('finalized', '1')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
  })();
}

function progressRowFor(db: Db, sourceId: string, filePath: string): ProgressRow | undefined {
  return db.prepare(`SELECT source_id AS sourceId, file_path AS path, file_size AS size,
      file_mtime_ms AS mtimeMs, rows, finished_at AS finishedAt, stats_json AS statsJson
    FROM build_progress WHERE source_id = ? AND file_path = ?`).get(sourceId, filePath) as ProgressRow | undefined;
}

function beginIngestFile(db: Db, sourceId: string, file: BuildSourceFile): void {
  if (ingestFileTransactions.has(db)) throw new Error("an ingest file transaction is already active");
  if (db.inTransaction) throw new Error("beginIngestFile requires an idle database");
  db.exec("BEGIN");
  ingestFileTransactions.set(db, { sourceId, file });
}

function completeIngestFile(db: Db, stats: SourceStats): void {
  commitIngestFile(db, stats.sourceId, stats.received, JSON.stringify(stats.progressRecord()));
}

function commitIngestFile(db: Db, sourceId: string, received: number, statsJson: string): void {
  const active = ingestFileTransactions.get(db);
  if (!active || !db.inTransaction) throw new Error("completeIngestFile has no active transaction");
  if (sourceId !== active.sourceId) throw new Error(`progress source mismatch: ${sourceId} != ${active.sourceId}`);
  try {
    db.prepare(`INSERT INTO build_progress
      (source_id, file_path, file_size, file_mtime_ms, rows, finished_at, stats_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(active.sourceId, active.file.path, active.file.size, active.file.mtimeMs, received, new Date().toISOString(), statsJson);
    db.exec("COMMIT");
    ingestFileTransactions.delete(db);
  } catch (error) {
    if (db.inTransaction) db.exec("ROLLBACK");
    ingestFileTransactions.delete(db);
    throw error;
  }
}

function abortIngestFile(db: Db, sourceId: string): void {
  if (db.inTransaction) db.exec("ROLLBACK");
  ingestFileTransactions.delete(db);
  clearIngestProgressTotal(sourceId);
}

export interface ResumableSourceBuildOptions {
  spec: BuildProgressSpec;
  releaseId: string;
  fillFields: readonly string[];
  buildFile: (file: BuildSourceFile) => Promise<SourceStats>;
}

/**
 * Run one source file per transaction. A source builder is called while that
 * transaction is open; its batched() calls therefore cannot commit halfway
 * through a raw file. The progress row is inserted before the same COMMIT.
 */
export async function buildResumableSourceFiles(db: Db, options: ResumableSourceBuildOptions): Promise<SourceStats> {
  const spec = normalizeProgressSpec(options.spec);
  ensureBuildProgressSchema(db);
  const fingerprint = progressMeta(db, "fingerprint");
  if (fingerprint !== progressFingerprint(spec)) throw new Error(`build progress was not prepared for ${spec.sourceId}`);
  validateProgressRows(db, spec);

  const aggregate = new SourceStats(spec.sourceId, options.releaseId, options.fillFields);
  const totalRows = spec.files.reduce((sum, file) => sum + file.rows, 0);
  let completedRows = 0;
  for (const file of spec.files) {
    const done = progressRowFor(db, spec.sourceId, file.path);
    if (done) {
      const saved = SourceStats.fromProgress(spec.sourceId, options.releaseId, options.fillFields, done.statsJson);
      aggregate.merge(saved);
      completedRows += saved.received;
      progressLog(`[ingest] source=${spec.sourceId} file=${file.path} resumed rows=${saved.received} total=${completedRows}/${totalRows || "?"}`);
      continue;
    }

    progressLog(`[ingest] source=${spec.sourceId} file=${file.path} start expected=${file.rows}`);
    if (file.rows > 0) registerIngestProgressTotal(spec.sourceId, file.rows);
    const started = Date.now();
    beginIngestFile(db, spec.sourceId, file);
    try {
      const stats = await options.buildFile(file);
      completeIngestFile(db, stats);
      aggregate.merge(stats);
      completedRows += stats.received;
      const elapsed = Math.max((Date.now() - started) / 1000, 0.001);
      const rowsPerSecond = stats.received / elapsed;
      const eta = totalRows > 0 ? ` ETA ${duration(Math.max(0, totalRows - completedRows) / Math.max(rowsPerSecond, 0.001))}` : "";
      progressLog(`[ingest] source=${spec.sourceId} file=${file.path} rows=${stats.received} rows/s=${rowsPerSecond.toFixed(0)} elapsed=${duration(elapsed)}${eta}`);
    } catch (error) {
      abortIngestFile(db, spec.sourceId);
      throw error;
    }
  }
  return aggregate;
}

export interface ResumableStep {
  /** 진행표의 "파일": 안정적인 경로 이름과 원천 입력의 지문(크기·수정시각) */
  file: BuildSourceFile;
  /** 반환 목록에서의 위치(중단 없는 빌드의 원래 순서). 같은 위치면 실행 순서. 기본값은 실행 순서. */
  slot?: number;
  /** false면 파일 트랜잭션으로 감싸지 않는다: 스스로 트랜잭션을 관리하고 다시 실행해도 같은 결과(멱등)여야 한다 */
  atomic?: boolean;
  /** prior = 앞서 끝난 단계들(이전 실행에서 끝난 것 포함)의 원천별 합산 통계 */
  run: (prior: readonly SourceStats[]) => Promise<SourceStats[]>;
}

interface StepStatsJson {
  steps: { sourceId: string; releaseId: string; fillFields: string[]; record: SourceStatsProgress }[];
}

function mergeBySource(lists: readonly (readonly SourceStats[])[]): SourceStats[] {
  const out = new Map<string, SourceStats>();
  for (const list of lists) {
    for (const stats of list) {
      let into = out.get(stats.sourceId);
      if (!into) {
        into = new SourceStats(stats.sourceId, stats.releaseId, stats.fillFields);
        out.set(stats.sourceId, into);
      }
      into.merge(stats);
    }
  }
  return [...out.values()];
}

/**
 * 원천 여러 개(또는 여러 파일)를 단계별로 적재한다. 단계 하나가 한 트랜잭션이고 진행표 행이 같은 COMMIT에 들어간다.
 * 끝난 단계는 --resume에서 건너뛰고 저장해 둔 통계로 대신한다. 결과는 slot 순서로 원천별로 합쳐 돌려준다.
 */
export async function buildResumableSteps(db: Db, specInput: BuildProgressSpec, steps: readonly ResumableStep[]): Promise<SourceStats[]> {
  const spec = normalizeProgressSpec(specInput);
  ensureBuildProgressSchema(db);
  if (progressMeta(db, "fingerprint") !== progressFingerprint(spec)) throw new Error(`build progress was not prepared for ${spec.sourceId}`);
  validateProgressRows(db, spec);
  const known = new Map(spec.files.map((file) => [file.path, file]));
  if (steps.length !== known.size || steps.some((step) => !known.has(step.file.path.replaceAll("\\", "/")))) {
    throw new Error(`build steps do not match the progress specification of ${spec.sourceId}`);
  }
  const done: { slot: number; index: number; list: SourceStats[] }[] = [];
  const t0 = Date.now();
  for (const [index, step] of steps.entries()) {
    const file = known.get(step.file.path.replaceAll("\\", "/"))!;
    const saved = progressRowFor(db, spec.sourceId, file.path);
    const slot = step.slot ?? index;
    const label = `step ${index + 1}/${steps.length} ${file.path}`;
    if (saved) {
      const json = JSON.parse(saved.statsJson) as StepStatsJson;
      const list = json.steps.map((s) => SourceStats.fromProgress(s.sourceId, s.releaseId, s.fillFields, JSON.stringify(s.record)));
      done.push({ slot, index, list });
      progressLog(`[ingest] ${label} resumed rows=${saved.rows}`);
      continue;
    }
    progressLog(`[ingest] ${label} start${file.rows > 0 ? ` expected=${file.rows}` : ""}`);
    const started = Date.now();
    const atomic = step.atomic !== false;
    if (atomic) beginIngestFile(db, spec.sourceId, file);
    try {
      const list = await step.run(mergeBySource(done.map((d) => d.list)));
      const received = list.reduce((sum, s) => sum + s.received, 0);
      const json: StepStatsJson = { steps: list.map((s) => ({ sourceId: s.sourceId, releaseId: s.releaseId, fillFields: [...s.fillFields], record: s.progressRecord() })) };
      if (!atomic) beginIngestFile(db, spec.sourceId, file);
      commitIngestFile(db, spec.sourceId, received, JSON.stringify(json));
      done.push({ slot, index, list });
      const elapsed = Math.max((Date.now() - started) / 1000, 0.001);
      progressLog(`[ingest] ${label} done rows=${received} rows/s=${(received / elapsed).toFixed(0)} elapsed=${duration(elapsed)} total=${duration((Date.now() - t0) / 1000)}`);
    } catch (error) {
      if (atomic) abortIngestFile(db, spec.sourceId);
      else if (ingestFileTransactions.has(db)) abortIngestFile(db, spec.sourceId);
      throw error;
    }
  }
  done.sort((a, b) => a.slot - b.slot || a.index - b.index);
  return mergeBySource(done.map((d) => d.list));
}

export function assertBuildProgressComplete(db: Db, specInput: BuildProgressSpec): void {
  const spec = normalizeProgressSpec(specInput);
  const rows = progressRows(db, spec.sourceId);
  const expected = new Set(spec.files.map((file) => file.path));
  const actual = new Set(rows.map((row) => row.path));
  if (actual.size !== expected.size || [...expected].some((path) => !actual.has(path))) {
    const missing = [...expected].filter((path) => !actual.has(path));
    throw new Error(`cannot finalize ${spec.sourceId}: ${missing.length} raw files are not complete (${missing.slice(0, 3).join(", ")})`);
  }
}

export function reclaimStaleDataDirLock(dataDir: string): boolean {
  const lockPath = join(dataDir, ".lock");
  if (!existsSync(lockPath)) return false;
  let pid: number;
  try {
    pid = Number(readFileSync(lockPath, "utf8").trim().split(/\s+/, 1)[0]);
  } catch {
    return false;
  }
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH" && code !== "EINVAL") return false;
    rmSync(lockPath, { force: true });
    progressLog(`[ingest] reclaimed stale data-dir lock pid=${pid}`);
    return true;
  }
}

let runSeq = 0;

function recordRun(db: Db, s: SourceStats, finishedAt: string, stableRunId?: string): void {
  db.prepare(`INSERT INTO ingest_run (run_id, source_id, partition_key, started_at, finished_at, status, expected_count, received_count, accepted_count, rejected_count, error_code, release_id, snapshot_json)
    VALUES (?, ?, '', ?, ?, 'succeeded', ?, ?, ?, ?, NULL, ?, ?)
    ON CONFLICT(run_id) DO NOTHING`)
    .run(stableRunId ?? `${s.sourceId}:${s.startedAt}:${runSeq++}`, s.sourceId, s.startedAt, finishedAt, s.totalCountReported, s.received, s.accepted, s.rejected + s.unlocated, s.releaseId, JSON.stringify({ ...s.snapshot(), unlocated: s.unlocated }));
}

export type KindBuilder = (db: Db, ctx: { core: Db | null }) => Promise<SourceStats[]>;

export interface BuildPlan {
  dataDir: string;
  version: string;
  builders: Partial<Record<DataFileKind, KindBuilder>>;
  /** Per-file progress makes a builder resumable without coupling it to SHP. */
  progress?: Partial<Record<DataFileKind, BuildProgressSpec>>;
  resume?: boolean;
  /** 진행 로그를 덧붙일 파일(버전 폴더의 build.log에는 항상 쓴다) */
  logFile?: string;
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
  // Only the files produced by this build need a fresh full scan. Existing
  // files were already hash-verified by publishManifestLocked and are not
  // re-scanned on a reference-only rebuild.
  for (const kind of Object.keys(stats)) {
    const file = candidate.files[kind];
    if (!file || !(DATA_FILE_KINDS as readonly string[]).includes(file.kind)) continue;
    const abs = resolveDataPath(plan.dataDir, file.path);
    const checked = checkSqliteIntegrity(abs);
    progressLog(`[gate] sqlite kind=${kind} integrity=${checked.ok ? "ok" : "FAIL"} rtree=${checked.rtreeMode} pages=${checked.pageCount ?? "-"} bytes=${checked.sizeBytes} elapsed=${checked.elapsedMs.toFixed(1)}ms`);
    for (const failure of checked.failures) {
      const gateFailure = { code: failure.code, detail: `${kind}: ${failure.detail}` } satisfies GateFailure;
      failures.push(gateFailure);
      progressLog(`[gate] FAIL code=${gateFailure.code} detail=${gateFailure.detail}`);
    }
  }
  return { ok: failures.length === 0, failures };
}

// buildings·parcels는 core 다음: 같은 실행에서 core를 만들었으면 그 파일을, 아니면 매니페스트의 현재 core를 읽기 전용으로 받는다.
const BUILD_ORDER: readonly DataFileKind[] = ["core", "buildings", "parcels", "reference", "market", "osm", "terrain", "weather"];

export function buildAndPublish(plan: BuildPlan): Promise<BuildOutcome> {
  reclaimStaleDataDirLock(plan.dataDir);
  return withDataDirLock(plan.dataDir, async () => {
    const current = readManifest(plan.dataDir);
    const files: Record<string, ManifestFile> = {};
    const stats: Record<string, SourceStats[]> = {};
    const versionDir = resolveDataPath(plan.dataDir, `${VERSIONS_DIR}/${plan.version}`);
    const versionExists = existsSync(versionDir);
    if (plan.resume && !versionExists) {
      throw new Error(`cannot resume ${VERSIONS_DIR}/${plan.version}: unfinished version directory does not exist`);
    }
    if (!plan.resume && versionExists) {
      throw new Error(`${VERSIONS_DIR}/${plan.version} already exists; use --resume for an unfinished build or choose a new version name`);
    }
    if (plan.resume && current?.version === plan.version) {
      throw new Error(`cannot resume ${VERSIONS_DIR}/${plan.version}: the version is already published`);
    }
    if (plan.resume && versionExists) {
      const builderKinds = new Set(Object.keys(plan.builders));
      for (const entry of readdirSync(versionDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".sqlite")) continue;
        const kind = entry.name.slice(0, -".sqlite".length);
        if (!builderKinds.has(kind as DataFileKind)) {
          throw new Error(`cannot resume ${VERSIONS_DIR}/${plan.version}: existing file ${entry.name} is not part of this build`);
        }
      }
    }
    mkdirSync(versionDir, { recursive: true });
    const stopLogs = [addBuildLog(join(versionDir, "build.log")), ...(plan.logFile ? [addBuildLog(plan.logFile)] : [])];
    progressLog(`[build] version=${plan.version} resume=${Boolean(plan.resume)} kinds=${Object.keys(plan.builders).join(",")}`);
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
        const fileExisted = existsSync(abs);
        mkdirSync(dirname(abs), { recursive: true });
        const db = new Database(abs);
        handles.push(db);
        const progressSpec = plan.progress?.[kind];
        if (plan.resume && !progressSpec) {
          throw new Error(`cannot resume ${kind}: this builder has no per-file progress specification`);
        }
        const originalPragmas = buildPragmas(db, progressSpec !== undefined);
        let bulkStarted = false;
        let pragmasRestored = false;
        try {
          initDataFileSchema(db, kind);
          let preparedProgress: BuildProgressSpec | undefined;
          if (progressSpec) {
            // A multi-file plan can be interrupted before a later kind starts;
            // that missing DB is initialized during resume. An existing DB
            // must carry the fingerprint and is validated strictly.
            preparedProgress = prepareBuildProgress(db, progressSpec, Boolean(plan.resume && fileExisted));
            prepareBuilderKinds(db, Object.keys(plan.builders), Boolean(plan.resume && fileExisted));
          }
          const finalized = preparedProgress ? isBuildFinalized(db) : false;
          if (!preparedProgress || !finalized) {
            beginFeatureBulk(db);
            bulkStarted = true;
          }
          const kindStats = await builder(db, { core });
          if (preparedProgress) {
            assertBuildProgressComplete(db, preparedProgress);
            if (!isBuildFinalized(db)) {
              finishFeatureBulk(db, { dropPending: false });
              bulkStarted = false;
              // ANALYZE is intentionally after every source file has committed.
              db.exec("ANALYZE feature; ANALYZE feature_rtree;");
              markBuildFinalized(db);
            }
            // Keep the progress/fingerprint tables for restart diagnostics; the
            // bbox staging table is only an implementation detail.
            dropFeatureBulkStaging(db);
          } else {
            finishFeatureBulk(db);
            bulkStarted = false;
            db.exec("ANALYZE feature; ANALYZE feature_rtree;");
          }
          const finishedAt = new Date().toISOString();
          const stableRunPrefix = preparedProgress ? `build:${progressMeta(db, "fingerprint")}:` : null;
          for (const [index, s] of kindStats.entries()) {
            recordRun(db, s, finishedAt, stableRunPrefix === null ? undefined : `${stableRunPrefix}${index}:${s.sourceId}`);
          }
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
      for (const stop of stopLogs) stop();
    }
    for (const f of Object.values(files)) f.sha256 = await sha256File(resolveDataPath(plan.dataDir, f.path));
    const candidate: Manifest = { version: plan.version, createdAt: new Date().toISOString(), files: { ...(current?.files ?? {}), ...files } };
    const baselineReset: string[] = [];
    const result = await publishManifestLocked(plan.dataDir, candidate, (m) => gate(plan, current, stats, m, baselineReset));
    return { ...result, files, stats, baselineReset };
  });
}
