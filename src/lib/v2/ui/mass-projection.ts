import { groundZAt, type Ring, type Scene } from "../scene";

export const EXPLODED_LAYERS = ["terrain", "water", "green", "roads", "buildings", "complete"] as const;
export type ExplodedLayer = (typeof EXPLODED_LAYERS)[number];
export type MassLayer = "mass_source" | "mass_estimated" | "mass_unknown" | "ground" | ExplodedLayer;

export type MassCamera = {
  azimuthDeg: number;
  elevationDeg: number;
  radiusM: number;
};

export type MassModel = {
  scene: Scene | null;
  camera: MassCamera;
  exploded?: { spreadPct: number };
};

export type MassFace = {
  path: string;
  shade: number;
  layer: MassLayer;
  depth: number;
  /** 분해 도판에서 면을 해당 원판 clip 그룹으로 보낼 때 사용한다. */
  stackIndex?: number;
  /** 분해 완성층이 원래 층의 색을 유지할 때만 채운다. */
  fill?: string;
  fillRule?: "evenodd";
};

export type MassLabel = { layer: ExplodedLayer; x: number; y: number; text: string };
export type MassPlate = {
  layer: ExplodedLayer;
  index: number;
  path: string;
  leftX: number;
  rightX: number;
  centerY: number;
  fill: string;
  present: boolean;
};
export type MassGuide = { side: "left" | "right"; x: number; y1: number; y2: number };

export type MassProjection = {
  faces: MassFace[];
  scale: number;
  labels?: MassLabel[];
  plates?: MassPlate[];
  guides?: MassGuide[];
};

export const CAMERA_PRESETS = {
  azimuth: [45, 135, 225, 315],
  elevation: [20, 35, 55],
} as const;

type RawPoint = { x: number; y: number; depth: number };
type RawFace = { points: RawPoint[]; paths?: RawPoint[][]; shade: number; layer: MassLayer; depth: number; fill?: string; fillRule?: "evenodd"; stackIndex?: number };
type WorldPoint = [number, number, number];

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

function pathOfFace(face: RawFace, scale: number, tx: number, ty: number, screenStep = 0): string {
  const layerTy = ty - (face.stackIndex ?? 0) * screenStep;
  return (face.paths ?? [face.points]).map((points) => pathOf(points, scale, tx, layerTy)).join("");
}

function rawPointsOf(face: RawFace): RawPoint[] {
  return (face.paths ?? [face.points]).flat();
}

