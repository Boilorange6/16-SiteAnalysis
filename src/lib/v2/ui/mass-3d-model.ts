import { groundZAt, type Ring, type Scene, type SceneBuilding } from "../scene";

/** S01의 3D 표시는 지형과 건물에 같은 실제 높이 배율을 사용한다. */
export const MASS_VERTICAL_EXAGGERATION = 1;

export type Mass3dHeightCategory = "confirmed" | "estimated" | "unknown";

/** v2 디자인 언어의 밝은 보드 톤을 3D 재질에도 그대로 적용한다. */
export const MASS_3D_COLORS = {
  confirmed: "#E8EDF2",
  estimated: "#F3D9A0",
  unknown: "#C8CDD4",
  terrain: "#E8ECEF",
  water: "#C4E6EB",
  green: "#CFE4C8",
  roads: "#D9DDE2",
  plate: "#F5F6F7",
  ink: "#111111",
} as const;

export type Mass3dPolygon = {
  outer: Ring;
  holes: Ring[];
};

export type Mass3dExtrusionSpec = Mass3dPolygon & {
  bottomZ: number;
  heightM: number;
  topZ: number;
  category: Mass3dHeightCategory;
  vertices: Array<[number, number, number]>;
};

const EPSILON = 1e-8;

export function cleanMassRing(ring: Ring): Ring {
  const points = ring
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    .map(([x, y]) => [x, y] as [number, number]);
  if (points.length > 1) {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (Math.abs(first[0] - last[0]) < EPSILON && Math.abs(first[1] - last[1]) < EPSILON) points.pop();
  }
  return points.length >= 3 ? points : [];
}

export function massRingArea(ring: Ring): number {
  const clean = cleanMassRing(ring);
  return clean.reduce((sum, point, index) => {
    const previous = clean[(index + clean.length - 1) % clean.length]!;
    return sum + previous[0] * point[1] - point[0] * previous[1];
  }, 0) / 2;
}

function pointInMassRing(point: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x, y] = ring[index]!;
    const [px, py] = ring[previous]!;
    const intersects = (y > point[1]) !== (py > point[1]) && point[0] < ((px - x) * (point[1] - y)) / (py - y || EPSILON) + x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function orientMassRing(ring: Ring, clockwise: boolean): Ring {
  const area = massRingArea(ring);
  if ((clockwise && area > 0) || (!clockwise && area < 0)) return [...ring].reverse();
  return ring;
}

/**
 * Scene의 링 배열을 ShapeGeometry가 이해하는 외곽 링 + 구멍으로 나눈다.
 * 입력 방향이 뒤섞여도 면적·포함관계로 보정하므로 행정 폴리곤의 방향에 기대지 않는다.
 */
export function polygonizeMassRings(rings: Ring[]): Mass3dPolygon[] {
  const clean = rings.map(cleanMassRing).filter((ring) => ring.length >= 3);
  const sorted = clean
    .map((ring, index) => ({ ring, index, area: Math.abs(massRingArea(ring)) }))
    .filter((entry) => entry.area > EPSILON)
    .sort((a, b) => b.area - a.area);
  const parents = new Map<number, number | null>();
  for (const entry of sorted) {
    const sample = entry.ring[0]!;
    const parent = sorted
      .filter((candidate) => candidate.area > entry.area + EPSILON && candidate.index !== entry.index && pointInMassRing(sample, candidate.ring))
      .sort((a, b) => a.area - b.area)[0];
    parents.set(entry.index, parent?.index ?? null);
  }

  const depthOf = (index: number): number => {
    let depth = 0;
    let parent = parents.get(index) ?? null;
    while (parent !== null) {
      depth += 1;
      parent = parents.get(parent) ?? null;
    }
    return depth;
  };

  return sorted
    .filter((entry) => depthOf(entry.index) % 2 === 0)
    .map((entry) => ({
      outer: orientMassRing(entry.ring, true),
      holes: sorted
        .filter((candidate) => parents.get(candidate.index) === entry.index && depthOf(candidate.index) % 2 === 1)
        .map((candidate) => orientMassRing(candidate.ring, false)),
    }));
}

export function mass3dHeightCategory(building: Pick<SceneBuilding, "heightM" | "heightMethod">): Mass3dHeightCategory {
  if (building.heightM === null || !Number.isFinite(building.heightM) || building.heightM <= 0) return "unknown";
  return building.heightMethod === "floors_estimate" || building.heightMethod === "assumed_one_floor" ? "estimated" : "confirmed";
}

export function mass3dBuildingHeight(building: Pick<SceneBuilding, "heightM" | "heightMethod">): number {
  const category = mass3dHeightCategory(building);
  return category === "unknown" ? 0 : Math.max(0, building.heightM ?? 0) * MASS_VERTICAL_EXAGGERATION;
}

function ringCentroid(ring: Ring): [number, number] {
  const clean = cleanMassRing(ring);
  if (clean.length === 0) return [0, 0];
  const area = massRingArea(clean);
  if (Math.abs(area) < EPSILON) {
    return [
      clean.reduce((sum, [x]) => sum + x, 0) / clean.length,
      clean.reduce((sum, [, y]) => sum + y, 0) / clean.length,
    ];
  }
  let x = 0;
  let y = 0;
  for (let index = 0; index < clean.length; index += 1) {
    const current = clean[index]!;
    const next = clean[(index + 1) % clean.length]!;
    const cross = current[0] * next[1] - next[0] * current[1];
    x += (current[0] + next[0]) * cross;
    y += (current[1] + next[1]) * cross;
  }
  return [x / (6 * area), y / (6 * area)];
}

/** 건물 바닥은 엔진이 계산한 baseZ를 우선하고, 누락된 DEM 장면에서는 지형을 직접 샘플한다. */
export function mass3dBuildingBottomZ(building: SceneBuilding, ground: Scene["ground"]): number {
  if (typeof building.baseZ === "number" && Number.isFinite(building.baseZ)) return building.baseZ;
  if (ground.kind === "flat") return 0;
  const first = building.rings[0];
  if (!first) return 0;
  const [x, y] = ringCentroid(first);
  return groundZAt(ground, x, y) ?? 0;
}

export function mass3dExtrusionVertices(polygon: Mass3dPolygon, bottomZ: number, heightM: number): Array<[number, number, number]> {
  const topZ = bottomZ + Math.max(0, heightM) * MASS_VERTICAL_EXAGGERATION;
  const rings = [polygon.outer, ...polygon.holes];
  return rings.flatMap((ring) => [
    ...ring.map(([x, y]) => [x, y, bottomZ] as [number, number, number]),
    ...ring.map(([x, y]) => [x, y, topZ] as [number, number, number]),
  ]);
}

export function mass3dExtrusionSpecs(building: SceneBuilding, ground: Scene["ground"]): Mass3dExtrusionSpec[] {
  const category = mass3dHeightCategory(building);
  const bottomZ = mass3dBuildingBottomZ(building, ground);
  const heightM = mass3dBuildingHeight(building);
  return polygonizeMassRings(building.rings).map((polygon) => ({
    ...polygon,
    bottomZ,
    heightM,
    topZ: bottomZ + heightM,
    category,
    vertices: mass3dExtrusionVertices(polygon, bottomZ, heightM),
  }));
}

export function mass3dGroundValues(scene: Scene): number[] {
  if (scene.ground.kind === "flat") return [0];
  return scene.ground.z.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

