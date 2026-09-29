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
  analysisDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.literal("Asia/Seoul"),
  filters: z.record(z.string(), z.unknown()),
  simulation: z.record(z.string(), z.unknown()).nullable(),
  parcelSnapshotHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
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
      })
      .nullable(),
    presentation: z.object({
      legend: z.array(z.object({ label: z.string(), min: z.number().nullable(), max: z.number().nullable() })),
      camera: z.record(z.string(), z.unknown()).nullable(),
      layers: z.array(z.string()),
      outputFace: z.enum(OUTPUT_FACES),
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

export function parseTileResult(value: unknown): TileResult {
  return TileResultSchema.parse(value);
}

export function tileCacheKey(input: { tileCode: string; manifestHash: string; engineVersion: string; conditions: TileConditions }): string {
  return sha256Hex(canonicalJson(input));
}
