/**
 * 분양(청약홈)·입주예정 → 미래 공급 (tile-catalog A06).
 * 청약홈은 기존 앱이 이미 지오코딩해 둔 planned_housing을 읽기 전용으로 재사용한다(spec §4.6: 기존 파일은 import·읽기만).
 */
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import type { MeasureRecord } from "../../a0/measure";
import { sha256Hex } from "../../canonical-json";
import { insertFeature } from "../../data/features";
import { resolveJibunAddress } from "../../data/jibun";
import { lookupParcelPoint } from "../../data/parcels";
import { batched, SourceStats } from "../build";

type Db = BetterSqlite3.Database;

export interface LegacyPlannedRow {
  id: string;
  name: string;
  address: string;
  area_name: string;
  kind: string;
  units: number;
  sale_date: string;
  move_in_month: string;
  homepage_url: string;
  notice_url: string;
  lat: number | null;
  lng: number | null;
}

export function readLegacyPlannedHousing(dbPath: string): LegacyPlannedRow[] {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare("SELECT id, name, address, area_name, kind, units, sale_date, move_in_month, homepage_url, notice_url, lat, lng FROM planned_housing").all() as LegacyPlannedRow[];
  } finally {
    db.close();
  }
}

const str = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};
const positive = (v: unknown): number | null => {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
};
const inKorea = (lng: number, lat: number): boolean => lng >= 124 && lng <= 132 && lat >= 33 && lat <= 39;

function insertEvent(db: Db, e: { eventId: string; eventType: string; stage: string; effectiveDate: string | null; plannedMonth: string | null; units: number | null; geometryId: string | null; evidenceUrl: string; releaseId: string }): void {
  db.prepare(`INSERT INTO development_event (event_id, project_id, event_type, stage, effective_date, planned_date, planned_date_precision, units, geometry_id, evidence_url, release_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(e.eventId, e.eventId, e.eventType, e.stage, e.effectiveDate, e.plannedMonth, e.plannedMonth ? "month" : "unknown", e.units, e.geometryId, e.evidenceUrl, e.releaseId);
}

export async function buildSupply(
  db: Db,
  input: { legacy: LegacyPlannedRow[]; legacyReleaseId: string; moveIn: AsyncIterable<MeasureRecord>; moveInReleaseId: string; core: Db },
): Promise<SourceStats[]> {
  const applyhome = new SourceStats("applyhome", input.legacyReleaseId, ["units", "plannedMonth"]);
  await batched(db, input.legacy, (r) => {
    applyhome.read();
    const id = `applyhome:${r.id}`;
    const m = /^(\d{4})(\d{2})$/.exec(String(r.move_in_month ?? "").trim());
    const plannedMonth = m ? `${m[1]}-${m[2]}` : null;
    const units = positive(r.units);
    const lng = r.lng == null || String(r.lng).trim() === "" ? NaN : Number(r.lng);
    const lat = r.lat == null || String(r.lat).trim() === "" ? NaN : Number(r.lat);
    const located = inKorea(lng, lat);
    if (located) {
      insertFeature(db, { stableId: id, kind: "planned_supply", sourceKey: r.id, releaseId: input.legacyReleaseId, geometry: { type: "Point", coordinates: [lng, lat] }, name: str(r.name), properties: { source: "applyhome", kind: str(r.kind), units, plannedMonth, address: str(r.address) } });
    }
    insertEvent(db, {
      eventId: id, eventType: "sale_notice", stage: "announced",
      effectiveDate: /^\d{4}-\d{2}-\d{2}$/.test(String(r.sale_date ?? "")) ? r.sale_date : null,
      plannedMonth, units, geometryId: located ? id : null,
      evidenceUrl: str(r.notice_url) ?? str(r.homepage_url) ?? "https://www.applyhome.co.kr", releaseId: input.legacyReleaseId,
    });
    if (located) applyhome.accept({ units, plannedMonth }, str(r.area_name) ?? "(미상)", str(r.kind) ?? "(미상)");
    else applyhome.unlocate();
  });

  const moveIn = new SourceStats("move_in", input.moveInReleaseId, ["units", "plannedMonth"]);
  const seen = new Set<string>();
  await batched(db, input.moveIn, (rec) => {
    moveIn.read();
    const p = rec.properties;
    const address = str(p["주소"]) ?? "";
    const name = str(p["아파트명"]);
    const id = `movein:${sha256Hex([address, name ?? "", str(p["입주예정월"]) ?? "", str(p["세대수"]) ?? "", str(p["사업유형"]) ?? ""].join("|")).slice(0, 16)}`;
    if (seen.has(id)) { moveIn.reject(); return; } // 다섯 필드가 모두 같은 중복 행
    seen.add(id);
    const plannedMonth = /^\d{4}-\d{2}$/.test(str(p["입주예정월"]) ?? "") ? str(p["입주예정월"]) : null;
    const units = positive(p["세대수"]);
    const loc = resolveJibunAddress(input.core, address);
    const point = loc ? lookupParcelPoint(input.core, loc.pnu) : null;
    if (loc && point) {
      insertFeature(db, { stableId: id, kind: "planned_supply", sourceKey: id, releaseId: input.moveInReleaseId, geometry: { type: "Point", coordinates: [point[0], point[1]] }, name, pnu: loc.pnu, legalCode: loc.legalCode, properties: { source: "move_in", kind: str(p["사업유형"]), units, plannedMonth, address } });
    }
    insertEvent(db, { eventId: id, eventType: "move_in", stage: "scheduled", effectiveDate: null, plannedMonth, units, geometryId: loc && point ? id : null, evidenceUrl: "https://www.data.go.kr/data/15111714/fileData.do", releaseId: input.moveInReleaseId });
    if (loc && point) moveIn.accept({ units, plannedMonth }, str(p["지역"]) ?? "(미상)", str(p["사업유형"]) ?? "(미상)");
    else moveIn.unlocate();
  });

  return [applyhome, moveIn];
}
