/**
 * VWorld 일별용도지역지구정보(dsId 24) 정비 관련 5개 레이어 → maintenance_zone 폴리곤 (reference)
 * + 정비사업 명부(maintenance.ts, 위치 없음)와의 이름 매칭 → feature_link(zone_of_project, method name_sgg).
 *
 * 속성: A1 지정ID(33자) · A3 갱신일 · A4 시군구코드(5) · A5 유형코드(UDT…) · A6 유형명 · A7 고시일(YYYYMMDD) · A8 구역명(빈 값·NUL 패딩 많음) · A9 비고/보조 이름.
 * 이용 근거는 용도지역과 같다(data.go.kr 15045898 '이용허락범위 제한 없음', dsId 24). 겹침은 합치지 않는다.
 *
 * 매칭은 결정적이고 점수제다. 이름이 정확히 같거나(정규화 후) 경계가 맞는 포함일 때만 후보가 되고,
 * 시군구가 다르면 후보가 아니다. 유형(레이어·이름 글자)이 같으면 가산, 다르면 감점. 임계값 미달·동점 후보 둘 이상이면 잇지 않는다(억지로 만들지 않음).
 */
import type BetterSqlite3 from "better-sqlite3";
import { insertFeature } from "../../data/features";
import { batched, SourceStats } from "../build";
import type { ShpRecord } from "../shp";
import { latestShpPerSido, type SidoShpSet } from "../shp-parts";
import { ZONING_RIGHTS } from "./zoning";

type Db = BetterSqlite3.Database;

export const MZONE_LAYERS = [
  { key: "zone", sourceId: "mzone_zone", title: "도시및주거환경정비/정비구역", fileTag: "AL_D029", typeHint: null },
  { key: "redevelopment", sourceId: "mzone_redevelopment", title: "도시재개발/재개발구역", fileTag: "AL_D027", typeHint: "재개발" },
  { key: "promotion", sourceId: "mzone_promotion", title: "도시재정비/재정비촉진지구", fileTag: "AL_D314", typeHint: null },
  { key: "planned", sourceId: "mzone_planned", title: "정비예정구역/정비계획을수립중인지역", fileTag: "AL_D316", typeHint: null },
  { key: "improvement", sourceId: "mzone_improvement", title: "주거환경개선특별/주거환경개선지구", fileTag: "AL_D028", typeHint: "주거환경개선" },
] as const satisfies readonly { key: string; sourceId: string; title: string; fileTag: string; typeHint: MaintType | null }[];
export type MzoneLayerKey = (typeof MZONE_LAYERS)[number]["key"];
type MaintType = "재개발" | "재건축" | "주거환경개선";

export const MZONE_RIGHTS = { ...ZONING_RIGHTS, note: "정비구역 5개 레이어(dsId 24)도 용도지역과 같은 근거로 적재" } as const;

export const LINK_RELATION = "zone_of_project";
export const LINK_METHOD = "name_sgg";
/** 이 값 미만이면 잇지 않는다 */
export const LINK_MIN_CONFIDENCE = 0.8;
/** 최고점과 이 차이 안에 다른 사업이 또 있으면 모호 → 잇지 않는다 */
const AMBIGUITY_GAP = 0.05;

const s = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim() : "";
  return t === "" ? null : t;
};

/** 20190801 → 2019-08-01. 실제 달력에 있는 날짜만 (아니면 null; 원문은 별도로 둔다) */
export function validDate(v: unknown): string | null {
  const m = s(v)?.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === iso ? iso : null;
}

