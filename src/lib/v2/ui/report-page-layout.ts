/**
 * 보고서 장 기하(inch). 화면 SlideSurface·PPT·그림 내보내기·축척이 모두 이 함수만 읽는다(spec 2026-10-30 §3·§7·§8).
 * 가장자리·간격·카드 폭은 판형과 관계없는 절대 inch다(글자 pt가 판형과 관계없는 절대 값이라서). 판형에 따라 달라지는 것은
 * 장 크기와 ② 지도 틀 폭(`SLIDE.infoRatio`), 지도 부속 단위 u(틀 모양)뿐이다.
 * 호출 순서: `keyCardBox` → `keyFigureFit`(카드 폭·maxHeight) → `reportPageGeometry`.
 *
 * 배치 규칙은 하나다(Ruling 17): ① 모든 요소를 기본 자리에 놓는다. ② 저장 자리를 카드(①, 주석 칩 포함) → 제목 → 범례 → 방위표 → 축척
 * 순서로 하나씩 시험한다. ③ 저장 자리는 지도 틀 안이고, 그 시점에 놓인 다른 모든 요소(주석 칩 포함)와 겹치지 않을 때만 받는다.
 * 아니면 그 요소는 기본 자리에 남는다. 이러면 어느 단계에서든 겹침이 없다.
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

type GeometryInput = {
  layout: PageLayoutKind; format: SlideFormat; panels?: PagePanels;
  summaryDeleted: boolean; titleSize: { w: number; h: number };
  keyCardHeight: number; legendSize: { w: number; h: number } | null;
  chartSlots: 0 | 1 | 2; sentenceHeight: number;
  /** 구성비 카드(그래프 카드 1)의 내용 높이. 두 카드를 다 둘 때 카드가 이보다 크면 이 높이로 줄이고 남는 높이는 거리 카드가 가진다. */
  chart1Content?: number;
  /** `주석 N` 칩이 있는가(기본 true). 있으면 칩 자리를 두고 해석 줄 폭에서 뺀다. */
  notes?: boolean;
};

/** 가장자리 24 px */
const EDGE = 0.25;
/** 지도 위 설명선 상자가 지도 틀 가장자리에서 떨어지는 거리도 장 가장자리 규칙이다(화면·PPT·그림이 같다). */
export const PAGE_EDGE = EDGE;
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
/** 범례 판과 그 아래 축척 판 사이 간격(inch, 1440 화면 11 px) */
export const LEGEND_SCALE_GAP = 0.12;
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
const union = (a: Rect, b: Rect | null): Rect => {
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(right(a), right(b)) - x, h: Math.max(bottom(a), bottom(b)) - y };
};

