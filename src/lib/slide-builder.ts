// 슬라이드 디자인의 단일 소스. 모든 레이아웃·색·크기 결정은 이 파일 안에서만 한다.
import type {
  AnalysisConfig, Apartment, Poi, PoiCategory, PoiPosition, RadiusPosition,
  RouteNormalizedPosition, School as SchoolPoi, SubwayStation,
} from "./types";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "./types";
import type { SlideElement, SlideSpec } from "./slide-spec";

export interface SlideBuildInput {
  readonly config: AnalysisConfig;
  readonly pois: readonly Poi[];
  readonly baseMapImage: string; // ""이면 캡처 실패 → 플레이스홀더
  readonly poiPositions: readonly PoiPosition[];
  readonly radiusPosition: RadiusPosition | null;
  readonly routePositions: readonly RouteNormalizedPosition[];
}

export const TOKENS = {
  font: "Noto Sans KR",
  navy: "#1E3A8A",
  blue: "#3B82F6",
  ink: "#0F172A",
  body: "#334155",
  sub: "#64748B",
  light: "#F8FAFC",
  line: "#E2E8F0",
  white: "#FFFFFF",
  radius: "#0EA5E9",
} as const;

// ── 공통 크롬 ────────────────────────────────────────────────────────────────

export function buildHeader(indexLabel: string, title: string, config: AnalysisConfig): SlideElement[] {
  const refDate = new Date().toLocaleDateString("ko-KR");
  return [
    // 타이틀 카드
    { kind: "rect", x: 0.03, y: 0.05, w: 0.4, h: 0.16, fill: { color: TOKENS.white, alpha: 0.92 }, radiusIn: 0.06, shadow: true },
    // 좌측 액센트 바
    { kind: "rect", x: 0.03, y: 0.05, w: 0.006, h: 0.16, fill: { color: TOKENS.blue } },
    { kind: "text", x: 0.048, y: 0.062, w: 0.36, h: 0.035, text: `SITE ANALYSIS · ${indexLabel}`, fontSizePt: 10, color: TOKENS.blue, bold: true, charSpacingPt: 2 },
    { kind: "text", x: 0.048, y: 0.098, w: 0.36, h: 0.065, text: title, fontSizePt: 24, color: TOKENS.navy, bold: true },
    { kind: "text", x: 0.048, y: 0.168, w: 0.36, h: 0.03, text: `${refDate} · 기준반경 ${config.radiusKm}km · ${config.centerName}`, fontSizePt: 9, color: TOKENS.sub },
  ];
}

export function buildKpiChips(chips: readonly { value: string; label: string }[]): SlideElement[] {
  const els: SlideElement[] = [];
  const chipW = 0.115;
  const chipH = 0.075;
  const gap = 0.012;
  chips.forEach((chip, i) => {
    const x = 0.03 + i * (chipW + gap);
    const y = 0.225;
    els.push(
      { kind: "rect", x, y, w: chipW, h: chipH, fill: { color: TOKENS.white, alpha: 0.88 }, radiusIn: 0.05, shadow: true },
      { kind: "text", x: x + 0.008, y: y + 0.006, w: chipW - 0.016, h: 0.04, text: chip.value, fontSizePt: 13, color: TOKENS.navy, bold: true },
      { kind: "text", x: x + 0.008, y: y + 0.044, w: chipW - 0.016, h: 0.026, text: chip.label, fontSizePt: 8, color: TOKENS.sub },
    );
  });
  return els;
}

