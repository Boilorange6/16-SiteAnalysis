/**
 * 분석 장 그래프 기하. 화면(SVG)과 PPT(도형)가 같은 목록을 그리도록 인치·pt·#rrggbb만 쓰는 중립 도형으로 만든다.
 * 모양은 시안(1280 px 폭 슬라이드, 1 px = 1/96 in)의 compBars·scatter·bandBars를 옮긴 것이다.
 */
import type { CompositionItem, DistanceData } from "./analysis-charts";

export type ChartShape =
  | { kind: "rect"; x: number; y: number; w: number; h: number; fill: string; stroke?: string; name: string }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; stroke: string; width: number; dash?: boolean; name: string }
  | { kind: "dots"; color: string; r: number; opacity: number; points: [number, number][]; stroke?: string; strokeWidth?: number; name: string } // 한 색 = 한 묶음(PPT custGeom 1개). strokeWidth는 pt
  | { kind: "text"; x: number; y: number; w: number; h: number; text: string; pt: number; bold?: boolean; color: string; align: "left" | "right" | "center"; name: string };
export type ChartBox = { x: number; y: number; w: number; h: number }; // 인치

const C = { track: "#f1efea", grid: "#ecebe6", axis: "#77766f", label: "#3b3a35", strong: "#1d1d1b", siteFill: "#f2b6b8", siteStroke: "#c9404a", lightBar: "#b9b4aa", bar: "#9db3d4" };
const PX = 1 / 96;
const AXIS_PT = 7.5; // 시안 10 px
const LABEL_PT = 8.6; // 시안 11.5 px

// 글자 폭·높이는 잴 수 없어 어림한다: 한글 등 넓은 글자는 pt 그대로, 숫자·공백·기호는 0.55배. 상자 겹침·안쪽 판정이 이 값을 쓴다.
const textW = (s: string, pt: number, bold = false) => [...s].reduce((sum, ch) => sum + (ch.charCodeAt(0) >= 0x1100 ? 1 : 0.55), 0) * pt * 0.0139 * (bold ? 1.05 : 1);
const textH = (pt: number) => (pt * 1.3) / 72;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

const group = (n: number) => n.toLocaleString("ko-KR");
/** 눈금·개수 숫자. 연도는 쉼표를 붙이지 않는다. */
const tickText = (v: number, unit: string) => (unit === "년" ? String(Math.round(v)) : group(Math.round(v)));
/** 중앙값은 정수면 정수·아니면 소수 1자리, 평균은 늘 소수 1자리. 연도는 소수 없이. */
const statText = (v: number, unit: string, oneDecimal: boolean) => {
  if (unit === "년") return String(Math.round(v));
  return oneDecimal || !Number.isInteger(v) ? v.toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : group(v);
};
const fit = (s: string, pt: number, maxW: number) => {
  if (textW(s, pt) <= maxW) return s;
  let t = s;
  while (t.length > 1 && textW(`${t}…`, pt) > maxW) t = t.slice(0, -1);
  return `${t}…`;
};
const isLight = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.85;
};

type TextShape = Extract<ChartShape, { kind: "text" }>;
/** 두 글자 상자가 겹친 넓이(맞닿기만 하면 0). */
const overlapArea = (a: TextShape, b: TextShape) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) - 1e-9) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) - 1e-9);

/** 글자 상자를 만들고 box 밖으로 나가지 않게 당겨 놓는다. ax는 정렬 기준 x, y는 상자 위. */
const textMaker = (box: ChartBox, prefix: string) => (name: string, text: string, pt: number, color: string, align: "left" | "right" | "center", ax: number, y: number, bold = false): TextShape => {
  const w = textW(text, pt, bold);
  const h = textH(pt);
  const x0 = align === "left" ? ax : align === "right" ? ax - w : ax - w / 2;
  return { kind: "text", x: clamp(x0, box.x, box.x + box.w - w), y: clamp(y, box.y, box.y + box.h - h), w, h, text, pt, bold, color, align, name: `${prefix}-${name}` };
};

const TITLE_PT = AXIS_PT * 1.15;

