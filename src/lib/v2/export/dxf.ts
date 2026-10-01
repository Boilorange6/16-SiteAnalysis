import type { Scene, Ring, SceneGround } from "../scene";

export const DXF_LAYERS = {
  BLDG: "BLDG",
  BLDG_EST: "BLDG_EST",
  BLDG_NOHEIGHT: "BLDG_NOHEIGHT",
  PARCEL: "PARCEL",
  SITE: "SITE",
  RADIUS: "RADIUS",
  META: "META",
  TERRAIN: "TERRAIN",
} as const;

export interface DxfOptions {
  origin?: "site" | "utmk";
}

type Pair = readonly [string | number, string | number];

const CRLF = "\r\n";

function numberText(value: number): string {
  if (!Number.isFinite(value)) throw new TypeError(`DXF coordinate must be finite, got ${value}`);
  const normalized = Math.abs(value) < 0.005 ? 0 : value;
  return normalized.toFixed(2);
}

function pushPairs(lines: string[], pairs: readonly Pair[]): void {
  for (const [code, value] of pairs) {
    lines.push(String(code).padStart(3, " "));
    lines.push(typeof value === "number" ? String(value).padStart(6, " ") : String(value));
  }
}

class HandleAllocator {
  private nextValue = 1;

  allocate(): string {
    const handle = this.nextValue.toString(16).toUpperCase();
    this.nextValue += 1;
    return handle;
  }

  handseed(): string {
    return this.nextValue.toString(16).toUpperCase();
  }
}

function addLwPolyline(
  lines: string[],
  ring: Ring,
  layer: string,
  thickness: number | undefined,
  elevation: number | undefined,
  handles: HandleAllocator,
  owner: string,
): void {
  if (ring.length === 0) return;
  pushPairs(lines, [
    [0, "LWPOLYLINE"],
    [5, handles.allocate()],
    [330, owner],
    [100, "AcDbEntity"],
    [8, layer],
    [100, "AcDbPolyline"],
    [90, ring.length],
    [70, 1],
  ]);
  if (elevation !== undefined) pushPairs(lines, [[38, numberText(elevation)]]);
  if (thickness !== undefined) pushPairs(lines, [[39, numberText(thickness)]]);
  for (const [x, y] of ring) pushPairs(lines, [[10, numberText(x)], [20, numberText(y)]]);
}

function groundOrigin(ground: Extract<SceneGround, { kind: "dem" }>): [number, number] {
  return [-((ground.cols - 1) * ground.cellM) / 2, -((ground.rows - 1) * ground.cellM) / 2];
}

type FacePoint = readonly [number, number, number];

function add3dFace(lines: string[], points: readonly [FacePoint, FacePoint, FacePoint, FacePoint], handles: HandleAllocator, owner: string): void {
  pushPairs(lines, [
    [0, "3DFACE"], [5, handles.allocate()], [330, owner], [100, "AcDbEntity"], [8, DXF_LAYERS.TERRAIN], [100, "AcDbFace"],
  ]);
  points.forEach(([x, y, z], index) => pushPairs(lines, [
    [10 + index, numberText(x)], [20 + index, numberText(y)], [30 + index, numberText(z)],
  ]));
}

function addTerrainFaces(
  lines: string[],
  ground: SceneGround,
  offset: readonly [number, number],
  handles: HandleAllocator,
  owner: string,
): void {
  if (ground.kind !== "dem") return;
  const [x0, y0] = groundOrigin(ground);
  const zAt = (col: number, row: number): number | null => ground.z[row * ground.cols + col] ?? null;
  const point = (col: number, row: number, z: number): FacePoint => [
    x0 + col * ground.cellM + offset[0],
    y0 + row * ground.cellM + offset[1],
    z,
  ];
  for (let row = 0; row < ground.rows - 1; row += 1) {
    for (let col = 0; col < ground.cols - 1; col += 1) {
      const a = zAt(col, row);
      const b = zAt(col + 1, row);
      const c = zAt(col + 1, row + 1);
      const d = zAt(col, row + 1);
      if (a === null || b === null || c === null || d === null) continue;
      add3dFace(lines, [point(col, row, a), point(col + 1, row, b), point(col + 1, row + 1, c), point(col + 1, row + 1, c)], handles, owner);
      add3dFace(lines, [point(col, row, a), point(col + 1, row + 1, c), point(col, row + 1, d), point(col, row + 1, d)], handles, owner);
    }
  }
}

