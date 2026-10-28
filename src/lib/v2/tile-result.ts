/**
 * 모든 타일의 결과 계약 (spec §5.2).
 * 화면·PPT·PNG·DXF·GLB는 이 결과에서만 만든다. 내보내는 동안 새 데이터를 조회하지 않는다.
 */
import { z } from "zod";
import { canonicalJson, sha256Hex } from "./canonical-json";
import { VALUE_STATUSES } from "./data/schema";

export const TILE_TYPES = ["analysis", "diagram", "simulation", "stack"] as const;
export const TILE_STATUSES = ["complete", "partial", "failed", "cancelled", "no_data", "not_provided", "pending", "running"] as const;
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
  /** 상세 창의 목록 줄과 지도 대표점을 연결하는 안정적인 지물 키. */
  fid: z.string().min(1).optional(),
  layer: z.string().min(1),
  lng: z.number().finite(),
  lat: z.number().finite(),
  weight: z.number().finite().nullable().optional(),
  label: z.string().nullable().optional(),
  highlight: z.boolean().optional(),
  /** 지도 라벨 이름. 자동 라벨은 labelPriority가 함께 있을 때만 사용한다. */
  name: z.string().nullable().optional(),
  /** 타일이 서식까지 끝낸 호버·고정 라벨의 보조 문구. */
  sublabel: z.string().nullable().optional(),
  /** 자동 라벨 노출 등급: 0은 자동 숨김, 1·2는 우선순위. */
  labelPriority: z.number().int().min(0).max(2).optional(),
  /** 역 출입구처럼 지물별로 원천 색을 덧씌울 때 쓰는 선택 색. */
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  /** 짧은 표식. 색만으로 뜻을 구분하지 않도록 텍스트를 함께 그린다. */
  badges: z.array(z.object({ text: z.string().min(1).max(4), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/) })).max(4).optional(),
  type: z.string().nullable().optional(),
  households: z.number().finite().nullable().optional(),
  approvalYear: z.number().int().nullable().optional(),
  floorsMax: z.number().finite().nullable().optional(),
  buildingCount: z.number().finite().nullable().optional(),
  distanceM: z.number().finite().nullable().optional(),
  parking: z.number().finite().nullable().optional(),
  // A05·A06 단지/사업 주택형: 전용면적(㎡) 소수점 버림, A/B/C형은 합산
  unitTypes: z.array(z.object({ typeM2: z.number().int().positive(), units: z.number().int().positive() })).optional(),
  // A06: 입주(예정) 월("YYYY-MM", 일자는 만들지 않는다)과 다른 원천과 같은 사업일 수 있음
  plannedMonth: z.string().regex(/^\d{4}-\d{2}$/).nullable().optional(),
  overlap: z.boolean().optional(),
  /** 그래프 y값(타일의 `valueAxis` 단위). 값이 없거나 추정이면 null. */
  value: z.number().finite().nullable().optional(),
});

/** 면(폴리곤) 지물 상한: 일반 타일은 개수, 고리 하나의 꼭짓점 수. 상한은 엔진이 지키고 스키마가 다시 막는다. */
export const MAX_MAP_POLYGONS = 3000;
/** D05는 한 건물을 기본·고층·저층 보기로 합쳐 저장하므로 결과 envelope만 3배까지 허용한다. */
export const MAX_D05_BUILDING_POLYGONS = MAX_MAP_POLYGONS * 3;
export const MAX_POLYGON_VERTICES = 200;
const LngLatSchema = z.tuple([z.number().finite(), z.number().finite()]);
export const MAX_MAP_LINES = 2000;
export const MAX_LINE_VERTICES = 200;
const MapLineSchema = z.object({
  /** 상세 창에서 선 지물과 목록을 연결할 때만 사용한다. */
  fid: z.string().min(1).optional(),
  layer: z.string().min(1),
  points: z.array(LngLatSchema).min(2).max(MAX_LINE_VERTICES),
  label: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  sublabel: z.string().nullable().optional(),
  /** 선의 실제 범례 호선명. 레이어 공통명(철도 노선)과 분리한다. */
  legendLabel: z.string().min(1).optional(),
  labelPriority: z.number().int().min(0).max(2).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  /** 밝은 호선의 선별 케이싱과 역사 막대 두께를 계산 결과에 보존한다. */
  casing: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  strokeWidth: z.number().finite().positive().max(40).optional(),
  casingWidth: z.number().finite().positive().max(48).optional(),
  /** 지도 선 상한에서 역사 막대처럼 우선 보존할 선. */
  capPriority: z.number().int().min(0).max(3).optional(),
  /** 선별 지물의 개별 불투명도. 없으면 공용 LayerStyle을 따른다. */
  opacity: z.number().finite().min(0).max(1).optional(),
  emphasis: z.enum(["major", "minor"]).optional(),
}).refine(
  ({ strokeWidth, casingWidth }) => casingWidth === undefined || strokeWidth === undefined || casingWidth >= strokeWidth,
  { path: ["casingWidth"], message: "casingWidth must be at least strokeWidth" },
);
const MapPolygonSchema = z.object({
  /** 상세 창에서 면 지물과 목록을 연결하는 안정적인 지물 키. */
  fid: z.string().min(1).optional(),
  layer: z.string().min(1),
  /** 첫 고리는 바깥, 나머지는 구멍. WGS84 [lng, lat]. 첫점=끝점으로 닫는다. */
  rings: z.array(z.array(LngLatSchema).min(4).max(MAX_POLYGON_VERTICES + 1)).min(1),
  label: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  sublabel: z.string().nullable().optional(),
  labelPriority: z.number().int().min(0).max(2).optional(),
  /** 그래프 y값(타일의 `valueAxis` 단위). 값이 없거나 추정이면 null. */
  value: z.number().finite().nullable().optional(),
  /** 건물 면 전용: 엔진이 동수로 센 건물인가(건물 중심이 반경 안). 지도는 반경에 걸친 건물도 그리므로 그래프 건물 수가 이 표시를 따른다. */
  counted: z.boolean().optional(),
});

