/** 서울플랜+ 정비사업 경계와 사업 현황을 시군구·면적 또는 이름으로 연결한다. */
import type BetterSqlite3 from "better-sqlite3";
import { insertFeature } from "../../data/features";
import { batched, SourceStats } from "../build";
import type { ShpRecord } from "../shp";
import type { SeoulPlanApiRow } from "../seoul-plan-fetch";
import { validDate } from "./maintenance-zone";

type Db = BetterSqlite3.Database;
export const SEOUL_PLAN_SOURCE_ID = "seoul_plan_zone";
export const SEOUL_PLAN_RIGHTS = { license: "공공누리 제4유형", origin: "서울특별시 서울플랜+ OA-22712·OA-23112·OA-23113" } as const;

export const SEOUL_PLAN_CLASSES: Record<string, readonly [string, string]> = {
  BZ101: ["신속통합기획", "신속통합기획"], BZ102: ["재개발(도시정비형)", "재개발"], BZ103: ["재개발(주택정비형)", "재개발"],
  BZ104: ["재건축(단독)", "재건축"], BZ105: ["재건축(공동)", "재건축"], BZ107: ["주거환경개선(관리형)", "주거환경개선"], BZ108: ["주거환경개선(정비형)", "주거환경개선"],
  BZ201: ["모아타운", "모아타운"], BZ202: ["가로주택정비사업", "가로주택정비"], BZ203: ["자율주택정비사업", "자율주택정비"], BZ204: ["소규모재건축사업", "소규모재건축"], BZ205: ["소규모재개발사업", "소규모재개발"],
  BZ401: ["재정비촉진지구", "재정비촉진지구"], BZ402: ["재정비촉진구역", "재정비촉진구역"], BZ403: ["존치정비구역", "존치구역"], BZ404: ["존치관리구역", "존치구역"], BZ502: ["도심 공공주택 복합사업", "도심공공주택복합"],
};

export const SEOUL_PLAN_STAGE_NAMES: Record<string, string> = {
  PP0101: "대상지선정(추진중)", PP0102: "대상지선정", PP0103: "기획완료", PP0104: "보류",
  PP0201: "입안제안", PP0202: "열람공고", PP0203: "위원회심의", PP0204: "구역지정", PP0205: "추진위구성", PP0206: "조합설립인가", PP0207: "건축심의", PP0208: "사업시행인가", PP0209: "관리처분계획인가", PP0210: "착공", PP0211: "준공",
  PP0301: "대상지선정", PP0302: "정비계획수립", PP0303: "위원회심의", PP0304: "구역지정", PP0305: "사업시행인가", PP0306: "착공", PP0307: "준공(일부)", PP0308: "준공",
  PP0401: "수립범위 자문", PP0402: "대상지선정", PP0403: "관리지역고시", PP0404: "사전자문", PP0405: "위원회심의", PP0406: "관리지역고시",
  PP0500: "조합설립인가 추진중(연번부여)", PP0501: "조합설립인가", PP0502: "건축심의", PP0503: "사업시행인가", PP0504: "착공", PP0505: "준공",
  PP0601: "주민합의체 구성", PP0602: "건축심의", PP0603: "사업시행인가", PP0604: "착공", PP0605: "준공",
  PP0701: "조합설립추진중", PP0702: "조합설립인가", PP0703: "건축심의", PP0704: "사업시행계획인가", PP0705: "착공", PP0706: "준공",
  PP1001: "지구지정", PP1002: "지구변경", PP1101: "대상지선정", PP1102: "촉진계획수립(변경)", PP1103: "열람공고", PP1104: "위원회심의", PP1105: "구역지정", PP1107: "추진위구성", PP1108: "조합설립인가", PP1109: "건축심의", PP1110: "사업시행인가", PP1111: "관리처분계획인가", PP1112: "착공", PP1113: "준공",
  PP1201: "예정지구지정", PP1202: "후보지선정", PP1203: "지구지정", PP1204: "설계공모완료", PP1205: "사업계획승인", PP1206: "착공", PP1207: "준공", PP1208: "입주중", PP1209: "후보지철회", PP2101: "구역지정", PP2102: "구역변경",
};
Object.assign(SEOUL_PLAN_STAGE_NAMES, {
  PP0801: "대상지선정", PP0802: "사전검토", PP0803: "입안제안", PP0804: "열람공고", PP0805: "위원회심의",
  PP0806: "구역지정", PP0807: "건축심의", PP0808: "사업계획승인", PP0809: "착공", PP0810: "준공",
  PP0901: "대상지선정", PP0902: "통심위 사전자문", PP0903: "입안제안", PP0904: "열람공고", PP0905: "위원회심의",
  PP0906: "구역지정", PP0907: "건축심의", PP0908: "사업계획승인", PP0909: "건축허가", PP0910: "착공",
  PP0911: "사용승인", PP0912: "입주", PP1901: "입주자 모집공고 완료", PP1801: "대상지선정", PP1802: "통심위 사전자문",
  PP1803: "입안제안", PP1804: "열람공고", PP1805: "위원회심의", PP1806: "구역지정", PP1807: "건축심의/통합심의",
  PP1808: "사업계획승인", PP1809: "착공", PP1810: "준공", PP2001: "입안제안", PP2002: "열람공고",
  PP2003: "위원회심의", PP2004: "구역지정", PP2005: "지구계획승인(변경)", PP2006: "착공", PP2007: "준공",
  PP1301: "입안제안", PP1302: "열람공고", PP1303: "위원회심의", PP1304: "구역지정", PP1305: "실시계획인가",
  PP1306: "준공", PP1401: "조합설립인가", PP1402: "1차 안전진단", PP1403: "건축심의", PP1404: "리모델링허가승인",
  PP1405: "2차 안전진단", PP1406: "착공", PP1407: "준공", PP1501: "추진계획수립중", PP1502: "추진계획승인",
  PP1503: "조합설립인가", PP1504: "사업시행계획인가", PP1505: "관리처분계획인가", PP1506: "착공", PP1507: "준공",
  PP1601: "대상지선정", PP1602: "활성화계획수립", PP1603: "마중물사업(추진중)", PP1604: "사업완료", PP2201: "대상지 선정",
  PP2202: "제안서접수", PP2203: "협상조정협의회 운영", PP2204: "협상완료", PP2205: "입안절차 진행", PP2206: "도시건축공동위 심의",
  PP2207: "결정고시", PP2208: "인허가 절차", PP2209: "착공", PP2210: "준공",
});
const STAGES: Record<string, string> = {};
for (const [stage, codes] of Object.entries({
  정비계획: "PP0101 PP0102 PP0103 PP0104 PP0201 PP0202 PP0203 PP0301 PP0302 PP0303 PP0401 PP0402 PP0404 PP0405 PP1101 PP1102 PP1103 PP1104 PP1201 PP1202",
  구역지정: "PP0204 PP0304 PP0403 PP0406 PP1001 PP1002 PP1105 PP2101 PP2102 PP1203 PP1204",
  추진위: "PP0205 PP1107 PP0500 PP0701", 조합: "PP0206 PP0207 PP1108 PP1109 PP0501 PP0502 PP0601 PP0602 PP0702 PP0703",
  사업시행: "PP0208 PP0305 PP1110 PP0503 PP0603 PP0704 PP1205", 관리처분: "PP0209 PP1111",
  착공: "PP0210 PP0306 PP1112 PP0504 PP0604 PP0705 PP1206", 준공: "PP0211 PP0307 PP0308 PP1113 PP0505 PP0605 PP0706 PP1207 PP1208",
})) for (const code of codes.split(" ")) STAGES[code] = stage;

