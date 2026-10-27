import { z } from "zod";
import type { DemVertical } from "./data/terrain";

export const SCENE_VERSION = "v2-scene@2";
const LEGACY_SCENE_VERSION = "v2-scene@1";

/** 좌표는 대지 중심 원점의 로컬 미터: x=동(+), y=북(+), z=위(+). */
export type Ring = [number, number][];

export type SceneGround =
  | { kind: "flat" }
  | {
      kind: "dem";
      cellM: number;
      cols: number;
      rows: number;
      originZ: number;
      z: (number | null)[];
      resolutionM: 5 | 30;
      vertical: DemVertical;
      sourceId: string;
    };

export interface SceneBuilding {
  id: string;
  /** 건물 도형 원천에서 보존한 이름. 없는 원천은 null이다. */
  name: string | null;
  /** 화면 표시에 쓰는 층수·높이 보조 문구. 1층 가정은 의도적으로 null이다. */
  sublabel: string | null;
  /** 자동 라벨 우선순위: 이름 있는 주요 건물만 1, 이름 없는 건물은 0이다. */
  labelPriority: number;
  rings: Ring[];
  /** 발자국 대표점 지표고(원점 상대). flat이면 null. */
  baseZ: number | null;
  heightM: number | null;
  heightMethod: "source" | "ledger_height" | "floors_estimate" | "user" | "unknown" | "assumed_one_floor";
  floorsAbove: number | null;
  useCode: string | null;
  approvalDate: string | null;
}

export interface SceneParcel {
  pnu: string;
  rings: Ring[];
  jimok: string | null;
  areaM2: number | null;
  isSite: boolean;
}

export interface SceneRoad {
  points: [number, number][];
  widthM: number;
  hierarchy: string;
  /** 도로 이름(예: "도곡로77길"). 이름 없는 도로는 null, 옛 장면은 없음. */
  name?: string | null;
}

/** OSM 녹지 분류(`ingest/sources/osm-landuse.ts`의 GREEN_CLASSES와 같은 값). */
export const GREEN_KINDS = ["forest", "park", "grass", "orchard"] as const;
export type GreenKind = (typeof GREEN_KINDS)[number];

export interface SceneRail {
  points: [number, number][];
  color: string;
  lineRef: string;
  name: string;
}

export interface SceneStation {
  name: string;
  x: number;
  y: number;
  color: string;
}

export interface ScenePlace {
  name: string;
  kind: "dong" | "park";
  x: number;
  y: number;
}

/** 장면 중심에서 반경 안에 잘라 둔 도로·녹지·수계 맥락층. */
export interface SceneContext {
  roads: SceneRoad[];
  green: Ring[][];
  water: Ring[][];
  /** `green`과 같은 길이·순서의 녹지 분류. 옛 장면은 없음. */
  greenKinds?: GreenKind[];
  /** 원 안으로 자른 지하철·철도 노선. 원천이 없으면 없음. */
  rail?: SceneRail[];
  stations?: SceneStation[];
  /** 법정동(면의 무게중심)·공원(점) 지명. */
  places?: ScenePlace[];
  /** 수관은 무거운 분석 타일이 채울 자리이며 장면 생성 때는 생략한다. */
  canopy?: Ring[][];
}

export interface Scene {
  version: typeof SCENE_VERSION;
  analysisId: string;
  manifestHash: string;
  origin: { epsg: "EPSG:5179"; x: number; y: number; lng: number; lat: number };
  radiusM: number;
  ground: SceneGround;
  site: Ring[] | null;
  buildings: SceneBuilding[];
  parcels: SceneParcel[];
  context?: SceneContext;
  counts: { buildingsTotal: number; buildingsIncluded: number; parcelsTotal: number; parcelsIncluded: number };
  sources: Array<{ sourceId: string; releaseId: string; sourceAsOf: string | null; fetchedAt: string }>;
  limitations: Array<{ kind: "unknown" | "estimated" | "partial" | "incomplete" | "not_provided"; note: string }>;
}

export const SCENE_MAX_BUILDINGS = 5000;
export const SCENE_MAX_PARCELS = 5000;
export const SCENE_GRID_MAX = 65;

