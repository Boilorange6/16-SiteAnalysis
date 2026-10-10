/**
 * 상세 표·카드·CSV에서 원천 코드를 사람이 읽는 라벨로 바꾸는 작은 공통 코드북.
 * 등록되지 않은 값은 원값을 반환해 새로운 원천 값이 조용히 사라지지 않게 한다.
 */

const VALUE_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  property_type: { apt: "아파트", offi: "오피스텔" },
  contract_type: { trade: "매매", jeonse: "전세", monthly: "월세" },
  renewal: { new: "신규", renewal: "갱신" },
  lifecycle_status: {
    proposed: "제안",
    approved: "승인",
    under_construction: "공사 중",
    opening_confirmed: "개통 확정",
    design: "설계",
    planned: "계획",
    operating: "운영",
  },
  stage: {
    proposed: "제안",
    approved: "승인",
    under_construction: "공사 중",
    opening_confirmed: "개통 확정",
    design: "설계",
    planned: "계획",
    operating: "운영",
  },
  metric: { gfa: "연면적", buildings: "건물 수" },
  season: { annual: "연간", spring: "봄", summer: "여름", autumn: "가을", winter: "겨울" },
  direction: {
    n: "북", nne: "북북동", ne: "북동", ene: "동북동", e: "동", ese: "동남동", se: "남동", sse: "남남동",
    s: "남", ssw: "남남서", sw: "남서", wsw: "서남서", w: "서", wnw: "서북서", nw: "북서", nnw: "북북서",
  },
  class: {
    forest: "산림", wood: "산림",
    park: "공원", nature_reserve: "공원", recreation_ground: "공원", garden: "공원",
    grass: "초지", meadow: "초지", heath: "초지", scrub: "초지",
    orchard: "과수원", vineyard: "과수원", allotments: "과수원",
    water: "수역", reservoir: "수역", river: "수역", riverbank: "수역", basin: "수역", wetland: "습지",
  },
};

export function detailDisplayValue(key: string, value: string | number | null): string | number | null {
  if (typeof value !== "string") return value;
  const raw = value.trim();
  return VALUE_LABELS[key]?.[raw.toLowerCase()] ?? value;
}
