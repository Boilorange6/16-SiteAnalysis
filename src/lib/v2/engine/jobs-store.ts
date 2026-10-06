/** 분석 작업 행 조회. API 경량 경로가 무거운 작업자 구현을 정적으로 불러오지 않게 분리한다. */
import type BetterSqlite3 from "better-sqlite3";
import { ensureAnalysisJobTable } from "../app-db";

type JobRow = {
  analysis_id: string;
  tile_code: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  priority: number;
  enqueued_at: string;
  started_at: string | null;
  finished_at: string | null;
  elapsed_ms: number | null;
  error: string | null;
  cancel_requested_at: string | null;
};

export type JobInfo = {
  code: string;
  status: JobRow["status"];
  priority: number;
  enqueuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  elapsedMs: number | null;
  error: string | null;
  cancelRequestedAt: string | null;
  retryable: boolean;
};

export function listJobs(db: BetterSqlite3.Database, analysisId: string): JobInfo[] {
  ensureAnalysisJobTable(db);
  const rows = db.prepare(`SELECT analysis_id, tile_code, status, priority, enqueued_at, started_at, finished_at, elapsed_ms, error, cancel_requested_at
    FROM analysis_job WHERE analysis_id = ? ORDER BY priority, enqueued_at`).all(analysisId) as JobRow[];
  return rows.map((row) => ({
    code: row.tile_code,
    status: row.status,
    priority: row.priority,
    enqueuedAt: row.enqueued_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    elapsedMs: row.elapsed_ms,
    error: row.error,
    cancelRequestedAt: row.cancel_requested_at,
    retryable: row.status === "failed" || row.status === "cancelled",
  }));
}
