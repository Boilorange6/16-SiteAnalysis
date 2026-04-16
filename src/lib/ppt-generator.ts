import PptxGenJS from "pptxgenjs";
import type {
  Poi,
  AnalysisConfig,
  SubwayStation,
  School,
  Apartment,
  Mountain,
  Park,
} from "./types";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "./types";

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const MAP_W = 9.333;
const PANEL_X = 9.333;
const PANEL_W = 4.0;
const TOTAL_CONTENT_SLIDES = 6;

const FONT_TITLE = "맑은 고딕";
const BG_DARK = "1A1A2E";
const BG_PANEL = "16213E";
const TEXT_WHITE = "FFFFFF";
const TEXT_LIGHT = "E0E0E0";
const ACCENT = "0F3460";

// ── Shared helpers ────────────────────────────────────────────────────────────

function addMapBackground(
  slide: PptxGenJS.Slide,
  mapImageBase64: string,
  transparency = 70
) {
  if (!mapImageBase64) return;
  slide.addImage({ data: mapImageBase64, x: 0, y: 0, w: MAP_W, h: SLIDE_H });
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: MAP_W,
    h: SLIDE_H,
    fill: { color: "000000", transparency },
  });
}

function addSlidePanel(
  slide: PptxGenJS.Slide,
  title: string,
  projectName: string,
  refDate: string
) {
  slide.addShape("rect", {
    x: PANEL_X,
    y: 0,
    w: PANEL_W,
    h: SLIDE_H,
    fill: { color: BG_PANEL, transparency: 10 },
  });
  // Header row: project name (left) + reference date (right)
  slide.addText(projectName, {
    x: PANEL_X + 0.3,
    y: 0.12,
    w: PANEL_W * 0.6,
    h: 0.28,
    fontSize: 8,
    fontFace: FONT_TITLE,
    color: "999999",
  });
  slide.addText(refDate, {
    x: PANEL_X + 0.3,
    y: 0.12,
    w: PANEL_W - 0.6,
    h: 0.28,
    fontSize: 8,
    fontFace: FONT_TITLE,
    color: "999999",
    align: "right",
  });
  // Slide title
  slide.addText(title, {
    x: PANEL_X + 0.3,
    y: 0.45,
    w: PANEL_W - 0.6,
    h: 0.6,
    fontSize: 20,
    fontFace: FONT_TITLE,
    color: TEXT_WHITE,
    bold: true,
  });
  // Accent line
  slide.addShape("rect", {
    x: PANEL_X + 0.3,
    y: 1.05,
    w: 2.0,
    h: 0.04,
    fill: { color: "E94560" },
  });
}

function addSlideFooter(slide: PptxGenJS.Slide, pageNum: number) {
  slide.addText("출처: 공개 데이터 | Site Analysis Generator", {
    x: PANEL_X + 0.3,
    y: 7.1,
    w: 2.5,
    h: 0.3,
    fontSize: 7,
    fontFace: FONT_TITLE,
    color: "555577",
  });
  slide.addText(`${pageNum} / ${TOTAL_CONTENT_SLIDES}`, {
    x: PANEL_X + 0.3,
    y: 7.1,
    w: PANEL_W - 0.6,
    h: 0.3,
    fontSize: 8,
    fontFace: FONT_TITLE,
    color: "888888",
    align: "right",
  });
}

function addLegend(
  slide: PptxGenJS.Slide,
  items: { label: string; color: string }[],
  startY: number
) {
  items.forEach((item, i) => {
    const y = startY + i * 0.35;
    slide.addShape("rect", {
      x: PANEL_X + 0.3,
      y,
      w: 0.2,
      h: 0.2,
      fill: { color: item.color.replace("#", "") },
      rectRadius: 0.03,
    });
    slide.addText(item.label, {
      x: PANEL_X + 0.6,
      y: y - 0.02,
      w: 3.0,
      h: 0.25,
      fontSize: 11,
      fontFace: FONT_TITLE,
      color: TEXT_LIGHT,
    });
  });
}

// ── Per-slide functions ───────────────────────────────────────────────────────

