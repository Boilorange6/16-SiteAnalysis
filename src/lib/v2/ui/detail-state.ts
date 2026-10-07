/**
 * G3 상세 창의 브라우저 상태와 표시 규칙.
 *
 * 서버의 detail registry는 Node 전용 모듈을 포함하므로 화면에서는 이
 * 계약을 별도로 사용한다. API의 숫자/날짜 원값은 CSV에 그대로 남고,
 * 이 파일의 포맷은 화면 표에만 적용된다.
 */

export const DETAIL_CODES: ReadonlySet<string> = new Set([
  "A01", "A02", "A04", "A07", "A09", "A10", "A11", "A12",
  "D02", "D03", "D04", "D05", "D10", "D11", "D12", "D13",
  "D16", "D17", "D18", "D19", "D22", "D28", "D29", "S02",
]);

export type DetailValue = string | number | null;
export type DetailColumn = {
  key: string;
  label: string;
  unit?: string;
  kind: "text" | "number" | "date" | "category";
  csvOnly?: boolean;
};
export type DetailRow = {
  fid: string;
  fids?: string[];
  lng: number;
  lat: number;
  cells: Record<string, DetailValue>;
};
export type DetailCard = {
  title: string;
  subtitle?: string;
  chip?: { label: string; color: string };
  fields: Array<{ label: string; value: string | null }>;
  missing?: string[];
  source: string;
};
export type DetailControl = {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  default: string;
};
export type DetailPayload = {
  analysisId: string;
  code: string;
  title: string;
  columns: DetailColumn[];
  csvColumns: DetailColumn[];
  controls: DetailControl[];
  card: DetailCard;
  rows: DetailRow[];
  total: number;
  rowCount?: number;
  exportFileName: string;
};
export type DetailAt = {
  card: DetailCard;
  fid?: string;
  fids?: string[];
  path?: Array<[number, number]>;
};
export type DetailTableColumn = DetailColumn & { label: string; csvOnly?: false };

/** 목록 API의 기본 limit 버그(Number(null) === 0)를 화면에서 넘기기 위한 전체 행 상한. */
export const DETAIL_LIST_LIMIT = 5000;

const BUILDING_USE_PREFIX_LABELS: Readonly<Record<string, string>> = {
  "01": "주거", "02": "주거",
  "03": "근린생활", "04": "근린생활",
  "05": "문화집회", "06": "문화집회", "13": "문화집회", "27": "문화집회",
  "07": "판매",
  "08": "기타", "20": "기타", "21": "기타", "23": "기타", "26": "기타", "28": "기타", "29": "기타",
  "09": "교육복지", "10": "교육복지", "11": "교육복지", "12": "교육복지",
  "14": "업무", "24": "업무",
  "15": "숙박", "16": "숙박",
  "17": "공업", "18": "공업", "19": "공업", "22": "공업", "25": "공업",
};

const DETAIL_NUMBER_FORMATTER = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 });

function isMissing(value: DetailValue): boolean {
  return value === null || value === undefined || value === "";
}

function buildingUseLabel(value: DetailValue): DetailValue {
  if (typeof value !== "string") return value;
  const raw = value.trim();
  if (!/^\d{5}$/.test(raw)) return value;
  return BUILDING_USE_PREFIX_LABELS[raw.slice(0, 2)] ?? "미상";
}

function fallbackCellValue(value: DetailValue, column: DetailColumn, row: DetailRow | undefined): DetailValue {
  if (!isMissing(value) || !row) return value;
  if (column.key === "name" && row.fid) return `건물 ${row.fid}`;
  if (column.key === "address" && row.fid) {
    const pnu = row.cells.pnu;
    return typeof pnu === "string" && pnu.trim() !== "" ? `PNU ${pnu.trim()}` : `주소 미확인 · 건물 ${row.fid}`;
  }
  return value;
}

