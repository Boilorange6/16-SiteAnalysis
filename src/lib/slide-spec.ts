// SlideSpec: HTML 미리보기와 PPT 내보내기가 공유하는 슬라이드 정의.
// 좌표(x,y,w,h,cx,cy 등)는 전부 슬라이드 기준 0~1 정규화 값.
// fontSize·테두리 두께는 pt, radius는 인치 — PPT 단위를 기준으로 하고 HTML이 환산한다.

export const SLIDE_W = 13.333; // inches
export const SLIDE_H = 7.5;
export const PX_W = 1280; // 논리 캔버스(px) = 13.333in × 96dpi
export const PX_H = 720;

export function ptToPx(pt: number): number {
  return (pt * 96) / 72;
}

export function inToPx(inches: number): number {
  return inches * 96;
}

export interface Fill {
  readonly color: string; // "#RRGGBB"
  readonly alpha?: number; // 0~1 불투명도, 생략 시 1
}

export interface Stroke {
  readonly color: string;
  readonly widthPt: number;
  readonly dash?: "solid" | "dash";
}

export interface ImageElement {
  readonly kind: "image";
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
  readonly dataUrl: string;
}

export interface RectElement {
  readonly kind: "rect";
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
  readonly fill: Fill;
  readonly stroke?: Stroke;
  readonly radiusIn?: number; // 인치
  readonly shadow?: boolean; // outer, blur 8pt, offset 3pt, 25%
}

export interface EllipseElement {
  readonly kind: "ellipse";
  readonly cx: number; readonly cy: number;
  readonly rx: number; readonly ry: number; // 정규화 반지름
  readonly fill: Fill;
  readonly stroke?: Stroke;
  readonly shadow?: boolean;
}

export interface LineElement {
  readonly kind: "line";
  readonly x1: number; readonly y1: number;
  readonly x2: number; readonly y2: number;
  readonly stroke: Stroke;
}

export interface TextElement {
  readonly kind: "text";
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
  readonly text: string;
  readonly fontSizePt: number;
  readonly color: string;
  readonly bold?: boolean;
  readonly align?: "left" | "center" | "right";
  readonly valign?: "top" | "middle" | "bottom";
  readonly charSpacingPt?: number; // 자간(pt)
  readonly fill?: Fill; // 텍스트 배경 박스
  readonly radiusIn?: number;
}

export interface TableColumn {
  readonly label: string;
  readonly wFrac: number; // 표 폭 대비 비율, 합=1
  readonly align?: "left" | "right";
}

export interface TableElement {
  readonly kind: "table";
  readonly x: number; readonly y: number; readonly w: number;
  readonly columns: readonly TableColumn[];
  readonly rows: readonly (readonly string[])[];
  readonly fontSizePt: number;
  readonly rowHIn: number; // 행 높이(인치)
  readonly headerFill: string; // "#RRGGBB"
  readonly headerColor: string;
  readonly zebraFill?: string; // 짝수 행 배경
}

export interface ChartElement {
  readonly kind: "chart";
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
  readonly title: string;
  readonly categories: readonly string[];
  readonly values: readonly number[];
  readonly color: string; // 막대 색
}

export type SlideElement =
  | ImageElement
  | RectElement
  | EllipseElement
  | LineElement
  | TextElement
  | TableElement
  | ChartElement;

export interface SlideSpec {
  readonly id: string;
  readonly title: string; // 썸네일 캡션용
  readonly warning?: string; // 예: 지도 캡처 실패
  readonly elements: readonly SlideElement[];
}
