/**
 * 경기도 정비사업 추진 현황 (경기데이터드림 openapi.gg.go.kr).
 *
 * 분당·과천 등 수도권 핵심 지역의 `단계: 미확인`을 해소하기 위한 지역 원천.
 * 서울 정보몽땅과 같은 방식으로 좌표를 붙여 공간조인에 쓴다.
 *
 * 주의: 실행하려면 data.go.kr 해당 데이터셋 활용신청 승인 + GG_OPEN_API_KEY가 필요하다.
 * 키가 없으면 provider는 빈 배열을 반환하고 앱은 기존 원천으로 동작한다.
 */
export const GYEONGGI_SERVICE_NAME = "ImprvBizStus";
const BASE_URL = `https://openapi.gg.go.kr/${GYEONGGI_SERVICE_NAME}`;
const DEFAULT_PAGE_SIZE = 1_000;
const MAX_PAGES = 20;

export interface GyeonggiMaintenanceRecord {
  readonly sido: string;
  readonly sigungu: string;
  readonly name: string;
  readonly type: string;
  readonly stage_text: string;
  readonly address: string;
  readonly planned_households?: number;
  readonly area_sqm?: number;
  readonly designation_date?: string;
}

type Row = Record<string, unknown>;

function text(row: Row, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

/** "1,842" → 1842, "-"·""·0 → undefined */
function numeric(row: Row, key: string): number | undefined {
  const raw = text(row, key).replaceAll(",", "");
  if (!/^\d+(\.\d+)?$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** "2021-03-15" 형태만 통과 — "0000-00-00" 같은 자리채움 값은 버린다 */
function isoDate(row: Row, key: string): string | undefined {
  const raw = text(row, key).replaceAll(".", "-").replaceAll("/", "-");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  return Number.parseInt(raw.slice(0, 4), 10) > 1900 && !raw.endsWith("00-00") ? raw : undefined;
}

export function normalizeGyeonggiRow(row: Row): GyeonggiMaintenanceRecord | null {
  const sigungu = text(row, "SIGUN_NM");
  const name = text(row, "BSNS_NM");
  if (!sigungu || !name) return null;
  return {
    sido: "경기도",
    sigungu,
    name,
    type: text(row, "BSNS_SE_NM"),
    stage_text: text(row, "PRGRS_STTUS_NM"),
    address: text(row, "LOCPLC_LOTNO_ADDR"),
    ...(numeric(row, "PLAN_HSHLD_CO") !== undefined ? { planned_households: numeric(row, "PLAN_HSHLD_CO") } : {}),
    ...(numeric(row, "ARA") !== undefined ? { area_sqm: numeric(row, "ARA") } : {}),
    ...(isoDate(row, "DESIGN_DE") ? { designation_date: isoDate(row, "DESIGN_DE") } : {}),
  };
}

function isObject(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ParsedPage {
  readonly rows: readonly Row[];
  readonly totalCount: number;
}

function parsePage(payload: unknown): ParsedPage {
  if (!isObject(payload)) throw new Error("경기 API 응답 형식 오류");
  // 데이터 없음은 오류가 아니다
  const topResult = payload.RESULT;
  if (isObject(topResult)) {
    const code = String(topResult.CODE ?? "");
    if (code.startsWith("INFO")) return { rows: [], totalCount: 0 };
    throw new Error(`경기 API 오류 ${code} ${String(topResult.MESSAGE ?? "")}`.trim());
  }

  const service = payload[GYEONGGI_SERVICE_NAME];
  if (!Array.isArray(service)) throw new Error("경기 API 응답에 서비스 블록이 없습니다");

  let totalCount = 0;
  const rows: Row[] = [];
  for (const block of service) {
    if (!isObject(block)) continue;
    if (Array.isArray(block.head)) {
      for (const headEntry of block.head) {
        if (!isObject(headEntry)) continue;
        if (typeof headEntry.list_total_count === "number") totalCount = headEntry.list_total_count;
        if (isObject(headEntry.RESULT)) {
          const code = String(headEntry.RESULT.CODE ?? "");
          if (code && !code.startsWith("INFO")) {
            throw new Error(`경기 API 오류 ${code} ${String(headEntry.RESULT.MESSAGE ?? "")}`.trim());
          }
        }
      }
    }
    if (Array.isArray(block.row)) rows.push(...block.row.filter(isObject));
  }
  return { rows, totalCount: totalCount || rows.length };
}

export async function fetchGyeonggiMaintenance(options: {
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
  readonly pageSize?: number;
  readonly signal?: AbortSignal;
}): Promise<readonly GyeonggiMaintenanceRecord[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const records: GyeonggiMaintenanceRecord[] = [];

  for (let pIndex = 1; pIndex <= MAX_PAGES; pIndex += 1) {
    const url = `${BASE_URL}?KEY=${encodeURIComponent(options.apiKey)}&Type=json`
      + `&pIndex=${pIndex}&pSize=${pageSize}`;
    const response = await fetchImpl(url, options.signal ? { signal: options.signal } : {});
    if (!response.ok) throw new Error(`경기 API HTTP ${response.status}`);
    const page = parsePage(await response.json());
    for (const row of page.rows) {
      const record = normalizeGyeonggiRow(row);
      if (record) records.push(record);
    }
    if (!page.rows.length || pIndex * pageSize >= page.totalCount) break;
  }
  return records;
}
