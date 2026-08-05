/**
 * 건축물대장 공동주택 저장소 — 법정동 단위 read-through.
 *
 * 전국 3,500여 법정동을 한 배치로 통째 교체하는 건 비현실적이다.
 * 대신 법정동 단위로 적재하고, 검색 시 신선하면 DB를 쓰고 아니면 API로 채운다.
 * 배치 스크립트는 같은 함수로 미리 데워두는 역할만 한다.
 *
 * 급감 방어도 법정동 단위로 건다. 청약홈과 규칙이 다른 이유:
 * 공동주택이 원래 없는 법정동(도농동 등)이 흔해서 0건이 정상일 수 있다.
 */
import type BetterSqlite3 from "better-sqlite3";
import { DROP_REJECT_RATIO, type Bbox } from "./dataset-store";

type Db = BetterSqlite3.Database;

/** 건축물대장은 월 단위로 갱신된다 */
export const LEDGER_DONG_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 오피스텔은 표제부, 공동주택은 총괄표제부에서 온다 — 출처가 달라 섞이면 안 된다 */
export type LedgerPurpose = "공동주택" | "오피스텔";

export interface LedgerRow {
  id: string;
  name: string;
  address: string;
  units: number;
  parking: number;
  maxFloor: number;
  useAprDay: string;
  /** 지번 본번/부번 — 이름만으로는 서로 다른 "현대아파트"가 병합되므로 식별에 쓴다 */
  bun: string;
  ji: string;
  lat: number | null;
  lng: number | null;
  /** 대장이 말하는 용도 — 오피스텔은 표제부, 공동주택은 총괄표제부에서 온다 */
  purpose: LedgerPurpose;
}

export function shouldRejectDongUpdate(previousCount: number, nextCount: number): boolean {
  if (previousCount <= 0) return false;
  return nextCount < previousCount * (1 - DROP_REJECT_RATIO);
}

function rowFromDb(row: Record<string, unknown>): LedgerRow {
  return {
    id: String(row["id"]),
    name: String(row["name"] ?? ""),
    address: String(row["address"] ?? ""),
    units: Number(row["units"] ?? 0),
    parking: Number(row["parking"] ?? 0),
    maxFloor: Number(row["max_floor"] ?? 0),
    useAprDay: String(row["use_apr_day"] ?? ""),
    bun: String(row["bun"] ?? ""),
    ji: String(row["ji"] ?? ""),
    lat: row["lat"] === null ? null : Number(row["lat"]),
    lng: row["lng"] === null ? null : Number(row["lng"]),
    // purpose 컬럼이 없던 시절 적재분은 전부 총괄표제부(공동주택)에서 왔다
    purpose: row["purpose"] === "오피스텔" ? "오피스텔" : "공동주택",
  };
}

/**
 * 적재된 법정동 데이터를 읽는다.
 * null이면 "아직 모른다 / 오래됐다"는 뜻이고, 빈 배열이면 "조회했고 공동주택이 없다"는 뜻이다.
 */
export function readLedgerDong(
  db: Db, sigunguCd: string, bjdongCd: string, now: number,
): LedgerRow[] | null {
  const sync = db
    .prepare("SELECT fetched_at FROM ledger_dong_sync WHERE sigungu_cd = ? AND bjdong_cd = ?")
    .get(sigunguCd, bjdongCd) as { fetched_at: number } | undefined;
  if (!sync) return null;
  if (now - sync.fetched_at > LEDGER_DONG_TTL_MS) return null;

  const rows = db
    .prepare("SELECT * FROM ledger_building WHERE sigungu_cd = ? AND bjdong_cd = ?")
    .all(sigunguCd, bjdongCd) as Array<Record<string, unknown>>;
  return rows.map(rowFromDb);
}

export interface DongUpsertResult {
  status: "ok" | "rejected";
  rowCount: number;
  previousCount: number;
  message?: string;
}

