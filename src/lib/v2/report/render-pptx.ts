/** 슬라이드 계획 → .pptx (pptxgenjs, 16:9, Alt4 톤). 브라우저·Node 공용. */
import PptxGenJS from "pptxgenjs";
import { PPT_FONT_MAIN as FONT } from "../../ppt-design-config";
import type { Badge } from "../ui/tile-view";
import { COVER_MAP_KEY, type PlannedSlide } from "./report-plan";

/** 지도 이미지(PNG data URL) — 키는 report-plan의 mapKeyOf */
export type MapImages = Record<string, string>;

type Slide = ReturnType<PptxGenJS["addSlide"]>;

const BG = "EEF0F3";
const INK = "16181D";
const MUTED = "676C76";
const LINE = "E2E4E9";
const CARD_X = 0.5;
const X0 = 0.95; // 카드 안쪽 여백
const W = 11.43; // 안쪽 폭
const hex = (c: string) => c.replace("#", "");
type Border = PptxGenJS.BorderProps;
const underline = (pt: number): [Border, Border, Border, Border] => [{ type: "none" }, { type: "none" }, { type: "solid", pt, color: LINE }, { type: "none" }];

const CHIP: Record<Badge["tone"], { fill: string; color: string }> = {
  status: { fill: "FCE9C7", color: "7A4B00" },
  limit: { fill: "F0E8DC", color: "5B4A2F" },
  model: { fill: "E6E1F7", color: "3D2E8C" },
};
const BAR_COLORS = ["8C5A3C", "A0522D", "C77B4A", "D9A06B", "E8C39A", "F1DCC0", "C9CCD3"];

function chips(s: Slide, items: { text: string; tone: Badge["tone"] }[], x: number, y: number, maxX: number) {
  let cx = x;
  for (const b of items) {
    const w = b.text.length * 0.13 + 0.32;
    if (cx + w > maxX) break;
    s.addShape("roundRect", { x: cx, y, w, h: 0.32, fill: { color: CHIP[b.tone].fill }, line: { color: CHIP[b.tone].fill }, rectRadius: 0.16 });
    s.addText(b.text, { x: cx, y, w, h: 0.32, align: "center", valign: "middle", fontFace: FONT, fontSize: 10, bold: true, color: CHIP[b.tone].color, margin: 0 });
    cx += w + 0.1;
  }
}

function frame(pptx: PptxGenJS, p: PlannedSlide): Slide {
  const s = pptx.addSlide();
  s.background = { color: BG };
  s.addShape("roundRect", { x: CARD_X, y: 0.35, w: 12.33, h: 6.8, fill: { color: "FFFFFF" }, line: { color: "FFFFFF" }, rectRadius: 0.12 });
  s.addShape("line", { x: X0, y: 6.42, w: W, h: 0, line: { color: LINE, width: 0.75 } });
  s.addText(p.footer, { x: X0, y: 6.48, w: W - 1.2, h: 0.5, valign: "top", fontFace: FONT, fontSize: 9, color: MUTED, margin: 0, fit: "shrink" });
  s.addText(`${p.no} / ${p.total}`, { x: X0 + W - 1.1, y: 6.48, w: 1.1, h: 0.3, align: "right", valign: "top", fontFace: FONT, fontSize: 9, color: MUTED, margin: 0 });
  return s;
}

function heading(s: Slide, color: string, kicker: string, title: string) {
  s.addText(kicker, { x: X0, y: 0.6, w: 8, h: 0.28, fontFace: FONT, fontSize: 10, bold: true, color: MUTED, margin: 0 });
  s.addShape("ellipse", { x: X0, y: 1.02, w: 0.2, h: 0.2, fill: { color: hex(color) }, line: { color: hex(color) } });
  s.addText(title, { x: X0 + 0.32, y: 0.9, w: W - 0.4, h: 0.45, valign: "middle", fontFace: FONT, fontSize: 24, bold: true, color: INK, margin: 0 });
}

