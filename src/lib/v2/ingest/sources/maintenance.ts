/**
 * 정비사업 현황 (tile-catalog D23) — 통합(data.go.kr 15160169)·표준데이터(15155703) 전국 CSV.
 * 두 파일 모두 주소·좌표·경계가 없다(시도·시군구·구역명뿐). 그래서 feature(위치)는 만들지 않고,
 * 사업당 development_event(market)만 적재한다: 공급 중복 제거(A06/A09)가 project_id로 잇고, 경계 원천이 생기면 같은 id로 feature를 붙인다.
 * 위치를 못 얻은 사업의 명부(이름·유형·단계·세대수)는 release coverage_json.projects에 남긴다 — 버리지 않고 세지도 않은 채 두지 않는다.
 *
 * 사업 id = "maint:" + sha256(시도2자리|시군구|구역명(공백 제거)|사업유형 대분류) 앞 16자.
 *  - 단계·세대수·시행자는 시간에 따라 바뀌므로 키에 넣지 않는다. 유형(재개발/재건축/주거환경개선)은 바뀌지 않는다.
 *  - 표준데이터는 유형이 없다: 통합에 (시도, 구역명, 시군구 접두 일치)로 정확히 한 건 맞으면 그 사업의 지정일 이벤트로 잇고, 아니면 유형 "미상"의 별도 사업이다.
 */
import type BetterSqlite3 from "better-sqlite3";
import type { MeasureRecord } from "../../a0/measure";
import { sha256Hex } from "../../canonical-json";
import { batched, SourceStats } from "../build";
import { sidoCodeOfName } from "./school-kapt";

type Db = BetterSqlite3.Database;

export const MAINT_STAGES = ["정비계획", "구역지정", "추진위", "조합", "사업시행", "관리처분", "착공", "준공", "미확인"] as const;
export type MaintStage = (typeof MAINT_STAGES)[number];

const INTEGRATED_STAGE: Record<string, MaintStage> = {
  정비구역지정: "구역지정", 추진위구성: "추진위", 조합설립인가: "조합", 사업시행인가: "사업시행", 관리처분인가: "관리처분", 착공: "착공",
  // 사업시행자지정(주거환경개선의 공공시행): 위 순서의 어디에 놓이는지 원천에 정의가 없어 추측하지 않는다.
};
const STD_STAGE: Record<string, MaintStage> = {
  구역지정: "구역지정", "추진위원회 승인": "추진위", 조합설립인가: "조합", 사업시행계획인가: "사업시행", 관리처분계획인가: "관리처분",
  "이주 및 철거": "관리처분", // 관리처분인가 뒤·착공 앞 (판단)
  "착공 및 일반분양": "착공", "해산 및 청산": "준공", // 조합 해산·청산은 준공 뒤 (판단)
};

const str = (v: unknown): string | null => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
};
const positive = (v: unknown): number | null => {
  const s = str(v)?.replace(/,/g, "") ?? "";
  const n = Number(s);
  return s !== "" && Number.isInteger(n) && n > 0 ? n : null;
};
const compact = (s: string) => s.replace(/\s+/g, "");
const noNo = (v: unknown) => str(v)?.replace(/^\d+\)\s*/, "") ?? null; // "6)관리처분인가" → "관리처분인가"

export function normalizeStage(raw: unknown, origin: "integrated" | "std"): MaintStage {
  const s = origin === "integrated" ? noNo(raw) : str(raw);
  return (s && (origin === "integrated" ? INTEGRATED_STAGE : STD_STAGE)[s]) || "미확인";
}
/** "1)재개발(주택정비)" · "2)재개발(도시정비)" → 재개발, "3)/4)재건축(…)" → 재건축, "5)주거환경개선" → 주거환경개선 */
export function normalizeType(raw: unknown): string {
  const s = noNo(raw) ?? "";
  return s.startsWith("재개발") ? "재개발" : s.startsWith("재건축") ? "재건축" : s.startsWith("주거환경") ? "주거환경개선" : "미상";
}
export function projectId(sido2: string, sigungu: string, name: string, type: string): string {
  return `maint:${sha256Hex([sido2, compact(sigungu), compact(name), type].join("|")).slice(0, 16)}`;
}

