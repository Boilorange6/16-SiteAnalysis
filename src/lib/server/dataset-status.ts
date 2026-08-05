/**
 * 적재 신뢰 표시.
 *
 * 실시간 조회를 배치로 옮기면 상류 장애가 조용해진다.
 * 마지막 성공 시각, 실제 서비스 중인 건수, 거부 사유를 화면까지 올려
 * "이 동네엔 원래 없나 보다"로 넘어가지 않게 한다.
 */
import type BetterSqlite3 from "better-sqlite3";
import { PLANNED_HOUSING_SPEC, readIngestRun } from "./dataset-store";
import { ledgerCoverage } from "./ledger-store";

type Db = BetterSqlite3.Database;

export interface DatasetStatus {
  kind: "planned_housing" | "ledger_building";
  /** 마지막으로 적재에 성공한 시각 (거부되면 갱신되지 않는다) */
  lastSuccessAt: number | null;
  /** 실제로 서비스 중인 건수 */
  rowCount: number;
  status: "ok" | "rejected";
  /** 거부 사유. 정상이면 빈 문자열 */
  message: string;
  /** 건축물대장에만 있는 값 — 조회 완료된 법정동 수 */
  dongCount?: number;
}

export function plannedHousingStatus(db: Db): DatasetStatus | null {
  const run = readIngestRun(db, PLANNED_HOUSING_SPEC.dataset);
  if (!run) return null;
  return {
    kind: "planned_housing",
    lastSuccessAt: run.lastSuccessAt,
    rowCount: run.rowCount,
    status: run.status === "rejected" ? "rejected" : "ok",
    message: run.message,
  };
}

export function ledgerBuildingStatus(db: Db): DatasetStatus | null {
  const coverage = ledgerCoverage(db);
  if (coverage.dongCount === 0) return null;
  return {
    kind: "ledger_building",
    lastSuccessAt: coverage.lastFetchedAt,
    rowCount: coverage.buildingCount,
    status: "ok",
    message: "",
    dongCount: coverage.dongCount,
  };
}

export function isDatasetStale(
  status: { lastSuccessAt: number | null } | null,
  now: number,
  maxAgeMs: number,
): boolean {
  if (!status || status.lastSuccessAt === null) return true;
  return now - status.lastSuccessAt > maxAgeMs;
}
