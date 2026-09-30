/**
 * PNU(필지고유번호) 도우미. PNU = 법정동 10 + 산 구분(1 일반·2 산) + 본번 4 + 부번 4, 항상 문자열.
 */
import type BetterSqlite3 from "better-sqlite3";
import type { LngLat } from "../crs";

type Db = BetterSqlite3.Database;

export function makePnu(legalCode: string, mountain: boolean, bun: string | number, ji: string | number): string | null {
  if (!/^\d{10}$/.test(legalCode)) return null;
  const b = typeof bun === "number" ? bun : /^\d+$/.test(String(bun).trim()) ? Number(bun) : NaN;
  const j = typeof ji === "number" ? ji : /^\d*$/.test(String(ji ?? "").trim()) ? Number(String(ji ?? "").trim() || 0) : NaN;
  if (!Number.isInteger(b) || !Number.isInteger(j) || b <= 0 || b > 9999 || j < 0 || j > 9999) return null;
  return `${legalCode}${mountain ? "2" : "1"}${String(b).padStart(4, "0")}${String(j).padStart(4, "0")}`;
}

const stmtCache = new WeakMap<Db, BetterSqlite3.Statement>();

export function lookupParcelPoint(db: Db, pnu: string): LngLat | null {
  let stmt = stmtCache.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT lng, lat FROM parcel_point WHERE pnu = ?");
    stmtCache.set(db, stmt);
  }
  const row = stmt.get(pnu) as { lng: number; lat: number } | undefined;
  return row ? [row.lng, row.lat] : null;
}