function addCircle(lines: string[], origin: readonly [number, number], radiusM: number, layer: string, handles: HandleAllocator, owner: string): void {
  pushPairs(lines, [
    [0, "CIRCLE"], [5, handles.allocate()], [330, owner], [100, "AcDbEntity"], [8, layer], [100, "AcDbCircle"],
    [10, numberText(origin[0])], [20, numberText(origin[1])], [30, numberText(0)], [40, numberText(radiusM)],
  ]);
}

function addPoint(lines: string[], origin: readonly [number, number], layer: string, handles: HandleAllocator, owner: string): void {
  pushPairs(lines, [
    [0, "POINT"], [5, handles.allocate()], [330, owner], [100, "AcDbEntity"], [8, layer], [100, "AcDbPoint"],
    [10, numberText(origin[0])], [20, numberText(origin[1])], [30, numberText(0)],
  ]);
}

function addText(lines: string[], origin: readonly [number, number], value: string, layer: string, handles: HandleAllocator, owner: string): void {
  pushPairs(lines, [
    [0, "TEXT"], [5, handles.allocate()], [330, owner], [100, "AcDbEntity"], [8, layer], [100, "AcDbText"],
    [10, numberText(origin[0])], [20, numberText(origin[1])], [30, numberText(0)], [40, numberText(0.5)], [1, value], [7, "Standard"],
  ]);
}

function localOrUtmkPoint(point: readonly [number, number], offset: readonly [number, number]): [number, number] {
  return [point[0] + offset[0], point[1] + offset[1]];
}

function localOrUtmkRing(ring: Ring, offset: readonly [number, number]): Ring {
  return ring.map((point) => localOrUtmkPoint(point, offset));
}

function buildingLayer(heightM: number | null, heightMethod: Scene["buildings"][number]["heightMethod"]): string {
  if (heightM === null || !Number.isFinite(heightM) || heightM <= 0) return DXF_LAYERS.BLDG_NOHEIGHT;
  return heightMethod === "floors_estimate" ? DXF_LAYERS.BLDG_EST : DXF_LAYERS.BLDG;
}

function addEmptyTable(lines: string[], name: string, handles: HandleAllocator): void {
  pushPairs(lines, [
    [0, "TABLE"], [2, name], [5, handles.allocate()], [330, 0], [100, "AcDbSymbolTable"], [70, 0], [0, "ENDTAB"],
  ]);
}

function addLtypeTable(lines: string[], handles: HandleAllocator): void {
  const table = handles.allocate();
  pushPairs(lines, [[0, "TABLE"], [2, "LTYPE"], [5, table], [330, 0], [100, "AcDbSymbolTable"], [70, 3]]);
  for (const [name, description] of [["BYBLOCK", ""], ["BYLAYER", ""], ["CONTINUOUS", "Solid line"]]) {
    pushPairs(lines, [
      [0, "LTYPE"], [5, handles.allocate()], [330, table], [100, "AcDbSymbolTableRecord"], [100, "AcDbLinetypeTableRecord"],
      [2, name], [70, 0], [3, description], [72, 65], [73, 0], [40, 0],
    ]);
  }
  pushPairs(lines, [[0, "ENDTAB"]]);
}

function addLayerTable(lines: string[], handles: HandleAllocator): void {
  const layers = Object.values(DXF_LAYERS);
  const table = handles.allocate();
  pushPairs(lines, [[0, "TABLE"], [2, "LAYER"], [5, table], [330, 0], [100, "AcDbSymbolTable"], [70, layers.length]]);
  layers.forEach((layer, index) => {
    pushPairs(lines, [
      [0, "LAYER"], [5, handles.allocate()], [330, table], [100, "AcDbSymbolTableRecord"], [100, "AcDbLayerTableRecord"],
      [2, layer], [70, 0], [62, index + 1], [6, "CONTINUOUS"],
    ]);
  });
  pushPairs(lines, [[0, "ENDTAB"]]);
}

function addStyleTable(lines: string[], handles: HandleAllocator): string {
  const table = handles.allocate();
  const style = handles.allocate();
  pushPairs(lines, [
    [0, "TABLE"], [2, "STYLE"], [5, table], [330, 0], [100, "AcDbSymbolTable"], [70, 1],
    [0, "STYLE"], [5, style], [330, table], [100, "AcDbSymbolTableRecord"], [100, "AcDbTextStyleTableRecord"],
    [2, "Standard"], [70, 0], [40, 0], [41, 1], [50, 0], [71, 0], [42, 1], [3, "txt.shx"], [4, ""],
    [0, "ENDTAB"],
  ]);
  return style;
}

