/**
 * 주변 단지 설명선(콜아웃) 배치 — 순수 함수. A05가 쓰고, A06(입주 시기·세대수·원천)도 행 정의만 바꿔 다시 쓴다.
 *
 * 규칙: 대지 기준 x가 왼쪽이면 왼쪽 칸, 오른쪽이면 오른쪽 칸(넘치면 중심에 가까운 것부터 반대쪽으로) →
 * 칸 안은 점의 세로 순서대로 위에서 아래로 쌓고(최소 간격 유지) → 지시선은 점 → 꺾임점 → 카드 안쪽 가장자리.
 * 같은 칸 지시선이 교차하면 두 카드의 자리를 맞바꿔 푼다(선 길이가 줄어드는 교환이라 반드시 끝난다).
 * 좌표 단위는 호출자가 정한다(화면 px, 슬라이드 inch). 점은 두 칸 사이의 지도 영역 안에 있어야 한다(calloutFrame이 보장).
 */
import type { MapFeature } from "../tile-result";
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
  lng: number;
  lat: number;
};

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
export type CardRow = { label: string; value: string; missing: boolean };

export function cardRows(c: Complex, analysisYear: number): CardRow[] {
  const row = (label: string, v: string | null): CardRow => ({ label, value: v ?? MISSING, missing: v === null });
  const floors = c.floorsMax === null ? null : `최고 ${fmtInt(c.floorsMax)}층`;
  const bldg = c.buildingCount === null ? null : `${fmtInt(c.buildingCount)}동`;
  const rows = [
    // 오피스텔은 세대가 아니라 호실
    row(c.layer === "officetel" ? "호실" : "세대수", c.households === null ? null : `${fmtInt(c.households)}${c.layer === "officetel" ? "호" : "세대"}`),
    row("준공", c.approvalYear === null ? null : `${c.approvalYear}년 · ${Math.max(0, analysisYear - c.approvalYear)}년차`),
    row("직선거리", c.distanceM === null ? null : `${fmtInt(c.distanceM)}m`),
    { label: "층·동", value: floors && bldg ? `${floors} · ${bldg}` : floors ? `${floors} · 동 ${MISSING}` : bldg ? `층 ${MISSING} · ${bldg}` : MISSING, missing: !floors && !bldg },
  ];
  // 주차는 값이 있을 때만 5번째 행 (그 밖에는 4행 고정)
  if (c.parking !== null) rows.push(row("주차", `${fmtInt(c.parking)}대`));
  return rows;
}
export const cardName = (c: Complex) => c.name ?? `이름 ${MISSING}`;
/** 카드 행 수: 페이지 안에 주차 값이 하나라도 있으면 5, 아니면 4 */
export const rowsFor = (items: Complex[]) => (items.some((c) => c.parking !== null) ? 5 : 4);

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
export const pageRange = (page: number, n: number, size = PAGE_SIZE) => `세대수 상위 ${(page - 1) * size + 1}–${Math.min(n, page * size)} / 전체 ${fmtInt(n)}단지`;
/** 보고서에 들어가는 A05 장 수: 개요 1장 + 설명표 장. 단지가 없으면 개요(상태 판)만 */
export function calloutReportPages(mode: CalloutMode, n: number): number {
  if (n === 0 || mode === "overview") return 1;
  return mode === "top10" ? 2 : 1 + pageCount(n);
}

// ── 기하 ──
export type Pt = [number, number];
export type Metrics = { cardW: number; compactW: number; minW: number; gap: number; stub: number; rMin: number; rMax: number; head: number; row: number; pad: number; compactH: number };
/** 화면(px) */
export const PX: Metrics = { cardW: 176, compactW: 136, minW: 96, gap: 8, stub: 14, rMin: 8, rMax: 15, head: 26, row: 17, pad: 6, compactH: 40 };
/** 슬라이드(inch) */
export const INCH: Metrics = { cardW: 2.55, compactW: 2.0, minW: 1.4, gap: 0.1, stub: 0.2, rMin: 0.12, rMax: 0.22, head: 0.28, row: 0.165, pad: 0.06, compactH: 0.5 };

