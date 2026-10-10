/** D19 지적 — 반경과 교차하는 연속지적 도형과 지목 구성을 참조용으로 표시한다. */
import type { FeatureHit } from "../../data/features";
import type { TileResult } from "../../tile-result";
import type { EngineContext, Limitation } from "../../engine/context";
import { makeTile, obs, polygonCandidate } from "../../engine/tiles/common";
import { polygonArea, polygonParts } from "../../engine/tiles/geo";
import { notProvided } from "../../engine/tiles/not-provided";
import { measureParcels } from "./parcel-measure";

const PARCEL_SOURCES = ["parcel_polygon"] as const;
type Metric = TileResult["metrics"][number];

type JimokGroup = { id: string; label: string };

const ROAD_JIMOK = new Set(["도", "도로", "철", "철도", "철도용지", "제", "제방"]);
const WATER_JIMOK = new Set(["천", "하천", "구", "구거", "유", "유지"]);
// 원천 지목은 도·천·구·유·제·철처럼 한 글자로 들어오는 경우가 많다.
// 그룹 판정은 이 목록을 먼저 확인해 도로와 하천·구거를 섞지 않는다.
const ROAD_WATER_JIMOK = new Set([...ROAD_JIMOK, ...WATER_JIMOK]);
const JIMOK_GROUPS: readonly JimokGroup[] = [
  { id: "jimok:site", label: "대지" },
  { id: "jimok:road", label: "도로" },
  { id: "jimok:field", label: "전답" },
  { id: "jimok:forest", label: "임야" },
  { id: "jimok:water", label: "하천·구거" },
  { id: "jimok:other", label: "기타" },
];
const JIMOK_LAYERS = JIMOK_GROUPS.map((group) => group.id);

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

function notApplicable(id: string, label: string, unit: string, formulaVersion: string): Metric {
  return { id, label, value: null, unit, formulaVersion, numerator: null, denominator: null, status: "not_applicable" };
}

function jimokOf(hit: FeatureHit): string {
  const value = hit.properties.jimok;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "미상";
}

const JIMOK_READABLE: Readonly<Record<string, string>> = {
  대: "대지",
  대지: "대지",
  도: "도로",
  도로: "도로",
  철: "철도",
  철도: "철도",
  철도용지: "철도",
  전: "전",
  답: "답",
  전답: "전·답",
  임: "임야",
  임야: "임야",
  천: "하천",
  하천: "하천",
  구: "구거",
  구거: "구거",
  유: "유지",
  유지: "유지",
  제: "제방",
  제방: "제방",
};

function readableJimokOf(hit: FeatureHit): string | null {
  const value = hit.properties.jimok;
  if (typeof value !== "string" || value.trim() === "") return null;
  const trimmed = value.trim();
  return JIMOK_READABLE[trimmed] ?? trimmed;
}

function jibunOf(hit: FeatureHit): string | null {
  const value = hit.properties.jibun;
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return hit.name ?? null;
}

function jimokGroupIndex(value: string): number {
  if (value === "대" || value === "대지") return 0;
  if (ROAD_WATER_JIMOK.has(value) && ROAD_JIMOK.has(value)) return 1;
  if (value === "전" || value === "답" || value === "전답") return 2;
  if (value === "임" || value === "임야") return 3;
  if (ROAD_WATER_JIMOK.has(value) && WATER_JIMOK.has(value)) return 4;
  return 5;
}

function groupedJimok(hits: FeatureHit[], byFeature: Map<number, { areaM2: number; parts: number[][][][] }>): Array<{ group: JimokGroup; count: number; areaM2: number }> {
  const grouped = JIMOK_GROUPS.map((group) => ({ group, count: 0, areaM2: 0 }));
  for (const hit of hits) {
    const current = grouped[jimokGroupIndex(jimokOf(hit))];
    current.count++;
    current.areaM2 += byFeature.get(hit.featureId)?.areaM2 ?? 0;
  }
  return grouped;
}