function addAppIdTable(lines: string[], handles: HandleAllocator): void {
  const table = handles.allocate();
  pushPairs(lines, [[0, "TABLE"], [2, "APPID"], [5, table], [330, 0], [100, "AcDbSymbolTable"], [70, 1]]);
  pushPairs(lines, [
    [0, "APPID"], [5, handles.allocate()], [330, table], [100, "AcDbSymbolTableRecord"], [100, "AcDbRegAppTableRecord"], [2, "ACAD"], [70, 0],
    [0, "ENDTAB"],
  ]);
}

function addDimStyleTable(lines: string[], handles: HandleAllocator, textStyle: string): void {
  const table = handles.allocate();
  pushPairs(lines, [
    [0, "TABLE"], [2, "DIMSTYLE"], [5, table], [330, 0], [100, "AcDbSymbolTable"], [70, 1], [100, "AcDbDimStyleTable"], [71, 1],
    [0, "DIMSTYLE"], [105, handles.allocate()], [330, table], [100, "AcDbSymbolTableRecord"], [100, "AcDbDimStyleTableRecord"], [2, "Standard"],
    [70, 0], [40, 1], [41, 0.18], [42, 0.0625], [43, 0.38], [44, 0.18], [45, 0], [46, 0], [47, 0], [48, 0],
    [140, 0.18], [141, 0.09], [142, 0], [143, 25.4], [144, 1], [145, 0], [146, 1], [147, 0.09], [148, 0],
    [71, 0], [72, 0], [73, 0], [74, 1], [75, 0], [76, 0], [77, 0], [78, 0], [79, 0],
    [170, 0], [171, 2], [172, 0], [173, 0], [174, 0], [175, 0], [176, 0], [177, 0], [178, 0],
    [271, 4], [272, 4], [273, 2], [274, 2], [275, 0], [276, 0], [277, 2], [278, 46], [279, 0], [280, 0], [281, 0], [282, 0], [283, 1], [284, 0], [285, 0], [286, 0], [288, 0], [289, 3],
    [340, textStyle], [371, -2], [372, -2], [0, "ENDTAB"],
  ]);
}

function addBlockRecordTable(lines: string[], handles: HandleAllocator): { model: string; paper: string } {
  const table = handles.allocate();
  const model = handles.allocate();
  const paper = handles.allocate();
  pushPairs(lines, [[0, "TABLE"], [2, "BLOCK_RECORD"], [5, table], [330, 0], [100, "AcDbSymbolTable"], [70, 2]]);
  for (const [name, record] of [["*Model_Space", model], ["*Paper_Space", paper]]) {
    pushPairs(lines, [
      [0, "BLOCK_RECORD"], [5, record], [330, table], [100, "AcDbSymbolTableRecord"], [100, "AcDbBlockTableRecord"], [2, name], [70, 0], [280, 1], [281, 0],
    ]);
  }
  pushPairs(lines, [[0, "ENDTAB"]]);
  return { model, paper };
}

function addEmptyBlock(lines: string[], name: string, record: string, handles: HandleAllocator): void {
  pushPairs(lines, [
    [0, "BLOCK"], [5, handles.allocate()], [330, record], [100, "AcDbEntity"], [8, "0"], [100, "AcDbBlockBegin"],
    [2, name], [70, 0], [10, 0], [20, 0], [30, 0], [3, name], [1, ""],
    [0, "ENDBLK"], [5, handles.allocate()], [330, record], [100, "AcDbEntity"], [8, "0"], [100, "AcDbBlockEnd"],
  ]);
}

function addObjects(lines: string[], handles: HandleAllocator): void {
  const root = handles.allocate();
  const groups = handles.allocate();
  pushPairs(lines, [
    [0, "DICTIONARY"], [5, root], [330, 0], [100, "AcDbDictionary"], [281, 1], [3, "ACAD_GROUP"], [350, groups],
    [0, "DICTIONARY"], [5, groups], [330, root], [100, "AcDbDictionary"], [281, 1],
  ]);
}

function metaText(scene: Scene): string {
  const ground = scene.ground.kind === "dem"
    ? `ground dem 30m ${scene.ground.vertical} originZ=${numberText(scene.ground.originZ)}`
    : "ground flat";
  return `origin EPSG:5179 E=${numberText(scene.origin.x)} N=${numberText(scene.origin.y)}; unit m; north=+Y; manifest ${scene.manifestHash.slice(0, 12)}; scene ${scene.version}; ${ground}`;
}

