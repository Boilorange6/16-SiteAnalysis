/**
 * 학교 위치·학구 연계(reference)와 K-APT(부동산원 단지 식별정보, core) 원천.
 * 학구 폴리곤은 원천에 없다 — 학구ID ↔ 학교ID ↔ 공간객체ID 관계만 feature_link로 남겨 두고, 폴리곤 원천이 생기면 이어 붙인다.
 */
import type BetterSqlite3 from "better-sqlite3";
import type { MeasureRecord } from "../../a0/measure";
import { insertFeature } from "../../data/features";
import { remapRenumberedPnu } from "../../data/jibun";
import { lookupParcelPoint } from "../../data/parcels";
import { batched, SourceStats } from "../build";
import type { PointSourceSpec } from "./points";

type Db = BetterSqlite3.Database;
type Props = Record<string, unknown>;

const str = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};
const positive = (v: unknown): number | null => {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return str(v) !== null && Number.isFinite(n) && n > 0 ? n : null;
};

/** 시도 이름(주소 첫 토큰·교육청명) → 2자리 시도 코드. 강원 51·전북 52는 신 코드(VWorld·K-APT와 같다) */
const SIDO_PREFIX: [string, string][] = [
  ["서울", "11"], ["부산", "26"], ["대구", "27"], ["인천", "28"], ["광주", "29"], ["대전", "30"], ["울산", "31"], ["세종", "36"],
  ["경기", "41"], ["강원", "51"], ["충청북", "43"], ["충북", "43"], ["충청남", "44"], ["충남", "44"], ["전북", "52"], ["전라북", "52"],
  ["전라남", "46"], ["전남", "46"], ["경상북", "47"], ["경북", "47"], ["경상남", "48"], ["경남", "48"], ["제주", "50"],
];
export function sidoCodeOfName(name: unknown): string {
  const s = str(name) ?? "";
  return SIDO_PREFIX.find(([p]) => s.startsWith(p))?.[1] ?? "(미상)";
}

export const SCHOOL_SPEC: PointSourceSpec = {
  sourceId: "school",
  kind: "school",
  lngField: "경도",
  latField: "위도",
  fillFields: ["학교급구분", "운영상태", "설립형태", "소재지지번주소"], // 원본 열 이름(buildPointSource가 원본 행으로 채움률을 낸다)
  idOf: (p) => str(p["학교ID"]),
  nameOf: (p) => str(p["학교명"]),
  legalCodeOf: () => null,
  regionOf: (p) => sidoCodeOfName(str(p["소재지지번주소"])?.split(/\s+/)[0] ?? p["시도교육청명"]),
  typeOf: (p) => str(p["학교급구분"]) ?? "(미상)",
  // 폐교 등 비운영 행도 버리지 않는다: operatingStatus에 원천 값을 그대로 둔다("운영" 외에는 소비 쪽이 걸러낸다).
  propsOf: (p) => ({
    schoolId: str(p["학교ID"]),
    level: str(p["학교급구분"]),
    operatingStatus: str(p["운영상태"]),
    foundation: str(p["설립형태"]),
    campus: str(p["본교분교구분"]),
    foundedAt: str(p["설립일자"]),
    address: str(p["소재지도로명주소"]) ?? str(p["소재지지번주소"]),
    jibunAddress: str(p["소재지지번주소"]),
    eduOffice: str(p["시도교육청명"]),
    eduSupportOffice: str(p["교육지원청명"]),
    asOf: str(p["데이터기준일자"]),
  }),
};

export const SCHOOL_ZONE_COVERAGE = {
  polygons: false,
  note: "학구 폴리곤 없음 — 학구ID↔학교ID(serves_zone)·학구ID↔공간객체ID(zone_geometry) 관계만 적재. 폴리곤 원천이 생기면 school_zone:<학구ID> 또는 공간객체ID로 잇는다.",
};

function insertLink(db: Db, from: string, to: string, relation: string, method: string, releaseId: string): boolean {
  return db.prepare("INSERT OR IGNORE INTO feature_link (from_stable_id, to_stable_id, relation_type, method, confidence, release_id) VALUES (?, ?, ?, ?, 1, ?)").run(from, to, relation, method, releaseId).changes === 1;
}

/** 학구–학교 연계: school:<학교ID> —serves_zone→ school_zone:<학구ID>. 학교 feature가 없으면 unlocated. 통학구역(초등) 파일: school_zone:<학구ID> —zone_geometry→ school_zone_geom:<공간객체ID>. */
export async function buildSchoolZoneLinks(
  db: Db,
  input: { link: AsyncIterable<MeasureRecord>; elem: AsyncIterable<MeasureRecord>; linkReleaseId: string; elemReleaseId: string },
): Promise<SourceStats[]> {
  const link = new SourceStats("school_zone_link", input.linkReleaseId, ["학교ID", "학구ID"]);
  const elem = new SourceStats("school_zone_elem", input.elemReleaseId, ["학구ID", "공간객체ID"]);
  const hasSchool = db.prepare("SELECT 1 FROM feature WHERE stable_id = ?").pluck();
  await batched(db, input.link, (r) => {
    link.read();
    const p = r.properties;
    const zone = str(p["학구ID"]);
    const school = str(p["학교ID"]);
    if (!zone || !school) return link.reject();
    if (!hasSchool.get(`school:${school}`)) return link.unlocate();
    if (!insertLink(db, `school:${school}`, `school_zone:${zone}`, "serves_zone", "school_zone_link", input.linkReleaseId)) return link.reject(); // 같은 연계 반복
    link.accept(p, sidoCodeOfName(p["시도교육청명"]), str(p["학교급구분"]) ?? "(미상)");
  });
  await batched(db, input.elem, (r) => {
    elem.read();
    const p = r.properties;
    const zone = str(p["학구ID"]);
    const obj = str(p["공간객체ID"]);
    if (!zone || !obj) return elem.reject();
    if (!insertLink(db, `school_zone:${zone}`, `school_zone_geom:${obj}`, "zone_geometry", "school_zone_elem", input.elemReleaseId)) return elem.reject();
    elem.accept(p, str(p["시도코드"]) ?? "(미상)", `class:${str(p["학구분류"]) ?? "(미상)"}`);
  });
  return [link, elem];
}

