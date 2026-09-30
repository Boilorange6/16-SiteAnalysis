/**
 * 지도 몰입형 오버레이의 위치 문법 (보드 카드 · 펼침 · PPT 슬라이드 공통).
 * 화면(px)과 슬라이드(inch)가 같은 자리 이름·여백·판 스타일을 쓰도록 토큰을 한곳에 둔다. 순수 함수만 있다.
 *
 *  왼쪽 위 = 제목 칩 · 오른쪽 위 = 보고서 칩/북쪽 · 왼쪽 아래 = 핵심 값 카드(+범례)
 *  오른쪽 아래 = 축척 · 맨 아래 = 출처 띠
 */
export type Box = { x0: number; y0: number; x1: number; y1: number };

export const OV = {
  /** 오버레이가 지도 가장자리에서 떨어지는 거리(px) */
  edge: 12,
  /** 판 모서리(px) / 카드 모서리(px) */
  plateRadius: 12,
  cardRadius: 18,
  /** 판 배경: 흰색 86% (CSS rgba .86 = PPT 투명도 14%) */
  plateAlpha: 0.86,
  /** 카드 높이(px). 2칸 타일도 같은 높이로 가로만 넓다 */
  cardHeight: 280,
  /** 출처 띠 높이(px) */
  stripH: 24,
  /** 핵심 값 카드 아래 상태 배지는 최대 이만큼, 나머지는 "+n" */
  maxBadges: 2,
  sourceCredit: "© VWorld(국토교통부)",
} as const;

export function badgesToShow<T>(items: T[], max: number = OV.maxBadges): { shown: T[]; more: number } {
  return { shown: items.slice(0, max), more: Math.max(0, items.length - max) };
}

/** 출처 띠 문구: 항상 출처와 기준일을 담는다 */
export function stripText(sourceLine: string, credit = true): string {
  const base = sourceLine === "출처 없음" ? "출처 없음 · 기준일 해당 없음" : sourceLine;
  return credit ? `${base} · ${OV.sourceCredit}` : base;
}

/** 카드/펼침 위에 오버레이가 덮는 자리(px). 지도 라벨은 이 자리를 피한다. */
export function cardReserved(w: number, h: number, opts: { valueH?: number; titleW?: number; right?: number } = {}): Box[] {
  const e = OV.edge;
  const titleW = Math.min(opts.titleW ?? 240, w - 2 * e);
  const valueH = opts.valueH ?? 104;
  const valueW = Math.min(230, w - 2 * e);
  const right = opts.right ?? 150;
  return [
    { x0: 0, y0: 0, x1: e + titleW, y1: e + 38 },
    { x0: w - e - right, y0: 0, x1: w, y1: e + 38 },
    { x0: 0, y0: h - OV.stripH - e - valueH, x1: e + valueW, y1: h },
    { x0: 0, y0: h - OV.stripH, x1: w, y1: h },
  ];
}

export type Rect = { x: number; y: number; w: number; h: number };

/** 슬라이드(16:9, inch) 오버레이 자리. */
export const SLIDE = { w: 13.333, h: 7.5, edge: 0.3, stripH: 0.36, infoRatio: 0.32 } as const;

export function slideLayout(): { title: Rect; info: Rect; legendX: number; legendBottom: number; strip: Rect; page: Rect } {
  const { w, h, edge, stripH } = SLIDE;
  const infoW = Math.round(w * SLIDE.infoRatio * 100) / 100;
  const stripY = h - stripH;
  return {
    title: { x: edge, y: edge, w: 4.6, h: 0.66 },
    info: { x: w - edge - infoW, y: edge, w: infoW, h: stripY - edge * 1.6 - edge },
    legendX: edge,
    legendBottom: stripY - edge * 0.6,
    strip: { x: 0, y: stripY, w, h: stripH },
    page: { x: w - 1.4, y: stripY, w: 1.3, h: stripH },
  };
}

/** 슬라이드 좌표(inch)를 지도 이미지 픽셀 좌표로 바꾼 예약 자리 (라벨 충돌 회피용) */
export function slideReserved(pxPerInch: number, opts: { info?: boolean } = { info: true }): Box[] {
  const l = slideLayout();
  const b = (r: Rect): Box => ({ x0: r.x * pxPerInch, y0: r.y * pxPerInch, x1: (r.x + r.w) * pxPerInch, y1: (r.y + r.h) * pxPerInch });
  return [b(l.title), ...(opts.info === false ? [] : [b(l.info)]), b(l.strip)];
}

/** 가로 방향 지도 중심 위치: 슬라이드에서는 오른쪽 정보 판을 뺀 영역의 가운데 */
export function slideSiteX(): number {
  const l = slideLayout();
  return (l.info.x - SLIDE.edge) / 2 / SLIDE.w;
}

/** 펼침에서 오른쪽 정보 판(360px)을 뺀 영역의 가운데 (모바일은 0.5) */
export function detailSiteX(width: number, panelW = 360): number {
  if (width <= 720) return 0.5;
  return Math.max(0.3, (width - panelW - 2 * OV.edge) / 2 / width);
}

/** 사각형이 겹치는가 (라벨 충돌 판정) */
export const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
