/**
 * v2는 기존 앱 DB를 건드리지 않는다(spec §4.6).
 * 두 경로가 같게 설정되면 사용자 데이터가 섞이므로 시작부터 거부한다.
 */
import { dirname, resolve } from "node:path";

/** 기존 src/lib/server/database.ts의 DB_PATH 규칙과 같다. 그 파일을 수정하지 않으려고 복제했다. */
export function legacyDbPath(): string {
  return process.env.DB_PATH || resolve(process.cwd(), ".cache/site-analysis.db");
}

export function v2AppDbPath(): string {
  const path = process.env.V2_APP_DB_PATH || resolve(process.cwd(), ".cache/v2/app.sqlite");
  if (resolve(path).toLowerCase() === resolve(legacyDbPath()).toLowerCase()) {
    throw new Error("V2_APP_DB_PATH must differ from the legacy DB_PATH");
  }
  return path;
}

export function v2DataDir(): string {
  return process.env.V2_DATA_DIR || resolve(process.cwd(), ".cache/v2/data");
}

export function v2RequestsDir(): string {
  return process.env.V2_REQUESTS_DIR || resolve(dirname(v2DataDir()), "requests");
}