// 11번째 자리가 1·2가 아닌 필지(블록 지번 "BL"·"가-238" 등)는 parcel_point에 없어 unlocated로 남는다
const KAPT_PNU = /^\d{19}$/;
const isoDate = (v: unknown): string | null => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "").trim()) ? String(v).trim() : null);

/**
 * K-APT 단지 식별정보 → kind kapt_complex. 좌표가 없어 필지고유번호(PNU) → parcel_point로 위치를 얻는다(못 얻으면 unlocated).
 * 같은 PNU의 ledger housing_complex가 있으면 feature_link(same_parcel, method "pnu")로 잇는다. 시도별 received/accepted/unlocated/rejected는 release coverage에 남긴다.
 */
export async function buildKapt(db: Db, input: { records: AsyncIterable<MeasureRecord>; releaseId: string }): Promise<SourceStats[]> {
  const stats = new SourceStats("kapt", input.releaseId, ["households", "buildingCount", "approvalDate"]);
  const seen = new Set<string>();
  const tally: Record<string, { received: number; accepted: number; unlocated: number; rejected: number }> = {};
  const housing = db.prepare("SELECT stable_id FROM feature WHERE kind = 'housing_complex' AND pnu = ? ORDER BY stable_id").pluck();
  let linked = 0;
  await batched(db, input.records, (r) => {
    stats.read();
    const p = r.properties;
    const id = str(p["단지고유번호"]);
    const sourcePnu = str(p["필지고유번호"]);
    // 광주·전남 옛 시군구 코드(29·46)는 통합 코드(12)로 바꿔서 parcel_point를 찾는다
    const pnu = sourcePnu && KAPT_PNU.test(sourcePnu) ? remapRenumberedPnu(db, sourcePnu, str(p["주소"])) : sourcePnu;
    const region = pnu ? pnu.slice(0, 2) : "(미상)";
    const t = (tally[region] ??= { received: 0, accepted: 0, unlocated: 0, rejected: 0 });
    t.received++;
    if (!id || !pnu || !KAPT_PNU.test(pnu) || seen.has(id)) {
      t.rejected++;
      return stats.reject();
    }
    seen.add(id);
    const point = lookupParcelPoint(db, pnu);
    if (!point) {
      t.unlocated++;
      return stats.unlocate();
    }
    const props: Props = {
      complexId: id,
      complexType: str(p["단지종류"]), // 원천 코드 그대로(1·2·3). 의미는 원천 문서에 없어 해석하지 않는다
      buildingCount: positive(p["동수"]),
      households: positive(p["세대수"]),
      approvalDate: isoDate(p["사용승인일"]),
      nameAppraisal: str(p["단지명_공시가격"]),
      nameLedger: str(p["단지명_건축물대장"]),
      nameRoad: str(p["단지명_도로명주소"]),
      address: str(p["주소"]),
      roadAddress: str(p["도로명주소"]),
      ...(pnu !== sourcePnu ? { sourcePnu } : {}),
    };
    const stableId = `kapt:${id}`;
    insertFeature(db, {
      stableId, kind: "kapt_complex", sourceKey: id, releaseId: input.releaseId,
      geometry: { type: "Point", coordinates: [point[0], point[1]] },
      name: str(p["단지명_공시가격"]) ?? str(p["단지명_건축물대장"]) ?? str(p["단지명_도로명주소"]),
      pnu, legalCode: pnu.slice(0, 10), properties: props,
    });
    for (const h of housing.all(pnu) as string[]) if (insertLink(db, stableId, h, "same_parcel", "pnu", input.releaseId)) linked++;
    t.accepted++;
    stats.accept(props, region, `type:${props.complexType ?? "(미상)"}`);
  });
  db.prepare("UPDATE source_release SET coverage_json = ? WHERE release_id = ?").run(JSON.stringify({ byRegion: tally, linkedToHousingComplex: linked, note: "위치 = PNU→parcel_point, 좌표 없음. unlocated는 feature로 넣지 않음." }), input.releaseId);
  // 받은 행이 있는데 하나도 못 넣은 시도는 품질 검사가 REGION_MISSING으로 잡는다.
  stats.expectedRegions = Object.entries(tally).filter(([, v]) => v.received > 0 && v.accepted + v.unlocated > 0).map(([k]) => k).filter((k) => k !== "(미상)");
  return [stats];
}
