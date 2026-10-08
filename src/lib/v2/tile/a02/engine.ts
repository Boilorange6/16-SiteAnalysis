/** A02 학교·통학구역 — 학교 위치 거리·개수와 VWorld 학구도 기반 배정 참조. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../../engine/context";
import type { FeatureHit } from "../../data/features";
import { candidate, fmt, makeTile, missing, nearestHit, nearestM, obs, type TileDraft } from "../../engine/tiles/common";
import { notProvided } from "../../engine/tiles/not-provided";
import { assignedSchools, schoolZoneSources, siteZones, zoneName, zoneOffice } from "../../engine/tiles/school-zone-shared";

export const SCHOOL_SEARCH_MIN_M = 1500;
export const SCHOOL_ZONE_NOTE = "통학구역 도형 미확보 — 배정은 교육청 확인";

const LEVELS = [
  { level: "초등학교", key: "elem", name: "초등학교", layer: "school_elem" },
  { level: "중학교", key: "middle", name: "중학교", layer: "school_middle" },
  { level: "고등학교", key: "high", name: "고등학교", layer: "school_high" },
] as const;

const isOperating = (h: FeatureHit) => h.properties.operatingStatus === "운영";

export function a02(ctx: EngineContext): TileResult {
  const schoolSources = ctx.sources("reference", ["school"]);
  const zoneSources = schoolZoneSources(ctx);
  const linkSources = ctx.sources("reference", ["school_zone_link"]);
  const sources = [...schoolSources, ...zoneSources, ...linkSources];
  if (sources.length === 0) return notProvided(ctx, "A02"); // 학교·학구 원천이 게시되지 않은 버전
  const hasZones = zoneSources.length > 0;
  const radiusM = ctx.input.radiusM;
  const searchM = Math.max(radiusM, SCHOOL_SEARCH_MIN_M);
  const searchTxt = `탐색 ${fmt(searchM)}m`;
  // 같은 학교ID는 한 번만(본교·분교 행 중복 방지)
  const seen = new Set<string>();
  const all = ctx.hits("reference", ["school"], searchM).filter(isOperating).filter((h) => {
    const id = String(h.properties.schoolId ?? h.stableId);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const metrics: TileDraft["metrics"] = [];
  const map: TileDraft["map"] = [];
  const nearestOf: Record<string, number | null> = {};
  for (const L of LEVELS) {
    const ofLevel = all.filter((h) => h.properties.level === L.level);
    const inR = ofLevel.filter((h) => h.distanceM! <= radiusM);
    const near = nearestHit(ofLevel);
    const nm = nearestM(ofLevel.map((h) => h.distanceM));
    nearestOf[L.key] = nm;
    metrics.push(
      nm === null ? missing(`nearest_${L.key}_m`, `최근접 ${L.name}`, "m", `a02-nearest@1:직선, ${searchTxt}`) : obs(`nearest_${L.key}_m`, `최근접 ${L.name}(학교 대표점)`, nm, "m", `a02-nearest@1:직선, ${searchTxt}`),
      obs(`${L.key}_schools`, `반경 내 ${L.name}`, inR.length, "개교", "a02-count@1:운영 학교, 고유 학교ID"),
    );
    for (const h of inR) map.push(h === near && L.key === "elem" ? candidate(h, "school_nearest", { highlight: true, label: `직선 ${nm}m` }) : candidate(h, L.layer));
  }
  const site: ReadonlyMap<string, FeatureHit[]> = hasZones ? siteZones(ctx) : new Map();
  const elemZones = site.get("school_zone_elem") ?? [];
  const middleZones = site.get("school_zone_middle") ?? [];
  const highZones = site.get("school_zone_high") ?? [];
  const assignedElem = hasZones ? assignedSchools(ctx, elemZones, "elem") : [];
  if (!hasZones) {
    metrics.push(missing("in_school_zone", "대상 주소의 통학구역", "", "a02-zone@0"));
    metrics.push(missing("assigned_elem_schools", "배정 초등학교(연계 확인)", "개교", "a02-assigned@0"));
    metrics.push(missing("middle_school_groups", "대상 중학교 학교군", "군", "a02-zone@0"));
    metrics.push(missing("high_school_groups", "대상 고등학교 학교군", "군", "a02-zone@0"));
  } else {
    metrics.push(obs("in_school_zone", "대상 주소의 초등 통학구역", elemZones.length > 0 ? 1 : 0, "", "a02-zone@1:대지 중심점의 VWorld 초등 학구도 포함 여부"));
    metrics.push(obs("assigned_elem_schools", "배정 초등학교(연계 확인)", assignedElem.length, "개교", "a02-assigned@1:serves_zone 링크가 있는 운영 초등학교 고유 수"));
    metrics.push(obs("middle_school_groups", "대상 중학교 학교군", middleZones.length, "군", "a02-zone@1:대지 중심점의 VWorld 중학교 학교군 수"));
    metrics.push(obs("high_school_groups", "대상 고등학교 학교군", highZones.length, "군", "a02-zone@1:대지 중심점의 VWorld 고등학교 학교군 수"));
  }

  const elem = nearestOf.elem;
  const sentence = !hasZones
    ? elem === null
      ? `${searchTxt} 안 운영 초등학교 없음, 통학구역은 미확인 → 통학구역 도형이 없어 배정은 판단하지 않음 → 배정은 교육청 확인 필요`
      : `최근접 초등학교 직선 ${fmt(elem)}m 확인, 통학구역은 미확인 → 통학구역 도형이 없어 가까운 학교가 배정학교라고 볼 수 없음 → 배정은 교육청 확인 필요`
    : (() => {
        const elemText = assignedElem.length > 0 ? assignedElem.map((school) => school.name).join("·") : elemZones.length > 0 ? "연계 학교 미확인" : "초등 통학구역 미포함";
        const middleText = middleZones.length > 0 ? middleZones.map((zone) => `${zoneName(zone)}(${zoneOffice(zone)})`).join("·") : "중학교 학교군 미포함";
        const highText = highZones.length > 0 ? highZones.map((zone) => `${zoneName(zone)}(${zoneOffice(zone)})`).join("·") : "고등학교 학교군 미포함";
        const nearest = elem === null ? "탐색 반경 안 운영 초등학교 없음" : `최근접 초등학교 직선 ${fmt(elem)}m`;
        return `${nearest} → 배정 초등학교 ${elemText}, 중학교 학교군 ${middleText}, 고등학교 학교군 ${highText} → VWorld 경계와 CSV 연계 기준이며 실제 배정은 교육청 확인 필요`;
      })();
  const coverageSources = [...schoolSources.map((source) => source.sourceId), ...zoneSources.map((source) => source.sourceId), ...linkSources.map((source) => source.sourceId)];
  const limitations = !hasZones
    ? [
        { kind: "not_provided" as const, note: SCHOOL_ZONE_NOTE },
        { kind: "unknown" as const, note: "학교 대표점 기준 직선거리이며 정문·통학로는 반영하지 않았습니다. 운영 상태가 ‘운영’인 학교만 셌습니다." },
        ...ctx.coverage("reference", coverageSources),
      ]
    : [
        { kind: "unknown" as const, note: "VWorld 학구도·학교군 경계와 학교별 serves_zone 연계를 참조해 표시합니다. 전입·배정 시점과 실제 배정은 교육청 확인이 필요합니다." },
        ...(elemZones.length > 0 && assignedElem.length === 0 ? [{ kind: "partial" as const, note: "대지의 초등 통학구역은 확인했지만 운영 학교로 연결된 serves_zone 연계가 없어 배정 초등학교 이름은 미확인입니다." }] : []),
        { kind: "unknown" as const, note: "학교 대표점 기준 직선거리이며 정문·통학로는 반영하지 않았습니다. 운영 상태가 ‘운영’인 학교만 셌습니다." },
        ...ctx.coverage("reference", coverageSources),
      ];
  return makeTile(ctx, {
    code: "A02",
    status: "partial",
    metrics,
    judgment: { ruleId: hasZones ? "a02-school-zones@2" : "a02-school-points@1", basisMetricIds: hasZones ? ["in_school_zone", "assigned_elem_schools"] : elem === null ? [] : ["nearest_elem_m"], sentence, level: null, criteria: null },
    sources,
    layers: ["school_elem", "school_middle", "school_high", "school_nearest"],
    map,
    limitations,
  });
}
