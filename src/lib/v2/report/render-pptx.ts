/**
 * 슬라이드 계획 → .pptx (pptxgenjs, 16:9). 브라우저·Node 공용.
 * 지도 몰입형: 슬라이드 전체가 지도 이미지, 그 위에 반투명 흰 판(편집 가능한 도형·글자)을 얹는다.
 * 판의 자리·여백은 화면 카드/펼침과 같은 문법(ui/overlay-layout)을 쓴다.
 */
import PptxGenJS from "pptxgenjs";
import { groupTaggedShapes } from "../../pptx-shape-group";
import { calloutPageTitleTail } from "../ui/callout-layout";
import { legendItemsOf, STRIP_COLORS } from "../ui/map-layers";
import { SLIDE, SLIDE_LEGEND, layoutRects, slideGeometry, slideLayout, slideLegend, slideLegendGeometry, slidePanelRects, slidePanelScale, slideSize, terrainSectionLayout, type Rect, type SlideFormat, type SlideLegendOptions } from "../ui/overlay-layout";
import type { Badge, TileView } from "../ui/tile-view";
import type { RoseModel } from "../ui/wind-rose";
import { sheetCells, type SheetGrid } from "../ui/sheet";
import { reportSummaryNotes } from "../ui/terrain-section";
import { COVER_MAP_KEY, mapKeyOf, type PlannedSlide } from "./report-plan";
import { E, FONT, INK, L, LINE, MUTED, coverLayout, fitBlock, fitFooterText, fitPt, fontSizeForStyle, hex, linesOf, plate, sourceLayout, textIn, titlePlateRect, type Border, type ReportItem, type Slide } from "./pptx-kit";
import { tileReportModuleFor } from "../tile/report";
import { addEditableMap, nativeMapFallbackNote, nativeMapStatus } from "./map-pptx";
import { exportBasemap } from "../ui/basemap";
import type { BasemapChoice } from "../ui/map-projection";
import type { BaseThemeId } from "../ui/map-theme";
import { badgeTextColor } from "../ui/map-labels";
import type { PageStyle } from "../ui/board-state";
import { drawTerrainSectionPptx } from "./terrain-section-pptx";
import { pageElementDeleted, TEXT_BOX_DEFAULTS, type MapFrameState, type ReportLayout } from "./report-doc";

/** 지도 이미지(PNG/JPEG data URL) — 키는 report-plan의 mapKeyOf */
export type MapImages = Record<string, string>;
export type PptxMapDrawing = "editable" | "image";

const underline = (pt: number): [Border, Border, Border, Border] => [{ type: "none" }, { type: "none" }, { type: "solid", pt, color: LINE }, { type: "none" }];

const CHIP: Record<Badge["tone"], { fill: string; color: string }> = {
  status: { fill: "FCE9C7", color: "7A4B00" },
  limit: { fill: "F0E8DC", color: "5B4A2F" },
  model: { fill: "E6E1F7", color: "3D2E8C" },
};

const panelTag = (key: string, display: string, part: string): string => `GRP|panel-${key}|${display}|${part}`;
const legendDashType = (dash?: string): "solid" | "dash" | "sysDot" => dash === "1 3" ? "sysDot" : dash ? "dash" : "solid";

function titleTextFit(title: string, kind: string, box: { w: number; h: number }, style: PageStyle): { titlePt: number; metaPt: number } {
  const titleMaxPt = fontSizeForStyle(style, "title");
  const metaMaxPt = 10 * (titleMaxPt / 18);
  let titlePt = fitBlock([title], box, titleMaxPt, 7);
  let metaPt = fitBlock([kind], box, metaMaxPt, 7);
  const widthAt = (value: string, pt: number) => textIn(value, pt);
  const textWidth = () => widthAt(title, titlePt) + widthAt(`  ${kind}`, metaPt);
  // fitBlock은 각 run을 따로 측정하므로, 한 텍스트 상자 안의 두 run 합도
  // 확인해 좁은 사용자 패널에서 실제 run 폭이 밖으로 밀리지 않게 한다.
  while (textWidth() > box.w + 1e-9 && (titlePt > 7 || metaPt > 7)) {
    if (titlePt >= metaPt && titlePt > 7) titlePt = Math.max(7, titlePt - 0.5);
    else if (metaPt > 7) metaPt = Math.max(7, metaPt - 0.5);
    else break;
  }
  return { titlePt, metaPt };
}

function background(s: Slide, image: string | undefined, tint?: string, format: SlideFormat = "wide") {
  const size = slideSize(format);
  const edge = slideGeometry(format).edge;
  if (image) s.addImage({ data: image, x: 0, y: 0, w: size.w, h: size.h });
  else {
    s.addShape("rect", { x: 0, y: 0, w: size.w, h: size.h, fill: { color: tint ?? "F2F2EF" }, line: { color: tint ?? "F2F2EF", width: 0 } });
    if (!tint) s.addText("지도 이미지를 만들지 못했습니다", { x: edge, y: size.h / 2 - 0.2, w: 5, h: 0.4, fontFace: FONT, fontSize: 11, color: MUTED, margin: 0 });
  }
}

/** 지도 바탕 결정에 쓰는 내보내기 설정: 보드가 고른 바탕(`basemap`)과 벡터 바탕 테마. 그림 만들기(buildMapImages)와 같은 값을 받는다. */
export type PptxMapLook = { basemap?: BasemapChoice; baseTheme?: BaseThemeId };

/** 맨 아래 출처 띠 + 쪽 번호. 출처·기준일은 모든 장에 있다. layers는 그 쪽 지도에 실제로 그려진 바탕(출처 표기를 정한다). */
function strip(s: Slide, p: PlannedSlide, credit: boolean, format: SlideFormat = "wide", layers: readonly BasemapChoice[] = []) {
  const size = slideSize(format);
  const g = slideGeometry(format);
  const defaultStrip = format === "wide" ? L.strip : slideLayout(format).strip;
  const sourcePanel = p.style?.panels?.source;
  const r = sourcePanel
    ? { x: sourcePanel.x * size.w, y: sourcePanel.y * size.h, w: sourcePanel.w * size.w, h: sourcePanel.h * size.h }
    : defaultStrip;
  // 출처 띠는 지도 래스터와 네이티브 도형을 모두 가리는 최상단의 불투명 안전영역이다.
  s.addShape("rect", { x: r.x, y: r.y, w: r.w, h: r.h, fill: { color: "FFFFFF", transparency: 0 }, line: { color: "FFFFFF", width: 0, transparency: 100 } });
  s.addShape("line", { x: r.x, y: r.y, w: r.w, h: 0, line: { color: INK, width: 0.5, transparency: 92 } });
  const pageNumberWidth = Math.min(1.2, Math.max(0.55, r.w * 0.28));
  const textX = r.x;
  const room = Math.max(0.2, r.w - pageNumberWidth - 0.08);
  const showCredit = !pageElementDeleted(p.page, "source");
  const footer = fitFooterText(p.footer, showCredit, room, fontSizeForStyle(p.style ?? {}, "source"), layers);
  if (showCredit) s.addText(footer.text, { x: textX, y: r.y, w: room, h: r.h, valign: "middle", fontFace: FONT, fontSize: footer.fontSize, color: "454A55", margin: 0, fit: "shrink" });
  s.addText(`${p.no} / ${p.total}`, { x: r.x + r.w - pageNumberWidth, y: r.y, w: pageNumberWidth, h: r.h, align: "right", valign: "middle", fontFace: FONT, fontSize: 9, color: "454A55", margin: 0 });
}

