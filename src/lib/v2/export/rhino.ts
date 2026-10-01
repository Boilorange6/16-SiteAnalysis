import type { Ring, Scene, SceneBuilding, SceneGround } from "../scene";

export const RHINO_LAYERS = ["BLDG", "BLDG_EST", "BLDG_NOHEIGHT", "PARCEL", "SITE", "RADIUS", "TERRAIN"] as const;
type RhinoLayerName = (typeof RHINO_LAYERS)[number];
type RhinoColor = { r: number; g: number; b: number };

const LAYER_COLORS: Record<RhinoLayerName, RhinoColor> = {
  BLDG: { r: 92, g: 112, b: 144 },
  BLDG_EST: { r: 235, g: 123, b: 31 },
  BLDG_NOHEIGHT: { r: 180, g: 184, b: 190 },
  PARCEL: { r: 112, g: 155, b: 104 },
  SITE: { r: 58, g: 115, b: 78 },
  RADIUS: { r: 104, g: 104, b: 104 },
  TERRAIN: { r: 173, g: 143, b: 87 },
};

async function loadRhino() {
  const module = await import("rhino3dm");
  return module.default();
}

type RhinoModule = Awaited<ReturnType<typeof loadRhino>>;
let rhinoPromise: ReturnType<typeof loadRhino> | null = null;