function addCoverSlide(
  pptx: PptxGenJS,
  config: AnalysisConfig,
  mapImageBase64: string,
  refDate: string
) {
  const slide = pptx.addSlide();
  slide.background = { fill: BG_DARK };
  if (mapImageBase64) {
    slide.addImage({ data: mapImageBase64, x: 0, y: 0, w: SLIDE_W, h: SLIDE_H });
    slide.addShape("rect", {
      x: 0,
      y: 0,
      w: SLIDE_W,
      h: SLIDE_H,
      fill: { color: "000000", transparency: 40 },
    });
  }
  slide.addText(`${config.centerName}\n사이트 분석 보고서`, {
    x: 1,
    y: 2.0,
    w: 8,
    h: 2.5,
    fontSize: 40,
    fontFace: FONT_TITLE,
    color: TEXT_WHITE,
    bold: true,
    lineSpacingMultiple: 1.4,
  });
  slide.addText(
    `분석 범위: 반경 ${config.radiusKm}km | 중심: ${config.centerLat.toFixed(4)}, ${config.centerLng.toFixed(4)}`,
    {
      x: 1,
      y: 4.5,
      w: 8,
      h: 0.5,
      fontSize: 14,
      fontFace: FONT_TITLE,
      color: TEXT_LIGHT,
    }
  );
  slide.addText(refDate, {
    x: 1,
    y: 5.2,
    w: 4,
    h: 0.4,
    fontSize: 12,
    fontFace: FONT_TITLE,
    color: "999999",
  });
}

function addOverviewSlide(
  pptx: PptxGenJS,
  allPois: readonly Poi[],
  subways: SubwayStation[],
  schools: School[],
  parks: Park[],
  mountains: Mountain[],
  apartments: Apartment[],
  mapImageBase64: string,
  projectName: string,
  refDate: string
) {
  const slide = pptx.addSlide();
  slide.background = { fill: BG_DARK };
  addMapBackground(slide, mapImageBase64);
  addSlidePanel(slide, "전체 현황도", projectName, refDate);
  slide.addText(
    `총 ${allPois.length}개 시설\n` +
      `지하철 ${subways.length}개 | 학교 ${schools.length}개\n` +
      `공원 ${parks.length}개 | 산 ${mountains.length}개\n` +
      `분양 아파트 ${apartments.length}개`,
    {
      x: PANEL_X + 0.3,
      y: 1.3,
      w: PANEL_W - 0.6,
      h: 1.8,
      fontSize: 13,
      fontFace: FONT_TITLE,
      color: TEXT_LIGHT,
      lineSpacingMultiple: 1.5,
    }
  );
  addLegend(
    slide,
    Object.entries(CATEGORY_LABELS).map(([key, label]) => ({
      label,
      color: CATEGORY_COLORS[key as keyof typeof CATEGORY_COLORS],
    })),
    3.5
  );
  addSlideFooter(slide, 1);
}

function addTransportSlide(
  pptx: PptxGenJS,
  subways: SubwayStation[],
  mapImageBase64: string,
  projectName: string,
  refDate: string
) {
  const slide = pptx.addSlide();
  slide.background = { fill: BG_DARK };
  addMapBackground(slide, mapImageBase64);
  addSlidePanel(slide, "교통 분석", projectName, refDate);

  const lineGroups = new Map<string, SubwayStation[]>();
  subways.forEach((s) => {
    lineGroups.set(s.line, [...(lineGroups.get(s.line) ?? []), s]);
  });

  let tY = 1.3;
  lineGroups.forEach((stations, line) => {
    const color = stations[0]?.lineColor ?? "#2196F3";
    slide.addShape("rect", {
      x: PANEL_X + 0.3,
      y: tY,
      w: 0.15,
      h: 0.15,
      fill: { color: color.replace("#", "") },
      rectRadius: 0.08,
    });
    slide.addText(`${line} (${stations.length}개역)`, {
      x: PANEL_X + 0.55,
      y: tY - 0.03,
      w: 3.0,
      h: 0.25,
      fontSize: 11,
      fontFace: FONT_TITLE,
      color: TEXT_WHITE,
      bold: true,
    });
    slide.addText(stations.map((s) => s.name).join(", "), {
      x: PANEL_X + 0.55,
      y: tY + 0.22,
      w: 3.2,
      h: 0.4,
      fontSize: 9,
      fontFace: FONT_TITLE,
      color: TEXT_LIGHT,
      wrap: true,
    });
    tY += 0.7;
  });

  addSlideFooter(slide, 2);
}

