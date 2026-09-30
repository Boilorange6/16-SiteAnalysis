/**
 * 지번 주소 → 법정동 코드·PNU. 좌표가 없는 원천(입주예정 등)을 필지 대표점에 붙일 때 쓴다.
 * 확신이 없으면 null을 돌려준다 — 비슷한 동에 찍는 것보다 "위치 미확인"이 낫다.
 */
import type BetterSqlite3 from "better-sqlite3";
import { matchSigungu, remapPnu, remapSplitSigungu } from "./code-remap";
import { makePnu } from "./parcels";

type Db = BetterSqlite3.Database;

export function parseJibunAddress(address: string): { head: string; mountain: boolean; bun: number; ji: number } | null {
  const m = address.trim().replace(/\s+/g, " ").match(/^(.*?)\s+(산\s*)?(\d+)(?:-(\d+))?(?:\s*번지)?$/);
  if (!m || !m[1]) return null;
  return { head: m[1], mountain: Boolean(m[2]), bun: Number(m[3]), ji: m[4] === undefined ? 0 : Number(m[4]) };
}

/**
 * 옛 코드로 적힌 PNU를 현재 법정구역 코드로 바꾼다(광주·전남 재번호, 인천 구 분할 — code-remap.ts).
 * 이미 현재 코드이거나 이름으로 하나로 정할 수 없으면 PNU를 그대로 돌려준다(추측하지 않는다).
 */
export function remapRenumberedPnu(db: Db, pnu: string, address: string | null): string {
  const r = remapPnu(db, pnu, address);
  return r.pnu ?? pnu;
}

export function resolveJibunAddress(db: Db, address: string): { legalCode: string; pnu: string } | null {
  const r = resolveJibunDetailed(db, address);
  return "pnu" in r ? r : null;
}

/** resolveJibunAddress와 같되, 실패 이유를 알려 준다(ambiguous = 동·리까지 더 적어야 정해짐). */
export function resolveJibunDetailed(db: Db, address: string): { legalCode: string; pnu: string } | { reason: "parse_failed" | "not_found" | "ambiguous" } {
  const parsed = parseJibunAddress(address);
  if (!parsed) return { reason: "parse_failed" };
  const notFound = { reason: "not_found" } as const;
  const ambiguous = { reason: "ambiguous" } as const;
  const tokens = parsed.head.split(" ");
  if (tokens.length < 2) return ambiguous;
  const found = matchSigungu(db, tokens);
  if (!found) {
    // 2026 개편으로 갈라진 옛 구(인천 중·동·서구): 법정동 이름으로 새 구의 코드를 찾는다
    const split = tokens.length <= 4 ? remapSplitSigungu(db, tokens) : null;
    if (!split) return notFound;
    if ("reason" in split) return split.reason === "ambiguous" ? ambiguous : notFound;
    const pnu = makePnu(split.code, parsed.mountain, parsed.bun, parsed.ji);
    return pnu ? { legalCode: split.code, pnu } : notFound;
  }
  if (found.tied) return ambiguous;
  const best = found;

  // 시군구 이름이 차지한 토큰을 건너뛴다
  let consumed = "";
  let i = 1;
  while (i < tokens.length && consumed.length < best.restName.length) consumed += tokens[i++];
  if (consumed !== best.restName) return notFound;
  const rest = tokens.slice(i);
  if (rest.length < 1) return ambiguous;
  if (rest.length > 2) return notFound;

  const emds = db.prepare("SELECT code FROM legal_area WHERE level = 'emd' AND parent_code = ? AND name = ?").pluck().all(best.code, rest[0]) as string[];
  if (emds.length !== 1) return emds.length === 0 ? notFound : ambiguous; // 없거나 동명이면 추측하지 않는다
  const emd = emds[0];
  let legalCode = `${emd}00`;
  if (rest.length === 1) {
    // 리가 있는 읍·면인데 리를 안 밝히면 존재하지 않는 코드가 된다
    if (db.prepare("SELECT 1 FROM legal_area WHERE level = 'ri' AND parent_code = ? LIMIT 1").get(emd)) return ambiguous;
  } else {
    const ris = db.prepare("SELECT code FROM legal_area WHERE level = 'ri' AND parent_code = ? AND name = ?").pluck().all(emd, rest[1]) as string[];
    if (ris.length !== 1) return ris.length === 0 ? notFound : ambiguous;
    legalCode = ris[0];
  }
  const pnu = makePnu(legalCode, parsed.mountain, parsed.bun, parsed.ji);
  return pnu ? { legalCode, pnu } : notFound;
}
