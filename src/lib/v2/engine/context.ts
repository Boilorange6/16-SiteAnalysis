/**
 * 분석 한 번의 공통 맥락: 게시된 manifest, 지연해서 여는 데이터 파일, 원천 릴리스, 지역 완전성.
 * 데이터 파일은 읽기 전용으로만 연다. 타일은 여기서 hits()로만 조회한다(반경 R*Tree, 전체 스캔 없음).
 */
import type BetterSqlite3 from "better-sqlite3";
import type { LngLat } from "../crs";
import { queryFeaturesInRadius, type FeatureHit } from "../data/features";
import { legalAreasForCircle } from "../data/legal-areas";
import { manifestHash, openDataFile, type Manifest } from "../data/manifest";
import type { TileConditions, TileResult } from "../tile-result";

export type Limitation = TileResult["limitations"][number];
export type FileKey = "core" | "reference" | "market";
export interface SourceRef {
  sourceId: string;
  releaseId: string;
  sourceAsOf: string | null;
  fetchedAt: string;
}

export interface EngineInput {
  address: string;
  center: LngLat;
  radiusM: number;
  analysisDate: string;
}

interface SnapshotJson {
  byRegion?: Record<string, number>;
  unlocated?: number;
}

export class EngineContext {
  readonly manifestHash: string;
  readonly conditions: TileConditions;
  private readonly handles = new Map<FileKey, BetterSqlite3.Database>();
  private readonly refs = new Map<FileKey, SourceRef[]>();
  private areas: ReturnType<typeof legalAreasForCircle> | null = null;

  constructor(
    readonly dataDir: string,
    readonly manifest: Manifest,
    readonly analysisId: string,
    readonly input: EngineInput,
  ) {
    this.manifestHash = manifestHash(manifest);
    this.conditions = {
      address: input.address,
      center: [input.center[0], input.center[1]],
      radiusM: input.radiusM,
      analysisDate: input.analysisDate,
      timezone: "Asia/Seoul",
      filters: {},
      simulation: null,
      parcelSnapshotHash: null,
    };
  }

  db(key: FileKey): BetterSqlite3.Database | null {
    if (!this.manifest.files[key]) return null; // 게시되지 않은 파일: 자료 없음
    let db = this.handles.get(key);
    if (!db) {
      db = openDataFile(this.dataDir, this.manifest, key);
      this.handles.set(key, db);
    }
    return db;
  }

  hits(key: FileKey, kinds: readonly string[], radiusM = this.input.radiusM): FeatureHit[] {
    const db = this.db(key);
    return db ? queryFeaturesInRadius(db, this.input.center, radiusM, kinds) : [];
  }

  private allRefs(key: FileKey): SourceRef[] {
    let list = this.refs.get(key);
    if (!list) {
      const db = this.db(key);
      list = db
        ? (db.prepare("SELECT source_id, release_id, source_as_of, fetched_at FROM source_release ORDER BY release_id").all() as Array<{ source_id: string; release_id: string; source_as_of: string | null; fetched_at: string }>)
            .map((r) => ({ sourceId: r.source_id, releaseId: r.release_id, sourceAsOf: r.source_as_of, fetchedAt: r.fetched_at }))
        : [];
      this.refs.set(key, list);
    }
    return list;
  }

  /** 파일에 적재된 원천 릴리스. 적재되지 않은 원천은 빠진다. */
  sources(key: FileKey, sourceIds: readonly string[]): SourceRef[] {
    return this.allRefs(key).filter((r) => sourceIds.includes(r.sourceId));
  }

  /** 반경이 걸치는 시도 코드(법정구역 기준) */
  sidoCodes(): string[] {
    const core = this.db("core");
    if (!core) return [];
    this.areas ??= legalAreasForCircle(core, this.input.center, this.input.radiusM);
    return [...new Set(this.areas.sigungu.map((a) => a.code.slice(0, 2)))].sort();
  }

  /** 반경과 교차하는 시군구(법정구역 기준) */
  sigungu(): Array<{ code: string; name: string }> {
    const core = this.db("core");
    if (!core) return [];
    this.areas ??= legalAreasForCircle(core, this.input.center, this.input.radiusM);
    return this.areas.sigungu;
  }

  /**
   * 원천의 적재 이력(ingest_run.snapshot_json)에서 읽은 한계.
   * source_release.coverage_json은 적재기가 채우지 않아 항상 비어 있다 — 기록된 것은 시도별 건수·위치 미확인 건수뿐이다.
   */
  coverage(key: FileKey, sourceIds: readonly string[]): Limitation[] {
    const db = this.db(key);
    if (!db) return [];
    const rows = db
      .prepare(`SELECT r.snapshot_json, r.rejected_count FROM ingest_run r JOIN source_release s ON s.release_id = r.release_id
        WHERE r.status = 'succeeded' AND s.source_id IN (${sourceIds.map(() => "?").join(",")})`)
      .all(...sourceIds) as Array<{ snapshot_json: string | null; rejected_count: number }>;
    const out: Limitation[] = [];
    if (rows.length === 0) return [{ kind: "unknown", note: "적재 이력이 없어 지역 완전성을 확인할 수 없습니다." }];
    let unlocated = 0;
    let rejected = 0;
    const regions = new Set<string>();
    for (const row of rows) {
      const snap = row.snapshot_json ? (JSON.parse(row.snapshot_json) as SnapshotJson) : {};
      const u = snap.unlocated ?? 0;
      unlocated += u;
      rejected += Math.max(0, row.rejected_count - u); // rejected_count는 위치 미확인을 포함해 기록된다
      for (const [region, n] of Object.entries(snap.byRegion ?? {})) if (n > 0) regions.add(region);
    }
    if (unlocated + rejected > 0) {
      out.push({ kind: "partial", note: `적재 때 위치를 확인하지 못한 ${unlocated}건과 형식 오류·중복 ${rejected}건은 제외되었습니다(전국 합계, 이 반경 안 건수는 알 수 없음).` });
    }
    const coded = regions.size > 0 && [...regions].every((r) => /^\d{2}$/.test(r));
    const sido = this.sidoCodes();
    if (coded && sido.length > 0) {
      const absent = sido.filter((c) => !regions.has(c));
      if (absent.length > 0) out.push({ kind: "incomplete", note: `반경이 걸친 시도 ${absent.join(", ")}의 자료가 적재되지 않았습니다.` });
      out.push({ kind: "unknown", note: "적재 이력에는 시도별 건수만 있어 시군구 단위 완전성은 확인할 수 없습니다." });
    } else {
      out.push({ kind: "unknown", note: "지역 완전성이 시도 코드로 기록되지 않아 이 반경의 누락 여부를 확인할 수 없습니다." });
    }
    return out;
  }

  close(): void {
    for (const db of this.handles.values()) db.close();
    this.handles.clear();
  }
}
