/**
 * 보고서 장 기하(inch). 화면 SlideSurface·PPT·그림 내보내기·축척이 모두 이 함수만 읽는다(spec 2026-10-30 §3·§7·§8).
 * 가장자리·간격·카드 폭은 판형과 관계없는 절대 inch다(글자 pt가 판형과 관계없는 절대 값이라서). 판형에 따라 달라지는 것은
 * 장 크기와 ② 지도 틀 폭(`SLIDE.infoRatio`), 지도 부속 단위 u(틀 모양)뿐이다.
 * 호출 순서: `keyCardWidth` → `keyFigureFit`(카드 폭·maxHeight) → `reportPageGeometry`.
 */
import { NOTES_CHIP_GAP, NOTES_CHIP_SIZE, normalizePagePanels, type PagePanelRect, type PagePanels } from "../report/report-geometry";
import { slideGeometry, type Rect, type SlideFormat } from "./overlay-layout";
import { NORTH_INSET, NORTH_RADIUS, SCALE_MAX_PX, SCALE_PANEL_ABOVE, SCALE_PANEL_BELOW, SCALE_PANEL_SIDE } from "./map-scene";

export type PageLayoutKind = "map-key" | "map-charts";

export type ReportPageGeometry = {
  map: Rect; footer: Rect; pageNo: Rect; title: Rect;
  /** ①: 떠 있는 카드 / ②: column.key와 같음 / 숫자 카드 지움이면 null */
  keyCard: Rect | null;
  column: { rect: Rect; key: Rect; chart1: Rect | null; chart2: Rect | null; sentence: Rect; notesChip: Rect } | null;
  /** ①: 숫자 카드 바로 아래 오른쪽의 `주석 N` 칩. ②·카드 없음·주석 없음이면 null. */
  keyNotesChip: Rect | null;
  legend: Rect | null; north: Rect; scaleBar: Rect;
  /** 지도 부속 u */
  unit: number;
  /** 960 / map.w */
  scenePxPerInch: number;
};

/** 가장자리 24 px */
const EDGE = 0.25;
/** 각주 띠 28 px */
const FOOTER_H = 0.29;
const PAGE_NO_W = 1;
/** 제목 칩 → ① 카드 사이 */
const TITLE_GAP = 0.125;
/** ① 카드 폭 300 px */
const CARD_W = 3.125;
/** ② 지도 틀 → 열 사이(20 px)·열 아래 여백 */
const COLUMN_GAP = 0.21;
/** 카드 사이 12 px */
const CARD_GAP = 0.125;
/** ① 숫자 카드와 그 아래 주석 칩 사이 */
const KEY_CHIP_GAP = 0.08;
/** 그래프 카드 최소 높이(제목 줄 + 그래프). 못 채우면 그래프 카드 2부터 뺀다. */
const CHART_MIN = 1.2;
/** 구성비 카드가 두 카드 몫에서 가져가는 비율(거리 그래프가 더 높다) */
const CHART1_SHARE = 0.45;
/** 방위표·축척 부속의 장면 폭(px). 틀을 이 폭의 장면으로 보고 크기를 정한다(d2 A). */
const SCENE_W = 960;

/** 틀 폭 기준 지도 부속 단위 u = clamp(1, 1.5, 장면 높이 / 360). 장면 높이 = 960 × 틀 높이 / 틀 폭. */
export function frameChromeUnit(frameW: number, frameH: number): number {
  return Math.max(1, Math.min(1.5, (SCENE_W * frameH) / Math.max(0.01, frameW) / 360));
}

const right = (r: Rect) => r.x + r.w;
const bottom = (r: Rect) => r.y + r.h;
const hit = (a: Rect, b: Rect) => a.x < right(b) - 1e-6 && b.x < right(a) - 1e-6 && a.y < bottom(b) - 1e-6 && b.y < bottom(a) - 1e-6;
const within = (r: Rect, frame: Rect) => r.x >= frame.x - 1e-6 && r.y >= frame.y - 1e-6 && right(r) <= right(frame) + 1e-6 && bottom(r) <= bottom(frame) + 1e-6;

