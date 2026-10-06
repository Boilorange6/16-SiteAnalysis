/**
 * 슬라이드 계획 → .pptx (pptxgenjs, 16:9). 브라우저·Node 공용.
 * 지도 몰입형: 슬라이드 전체가 지도 이미지, 그 위에 반투명 흰 판(편집 가능한 도형·글자)을 얹는다.
 * 판의 자리·여백은 화면 카드/펼침과 같은 문법(ui/overlay-layout)을 쓴다.
 */
import PptxGenJS from "pptxgenjs";
import { PPT_FONT_MAIN as FONT } from "../../ppt-design-config";
import { GROUP_TAG_PREFIX, groupTaggedShapes } from "../../pptx-shape-group";
import { INCH, SLIDE_OVERVIEW_FILL, cardName, cardRows, dotColor, dotRadius, fmtInt, inkOn, layoutCallouts, overlapChip, pageItems, pageRange, rowsFor, slideCalloutFrame, type CalloutFrame, type Complex, type Placed, type Pt } from "../ui/callout-layout";
import { STRIP_COLORS } from "../ui/map-layers";
import { framedViewport, makeProjector } from "../ui/map-projection";
import { OV, SLIDE, slideLayout, slideLegend, slideSiteX, stripText, type Rect } from "../ui/overlay-layout";
import type { Badge, CalloutModel, TileView } from "../ui/tile-view";
import type { RoseModel } from "../ui/wind-rose";
import { sheetCells, type SheetGrid } from "../ui/sheet";
import { COVER_MAP_KEY, mapKeyOf, type PlannedSlide } from "./report-plan";

/** 지도 이미지(PNG/JPEG data URL) — 키는 report-plan의 mapKeyOf */
export type MapImages = Record<string, string>;

type Slide = ReturnType<PptxGenJS["addSlide"]>;

const INK = "15171C";
const MUTED = "5B606B";
const LINE = "D9DCE2";
const PLATE_ALPHA = Math.round((1 - OV.plateAlpha) * 100); // 흰색 86% = 투명도 14
const L = slideLayout();
const E = SLIDE.edge;
const hex = (c: string) => c.replace("#", "");
type Border = PptxGenJS.BorderProps;
const underline = (pt: number): [Border, Border, Border, Border] => [{ type: "none" }, { type: "none" }, { type: "solid", pt, color: LINE }, { type: "none" }];

const CHIP: Record<Badge["tone"], { fill: string; color: string }> = {
  status: { fill: "FCE9C7", color: "7A4B00" },
  limit: { fill: "F0E8DC", color: "5B4A2F" },
  model: { fill: "E6E1F7", color: "3D2E8C" },
};

// ── 글자 크기 추정 (pptx는 자동 줄임이 열 때 적용되지 않으므로 미리 재서 정한다) ──
const chW = (ch: string) => (ch.charCodeAt(0) > 0x2e80 ? 1 : 0.56);
const textIn = (s: string, pt: number) => ([...s].reduce((w, ch) => w + chW(ch), 0) * pt) / 72;
const linesOf = (s: string, pt: number, w: number) => Math.max(1, Math.ceil((textIn(s, pt) / w) * 1.1));
/** maxLines 안에 들어가는 가장 큰 글자 크기 */
function fitPt(s: string, maxPt: number, w: number, maxLines: number, minPt = 8): number {
  let pt = maxPt;
  while (pt > minPt && linesOf(s, pt, w) > maxLines) pt -= 0.5;
  return pt;
}

// ── 공통 도형 ──
function plate(s: Slide, r: Rect, radius = 0.12) {
  s.addShape("roundRect", { x: r.x, y: r.y, w: r.w, h: r.h, fill: { color: "FFFFFF", transparency: PLATE_ALPHA }, line: { color: INK, width: 0.5, transparency: 92 }, rectRadius: radius });
}

function background(s: Slide, image: string | undefined, tint?: string) {
  if (image) s.addImage({ data: image, x: 0, y: 0, w: SLIDE.w, h: SLIDE.h });
  else {
    s.addShape("rect", { x: 0, y: 0, w: SLIDE.w, h: SLIDE.h, fill: { color: tint ?? "F2F2EF" }, line: { color: tint ?? "F2F2EF", width: 0 } });
    if (!tint) s.addText("지도 이미지를 만들지 못했습니다", { x: E, y: SLIDE.h / 2 - 0.2, w: 5, h: 0.4, fontFace: FONT, fontSize: 11, color: MUTED, margin: 0 });
  }
}

/** 맨 아래 출처 띠 + 쪽 번호. 출처·기준일은 모든 장에 있다 */
function strip(s: Slide, p: PlannedSlide, credit: boolean) {
  const r = L.strip;
  s.addShape("rect", { x: r.x, y: r.y, w: r.w, h: r.h, fill: { color: "FFFFFF", transparency: PLATE_ALPHA }, line: { color: "FFFFFF", width: 0, transparency: 100 } });
  s.addShape("line", { x: r.x, y: r.y, w: r.w, h: 0, line: { color: INK, width: 0.5, transparency: 92 } });
  const room = SLIDE.w - E - 1.7;
  const full = stripText(p.footer, credit);
  const text = textIn(full, 9) <= room ? full : p.footer;
  s.addText(text, { x: E, y: r.y, w: room, h: r.h, valign: "middle", fontFace: FONT, fontSize: 9, color: "454A55", margin: 0, fit: "shrink" });
  s.addText(`${p.no} / ${p.total}`, { x: SLIDE.w - E - 1.2, y: r.y, w: 1.2, h: r.h, align: "right", valign: "middle", fontFace: FONT, fontSize: 9, color: "454A55", margin: 0 });
}

