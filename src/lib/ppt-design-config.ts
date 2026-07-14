import type { PoiCategory } from "./types";
import { CATEGORY_COLORS } from "./types";

/**
 * 보고서 서체 — 웹 미리보기(canvas)와 PPT(pptxgenjs fontFace)가 공유하는 단일 소스.
 * PPT는 폰트를 임베드하지 않으므로 열람 PC에 아래 폰트가 설치되어 있어야 의도한 대로 보인다.
 */
export const PPT_FONT_MAIN = "Noto Sans KR";
export const PPT_FONT_NUM = "Pretendard";

export type CategoryColorMap = Record<PoiCategory, string>;
export type PptLegendPosition = "bottom-left" | "bottom-right" | "top-left" | "top-right";
export type PptLineDash = "solid" | "dash" | "dot";
export type PptFrameStyle =
  | "none"
  | "executive-rail"
  | "editorial-mat"
  | "satellite-hud"
  | "boardroom-ledger"
  | "blueprint-grid"
  | "organic-contour"
  | "luxury-keyline"
  | "metro-wayfinding"
  | "deal-room"
  | "minimal-document";
export type PptTitleStyle =
  | "plain"
  | "command-bar"
  | "editorial-rule"
  | "hud-bracket"
  | "ledger-tab"
  | "blueprint-label"
  | "organic-ribbon"
  | "luxury-plaque"
  | "transit-sign"
  | "deal-terminal"
  | "ink-rule";
export type PptPanelStyle =
  | "glass"
  | "paper"
  | "hud"
  | "ledger"
  | "blueprint"
  | "organic"
  | "luxury"
  | "transit"
  | "terminal"
  | "document";
export type PptMarkerStyle =
  | "solid-dot"
  | "ring-dot"
  | "square"
  | "diamond"
  | "crosshair"
  | "soft-dot"
  | "jewel"
  | "transit-node"
  | "signal"
  | "ink-dot";
export type PptLegendStyle = "card" | "rail" | "strip" | "index" | "minimal";
export type PptMetricStyle = "stripe" | "scorecard" | "terminal" | "ledger" | "stat-sheet" | "number-plate";
export type PptCompositionStyle =
  | "none"
  | "split-command"
  | "print-editorial"
  | "radar-hud"
  | "finance-ledger"
  | "planning-sheet"
  | "landscape-report"
  | "luxury-brochure"
  | "transit-atlas"
  | "war-room"
  | "mono-dossier";

export interface PptDesignConfig {
  // Visual system
  readonly frameStyle: PptFrameStyle;
  readonly titleStyle: PptTitleStyle;
  readonly panelStyle: PptPanelStyle;
  readonly markerStyle: PptMarkerStyle;
  readonly legendStyle: PptLegendStyle;
  readonly metricStyle: PptMetricStyle;
  readonly compositionStyle: PptCompositionStyle;
  readonly accentColor: string;
  readonly secondaryAccentColor: string;
  readonly canvasColor: string;

  // Theme
  readonly primaryColor: string;
  readonly overlayColor: string;
  readonly textColor: string;
  readonly mutedTextColor: string;
  readonly mapOverlayColor: string;
  readonly mapOverlayTransparency: number;
  /**
   * 베이스맵 흑백 톤(grayscale+어둡게, `src/lib/map-image-tone.ts`) 적용 여부.
   * 기본 true — 원본 보고서(260311 사이트현황) slide 3·5 문법: 흑백 위성지도 위에 컬러 오버레이가 주인공.
   */
  readonly mapGrayscale: boolean;
  /** 수치·대상지 강조용 빨강 (원본 보고서 핵심 수치·대상지 폴리곤 색 계열, #C00000 부근) */
  readonly accentRed: string;
  /** 지도 슬라이드 인사이트 카드 배경 — 라운드 검정 카드 */
  readonly insightCardBg: string;
  /** 인사이트 카드 본문 텍스트 — 흰 볼드 */
  readonly insightCardText: string;
  /** 비교 단지 폴리곤/강조색 — 베이지 (대상지 accentRed와 구분) */
  readonly polygonComparison: string;

