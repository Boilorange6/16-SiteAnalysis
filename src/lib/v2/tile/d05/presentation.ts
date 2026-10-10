import { isConfirmedHeightMethod, isAssumedOneFloor, type BuildingRow } from "../../engine/tiles/buildings-shared";

/** D05/D06/D07가 같은 건물의 라벨 값과 출력 순서를 공유한다. */
export function buildingSublabel(row: Pick<BuildingRow, "floorsAbove" | "heightM" | "heightMethod">): string | null {
  if (!isAssumedOneFloor(row) && row.floorsAbove !== null && Number.isFinite(row.floorsAbove) && row.floorsAbove > 0) {
    return `${Math.round(row.floorsAbove)}층`;
  }
  if (!isAssumedOneFloor(row) && row.heightM !== null && Number.isFinite(row.heightM) && row.heightM > 0) {
    const value = Math.round(row.heightM * 10) / 10;
    return `${Number.isInteger(value) ? value : value.toFixed(1)}m`;
  }
  return null;
}
export function buildingMapExtra(row: BuildingRow, layer: string): {
  name: string | null;
  sublabel: string | null;
  labelPriority: 0 | 1 | 2;
} {
  const name = row.hit.name ?? null;
  const priority = name === null ? 0 : layer === "tall_ge35" || layer === "tall_ge35_est" ? 2 : 1;
  return { name, sublabel: buildingSublabel(row), labelPriority: priority };
}

/** 지도 자동 라벨의 같은 등급 순서는 층수·높이가 큰 건물부터 결정한다. */
export function sortBuildingRows(rows: readonly BuildingRow[]): BuildingRow[] {
  return [...rows].sort((a, b) => {
    const floorDelta = (b.floorsAbove ?? -1) - (a.floorsAbove ?? -1);
    if (floorDelta !== 0) return floorDelta;
    const heightDelta = (b.heightM ?? -1) - (a.heightM ?? -1);
    if (heightDelta !== 0) return heightDelta;
    return a.hit.featureId - b.hit.featureId;
  });
}

/** D06·D07의 같은 경계 함수. 1층 가정은 확인 높이와 섞이지 않는다. */
export function heightLayer(row: BuildingRow, mode: "tall" | "low"): string {
  const value = row.heightM;
  if (value === null || !Number.isFinite(value)) return `${mode}_unknown`;
  if (row.heightMethod === "assumed_one_floor") return `${mode}_assumed_1f_est`;
  if (row.heightMethod === "floors_estimate") {
    if (mode === "tall") return value >= 35 ? "tall_ge35_est" : "tall_lt35";
    return value <= 12 ? "low_le12_est" : "low_gt12";
  }
  if (isConfirmedHeightMethod(row.heightMethod)) {
    if (mode === "tall") return value >= 35 ? "tall_ge35" : "tall_lt35";
    return value <= 12 ? "low_le12" : "low_gt12";
  }
  return `${mode}_unknown`;
}