/** 제목은 box 맨 위 왼쪽에 굵게 한 줄. 차트는 그 아래 남은 칸에 그린다. 제목이 빈 글이면 box 전부를 차트에 쓴다. */
function withTitle(box: ChartBox, scale: number, title: string, prefix: string, draw: (rest: ChartBox) => ChartShape[]): ChartShape[] {
  if (!title) return draw(box);
  const pt = TITLE_PT * scale;
  const rest = { x: box.x, y: box.y + textH(pt) + 0.04 * scale, w: box.w, h: box.h - textH(pt) - 0.04 * scale };
  const shapes = draw(rest);
  if (!shapes.length) return shapes;
  return [textMaker(box, prefix)("title", fit(title, pt, box.w / 1.05), pt, C.strong, "left", box.x, box.y, true), ...shapes];
}

export function compositionShapes(items: CompositionItem[], box: ChartBox, scale: number, title = ""): ChartShape[] {
  return withTitle(box, scale, title, "chart-composition", (rest) => compositionRows(items, rest, scale));
}

function compositionRows(items: CompositionItem[], box: ChartBox, scale: number): ChartShape[] {
  if (!items.length) return [];
  const text = textMaker(box, "chart-composition");
  const rh = Math.min(0.23 * scale, box.h / items.length);
  const pt = Math.min(LABEL_PT * scale, (rh * 72) / 1.3);
  const h = textH(pt);
  const labelW = box.w * 0.3;
  const trackX = box.x + labelW;
  const trackW = box.w - labelW - 0.46 * scale - 0.08 * scale; // 오른쪽은 % 칸 + 간격
  const max = Math.max(...items.map((item) => item.count)) || 1;
  return items.flatMap((item, i): ChartShape[] => {
    const y = box.y + i * rh;
    const barY = y + rh * 0.18;
    const barH = rh * 0.64;
    const percent = Math.round(item.share * 100);
    return [
      text(`label-${i}`, fit(item.label, pt, labelW - 0.04 * scale), pt, C.label, "left", box.x, y + rh / 2 - h / 2),
      { kind: "rect", x: trackX, y: barY, w: trackW, h: barH, fill: C.track, name: `chart-composition-track-${i}` },
      { kind: "rect", x: trackX, y: barY, w: Math.max(2 * PX, (trackW * item.count) / max), h: barH, fill: item.color, ...(isLight(item.color) ? { stroke: C.lightBar } : {}), name: `chart-composition-bar-${i}` },
      text(`value-${i}`, item.share > 0 && percent === 0 ? "<1%" : `${percent}%`, pt, C.strong, "right", box.x + box.w, y + rh / 2 - h / 2, true),
    ];
  });
}

/** y 눈금. 10 단위가 8개 이하면 그대로(층수), 아니면 1·2·5×10^k 중 6개 이하가 되는 가장 작은 단위. 연도처럼 최솟값이 최댓값의 절반보다 크면 0에서 시작하지 않고 최댓값을 단위로 올림한다. */
function axisOf(lo: number, hi: number) {
  const rebase = lo > 0.5 * hi;
  const build = (step: number, end: number) => {
    const start = rebase ? Math.floor(lo / step) * step : 0;
    const to = Math.max(end, start + step);
    return { start, end: to, step, n: Math.round((to - start) / step) + 1 };
  };
  const ten = build(10, Math.ceil((rebase ? hi : hi + 1) / 10) * 10);
  if (ten.n <= 8) return ten;
  for (let p = 1; ; p *= 10) {
    for (const m of [1, 2, 5]) {
      const a = build(m * p, Math.ceil(hi / (m * p)) * (m * p));
      if (a.n <= 6) return a;
    }
  }
}

type Scatter = Extract<DistanceData, { kind: "scatter" }>;