const PointSchema = z.tuple([z.number().finite(), z.number().finite()]);
const RingSchema: z.ZodType<Ring> = z.array(PointSchema);

const SceneGroundSchema: z.ZodType<SceneGround> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("flat") }),
  z.object({
    kind: z.literal("dem"),
    cellM: z.number().finite().positive(),
    cols: z.number().int().positive().max(SCENE_GRID_MAX),
    rows: z.number().int().positive().max(SCENE_GRID_MAX),
    originZ: z.number().finite(),
    z: z.array(z.number().finite().nullable()),
    resolutionM: z.union([z.literal(5), z.literal(30)]),
    vertical: z.enum(["EGM96", "EGM2008"]),
    sourceId: z.string().min(1),
  }).superRefine((ground, ctx) => {
    if (ground.z.length !== ground.cols * ground.rows) {
      ctx.addIssue({ code: "custom", path: ["z"], message: "ground z length must equal rows × cols" });
    }
  }),
]);

const SceneBuildingSchema: z.ZodType<SceneBuilding> = z.object({
  id: z.string().min(1),
  name: z.string().nullable().default(null),
  sublabel: z.string().nullable().default(null),
  labelPriority: z.number().int().min(0).max(2).default(0),
  rings: z.array(RingSchema),
  baseZ: z.number().finite().nullable(),
  heightM: z.number().positive().nullable(),
  heightMethod: z.enum(["source", "ledger_height", "floors_estimate", "user", "unknown", "assumed_one_floor"]),
  floorsAbove: z.number().int().nonnegative().nullable(),
  useCode: z.string().nullable(),
  approvalDate: z.string().nullable(),
});

/** 건물명 뒤에 붙일 표시용 높이 문구를 만든다. 1층 가정은 별도 한계 문구로만 알린다. */
export function sceneBuildingSublabel(
  building: Pick<SceneBuilding, "floorsAbove" | "heightM" | "heightMethod">,
): string | null {
  if (building.heightMethod !== "assumed_one_floor" && building.floorsAbove !== null && Number.isFinite(building.floorsAbove) && building.floorsAbove > 0) {
    return `${Math.round(building.floorsAbove)}층`;
  }
  if (building.heightMethod !== "assumed_one_floor" && building.heightM !== null && Number.isFinite(building.heightM) && building.heightM > 0) {
    const value = Math.round(building.heightM * 10) / 10;
    return `${Number.isInteger(value) ? value : value.toFixed(1)}m`;
  }
  return null;
}

const SceneParcelSchema: z.ZodType<SceneParcel> = z.object({
  pnu: z.string().min(1),
  rings: z.array(RingSchema),
  jimok: z.string().nullable(),
  areaM2: z.number().finite().nonnegative().nullable(),
  isSite: z.boolean(),
});

const SceneRoadSchema: z.ZodType<SceneRoad> = z.object({
  points: z.array(PointSchema).min(2),
  widthM: z.number().finite().positive(),
  hierarchy: z.string().min(1),
  name: z.string().nullable().optional(),
});

const SceneContextSchema: z.ZodType<SceneContext> = z.object({
  roads: z.array(SceneRoadSchema),
  green: z.array(z.array(RingSchema)),
  water: z.array(z.array(RingSchema)),
  greenKinds: z.array(z.enum(GREEN_KINDS)).optional(),
  rail: z.array(z.object({
    points: z.array(PointSchema).min(2),
    color: z.string(),
    lineRef: z.string(),
    name: z.string(),
  })).optional(),
  stations: z.array(z.object({ name: z.string(), x: z.number().finite(), y: z.number().finite(), color: z.string() })).optional(),
  places: z.array(z.object({ name: z.string(), kind: z.enum(["dong", "park"]), x: z.number().finite(), y: z.number().finite() })).optional(),
  canopy: z.array(z.array(RingSchema)).optional(),
});

