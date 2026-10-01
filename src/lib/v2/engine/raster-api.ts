/** 타일 래스터 조회 본체. Next 라우트와 테스트가 같은 소유권·캐시 검사를 쓴다. */
import type BetterSqlite3 from "better-sqlite3";
import { getAnalysisRun } from "../app-db";
import { parseTileResult, type RasterRef } from "../tile-result";
import { loadTileRaster } from "../raster-store";

type Db = BetterSqlite3.Database;
type RasterReply = { status: 200; body: Buffer; ref: RasterRef } | { status: 404 | 403 };

function readable(run: { userId?: string | number | null }, userId?: string | number | null): boolean {
  return run.userId == null || (userId != null && String(run.userId) === String(userId));
}

export function getTileRaster(db: Db, analysisId: string, code: string, name: string, userId?: string | number | null): RasterReply {
  const run = getAnalysisRun(db, analysisId);
  if (!run) return { status: 404 };
  if (!readable(run, userId)) return { status: 403 };
  const row = db.prepare("SELECT cache_key, status, result_json FROM tile_result WHERE analysis_id = ? AND tile_code = ?").get(analysisId, code) as
    | { cache_key: string; status: string; result_json: string }
    | undefined;
  if (!row || (row.status !== "complete" && row.status !== "partial")) return { status: 404 };
  const result = parseTileResult(JSON.parse(row.result_json));
  const ref = result.presentation.rasters?.find((candidate) => candidate.name === name);
  if (!ref) return { status: 404 };
  const stored = loadTileRaster(db, row.cache_key, name);
  if (!stored) return { status: 404 };
  return { status: 200, body: stored.blob, ref };
}
