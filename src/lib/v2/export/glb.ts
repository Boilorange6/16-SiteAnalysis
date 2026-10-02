import { SCENE_MAX_BUILDINGS, type Scene, type SceneBuilding, type SceneGround } from "../scene";
import { cleanRings } from "./rings";
import { exportFileName } from "./download";

// earcut 2.2.4 is an existing JavaScript-only transitive dependency.
// @ts-expect-error earcut does not ship TypeScript declarations.
import earcutImport from "earcut";

type Point2 = [number, number];
type Geometry = { positions: number[]; indices: number[] };
type Earcut = (vertices: number[], holes?: number[], dimensions?: number) => number[];

const earcut = earcutImport as unknown as Earcut;

const MATERIAL_NAMES = ["mass_source", "mass_estimated", "mass_unknown", "ground", "terrain"] as const;

const MATERIALS = [
  {
    name: "mass_source",
    pbrMetallicRoughness: { baseColorFactor: [0.48, 0.54, 0.62, 1], metallicFactor: 0, roughnessFactor: 1 },
    alphaMode: "OPAQUE",
  },
  {
    name: "mass_estimated",
    pbrMetallicRoughness: { baseColorFactor: [0.92, 0.48, 0.12, 1], metallicFactor: 0, roughnessFactor: 1 },
    alphaMode: "OPAQUE",
  },
  {
    name: "mass_unknown",
    pbrMetallicRoughness: { baseColorFactor: [0.78, 0.8, 0.83, 1], metallicFactor: 0, roughnessFactor: 1 },
    alphaMode: "OPAQUE",
  },
  {
    name: "ground",
    pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
    alphaMode: "OPAQUE",
  },
  {
    name: "terrain",
    pbrMetallicRoughness: { baseColorFactor: [0.68, 0.56, 0.34, 1], metallicFactor: 0, roughnessFactor: 1 },
    alphaMode: "OPAQUE",
  },
] as const;

function geometry(): Geometry {
  return { positions: [], indices: [] };
}

function validRings(building: SceneBuilding): Point2[][] {
  return cleanRings(building.rings);
}

/** Scene x/y is east/north; glTF is x/y/z = east/up/-north. */
function pushPosition(target: Geometry, x: number, north: number, up: number): number {
  const index = target.positions.length / 3;
  target.positions.push(x, up, -north);
  return index;
}

function addSurface(target: Geometry, rings: Point2[][], up: number): void {
  if (rings.length === 0) return;

  const flat: number[] = [];
  const holeIndices: number[] = [];
  for (const [ringIndex, ring] of rings.entries()) {
    if (ringIndex > 0) holeIndices.push(flat.length / 2);
    for (const [x, y] of ring) flat.push(x, y);
  }

  const vertexOffset = target.positions.length / 3;
  for (let i = 0; i < flat.length; i += 2) pushPosition(target, flat[i], flat[i + 1], up);
  for (const index of earcut(flat, holeIndices, 2)) target.indices.push(vertexOffset + index);
}

function addWalls(target: Geometry, rings: Point2[][], baseZ: number, height: number): void {
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const offset = target.positions.length / 3;
      pushPosition(target, a[0], a[1], baseZ);
      pushPosition(target, b[0], b[1], baseZ);
      pushPosition(target, b[0], b[1], baseZ + height);
      pushPosition(target, a[0], a[1], baseZ + height);
      target.indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
    }
  }
}

function materialIndexFor(building: SceneBuilding): 0 | 1 | 2 {
  if (building.heightM === null || building.heightMethod === "unknown") return 2;
  if (!Number.isFinite(building.heightM) || building.heightM <= 0) return 2;
  return building.heightMethod === "floors_estimate" ? 1 : 0;
}

function addBuilding(target: Geometry, building: SceneBuilding): void {
  const rings = validRings(building);
  if (rings.length === 0) return;

  const materialIndex = materialIndexFor(building);
  const baseZ = building.baseZ ?? 0;
  if (materialIndex === 2) {
    // A missing or explicitly unknown height is a footprint only, never a 0m extrusion.
    addSurface(target, rings, baseZ);
    return;
  }

  const height = building.heightM as number;
  addSurface(target, rings, baseZ + height);
  addWalls(target, rings, baseZ, height);
}

function distanceSquared(building: SceneBuilding): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const ring of validRings(building)) {
    for (const [x, y] of ring) nearest = Math.min(nearest, x * x + y * y);
  }
  return nearest;
}

function addGround(target: Geometry, radiusM: number): void {
  const sides = 64;
  const center = pushPosition(target, 0, 0, 0);
  for (let i = 0; i < sides; i += 1) {
    const angle = (Math.PI * 2 * i) / sides;
    pushPosition(target, radiusM * Math.cos(angle), radiusM * Math.sin(angle), 0);
  }
  for (let i = 0; i < sides; i += 1) {
    const next = (i + 1) % sides;
    target.indices.push(center, center + 1 + i, center + 1 + next);
  }
}

function groundOrigin(ground: Extract<SceneGround, { kind: "dem" }>): [number, number] {
  return [-((ground.cols - 1) * ground.cellM) / 2, -((ground.rows - 1) * ground.cellM) / 2];
}

function addTerrain(target: Geometry, ground: SceneGround): void {
  if (ground.kind !== "dem") return;
  const [x0, y0] = groundOrigin(ground);
  const vertexByGridPoint = new Map<string, number>();
  const zAt = (col: number, row: number): number | null => ground.z[row * ground.cols + col] ?? null;
  const vertex = (col: number, row: number, z: number): number => {
    const key = `${col}:${row}`;
    const existing = vertexByGridPoint.get(key);
    if (existing !== undefined) return existing;
    const index = pushPosition(target, x0 + col * ground.cellM, y0 + row * ground.cellM, z);
    vertexByGridPoint.set(key, index);
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
      target.indices.push(ia, ib, ic, ia, ic, id);
    }
  }
}

