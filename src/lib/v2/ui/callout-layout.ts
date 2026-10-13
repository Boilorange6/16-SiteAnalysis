/**
 * 주변 단지 설명선(콜아웃) 배치 — 순수 함수. A05가 쓰고, A06(입주 시기·세대수·원천)도 행 정의만 바꿔 다시 쓴다.
 *
 * 규칙: 대지 기준 x가 왼쪽이면 왼쪽 칸, 오른쪽이면 오른쪽 칸(넘치면 중심에 가까운 것부터 반대쪽으로) →
 * 칸 안은 점의 세로 순서대로 위에서 아래로 쌓고(최소 간격 유지) → 지시선은 점 → 꺾임점 → 카드 안쪽 가장자리.
 * 같은 칸 지시선이 교차하면 두 카드의 자리를 맞바꿔 푼다(선 길이가 줄어드는 교환이라 반드시 끝난다).
 * 좌표 단위는 호출자가 정한다(화면 px, 슬라이드 inch). 점은 두 칸 사이의 지도 영역 안에 있어야 한다(calloutFrame이 보장).
 */
import type { MapFeature } from "../tile-result";
import { unitTypeSummary, unitTypesFromUnknown, type UnitType } from "../unit-types";
import { layerStyle } from "./map-layers";
import { SLIDE } from "./overlay-layout";

export type Complex = {
  id: string;
  /** 세대수 순위(1부터). 표의 번호와 점의 번호가 같다 */
  rank: number;
  layer: string;
  name: string | null;
  type: string | null;
  households: number | null;
  approvalYear: number | null;
  floorsMax: number | null;
  buildingCount: number | null;
  distanceM: number | null;
  parking: number | null;
  unitTypes: UnitType[];
  lng: number;
  lat: number;
  /** A06(분양·입주예정) 사업이면 채운다. 없으면 A05 단지 */
  supply?: SupplyInfo | null;
};

/** A06 사업 하나의 일정·원천 (월 단위, 일자는 만들지 않는다) */
export type SupplyInfo = { plannedMonth: string | null; source: string; overlap: boolean; timing: Timing };

export const PAGE_SIZE = 10;
/** 보드 카드에 설명표를 붙이는 단지 수 */
export const BOARD_TOP = 6;
export const MISSING = "확인필요";

const n0 = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);
export const fmtInt = (n: number) => n.toLocaleString("en-US");

/** 세대수 내림차순(미상은 뒤) → 가까운 순 → 이름 → 좌표. 같은 입력이면 순위·id가 항상 같다 */
export function rankComplexes(features: MapFeature[]): Complex[] {
  const list = features.map((f) => ({
    layer: f.layer,
    name: f.name?.trim() || null,
    type: f.type ?? null,
    households: n0(f.households ?? f.weight),
    approvalYear: n0(f.approvalYear),
    floorsMax: n0(f.floorsMax),
    buildingCount: n0(f.buildingCount),
    distanceM: n0(f.distanceM),
    parking: n0(f.parking),
    unitTypes: unitTypesFromUnknown(f.unitTypes),
    lng: f.lng,
    lat: f.lat,
  }));
  list.sort(
    (a, b) =>
      (b.households ?? -1) - (a.households ?? -1) ||
      (a.distanceM ?? 1e12) - (b.distanceM ?? 1e12) ||
      (a.name ?? "￿").localeCompare(b.name ?? "￿", "en") ||
      a.lng - b.lng ||
      a.lat - b.lat,
  );
  return list.map((c, i) => ({ ...c, id: `c${i + 1}`, rank: i + 1 }));
}

// ── A06: 입주(예정) 시기 버킷·정렬 ──
export type Timing = "past" | "m0_12" | "m13_24" | "later" | "unscheduled";
export const TIMING_ORDER: Timing[] = ["past", "m0_12", "m13_24", "later", "unscheduled"];
export const TIMING_STYLE: Record<Timing, { label: string; color: string }> = {
  past: { label: "이미 입주", color: "#6B7280" },
  m0_12: { label: "0–12개월", color: "#C2410C" },
  m13_24: { label: "13–24개월", color: "#F2A413" },
  later: { label: "24개월 이후", color: "#3B82A0" },
  unscheduled: { label: "미확인", color: "#C7CBD3" },
};
export const SUPPLY_SOURCE: Record<string, string> = { applyhome: "청약홈", move_in: "입주예정" };
export const SUPPLY_LAYERS = new Set(Object.keys(SUPPLY_SOURCE));

/** plannedMonth("YYYY-MM")를 분석일 기준 개월 차로 나눈다. 형식이 다르면 일정 미확인 (엔진 A06 버킷과 같은 함수) */
export function timingBucket(plannedMonth: unknown, analysisDate: string): Timing {
  const m = typeof plannedMonth === "string" ? /^(\d{4})-(\d{2})$/.exec(plannedMonth) : null;
  if (!m) return "unscheduled";
  const d = Number(m[1]) * 12 + Number(m[2]) - (Number(analysisDate.slice(0, 4)) * 12 + Number(analysisDate.slice(5, 7)));
  return d < 0 ? "past" : d <= 12 ? "m0_12" : d <= 24 ? "m13_24" : "later";
}
export const fmtMonth = (ym: string) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;

/**
 * 사업 순서: 다가오는 입주(분석월 포함 이후)를 가까운 달부터 → 이미 입주한 사업은 최근 순 → 일정 미확인.
 * 같은 달이면 세대수 많은 순 → 가까운 순 → 이름 → 좌표. 번호 = 이 순서.
 */
