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
import type { ParcelSpatialLookup } from "./parcel-spatial";

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
  method: "source" | "ledger_height" | "floors_estimate" | "ledger_floors_estimate" | "unknown";
  floorsAbove: number | null;
  ledgerMatch?: LedgerFloorMatch;
}

export function heightOf(p: Record<string, unknown>, floorHeightM = FLOOR_HEIGHT_M, ledgerMatch: LedgerFloorMatch | null = null): BuildingHeight {
  const floors = pos(p.A26, 0);
  const source = pos(p.A16);
  if (source !== null) return { heightM: source, method: "source", floorsAbove: floors };
  if (ledgerMatch?.heightM !== undefined && ledgerMatch.heightM !== null && ledgerMatch.heightM > 0) return {
    heightM: Math.round(ledgerMatch.heightM * 100) / 100,
    method: "ledger_height",
    floorsAbove: floors ?? ledgerMatch.floorsAbove,
    ledgerMatch,
  };
  if (floors !== null) return { heightM: Math.round(floors * floorHeightM * 100) / 100, method: "floors_estimate", floorsAbove: floors };
  if (ledgerMatch?.floorsAbove !== null && ledgerMatch?.floorsAbove !== undefined) return {
    heightM: Math.round(ledgerMatch.floorsAbove * floorHeightM * 100) / 100,
    method: "ledger_floors_estimate",
    floorsAbove: ledgerMatch.floorsAbove,
    ledgerMatch,
  };
  return { heightM: null, method: "unknown", floorsAbove: null };
}

function ledgerProvenance(match: LedgerFloorMatch, floorHeightM: number, base: Record<string, unknown>, approvalApplied: boolean, heightApplied = true): string {
  const output: Record<string, unknown> = {
    ...base,
    ledger: {
      source: "ledger_title_dong",
      ledgerPk: match.ledgerPk,
      match: match.method,
      dongName: match.dongName ?? null,
      heightM: match.heightM ?? null,
      floorsAbove: match.floorsAbove ?? null,
      approvalDate: match.approvalDate ?? null,
    },
  };
  output.height_m = !heightApplied ? base.height_m ?? {} : match.heightM !== null && match.heightM !== undefined
    ? { source: "ledger.title.높이(m)", ledgerPk: match.ledgerPk, ledger_pk: match.ledgerPk, match: match.method }
    : match.floorsAbove !== null && match.floorsAbove !== undefined
      ? { source: "ledger.title.지상_층_수*floorHeightM", floorHeightM, ledgerPk: match.ledgerPk, ledger_pk: match.ledgerPk, match: match.method }
      : base.height_m ?? {};
  if (heightApplied && match.floorsAbove !== null && match.floorsAbove !== undefined) output.floors_above = { source: "ledger.title.지상_층_수", ledgerPk: match.ledgerPk, ledger_pk: match.ledgerPk, match: match.method };
  if (approvalApplied && match.approvalDate) output.approval_date = { source: "ledger.title.사용승인_일", ledgerPk: match.ledgerPk, ledger_pk: match.ledgerPk, match: match.method };
  return JSON.stringify(output);
}

const isPolygonal = (g: Geometry | null): g is Geometry => g !== null && (g.type === "Polygon" || g.type === "MultiPolygon");

interface LedgerCandidateRow {
  feature_id: number;
  ledger_pk: string;
  region: string;
  base_height_m: number | null;
  base_height_method: string;
  base_floors_above: number | null;
  base_approval_date: string | null;
  base_ledger_pk: string | null;
  base_provenance_json: string;
  applied_height_m: number | null;
  applied_height_method: string;
  applied_floors_above: number | null;
  applied_approval_date: string | null;
  applied_provenance_json: string;
}