/** Keep every material primitive valid even when a scene has no buildings in that category. */
function ensureRenderable(target: Geometry): void {
  if (target.indices.length > 0) return;
  target.positions = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  target.indices = [0, 1, 2];
}

function padTo4(value: number): number {
  return (value + 3) & ~3;
}

class BinaryWriter {
  private readonly chunks: Uint8Array[] = [];

  private size = 0;

  append(data: ArrayBufferView): { byteOffset: number; byteLength: number } {
    const aligned = padTo4(this.size);
    if (aligned !== this.size) {
      this.chunks.push(new Uint8Array(aligned - this.size));
      this.size = aligned;
    }
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.chunks.push(bytes);
    const byteOffset = this.size;
    this.size += bytes.byteLength;
    return { byteOffset, byteLength: bytes.byteLength };
  }

  finish(): Uint8Array {
    const output = new Uint8Array(this.size);
    let offset = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }
}

function minMax(positions: ArrayLike<number>): { min: number[]; max: number[] } {
  if (positions.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[i + axis]);
      max[axis] = Math.max(max[axis], positions[i + axis]);
    }
  }
  return { min, max };
}

function makeGlb(json: Record<string, unknown>, bin: Uint8Array): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPaddedLength = padTo4(jsonBytes.byteLength);
  const binPaddedLength = padTo4(bin.byteLength);
  const totalLength = 12 + 8 + jsonPaddedLength + 8 + binPaddedLength;
  const output = new Uint8Array(totalLength);
  const view = new DataView(output.buffer);

  view.setUint32(0, 0x46546c67, true); // glTF
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonPaddedLength, true);
  view.setUint32(16, 0x4e4f534a, true); // JSON
  output.set(jsonBytes, 20);
  output.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonPaddedLength);

  const binHeader = 20 + jsonPaddedLength;
  view.setUint32(binHeader, binPaddedLength, true);
  view.setUint32(binHeader + 4, 0x004e4942, true); // BIN\0
  output.set(bin, binHeader + 8);
  return output;
}

export function sceneToGlb(scene: Scene): Uint8Array {
  const materialGeometries = [geometry(), geometry(), geometry(), geometry()];
  if (scene.ground.kind === "dem") materialGeometries.push(geometry());
  const buildings = scene.buildings
    .map((building, index) => ({ building, index, distance: distanceSquared(building) }))
    .sort((a, b) => {
      if (a.distance < b.distance) return -1;
      if (a.distance > b.distance) return 1;
      return a.index - b.index;
    })
    .slice(0, SCENE_MAX_BUILDINGS);

  for (const { building } of buildings) addBuilding(materialGeometries[materialIndexFor(building)], building);
  if (scene.ground.kind === "dem") addTerrain(materialGeometries[4], scene.ground);
  else addGround(materialGeometries[3], scene.radiusM);
  materialGeometries.forEach((target, index) => {
    if (index !== 4) ensureRenderable(target);
  });

  const writer = new BinaryWriter();
  const bufferViews: Array<Record<string, unknown>> = [];
  const accessors: Array<Record<string, unknown>> = [];
  const primitives: Array<Record<string, unknown>> = [];

  for (const [material, target] of materialGeometries.entries()) {
    const positionData = new Float32Array(target.positions);
    const positionRange = writer.append(positionData);
    const indexRange = writer.append(new Uint32Array(target.indices));
    const positionBufferView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: positionRange.byteOffset, byteLength: positionRange.byteLength, target: 34962 });
    const indexBufferView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: indexRange.byteOffset, byteLength: indexRange.byteLength, target: 34963 });
    const positionAccessor = accessors.length;
    const bounds = minMax(positionData);
    accessors.push({
      bufferView: positionBufferView,
      componentType: 5126,
      count: positionData.length / 3,
      type: "VEC3",
      min: bounds.min,
      max: bounds.max,
    });
    const indexAccessor = accessors.length;
    accessors.push({ bufferView: indexBufferView, componentType: 5125, count: target.indices.length, type: "SCALAR" });
    primitives.push({ attributes: { POSITION: positionAccessor }, indices: indexAccessor, material, mode: 4 });
  }

  const bin = writer.finish();

  const gltf = {
    asset: {
      version: "2.0",
      generator: "site-analysis v2",
      extras: {
        origin: scene.origin,
        units: "m",
        up: "+Y",
        north: "-Z",
        manifestHash: scene.manifestHash,
        analysisId: scene.analysisId,
        sceneVersion: scene.version,
        ground: scene.ground.kind === "dem"
          ? {
              kind: "dem",
              cellM: scene.ground.cellM,
              originZ: scene.ground.originZ,
              resolutionM: scene.ground.resolutionM,
              vertical: scene.ground.vertical,
            }
          : { kind: "flat" },
        buildings: buildings.map(({ building }) => ({
          id: building.id,
          heightMethod: building.heightMethod,
          floorsAbove: building.floorsAbove,
          baseZ: building.baseZ,
        })),
      },
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "site-analysis" }],
    meshes: [{ name: "site-analysis", primitives }],
    materials: MATERIAL_NAMES.slice(0, materialGeometries.length).map((name, index) => ({ ...MATERIALS[index], name })),
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.byteLength }],
  } satisfies Record<string, unknown>;

  return makeGlb(gltf, bin);
}

export function glbFileName(address: string, analysisDate: string): string {
  return exportFileName("glb", address, analysisDate);
}