/** 왼쪽 위 제목 판: 타일 색 점 + 번호 + 타일명 + 종류 */
function titlePlate(s: Slide, color: string, code: string, title: string, kind: string, maxW: number) {
  const w = Math.min(maxW, 0.62 + textIn(`${code}  `, 10) + textIn(title, 18) + textIn(`  ${kind}`, 10));
  const r = { x: L.title.x, y: L.title.y, w, h: L.title.h };
  plate(s, r);
  s.addShape("ellipse", { x: r.x + 0.2, y: r.y + r.h / 2 - 0.09, w: 0.18, h: 0.18, fill: { color: hex(color) }, line: { color: hex(color) } });
  s.addText(
    [
      { text: `${code}  `, options: { fontSize: 10, color: MUTED, bold: true } },
      { text: title, options: { fontSize: 18, color: INK, bold: true } },
      { text: `  ${kind}`, options: { fontSize: 10, color: MUTED, bold: true } },
    ],
    { x: r.x + 0.48, y: r.y, w: w - 0.58, h: r.h, valign: "middle", fontFace: FONT, margin: 0 },
  );
}

/** 배지 줄바꿈 배치. draw=false면 높이만 잰다 */
function chipRows(s: Slide, items: { text: string; tone: Badge["tone"] }[], x: number, y: number, maxW: number, draw: boolean): number {
  let cx = x;
  let cy = y;
  for (const b of items) {
    const w = Math.min(maxW, textIn(b.text, 10) + 0.3);
    if (cx > x && cx + w > x + maxW) {
      cx = x;
      cy += 0.36;
    }
    if (draw) {
      s.addShape("roundRect", { x: cx, y: cy, w, h: 0.3, fill: { color: CHIP[b.tone].fill }, line: { color: CHIP[b.tone].fill }, rectRadius: 0.15 });
      s.addText(b.text, { x: cx, y: cy, w, h: 0.3, align: "center", valign: "middle", fontFace: FONT, fontSize: 10, bold: true, color: CHIP[b.tone].color, margin: 0 });
    }
    cx += w + 0.08;
  }
  return items.length ? cy - y + 0.3 : 0;
}

type Item = { h: number; draw: (y: number) => void };

/** 오른쪽 정보 판: 항목을 쌓아 높이를 정한 뒤 판을 먼저 그리고 항목을 얹는다 */
function infoPanel(s: Slide, items: Item[]) {
  const gap = 0.12;
  const pad = 0.22;
  const need = items.reduce((a, i) => a + i.h, 0) + gap * Math.max(0, items.length - 1) + pad * 2;
  const r = { x: L.info.x, y: L.info.y, w: L.info.w, h: Math.min(L.info.h, need) };
  plate(s, r, 0.16);
  let y = r.y + pad;
  for (const it of items) {
    it.draw(y);
    y += it.h + gap;
  }
}

const IX = L.info.x + 0.25;
const IW = L.info.w - 0.5;

const badgeItem = (s: Slide, badges: Badge[]): Item | null => {
  const items = badges.map((b) => ({ text: b.text, tone: b.tone }));
  const h = chipRows(s, items, IX, 0, IW, false);
  return h ? { h, draw: (y) => void chipRows(s, items, IX, y, IW, true) } : null;
};

function headlineItems(s: Slide, h: NonNullable<TileView["headline"]>): Item[] {
  const sub = [h.aux, h.tag].filter(Boolean).join(" · ");
  const pt = fitPt(h.value, 36, IW, 1, 20);
  // 라벨·값·보조어는 붙여서 한 덩어리로 (항목 사이 간격을 넣지 않는다)
  return [
    {
      h: 0.24 + 0.66 + (sub ? 0.24 : 0),
      draw: (y) => {
        s.addText(h.label, { x: IX, y, w: IW, h: 0.24, fontFace: FONT, fontSize: fitPt(h.label, 11, IW, 1, 8), color: MUTED, margin: 0 });
        s.addText(h.value, { x: IX, y: y + 0.24, w: IW, h: 0.66, valign: "middle", fontFace: FONT, fontSize: pt, bold: true, color: INK, margin: 0 });
        if (sub) s.addText(sub, { x: IX, y: y + 0.9, w: IW, h: 0.24, fontFace: FONT, fontSize: 10.5, color: MUTED, margin: 0 });
      },
    },
  ];
}

const textItem = (s: Slide, text: string, pt: number, color: string, bold = false, maxLines = 6): Item => {
  const size = fitPt(text, pt, IW, maxLines, 8);
  const h = linesOf(text, size, IW) * (size / 72) * 1.45 + 0.04;
  return { h, draw: (y) => void s.addText(text, { x: IX, y, w: IW, h, valign: "top", fontFace: FONT, fontSize: size, bold, color, margin: 0 }) };
};