export function rankSupply(features: MapFeature[], analysisDate: string): Complex[] {
  const list = features
    .filter((f) => SUPPLY_LAYERS.has(f.layer))
    .map((f) => {
      const plannedMonth = typeof f.plannedMonth === "string" && /^\d{4}-\d{2}$/.test(f.plannedMonth) ? f.plannedMonth : null;
      return {
        layer: f.layer,
        name: f.name?.trim() || null,
        type: f.type ?? null,
        households: n0(f.households ?? f.weight),
        approvalYear: null,
        floorsMax: null,
        buildingCount: null,
        distanceM: n0(f.distanceM),
        parking: null,
        unitTypes: unitTypesFromUnknown(f.unitTypes),
        lng: f.lng,
        lat: f.lat,
        supply: { plannedMonth, source: f.layer, overlap: f.overlap === true, timing: timingBucket(plannedMonth, analysisDate) } satisfies SupplyInfo,
      };
    });
  const group = (c: (typeof list)[number]) => (c.supply.timing === "unscheduled" ? 2 : c.supply.timing === "past" ? 1 : 0);
  list.sort((a, b) => {
    const ga = group(a);
    const gb = group(b);
    if (ga !== gb) return ga - gb;
    const ma = a.supply.plannedMonth ?? "";
    const mb = b.supply.plannedMonth ?? "";
    return (ga === 1 ? (ma < mb ? 1 : ma > mb ? -1 : 0) : ma < mb ? -1 : ma > mb ? 1 : 0) ||
      (b.households ?? -1) - (a.households ?? -1) ||
      (a.distanceM ?? 1e12) - (b.distanceM ?? 1e12) ||
      (a.name ?? "￿").localeCompare(b.name ?? "￿", "en") ||
      a.lng - b.lng ||
      a.lat - b.lat;
  });
  return list.map((c, i) => ({ ...c, id: `c${i + 1}`, rank: i + 1 }));
}

/** A06 카드 행: 입주(예정) 시기 / 세대수 / 원천 / 직선거리. 일정이 없으면 "일정 확인필요" */
export function supplyRows(c: Complex): CardRow[] {
  const s = c.supply!;
  const unit = c.type === "오피스텔" ? "호" : "세대";
  const src = s.overlap ? "청약홈 · 입주예정" : (SUPPLY_SOURCE[s.source] ?? s.source);
  return [
    { label: "입주(예정) 시기", value: s.plannedMonth ? fmtMonth(s.plannedMonth) : "일정 확인필요", missing: s.plannedMonth === null },
    { label: "세대수", value: c.households === null ? MISSING : `${fmtInt(c.households)}${unit}`, missing: c.households === null },
    { label: "타입", value: unitTypeSummary(c.unitTypes), missing: c.unitTypes.length === 0, unitType: true },
    { label: "원천", value: src, missing: false },
    { label: "직선거리", value: c.distanceM === null ? MISSING : `${fmtInt(c.distanceM)}m`, missing: c.distanceM === null },
  ];
}

/** 개요 값 카드: 원천별로 따로 (합계 없음) */
export function supplyStats(all: Complex[]): { stats: Stat[]; note: string | null } {
  const by = (src: string) => all.filter((c) => c.supply?.source === src);
  const units = (l: Complex[]) => l.reduce((s, c) => s + (c.households ?? 0), 0);
  const overlap = all.filter((c) => c.supply?.overlap).length;
  const soon = all.filter((c) => c.supply?.timing === "m0_12").length;
  return {
    stats: [
      { value: fmtInt(all.length), unit: "곳", label: "반경 안 사업" },
      { value: fmtInt(units(by("applyhome"))), unit: "세대", label: `청약홈 (${fmtInt(by("applyhome").length)}곳)` },
      { value: fmtInt(units(by("move_in"))), unit: "세대", label: `입주예정 (${fmtInt(by("move_in").length)}곳)` },
    ],
    note: `원천 합계는 내지 않음${overlap > 0 ? ` · 중복 가능 ${overlap}곳` : ""}${soon > 0 ? ` · 12개월 내 입주 ${soon}곳` : ""}`,
  };
}
export type Stat = { value: string; unit: string; label: string };

/** 색·크기 범례. A05는 준공 연대, A06은 입주 시기 */
export type CalloutLegendItem = { label: string; color: string; hollow?: boolean };
export type CalloutLegendSpec = { title: string; items: CalloutLegendItem[]; sizeLabel: string };
export const SUPPLY_LEGEND: CalloutLegendSpec = { title: "입주 시기", items: TIMING_ORDER.map((t) => ({ label: TIMING_STYLE[t].label, color: TIMING_STYLE[t].color })), sizeLabel: "크기 = 세대수" };