function formatOf(p: PlannedSlide): SlideFormat {
  return p.format ?? "wide";
}

function layoutOf(p: PlannedSlide): ReportLayout {
  return p.page?.layout ?? (p.style?.summary === false ? "map-full" : "map-summary");
}

function pageStyleFor(p: PlannedSlide, format: SlideFormat): PageStyle {
  const page = p.page;
  const pageLayout = p.page?.layout;
  if (!pageLayout || !page) return p.style ?? {};
  const rects = layoutRects(pageLayout, format);
  const panels = {
    ...(pageLayout === "map-summary" || pageLayout === "map-full" ? {} : {
      title: rects.title,
      ...(rects.summary ? { summary: rects.summary } : {}),
      ...(rects.legend ? { legend: rects.legend } : {}),
    }),
    ...(page.panels ?? {}),
  };
  return {
    ...(p.style ?? {}),
    ...(Object.keys(panels).length > 0 ? { panels } : {}),
    ...(pageLayout === "side-by-side" ? { summary: false } : pageLayout === "numbers-first" ? { summary: true } : {}),
    ...(pageElementDeleted(page, "summary") ? { summary: false } : {}),
  };
}

function frameOf(p: PlannedSlide): MapFrameState | undefined {
  return p.page?.kind === "tile" ? p.page.frame : undefined;
}

function frameLegendOptions(frame: MapFrameState | undefined): SlideLegendOptions {
  if (!frame) return {};
  return frame.legend;
}

function frameForLayout(p: PlannedSlide, format: SlideFormat): { x: number; y: number; w: number; h: number } | undefined {
  if (p.kind !== "tile") return undefined;
  const pageLayout = layoutOf(p);
  if (pageLayout === "map-full" || pageLayout === "map-summary") return undefined;
  const rect = layoutRects(pageLayout, format).map;
  if (!rect) return undefined;
  const size = slideSize(format);
  return { x: rect.x * size.w, y: rect.y * size.h, w: rect.w * size.w, h: rect.h * size.h };
}

function pageTextBoxes(s: Slide, p: PlannedSlide, format: SlideFormat): void {
  if (!p.page?.textBoxes.length) return;
  const size = slideSize(format);
  for (const box of p.page.textBoxes) {
    if (!box.text.trim()) continue;
    const defaults = TEXT_BOX_DEFAULTS[box.kind ?? "body"];
    s.addText(box.text, {
      x: box.x * size.w,
      y: box.y * size.h,
      w: box.w * size.w,
      h: box.h * size.h,
      fontFace: FONT,
      fontSize: box.pt,
      color: hex(box.color ?? defaults.color ?? INK),
      bold: box.bold ?? defaults.bold ?? false,
      italic: box.italic ?? defaults.italic ?? false,
      align: box.align ?? defaults.align ?? "left",
      margin: 0,
      fit: "shrink",
      objectName: `GRP|textBox-${box.id}|글상자|text`,
    });
  }
}

function pageNotes(s: Slide, p: PlannedSlide, extra: readonly string[] = []): void {
  const notes = [p.notes?.trim(), ...extra.map((note) => note.trim())].filter((note): note is string => !!note);
  if (notes.length > 0) s.addNotes(notes.join("\n"));
}

/** 왼쪽 위 제목 판: 타일 색 점 + 타일명 + 종류 */
function titlePlate(s: Slide, color: string, title: string, kind: string, maxW: number, style: PageStyle = {}, hasSummary = true, format: SlideFormat = "wide") {
  const r = titlePlateRect(title, kind, maxW, style, hasSummary, format);
  const textX = r.x + Math.min(0.48, Math.max(0.04, r.w * 0.35));
  const textRight = r.x + r.w - Math.min(0.1, Math.max(0.01, r.w * 0.08));
  const textBox = { w: Math.max(0.01, textRight - textX), h: Math.max(0.01, r.h - Math.min(0.08, r.h * 0.2)) };
  const { titlePt, metaPt } = titleTextFit(title, kind, textBox, style);
  const group = panelTag("title", "제목", "plate");
  plate(s, r, 0.12, group);
  const dotSize = Math.min(0.18, Math.max(0.02, r.w * 0.16));
  const dotX = r.x + Math.min(0.2, Math.max(0.01, r.w - dotSize - 0.01));
  s.addShape("ellipse", { x: dotX, y: r.y + Math.max(0, r.h / 2 - dotSize / 2), w: dotSize, h: dotSize, fill: { color: hex(color) }, line: { color: hex(color) }, objectName: panelTag("title", "제목", "mark") });
  s.addText(
    [
      { text: title, options: { fontSize: titlePt, color: INK, bold: true } },
      ...(kind ? [{ text: `  ${kind}`, options: { fontSize: metaPt, color: MUTED, bold: true } }] : []),
    ],
    { x: textX, y: r.y, w: textBox.w, h: r.h, valign: "middle", fontFace: FONT, margin: 0, objectName: panelTag("title", "제목", "text") },
  );
}

/** 배지 줄바꿈 배치. draw=false면 높이만 잰다 */
function chipRows(s: Slide, items: { text: string; tone: Badge["tone"] }[], x: number, y: number, maxW: number, draw: boolean, scale = 1): number {
  const chipH = 0.3 * scale;
  const rowGap = 0.36 * scale;
  const itemGap = 0.08 * scale;
  let cx = x;
  let cy = y;
  for (const b of items) {
    const w = Math.min(maxW, textIn(b.text, 10 * scale) + 0.3 * scale);
    if (cx > x && cx + w > x + maxW) {
      cx = x;
      cy += rowGap;
    }
    if (draw) {
      s.addShape("roundRect", { x: cx, y: cy, w, h: chipH, fill: { color: CHIP[b.tone].fill }, line: { color: CHIP[b.tone].fill }, rectRadius: 0.15 * scale });
      s.addText(b.text, { x: cx, y: cy, w, h: chipH, align: "center", valign: "middle", fontFace: FONT, fontSize: fitBlock([b.text], { w: Math.max(0.1, w - 0.12 * scale), h: chipH }, 10 * scale, 7), bold: true, color: CHIP[b.tone].color, margin: 0 });
    }
    cx += w + itemGap;
  }
  return items.length ? cy - y + chipH : 0;
}

