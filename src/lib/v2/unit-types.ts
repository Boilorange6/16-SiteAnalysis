/** 단지 주택형 공통 규칙. 원천별 A/B/C 표기는 같은 전용면적 숫자로 합친다. */

export type UnitType = { typeM2: number; units: number };

/** 전용면적(㎡)을 사용자에게 표시하는 타입 숫자로 바꾼다. */
export function unitTypeM2(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : String(value ?? "").replace(/,/g, "").trim();
  const raw = typeof value === "number" ? value : Number(/^\+?(\d+(?:\.\d+)?)/.exec(text)?.[1] ?? text);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const typeM2 = Math.floor(raw);
  return typeM2 > 0 ? typeM2 : null;
}

/** 양수 세대수만 타입 집계에 반영한다. */
export function unitTypeUnits(value: unknown): number | null {
  const raw = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

export function mergeUnitType(target: Map<number, number>, typeM2: number | null, units: number | null): boolean {
  if (typeM2 === null || units === null) return false;
  target.set(typeM2, (target.get(typeM2) ?? 0) + units);
  return true;
}

export function sortedUnitTypes(value: Iterable<UnitType> | Map<number, number>): UnitType[] {
  const source = value instanceof Map ? [...value.entries()].map(([typeM2, units]) => ({ typeM2, units })) : [...value];
  return source
    .filter((item) => Number.isInteger(item.typeM2) && item.typeM2 > 0 && Number.isFinite(item.units) && item.units > 0)
    .map((item) => ({ typeM2: Math.trunc(item.typeM2), units: Math.trunc(item.units) }))
    .filter((item) => item.units > 0)
    .sort((a, b) => a.typeM2 - b.typeM2);
}

/** 엔진/저장 JSON에서 들어온 값을 안전하게 정규화한다. */
export function unitTypesFromUnknown(value: unknown): UnitType[] {
  if (!Array.isArray(value)) return [];
  const counts = new Map<number, number>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    mergeUnitType(counts, unitTypeM2(row.typeM2), unitTypeUnits(row.units));
  }
  return sortedUnitTypes(counts);
}

/** 세대수 상위 3타입을 전용면적 오름차순으로 보여주는 한 줄. */
export function unitTypeSummary(value: Iterable<UnitType> | Map<number, number>): string {
  const types = sortedUnitTypes(value);
  if (types.length === 0) return "타입 미확인";
  const top = [...types].sort((a, b) => b.units - a.units || a.typeM2 - b.typeM2).slice(0, 3).sort((a, b) => a.typeM2 - b.typeM2);
  const text = top.map((item) => `${item.typeM2}㎡ ${item.units.toLocaleString("en-US")}`).join(" · ");
  const rest = types.length - top.length;
  return rest > 0 ? `${text} 외 ${rest}타입` : text;
}

/** 화면/PPT에서 타입·세대수 짝을 원자 단위로 줄바꿈하기 위한 요약 조각. */
export function unitTypeSummaryParts(summary: string): string[] {
  return summary.split(" · ");
}

export const UNIT_TYPE_BASIS = "전용면적 기준";