// ── 점: 크기 = √세대수, 색 = 준공 연대 (D04 팔레트 공유) ──
export const DECADE_LAYERS = ["bldg_pre1980", "bldg_1980s", "bldg_1990s", "bldg_2000s", "bldg_2010s", "bldg_2020s", "bldg_unknown"] as const;
export function decadeLayer(year: number | null): (typeof DECADE_LAYERS)[number] {
  if (year === null) return "bldg_unknown";
  if (year <= 1979) return "bldg_pre1980";
  if (year < 1990) return "bldg_1980s";
  if (year < 2000) return "bldg_1990s";
  if (year < 2010) return "bldg_2000s";
  if (year < 2020) return "bldg_2010s";
  return "bldg_2020s";
}
export const decadeColor = (year: number | null) => layerStyle(decadeLayer(year)).color;
export const STOCK_LEGEND: CalloutLegendSpec = {
  title: "준공 연대",
  items: DECADE_LAYERS.map((k) => ({ label: layerStyle(k).label, color: layerStyle(k).color, hollow: k === "bldg_unknown" })),
  sizeLabel: "크기 = 세대·호실",
};
export const OTHER_HOUSING_LABEL = "기타 공동주택";
export const OTHER_HOUSING_COLOR = "#9AA0AA";
/** 점·번호 원 색: A06은 입주 시기 버킷, A05는 준공 연대 */
export const dotColor = (c: Complex) => (c.supply ? TIMING_STYLE[c.supply.timing].color : decadeColor(c.approvalYear));
/** A05 준공 연도 미상만 hollow로 그린다. A06 일정 미상은 채운 원이다. */
export const isHollowComplexMarker = (c: Pick<Complex, "approvalYear" | "supply"> | null | undefined): boolean => Boolean(c && !c.supply && c.approvalYear === null);
export const calloutLegendMatches = (c: Complex, color: string | null): boolean => color === null || dotColor(c) === color;