type Item = ReportItem;
type InfoBox = { x: number; y?: number; w: number; h: number };

const innerInfoBox = (rect: Rect, scale = 1): InfoBox => {
  const pad = 0.22 * scale;
  return { x: rect.x + pad, w: Math.max(0.2, rect.w - pad * 2), h: Math.max(0.2, rect.h - pad * 2) };
};

/** 오른쪽 정보 판: 항목을 쌓아 높이를 정한 뒤 판을 먼저 그리고 항목을 얹는다 */
function infoPanel(s: Slide, items: Item[], rect: Rect | null, scale = 1) {
  if (!rect) return;
  const gap = 0.12 * scale;
  const pad = Math.min(0.22 * scale, Math.max(0, rect.w / 2), Math.max(0, rect.h / 2));
  const r = rect;
  const group = panelTag("summary", "요약", "plate");
  plate(s, r, 0.16, group);
  const confine = <T extends object>(options: T | undefined): T | null => {
    if (!options) return null;
    const box = options as T & { x?: number; y?: number; w?: number; h?: number };
    if (![box.x, box.y, box.w, box.h].every((value) => typeof value === "number" && Number.isFinite(value))) return options;
    const x = box.x as number;
    const y = box.y as number;
    const w = Math.max(0, box.w as number);
    const h = Math.max(0, box.h as number);
    const x0 = Math.max(r.x, x);
    const y0 = Math.max(r.y, y);
    const x1 = Math.min(r.x + r.w, x + w);
    const y1 = Math.min(r.y + r.h, y + h);
    if (x1 < x0 || y1 < y0) return null;
    return { ...options, x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) } as T;
  };
  const groupedSlide = {
    addShape: (name: Parameters<Slide["addShape"]>[0], options: Parameters<Slide["addShape"]>[1]) => {
      const clipped = confine(options);
      return clipped ? s.addShape(name, { ...clipped, objectName: group }) : undefined;
    },
    addText: (text: Parameters<Slide["addText"]>[0], options: Parameters<Slide["addText"]>[1]) => {
      const clipped = confine(options);
      return clipped ? s.addText(text, { ...clipped, objectName: group }) : undefined;
    },
  } as Slide;
  let y = r.y + pad;
  for (const it of items) {
    if (y >= r.y + r.h) break;
    it.draw(y, groupedSlide);
    y += it.h + gap;
  }
}

const badgeItem = (s: Slide, badges: Badge[], box: InfoBox, scale = 1): Item | null => {
  const items = badges.map((b) => ({ text: b.text, tone: b.tone }));
  const h = chipRows(s, items, box.x, 0, box.w, false, scale);
  return h ? { h, draw: (y, target = s) => void chipRows(target, items, box.x, y, box.w, true, scale) } : null;
};

function headlineItems(s: Slide, h: NonNullable<TileView["headline"]>, box: InfoBox, scale = 1): Item[] {
  const sub = [h.aux, h.tag].filter(Boolean).join(" · ");
  const labelH = 0.24 * scale;
  const valueH = 0.66 * scale;
  const subH = 0.24 * scale;
  const pt = fitBlock([h.value], { w: box.w, h: valueH }, 36 * scale, 7);
  // 라벨·값·보조어는 붙여서 한 덩어리로 (항목 사이 간격을 넣지 않는다)
  return [
    {
      h: labelH + valueH + (sub ? subH : 0),
      draw: (y, target = s) => {
        target.addText(h.label, { x: box.x, y, w: box.w, h: labelH, fontFace: FONT, fontSize: fitBlock([h.label], { w: box.w, h: labelH }, 11 * scale, 7), color: MUTED, margin: 0, fit: "shrink" });
        target.addText(h.value, { x: box.x, y: y + labelH, w: box.w, h: valueH, valign: "middle", fontFace: FONT, fontSize: pt, bold: true, color: INK, margin: 0, fit: "shrink" });
        if (sub) target.addText(sub, { x: box.x, y: y + labelH + valueH, w: box.w, h: subH, fontFace: FONT, fontSize: fitBlock([sub], { w: box.w, h: subH }, 10.5 * scale, 7), color: MUTED, margin: 0, fit: "shrink" });
      },
    },
  ];
}

const textItem = (s: Slide, text: string, pt: number, color: string, bold = false, maxLines = 6, box: InfoBox, scale = 1): Item => {
  const scaledPt = pt * scale;
  const size = fitBlock(text.split("\n"), { w: box.w, h: maxLines * (scaledPt / 72) * 1.45 }, scaledPt, 7);
  const rows = text.split("\n").reduce((sum, line) => sum + linesOf(line, size, box.w), 0);
  const h = rows * (size / 72) * 1.45 + 0.04;
  return { h, draw: (y, target = s) => void target.addText(text, { x: box.x, y, w: box.w, h, valign: "top", fontFace: FONT, fontSize: size, bold, color, margin: 0, fit: "shrink" }) };
};

function roseSummary(model: RoseModel): string {
  const pct = (hours: number) => {
    const value = model.totalHours > 0 ? (hours / model.totalHours) * 100 : 0;
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  };
  return `정온 ${pct(model.calmHours)}% · 결측 ${pct(model.missingHours)}% · 지점 ${model.station}`;
}

const ROSE_SEASON_LABEL = { annual: "연간", spring: "봄", summer: "여름", autumn: "가을", winter: "겨울" } as const;

function rowItems(s: Slide, rows: TileView["rows"], box: InfoBox, scale = 1): Item[] {
  return rows.map((r) => ({
    h: 0.3 * scale,
    draw: (y, target = s) => {
      const rowH = 0.28 * scale;
      target.addText(r.label, { x: box.x, y, w: box.w * 0.55, h: rowH, valign: "middle", fontFace: FONT, fontSize: fitBlock([r.label], { w: box.w * 0.55, h: rowH }, 11 * scale, 7), color: MUTED, margin: 0, fit: "shrink" });
      const v = [r.value, r.aux, r.tag].filter(Boolean).join(" · ");
      target.addText(v, { x: box.x + box.w * 0.55, y, w: box.w * 0.45, h: rowH, align: "right", valign: "middle", fontFace: FONT, fontSize: fitBlock([v], { w: box.w * 0.45, h: rowH }, 11 * scale, 7), bold: true, color: INK, margin: 0, fit: "shrink" });
      target.addShape("line", { x: box.x, y: y + 0.3 * scale, w: box.w, h: 0, line: { color: LINE, width: 0.75 } });
    },
  }));
}

