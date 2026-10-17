import type BetterSqlite3 from "better-sqlite3";
import type { LngLat } from "../crs";
import { toUtmk } from "../crs";
import { queryFeaturesInRadius, type FeatureHit } from "../data/features";
import type { SourceRef } from "../engine/context";
import { TopoDemReader, type TopoDemGrid } from "./dem";
import type { TopoSummary } from "./build";
import type { TopoKind } from "./layers";
import { openTopoForUser } from "./upload";

type Db = BetterSqlite3.Database;

export const TOPO_AFFECTED_TILES = [
  "D02", "D03", "D04", "D05", "D10", "D13", "D15", "D16",
  "D17", "D18", "D29", "S01", "S02", "S03", "S04",
] as const;

export interface TopoParameter {
  id: string;
  sha256: string;
}

export interface TopoHandle {
  sha256: string;
  summary: TopoSummary;
  source: SourceRef;
  hits(kinds: readonly TopoKind[], radiusM?: number): FeatureHit[];
  covers(x: number, y: number): boolean;
  dem: TopoDemReader | null;
}

interface TopoScope {
  center: LngLat;
  radiusM: number;
}

const dbForHandle = new WeakMap<TopoHandle, Db>();
const scopeForHandle = new WeakMap<TopoHandle, TopoScope>();
const closedHandles = new WeakSet<TopoHandle>();

function topoValue(parameters: Record<string, unknown>): { id: string; sha256: string | null } | null {
  const value = parameters.topo;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const topo = value as { id?: unknown; sha256?: unknown };
  if (typeof topo.id !== "string" || topo.id.length === 0) return null;
  const sha256 = typeof topo.sha256 === "string" && /^[0-9a-f]{64}$/.test(topo.sha256) ? topo.sha256 : null;
  return { id: topo.id, sha256 };
}

export function hasTopoParameter(parameters: Record<string, unknown>): boolean {
  return topoValue(parameters) !== null;
}

export function topoSha256ForParameters(parameters: Record<string, unknown>): string | null {
  return topoValue(parameters)?.sha256 ?? null;
}

export function filtersForTopo(sha256: string | null): Record<string, unknown> {
  return sha256 === null ? {} : { topo: sha256 };
}

function readDem(db: Db): TopoDemReader | null {
  const row = db.prepare("SELECT x0, y0, cell_m, cols, rows, data FROM topo_dem LIMIT 1").get() as {
    x0: number;
    y0: number;
    cell_m: number;
    cols: number;
    rows: number;
    data: Buffer;
  } | undefined;
  if (!row || !Buffer.isBuffer(row.data) || row.data.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) return null;
  const values = new Float32Array(row.data.byteLength / Float32Array.BYTES_PER_ELEMENT);
  new Uint8Array(values.buffer).set(new Uint8Array(row.data));
  const grid: TopoDemGrid = {
    x0: row.x0,
    y0: row.y0,
    cellM: row.cell_m,
    cols: row.cols,
    rows: row.rows,
    values,
  };
  return new TopoDemReader(grid);
}

/** Attach the request center/radius that EngineContext uses for all feature queries. */
export function bindTopoHandle(handle: TopoHandle, center: LngLat, radiusM: number): void {
  scopeForHandle.set(handle, { center: [center[0], center[1]], radiusM });
}

export function closeTopoHandle(handle: TopoHandle | null): void {
  if (!handle || closedHandles.has(handle)) return;
  closedHandles.add(handle);
  dbForHandle.get(handle)?.close();
  dbForHandle.delete(handle);
  scopeForHandle.delete(handle);
}

/** Open the per-analysis SQLite only after checking the uploaded file owner. */
export function topoHandleFor(
  appDb: Db,
  parameters: Record<string, unknown>,
  userId: string | number | null | undefined,
): TopoHandle | null {
  const value = topoValue(parameters);
  if (!value || userId == null) return null;
  const opened = openTopoForUser(appDb, value.id, userId);
  if (!opened || (value.sha256 !== null && value.sha256 !== opened.sha256)) {
    opened?.db.close();
    return null;
  }

  const summary = opened.summary;
  const handle = {
    sha256: opened.sha256,
    summary,
    source: {
      sourceId: "ngii_topo",
      releaseId: `ngii_topo@${opened.sha256.slice(0, 12)}`,
      sourceAsOf: null,
      fetchedAt: opened.uploadedAt,
    },
    hits(kinds: readonly TopoKind[], radiusM?: number): FeatureHit[] {
      const scope = scopeForHandle.get(handle);
      if (!scope) throw new Error("TopoHandle is not bound to an EngineContext");
      return queryFeaturesInRadius(opened.db, scope.center, radiusM ?? scope.radiusM, kinds);
    },
    covers(x: number, y: number): boolean {
      const [minX, minY, maxX, maxY] = summary.bboxUtmk;
      return x >= minX && x <= maxX && y >= minY && y <= maxY;
    },
    dem: readDem(opened.db),
  } satisfies TopoHandle;
  dbForHandle.set(handle, opened.db);
  return handle;
}
