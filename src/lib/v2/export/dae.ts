import type { Scene } from "../scene";
import { sceneToGlb } from "./glb";
import { exportFileName } from "./download";

/** DAE의 레이어는 3DM/DXF와 같은 이름을 써서 SketchUp에서 바로 구분한다. */
export const DAE_LAYERS = ["BLDG", "BLDG_EST", "BLDG_NOHEIGHT", "PARCEL", "SITE", "RADIUS", "TERRAIN"] as const;

type DaeLayer = (typeof DAE_LAYERS)[number];

const GLB_GEOMETRY_LAYERS: readonly DaeLayer[] = ["BLDG", "BLDG_EST", "BLDG_NOHEIGHT", "RADIUS", "TERRAIN"];

type GlbAccessor = {
  bufferView: number;
  byteOffset?: number;
  count: number;
  componentType: number;
  type: string;
};

type GlbBufferView = {
  byteOffset?: number;
  byteLength: number;
};

type GlbPrimitive = {
  attributes: { POSITION: number };
  indices: number;
};

type GlbDocument = {
  accessors: GlbAccessor[];
  bufferViews: GlbBufferView[];
  meshes: Array<{ primitives: GlbPrimitive[] }>;
};

type Geometry = {
  positions: number[];
  indices: number[];
};

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function numberText(value: number): string {
  if (!Number.isFinite(value)) throw new TypeError(`DAE coordinate must be finite, got ${value}`);
  return String(Object.is(value, -0) ? 0 : value);
}

function numberList(values: readonly number[]): string {
  return values.map(numberText).join(" ");
}

function readGlbDocument(bytes: Uint8Array): { document: GlbDocument; bin: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || new TextDecoder().decode(bytes.subarray(0, 4)) !== "glTF") {
    throw new TypeError("sceneToGlb returned an invalid GLB header");
  }
  if (view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) {
    throw new TypeError("sceneToGlb returned an unsupported GLB version or length");
  }

  const jsonLength = view.getUint32(12, true);
  const jsonStart = 20;
  if (view.getUint32(16, true) !== 0x4e4f534a || jsonStart + jsonLength + 8 > bytes.byteLength) {
    throw new TypeError("sceneToGlb is missing its JSON chunk");
  }
  const document = JSON.parse(new TextDecoder().decode(bytes.subarray(jsonStart, jsonStart + jsonLength)).trim()) as GlbDocument;
  const binHeader = jsonStart + jsonLength;
  const binLength = view.getUint32(binHeader, true);
  if (view.getUint32(binHeader + 4, true) !== 0x004e4942 || binHeader + 8 + binLength > bytes.byteLength) {
    throw new TypeError("sceneToGlb is missing its BIN chunk");
  }
  return { document, bin: bytes.subarray(binHeader + 8, binHeader + 8 + binLength) };
}

function readPositions(document: GlbDocument, bin: Uint8Array, accessorIndex: number): number[] {
  const accessor = document.accessors[accessorIndex];
  const bufferView = document.bufferViews[accessor.bufferView];
  if (!accessor || !bufferView || accessor.componentType !== 5126 || accessor.type !== "VEC3") {
    throw new TypeError("DAE conversion requires float32 VEC3 GLB positions");
  }
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const end = start + accessor.count * 3 * 4;
  if (start < 0 || end > bin.byteLength) throw new TypeError("GLB position accessor exceeds its BIN chunk");
  const values: number[] = [];
  for (let i = 0; i < accessor.count * 3; i += 1) values.push(view.getFloat32(start + i * 4, true));
  return values;
}