/** 왼쪽 아래 범례 판 (지도 레이어 색) */
function legendPlate(s: Slide, p: PlannedSlide & { kind: "tile" }, hasSummary = true, format: SlideFormat = "wide", style: PageStyle = p.style ?? {}) {
  const model = p.map;
  if (!model) return;
  const { items, notes, rect: r } = slideLegend(model, !p.muted, style, hasSummary, format, frameLegendOptions(frameOf(p)));
  if (!r) return;
  const scale = slidePanelScale(style.legendScale);
  const legendPt = fontSizeForStyle(style, "legend");
  const focus = style.legendFocus ? legendItemsOf(model).find((item) => item.key === style.legendFocus)?.label ?? style.legendFocus : null;
  const group = panelTag("legend", "범례", "plate");
  plate(s, r, 0.12, group);
  const topPad = Math.min(SLIDE_LEGEND.padding * scale, Math.max(0, r.h));
  const bottomPad = Math.min(SLIDE_LEGEND.padding * scale, Math.max(0, r.h - topPad));
  const nominalRowH = SLIDE_LEGEND.row * scale;
  const nominalNoteH = SLIDE_LEGEND.note * scale;
  const wantedH = items.length * nominalRowH + notes.length * nominalNoteH;
  const compression = wantedH > 0 ? Math.min(1, Math.max(0, (r.h - topPad - bottomPad) / wantedH)) : 1;
  const rowH = nominalRowH * compression;
  const noteH = nominalNoteH * compression;
  const iconScale = scale * compression;
  const iconDy = (SLIDE_LEGEND.row - 0.3) * iconScale / 2;
  const legendGeometry = slideLegendGeometry(r, scale);
  const iconXFor = (width: number) => legendGeometry.contentX + Math.max(0, (legendGeometry.iconColumn - width) / 2);
  const confine = <T extends object>(options: T | undefined): T | null => {
    if (!options) return null;
    const box = options as T & { x?: number; y?: number; w?: number; h?: number };
    if (![box.x, box.y, box.w, box.h].every((value) => typeof value === "number" && Number.isFinite(value))) return options;
    const x = box.x as number;
    const y = box.y as number;
    const w = Math.max(0, box.w as number);
    const h = Math.max(0, box.h as number);
    const x0 = Math.max(r.x, x);
    const y0 = Math.max(r.y, y);
    const x1 = Math.min(r.x + r.w, x + w);
    const y1 = Math.min(r.y + r.h, y + h);
    if (x1 < x0 || y1 < y0) return null;
    return { ...options, x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) } as T;
  };
  const target = {
    addShape: (name: Parameters<Slide["addShape"]>[0], options: Parameters<Slide["addShape"]>[1]) => {
      const clipped = confine(options);
      const objectName = clipped && (clipped as { objectName?: string }).objectName;
      return clipped ? s.addShape(name, { ...clipped, objectName: objectName ?? group }) : undefined;
    },
    addText: (text: Parameters<Slide["addText"]>[0], options: Parameters<Slide["addText"]>[1]) => {
      const clipped = confine(options);
      const objectName = clipped && (clipped as { objectName?: string }).objectName;
      return clipped ? s.addText(text, { ...clipped, objectName: objectName ?? group }) : undefined;
    },
  } as Slide;
  items.forEach((it, i) => {
    const y = r.y + topPad + i * rowH;
    const focused = !it.site && focus !== null && it.label === focus;
    const dimmed = focus !== null && !it.site && !focused;
    const fade = dimmed ? 65 : 0;
    const labelX = legendGeometry.labelX;
    const labelW = Math.max(0.01, legendGeometry.labelW);
    const labelPt = fitBlock([it.label], { w: labelW, h: Math.max(0.01, rowH) }, legendPt, 7);
    if (it.site) {
      target.addShape("diamond", { x: iconXFor(0.16 * iconScale), y: y + iconDy + 0.04 * iconScale, w: 0.16 * iconScale, h: 0.16 * iconScale, fill: { color: "FFFFFF", transparency: fade }, line: { color: "111111", width: 0.8, transparency: fade } });
      target.addShape("ellipse", { x: iconXFor(0.04 * iconScale), y: y + iconDy + 0.1 * iconScale, w: 0.04 * iconScale, h: 0.04 * iconScale, fill: { color: "111111", transparency: fade }, line: { color: "111111", width: 0, transparency: fade } });
    } else if (it.symbol === "rail-axis") {
      target.addShape("line", { x: iconXFor(0.22 * iconScale), y: y + iconDy + 0.145 * iconScale, w: 0.22 * iconScale, h: 0, line: { color: "172033", width: 5.2, transparency: fade, beginArrowType: "none", endArrowType: "none" } });
      target.addShape("line", { x: iconXFor(0.22 * iconScale), y: y + iconDy + 0.145 * iconScale, w: 0.22 * iconScale, h: 0, line: { color: hex(it.color), width: 3.6, transparency: fade, beginArrowType: "none", endArrowType: "none" } });
    } else if (it.symbol === "rail-exit") {
      target.addShape("ellipse", { x: iconXFor(0.19 * iconScale), y: y + iconDy + 0.035 * iconScale, w: 0.19 * iconScale, h: 0.19 * iconScale, fill: { color: "FFD200", transparency: fade }, line: { color: "172033", width: 0.75, transparency: fade } });
    } else if (it.badge) {
      const badgeX = iconXFor(0.19 * iconScale);
      target.addShape("ellipse", { x: badgeX, y: y + iconDy + 0.03 * iconScale, w: 0.19 * iconScale, h: 0.19 * iconScale, fill: { color: hex(it.color), transparency: fade }, line: { color: "FFFFFF", width: 0.75, transparency: fade } });
      target.addText(it.badge, { x: badgeX, y: y + iconDy + 0.03 * iconScale, w: 0.19 * iconScale, h: 0.19 * iconScale, align: "center", valign: "middle", fontFace: FONT, fontSize: Math.max(7, 7 * (legendPt / 10)), bold: true, color: dimmed ? "8C919B" : hex(badgeTextColor(it.color)), margin: 0 });
    } else if (it.lineSwatch) {
      const lineW = 0.22 * iconScale;
      const x = iconXFor(lineW);
      const lineY = y + iconDy + 0.145 * iconScale;
      const dashType = legendDashType(it.dash);
      const lineWidth = Math.max(1.2, (it.strokeWidth ?? 1.5) * 0.9);
      if (it.casing) target.addShape("line", { x, y: lineY, w: lineW, h: 0, line: { color: hex(it.casing), width: lineWidth + 1.8, transparency: fade, dashType }, objectName: `${group}|item-${i}|casing` });
      target.addShape("line", { x, y: lineY, w: lineW, h: 0, line: { color: hex(it.color), width: lineWidth, transparency: fade, dashType }, objectName: `${group}|item-${i}|line` });
      if (it.tickMarks) {
        for (const offset of [0.05, 0.11, 0.17]) {
          target.addShape("line", { x: x + offset * iconScale, y: y + iconDy + 0.095 * iconScale, w: 0.001, h: 0.1 * iconScale, line: { color: hex(it.color), width: 0.7, transparency: fade }, objectName: `${group}|item-${i}|tick-${offset}` });
        }
      }
    } else if (it.legendSwatch === "polygon") {
      const polygonSize = 0.19 * iconScale;
      target.addShape("rect", {
        x: iconXFor(polygonSize),
        y: y + iconDy + 0.035 * iconScale,
        w: polygonSize,
        h: polygonSize,
        fill: { color: hex(it.fill && it.fill !== "none" ? it.fill : it.color), transparency: it.fill === "none" ? 100 : Math.round((1 - (it.fillOpacity ?? 1)) * 100) },
        line: { color: hex(it.stroke ?? it.color), width: 0.75, transparency: fade, dashType: legendDashType(it.dash) },
        objectName: `${group}|item-${i}|polygon`,
      });
    } else {
      const pointSize = 0.13 * iconScale;
      target.addShape("ellipse", { x: iconXFor(pointSize), y: y + iconDy + 0.06 * iconScale, w: pointSize, h: pointSize, fill: { color: hex(it.color), transparency: fade }, line: { color: "FFFFFF", width: 0.75, transparency: fade } });
    }
    target.addText(it.label, { x: labelX, y, w: labelW, h: Math.max(0.01, rowH), valign: "middle", fontFace: FONT, fontSize: labelPt, bold: focused, color: dimmed ? "8C919B" : INK, margin: 0 });
  });
  notes.forEach((n, i) => {
      const noteX = legendGeometry.noteX;
      const noteW = Math.max(0.01, legendGeometry.noteW);
      target.addText(n, { x: noteX, y: r.y + topPad + items.length * rowH + i * noteH, w: noteW, h: Math.max(0.01, noteH), valign: "middle", fontFace: FONT, fontSize: fitBlock([n], { w: noteW, h: Math.max(0.01, noteH) }, 8.5 * (legendPt / 10), 7), color: MUTED, margin: 0, fit: "shrink" });
  });
}