function ensureLedgerCandidateTable(db: BetterSqlite3.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS ledger_match_candidate (
    feature_id INTEGER PRIMARY KEY,
    ledger_pk TEXT NOT NULL,
    region TEXT NOT NULL,
    base_height_m REAL,
    base_height_method TEXT NOT NULL,
    base_floors_above INTEGER,
    base_approval_date TEXT,
    base_ledger_pk TEXT,
    base_provenance_json TEXT NOT NULL,
    applied_height_m REAL,
    applied_height_method TEXT NOT NULL,
    applied_floors_above INTEGER,
    applied_approval_date TEXT,
    applied_provenance_json TEXT NOT NULL,
    match_method TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ledger_match_candidate_pk ON ledger_match_candidate(ledger_pk);`);
}

function parsedProvenance(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** 모든 GIS 파일을 본 뒤 같은 표제부 PK가 2개 건물에 붙었는지 판정한다. */
export function finalizeLedgerMatches(db: BetterSqlite3.Database, stats: SourceStats | readonly SourceStats[], options: { drop?: boolean } = {}): { matched: number; rejectedOneToMany: number } {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ledger_match_candidate' LIMIT 1").get();
  if (!exists) return { matched: 0, rejectedOneToMany: 0 };
  // 표제부 후보는 GIS 건물 행에서만 나온다 — 도로명주소 등 다른 원천 통계를 되돌리면 그 채움률이 0으로 깎인다.
  const statList = (Array.isArray(stats) ? stats : [stats]).filter((s) => s.sourceId === "building");
  // 1,700만 건을 JS 배열로 복사하지 않는다. 중복 PK의 행만 SQLite
  // iterator로 흘려보내고, 정상 매칭 수는 집계 쿼리로 계산한다.
  const total = Number(db.prepare("SELECT COUNT(*) FROM ledger_match_candidate").pluck().get());
  // 중복 PK 목록은 작게 별도 staging하고, 후보 본문은 1,000행씩 읽는다.
  // SQLite statement가 iterate 중일 때 같은 연결로 UPDATE할 수 없으므로
  // 한 번에 전량을 .all()하지 않는다.
  db.exec("DROP TABLE IF EXISTS ledger_match_duplicate_pk; CREATE TABLE ledger_match_duplicate_pk AS SELECT ledger_pk FROM ledger_match_candidate GROUP BY ledger_pk HAVING COUNT(*) > 1; CREATE UNIQUE INDEX idx_ledger_match_duplicate_pk ON ledger_match_duplicate_pk(ledger_pk);");
  const rejectedCount = Number(db.prepare("SELECT COUNT(*) FROM ledger_match_candidate c JOIN ledger_match_duplicate_pk d USING (ledger_pk)").pluck().get());
  const restore = db.prepare(`UPDATE building_fact SET ledger_pk = ?, height_m = ?, height_method = ?, floors_above = ?, approval_date = ?, field_provenance_json = ? WHERE feature_id = ?`);
  const duplicateBatch = db.prepare(`SELECT c.* FROM ledger_match_candidate c
    JOIN ledger_match_duplicate_pk d USING (ledger_pk)
    WHERE c.feature_id > ? ORDER BY c.feature_id LIMIT 1000`);
  let lastFeatureId = 0;
  for (;;) {
    const batch = duplicateBatch.all(lastFeatureId) as LedgerCandidateRow[];
    if (batch.length === 0) break;
    db.transaction(() => {
      for (const row of batch) {
        restore.run(row.base_ledger_pk, row.base_height_m, row.base_height_method, row.base_floors_above, row.base_approval_date, row.base_provenance_json, row.feature_id);
        const oldProps = { heightM: row.applied_height_m, floorsAbove: row.applied_floors_above, approvalDate: row.applied_approval_date };
        const newProps = { heightM: row.base_height_m, floorsAbove: row.base_floors_above, approvalDate: row.base_approval_date };
        for (const sourceStats of statList) sourceStats.replaceTag(row.region, row.applied_height_method, row.base_height_method, oldProps, newProps);
      }
    })();
    lastFeatureId = batch[batch.length - 1].feature_id;
    if (batch.length < 1000) break;
  }
  db.exec("DROP TABLE ledger_match_duplicate_pk");
  const matched = total - rejectedCount;
  if (options.drop !== false) db.exec("DROP TABLE ledger_match_candidate");
  return { matched, rejectedOneToMany: rejectedCount };
}

export async function buildBuildings(
  db: BetterSqlite3.Database,
  records: AsyncIterable<ShpRecord>,
  releaseId: string,
  opts: { maxYear?: number; floorHeightM?: number; ledger?: LedgerFloorLookup | null; spatial?: ParcelSpatialLookup | null; parcelVersion?: string | null; deferLedgerMatches?: boolean } = {},
): Promise<SourceStats> {
  const maxYear = opts.maxYear ?? new Date().getUTCFullYear();
  const floorHeightM = opts.floorHeightM ?? FLOOR_HEIGHT_M;
  const stats = new SourceStats("building", releaseId, ["heightM", "floorsAbove", "useCode", "approvalDate"]);
  const insertFact = db.prepare(`INSERT INTO building_fact (feature_id, ledger_pk, height_m, height_method, floors_above, floors_below, use_code, approval_date, gross_floor_area_m2, footprint_area_m2, pnu_method, pnu_spatial, field_provenance_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const provenance = { height_m: { source: "A16", floorHeightM }, floors_above: "A26", use_code: "A8", approval_date: "A13", areas: "A14/A12" };
  const provSource = JSON.stringify({ height_m: "A16" });
  const provEstimate = JSON.stringify({ ...provenance, height_m: { source: "A26*floorHeightM", floorHeightM } });
  if (opts.ledger) ensureLedgerCandidateTable(db);
  const insertCandidate = opts.ledger ? db.prepare(`INSERT OR REPLACE INTO ledger_match_candidate
    (feature_id, ledger_pk, region, base_height_m, base_height_method, base_floors_above, base_approval_date, base_ledger_pk, base_provenance_json, applied_height_m, applied_height_method, applied_floors_above, applied_approval_date, applied_provenance_json, match_method)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`): null;

  await batched(db, records, (r) => {
    stats.read();
    const p = r.properties;
    const ufid = str(p.A1);
    if (!ufid || !isPolygonal(r.geometry)) return stats.reject();
    const sourcePnu = typeof p.A2 === "string" && /^\d{19}$/.test(p.A2.trim()) ? p.A2.trim() : null;
    const spatialMatch = sourcePnu === null ? opts.spatial?.match(r.geometry) ?? null : null;
    const pnu = sourcePnu ?? spatialMatch?.pnu ?? null;
    const pnuMethod = sourcePnu ? "source" : spatialMatch ? "spatial" : "unknown";
    const legal = typeof p.A3 === "string" && /^\d{10}$/.test(p.A3) ? p.A3 : null;
    const useCode = str(p.A8);
    const approvalDate = validDate(p.A13, maxYear);
    const grossFloorAreaM2 = pos(p.A14);
    const footprintAreaM2 = pos(p.A12);
    const nativeHeight = heightOf(p, floorHeightM);
    let ledgerMatch: LedgerFloorMatch | null = null;
    if (opts.ledger) {
      const input: LedgerFloorInput = {
        pnu,
        ledgerPk: str(p.A21),
        name: str(p.A24),
        grossFloorAreaM2,
        footprintAreaM2,
      };
      ledgerMatch = opts.ledger.match(input);
    }
    const h = heightOf(p, floorHeightM, ledgerMatch);
    const effectiveApproval = approvalDate ?? ledgerMatch?.approvalDate ?? null;
    const sourceLedgerPk = str(p.A21);
    const effectiveLedgerPk = sourceLedgerPk ?? (ledgerMatch ? ledgerMatch.ledgerPk : null);
    const baseProvenance = nativeHeight.method === "floors_estimate" ? provEstimate : nativeHeight.method === "source" ? provSource : "{}";
    const hProvenance = ledgerMatch
      ? ledgerProvenance(ledgerMatch, floorHeightM, parsedProvenance(baseProvenance), approvalDate === null && Boolean(ledgerMatch.approvalDate), h.method === "ledger_height" || h.method === "ledger_floors_estimate")
      : baseProvenance;
    const finalProvenance = JSON.stringify({
      ...parsedProvenance(hProvenance),
      pnu: sourcePnu ? { method: "source", source: "A2" } : spatialMatch ? { method: "spatial", parcelVersion: spatialMatch.parcelVersion, spatialMethod: spatialMatch.method, pnu: spatialMatch.pnu } : { method: "unknown" },
    });
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
      effectiveLedgerPk,
      h.heightM,
      h.method,
      h.floorsAbove,
      count(p.A27),
      useCode,
      effectiveApproval,
      grossFloorAreaM2,
      footprintAreaM2,
      pnuMethod,
      spatialMatch?.pnu ?? null,
      finalProvenance,
    );
    stats.accept({ heightM: h.heightM, floorsAbove: h.floorsAbove, useCode, approvalDate: effectiveApproval }, region, h.method);
    const hasLedgerValue = Boolean(ledgerMatch);
    if (insertCandidate && ledgerMatch && hasLedgerValue) {
      insertCandidate.run(featureId, ledgerMatch.ledgerPk, region, nativeHeight.heightM, nativeHeight.method, nativeHeight.floorsAbove, approvalDate, sourceLedgerPk, JSON.stringify({ ...parsedProvenance(baseProvenance), pnu: sourcePnu ? { method: "source", source: "A2" } : spatialMatch ? { method: "spatial", parcelVersion: spatialMatch.parcelVersion, spatialMethod: spatialMatch.method, pnu: spatialMatch.pnu } : { method: "unknown" } }), h.heightM, h.method, h.floorsAbove, effectiveApproval, finalProvenance, ledgerMatch.method);
    }
  });
  if (opts.ledger && !opts.deferLedgerMatches) finalizeLedgerMatches(db, stats);
  return stats;
}