export const SceneSchema: z.ZodType<Scene> = z.object({
  version: z.literal(SCENE_VERSION),
  analysisId: z.string().min(1),
  manifestHash: z.string().min(1),
  origin: z.object({
    epsg: z.literal("EPSG:5179"),
    x: z.number().finite(),
    y: z.number().finite(),
    lng: z.number().finite(),
    lat: z.number().finite(),
  }),
  radiusM: z.number().positive(),
  ground: SceneGroundSchema,
  site: z.array(RingSchema).nullable(),
  buildings: z.array(SceneBuildingSchema),
  parcels: z.array(SceneParcelSchema),
  context: SceneContextSchema.optional(),
  counts: z.object({
    buildingsTotal: z.number().int().nonnegative(),
    buildingsIncluded: z.number().int().nonnegative(),
    parcelsTotal: z.number().int().nonnegative(),
    parcelsIncluded: z.number().int().nonnegative(),
  }),
  sources: z.array(
    z.object({
      sourceId: z.string().min(1),
      releaseId: z.string().min(1),
      sourceAsOf: z.string().nullable(),
      fetchedAt: z.string().min(1),
    }),
  ),
  limitations: z.array(
    z.object({
      kind: z.enum(["unknown", "estimated", "partial", "incomplete", "not_provided"]),
      note: z.string().min(1),
    }),
  ),
}).superRefine((scene, ctx) => {
  if (scene.ground.kind !== "flat") return;
  scene.buildings.forEach((building, index) => {
    if (building.baseZ !== null) {
      ctx.addIssue({ code: "custom", path: ["buildings", index, "baseZ"], message: "flat ground requires baseZ to be null" });
    }
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseScene(v: unknown): Scene {
  if (isRecord(v) && v.version === LEGACY_SCENE_VERSION && v.groundZ === 0) {
    const migrated: Record<string, unknown> = {
      ...v,
      version: SCENE_VERSION,
      ground: { kind: "flat" },
      buildings: Array.isArray(v.buildings)
        ? v.buildings.map((building) => isRecord(building) ? { ...building, baseZ: null } : building)
        : v.buildings,
    };
    delete migrated.groundZ;
    return SceneSchema.parse(migrated);
  }
  return SceneSchema.parse(v);
}

/** SceneGround의 암시적 로컬 격자 원점. row 0은 남쪽이고 격자는 장면 원점에 대칭이다. */
function groundOrigin(ground: Extract<SceneGround, { kind: "dem" }>): { x0: number; y0: number } {
  return {
    x0: -((ground.cols - 1) * ground.cellM) / 2,
    y0: -((ground.rows - 1) * ground.cellM) / 2,
  };
}

/** 지반 격자의 상대 높이를 쌍선형 보간한다. 결측 셀이 하나라도 포함되면 null이다. */
export function groundZAt(ground: SceneGround, x: number, y: number): number | null {
  if (ground.kind === "flat") return 0;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const { x0, y0 } = groundOrigin(ground);
  const gx = (x - x0) / ground.cellM;
  const gy = (y - y0) / ground.cellM;
  if (gx < 0 || gy < 0 || gx > ground.cols - 1 || gy > ground.rows - 1) return null;

  const xLow = Math.floor(gx);
  const yLow = Math.floor(gy);
  const xHigh = Math.min(xLow + 1, ground.cols - 1);
  const yHigh = Math.min(yLow + 1, ground.rows - 1);
  const tx = gx - xLow;
  const ty = gy - yLow;
  const sample = (col: number, row: number): number | null => ground.z[row * ground.cols + col] ?? null;
  const z00 = sample(xLow, yLow);
  const z10 = sample(xHigh, yLow);
  const z01 = sample(xLow, yHigh);
  const z11 = sample(xHigh, yHigh);
  if (z00 === null || z10 === null || z01 === null || z11 === null) return null;
  const low = z00 + (z10 - z00) * tx;
  const high = z01 + (z11 - z01) * tx;
  return low + (high - low) * ty;
}

const roundCentimeter = (value: number): number => {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/** EPSG:5179 좌표 고리 → 로컬 미터(cm 반올림) */
export function toLocalRing(ring: number[][], origin: { x: number; y: number }): Ring {
  return ring.map(([x, y]) => [roundCentimeter(x - origin.x), roundCentimeter(y - origin.y)]);
}
