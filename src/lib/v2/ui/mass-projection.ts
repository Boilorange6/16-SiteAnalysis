import type { Ring, Scene } from "../scene";

export type MassLayer = "mass_source" | "mass_estimated" | "mass_unknown" | "ground";

export type MassCamera = {
  azimuthDeg: number;
  elevationDeg: number;
  radiusM: number;
};

export type MassModel = {
  scene: Scene | null;
  camera: MassCamera;
};

export type MassFace = {
  path: string;
  shade: number;
  layer: MassLayer;
  depth: number;
};

export type MassProjection = {
  faces: MassFace[];
  scale: number;
};

type RawPoint = { x: number; y: number; depth: number };
type RawFace = { points: RawPoint[]; shade: number; layer: MassLayer; depth: number };

const EPSILON = 1e-8;

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const finiteOr = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);

function cleanRing(ring: Ring): [number, number][] {
  const points = ring.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)).map(([x, y]) => [x, y] as [number, number]);
  if (points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.abs(first[0] - last[0]) < EPSILON && Math.abs(first[1] - last[1]) < EPSILON) points.pop();
  }
  return points.length >= 3 ? points : [];
}

function signedArea(ring: [number, number][]): number {
  return ring.reduce((sum, point, index) => {
    const previous = ring[(index + ring.length - 1) % ring.length];
    return sum + previous[0] * point[1] - point[0] * previous[1];
  }, 0) / 2;
}

function pathOf(points: RawPoint[], scale: number, tx: number, ty: number): string {
  return `${points
    .map((point, index) => `${index === 0 ? "M" : "L"}${(point.x * scale + tx).toFixed(2)} ${(point.y * scale + ty).toFixed(2)}`)
    .join("")}Z`;
}

function averageDepth(points: RawPoint[]): number {
  return points.reduce((sum, point) => sum + point.depth, 0) / Math.max(1, points.length);
}

function lightShade(nx: number, ny: number, nz: number): number {
  // 북서 상단에서 비추는 부드러운 광원. shade는 0(어두움)~1(밝음)이다.
  const lx = -0.45;
  const ly = 0.7;
  const lz = 0.9;
  const length = Math.hypot(lx, ly, lz);
  const dot = (nx * lx + ny * ly + nz * lz) / length;
  return Math.max(0.2, Math.min(1, 0.42 + Math.max(0, dot) * 0.58));
}

function layerOf(heightM: number | null, heightMethod: string): MassLayer {
  if (heightM === null || !Number.isFinite(heightM) || heightM <= 0) return "mass_unknown";
  return heightMethod === "floors_estimate" ? "mass_estimated" : "mass_source";
}

function projectRaw(point: [number, number], z: number, cosA: number, sinA: number, cosE: number, sinE: number): RawPoint {
  const x = point[0] * cosA - point[1] * sinA;
  const y = point[0] * sinA + point[1] * cosA;
  return { x, y: -(y * sinE + z * cosE), depth: y * cosE - z * sinE };
}

