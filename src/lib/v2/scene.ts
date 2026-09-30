import { z } from "zod";

export const SCENE_VERSION = "v2-scene@1";

/** 좌표는 대지 중심 원점의 로컬 미터: x=동(+), y=북(+), z=위(+). 지반은 평탄(z=0). */
export type Ring = [number, number][];

export interface SceneBuilding {
  id: string;
  rings: Ring[];
  heightM: number | null;
  heightMethod: "source" | "floors_estimate" | "user" | "unknown";
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

export interface Scene {
  version: typeof SCENE_VERSION;
  analysisId: string;
  manifestHash: string;
  origin: { epsg: "EPSG:5179"; x: number; y: number; lng: number; lat: number };
  radiusM: number;
  groundZ: 0;
  site: Ring[] | null;
  buildings: SceneBuilding[];
  parcels: SceneParcel[];
  counts: { buildingsTotal: number; buildingsIncluded: number; parcelsTotal: number; parcelsIncluded: number };
  sources: Array<{ sourceId: string; releaseId: string; sourceAsOf: string | null; fetchedAt: string }>;
  limitations: Array<{ kind: "unknown" | "estimated" | "partial" | "incomplete" | "not_provided"; note: string }>;
}

export const SCENE_MAX_BUILDINGS = 5000;
export const SCENE_MAX_PARCELS = 5000;

const PointSchema = z.tuple([z.number().finite(), z.number().finite()]);
const RingSchema: z.ZodType<Ring> = z.array(PointSchema);

const SceneBuildingSchema: z.ZodType<SceneBuilding> = z.object({
  id: z.string().min(1),
  rings: z.array(RingSchema),
  heightM: z.number().positive().nullable(),
  heightMethod: z.enum(["source", "floors_estimate", "user", "unknown"]),
  floorsAbove: z.number().int().nonnegative().nullable(),
  useCode: z.string().nullable(),
  approvalDate: z.string().nullable(),
});

const SceneParcelSchema: z.ZodType<SceneParcel> = z.object({
  pnu: z.string().min(1),
  rings: z.array(RingSchema),
  jimok: z.string().nullable(),
  areaM2: z.number().finite().nonnegative().nullable(),
  isSite: z.boolean(),
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
  groundZ: z.literal(0),
  site: z.array(RingSchema).nullable(),
  buildings: z.array(SceneBuildingSchema),
  parcels: z.array(SceneParcelSchema),
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
});

export function parseScene(v: unknown): Scene {
  return SceneSchema.parse(v);
}

const roundCentimeter = (value: number): number => {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/** EPSG:5179 좌표 고리 → 로컬 미터(cm 반올림) */
export function toLocalRing(ring: number[][], origin: { x: number; y: number }): Ring {
  return ring.map(([x, y]) => [roundCentimeter(x - origin.x), roundCentimeter(y - origin.y)]);
}
