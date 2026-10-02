/**
 * Process-local read-only handles for published data files.
 *
 * A v2 POST opens the same immutable SQLite files repeatedly. Keeping a small
 * idle pool preserves SQLite's page cache and prepared statements between
 * analyses without sharing handles across worker_threads or changing the
 * published files.
 */
import { resolve } from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import { openDataFile, resolveDataPath, type Manifest } from "./manifest";

type Db = BetterSqlite3.Database;

interface PoolEntry {
  readonly key: string;
  readonly db: Db;
  active: number;
  lastUsed: number;
}

const MAX_IDLE_HANDLES = 8;
const entries = new Map<string, PoolEntry>();
let clock = 0;

function entryKey(dataDir: string, manifest: Manifest, key: string): string {
  return `${resolve(dataDir)}\0${key}\0${resolveDataPath(dataDir, manifest.files[key].path)}`;
}

function trimIdle(): void {
  const idle = [...entries.values()]
    .filter((entry) => entry.active === 0)
    .sort((a, b) => a.lastUsed - b.lastUsed);
  while (entries.size > MAX_IDLE_HANDLES && idle.length > 0) {
    const entry = idle.shift()!;
    if (entries.get(entry.key) !== entry || entry.active !== 0) continue;
    entries.delete(entry.key);
    entry.db.close();
  }
}

export function acquireDataFile(dataDir: string, manifest: Manifest, key: string): Db {
  const cacheKey = entryKey(dataDir, manifest, key);
  const current = entries.get(cacheKey);
  if (current) {
    current.active += 1;
    current.lastUsed = ++clock;
    return current.db;
  }
  const entry: PoolEntry = { key: cacheKey, db: openDataFile(dataDir, manifest, key), active: 1, lastUsed: ++clock };
  entries.set(cacheKey, entry);
  return entry.db;
}

export function releaseDataFile(db: Db): void {
  for (const entry of entries.values()) {
    if (entry.db !== db) continue;
    entry.active = Math.max(0, entry.active - 1);
    entry.lastUsed = ++clock;
    trimIdle();
    return;
  }
  // A caller may pass a handle created by openDataFile rather than this pool.
  // It remains the caller's responsibility in that case.
}

/** Test/process-shutdown hook; only idle handles are closed. */
export function closeIdleDataFiles(): number {
  let closed = 0;
  for (const [key, entry] of entries) {
    if (entry.active !== 0) continue;
    entries.delete(key);
    entry.db.close();
    closed += 1;
  }
  return closed;
}

/** Test/process-shutdown hook for callers that know no pooled work is active. */
export function closeDataFilePool(): void {
  for (const entry of entries.values()) entry.db.close();
  entries.clear();
}
