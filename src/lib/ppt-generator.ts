import PptxGenJS from "pptxgenjs";
import type {
  Poi,
  PoiPosition,
  RadiusPosition,
  AnalysisConfig,
  PoiCategory,
  SubwayStation,
  School,
  Apartment,
  Mountain,
  Park,
} from "./types";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "./types";

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

// Design Tokens from Spec
const FONT_MAIN = "Noto Sans KR";
const COLOR_PRIMARY = "1E3A8A"; // Primary Navy
const COLOR_SECONDARY = "3B82F6"; // Secondary Navy
const COLOR_OVERLAY_DARK = "0F172A";
const COLOR_OVERLAY_LIGHT = "F8FAFC";
const COLOR_TEXT_BODY = "334155";
const COLOR_TEXT_SUB = "475569";

const MARKER_SIZE = 0.22;
const MARKER_SIZE_SM = 0.16;

// ── Shared helpers ────────────────────────────────────────────────────────────

function addFullBleedMap(slide: PptxGenJS.Slide, baseMapImage: string) {
  if (!baseMapImage) return;
  slide.addImage({
    data: baseMapImage,
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: SLIDE_H,
  });
}

function addHeader(slide: PptxGenJS.Slide, title: string, config: AnalysisConfig) {
  // Semi-transparent Header Overlay
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: 1.1,
    fill: { color: COLOR_OVERLAY_LIGHT, transparency: 15 },
  });
  
  slide.addText("SITE ANALYSIS REPORT", {
    x: 0.5,
    y: 0.2,
    w: 4,
    h: 0.3,
    fontSize: 10,
    fontFace: FONT_MAIN,
    color: COLOR_SECONDARY,
    bold: true,
  });

  slide.addText(title, {
    x: 0.5,
    y: 0.45,
    w: 8,
    h: 0.5,
    fontSize: 28,
    fontFace: FONT_MAIN,
    color: COLOR_PRIMARY,
    bold: true,
  });

  const refDate = new Date().toLocaleDateString("ko-KR");
  slide.addText(`${refDate} | 기준반경: ${config.radiusKm}km`, {
    x: SLIDE_W - 4.5,
    y: 0.45,
    w: 4,
    h: 0.5,
    fontSize: 12,
    fontFace: FONT_MAIN,
    color: COLOR_TEXT_SUB,
    align: "right",
  });

  // Bottom border line
  slide.addShape("rect", {
    x: 0.5,
    y: 1.0,
    w: SLIDE_W - 1.0,
    h: 0.03,
    fill: { color: COLOR_PRIMARY },
  });
}

function addFooter(slide: PptxGenJS.Slide, pageNum: number, total: number) {
  slide.addText(`지도 데이터: Mapbox/ESRI | 시설 데이터: 공공데이터포털`, {
    x: 0.5,
    y: 7.1,
    w: 6,
    h: 0.3,
    fontSize: 8,
    fontFace: FONT_MAIN,
    color: "666666",
  });
  slide.addText(`${pageNum} / ${total}`, {
    x: SLIDE_W - 1.5,
    y: 7.1,
    w: 1,
    h: 0.3,
    fontSize: 10,
    fontFace: FONT_MAIN,
    color: "666666",
    align: "right",
  });
}

function addDataPanel(slide: PptxGenJS.Slide, x: number, y: number, w: number, h: number) {
  slide.addShape("rect", {
    x, y, w, h,
    fill: { color: COLOR_OVERLAY_LIGHT, transparency: 10 },
    line: { color: COLOR_PRIMARY, width: 1 },
    shadow: { type: "outer", blur: 10, offset: 4, color: "000000", opacity: 0.2 },
    rectRadius: 0.1,
  });
}

function addLegend(slide: PptxGenJS.Slide) {
  const items = Object.entries(CATEGORY_LABELS).map(([key, label]) => ({
    label,
    color: CATEGORY_COLORS[key as keyof typeof CATEGORY_COLORS],
  }));

  const legW = 1.8;
  const legH = items.length * 0.3 + 0.2;
  const legX = SLIDE_W - legW - 0.5;
  const legY = SLIDE_H - legH - 0.6;

  slide.addShape("rect", {
    x: legX,
    y: legY,
    w: legW,
    h: legH,
    fill: { color: COLOR_OVERLAY_LIGHT, transparency: 10 },
    rectRadius: 0.05,
  });

  items.forEach((item, i) => {
    const y = legY + 0.1 + i * 0.3;
    slide.addShape("ellipse", {
      x: legX + 0.15,
      y: y + 0.05,
      w: 0.15,
      h: 0.15,
      fill: { color: item.color.replace("#", "") },
      line: { color: "FFFFFF", width: 1 },
    });
    slide.addText(item.label, {
      x: legX + 0.4,
      y: y,
      w: 1.2,
      h: 0.25,
      fontSize: 9,
      fontFace: FONT_MAIN,
      color: COLOR_TEXT_BODY,
    });
  });
}

