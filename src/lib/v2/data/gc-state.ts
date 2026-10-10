import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const GC_STATE_FILE = "gc-state.json";

interface SkipItemState {
  consecutive: number;
  lastSkippedAt: string;
}

interface GcState {
  items: Record<string, SkipItemState>;
}

export interface GcSkipWarning {
  path: string;
  consecutive: number;
}

export interface GcSkipStateOptions {
  threshold?: number;
  now?: () => string;
}

function readState(path: string): GcState {
  if (!existsSync(path)) return { items: {} };
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<GcState>;
    if (!value || typeof value.items !== "object" || value.items === null) return { items: {} };
    const items: Record<string, SkipItemState> = {};
    for (const [key, item] of Object.entries(value.items)) {
      if (!item || !Number.isSafeInteger(item.consecutive) || item.consecutive < 1 || typeof item.lastSkippedAt !== "string") continue;
      items[key] = { consecutive: item.consecutive, lastSkippedAt: item.lastSkippedAt };
    }
    return { items };
  } catch {
    // A damaged warning ledger must not make an otherwise safe GC fail.
    return { items: {} };
  }
}

function writeStateAtomic(path: string, state: GcState): void {
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(temp, path);
}

/** Record one GC run's skipped paths and return paths that crossed the warning threshold. */
export function recordGcSkipped(dataDir: string, skipped: readonly string[], options: GcSkipStateOptions = {}): GcSkipWarning[] {
  const threshold = options.threshold ?? 3;
  if (!Number.isSafeInteger(threshold) || threshold < 1) throw new RangeError(`invalid GC skipped warning threshold: ${threshold}`);
  const now = options.now ?? (() => new Date().toISOString());
  const old = readState(join(dataDir, GC_STATE_FILE));
  const next: GcState = { items: {} };
  const warnings: GcSkipWarning[] = [];
  for (const path of [...new Set(skipped)].sort()) {
    const previous = old.items[path];
    const consecutive = (previous?.consecutive ?? 0) + 1;
    next.items[path] = { consecutive, lastSkippedAt: now() };
    if (consecutive >= threshold) warnings.push({ path, consecutive });
  }
  writeStateAtomic(join(dataDir, GC_STATE_FILE), next);
  return warnings;
}