// ─── 이름 정규화 ──────────────────────────────────────────────────────────
/** 긴 것부터 지운다. 사업 종류·구역 단위를 나타내는 낱말이라 이름 구분에 쓸모가 없다. */
const STRIP_WORDS = [
  "재개발정비구역", "재건축정비구역", "주거환경개선지구", "주거환경개선사업", "재정비촉진지구", "재정비촉진구역", "정비예정구역", "주택재개발", "주택재건축",
  "도시환경정비사업", "도시환경정비", "도시정비형", "재정비촉진", "재개발사업", "재건축사업", "정비구역", "정비사업", "촉진지구", "촉진구역", "재개발", "재건축",
  "아파트", "주택", "사업", "정비", "구역", "지구",
];
const STRIP_RE = new RegExp(STRIP_WORDS.join("|"), "g");
/** 괄호 안에 흔히 오는 뜻 없는 말: 이름 키로 쓰지 않는다 */
const STOP_INNER = new Set(["도시환경", "존치관리", "공공", "민간", "도시재생"]);

export interface NameKeys {
  /** 괄호 밖 본문 (비어 있을 수 있다) */
  main: string;
  /** 괄호 안 (3글자 이상, 정확 일치에만 쓴다) */
  inner: string[];
}

/** 비교용 키. "제1구역"·"1구역"·"1지구" → "1", "홍제제3주택재개발정비구역" → "홍제3". */
export function nameKeys(raw: string | null): NameKeys {
  const t = (raw ?? "").normalize("NFKC");
  const norm = (p: string) => p
    .replace(/<[^>]*>/g, "") // "<인천광역시 고시 제2020-129호>" 같은 고시 표기
    .replace(STRIP_RE, "")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/제(?=\d)/g, "")
    .replace(/(^|\D)0+(?=\d)/g, "$1");
  const inner = [...t.matchAll(/\(([^)]*)\)/g)].map((m) => norm(m[1])).filter((k) => k.length >= 3 && hasHangul(k) && !STOP_INNER.has(k));
  return { main: norm(t.replace(/\([^)]*\)/g, " ")), inner: [...new Set(inner)] };
}
const allKeys = (n: NameKeys) => [n.main, ...n.inner].filter((k) => k.length >= 2 && hasHangul(k));
const hasHangul = (k: string) => /[가-힣]/.test(k);
const isDigit = (c: string | undefined) => c !== undefined && /\d/.test(c);

/** short가 long 안에 있고 앞뒤가 숫자로 이어지지 않으면 true ("신길1"은 "신길13" 안에 있지 않다) */
function containsAtBoundary(long: string, short: string): boolean {
  for (let i = long.indexOf(short); i >= 0; i = long.indexOf(short, i + 1)) {
    if (!isDigit(long[i - 1]) && !isDigit(long[i + short.length])) return true;
  }
  return false;
}

/** 이름 글자에서 본 사업 유형 */
export function typeFromText(text: string | null): MaintType | null {
  if (!text) return null;
  if (text.includes("재개발") || text.includes("도시환경정비")) return "재개발"; // 도시환경정비사업은 옛 재개발 계열
  if (text.includes("재건축")) return "재건축";
  if (text.includes("주거환경")) return "주거환경개선";
  return null;
}

/** 구역명: A8이 유형 이름뿐("정비구역")이면 비어 있는 것으로 보고 A9로 넘어간다. */
export function cleanZoneName(a8: unknown, a9: unknown): { name: string | null; altName: string | null; source: "A8" | "A9" | null } {
  const c = (v: unknown) => { const t = s(v); const k = nameKeys(t); return t && (k.main !== "" || k.inner.length > 0) ? t : null; };
  const n8 = c(a8);
  const n9 = c(a9);
  if (n8) return { name: n8, altName: n9 && n9 !== n8 ? n9 : null, source: "A8" };
  return { name: n9, altName: null, source: n9 ? "A9" : null };
}