function addPoiMarkers(
  slide: PptxGenJS.Slide,
  positions: readonly PoiPosition[],
  categories: readonly PoiCategory[],
  options: { showLabels?: boolean; size?: number } = {}
) {
  const { showLabels = true, size = MARKER_SIZE } = options;
  const filtered = positions.filter((p) => categories.includes(p.poi.category));

  filtered.forEach(({ poi, nx, ny }) => {
    const x = nx * SLIDE_W;
    const y = ny * SLIDE_H;

    const color =
      poi.category === "subway"
        ? (poi as SubwayStation).lineColor.replace("#", "")
        : CATEGORY_COLORS[poi.category].replace("#", "");

    slide.addShape("ellipse", {
      x: x - size / 2,
      y: y - size / 2,
      w: size,
      h: size,
      fill: { color },
      line: { color: "FFFFFF", width: 1.5 },
      shadow: { type: "outer", blur: 4, offset: 2, color: "000000", opacity: 0.4 },
    });

    if (showLabels) {
      const labelW = Math.max(0.6, poi.name.length * 0.1 + 0.2);
      slide.addText(poi.name, {
        x: x + size / 2 + 0.05,
        y: y - 0.12,
        w: labelW,
        h: 0.24,
        fontSize: 8,
        fontFace: FONT_MAIN,
        color: COLOR_PRIMARY,
        bold: true,
        fill: { color: "FFFFFF", transparency: 20 },
        rectRadius: 0.04,
        align: "center",
        valign: "middle",
      });
    }
  });
}

function addRadiusCircle(slide: PptxGenJS.Slide, radiusPosition: RadiusPosition | null) {
  if (!radiusPosition) return;
  const cx = radiusPosition.centerNx * SLIDE_W;
  const cy = radiusPosition.centerNy * SLIDE_H;
  const rx = radiusPosition.radiusNx * SLIDE_W;
  const ry = radiusPosition.radiusNy * SLIDE_H;

  slide.addShape("ellipse", {
    x: cx - rx,
    y: cy - ry,
    w: rx * 2,
    h: ry * 2,
    fill: { color: "0EA5E9", transparency: 85 },
    line: { color: "0EA5E9", width: 2, dashType: "dash" },
  });

  slide.addShape("ellipse", {
    x: cx - 0.1,
    y: cy - 0.1,
    w: 0.2,
    h: 0.2,
    fill: { color: COLOR_SECONDARY },
    line: { color: "FFFFFF", width: 2 },
  });
}

export interface RouteNormalizedPosition {
  readonly line: string;
  readonly lineColor: string;
  readonly points: readonly { readonly nx: number; readonly ny: number }[];
}

function addSubwayRouteLines(
  slide: PptxGenJS.Slide,
  routePositions: readonly RouteNormalizedPosition[]
) {
  routePositions.forEach((route) => {
    const color = route.lineColor.replace("#", "");

    for (let i = 0; i < route.points.length - 1; i++) {
      const from = route.points[i];
      const to = route.points[i + 1];
      const x1 = from.nx * SLIDE_W;
      const y1 = from.ny * SLIDE_H;
      const x2 = to.nx * SLIDE_W;
      const y2 = to.ny * SLIDE_H;

      const x = Math.min(x1, x2);
      const y = Math.min(y1, y2);
      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);
      const goesRight = x2 >= x1;
      const goesDown = y2 >= y1;

      slide.addShape("line", {
        x,
        y,
        w: Math.max(w, 0.005),
        h: Math.max(h, 0.005),
        line: { color, width: 3 },
        flipV: goesRight !== goesDown,
      });
    }
  });
}

// ── Slides ──────────────────────────────────────────────────────────────────