function place(input: GeometryInput): { geometry: ReportPageGeometry; cardMoved: Rect | null } {
  const { layout, format, summaryDeleted, titleSize, keyCardHeight, legendSize, chartSlots, sentenceHeight, notes = true } = input;
  const g = slideGeometry(format);
  const stored = normalizePagePanels(input.panels) ?? {};
  const toRect = (p: PagePanelRect): Rect => ({ x: p.x * g.w, y: p.y * g.h, w: p.w * g.w, h: p.h * g.h });
  const chip = NOTES_CHIP_SIZE;

  const footer: Rect = { x: 0, y: g.h - FOOTER_H, w: g.w, h: FOOTER_H };
  const pageNo: Rect = { x: g.w - EDGE - PAGE_NO_W, y: footer.y, w: PAGE_NO_W, h: FOOTER_H };
  const withColumn = layout === "map-charts" && !summaryDeleted;
  const map: Rect = { x: 0, y: 0, w: withColumn ? g.w * (1 - g.infoRatio) : g.w, h: footer.y };
  const unit = frameChromeUnit(map.w, map.h);
  const k = map.w / SCENE_W; // 장면 px → inch
  const edgePx = NORTH_INSET - NORTH_RADIUS; // 방위표가 틀 모서리에서 떨어진 거리(7 px)

  // ── 1. 기본 자리
  const titleAuto: Rect = { x: EDGE, y: EDGE, w: titleSize.w, h: titleSize.h };
  const northSize = { w: 2 * NORTH_RADIUS * unit * k, h: 2 * NORTH_RADIUS * unit * k };
  const northAuto: Rect = { ...northSize, x: map.w - edgePx * unit * k - northSize.w, y: edgePx * unit * k };
  const scaleSize = { w: (SCALE_MAX_PX + 2 * SCALE_PANEL_SIDE) * unit * k, h: (SCALE_PANEL_ABOVE + SCALE_PANEL_BELOW) * unit * k };
  const scaleAuto: Rect = { ...scaleSize, x: map.w - edgePx * unit * k - scaleSize.w, y: map.h - 12 * unit * k - scaleSize.h };
  const chipBelow = (card: Rect): Rect | null => (notes ? { x: right(card) - chip.w, y: bottom(card) + KEY_CHIP_GAP, ...chip } : null);
  // 범례 기본 자리(2026-11-05 사용자 결정): 오른쪽 아래, 축척 판 바로 위(간격 LEGEND_SCALE_GAP). 오른쪽 끝은 축척 판과 같다. 쪽마다 옮기지 않는다.
  const legendAuto: Rect | null = legendSize ? { x: right(scaleAuto) - legendSize.w, y: scaleAuto.y - LEGEND_SCALE_GAP - legendSize.h, ...legendSize } : null;
  // 저장 자리는 틀 안이고 이미 놓인 요소와 겹치지 않을 때만 받는다. 크기는 저장값이 아니라 기하가 정한다.
  const placed = (panel: PagePanelRect | undefined, size: { w: number; h: number }, others: readonly (Rect | null)[]): Rect | null => {
    if (!panel) return null;
    const at = toRect(panel);
    const rect: Rect = { x: at.x, y: at.y, ...size };
    return within(rect, map) && others.every((r) => !r || !hit(rect, r)) ? rect : null;
  };

  // ── 2~3. 저장 자리를 제목 → 범례 → 방위표 → 축척 순으로 시험한다. 카드(`block`)는 이미 정해진 것으로 본다.
  const arrange = (blk: Rect | null) => {
    let legend = legendAuto;
    const title = placed(stored.title, titleSize, [blk, legend, northAuto, scaleAuto]) ?? titleAuto;
    if (legendSize) legend = placed(stored.legend, legendSize, [title, blk, northAuto, scaleAuto]) ?? legend;
    const north = placed(stored.north, northSize, [title, blk, legend, scaleAuto]) ?? northAuto;
    const scaleBar = placed(stored.scaleBar, scaleSize, [title, blk, legend, north]) ?? scaleAuto;
    return { title, legend, north, scaleBar };
  };

  let keyCard: Rect | null = null;
  let keyNotesChip: Rect | null = null;
  let cardMoved: Rect | null = null;
  let column: ReportPageGeometry["column"] = null;

  if (withColumn) {
    const rect: Rect = { x: map.w + COLUMN_GAP, y: EDGE, w: g.w - EDGE - (map.w + COLUMN_GAP), h: footer.y - COLUMN_GAP - EDGE };
    const key: Rect = { x: rect.x, y: rect.y, w: rect.w, h: keyCardHeight };
    // 숫자 카드가 없으면(D17 단면 장에서 카드만 지운 경우, Ruling 38) 첫 그래프 카드가 열 맨 위에서 시작한다.
    const top = keyCardHeight > 0 ? bottom(key) + CARD_GAP : rect.y;
    // 해석 줄은 열 맨 아래. 주석 칩은 그 오른쪽 끝(열 맨 아래 오른쪽)이고 해석 줄은 칩 자리를 비킨다. 그래프 카드는 둘 중 높은 쪽 위에서 끝난다.
    const notesChip: Rect = { x: right(rect) - chip.w, y: bottom(rect) - chip.h, ...chip };
    const sentence: Rect = { x: rect.x, y: bottom(rect) - sentenceHeight, w: rect.w - (notes ? chip.w + NOTES_CHIP_GAP : 0), h: sentenceHeight };
    const chartsBottom = bottom(rect) - Math.max(sentenceHeight, notes ? chip.h : 0);
    // key | chart1 | chart2 | 아래 줄 사이 간격을 뺀 남은 높이로 그래프 카드를 채운다. 모자라면 chart2 → chart1 순으로 뺀다.
    const room = (cards: number) => chartsBottom - top - CARD_GAP * cards;
    let slots = chartSlots;
    while (slots > 0 && room(slots) < CHART_MIN * slots) slots--;
    let chart1: Rect | null = null;
    let chart2: Rect | null = null;
    // 카드 하나만 남아도 내용보다 큰 빈 여백을 두지 않는다(열 바탕이 비는 쪽이 낫다).
    if (slots === 1) chart1 = { x: rect.x, y: top, w: rect.w, h: Math.min(room(1), input.chart1Content ?? Infinity) };
    if (slots === 2) {
      // 구성비 카드는 내용 높이를 받고(spec §3-3: 그래프 카드 2부터 줄인다), 거리 카드가 CHART_MIN 아래로 줄지 않게만 막는다.
      const h1 = Math.min(input.chart1Content ?? room(2) * CHART1_SHARE, room(2) - CHART_MIN);
      chart1 = { x: rect.x, y: top, w: rect.w, h: h1 };
      chart2 = { x: rect.x, y: bottom(chart1) + CARD_GAP, w: rect.w, h: room(2) - h1 };
    }
    column = { rect, key, chart1, chart2, sentence, notesChip };
    keyCard = key;
  } else if (!summaryDeleted) {
    // ① 기본 카드 y는 기본 제목 자리 기준으로 고정한다(제목 칩을 옮겨도 카드는 따라가지 않는다).
    keyCard = { x: EDGE, y: bottom(titleAuto) + TITLE_GAP, w: CARD_W, h: keyCardHeight };
    // ① 저장 카드(옮기고 크기도 바꿀 수 있다, §7): 카드 + 칩 묶음이 틀 안이고, 제목·방위표·축척과 겹치지 않으며,
    // 그 장의 실제 범례 자리(저장한 자리가 받아들여지면 그 자리, 아니면 기본 자리)가 카드와 겹치지 않을 때만 받는다(T14b-3). ②는 무시.
    if (stored.summary) {
      const cand = toRect(stored.summary);
      const block = union(cand, chipBelow(cand));
      const others = [titleAuto, northAuto, scaleAuto];
      const lg = legendSize ? arrange(block).legend : null;
      if (within(block, map) && others.every((r) => !hit(block, r)) && (!lg || (within(lg, map) && !hit(lg, block)))) {
        cardMoved = cand;
        keyCard = cand;
      }
    }
    keyNotesChip = chipBelow(keyCard);
  }
  const block: Rect | null = !withColumn && keyCard ? union(keyCard, keyNotesChip) : null;

  const { title, legend, north, scaleBar } = arrange(block);

  return { geometry: { map, footer, pageNo, title, keyCard, column, keyNotesChip, legend, north, scaleBar, unit, scenePxPerInch: SCENE_W / map.w }, cardMoved };
}