export const cardHeight = (m: Metrics, variant: "full" | "compact", rows: number) => (variant === "compact" ? m.compactH : m.head + rows * m.row + m.pad);

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
  /** 반경 원 지름 / 높이의 상한 (기본 0.8) */
  maxFill?: number;
};

export function calloutFrame(s: FrameSpec): CalloutFrame {
  const { W, H, m } = s;
  const cardW = Math.max(m.minW, Math.min(s.variant === "compact" ? m.compactW : m.cardW, W * 0.27));
  const cardH = cardHeight(m, s.variant, s.rows);
  const rx1 = W - (s.rightInset ?? 0) - s.edge;
  const left: Column = { x0: s.edge, x1: s.edge + cardW, top: s.top, bottom: s.leftBottom ?? s.bottom };
  const right: Column = { x0: rx1 - cardW, x1: rx1, top: s.top, bottom: s.bottom };
  const pad = m.stub * 0.6;
  const lo = left.x1 + m.stub + pad;
  const hi = right.x0 - m.stub - pad;
  const diameter = Math.max(m.rMax * 4, Math.min((s.maxFill ?? 0.8) * H, hi - lo));
  const centerX = (left.x1 + right.x0) / 2;
  return { W, H, left, right, cardW, cardH, variant: s.variant, rows: s.rows, perSide: s.perSide, m, centerX, siteX: centerX / W, diameter, fill: diameter / H };
}

/** 슬라이드(16:9, inch) 설명표 장의 프레임: 위는 제목 판 아래, 아래는 출처 띠 위. 행이 5개면 행 높이를 줄여 5장이 들어가게 한다 */
export function slideCalloutFrame(rows: number): CalloutFrame {
  const bottom = SLIDE.h - SLIDE.stripH - 0.14;
  const top = SLIDE.edge + 0.66 + 0.14;
  const avail = (bottom - top - 4 * INCH.gap) / 5;
  const m: Metrics = { ...INCH, row: Math.min(INCH.row, (avail - INCH.head - INCH.pad) / rows) };
  // 원이 아래 범례 판 위에서 끝나도록 살짝 줄인다
  return calloutFrame({ W: SLIDE.w, H: SLIDE.h, m, edge: SLIDE.edge, top, bottom, perSide: 5, rows, variant: "full", maxFill: 0.76 });
}

/** 개요 장의 반경 원 크기 (왼쪽 아래 범례 판 위에서 끝난다) */
export const SLIDE_OVERVIEW_FILL = 0.72;

export type LayoutPoint ={ id: string; x: number; y: number };
export type Placed = {
  id: string;
  side: "L" | "R";
  /** 카드 왼쪽 위 */
  x: number;
  y: number;
  dot: Pt;
  knee: Pt;
  edge: Pt;
};

export const capacityOf = (col: Column, f: Pick<CalloutFrame, "cardH" | "perSide" | "m">) =>
  Math.max(0, Math.min(f.perSide, Math.floor((col.bottom - col.top + f.m.gap) / (f.cardH + f.m.gap) + 1e-6)));

/** 위→아래 카드 자리(왼쪽 위 y). 바람직한 자리에서 겹치면 무리 지어 평균 위치로 옮기고(최소 간격 유지), 칸 밖은 안으로 민다 */
export function stackTops(centers: number[], cardH: number, gap: number, top: number, bottom: number): number[] {
  const n = centers.length;
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
    // 남는 점은 중심에서 가장 먼 순서가 아니라 가장 아래부터 버린다 (결정적)
    while (arr.length > cap) overflow.push(arr.pop()!.id);
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
      placed.push({ id: p.id, side, x: col.x0, y: tops[k], dot: [p.x, p.y], knee: knee(k), edge: [edgeX, tops[k] + f.cardH / 2] });
    });
  };
  build(L, f.left, "L");
  build(R, f.right, "R");
  return { placed, overflow };
}