function roseSummary(model: RoseModel): string {
  const pct = (hours: number) => {
    const value = model.totalHours > 0 ? (hours / model.totalHours) * 100 : 0;
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  };
  return `정온 ${pct(model.calmHours)}% · 결측 ${pct(model.missingHours)}% · 지점 ${model.station}`;
}

const ROSE_SEASON_LABEL = { annual: "연간", spring: "봄", summer: "여름", autumn: "가을", winter: "겨울" } as const;

function rowItems(s: Slide, rows: TileView["rows"]): Item[] {
  return rows.map((r) => ({
    h: 0.3,
    draw: (y) => {
      s.addText(r.label, { x: IX, y, w: IW * 0.55, h: 0.28, valign: "middle", fontFace: FONT, fontSize: fitPt(r.label, 11, IW * 0.55, 1, 8), color: MUTED, margin: 0 });
      const v = [r.value, r.aux, r.tag].filter(Boolean).join(" · ");
      s.addText(v, { x: IX + IW * 0.55, y, w: IW * 0.45, h: 0.28, align: "right", valign: "middle", fontFace: FONT, fontSize: fitPt(v, 11, IW * 0.45, 1, 8), bold: true, color: INK, margin: 0 });
      s.addShape("line", { x: IX, y: y + 0.3, w: IW, h: 0, line: { color: LINE, width: 0.75 } });
    },
  }));
}

/** 왼쪽 아래 범례 판 (지도 레이어 색) */
function legendPlate(s: Slide, p: PlannedSlide & { kind: "tile" }) {
  const model = p.map;
  if (!model) return;
  const { items, notes, rect: r } = slideLegend(model, !p.muted);
  if (!r) return;
  plate(s, r);
  items.forEach((it, i) => {
    const y = r.y + 0.1 + i * 0.25;
    if (it.site) {
      s.addShape("diamond", { x: r.x + 0.19, y: y + 0.04, w: 0.16, h: 0.16, fill: { color: "FFFFFF" }, line: { color: "111111", width: 0.8 } });
      s.addShape("ellipse", { x: r.x + 0.25, y: y + 0.1, w: 0.04, h: 0.04, fill: { color: "111111" }, line: { color: "111111", width: 0 } });
    } else {
      s.addShape("ellipse", { x: r.x + 0.2, y: y + 0.06, w: 0.13, h: 0.13, fill: { color: hex(it.color) }, line: { color: "FFFFFF", width: 0.75 } });
    }
    s.addText(it.label, { x: r.x + 0.45, y, w: r.w - 0.55, h: 0.25, valign: "middle", fontFace: FONT, fontSize: 10, color: INK, margin: 0 });
  });
  notes.forEach((n, i) => {
    s.addText(n, { x: r.x + 0.2, y: r.y + 0.1 + items.length * 0.25 + i * 0.22, w: r.w - 0.3, h: 0.22, valign: "middle", fontFace: FONT, fontSize: 8.5, color: MUTED, margin: 0, fit: "shrink" });
  });
}

// ── 주변 단지 설명선 장: 지도는 단지 없는 전면 이미지, 점·지시선·표·범례는 편집 가능한 도형 (단지별 PPT 그룹 callout-<id>) ──
const AMBER = "9A5B00";
const K = SLIDE.w / 960; // 지도 이미지(960×540) 픽셀 → inch
const cTag = (c: Complex, part: string) => `${GROUP_TAG_PREFIX}callout-${c.id}|${`콜아웃 ${c.rank} ${cardName(c)}`.replace(/\|/g, "/")}|${part}`;

function projector(model: CalloutModel, siteX: number, fill: number): (c: Complex) => Pt {
  const pr = makeProjector(framedViewport(model.center, model.radiusM, 960, 540, siteX, fill));
  return (c) => {
    const [x, y] = pr(c.lng, c.lat);
    return [x * K, y * K];
  };
}

function seg(s: Slide, a: Pt, b: Pt, color: string, width: number, transparency: number, objectName: string) {
  s.addShape("line", {
    x: Math.min(a[0], b[0]),
    y: Math.min(a[1], b[1]),
    w: Math.max(Math.abs(b[0] - a[0]), 0.005),
    h: Math.max(Math.abs(b[1] - a[1]), 0.005),
    line: { color, width, transparency },
    flipV: b[0] >= a[0] !== b[1] >= a[1],
    objectName,
  });
}

function numberDot(s: Slide, c: Complex, at: Pt, r: number) {
  const color = dotColor(c);
  s.addShape("ellipse", { x: at[0] - r - 0.025, y: at[1] - r - 0.025, w: 2 * r + 0.05, h: 2 * r + 0.05, fill: { color: "FFFFFF", transparency: 8 }, line: { color: "FFFFFF", width: 0, transparency: 100 }, objectName: cTag(c, "dot-halo") });
  s.addShape("ellipse", { x: at[0] - r, y: at[1] - r, w: 2 * r, h: 2 * r, fill: { color: hex(color) }, line: { color: INK, width: 0.5, transparency: 50 }, objectName: cTag(c, "dot") });
  s.addText(String(c.rank), { x: at[0] - r, y: at[1] - r, w: 2 * r, h: 2 * r, align: "center", valign: "middle", fontFace: FONT, fontSize: r >= 0.17 ? 9 : 8, bold: true, color: hex(inkOn(color)), margin: 0, objectName: cTag(c, "dot-no") });
}

