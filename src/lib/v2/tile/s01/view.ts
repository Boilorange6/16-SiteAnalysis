import type { Scene } from "../../scene";
import type { TileResult } from "../../tile-result";
import type { MassModel } from "../../ui/mass-projection";
import { countText, metricPercent, metricText, percentText, statList } from "../key-figure";
import type { KeyFigure, TileClientModule, TileHeadlineHelpers } from "../types";
import { s01CutModule } from "./cut";

/**
 * 중앙값은 원천 높이 + 층수 추정 높이(높이 확인 건물) 기준이고 1층 가정 건물은 뺀다.
 * 높이 수치이므로 1층 가정 건물의 비율을 보조 숫자로 함께 싣는다(저장소 규칙).
 */
function s01KeyFigure(result: TileResult, helpers: TileHeadlineHelpers): KeyFigure | null {
  const median = metricText(result, "height_median_m", helpers);
  if (median === null) return null;
  const known = result.metrics.find((metric) => metric.id === "height_known_pct");
  const assumed = result.metrics.find((metric) => metric.id === "height_assumed_one_floor_count");
  const count = assumed?.numerator ?? null;
  const total = assumed?.denominator ?? null;
  const assumedRow: readonly [string | null, string] = count !== null && total !== null && total > 0
    ? [percentText((count / total) * 100), `1층 가정(추정) · ${countText(count, "동")}`]
    : [null, "1층 가정(추정)"];
  return {
    question: "주변 건물 높이 중앙값",
    answer: { value: median, kind: "number" },
    ...(known?.numerator == null ? {} : { sub: `높이 확인 ${countText(known.numerator, "동")} 기준 · 1층 가정 건물은 제외` }),
    stats: statList([
      [metricPercent(result, "height_known_pct"), "높이 확인(원천+층수 추정)"],
      assumedRow,
    ]),
  };
}

function massOfS01(result: TileResult, scene: Scene | null | undefined): MassModel | null {
  if (!result.presentation.camera) return null;
  const camera = result.presentation.camera;
  if (typeof camera.azimuthDeg !== "number" || typeof camera.elevationDeg !== "number") return null;
  return {
    scene: scene ?? null,
    camera: {
      azimuthDeg: camera.azimuthDeg,
      elevationDeg: camera.elevationDeg,
      radiusM: typeof camera.radiusM === "number" ? camera.radiusM : result.conditions.radiusM,
    },
  };
}

export const s01ClientModule = {
  code: "S01",
  headline: { ids: ["height_median_m", "height_known_pct", "buildings"] },
  keyFigureFor: s01KeyFigure,
  mass: massOfS01,
  cut: s01CutModule,
} satisfies TileClientModule;
