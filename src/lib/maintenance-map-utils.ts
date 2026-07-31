import { formatMaintenanceArea } from "./maintenance-analysis";
import { maintenanceStalenessNote } from "./maintenance-presentation";
import type {
  MaintenanceBoundary,
  MaintenanceBoundaryStatus,
  MaintenanceProject,
  MaintenanceSource,
  RecentTradeItem,
  RecentTradeSummary,
} from "./types";

/** 거래금액(만원) → "22억 5,000" / "9,800만" */
export function formatTradePrice(manwon: number): string {
  if (manwon >= 10_000) {
    const eok = Math.floor(manwon / 10_000);
    const rest = manwon % 10_000;
    return rest > 0 ? `${eok}억 ${rest.toLocaleString()}` : `${eok}억`;
  }
  return `${manwon.toLocaleString()}만`;
}

/** PPT 표 셀용 축약 — "22.5억(26.06)" / 거래 없으면 "무거래" */
export function formatComplexTradeCell(summary: RecentTradeSummary | undefined): string {
  if (!summary) return "무거래";
  const eokValue = summary.latest_price_manwon / 10_000;
  const price = eokValue >= 1
    ? `${(Math.round(eokValue * 10) / 10).toString().replace(/\.0$/, "")}억`
    : `${summary.latest_price_manwon.toLocaleString()}만`;
  const date = summary.latest_date;
  return `${price}(${date.slice(2, 4)}.${date.slice(5, 7)})`;
}

/** 팝업 펼침 목록 HTML — 최근 거래 상세를 접힌 상태로 제공한다 */
export function buildTradeDetailHtml(summary: RecentTradeSummary): string {
  const list = summary.recent_list ?? [];
  if (list.length <= 1) return "";
  const items = list
    .map((item) => `<li style="padding:2px 0;color:#334155">${escapeMaintenanceHtml(formatTradeDetailLine(item))}</li>`)
    .join("");
  return `<details style="margin-top:6px">
    <summary style="cursor:pointer;font-size:12px;color:#2563eb;font-weight:600">최근 거래 ${list.length}건 보기</summary>
    <ul style="margin:4px 0 0;padding-left:16px;font-size:12px;line-height:1.5">${items}</ul>
  </details>`;
}

/** "2026-06-15 · 22억 5,000 · 84.9㎡ · 21층" */
export function formatTradeDetailLine(item: RecentTradeItem): string {
  const parts = [item.deal_date, formatTradePrice(item.price_manwon)];
  if (item.area_sqm > 0) parts.push(`${item.area_sqm}㎡`);
  if (item.floor) parts.push(`${item.floor}층`);
  return parts.join(" · ");
}

/** "22억 5,000 (2026-06-15 · 84.9㎡) · 6개월 12건" */
export function formatRecentTradesLine(summary: RecentTradeSummary): string {
  const area = summary.latest_area_sqm > 0 ? ` · ${summary.latest_area_sqm}㎡` : "";
  return `${formatTradePrice(summary.latest_price_manwon)} (${summary.latest_date}${area}) · ${summary.months}개월 ${summary.count}건`;
}

const MAINTENANCE_SOURCE_LABELS: Readonly<Record<MaintenanceSource, string>> = {
  molit_integrated: "국토부 전국 정비사업",
  public_standard: "공공데이터 표준 정비사업",
  molit_spatial: "국토부 정비구역 경계",
  seoul_open_data: "서울 열린데이터광장",
  busan_data_go_kr: "부산 정비사업 API",
};

const BOUNDARY_LABELS: Readonly<Record<MaintenanceBoundaryStatus, string>> = {
  confirmed: "공식 경계 확인",
  unmatched: "공식 경계 · 사업정보 미결합",
  unavailable: "경계 미확인",
};