function calloutCard(s: Slide, c: Complex, p: Placed, f: CalloutFrame, year: number) {
  const { m } = f;
  const color = dotColor(c);
  const chip = overlapChip(c);
  s.addShape("roundRect", { x: p.x, y: p.y, w: f.cardW, h: f.cardH, fill: { color: "FFFFFF", transparency: 8 }, line: { color: INK, width: 0.5, transparency: 88 }, rectRadius: 0.08, objectName: cTag(c, "card") });
  s.addShape("ellipse", { x: p.x + 0.09, y: p.y + m.head / 2 - 0.09, w: 0.18, h: 0.18, fill: { color: hex(color) }, line: { color: INK, width: 0.5, transparency: 55 }, objectName: cTag(c, "card-no-bg") });
  s.addText(String(c.rank), { x: p.x + 0.09, y: p.y + m.head / 2 - 0.09, w: 0.18, h: 0.18, align: "center", valign: "middle", fontFace: FONT, fontSize: 8, bold: true, color: hex(inkOn(color)), margin: 0, objectName: cTag(c, "card-no") });
  const name = cardName(c);
  const chipW = chip ? 0.62 : 0;
  s.addText(name, { x: p.x + 0.34, y: p.y, w: f.cardW - 0.42 - chipW, h: m.head, valign: "middle", fontFace: FONT, fontSize: fitPt(name, 9.5, f.cardW - 0.42 - chipW, 1, 7), bold: true, color: c.name ? INK : AMBER, margin: 0, objectName: cTag(c, "name") });
  if (chip) {
    s.addShape("roundRect", { x: p.x + f.cardW - 0.68, y: p.y + m.head / 2 - 0.09, w: 0.6, h: 0.18, fill: { color: "FDF1D3" }, line: { color: "FDF1D3", width: 0 }, rectRadius: 0.09, objectName: cTag(c, "chip-bg") });
    s.addText(chip, { x: p.x + f.cardW - 0.68, y: p.y + m.head / 2 - 0.09, w: 0.6, h: 0.18, align: "center", valign: "middle", fontFace: FONT, fontSize: 7.5, bold: true, color: "7A5200", margin: 0, objectName: cTag(c, "chip") });
  }
  seg(s, [p.x, p.y + m.head], [p.x + f.cardW, p.y + m.head], INK, 0.5, 90, cTag(c, "head-sep"));
  const fs = Math.min(8.5, Math.floor(m.row * 72 * 0.68 * 2) / 2);
  const lw = c.supply ? 1.0 : 0.7; // "입주(예정) 시기"가 한 줄에 들어가게
  cardRows(c, year).forEach((r, i) => {
    const y = p.y + m.head + 0.03 + i * m.row;
    s.addText(r.label, { x: p.x + 0.1, y, w: lw, h: m.row, valign: "middle", fontFace: FONT, fontSize: fs, color: MUTED, margin: 0, objectName: cTag(c, `row-${i}-label`) });
    s.addText(r.value, { x: p.x + 0.1 + lw, y, w: f.cardW - 0.2 - lw, h: m.row, align: "right", valign: "middle", fontFace: FONT, fontSize: fitPt(r.value, fs, f.cardW - 0.2 - lw, 1, 6), bold: true, color: r.missing ? AMBER : INK, margin: 0, objectName: cTag(c, `row-${i}-value`) });
  });
}

/** 준공 연대 색 + 크기 = 세대수 범례 판. 아래 가장자리(bottom)에 붙고, 폭(maxW)을 넘으면 줄을 바꾼다 */
function calloutLegend(s: Slide, model: CalloutModel, x: number, bottom: number, maxW: number) {
  const entries = [{ text: model.legend.title, color: null as string | null }, ...model.legend.items.map((it) => ({ text: it.label, color: it.color })), { text: model.legend.sizeLabel, color: null }];
  const rows: Array<Array<{ text: string; color: string | null; x: number; w: number }>> = [[]];
  let cx = 0;
  for (const e of entries) {
    const w = (e.color ? 0.22 : 0.04) + textIn(e.text, 9) + 0.1;
    if (cx > 0 && cx + w > maxW - 0.3) {
      rows.push([]);
      cx = 0;
    }
    rows.at(-1)!.push({ ...e, x: cx, w });
    cx += w;
  }
  const w = Math.min(maxW, Math.max(...rows.map((r) => r.reduce((a, i) => a + i.w, 0))) + 0.3);
  const h = 0.14 + rows.length * 0.24;
  const r = { x, y: bottom - h, w, h };
  plate(s, r);
  rows.forEach((row, ri) =>
    row.forEach((e) => {
      const y = r.y + 0.07 + ri * 0.24;
      if (e.color) s.addShape("ellipse", { x: r.x + 0.15 + e.x, y: y + 0.06, w: 0.12, h: 0.12, fill: { color: hex(e.color) }, line: { color: INK, width: 0.5, transparency: 55 } });
      s.addText(e.text, { x: r.x + 0.15 + e.x + (e.color ? 0.16 : 0), y, w: e.w, h: 0.24, valign: "middle", fontFace: FONT, fontSize: 9, bold: !e.color, color: e.color ? INK : MUTED, margin: 0 });
    }),
  );
}