function addEducationSlide(
  pptx: PptxGenJS,
  schools: School[],
  mapImageBase64: string,
  projectName: string,
  refDate: string
) {
  const slide = pptx.addSlide();
  slide.background = { fill: BG_DARK };
  addMapBackground(slide, mapImageBase64);
  addSlidePanel(slide, "교육 환경", projectName, refDate);

  const levelMap = { elementary: "초등학교", middle: "중학교", high: "고등학교" } as const;
  let eY = 1.3;
  (["elementary", "middle", "high"] as const).forEach((level) => {
    const filtered = schools.filter((s) => s.level === level);
    slide.addText(`${levelMap[level]} (${filtered.length}개)`, {
      x: PANEL_X + 0.3,
      y: eY,
      w: 3.5,
      h: 0.3,
      fontSize: 12,
      fontFace: FONT_TITLE,
      color: TEXT_WHITE,
      bold: true,
    });
    slide.addText(filtered.map((s) => s.name).join(", "), {
      x: PANEL_X + 0.3,
      y: eY + 0.3,
      w: 3.5,
      h: 0.6,
      fontSize: 9,
      fontFace: FONT_TITLE,
      color: TEXT_LIGHT,
      wrap: true,
    });
    eY += 1.1;
  });

  addSlideFooter(slide, 3);
}

function addNatureSlide(
  pptx: PptxGenJS,
  mountains: Mountain[],
  parks: Park[],
  mapImageBase64: string,
  projectName: string,
  refDate: string
) {
  const slide = pptx.addSlide();
  slide.background = { fill: BG_DARK };
  addMapBackground(slide, mapImageBase64);
  addSlidePanel(slide, "자연 환경", projectName, refDate);

  let nY = 1.3;
  slide.addText(`산 (${mountains.length}개)`, {
    x: PANEL_X + 0.3,
    y: nY,
    w: 3.5,
    h: 0.3,
    fontSize: 12,
    fontFace: FONT_TITLE,
    color: TEXT_WHITE,
    bold: true,
  });
  nY += 0.35;
  mountains.forEach((m) => {
    slide.addText(`${m.name} (${m.elevation_m}m)`, {
      x: PANEL_X + 0.3,
      y: nY,
      w: 3.5,
      h: 0.25,
      fontSize: 10,
      fontFace: FONT_TITLE,
      color: TEXT_LIGHT,
    });
    nY += 0.28;
  });

  nY += 0.3;
  slide.addText(`공원 (${parks.length}개)`, {
    x: PANEL_X + 0.3,
    y: nY,
    w: 3.5,
    h: 0.3,
    fontSize: 12,
    fontFace: FONT_TITLE,
    color: TEXT_WHITE,
    bold: true,
  });
  nY += 0.35;
  parks.slice(0, 8).forEach((p) => {
    const areaTxt =
      p.area_sqm >= 100000
        ? `${(p.area_sqm / 10000).toFixed(1)}만㎡`
        : `${(p.area_sqm / 1000).toFixed(1)}천㎡`;
    slide.addText(`${p.name} (${areaTxt})`, {
      x: PANEL_X + 0.3,
      y: nY,
      w: 3.5,
      h: 0.25,
      fontSize: 9,
      fontFace: FONT_TITLE,
      color: TEXT_LIGHT,
    });
    nY += 0.25;
  });

  addSlideFooter(slide, 4);
}

function addApartmentsSlide(
  pptx: PptxGenJS,
  apartments: Apartment[],
  mapImageBase64: string,
  projectName: string,
  refDate: string
) {
  const slide = pptx.addSlide();
  slide.background = { fill: BG_DARK };
  addMapBackground(slide, mapImageBase64);
  addSlidePanel(slide, "분양 현황", projectName, refDate);

  const tableRows: PptxGenJS.TableRow[] = [
    [
      { text: "단지명", options: { bold: true, fontSize: 9, color: TEXT_WHITE, fill: { color: ACCENT } } },
      { text: "세대수", options: { bold: true, fontSize: 9, color: TEXT_WHITE, fill: { color: ACCENT } } },
      { text: "평당가(만)", options: { bold: true, fontSize: 9, color: TEXT_WHITE, fill: { color: ACCENT } } },
      { text: "분양일", options: { bold: true, fontSize: 9, color: TEXT_WHITE, fill: { color: ACCENT } } },
    ],
    ...apartments.map((a) => [
      { text: a.name, options: { fontSize: 8, color: TEXT_LIGHT } },
      { text: `${a.units.toLocaleString()}`, options: { fontSize: 8, color: TEXT_LIGHT, align: "right" as const } },
      { text: `${a.price_per_pyeong.toLocaleString()}`, options: { fontSize: 8, color: TEXT_LIGHT, align: "right" as const } },
      { text: a.sale_date, options: { fontSize: 8, color: TEXT_LIGHT } },
    ]),
  ];
  slide.addTable(tableRows, {
    x: PANEL_X + 0.15,
    y: 1.3,
    w: PANEL_W - 0.3,
    fontFace: FONT_TITLE,
    border: { type: "solid", pt: 0.5, color: "333366" },
    rowH: 0.3,
  });

  addSlideFooter(slide, 5);
}