/** 화면용 셀 원값. 원자료/CSV는 손대지 않고, 누락된 건물 식별 정보만 읽을 수 있게 보강한다. */
export function detailCellValue(value: DetailValue, column: DetailColumn, row?: DetailRow): DetailValue {
  const fallback = fallbackCellValue(value, column, row);
  return column.key === "primary_use" ? buildingUseLabel(fallback) : fallback;
}

export function hasDetail(code: string): boolean {
  return DETAIL_CODES.has(code);
}

/** 서버/시안에서 실수로 남은 템플릿 표현식이 사용자 화면에 노출되지 않게 한다. */
export function sanitizeDetailText(value: string | null | undefined): string {
  if (!value) return "";
  const cleaned = value
    .replace(/\s*\$\{[^}]*\}\s*(?:m|㎡|분)?/g, " 값 없음")
    .replace(/\$\{[^}]*\}/g, "값 없음")
    .replace(/\$\{/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || "값 없음";
}

function numberValue(value: DetailValue): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function formatNumber(value: DetailValue): string {
  const number = numberValue(value);
  if (number === null) return "—";
  return DETAIL_NUMBER_FORMATTER.format(number);
}

function formatYear(value: DetailValue): string {
  if (value === null || value === undefined || value === "") return "—";
  const match = String(value).match(/\b(\d{4})/);
  return match ? match[1] : sanitizeDetailText(String(value));
}

/** 표의 한 셀. 숫자에는 단위를 붙이지 않고 머리글의 단위를 사용한다. */
export function formatDetailValue(value: DetailValue, column: DetailColumn, row?: DetailRow): string {
  const displayValue = detailCellValue(value, column, row);
  if (isMissing(displayValue)) return "—";
  if (column.key === "approval_date") return formatYear(displayValue);
  if (column.key === "floors_above") {
    const above = formatNumber(displayValue);
    const below = row ? numberValue(row.cells.floors_below) : null;
    return below === null ? `${above}/—` : `${above}/B${formatNumber(below)}`;
  }
  if (column.kind === "number") return formatNumber(displayValue);
  if (column.kind === "date") return sanitizeDetailText(String(displayValue));
  return sanitizeDetailText(String(displayValue));
}

/** 카드의 숫자 문자열도 같은 Intl 규칙을 적용해 IEEE-754 꼬리 숫자가 새지 않게 한다. */
export function formatDetailCardValue(value: string | null | undefined): string {
  const cleaned = value ? sanitizeDetailText(value) : "";
  if (!cleaned) return "값 없음";
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) return cleaned;
  const match = cleaned.match(/^(-?(?:\d[\d,]*)(?:\.\d+)?)(.*)$/);
  if (!match) return cleaned;
  const numeric = Number(match[1]!.replaceAll(",", ""));
  return Number.isFinite(numeric) ? `${DETAIL_NUMBER_FORMATTER.format(numeric)}${match[2]}` : cleaned;
}

/** API는 CSV 전용으로 둔 승인일·지하층도 화면의 필요한 요약 열로 복원한다. */
export function tableColumns(payload: Pick<DetailPayload, "columns" | "csvColumns" | "code">): DetailTableColumn[] {
  const columns = payload.columns.filter((column) => !column.csvOnly).map((column) => ({
    ...column,
    label: column.key === "floors_above" ? "층" : column.label,
    csvOnly: false as const,
  }));
  if (["D02", "D03", "D04", "D05"].includes(payload.code) && payload.csvColumns.some((column) => column.key === "approval_date") && !columns.some((column) => column.key === "approval_date")) {
    columns.push({ key: "approval_date", label: "승인", kind: "date", csvOnly: false });
  }
  return columns;
}

export function rowTitle(row: DetailRow, columns: readonly DetailColumn[]): string {
  const preferred = ["name", "address", "band", "density_band", "direction"];
  const columnFor = (key: string) => columns.find((column) => column.key === key);
  const key = preferred.find((candidate) => {
    const column = columnFor(candidate);
    return !!column && (!isMissing(row.cells[candidate]) || candidate === "name" || candidate === "address");
  })
    ?? columns.find((column) => !isMissing(row.cells[column.key]))?.key;
  return key ? formatDetailValue(row.cells[key] ?? null, columnFor(key) ?? { key, label: key, kind: "text" }, row) : "값 없음";
}