// ─── 시군구 이름 → 코드 ───────────────────────────────────────────────────
/** 명부의 시군구 이름은 "성남수정구"(시 글자 없음)·"강남구". core legal_area의 "경기도 성남시 수정구"를 같은 꼴로 만든다. */
export function sigunguIndex(rows: readonly { code: string; name: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const { code, name } of rows) {
    const tok = name.split(/\s+/);
    const rest = tok.slice(1);
    const local = rest.length >= 2 ? rest[0].replace(/시$/, "") + rest.slice(1).join("") : rest.length === 1 ? rest[0] : tok[0];
    out.set(`${code.slice(0, 2)}|${local}`, code);
  }
  return out;
}
export const sigunguIndexFromCore = (core: Db) =>
  sigunguIndex(core.prepare("SELECT code, name FROM legal_area WHERE level = 'sigungu'").all() as { code: string; name: string }[]);

// ─── 적재 ─────────────────────────────────────────────────────────────────
export function mzoneLayerFiles(paths: readonly string[]): Map<MzoneLayerKey, SidoShpSet> {
  const out = new Map<MzoneLayerKey, SidoShpSet>();
  for (const l of MZONE_LAYERS) {
    // 같은 이름의 파일이 두 폴더에 풀려 있어도(수동 추출 x/ + extractAll) 한 번만 읽는다
    const uniq = [...new Map(paths.map((p) => [p.split(/[\\/]/).pop()!, p])).values()];
    const set = latestShpPerSido(uniq, l.fileTag).get("00");
    if (set) out.set(l.key, set);
  }
  return out;
}

export interface MzoneLayerInput {
  layer: MzoneLayerKey;
  releaseId: string;
  records: AsyncIterable<ShpRecord>;
}

export interface MzoneRoster { id: string; sido: string; sigungu: string; name: string; type: string }
export interface Zone { stableId: string; releaseId: string; layer: MzoneLayerKey; sigungu: string; name: string | null; altName: string | null; typeLabel: string | null }

export async function buildMaintenanceZones(db: Db, layers: MzoneLayerInput[], roster?: { projects: readonly MzoneRoster[]; sigungu: Map<string, string> }): Promise<SourceStats[]> {
  const seen = new Map<string, number>();
  const out: SourceStats[] = [];
  for (const input of layers) {
    const layer = MZONE_LAYERS.find((l) => l.key === input.layer)!;
    const stats = new SourceStats(layer.sourceId, input.releaseId, ["name", "announcedDate"]);
    await batched(db, input.records, (r) => {
      stats.read();
      const p = r.properties;
      const g = r.geometry;
      const sigungu = s(p.A4);
      const id = s(p.A1);
      if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon") || !id || !sigungu || !/^\d{5}$/.test(sigungu)) return stats.reject();
      const { name, altName, source } = cleanZoneName(p.A8, p.A9);
      const props = {
        layer: layer.key,
        typeCode: s(p.A5),
        typeLabel: s(p.A6),
        announcedDate: validDate(p.A7),
        announcedRaw: s(p.A7),
        name,
        altName,
        nameSource: source,
        sigungu,
        featureId: id,
        sourceUpdatedAt: s(p.A3),
      };
      const stable = `mzone:${layer.key}:${id}`;
      const n = seen.get(stable) ?? 0;
      seen.set(stable, n + 1);
      insertFeature(db, { stableId: n === 0 ? stable : `${stable}#${n}`, kind: "maintenance_zone", sourceKey: id, releaseId: input.releaseId, geometry: g, name, legalCode: `${sigungu}00000`, properties: props });
      stats.accept(props, sigungu.slice(0, 2), s(p.A6) ?? "(미상)");
    }, 1000);
    out.push(stats);
  }
  const link = roster ? linkZones(db, roster.projects, roster.sigungu) : null;
  for (const st of out) {
    const l = link?.byRelease.get(st.releaseId);
    db.prepare("UPDATE source_release SET coverage_json = ?, rights_json = ? WHERE release_id = ?").run(
      JSON.stringify({ byRegion: st.byRegion, polygons: true, matching: link ? { relation: LINK_RELATION, method: LINK_METHOD, minConfidence: LINK_MIN_CONFIDENCE, zones: l?.zones ?? 0, linked: l?.linked ?? 0, unresolvedRosterSigungu: link.unresolvedSigungu } : "명부 없이 적재" }),
      JSON.stringify({ ...MZONE_RIGHTS, layer: MZONE_LAYERS.find((x) => x.sourceId === st.sourceId)?.title }),
      st.releaseId,
    );
  }
  return out;
}

