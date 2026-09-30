/**
 * 모든 타일의 결과 계약 (spec §5.2).
 * 화면·PPT·PNG·DXF·GLB는 이 결과에서만 만든다. 내보내는 동안 새 데이터를 조회하지 않는다.
 */
import { z } from "zod";
import { canonicalJson, sha256Hex } from "./canonical-json";
import { VALUE_STATUSES } from "./data/schema";

export const TILE_TYPES = ["analysis", "diagram", "simulation", "stack"] as const;
export const TILE_STATUSES = ["complete", "partial", "failed", "cancelled", "no_data", "not_provided"] as const;
export const OUTPUT_FACES = ["front", "back", "both"] as const;
export const JUDGMENT_LEVELS = ["good", "fair", "caution"] as const;
export const LIMITATION_KINDS = ["unknown", "estimated", "suppressed", "partial", "incomplete", "not_provided"] as const;

const HAS_VALUE = new Set<string>(["observed", "estimated"]);

const MetricSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    value: z.number().finite().nullable(),
    unit: z.string(),
    formulaVersion: z.string().min(1),
    numerator: z.number().finite().nullable(),
    denominator: z.number().finite().nullable(),
    status: z.enum(VALUE_STATUSES),
  })
  .refine((m) => (m.value !== null) === HAS_VALUE.has(m.status), {
    message: "value must be present exactly when status is observed or estimated",
  });

const ConditionsSchema = z.object({
  address: z.string(),
  center: z.tuple([z.number().finite(), z.number().finite()]),
  radiusM: z.number().positive(),
  analysisDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((d) => {
      const t = new Date(`${d}T00:00:00Z`);
      return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
    }, "analysisDate must be a real calendar date"),
  timezone: z.literal("Asia/Seoul"),
  filters: z.record(z.string(), z.unknown()),
  simulation: z.record(z.string(), z.unknown()).nullable(),
  parcelSnapshotHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
});

export const MAX_MAP_FEATURES = 3000;
const MapFeatureSchema = z.object({
  layer: z.string().min(1),
  lng: z.number().finite(),
  lat: z.number().finite(),
  weight: z.number().finite().nullable().optional(),
  label: z.string().nullable().optional(),
  highlight: z.boolean().optional(),
  // 단지 설명선(A05·A06)용: 엔진이 아는 값만, 모르면 null(화면에는 "확인필요")
  name: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  households: z.number().finite().nullable().optional(),
  approvalYear: z.number().int().nullable().optional(),
  floorsMax: z.number().finite().nullable().optional(),
  buildingCount: z.number().finite().nullable().optional(),
  distanceM: z.number().finite().nullable().optional(),
  parking: z.number().finite().nullable().optional(),
  // A06: 입주(예정) 월("YYYY-MM", 일자는 만들지 않는다)과 다른 원천과 같은 사업일 수 있음
  plannedMonth: z.string().regex(/^\d{4}-\d{2}$/).nullable().optional(),
  overlap: z.boolean().optional(),
});

/** 면(폴리곤) 지물 상한: 개수, 고리 하나의 꼭짓점 수. 상한은 엔진이 지키고 스키마가 다시 막는다. */
export const MAX_MAP_POLYGONS = 3000;
export const MAX_POLYGON_VERTICES = 200;
const LngLatSchema = z.tuple([z.number().finite(), z.number().finite()]);
const MapPolygonSchema = z.object({
  layer: z.string().min(1),
  /** 첫 고리는 바깥, 나머지는 구멍. WGS84 [lng, lat]. 첫점=끝점으로 닫는다. */
  rings: z.array(z.array(LngLatSchema).min(4).max(MAX_POLYGON_VERTICES + 1)).min(1),
  label: z.string().nullable().optional(),
});

