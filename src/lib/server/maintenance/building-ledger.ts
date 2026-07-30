/**
 * 국토부 건축물대장 HUB 총괄표제부(getBrRecapTitleInfo) 연동.
 * 정비구역 대표지번의 현존 건축물 사용승인일로 사업 완료(준공)를 판별한다.
 * 조합이 정보몽땅 단계를 갱신하지 않아 "착공"에 멈춘 완료 단지를 걸러내는 용도.
 */
export const RECAP_TITLE_ENDPOINT = "https://apis.data.go.kr/1613000/BldRgstHubService/getBrRecapTitleInfo";

export interface JibunAddress {
  readonly dong: string;
  readonly bun: string;
  readonly ji: string;
}

/** "서울특별시 강남구 개포동 660-4" → { dong: "개포동", bun: "660", ji: "4" } */
export function parseJibunAddress(address: string): JibunAddress | null {
  const matches = [...address.matchAll(/([가-힣]+(?:동|가|리))\s+(\d{1,4})(?:-(\d{1,4}))?(?=\s|$)/gu)];
  const last = matches.at(-1);
  if (!last) return null;
  return { dong: last[1] ?? "", bun: last[2] ?? "", ji: last[3] ?? "0" };
}

export interface RecapTitleInfo {
  readonly households: number;
  /** 사용승인일 YYYYMMDD — 없으면 undefined */
  readonly use_approval_day?: string;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function itemList(body: JsonObject): readonly JsonObject[] {
  const items = body.items;
  if (!isObject(items)) return [];
  const item = items.item;
  if (Array.isArray(item)) return item.filter(isObject);
  return isObject(item) ? [item] : [];
}

export async function fetchRecapTitleInfo(options: {
  readonly serviceKey: string;
  readonly sigunguCd: string;
  readonly bjdongCd: string;
  readonly bun: string;
  readonly ji: string;
  /** 테스트 주입용 — 기본 global fetch (data.go.kr는 ky 기본 헤더에 NPE를 반환한다) */
  readonly fetchImpl?: typeof fetch;
}): Promise<RecapTitleInfo | null> {
  // data.go.kr는 serviceKey 인코딩에 민감 — URL을 직접 구성한다
  const url = `${RECAP_TITLE_ENDPOINT}?serviceKey=${encodeURIComponent(options.serviceKey)}`
    + `&sigunguCd=${options.sigunguCd}&bjdongCd=${options.bjdongCd}`
    + `&bun=${options.bun.padStart(4, "0")}&ji=${options.ji.padStart(4, "0")}`
    + `&numOfRows=20&pageNo=1&_type=json`;
  const response = await (options.fetchImpl ?? fetch)(url);
  if (!response.ok) throw new Error(`건축물대장 HTTP ${response.status}`);
  const root: unknown = await response.json();
  if (!isObject(root) || !isObject(root.response)) throw new Error("건축물대장 응답 형식 오류");
  const header = root.response.header;
  if (isObject(header) && header.resultCode !== undefined && String(header.resultCode) !== "00") {
    throw new Error(`건축물대장 오류 코드 ${String(header.resultCode)}`);
  }
  if (!isObject(root.response.body)) return null;
  const items = itemList(root.response.body);
  if (!items.length) return null;
  // 여러 총괄표제부가 있으면 최신 사용승인일 기준(신축 대장이 완료 판별의 근거)
  let best: RecapTitleInfo | null = null;
  for (const item of items) {
    const day = String(item.useAprDay ?? "").trim();
    const useDay = /^\d{8}$/.test(day) ? day : undefined;
    const households = Number(item.hhldCnt ?? 0);
    const candidate: RecapTitleInfo = {
      households: Number.isFinite(households) ? households : 0,
      ...(useDay ? { use_approval_day: useDay } : {}),
    };
    if (!best || (candidate.use_approval_day ?? "") > (best.use_approval_day ?? "")) best = candidate;
  }
  return best;
}

/** 완료 판별 대상 단계 — 공사가 존재할 수 있는 후반부 단계만 조회해 API 낭비를 줄인다 */
export const LEDGER_CHECK_STAGE_PATTERN = /착공|분양|철거|관리처분|이주/u;

export interface CompletionAssessment {
  readonly completed: boolean;
  readonly use_approval_day?: string;
  readonly households?: number;
}

/**
 * 현존 건물 사용승인일이 구역지정일 이후(미상이면 2018년 이후)면
 * 신축이 완료된 것으로 보고 사업 종료로 판정한다.
 * (재건축 대상 구축은 사용승인일이 지정일보다 과거이므로 오탐하지 않는다)
 */
export function assessLedgerCompletion(options: {
  readonly recap: RecapTitleInfo | null;
  readonly designationDate?: string;
}): CompletionAssessment {
  const recap = options.recap;
  const day = recap?.use_approval_day;
  if (!recap || !day) return { completed: false };
  const useYear = Number(day.slice(0, 4));
  const designationYear = Number(options.designationDate?.slice(0, 4));
  const threshold = Number.isFinite(designationYear) && designationYear > 1900 ? designationYear : 2018;
  if (!Number.isFinite(useYear) || useYear < threshold) return { completed: false };
  return {
    completed: true,
    use_approval_day: day,
    ...(recap.households > 0 ? { households: recap.households } : {}),
  };
}

export function formatUseApprovalDay(day: string): string {
  return `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
}