function readIndices(document: GlbDocument, bin: Uint8Array, accessorIndex: number): number[] {
  const accessor = document.accessors[accessorIndex];
  const bufferView = document.bufferViews[accessor.bufferView];
  if (!accessor || !bufferView || accessor.type !== "SCALAR") throw new TypeError("DAE conversion requires scalar GLB indices");
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const bytesPerIndex = accessor.componentType === 5125 ? 4 : accessor.componentType === 5123 ? 2 : accessor.componentType === 5121 ? 1 : 0;
  if (bytesPerIndex === 0) throw new TypeError("DAE conversion requires an unsigned GLB index accessor");
  const end = start + accessor.count * bytesPerIndex;
  if (start < 0 || end > bin.byteLength) throw new TypeError("GLB index accessor exceeds its BIN chunk");
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const values: number[] = [];
  for (let i = 0; i < accessor.count; i += 1) {
    const offset = start + i * bytesPerIndex;
    values.push(bytesPerIndex === 4 ? view.getUint32(offset, true) : bytesPerIndex === 2 ? view.getUint16(offset, true) : view.getUint8(offset));
  }
  if (values.length % 3 !== 0) throw new TypeError("GLB index accessor is not a triangle list");
  return values;
}

function glbGeometries(scene: Scene): Geometry[] {
  const { document, bin } = readGlbDocument(sceneToGlb(scene));
  const primitives = document.meshes[0]?.primitives;
  if (!primitives || primitives.length > GLB_GEOMETRY_LAYERS.length) throw new TypeError("sceneToGlb geometry layout changed; update DAE layers");
  return primitives.map((primitive) => ({
    positions: readPositions(document, bin, primitive.attributes.POSITION),
    indices: readIndices(document, bin, primitive.indices),
  }));
}

const LAYER_COLORS: Record<DaeLayer, readonly [number, number, number, number]> = {
  BLDG: [0.36, 0.44, 0.56, 1],
  BLDG_EST: [0.92, 0.48, 0.12, 1],
  BLDG_NOHEIGHT: [0.70, 0.72, 0.75, 1],
  PARCEL: [0.44, 0.61, 0.41, 1],
  SITE: [0.23, 0.45, 0.31, 1],
  RADIUS: [0.55, 0.55, 0.55, 1],
  TERRAIN: [0.68, 0.56, 0.34, 1],
};

function effectXml(layer: DaeLayer): string {
  return [
    `      <effect id="effect-${layer}" name="${layer}">`,
    "        <profile_COMMON>",
    `          <technique sid="common">`,
    "            <phong>",
    `              <diffuse><color>${numberList(LAYER_COLORS[layer])}</color></diffuse>`,
    "              <ambient><color>0.1 0.1 0.1 1</color></ambient>",
    "            </phong>",
    "          </technique>",
    "        </profile_COMMON>",
    "      </effect>",
  ].join("\n");
}

function materialXml(layer: DaeLayer): string {
  return `      <material id="material-${layer}" name="${layer}"><instance_effect url="#effect-${layer}"/></material>`;
}

function geometryXml(layer: DaeLayer, geometry: Geometry): string {
  if (geometry.indices.length === 0) return "";
  const vertexCount = geometry.positions.length / 3;
  if (!Number.isInteger(vertexCount) || vertexCount === 0) throw new TypeError(`DAE ${layer} positions are not VEC3 data`);
  return [
    `    <geometry id="geometry-${layer}" name="${layer}">`,
    "      <mesh>",
    `        <source id="source-${layer}-positions">`,
    `          <float_array id="array-${layer}-positions" count="${geometry.positions.length}">${numberList(geometry.positions)}</float_array>`,
    "          <technique_common>",
    `            <accessor source="#array-${layer}-positions" count="${vertexCount}" stride="3">`,
    `              <param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>`,
    "            </accessor>",
    "          </technique_common>",
    "        </source>",
    `        <vertices id="vertices-${layer}"><input semantic="POSITION" source="#source-${layer}-positions"/></vertices>`,
    `        <triangles material="material-${layer}" count="${geometry.indices.length / 3}">`,
    `          <input semantic="VERTEX" source="#vertices-${layer}" offset="0"/>`,
    `          <p>${geometry.indices.join(" ")}</p>`,
    "        </triangles>",
    "      </mesh>",
    "    </geometry>",
  ].join("\n");
}