/** 개요 장: 번호 점 전체 + 왼쪽 아래 핵심 값 카드 + 범례 (오른쪽 정보 판은 tile()이 그린다) */
function calloutOverview(s: Slide, p: PlannedSlide & { kind: "tile" }) {
  const cm = p.callout!.model;
  const proj = projector(cm, slideSiteX(), SLIDE_OVERVIEW_FILL);
  const hMax = Math.max(0, ...cm.complexes.map((c) => c.households ?? 0));
  cm.complexes.forEach((c) => numberDot(s, c, proj(c), dotRadius(c.households, hMax, INCH.rMin, INCH.rMax)));
  if (cm.complexes.length === 0) {
    const w = 4.6;
    const h = 1.2;
    // 대지 표시를 가리지 않게 원 아래쪽에 둔다
    const r = { x: slideSiteX() * SLIDE.w - w / 2, y: SLIDE.h / 2 + 0.9, w, h };
    plate(s, r, 0.16);
    s.addText(`반경 안 확인된 ${cm.unit === "곳" ? "사업" : "단지"} 0`, { x: r.x + 0.3, y: r.y + 0.2, w: w - 0.6, h: 0.45, fontFace: FONT, fontSize: 20, bold: true, color: INK, margin: 0 });
    s.addText(`기준 ${cm.sourceLine}`, { x: r.x + 0.3, y: r.y + 0.7, w: w - 0.6, h: 0.35, valign: "top", fontFace: FONT, fontSize: 10.5, color: MUTED, margin: 0, fit: "shrink" });
    return;
  }
  if (cm.complexes.length > 0) calloutLegend(s, cm, E, L.legendBottom, L.info.x - 2 * E);
}

/** 개요 장 오른쪽 정보 판의 핵심 값: 단지 수 · 확인 세대(아파트) · 준공 중앙값 (기본 headline 대신) */
function calloutStatItem(s: Slide, cm: CalloutModel): Item {
  const stats = cm.stats.map((t): [string, string, string] => [t.value, t.unit, t.label]);
  const note = cm.statNote;
  const cw = IW / 3;
  return {
    h: 0.86 + (note ? 0.24 : 0),
    draw: (y) => {
      stats.forEach(([v, u, label], i) => {
        const x = IX + i * cw;
        s.addText([{ text: v, options: { fontSize: v.length > 5 ? 15 : 24, bold: true, color: INK } }, { text: u ? ` ${u}` : "", options: { fontSize: 10, color: MUTED } }], { x, y, w: cw - 0.05, h: 0.6, valign: "middle", fontFace: FONT, margin: 0 });
        s.addText(label, { x, y: y + 0.6, w: cw - 0.05, h: 0.24, valign: "middle", fontFace: FONT, fontSize: 9, color: MUTED, margin: 0 });
      });
      if (note) s.addText(note, { x: IX, y: y + 0.86, w: IW, h: 0.22, valign: "middle", fontFace: FONT, fontSize: 9, color: MUTED, margin: 0, fit: "shrink" });
    },
  };
}

/** 설명표 장: 번호 점 + 무교차 지시선 + 좌우 표 */
function calloutPage(s: Slide, p: PlannedSlide & { kind: "tile" }) {
  const { model: cm, page } = p.callout!;
  const items = pageItems(cm.complexes, page);
  const f = slideCalloutFrame(rowsFor(items));
  const proj = projector(cm, f.siteX, f.fill);
  const hMax = Math.max(0, ...cm.complexes.map((c) => c.households ?? 0));
  const at = new Map(cm.complexes.map((c) => [c.id, proj(c)]));
  // 다른 장의 단지는 작은 점만 (같은 지도 범위)
  cm.complexes.filter((c) => !items.includes(c)).forEach((c) => {
    const [x, y] = at.get(c.id)!;
    s.addShape("ellipse", { x: x - 0.045, y: y - 0.045, w: 0.09, h: 0.09, fill: { color: hex(dotColor(c)), transparency: 40 }, line: { color: "FFFFFF", width: 0.5 } });
  });
  const { placed } = layoutCallouts(f, items.map((c) => ({ id: c.id, x: at.get(c.id)![0], y: at.get(c.id)![1] })));
  const byId = new Map(items.map((c) => [c.id, c]));
  for (const pl of placed) {
    const c = byId.get(pl.id)!;
    seg(s, pl.dot, pl.knee, "FFFFFF", 3.4, 8, cTag(c, "leader-halo-1"));
    seg(s, pl.knee, pl.edge, "FFFFFF", 3.4, 8, cTag(c, "leader-halo-2"));
    seg(s, pl.dot, pl.knee, INK, 1, 0, cTag(c, "leader-1"));
    seg(s, pl.knee, pl.edge, INK, 1, 0, cTag(c, "leader-2"));
  }
  for (const pl of placed) numberDot(s, byId.get(pl.id)!, pl.dot, dotRadius(byId.get(pl.id)!.households, hMax, INCH.rMin, INCH.rMax));
  for (const pl of placed) calloutCard(s, byId.get(pl.id)!, pl, f, cm.analysisYear);
  calloutLegend(s, cm, f.left.x1 + 0.35, L.legendBottom, f.right.x0 - f.left.x1 - 0.7);
}

