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

function pointGeometry(lngLat: readonly [number, number]) {
  return { type: "Point" as const, coordinates: [lngLat[0], lngLat[1]] };
}

export async function buildLedger(
  db: Db,
  input: { recap: AsyncIterable<MeasureRecord>; title: AsyncIterable<MeasureRecord>; recapReleaseId: string; titleReleaseId: string },
): Promise<SourceStats[]> {
  const recapStats = new SourceStats("ledger_recap_housing", input.recapReleaseId, ["units", "parking", "approvalDate"]);
  const recapPnus = new Set<string>();

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
  const housing = new Map<string, { legalCode: string; name: string | null; otherUse: string | null; units: number; approvalDate: string | null; buildingCount: number; point: readonly [number, number] }>();

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
      const cur = housing.get(loc.pnu);
      const point = cur ? cur.point : lookupParcelPoint(db, loc.pnu);
      if (!point) return housingStats.unlocate();
      const approval = ymd(p["사용승인_일"]);
      if (cur) {
        cur.units += units;
        cur.buildingCount += 1;
        if (approval && (!cur.approvalDate || approval < cur.approvalDate)) cur.approvalDate = approval;
      } else {
        housing.set(loc.pnu, { legalCode: loc.legalCode, name: str(p["건물_명"]), otherUse, units, approvalDate: approval, buildingCount: 1, point });
      }
    } else if (mainUse === "업무시설" && otherUse?.includes("오피스텔")) {
      officetelStats.read();
      const loc = ledgerPnu(p);
      const point = loc ? lookupParcelPoint(db, loc.pnu) : null;
      if (!loc || !point) return officetelStats.unlocate();
      const pk = str(p["관리_건축물대장_PK"]) ?? loc.pnu;
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
    const props = { source: "title", ledgerPk: null, mainUse: "공동주택", otherUse: h.otherUse, units: h.units, households: null, parking: null, approvalDate: h.approvalDate, buildingCount: h.buildingCount };
    insertFeature(db, { stableId: `title-housing:${pnu}`, kind: "housing_complex", sourceKey: pnu, releaseId: input.titleReleaseId, geometry: pointGeometry(h.point), name: h.name, pnu, legalCode: h.legalCode, properties: props });
    for (let i = 0; i < h.buildingCount; i++) housingStats.accept(props, h.legalCode.slice(0, 2), "공동주택"); // 행 단위 집계
  });

  return [recapStats, housingStats, officetelStats];
}