function addCoverSlide(pptx: PptxGenJS, config: AnalysisConfig, baseMapImage: string) {
  const slide = pptx.addSlide();
  if (baseMapImage) {
    slide.addImage({ data: baseMapImage, x: 0, y: 0, w: SLIDE_W, h: SLIDE_H });
    slide.addShape("rect", {
      x: 0, y: 0, w: SLIDE_W, h: SLIDE_H,
      fill: { color: COLOR_PRIMARY, transparency: 40 },
    });
  } else {
    slide.background = { fill: COLOR_PRIMARY };
  }

  slide.addText(config.centerName, {
    x: 1, y: 2.5, w: 11, h: 1,
    fontSize: 48, fontFace: FONT_MAIN, color: "FFFFFF", bold: true, align: "center",
  });
  slide.addText("사이트 입지 분석 보고서", {
    x: 1, y: 3.5, w: 11, h: 0.6,
    fontSize: 24, fontFace: FONT_MAIN, color: "FFFFFF", align: "center",
  });
  
  slide.addShape("rect", { x: 5, y: 4.3, w: 3.333, h: 0.05, fill: { color: COLOR_SECONDARY } });

  const refDate = new Date().toLocaleDateString("ko-KR");
  slide.addText(`${refDate} | 반경 ${config.radiusKm}km 분석`, {
    x: 1, y: 4.8, w: 11, h: 0.4,
    fontSize: 14, fontFace: FONT_MAIN, color: "E0E0E0", align: "center",
  });
}

function addOverviewSlide(
  pptx: PptxGenJS,
  config: AnalysisConfig,
  baseMapImage: string,
  poiPositions: readonly PoiPosition[],
  radiusPosition: RadiusPosition | null,
  routePositions: readonly RouteNormalizedPosition[]
) {
  const slide = pptx.addSlide();
  addFullBleedMap(slide, baseMapImage);
  addRadiusCircle(slide, radiusPosition);
  addSubwayRouteLines(slide, routePositions);
  addPoiMarkers(slide, poiPositions, ["subway", "school", "park", "mountain", "apartment"], { showLabels: false, size: MARKER_SIZE_SM });
  addHeader(slide, "입지 현황 종합", config);
  addLegend(slide);
  addFooter(slide, 1, 6);
}

function addCategorySlide(
  pptx: PptxGenJS,
  title: string,
  category: PoiCategory | PoiCategory[],
  config: AnalysisConfig,
  baseMapImage: string,
  poiPositions: readonly PoiPosition[],
  radiusPosition: RadiusPosition | null,
  pageNum: number,
  details: string[],
  routePositions: readonly RouteNormalizedPosition[] = []
) {
  const slide = pptx.addSlide();
  addFullBleedMap(slide, baseMapImage);
  addRadiusCircle(slide, radiusPosition);
  const cats = Array.isArray(category) ? category : [category];
  if (cats.includes("subway")) {
    addSubwayRouteLines(slide, routePositions);
  }
  addPoiMarkers(slide, poiPositions, cats);
  addHeader(slide, title, config);

  const panelW = 3.5;
  const panelH = Math.min(4.5, details.length * 0.4 + 0.6);
  addDataPanel(slide, 0.5, 1.5, panelW, panelH);
  
  details.forEach((text, i) => {
    slide.addText(`• ${text}`, {
      x: 0.7, y: 1.8 + i * 0.4, w: panelW - 0.4, h: 0.35,
      fontSize: 11, fontFace: FONT_MAIN, color: COLOR_TEXT_BODY,
    });
  });

  addFooter(slide, pageNum, 6);
}

function addApartmentSlide(
  pptx: PptxGenJS,
  apartments: Apartment[],
  config: AnalysisConfig,
  baseMapImage: string,
  poiPositions: readonly PoiPosition[],
  radiusPosition: RadiusPosition | null
) {
  const slide = pptx.addSlide();
  addFullBleedMap(slide, baseMapImage);
  addRadiusCircle(slide, radiusPosition);
  addPoiMarkers(slide, poiPositions, ["apartment"]);
  addHeader(slide, "주변 분양 현황", config);

  const tableW = 5.5;
  addDataPanel(slide, 0.5, 1.5, tableW, Math.min(5, apartments.length * 0.35 + 0.8));

  const rows: PptxGenJS.TableRow[] = [
    [
      { text: "단지명", options: { bold: true, color: "FFFFFF", fill: { color: COLOR_PRIMARY } } },
      { text: "세대수", options: { bold: true, color: "FFFFFF", fill: { color: COLOR_PRIMARY }, align: "right" } },
      { text: "평당가", options: { bold: true, color: "FFFFFF", fill: { color: COLOR_PRIMARY }, align: "right" } },
      { text: "분양일", options: { bold: true, color: "FFFFFF", fill: { color: COLOR_PRIMARY } } },
    ],
    ...apartments.slice(0, 10).map(a => [
      { text: a.name },
      { text: a.units.toLocaleString(), options: { align: "right" as const } },
      { text: a.price_per_pyeong.toLocaleString(), options: { align: "right" as const } },
      { text: a.sale_date },
    ])
  ];

  slide.addTable(rows, {
    x: 0.7, y: 1.8, w: tableW - 0.4,
    fontSize: 9, fontFace: FONT_MAIN,
    border: { type: "solid", pt: 0.5, color: "E2E8F0" },
    rowH: 0.3,
  });

  addFooter(slide, 5, 6);
}

