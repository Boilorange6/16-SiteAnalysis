/**
 * 건축물대장(총괄표제부·표제부) → 공동주택 단지·오피스텔 (tile-catalog A05).
 * 좌표가 없어 PNU → 필지 대표점으로 위치를 얻는다. 못 얻으면 feature를 만들지 않고 unlocated로 센다.
 */
import type BetterSqlite3 from "better-sqlite3";
import type { MeasureRecord } from "../../a0/measure";
import { insertFeature } from "../../data/features";
import { lookupParcelPoint, makePnu } from "../../data/parcels";
import { batched, SourceStats } from "../build";

type Db = BetterSqlite3.Database;
type Props = Record<string, unknown>;

const str = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};
/** 대장의 0·빈 값은 미상이다 */
const positive = (v: unknown): number | null => {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
};
const ymd = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return /^\d{8}$/.test(s) && s !== "00000000" ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
};

export function ledgerPnu(p: Props): { legalCode: string; pnu: string } | null {
  const legalCode = `${str(p["시군구_코드"]) ?? ""}${str(p["법정동_코드"]) ?? ""}`;
  const gb = str(p["대지_구분_코드"]);
  if (gb !== "0" && gb !== "1") return null; // 2 = 블록 지번: PNU가 없다
  const pnu = makePnu(legalCode, gb === "1", str(p["번"]) ?? "", str(p["지"]) ?? "0");
  return pnu ? { legalCode, pnu } : null;
}

export interface LedgerFloorInput {
  pnu: string | null;
  ledgerPk: string | null;
  name: string | null;
  grossFloorAreaM2: number | null;
  footprintAreaM2: number | null;
}

export type LedgerFloorMatchMethod = "ledger_pk" | "pnu_unique" | "pnu_name" | "pnu_area";

export interface LedgerFloorMatch {
  ledgerPk: string;
  floorsAbove: number;
  method: LedgerFloorMatchMethod;
}

export interface LedgerFloorLookup {
  /** 표제부 후보가 있는 PNU인지 확인한다(다건 PNU 보수 판정용). */
  hasPnu(pnu: string): boolean;
  match(input: LedgerFloorInput): LedgerFloorMatch | null;
}

interface LedgerFloorCandidate extends LedgerFloorMatch {
  pnu: string | null;
  name: string | null;
  grossFloorAreaM2: number | null;
  footprintAreaM2: number | null;
}

const positiveInteger = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const positiveNumber = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const keyString = (value: unknown): string | null => {
  const s = String(value ?? "").trim();
  return s === "" ? null : s;
};

const normalizedName = (value: string | null): string | null => value?.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[\s()·,._\-/\\]/g, "") || null;

function propertyNumber(props: Props, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = positiveNumber(props[key]);
    if (value !== null) return value;
  }
  return null;
}

function areaMatches(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= Math.max(1, Math.max(a, b) * 0.01);
}

/**
 * 현재 core에 보존된 표제부 층수 후보를 building PNU/대장 PK에 연결한다.
 *
 * housing_complex는 현재 총괄표제부로 집계되어 동별 층수가 없으므로,
 * floorsAbove가 실제로 남아 있는 표제부 후보만 사용한다. PNU 다건은
 * 대장 PK가 맞거나 이름/면적이 하나로 좁혀질 때만 반환한다.
 */
