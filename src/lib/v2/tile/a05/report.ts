import { GROUP_TAG_PREFIX } from "../../../pptx-shape-group";
import { INCH, SLIDE_OVERVIEW_FILL, cardName, cardRows, dotColor, dotRadius, inkOn, layoutCallouts, overlapChip, pageItems, rowsFor, slideCalloutFrame, type CalloutFrame, type Complex, type Placed, type Pt } from "../../ui/callout-layout";
import { framedViewport, makeProjector } from "../../ui/map-projection";
import { slideSiteX } from "../../ui/overlay-layout";
import type { CalloutModel } from "../../ui/tile-view";
import { unitTypeSummaryParts } from "../../unit-types";
import { E, FONT, INK, IW, IX, L, MUTED, SLIDE, fitPt, hex, plate, seg, textIn, type ReportItem, type Slide } from "../../report/pptx-kit";
import type { PlannedSlide } from "../../report/report-plan";
import type { TileReportRenderContext } from "../../report/types";
import type { TileClientModule } from "../types";

// The A05 and A06 callout pages are one ownership unit, matching their shared screen Stage.
const AMBER = "9A5B00";
const K = SLIDE.w / 960;
const cTag = (c: Complex, part: string) => `${GROUP_TAG_PREFIX}callout-${c.id}|${`콜아웃 ${c.rank} ${cardName(c)}`.replace(/\|/g, "/")}|${part}`;

function projector(model: CalloutModel, siteX: number, fill: number): (c: Complex) => Pt {
  const pr = makeProjector(framedViewport(model.center, model.radiusM, 960, 540, siteX, fill));
  return (c) => {
    const [x, y] = pr(c.lng, c.lat);
    return [x * K, y * K];
  };
}

function numberDot(s: Slide, c: Complex, at: Pt, r: number) {
  const color = dotColor(c);
  s.addShape("ellipse", { x: at[0] - r - 0.025, y: at[1] - r - 0.025, w: 2 * r + 0.05, h: 2 * r + 0.05, fill: { color: "FFFFFF", transparency: 8 }, line: { color: "FFFFFF", width: 0, transparency: 100 }, objectName: cTag(c, "dot-halo") });
  s.addShape("ellipse", { x: at[0] - r, y: at[1] - r, w: 2 * r, h: 2 * r, fill: { color: hex(color) }, line: { color: INK, width: 0.5, transparency: 50 }, objectName: cTag(c, "dot") });
  s.addText(String(c.rank), { x: at[0] - r, y: at[1] - r, w: 2 * r, h: 2 * r, align: "center", valign: "middle", fontFace: FONT, fontSize: r >= 0.17 ? 9 : 8, bold: true, color: hex(inkOn(color)), margin: 0, objectName: cTag(c, "dot-no") });
}

