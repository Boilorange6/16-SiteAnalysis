/** D26 통학구역 도판 — VWorld 학교 학구도·학교군 폴리곤과 대지 포함 구역. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../../engine/context";
import type { FeatureHit } from "../../data/features";
import { areaInCircle, polygonArea } from "../../engine/tiles/geo";
import { fmt, makeTile, obs, polygonCandidate, type PolygonCandidate, type TileDraft } from "../../engine/tiles/common";
import { formatDistanceM } from "../../ui/tile-view";
import { SCHOOL_ZONE_KINDS, schoolZoneSources, siteZones, zoneBaseDate, zoneName, zoneOffice } from "../../engine/tiles/school-zone-shared";
import { notProvided } from "../../engine/tiles/not-provided";

const KIND_TO_LAYERS = {
  school_zone_elem: { normal: "school_zone_elem", site: "school_zone_elem_site", label: "초등 통학구역" },
  school_zone_middle: { normal: "school_zone_middle", site: "school_zone_middle_site", label: "중학교 학교군" },
  school_zone_high: { normal: "school_zone_high", site: "school_zone_high_site", label: "고등학교 학교군" },
} as const;

const siteText = (hits: readonly ReturnType<EngineContext["hits"]>[number][], empty: string) => hits.length > 0 ? hits.map((hit) => `${zoneName(hit)}(${zoneOffice(hit)})`).join("·") : empty;

function rawZoneName(hit: FeatureHit): string | null {
  for (const value of [hit.properties.hakgudoName, hit.properties.hakgudo_nm, hit.name]) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

export function d26(ctx: EngineContext): TileResult {
  const sources = schoolZoneSources(ctx);
  if (sources.length === 0) return notProvided(ctx, "D26");

  const radiusM = ctx.input.radiusM;
  const site = siteZones(ctx);
  const polygons: PolygonCandidate[] = [];
  const counts = new Map(SCHOOL_ZONE_KINDS.map((kind) => [kind, 0]));
  let clipFailed = 0;
  const hits = ctx.hits("reference", [...SCHOOL_ZONE_KINDS], radiusM).sort((a, b) => a.featureId - b.featureId);
  for (const hit of hits) {
    const kind = hit.kind as (typeof SCHOOL_ZONE_KINDS)[number];
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    const highlighted = site.get(kind)?.some((candidate) => candidate.featureId === hit.featureId) ?? false;
    const clipped = areaInCircle(ctx.input.center, radiusM, hit.geometry);
    if (!clipped) {
      clipFailed++;
      continue;
    }
    const layer = highlighted ? KIND_TO_LAYERS[kind].site : KIND_TO_LAYERS[kind].normal;
    for (const [partIndex, rings] of clipped.parts.entries()) {
      const areaM2 = polygonArea(rings);
      const polygon = areaM2 > 0
        ? polygonCandidate(hit.featureId * 1000 + partIndex, layer, rings, areaM2, null, {
            name: highlighted ? rawZoneName(hit) : null,
            sublabel: null,
            labelPriority: highlighted ? 2 : 0,
          })
        : null;
      if (polygon) polygons.push(polygon);
    }
  }

  const elem = site.get("school_zone_elem") ?? [];
  const middle = site.get("school_zone_middle") ?? [];
  const high = site.get("school_zone_high") ?? [];
  const baseDate = sources.map((source) => source.sourceAsOf).filter((date): date is string => date !== null).sort().at(-1) ?? zoneBaseDate(hits[0]) ?? "미확인";
  const metrics: TileDraft["metrics"] = [
    obs("back_elem_count", "반경 내 초등 통학구역", counts.get("school_zone_elem") ?? 0, "구역", "d26-count@1:반경과 교차하는 고유 VWorld 초등 학구도 수"),
    obs("back_middle_count", "반경 내 중학교 학교군", counts.get("school_zone_middle") ?? 0, "군", "d26-count@1:반경과 교차하는 고유 VWorld 중학교 학교군 수"),
    obs("back_high_count", "반경 내 고등학교 학교군", counts.get("school_zone_high") ?? 0, "군", "d26-count@1:반경과 교차하는 고유 VWorld 고등학교 학교군 수"),
    obs("site_elem_zone", "대지의 초등 통학구역", elem.length > 0 ? 1 : 0, "개", "d26-site@1:대지 중심점이 초등 학구도에 포함되는지"),
    obs("site_middle_group", "대지의 중학교 학교군", middle.length, "군", "d26-site@1:대지 중심점이 중학교 학교군에 포함되는 고유 구역 수"),
    obs("site_high_group", "대지의 고등학교 학교군", high.length, "군", "d26-site@1:대지 중심점이 고등학교 학교군에 포함되는 고유 구역 수"),
  ];
  const coverage = ctx.coverage("reference", ["school_zone"]);
  const status: TileResult["status"] = clipFailed > 0 || coverage.some((limitation) => limitation.kind === "partial" || limitation.kind === "incomplete") ? "partial" : "complete";
  const sentence = `VWorld 학구도 기준일 ${baseDate}, 반경 ${formatDistanceM(radiusM)} 안 초등 통학구역 ${fmt(counts.get("school_zone_elem") ?? 0)}곳·중학교 학교군 ${fmt(counts.get("school_zone_middle") ?? 0)}곳·고등학교 학교군 ${fmt(counts.get("school_zone_high") ?? 0)}곳 → 대지 초등 ${siteText(elem, "미포함")}, 중학교 ${siteText(middle, "미포함")}, 고등학교 ${siteText(high, "미포함")} → 실제 배정은 교육청 확인 필요`;
  const limitations: TileDraft["limitations"] = [
    { kind: "unknown", note: "VWorld 학구도·학교군 경계의 대지 포함 여부를 표시한 참조 도판입니다. 학구도에 연결된 학교와 실제 전입·배정 결과는 교육청 확인이 필요합니다." },
    ...(clipFailed > 0 ? [{ kind: "partial" as const, note: `도형 오류로 반경 교차를 계산하지 못한 학구도 ${clipFailed}건은 지도에서 제외했습니다.` }] : []),
    ...coverage,
  ];
  return makeTile(ctx, {
    code: "D26",
    type: "diagram",
    status,
    metrics,
    judgment: { ruleId: "D26-school-zone@1", basisMetricIds: ["back_elem_count", "site_elem_zone"], sentence, level: null, criteria: null },
    sources,
    layers: ["school_zone_elem", "school_zone_elem_site", "school_zone_middle", "school_zone_middle_site", "school_zone_high", "school_zone_high_site"],
    polygons,
    limitations,
  });
}