  // Cover
  /** 표지 배경 — 거의 검정(원본 보고서 표지 문법, #1A1A1A 부근). 지도 이미지 대신 단색으로 채운다. */
  readonly coverBg: string;
  readonly coverTitleFontSize: number;
  /** 좌상단 아이브로우 2줄째("사이트 입지 분석") 폰트 크기 — 1줄째는 이 값의 ~75%로 파생 계산 */
  readonly coverSubtitleFontSize: number;
  readonly coverMetaFontSize: number;

  // Title chips
  readonly titleChipX: number;
  readonly titleChipY: number;
  readonly titleChipHeight: number;
  readonly titleChipMaxWidth: number;
  readonly titleFontSize: number;
  readonly subtitleFontSize: number;
  readonly titleChipTransparency: number;
  readonly titleChipRadius: number;

  // Markers
  readonly markerSize: number;
  readonly markerSizeSm: number;
  readonly markerTransparency: number;
  readonly markerBorderWidth: number;
  readonly markerBorderColor: string;

  // Category colors
  readonly categoryColors: CategoryColorMap;

  // Concentric rings
  readonly ringLineWidth: number;
  readonly ringOuterLineWidth: number;
  readonly ringTransparency: number;
  readonly ringDash: PptLineDash;

  // Subway route lines
  readonly subwayLineWidth: number;
  readonly stationLabelFontSize: number;
  readonly stationBarHalfLengthM: number;
  readonly stationBarWidth: number;

  // Text / labels
  readonly labelFontSize: number;
  readonly labelBgTransparency: number;
  readonly legendFontSize: number;
  readonly detailFontSize: number;
  readonly summaryFontSize: number;

  // Legend
  readonly legendPosition: PptLegendPosition;
  readonly legendTransparency: number;
  readonly legendBorderTransparency: number;
  readonly legendRadius: number;
  /**
   * 지도 위 범례 라벨 색 — 흑백 지도 위에서 쓰이므로 기본 흰색. `textColor`(#111827,
   * 어두운 색)는 백색 정보 슬라이드용 토큰이라 지도 범례에 재사용하면 판독 불가(Task 5 이월 결함).
   * 지도 슬라이드의 범례(overview/category/apartment callout)만 이 토큰을 쓴다.
   */
  readonly legendTextColor: string;

  // Data panels
  readonly panelTransparency: number;
  readonly panelColor: string;
  readonly panelBorderTransparency: number;
  readonly panelRadius: number;
  readonly panelX: number;
  readonly panelY: number;
  readonly panelWidth: number;

  // Residential callouts — 원본 보고서 slide 7 문법: 흰 리더라인 + 미니 데이터표
  // (헤더=단지명, 행=세대수/입주/전용면적대 중 가용 필드만). calloutWidth/calloutHeight는
  // 표 전체의 예약 치수(겹침 방지 레이아웃용 상한 — 실제 행 수가 적으면 그 안에서 세로 중앙 정렬).
  readonly calloutWidth: number;
  readonly calloutHeight: number;
  /** 헤더 셀(단지명) 높이 */
  readonly calloutHeaderHeight: number;
  /** 데이터 행 1개 높이 */
  readonly calloutRowHeight: number;
  readonly calloutTransparency: number;
  readonly calloutFontSize: number;
  readonly calloutDetailFontSize: number;
  readonly leaderLineWidth: number;
  readonly leaderLineTransparency: number;

  // Site marker
  readonly siteMarkerOuterSize: number;
  readonly siteMarkerInnerSize: number;
  readonly siteLabelFontSize: number;
}