interface Project { id: string; sido2: string; sigungu: string; name: string; type: string; rawType: string | null; rawStage: string | null; stage: MaintStage; households: number | null; designatedAt: string | null; operator: string | null; origin: string }
const EVIDENCE = { integrated: "https://www.data.go.kr/data/15160169/fileData.do", std: "https://www.data.go.kr/data/15155703/standard.do" };

function insertEvent(db: Db, e: { id: string; projectId: string; stage: MaintStage; effectiveDate: string | null; units: number | null; url: string; releaseId: string }): void {
  db.prepare(`INSERT INTO development_event (event_id, project_id, event_type, stage, effective_date, planned_date, planned_date_precision, units, geometry_id, evidence_url, release_id)
    VALUES (?, ?, 'maintenance_stage', ?, ?, NULL, 'unknown', ?, NULL, ?, ?)`).run(e.id, e.projectId, e.stage, e.effectiveDate, e.units, e.url, e.releaseId);
}

const tally = (t: Record<string, { received: number; accepted: number; located: number; rejected: number }>, r: string) => (t[r] ??= { received: 0, accepted: 0, located: 0, rejected: 0 });
const FILL = ["stage", "households", "type", "designatedAt"] as const;

export async function buildMaintenance(
  db: Db,
  input: { integrated: AsyncIterable<MeasureRecord>; integratedReleaseId: string; std: AsyncIterable<MeasureRecord>; stdReleaseId: string },
): Promise<SourceStats[]> {
  const byId = new Map<string, Project>();
  const byName = new Map<string, Project[]>(); // 시도2|구역명 → 사업 (표준 ↔ 통합 대조용)
  const finish = (s: SourceStats, projects: Project[], byRegion: Record<string, { received: number; accepted: number; located: number; rejected: number }>, extra: Record<string, unknown>) => {
    db.prepare("UPDATE source_release SET coverage_json = ?, rights_json = ? WHERE release_id = ?").run(
      JSON.stringify({ byRegion, located: 0, unlocated: projects.length, ...extra, note: "원천에 주소·좌표가 없어 위치 feature 없음. projects = 위치 없는 사업 명부.", projects: projects.map((p) => ({ id: p.id, sido: p.sido2, sigungu: p.sigungu, name: p.name, type: p.type, rawStage: p.rawStage, stage: p.stage, households: p.households, designatedAt: p.designatedAt, operator: p.operator })) }),
      JSON.stringify({ license: "이용허락범위 제한 없음", origin: s.sourceId }),
      s.releaseId,
    );
    s.expectedRegions = Object.keys(byRegion).filter((k) => k !== "(미상)");
  };

  const integ = new SourceStats("maintenance_integrated", input.integratedReleaseId, FILL);
  const iProjects: Project[] = [];
  const iRegion: Record<string, { received: number; accepted: number; located: number; rejected: number }> = {};
  await batched(db, input.integrated, (r) => {
    integ.read();
    const p = r.properties;
    const sigungu = str(p["시군구"]);
    const name = str(p["구역명칭"]);
    const sido2 = sidoCodeOfName(p["시도"]);
    const t = tally(iRegion, sido2);
    t.received++;
    const type = normalizeType(p["사업유형"]);
    if (!sigungu || !name || sido2 === "(미상)") { t.rejected++; return integ.reject(); }
    const id = projectId(sido2, sigungu, name, type);
    if (byId.has(id)) { t.rejected++; return integ.reject(); } // 시도·시군구·구역명·유형이 모두 같은 반복 행
    const proj: Project = { id, sido2, sigungu, name, type, rawType: str(p["사업유형"]), rawStage: str(p["현 사업추진단계"]), stage: normalizeStage(p["현 사업추진단계"], "integrated"), households: positive(p["공급 예정 세대수"]), designatedAt: null, operator: noNo(p["사업시행자"]), origin: "integrated" };
    byId.set(id, proj);
    const key = `${sido2}|${compact(name)}`;
    byName.set(key, [...(byName.get(key) ?? []), proj]);
    iProjects.push(proj);
    insertEvent(db, { id, projectId: id, stage: proj.stage, effectiveDate: null, units: proj.households, url: EVIDENCE.integrated, releaseId: input.integratedReleaseId });
    t.accepted++;
    integ.accept({ stage: proj.stage === "미확인" ? null : proj.stage, households: proj.households, type: type === "미상" ? null : type, designatedAt: null }, sido2, type);
  });

  const std = new SourceStats("maintenance_std", input.stdReleaseId, FILL);
  const sProjects: Project[] = [];
  const sRegion: Record<string, { received: number; accepted: number; located: number; rejected: number }> = {};
  let linked = 0;
  const seenStd = new Set<string>();
  await batched(db, input.std, (r) => {
    std.read();
    const p = r.properties;
    const sigungu = str(p["시군구명"]);
    const name = str(p["구역명"]);
    const sido2 = sidoCodeOfName(p["시도명"]);
    const t = tally(sRegion, sido2);
    t.received++;
    if (!sigungu || !name || sido2 === "(미상)") { t.rejected++; return std.reject(); }
    const d = str(p["지정일자"]) ?? "";
    const t0 = Date.parse(`${d}T00:00:00Z`);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(t0) && new Date(t0).toISOString().slice(0, 10) === d ? d : null; // 일 단위 그대로. 없거나 불가능한 날짜면 null — 일을 만들지 않는다
    const match = (byName.get(`${sido2}|${compact(name)}`) ?? []).filter((q) => q.sigungu.startsWith(sigungu) || sigungu.startsWith(q.sigungu));
    const stage = normalizeStage(p["진행단계내용"], "std");
    const households = positive(p["세대수"]);
    if (match.length === 1) {
      // 통합의 같은 사업: 새 사업을 만들지 않고 지정일만 잇는다(현재 단계·세대수는 통합 값을 유지).
      const m = match[0];
      const evId = `${m.id}:designated`;
      if (seenStd.has(evId)) { t.rejected++; return std.reject(); }
      seenStd.add(evId);
      if (date) insertEvent(db, { id: evId, projectId: m.id, stage: "구역지정", effectiveDate: date, units: null, url: EVIDENCE.std, releaseId: input.stdReleaseId });
      m.designatedAt ??= date;
      linked++;
      t.accepted++;
      return std.accept({ stage: stage === "미확인" ? null : stage, households, type: null, designatedAt: date }, sido2, "linked");
    }
    const id = projectId(sido2, sigungu, name, "미상");
    if (byId.has(id)) { t.rejected++; return std.reject(); }
    const proj: Project = { id, sido2, sigungu, name, type: "미상", rawType: null, rawStage: str(p["진행단계내용"]), stage, households, designatedAt: date, operator: str(p["관리기관명"]), origin: "std" };
    byId.set(id, proj);
    sProjects.push(proj);
    insertEvent(db, { id, projectId: id, stage, effectiveDate: null, units: households, url: EVIDENCE.std, releaseId: input.stdReleaseId });
    if (date) insertEvent(db, { id: `${id}:designated`, projectId: id, stage: "구역지정", effectiveDate: date, units: null, url: EVIDENCE.std, releaseId: input.stdReleaseId });
    t.accepted++;
    std.accept({ stage: stage === "미확인" ? null : stage, households, type: null, designatedAt: date }, sido2, "std_only");
  });

  // 명부는 위치 없는 사업 전체: 통합 사업(지정일이 붙은 것 포함)과 표준 단독 사업
  finish(integ, iProjects, iRegion, {});
  finish(std, sProjects, sRegion, { linkedToIntegrated: linked });
  return [integ, std];
}