function unitTypeLines(value: string, fontSize: number, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const part of unitTypeSummaryParts(value)) {
    const candidate = current ? `${current} · ${part}` : part;
    if (current && textIn(candidate, fontSize) > width) {
      lines.push(current);
      current = part;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [value];
}

function fitUnitTypeValue(value: string, maxPt: number, width: number): { fontSize: number; lines: string[] } {
  for (let fontSize = maxPt; fontSize >= 6; fontSize -= 0.5) {
    const lines = unitTypeLines(value, fontSize, width);
    if (lines.length <= 2) return { fontSize, lines };
  }
  return { fontSize: 6, lines: unitTypeLines(value, 6, width) };
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
  let y = p.y + m.head + 0.03;
  cardRows(c, year).forEach((r, i) => {
    const lw = r.label === "입주(예정) 시기" ? 1.0 : 0.55;
    const valueW = f.cardW - 0.2 - lw;
    const fitted = r.unitType ? fitUnitTypeValue(r.value, fs, valueW) : { fontSize: fitPt(r.value, fs, valueW, 1, 6), lines: [r.value] };
    const rowH = r.unitType ? m.row * 2 : m.row;
    s.addText(r.label, { x: p.x + 0.1, y, w: lw, h: rowH, valign: "middle", fontFace: FONT, fontSize: fs, color: MUTED, margin: 0, objectName: cTag(c, `row-${i}-label`) });
    s.addText(fitted.lines.join("\n"), { x: p.x + 0.1 + lw, y, w: valueW, h: rowH, align: "right", valign: "middle", fontFace: FONT, fontSize: fitted.fontSize, bold: true, color: r.missing ? AMBER : INK, margin: 0, objectName: cTag(c, `row-${i}-value`) });
    y += rowH;
  });
}

/** 준공 연대 색 + 크기 = 세대수 범례 판. 아래 가장자리(bottom)에 붙고, 폭(maxW)을 넘으면 줄을 바꾄다 */
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

/** 개요 장: 번호 점 전체 + 왼쪽 아래 핵심 값 카드 + 범례 (오른쪽 정보 판은 공용 renderer가 그린다) */
function calloutOverview(s: Slide, p: PlannedSlide & { kind: "tile" }) {
  const cm = p.callout!.model;
  const proj = projector(cm, slideSiteX(), SLIDE_OVERVIEW_FILL);
  const hMax = Math.max(0, ...cm.complexes.map((c) => c.households ?? 0));
  cm.complexes.forEach((c) => numberDot(s, c, proj(c), dotRadius(c.households, hMax, INCH.rMin, INCH.rMax)));
  if (cm.complexes.length === 0) {
    const w = 4.6;
    const h = 1.2;
    const r = { x: slideSiteX() * SLIDE.w - w / 2, y: SLIDE.h / 2 + 0.9, w, h };
    plate(s, r, 0.16);
    s.addText(`반경 안 확인된 ${cm.unit === "곳" ? "사업" : "단지"} 0`, { x: r.x + 0.3, y: r.y + 0.2, w: w - 0.6, h: 0.45, fontFace: FONT, fontSize: 20, bold: true, color: INK, margin: 0 });
    s.addText(`기준 ${cm.sourceLine}`, { x: r.x + 0.3, y: r.y + 0.7, w: w - 0.6, h: 0.35, valign: "top", fontFace: FONT, fontSize: 10.5, color: MUTED, margin: 0, fit: "shrink" });
    return;
  }
  calloutLegend(s, cm, E, L.legendBottom, L.info.x - 2 * E);
}

/** 개요 장 오른쪽 정보 판의 핵심 값: 단지 수 · 확인 세대(아파트) · 준공 중앙값 */
function calloutStatItem(s: Slide, cm: CalloutModel): ReportItem {
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
  cm.complexes.filter((c) => !items.includes(c)).forEach((c) => {
    const [x, y] = at.get(c.id)!;
    s.addShape("ellipse", { x: x - 0.045, y: y - 0.045, w: 0.09, h: 0.09, fill: { color: hex(dotColor(c)), transparency: 40 }, line: { color: "FFFFFF", width: 0.5 } });
  });
  const { placed } = layoutCallouts(f, items.map((c) => ({ id: c.id, rank: c.rank, x: at.get(c.id)![0], y: at.get(c.id)![1] })));
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

function renderCallout({ slide, planned, part }: TileReportRenderContext): ReportItem | void {
  if (!planned.callout) return;
  if (part === "page") {
    calloutPage(slide, planned);
    return;
  }
  if (part === "overview") {
    calloutOverview(slide, planned);
    return;
  }
  if (planned.callout.model.complexes.length > 0) return calloutStatItem(slide, planned.callout.model);
}

const report = { render: renderCallout };

export const a05ReportModule = { code: "A05", report } satisfies Pick<TileClientModule, "code" | "report">;
export const a06ReportModule = { code: "A06", report } satisfies Pick<TileClientModule, "code" | "report">;
