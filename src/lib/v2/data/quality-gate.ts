/**
 * 적재 품질 검사 (spec §3.5).
 * 기존 30% 급감 거부를 최종 안전장치로 유지하고, 전국 합계로는 안 보이는 실패를 더 잡는다.
 */
import { DROP_REJECT_RATIO } from "../../server/dataset-store";

/** 이전 대비 이만큼(비율 포인트) 넘게 채움률이 떨어지면 보류한다 */
export const FILL_RATE_DROP_THRESHOLD = 0.1;

export interface IngestSnapshot {
  total: number;
  byRegion: Record<string, number>;
  byType: Record<string, number>;
  /** 필드별 채움률 0..1 */
  fillRates: Record<string, number>;
}

export interface IngestObservation {
  /** 원천이 응답에 담았다고 밝힌 행 수. 모르면 null */
  responseRowsReported: number | null;
  parsedRows: number;
  pageLimitHit: boolean;
  totalCountReported: number | null;
  next: IngestSnapshot;
  previous: IngestSnapshot | null;
  /** 첫 적재에도 반드시 있어야 하는 지역 코드 */
  expectedRegions?: readonly string[];
}

export type GateFailureCode =
  | "PARSED_ZERO_WITH_ROWS"
  | "EMPTY"
  | "TOTAL_DROP"
  | "REGION_MISSING"
  | "TYPE_MISSING"
  | "FILL_RATE_DROP"
  | "INCOMPLETE_FETCH"
  | "EXPECTATION_BELOW";

export interface GateFailure {
  code: GateFailureCode;
  detail: string;
}

export interface GateResult {
  ok: boolean;
  failures: GateFailure[];
}

function missingKeys(previous: Record<string, number>, next: Record<string, number>): string[] {
  return Object.entries(previous)
    .filter(([key, count]) => count > 0 && !((next[key] ?? 0) > 0))
    .map(([key]) => key);
}

export function evaluateIngest(obs: IngestObservation): GateResult {
  const failures: GateFailure[] = [];
  const { next, previous } = obs;

  if ((obs.responseRowsReported ?? 0) > 0 && obs.parsedRows === 0) {
    failures.push({ code: "PARSED_ZERO_WITH_ROWS", detail: `response reported ${obs.responseRowsReported} rows, parsed 0` });
  } else if (next.total <= 0) {
    failures.push({ code: "EMPTY", detail: "ingest produced 0 rows" });
  }

  if (previous && previous.total > 0 && next.total < previous.total * (1 - DROP_REJECT_RATIO)) {
    failures.push({ code: "TOTAL_DROP", detail: `${previous.total} -> ${next.total}` });
  }

  const regionBaseline: Record<string, number> = { ...(previous?.byRegion ?? {}) };
  for (const region of obs.expectedRegions ?? []) regionBaseline[region] = Math.max(regionBaseline[region] ?? 0, 1);
  const lostRegions = missingKeys(regionBaseline, next.byRegion);
  if (lostRegions.length > 0) failures.push({ code: "REGION_MISSING", detail: lostRegions.join(",") });

  if (previous) {
    const lostTypes = missingKeys(previous.byType, next.byType);
    if (lostTypes.length > 0) failures.push({ code: "TYPE_MISSING", detail: lostTypes.join(",") });

    const dropped = Object.entries(previous.fillRates)
      .filter(([field, rate]) => rate - (next.fillRates[field] ?? 0) > FILL_RATE_DROP_THRESHOLD + 1e-9)
      .map(([field, rate]) => `${field} ${rate} -> ${next.fillRates[field] ?? 0}`);
    if (dropped.length > 0) failures.push({ code: "FILL_RATE_DROP", detail: dropped.join("; ") });
  }

  if (obs.pageLimitHit || (obs.totalCountReported !== null && obs.totalCountReported !== obs.parsedRows)) {
    failures.push({
      code: "INCOMPLETE_FETCH",
      detail: obs.pageLimitHit ? "page limit reached" : `totalCount ${obs.totalCountReported} != parsed ${obs.parsedRows}`,
    });
  }

  return { ok: failures.length === 0, failures };
}

export interface SiteExpectation {
  siteId: string;
  kind: string;
  minCount: number;
}

export function checkExpectations(
  expectations: readonly SiteExpectation[],
  count: (siteId: string, kind: string) => number,
): GateResult {
  const failures: GateFailure[] = [];
  for (const e of expectations) {
    const actual = count(e.siteId, e.kind);
    if (actual < e.minCount) {
      failures.push({ code: "EXPECTATION_BELOW", detail: `${e.siteId} ${e.kind}: ${actual} < ${e.minCount}` });
    }
  }
  return { ok: failures.length === 0, failures };
}
