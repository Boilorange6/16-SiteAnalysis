/**
 * 분석 한 번의 공통 맥락: 게시된 manifest, 지연해서 여는 데이터 파일, 원천 릴리스, 지역 완전성.
 * 데이터 파일은 읽기 전용으로만 연다. 타일은 여기서 hits()로만 조회한다(반경 R*Tree, 전체 스캔 없음).
 */
import type BetterSqlite3 from "better-sqlite3";
import type { LngLat } from "../crs";
import { booleanIntersects, feature, featureCollection, intersect } from "@turf/turf";
import { geometryBbox, queryFeaturesByPnus, queryFeaturesInBboxes, queryFeaturesInRadius, type FeatureHit } from "../data/features";
import { acquireDataFile, releaseDataFile } from "../data/file-pool";
import { legalAreasForCircle } from "../data/legal-areas";
import { manifestHash, openDataFile, type Manifest } from "../data/manifest";
import type { RasterRef, TileConditions, TileResult } from "../tile-result";
import { encodeRaster, MAX_TILE_RASTER_BYTES, type RasterData } from "../raster-store";
import { siteSnapshotHash, type EngineSite } from "./site";
import { bindTopoHandle, closeTopoHandle, filtersForTopo, type TopoHandle } from "../topo/context";

export type Limitation = TileResult["limitations"][number];
export type FileKey = "core" | "buildings" | "parcels" | "reference" | "market" | "terrain" | "weather";
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
  pnu: string | null;
  /** EPSG:5179 대지 도형과 선택 방식. pnu는 옛 타일 호출자 하위 호환용 별칭이다. */
  site: EngineSite;
}

export type InitialDataHandles = Partial<Record<FileKey, BetterSqlite3.Database>>;
export type RasterValues = Uint8Array | Uint16Array | Int16Array;
export type RasterReader = (code: string, name: string) => { ref: RasterRef; values: RasterValues } | null;

interface SnapshotJson {
  byRegion?: Record<string, number>;
  unlocated?: number;
}

export class EngineContext {
  readonly manifestHash: string;
  readonly conditions: TileConditions;
  readonly input: EngineInput;
  readonly topo: TopoHandle | null;
  private readonly handles = new Map<FileKey, BetterSqlite3.Database>();
  private readonly refs = new Map<FileKey, SourceRef[]>();
  private readonly hitCache = new Map<string, FeatureHit[]>();
  private readonly memoCache = new Map<string, unknown>();
  private readonly rasterItems = new Map<string, Array<{ ref: RasterRef; blob: Buffer }>>();
  private areas: ReturnType<typeof legalAreasForCircle> | null = null;
  readonly rasterReader: RasterReader | undefined;

  constructor(
    readonly dataDir: string,
    readonly manifest: Manifest,
    readonly analysisId: string,
    input: EngineInput,
    initialHandles: InitialDataHandles = {},
    options: { rasterReader?: RasterReader; reuseDataFiles?: boolean; pooledKeys?: readonly FileKey[]; topo?: TopoHandle | null } = {},
  ) {
    this.rasterReader = options.rasterReader;
    this.reuseDataFiles = options.reuseDataFiles === true;
    this.topo = options.topo ?? null;
    const pooledKeys = new Set(options.pooledKeys ?? []);
    const site = input.site ?? { pnus: input.pnu ? [input.pnu] : [], geometry: null, kind: "address" as const };
    this.input = { ...input, site, pnu: input.pnu ?? site.pnus[0] ?? null };
    for (const [key, db] of Object.entries(initialHandles)) {
      if (db) {
        const fileKey = key as FileKey;
        this.handles.set(fileKey, db);
        if (options.reuseDataFiles === true && pooledKeys.has(fileKey)) this.pooledKeys.add(fileKey);
      }
    }
    this.manifestHash = manifestHash(manifest);
    if (this.topo) bindTopoHandle(this.topo, this.input.center, this.input.radiusM);
    this.conditions = {
      address: input.address,
      center: [input.center[0], input.center[1]],
      radiusM: input.radiusM,
      analysisDate: input.analysisDate,
      timezone: "Asia/Seoul",
      filters: filtersForTopo(this.topo?.sha256 ?? null),
      simulation: null,
      parcelSnapshotHash: siteSnapshotHash(site),
    };
  }

  private readonly pooledKeys = new Set<FileKey>();
  private readonly reuseDataFiles: boolean;

  db(key: FileKey): BetterSqlite3.Database | null {
    if (!this.manifest.files[key]) return null; // 게시되지 않은 파일: 자료 없음
    let db = this.handles.get(key);
    if (!db) {
      db = this.reuseDataFiles
        ? acquireDataFile(this.dataDir, this.manifest, key)
        : openDataFile(this.dataDir, this.manifest, key);
      this.handles.set(key, db);
      if (this.reuseDataFiles) this.pooledKeys.add(key);
    }
    return db;
  }

  /** 한 분석에서 여러 타일이 공유하는 계산을 한 번만 실행한다. null도 캐시한다. */
  memo<T>(key: string, compute: () => T): T {
    if (this.memoCache.has(key)) return this.memoCache.get(key) as T;
    const value = compute();
    this.memoCache.set(key, value);
    return value;
  }

