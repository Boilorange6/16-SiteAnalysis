/**
 * TileResult → 화면 문자열. 화면이 쓰는 문구는 전부 여기서 만든다 (컴포넌트에는 문구 로직 없음).
 * 규칙: 종합 점수 없음 · 도보 시간 없음 · 공급/가격/개발은 좋음·주의 평가 없음 (plan 화면 규칙 1~8).
 */
import type { OUTPUT_FACES, TileResult } from "../tile-result";
import { catalogEntry, sourceName } from "./tile-catalog";

export type OutputFace = (typeof OUTPUT_FACES)[number];
export type Badge = { text: string; note?: string; tone: "status" | "limit" | "model" };
export type Row = { label: string; value: string; aux?: string; tag?: string };
export type TileView = {
  tileId: string;
  code: string;
  title: string;
  color: string;
  status: TileResult["status"];
  badges: Badge[];
  headline: { value: string; label: string; aux?: string; tag?: string } | null;
  rows: Row[];
  sentence: string | null;
  grade: { label: string; criteria: string } | null;
  caveats: string[];
  notes: string[];
  sourceLine: string;
  chart: { label: string; value: number }[] | null;
  hasFace: boolean;
  retryable: boolean;
};

const STATUS_TEXT: Partial<Record<TileResult["status"], string>> = {
  partial: "일부 자료만 집계",
  failed: "계산 실패",
  cancelled: "취소됨",
  no_data: "자료 없음",
  not_provided: "다음 단계에서 제공",
};
const LIMIT_TEXT: Record<TileResult["limitations"][number]["kind"], string> = {
  estimated: "추정",
  incomplete: "지역 자료 불완전",
  partial: "일부 자료만 집계",
  unknown: "미확인",
  suppressed: "비공개",
  not_provided: "자료 미확보",
};
const GRADE_TEXT = { good: "좋음", fair: "보통", caution: "주의" } as const;
// 등급은 거리 지표 타일에서만 쓴다 (공급·가격·개발은 평가하지 않음).
const GRADED_CODES = new Set(["A01", "A02"]);
const CAVEATS: Record<string, string> = {
  A02: "배정은 교육청 확인",
  S02: "건물·지형 모델에 의한 기하학적 일조 추정입니다. 구름·실제 기상·창면 조건 및 법적 일조 판정을 포함하지 않습니다.",
  S03: "브라우저 탐색용 바람 모형입니다. 보행 안전·구조설계·인허가·검증된 CFD 결과로 사용할 수 없습니다.",
};
const MODEL_BADGE: Record<string, string> = { S02: "그림자 추정 · 법적 판정 아님", S03: "탐색용" };

export const FACE_TEXT: Record<OutputFace, string> = { front: "도판", back: "구성비", both: "도판 + 구성비" };
export const faceLabel = (f: OutputFace) => FACE_TEXT[f];

const group = (n: number) => {
  const [i, f] = String(n).split(".");
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? `.${f}` : "");
};
const withUnit = (n: number, unit: string) => {
  const v = unit === "년" ? String(n) : group(n); // 연도는 자리 구분 쉼표 없음
  return unit === "" ? v : unit.length > 2 ? `${v} ${unit}` : `${v}${unit}`;
};

function metricRow(m: TileResult["metrics"][number]): Row {
  const base = { label: m.label };
  switch (m.status) {
    case "missing":
      return { ...base, value: "미확인" };
    case "suppressed":
      return { ...base, value: "비공개" };
    case "not_applicable":
      return { ...base, value: "해당 없음" };
    default:
      return {
        ...base,
        value: withUnit(m.value as number, m.unit),
        ...(m.unit === "m" ? { aux: "직선" } : {}),
        ...(m.status === "estimated" ? { tag: "추정" } : {}),
      };
  }
}

export function sourceLineOf(sources: TileResult["provenance"]["sources"]): string {
  if (sources.length === 0) return "출처 없음";
  return sources.map((s) => `${sourceName(s.sourceId)} ${s.sourceAsOf ?? "기준일 미확인"}`).join(" · ");
}