const str = (v: unknown): string | null => typeof v === "string" && v.replace(/\u0000/g, "").trim() ? v.replace(/\u0000/g, "").trim() : null;
const num = (v: unknown): number | null => {
  if (typeof v !== "number" && typeof v !== "string") return null;
  if (typeof v === "string" && !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const date = (v: unknown) => {
  const value = str(v);
  if (!value) return null;
  const m = /^(\d{4})-?(\d{2})-?(\d{2})(?:\s.*)?$/.exec(value);
  return m ? validDate(`${m[1]}${m[2]}${m[3]}`) : null;
};
const nameKey = (v: unknown) => (str(v) ?? "").normalize("NFKC").replace(/\(가칭\)/g, "").replace(/[()\s]/g, "").replace(/(?:정비사업|사업|구역)+$/g, "");
const apiSigungu = (row: SeoulPlanApiRow, index?: Map<string, string>) => {
  const value = str(row.SITE_CODE);
  if (value && /^\d{5}$/.test(value)) return value;
  const name = str(row.SITE_CODE_NM) ?? value;
  return name ? index?.get(`11|${name.replace(/^서울특별시\s*/, "")}`) ?? null : null;
};

export async function loadSeoulPlanZones(db: Db, input: { releaseId: string; records: AsyncIterable<ShpRecord> | Iterable<ShpRecord>; api?: SeoulPlanApiRow[]; sigungu?: Map<string, string> }): Promise<SourceStats> {
  const stats = new SourceStats(SEOUL_PLAN_SOURCE_ID, input.releaseId, ["geometry", "name", "stage"]);
  const records: ShpRecord[] = [];
  const excludedClasses: Record<string, number> = {};
  for await (const r of input.records) {
    stats.read();
    const cls = str(r.properties.SCLAS_CL) ?? "(미상)";
    if (!SEOUL_PLAN_CLASSES[cls]) { excludedClasses[cls] = (excludedClasses[cls] ?? 0) + 1; stats.reject(); continue; }
    if (!r.geometry || !["Polygon", "MultiPolygon"].includes(r.geometry.type) || !str(r.properties.PRESENT_SN) || !/^\d{5}$/.test(str(r.properties.SIGNGU_SE) ?? "")) { stats.reject(); continue; }
    records.push(r);
  }
  const groups = new Map<string, ShpRecord[]>();
  for (const r of records) {
    const grp = str(r.properties.GRP);
    if (grp) groups.set(grp, [...(groups.get(grp) ?? []), r]);
  }
  for (const members of groups.values()) members.sort((a, b) => (str(a.properties.PRESENT_SN) ?? "").localeCompare(str(b.properties.PRESENT_SN) ?? ""));
  const rows = input.api ?? [];
  const apiBySg = new Map<string, { row: SeoulPlanApiRow; index: number }[]>();
  rows.forEach((row, index) => {
    const sg = apiSigungu(row, input.sigungu);
    if (sg) apiBySg.set(sg, [...(apiBySg.get(sg) ?? []), { row, index }]);
  });
  const used = new Set<number>();
  const seen = new Map<string, number>();
  let matchedByArea = 0, matchedByName = 0;
  await batched(db, records, (r) => {
    const p = r.properties, cls = str(p.SCLAS_CL)!, id = str(p.PRESENT_SN)!, sg = str(p.SIGNGU_SE)!, grp = str(p.GRP);
    const members = grp ? groups.get(grp) ?? [] : [];
    const other = members.find((x) => str(x.properties.SCLAS_CL) !== "BZ101");
    const representative = members.some((x) => str(x.properties.SCLAS_CL) === "BZ101") && other ? other.properties : p;
    const projectClass = str(representative.SCLAS_CL)!;
    const stageCode = str(representative.PROPEL_CD);
    const area = num(p.DGM_AR);
    const candidates = apiBySg.get(sg) ?? [];
    const areaMatches = area === null ? [] : candidates.filter(({ row }) => { const a = num(row.BSNS_AREA); return a !== null && Math.abs(a - area) <= 0.5; });
    let match = areaMatches.length === 1 ? areaMatches[0] : undefined;
    if (match) matchedByArea++;
    else if (areaMatches.length === 0) {
      const key = nameKey(p.DGM_NM);
      const names = key ? candidates.filter(({ row }) => nameKey(row.BSNS_NAME) === key) : [];
      if (names.length === 1) { match = names[0]; matchedByName++; }
    }
    if (match) used.add(match.index);
    const a = match?.row;
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    const stableId = `seoulplan:${id}${n ? `#${n}` : ""}`;
    const households = num(a?.SUPLY_HSHLD);
    const props = {
      layer: "seoul_plan", classCode: cls, className: SEOUL_PLAN_CLASSES[cls][0], projectType: SEOUL_PLAN_CLASSES[projectClass][1],
      program: cls === "BZ101" || members.some((x) => str(x.properties.SCLAS_CL) === "BZ101") ? "신속통합기획" : null,
      areaKind: cls === "BZ201" ? "모아타운" : cls === "BZ401" ? "재정비촉진지구" : null,
      projectKey: grp ? `seoulplan:${grp}` : stableId, stageCode, stageName: stageCode ? SEOUL_PLAN_STAGE_NAMES[stageCode] ?? null : null,
      stage: stageCode ? STAGES[stageCode] ?? "미확인" : "미확인", stageDate: date(a?.PROPEL_DT), areaM2: area,
      households: households !== null && Number.isInteger(households) && households > 0 ? households : null,
      overview: a ? { bizAreaM2: num(a.BSNS_AREA), floorAreaRatio: num(a.FLAR_RT), buildingCoverage: num(a.BLDGLND_RT), floors: str(a.FLOOR), heightM: num(a.HEIGHT), saleUnits: num(a.PARCEL), rentUnits: num(a.RENTAL), zoningBefore: str(a.SPFC_PREV), zoningAfter: str(a.SPFC_AFTER) } : null,
      apiMatched: !!a, grp, sigungu: sg, sourceUpdatedAt: date(p.CREATE_DAT),
    };
    const name = str(p.DGM_NM);
    insertFeature(db, { stableId, kind: "maintenance_zone", sourceKey: id, releaseId: input.releaseId, geometry: r.geometry!, name, legalCode: `${sg}00000`, properties: props });
    stats.accept({ ...props, name, geometry: r.geometry, stage: props.stage === "미확인" ? null : props.stage }, sg.slice(0, 2), cls);
  }, 1000);
  db.prepare("UPDATE source_release SET coverage_json = ?, rights_json = ? WHERE release_id = ?").run(JSON.stringify({ polygons: stats.accepted, apiRows: rows.length, matchedByArea, matchedByName, unmatchedApi: rows.length - used.size, excludedClasses }), JSON.stringify(SEOUL_PLAN_RIGHTS), input.releaseId);
  return stats;
}