function groundRing(radius: number): [number, number][] {
  const n = 72;
  return Array.from({ length: n }, (_, index) => {
    const angle = (index / n) * Math.PI * 2;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
}

function addBuildingFaces(
  raw: RawFace[],
  building: Scene["buildings"][number],
  project: (point: [number, number], z: number) => RawPoint,
  cameraDirection: [number, number],
): void {
  const layer = layerOf(building.heightM, building.heightMethod);
  const height = layer === "mass_unknown" ? 0 : (building.heightM as number);
  for (const sourceRing of building.rings) {
    const ring = cleanRing(sourceRing);
    if (ring.length < 3) continue;

    if (layer === "mass_unknown") {
      const floor = ring.map((point) => project(point, 0));
      raw.push({ points: floor, shade: 0.38, layer, depth: averageDepth(floor) });
      continue;
    }

    const roof = ring.map((point) => project(point, height));
    raw.push({ points: roof, shade: 0.94, layer, depth: averageDepth(roof) });

    // 고리의 방향을 이용해 외측 법선을 복원하고, 카메라를 향하는 벽만 남긴다.
    const ccw = signedArea(ring) >= 0;
    for (let index = 0; index < ring.length; index++) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const length = Math.hypot(dx, dy);
      if (length < EPSILON) continue;
      const nx = (ccw ? dy : -dy) / length;
      const ny = (ccw ? -dx : dx) / length;
      if (nx * cameraDirection[0] + ny * cameraDirection[1] <= 0) continue;
      const wall = [project(a, 0), project(b, 0), project(b, height), project(a, height)];
      raw.push({ points: wall, shade: lightShade(nx, ny, 0), layer, depth: averageDepth(wall) });
    }
  }
}

/**
 * Scene의 로컬 미터 좌표를 고정 축측 카메라용 SVG path로 투영한다.
 * x'·y'·depth 규약은 DXF/GLB와 독립적으로 화면과 PPT가 공유한다.
 */
export function projectMass(scene: Scene, camera: MassCamera, width: number, height: number): MassProjection {
  const azimuth = radians(finiteOr(camera.azimuthDeg, 225));
  const elevation = radians(Math.max(-89, Math.min(89, finiteOr(camera.elevationDeg, 35))));
  const cosA = Math.cos(azimuth);
  const sinA = Math.sin(azimuth);
  const cosE = Math.cos(elevation);
  const sinE = Math.sin(elevation);
  const project = (point: [number, number], z: number) => projectRaw(point, z, cosA, sinA, cosE, sinE);
  const cameraDirection: [number, number] = [sinA, cosA];
  const raw: RawFace[] = [];

  const radius = Math.max(1, finiteOr(scene.radiusM, finiteOr(camera.radiusM, 100)));
  const ground = groundRing(radius).map((point) => project(point, 0));
  raw.push({ points: ground, shade: 0.08, layer: "ground", depth: -Number.MAX_VALUE });

  for (const building of scene.buildings) addBuildingFaces(raw, building, project, cameraDirection);

  const groundHeight = Math.max(...ground.map((point) => point.y)) - Math.min(...ground.map((point) => point.y));
  const groundWidth = Math.max(...ground.map((point) => point.x)) - Math.min(...ground.map((point) => point.x));
  const allPoints = raw.flatMap((face) => face.points);
  const allWidth = Math.max(...allPoints.map((point) => point.x)) - Math.min(...allPoints.map((point) => point.x));
  const allHeight = Math.max(...allPoints.map((point) => point.y)) - Math.min(...allPoints.map((point) => point.y));
  const targetHeight = Math.max(1, height * 0.8);
  // 반경 원의 투영 높이를 그림 높이의 80%에 맞추되, 폭과 전체 건물이 잘리지 않게 한다.
  const byGround = groundHeight > EPSILON ? targetHeight / groundHeight : 1;
  const byWidth = allWidth > EPSILON ? (width * 0.94) / allWidth : byGround;
  const byHeight = allHeight > EPSILON ? (height * 0.92) / allHeight : byGround;
  const scale = Math.max(0.0001, Math.min(byGround, byWidth, byHeight));

  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const minY = Math.min(...allPoints.map((point) => point.y));
  const maxY = Math.max(...allPoints.map((point) => point.y));
  const tx = width / 2 - ((minX + maxX) / 2) * scale;
  const ty = height * 0.54 - ((minY + maxY) / 2) * scale;

  const ordered = [...raw].sort((a, b) => {
    if (a.layer === "ground" && b.layer !== "ground") return -1;
    if (a.layer !== "ground" && b.layer === "ground") return 1;
    return a.depth - b.depth;
  });
  return {
    faces: ordered.map((face) => ({ path: pathOf(face.points, scale, tx, ty), shade: face.shade, layer: face.layer, depth: face.depth })),
    scale,
  };
}
