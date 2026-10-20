import type { ReportPage } from "./report-doc";
import type { PlannedSlide } from "./report-plan";

/** export 계획의 한 출력 장을 페이지 줄에 표시하기 위한 저장하지 않는 view 모델. */
export type ReportPageStripItem = {
  page: ReportPage;
  slide: PlannedSlide;
  pageIndex: number;
  outputIndex: number;
  outputTotal: number;
  continuationIndex: number;
  continuationCount: number;
};

function pageTitle(page: ReportPage, slide: PlannedSlide): string {
  if (slide.kind === "tile" || slide.kind === "sheet") return slide.view.title;
  if (page.kind === "cover") return "표지";
  if (page.kind === "sources") return "출처·기준일";
  if (page.kind === "blank") return "빈 페이지";
  if (page.kind === "compare") return "여러 타일 비교";
  return page.part.type === "single" ? "분석 타일 한 장" : "분석 타일";
}

/** 같은 doc page가 여러 출력 장으로 확장될 때만 n/N을 붙인다. */
export function pageStripLabel(item: ReportPageStripItem): string {
  const title = pageTitle(item.page, item.slide);
  return item.continuationCount > 1
    ? `${title} ${item.continuationIndex}/${item.continuationCount}`
    : title;
}

/** 페이지 줄은 export와 동일한 PlannedSlide 배열에서만 만든다. */
export function pageStripItems(pages: readonly ReportPage[], plan: readonly PlannedSlide[]): ReportPageStripItem[] {
  const pageIndexById = new Map(pages.map((page, index) => [page.id, index]));
  const continuationCounts = new Map<string, number>();
  for (const slide of plan) {
    const id = slide.page?.id;
    if (id) continuationCounts.set(id, (continuationCounts.get(id) ?? 0) + 1);
  }
  const continuationSeen = new Map<string, number>();
  return plan.flatMap((slide, planIndex) => {
    const page = slide.page;
    if (!page) return [];
    const pageIndex = pageIndexById.get(page.id);
    if (pageIndex === undefined) return [];
    const continuationIndex = (continuationSeen.get(page.id) ?? 0) + 1;
    continuationSeen.set(page.id, continuationIndex);
    return [{
      page,
      slide,
      pageIndex,
      outputIndex: slide.no > 0 ? slide.no : planIndex + 1,
      outputTotal: slide.total > 0 ? slide.total : plan.length,
      continuationIndex,
      continuationCount: continuationCounts.get(page.id) ?? 1,
    }];
  });
}