/**
 * 설명선 칸의 아래 끝(inch, 지도 틀 기준), 칸마다 따로(2026-11-05): 왼쪽은 지도 틀 아래 끝(안쪽 여백)까지, 오른쪽은 범례 판 위 − 간격에서 끝난다.
 * 범례 판이 있는 쪽 칸만 판 위에서 끝난다(기본 자리는 오른쪽이고, 사용자가 왼쪽 절반으로 옮겨 저장했으면 왼쪽 칸이 끊긴다).
 * `right`는 범례 판이 오른쪽에 있을 때만 값이 있다: 없으면 오른쪽 칸은 장면의 축척 판 규칙을 그대로 따른다.
 */
export function reportCalloutBottoms(geometry: Pick<ReportPageGeometry, "map" | "legend">): { left: number; right?: number } {
  const above = geometry.legend ? geometry.legend.y - EDGE * 0.5 : null;
  const onRight = !!geometry.legend && geometry.legend.x + geometry.legend.w / 2 >= geometry.map.w / 2;
  return { left: above !== null && !onRight ? above : geometry.map.h - EDGE, ...(above !== null && onRight ? { right: above } : {}) };
}

/**
 * 카드 맞춤(`keyFigureFit`)을 기하보다 먼저 부르기 위한 입구. ② 열 폭, ① 기본 폭 또는 저장 카드를 쓸 수 있을 때 그 폭이다.
 * 저장 카드를 `reportPageGeometry`와 같은 판정으로 받으면 `h`가 저장 높이(`keyFigureFit`의 `maxHeight`로 넘길 값), 아니면 null이다.
 * 같은 `panels`·`titleSize`·`legendSize`·`notes`를 `reportPageGeometry`에도 넘겨야 판정이 같다.
 */
export function keyCardBox(input: { layout: PageLayoutKind; format: SlideFormat; panels?: PagePanels; summaryDeleted: boolean; titleSize: { w: number; h: number }; legendSize: { w: number; h: number } | null; notes?: boolean }): { w: number; h: number | null } {
  const { geometry, cardMoved } = place({ ...input, keyCardHeight: 0, chartSlots: 0, sentenceHeight: 0 });
  if (geometry.column) return { w: geometry.column.key.w, h: null };
  return cardMoved ? { w: cardMoved.w, h: cardMoved.h } : { w: CARD_W, h: null };
}

export function reportPageGeometry(input: GeometryInput): ReportPageGeometry {
  return place(input).geometry;
}
