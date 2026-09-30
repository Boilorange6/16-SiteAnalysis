/**
 * 슬라이드 계획 → .pptx (pptxgenjs, 16:9). 브라우저·Node 공용.
 * 지도 몰입형: 슬라이드 전체가 지도 이미지, 그 위에 반투명 흰 판(편집 가능한 도형·글자)을 얹는다.
 * 판의 자리·여백은 화면 카드/펼침과 같은 문법(ui/overlay-layout)을 쓴다.
 */
import PptxGenJS from "pptxgenjs";
import { PPT_FONT_MAIN as FONT } from "../../ppt-design-config";
import { STRIP_COLORS } from "../ui/map-layers";
import { OV, SLIDE, slideLayout, slideLegend, stripText, type Rect } from "../ui/overlay-layout";
import type { Badge, TileView } from "../ui/tile-view";
import { COVER_MAP_KEY, type PlannedSlide } from "./report-plan";

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
  const { items, notes, rect: r } = slideLegend(model);
  if (!r) return;
  plate(s, r);
  items.forEach((it, i) => {
    const y = r.y + 0.1 + i * 0.25;
    s.addShape("ellipse", { x: r.x + 0.2, y: y + 0.06, w: 0.13, h: 0.13, fill: { color: hex(it.color) }, line: { color: "FFFFFF", width: 0.75 } });
    s.addText(it.label, { x: r.x + 0.45, y, w: r.w - 0.55, h: 0.25, valign: "middle", fontFace: FONT, fontSize: 10, color: INK, margin: 0 });
  });
  notes.forEach((n, i) => {
    s.addText(n, { x: r.x + 0.2, y: r.y + 0.1 + items.length * 0.25 + i * 0.22, w: r.w - 0.3, h: 0.22, valign: "middle", fontFace: FONT, fontSize: 8.5, color: MUTED, margin: 0, fit: "shrink" });
  });
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
  const chart = !p.map; // D04 구성비 면: 연한 타일색 바탕에 차트가 전면
  const mix = (c: string, a: number) => {
    const n = parseInt(hex(c), 16);
    const ch = (sh: number) => Math.round(255 - (255 - ((n >> sh) & 255)) * a);
    return [16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, "0")).join("").toUpperCase();
  };
  background(s, chart ? undefined : images[v.tileId], chart ? mix(v.color, 0.07) : undefined);
  titlePlate(s, v.color, v.code, v.title, [v.kindLabel, p.faceLabel].filter((t, i, a) => t && a.indexOf(t) === i).join(" · "), L.info.x - 2 * E);

  const notes = [...v.caveats, ...v.notes];
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

  if (v.headline) items.push(...headlineItems(s, v.headline));
  if (v.sentence) items.push(textItem(s, v.sentence, 12.5, INK, true, 5));
  // D04는 도판(지도) 면에 구성비 수치를 반복하지 않는다
  const rows = p.body.face === "front" || p.body.face === "back" ? [] : v.rows.filter((r) => r.label !== v.headline?.label).slice(0, 5);
  if (rows.length) items.push(...rowItems(s, rows));
  if (v.grade) items.push(textItem(s, `거리 등급 ${v.grade.label} · ${v.grade.criteria}`, 9, MUTED, false, 3));
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
      s.addText(`${c.value}%`, { x: x0 + labW + trackW + 0.1, y, w: 0.8, h: rh, align: "right", valign: "middle", fontFace: FONT, fontSize: 14, bold: true, color: INK, margin: 0 });
    });
  } else legendPlate(s, p);

  infoPanel(s, items);
  strip(s, p, !chart);
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
    else sources(pptx, p, images);
  }
  return (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
}
