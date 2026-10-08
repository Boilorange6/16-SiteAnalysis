import { a05ReportModule, a06ReportModule } from "./a05/report";
import type { TileReportModule } from "./types";

export type { TileReportModule } from "./types";

/** Report-only registry: keeping it out of tile/client prevents pptxgenjs from entering the client graph. */
const TILE_REPORT_MODULES: readonly TileReportModule[] = [a05ReportModule, a06ReportModule];

export function tileReportModuleFor(code: string): TileReportModule | undefined {
  return TILE_REPORT_MODULES.find((module) => module.code === code);
}