function instanceXml(layer: DaeLayer): string {
  return [
    `      <instance_geometry url="#geometry-${layer}">`,
    "        <bind_material>",
    "          <technique_common>",
    `            <instance_material symbol="material-${layer}" target="#material-${layer}"/>`,
    "          </technique_common>",
    "        </bind_material>",
    "      </instance_geometry>",
  ].join("\n");
}

function metadataXml(scene: Scene): string {
  const ground = scene.ground.kind === "dem" ? "dem" : "flat";
  const originZ = scene.ground.kind === "dem" ? scene.ground.originZ : 0;
  return [
    "    <extra>",
    `      <technique profile="SITE_ANALYSIS">`,
    `        <param name="origin_epsg">EPSG:5179</param>`,
    `        <param name="origin_x">${numberText(scene.origin.x)}</param>`,
    `        <param name="origin_y">${numberText(scene.origin.y)}</param>`,
    `        <param name="origin_lng">${numberText(scene.origin.lng)}</param>`,
    `        <param name="origin_lat">${numberText(scene.origin.lat)}</param>`,
    `        <param name="origin_z">${numberText(originZ)}</param>`,
    `        <param name="units">m</param>`,
    `        <param name="up">+Y</param>`,
    `        <param name="north">-Z</param>`,
    `        <param name="ground">${ground}</param>`,
    `        <param name="manifestHash">${xmlEscape(scene.manifestHash)}</param>`,
    `        <param name="analysisId">${xmlEscape(scene.analysisId)}</param>`,
    `        <param name="sceneVersion">${xmlEscape(scene.version)}</param>`,
    "      </technique>",
    "    </extra>",
  ].join("\n");
}

/** Scene의 GLB 실척 형상을 SketchUp 가져오기용 Collada 1.4.1 XML로 변환한다. */
export function sceneToDae(scene: Scene): string {
  const geometries = glbGeometries(scene);
  const geometryByLayer = new Map<DaeLayer, Geometry>();
  for (const [index, geometry] of geometries.entries()) {
    const layer = GLB_GEOMETRY_LAYERS[index];
    if (layer) geometryByLayer.set(layer, geometry);
  }
  const geometryXmlText = GLB_GEOMETRY_LAYERS
    .map((layer) => geometryByLayer.get(layer) ? geometryXml(layer, geometryByLayer.get(layer) as Geometry) : "")
    .filter(Boolean)
    .join("\n");
  const effects = DAE_LAYERS.map(effectXml).join("\n");
  const materials = DAE_LAYERS.map(materialXml).join("\n");
  const layers = DAE_LAYERS.map((layer) => [
    `      <node id="layer-${layer}" name="${layer}" type="NODE">`,
    ...(geometryByLayer.has(layer) && (geometryByLayer.get(layer)?.indices.length ?? 0) > 0 ? [instanceXml(layer)] : []),
    "      </node>",
  ].join("\n")).join("\n");

  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<COLLADA xmlns=\"http://www.collada.org/2005/11/COLLADASchema\" version=\"1.4.1\">",
    "  <asset>",
    "    <contributor><authoring_tool>site-analysis v2</authoring_tool></contributor>",
    "    <unit name=\"meter\" meter=\"1\"/>",
    "    <up_axis>Y_UP</up_axis>",
    "  </asset>",
    metadataXml(scene),
    "  <library_effects>",
    effects,
    "  </library_effects>",
    "  <library_materials>",
    materials,
    "  </library_materials>",
    "  <library_geometries>",
    geometryXmlText,
    "  </library_geometries>",
    "  <library_visual_scenes>",
    "    <visual_scene id=\"Scene\" name=\"site-analysis v2\">",
    layers,
    "    </visual_scene>",
    "  </library_visual_scenes>",
    "  <scene><instance_visual_scene url=\"#Scene\"/></scene>",
    "</COLLADA>",
    "",
  ].join("\n");
}

export function daeFileName(address: string, analysisDate: string): string {
  return exportFileName("dae", address, analysisDate);
}