/** 좁은 지도에서 가장 많이 등장하는 세 가지 범주만 남기는 설명선 범례. */
export function compactCalloutLegend(spec: CalloutLegendSpec, complexes: Complex[], limit = 3): CalloutLegendItem[] {
  const counts = new Map<string, number>();
  for (const c of complexes) counts.set(dotColor(c), (counts.get(dotColor(c)) ?? 0) + 1);
  return spec.items
    .map((item, order) => ({ ...item, count: counts.get(item.color) ?? 0, order }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .slice(0, Math.max(0, limit))
    .map(({ count: _count, order: _order, ...item }) => item);
}

export function dotRadius(households: number | null, maxHouseholds: number, rMin: number, rMax: number): number {
  if (households === null || households <= 0 || maxHouseholds <= 0) return rMin;
  return rMin + (rMax - rMin) * Math.sqrt(Math.min(1, households / maxHouseholds));
}

/** 색 위 글자색: 밝은 색이면 어두운 글자 */
export function inkOn(hex: string): "#ffffff" | "#16181d" {
  const n = parseInt(hex.replace("#", ""), 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum > 0.6 ? "#16181d" : "#ffffff";
}

// ── 카드 행 ──
export type CardRow = { label: string; value: string; missing: boolean; unitType?: boolean };

function unitTypeRow(c: Complex): CardRow {
  return { label: "타입", value: unitTypeSummary(c.unitTypes), missing: c.unitTypes.length === 0, unitType: true };
}

export function cardRows(c: Complex, analysisYear: number): CardRow[] {
  if (c.supply) return supplyRows(c);
  const row = (label: string, v: string | null): CardRow => ({ label, value: v ?? MISSING, missing: v === null });
  const floors = c.floorsMax === null ? null : `최고 ${fmtInt(c.floorsMax)}층`;
  const bldg = c.buildingCount === null ? null : `${fmtInt(c.buildingCount)}동`;
  const rows = [
    // 오피스텔은 세대가 아니라 호실
    row(c.layer === "officetel" ? "호실" : "세대수", c.households === null ? null : `${fmtInt(c.households)}${c.layer === "officetel" ? "호" : "세대"}`),
    unitTypeRow(c),
    row("준공", c.approvalYear === null ? null : `${c.approvalYear}년 · ${Math.max(0, analysisYear - c.approvalYear)}년차`),
    row("직선거리", c.distanceM === null ? null : `${fmtInt(c.distanceM)}m`),
    { label: "층·동", value: floors && bldg ? `${floors} · ${bldg}` : floors ? `${floors} · 동 ${MISSING}` : bldg ? `층 ${MISSING} · ${bldg}` : MISSING, missing: !floors && !bldg },
  ];
  // 주차는 값이 있을 때만 5번째 행 (그 밖에는 4행 고정)
  if (c.parking !== null) rows.push(row("주차", `${fmtInt(c.parking)}대`));
  return rows;
}
export const cardName = (c: Complex) => c.name ?? `이름 ${MISSING}`;

/** 카드 안 단지명. 원문을 유지하고 CSS가 최대 두 줄로 자연스럽게 감싼다. */
export function displayComplexName(c: Complex, siblings: readonly Complex[] = []): string {
  const full = cardName(c);
  if (c.name === null) return full;
  const prefix = [...full].slice(0, 6).join("");
  const duplicatePrefix = siblings.filter((s) => s.name !== null && [...s.name].slice(0, 6).join("") === prefix).length > 1;
  return duplicatePrefix ? `${full} · ${c.rank}번` : full;
}

/**
 * compact 카드에서 이름이 실제로 두 줄이 될 만큼 긴지 화면 토큰으로 추정한다.
 * 브라우저에서 줄바꿈을 막지 않고, 프레임만 두 줄 이름에 맞춰 예약한다.
 */
export function compactNameNeedsExtraHeight(c: Complex, siblings: readonly Complex[], cardW: number): boolean {
  // data-narrow 카드의 헤더는 이름이 한 줄이어도 값 줄과 겹치지 않게 여유를 둔다.
  if (cardW < 112) return true;
  const label = displayComplexName(c, siblings);
  const textW = [...label].reduce((sum, ch) => sum + (ch === " " ? 4 : /[\u0000-\u007f]/.test(ch) ? 7 : 12), 0);
  const chipW = c.supply?.overlap ? 42 : 0;
  // compact .cHead: 좌우 padding 16 + 번호 18 + gap 6 + optional chip.
  return textW > cardW - 40 - chipW + 0.5;
}

// ── 모바일(≤520px): 좌우 칸 대신 지도 아래 가로 띠 카드 (지시선 없음) ──
export const MOBILE_MAX_W = 520;
export const isMobileWidth = (w: number) => w <= MOBILE_MAX_W;
/** 모바일 띠: 최대 3줄 단지명 + 2줄 값 + 여백을 수용하는 예약 높이(px). */
export const STRIP_H = 92;
export type StripCard = { id: string; rank: number; name: string; fullName: string; nameMissing: boolean; color: string; hollow: boolean; chip: string | null; lines: string[] };
/** 띠 카드 모델: 순서 = 페이지 순서(번호 순), 카드 값과 타입을 세 줄로 */
export function stripCards(items: Complex[], analysisYear: number): StripCard[] {
  return items.map((c) => {
    const v = cardRows(c, analysisYear).map((r) => r.value);
    const lines = c.supply ? [`${v[0]} · ${v[1]}`, v[2], `${v[3]} · ${v[4]}`] : [v[0], v[1], `${v[2]} · ${v[3]}`];
    return { id: c.id, rank: c.rank, name: displayComplexName(c, items), fullName: cardName(c), nameMissing: c.name === null, color: dotColor(c), hollow: isHollowComplexMarker(c), chip: overlapChip(c), lines };
  });
}
/** 띠 모양 프레임: 두 칸이 없으므로 반경 원이 가로를 거의 다 쓴다 */
export function stripFrame(W: number, H: number, m: Metrics, top: number, bottom: number): CalloutFrame {
  const edge = 8;
  const diameter = Math.max(m.rMax * 4, Math.min(W - 2 * edge - 2 * m.rMax, 0.94 * (bottom - top)));
  return { W, H, left: { x0: edge, x1: edge, top, bottom }, right: { x0: W - edge, x1: W - edge, top, bottom }, cardW: 0, cardH: 0, variant: "compact", rows: 0, perSide: 0, m, centerX: W / 2, siteX: 0.5, diameter, fill: diameter / H };
}
/** 카드 행 수: 타입 행은 항상 확보하고, A05 주차 행은 값이 있을 때만 붙인다. */
export const rowsFor = (items: Complex[]) => (items.some((c) => c.supply) ? 5 : items.some((c) => c.parking !== null) ? 6 : 5);

// ── 요약 (개요 페이지 핵심 값 카드) ──
export function summarize(all: Complex[]): { count: number; apartments: number; households: number; householdsKnown: number; medianYear: number | null } {
  // 확인 세대 합계는 아파트만 (엔진 A05 지표와 같다). 오피스텔은 호실이라 더하지 않는다
  const apts = all.filter((c) => c.layer === "apt");
  const hh = apts.map((c) => c.households).filter((v): v is number => v !== null);
  const years = all.map((c) => c.approvalYear).filter((v): v is number => v !== null).sort((a, b) => a - b);
  return { count: all.length, apartments: apts.length, households: hh.reduce((s, v) => s + v, 0), householdsKnown: hh.length, medianYear: years.length ? years[Math.floor((years.length - 1) / 2)] : null };
}

// ── 페이지 (세대수 내림차순 10단지씩, 모든 페이지 같은 지도 범위) ──
export type CalloutMode = "overview" | "top10" | "all";
export const CALLOUT_MODES: Array<{ id: CalloutMode; label: string }> = [
  { id: "overview", label: "개요만" },
  { id: "top10", label: "상위 10" },
  { id: "all", label: "전체" },
];
export const DEFAULT_CALLOUT_MODE: CalloutMode = "top10";

export const pageCount = (n: number, size = PAGE_SIZE) => Math.ceil(n / size);
export const pageItems = (all: Complex[], page: number, size = PAGE_SIZE) => all.slice((page - 1) * size, page * size);
export const pageRange = (page: number, n: number, size = PAGE_SIZE, supply = false) =>
  `${supply ? "입주 시기순" : "세대수 상위"} ${(page - 1) * size + 1}–${Math.min(n, page * size)} / 전체 ${fmtInt(n)}${supply ? "곳" : "단지"}`;
/** 카드 이름 띠의 "중복 가능" 칩 */
export const overlapChip = (c: Complex) => (c.supply?.overlap ? "중복 가능" : null);
/** 보고서에 들어가는 A05 장 수: 개요 1장 + 설명표 장. 단지가 없으면 개요(상태 판)만 */
export function calloutReportPages(mode: CalloutMode, n: number): number {
  if (n === 0 || mode === "overview") return 1;
  return mode === "top10" ? 2 : 1 + pageCount(n);
}

// ── 기하 ──
export type Pt = [number, number];
export type Metrics = { cardW: number; compactW: number; minW: number; cardFraction?: number; gap: number; stub: number; rMin: number; rMax: number; head: number; row: number; pad: number; compactH: number };
/** 화면(px) */
export const PX: Metrics = { cardW: 176, compactW: 136, minW: 96, cardFraction: 0.27, gap: 8, stub: 14, rMin: 8, rMax: 15, head: 26, row: 17, pad: 6, compactH: 56 };
/** 좁은 화면(모바일): 카드를 좁히고 점을 줄여 반경 원이 두 칸 사이에 들어가게 한다 */
export const PX_NARROW: Metrics = { ...PX, cardW: 100, compactW: 100, minW: 84, cardFraction: 0.21, gap: 6, stub: 10, rMin: 6, rMax: 11, compactH: 60 };
/** 슬라이드(inch) */
export const INCH: Metrics = { cardW: 2.55, compactW: 2.0, minW: 1.4, gap: 0.1, stub: 0.2, rMin: 0.12, rMax: 0.22, head: 0.28, row: 0.165, pad: 0.06, compactH: 0.5 };

/** compact 카드는 실제 두 줄 이름(또는 좁은 카드)일 때만 줄바꿈 여유를 예약한다. */
export const cardHeight = (m: Metrics, variant: "full" | "compact", rows: number, compactNameWrap = false) =>
  variant === "compact" ? m.compactH + (compactNameWrap ? m.row : 0) : m.head + (rows + 1) * m.row + m.pad + (compactNameWrap ? m.row * 0.25 : 0);

export const cardWidth = (m: Metrics, variant: "full" | "compact", W: number) =>
  Math.max(m.minW, Math.min(variant === "compact" ? m.compactW : m.cardW, W * (m.cardFraction ?? 0.27)));

export type Column = { x0: number; x1: number; top: number; bottom: number };
export type CalloutFrame = {
  W: number;
  H: number;
  left: Column;
  right: Column;
  cardW: number;
  cardH: number;
  variant: "full" | "compact";
  rows: number;
  perSide: number;
  m: Metrics;
  /** 지도 원 중심의 가로 위치(px)와 W에 대한 비율 */
  centerX: number;
  siteX: number;
  /** 반경 원 지름(px)과 지도 높이에 대한 비율(MapFigure fill) */
  diameter: number;
  fill: number;
};

export type FrameSpec = {
  W: number;
  H: number;
  m: Metrics;
  edge: number;
  /** 칸이 놓이는 세로 범위 (제목 칩 아래 ~ 출처 띠 위) */
  top: number;
  bottom: number;
  /** 왼쪽 칸만 더 위에서 끝나야 할 때(왼쪽 아래 값 카드) */
  leftBottom?: number;
  /** 오른쪽 정보 판이 덮는 폭: 오른쪽 칸이 그만큼 안쪽으로 이동 */
  rightInset?: number;
  perSide: number;
  rows: number;
  variant: "full" | "compact";
  /** compact 카드의 이름이 실제로 두 줄이 될 때만 추가 높이를 예약한다. */
  compactNameWrap?: boolean;
  /** 좁은 보드에서 카드 폭과 무관하게 확보할 중앙 원의 최소 지름. */
  minDiameter?: number;
  /** 반경 원 지름 / 높이의 상한 (기본 0.8) */
  maxFill?: number;
};

export function calloutFrame(s: FrameSpec): CalloutFrame {
  const { W, H, m } = s;
  const cardW = cardWidth(m, s.variant, W);
  const cardH = cardHeight(m, s.variant, s.rows, s.compactNameWrap === true);
  const rx1 = W - (s.rightInset ?? 0) - s.edge;
  const left: Column = { x0: s.edge, x1: s.edge + cardW, top: s.top, bottom: s.leftBottom ?? s.bottom };
  const right: Column = { x0: rx1 - cardW, x1: rx1, top: s.top, bottom: s.bottom };
  const pad = m.stub * 0.6;
  const lo = left.x1 + m.stub + pad;
  const hi = right.x0 - m.stub - pad;
  const diameter = Math.max(m.rMax * 4, s.minDiameter ?? 0, Math.min((s.maxFill ?? 0.8) * H, hi - lo));
  const centerX = (left.x1 + right.x0) / 2;
  return { W, H, left, right, cardW, cardH, variant: s.variant, rows: s.rows, perSide: s.perSide, m, centerX, siteX: centerX / W, diameter, fill: diameter / H };
}

/** 슬라이드(16:9, inch) 설명표 장의 프레임: 위는 제목 판 아래, 아래는 출처 띠 위. 행이 5개면 행 높이를 줄여 5장이 들어가게 한다 */
export function slideCalloutFrame(rows: number): CalloutFrame {
  const bottom = SLIDE.h - SLIDE.stripH - 0.14;
  const top = SLIDE.edge + 0.66 + 0.14;
  const avail = (bottom - top - 4 * INCH.gap) / 5;
  // 타입 요약은 짝 단위로 최대 두 줄을 쓰므로 한 행 높이를 추가로 예약한다.
  const m: Metrics = { ...INCH, row: Math.min(INCH.row, (avail - INCH.head - INCH.pad) / (rows + 1)) };
  // 원이 아래 범례 판 위에서 끝나도록 살짝 줄인다
  return calloutFrame({ W: SLIDE.w, H: SLIDE.h, m, edge: SLIDE.edge, top, bottom, perSide: 5, rows, variant: "full", maxFill: 0.76 });
}

/** 개요 장의 반경 원 크기 (왼쪽 아래 범례 판 위에서 끝난다) */
export const SLIDE_OVERVIEW_FILL = 0.72;

export type LayoutPoint = {
  id: string;
  x: number;
  y: number;
  rank?: number;
  /** Optional per-point card dimensions. Omitted points keep the fixed legacy frame contract. */
  width?: number;
  height?: number;
};
export type Placed = {
  id: string;
  side: "L" | "R";
  /** 카드 왼쪽 위 */
  x: number;
  y: number;
  width: number;
  height: number;
  dot: Pt;
  knee: Pt;
  edge: Pt;
};

export type ClusterPoint = { id: string; x: number; y: number; radius: number };
export type ClusterGroup = { id: string; center: Pt; radius: number; members: string[] };
export type ClusterResult = { positions: Map<string, Pt>; groups: ClusterGroup[] };

/** 겹치는 지도 점을 결정적으로 펼쳐 보이고, 바깥 점선 원으로 같은 클러스터임을 알린다. */
export function clusterPoints(points: ClusterPoint[], gap = 3): ClusterResult {
  const parent = points.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== i) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i];
      const b = points[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) <= a.radius + b.radius + gap) union(i, j);
    }
  }

  const groups = new Map<number, ClusterPoint[]>();
  points.forEach((point, i) => {
    const root = find(i);
    const group = groups.get(root) ?? [];
    group.push(point);
    groups.set(root, group);
  });
  const positions = new Map<string, Pt>();
  const clusters: ClusterGroup[] = [];
  for (const members of groups.values()) {
    members.sort((a, b) => a.id.localeCompare(b.id));
    if (members.length === 1) {
      positions.set(members[0].id, [members[0].x, members[0].y]);
      continue;
    }
    const center: Pt = [members.reduce((sum, point) => sum + point.x, 0) / members.length, members.reduce((sum, point) => sum + point.y, 0) / members.length];
    const maxRadius = Math.max(...members.map((point) => point.radius));
    const spread = Math.max(12, maxRadius + 7, Math.min(30, 9 + members.length * 2));
    members.forEach((point, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / members.length;
      positions.set(point.id, [center[0] + Math.cos(angle) * spread, center[1] + Math.sin(angle) * spread]);
    });
    clusters.push({ id: `cluster:${members[0].id}`, center, radius: spread + maxRadius + 4, members: members.map((point) => point.id) });
  }
  return { positions, groups: clusters };
}