function samePoint(a: readonly [number, number], b: readonly [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function cleanRing(ring: Ring): [number, number][] {
  const points: [number, number][] = [];
  for (const [x, y] of ring) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const point: [number, number] = [x, y];
    if (points.length === 0 || !samePoint(points[points.length - 1], point)) points.push(point);
  }
  if (points.length > 1 && samePoint(points[0], points[points.length - 1])) points.pop();
  return points.length >= 3 ? points : [];
}

function ringPoints(ring: Ring, z: number): number[][] {
  const points = cleanRing(ring).map(([x, y]) => [x, y, z]);
  if (points.length < 3) return [];
  points.push([...points[0]]);
  return points;
}

function curveForRing(rhino: RhinoModule, ring: Ring, z: number) {
  const points = ringPoints(ring, z);
  if (points.length === 0) return null;
  const polyline = rhino.Polyline.createFromPoints(points);
  if (!polyline || !polyline.isValid || !polyline.isClosed) return null;
  return polyline.toPolylineCurve();
}

function layerIndex(layers: Map<RhinoLayerName, number>, name: RhinoLayerName): number {
  const index = layers.get(name);
  if (index === undefined) throw new Error(`missing Rhino layer: ${name}`);
  return index;
}

function attributes(
  rhino: RhinoModule,
  layers: Map<RhinoLayerName, number>,
  layer: RhinoLayerName,
  name?: string,
  heightMethod?: SceneBuilding["heightMethod"],
) {
  const result = new rhino.ObjectAttributes();
  result.layerIndex = layerIndex(layers, layer);
  if (name !== undefined) result.name = name;
  if (heightMethod !== undefined) result.setUserString("heightMethod", heightMethod);
  return result;
}

function addPlanarRings(
  doc: InstanceType<RhinoModule["File3dm"]>,
  rhino: RhinoModule,
  layers: Map<RhinoLayerName, number>,
  layer: RhinoLayerName,
  rings: Ring[],
  z: number,
  name?: string,
): void {
  const objectAttributes = attributes(rhino, layers, layer, name);
  for (const ring of rings) {
    const curve = curveForRing(rhino, ring, z);
    if (curve) doc.objects().addCurve(curve, objectAttributes);
  }
}

function buildingLayer(building: SceneBuilding): RhinoLayerName {
  if (building.heightM === null || building.heightMethod === "unknown") return "BLDG_NOHEIGHT";
  return building.heightMethod === "floors_estimate" ? "BLDG_EST" : "BLDG";
}

function addBuilding(
  doc: InstanceType<RhinoModule["File3dm"]>,
  rhino: RhinoModule,
  layers: Map<RhinoLayerName, number>,
  building: SceneBuilding,
): void {
  const layer = buildingLayer(building);
  const objectAttributes = attributes(rhino, layers, layer, building.id, building.heightMethod);
  const baseZ = building.baseZ ?? 0;
  const heightM = building.heightM;
  const hasHeight = heightM !== null && heightM > 0 && building.heightMethod !== "unknown";
  if (!hasHeight) {
    for (const ring of building.rings) {
      const curve = curveForRing(rhino, ring, baseZ);
      if (curve) doc.objects().addCurve(curve, objectAttributes);
    }
    return;
  }

  const outer = curveForRing(rhino, building.rings[0], baseZ);
  if (!outer) throw new Error(`building ${building.id} has no valid outer ring`);
  const extrusion = rhino.Extrusion.create(outer, heightM, true);
  if (!extrusion) throw new Error(`building ${building.id} could not be extruded`);
  for (const ring of building.rings.slice(1)) {
    // rhino3dm expects inner profiles as 2D XY curves even when the outer profile is elevated.
    const inner = curveForRing(rhino, ring, 0);
    if (!inner || !extrusion.addInnerProfile(inner)) throw new Error(`building ${building.id} has an invalid inner ring`);
  }
  doc.objects().addExtrusion(extrusion, objectAttributes);
}

function groundOrigin(ground: Extract<SceneGround, { kind: "dem" }>): [number, number] {
  return [-((ground.cols - 1) * ground.cellM) / 2, -((ground.rows - 1) * ground.cellM) / 2];
}

function terrainMesh(rhino: RhinoModule, ground: SceneGround) {
  if (ground.kind !== "dem") return null;
  const mesh = new rhino.Mesh();
  const [x0, y0] = groundOrigin(ground);
  const vertices = new Map<string, number>();
  const zAt = (col: number, row: number): number | null => ground.z[row * ground.cols + col] ?? null;
  const vertex = (col: number, row: number, z: number): number => {
    const key = `${col}:${row}`;
    const existing = vertices.get(key);
    if (existing !== undefined) return existing;
    const index = mesh.vertices().addPoint3d(x0 + col * ground.cellM, y0 + row * ground.cellM, z);
    vertices.set(key, index);
    return index;
  };
  for (let row = 0; row < ground.rows - 1; row += 1) {
    for (let col = 0; col < ground.cols - 1; col += 1) {
      const a = zAt(col, row);
      const b = zAt(col + 1, row);
      const c = zAt(col + 1, row + 1);
      const d = zAt(col, row + 1);
      if (a === null || b === null || c === null || d === null) continue;
      const ia = vertex(col, row, a);
      const ib = vertex(col + 1, row, b);
      const ic = vertex(col + 1, row + 1, c);
      const id = vertex(col, row + 1, d);
      mesh.faces().addTriFace(ia, ib, ic);
      mesh.faces().addTriFace(ia, ic, id);
    }
  }
  if (mesh.faces().count === 0) return null;
  mesh.normals().computeNormals();
  return mesh;
}

function addDocumentStrings(doc: InstanceType<RhinoModule["File3dm"]>, scene: Scene): void {
  const strings = doc.strings();
  strings.set("origin_epsg5179_x", String(scene.origin.x));
  strings.set("origin_epsg5179_y", String(scene.origin.y));
  strings.set("origin_lng", String(scene.origin.lng));
  strings.set("origin_lat", String(scene.origin.lat));
  strings.set("originZ", String(scene.ground.kind === "dem" ? scene.ground.originZ : 0));
  strings.set("units", "m");
  strings.set("north", "+Y");
  strings.set("manifestHash", scene.manifestHash);
  strings.set("sceneVersion", scene.version);
}

/** Scene을 Rhino 3DM으로 변환한다. rhino3dm WASM은 호출 시 한 번만 지연 로드한다. */
export async function sceneTo3dm(scene: Scene): Promise<Uint8Array> {
  rhinoPromise ??= loadRhino();
  const rhino = await rhinoPromise;
  const doc = new rhino.File3dm();
  doc.settings().modelUnitSystem = rhino.UnitSystem.Meters;

  const layers = new Map<RhinoLayerName, number>();
  for (const name of RHINO_LAYERS) {
    const index = doc.layers().addLayer(name, LAYER_COLORS[name]);
    if (index < 0) throw new Error(`could not create Rhino layer: ${name}`);
    layers.set(name, index);
  }

  for (const building of scene.buildings.slice(0, 5000)) addBuilding(doc, rhino, layers, building);

  let hasSiteParcel = false;
  for (const parcel of scene.parcels.slice(0, 5000)) {
    if (parcel.isSite) hasSiteParcel = true;
    addPlanarRings(doc, rhino, layers, parcel.isSite ? "SITE" : "PARCEL", parcel.rings, 0, parcel.pnu);
  }
  if (!hasSiteParcel && scene.site !== null) addPlanarRings(doc, rhino, layers, "SITE", scene.site, 0, "site");

  doc.objects().addCircle(
    new rhino.Circle([0, 0, 0], scene.radiusM),
    attributes(rhino, layers, "RADIUS", "analysis-radius"),
  );

  const mesh = terrainMesh(rhino, scene.ground);
  if (mesh) doc.objects().addMesh(mesh, attributes(rhino, layers, "TERRAIN", "terrain"));

  addDocumentStrings(doc, scene);
  return doc.toByteArray();
}
