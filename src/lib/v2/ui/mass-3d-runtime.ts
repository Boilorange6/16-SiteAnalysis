import { groundZAt, type Ring, type Scene } from "../scene";
import { CAMERA_PRESETS, EXPLODED_LAYERS, MASS_USE_COLORS, type MassCamera, type MassColorScheme } from "./mass-projection";
import {
  MASS_3D_COLORS,
  mass3dBuildingBottomZ,
  mass3dExtrusionSpecs,
  mass3dGroundValues,
  mass3dHeightCategory,
  polygonizeMassRings,
  type Mass3dHeightCategory,
  type Mass3dPolygon,
} from "./mass-3d-model";

export type Mass3dRenderInput = {
  scene: Scene | null;
  camera: MassCamera;
  width: number;
  height: number;
  exploded?: { spreadPct: number; scheme?: MassColorScheme };
  quality?: "card" | "detail";
  label?: string;
};

export type Mass3dMount = {
  update: (input: Mass3dRenderInput) => void;
  dispose: () => void;
};

type ThreeModule = any;
type ThreeObject = any;
type ThreeMaterial = any;
type ThreeGeometry = any;

const DEFAULT_CAMERA: MassCamera = { azimuthDeg: 225, elevationDeg: 35, radiusM: 100 };
const EPSILON = 1e-6;
const IMAGE_CACHE_LIMIT = 24;
const PNG_CACHE = new Map<string, string>();
const PNG_PENDING = new Map<string, Promise<string>>();
let threePromise: Promise<ThreeModule> | null = null;
let offscreenRenderer: any = null;

const finiteOr = (value: number | null | undefined, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const radians = (degrees: number): number => (degrees * Math.PI) / 180;

export function mass3dCacheKey(input: Pick<Mass3dRenderInput, "scene" | "camera" | "width" | "height" | "exploded" | "quality">): string {
  const sceneKey = input.scene ? `${input.scene.analysisId}:${input.scene.manifestHash}` : "empty";
  const camera = input.camera ?? DEFAULT_CAMERA;
  const exploded = input.exploded ? `${input.exploded.spreadPct}:${input.exploded.scheme ?? "use"}` : "basic";
  return [
    sceneKey,
    camera.azimuthDeg,
    camera.elevationDeg,
    camera.radiusM,
    exploded,
    input.quality ?? "detail",
    Math.round(input.width),
    Math.round(input.height),
  ].join("|");
}

export function isMass3dWebGLAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

async function loadThree(): Promise<ThreeModule> {
  threePromise ??= import("three");
  return threePromise;
}

function cleanCanvasSize(value: number, fallback: number): number {
  return Math.max(1, Math.round(finiteOr(value, fallback)));
}

function makeRenderer(THREE: ThreeModule, canvas?: HTMLCanvasElement): any {
  if (!isMass3dWebGLAvailable()) throw new Error("WebGL을 사용할 수 없습니다.");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor("#F2F2EF", 1);
  renderer.setPixelRatio(1);
  if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

function ringCenter(ring: Ring): [number, number] {
  if (ring.length === 0) return [0, 0];
  return [
    ring.reduce((sum, [x]) => sum + x, 0) / ring.length,
    ring.reduce((sum, [, y]) => sum + y, 0) / ring.length,
  ];
}

function averageGroundZ(scene: Scene, ring: Ring): number {
  if (scene.ground.kind === "flat") return 0;
  const values = ring.map(([x, y]) => groundZAt(scene.ground, x, y)).filter((value): value is number => value !== null);
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function sceneRadius(scene: Scene | null, camera: MassCamera): number {
  return Math.max(1, finiteOr(scene?.radiusM, finiteOr(camera.radiusM, 100)));
}

function layerGap(scene: Scene | null, camera: MassCamera, exploded: Mass3dRenderInput["exploded"]): number {
  if (!exploded) return 0;
  return sceneRadius(scene, camera) * 0.18 * Math.max(0, finiteOr(exploded.spreadPct, 100)) / 100;
}

function layerOffset(scene: Scene | null, camera: MassCamera, exploded: Mass3dRenderInput["exploded"], index: number): number {
  return layerGap(scene, camera, exploded) * index;
}

function safeScheme(input: Mass3dRenderInput): MassColorScheme {
  return input.exploded?.scheme ?? "use";
}

function useClassOf(code: string | null): string {
  if (typeof code !== "string") return "미상";
  const key = code.trim().slice(0, 2);
  if (["01", "02"].includes(key)) return "주거";
  if (["03", "04"].includes(key)) return "근린생활";
  if (["05", "06", "13", "27"].includes(key)) return "문화집회";
  if (key === "07") return "판매";
  if (["08", "20", "21", "23", "26", "28", "29"].includes(key)) return "기타";
  if (["09", "10", "11", "12"].includes(key)) return "교육복지";
  if (["14", "24"].includes(key)) return "업무";
  if (["15", "16"].includes(key)) return "숙박";
  if (["17", "18", "19", "22", "25"].includes(key)) return "공업";
  return "미상";
}

const useColors = new Map<string, string>(MASS_USE_COLORS.map(({ label, color }) => [label, color]));
const ageColors = ["#B98977", "#C6A28A", "#D5B99A", "#E2CCAC", "#EBDDBE", "#F1E8D5", "#D0D3D6"];
const heightColors = ["#D9E6E0", "#C7DBD9", "#B2CDD2", "#A4BDD0", "#B8B9CD", "#D0D3D6"];

function approvalYear(value: string | null): number | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})/);
  const year = match ? Number(match[1]) : NaN;
  return Number.isFinite(year) && year >= 1900 && year <= 2200 ? year : null;
}

