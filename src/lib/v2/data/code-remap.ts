/**
 * 옛 행정구역 코드로 적힌 원천(공시지가·K-APT 등)을 게시된 core의 현재 법정구역 코드로 옮긴다.
 * 2026년 개편: 광주(29)·전남(46) → 전남광주통합특별시(12, 시군구 재번호), 인천 중구·동구·서구 → 제물포·영종·서해·검단구(법정동 코드 자체가 바뀜).
 * 방법: 현재 코드는 core legal_area의 이름표로 찾는다. 원천 자신의 주소 이름(시도 시군구 읍면동 [리])이 열쇠이며, 이름이 하나로 정해지지 않으면 null이다(추측 금지).
 * 지번 부분(PNU 11번째 자리부터)은 건드리지 않는다.
 */
import type BetterSqlite3 from "better-sqlite3";

type Db = BetterSqlite3.Database;

export const SIDO_ALIASES: Record<string, string> = {
  서울: "서울특별시", 부산: "부산광역시", 대구: "대구광역시", 인천: "인천광역시", 대전: "대전광역시", 울산: "울산광역시",
  세종: "세종특별자치시", 경기: "경기도", 강원: "강원특별자치도", 강원도: "강원특별자치도", 충북: "충청북도", 충남: "충청남도",
  전북: "전북특별자치도", 전라북도: "전북특별자치도", 전북특별차지도: "전북특별자치도", 경북: "경상북도", 경남: "경상남도", 제주: "제주특별자치도", 제주도: "제주특별자치도",
  광주: "전남광주통합특별시", 광주광역시: "전남광주통합특별시", 전남: "전남광주통합특별시", 전라남도: "전남광주통합특별시",
};

/** 시도 코드 2자리가 바뀐 곳: 29 광주·46 전남 → 12. 시군구는 재번호, 읍면동 3자리 이후는 그대로다(K-APT 5,989건 이름 일치 100%). */
export const RENUMBERED_SIDO: Record<string, string> = { "29": "12", "46": "12" };

export interface Area {
  code: string;
  name: string;
}

interface Index {
  sigungus: Area[];
  codes: Set<string>; // 현재 읍면동(8자리)·리(10자리)
  emdBySig: Map<string, string[]>; // "시군구5|읍면동명" → 읍면동 8자리
  emdBySido: Map<string, string[]>; // "시도2|읍면동명"
  riByEmd: Map<string, string[]>; // "읍면동8|리명" → 리 10자리
  riBySig: Map<string, string[]>; // "시군구5|리명"
  emdWithRi: Set<string>;
}

const indexCache = new WeakMap<Db, Index>();
const sigunguCache = new WeakMap<Db, Area[]>();