export function upsertLedgerDong(
  db: Db, sigunguCd: string, bjdongCd: string, rows: readonly LedgerRow[], now: number,
): DongUpsertResult {
  const previous = db
    .prepare("SELECT COUNT(*) AS n FROM ledger_building WHERE sigungu_cd = ? AND bjdong_cd = ?")
    .get(sigunguCd, bjdongCd) as { n: number };
  const previousCount = previous.n;

  if (shouldRejectDongUpdate(previousCount, rows.length)) {
    const message =
      `${sigunguCd}-${bjdongCd} 적재 거부: ${previousCount}건 → ${rows.length}건 급감. 기존 데이터를 유지합니다.`;
    return { status: "rejected", rowCount: rows.length, previousCount, message };
  }

  const replace = db.transaction(() => {
    db.prepare("DELETE FROM ledger_building WHERE sigungu_cd = ? AND bjdong_cd = ?").run(sigunguCd, bjdongCd);
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO ledger_building
       (id, sigungu_cd, bjdong_cd, name, address, units, parking, max_floor, use_apr_day, bun, ji, lat, lng, purpose)
       VALUES (@id, @sigungu_cd, @bjdong_cd, @name, @address, @units, @parking, @max_floor, @use_apr_day, @bun, @ji, @lat, @lng, @purpose)`,
    );
    for (const row of rows) {
      stmt.run({
        id: row.id,
        sigungu_cd: sigunguCd,
        bjdong_cd: bjdongCd,
        name: row.name,
        address: row.address,
        units: row.units,
        parking: row.parking,
        max_floor: row.maxFloor,
        use_apr_day: row.useAprDay,
        bun: row.bun ?? "",
        ji: row.ji ?? "",
        lat: row.lat ?? null,
        lng: row.lng ?? null,
        purpose: row.purpose ?? "공동주택",
      });
    }
    db.prepare(
      `INSERT INTO ledger_dong_sync (sigungu_cd, bjdong_cd, fetched_at, row_count)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(sigungu_cd, bjdong_cd) DO UPDATE SET
         fetched_at = excluded.fetched_at,
         row_count = excluded.row_count`,
    ).run(sigunguCd, bjdongCd, now, rows.length);
  });
  replace();

  return { status: "ok", rowCount: rows.length, previousCount };
}

export function readLedgerInBbox(db: Db, bbox: Bbox): LedgerRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM ledger_building
       WHERE lat IS NOT NULL AND lng IS NOT NULL
         AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`,
    )
    .all(bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng) as Array<Record<string, unknown>>;
  return rows.map(rowFromDb);
}

/** 적재된 법정동 수와 건물 수 (신뢰 표시용) */
export function ledgerCoverage(db: Db): { dongCount: number; buildingCount: number; lastFetchedAt: number | null } {
  const dong = db.prepare("SELECT COUNT(*) AS n, MAX(fetched_at) AS t FROM ledger_dong_sync").get() as {
    n: number;
    t: number | null;
  };
  const building = db.prepare("SELECT COUNT(*) AS n FROM ledger_building").get() as { n: number };
  return { dongCount: dong.n, buildingCount: building.n, lastFetchedAt: dong.t };
}

/**
 * 용도로 걸러 적재 행을 읽는다. **신선도를 보지 않는다.**
 *
 * 오피스텔은 배치(ingest:ledger)에서만 채운다. 30일 TTL이 지나면 실시간 경로가
 * 공동주택만 다시 받아 그 법정동을 통째로 덮어쓰는데, 그때 오피스텔이 같이 사라진다.
 * 갱신할 때 기존 오피스텔을 살려 넣으려면 만료 여부와 무관하게 읽을 수 있어야 한다.
 */
export function readLedgerRowsByPurpose(
  db: Db, sigunguCd: string, bjdongCd: string, purpose: LedgerPurpose,
): LedgerRow[] {
  const rows = db
    .prepare("SELECT * FROM ledger_building WHERE sigungu_cd = ? AND bjdong_cd = ? AND purpose = ?")
    .all(sigunguCd, bjdongCd, purpose) as Array<Record<string, unknown>>;
  return rows.map(rowFromDb);
}