function buildingColor(building: Scene["buildings"][number], category: Mass3dHeightCategory, input: Mass3dRenderInput): string {
  if (!input.exploded) return MASS_3D_COLORS[category];
  const scheme = safeScheme(input);
  if (scheme === "single") return category === "unknown" ? MASS_3D_COLORS.unknown : "#D2DCE5";
  if (scheme === "use") return useColors.get(useClassOf(building.useCode)) ?? useColors.get("미상")!;
  if (scheme === "age") {
    const year = approvalYear(building.approvalDate);
    if (year === null) return ageColors[ageColors.length - 1]!;
    if (year < 1980) return ageColors[0]!;
    if (year < 1990) return ageColors[1]!;
    if (year < 2000) return ageColors[2]!;
    if (year < 2010) return ageColors[3]!;
    if (year < 2020) return ageColors[4]!;
    return ageColors[5]!;
  }
  const floors = building.floorsAbove ?? (building.heightM !== null && building.heightM > 0 ? building.heightM / 3 : null);
  if (floors === null || !Number.isFinite(floors)) return heightColors[heightColors.length - 1]!;
  if (floors <= 4) return heightColors[0]!;
  if (floors <= 8) return heightColors[1]!;
  if (floors <= 14) return heightColors[2]!;
  if (floors <= 25) return heightColors[3]!;
  return heightColors[4]!;
}

function createShape(THREE: ThreeModule, polygon: Mass3dPolygon): any {
  const draw = (path: any, ring: Ring) => {
    const first = ring[0];
    if (!first) return;
    path.moveTo(first[0], first[1]);
    for (const [x, y] of ring.slice(1)) path.lineTo(x, y);
    path.closePath();
  };
  const shape = new THREE.Shape();
  draw(shape, polygon.outer);
  for (const hole of polygon.holes) {
    const path = new THREE.Path();
    draw(path, hole);
    shape.holes.push(path);
  }
  return shape;
}

function materialFor(
  THREE: ThreeModule,
  materials: Map<string, ThreeMaterial>,
  color: string,
  options: { transparent?: boolean; opacity?: number; polygonOffset?: boolean } = {},
): ThreeMaterial {
  const key = `${color}|${options.transparent ? "t" : "o"}|${options.opacity ?? 1}|${options.polygonOffset ? "p" : "n"}`;
  const existing = materials.get(key);
  if (existing) return existing;
  const material = new THREE.MeshLambertMaterial({
    color,
    side: THREE.DoubleSide,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    polygonOffset: options.polygonOffset ?? false,
    polygonOffsetFactor: options.polygonOffset ? -1 : 0,
    polygonOffsetUnits: options.polygonOffset ? -1 : 0,
  });
  materials.set(key, material);
  return material;
}

