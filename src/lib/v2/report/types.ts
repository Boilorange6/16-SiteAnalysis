import type { PlannedSlide } from "./report-plan";
import type { ReportItem, Slide } from "./pptx-kit";

export type TileReportPart = "overview" | "stat" | "page";

export type TileReportRenderContext = {
  slide: Slide;
  planned: PlannedSlide & { kind: "tile" };
  part: TileReportPart;
};

export type TileReportHook = {
  render: (context: TileReportRenderContext) => ReportItem | void;
};
