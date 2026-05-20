import type { PoiCategory } from "./types";
import { CATEGORY_COLORS } from "./types";

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

  // Cover
  readonly coverOverlayTransparency: number;
  readonly coverTitleFontSize: number;
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

  // Data panels
  readonly panelTransparency: number;
  readonly panelColor: string;
  readonly panelBorderTransparency: number;
  readonly panelRadius: number;
  readonly panelX: number;
  readonly panelY: number;
  readonly panelWidth: number;

  // Residential callouts
  readonly calloutWidth: number;
  readonly calloutHeight: number;
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
  mapOverlayColor: "#FFFFFF",
  mapOverlayTransparency: 42,
  coverOverlayTransparency: 28,
  coverTitleFontSize: 48,
  coverSubtitleFontSize: 24,
  coverMetaFontSize: 16,
  titleChipX: 0.4,
  titleChipY: 0.3,
  titleChipHeight: 0.42,
  titleChipMaxWidth: 5.5,
  titleFontSize: 16,
  subtitleFontSize: 9,
  titleChipTransparency: 100,
  titleChipRadius: 0.02,
  markerSize: 0.07,
  markerSizeSm: 0.05,
  markerTransparency: 0,
  markerBorderWidth: 1,
  markerBorderColor: "#111827",
  categoryColors: { ...CATEGORY_COLORS },
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
  panelTransparency: 4,
  panelColor: "#FFFFFF",
  panelBorderTransparency: 42,
  panelRadius: 0.04,
  panelX: 0.4,
  panelY: 1.1,
  panelWidth: 3.5,
  calloutWidth: 2.4,
  calloutHeight: 0.55,
  calloutTransparency: 3,
  calloutFontSize: 10,
  calloutDetailFontSize: 8.5,
  leaderLineWidth: 0.75,
  leaderLineTransparency: 15,
  siteMarkerOuterSize: 0.30,
  siteMarkerInnerSize: 0.12,
  siteLabelFontSize: 8,
};