function cover(pptx: PptxGenJS, p: PlannedSlide & { kind: "cover" }, images: MapImages) {
  const s = pptx.addSlide();
  background(s, images[COVER_MAP_KEY]);
  // 왼쪽 큰 제목 판
  const tw = 5.7;
  const ad = p.address;
  const apt = fitPt(ad, 28, tw - 0.6, 2, 16);
  const ah = linesOf(ad, apt, tw - 0.6) * (apt / 72) * 1.35 + 0.05;
  const metricsH = 0.62 * 2;
  const chipH = p.incomplete ? 0.42 : 0;
  const th = 0.25 + 0.3 + ah + 0.15 + metricsH + 0.3 + chipH + 0.2;
  plate(s, { x: E, y: E, w: tw, h: th }, 0.16);
  let y = E + 0.22;
  s.addText("사이트 분석 보고서", { x: E + 0.3, y, w: tw - 0.6, h: 0.26, fontFace: FONT, fontSize: 11, bold: true, color: MUTED, margin: 0 });
  y += 0.3;
  s.addText(ad, { x: E + 0.3, y, w: tw - 0.6, h: ah, valign: "top", fontFace: FONT, fontSize: apt, bold: true, color: INK, margin: 0 });
  y += ah + 0.15;
  p.metrics.forEach((m, i) => {
    const x = E + 0.3 + (i % 2) * ((tw - 0.6) / 2);
    const my = y + Math.floor(i / 2) * 0.62;
    s.addText(m.label, { x, y: my, w: (tw - 0.6) / 2 - 0.1, h: 0.22, fontFace: FONT, fontSize: 10, color: MUTED, margin: 0 });
    s.addText(m.value, { x, y: my + 0.22, w: (tw - 0.6) / 2 - 0.1, h: 0.36, valign: "middle", fontFace: FONT, fontSize: fitPt(m.value, 17, (tw - 0.6) / 2 - 0.1, 1, 11), bold: true, color: INK, margin: 0 });
  });
  y += metricsH + 0.1;
  s.addText(p.asOfLine, { x: E + 0.3, y, w: tw - 0.6, h: 0.26, valign: "middle", fontFace: FONT, fontSize: 11, color: MUTED, margin: 0 });
  if (p.incomplete) chipRows(s, [{ text: p.incomplete, tone: "status" }], E + 0.3, y + 0.36, tw - 0.6, true);

  // 오른쪽 타일 목록 판
  const lw = 5.6;
  const rowH = Math.min(0.4, 6.0 / Math.max(1, p.lines.length));
  const lh = 0.62 + p.lines.length * rowH + 0.12;
  const lx = SLIDE.w - E - lw;
  plate(s, { x: lx, y: E, w: lw, h: Math.min(lh, L.info.h) }, 0.16);
  s.addText("타일", { x: lx + 0.3, y: E + 0.18, w: lw - 0.6, h: 0.28, fontFace: FONT, fontSize: 11, bold: true, color: MUTED, margin: 0 });
  p.lines.forEach((l, i) => {
    const ry = E + 0.55 + i * rowH;
    s.addShape("ellipse", { x: lx + 0.3, y: ry + rowH / 2 - 0.06, w: 0.12, h: 0.12, fill: { color: hex(l.color) }, line: { color: hex(l.color) } });
    const text = `${l.title}  ${l.text}`;
    s.addText(
      [
        { text: `${l.title}  `, options: { bold: true, color: INK } },
        { text: l.text, options: { color: MUTED } },
      ],
      { x: lx + 0.52, y: ry, w: lw - 0.85, h: rowH, valign: "middle", fontFace: FONT, fontSize: fitPt(text, 11, lw - 0.85, 1, 8), margin: 0 },
    );
  });
  strip(s, p, !!p.map);
}

