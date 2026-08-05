/**
 * 지오코딩 / 역지오코딩 영구 캐시.
 *
 * 성공 좌표는 원래도 geocode_cache에 남고 있었다. 새던 곳은 두 군데다.
 *   - 실패는 기록되지 않아 분석마다 같은 주소를 다시 왕복한다.
 *     주소 후보 폴백(buildGeocodeCandidates)을 넣은 뒤로는 주소당 최대 3회로 늘었다.
 *   - 좌표→법정동 역지오코딩은 단지마다 호출되는데 캐시가 없었다.
 */
import type BetterSqlite3 from "better-sqlite3";

type Db = BetterSqlite3.Database;

/** 실패한 주소를 다시 시도하기까지의 유예. 주소 파서가 개선될 수 있으므로 영구 차단은 하지 않는다. */
export const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 법정동 캐시 좌표 키 자릿수. 4자리 ≈ 11m — 법정동 경계에 비하면 무시할 오차다. */
const LEGALCODE_PRECISION = 4;

export interface Coord {
  lat: number;
  lng: number;
}

export interface LegalCode {
  sigunguCd: string;
  bjdongCd: string;
  areaName: string;
}

export function readGeocode(db: Db, address: string): Coord | null {
  const row = db.prepare("SELECT lat, lng FROM geocode_cache WHERE address = ?").get(address) as
    | Coord
    | undefined;
  return row ?? null;
}

export function writeGeocode(db: Db, address: string, lat: number, lng: number, now: number): void {
  const save = db.transaction(() => {
    db.prepare(
      "INSERT OR REPLACE INTO geocode_cache (address, lat, lng, created_at) VALUES (?, ?, ?, ?)",
    ).run(address, lat, lng, now / 1000);
    // 성공했으면 과거 실패 이력은 무효다.
    db.prepare("DELETE FROM geocode_miss WHERE address = ?").run(address);
  });
  save();
}

export function isRecentMiss(db: Db, address: string, now: number): boolean {
  const row = db.prepare("SELECT last_attempt_at FROM geocode_miss WHERE address = ?").get(address) as
    | { last_attempt_at: number }
    | undefined;
  if (!row) return false;
  return now - row.last_attempt_at < MISS_TTL_MS;
}

export function recordGeocodeMiss(db: Db, address: string, now: number): void {
  db.prepare(
    `INSERT INTO geocode_miss (address, attempts, last_attempt_at) VALUES (?, 1, ?)
     ON CONFLICT(address) DO UPDATE SET
       attempts = attempts + 1,
       last_attempt_at = excluded.last_attempt_at`,
  ).run(address, now);
}

function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(LEGALCODE_PRECISION)},${lng.toFixed(LEGALCODE_PRECISION)}`;
}

export function readLegalCode(db: Db, lat: number, lng: number): LegalCode | null {
  const row = db
    .prepare("SELECT sigungu_cd, bjdong_cd, area_name FROM legalcode_cache WHERE coord_key = ?")
    .get(coordKey(lat, lng)) as Record<string, string> | undefined;
  if (!row) return null;
  return {
    sigunguCd: row["sigungu_cd"],
    bjdongCd: row["bjdong_cd"],
    areaName: row["area_name"] ?? "",
  };
}

export function writeLegalCode(db: Db, lat: number, lng: number, code: LegalCode, now: number): void {
  db.prepare(
    `INSERT OR REPLACE INTO legalcode_cache (coord_key, sigungu_cd, bjdong_cd, area_name, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(coordKey(lat, lng), code.sigunguCd, code.bjdongCd, code.areaName, now / 1000);
}