export const capacityOf = (col: Column, f: Pick<CalloutFrame, "cardH" | "perSide" | "m">, cardHeights?: readonly number[]) => {
  if (!cardHeights) return Math.max(0, Math.min(f.perSide, Math.floor((col.bottom - col.top + f.m.gap) / (f.cardH + f.m.gap) + 1e-6)));
  let used = 0;
  let count = 0;
  for (const height of cardHeights) {
    const next = Math.max(0, height) + (count > 0 ? f.m.gap : 0);
    if (used + next > col.bottom - col.top + 1e-6 || count >= f.perSide) break;
    used += next;
    count += 1;
  }
  return count;
};

/** 위→아래 카드 자리(왼쪽 위 y). 바람직한 자리에서 겹치면 무리 지어 평균 위치로 옮기고(최소 간격 유지), 칸 밖은 안으로 민다 */
export function stackTops(centers: number[], cardH: number | readonly number[], gap: number, top: number, bottom: number): number[] {
  const n = centers.length;
  if (typeof cardH !== "number") {
    const heights = centers.map((_, index) => Math.max(0, cardH[index] ?? 0));
    if (n === 0) return [];
    const tops = centers.map((center, index) => center - heights[index]! / 2);
    for (let i = 1; i < n; i++) tops[i] = Math.max(tops[i]!, tops[i - 1]! + heights[i - 1]! + gap);
    const lastBottom = tops[n - 1]! + heights[n - 1]!;
    if (lastBottom > bottom) {
      const shift = lastBottom - bottom;
      for (let i = 0; i < n; i++) tops[i] -= shift;
    }
    if (tops[0]! < top) {
      const shift = top - tops[0]!;
      for (let i = 0; i < n; i++) tops[i] += shift;
    }
    return tops;
  }
  const step = cardH + gap;
  type Block = { first: number; n: number; sum: number };
  const blocks: Block[] = [];
  const topOf = (b: Block) => b.sum / b.n;
  for (let i = 0; i < n; i++) {
    blocks.push({ first: i, n: 1, sum: centers[i] - cardH / 2 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (topOf(a) + a.n * step <= topOf(b) + 1e-9) break;
      // 합치기: b의 각 멤버는 a 시작 기준으로 (a.n + k) 칸 아래에 놓인다
      blocks.splice(-2, 2, { first: a.first, n: a.n + b.n, sum: a.sum + b.sum - b.n * a.n * step });
    }
  }
  const tops: number[] = [];
  for (const b of blocks) for (let k = 0; k < b.n; k++) tops.push(topOf(b) + k * step);
  // 칸 밖으로 나간 것을 안으로 (앞에서 아래로 한 번, 뒤에서 위로 한 번)
  for (let i = 0; i < n; i++) tops[i] = Math.max(tops[i], i === 0 ? top : tops[i - 1] + step);
  for (let i = n - 1; i >= 0; i--) tops[i] = Math.min(tops[i], i === n - 1 ? bottom - cardH : tops[i + 1] - step);
  return tops;
}

const orient = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
/** 두 선분이 서로를 가로지르는가 (끝점만 닿는 경우는 제외) */
export function segCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  return d1 * d2 < -1e-9 && d3 * d4 < -1e-9;
}

