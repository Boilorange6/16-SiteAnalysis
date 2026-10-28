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
  hasSummary?: boolean;
  /** 그래프 자료가 있어 「지도 + 그래프」를 고를 수 있나 */
  hasCharts?: boolean;
  renderSignatures?: Partial<Record<ReportLayout, string>>;
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

function pageLabel(input: ReportLayoutInput): string {
  if (input.pageKind === "compare") return "조판";
  if (input.pageKind === "cover") return "표지";
  if (input.pageKind === "sources") return "출처";
  if (input.pageKind === "blank") return "빈 페이지";
  return input.hasMap ? "지도 타일" : "그림 타일";
}

function disabledChoices(reason: string): ReportLayoutChoice[] {
  return [
    { value: "map-full", label: "레이아웃 없음", disabled: true, tooltip: reason },
  ];
}

/**
 * 레이아웃 버튼은 이름이 아니라 계획 결과의 렌더 시그니처가 달라질 때만 남긴다.
 * 시그니처를 호출부가 넘기면 plan 결과 비교를 그대로 테스트할 수 있고, 없으면
 * 현재 문서의 지도/요약 조건으로 보수적인 기본 시그니처를 만든다.
 */
export function reportLayoutDecision(input: ReportLayoutInput): ReportLayoutDecision {
  const label = pageLabel(input);
  if (input.pageKind === "compare") return { pageLabel: label, choices: [], gridChoices: [...GRID_CHOICES] };
  if (input.pageKind !== "tile") {
    const reason = input.pageKind === "cover" ? "표지는 고정 배치입니다." : input.pageKind === "sources" ? "출처 페이지는 고정 배치입니다." : "빈 페이지는 배치가 없습니다.";
    return { pageLabel: label, choices: disabledChoices(reason), gridChoices: [], disabledReason: reason };
  }

  const mapWord = input.hasMap ? "지도" : "그림";
  const defaults: Record<ReportLayout, string> = {
    "map-full": `${mapWord}:full:${input.hasSummary ? "summary" : "none"}`,
    "map-summary": `${mapWord}:summary:${input.hasSummary ? "summary" : "none"}`,
    // 요약 칸이 없으면 그래프 열을 그릴 곳이 없어 「크게」와 같은 모양이다.
    "map-charts": input.hasSummary ? `${mapWord}:charts` : `${mapWord}:full:none`,
    "numbers-first": "numbers-first",
    "side-by-side": "legacy-hidden",
  };
  const signatures = { ...defaults, ...(input.renderSignatures ?? {}) };
  const seen = new Set<string>();
  const choices: ReportLayoutChoice[] = [];
  const candidates: Array<{ value: ReportLayout; label: string }> = [
    { value: "map-full", label: `${mapWord} 크게` },
    { value: "map-summary", label: `${mapWord} + 요약` },
    ...(input.hasCharts ? [{ value: "map-charts" as const, label: "지도 + 그래프" }] : []),
    { value: "numbers-first", label: "숫자 먼저" },
  ];
  for (const candidate of candidates) {
    const signature = signatures[candidate.value];
    if (seen.has(signature)) continue;
    seen.add(signature);
    choices.push(candidate);
  }
  return { pageLabel: label, choices, gridChoices: [] };
}

export function reportGridChoices(): ReportGridChoice[] {
  return [...GRID_CHOICES];
}