/** 카드 크기와 상관없는 바탕 기하: 장 크기, 지도 틀, 기본·저장 제목, 기본 방위표·축척, ① 저장 카드 자리. */
function baseFrame(layout: PageLayoutKind, format: SlideFormat, panels: PagePanels | undefined, summaryDeleted: boolean, titleSize: { w: number; h: number }) {
  const g = slideGeometry(format);
  const stored = normalizePagePanels(panels) ?? {};
  const toRect = (p: PagePanelRect): Rect => ({ x: p.x * g.w, y: p.y * g.h, w: p.w * g.w, h: p.h * g.h });
  const footer: Rect = { x: 0, y: g.h - FOOTER_H, w: g.w, h: FOOTER_H };
  const withColumn = layout === "map-charts" && !summaryDeleted;
  const map: Rect = { x: 0, y: 0, w: withColumn ? g.w * (1 - g.infoRatio) : g.w, h: footer.y };
  const titleAuto: Rect = { x: EDGE, y: EDGE, w: titleSize.w, h: titleSize.h };

  const unit = frameChromeUnit(map.w, map.h);
  const k = map.w / SCENE_W; // 장면 px → inch
  const edgePx = NORTH_INSET - NORTH_RADIUS; // 방위표가 틀 모서리에서 떨어진 거리(7 px)
  const northSize = { w: 2 * NORTH_RADIUS * unit * k, h: 2 * NORTH_RADIUS * unit * k };
  const northAuto: Rect = { ...northSize, x: map.w - edgePx * unit * k - northSize.w, y: edgePx * unit * k };
  const scaleSize = { w: (SCALE_MAX_PX + 2 * SCALE_PANEL_SIDE) * unit * k, h: (SCALE_PANEL_ABOVE + SCALE_PANEL_BELOW) * unit * k };
  const scaleAuto: Rect = { ...scaleSize, x: map.w - edgePx * unit * k - scaleSize.w, y: map.h - 12 * unit * k - scaleSize.h };

  // 저장 자리: 틀 안이고 이미 놓인 요소와 겹치지 않을 때만 쓴다. 크기는 저장값이 아니라 기하가 정한다.
  const placed = (panel: PagePanelRect | undefined, size: { w: number; h: number }, avoid: readonly (Rect | null)[]): Rect | null => {
    if (!panel) return null;
    const at = toRect(panel);
    const rect: Rect = { x: at.x, y: at.y, ...size };
    return within(rect, map) && avoid.every((r) => !r || !hit(rect, r)) ? rect : null;
  };

  const titleSaved = placed(stored.title, titleSize, [northAuto, scaleAuto]);
  // ①: 저장 카드 자리는 틀 안이고 제목·방위표·축척과 겹치지 않을 때만 쓴다(옮기고 크기도 바꿀 수 있다, §7). ②는 무시.
  const movedCard = !withColumn && !summaryDeleted && stored.summary ? toRect(stored.summary) : null;
  const cardMoved = movedCard && within(movedCard, map) && [titleSaved ?? titleAuto, northAuto, scaleAuto].every((r) => !hit(movedCard, r)) ? movedCard : null;
  return { g, stored, footer, withColumn, map, titleAuto, titleSaved, unit, k, northSize, northAuto, scaleSize, scaleAuto, placed, cardMoved };
}

/** ① 카드 폭(저장 카드 자리가 쓸 수 있으면 그 폭) 또는 ② 열 폭. 카드 맞춤(`keyFigureFit`)을 기하보다 먼저 부르기 위한 입구다. */
export function keyCardWidth(layout: PageLayoutKind, format: SlideFormat, panels?: PagePanels, titleSize: { w: number; h: number } = { w: 4.6, h: 0.5 }): number {
  const b = baseFrame(layout, format, panels, false, titleSize);
  if (b.withColumn) return b.g.w - EDGE - (b.map.w + COLUMN_GAP);
  return b.cardMoved?.w ?? CARD_W;
}