function createGroundGeometry(THREE: ThreeModule, scene: Scene, radius: number, zOffset: number): ThreeGeometry {
  if (scene.ground.kind === "flat") {
    const geometry = new THREE.CircleGeometry(radius, 72);
    geometry.translate(0, 0, zOffset);
    return geometry;
  }
  const ground = scene.ground;
  const x0 = -((ground.cols - 1) * ground.cellM) / 2;
  const y0 = -((ground.rows - 1) * ground.cellM) / 2;
  const positions: number[] = [];
  for (let row = 0; row < ground.rows; row += 1) {
    for (let col = 0; col < ground.cols; col += 1) {
      const value = ground.z[row * ground.cols + col];
      positions.push(x0 + col * ground.cellM, y0 + row * ground.cellM, (typeof value === "number" && Number.isFinite(value) ? value : 0) + zOffset);
    }
  }
  const indices: number[] = [];
  const sample = (row: number, col: number): number | null => {
    const value = ground.z[row * ground.cols + col];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  for (let row = 0; row < ground.rows - 1; row += 1) {
    for (let col = 0; col < ground.cols - 1; col += 1) {
      if (sample(row, col) === null || sample(row, col + 1) === null || sample(row + 1, col) === null || sample(row + 1, col + 1) === null) continue;
      const a = row * ground.cols + col;
      const b = a + 1;
      const d = (row + 1) * ground.cols + col;
      const c = d + 1;
      indices.push(a, b, c, a, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addTerrain(
  THREE: ThreeModule,
  root: any,
  materials: Map<string, ThreeMaterial>,
  scene: Scene,
  radius: number,
  zOffset: number,
): void {
  const geometry = createGroundGeometry(THREE, scene, radius, zOffset);
  const mesh = new THREE.Mesh(geometry, materialFor(THREE, materials, MASS_3D_COLORS.terrain));
  mesh.name = "s01-terrain";
  mesh.receiveShadow = true;
  root.add(mesh);
}

function addPlate(
  THREE: ThreeModule,
  root: any,
  materials: Map<string, ThreeMaterial>,
  radius: number,
  z: number,
  layer: string,
): void {
  const plate = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 72),
    materialFor(THREE, materials, MASS_3D_COLORS.plate, { polygonOffset: true }),
  );
  plate.name = `s01-plate-${layer}`;
  plate.position.z = z - 0.08;
  plate.receiveShadow = true;
  root.add(plate);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(radius, 72), new THREE.ShadowMaterial({ opacity: 0.1 }));
  shadow.name = `s01-plate-shadow-${layer}`;
  shadow.position.z = z - 0.03;
  shadow.receiveShadow = true;
  root.add(shadow);
}

function addPolygonMesh(
  THREE: ThreeModule,
  root: any,
  materials: Map<string, ThreeMaterial>,
  polygon: Mass3dPolygon,
  color: string,
  z: number,
  name: string,
): void {
  const geometry = new THREE.ShapeGeometry(createShape(THREE, polygon));
  const mesh = new THREE.Mesh(geometry, materialFor(THREE, materials, color, { polygonOffset: true }));
  mesh.name = name;
  mesh.position.z = z + 0.035;
  mesh.receiveShadow = true;
  root.add(mesh);
}

function addContextPolygons(
  THREE: ThreeModule,
  root: any,
  materials: Map<string, ThreeMaterial>,
  scene: Scene,
  polygons: Ring[][],
  color: string,
  zOffset: number,
  name: string,
): void {
  polygons.forEach((rings, index) => {
    const valid = polygonizeMassRings(rings);
    valid.forEach((polygon, polygonIndex) => {
      addPolygonMesh(THREE, root, materials, polygon, color, zOffset + averageGroundZ(scene, polygon.outer), `${name}-${index}-${polygonIndex}`);
    });
  });
}

function addRoads(
  THREE: ThreeModule,
  root: any,
  materials: Map<string, ThreeMaterial>,
  scene: Scene,
  zOffset: number,
): void {
  for (const [roadIndex, road] of (scene.context?.roads ?? []).entries()) {
    const points = road.points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    const width = finiteOr(road.widthM, 0);
    if (points.length < 2 || width <= 0) continue;
    for (let index = 0; index < points.length - 1; index += 1) {
      const a = points[index]!;
      const b = points[index + 1]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const length = Math.hypot(dx, dy);
      if (length < EPSILON) continue;
      const nx = (-dy / length) * width * 0.5;
      const ny = (dx / length) * width * 0.5;
      const polygon: Mass3dPolygon = {
        outer: [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]],
        holes: [],
      };
      addPolygonMesh(THREE, root, materials, polygon, MASS_3D_COLORS.roads, zOffset + averageGroundZ(scene, polygon.outer), `s01-road-${roadIndex}-${index}`);
    }
  }
}

function addBuildingMeshes(
  THREE: ThreeModule,
  root: any,
  materials: Map<string, ThreeMaterial>,
  scene: Scene,
  input: Mass3dRenderInput,
  zOffset: number,
): void {
  for (const [buildingIndex, building] of scene.buildings.entries()) {
    const category = mass3dHeightCategory(building);
    const color = buildingColor(building, category, input);
    const specs = mass3dExtrusionSpecs(building, scene.ground);
    for (const [polygonIndex, spec] of specs.entries()) {
      const shape = createShape(THREE, spec);
      const geometry = spec.heightM > 0
        ? new THREE.ExtrudeGeometry(shape, { depth: spec.heightM, bevelEnabled: false, steps: 1, curveSegments: 1 })
        : new THREE.ShapeGeometry(shape);
      const mesh = new THREE.Mesh(geometry, materialFor(THREE, materials, color));
      mesh.name = `s01-building-${buildingIndex}-${polygonIndex}`;
      mesh.position.z = spec.bottomZ + zOffset;
      mesh.castShadow = spec.heightM > 0;
      mesh.receiveShadow = true;
      root.add(mesh);
    }
  }
}

function addSiteMarker(
  THREE: ThreeModule,
  root: any,
  scene: Scene,
  radius: number,
  zOffset: number,
): void {
  if (!scene.site || scene.site.length === 0) return;
  const white = new THREE.LineBasicMaterial({ color: "#FFFFFF", transparent: true, opacity: 0.95 });
  const black = new THREE.LineBasicMaterial({ color: MASS_3D_COLORS.ink });
  const allPoints = scene.site.flatMap((ring) => ring);
  for (const [ringIndex, ring] of scene.site.entries()) {
    const points = ring.map(([x, y]) => new THREE.Vector3(x, y, (groundZAt(scene.ground, x, y) ?? 0) + zOffset + 0.11));
    if (points.length < 3) continue;
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const halo = new THREE.LineLoop(geometry, white);
    halo.name = `s01-site-halo-${ringIndex}`;
    root.add(halo);
    const outline = new THREE.LineLoop(geometry.clone(), black);
    outline.name = `s01-site-outline-${ringIndex}`;
    root.add(outline);
  }
  const [cx, cy] = ringCenter(allPoints);
  const z = (groundZAt(scene.ground, cx, cy) ?? 0) + zOffset + 0.16;
  const size = Math.max(2, Math.min(radius * 0.035, radius * 0.08));
  const diamond: Ring = [[cx, cy + size], [cx + size, cy], [cx, cy - size], [cx - size, cy]];
  const shape = new THREE.Shape();
  shape.moveTo(diamond[0]![0], diamond[0]![1]);
  for (const [x, y] of diamond.slice(1)) shape.lineTo(x, y);
  shape.closePath();
  const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: "#FFFFFF", side: THREE.DoubleSide }));
  fill.position.z = z;
  fill.name = "s01-site-diamond";
  root.add(fill);
  const border = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(diamond.map(([x, y]) => new THREE.Vector3(x, y, z + 0.02))), black);
  border.name = "s01-site-diamond-border";
  root.add(border);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(Math.max(0.6, size * 0.16), 16), new THREE.MeshBasicMaterial({ color: MASS_3D_COLORS.ink }));
  dot.position.set(cx, cy, z + 0.03);
  dot.name = "s01-site-center";
  root.add(dot);
}

