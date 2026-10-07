/**
 * GIS건물통합정보(VWorld AL_D010) → kind `building` feature + `building_fact` (core).
 * 속성 이름은 A0…An이다. 열 의미(dbf 필드 순서 + 경기 30만 건 값 검증: 건폐율 A17≈A12/A15 98%, 용적률 A18≈A14/A15 87%,
 * 높이/층수 중앙값 4.5, 사용승인일은 C10 문자열, A23=PNU 앞 5자리, parcels.ts의 A2=PNU):
 *   A1 UFID(28, 건물마다 유일)  A2 PNU(19)  A3 법정동코드(10)  A4 법정동명  A5 지번
 *   A8 주용도코드(5, 대장 없으면 공백)  A9 주용도명  A11 구조명
 *   A12 건축면적(㎡)  A13 사용승인일(문자열 YYYY-MM-DD)  A14 연면적(㎡)  A15 대지면적  A16 높이(m)
 *   A17 건폐율  A18 용적률  A21 건축물대장 PK  A23 시군구코드(5)  A24 건물명  A26 지상층수  A27 지하층수
 * 대장과 연결되지 않은 건물(약 60~65%)은 A8~A27이 비어 있다 — 그래도 도형은 적재한다(높이 미상).
 */
import type BetterSqlite3 from "better-sqlite3";
import type { Geometry } from "geojson";
import { insertFeature } from "../../data/features";
import { batched, SourceStats } from "../build";
import type { ShpRecord } from "../shp";
import type { LedgerFloorInput, LedgerFloorLookup, LedgerFloorMatch } from "./ledger";

/** 높이 원천값이 없을 때 층수 추정에 쓰는 층고(m). 원천에서 높이·층수가 둘 다 있는 건물의 중앙값은 약 4.5 m/층이다(과소추정 쪽). */
export const FLOOR_HEIGHT_M = 3.0;
const MIN_YEAR = 1800;
/** 도형 좌표는 1 cm로 반올림해 저장한다(꼭짓점은 그대로) — 원천 정밀도와 좌표 재투영 오차보다 작다. 파일 크기 약 18% 절감. */
export const COORD_DECIMALS = 2;

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};
const pos = (v: unknown, digits = 2): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v * 10 ** digits) / 10 ** digits : null);
const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

/** 실재하는 날짜만. 1800년 이전·릴리스 연도 이후는 null (원천에 0991-04-12, 7982-01-01 같은 오입력이 있다). */
export function validDate(v: unknown, maxYear: number): string | null {
  const s = str(v);
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < MIN_YEAR || y > maxYear || mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
  return s;
}

export interface BuildingHeight {
  heightM: number | null;
  method: "source" | "floors_estimate" | "ledger_floors_estimate" | "unknown";
  floorsAbove: number | null;
  ledgerMatch?: LedgerFloorMatch;
}

export function heightOf(p: Record<string, unknown>, floorHeightM = FLOOR_HEIGHT_M, ledgerMatch: LedgerFloorMatch | null = null): BuildingHeight {
  const floors = pos(p.A26, 0);
  const source = pos(p.A16);
  if (source !== null) return { heightM: source, method: "source", floorsAbove: floors };
  if (floors !== null) return { heightM: Math.round(floors * floorHeightM * 100) / 100, method: "floors_estimate", floorsAbove: floors };
  if (ledgerMatch) return {
    heightM: Math.round(ledgerMatch.floorsAbove * floorHeightM * 100) / 100,
    method: "ledger_floors_estimate",
    floorsAbove: ledgerMatch.floorsAbove,
    ledgerMatch,
  };
  return { heightM: null, method: "unknown", floorsAbove: null };
}

function ledgerProvenance(match: LedgerFloorMatch, floorHeightM: number): string {
  return JSON.stringify({
    origin: "ledger-title",
    height_m: {
      source: "ledger.title.지상_층_수*floorHeightM",
      floorHeightM,
      ledgerPk: match.ledgerPk,
      ledger_pk: match.ledgerPk,
      match: match.method,
    },
    floors_above: {
      source: "ledger.title.지상_층_수",
      ledgerPk: match.ledgerPk,
      ledger_pk: match.ledgerPk,
    },
  });
}

const isPolygonal = (g: Geometry | null): g is Geometry => g !== null && (g.type === "Polygon" || g.type === "MultiPolygon");

