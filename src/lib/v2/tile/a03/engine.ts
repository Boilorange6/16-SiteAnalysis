/** A03 생활편의·상가 — 소상공인 상가정보를 업종군으로 묶어 센다. 등급 없음. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../../engine/context";
import { candidate, fmt, makeTile, missing, noDataTile, obs } from "../../engine/tiles/common";
import { formatDistanceM } from "../../ui/tile-view";

export const STORE_GROUPS = [
  { id: "grocery", label: "식료품", basic: true },
  { id: "clinic", label: "의원", basic: true },
  { id: "pharmacy", label: "약국", basic: true },
  { id: "life_service", label: "생활서비스", basic: true },
  { id: "eatery", label: "음식·카페", basic: false },
  { id: "other", label: "기타", basic: false },
] as const;
export type StoreGroup = (typeof STORE_GROUPS)[number]["id"];

/**
 * 상권업종소분류코드(categoryCode) 접두어 → 업종군. 코드가 없으면 대분류로만 판단한다.
 * G204 종합 소매(슈퍼·편의점 등) · G205 식료품 소매(가축 사료 G20502·건강보조식품 G20508 제외)
 * Q102 의원(치과·한의원 포함) · G21501 약국 · S201·S202·S205~S209 수리·이미용·세탁 등 생활서비스 · 대분류 음식 = 음식·카페
 */
export function storeGroup(p: Record<string, unknown>): StoreGroup {
  const code = typeof p.categoryCode === "string" ? p.categoryCode : "";
  if (code.startsWith("G204") || (code.startsWith("G205") && code !== "G20502" && code !== "G20508")) return "grocery";
  if (code.startsWith("Q102")) return "clinic";
  if (code === "G21501") return "pharmacy";
  if (/^S20[125678]|^S209/.test(code)) return "life_service";
  if (code.startsWith("I") || (code === "" && p.majorCategory === "음식")) return "eatery";
  return "other";
}

export function a03(ctx: EngineContext): TileResult {
  const sources = ctx.sources("reference", ["store"]);
  if (sources.length === 0) return noDataTile(ctx, "A03", ["store"]);
  const hits = ctx.hits("reference", ["store"]);
  const count = Object.fromEntries(STORE_GROUPS.map((g) => [g.id, 0])) as Record<StoreGroup, number>;
  const nearestOf: Partial<Record<StoreGroup, (typeof hits)[number]>> = {};
  for (const h of hits) {
    const g = storeGroup(h.properties);
    count[g] += 1;
    if (h.distanceM === null) continue;
    const previous = nearestOf[g];
    if (previous === undefined || h.distanceM < previous.distanceM! || (h.distanceM === previous.distanceM && h.featureId < previous.featureId)) nearestOf[g] = h;
  }
  const basicFound = STORE_GROUPS.filter((g) => g.basic && count[g.id] > 0);
  const basicMissing = STORE_GROUPS.filter((g) => g.basic && count[g.id] === 0);
  const areaKm2 = (Math.PI * ctx.input.radiusM * ctx.input.radiusM) / 1e6;
  const metrics = [
    obs("basic_groups", "기초 생활시설 확인 군(4군 중)", basicFound.length, "군", "a03-basic-groups@1", basicFound.length, 4),
    obs("stores", "반경 내 상가 전체", hits.length, "개", "a03-count@1"),
    ...STORE_GROUPS.map((g) => obs(`count_${g.id}`, `${g.label} 업소`, count[g.id], "개", "a03-group-count@1")),
    ...STORE_GROUPS.filter((g) => g.basic).map((g) => {
      const n = nearestOf[g.id]?.distanceM;
      return n === undefined || n === null ? missing(`nearest_${g.id}_m`, `최근접 ${g.label}`, "m", "a03-group-nearest@1") : obs(`nearest_${g.id}_m`, `최근접 ${g.label}`, Math.round(n), "m", "a03-group-nearest@1");
    }),
    obs("store_density", "상가 밀도", Math.round((hits.length / areaKm2) * 10) / 10, "개/㎢", "a03-density@1", hits.length, Math.round(areaKm2 * 1000) / 1000),
  ];
  const sentence = `기초 생활시설 4군 중 ${basicFound.length}군 확인 → ${
    basicFound.length === 4 ? "반경 안에서 일상 시설 접근 가능" : basicFound.length === 0 ? "반경 안에서 기초 시설이 확인되지 않음" : "반경 안에서 일상 시설 접근이 일부 가능"
  } → ${basicMissing.length ? `미확인 군(${basicMissing.map((g) => g.label).join(", ")}) 현장 확인` : `업소 ${fmt(hits.length)}개의 영업 여부는 현장 확인`}`;
  return makeTile(ctx, {
    code: "A03",
    status: "complete",
    metrics,
    judgment: { ruleId: "a03-basic-groups@1", basisMetricIds: ["basic_groups"], sentence, level: null, criteria: null },
    sources,
    layers: STORE_GROUPS.map((g) => `store:${g.id}`),
    map: hits.map((h) => {
      const g = storeGroup(h.properties);
      const isNearest = h === nearestOf[g] && h.distanceM !== null;
      const sublabel = isNearest && h.distanceM !== null ? formatDistanceM(h.distanceM) : null;
      return candidate(h, `store:${g}`, {
        distanceM: h.distanceM,
        sublabel,
        labelPriority: isNearest ? 2 : 0,
        ...(isNearest ? { highlight: true } : {}),
      });
    }),
    limitations: ctx.coverage("reference", ["store"]),
  });
}