function push(m: Map<string, string[]>, k: string, v: string): void {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

function index(db: Db): Index {
  let ix = indexCache.get(db);
  if (ix) return ix;
  ix = { sigungus: [], codes: new Set(), emdBySig: new Map(), emdBySido: new Map(), riByEmd: new Map(), riBySig: new Map(), emdWithRi: new Set() };
  for (const r of db.prepare("SELECT code, level, name FROM legal_area").all() as { code: string; level: string; name: string }[]) {
    if (r.level === "sigungu") ix.sigungus.push({ code: r.code, name: r.name });
    else if (r.level === "emd") {
      ix.codes.add(r.code);
      push(ix.emdBySig, `${r.code.slice(0, 5)}|${r.name}`, r.code);
      push(ix.emdBySido, `${r.code.slice(0, 2)}|${r.name}`, r.code);
    } else {
      ix.codes.add(r.code);
      ix.emdWithRi.add(r.code.slice(0, 8));
      push(ix.riByEmd, `${r.code.slice(0, 8)}|${r.name}`, r.code);
      push(ix.riBySig, `${r.code.slice(0, 5)}|${r.name}`, r.code);
    }
  }
  if (ix.sigungus.length) indexCache.set(db, ix); // 빈 표(아직 안 채워진 db)는 굳히지 않는다
  return ix;
}

export function sigungus(db: Db): Area[] {
  let areas = sigunguCache.get(db);
  if (!areas) {
    areas = (db.prepare("SELECT code, name FROM legal_area WHERE level = 'sigungu' ORDER BY code").all() as Area[]);
    if (areas.length > 0) sigunguCache.set(db, areas);
  }
  return areas;
}

/** 시군구: "시도 시군구" 이름에서 시도를 떼고 공백을 무시해 가장 긴 접두어를 고른다(예: "성남시 분당구"). tokens[0]은 시도. */
export function matchSigungu(db: Db, tokens: string[], codePrefix = ""): { code: string; restName: string; tied: boolean } | null {
  const sido = SIDO_ALIASES[tokens[0]] ?? tokens[0];
  const restJoined = tokens.slice(1).join("");
  let best: { code: string; restName: string; tied: boolean } | null = null;
  for (const s of sigungus(db)) {
    if (!s.code.startsWith(codePrefix)) continue;
    // 원천 SIG 이름의 시도 접두어도 같은 표로 정규화한다(실제 원천 표기: "전북특별차지도", "제주도")
    const sp = s.name.indexOf(" ");
    const sigSido = sp < 0 ? s.name : s.name.slice(0, sp);
    if ((SIDO_ALIASES[sigSido] ?? sigSido) !== sido) continue;
    const restName = s.name.slice(sigSido.length + 1).replace(/\s+/g, ""); // 세종: 이름이 시도와 같아 ""
    if (!restJoined.startsWith(restName)) continue;
    if (!best || restName.length > best.restName.length) best = { code: s.code, restName, tied: false };
    else if (restName.length === best.restName.length) best.tied = true;
  }
  return best;
}

/** 인천 옛 중구·동구·서구는 통째로 옮겨 가지 않고 갈라졌다. 옛 구 이름 → 새 구 후보(이 안에서 법정동 이름이 하나로 정해져야 한다). */
export const SPLIT_SIGUNGU: Record<string, readonly string[]> = {
  "인천광역시 중구": ["28125", "28155"], // 제물포구·영종구
  "인천광역시 동구": ["28125"], // 제물포구
  "인천광역시 서구": ["28275", "28290"], // 서해구·검단구
};

export type LegalRemap =
  | { code: string; via: "current" | "sigungu" | "emd-name" | "ri-name" }
  | { code: null; reason: "bad_code" | "no_names" | "not_found" | "ambiguous" };

const fail = (reason: "bad_code" | "no_names" | "not_found" | "ambiguous"): LegalRemap => ({ code: null, reason });
const NUMERIC_TAIL = /^(산)?\d+(-\d+)?(번지)?$/;
const uniq = (a: string[]): string[] => [...new Set(a)];

/**
 * 옛 법정동 코드(10자리)를 현재 코드로. address는 "시도 시군구 읍면동 [리] [지번…]" — 숫자로 시작하는 지번 토큰부터는 버린다.
 * 현재 코드면 그대로, 아니면 (1) 시군구 재번호(29·46)로 만든 코드가 실존하면 그것, (2) 이름 경로(읍면동→리)가 현재 표에서 하나로 정해지면 그것.
 */
export function remapLegalCode(db: Db, code10: string, address: string | null): LegalRemap {
  if (!/^\d{10}$/.test(code10)) return fail("bad_code");
  const ix = index(db);
  const exists = (c: string) => ix.codes.has(c.endsWith("00") ? c.slice(0, 8) : c);
  if (exists(code10)) return { code: code10, via: "current" };
  if (!address) return fail("no_names");
  const tokens = address.trim().split(/\s+/);
  const cut = tokens.findIndex((t, i) => i > 0 && NUMERIC_TAIL.test(t));
  const names = cut < 0 ? tokens : tokens.slice(0, cut);
  if (names.length < 2) return fail("no_names");
  const sido2 = RENUMBERED_SIDO[code10.slice(0, 2)] ?? code10.slice(0, 2);

  // 1) 시군구가 현재 표에 있다
  const hit = matchSigungu(db, names, sido2);
  if (hit && !hit.tied) {
    if (RENUMBERED_SIDO[code10.slice(0, 2)]) {
      const c = hit.code + code10.slice(5);
      if (exists(c) || ix.codes.size === 0) return { code: c, via: "sigungu" }; // 읍면동 표가 없으면 확인할 수 없어 K-APT 실측(이름 일치 100%)을 믿는다
    }
    let consumed = "";
    let i = 1;
    while (i < names.length && consumed.length < hit.restName.length) consumed += names[i++];
    if (consumed === hit.restName) return byNames(ix, [hit.code], null, names[i], names[i + 1]);
  }

  // 2) 옛 시군구 이름이 사라졌다(인천 중구·동구·서구): 갈라진 새 구 후보 안에서, 후보 정보가 없으면 시도 전체에서 이름으로
  if (names.length < 3) return fail("no_names");
  const k = names[1].endsWith("시") && names[2].endsWith("구") ? 2 : 1; // "성남시 분당구"처럼 시 아래 구
  return remapSplitSigungu(db, names) ?? byNames(ix, null, sido2, names[k + 1], names[k + 2]);
}

/** 갈라진 옛 시군구(인천 중·동·서구) 주소의 현재 법정동 코드. 그 옛 구가 아니면 null. names = [시도, 시군구, 읍면동, 리?]. */
export function remapSplitSigungu(db: Db, names: string[]): LegalRemap | null {
  const split = SPLIT_SIGUNGU[`${SIDO_ALIASES[names[0]] ?? names[0]} ${names[1]}`];
  return split ? byNames(index(db), split, null, names[2], names[3]) : null;
}

/** sigs가 있으면 그 시군구들 안에서, 없으면 sido2 전체에서 읍면동 이름(→리 이름)으로 유일하게 찾는다. */
function byNames(ix: Index, sigs: readonly string[] | null, sido2: string | null, emdName: string | undefined, riName: string | undefined): LegalRemap {
  if (!emdName) return fail("no_names");
  const emds = uniq(sigs ? sigs.flatMap((s) => ix.emdBySig.get(`${s}|${emdName}`) ?? []) : ix.emdBySido.get(`${sido2}|${emdName}`) ?? []);
  if (emds.length > 1) return fail("ambiguous");
  if (emds.length === 1) {
    const emd = emds[0];
    if (!ix.emdWithRi.has(emd)) return riName ? fail("not_found") : { code: `${emd}00`, via: "emd-name" };
    if (!riName) return fail("ambiguous"); // 리가 있는 읍·면인데 리를 안 밝혔다
    const ris = ix.riByEmd.get(`${emd}|${riName}`) ?? [];
    return ris.length === 1 ? { code: ris[0], via: "emd-name" } : fail(ris.length === 0 ? "not_found" : "ambiguous");
  }
  // 읍면동 이름이 바뀌었다(면→읍 승격 등): 리 이름이 시군구 안에서 유일하면 리 코드로
  if (riName && sigs?.length === 1) {
    const ris = ix.riBySig.get(`${sigs[0]}|${riName}`) ?? [];
    if (ris.length === 1) return { code: ris[0], via: "ri-name" };
    if (ris.length > 1) return fail("ambiguous");
  }
  return fail("not_found");
}

/** PNU(19자리)의 법정동 10자리를 remapLegalCode로 바꾼다. 지번 부분은 그대로. */
export function remapPnu(db: Db, pnu: string, address: string | null): { pnu: string; via: string } | { pnu: null; reason: string } {
  if (!/^\d{19}$/.test(pnu)) return { pnu: null, reason: "bad_code" };
  const r = remapLegalCode(db, pnu.slice(0, 10), address);
  return "reason" in r ? { pnu: null, reason: r.reason } : { pnu: r.code + pnu.slice(10), via: r.via };
}