function addSummarySlide(
  pptx: PptxGenJS,
  config: AnalysisConfig,
  pois: readonly Poi[],
  baseMapImage: string,
  radiusPosition: RadiusPosition | null
) {
  const slide = pptx.addSlide();
  addFullBleedMap(slide, baseMapImage);
  addRadiusCircle(slide, radiusPosition);
  addHeader(slide, "종합 분석 및 시사점", config);

  const panelW = 6;
  addDataPanel(slide, 0.5, 1.5, panelW, 5);

  const subways = pois.filter((p): p is SubwayStation => p.category === "subway");
  const schools = pois.filter((p): p is School => p.category === "school");
  const apartments = pois.filter((p): p is Apartment => p.category === "apartment");
  const avgPrice = apartments.length ? Math.round(apartments.reduce((s, a) => s + a.price_per_pyeong, 0) / apartments.length) : 0;

  const points = [
    `교통 환경: 반경 내 지하철역 ${subways.length}개소 위치`,
    `교육 여건: 초/중/고 총 ${schools.length}개교 인접`,
    `공급 현황: 인근 ${apartments.length}개 단지 분양 진행 중`,
    `가격 수준: 평균 분양가 ${avgPrice.toLocaleString()}만원/평 형성`,
    `종합 평가: 대상지는 우수한 생활 인프라를 갖춘 입지로 판단됨`,
  ];

  points.forEach((text, i) => {
    slide.addText(text, {
      x: 0.8, y: 2.0 + i * 0.6, w: panelW - 0.6, h: 0.5,
      fontSize: 14, fontFace: FONT_MAIN, color: COLOR_TEXT_BODY,
      bold: i === points.length - 1,
    });
  });

  addFooter(slide, 6, 6);
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function generateSiteAnalysisPpt(
  config: AnalysisConfig,
  allPois: readonly Poi[],
  baseMapImage: string,
  poiPositions: readonly PoiPosition[],
  radiusPosition: RadiusPosition | null = null,
  routePositions: readonly RouteNormalizedPosition[] = []
): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = `${config.centerName} 입지 분석`;

  addCoverSlide(pptx, config, baseMapImage);
  addOverviewSlide(pptx, config, baseMapImage, poiPositions, radiusPosition, routePositions);

  const subways = allPois.filter((p): p is SubwayStation => p.category === "subway");
  addCategorySlide(pptx, "교통 분석", "subway", config, baseMapImage, poiPositions, radiusPosition, 2,
    subways.slice(0, 8).map(s => `${s.name} (${s.line})`), routePositions);

  const schools = allPois.filter((p): p is School => p.category === "school");
  addCategorySlide(pptx, "교육 환경", "school", config, baseMapImage, poiPositions, radiusPosition, 3,
    schools.slice(0, 8).map(s => `${s.name} (${s.level === 'elementary' ? '초' : s.level === 'middle' ? '중' : '고'})`));

  addCategorySlide(pptx, "자연 환경", ["park", "mountain"], config, baseMapImage, poiPositions, radiusPosition, 4,
    allPois.filter(p => p.category === "park" || p.category === "mountain").slice(0, 8).map(p => p.name));

  const apartments = allPois.filter((p): p is Apartment => p.category === "apartment");
  addApartmentSlide(pptx, apartments, config, baseMapImage, poiPositions, radiusPosition);

  addSummarySlide(pptx, config, allPois, baseMapImage, radiusPosition);

  await pptx.writeFile({ fileName: `${config.centerName}_사이트분석.pptx` });
}
