import { performance } from "node:perf_hooks";

export interface TimedValue<T> {
  value: T;
  elapsedMs: number;
}

/** Keep wall-clock measurement identical between performance scripts and engine probes. */
export function measureElapsed<T>(work: () => T): TimedValue<T> {
  const started = performance.now();
  const value = work();
  return { value, elapsedMs: Math.max(0, Math.round(performance.now() - started)) };
}

export function sumTimings(timings: Readonly<Record<string, number>>, codes: Iterable<string>): number {
  let total = 0;
  for (const code of codes) total += Number.isFinite(timings[code]) ? timings[code] : 0;
  return Math.max(0, Math.round(total));
}