function cover(pptx: PptxGenJS, p: PlannedSlide & { kind: "cover" }, images: MapImages, look: PptxMapLook) {
  const format = formatOf(p);
  const s = pptx.addSlide();
  background(s, images[mapKeyOf(p) ?? COVER_MAP_KEY], undefined, format);
  // 왼쪽 큰 제목 판
  const layout = coverLayout({ address: p.address, metricCount: p.metrics.length, lineCount: p.lines.length, incomplete: !!p.incomplete }, format);
  const { left, right, leftInner, address, metricCellW, metricsY, asOf, incompleteY, rightHeading, rowH, addressPt } = layout;
  plate(s, left, 0.16);
  const coverTitleScale = fontSizeForStyle(p.style ?? {}, "title") / 18;
  s.addText("사이트 분석 보고서", { x: leftInner.x, y: leftInner.y, w: leftInner.w, h: leftInner.h, fontFace: FONT, fontSize: 11 * coverTitleScale, bold: true, color: MUTED, margin: 0 });
  s.addText(p.address, { x: address.x, y: address.y, w: address.w, h: address.h, valign: "top", fontFace: FONT, fontSize: addressPt, bold: true, color: INK, margin: 0 });
  p.metrics.forEach((m, i) => {
    const x = leftInner.x + (i % 2) * (leftInner.w / 2);
    const my = metricsY + Math.floor(i / 2) * 0.62;
    s.addText(m.label, { x, y: my, w: metricCellW, h: 0.22, fontFace: FONT, fontSize: 10, color: MUTED, margin: 0 });
    s.addText(m.value, { x, y: my + 0.22, w: metricCellW, h: 0.36, valign: "middle", fontFace: FONT, fontSize: fitPt(m.value, 17, metricCellW, 1, 11), bold: true, color: INK, margin: 0 });
  });
  s.addText(p.asOfLine, { x: asOf.x, y: asOf.y, w: asOf.w, h: asOf.h, valign: "middle", fontFace: FONT, fontSize: 11, color: MUTED, margin: 0 });
  if (p.incomplete) chipRows(s, [{ text: p.incomplete, tone: "status" }], leftInner.x, incompleteY, leftInner.w, true);

  // 오른쪽 타일 목록 판
  plate(s, right, 0.16);
  s.addText("타일", { x: rightHeading.x, y: rightHeading.y, w: rightHeading.w, h: rightHeading.h, fontFace: FONT, fontSize: 11, bold: true, color: MUTED, margin: 0 });
  p.lines.forEach((l, i) => {
    const row = layout.row(i);
    const ry = row.y;
    s.addShape("ellipse", { x: row.x, y: ry + rowH / 2 - 0.06, w: 0.12, h: 0.12, fill: { color: hex(l.color) }, line: { color: hex(l.color) } });
    const text = `${l.title}  ${l.text}`;
    s.addText(
      [
        { text: `${l.title}  `, options: { bold: true, color: INK } },
        { text: l.text, options: { color: MUTED } },
      ],
      { x: row.x + 0.22, y: ry, w: row.w, h: row.h, valign: "middle", fontFace: FONT, fontSize: fitPt(text, 11, row.w, 1, 8), margin: 0 },
    );
  });
  pageTextBoxes(s, p, format);
  pageNotes(s, p);
  strip(s, p, !!p.map, format, p.map ? [exportBasemap(p.map, look.basemap)] : []);
}

