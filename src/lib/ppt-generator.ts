import PptxGenJS from "pptxgenjs";
import type {
  Poi,
  AnalysisConfig,
  SubwayStation,
  School,
  Apartment,
  Mountain,
  Park,
  CATEGORY_COLORS as CategoryColorsType,
} from "./types";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "./types";

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const MAP_W = 9.333;
const PANEL_X = 9.333;
const PANEL_W = 4.0;

const FONT_TITLE = "맑은 고딕";
const BG_DARK = "1A1A2E";
const BG_PANEL = "16213E";
const TEXT_WHITE = "FFFFFF";
const TEXT_LIGHT = "E0E0E0";
const ACCENT = "0F3460";

function addDarkOverlay(slide: PptxGenJS.Slide) {
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: SLIDE_H,
    fill: { color: "000000", transparency: 40 },
  });
}

function addPanel(slide: PptxGenJS.Slide) {
  slide.addShape("rect", {
    x: PANEL_X,
    y: 0,
    w: PANEL_W,
    h: SLIDE_H,
    fill: { color: BG_PANEL, transparency: 10 },
  });
}

function addSlideTitle(slide: PptxGenJS.Slide, title: string) {
  slide.addText(title, {
    x: PANEL_X + 0.3,
    y: 0.3,
    w: PANEL_W - 0.6,
    h: 0.6,
    fontSize: 20,
    fontFace: FONT_TITLE,
    color: TEXT_WHITE,
    bold: true,
  });
  slide.addShape("rect", {
    x: PANEL_X + 0.3,
    y: 0.9,
    w: 2.0,
    h: 0.04,
    fill: { color: "E94560" },
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

  // Slide 1: Cover
  const coverSlide = pptx.addSlide();
  coverSlide.background = { fill: BG_DARK };
  if (mapImageBase64) {
    coverSlide.addImage({
      data: mapImageBase64,
      x: 0,
      y: 0,
      w: SLIDE_W,
      h: SLIDE_H,
    });
    addDarkOverlay(coverSlide);
  }
  coverSlide.addText(`${config.centerName}\n사이트 분석 보고서`, {
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
  coverSlide.addText(
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
  coverSlide.addText(new Date().toLocaleDateString("ko-KR"), {
    x: 1,
    y: 5.2,
    w: 4,
    h: 0.4,
    fontSize: 12,
    fontFace: FONT_TITLE,
    color: "999999",
  });

  // Slide 2: Overview
  const overviewSlide = pptx.addSlide();
  overviewSlide.background = { fill: BG_DARK };
  if (mapImageBase64) {
    overviewSlide.addImage({
      data: mapImageBase64,
      x: 0,
      y: 0,
      w: MAP_W,
      h: SLIDE_H,
    });
    overviewSlide.addShape("rect", {
      x: 0,
      y: 0,
      w: MAP_W,
      h: SLIDE_H,
      fill: { color: "000000", transparency: 70 },
    });
  }
  addPanel(overviewSlide);
  addSlideTitle(overviewSlide, "전체 현황도");
  overviewSlide.addText(
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
    overviewSlide,
    Object.entries(CATEGORY_LABELS).map(([key, label]) => ({
      label,
      color: CATEGORY_COLORS[key as keyof typeof CATEGORY_COLORS],
    })),
    3.5
  );

  // Slide 3: Transportation
  const transportSlide = pptx.addSlide();
  transportSlide.background = { fill: BG_DARK };
  if (mapImageBase64) {
    transportSlide.addImage({ data: mapImageBase64, x: 0, y: 0, w: MAP_W, h: SLIDE_H });
    transportSlide.addShape("rect", { x: 0, y: 0, w: MAP_W, h: SLIDE_H, fill: { color: "000000", transparency: 70 } });
  }
  addPanel(transportSlide);
  addSlideTitle(transportSlide, "교통 분석");

  const lineGroups = new Map<string, SubwayStation[]>();
  subways.forEach((s) => {
    const existing = lineGroups.get(s.line) ?? [];
    lineGroups.set(s.line, [...existing, s]);
  });
  let tY = 1.3;
  lineGroups.forEach((stations, line) => {
    const color = stations[0]?.lineColor ?? "#2196F3";
    transportSlide.addShape("rect", {
      x: PANEL_X + 0.3,
      y: tY,
      w: 0.15,
      h: 0.15,
      fill: { color: color.replace("#", "") },
      rectRadius: 0.08,
    });
    transportSlide.addText(`${line} (${stations.length}개역)`, {
      x: PANEL_X + 0.55,
      y: tY - 0.03,
      w: 3.0,
      h: 0.25,
      fontSize: 11,
      fontFace: FONT_TITLE,
      color: TEXT_WHITE,
      bold: true,
    });
    const stationNames = stations.map((s) => s.name).join(", ");
    transportSlide.addText(stationNames, {
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

  // Slide 4: Education
  const eduSlide = pptx.addSlide();
  eduSlide.background = { fill: BG_DARK };
  if (mapImageBase64) {
    eduSlide.addImage({ data: mapImageBase64, x: 0, y: 0, w: MAP_W, h: SLIDE_H });
    eduSlide.addShape("rect", { x: 0, y: 0, w: MAP_W, h: SLIDE_H, fill: { color: "000000", transparency: 70 } });
  }
  addPanel(eduSlide);
  addSlideTitle(eduSlide, "교육 환경");

  const levelMap = { elementary: "초등학교", middle: "중학교", high: "고등학교" } as const;
  let eY = 1.3;
  (["elementary", "middle", "high"] as const).forEach((level) => {
    const filtered = schools.filter((s) => s.level === level);
    eduSlide.addText(`${levelMap[level]} (${filtered.length}개)`, {
      x: PANEL_X + 0.3,
      y: eY,
      w: 3.5,
      h: 0.3,
      fontSize: 12,
      fontFace: FONT_TITLE,
      color: TEXT_WHITE,
      bold: true,
    });
    eduSlide.addText(filtered.map((s) => s.name).join(", "), {
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

  // Slide 5: Nature
  const natureSlide = pptx.addSlide();
  natureSlide.background = { fill: BG_DARK };
  if (mapImageBase64) {
    natureSlide.addImage({ data: mapImageBase64, x: 0, y: 0, w: MAP_W, h: SLIDE_H });
    natureSlide.addShape("rect", { x: 0, y: 0, w: MAP_W, h: SLIDE_H, fill: { color: "000000", transparency: 70 } });
  }
  addPanel(natureSlide);
  addSlideTitle(natureSlide, "자연 환경");

  let nY = 1.3;
  natureSlide.addText(`산 (${mountains.length}개)`, {
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
    natureSlide.addText(`${m.name} (${m.elevation_m}m)`, {
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
  natureSlide.addText(`공원 (${parks.length}개)`, {
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
    const areaTxt = p.area_sqm >= 100000 ? `${(p.area_sqm / 10000).toFixed(1)}만㎡` : `${(p.area_sqm / 1000).toFixed(1)}천㎡`;
    natureSlide.addText(`${p.name} (${areaTxt})`, {
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

  // Slide 6: Apartments
  const aptSlide = pptx.addSlide();
  aptSlide.background = { fill: BG_DARK };
  if (mapImageBase64) {
    aptSlide.addImage({ data: mapImageBase64, x: 0, y: 0, w: MAP_W, h: SLIDE_H });
    aptSlide.addShape("rect", { x: 0, y: 0, w: MAP_W, h: SLIDE_H, fill: { color: "000000", transparency: 70 } });
  }
  addPanel(aptSlide);
  addSlideTitle(aptSlide, "분양 현황");

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
  aptSlide.addTable(tableRows, {
    x: PANEL_X + 0.15,
    y: 1.3,
    w: PANEL_W - 0.3,
    fontFace: FONT_TITLE,
    border: { type: "solid", pt: 0.5, color: "333366" },
    rowH: 0.3,
  });

  // Slide 7: Summary
  const summarySlide = pptx.addSlide();
  summarySlide.background = { fill: BG_DARK };
  if (mapImageBase64) {
    summarySlide.addImage({ data: mapImageBase64, x: 0, y: 0, w: MAP_W, h: SLIDE_H });
    summarySlide.addShape("rect", { x: 0, y: 0, w: MAP_W, h: SLIDE_H, fill: { color: "000000", transparency: 70 } });
  }
  addPanel(summarySlide);
  addSlideTitle(summarySlide, "종합 분석");

  const totalUnits = apartments.reduce((sum, a) => sum + a.units, 0);
  const avgPrice = apartments.length > 0
    ? Math.round(apartments.reduce((sum, a) => sum + a.price_per_pyeong, 0) / apartments.length)
    : 0;

  const summaryItems = [
    `분석 중심: ${config.centerName}`,
    `분석 범위: 반경 ${config.radiusKm}km`,
    `지하철역: ${subways.length}개 (${lineGroups.size}개 노선)`,
    `교육시설: ${schools.length}개 (초 ${schools.filter((s) => s.level === "elementary").length} / 중 ${schools.filter((s) => s.level === "middle").length} / 고 ${schools.filter((s) => s.level === "high").length})`,
    `자연환경: 산 ${mountains.length}개, 공원 ${parks.length}개`,
    `분양단지: ${apartments.length}개 (총 ${totalUnits.toLocaleString()}세대)`,
    `평균 분양가: ${avgPrice.toLocaleString()}만원/평`,
  ];

  summaryItems.forEach((text, i) => {
    summarySlide.addText(text, {
      x: PANEL_X + 0.3,
      y: 1.3 + i * 0.4,
      w: PANEL_W - 0.6,
      h: 0.35,
      fontSize: 11,
      fontFace: FONT_TITLE,
      color: TEXT_LIGHT,
    });
  });

  summarySlide.addText("* 본 보고서는 자동 생성되었습니다", {
    x: PANEL_X + 0.3,
    y: 6.5,
    w: PANEL_W - 0.6,
    h: 0.3,
    fontSize: 8,
    fontFace: FONT_TITLE,
    color: "666666",
  });

  await pptx.writeFile({ fileName: `${config.centerName}_사이트분석.pptx` });
}