export const pathOf = (p: Placed): Pt[] => [p.dot, p.knee, p.edge];

/** 같은 칸 지시선 사이의 교차 수 (테스트·자체 점검용) */
export function countCrossings(placed: Placed[]): number {
  let n = 0;
  for (const side of ["L", "R"] as const) {
    const cs = placed.filter((p) => p.side === side).map(pathOf);
    for (let i = 0; i < cs.length; i++)
      for (let j = i + 1; j < cs.length; j++)
        for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) if (segCross(cs[i][a], cs[i][a + 1], cs[j][b], cs[j][b + 1])) n += 1;
  }
  return n;
}

/**
 * 점 → 카드 배치. 두 칸에 다 못 넣는 점은 overflow로 돌려준다(호출자가 페이지 크기를 칸 용량 이하로 정한다).
 */
export function layoutCallouts(f: CalloutFrame, points: LayoutPoint[]): { placed: Placed[]; overflow: string[] } {
  const hasDimensions = points.some((point) => point.width !== undefined || point.height !== undefined);
  if (hasDimensions) return layoutVariableCallouts(f, points);
  const capL = capacityOf(f.left, f);
  const capR = capacityOf(f.right, f);
  const byY = (a: LayoutPoint, b: LayoutPoint) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1);
  const L = points.filter((p) => p.x < f.centerX).sort(byY);
  const R = points.filter((p) => p.x >= f.centerX).sort(byY);
  // 넘치면 중심선에 가장 가까운 것부터 반대쪽으로
  const spill = (from: LayoutPoint[], toArr: LayoutPoint[], cap: number, toCap: number, dist: (p: LayoutPoint) => number) => {
    while (from.length > cap && toArr.length < toCap) {
      let k = 0;
      for (let i = 1; i < from.length; i++) if (dist(from[i]) < dist(from[k])) k = i;
      toArr.push(from.splice(k, 1)[0]);
    }
  };
  const dist = (p: LayoutPoint) => Math.abs(p.x - f.centerX);
  spill(L, R, capL, capR, dist);
  spill(R, L, capR, capL, dist);
  const overflow: string[] = [];
  const fit = (arr: LayoutPoint[], cap: number) => {
    arr.sort(byY);
    // 화면 y가 아니라 순위가 낮은(숫자가 큰) 단지부터 버린다. cN이 아닌
    // 호출자는 rank를 주고, 예전 호출자의 문자열 id는 결정적인 역순으로 처리한다.
    const rankOf = (p: LayoutPoint): number | null => {
      if (typeof p.rank === "number" && Number.isFinite(p.rank)) return p.rank;
      const match = /^c(\d+)$/.exec(p.id);
      return match ? Number(match[1]) : null;
    };
    const lowerPriorityFirst = (a: LayoutPoint, b: LayoutPoint) => {
      const ar = rankOf(a), br = rankOf(b);
      if (ar !== null || br !== null) {
        if (ar === null) return 1;
        if (br === null) return -1;
        if (ar !== br) return br - ar;
      }
      return b.id.localeCompare(a.id, "en");
    };
    while (arr.length > cap) {
      let k = 0;
      for (let i = 1; i < arr.length; i++) if (lowerPriorityFirst(arr[i], arr[k]) < 0) k = i;
      const candidate = arr.splice(k, 1)[0];
      // fit에서 탈락한 점도 반대 칸에 아직 자리가 있으면 한 번 더 살린다.
      const other = arr === L ? R : L;
      const otherCap = arr === L ? capR : capL;
      if (other.length < otherCap) other.push(candidate);
      else overflow.push(candidate.id);
    }
  };
  fit(L, capL);
  fit(R, capR);

  const placed: Placed[] = [];
  const build = (arr: LayoutPoint[], col: Column, side: "L" | "R") => {
    if (arr.length === 0) return;
    const tops = stackTops(arr.map((p) => p.y), f.cardH, f.m.gap, col.top, col.bottom);
    const edgeX = side === "L" ? col.x1 : col.x0;
    const kneeX = side === "L" ? edgeX + f.m.stub : edgeX - f.m.stub;
    const slot = arr.map((_, i) => i); // arr[i]가 쓰는 자리
    const knee = (k: number): Pt => [kneeX, tops[k] + f.cardH / 2];
    for (let guard = 0, changed = true; changed && guard < 400; guard++) {
      changed = false;
      for (let i = 0; i < arr.length; i++)
        for (let j = i + 1; j < arr.length; j++)
          if (segCross([arr[i].x, arr[i].y], knee(slot[i]), [arr[j].x, arr[j].y], knee(slot[j]))) {
            [slot[i], slot[j]] = [slot[j], slot[i]];
            changed = true;
          }
    }
    arr.forEach((p, i) => {
      const k = slot[i];
      placed.push({ id: p.id, side, x: col.x0, y: tops[k], width: f.cardW, height: f.cardH, dot: [p.x, p.y], knee: knee(k), edge: [edgeX, tops[k] + f.cardH / 2] });
    });
  };
  build(L, f.left, "L");
  build(R, f.right, "R");
  return { placed, overflow };
}

