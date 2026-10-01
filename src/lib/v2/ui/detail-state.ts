/**
 * G3 상세 창의 브라우저 상태와 표시 규칙.
 *
 * 서버의 detail registry는 Node 전용 모듈을 포함하므로 화면에서는 이
 * 계약을 별도로 사용한다. API의 숫자/날짜 원값은 CSV에 그대로 남고,
 * 이 파일의 포맷은 화면 표에만 적용된다.
 */

export const DETAIL_CODES: ReadonlySet<string> = new Set([
  "D02", "D03", "D04", "D05", "D06", "D07",
  "D08", "D09", "D10", "D11", "D12", "D13", "D14",
  "D16", "D17", "D18", "D19", "D20", "D21", "D22", "D23",
  "D24", "D25", "D26", "D27", "D28", "D29",
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
  return number.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function formatYear(value: DetailValue): string {
  if (value === null || value === undefined || value === "") return "—";
  const match = String(value).match(/\b(\d{4})/);
  return match ? match[1] : sanitizeDetailText(String(value));
}

/** 표의 한 셀. 숫자에는 단위를 붙이지 않고 머리글의 단위를 사용한다. */
export function formatDetailValue(value: DetailValue, column: DetailColumn, row?: DetailRow): string {
  if (value === null || value === undefined || value === "") return "—";
  if (column.key === "approval_date") return formatYear(value);
  if (column.key === "floors_above") {
    const above = formatNumber(value);
    const below = row ? numberValue(row.cells.floors_below) : null;
    return below === null ? `${above}/—` : `${above}/B${formatNumber(below)}`;
  }
  if (column.kind === "number") return formatNumber(value);
  if (column.kind === "date") return sanitizeDetailText(String(value));
  return sanitizeDetailText(String(value));
}

/** API는 CSV 전용으로 둔 승인일·지하층도 화면의 필요한 요약 열로 복원한다. */
export function tableColumns(payload: Pick<DetailPayload, "columns" | "csvColumns" | "code">): DetailTableColumn[] {
  const columns = payload.columns.filter((column) => !column.csvOnly).map((column) => ({
    ...column,
    label: column.key === "floors_above" ? "층" : column.label,
    csvOnly: false as const,
  }));
  if (["D02", "D03", "D04", "D05", "D06", "D07"].includes(payload.code) && payload.csvColumns.some((column) => column.key === "approval_date") && !columns.some((column) => column.key === "approval_date")) {
    columns.push({ key: "approval_date", label: "승인", kind: "date", csvOnly: false });
  }
  return columns;
}

export function rowTitle(row: DetailRow, columns: readonly DetailColumn[]): string {
  const preferred = ["name", "address", "band", "density_band", "direction"];
  const key = preferred.find((candidate) => columns.some((column) => column.key === candidate) && row.cells[candidate] !== null && row.cells[candidate] !== undefined && row.cells[candidate] !== "")
    ?? columns.find((column) => row.cells[column.key] !== null && row.cells[column.key] !== undefined && row.cells[column.key] !== "")?.key;
  return key ? formatDetailValue(row.cells[key] ?? null, columns.find((column) => column.key === key) ?? { key, label: key, kind: "text" }) : "값 없음";
}

export function filterDetailRows(rows: readonly DetailRow[], columns: readonly DetailColumn[], query: string): DetailRow[] {
  const lowered = query.trim().toLocaleLowerCase("ko-KR");
  if (!lowered) return [...rows];
  return rows.filter((row) => [rowTitle(row, columns), ...Object.values(row.cells).map((value) => sanitizeDetailText(value === null ? "" : String(value)))].some((value) => value.toLocaleLowerCase("ko-KR").includes(lowered)));
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

export const missingLabel = (value: string | null | undefined): string => value ? sanitizeDetailText(value) : "값 없음";