function scatterShapes(d: Scatter, radiusM: number, box: ChartBox, scale: number): ChartShape[] {
  const text = textMaker(box, "chart-distance");
  const unit = d.axis.unit;
  const pt = AXIS_PT * scale;
  const th = textH(pt);
  const all = [...d.points.map((p) => p.v), d.median, d.mean, d.max, ...(d.site === null ? [] : [d.site])];
  const axis = axisOf(Math.min(...all), Math.max(...all));
  const ticks = Array.from({ length: axis.n }, (_, i) => axis.start + i * axis.step);
  const xLabels = [0, 0.25, 0.5, 0.75, 1].map((f, i) => `${group(Math.round(radiusM * f))}${i === 4 ? " m" : ""}`);

  const l = Math.max(...ticks.map((v) => textW(tickText(v, unit), pt))) + 0.1 * scale;
  const r = Math.max(0.083 * scale, textW(xLabels[4]!, pt) / 2); // 마지막 눈금 글자가 상자 밖으로 안 나가게
  const b = th + 0.07 * scale;
  const px = box.x + l;
  const pw = box.w - l - r;
  const medText = `중앙값 ${statText(d.median, unit, false)}${unit}`;
  const meanText = `평균 ${statText(d.mean, unit, true)}${unit}`;
  const medW = textW(medText, pt, true);
  const sideFits = medW + textW(meanText, pt) + 0.08 * scale <= pw; // 가까운 두 선의 글자를 한 줄에 나란히 놓을 수 있나
  const t = sideFits ? th + 0.03 * scale : 2 * th + 0.04 * scale; // 위에 중앙값·평균 글자 자리(나란히 못 놓으면 두 줄)
  const ph = box.h - t - b;
  const X = (m: number) => px + (pw * Math.min(m, radiusM)) / radiusM;
  const Y = (v: number) => box.y + t + ph * (1 - (v - axis.start) / (axis.end - axis.start));

  const out: ChartShape[] = [];
  const skip = Math.max(1, Math.ceil((th * 1.1) / (ph / (axis.n - 1)))); // 글자가 눈금 간격보다 크면 격자선은 두고 글자만 건너뛴다
  ticks.forEach((v, i) => {
    out.push({ kind: "line", x1: px, y1: Y(v), x2: px + pw, y2: Y(v), stroke: C.grid, width: 0.75, name: `chart-distance-grid-${i}` });
    if (i % skip === 0) out.push(text(`ytick-${i}`, tickText(v, unit), pt, C.axis, "right", px - 0.07 * scale, Y(v) - th / 2));
  });
  xLabels.forEach((s, i) => out.push(text(`xtick-${i}`, s, pt, C.axis, "center", X(radiusM * (i / 4)), box.y + box.h - th)));

  const byColor = new Map<string, [number, number][]>();
  for (const p of d.points) {
    if (!byColor.has(p.color)) byColor.set(p.color, []);
    byColor.get(p.color)!.push([X(p.d), Y(p.v)]);
  }
  [...byColor].forEach(([color, points], i) => out.push({ kind: "dots", color, r: 0.018 * scale, opacity: 0.45, points, name: `chart-distance-dots-${i}` }));

  const yMed = Y(d.median);
  const yMean = Y(d.mean);
  out.push({ kind: "line", x1: px, y1: yMean, x2: px + pw, y2: yMean, stroke: C.strong, width: 0.75, dash: true, name: "chart-distance-mean" });
  out.push({ kind: "line", x1: px, y1: yMed, x2: px + pw, y2: yMed, stroke: C.strong, width: 0.9, name: "chart-distance-median" });
  // 두 선이 글자 높이보다 가까우면 글자를 같은 줄에 나란히 둔다(평균을 중앙값 왼쪽에). 가로로 모자라면 두 글자를 선 위쪽에만 두 줄로 쌓는다(아래쪽은 x 눈금과 부딪힌다).
  const gap = 0.03 * scale;
  const close = Math.abs(yMed - yMean) < th;
  const right = px + pw;
  let yMedLabel = yMed - gap - th;
  let yMeanLabel = yMean - gap - th;
  let meanAx = right;
  if (close) {
    const first = Math.min(yMed, yMean) - gap - th; // 위쪽 선 바로 위
    if (sideFits) {
      yMedLabel = yMeanLabel = first;
      meanAx = right - medW - 0.08 * scale;
    } else if (yMed <= yMean) yMeanLabel = first - th;
    else yMedLabel = first - th;
  }
  out.push(text("median-label", medText, pt, C.strong, "right", right, yMedLabel, true));
  out.push(text("mean-label", meanText, pt, C.label, "right", meanAx, yMeanLabel));

  if (d.site !== null) {
    // 테두리 있는 점 하나(분홍 속·진한 테두리 1.5 px). 반지름은 테두리 가운데선까지.
    const ys = Y(d.site);
    out.push({ kind: "dots", color: C.siteFill, r: 5 * PX * scale, opacity: 1, points: [[X(0), ys]], stroke: C.siteStroke, strokeWidth: 1.5 * 0.75, name: "chart-distance-site" });
    // 글자 자리 후보: 점 위 → 아래 → 점 오른쪽 한가운데 → 한 줄씩 더 위·아래. 다른 글자와 안 겹치는 첫 자리, 없으면 겹침이 가장 적은 자리.
    const siteText = `대지 평균 ${tickText(d.site, unit)}${unit}`;
    const ds = 0.05 * scale;
    const tops = [ys - ds - th, ys + ds, ys - th / 2, ...[1, 2, 3].flatMap((j) => [ys - ds - th * (1 + j), ys + ds + th * j])];
    const placed = out.filter((o): o is TextShape => o.kind === "text");
    let best: TextShape | undefined;
    let bestArea = Infinity;
    for (const y of tops) {
      const cand = text("site-label", siteText, pt, C.siteStroke, "left", X(0) + 0.083 * scale, y, true);
      const area = placed.reduce((sum, o) => sum + overlapArea(o, cand), 0);
      if (area < bestArea) [best, bestArea] = [cand, area];
      if (area === 0) break;
    }
    out.push(best!);
  }
  return out;
}

