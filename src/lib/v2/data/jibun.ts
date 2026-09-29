/**
 * 지번 주소 → 법정동 코드·PNU. 좌표가 없는 원천(입주예정 등)을 필지 대표점에 붙일 때 쓴다.
 * 확신이 없으면 null을 돌려준다 — 비슷한 동에 찍는 것보다 "위치 미확인"이 낫다.
 */
import type BetterSqlite3 from "better-sqlite3";
import { makePnu } from "./parcels";

type Db = BetterSqlite3.Database;

const SIDO_ALIASES: Record<string, string> = {
  서울: "서울특별시", 부산: "부산광역시", 대구: "대구광역시", 인천: "인천광역시", 대전: "대전광역시", 울산: "울산광역시",
  세종: "세종특별자치시", 경기: "경기도", 강원: "강원특별자치도", 강원도: "강원특별자치도", 충북: "충청북도", 충남: "충청남도",
  전북: "전북특별자치도", 전라북도: "전북특별자치도", 경북: "경상북도", 경남: "경상남도", 제주: "제주특별자치도", 제주도: "제주특별자치도",
  광주: "전남광주통합특별시", 광주광역시: "전남광주통합특별시", 전남: "전남광주통합특별시", 전라남도: "전남광주통합특별시",
};

export function parseJibunAddress(address: string): { head: string; mountain: boolean; bun: number; ji: number } | null {
  const m = address.trim().replace(/\s+/g, " ").match(/^(.*?)\s+(산\s*)?(\d+)(?:-(\d+))?(?:\s*번지)?$/);
  if (!m || !m[1]) return null;
  return { head: m[1], mountain: Boolean(m[2]), bun: Number(m[3]), ji: m[4] === undefined ? 0 : Number(m[4]) };
}

interface Area {
  code: string;
  name: string;
}

const sigCache = new WeakMap<Db, Area[]>();

function sigungus(db: Db): Area[] {
  let rows = sigCache.get(db);
  if (!rows) {
    rows = db.prepare("SELECT code, name FROM legal_area WHERE level = 'sigungu'").all() as Area[];
    if (rows.length) sigCache.set(db, rows);
  }
  return rows;
}

export function resolveJibunAddress(db: Db, address: string): { legalCode: string; pnu: string } | null {
  const parsed = parseJibunAddress(address);
  if (!parsed) return null;
  const tokens = parsed.head.split(" ");
  if (tokens.length < 2) return null;
  const sido = SIDO_ALIASES[tokens[0]] ?? tokens[0];
  const restJoined = tokens.slice(1).join("");

  // 시군구: "시도 시군구" 이름에서 시도를 떼고 공백을 무시해 가장 긴 접두어를 고른다(예: "성남시 분당구")
  let best: { code: string; restName: string } | null = null;
  let tied = false;
  for (const s of sigungus(db)) {
    if (s.name !== sido && !s.name.startsWith(`${sido} `)) continue;
    const restName = s.name.slice(sido.length + 1).replace(/\s+/g, ""); // 세종: 이름이 시도와 같아 ""
    if (!restJoined.startsWith(restName)) continue;
    if (!best || restName.length > best.restName.length) {
      best = { code: s.code, restName };
      tied = false;
    } else if (restName.length === best.restName.length) tied = true;
  }
  if (!best || tied) return null;

  // 시군구 이름이 차지한 토큰을 건너뛴다
  let consumed = "";
  let i = 1;
  while (i < tokens.length && consumed.length < best.restName.length) consumed += tokens[i++];
  if (consumed !== best.restName) return null;
  const rest = tokens.slice(i);
  if (rest.length < 1 || rest.length > 2) return null;

  const emds = db.prepare("SELECT code FROM legal_area WHERE level = 'emd' AND parent_code = ? AND name = ?").pluck().all(best.code, rest[0]) as string[];
  if (emds.length !== 1) return null; // 없거나 동명이면 추측하지 않는다
  const emd = emds[0];
  let legalCode = `${emd}00`;
  if (rest.length === 1) {
    // 리가 있는 읍·면인데 리를 안 밝히면 존재하지 않는 코드가 된다
    if (db.prepare("SELECT 1 FROM legal_area WHERE level = 'ri' AND parent_code = ? LIMIT 1").get(emd)) return null;
  } else {
    const ris = db.prepare("SELECT code FROM legal_area WHERE level = 'ri' AND parent_code = ? AND name = ?").pluck().all(emd, rest[1]) as string[];
    if (ris.length !== 1) return null;
    legalCode = ris[0];
  }
  const pnu = makePnu(legalCode, parsed.mountain, parsed.bun, parsed.ji);
  return pnu ? { legalCode, pnu } : null;
}