function heightBounds(scene: Scene | null, input: Mass3dRenderInput): { min: number; max: number } {
  if (!scene) return { min: 0, max: 0 };
  const terrain = mass3dGroundValues(scene);
  let min = terrain.length > 0 ? Math.min(...terrain) : 0;
  let max = terrain.length > 0 ? Math.max(...terrain) : 0;
  for (const building of scene.buildings) {
    const bottom = mass3dBuildingBottomZ(building, scene.ground);
    const height = mass3dHeightCategory(building) === "unknown" ? 0 : Math.max(0, building.heightM ?? 0);
    min = Math.min(min, bottom);
    max = Math.max(max, bottom + height);
  }
  const gap = layerGap(scene, input.camera, input.exploded);
  if (input.exploded) max += gap * (EXPLODED_LAYERS.length - 1);
  return { min, max };
}

function boundsForCamera(THREE: ThreeModule, scene: Scene | null, input: Mass3dRenderInput): { targetZ: number; viewWidth: number; viewHeight: number; distance: number } {
  const radius = sceneRadius(scene, input.camera);
  const bounds = heightBounds(scene, input);
  const elevationDeg = input.exploded ? 15 : Math.max(-89, Math.min(89, finiteOr(input.camera.elevationDeg, DEFAULT_CAMERA.elevationDeg)));
  const elevation = radians(elevationDeg);
  const azimuth = radians(finiteOr(input.camera.azimuthDeg, DEFAULT_CAMERA.azimuthDeg));
  const cosA = Math.cos(azimuth);
  const sinA = Math.sin(azimuth);
  const cosE = Math.cos(elevation);
  const sinE = Math.sin(elevation);
  const targetZ = (bounds.min + bounds.max) / 2;
  const points: Array<[number, number, number]> = [
    [-radius, -radius, bounds.min], [radius, -radius, bounds.min], [radius, radius, bounds.min], [-radius, radius, bounds.min],
    [-radius, -radius, bounds.max], [radius, -radius, bounds.max], [radius, radius, bounds.max], [-radius, radius, bounds.max],
  ];
  if (scene?.ground.kind === "dem") {
    const ground = scene.ground;
    const x0 = -((ground.cols - 1) * ground.cellM) / 2;
    const y0 = -((ground.rows - 1) * ground.cellM) / 2;
    points.push([x0, y0, bounds.min], [x0 + (ground.cols - 1) * ground.cellM, y0, bounds.min], [x0, y0 + (ground.rows - 1) * ground.cellM, bounds.min], [x0 + (ground.cols - 1) * ground.cellM, y0 + (ground.rows - 1) * ground.cellM, bounds.max]);
  }
  const projected = points.map(([x, y, z]) => ({
    x: x * cosA - y * sinA,
    y: -((x * sinA + y * cosA) * sinE + (z - targetZ) * cosE),
  }));
  const projectedWidth = Math.max(1, Math.max(...projected.map((point) => point.x)) - Math.min(...projected.map((point) => point.x)));
  const projectedHeight = Math.max(1, Math.max(...projected.map((point) => point.y)) - Math.min(...projected.map((point) => point.y)));
  const aspect = cleanCanvasSize(input.width, 960) / cleanCanvasSize(input.height, 540);
  const viewHeight = Math.max(projectedHeight, projectedWidth / Math.max(0.1, aspect)) * 1.16;
  const viewWidth = viewHeight * Math.max(0.1, aspect);
  const distance = Math.max(radius * 4, (bounds.max - bounds.min + radius) * 6, 200);
  // Keep THREE referenced here so tree-shaking does not accidentally elide the coordinate contract.
  void THREE;
  return { targetZ, viewWidth, viewHeight, distance };
}

