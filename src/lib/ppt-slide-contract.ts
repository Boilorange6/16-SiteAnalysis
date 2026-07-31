import type { ResidentialPoi } from "./types";

/**
 * 보고서 슬라이드 계약 — pptx 생성기와 canvas 미리보기가 함께 쓰는 단일 출처.
 *
 * 기존에는 주거 POI 7개당 슬라이드를 무제한으로 붙여 결과에 따라 총 장수가 달라졌다.
 * 목차·페이지 참조·검수 기준이 매번 흔들리므로 주거 섹션을 고정 예산으로 묶는다.
 */
export const APT_PAGE_SIZE = 7;

/** 주거 공급 상세 슬라이드 고정 장수 */
export const RESIDENTIAL_SLIDE_BUDGET = 9;

/** 주거 섹션을 제외한 고정 슬라이드 수 */
export const FIXED_SLIDE_COUNT = 14;

/** 보고서 총 장수 계약 */
export const TOTAL_SLIDE_COUNT = FIXED_SLIDE_COUNT + RESIDENTIAL_SLIDE_BUDGET;

/**
 * 준공일 오름차순(미상은 뒤)으로 정렬해 고정 장수만큼 페이지를 만든다.
 * 부족하면 빈 페이지로 채우고, 넘치면 잘라낸다(잘린 수는 overflowNotice로 밝힌다).
 */
export function pageResidentials(
  residentials: readonly ResidentialPoi[],
  pageSize: number = APT_PAGE_SIZE,
  budget: number = RESIDENTIAL_SLIDE_BUDGET,
): ResidentialPoi[][] {
  const dated = [...residentials]
    .filter((apt) => apt.sale_date)
    .sort((left, right) => left.sale_date.localeCompare(right.sale_date));
  const undated = residentials.filter((apt) => !apt.sale_date);
  const ordered = [...dated, ...undated].slice(0, pageSize * budget);

  const pages: ResidentialPoi[][] = [];
  for (let index = 0; index < budget; index += 1) {
    pages.push(ordered.slice(index * pageSize, (index + 1) * pageSize));
  }
  return pages;
}

/** 지면에 담지 못한 항목 수를 밝힌다 — 조용한 절단은 "전부 실었다"로 오독된다 */
export function overflowNotice(total: number, shown: number): string {
  const hidden = total - shown;
  return hidden > 0 ? `외 ${hidden.toLocaleString()}개` : "";
}
