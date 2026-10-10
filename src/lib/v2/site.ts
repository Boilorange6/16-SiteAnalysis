/** 주소 입력 계약. 도로명 데이터 공급원이 붙으면 이 순수 검사만 제거하면 된다. */
export const ROAD_ADDRESS_UNSUPPORTED_MESSAGE = "도로명 주소는 아직 지원하지 않습니다 — 지번(예: 고덕동 250)으로 입력해 주세요";

const ROAD_ADDRESS_PATTERN = /(?:대로|로|길)\s*\d+(?:-\d+)?(?:\s|$)/u;

export function isRoadAddress(address: string): boolean {
  return ROAD_ADDRESS_PATTERN.test(address.trim().replace(/\s+/g, " "));
}

/** 분석 POST와 저장 프로젝트가 함께 보존하는 원본 대지 입력. */
export type SiteInput =
  | { pnus: readonly string[] }
  | { polygon: readonly [number, number][] };

/** 저장 JSON에서 원본 대지 입력만 안전하게 꺼낸다. 엔진의 EPSG:5179 geometry는 입력으로 쓰지 않는다. */
export function parseSiteInput(value: unknown): SiteInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.pnus) && record.pnus.length > 0 && record.pnus.length <= 30 && record.pnus.every((pnu) => typeof pnu === "string" && /^\d{19}$/.test(pnu))) {
    return { pnus: [...record.pnus] };
  }
  if (Array.isArray(record.polygon) && record.polygon.length >= 4 && record.polygon.length <= 501 && record.polygon.every((point): point is [number, number] => Array.isArray(point) && point.length === 2 && typeof point[0] === "number" && Number.isFinite(point[0]) && typeof point[1] === "number" && Number.isFinite(point[1]))) {
    const first = record.polygon[0]!;
    const last = record.polygon.at(-1)!;
    if (first[0] !== last[0] || first[1] !== last[1]) return null;
    return { polygon: record.polygon.map(([lng, lat]) => [lng, lat] as [number, number]) };
  }
  return null;
}