export function toTileView(r: TileResult): TileView {
  const cat = catalogEntry(r.tileCode);
  const badges: Badge[] = [];
  const statusText = STATUS_TEXT[r.status];
  if (statusText) badges.push({ text: statusText, tone: "status" });
  for (const l of r.limitations) {
    badges.push({ text: LIMIT_TEXT[l.kind], note: l.note, tone: "limit" });
    if (r.tileCode === "A06" && l.note.includes("중복")) badges.push({ text: "중복 가능 · 합계 보류", note: l.note, tone: "limit" });
  }
  if (MODEL_BADGE[r.tileCode]) badges.push({ text: MODEL_BADGE[r.tileCode], tone: "model" });

  const overlap = r.tileCode === "A06";
  const isShare = (id: string) => r.tileCode === "D04" && id.startsWith("share_");
  const metrics = r.metrics.filter((m) => !(overlap && /total|sum/.test(m.id)));
  const rows = metrics.map(metricRow);
  const caveats = CAVEATS[r.tileCode] ? [CAVEATS[r.tileCode]] : [];

  let headline: TileView["headline"] = null;
  const hasResult = r.status === "complete" || r.status === "partial";
  if (hasResult && metrics.length > 0) {
    if (r.tileCode === "A02") {
      const zone = metrics.find((m) => m.id === "in_school_zone");
      const asOf = r.provenance.sources.find((s) => s.sourceId === "school_zone")?.sourceAsOf;
      const inside = zone?.status === "observed" ? (zone.value === 1 ? "통학구역 안" : "통학구역 밖") : "통학구역 미확인";
      headline = { value: inside, label: "대지 기준", aux: `학구도 기준일 ${asOf ?? "미확인"}` };
    } else {
      const first = rows[0];
      headline = { value: first.value, label: first.label, aux: first.aux, tag: first.tag };
    }
  }
  // A02의 통학구역 지표는 headline이 대신 보여 준다.
  const allRows = r.tileCode === "A02" ? metrics.filter((m) => m.id !== "in_school_zone").map(metricRow) : rows;

  const gradedMetricOk = r.judgment?.level != null && GRADED_CODES.has(r.tileCode) && r.judgment.criteria;
  return {
    tileId: r.tileId,
    code: r.tileCode,
    title: cat.title,
    color: cat.color,
    status: r.status,
    badges,
    headline,
    rows: allRows,
    sentence: r.judgment?.sentence ?? null,
    grade: gradedMetricOk ? { label: GRADE_TEXT[r.judgment!.level!], criteria: `내부 제안 기준: ${r.judgment!.criteria}` } : null,
    caveats,
    notes: r.limitations.map((l) => l.note),
    sourceLine: sourceLineOf(r.provenance.sources),
    chart:
      r.tileCode === "D04"
        ? r.metrics.filter((m) => isShare(m.id) && m.value !== null).map((m) => ({ label: m.label, value: m.value as number }))
        : null,
    hasFace: r.tileCode === "D04",
    retryable: r.status === "failed",
  };
}

// ── 대지 요약 ──
/** 면적·용도지역이 적재되지 않은 동안은 null — 화면에는 "미확인"으로 보인다. */
export type SiteSummary = { address: string; areaM2: number | null; zoning: string | null; radiusM: number; facts: string[] };
export type SummaryView = {
  address: string;
  area: string;
  zoning: string;
  radius: string;
  facts: string[];
  asOfLine: string;
  incomplete: boolean;
  incompleteCount: number;
};

export function toSummaryView(s: SiteSummary, results: TileResult[]): SummaryView {
  const dates = results.flatMap((r) => r.provenance.sources.map((x) => x.sourceAsOf)).filter((d): d is string => !!d).sort();
  const weak = results.filter((r) => r.status !== "complete" || r.limitations.some((l) => l.kind !== "estimated"));
  return {
    address: s.address,
    area: s.areaM2 === null ? "면적 미확인" : `${group(s.areaM2)}㎡`,
    zoning: s.zoning ?? "용도지역 미확인",
    radius: `반경 ${s.radiusM >= 1000 ? `${s.radiusM / 1000}km` : `${s.radiusM}m`}`,
    facts: s.facts.slice(0, 3),
    asOfLine: dates.length ? `자료 기준일 ${dates[0]}${dates.length > 1 && dates[0] !== dates[dates.length - 1] ? ` ~ ${dates[dates.length - 1]}` : ""}` : "자료 기준일 미확인",
    incomplete: weak.length > 0,
    incompleteCount: weak.length,
  };
}