export async function buildBuildings(
  db: BetterSqlite3.Database,
  records: AsyncIterable<ShpRecord>,
  releaseId: string,
  opts: { maxYear?: number; floorHeightM?: number; ledger?: LedgerFloorLookup | null } = {},
): Promise<SourceStats> {
  const maxYear = opts.maxYear ?? new Date().getUTCFullYear();
  const floorHeightM = opts.floorHeightM ?? FLOOR_HEIGHT_M;
  const stats = new SourceStats("building", releaseId, ["heightM", "floorsAbove", "useCode", "approvalDate"]);
  const insertFact = db.prepare(`INSERT INTO building_fact (feature_id, ledger_pk, height_m, height_method, floors_above, floors_below, use_code, approval_date, gross_floor_area_m2, footprint_area_m2, field_provenance_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const provenance = { height_m: { source: "A16", floorHeightM }, floors_above: "A26", use_code: "A8", approval_date: "A13", areas: "A14/A12" };
  const provSource = JSON.stringify({ height_m: "A16" });
  const provEstimate = JSON.stringify({ ...provenance, height_m: { source: "A26*floorHeightM", floorHeightM } });
  const pendingPnu = new Map<string, Array<{ featureId: number; match: LedgerFloorMatch; region: string }>>();
  const candidateRowsByPnu = new Map<string, number>();
  const directPnu = new Set<string>();

  await batched(db, records, (r) => {
    stats.read();
    const p = r.properties;
    const ufid = str(p.A1);
    if (!ufid || !isPolygonal(r.geometry)) return stats.reject();
    const pnu = typeof p.A2 === "string" && /^\d{19}$/.test(p.A2) ? p.A2 : null;
    const legal = typeof p.A3 === "string" && /^\d{10}$/.test(p.A3) ? p.A3 : null;
    const useCode = str(p.A8);
    const approvalDate = validDate(p.A13, maxYear);
    const grossFloorAreaM2 = pos(p.A14);
    const footprintAreaM2 = pos(p.A12);
    const nativeHeight = heightOf(p, floorHeightM);
    let ledgerMatch: LedgerFloorMatch | null = null;
    if (nativeHeight.method === "unknown" && opts.ledger) {
      const input: LedgerFloorInput = {
        pnu,
        ledgerPk: str(p.A21),
        name: str(p.A24),
        grossFloorAreaM2,
        footprintAreaM2,
      };
      ledgerMatch = opts.ledger.match(input);
    }
    const deferredMatch = ledgerMatch?.method === "pnu_unique" && pnu !== null ? ledgerMatch : null;
    const h = deferredMatch ? nativeHeight : heightOf(p, floorHeightM, ledgerMatch);
    let featureId: number;
    try {
      featureId = insertFeature(db, { stableId: `building:${ufid}`, kind: "building", sourceKey: ufid, releaseId, geometry: r.geometry, name: str(p.A24), pnu, legalCode: legal, roundM: 10 ** -COORD_DECIMALS });
    } catch (e) {
      if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") return stats.reject(); // 중복 UFID
      throw e;
    }
    const region = (pnu ?? legal ?? "").slice(0, 2) || "(미상)";
    insertFact.run(
      featureId,
      str(p.A21),
      h.heightM,
      h.method,
      h.floorsAbove,
      count(p.A27),
      useCode,
      approvalDate,
      grossFloorAreaM2,
      footprintAreaM2,
      h.method === "ledger_floors_estimate" && h.ledgerMatch ? ledgerProvenance(h.ledgerMatch, floorHeightM) : h.method === "floors_estimate" ? provEstimate : h.method === "source" ? provSource : "{}",
    );
    stats.accept({ heightM: h.heightM, floorsAbove: h.floorsAbove, useCode, approvalDate }, region, h.method);
    if (pnu && opts.ledger?.hasPnu(pnu)) candidateRowsByPnu.set(pnu, (candidateRowsByPnu.get(pnu) ?? 0) + 1);
    if (ledgerMatch?.method === "ledger_pk" && pnu) directPnu.add(pnu);
    if (deferredMatch && pnu !== null) {
      const rows = pendingPnu.get(pnu) ?? [];
      rows.push({ featureId, match: deferredMatch, region });
      pendingPnu.set(pnu, rows);
    }
  });

  if (opts.ledger && pendingPnu.size > 0) {
    const update = db.prepare("UPDATE building_fact SET height_m = ?, height_method = 'ledger_floors_estimate', floors_above = ?, field_provenance_json = ? WHERE feature_id = ? AND height_method = 'unknown'");
    for (const [pnu, rows] of pendingPnu) {
      // 같은 PNU의 건물 행이 둘 이상이면 표제부 동을 특정할 수 없으므로 미상으로 보존한다.
      if (rows.length !== 1 || directPnu.has(pnu) || (candidateRowsByPnu.get(pnu) ?? 0) !== 1) continue;
      const row = rows[0];
      const height = heightOf({ A16: 0, A26: 0 }, floorHeightM, row.match);
      if (height.method !== "ledger_floors_estimate" || height.ledgerMatch === undefined) continue;
      const result = update.run(height.heightM, height.floorsAbove, ledgerProvenance(height.ledgerMatch, floorHeightM), row.featureId);
      if (result.changes === 1) stats.retag(row.region, "unknown", "ledger_floors_estimate", { heightM: height.heightM, floorsAbove: height.floorsAbove });
    }
  }
  return stats;
}
