import type { Scene, Ring } from "../scene";

export const DXF_LAYERS = {
  BLDG: "BLDG",
  BLDG_EST: "BLDG_EST",
  BLDG_NOHEIGHT: "BLDG_NOHEIGHT",
  PARCEL: "PARCEL",
  SITE: "SITE",
  RADIUS: "RADIUS",
  META: "META",
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

function addLwPolyline(lines: string[], ring: Ring, layer: string, thickness?: number): void {
  if (ring.length === 0) return;
  pushPairs(lines, [
    [0, "LWPOLYLINE"],
    [8, layer],
    [90, ring.length],
    [70, 1],
  ]);
  if (thickness !== undefined) pushPairs(lines, [[39, numberText(thickness)]]);
  for (const [x, y] of ring) pushPairs(lines, [[10, numberText(x)], [20, numberText(y)]]);
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

function addLayerTable(lines: string[]): void {
  const layers = Object.values(DXF_LAYERS);
  pushPairs(lines, [
    [0, "TABLE"],
    [2, "LAYER"],
    [70, layers.length],
  ]);
  layers.forEach((layer, index) => {
    pushPairs(lines, [
      [0, "LAYER"],
      [2, layer],
      [70, 0],
      [62, index + 1],
      [6, "CONTINUOUS"],
    ]);
  });
  pushPairs(lines, [[0, "ENDTAB"]]);
}

function metaText(scene: Scene): string {
  return `origin EPSG:5179 E=${numberText(scene.origin.x)} N=${numberText(scene.origin.y)}; unit m; north=+Y; manifest ${scene.manifestHash.slice(0, 12)}; scene ${scene.version}`;
}

/** Scene의 로컬 미터 좌표를 AutoCAD R2000 DXF로 변환한다. */
export function sceneToDxf(scene: Scene, opts: DxfOptions = {}): string {
  const originMode = opts.origin ?? "site";
  if (originMode !== "site" && originMode !== "utmk") throw new RangeError(`unsupported DXF origin: ${originMode}`);
  const offset: readonly [number, number] = originMode === "utmk" ? [scene.origin.x, scene.origin.y] : [0, 0];
  const originPoint = localOrUtmkPoint([0, 0], offset);
  const lines: string[] = [];

  pushPairs(lines, [
    [0, "SECTION"],
    [2, "HEADER"],
    [9, "$ACADVER"],
    [1, "AC1015"],
    [9, "$INSUNITS"],
    [70, 6],
    [0, "ENDSEC"],
    [0, "SECTION"],
    [2, "TABLES"],
  ]);
  addLayerTable(lines);
  pushPairs(lines, [
    [0, "ENDSEC"],
    [0, "SECTION"],
    [2, "ENTITIES"],
  ]);

  for (const building of scene.buildings) {
    const layer = buildingLayer(building.heightM, building.heightMethod);
    const thickness = building.heightM !== null && Number.isFinite(building.heightM) && building.heightM > 0 ? building.heightM : undefined;
    for (const ring of building.rings) addLwPolyline(lines, localOrUtmkRing(ring, offset), layer, thickness);
  }

  let hasSiteParcel = false;
  for (const parcel of scene.parcels) {
    const layer = parcel.isSite ? DXF_LAYERS.SITE : DXF_LAYERS.PARCEL;
    hasSiteParcel ||= parcel.isSite;
    for (const ring of parcel.rings) addLwPolyline(lines, localOrUtmkRing(ring, offset), layer);
  }
  if (!hasSiteParcel && scene.site !== null) {
    for (const ring of scene.site) addLwPolyline(lines, localOrUtmkRing(ring, offset), DXF_LAYERS.SITE);
  }

  pushPairs(lines, [
    [0, "CIRCLE"],
    [8, DXF_LAYERS.RADIUS],
    [10, numberText(originPoint[0])],
    [20, numberText(originPoint[1])],
    [30, numberText(0)],
    [40, numberText(scene.radiusM)],
    [0, "POINT"],
    [8, DXF_LAYERS.SITE],
    [10, numberText(originPoint[0])],
    [20, numberText(originPoint[1])],
    [30, numberText(0)],
    [0, "TEXT"],
    [8, DXF_LAYERS.META],
    [10, numberText(originPoint[0])],
    [20, numberText(originPoint[1])],
    [30, numberText(0)],
    [40, numberText(0.5)],
    [1, metaText(scene)],
    [0, "ENDSEC"],
    [0, "EOF"],
  ]);

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