const TerrainSectionSchema = z.object({
  axis: z.enum(["EW", "NS"]),
  from: z.tuple([z.number().finite(), z.number().finite()]),
  to: z.tuple([z.number().finite(), z.number().finite()]),
  samples: z.array(z.object({ d: z.number().finite().nonnegative(), z: z.number().finite().nullable() })),
  siteSpan: z.tuple([z.number().finite().nonnegative(), z.number().finite().nonnegative()]),
  crossings: z.array(z.object({
    d: z.number().finite().nonnegative(),
    kind: z.enum(["retaining", "cut_fill", "fence"]),
    heightM: z.number().finite().nullable(),
  })),
});
const TerrainSectionsSchema = z.object({ A: TerrainSectionSchema, B: TerrainSectionSchema });
export const ROSE_SEASONS = ["annual", "spring", "summer", "autumn", "winter"] as const;
export type RoseSeason = (typeof ROSE_SEASONS)[number];

export const RoseSchema = z.object({
  station: z.string().min(1),
  dirs: z.array(z.array(z.number().finite().nonnegative()).length(5)).length(16),
  calmHours: z.number().finite().nonnegative(),
  missingHours: z.number().finite().nonnegative(),
  totalHours: z.number().finite().nonnegative(),
});
export type Rose = z.infer<typeof RoseSchema>;
export const RoseSetSchema = z.object({
  annual: RoseSchema,
  spring: RoseSchema,
  summer: RoseSchema,
  autumn: RoseSchema,
  winter: RoseSchema,
});
export type RoseSet = z.infer<typeof RoseSetSchema>;

/** 격자 남서 모서리·셀 크기를 포함한 압축 래스터 참조. 바이너리는 앱 DB에 둔다. */
export const RasterRefSchema = z.object({
  name: z.string().regex(/^[a-z0-9_]{1,48}$/),
  kind: z.enum(["scalar", "classes", "mask", "vector2"]),
  crs: z.literal("EPSG:5179"),
  x0: z.number().finite(),
  y0: z.number().finite(),
  cellM: z.number().positive(),
  cols: z.number().int().min(1).max(4096),
  rows: z.number().int().min(1).max(4096),
  dtype: z.enum(["u8", "u16", "i16", "bits"]),
  bands: z.union([z.literal(1), z.literal(2)]),
  scale: z.number().finite(),
  offset: z.number().finite(),
  nodata: z.number().int().nullable(),
  palette: z.string().min(1),
  label: z.string().nullable().optional(),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const TileResultSchema = z
  .object({
    tileId: z.string().min(1),
    analysisId: z.string().min(1),
    tileType: z.enum(TILE_TYPES),
    tileCode: z.string().regex(/^[ADS]\d{2}$|^STACK$|^SHEET$|^SUMMARY$/),
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
      /** 면 지물(선택). D05만 세 보기 합산으로 MAX_D05_BUILDING_POLYGONS까지 허용하고, 실제 화면은 한 보기만 그린다. */
      polygons: z.array(MapPolygonSchema).max(MAX_D05_BUILDING_POLYGONS).optional(),
      polygonsTotal: z.number().int().nonnegative().optional(),
      /** 선 지물(WGS84). 상한 MAX_MAP_LINES. */
      lines: z.array(MapLineSchema).max(MAX_MAP_LINES).optional(),
      linesTotal: z.number().int().nonnegative().optional(),
      /** D22 바람장미: 북쪽부터 시계방향 16방위 × 풍속 5구간 시간수. */
      rose: RoseSchema.optional(),
      /** D22 계절·연간 바람장미. 옛 weather 파일에서는 연간 rose만 유지한다. */
      roses: RoseSetSchema.optional(),
      /** D17 수치지형도 선택 단면. topo가 있는 분석에만 저장한다. */
      terrainSections: TerrainSectionsSchema.optional(),
      /** 지도 위에 겹칠 압축 격자 결과. 바이너리는 tile_raster에 저장한다. */
      rasters: z.array(RasterRefSchema).max(96).optional(),
      /** D01처럼 타일 자체가 고정하는 항공영상 배경. */
      basemap: z.enum(["Satellite"]).optional(),
      /** 지물 `value`의 뜻: 축 이름·값 단위·세는 단위(예: 지상 층수·층·동). 값을 싣는 타일만 둔다. */
      valueAxis: z.object({ label: z.string().min(1), unit: z.string(), countUnit: z.string().min(1) }).optional(),
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
export type MapLine = z.infer<typeof MapLineSchema>;
export type RasterRef = z.infer<typeof RasterRefSchema>;
export type TerrainSections = z.infer<typeof TerrainSectionsSchema>;
export type RasterKind = RasterRef["kind"];
export type RasterDType = RasterRef["dtype"];
export type BasemapChoice = NonNullable<TileResult["presentation"]["basemap"]>;

export function parseTileResult(value: unknown): TileResult {
  return TileResultSchema.parse(value);
}

export function tileCacheKey(input: { tileCode: string; manifestHash: string; engineVersion: string; conditions: TileConditions }): string {
  return sha256Hex(canonicalJson(input));
}