function makeCamera(THREE: ThreeModule, scene: Scene | null, input: Mass3dRenderInput, width: number, height: number): any {
  const fit = boundsForCamera(THREE, scene, { ...input, width, height });
  const camera = new THREE.OrthographicCamera(-fit.viewWidth / 2, fit.viewWidth / 2, fit.viewHeight / 2, -fit.viewHeight / 2, 0.1, fit.distance * 20 + 1000);
  const elevation = radians(input.exploded ? 15 : Math.max(-89, Math.min(89, finiteOr(input.camera.elevationDeg, DEFAULT_CAMERA.elevationDeg))));
  const azimuth = radians(finiteOr(input.camera.azimuthDeg, DEFAULT_CAMERA.azimuthDeg));
  const target = new THREE.Vector3(0, 0, fit.targetZ);
  const direction = new THREE.Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation));
  camera.position.copy(target).addScaledVector(direction, fit.distance);
  camera.up.set(0, 0, 1);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  return camera;
}

function createLights(
  THREE: ThreeModule,
  root: any,
  scene: Scene | null,
  input: Mass3dRenderInput,
): void {
  const radius = sceneRadius(scene, input.camera);
  const hemisphere = new THREE.HemisphereLight("#FFFFFF", "#B8BEC7", 1.8);
  hemisphere.name = "s01-hemisphere-light";
  root.add(hemisphere);
  const sun = new THREE.DirectionalLight("#FFFFFF", 1.6);
  sun.name = "s01-southeast-sun";
  sun.position.set(radius * 1.2, -radius * 1.2, radius * 2.1);
  sun.castShadow = true;
  const shadowSize = radius >= 600 ? 2048 : radius >= 250 ? 1536 : 1024;
  sun.shadow.mapSize.width = shadowSize;
  sun.shadow.mapSize.height = shadowSize;
  sun.shadow.camera.left = -radius * 1.5;
  sun.shadow.camera.right = radius * 1.5;
  sun.shadow.camera.top = radius * 1.5;
  sun.shadow.camera.bottom = -radius * 1.5;
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = radius * 6 + 500;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.08;
  sun.target.position.set(0, 0, layerGap(scene, input.camera, input.exploded) * 2.5);
  root.add(sun);
  root.add(sun.target);
}