type PointDimensions = { width: number; height: number };

function dimensionsOf(point: LayoutPoint, f: CalloutFrame): PointDimensions {
  return {
    width: Number.isFinite(point.width) && point.width! > 0 ? point.width! : f.cardW,
    height: Number.isFinite(point.height) && point.height! > 0 ? point.height! : f.cardH,
  };
}

function stackHeight(points: readonly LayoutPoint[], f: CalloutFrame): number {
  return points.reduce((height, point, index) => height + dimensionsOf(point, f).height + (index > 0 ? f.m.gap : 0), 0);
}

function fitsColumn(points: readonly LayoutPoint[], column: Column, f: CalloutFrame): boolean {
  return points.length <= f.perSide && stackHeight(points, f) <= column.bottom - column.top + 1e-6;
}

function rankOfPoint(point: LayoutPoint): number | null {
  if (typeof point.rank === "number" && Number.isFinite(point.rank)) return point.rank;
  const match = /^c(\d+)$/.exec(point.id);
  return match ? Number(match[1]) : null;
}

function lowerPriorityFirst(a: LayoutPoint, b: LayoutPoint): number {
  const ar = rankOfPoint(a);
  const br = rankOfPoint(b);
  if (ar !== null || br !== null) {
    if (ar === null) return 1;
    if (br === null) return -1;
    if (ar !== br) return br - ar;
  }
  return b.id.localeCompare(a.id, "en");
}