function tile(pptx: PptxGenJS, p: PlannedSlide & { kind: "tile" }, images: MapImages, mapDrawing: PptxMapDrawing, look: PptxMapLook) {
  const v = p.view;
  const format = formatOf(p);
  const g = slideGeometry(format);
  const layout = slideLayout(format);
  const s = pptx.addSlide();
  const style = pageStyleFor(p, format);
  const chart = !p.map && !p.mass && !p.rose; // 도판 구성비 면: 연한 타일색 바탕에 차트가 전면
  const summaryPt = fontSizeForStyle(style, "summary");
  const summaryScale = summaryPt / 13;
  const mix = (c: string, a: number) => {
    const n = parseInt(hex(c), 16);
    const ch = (sh: number) => Math.round(255 - (255 - ((n >> sh) & 255)) * a);
    return [16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, "0")).join("").toUpperCase();
  };
  const co = p.callout;
  const hasSummary = style.summary !== false && !pageElementDeleted(p.page, "summary") && !(co && co.page > 0);
  const baseLegend = p.map ? slideLegend(p.map, !p.muted, undefined, hasSummary, format, frameLegendOptions(frameOf(p))).rect : null;
  const panels = slidePanelRects(style, hasSummary, baseLegend, format);
  const terrainShown = v.code === "D17" && !!v.terrainSections && !!p.terrainSection;
  const terrainLayout = terrainShown ? terrainSectionLayout(panels, layout, format) : null;
  const summaryRect = terrainLayout?.summary ?? panels.summary;
  const summaryX = summaryRect?.x ?? g.w;
  const contentBox = summaryRect ? innerInfoBox(summaryRect, summaryScale) : { x: g.edge, w: Math.max(0.2, g.w - 2 * g.edge), h: 0.2 };
  const calloutReport = tileReportModuleFor(v.code)?.report;
  const mapStatus = p.map ? nativeMapStatus(p.map) : null;
  const nativeMap = mapDrawing === "editable" && !!p.map && !!mapStatus?.native;
  const mapLayer = p.map ? exportBasemap(p.map, look.basemap, frameOf(p)) : null;
  const stripLayers = mapLayer ? [mapLayer] : [];
  // 벡터 바탕이면 바탕은 도형으로 먼저 그리고, 그림은 값 래스터·밀집 층만(있을 때) 그 위에 놓는다.
  const vectorMap = nativeMap && mapLayer === "vector";
  const mapImage = chart ? undefined : images[mapKeyOf(p) ?? v.tileId];
  if (!vectorMap) background(s, mapImage, chart ? mix(v.color, 0.07) : undefined, format);
  const fallbackNotes: string[] = [];
  if (nativeMap && p.map) {
    const size = slideSize(format);
    addEditableMap(s, p, p.map, {
      style, format, frame: frameForLayout(p, format), reportFrame: frameOf(p), layout: layoutOf(p),
      basemap: mapLayer ?? undefined,
      baseTheme: look.baseTheme,
      underlay: vectorMap && mapImage ? () => { s.addImage({ data: mapImage, x: 0, y: 0, w: size.w, h: size.h }); } : undefined,
    });
    if (mapStatus?.denseLayers.length || mapStatus?.rasterValues.length) fallbackNotes.push(nativeMapFallbackNote(p.map));
  } else if (p.map) fallbackNotes.push(nativeMapFallbackNote(p.map));
  const coTail = co ? calloutPageTitleTail(co.model.complexes, co.page, co.model.unit, co.shownKeys, co.numberStart ?? 1) : null;
  if (!pageElementDeleted(p.page, "title")) titlePlate(s, v.color, p.page?.titleOverride ?? v.title, [v.kindLabel, p.faceLabel, coTail].filter((t, i, a) => t && a.indexOf(t) === i).join(" · "), co && co.page > 0 ? g.w - 2 * g.edge : summaryX - 2 * g.edge, style, hasSummary, format);
  if (co && co.page > 0) {
    calloutReport?.render({ slide: s, planned: p, part: "page" });
    pageTextBoxes(s, p, format);
    pageNotes(s, p, fallbackNotes);
    strip(s, p, true, format, stripLayers);
    return;
  }

  const notes = [
    // D17 단면 칸만 메모를 줄인다. 다른 타일은 자료 주의 문구를 모두 싣는다.
    ...(terrainShown ? reportSummaryNotes(v, true) : [...v.caveats, ...v.notes]),
    ...(p.mass ? ["DXF·GLB는 내보내기에서"] : []),
    ...(p.rose ? [roseSummary(p.rose), `바람장미 선택 계절 · ${ROSE_SEASON_LABEL[p.roseSeason ?? "annual"]}`] : []),
  ];
  const items: Item[] = [];
  const b = badgeItem(s, v.badges, contentBox, summaryScale);
  if (b) items.push(b);

  if (p.body.kind === "state") {
    // 상태 화면: 흐린 대지 지도 가운데 판
    const w = 5.0;
    const msg = p.body.message;
    const pt = fitBlock([msg], { w: w - 0.6, h: 1.1 }, 20, 7);
    const h = 0.4 + linesOf(msg, pt, w - 0.6) * (pt / 72) * 1.4 + 0.75;
    const r = { x: (summaryX - w) / 2, y: (g.h - h) / 2, w, h };
    plate(s, r, 0.16);
    s.addText(msg, { x: r.x + 0.3, y: r.y + 0.22, w: w - 0.6, h: h - 0.9, valign: "top", fontFace: FONT, fontSize: pt, bold: true, color: INK, margin: 0 });
    s.addText("이 타일의 수치는 만들지 않았습니다. 조건을 바꾸거나 다시 계산한 뒤 보고서를 만들 수 있습니다.", { x: r.x + 0.3, y: r.y + h - 0.68, w: w - 0.6, h: 0.5, valign: "top", fontFace: FONT, fontSize: 10.5, color: MUTED, margin: 0 });
    notes.forEach((n) => items.push(textItem(s, n, 10, MUTED, false, 6, contentBox, summaryScale)));
    infoPanel(s, items, summaryRect, summaryScale);
    pageTextBoxes(s, p, format);
    pageNotes(s, p, fallbackNotes);
    strip(s, p, true, format, stripLayers);
    return;
  }

  if (co && co.model.complexes.length > 0) {
    const stat = calloutReport?.render({ slide: s, planned: p, part: "stat" });
    if (stat) items.push(stat);
  }
  else if (v.headline) items.push(...headlineItems(s, v.headline, contentBox, summaryScale));
  const summaryText = p.page?.summaryOverride ?? v.sentence;
  if (summaryText) items.push(textItem(s, summaryText, summaryPt, INK, true, 5, contentBox, 1));
  if (v.filterLine) items.push(textItem(s, v.filterLine, 10, MUTED, true, 2, contentBox, summaryScale));
  // 도판(지도) 면에 구성비 수치를 반복하지 않는다
  const rows = p.body.face === "front" || p.body.face === "back" ? [] : v.rows.filter((r) => r.label !== v.headline?.label).slice(0, 5);
  if (rows.length) items.push(...rowItems(s, rows, contentBox, summaryScale));
  if (v.grades.length > 0) items.push(textItem(s, v.grades.map((g) => `${g.label} · ${g.criteria}`).join("\n"), 9, MUTED, false, 4, contentBox, summaryScale));
  else if (v.grade) items.push(textItem(s, `거리 등급 ${v.grade.label} · ${v.grade.criteria}`, 9, MUTED, false, 3, contentBox, summaryScale));
  if (notes.length) items.push(textItem(s, notes.join("\n"), 9, MUTED, false, 5, contentBox, summaryScale));

  if (chart) {
    // 전면 구성비 차트 (왼쪽 영역)
    const data = v.chart ?? [];
    const max = Math.max(1, ...data.map((c) => c.value));
    const x0 = g.edge + 0.2;
    const y0 = layout.title.y + layout.title.h + 0.4;
    const y1 = layout.strip.y - 0.4;
    const rh = Math.min(0.72, (y1 - y0) / Math.max(1, data.length));
    const labW = 1.9;
    const trackW = summaryX - E - 0.4 - x0 - labW - 1.0;
    data.forEach((c, i) => {
      const y = y0 + i * rh;
      s.addText(c.label, { x: x0, y, w: labW, h: rh, valign: "middle", fontFace: FONT, fontSize: 14, bold: true, color: "454A55", margin: 0 });
      s.addShape("rect", { x: x0 + labW, y: y + rh * 0.2, w: trackW, h: rh * 0.6, fill: { color: INK, transparency: 95 }, line: { color: INK, width: 0, transparency: 100 } });
      s.addShape("rect", { x: x0 + labW, y: y + rh * 0.2, w: Math.max(0.04, (trackW * c.value) / max), h: rh * 0.6, fill: { color: hex(STRIP_COLORS[i % STRIP_COLORS.length]) }, line: { color: hex(STRIP_COLORS[i % STRIP_COLORS.length]), width: 0 } });
      s.addText(`${c.value}${c.unit === "%" ? "%" : ` ${c.unit}`}`, { x: x0 + labW + trackW + 0.1, y, w: 0.8, h: rh, align: "right", valign: "middle", fontFace: FONT, fontSize: 14, bold: true, color: INK, margin: 0 });
    });
  } else if (terrainShown && v.terrainSections && p.terrainSection && terrainLayout) {
    const stepRow = v.rows.find((row) => row.label === "반경 안 단차 시설 수");
    const facilityCount = stepRow ? Number.parseInt(stepRow.value.replace(/[^0-9-]/g, ""), 10) : null;
    drawTerrainSectionPptx(s, v.terrainSections, p.terrainSection, terrainLayout.rect, Number.isFinite(facilityCount) ? facilityCount : null);
    legendPlate(s, p, hasSummary, format, style);
  } else if (co) calloutReport?.render({ slide: s, planned: p, part: "overview" });
  else legendPlate(s, p, hasSummary, format, style);

  infoPanel(s, items, summaryRect, summaryScale);
  pageTextBoxes(s, p, format);
  pageNotes(s, p, fallbackNotes);
  strip(s, p, !chart, format, stripLayers);
}