export function buildFooter(pageNum: number, total: number): SlideElement[] {
  const page = `${String(pageNum).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  return [
    { kind: "rect", x: 0, y: 0.955, w: 1, h: 0.045, fill: { color: TOKENS.ink, alpha: 0.55 } },
    { kind: "text", x: 0.03, y: 0.958, w: 0.5, h: 0.038, text: "지도 데이터: OpenStreetMap/ESRI · 시설 데이터: 공공데이터포털", fontSizePt: 8, color: "#CBD5E1", valign: "middle" },
    { kind: "text", x: 0.9, y: 0.958, w: 0.07, h: 0.038, text: page, fontSizePt: 9, color: "#CBD5E1", align: "right", valign: "middle" },
  ];
}

export function buildLegend(categories: readonly PoiCategory[]): SlideElement[] {
  const rowH = 0.036;
  const w = 0.135;
  const h = categories.length * rowH + 0.028;
  const x = 1 - w - 0.03;
  const y = 1 - h - 0.065;
  const els: SlideElement[] = [
    { kind: "rect", x, y, w, h, fill: { color: TOKENS.white, alpha: 0.92 }, radiusIn: 0.05, shadow: true },
  ];
  categories.forEach((cat, i) => {
    const rowY = y + 0.016 + i * rowH;
    els.push(
      { kind: "ellipse", cx: x + 0.014, cy: rowY + rowH / 2 - 0.004, rx: 0.0045, ry: 0.008, fill: { color: CATEGORY_COLORS[cat] }, stroke: { color: TOKENS.white, widthPt: 1 } },
      { kind: "text", x: x + 0.026, y: rowY - 0.004, w: w - 0.032, h: rowH, text: CATEGORY_LABELS[cat], fontSizePt: 9, color: TOKENS.body, valign: "middle" },
    );
  });
  return els;
}

const MARKER_R = 0.0085; // 정규화(가로 기준) 반지름

export function buildMapLayer(
  input: SlideBuildInput,
  opts: {
    categories: readonly PoiCategory[];
    showLabels: boolean;
    markerSize?: number;
    showRoutes?: boolean;
  }
): SlideElement[] {
  const els: SlideElement[] = [];

  if (input.baseMapImage) {
    els.push({ kind: "image", x: 0, y: 0, w: 1, h: 1, dataUrl: input.baseMapImage });
  } else {
    els.push(
      { kind: "rect", x: 0, y: 0, w: 1, h: 1, fill: { color: "#DBEAFE" } },
      { kind: "text", x: 0.25, y: 0.45, w: 0.5, h: 0.1, text: "지도 이미지를 불러오지 못했습니다", fontSizePt: 14, color: TOKENS.sub, align: "center", valign: "middle" },
    );
  }

  if (input.radiusPosition) {
    const { centerNx, centerNy, radiusNx, radiusNy } = input.radiusPosition;
    els.push(
      { kind: "ellipse", cx: centerNx, cy: centerNy, rx: radiusNx, ry: radiusNy, fill: { color: TOKENS.radius, alpha: 0.12 }, stroke: { color: TOKENS.radius, widthPt: 2, dash: "dash" } },
      { kind: "ellipse", cx: centerNx, cy: centerNy, rx: 0.0075, ry: 0.0133, fill: { color: TOKENS.blue }, stroke: { color: TOKENS.white, widthPt: 2 }, shadow: true },
    );
  }

  if (opts.showRoutes) {
    input.routePositions.forEach((route) => {
      for (let i = 0; i < route.points.length - 1; i++) {
        const from = route.points[i];
        const to = route.points[i + 1];
        els.push({ kind: "line", x1: from.nx, y1: from.ny, x2: to.nx, y2: to.ny, stroke: { color: route.lineColor, widthPt: 3 } });
      }
    });
  }

  const r = opts.markerSize ?? MARKER_R;
  input.poiPositions
    .filter((p) => opts.categories.includes(p.poi.category))
    .forEach(({ poi, nx, ny }) => {
      const color = poi.category === "subway" ? (poi as SubwayStation).lineColor : CATEGORY_COLORS[poi.category];
      els.push({
        kind: "ellipse", cx: nx, cy: ny, rx: r, ry: r * (16 / 9),
        fill: { color }, stroke: { color: TOKENS.white, widthPt: 1.5 }, shadow: true,
      });
      if (opts.showLabels) {
        const labelW = Math.max(0.05, poi.name.length * 0.0095 + 0.012);
        els.push({
          kind: "text", x: nx + r + 0.004, y: ny - 0.017, w: labelW, h: 0.034,
          text: poi.name, fontSizePt: 8, color: TOKENS.navy, bold: true, align: "center", valign: "middle",
          fill: { color: TOKENS.white, alpha: 0.85 }, radiusIn: 0.03,
        });
      }
    });

  return els;
}

// ── 슬라이드별 빌더 ──────────────────────────────────────────────────────────

const TOTAL = 7;

function buildPanelCard(x: number, y: number, w: number, h: number, title: string): SlideElement[] {
  return [
    { kind: "rect", x, y, w, h, fill: { color: TOKENS.white, alpha: 0.92 }, radiusIn: 0.06, shadow: true },
    { kind: "rect", x, y, w: 0.005, h, fill: { color: TOKENS.navy } },
    { kind: "text", x: x + 0.016, y: y + 0.018, w: w - 0.03, h: 0.04, text: title, fontSizePt: 12, color: TOKENS.navy, bold: true, charSpacingPt: 1 },
    { kind: "line", x1: x + 0.016, y1: y + 0.062, x2: x + w - 0.016, y2: y + 0.062, stroke: { color: TOKENS.line, widthPt: 1 } },
  ];
}

function buildListPanel(x: number, y: number, w: number, title: string, items: readonly string[]): SlideElement[] {
  const rowH = 0.042;
  const h = 0.08 + Math.max(items.length, 1) * rowH + 0.02;
  const els = buildPanelCard(x, y, w, h, title);
  if (items.length === 0) {
    els.push({ kind: "text", x: x + 0.016, y: y + 0.08, w: w - 0.03, h: rowH, text: "반경 내 해당 시설 없음", fontSizePt: 11, color: TOKENS.sub, valign: "middle" });
    return els;
  }
  items.forEach((text, i) => {
    els.push({ kind: "text", x: x + 0.016, y: y + 0.08 + i * rowH, w: w - 0.03, h: rowH, text: `·  ${text}`, fontSizePt: 11, color: TOKENS.body, valign: "middle" });
  });
  return els;
}

function withWarning(input: SlideBuildInput, spec: SlideSpec): SlideSpec {
  return input.baseMapImage ? spec : { ...spec, warning: "지도 캡처 실패 — 플레이스홀더 배경으로 표시됩니다" };
}

function coverSlide(input: SlideBuildInput): SlideSpec {
  const { config, pois } = input;
  const counts = {
    subway: pois.filter((p) => p.category === "subway").length,
    school: pois.filter((p) => p.category === "school").length,
    nature: pois.filter((p) => p.category === "park" || p.category === "mountain").length,
    apartment: pois.filter((p) => p.category === "apartment").length,
  };
  const refDate = new Date().toLocaleDateString("ko-KR");
  const elements: SlideElement[] = [
    ...buildMapLayer(input, { categories: [], showLabels: false }),
    { kind: "rect", x: 0, y: 0, w: 1, h: 1, fill: { color: TOKENS.ink, alpha: 0.55 } },
    { kind: "text", x: 0.08, y: 0.3, w: 0.6, h: 0.045, text: "SITE ANALYSIS REPORT", fontSizePt: 13, color: TOKENS.blue, bold: true, charSpacingPt: 4 },
    { kind: "text", x: 0.08, y: 0.36, w: 0.84, h: 0.13, text: config.centerName, fontSizePt: 44, color: TOKENS.white, bold: true },
    { kind: "rect", x: 0.082, y: 0.51, w: 0.09, h: 0.007, fill: { color: TOKENS.blue } },
    { kind: "text", x: 0.08, y: 0.545, w: 0.6, h: 0.06, text: "사이트 입지 분석 보고서", fontSizePt: 20, color: "#E2E8F0" },
    { kind: "text", x: 0.08, y: 0.64, w: 0.84, h: 0.04, text: `지하철 ${counts.subway}개소 · 학교 ${counts.school}개교 · 공원/산 ${counts.nature}개소 · 분양 ${counts.apartment}단지`, fontSizePt: 13, color: "#CBD5E1" },
    { kind: "text", x: 0.08, y: 0.69, w: 0.84, h: 0.035, text: `${refDate} · 반경 ${config.radiusKm}km 분석`, fontSizePt: 11, color: "#94A3B8" },
  ];
  return withWarning(input, { id: "cover", title: "표지", elements });
}

function overviewSlide(input: SlideBuildInput): SlideSpec {
  const cats: PoiCategory[] = ["subway", "school", "park", "mountain", "apartment"];
  const chips = [
    { value: `${input.pois.filter((p) => p.category === "subway").length}개소`, label: "지하철역" },
    { value: `${input.pois.filter((p) => p.category === "school").length}개교`, label: "학교" },
    { value: `${input.pois.filter((p) => p.category === "apartment").length}단지`, label: "분양" },
  ];
  return withWarning(input, {
    id: "overview",
    title: "입지 현황 종합",
    elements: [
      ...buildMapLayer(input, { categories: cats, showLabels: false, markerSize: 0.006, showRoutes: true }),
      ...buildHeader("02", "입지 현황 종합", input.config),
      ...buildKpiChips(chips),
      ...buildLegend(cats),
      ...buildFooter(2, TOTAL),
    ],
  });
}

function subwaySlide(input: SlideBuildInput): SlideSpec {
  const subways = input.pois.filter((p): p is SubwayStation => p.category === "subway");
  const lines = [...new Set(subways.map((s) => s.line))];
  return withWarning(input, {
    id: "subway",
    title: "교통 분석",
    elements: [
      ...buildMapLayer(input, { categories: ["subway"], showLabels: true, showRoutes: true }),
      ...buildHeader("03", "교통 분석", input.config),
      ...buildKpiChips([
        { value: `${subways.length}개소`, label: "지하철역" },
        { value: `${lines.length}개`, label: "지나는 노선" },
      ]),
      ...buildListPanel(0.03, 0.33, 0.27, "반경 내 지하철역", subways.slice(0, 8).map((s) => `${s.name} (${s.line})`)),
      ...buildFooter(3, TOTAL),
    ],
  });
}

function schoolSlide(input: SlideBuildInput): SlideSpec {
  const schools = input.pois.filter((p): p is SchoolPoi => p.category === "school");
  const levelLabel = { elementary: "초", middle: "중", high: "고" } as const;
  const byLevel = (lv: SchoolPoi["level"]) => schools.filter((s) => s.level === lv).length;
  return withWarning(input, {
    id: "school",
    title: "교육 환경",
    elements: [
      ...buildMapLayer(input, { categories: ["school"], showLabels: true }),
      ...buildHeader("04", "교육 환경", input.config),
      ...buildKpiChips([
        { value: `${schools.length}개교`, label: "학교 합계" },
        { value: `${byLevel("elementary")}·${byLevel("middle")}·${byLevel("high")}`, label: "초·중·고" },
      ]),
      ...buildListPanel(0.03, 0.33, 0.27, "반경 내 학교", schools.slice(0, 8).map((s) => `${s.name} (${levelLabel[s.level]})`)),
      ...buildFooter(4, TOTAL),
    ],
  });
}

function natureSlide(input: SlideBuildInput): SlideSpec {
  const nature = input.pois.filter((p) => p.category === "park" || p.category === "mountain");
  return withWarning(input, {
    id: "nature",
    title: "자연 환경",
    elements: [
      ...buildMapLayer(input, { categories: ["park", "mountain"], showLabels: true }),
      ...buildHeader("05", "자연 환경", input.config),
      ...buildKpiChips([{ value: `${nature.length}개소`, label: "공원·산" }]),
      ...buildListPanel(0.03, 0.33, 0.27, "반경 내 공원·산", nature.slice(0, 8).map((p) => p.name)),
      ...buildFooter(5, TOTAL),
    ],
  });
}

function apartmentSlide(input: SlideBuildInput): SlideSpec {
  const apartments = input.pois.filter((p): p is Apartment => p.category === "apartment");
  const top = [...apartments].sort((a, b) => b.units - a.units).slice(0, 8);
  const chartTop = [...apartments].sort((a, b) => b.price_per_pyeong - a.price_per_pyeong).slice(0, 5);
  const avgPrice = apartments.length ? Math.round(apartments.reduce((s, a) => s + a.price_per_pyeong, 0) / apartments.length) : 0;

  const elements: SlideElement[] = [
    ...buildMapLayer(input, { categories: ["apartment"], showLabels: true }),
    ...buildHeader("06", "주변 분양 현황", input.config),
    ...buildKpiChips([
      { value: `${apartments.length}단지`, label: "분양 단지" },
      { value: `${avgPrice.toLocaleString()}`, label: "평균 평당가(만원)" },
    ]),
    ...buildFooter(6, TOTAL),
  ];

  if (apartments.length === 0) {
    elements.push(...buildListPanel(0.03, 0.33, 0.42, "분양 단지", []));
  } else {
    // 표 카드
    elements.push(...buildPanelCard(0.03, 0.33, 0.42, 0.36, "분양 단지 목록"));
    elements.push({
      kind: "table", x: 0.046, y: 0.41, w: 0.39,
      columns: [
        { label: "단지명", wFrac: 0.4 },
        { label: "세대수", wFrac: 0.18, align: "right" },
        { label: "평당가", wFrac: 0.2, align: "right" },
        { label: "분양일", wFrac: 0.22 },
      ],
      rows: top.map((a) => [a.name, a.units.toLocaleString(), a.price_per_pyeong.toLocaleString(), a.sale_date]),
      fontSizePt: 9, rowHIn: 0.26, headerFill: TOKENS.navy, headerColor: TOKENS.white, zebraFill: "#F1F5F9",
    });
    // 차트 카드
    elements.push(...buildPanelCard(0.03, 0.71, 0.42, 0.23, "평당가 비교 (상위 5)"));
    elements.push({
      kind: "chart", x: 0.046, y: 0.775, w: 0.39, h: 0.15,
      title: "평당가(만원/평)",
      categories: chartTop.map((a) => a.name),
      values: chartTop.map((a) => a.price_per_pyeong),
      color: TOKENS.blue,
    });
  }

  return withWarning(input, { id: "apartment", title: "주변 분양 현황", elements });
}

function summarySlide(input: SlideBuildInput): SlideSpec {
  const { pois } = input;
  const subways = pois.filter((p) => p.category === "subway").length;
  const schools = pois.filter((p) => p.category === "school").length;
  const apartments = pois.filter((p): p is Apartment => p.category === "apartment");
  const avgPrice = apartments.length ? Math.round(apartments.reduce((s, a) => s + a.price_per_pyeong, 0) / apartments.length) : 0;

  const points = [
    ["교통 환경", `반경 내 지하철역 ${subways}개소 위치`],
    ["교육 여건", `초·중·고 총 ${schools}개교 인접`],
    ["공급 현황", `인근 ${apartments.length}개 단지 분양 진행 중`],
    ["가격 수준", `평균 분양가 ${avgPrice.toLocaleString()}만원/평 형성`],
    ["종합 평가", "대상지는 우수한 생활 인프라를 갖춘 입지로 판단됨"],
  ] as const;

  const cardX = 0.03, cardY = 0.31, cardW = 0.46;
  const rowH = 0.095;
  const cardH = 0.09 + points.length * rowH;
  const elements: SlideElement[] = [
    ...buildMapLayer(input, { categories: [], showLabels: false }),
    ...buildHeader("07", "종합 분석 및 시사점", input.config),
    ...buildPanelCard(cardX, cardY, cardW, cardH, "핵심 요약"),
    ...buildFooter(7, TOTAL),
  ];
  points.forEach(([label, text], i) => {
    const y = cardY + 0.085 + i * rowH;
    const isLast = i === points.length - 1;
    elements.push(
      { kind: "rect", x: cardX + 0.016, y: y + 0.008, w: 0.075, h: 0.05, fill: { color: isLast ? TOKENS.navy : "#EFF6FF" }, radiusIn: 0.04 },
      { kind: "text", x: cardX + 0.016, y: y + 0.008, w: 0.075, h: 0.05, text: label, fontSizePt: 9, color: isLast ? TOKENS.white : TOKENS.navy, bold: true, align: "center", valign: "middle" },
      { kind: "text", x: cardX + 0.102, y: y, w: cardW - 0.12, h: 0.066, text, fontSizePt: 13, color: TOKENS.body, bold: isLast, valign: "middle" },
    );
  });
  return withWarning(input, { id: "summary", title: "종합 분석 및 시사점", elements });
}

export function buildSlides(input: SlideBuildInput): SlideSpec[] {
  return [
    coverSlide(input),
    overviewSlide(input),
    subwaySlide(input),
    schoolSlide(input),
    natureSlide(input),
    apartmentSlide(input),
    summarySlide(input),
  ];
}