/** Same placement rules as the legacy layout, with optional real card dimensions per point. */
function layoutVariableCallouts(f: CalloutFrame, points: LayoutPoint[]): { placed: Placed[]; overflow: string[] } {
  const byY = (a: LayoutPoint, b: LayoutPoint) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1);
  const L = points.filter((point) => point.x < f.centerX).sort(byY);
  const R = points.filter((point) => point.x >= f.centerX).sort(byY);
  const overflow: string[] = [];
  const distance = (point: LayoutPoint) => Math.abs(point.x - f.centerX);

  // Keep the old center-first spill behavior where the opposite column has room.
  const moveClosestIfFits = (from: LayoutPoint[], to: LayoutPoint[], toColumn: Column): boolean => {
    let candidate = -1;
    for (let index = 0; index < from.length; index++) {
      if (candidate < 0 || distance(from[index]!) < distance(from[candidate]!)) candidate = index;
    }
    if (candidate < 0) return false;
    const next = [...to, from[candidate]!];
    if (!fitsColumn(next, toColumn, f)) return false;
    to.push(from.splice(candidate, 1)[0]!);
    return true;
  };

  const columnOf = (side: "L" | "R") => side === "L" ? f.left : f.right;
  while (!fitsColumn(L, f.left, f) || !fitsColumn(R, f.right, f)) {
    const lExcess = Math.max(0, L.length - f.perSide) + Math.max(0, stackHeight(L, f) - (f.left.bottom - f.left.top));
    const rExcess = Math.max(0, R.length - f.perSide) + Math.max(0, stackHeight(R, f) - (f.right.bottom - f.right.top));
    const side: "L" | "R" = lExcess >= rExcess ? "L" : "R";
    const from = side === "L" ? L : R;
    const to = side === "L" ? R : L;
    const toColumn = columnOf(side === "L" ? "R" : "L");
    if (moveClosestIfFits(from, to, toColumn)) continue;
    if (from.length === 0) break;
    let remove = 0;
    for (let index = 1; index < from.length; index++) if (lowerPriorityFirst(from[index]!, from[remove]!) < 0) remove = index;
    overflow.push(from.splice(remove, 1)[0]!.id);
  }

  const placed: Placed[] = [];
  const build = (arr: LayoutPoint[], column: Column, side: "L" | "R") => {
    if (arr.length === 0) return;
    const initial = [...arr].sort(byY);
    const geometry = (order: readonly LayoutPoint[]) => {
      const dimensions = order.map((point) => dimensionsOf(point, f));
      const tops = stackTops(order.map((point) => point.y), dimensions.map((dimension) => dimension.height), f.m.gap, column.top, column.bottom);
      const paths = order.map((point, index) => {
        const dimension = dimensions[index]!;
        const x = side === "L" ? column.x0 : column.x1 - dimension.width;
        const edgeX = side === "L" ? x + dimension.width : x;
        const kneeX = side === "L" ? edgeX + f.m.stub : edgeX - f.m.stub;
        const centerY = tops[index]! + dimension.height / 2;
        return { point, dimension, top: tops[index]!, edgeX, kneeX, centerY, segment: [[point.x, point.y] as Pt, [kneeX, centerY] as Pt] as const };
      });
      return { tops, paths };
    };
    const crossings = (order: readonly LayoutPoint[]) => {
      const paths = geometry(order).paths;
      let count = 0;
      for (let i = 0; i < paths.length; i++) {
        for (let j = i + 1; j < paths.length; j++) {
          if (segCross(paths[i]!.segment[0], paths[i]!.segment[1], paths[j]!.segment[0], paths[j]!.segment[1])) count += 1;
        }
      }
      return count;
    };
    // Recompute the variable-height stack after each improving exchange so a
    // card's edge, knee, and height always describe the same rendered card.
    const order = [...initial];
    for (let guard = 0; guard < order.length * order.length; guard++) {
      const currentScore = crossings(order);
      let best: { i: number; j: number; score: number } | null = null;
      for (let i = 0; i < order.length; i++) {
        for (let j = i + 1; j < order.length; j++) {
          const candidate = [...order];
          [candidate[i], candidate[j]] = [candidate[j]!, candidate[i]!];
          const score = crossings(candidate);
          if (score < (best?.score ?? currentScore)) best = { i, j, score };
        }
      }
      if (!best) break;
      [order[best.i], order[best.j]] = [order[best.j]!, order[best.i]!];
    }
    const { paths } = geometry(order);
    paths.forEach(({ point, dimension, top, edgeX, kneeX, centerY }) => {
      placed.push({
        id: point.id,
        side,
        x: side === "L" ? column.x0 : column.x1 - dimension.width,
        y: top,
        width: dimension.width,
        height: dimension.height,
        dot: [point.x, point.y],
        knee: [kneeX, centerY],
        edge: [edgeX, centerY],
      });
    });
  };
  build(L, f.left, "L");
  build(R, f.right, "R");
  return { placed, overflow };
}