export function ledgerFloorLookup(core: Db | null | undefined): LedgerFloorLookup | null {
  if (!core) return null;
  const byPnu = new Map<string, LedgerFloorCandidate[]>();
  const byLedgerPk = new Map<string, LedgerFloorCandidate[]>();
  try {
    const rows = core.prepare("SELECT kind, pnu, name, properties_json FROM feature WHERE kind IN ('housing_complex', 'officetel')").all() as Array<{ kind: string; pnu: string | null; name: string | null; properties_json: string }>;
    for (const row of rows) {
      let props: Props;
      try {
        props = JSON.parse(row.properties_json) as Props;
      } catch {
        continue;
      }
      const floorsAbove = positiveInteger(props.floorsAbove);
      const ledgerPk = keyString(props.ledgerPk);
      if (floorsAbove === null || ledgerPk === null) continue;
      const candidate: LedgerFloorCandidate = {
        ledgerPk,
        floorsAbove,
        method: "pnu_unique",
        pnu: /^\d{19}$/.test(row.pnu ?? "") ? row.pnu : null,
        name: keyString(row.name),
        grossFloorAreaM2: propertyNumber(props, ["grossFloorAreaM2", "grossFloorArea", "gross_floor_area_m2", "연면적"]),
        footprintAreaM2: propertyNumber(props, ["footprintAreaM2", "footprintArea", "footprint_area_m2", "건축면적"]),
      };
      const byKey = byLedgerPk.get(ledgerPk) ?? [];
      byKey.push(candidate);
      byLedgerPk.set(ledgerPk, byKey);
      if (candidate.pnu) {
        const byParcel = byPnu.get(candidate.pnu) ?? [];
        byParcel.push(candidate);
        byPnu.set(candidate.pnu, byParcel);
      }
    }
  } catch {
    return null;
  }

  const unique = (candidates: LedgerFloorCandidate[], method: LedgerFloorMatchMethod): LedgerFloorMatch | null => {
    if (candidates.length !== 1) return null;
    return { ledgerPk: candidates[0].ledgerPk, floorsAbove: candidates[0].floorsAbove, method };
  };

  return {
    hasPnu: (pnu) => byPnu.has(pnu),
    match: (input) => {
      const direct = input.ledgerPk ? unique(byLedgerPk.get(input.ledgerPk) ?? [], "ledger_pk") : null;
      if (direct) return direct;
      if (!input.pnu) return null;
      const candidates = byPnu.get(input.pnu) ?? [];
      if (candidates.length === 1) return unique(candidates, "pnu_unique");

      const sourceName = normalizedName(input.name);
      const named = sourceName ? candidates.filter((candidate) => normalizedName(candidate.name) === sourceName) : [];
      const nameMatch = unique(named, "pnu_name");
      if (nameMatch) return nameMatch;

      const areaMatched = candidates.filter((candidate) =>
        areaMatches(input.grossFloorAreaM2, candidate.grossFloorAreaM2)
        || areaMatches(input.footprintAreaM2, candidate.footprintAreaM2),
      );
      return unique(areaMatched, "pnu_area");
    },
  };
}

function pointGeometry(lngLat: readonly [number, number]) {
  return { type: "Point" as const, coordinates: [lngLat[0], lngLat[1]] };
}