export function boundaryToLeafletLatLngs(
  boundary: MaintenanceBoundary,
): [number, number][][] | [number, number][][][] {
  switch (boundary.type) {
    case "Polygon":
      return boundary.coordinates.map((ring) => ring.map(([lng, lat]): [number, number] => [lat, lng]));
    case "MultiPolygon":
      return boundary.coordinates.map((polygon) =>
        polygon.map((ring) => ring.map(([lng, lat]): [number, number] => [lat, lng]))
      );
    default: {
      const unexpectedBoundary: never = boundary;
      throw new Error(`Unsupported maintenance boundary: ${unexpectedBoundary}`);
    }
  }
}

export function maintenanceBoundaryLabel(status: MaintenanceBoundaryStatus): string {
  return BOUNDARY_LABELS[status];
}

export function maintenanceSourceLabel(source: MaintenanceSource): string {
  return MAINTENANCE_SOURCE_LABELS[source];
}

export function escapeMaintenanceHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function safeExternalHref(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? escapeMaintenanceHtml(url.toString()) : null;
  } catch {
    return null;
  }
}

function popupRow(label: string, value: string): string {
  return `<tr><th scope="row" style="color:#64748b;padding:4px 12px 4px 0;font-size:12px;font-weight:500;text-align:left;white-space:nowrap">${label}</th><td style="font-weight:600;font-size:12px;line-height:1.45;overflow-wrap:anywhere">${value}</td></tr>`;
}

export function buildMaintenancePopupHtml(project: MaintenanceProject): string {
  const sourceLabel = maintenanceSourceLabel(project.source);
  const sourceHref = safeExternalHref(project.notice_url ?? project.boundary_source_url);
  const sourceValue = sourceHref
    ? `<a href="${sourceHref}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;font-weight:700">${sourceLabel}</a>`
    : sourceLabel;
  const households = project.planned_households && project.planned_households > 0
    ? `${project.planned_households.toLocaleString()}세대`
    : "미확인";

  return `<article style="font-family:'Noto Sans KR','Pretendard',system-ui,sans-serif;min-width:240px;max-width:300px;color:#0f172a">
    <h3 style="font-weight:800;font-size:14px;margin:0 0 8px;color:#DB2777;line-height:1.45;overflow-wrap:anywhere">${escapeMaintenanceHtml(project.name)}</h3>
    <table style="width:100%;border-collapse:collapse">
      ${popupRow("유형", escapeMaintenanceHtml(project.type || "정비사업"))}
      ${popupRow("단계", escapeMaintenanceHtml(project.stage_detail ?? project.stage))}
      ${popupRow("시행자", escapeMaintenanceHtml(project.implementer || "미확인"))}
      ${popupRow("예정세대수", households)}
      ${popupRow("면적", project.area_sqm > 0 ? formatMaintenanceArea(project.area_sqm) : "미확인")}
      ${popupRow("구역지정일", escapeMaintenanceHtml(project.designation_date || "미확인"))}
      ${popupRow("주소/위치", escapeMaintenanceHtml(project.address || "미확인"))}
      ${project.recent_trades ? popupRow("최근 실거래", escapeMaintenanceHtml(formatRecentTradesLine(project.recent_trades))) : ""}
      ${maintenanceStalenessNote(project) ? popupRow("주의", `<span style="color:#B45309;font-weight:700">${escapeMaintenanceHtml(maintenanceStalenessNote(project))}</span>`) : ""}
      ${popupRow("경계", maintenanceBoundaryLabel(project.boundary_status))}
      ${popupRow("출처", sourceValue)}
      ${popupRow("기준일", escapeMaintenanceHtml(project.source_updated_at || "미확인"))}
    </table>
    ${project.recent_trades ? buildTradeDetailHtml(project.recent_trades) : ""}
    <p style="margin:9px 0 0;padding-top:8px;border-top:1px solid #e2e8f0;color:#475569;font-size:12px;line-height:1.5">법적 효력 없는 참고자료</p>
  </article>`;
}
