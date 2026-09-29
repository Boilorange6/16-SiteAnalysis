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
import { queryFeaturesInRadius } from "../data/features";
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
  readonly byRegion: Record<string, number> = {};
  readonly byType: Record<string, number> = {};
  /** 첫 적재에도 반드시 있어야 하는 지역 코드 (품질 검사 REGION_MISSING) */
  expectedRegions: string[] = [];
  readonly startedAt = new Date().toISOString();
  private readonly filled = new Map<string, number>();

  constructor(readonly sourceId: string, readonly releaseId: string, readonly fillFields: readonly string[]) {}

  read(): void {
    this.received++;
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

export async function batched<T>(db: Db, items: AsyncIterable<T> | Iterable<T>, fn: (item: T) => void, size = 5000): Promise<void> {
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

function recordRun(db: Db, s: SourceStats, finishedAt: string): void {
  db.prepare(`INSERT INTO ingest_run (run_id, source_id, partition_key, started_at, finished_at, status, expected_count, received_count, accepted_count, rejected_count, error_code, release_id, snapshot_json)
    VALUES (?, ?, '', ?, ?, 'succeeded', NULL, ?, ?, ?, NULL, ?, ?)`)
    .run(`${s.sourceId}:${s.startedAt}`, s.sourceId, s.startedAt, finishedAt, s.received, s.accepted, s.rejected + s.unlocated, s.releaseId, JSON.stringify(s.snapshot()));
}

export type KindBuilder = (db: Db, ctx: { core: Db | null }) => Promise<SourceStats[]>;

export interface BuildPlan {
  dataDir: string;
  version: string;
  builders: Partial<Record<DataFileKind, KindBuilder>>;
  expectations?: SiteExpectation[];
}

export interface BuildOutcome {
  published: boolean;
  hash: string;
  failures: GateFailure[];
  files: Record<string, ManifestFile>;
  stats: Record<string, SourceStats[]>;
}

function previousSnapshot(db: Db, sourceId: string): IngestSnapshot | null {
  try {
    const json = db
      .prepare("SELECT snapshot_json FROM ingest_run WHERE source_id = ? AND status = 'succeeded' ORDER BY finished_at DESC LIMIT 1")
      .pluck()
      .get(sourceId) as string | null | undefined;
    return json ? (JSON.parse(json) as IngestSnapshot) : null;
  } catch {
    return null; // 스키마 v1 파일에는 snapshot_json이 없다
  }
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

function gate(plan: BuildPlan, previous: Manifest | null, stats: Record<string, SourceStats[]>, candidate: Manifest): GateResult {
  const failures: GateFailure[] = [];
  for (const [kind, list] of Object.entries(stats)) {
    const prevDb = previous?.files[kind] ? openDataFile(plan.dataDir, previous, kind) : null;
    try {
      for (const s of list) {
        const r = evaluateIngest({
          responseRowsReported: s.received,
          parsedRows: s.accepted,
          pageLimitHit: false,
          totalCountReported: null,
          next: s.snapshot(),
          previous: prevDb ? previousSnapshot(prevDb, s.sourceId) : null,
          expectedRegions: s.expectedRegions,
        });
        for (const f of r.failures) failures.push({ code: f.code, detail: `${s.sourceId}: ${f.detail}` });
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

const BUILD_ORDER: readonly DataFileKind[] = ["core", "reference", "market", "osm"];

export function buildAndPublish(plan: BuildPlan): Promise<BuildOutcome> {
  return withDataDirLock(plan.dataDir, async () => {
    const current = readManifest(plan.dataDir);
    const files: Record<string, ManifestFile> = {};
    const stats: Record<string, SourceStats[]> = {};
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
        if (existsSync(abs)) throw new Error(`${rel} already exists; choose a new version name`);
        mkdirSync(dirname(abs), { recursive: true });
        const db = new Database(abs);
        handles.push(db);
        db.pragma("journal_mode = DELETE");
        db.pragma("foreign_keys = ON");
        initDataFileSchema(db, kind);
        const kindStats = await builder(db, { core });
        const finishedAt = new Date().toISOString();
        for (const s of kindStats) recordRun(db, s, finishedAt);
        stats[kind] = kindStats;
        files[kind] = { path: rel, sha256: "", kind, schemaVersion: DATA_SCHEMA_VERSION };
        if (kind === "core") core = db;
      }
    } finally {
      for (const db of handles) db.close();
    }
    for (const f of Object.values(files)) f.sha256 = await sha256File(resolveDataPath(plan.dataDir, f.path));
    const candidate: Manifest = { version: plan.version, createdAt: new Date().toISOString(), files: { ...(current?.files ?? {}), ...files } };
    const result = await publishManifestLocked(plan.dataDir, candidate, (m) => gate(plan, current, stats, m));
    return { ...result, files, stats };
  });
}