function addSummarySlide(
  pptx: PptxGenJS,
  config: AnalysisConfig,
  subways: SubwayStation[],
  schools: School[],
  mountains: Mountain[],
  parks: Park[],
  apartments: Apartment[],
  mapImageBase64: string,
  projectName: string,
  refDate: string
) {
  const slide = pptx.addSlide();
  slide.background = { fill: BG_DARK };
  addMapBackground(slide, mapImageBase64);
  addSlidePanel(slide, "종합 분석", projectName, refDate);

  const lineCount = new Set(subways.map((s) => s.line)).size;
  const totalUnits = apartments.reduce((sum, a) => sum + a.units, 0);
  const avgPrice =
    apartments.length > 0
      ? Math.round(apartments.reduce((sum, a) => sum + a.price_per_pyeong, 0) / apartments.length)
      : 0;
  const elemCount = schools.filter((s) => s.level === "elementary").length;
  const middleCount = schools.filter((s) => s.level === "middle").length;
  const highCount = schools.filter((s) => s.level === "high").length;

  const summaryItems = [
    `분석 중심: ${config.centerName}`,
    `분석 범위: 반경 ${config.radiusKm}km`,
    `지하철역: ${subways.length}개 (${lineCount}개 노선)`,
    `교육시설: ${schools.length}개 (초 ${elemCount} / 중 ${middleCount} / 고 ${highCount})`,
    `자연환경: 산 ${mountains.length}개, 공원 ${parks.length}개`,
    `분양단지: ${apartments.length}개 (총 ${totalUnits.toLocaleString()}세대)`,
    `평균 분양가: ${avgPrice.toLocaleString()}만원/평`,
  ];

  summaryItems.forEach((text, i) => {
    slide.addText(text, {
      x: PANEL_X + 0.3,
      y: 1.3 + i * 0.4,
      w: PANEL_W - 0.6,
      h: 0.35,
      fontSize: 11,
      fontFace: FONT_TITLE,
      color: TEXT_LIGHT,
    });
  });

  slide.addText("* 본 보고서는 자동 생성되었습니다", {
    x: PANEL_X + 0.3,
    y: 6.5,
    w: PANEL_W - 0.6,
    h: 0.3,
    fontSize: 8,
    fontFace: FONT_TITLE,
    color: "666666",
  });

  addSlideFooter(slide, 6);
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateSiteAnalysisPpt(
  config: AnalysisConfig,
  allPois: readonly Poi[],
  mapImageBase64: string
): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Site Analysis Generator";
  pptx.title = `${config.centerName} 사이트 분석`;

  const subways = allPois.filter((p): p is SubwayStation => p.category === "subway");
  const schools = allPois.filter((p): p is School => p.category === "school");
  const parks = allPois.filter((p): p is Park => p.category === "park");
  const mountains = allPois.filter((p): p is Mountain => p.category === "mountain");
  const apartments = allPois.filter((p): p is Apartment => p.category === "apartment");

  const refDate = new Date().toLocaleDateString("ko-KR");
  const projectName = `${config.centerName} 사이트 분석`;

  addCoverSlide(pptx, config, mapImageBase64, refDate);
  addOverviewSlide(pptx, allPois, subways, schools, parks, mountains, apartments, mapImageBase64, projectName, refDate);
  addTransportSlide(pptx, subways, mapImageBase64, projectName, refDate);
  addEducationSlide(pptx, schools, mapImageBase64, projectName, refDate);
  addNatureSlide(pptx, mountains, parks, mapImageBase64, projectName, refDate);
  addApartmentsSlide(pptx, apartments, mapImageBase64, projectName, refDate);
  addSummarySlide(pptx, config, subways, schools, mountains, parks, apartments, mapImageBase64, projectName, refDate);

  await pptx.writeFile({ fileName: `${config.centerName}_사이트분석.pptx` });
}
