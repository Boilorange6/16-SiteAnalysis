import type { PlannedSlide } from "./report-plan";
import type { ReportItem, Slide } from "./pptx-kit";
import type { Rect } from "../ui/overlay-layout";

export type TileReportPart = "overview" | "stat" | "page";

/**
 * 새 장 배치(지도 틀이 각주 띠 위에서 끝나고 ②는 폭 0.68)의 설명선 개요 틀. 있으면 설명선 점·범례를 이 틀 기준으로 그린다.
 * 없으면(PPT는 Task 7까지) 옛 쪽 전체 기준이다.
 */
export type CalloutOverviewFrame = {
  map: Rect;
  legend: Rect | null;
  legendMaxW: number;
  /** 왼쪽 카드 칸의 위 끝(inch, 제목 칩 아래. ①은 숫자 카드·주석 칩 아래). 오른쪽 칸은 방위표 아래(`calloutRightTop`)에서 시작한다. */
  calloutTop: number;
  calloutRightTop: number;
  /** 오른쪽 카드 칸의 아래 끝(축척 막대 위). 왼쪽 칸은 범례 판 위에서 끝난다. */
  calloutBottom: number;
};

export type TileReportRenderContext = {
  slide: Slide;
  planned: PlannedSlide & { kind: "tile" };
  part: TileReportPart;
  overviewFrame?: CalloutOverviewFrame;
};

export type TileReportHook = {
  render: (context: TileReportRenderContext) => ReportItem | void;
};