export const DEFAULT_PPT_DESIGN: PptDesignConfig = {
  frameStyle: "none",
  titleStyle: "plain",
  panelStyle: "glass",
  markerStyle: "ring-dot",
  legendStyle: "minimal",
  metricStyle: "stat-sheet",
  compositionStyle: "none",
  accentColor: "#111827",
  secondaryAccentColor: "#475569",
  canvasColor: "#FFFFFF",
  primaryColor: "#111827",
  overlayColor: "#FFFFFF",
  textColor: "#111827",
  mutedTextColor: "#475569",
  // 베이스맵 자체가 이제 흑백+어둡게(map-image-tone.ts) 처리되므로, 예전처럼 흰 반투명 베일로
  // 한 번 더 지도를 씻어내면(desaturate) 어둡게 한 효과가 상쇄된다 — 어둡고 채도 없는 근흑색
  // 베일을 아주 옅게만 얹어 텍스트 가독성용 비네트 정도로만 재조정 (흑백화와 중복 적용 방지).
  mapOverlayColor: "#0B0F14",
  mapOverlayTransparency: 78,
  mapGrayscale: true,
  accentRed: "#C00000",
  insightCardBg: "#141414",
  insightCardText: "#FFFFFF",
  polygonComparison: "#D8C7A0",
  coverBg: "#1A1A1A",
  coverTitleFontSize: 60,
  coverSubtitleFontSize: 15,
  coverMetaFontSize: 16,
  titleChipX: 0.4,
  titleChipY: 0.3,
  titleChipHeight: 0.42,
  titleChipMaxWidth: 5.5,
  titleFontSize: 16,
  subtitleFontSize: 9,
  titleChipTransparency: 100,
  titleChipRadius: 0.02,
  // 2026-07-14 사용자 요청: 지도 동그라미 마커 1.5배 (0.07/0.05 → 0.105/0.075)
  markerSize: 0.105,
  markerSizeSm: 0.075,
  markerTransparency: 0,
  markerBorderWidth: 1,
  markerBorderColor: "#111827",
  // P4R Task C-8: 도트 시인성 — CATEGORY_COLORS는 sidebar.tsx/map-marker-utils.ts(웹 지도 마커·범례)와
  // 공유하는 토큰이라 원본을 바꾸면 웹 UI가 회귀한다. school/mountain 2개만 PPT 전용으로 오버라이드:
  // school 원본(#3B82F6)은 흑백+어둡게 처리된 위성지도 위에서 잘 안 보여 더 밝은 하늘색으로,
  // mountain 원본은 park과 동일값(#10B981)이라 두 카테고리가 지도에서 구분 불가 — mountain만
  // 짙은 청록(teal)으로 바꿔 park(에메랄드 그린)과 색상(hue)이 분리되게 한다.
  categoryColors: { ...CATEGORY_COLORS, school: "#7DD3FC", mountain: "#0F766E" },
  ringLineWidth: 0.8,
  ringOuterLineWidth: 1.2,
  ringTransparency: 35,
  ringDash: "dot",
  subwayLineWidth: 3,
  stationLabelFontSize: 9,
  stationBarHalfLengthM: 150,
  stationBarWidth: 6,
  labelFontSize: 9,
  labelBgTransparency: 6,
  legendFontSize: 8,
  detailFontSize: 12,
  summaryFontSize: 15,
  legendPosition: "bottom-left",
  legendTransparency: 10,
  legendBorderTransparency: 100,
  legendRadius: 0.05,
  legendTextColor: "#FFFFFF",
  panelTransparency: 4,
  panelColor: "#FFFFFF",
  panelBorderTransparency: 42,
  panelRadius: 0.04,
  panelX: 0.4,
  panelY: 1.1,
  panelWidth: 3.5,
  calloutWidth: 2.4,
  // 2026-07-14 5행 규격(세대수/준공/주차/층·동/시공사): 0.22 + 5×0.17 = 1.07
  calloutHeight: 1.07,
  calloutHeaderHeight: 0.22,
  calloutRowHeight: 0.17,
  calloutTransparency: 3,
  calloutFontSize: 10,
  calloutDetailFontSize: 8.5,
  leaderLineWidth: 0.75,
  leaderLineTransparency: 15,
  siteMarkerOuterSize: 0.30,
  siteMarkerInnerSize: 0.12,
  siteLabelFontSize: 8,
};