function sheet(pptx: PptxGenJS, p: PlannedSlide & { kind: "sheet" }, images: MapImages, look: PptxMapLook) {
  const format = formatOf(p);
  const g = slideGeometry(format);
  const s = pptx.addSlide();
  s.background = { color: "F2F2EF" };
  titlePlate(s, p.view.color, p.view.title, p.grid, g.w - 2 * g.edge, p.style, false, format);
  const cells = sheetCells(p.grid as SheetGrid);
  const cellNotes = new Set<string>();
  const cellLayers: BasemapChoice[] = [];
  for (const [index, cell] of p.cells.entries()) {
    if (!cell) continue;
    const r = cells[index];
    if (!r) continue;
    s.addShape("roundRect", { x: r.x, y: r.y, w: r.w, h: r.h, rectRadius: 0.08, fill: { color: "FFFFFF" }, line: { color: LINE, width: 0.75 } });
    const chart = cell.face === "back" && cell.view.chart;
    const sourceMap = !chart && !cell.mass && !cell.rose ? cell.view.map ?? cell.view.backdrop : null;
    const cellMap = sourceMap && sourceMap.tileCode ? sourceMap : sourceMap ? { ...sourceMap, tileCode: cell.view.code } : null;
    const cellStatus = cellMap ? nativeMapStatus(cellMap) : null;
    const cellLayer = cellMap ? exportBasemap(cellMap, look.basemap, cell.reportFrame) : null;
    if (cellLayer) cellLayers.push(cellLayer);
    // 벡터 바탕 칸: 바탕은 도형, 그림은 값 래스터·밀집 층이 있을 때만(addEditableMap 안에서 바탕 위에 놓는다).
    const vectorCell = !!cellStatus?.native && cellLayer === "vector";
    const cellImage = images[cell.mapKey];
    if (vectorCell) {
      // 아래 addEditableMap이 그린다
    } else if (chart) {
      const data = cell.view.chart ?? [];
      const max = Math.max(1, ...data.map((entry) => entry.value));
      const y0 = r.y + 0.58;
      const rowH = Math.min(0.38, (r.h - 0.95) / Math.max(1, data.length));
      const labelW = Math.min(1.35, r.w * 0.34);
      const trackW = Math.max(0.5, r.w - labelW - 0.8);
      data.forEach((entry, chartIndex) => {
        const y = y0 + chartIndex * rowH;
        s.addText(entry.label, { x: r.x + 0.12, y, w: labelW - 0.08, h: rowH, valign: "middle", fontFace: FONT, fontSize: fitPt(entry.label, 8.5, labelW - 0.08, 1, 6), bold: true, color: MUTED, margin: 0, fit: "shrink" });
        s.addShape("rect", { x: r.x + labelW, y: y + rowH * 0.22, w: trackW, h: rowH * 0.56, fill: { color: INK, transparency: 94 }, line: { color: INK, width: 0, transparency: 100 } });
        s.addShape("rect", { x: r.x + labelW, y: y + rowH * 0.22, w: Math.max(0.03, (trackW * entry.value) / max), h: rowH * 0.56, fill: { color: hex(STRIP_COLORS[chartIndex % STRIP_COLORS.length]) }, line: { color: hex(STRIP_COLORS[chartIndex % STRIP_COLORS.length]), width: 0 } });
        s.addText(`${entry.value}${entry.unit === "%" ? "%" : ` ${entry.unit}`}`, { x: r.x + r.w - 0.68, y, w: 0.56, h: rowH, align: "right", valign: "middle", fontFace: FONT, fontSize: 8.5, bold: true, color: INK, margin: 0 });
      });
    } else if (cellImage) {
      s.addImage({ data: cellImage, x: r.x, y: r.y, w: r.w, h: r.h, sizing: { type: "contain", w: r.w, h: r.h }, altText: `${cell.view.title} ${cell.face === "back" ? "구성비" : "도판"}` });
    } else {
      s.addText("그림을 만들지 못했습니다", { x: r.x + 0.15, y: r.y + r.h / 2 - 0.12, w: r.w - 0.3, h: 0.25, align: "center", fontFace: FONT, fontSize: 9, color: MUTED, margin: 0 });
    }
    if (!chart && !cell.mass && !cell.rose) {
      if (cellMap && cellStatus?.native) {
        addEditableMap(s, null, cellMap, {
          mode: "cell", scope: `cell-${index}`, frame: { x: r.x, y: r.y, w: r.w, h: r.h }, style: cell.style, reportFrame: cell.reportFrame, format,
          basemap: cellLayer ?? undefined,
          baseTheme: look.baseTheme,
          underlay: vectorCell && cellImage ? () => { s.addImage({ data: cellImage, x: r.x, y: r.y, w: r.w, h: r.h, sizing: { type: "contain", w: r.w, h: r.h }, altText: `${cell.view.title} 값 래스터` }); } : undefined,
        });
        if (cellStatus.denseLayers.length || cellStatus.rasterValues.length) cellNotes.add(nativeMapFallbackNote(cellMap));
      }
    }
    const cutNote = cell.view.notes[0] ?? null;
    if (cutNote) cellNotes.add(cutNote);
    const chipText = cell.view.title;
    s.addShape("roundRect", { x: r.x + 0.1, y: r.y + 0.1, w: Math.min(r.w - 0.2, 2.9), h: 0.3, rectRadius: 0.12, fill: { color: "FFFFFF", transparency: 10 }, line: { color: INK, transparency: 88, width: 0.5 } });
    s.addText(chipText, { x: r.x + 0.2, y: r.y + 0.1, w: Math.min(r.w - 0.4, 2.7), h: 0.3, valign: "middle", fontFace: FONT, fontSize: fitPt(chipText, 8.5, Math.min(r.w - 0.4, 2.7), 1, 8), bold: true, color: INK, margin: 0, fit: "shrink" });
  }
  pageTextBoxes(s, p, format);
  pageNotes(s, p, [...cellNotes]);
  strip(s, p, true, format, cellLayers);
}