function bandShapes(bands: { from: number; to: number; count: number }[], box: ChartBox, scale: number): ChartShape[] {
  const n = bands.length;
  if (!n) return [];
  const text = textMaker(box, "chart-distance");
  const pt = AXIS_PT * scale;
  const th = textH(pt);
  // 막대 아래 글자는 구간 경계(0, 100, … 마지막만 ` m`). 막대마다 `0–100 m`를 쓰면 열 개일 때 서로 겹친다.
  const bounds = [...bands.map((band) => band.from), bands[n - 1]!.to];
  const label = (i: number) => `${group(bounds[i]!)}${i === n ? " m" : ""}`;
  const lastW = textW(label(n), pt);
  const l = Math.max(0.083 * scale, textW(label(0), pt) / 2);
  const r = Math.max(0.083 * scale, lastW / 2);
  const pw = box.w - l - r;
  const pitch = pw / n;
  const midW = Math.max(...bounds.slice(0, n).map((_, i) => textW(label(i), pt)));
  const every = Math.max(1, Math.ceil((Math.max(midW, (midW + lastW) / 2) + 0.04 * scale) / pitch)); // 글자가 피치보다 넓으면 끝에서부터 건너뛰며 쓴다
  const maxCount = Math.max(...bands.map((band) => band.count));
  // 개수 글자는 눈금 글자보다 작아지지 않는다. 피치에 안 들어가면 가장 많은 구간부터 k개 간격으로 건너뛴다.
  const countPt = pt;
  const tallest = bands.findIndex((band) => band.count === maxCount);
  const countStep = Math.max(1, Math.ceil((Math.max(...bands.map((band) => textW(group(band.count), countPt, true))) + 0.04 * scale) / pitch));
  const t = textH(countPt) + 0.04 * scale;
  const b = th + 0.07 * scale;
  const px = box.x + l;
  const base = box.y + box.h - b;
  const ph = box.h - t - b;

  const out: ChartShape[] = [{ kind: "line", x1: px, y1: base, x2: px + pw, y2: base, stroke: C.lightBar, width: 0.75, name: "chart-distance-baseline" }];
  bands.forEach((band, i) => {
    const cx = px + pitch * (i + 0.5);
    const h = maxCount > 0 ? (ph * band.count) / maxCount : 0;
    out.push({ kind: "rect", x: cx - pitch * 0.3, y: base - h, w: pitch * 0.6, h, fill: C.bar, name: `chart-distance-band-${i}` });
    if ((i - tallest) % countStep === 0) out.push(text(`count-${i}`, group(band.count), countPt, C.strong, "center", cx, base - h - 0.03 * scale - textH(countPt), true));
  });
  for (let i = n; i >= 0; i -= every) out.push(text(`xtick-${i}`, label(i), pt, C.axis, "center", px + pitch * i, box.y + box.h - th));
  return out;
}

export function distanceShapes(d: DistanceData, radiusM: number, box: ChartBox, scale: number, title = ""): ChartShape[] {
  return withTitle(box, scale, title, "chart-distance", (rest) => (d.kind === "scatter" ? scatterShapes(d, radiusM, rest, scale) : bandShapes(d.bands, rest, scale)));
}