export const TileResultSchema = z
  .object({
    tileId: z.string().min(1),
    analysisId: z.string().min(1),
    tileType: z.enum(TILE_TYPES),
    tileCode: z.string().regex(/^[ADS]\d{2}$|^STACK$|^SUMMARY$/),
    status: z.enum(TILE_STATUSES),
    engineVersion: z.string().min(1),
    conditions: ConditionsSchema,
    metrics: z.array(MetricSchema),
    judgment: z
      .object({
        ruleId: z.string().min(1),
        basisMetricIds: z.array(z.string()),
        sentence: z.string().min(1),
        level: z.enum(JUDGMENT_LEVELS).nullable(),
        criteria: z.string().min(1).nullable(),
        /** 근거 지표가 둘 이상인 타일(A01 철도·버스)의 등급별 판정. level은 그중 가장 나쁜 등급 */
        grades: z
          .array(z.object({ metricId: z.string().min(1), level: z.enum(JUDGMENT_LEVELS), criteria: z.string().min(1) }))
          .optional(),
      })
      .nullable(),
    presentation: z.object({
      legend: z.array(z.object({ label: z.string(), min: z.number().nullable(), max: z.number().nullable() })),
      camera: z.record(z.string(), z.unknown()).nullable(),
      layers: z.array(z.string()),
      outputFace: z.enum(OUTPUT_FACES),
      /** 지도 표시용 지물(WGS84). 없으면 지도에 지물을 그리지 않는다. 상한 MAX_MAP_FEATURES. */
      features: z.array(MapFeatureSchema).optional(),
      /** 상한으로 잘리기 전 전체 개수 */
      featuresTotal: z.number().int().nonnegative().optional(),
      /** 면 지물(선택). 없거나 그릴 수 없으면 같은 정보의 대표점 features로 대신한다. 상한 MAX_MAP_POLYGONS. */
      polygons: z.array(MapPolygonSchema).max(MAX_MAP_POLYGONS).optional(),
      polygonsTotal: z.number().int().nonnegative().optional(),
    }),
    provenance: z.object({
      manifestHash: z.string().regex(/^[0-9a-f]{64}$/),
      sources: z.array(
        z.object({
          sourceId: z.string().min(1),
          releaseId: z.string().min(1),
          sourceAsOf: z.string().nullable(),
          fetchedAt: z.string().min(1),
        }),
      ),
    }),
    limitations: z.array(z.object({ kind: z.enum(LIMITATION_KINDS), note: z.string().min(1) })),
  })
  .superRefine((t, ctx) => {
    if (t.status === "complete" && t.provenance.sources.length === 0) {
      ctx.addIssue({ code: "custom", path: ["provenance", "sources"], message: "a complete tile needs at least one source" });
    }
    const seen = new Set<string>();
    t.metrics.forEach((m, i) => {
      if (seen.has(m.id)) ctx.addIssue({ code: "custom", path: ["metrics", i, "id"], message: `duplicate metric id ${m.id}` });
      seen.add(m.id);
    });
    if (t.judgment && t.judgment.level !== null) {
      if (t.judgment.basisMetricIds.length === 0) {
        ctx.addIssue({ code: "custom", path: ["judgment", "basisMetricIds"], message: "a graded judgment needs basis metrics" });
      }
      if (t.judgment.criteria === null) {
        ctx.addIssue({ code: "custom", path: ["judgment", "criteria"], message: "a graded judgment needs its criteria" });
      }
    }
    if (t.judgment?.grades?.length) {
      const graded = new Map(t.metrics.map((m) => [m.id, m]));
      t.judgment.grades.forEach((g, i) => {
        const metric = graded.get(g.metricId);
        if (!metric || !HAS_VALUE.has(metric.status)) {
          ctx.addIssue({ code: "custom", path: ["judgment", "grades", i, "metricId"], message: `cannot grade on ${g.metricId}: metric missing or not observed` });
        }
      });
      if (t.judgment.level === null) ctx.addIssue({ code: "custom", path: ["judgment", "level"], message: "grades need a judgment level" });
      if (t.tileCode !== "A01" && t.tileCode !== "A02") ctx.addIssue({ code: "custom", path: ["judgment", "grades"], message: "only A01/A02 may carry grades" });
    }
    if (t.judgment) {
      const byId = new Map(t.metrics.map((m) => [m.id, m]));
      for (const id of t.judgment.basisMetricIds) {
        const metric = byId.get(id);
        if (!metric) {
          ctx.addIssue({ code: "custom", path: ["judgment", "basisMetricIds"], message: `unknown metric ${id}` });
        } else if (t.judgment.level !== null && !HAS_VALUE.has(metric.status)) {
          ctx.addIssue({ code: "custom", path: ["judgment", "level"], message: `cannot grade on ${id} with status ${metric.status}` });
        }
      }
    }
  });

export type TileResult = z.infer<typeof TileResultSchema>;
export type TileConditions = TileResult["conditions"];
export type MapFeature = z.infer<typeof MapFeatureSchema>;
export type MapPolygon = z.infer<typeof MapPolygonSchema>;

export function parseTileResult(value: unknown): TileResult {
  return TileResultSchema.parse(value);
}

export function tileCacheKey(input: { tileCode: string; manifestHash: string; engineVersion: string; conditions: TileConditions }): string {
  return sha256Hex(canonicalJson(input));
}