// ─── 매칭 ─────────────────────────────────────────────────────────────────
export interface Candidate { projectId: string; score: number; why: string }
export interface Match { zone: Zone; projectId: string; confidence: number; why: string }
export interface Reject { zone: Zone; reason: "no_name" | "no_candidate" | "low_score" | "ambiguous"; best: Candidate[] }

const round2 = (x: number) => Math.round(x * 100) / 100;

/** 구역 하나와 사업 하나의 점수. 이름이 후보 조건에 못 미치면 null. */
export function scorePair(zone: Pick<Zone, "layer" | "name" | "altName">, proj: Pick<MzoneRoster, "name" | "type">): { score: number; why: string } | null {
  const pk = nameKeys(proj.name);
  const zks = [zone.name, zone.altName].map((n) => nameKeys(n));
  const ok = (k: string) => k.length >= 3 && hasHangul(k);
  let base = 0;
  let why = "";
  for (const pa of allKeys(pk)) for (const zk of zks) for (const za of allKeys(zk)) if (pa === za && base < 0.85) { base = 0.85; why = "exact"; }
  // 구역명이 사업명을 품은 경우만(구역명 쪽이 긴 설명문일 때). 반대(사업명이 더 긴 경우: "중앙동" ⊂ "속초중앙동")는 우연이 많아 쓰지 않는다.
  // 포함은 괄호 밖 본문끼리만 (괄호 안 짧은 말·비고 문장에 우연히 들어 있는 경우를 막는다)
  if (base === 0) {
    for (const zk of zks) if (ok(pk.main) && containsAtBoundary(zk.main, pk.main)) { base = 0.75; why = "zone-contains"; }
  }
  if (base === 0) return null;
  const layerHint = MZONE_LAYERS.find((l) => l.key === zone.layer)?.typeHint ?? null;
  const zType = typeFromText([zone.name, zone.altName].filter(Boolean).join(" ")) ?? layerHint;
  const pType = (proj.type === "미상" ? typeFromText(proj.name) : proj.type) as MaintType | null; // 표준데이터 사업은 유형이 없어 이름 글자로 본다
  let score = base;
  if (zType && pType) {
    if (zType === pType) { score += 0.05; why += "+type"; } else { score -= 0.3; why += "-type"; }
  }
  return { score: round2(score), why };
}

/** 점수순 후보에서 결정한다: 임계값 이상이고 다른 사업이 AMBIGUITY_GAP 안에 없을 때만 잇는다. */
export function decide(zone: Zone, cands: Candidate[]): Match | Reject {
  if (!zone.name && !zone.altName) return { zone, reason: "no_name", best: [] };
  if (cands.length === 0) return { zone, reason: "no_candidate", best: [] };
  const sorted = [...cands].sort((a, b) => b.score - a.score || (a.projectId < b.projectId ? -1 : 1));
  const [top, second] = sorted;
  if (top.score < LINK_MIN_CONFIDENCE) return { zone, reason: "low_score", best: sorted.slice(0, 3) };
  if (second && second.score >= LINK_MIN_CONFIDENCE && top.score - second.score < AMBIGUITY_GAP) return { zone, reason: "ambiguous", best: sorted.slice(0, 3) };
  return { zone, projectId: top.projectId, confidence: top.score, why: top.why };
}

/** 2026 행정통합: 광주(29)·전남(46) → 전남광주통합특별시(코드 12). 명부는 옛 시도 코드를 쓴다. */
const SIDO_ALIAS: Record<string, string> = { 29: "12", 46: "12" };

