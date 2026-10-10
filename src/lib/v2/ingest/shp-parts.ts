/**
 * VWorld 시도별 SHP 파일 찾기. 큰 시도는 `AL_D002_51_20260908.shp`, `AL_D002_51_20260908(2).shp` …
 * (파트당 100만 레코드)로 쪼개져 온다. 시도마다 가장 새 날짜 한 벌의 모든 파트를 파트 순서로 돌려준다.
 */
import { basename } from "node:path";

export interface SidoShpSet {
  date: string;
  files: string[];
}

export function latestShpPerSido(paths: readonly string[], tag: string): Map<string, SidoShpSet> {
  const re = new RegExp(String.raw`^${tag}_(\d+)_(\d{8})(?:\((\d+)\))?\.shp$`, "i");
  const bySido = new Map<string, { date: string; parts: { part: number; file: string }[] }>();
  for (const file of paths) {
    const m = basename(file).match(re);
    if (!m) continue;
    const [, sido, date, part] = m;
    let cur = bySido.get(sido);
    if (!cur || date > cur.date) bySido.set(sido, (cur = { date, parts: [] }));
    if (date === cur.date) cur.parts.push({ part: part ? Number(part) : 1, file });
  }
  return new Map([...bySido].sort(([a], [b]) => a.localeCompare(b)).map(([sido, v]) => [sido, { date: v.date, files: v.parts.sort((a, b) => a.part - b.part).map((p) => p.file) }]));
}

/** 시도별 파트 수 한 줄: "51x3 43x3 11x1" */
export const partCounts = (sets: Map<string, SidoShpSet>): string => [...sets].map(([s, v]) => `${s}x${v.files.length}`).join(" ") || "-";

/** 고른 시도 세트들 중 가장 오래된 날짜(릴리스 기준일용) */
export const oldestDate = (sets: Map<string, SidoShpSet>): string | null => [...sets.values()].map((v) => v.date).sort()[0] ?? null;