function note(s: Slide, lines: string[], y: number, h: number) {
  if (lines.length) s.addText(lines.map((t) => ({ text: t, options: { breakLine: true } })), { x: X0, y, w: W, h, valign: "top", fontFace: FONT, fontSize: 10, color: MUTED, margin: 0, paraSpaceAfter: 2 });
}

/** 지도 그림 자리(가로:세로 = 1.6:1). 이미지를 못 만들었으면 자리표시 사각형이 들어간다. */
function mapBox(s: Slide, data: string | undefined, x: number, y: number, w: number) {
  const h = w / 1.6;
  if (data) s.addImage({ data, x, y, w, h });
  else {
    s.addShape("rect", { x, y, w, h, fill: { color: "F2F2EF" }, line: { color: LINE, width: 0.75 } });
    s.addText("지도 이미지를 만들지 못했습니다", { x, y, w, h, align: "center", valign: "middle", fontFace: FONT, fontSize: 11, color: MUTED, margin: 0 });
  }
}

function cover(pptx: PptxGenJS, p: PlannedSlide & { kind: "cover" }, images: MapImages) {
  const s = frame(pptx, p);
  s.addText("사이트 분석 보고서", { x: X0, y: 0.6, w: 8, h: 0.3, fontFace: FONT, fontSize: 11, bold: true, color: MUTED, margin: 0 });
  s.addText(p.address, { x: X0, y: 0.95, w: W, h: 0.7, valign: "middle", fontFace: FONT, fontSize: 28, bold: true, color: INK, margin: 0, fit: "shrink" });
  const mp = !!p.map; // 지도가 있으면 지표는 왼쪽 2×2, 지도는 오른쪽
  const cols = mp ? 2 : p.metrics.length;
  const cw = mp ? 3.05 : W / p.metrics.length;
  p.metrics.forEach((m, i) => {
    const x = X0 + (i % cols) * cw;
    const y = 1.85 + Math.floor(i / cols) * 0.95;
    s.addText(m.label, { x, y, w: cw - 0.1, h: 0.28, fontFace: FONT, fontSize: 10, color: MUTED, margin: 0 });
    s.addText(m.value, { x, y: y + 0.28, w: cw - 0.1, h: 0.5, valign: "middle", fontFace: FONT, fontSize: mp ? 18 : 20, bold: true, color: INK, margin: 0, fit: "shrink" });
  });
  if (p.map) mapBox(s, images[COVER_MAP_KEY], X0 + 6.35, 1.8, 5.08);
  const infoY = mp ? 3.85 : 2.85;
  s.addText(p.asOfLine, { x: X0, y: infoY, w: mp ? 6 : 5.5, h: 0.32, valign: "middle", fontFace: FONT, fontSize: 11, color: MUTED, margin: 0 });
  if (p.incomplete) chips(s, [{ text: p.incomplete, tone: "status" }], mp ? X0 : X0 + 5.6, mp ? infoY + 0.42 : infoY, mp ? X0 + 6 : X0 + W);
  const ruleY = mp ? 5.05 : 3.4;
  s.addShape("line", { x: X0, y: ruleY, w: W, h: 0, line: { color: LINE, width: 0.75 } });
  const half = Math.ceil(p.lines.length / 2);
  const colW = W / 2 - 0.2;
  const rowH = Math.min(0.42, (mp ? 1.25 : 2.7) / Math.max(half, 1));
  p.lines.forEach((l, i) => {
    const col = i < half ? 0 : 1;
    const row = col === 0 ? i : i - half;
    const x = X0 + col * (colW + 0.4);
    const y = ruleY + 0.15 + row * rowH;
    s.addShape("ellipse", { x, y: y + rowH / 2 - 0.06, w: 0.12, h: 0.12, fill: { color: hex(l.color) }, line: { color: hex(l.color) } });
    s.addText(
      [
        { text: `${l.title}  `, options: { bold: true, color: INK } },
        { text: l.text, options: { color: MUTED } },
      ],
      { x: x + 0.22, y, w: colW - 0.22, h: rowH, valign: "middle", fontFace: FONT, fontSize: 11, margin: 0, fit: "shrink" },
    );
  });
}

