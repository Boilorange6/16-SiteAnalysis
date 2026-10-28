/** 서울플랜+ 사업 현황 API 원본 수집. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { maskKey } from "./rtms-fetch";

export const SEOUL_PLAN_SERVICES = ["vnBsnsNmtn", "vnBsnsSmalNmtn"] as const;
export type SeoulPlanApiRow = Record<string, unknown>;

export async function fetchSeoulPlan(o: { key: string; rawDir: string; date: string; refetch?: boolean }): Promise<Record<string, number>> {
  const dir = join(o.rawDir, "seoul_plan", "api", o.date);
  mkdirSync(dir, { recursive: true });
  const counts: Record<string, number> = {};
  for (const service of SEOUL_PLAN_SERVICES) {
    const file = join(dir, `${service}.json`);
    if (!o.refetch && existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, "utf8"));
      if (saved.service === service && Array.isArray(saved.rows) && saved.rows.length === saved.totalCount) {
        counts[service] = saved.rows.length;
        continue;
      }
    }
    const rows: SeoulPlanApiRow[] = [];
    let totalCount: number | null = null;
    for (let start = 1; totalCount === null || start <= totalCount; start += 1000) {
      const url = `http://openapi.seoul.go.kr:8088/${encodeURIComponent(o.key)}/json/${service}/${start}/${start + 999}/`;
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json() as Record<string, unknown>;
        const data = body[service] as { list_total_count?: number; RESULT?: { CODE?: string; MESSAGE?: string }; row?: SeoulPlanApiRow[] } | undefined;
        if (!data || data.RESULT?.CODE !== "INFO-000" || !Array.isArray(data.row)) throw new Error(`API 응답 오류 ${data?.RESULT?.CODE ?? "형식 오류"}`);
        const count = Number(data.list_total_count);
        if (!Number.isSafeInteger(count) || count < 0 || (totalCount !== null && count !== totalCount)) throw new Error("API 전체 행 수가 잘못되었거나 변경됨");
        totalCount = count;
        const expected = Math.min(1000, totalCount - start + 1);
        if (data.row.length !== expected) throw new Error(`API 페이지 행 수 불일치: ${data.row.length}/${expected}`);
        rows.push(...data.row);
      } catch (error) {
        throw new Error(maskKey(`${service} ${start}: ${error instanceof Error ? error.message : String(error)}`, o.key));
      }
    }
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ service, fetchedAt: new Date().toISOString(), totalCount, rows }));
    renameSync(tmp, file);
    counts[service] = rows.length;
  }
  return counts;
}