function addExplodedContent(
  THREE: ThreeModule,
  root: any,
  materials: Map<string, ThreeMaterial>,
  scene: Scene,
  input: Mass3dRenderInput,
  radius: number,
): void {
  const context = scene.context;
  for (const [index, layer] of EXPLODED_LAYERS.entries()) {
    const z = layerOffset(scene, input.camera, input.exploded, index);
    addPlate(THREE, root, materials, radius, z, layer);
    if (layer === "terrain") addTerrain(THREE, root, materials, scene, radius, z);
    if (layer === "water") addContextPolygons(THREE, root, materials, scene, context?.water ?? [], MASS_3D_COLORS.water, z, "s01-water");
    if (layer === "green") addContextPolygons(THREE, root, materials, scene, context?.green ?? [], MASS_3D_COLORS.green, z, "s01-green");
    if (layer === "roads") addRoads(THREE, root, materials, scene, z);
    if (layer === "buildings") addBuildingMeshes(THREE, root, materials, scene, input, z);
    if (layer === "complete") {
      addTerrain(THREE, root, materials, scene, radius, z);
      addContextPolygons(THREE, root, materials, scene, context?.water ?? [], MASS_3D_COLORS.water, z, "s01-complete-water");
      addContextPolygons(THREE, root, materials, scene, context?.green ?? [], MASS_3D_COLORS.green, z, "s01-complete-green");
      addRoads(THREE, root, materials, scene, z);
      addBuildingMeshes(THREE, root, materials, scene, input, z);
      addSiteMarker(THREE, root, scene, radius, z);
    }
  }
}

function buildMassScene(
  THREE: ThreeModule,
  input: Mass3dRenderInput,
  width: number,
  height: number,
): { scene: any; camera: any; dispose: () => void } {
  const scene3d = new THREE.Scene();
  const root = new THREE.Group();
  root.name = "s01-mass-root";
  scene3d.add(root);
  const materials = new Map<string, ThreeMaterial>();
  const scene = input.scene;
  const radius = sceneRadius(scene, input.camera);
  if (scene) {
    if (input.exploded) addExplodedContent(THREE, root, materials, scene, input, radius);
    else {
      addTerrain(THREE, root, materials, scene, radius, 0);
      addBuildingMeshes(THREE, root, materials, scene, input, 0);
      addSiteMarker(THREE, root, scene, radius, 0);
    }
  } else {
    addPlate(THREE, root, materials, radius, 0, "empty");
  }
  createLights(THREE, root, scene, input);
  const camera = makeCamera(THREE, scene, input, width, height);
  const dispose = () => {
    disposeMassObject(root);
    for (const material of materials.values()) material.dispose();
    scene3d.clear();
  };
  return { scene: scene3d, camera, dispose };
}

export function disposeMassObject(object: ThreeObject): void {
  object.traverse((child: ThreeObject) => {
    const mesh = child as unknown as { geometry?: ThreeGeometry; material?: ThreeMaterial | ThreeMaterial[] };
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) material.dispose();
  });
  object.clear();
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function drawChip(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, hatch = false): void {
  ctx.font = "600 12px 'Noto Sans KR', 'Malgun Gothic', sans-serif";
  const width = ctx.measureText(text).width + 30;
  roundedRect(ctx, x, y, width, 24, 12);
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.fill();
  ctx.strokeStyle = "rgba(21,23,28,0.12)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillRect(x + 9, y + 8, 9, 9);
  if (hatch) {
    ctx.strokeStyle = "#9B782E";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 9, y + 17);
    ctx.lineTo(x + 18, y + 8);
    ctx.stroke();
  }
  ctx.fillStyle = "#15171C";
  ctx.fillText(text, x + 23, y + 16);
}