export function matchZones(zones: readonly Zone[], projects: readonly MzoneRoster[], sigungu: Map<string, string>): { matches: Match[]; rejects: Reject[]; unresolvedSigungu: number } {
  const byCode = new Map<string, MzoneRoster[]>();
  let unresolved = 0;
  for (const p of projects) {
    const sido = SIDO_ALIAS[p.sido] ?? p.sido;
    const name = p.sigungu.replace(/\s+/g, "");
    const exact = sigungu.get(`${sido}|${name}`);
    // 구가 있는 시가 구 없이 적힌 행("안산시"): 그 시의 구들을 모두 후보 위치로 본다
    const stem = name.endsWith("시") ? name.slice(0, -1) : null;
    const codes = exact ? [exact] : stem ? [...sigungu].filter(([k]) => k.startsWith(`${sido}|${stem}`) && /구$/.test(k)).map(([, c]) => c) : [];
    if (codes.length === 0) { unresolved++; continue; }
    for (const code of codes) byCode.set(code, [...(byCode.get(code) ?? []), p]);
  }
  const known = new Set(sigungu.values());
  const matches: Match[] = [];
  const rejects: Reject[] = [];
  for (const z of zones) {
    // 구가 있는 시에서 A4가 시 단위 코드(끝이 0이고 법정구역에 없음)면 같은 시의 구들을 후보로 두되 조금 감점한다.
    const cityLevel = !known.has(z.sigungu) && z.sigungu.endsWith("0");
    const pool = cityLevel ? [...byCode].filter(([c]) => c.slice(0, 4) === z.sigungu.slice(0, 4)).flatMap(([, v]) => v) : (byCode.get(z.sigungu) ?? []);
    const cands: Candidate[] = [];
    for (const p of pool) {
      const sc = scorePair(z, p);
      if (sc) cands.push({ projectId: p.id, score: round2(sc.score - (cityLevel ? 0.05 : 0)), why: sc.why });
    }
    const d = decide(z, cands);
    if ("projectId" in d) matches.push(d);
    else rejects.push(d);
  }
  return { matches, rejects, unresolvedSigungu: unresolved };
}

export function zonesFromDb(db: Db): Zone[] {
  return (db.prepare("SELECT stable_id, release_id, properties_json FROM feature WHERE kind = 'maintenance_zone' ORDER BY feature_id").all() as { stable_id: string; release_id: string; properties_json: string }[]).map((r) => {
    const p = JSON.parse(r.properties_json);
    return { stableId: r.stable_id, releaseId: r.release_id, layer: p.layer, sigungu: p.sigungu, name: p.name, altName: p.altName, typeLabel: p.typeLabel };
  });
}

/** 적재된 구역을 명부와 매칭해 feature_link를 쓴다. */
export function linkZones(db: Db, projects: readonly MzoneRoster[], sigungu: Map<string, string>) {
  const r = matchZones(zonesFromDb(db), projects, sigungu);
  const ins = db.prepare("INSERT OR IGNORE INTO feature_link (from_stable_id, to_stable_id, relation_type, method, confidence, release_id) VALUES (?, ?, ?, ?, ?, ?)");
  const byRelease = new Map<string, { zones: number; linked: number }>();
  const bump = (rel: string, k: "zones" | "linked") => { const e = byRelease.get(rel) ?? { zones: 0, linked: 0 }; e[k]++; byRelease.set(rel, e); };
  db.exec("BEGIN");
  try {
    for (const m of r.matches) { ins.run(m.zone.stableId, m.projectId, LINK_RELATION, LINK_METHOD, m.confidence, m.zone.releaseId); bump(m.zone.releaseId, "linked"); bump(m.zone.releaseId, "zones"); }
    for (const x of r.rejects) bump(x.zone.releaseId, "zones");
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { ...r, byRelease };
}