/** Scene의 로컬 미터 좌표를 AutoCAD R2000 DXF로 변환한다. */
export function sceneToDxf(scene: Scene, opts: DxfOptions = {}): string {
  const originMode = opts.origin ?? "site";
  if (originMode !== "site" && originMode !== "utmk") throw new RangeError(`unsupported DXF origin: ${originMode}`);
  const offset: readonly [number, number] = originMode === "utmk" ? [scene.origin.x, scene.origin.y] : [0, 0];
  const originPoint = localOrUtmkPoint([0, 0], offset);
  const handles = new HandleAllocator();
  const tableLines: string[] = [];
  const blockLines: string[] = [];
  const entityLines: string[] = [];
  const objectLines: string[] = [];
  const styleHandle = addStyleTable(tableLines, handles);
  addEmptyTable(tableLines, "VPORT", handles);
  addLtypeTable(tableLines, handles);
  addLayerTable(tableLines, handles);
  addEmptyTable(tableLines, "VIEW", handles);
  addEmptyTable(tableLines, "UCS", handles);
  addAppIdTable(tableLines, handles);
  addDimStyleTable(tableLines, handles, styleHandle);
  const blockRecords = addBlockRecordTable(tableLines, handles);
  addEmptyBlock(blockLines, "*Model_Space", blockRecords.model, handles);
  addEmptyBlock(blockLines, "*Paper_Space", blockRecords.paper, handles);
  addObjects(objectLines, handles);

  for (const building of scene.buildings) {
    const layer = buildingLayer(building.heightM, building.heightMethod);
    const thickness = building.heightM !== null && Number.isFinite(building.heightM) && building.heightM > 0 ? building.heightM : undefined;
    const elevation = scene.ground.kind === "dem" && building.baseZ !== null && Number.isFinite(building.baseZ) ? building.baseZ : undefined;
    for (const ring of building.rings) addLwPolyline(entityLines, localOrUtmkRing(ring, offset), layer, thickness, elevation, handles, blockRecords.model);
  }

  addTerrainFaces(entityLines, scene.ground, offset, handles, blockRecords.model);

  let hasSiteParcel = false;
  for (const parcel of scene.parcels) {
    const layer = parcel.isSite ? DXF_LAYERS.SITE : DXF_LAYERS.PARCEL;
    hasSiteParcel ||= parcel.isSite;
    for (const ring of parcel.rings) addLwPolyline(entityLines, localOrUtmkRing(ring, offset), layer, undefined, undefined, handles, blockRecords.model);
  }
  if (!hasSiteParcel && scene.site !== null) {
    for (const ring of scene.site) addLwPolyline(entityLines, localOrUtmkRing(ring, offset), DXF_LAYERS.SITE, undefined, undefined, handles, blockRecords.model);
  }

  addCircle(entityLines, originPoint, scene.radiusM, DXF_LAYERS.RADIUS, handles, blockRecords.model);
  addPoint(entityLines, originPoint, DXF_LAYERS.SITE, handles, blockRecords.model);
  addText(entityLines, originPoint, metaText(scene), DXF_LAYERS.META, handles, blockRecords.model);

  const lines: string[] = [];
  pushPairs(lines, [
    [0, "SECTION"], [2, "HEADER"], [9, "$ACADVER"], [1, "AC1015"], [9, "$HANDSEED"], [5, handles.handseed()], [9, "$INSUNITS"], [70, 6],
    [0, "ENDSEC"],
    [0, "SECTION"], [2, "CLASSES"], [0, "ENDSEC"],
    [0, "SECTION"], [2, "TABLES"],
  ]);
  lines.push(...tableLines);
  pushPairs(lines, [[0, "ENDSEC"], [0, "SECTION"], [2, "BLOCKS"]]);
  lines.push(...blockLines);
  pushPairs(lines, [[0, "ENDSEC"], [0, "SECTION"], [2, "ENTITIES"]]);
  lines.push(...entityLines);
  pushPairs(lines, [[0, "ENDSEC"], [0, "SECTION"], [2, "OBJECTS"]]);
  lines.push(...objectLines);
  pushPairs(lines, [[0, "ENDSEC"], [0, "EOF"]]);

  return `${lines.join(CRLF)}${CRLF}`;
}

function filenamePart(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
}

function compactDate(value: string): string {
  const match = value.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})/);
  if (!match) throw new TypeError(`analysisDate must start with YYYYMMDD or YYYY-MM-DD, got ${value}`);
  return `${match[1]}${match[2]}${match[3]}`;
}

export function dxfFileName(address: string, analysisDate: string): string {
  const safeAddress = filenamePart(address) || "미상";
  return `사이트분석_${safeAddress}_${compactDate(analysisDate)}.dxf`;
}