function tile(pptx: PptxGenJS, p: PlannedSlide & { kind: "tile" }, images: MapImages) {
  const v = p.view;
  const s = pptx.addSlide();
  const chart = !p.map && !p.mass && !p.rose; // 도판 구성비 면: 연한 타일색 바탕에 차트가 전면
  const mix = (c: string, a: number) => {
    const n = parseInt(hex(c), 16);
    const ch = (sh: number) => Math.round(255 - (255 - ((n >> sh) & 255)) * a);
    return [16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, "0")).join("").toUpperCase();
  };
  const co = p.callout;
  background(s, chart ? undefined : images[mapKeyOf(p) ?? v.tileId], chart ? mix(v.color, 0.07) : undefined);
  const coTail = co ? (co.page === 0 ? `개요 · 전체 ${fmtInt(co.model.complexes.length)}${co.model.unit}` : pageRange(co.page, co.model.complexes.length, undefined, co.model.kind === "supply")) : null;
  titlePlate(s, v.color, v.code, v.title, [v.kindLabel, p.faceLabel, coTail].filter((t, i, a) => t && a.indexOf(t) === i).join(" · "), co && co.page > 0 ? SLIDE.w - 2 * E : L.info.x - 2 * E);
  if (co && co.page > 0) {
    calloutPage(s, p);
    strip(s, p, true);
    return;
  }

  const notes = [
    ...v.caveats,
    ...v.notes,
    ...(v.code === "S01" ? ["DXF·GLB는 내보내기에서"] : []),
    ...(p.rose ? [roseSummary(p.rose), `바람장미 선택 계절 · ${ROSE_SEASON_LABEL[p.roseSeason ?? "annual"]}`] : []),
  ];
  const items: Item[] = [];
  const b = badgeItem(s, v.badges);
  if (b) items.push(b);

  if (p.body.kind === "state") {
    // 상태 화면: 흐린 대지 지도 가운데 판
    const w = 5.0;
    const msg = p.body.message;
    const pt = fitPt(msg, 20, w - 0.6, 2, 13);
    const h = 0.4 + linesOf(msg, pt, w - 0.6) * (pt / 72) * 1.4 + 0.75;
    const r = { x: (L.info.x - w) / 2, y: (SLIDE.h - h) / 2, w, h };
    plate(s, r, 0.16);
    s.addText(msg, { x: r.x + 0.3, y: r.y + 0.22, w: w - 0.6, h: h - 0.9, valign: "top", fontFace: FONT, fontSize: pt, bold: true, color: INK, margin: 0 });
    s.addText("이 타일의 수치는 만들지 않았습니다. 조건을 바꾸거나 다시 계산한 뒤 보고서를 만들 수 있습니다.", { x: r.x + 0.3, y: r.y + h - 0.68, w: w - 0.6, h: 0.5, valign: "top", fontFace: FONT, fontSize: 10.5, color: MUTED, margin: 0 });
    notes.forEach((n) => items.push(textItem(s, n, 10, MUTED)));
    infoPanel(s, items);
    strip(s, p, true);
    return;
  }

  if (co && co.model.complexes.length > 0) items.push(calloutStatItem(s, co.model));
  else if (v.headline) items.push(...headlineItems(s, v.headline));
  if (v.sentence) items.push(textItem(s, v.sentence, 12.5, INK, true, 5));
  if (v.filterLine) items.push(textItem(s, v.filterLine, 10, MUTED, true, 2));
  // 도판(지도) 면에 구성비 수치를 반복하지 않는다
  const rows = p.body.face === "front" || p.body.face === "back" ? [] : v.rows.filter((r) => r.label !== v.headline?.label).slice(0, 5);
  if (rows.length) items.push(...rowItems(s, rows));
  if (v.grades.length > 0) items.push(textItem(s, v.grades.map((g) => `${g.label} · ${g.criteria}`).join("\n"), 9, MUTED, false, 4));
  else if (v.grade) items.push(textItem(s, `거리 등급 ${v.grade.label} · ${v.grade.criteria}`, 9, MUTED, false, 3));
  if (notes.length) items.push(textItem(s, notes.join("\n"), 9, MUTED, false, 5));

  if (chart) {
    // 전면 구성비 차트 (왼쪽 영역)
    const data = v.chart ?? [];
    const max = Math.max(1, ...data.map((c) => c.value));
    const x0 = E + 0.2;
    const y0 = L.title.y + L.title.h + 0.4;
    const y1 = L.strip.y - 0.4;
    const rh = Math.min(0.72, (y1 - y0) / Math.max(1, data.length));
    const labW = 1.9;
    const trackW = L.info.x - E - 0.4 - x0 - labW - 1.0;
    data.forEach((c, i) => {
      const y = y0 + i * rh;
      s.addText(c.label, { x: x0, y, w: labW, h: rh, valign: "middle", fontFace: FONT, fontSize: 14, bold: true, color: "454A55", margin: 0 });
      s.addShape("rect", { x: x0 + labW, y: y + rh * 0.2, w: trackW, h: rh * 0.6, fill: { color: INK, transparency: 95 }, line: { color: INK, width: 0, transparency: 100 } });
      s.addShape("rect", { x: x0 + labW, y: y + rh * 0.2, w: Math.max(0.04, (trackW * c.value) / max), h: rh * 0.6, fill: { color: hex(STRIP_COLORS[i % STRIP_COLORS.length]) }, line: { color: hex(STRIP_COLORS[i % STRIP_COLORS.length]), width: 0 } });
      s.addText(`${c.value}${c.unit === "%" ? "%" : ` ${c.unit}`}`, { x: x0 + labW + trackW + 0.1, y, w: 0.8, h: rh, align: "right", valign: "middle", fontFace: FONT, fontSize: 14, bold: true, color: INK, margin: 0 });
    });
  } else if (co) calloutOverview(s, p);
  else legendPlate(s, p);

  infoPanel(s, items);
  strip(s, p, !chart);
}