export async function buildLedger(
  db: Db,
  input: { recap: AsyncIterable<MeasureRecord>; title: AsyncIterable<MeasureRecord>; recapReleaseId: string; titleReleaseId: string },
): Promise<SourceStats[]> {
  const recapStats = new SourceStats("ledger_recap_housing", input.recapReleaseId, ["units", "parking", "approvalDate"]);
  const recapPnus = new Set<string>();
  const recapPks = new Set<string>();
  const officetelPks = new Set<string>();

  await batched(db, input.recap, (r) => {
    const p = r.properties;
    const units = positive(p["세대_수(세대)"]);
    const mainUse = str(p["주_용도_코드_명"]);
    if (units === null && mainUse !== "공동주택") return; // 대상 아님: 세지 않는다
    recapStats.read();
    const loc = ledgerPnu(p);
    if (loc) recapPnus.add(loc.pnu); // 위치를 못 얻어도 표제부 동을 단지로 다시 세지 않는다
    const point = loc ? lookupParcelPoint(db, loc.pnu) : null;
    if (!loc || !point) return recapStats.unlocate();
    const pk = str(p["관리_건축물대장_PK"]) ?? loc.pnu;
    if (recapPks.has(pk)) return recapStats.reject(); // 같은 PK가 또 나옴: 첫 행만 남긴다
    recapPks.add(pk);
    const props = {
      source: "recap",
      ledgerPk: pk,
      mainUse,
      otherUse: str(p["기타_용도"]),
      units,
      households: positive(p["가구_수(가구)"]),
      parking: positive(p["총_주차_수"]),
      approvalDate: ymd(p["사용승인_일"]),
      buildingCount: positive(p["주_건축물_수"]),
    };
    insertFeature(db, { stableId: `recap:${pk}`, kind: "housing_complex", sourceKey: pk, releaseId: input.recapReleaseId, geometry: pointGeometry(point), name: str(p["건물_명"]), pnu: loc.pnu, legalCode: loc.legalCode, properties: props });
    recapStats.accept(props, loc.legalCode.slice(0, 2), mainUse ?? "(미상)");
  });

  const housingStats = new SourceStats("ledger_title_housing", input.titleReleaseId, ["units", "approvalDate"]);
  const officetelStats = new SourceStats("ledger_title_officetel", input.titleReleaseId, ["units", "floorsAbove", "approvalDate"]);
  const housing = new Map<string, {
    legalCode: string;
    name: string | null;
    otherUse: string | null;
    units: number;
    approvalDate: string | null;
    buildingCount: number;
    point: readonly [number, number];
    ledgerPk: string | null;
    floorsAbove: number | null;
    grossFloorAreaM2: number | null;
    footprintAreaM2: number | null;
  }>();

  await batched(db, input.title, (r) => {
    const p = r.properties;
    const mainUse = str(p["주_용도_코드_명"]);
    const otherUse = str(p["기타_용도"]);
    if (mainUse === "공동주택") {
      const loc = ledgerPnu(p);
      if (loc && recapPnus.has(loc.pnu)) return; // 총괄표제부 단지의 동: 대상 아님
      housingStats.read();
      if (!loc) return housingStats.unlocate();
      const units = positive(p["세대_수(세대)"]);
      if (units === null) return housingStats.reject(); // 세대 미상
      const ledgerPk = str(p["관리_건축물대장_PK"]) ?? loc.pnu;
      const floorsAbove = positive(p["지상_층_수"]);
      const grossFloorAreaM2 = positive(p["연면적"]);
      const footprintAreaM2 = positive(p["건축면적"]);
      const cur = housing.get(loc.pnu);
      const point = cur ? cur.point : lookupParcelPoint(db, loc.pnu);
      if (!point) return housingStats.unlocate();
      const approval = ymd(p["사용승인_일"]);
      if (cur) {
        cur.units += units;
        cur.buildingCount += 1;
        // 한 PNU에 여러 동을 합치면 어느 동의 층수인지 알 수 없으므로
        // PK·층수·면적을 버리고, 총괄 feature에는 집계값만 남긴다.
        cur.ledgerPk = null;
        cur.floorsAbove = null;
        cur.grossFloorAreaM2 = null;
        cur.footprintAreaM2 = null;
        if (approval && (!cur.approvalDate || approval < cur.approvalDate)) cur.approvalDate = approval;
      } else {
        housing.set(loc.pnu, { legalCode: loc.legalCode, name: str(p["건물_명"]), otherUse, units, approvalDate: approval, buildingCount: 1, point, ledgerPk, floorsAbove, grossFloorAreaM2, footprintAreaM2 });
      }
    } else if (mainUse === "업무시설" && otherUse?.includes("오피스텔")) {
      officetelStats.read();
      const loc = ledgerPnu(p);
      const point = loc ? lookupParcelPoint(db, loc.pnu) : null;
      if (!loc || !point) return officetelStats.unlocate();
      const pk = str(p["관리_건축물대장_PK"]) ?? loc.pnu;
      if (officetelPks.has(pk)) return officetelStats.reject();
      officetelPks.add(pk);
      const props = {
        ledgerPk: pk,
        units: positive(p["호_수(호)"]),
        floorsAbove: positive(p["지상_층_수"]),
        heightM: positive(p["높이(m)"]),
        approvalDate: ymd(p["사용승인_일"]),
        otherUse,
      };
      insertFeature(db, { stableId: `title:${pk}`, kind: "officetel", sourceKey: pk, releaseId: input.titleReleaseId, geometry: pointGeometry(point), name: str(p["건물_명"]), pnu: loc.pnu, legalCode: loc.legalCode, properties: props });
      officetelStats.accept(props, loc.legalCode.slice(0, 2), "officetel");
    }
  });

  await batched(db, housing, ([pnu, h]) => {
    const props: Props = { source: "title", ledgerPk: null, mainUse: "공동주택", otherUse: h.otherUse, units: h.units, households: null, parking: null, approvalDate: h.approvalDate, buildingCount: h.buildingCount };
    if (h.buildingCount === 1 && h.ledgerPk && h.floorsAbove !== null) {
      props.ledgerPk = h.ledgerPk;
      props.floorsAbove = h.floorsAbove;
      if (h.grossFloorAreaM2 !== null) props.grossFloorAreaM2 = h.grossFloorAreaM2;
      if (h.footprintAreaM2 !== null) props.footprintAreaM2 = h.footprintAreaM2;
    }
    insertFeature(db, { stableId: `title-housing:${pnu}`, kind: "housing_complex", sourceKey: pnu, releaseId: input.titleReleaseId, geometry: pointGeometry(h.point), name: h.name, pnu, legalCode: h.legalCode, properties: props });
    for (let i = 0; i < h.buildingCount; i++) housingStats.accept(props, h.legalCode.slice(0, 2), "공동주택"); // 행 단위 집계
  });

  return [recapStats, housingStats, officetelStats];
}