function tile(pptx: PptxGenJS, p: PlannedSlide & { kind: "tile" }, images: MapImages) {
  const v = p.view;
  const s = frame(pptx, p);
  heading(s, v.color, `${v.code}${p.faceLabel ? ` · ${p.faceLabel}` : ""}`, v.title);
  chips(s, v.badges.map((b) => ({ text: b.text, tone: b.tone })), X0, 1.5, X0 + W);
  const notes = [...v.caveats, ...v.notes];

  if (p.body.kind === "state") {
    s.addText(p.body.message, { x: X0, y: 2.4, w: W, h: 0.8, valign: "middle", fontFace: FONT, fontSize: 26, bold: true, color: INK, margin: 0 });
    s.addText("이 타일의 수치는 만들지 않았습니다. 조건을 바꾸거나 다시 계산한 뒤 보고서를 만들 수 있습니다.", { x: X0, y: 3.3, w: W, h: 0.4, fontFace: FONT, fontSize: 13, color: MUTED, margin: 0 });
    note(s, notes, 4.5, 1.7);
    return;
  }

  if (p.map) {
    // 왼쪽 지도 · 오른쪽 큰 숫자·표·판단, 아래 출처·기준일(프레임 푸터)
    const RX = X0 + 6.85;
    const RW = W - 6.85;
    mapBox(s, images[v.tileId], X0, 1.95, 6.6);
    const h = v.headline;
    if (h) {
      s.addText(h.label, { x: RX, y: 1.95, w: RW, h: 0.3, fontFace: FONT, fontSize: 12, color: MUTED, margin: 0, fit: "shrink" });
      s.addText(h.value, { x: RX, y: 2.25, w: RW, h: 0.8, valign: "middle", fontFace: FONT, fontSize: 34, bold: true, color: INK, margin: 0, fit: "shrink" });
      const sub = [h.aux, h.tag].filter(Boolean).join(" · ");
      if (sub) s.addText(sub, { x: RX, y: 3.05, w: RW, h: 0.28, fontFace: FONT, fontSize: 11, color: MUTED, margin: 0 });
    }
    const rows = v.rows.filter((r) => r.label !== h?.label).slice(0, 5);
    if (rows.length) {
      const cell = (text: string, o: { bold?: boolean; right?: boolean; color?: string } = {}) => ({
        text,
        options: { fontFace: FONT, fontSize: 11, bold: o.bold, color: o.color ?? INK, align: (o.right ? "right" : "left") as "right" | "left", valign: "middle" as const, border: underline(0.75) },
      });
      s.addTable(rows.map((r) => [cell(r.label, { color: MUTED }), cell([r.value, r.aux, r.tag].filter(Boolean).join(" · "), { bold: true, right: true })]), {
        x: RX, y: 3.4, w: RW, colW: [RW * 0.55, RW * 0.45], rowH: 0.3, margin: [0, 0.05, 0, 0.05],
      });
    }
    if (v.sentence) s.addText(v.sentence, { x: RX, y: 5.0, w: RW, h: 0.75, valign: "top", fontFace: FONT, fontSize: 12, bold: true, color: INK, margin: 0, fit: "shrink" });
    if (v.grade) notes.unshift(`거리 등급 ${v.grade.label} · ${v.grade.criteria}`);
    if (notes.length) s.addText(notes.map((t) => ({ text: t, options: { breakLine: true } })), { x: RX, y: 5.78, w: RW, h: 0.62, valign: "top", fontFace: FONT, fontSize: 8.5, color: MUTED, margin: 0, paraSpaceAfter: 1, fit: "shrink" });
    return;
  }

  const head = v.headline;
  if (head && p.body.face !== "back") {
    s.addText(head.label, { x: X0, y: 2.05, w: 4.3, h: 0.3, fontFace: FONT, fontSize: 12, color: MUTED, margin: 0 });
    s.addText(head.value, { x: X0, y: 2.35, w: 4.3, h: 0.9, valign: "middle", fontFace: FONT, fontSize: 40, bold: true, color: INK, margin: 0, fit: "shrink" });
    const sub = [head.aux, head.tag].filter(Boolean).join(" · ");
    if (sub) s.addText(sub, { x: X0, y: 3.25, w: 4.3, h: 0.3, fontFace: FONT, fontSize: 11, color: MUTED, margin: 0 });
  }

  if (p.body.face === "front" && v.chart) {
    // 도판: 구성비 가로 누적 막대
    const total = v.chart.reduce((a, c) => a + c.value, 0) || 1;
    const bx = X0;
    const by = 3.45;
    let cx = bx;
    v.chart.forEach((c, i) => {
      const w = (W * c.value) / total;
      s.addShape("rect", { x: cx, y: by, w, h: 0.55, fill: { color: BAR_COLORS[i % BAR_COLORS.length] }, line: { color: "FFFFFF", width: 1 } });
      cx += w;
    });
    const per = 4;
    const lw = W / per;
    v.chart.forEach((c, i) => {
      const x = bx + (i % per) * lw;
      const y = by + 0.68 + Math.floor(i / per) * 0.32;
      s.addShape("rect", { x, y: y + 0.09, w: 0.14, h: 0.14, fill: { color: BAR_COLORS[i % BAR_COLORS.length] }, line: { color: BAR_COLORS[i % BAR_COLORS.length] } });
      s.addText(`${c.label}  ${c.value}%`, { x: x + 0.22, y, w: lw - 0.3, h: 0.32, valign: "middle", fontFace: FONT, fontSize: 11, color: INK, margin: 0 });
    });
  } else if (v.rows.length) {
    // 구성비/일반: 표
    const wide = p.body.face === "back";
    const tx = wide ? X0 : X0 + 4.6;
    const tw = wide ? W : W - 4.6;
    const y = wide ? 2.0 : 2.05;
    const cell = (text: string, o: { bold?: boolean; right?: boolean; color?: string } = {}) => ({
      text,
      options: { fontFace: FONT, fontSize: 12, bold: o.bold, color: o.color ?? INK, align: (o.right ? "right" : "left") as "right" | "left", valign: "middle" as const, border: underline(0.75) },
    });
    const rows = v.rows.map((r) => [cell(r.label, { color: MUTED }), cell([r.value, r.aux, r.tag].filter(Boolean).join(" · "), { bold: true, right: true })]);
    s.addTable(rows, { x: tx, y, w: tw, colW: [tw * 0.55, tw * 0.45], rowH: 0.34, margin: [0, 0.05, 0, 0.05] });
  }

  if (v.sentence) s.addText(v.sentence, { x: X0, y: 4.75, w: W, h: 0.6, valign: "middle", fontFace: FONT, fontSize: 14, bold: true, color: INK, margin: 0, fit: "shrink" });
  if (v.grade) notes.unshift(`거리 등급 ${v.grade.label} · ${v.grade.criteria}`);
  note(s, notes, 5.4, 0.95);
}

function sources(pptx: PptxGenJS, p: PlannedSlide & { kind: "sources" }) {
  const s = frame(pptx, p);
  heading(s, "#7A7E87", "출처", "자료 출처와 기준일");
  const h = (t: string) => ({ text: t, options: { fontFace: FONT, fontSize: 11, bold: true, color: MUTED, border: underline(1) } });
  const c = (t: string, bold = false) => ({ text: t, options: { fontFace: FONT, fontSize: 11, bold, color: INK, border: underline(0.75) } });
  const rows = [[h("출처"), h("기준일"), h("사용한 타일")], ...p.rows.map((r) => [c(r.source, true), c(r.asOf), c(r.tiles)])];
  s.addTable(rows, { x: X0, y: 1.6, w: W, colW: [W * 0.25, W * 0.2, W * 0.55], rowH: 0.3, margin: [0, 0.05, 0, 0.05] });
}

export async function renderReportPptx(plan: PlannedSlide[], images: MapImages = {}): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5
  pptx.title = "사이트 분석 보고서";
  for (const p of plan) {
    if (p.kind === "cover") cover(pptx, p, images);
    else if (p.kind === "tile") tile(pptx, p, images);
    else sources(pptx, p);
  }
  return (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
}