function drawNorth(ctx: CanvasRenderingContext2D, width: number, height: number, camera: MassCamera): void {
  const x = width - 42;
  const y = 42;
  const angle = radians(finiteOr(camera.azimuthDeg, DEFAULT_CAMERA.azimuthDeg));
  const dx = -Math.sin(angle) * 22;
  const dy = -Math.cos(angle) * Math.sin(radians(finiteOr(camera.elevationDeg, DEFAULT_CAMERA.elevationDeg))) * 22;
  const length = Math.hypot(dx, dy) || 1;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(x, y, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#15171C";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + (dx / length) * 25, y + (dy / length) * 25);
  ctx.stroke();
  ctx.fillStyle = "#15171C";
  ctx.beginPath();
  ctx.moveTo(x + (dx / length) * 28, y + (dy / length) * 28);
  ctx.lineTo(x + (dx / length) * 18 - (dy / length) * 5, y + (dy / length) * 18 + (dx / length) * 5);
  ctx.lineTo(x + (dx / length) * 18 + (dy / length) * 5, y + (dy / length) * 18 - (dx / length) * 5);
  ctx.closePath();
  ctx.fill();
  ctx.font = "700 10px 'Noto Sans KR', 'Malgun Gothic', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("N", x, y + 32);
  ctx.textAlign = "left";
}

function drawMassChrome(canvas: HTMLCanvasElement, input: Mass3dRenderInput): void {
  const width = cleanCanvasSize(input.width, 960);
  const height = cleanCanvasSize(input.height, 540);
  const sx = canvas.width / width;
  const sy = canvas.height / height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.save();
  ctx.scale(sx, sy);
  drawNorth(ctx, width, height, input.camera);
  const isDem = input.scene?.ground.kind === "dem";
  if (!input.exploded) {
    const items: Array<readonly [string, string, boolean]> = [
      ["확정 높이", MASS_3D_COLORS.confirmed, false],
      ["추정 높이", MASS_3D_COLORS.estimated, true],
      ["높이 미상", MASS_3D_COLORS.unknown, false],
      ...(isDem ? [["지형", MASS_3D_COLORS.terrain, false] as const] : []),
    ] as const;
    let x = 16;
    for (const [label, color, hatch] of items) {
      drawChip(ctx, x, height - 34, label, color, hatch);
      x += ctx.measureText(label).width + 42;
    }
  } else {
    for (const [index, layer] of EXPLODED_LAYERS.entries()) {
      const y = height * 0.76 - index * Math.min(44, height * 0.08);
      ctx.strokeStyle = "rgba(137,147,160,0.7)";
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(112, y);
      ctx.lineTo(width * 0.29, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "700 11px 'Noto Sans KR', 'Malgun Gothic', sans-serif";
      ctx.fillStyle = "#15171C";
      ctx.fillText(layer === "terrain" ? "지형" : layer === "complete" ? "완성" : layer === "buildings" ? "건물" : layer === "water" ? "수계" : layer === "green" ? "녹지" : "도로", 16, y + 4);
      const present = layer === "terrain" || layer === "complete" || layer === "buildings"
        ? Boolean(input.scene)
        : layer === "water" ? (input.scene?.context?.water.length ?? 0) > 0
          : layer === "green" ? (input.scene?.context?.green.length ?? 0) > 0
            : (input.scene?.context?.roads.length ?? 0) > 0;
      if (!present) {
        ctx.font = "10px 'Noto Sans KR', 'Malgun Gothic', sans-serif";
        ctx.fillStyle = "#676C76";
        ctx.fillText("자료 없음", 16, y + 17);
      }
    }
  }
  if (input.scene?.ground.kind === "flat") {
    ctx.font = "10px 'Noto Sans KR', 'Malgun Gothic', sans-serif";
    ctx.fillStyle = "#5B606B";
    ctx.textAlign = "right";
    ctx.fillText("지형 미반영", width - 16, 74);
    ctx.textAlign = "left";
  }
  const missingContext = input.exploded && ((input.scene?.context?.water.length ?? 0) === 0 || (input.scene?.context?.green.length ?? 0) === 0 || (input.scene?.context?.roads.length ?? 0) === 0);
  if (missingContext) {
    ctx.font = "10px 'Noto Sans KR', 'Malgun Gothic', sans-serif";
    ctx.fillStyle = "#676C76";
    ctx.textAlign = "center";
    ctx.fillText("도로·녹지·수계: 자료가 없는 층은 빈 원판으로 표시", width / 2, height - 10);
    ctx.textAlign = "left";
  }
  ctx.restore();
}

function renderState(
  THREE: ThreeModule,
  renderer: any,
  input: Mass3dRenderInput,
  width: number,
  height: number,
): { dispose: () => void } {
  const state = buildMassScene(THREE, { ...input, width, height }, width, height);
  try {
    renderer.setSize(width, height, false);
    renderer.render(state.scene, state.camera);
    return state;
  } catch (error) {
    state.dispose();
    throw error;
  }
}

async function compositePngChrome(baseDataUrl: string, input: Mass3dRenderInput, width: number, height: number): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return baseDataUrl;
  const image = new Image();
  image.src = baseDataUrl;
  await image.decode();
  context.drawImage(image, 0, 0, width, height);
  drawMassChrome(canvas, { ...input, width, height });
  return canvas.toDataURL("image/png");
}

async function renderPngUncached(input: Mass3dRenderInput): Promise<string> {
  const THREE = await loadThree();
  offscreenRenderer ??= makeRenderer(THREE);
  const width = cleanCanvasSize(input.width, 960);
  const height = cleanCanvasSize(input.height, 540);
  const state = renderState(THREE, offscreenRenderer, input, width, height);
  try {
    const baseDataUrl = offscreenRenderer.domElement.toDataURL("image/png");
    return await compositePngChrome(baseDataUrl, input, width, height);
  } finally {
    state.dispose();
    offscreenRenderer.setRenderTarget(null);
  }
}

export async function renderMass3dPng(input: Mass3dRenderInput): Promise<string> {
  const key = mass3dCacheKey(input);
  const cached = PNG_CACHE.get(key);
  if (cached) return cached;
  const pending = PNG_PENDING.get(key);
  if (pending) return pending;
  const job = renderPngUncached(input)
    .then((dataUrl) => {
      PNG_CACHE.set(key, dataUrl);
      while (PNG_CACHE.size > IMAGE_CACHE_LIMIT) PNG_CACHE.delete(PNG_CACHE.keys().next().value!);
      return dataUrl;
    })
    .finally(() => PNG_PENDING.delete(key));
  PNG_PENDING.set(key, job);
  return job;
}

export function clearMass3dPngCache(): void {
  PNG_CACHE.clear();
  PNG_PENDING.clear();
}

export async function mountMass3d(container: HTMLElement, input: Mass3dRenderInput): Promise<Mass3dMount> {
  const THREE = await loadThree();
  if (!isMass3dWebGLAvailable()) throw new Error("WebGL을 사용할 수 없습니다.");
  const canvas = document.createElement("canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", input.label ?? "S01 3D 매스");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  container.replaceChildren(canvas);
  const renderer = makeRenderer(THREE, canvas);
  let currentState: { dispose: () => void } | null = null;
  let currentInput = input;
  let disposed = false;
  const render = () => {
    if (disposed) return;
    const width = cleanCanvasSize(container.clientWidth, input.width);
    const height = cleanCanvasSize(container.clientHeight, input.height);
    currentState?.dispose();
    currentState = renderState(THREE, renderer, { ...currentInput, width, height }, width, height);
  };
  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(render);
  resizeObserver?.observe(container);
  try {
    render();
  } catch (error) {
    resizeObserver?.disconnect();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    throw error;
  }
  return {
    update(nextInput) {
      currentInput = nextInput;
      canvas.setAttribute("aria-label", nextInput.label ?? "S01 3D 매스");
      render();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      resizeObserver?.disconnect();
      currentState?.dispose();
      currentState = null;
      canvas.remove();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

export function disposeMass3dRenderers(): void {
  offscreenRenderer?.dispose();
  offscreenRenderer?.forceContextLoss();
  offscreenRenderer = null;
}

export { CAMERA_PRESETS };
