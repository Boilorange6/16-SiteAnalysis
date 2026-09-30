/**
 * A02 학교·통학구역 — 학교 위치 점(운영 중만)의 학교급별 거리·개수. 통학구역 도형이 없어 배정은 판단하지 않는다.
 * 카탈로그: 등급은 공식 연결 학교가 확인된 경우에만 제안한다 → 통학구역 미확보이므로 등급 없음.
 */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import type { FeatureHit } from "../../data/features";
import { candidate, fmt, makeTile, missing, nearestHit, nearestM, obs, type TileDraft } from "./common";
import { notProvided } from "./not-provided";

export const SCHOOL_SEARCH_MIN_M = 1500;
export const SCHOOL_ZONE_NOTE = "통학구역 도형 미확보 — 배정은 교육청 확인";

const LEVELS = [
  { level: "초등학교", key: "elem", name: "초등학교", layer: "school_elem" },
  { level: "중학교", key: "middle", name: "중학교", layer: "school_middle" },
  { level: "고등학교", key: "high", name: "고등학교", layer: "school_high" },
] as const;

const isOperating = (h: FeatureHit) => h.properties.operatingStatus === "운영";

export function a02(ctx: EngineContext): TileResult {
  const sources = ctx.sources("reference", ["school"]);
  if (sources.length === 0) return notProvided(ctx, "A02"); // 학교 원천이 게시되지 않은 버전
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
  metrics.push(missing("in_school_zone", "대상 주소의 통학구역", "", "a02-zone@0"));

  const elem = nearestOf.elem;
  const sentence =
    elem === null
      ? `${searchTxt} 안 운영 초등학교 없음, 통학구역은 미확인 → 통학구역 도형이 없어 배정은 판단하지 않음 → 배정은 교육청 확인 필요`
      : `최근접 초등학교 직선 ${fmt(elem)}m 확인, 통학구역은 미확인 → 통학구역 도형이 없어 가까운 학교가 배정학교라고 볼 수 없음 → 배정은 교육청 확인 필요`;
  return makeTile(ctx, {
    code: "A02",
    status: "partial",
    metrics,
    judgment: { ruleId: "a02-school-points@1", basisMetricIds: elem === null ? [] : ["nearest_elem_m"], sentence, level: null, criteria: null },
    sources,
    layers: ["school_elem", "school_middle", "school_high", "school_nearest"],
    map,
    limitations: [
      { kind: "not_provided", note: SCHOOL_ZONE_NOTE },
      { kind: "unknown", note: "학교 대표점 기준 직선거리이며 정문·통학로는 반영하지 않았습니다. 운영 상태가 ‘운영’인 학교만 셌습니다." },
      ...ctx.coverage("reference", ["school"]),
    ],
  });
}
