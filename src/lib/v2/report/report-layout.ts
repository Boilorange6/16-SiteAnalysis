import type { ReportLayout } from "./report-doc";

export type ReportLayoutPageKind = "tile" | "compare" | "cover" | "sources" | "blank";
export type ReportGrid = "2x2" | "3x2" | "3x1";

export type ReportLayoutChoice = {
  value: ReportLayout;
  label: string;
  disabled?: boolean;
  tooltip?: string;
};

export type ReportGridChoice = { value: ReportGrid; label: string };

export type ReportLayoutInput = {
  pageKind: ReportLayoutPageKind;
  hasMap?: boolean;
  /** 지도가 아니라 그림(바람장미·3D 매스)이 전면인 장. 「숫자 먼저」는 지도 틀 전용이라 뺀다. */
  figure?: boolean;
  /** 그래프 자료가 있어 「지도 + 그래프」를 고를 수 있나 */
  hasCharts?: boolean;
  /** D17 지형 단면을 그리는 장: 그래프 카드 자리가 단면이라 「지도 + 그래프」 한 가지 배치만 갖는다(Ruling 37). */
  terrain?: boolean;
};

export type ReportLayoutDecision = {
  pageLabel: string;
  choices: ReportLayoutChoice[];
  gridChoices: ReportGridChoice[];
  disabledReason?: string;
};

const GRID_CHOICES: readonly ReportGridChoice[] = [
  { value: "2x2", label: "2×2 · 4칸" },
  { value: "3x2", label: "3×2 · 6칸" },
  { value: "3x1", label: "3×1 · 3칸" },
];

/** 보고서 장이 지도가 아니라 그림(바람장미 D22·3D 매스 S01)을 전면에 그리는 타일 코드 */
export const FIGURE_TILE_CODES: ReadonlySet<string> = new Set(["D22", "S01"]);

export function isFigureTileId(tileId: string): boolean {
  return FIGURE_TILE_CODES.has(/(?:^|-)([ADS]\d{2})$/.exec(tileId)?.[1] ?? "");
}

type FigureSlideLike = { kind: string; rose?: unknown; mass?: unknown; cells?: ReadonlyArray<{ rose?: unknown; mass?: unknown } | null | undefined> };

/**
 * 그림(바람장미·3D 매스)이 전면인 장인가: 그림 타일 한 장이거나, 칸이 모두 그림인 컷 시트(D22 계절 4컷 등).
 * 레이아웃 창의 선택지(`그림 + 숫자`)와 저장 값(`map-key`)이 이 판정 하나를 따라 저장·복원이 같은 값이 된다.
 */
export function isFigureSlide(slide: FigureSlideLike): boolean {
  if (slide.kind === "tile") return !!(slide.rose || slide.mass);
  if (slide.kind !== "sheet") return false;
  const cells = (slide.cells ?? []).filter((cell) => !!cell);
  return cells.length > 0 && cells.every((cell) => !!(cell!.rose || cell!.mass));
}

function pageLabel(input: ReportLayoutInput): string {
  if (input.pageKind === "compare") return "조판";
  if (input.pageKind === "cover") return "표지";
  if (input.pageKind === "sources") return "출처";
  if (input.pageKind === "blank") return "빈 페이지";
  return input.hasMap ? "지도 타일" : "그림 타일";
}

function disabledChoices(reason: string): ReportLayoutChoice[] {
  return [
    { value: "map-key", label: "레이아웃 없음", disabled: true, tooltip: reason },
  ];
}

/**
 * 레이아웃 창에는 그 장에서 실제로 다르게 그려지는 것만 보인다(§9-8).
 * 지도·그림이 없는 장은 숫자 먼저, 지도·그림 장은 지도(그림) + 숫자, 그래프 자료가 있으면 지도 + 그래프를 더한다.
 */
export function reportLayoutDecision(input: ReportLayoutInput): ReportLayoutDecision {
  const label = pageLabel(input);
  if (input.pageKind === "compare") return { pageLabel: label, choices: [], gridChoices: [...GRID_CHOICES] };
  if (input.pageKind !== "tile") {
    const reason = input.pageKind === "cover" ? "표지는 고정 배치입니다." : input.pageKind === "sources" ? "출처 페이지는 고정 배치입니다." : "빈 페이지는 배치가 없습니다.";
    return { pageLabel: label, choices: disabledChoices(reason), gridChoices: [], disabledReason: reason };
  }

  // 지도도 그림도 없는 장(뒷면 표 등)은 숫자 먼저 하나뿐이다.
  if (!input.hasMap && !input.figure) return { pageLabel: label, choices: [{ value: "numbers-first", label: "숫자 먼저" }], gridChoices: [] };
  if (input.terrain && input.hasMap && !input.figure) return { pageLabel: label, choices: [{ value: "map-charts", label: "지도 + 그래프" }], gridChoices: [] };
  const choices: ReportLayoutChoice[] = [
    { value: "map-key", label: input.hasMap ? "지도 + 숫자" : "그림 + 숫자" },
    ...(input.hasCharts && !input.figure ? [{ value: "map-charts" as const, label: "지도 + 그래프" }] : []),
  ];
  return { pageLabel: label, choices, gridChoices: [] };
}

/**
 * 그리는 단계의 공통 판정. 저장된 값(옛 값 포함)과 이 장의 지도·그림·그래프 유무로 실제 레이아웃을 정한다.
 * 그래프 자료를 잃은 map-charts(옛 분석 등)는 map-key로 그려 빈 그래프 카드를 남기지 않는다.
 */
export function resolveReportLayout(layout: ReportLayout, page: { hasMap: boolean; figure: boolean; hasCharts: boolean; terrain?: boolean }): "map-key" | "map-charts" | "numbers-first" {
  if (!page.hasMap && !page.figure) return "numbers-first";
  if (page.terrain && page.hasMap && !page.figure) return "map-charts"; // 단면 장은 저장 값과 상관없이 단면이 있는 배치로 읽는다(Ruling 37)
  if ((layout === "map-charts" || layout === "numbers-first") && page.hasCharts && !page.figure) return "map-charts";
  return "map-key";
}

export function reportGridChoices(): ReportGridChoice[] {
  return [...GRID_CHOICES];
}