export function filterDetailRows(rows: readonly DetailRow[], columns: readonly DetailColumn[], query: string): DetailRow[] {
  const lowered = query.trim().toLocaleLowerCase("ko-KR");
  if (!lowered) return [...rows];
  return rows.filter((row) => [rowTitle(row, columns), ...Object.entries(row.cells).map(([key, value]) => formatDetailValue(value, columns.find((column) => column.key === key) ?? { key, label: key, kind: "text" }, row))].some((value) => value.toLocaleLowerCase("ko-KR").includes(lowered)));
}

export function sortDetailRows(rows: readonly DetailRow[], column: DetailColumn | undefined, direction: "asc" | "desc"): DetailRow[] {
  if (!column) return [...rows];
  const sign = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = a.cells[column.key];
    const bv = b.cells[column.key];
    if (av === bv) return a.fid.localeCompare(b.fid, "en", { numeric: true });
    if (av === null || av === undefined || av === "") return 1;
    if (bv === null || bv === undefined || bv === "") return -1;
    const an = numberValue(av);
    const bn = numberValue(bv);
    if (an !== null && bn !== null) return sign * (an - bn);
    return sign * String(av).localeCompare(String(bv), "ko-KR", { numeric: true, sensitivity: "base" });
  });
}

export function detailApiUrl(analysisId: string, code: string, suffix = "", controls: Readonly<Record<string, string>> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(controls)) if (value) params.set(key, value);
  const query = params.toString();
  return `/site/api/v2/analyses/${encodeURIComponent(analysisId)}/detail/${encodeURIComponent(code)}${suffix}${query ? `?${query}` : ""}`;
}

/** 목록은 summary.total과 같은 페이지를 받아야 하므로 명시적으로 전체 limit을 붙인다. */
export function detailListApiUrl(analysisId: string, code: string, controls: Readonly<Record<string, string>> = {}): string {
  const base = detailApiUrl(analysisId, code, "", controls);
  return `${base}${base.includes("?") ? "&" : "?"}limit=${DETAIL_LIST_LIMIT}`;
}

export type DetailFeatureWeight = { fid?: string | null; weight?: number | null };

/** A04 대표점의 원천 면적(weight)을 목록의 0㎡ fallback으로 사용한다. */
export function normalizeDetailPayload(payload: DetailPayload, features: readonly DetailFeatureWeight[] = [], radiusM = 0): DetailPayload {
  if (payload.code !== "A04") return payload;
  const weights = new Map(features.filter((feature) => feature.fid).map((feature) => [feature.fid!, feature.weight]));
  const circleArea = radiusM > 0 ? Math.PI * radiusM ** 2 : 0;
  const rows = payload.rows.map((row) => {
    const originalArea = numberValue(row.cells.area_m2);
    const mapArea = weights.get(row.fid);
    const area = originalArea !== null && originalArea > 0 ? originalArea : typeof mapArea === "number" && Number.isFinite(mapArea) && mapArea > 0 ? mapArea : originalArea;
    return {
      ...row,
      cells: {
        ...row.cells,
        area_m2: area,
        share_pct: area !== null && circleArea > 0 ? (area / circleArea) * 100 : row.cells.share_pct,
      },
    };
  });
  const areaSum = rows.reduce((sum, row) => sum + (numberValue(row.cells.area_m2) ?? 0), 0);
  if (areaSum <= 0) return { ...payload, rows };
  return {
    ...payload,
    rows,
    card: {
      ...payload.card,
      fields: payload.card.fields.map((field) => field.label === "면적 합계" ? { ...field, value: `${DETAIL_NUMBER_FORMATTER.format(areaSum)}㎡` } : field),
    },
  };
}

export const missingLabel = (value: string | null | undefined): string => value ? sanitizeDetailText(value) : "값 없음";