function sheet(pptx: PptxGenJS, p: PlannedSlide & { kind: "sheet" }, images: MapImages) {
  const s = pptx.addSlide();
  s.background = { color: "F2F2EF" };
  titlePlate(s, p.view.color, "SHEET", p.view.title, p.grid, SLIDE.w - 2 * E);
  const cells = sheetCells(p.grid as SheetGrid);
  for (const [index, cell] of p.cells.entries()) {
    const r = cells[index];
    if (!r) continue;
    s.addShape("roundRect", { x: r.x, y: r.y, w: r.w, h: r.h, rectRadius: 0.08, fill: { color: "FFFFFF" }, line: { color: LINE, width: 0.75 } });
    const chart = cell.face === "back" && cell.view.chart;
    if (chart) {
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
    } else if (images[cell.mapKey]) {
      s.addImage({ data: images[cell.mapKey], x: r.x, y: r.y, w: r.w, h: r.h, sizing: { type: "contain", w: r.w, h: r.h }, altText: `${cell.view.title} ${cell.face === "back" ? "구성비" : "도판"}` });
    } else {
      s.addText("그림을 만들지 못했습니다", { x: r.x + 0.15, y: r.y + r.h / 2 - 0.12, w: r.w - 0.3, h: 0.25, align: "center", fontFace: FONT, fontSize: 9, color: MUTED, margin: 0 });
    }
    const faceText = cell.face === "back" ? "구성비" : "도판";
    const time = /^\d{2}:\d{2}$/.test(cell.view.notes[0] ?? "") ? cell.view.notes[0] : null;
    const chipText = `${cell.view.code} · ${cell.view.title} · ${faceText}${time ? ` · ${time}` : ""}`;
    s.addShape("roundRect", { x: r.x + 0.1, y: r.y + 0.1, w: Math.min(r.w - 0.2, 2.9), h: 0.3, rectRadius: 0.12, fill: { color: "FFFFFF", transparency: 10 }, line: { color: INK, transparency: 88, width: 0.5 } });
    s.addText(chipText, { x: r.x + 0.2, y: r.y + 0.1, w: Math.min(r.w - 0.4, 2.7), h: 0.3, valign: "middle", fontFace: FONT, fontSize: fitPt(chipText, 8.5, Math.min(r.w - 0.4, 2.7), 1, 6), bold: true, color: INK, margin: 0, fit: "shrink" });
    s.addText(`출처 ${cell.view.sourceLine}`, { x: r.x + 0.12, y: r.y + r.h - 0.29, w: r.w - 0.24, h: 0.18, fontFace: FONT, fontSize: 7.5, color: MUTED, margin: 0, fit: "shrink" });
  }
  strip(s, p, false);
}

function sources(pptx: PptxGenJS, p: PlannedSlide & { kind: "sources" }, images: MapImages) {
  const s = pptx.addSlide();
  background(s, images[COVER_MAP_KEY]);
  // 지도를 흐리게: 흰 막
  s.addShape("rect", { x: 0, y: 0, w: SLIDE.w, h: SLIDE.h, fill: { color: "FFFFFF", transparency: 25 }, line: { color: "FFFFFF", width: 0, transparency: 100 } });
  titlePlate(s, "#7A7E87", "", "자료 출처와 기준일", "", SLIDE.w - 2 * E);
  const h = Math.min(L.strip.y - 1.4 - 0.3, 0.5 + 0.34 * (p.rows.length + 1));
  const r = { x: E, y: 1.2, w: SLIDE.w - 2 * E, h };
  plate(s, r, 0.16);
  const hd = (t: string) => ({ text: t, options: { fontFace: FONT, fontSize: 11, bold: true, color: MUTED, border: underline(1) } });
  const c = (t: string, bold = false) => ({ text: t, options: { fontFace: FONT, fontSize: 11, bold, color: INK, border: underline(0.75) } });
  const rows = [[hd("출처"), hd("기준일"), hd("사용한 타일")], ...p.rows.map((row) => [c(row.source, true), c(row.asOf), c(row.tiles)])];
  const W = r.w - 0.6;
  s.addTable(rows, { x: r.x + 0.3, y: r.y + 0.2, w: W, colW: [W * 0.25, W * 0.2, W * 0.55], rowH: 0.32, margin: [0, 0.05, 0, 0.05] });
  strip(s, p, !!p.map);
}

export async function renderReportPptx(plan: PlannedSlide[], images: MapImages = {}): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5
  pptx.title = "사이트 분석 보고서";
  for (const p of plan) {
    if (p.kind === "cover") cover(pptx, p, images);
    else if (p.kind === "tile") tile(pptx, p, images);
    else if (p.kind === "sheet") sheet(pptx, p, images);
    else sources(pptx, p, images);
  }
  const bytes = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
  // pptxgenjs는 도형 그룹을 만들지 못한다: 설명선 장의 단지별 도형(GRP| 이름표)을 후처리로 PPT 그룹으로 묶는다
  return plan.some((p) => p.kind === "tile" && p.callout) ? groupTaggedShapes(bytes) : bytes;
}