function toMassFace(face: RawFace, scale: number, tx: number, ty: number, screenStep = 0): MassFace {
  const output: MassFace = { path: pathOfFace(face, scale, tx, ty, screenStep), shade: face.shade, layer: face.layer, depth: face.depth };
  if (face.stackIndex !== undefined) output.stackIndex = face.stackIndex;
  if (face.fill !== undefined) output.fill = face.fill;
  if (face.fillRule !== undefined) output.fillRule = face.fillRule;
  return output;
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

function layerOf(heightM: number | null, heightMethod: string): "mass_source" | "mass_estimated" | "mass_unknown" {
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

function groundCellFaces(
  ground: Extract<Scene["ground"], { kind: "dem" }>,
  project: (point: [number, number], z: number) => RawPoint,
  layer: MassLayer = "ground",
  fill?: string,
  stackIndex?: number,
): RawFace[] {
  const x0 = -((ground.cols - 1) * ground.cellM) / 2;
  const y0 = -((ground.rows - 1) * ground.cellM) / 2;
  const sample = (row: number, col: number): number | null => {
    const value = ground.z[row * ground.cols + col];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const cross = (a: WorldPoint, b: WorldPoint, c: WorldPoint): [number, number, number] => [
    (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
    (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
  ];
  const faces: RawFace[] = [];
  for (let row = 0; row < ground.rows - 1; row += 1) {
    for (let col = 0; col < ground.cols - 1; col += 1) {
      const z00 = sample(row, col);
      const z10 = sample(row, col + 1);
      const z11 = sample(row + 1, col + 1);
      const z01 = sample(row + 1, col);
      if (z00 === null || z10 === null || z11 === null || z01 === null) continue;

      const world: WorldPoint[] = [
        [x0 + col * ground.cellM, y0 + row * ground.cellM, z00],
        [x0 + (col + 1) * ground.cellM, y0 + row * ground.cellM, z10],
        [x0 + (col + 1) * ground.cellM, y0 + (row + 1) * ground.cellM, z11],
        [x0 + col * ground.cellM, y0 + (row + 1) * ground.cellM, z01],
      ];
      const [nx, ny, nz] = cross(world[0], world[1], world[2]);
      const normalLength = Math.hypot(nx, ny, nz);
      if (normalLength < EPSILON) continue;
      const points = world.map(([x, y, z]) => project([x, y], z));
      faces.push({
        points,
        shade: lightShade(nx / normalLength, ny / normalLength, nz / normalLength),
        layer,
        depth: averageDepth(points),
        fill,
        stackIndex,
      });
    }
  }
  return faces;
}

function addBuildingFaces(
  raw: RawFace[],
  building: Scene["buildings"][number],
  project: (point: [number, number], z: number) => RawPoint,
  cameraDirection: [number, number],
  outputLayer?: MassLayer,
  fill?: string,
  stackIndex?: number,
): void {
  const sourceLayer = layerOf(building.heightM, building.heightMethod);
  const layer = outputLayer ?? sourceLayer;
  const height = sourceLayer === "mass_unknown" ? 0 : (building.heightM as number);
  for (const sourceRing of building.rings) {
    const ring = cleanRing(sourceRing);
    if (ring.length < 3) continue;
    const baseZ = typeof building.baseZ === "number" && Number.isFinite(building.baseZ) ? building.baseZ : 0;

    if (sourceLayer === "mass_unknown") {
      const floor = ring.map((point) => project(point, baseZ));
      raw.push({ points: floor, shade: 0.38, layer, depth: averageDepth(floor), fill, stackIndex });
      continue;
    }

    const roof = ring.map((point) => project(point, baseZ + height));
    raw.push({ points: roof, shade: 0.94, layer, depth: averageDepth(roof), fill, stackIndex });

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
      const wall = [project(a, baseZ), project(b, baseZ), project(b, baseZ + height), project(a, baseZ + height)];
      raw.push({ points: wall, shade: lightShade(nx, ny, 0), layer, depth: averageDepth(wall), fill, stackIndex });
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
  if (scene.ground.kind === "dem") {
    raw.push(...groundCellFaces(scene.ground, project));
  } else {
    const ground = groundRing(radius).map((point) => project(point, 0));
    raw.push({ points: ground, shade: 0.08, layer: "ground", depth: -Number.MAX_VALUE });
  }

  for (const building of scene.buildings) addBuildingFaces(raw, building, project, cameraDirection);

  const allPoints = raw.flatMap((face) => face.points);
  if (allPoints.length === 0) return { faces: [], scale: 1 };
  const groundPoints = raw.filter((face) => face.layer === "ground").flatMap(rawPointsOf);
  const groundHeight = groundPoints.length > 0 ? Math.max(...groundPoints.map((point) => point.y)) - Math.min(...groundPoints.map((point) => point.y)) : 0;
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

  // 평탄 원판은 depth가 -MAX라 뒤에 남고, DEM 셀은 건물과 같은 깊이 정렬에 참여한다.
  const ordered = [...raw].sort((a, b) => a.depth - b.depth);
  return {
    faces: ordered.map((face) => toMassFace(face, scale, tx, ty)),
    scale,
  };
}

const EXPLODED_LABEL_TEXT: Record<ExplodedLayer, string> = {
  terrain: "지형",
  water: "수계",
  green: "녹지",
  roads: "도로",
  buildings: "건물",
  complete: "완성",
};

const EXPLODED_BUILDING_FILL: Record<"mass_source" | "mass_estimated" | "mass_unknown", string> = {
  mass_source: "#5E83B3",
  mass_estimated: "#C58B2B",
  mass_unknown: "#9EA5AF",
};

const EXPLODED_FILL = {
  terrain: "#EEF1F4",
  water: "#61AFC7",
  green: "#8ACB78",
  roads: "#727B88",
} as const;

const EXPLODED_PLATE_FILL: Record<ExplodedLayer, string> = {
  terrain: "#F0F2F4",
  water: "#E8F5F8",
  green: "#EEF7EC",
  roads: "#F0F2F5",
  buildings: "#EEF2F7",
  complete: "#F4F3F0",
};

function projectLayerPoint(
  point: [number, number],
  z: number,
  layerIndex: number,
  gap: number,
  cosA: number,
  sinA: number,
  cosE: number,
  sinE: number,
): RawPoint {
  return projectRaw(point, z + layerIndex * gap, cosA, sinA, cosE, sinE);
}

function contextPolygonFaces(
  raw: RawFace[],
  polygons: Ring[][],
  layer: MassLayer,
  layerIndex: number,
  ground: Scene["ground"],
  project: (point: [number, number], z: number) => RawPoint,
  fill: string,
): void {
  for (const polygon of polygons) {
    const rings = polygon.map(cleanRing).filter((ring) => ring.length >= 3);
    if (rings.length === 0) continue;
    const projectedRings = rings.map((ring) => ring.map((point) => project(point, groundZAt(ground, point[0], point[1]) ?? 0)));
    const points = projectedRings[0];
    const allPoints = projectedRings.flat();
    raw.push({
      points,
      paths: projectedRings,
      shade: 0.86,
      layer,
      depth: averageDepth(allPoints),
      fill,
      fillRule: "evenodd",
      stackIndex: layerIndex,
    });
  }
}

function contextRoadFaces(
  raw: RawFace[],
  roads: NonNullable<Scene["context"]>["roads"],
  layer: MassLayer,
  layerIndex: number,
  ground: Scene["ground"],
  project: (point: [number, number], z: number) => RawPoint,
  fill: string,
): void {
  for (const road of roads) {
    const points = road.points
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
      .map(([x, y]) => [x, y] as [number, number]);
    const width = Number.isFinite(road.widthM) && road.widthM > 0 ? road.widthM : 0;
    if (points.length < 2 || width <= 0) continue;
    for (let index = 0; index < points.length - 1; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const length = Math.hypot(dx, dy);
      if (length < EPSILON) continue;
      const nx = (-dy / length) * width * 0.5;
      const ny = (dx / length) * width * 0.5;
      const ring: [number, number][] = [
        [a[0] + nx, a[1] + ny],
        [b[0] + nx, b[1] + ny],
        [b[0] - nx, b[1] - ny],
        [a[0] - nx, a[1] - ny],
      ];
      const projected = ring.map((point) => project(point, groundZAt(ground, point[0], point[1]) ?? 0));
      raw.push({
        points: projected,
        shade: 0.76,
        layer,
        depth: averageDepth(projected),
        fill,
        stackIndex: layerIndex,
      });
    }
  }
}

function explodedTerrainFaces(
  raw: RawFace[],
  scene: Scene,
  layer: ExplodedLayer,
  layerIndex: number,
  project: (point: [number, number], z: number) => RawPoint,
  fill: string,
): void {
  if (scene.ground.kind === "dem") {
    raw.push(...groundCellFaces(scene.ground, project, layer, fill, layerIndex));
    return;
  }
  const points = groundRing(Math.max(1, finiteOr(scene.radiusM, 100))).map((point) => project(point, 0));
  raw.push({ points, shade: 0.95, layer, depth: averageDepth(points), fill, stackIndex: layerIndex });
}

function addExplodedBuildings(
  raw: RawFace[],
  scene: Scene,
  layer: ExplodedLayer,
  project: (point: [number, number], z: number) => RawPoint,
  cameraDirection: [number, number],
): void {
  for (const building of scene.buildings) {
    const sourceLayer = layerOf(building.heightM, building.heightMethod);
    addBuildingFaces(raw, building, project, cameraDirection, layer, EXPLODED_BUILDING_FILL[sourceLayer], EXPLODED_LAYERS.indexOf(layer));
  }
}

function hasContextPolygons(polygons: Ring[][] | undefined): boolean {
  return (polygons ?? []).some((polygon) => polygon.some((ring) => cleanRing(ring).length >= 3));
}

function hasContextRoads(roads: NonNullable<Scene["context"]>["roads"] | undefined): boolean {
  return (roads ?? []).some((road) => road.points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)).length >= 2 && Number.isFinite(road.widthM) && road.widthM > 0);
}

function hasBuildings(scene: Scene): boolean {
  return scene.buildings.some((building) => building.rings.some((ring) => cleanRing(ring).length >= 3));
}

/**
 * 장면을 지형·수계·녹지·도로·건물·완성의 여섯 축측 층으로 펼친다.
 * 각 층은 반경 × 0.18 × spreadPct/100 만큼 z축으로 떨어뜨리고, 화면에서는
 * 겹치지 않도록 같은 순서의 세로 여백을 둔다. 모든 층에 같은 반경 원판을
 * 반환해 SVG가 층별로 clip하고, 맥락 원천이 비어 있어도 빈 원판과 자료 없음
 * 라벨을 유지한다.
 */
export function projectExploded(
  scene: Scene,
  camera: MassCamera,
  width: number,
  height: number,
  spreadPct = 100,
): MassProjection & { labels: MassLabel[] } {
  const azimuth = radians(finiteOr(camera.azimuthDeg, 225));
  const elevation = radians(Math.max(-89, Math.min(89, finiteOr(camera.elevationDeg, 35))));
  const cosA = Math.cos(azimuth);
  const sinA = Math.sin(azimuth);
  const cosE = Math.cos(elevation);
  const sinE = Math.sin(elevation);
  const radius = Math.max(1, finiteOr(scene.radiusM, finiteOr(camera.radiusM, 100)));
  const spread = Math.max(0, finiteOr(spreadPct, 100)) / 100;
  const gap = radius * 0.18 * spread;
  // sitedia의 60% 캡처처럼 세로로 읽히되, 작은 도판에서도 마지막 원판이
  // 잘리지 않도록 뷰포트 높이에 상한을 둔다. 상한 전까지는 펼침 %에 선형이다.
  const screenStep = Math.min(height * 0.13, Math.min(width, height) * 0.24 * spread);
  const cameraDirection: [number, number] = [sinA, cosA];
  const raw: RawFace[] = [];
  const context = scene.context;
  const present: Record<ExplodedLayer, boolean> = {
    terrain: true,
    water: hasContextPolygons(context?.water),
    green: hasContextPolygons(context?.green),
    roads: hasContextRoads(context?.roads),
    buildings: hasBuildings(scene),
    complete: true,
  };
  const projectFor = (layer: ExplodedLayer) => {
    const layerIndex = EXPLODED_LAYERS.indexOf(layer);
    return (point: [number, number], z: number) => projectLayerPoint(point, z, layerIndex, gap, cosA, sinA, cosE, sinE);
  };

  explodedTerrainFaces(raw, scene, "terrain", 0, projectFor("terrain"), EXPLODED_FILL.terrain);
  if (present.water) contextPolygonFaces(raw, context?.water ?? [], "water", 1, scene.ground, projectFor("water"), EXPLODED_FILL.water);
  if (present.green) contextPolygonFaces(raw, context?.green ?? [], "green", 2, scene.ground, projectFor("green"), EXPLODED_FILL.green);
  if (present.roads) contextRoadFaces(raw, context?.roads ?? [], "roads", 3, scene.ground, projectFor("roads"), EXPLODED_FILL.roads);
  if (present.buildings) addExplodedBuildings(raw, scene, "buildings", projectFor("buildings"), cameraDirection);

  // 완성층은 각 원래 층의 색을 보존한 단일 층으로 다시 합성한다.
  explodedTerrainFaces(raw, scene, "complete", 5, projectFor("complete"), EXPLODED_FILL.terrain);
  if (present.water) contextPolygonFaces(raw, context?.water ?? [], "complete", 5, scene.ground, projectFor("complete"), EXPLODED_FILL.water);
  if (present.green) contextPolygonFaces(raw, context?.green ?? [], "complete", 5, scene.ground, projectFor("complete"), EXPLODED_FILL.green);
  if (present.roads) contextRoadFaces(raw, context?.roads ?? [], "complete", 5, scene.ground, projectFor("complete"), EXPLODED_FILL.roads);
  if (present.buildings) addExplodedBuildings(raw, scene, "complete", projectFor("complete"), cameraDirection);

  const plateRings = EXPLODED_LAYERS.map((layer) => groundRing(radius).map((point) => projectFor(layer)(point, 0)));
  const plateRawPoints = plateRings.flat();
  // 맥락선이 반경 밖으로 조금 돌출해도 plate의 축척·중심을 흔들지 않는다.
  // 건물층의 실제 높이만 plate 여백 계산에 참여시키고, 모든 face는 아래 SVG
  // clipPath에서 최종적으로 반경 원 안으로 잘린다.
  const layoutFaces = raw.filter((face) => face.stackIndex === EXPLODED_LAYERS.indexOf("buildings"));
  const layoutPoints = [...layoutFaces.flatMap(rawPointsOf), ...plateRawPoints];
  const layoutWidth = Math.max(...layoutPoints.map((point) => point.x)) - Math.min(...layoutPoints.map((point) => point.x));
  const layoutHeight = Math.max(...layoutPoints.map((point) => point.y)) - Math.min(...layoutPoints.map((point) => point.y));
  const plateWidth = Math.max(...plateRings[0].map((point) => point.x)) - Math.min(...plateRings[0].map((point) => point.x));
  const targetHeight = Math.max(1, height * 0.82);
  const byPlateWidth = plateWidth > EPSILON ? (width * 0.24) / plateWidth : 1;
  const byWidth = layoutWidth > EPSILON ? (width * 0.9) / layoutWidth : byPlateWidth;
  const byHeight = layoutHeight > EPSILON ? Math.max(0.0001, targetHeight - screenStep * (EXPLODED_LAYERS.length - 1)) / layoutHeight : byPlateWidth;
  const scale = Math.max(0.0001, Math.min(byPlateWidth, byWidth, byHeight));
  const screenPoints = [
    ...layoutFaces.flatMap((face) => rawPointsOf(face).map((point) => ({
      x: point.x * scale,
      y: point.y * scale - (face.stackIndex ?? 0) * screenStep,
    }))),
    ...plateRings.flatMap((ring, index) => ring.map((point) => ({
      x: point.x * scale,
      y: point.y * scale - index * screenStep,
    }))),
  ];
  const minX = Math.min(...screenPoints.map((point) => point.x));
  const maxX = Math.max(...screenPoints.map((point) => point.x));
  const minY = Math.min(...screenPoints.map((point) => point.y));
  const maxY = Math.max(...screenPoints.map((point) => point.y));
  const tx = width / 2 - (minX + maxX) / 2;
  const ty = height * 0.43 - (minY + maxY) / 2;
  const plates = EXPLODED_LAYERS.map((layer, index) => {
    const points = plateRings[index];
    const leftX = Math.min(...points.map((point) => point.x)) * scale + tx;
    const rightX = Math.max(...points.map((point) => point.x)) * scale + tx;
    const center = projectLayerPoint([0, 0], 0, index, gap, cosA, sinA, cosE, sinE);
    const centerY = center.y * scale + ty - index * screenStep;
    return {
      layer,
      index,
      path: pathOf(points, scale, tx, ty - index * screenStep),
      leftX,
      rightX,
      centerY,
      fill: EXPLODED_PLATE_FILL[layer],
      present: present[layer],
    } satisfies MassPlate;
  });
  const guides = plates.slice(0, -1).flatMap((plate, index) => {
    const next = plates[index + 1];
    return [
      { side: "left" as const, x: plate.leftX, y1: plate.centerY, y2: next.centerY },
      { side: "right" as const, x: plate.rightX, y1: plate.centerY, y2: next.centerY },
    ];
  });
  const labels = plates.map((plate) => ({
    layer: plate.layer,
    x: plate.leftX + 10,
    y: plate.centerY,
    text: plate.present ? EXPLODED_LABEL_TEXT[plate.layer] : `${EXPLODED_LABEL_TEXT[plate.layer]} · 자료 없음`,
  }));
  const ordered = [...raw].sort((a, b) => a.depth - b.depth);
  return {
    faces: ordered.map((face) => toMassFace(face, scale, tx, ty, screenStep)),
    scale,
    labels,
    plates,
    guides,
  };
}
