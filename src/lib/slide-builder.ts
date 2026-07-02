// 슬라이드 디자인의 단일 소스. 모든 레이아웃·색·크기 결정은 이 파일 안에서만 한다.
import type {
  AnalysisConfig, Poi, PoiCategory, PoiPosition, RadiusPosition,
  RouteNormalizedPosition, SubwayStation,
} from "./types";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "./types";
import type { SlideElement } from "./slide-spec";

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