export function reportPageGeometry(input: {
  layout: PageLayoutKind; format: SlideFormat; panels?: PagePanels;
  summaryDeleted: boolean; titleSize: { w: number; h: number };
  keyCardHeight: number; legendSize: { w: number; h: number } | null;
  chartSlots: 0 | 1 | 2; sentenceHeight: number;
  /** `주석 N` 칩이 있는가(기본 true). 있으면 칩 자리를 두고 해석 줄 폭에서 뺀다. */
  notes?: boolean;
}): ReportPageGeometry {
  const { layout, format, summaryDeleted, titleSize, keyCardHeight, legendSize, chartSlots, sentenceHeight, notes = true } = input;
  const { g, stored, footer, withColumn, map, titleAuto, titleSaved, unit, northSize, northAuto, scaleSize, scaleAuto, placed, cardMoved } = baseFrame(layout, format, input.panels, summaryDeleted, titleSize);
  const pageNo: Rect = { x: g.w - EDGE - PAGE_NO_W, y: footer.y, w: PAGE_NO_W, h: FOOTER_H };
  const chip = NOTES_CHIP_SIZE;

  let keyCard: Rect | null = null;
  let keyNotesChip: Rect | null = null;
  let column: ReportPageGeometry["column"] = null;

  if (withColumn) {
    const rect: Rect = { x: map.w + COLUMN_GAP, y: EDGE, w: g.w - EDGE - (map.w + COLUMN_GAP), h: footer.y - COLUMN_GAP - EDGE };
    const key: Rect = { x: rect.x, y: rect.y, w: rect.w, h: keyCardHeight };
    // 해석 줄은 열 맨 아래. 주석 칩은 그 오른쪽 끝(열 맨 아래 오른쪽)이고 해석 줄은 칩 자리를 비킨다.
    const notesChip: Rect = { x: right(rect) - chip.w, y: bottom(rect) - chip.h, ...chip };
    const sentence: Rect = { x: rect.x, y: bottom(rect) - sentenceHeight, w: rect.w - (notes ? chip.w + NOTES_CHIP_GAP : 0), h: sentenceHeight };
    // key | chart1 | chart2 | sentence 사이 간격을 뺀 남은 높이로 그래프 카드를 채운다. 모자라면 chart2 → chart1 순으로 뺀다.
    const room = (cards: number) => sentence.y - bottom(key) - CARD_GAP * (cards + 1);
    let slots = chartSlots;
    while (slots > 0 && room(slots) < CHART_MIN * slots) slots--;
    let chart1: Rect | null = null;
    let chart2: Rect | null = null;
    if (slots === 1) chart1 = { x: rect.x, y: bottom(key) + CARD_GAP, w: rect.w, h: room(1) };
    if (slots === 2) {
      const h1 = room(2) * CHART1_SHARE;
      chart1 = { x: rect.x, y: bottom(key) + CARD_GAP, w: rect.w, h: h1 };
      chart2 = { x: rect.x, y: bottom(chart1) + CARD_GAP, w: rect.w, h: room(2) - h1 };
    }
    column = { rect, key, chart1, chart2, sentence, notesChip };
    keyCard = key;
  } else if (!summaryDeleted) {
    // ① 기본 카드 y는 기본 제목 자리 기준으로 고정한다(제목 칩을 옮겨도 카드는 따라가지 않는다).
    keyCard = cardMoved ?? { x: EDGE, y: bottom(titleAuto) + TITLE_GAP, w: CARD_W, h: keyCardHeight };
    if (notes) keyNotesChip = { x: right(keyCard) - chip.w, y: bottom(keyCard) + KEY_CHIP_GAP, ...chip };
  }
  const cardBlock: Rect | null = keyCard && { ...keyCard, h: (keyNotesChip ? bottom(keyNotesChip) : bottom(keyCard)) - keyCard.y };

  // 제목: 저장 자리가 카드와 겹치지 않으면 쓴다(기본 자리는 기본 카드와 겹치지 않는다).
  const title = titleSaved && !(keyCard && hit(titleSaved, keyCard)) ? titleSaved : titleAuto;

  // 범례 후보: 저장 자리 또는 기본 자리(왼쪽 아래). 카드(+칩)가 커서 세로로 겹치면 카드 오른쪽으로 민다(카드는 줄이지 않는다).
  let legendCandidate: Rect | null = null;
  if (legendSize) {
    legendCandidate = placed(stored.legend, legendSize, [title, cardBlock]);
    if (!legendCandidate) {
      legendCandidate = { x: EDGE, y: map.h - EDGE - legendSize.h, ...legendSize };
      if (keyCard && cardBlock && hit(legendCandidate, cardBlock)) legendCandidate = { ...legendCandidate, x: Math.min(right(keyCard) + CARD_GAP, Math.max(EDGE, map.w - EDGE - legendSize.w)) };
    }
  }

  // 옮겨 둔 방위표·축척은 제목·카드·칩·범례(저장 또는 기본 자리)와 겹치면 기본 자리로 돌아간다.
  const north = placed(stored.north, northSize, [title, cardBlock, scaleAuto, legendCandidate]) ?? northAuto;
  const scaleBar = placed(stored.scaleBar, scaleSize, [title, cardBlock, north, legendCandidate]) ?? scaleAuto;

  return { map, footer, pageNo, title, keyCard, column, keyNotesChip, legend: legendCandidate, north, scaleBar, unit, scenePxPerInch: SCENE_W / map.w };
}
