/** D08 용도지역 — 중첩 가능한 지정 면적과 원천 세분을 도판으로 표시한다. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../../engine/context";
import { makeTile, obs, type MapCandidate, type TileDraft } from "../../engine/tiles/common";
import { notProvided } from "../../engine/tiles/not-provided";
import { collectZoning, CLASSES, ZONING_LAYERS } from "../../engine/tiles/zoning-shared";

const RAW_TOP = 6;
const r1 = (n: number) => Math.round(n * 10) / 10;
const rounded = (n: number) => Math.round(n);

export function d08(ctx: EngineContext): TileResult {
  const zoning = collectZoning(ctx);
  if (!zoning) return notProvided(ctx, "D08");

  const { byClass, byRaw, circleArea, total, siteLabel, siteNames, fine, polys, points } = zoning;
  const pct = (areaM2: number) => r1((areaM2 / circleArea) * 100);
  const classes = CLASSES.map((name) => [name, byClass.get(name) ?? 0] as const);
  const presentClasses = classes.filter(([, areaM2]) => areaM2 > 0);
  const raws = [...byRaw].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, RAW_TOP);
  const cappedTotal = Math.min(circleArea, total);
  const overlapM2 = Math.max(0, total - circleArea);

  const metrics: TileDraft["metrics"] = [
    obs("fill_zoning_pct", "유효 용도지역 지정 면적률", pct(cappedTotal), "%", "d08-fill@1:min(100%, 지정 도형 교차면적 합÷π·r²)", rounded(cappedTotal), rounded(circleArea)),
    ...classes.map(([name, areaM2], index) => obs(`share_class_${index + 1}`, `구성비: ${name}`, pct(areaM2), "%", "d08-share-class@1:교차면적÷반경 원 면적(중복 제거 없음)", rounded(areaM2), rounded(circleArea))),
    obs("back_overlap_pct", "중첩 지정 초과분", r1(Math.max(0, pct(total) - 100)), "%", "d08-overlap@1:max(0, Σ교차 지정면적−π·r²)÷π·r²", rounded(overlapM2), rounded(circleArea)),
    ...raws.map(([name, areaM2], index) => obs(`raw_${index + 1}`, `원천 세분: ${name}`, pct(areaM2), "%", "d08-raw@1:원천 세분 교차면적÷반경 원 면적", rounded(areaM2), rounded(circleArea))),
  ];

  const top = presentClasses.length ? [...presentClasses].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, areaM2]) => `${name} ${pct(areaM2)}%`).join("·") : null;
  const sentence = siteLabel === null
    ? `대지 중심점의 용도지역 지정을 도면에서 확인하지 못함${top ? `, 반경 안 구성은 ${top}` : ""} → 도면 밖이거나 미지정일 수 있음 → 토지이용계획확인서로 확인 필요`
    : `대지 중심점은 ${siteLabel}${siteNames.length > 1 ? "(복수 지정)" : ""}${top ? `, 반경 안 구성은 ${top}` : ""} → 지정 현황이며 지구·건축 허용 여부를 뜻하지 않음 → 토지이용계획확인서로 개별 규제 확인 필요`;

  const map: MapCandidate[] = [...points];
  if (siteLabel) map.push({ id: 0, f: { layer: "zoning_site", lng: ctx.input.center[0], lat: ctx.input.center[1], highlight: true, label: siteLabel } });
  const missingLayers = ZONING_LAYERS.filter((layer) => !zoning.sources.some((source) => source.sourceId === layer));
  const coverage = ctx.coverage("reference", ZONING_LAYERS);
  const limitations: TileDraft["limitations"] = [
    { kind: "unknown", note: "구성비의 분모는 반경 원 면적입니다(수면·도면 밖·미지정 구간 포함). 지구·지구단위계획은 포함하지 않습니다." },
    ...(overlapM2 > circleArea * 0.005 ? [{ kind: "estimated" as const, note: `겹치는 지정 도형이 있어 구성비 합이 ${pct(total)}%로 100%를 넘을 수 있습니다(겹친 면적은 각각 셈).` }] : []),
    ...(zoning.umbrellas > 0 ? [{ kind: "suppressed" as const, note: `세분 없이 “도시지역”으로만 지정된 도형 ${zoning.umbrellas}건은 다른 지정과 겹쳐 구성비에서 제외했습니다.` }] : []),
    ...(fine.length > 1 ? [{ kind: "unknown" as const, note: "대지 중심점에 복수의 용도지역 지정이 있어 모두 표시했습니다. 어느 것이 적용되는지 확인이 필요합니다." }] : []),
    ...(zoning.clipFailed > 0 ? [{ kind: "partial" as const, note: `도형 오류로 반경 절단이 안 된 ${zoning.clipFailed}건은 구성비에서 빠졌습니다.` }] : []),
    ...(missingLayers.length > 0 ? [{ kind: "incomplete" as const, note: `용도지역 자료 ${missingLayers.length}종(${missingLayers.join(", ")})을 확인하지 못했습니다.` }] : []),
    ...coverage,
  ];
  const status: TileResult["status"] = limitations.some((limitation) => limitation.kind === "partial" || limitation.kind === "incomplete") ? "partial" : "complete";

  return makeTile(ctx, {
    code: "D08",
    type: "diagram",
    status,
    metrics,
    judgment: { ruleId: "D08-zoning@1", basisMetricIds: ["fill_zoning_pct"], sentence, level: null, criteria: null },
    sources: zoning.sources,
    layers: ["zoning_site", ...CLASSES.flatMap((name) => [`zone:${name}`, `zone_center:${name}`])],
    map,
    polygons: polys,
    limitations,
  });
}