function sources(pptx: PptxGenJS, p: PlannedSlide & { kind: "sources" }, images: MapImages, look: PptxMapLook) {
  const format = formatOf(p);
  const size = slideSize(format);
  const g = slideGeometry(format);
  const s = pptx.addSlide();
  background(s, images[mapKeyOf(p) ?? COVER_MAP_KEY], undefined, format);
  // 지도를 흐리게: 흰 막
  s.addShape("rect", { x: 0, y: 0, w: size.w, h: size.h, fill: { color: "FFFFFF", transparency: 25 }, line: { color: "FFFFFF", width: 0, transparency: 100 } });
  titlePlate(s, "#7A7E87", "자료 출처와 기준일", "", size.w - 2 * g.edge, p.style ?? {}, false, format);
  // 원천이 많은 분석은 report-plan에서 여러 출처 장으로 나눈다. 한 장 안의 표는 승인 시안의 열 구조를 유지한다.
  const source = sourceLayout(p.rows.length, p.style ?? {}, format);
  const dense = source.dense;
  const sourcePt = fontSizeForStyle(p.style ?? {}, "source");
  const r = source.table;
  plate(s, r, 0.16);
  const cell = (t: string, opts: { bold?: boolean; fontSize?: number; color?: string } = {}) => ({
    text: t,
    options: { fontFace: FONT, fontSize: opts.fontSize ?? sourcePt, bold: opts.bold ?? false, color: opts.color ?? INK, border: underline(opts.bold ? 1 : 0.75), margin: (dense ? [0, 0.03, 0, 0.03] : [0, 0.05, 0, 0.05]) as [number, number, number, number], fit: (dense ? "shrink" : "none") as "shrink" | "none" },
  });
  const header = (t: string) => cell(t, { bold: true, fontSize: sourcePt, color: MUTED });
  const rows = [
    [header("제공처·자료"), header("기준일"), header("이용조건"), header("원문 확인"), header("사용한 타일")],
    ...p.rows.map((row) => [
      cell(`${row.provider || "제공처 미기록"}\n${row.source}`, { bold: true }),
      cell(row.asOf),
      cell(row.license || "미기록"),
      row.url ? { text: "원문 확인", options: { ...cell("원문 확인", { color: "235DB5" }).options, hyperlink: { url: row.url } } } : cell("원문 링크 미기록"),
      cell(row.tiles),
    ]),
  ];
  const W = source.tableContent.w;
  s.addTable(rows, { x: source.tableContent.x, y: source.tableContent.y, w: W, colW: [W * 0.24, W * 0.14, W * 0.16, W * 0.25, W * 0.21], rowH: dense ? 0.28 : 0.32, margin: 0 });
  s.addText(`분석 생성일 ${p.analysisDate} · 기준일은 원천 자료 날짜${p.rows.length > 12 ? ` · 원천 ${p.rows.length}건` : ""}`, { x: source.footer.x, y: source.footer.y, w: source.footer.w, h: source.footer.h, fontFace: FONT, fontSize: sourcePt, color: MUTED, margin: 0, fit: "shrink" });
  pageTextBoxes(s, p, format);
  pageNotes(s, p);
  strip(s, p, !!p.map, format, p.map ? [exportBasemap(p.map, look.basemap)] : []);
}

function blank(pptx: PptxGenJS, p: PlannedSlide) {
  const format = formatOf(p);
  const size = slideSize(format);
  const s = pptx.addSlide();
  background(s, undefined, "FFFFFF", format);
  s.addShape("rect", { x: 0.45, y: 0.45, w: size.w - 0.9, h: size.h - 0.9, fill: { color: "FFFFFF", transparency: 100 }, line: { color: "D9DCE2", width: 0.75 }, objectName: "GRP|blank|빈 페이지|frame" });
  pageTextBoxes(s, p, format);
  pageNotes(s, p);
  strip(s, p, false, format);
}

export async function renderReportPptx(plan: PlannedSlide[], images: MapImages = {}, options: { mapDrawing?: PptxMapDrawing } & PptxMapLook = {}): Promise<Uint8Array> {
  const mapDrawing = options.mapDrawing ?? "editable";
  const look: PptxMapLook = { basemap: options.basemap, baseTheme: options.baseTheme };
  const pptx = new PptxGenJS();
  const format = plan.find((slide) => slide.format)?.format ?? "wide";
  if (format === "wide") pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5
  else {
    const size = slideSize(format);
    const name = `REPORT_${format.toUpperCase()}`;
    pptx.defineLayout({ name, width: size.w, height: size.h });
    pptx.layout = name;
  }
  pptx.title = "사이트 분석 보고서";
  for (const p of plan) {
    if (p.page?.kind === "blank") blank(pptx, p);
    else if (p.kind === "cover") cover(pptx, p, images, look);
    else if (p.kind === "tile") tile(pptx, p, images, mapDrawing, look);
    else if (p.kind === "sheet") sheet(pptx, p, images, look);
    else sources(pptx, p, images, look);
  }
  const bytes = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
  // pptxgenjs는 도형 그룹을 만들지 못한다: GRP| 태그를 선택 창용 그룹으로 후처리한다.
  return groupTaggedShapes(bytes);
}