export function d19(ctx: EngineContext): TileResult {
  const sources = ctx.sources("parcels", PARCEL_SOURCES);
  if (sources.length === 0) return notProvided(ctx, "D19");

  const hits = ctx.hits("parcels", ["parcel"]);
  const siteHits = ctx.siteParcelHits();
  const siteHitIds = new Set(siteHits.map((hit) => hit.featureId));
  const { byFeature, failed } = measureParcels(ctx, hits);
  const circleAreaM2 = Math.PI * ctx.input.radiusM ** 2;
  const circleAreaRounded = Math.round(circleAreaM2);
  const validAreaM2 = [...byFeature.values()].reduce((sum, value) => sum + value.areaM2, 0);
  const siteFound = ctx.input.site.geometry !== null || (ctx.input.pnu !== null && siteHitIds.size > 0);
  const grouped = groupedJimok(hits, byFeature);

  const metrics: Metric[] = [
    obs("parcels", "교차 필지", hits.length, "필지", "d19-parcels@1:반경과 실제 교차하는 parcel 도형 수"),
    ctx.input.site.kind === "address" && ctx.input.pnu === null && ctx.input.site.geometry === null
      ? notApplicable("site_parcel_found", "대상 필지 도형 확인", "여부", "d19-site-parcel@1:pnu 입력이 없는 좌표 분석")
      : obs("site_parcel_found", "대상 필지 도형 확인", siteFound ? 1 : 0, "여부", "d19-site-parcel@1:대지 geometry 또는 선택 PNU 도형 확보 여부", siteFound ? 1 : 0, 1),
    obs("fill_geometry_pct", "확보 도형 면적률(대상 분모 미확보)", pct(validAreaM2, circleAreaM2), "%", "d19-fill-geometry@1:유효 도형 교차면적÷π·r²; 원천 지적 대상 면적 분모 미확보", Math.round(validAreaM2), circleAreaRounded),
  ];

  for (const [i, values] of grouped.entries()) {
    metrics.push(obs(`share_jimok_${i + 1}`, `지목: ${values.group.label}`, pct(values.count, hits.length), "%", "d19-jimok-share@2:고정 6개 지목 그룹별 교차 필지 수÷교차 필지 수", values.count, hits.length));
    metrics.push(obs(`share_area_${i + 1}`, `${values.group.label} (면적)`, pct(values.areaM2, circleAreaM2), "%", "d19-share-area@2:고정 6개 지목 그룹별 유효 도형 교차면적÷π·r²", Math.round(values.areaM2), circleAreaRounded));
  }

  const polygons = [];
  const renderedSiteIds = new Set<number>();
  for (const hit of hits) {
    const measured = byFeature.get(hit.featureId);
    if (!measured) continue;
    const isSite = siteHitIds.has(hit.featureId);
    const layer = isSite ? "parcel_site" : JIMOK_GROUPS[jimokGroupIndex(jimokOf(hit))].id;
    const jibun = jibunOf(hit);
    const name = jibun === null ? null : isSite ? `대지 ${jibun}` : jibun;
    const legacyLabel = jibun;
    if (isSite) {
      renderedSiteIds.add(hit.featureId);
    }
    // A selected multi-parcel site is a deliberate map target, so preserve
    // its full parcel outlines even when an outline extends beyond the
    // analysis circle. Legacy address mode keeps the existing clipped view.
    const displayParts = isSite && ctx.input.site.kind === "parcels" ? polygonParts(hit.geometry) : measured.parts;
    for (const rings of displayParts) {
      const polygon = polygonCandidate(hit.featureId, layer, rings, polygonArea(rings), legacyLabel, {
        name,
        sublabel: readableJimokOf(hit),
        labelPriority: isSite ? 2 : 0,
      });
      if (polygon) polygons.push(polygon);
    }
  }

  // A selected parcel can sit wholly outside a small analysis circle. It is
  // still part of the requested site and must remain visible in parcel_site.
  if (ctx.input.site.kind === "parcels") {
    for (const hit of siteHits) {
      if (renderedSiteIds.has(hit.featureId)) continue;
      const jibun = jibunOf(hit);
      const name = jibun === null ? null : `대지 ${jibun}`;
      for (const rings of polygonParts(hit.geometry)) {
        const polygon = polygonCandidate(hit.featureId, "parcel_site", rings, polygonArea(rings), jibun, {
          name,
          sublabel: readableJimokOf(hit),
          labelPriority: 2,
        });
        if (polygon) polygons.push(polygon);
      }
    }
  }

  // 직접 그린 구역은 원천 필지와 무관하게 대지 도형 자체를 계약상 parcel_site로 보낸다.
  if (ctx.input.site.kind === "polygon" && ctx.input.site.geometry) {
    for (const rings of polygonParts(ctx.input.site.geometry)) {
      const candidatePolygon = polygonCandidate(0, "parcel_site", rings, polygonArea(rings), null, {
        name: null,
        sublabel: null,
        labelPriority: 0,
      });
      if (candidatePolygon) polygons.push(candidatePolygon);
    }
  }

  const coverage = ctx.coverage("parcels", PARCEL_SOURCES);
  const limitations: Limitation[] = [
    { kind: "unknown", note: "확보 도형 면적률의 분모는 반경 원 면적이며, 원천 지적 대상 면적 분모는 확보하지 못했습니다." },
    { kind: "unknown", note: "연속지적 도형과 지목은 참조용이며 법적 경계·공부면적의 확정 자료가 아닙니다." },
    ...(failed > 0 ? [{ kind: "partial" as const, note: `도형 오류로 반경 교차 면적을 계산하지 못한 ${failed}건은 면적 구성에서 제외했습니다.` }] : []),
    ...coverage,
  ];
  const status: TileResult["status"] = limitations.some((item) => item.kind === "partial" || item.kind === "incomplete") ? "partial" : "complete";
  const topJimok = [...grouped].sort((a, b) => b.count - a.count || JIMOK_GROUPS.indexOf(a.group) - JIMOK_GROUPS.indexOf(b.group))[0];
  const topJimokText = topJimok && topJimok.count > 0 ? `상위 지목 ${topJimok.group.label} ${topJimok.count}개(${pct(topJimok.count, hits.length)}%)` : "지목별 필지 0개";
  const sentence = hits.length === 0
    ? `반경 ${ctx.input.radiusM.toLocaleString("en-US")}m 안 연속지적 필지 0개, ${topJimokText} → 지적 도형 공백과 무필지를 구분할 수 없음 → 지적도와 토지대장 확인 필요`
    : `반경 ${ctx.input.radiusM.toLocaleString("en-US")}m 안 연속지적 필지 ${hits.length}개, ${topJimokText} → 지목별 필지 수와 교차 도형 면적을 참조용으로 표시 → 대상 필지와 경계는 지적도·토지대장 확인 필요`;

  return makeTile(ctx, {
    code: "D19",
    type: "diagram",
    status,
    metrics,
    judgment: { ruleId: "D19-parcels@1", basisMetricIds: ["parcels"], sentence, level: null, criteria: null },
    sources,
    layers: ["parcel_site", ...JIMOK_LAYERS],
    polygons,
    limitations,
  });
}
