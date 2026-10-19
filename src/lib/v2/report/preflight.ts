import type { PlannedSlide } from "./report-plan";

export type PreflightIssue = {
  pageNo: number;
  pageId: string;
  level: "warn" | "ok";
  text: string;
};

type SlideMeasure = { legendOverflow: boolean };
type StyleDecorations = { north?: boolean; scaleBar?: boolean };

const pageNoOf = (slide: PlannedSlide): number => slide.no;
const pageIdOf = (slide: PlannedSlide): string => slide.page?.id ?? slide.key;

function issue(slide: PlannedSlide, level: PreflightIssue["level"], text: string): PreflightIssue {
  return { pageNo: pageNoOf(slide), pageId: pageIdOf(slide), level, text };
}

function mapPage(slide: PlannedSlide): boolean {
  if (slide.kind === "tile" || slide.kind === "cover" || slide.kind === "sources") return !!slide.map;
  return slide.cells.some((cell) => !!cell?.view.map);
}

function decorationsOf(slide: PlannedSlide): StyleDecorations {
  const page = slide.page;
  if (page?.kind === "tile") return page.frame.decorations;
  if (page?.kind === "compare") {
    const decorations = page.cells.map((cell) => cell.frame.decorations);
    return {
      north: decorations.every((value) => value.north),
      scaleBar: decorations.every((value) => value.scaleBar),
    };
  }
  const style = slide.style as typeof slide.style & { decorations?: StyleDecorations; north?: boolean; scaleBar?: boolean };
  return {
    north: style.decorations?.north ?? style.north ?? true,
    scaleBar: style.decorations?.scaleBar ?? style.scaleBar ?? true,
  };
}

function measureFor(slide: PlannedSlide, measures: Map<string, SlideMeasure>): SlideMeasure | undefined {
  return measures.get(slide.key) ?? (slide.page ? measures.get(slide.page.id) : undefined);
}

function tileMissing(slide: PlannedSlide): boolean {
  return slide.kind === "tile" && (slide.missing === true || slide.body.kind === "state");
}

function tileTitle(slide: PlannedSlide): string {
  return slide.kind === "tile" ? slide.view.title : "타일";
}

/** 보고서 계획을 내보내기 전에 사용자가 고칠 수 있는 문제를 순수하게 찾는다. */
export function preflightReport(plan: PlannedSlide[], measures: Map<string, SlideMeasure>): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const maps = plan.filter(mapPage);
  let mapsAreReady = true;

  for (const slide of plan) {
    if (mapPage(slide)) {
      const decorations = decorationsOf(slide);
      if (!decorations.scaleBar || !decorations.north) {
        mapsAreReady = false;
        issues.push(issue(slide, "warn", `${slide.no}쪽 지도에 축척 막대나 방위표가 없습니다`));
      }
    }
    if (tileMissing(slide)) issues.push(issue(slide, "warn", `${slide.no}쪽 ${tileTitle(slide)}의 분석 결과가 없습니다`));
    if (measureFor(slide, measures)?.legendOverflow) {
      issues.push(issue(slide, "warn", `${slide.no}쪽 범례 한 줄이 페이지 밖으로 넘칩니다`));
    }
  }

  if (maps.length > 0 && mapsAreReady) {
    issues.push({ pageNo: 0, pageId: "maps", level: "ok", text: "모든 지도에 축척·방위표가 있습니다" });
  }
  const source = plan.find((slide) => slide.kind === "sources");
  if (source) issues.push(issue(source, "ok", "출처 페이지가 들어 있습니다"));
  else issues.push({ pageNo: 0, pageId: "sources", level: "warn", text: "출처 페이지가 없습니다" });
  return issues;
}