  /** 타일 계산이 만든 래스터를 압축해 보관한다. 상한을 넘으면 품질을 몰래 낮추지 않고 실패시킨다. */
  emitRaster(code: string, r: RasterData): RasterRef {
    const encoded = encodeRaster(r);
    const items = this.rasterItems.get(code) ?? [];
    if (items.some((item) => item.ref.name === encoded.ref.name)) throw new Error(`DUPLICATE_RASTER: ${code}/${encoded.ref.name}`);
    const total = items.reduce((sum, item) => sum + item.blob.length, 0) + encoded.blob.length;
    if (total > MAX_TILE_RASTER_BYTES) throw new Error(`TILE_RASTERS_TOO_LARGE: ${code} ${total} bytes`);
    items.push(encoded);
    this.rasterItems.set(code, items);
    return encoded.ref;
  }

  takeRasters(code: string): Array<{ ref: RasterRef; blob: Buffer }> {
    const items = this.rasterItems.get(code) ?? [];
    this.rasterItems.delete(code);
    return items;
  }

  hits(key: FileKey, kinds: readonly string[], radiusM = this.input.radiusM): FeatureHit[] {
    const cacheKey = JSON.stringify([key, [...kinds].sort(), radiusM]);
    const cached = this.hitCache.get(cacheKey);
    if (cached) return cached;
    const db = this.db(key);
    const hits = db ? queryFeaturesInRadius(db, this.input.center, radiusM, kinds) : [];
    this.hitCache.set(cacheKey, hits);
    return hits;
  }

  /** 대지 geometry와 실제 교차하는 필지. 선택 PNU가 없는 직접 그린 구역도 지원한다. */
  siteParcelHits(): FeatureHit[] {
    return this.memo("site:parcel-hits", () => {
      const geometry = this.input.site.geometry;
      const db = this.db("parcels");
      if (!db) return [];
      // PNU 선택은 경계가 맞닿은 이웃까지 포함하지 않고 사용자가 고른 PNU를 그대로 보존한다.
      if (this.input.site.kind !== "polygon" && this.input.site.pnus.length > 0) {
        return queryFeaturesByPnus(db, this.input.site.pnus);
      }
      if (!geometry) {
        const pnu = this.input.pnu;
        return pnu ? this.hits("parcels", ["parcel"]).filter((hit) => hit.pnu === pnu) : [];
      }
      const candidates = queryFeaturesInBboxes(db, [geometryBbox(geometry)], ["parcel"]);
      const siteFeature = feature(geometry);
      return candidates
        .filter((hit) => {
          try {
            if (!booleanIntersects(siteFeature as never, feature(hit.geometry) as never)) return false;
            const clipped = intersect(featureCollection([siteFeature as never, feature(hit.geometry) as never]) as never);
            if (!clipped || (clipped.geometry.type !== "Polygon" && clipped.geometry.type !== "MultiPolygon")) return false;
            const parts = clipped.geometry.type === "Polygon" ? [clipped.geometry.coordinates] : clipped.geometry.coordinates;
            const ringArea = (ring: readonly number[][]) => Math.abs(ring.reduce((sum, point, index) => {
              const next = ring[(index + 1) % ring.length];
              return sum + point[0] * next[1] - next[0] * point[1];
            }, 0)) / 2;
            return parts.reduce((sum, rings) => sum + ringArea(rings[0]) - rings.slice(1).reduce((holes, ring) => holes + ringArea(ring), 0), 0) > 1e-6;
          } catch { return false; }
        })
        .sort((a, b) => a.featureId - b.featureId);
    });
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
      out.push({ kind: "partial", note: `자료를 정리하는 과정에서 위치를 확인하지 못한 ${unlocated}건과 추가 확인이 필요한 ${rejected}건은 제외되었습니다. 전체 자료 기준 집계라 이 반경 안 건수와는 다를 수 있습니다.` });
    }
    const coded = regions.size > 0 && [...regions].every((r) => /^\d{2}$/.test(r));
    const sido = this.sidoCodes();
    if (coded && sido.length > 0) {
      const absent = sido.filter((c) => !regions.has(c));
      if (absent.length > 0) out.push({ kind: "incomplete", note: `반경이 걸친 시도 ${absent.join(", ")}의 자료를 확인하지 못했습니다.` });
      out.push({ kind: "unknown", note: "시도별 집계만 있어 시군구 단위 완전성은 확인할 수 없습니다." });
    } else {
      out.push({ kind: "unknown", note: "지역 완전성이 시도 코드로 기록되지 않아 이 반경의 누락 여부를 확인할 수 없습니다." });
    }
    return out;
  }

  close(): void {
    for (const [key, db] of this.handles) {
      if (this.pooledKeys.has(key)) releaseDataFile(db);
      else db.close();
    }
    this.handles.clear();
    this.pooledKeys.clear();
    this.hitCache.clear();
    this.memoCache.clear();
    this.rasterItems.clear();
    closeTopoHandle(this.topo);
  }
}
