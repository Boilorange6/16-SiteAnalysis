/**
 * A12 토지·용도지역 — 대지 중심점이 든 용도지역 도형과, 반경 안 용도지역 구성비(D08 분류·원천 세분).
 * 세분 없이 “도시지역”만 지정된 우산 도형(umbrella)은 구성비에서 뺀다(아래 세분 지정과 겹친다).
 * 겹치는 지정은 합치지 않아 구성비 합이 100%를 넘을 수 있고, 그럴 때 그렇다고 적는다. 개별공시지가는 아직 적재하지 않는다.
 */
import { booleanPointInPolygon } from "@turf/turf";
import { toUtmk } from "../../crs";
import type { TileResult } from "../../tile-result";
import type { EngineContext, Limitation } from "../context";
import { candidate, makeTile, missing, obs, polygonCandidate, type MapCandidate, type PolygonCandidate, type TileDraft } from "./common";
import { clipToCircle, polygonArea, polygonParts } from "./geo";
import { notProvided } from "./not-provided";

const LAYERS = ["zoning_urban", "zoning_management", "zoning_agri_forest", "zoning_nature", "zoning_other"];
export const CLASSES = ["주거", "상업", "공업", "녹지", "관리", "농림", "자연환경보전", "기타"] as const;
const RAW_TOP = 6;
const r1 = (n: number) => Math.round(n * 10) / 10;

export function a12(ctx: EngineContext): TileResult {
  const sources = ctx.sources("reference", LAYERS);
  if (sources.length === 0) return notProvided(ctx, "A12");
  const { center, radiusM } = ctx.input;

  const hits = ctx.hits("reference", ["zoning_area"]);
  const isUmbrella = (h: (typeof hits)[number]) => h.properties.umbrella === true;
  const cls = (h: (typeof hits)[number]) => (CLASSES as readonly string[]).includes(String(h.properties.zoningClass)) ? String(h.properties.zoningClass) : "기타";
  const nameOf = (h: (typeof hits)[number]) => (typeof h.properties.zoningName === "string" && h.properties.zoningName !== "" ? h.properties.zoningName : h.name ?? "이름 없음");

  // 대지: 중심점이 든 도형 (세분 지정이 있으면 그것만, 없으면 우산 도형)
  const xy = toUtmk(center);
  const containing = ctx.hits("reference", ["zoning_area"], 1).filter((h) => booleanPointInPolygon(xy as [number, number], { type: "Feature", properties: {}, geometry: h.geometry } as never));
  const fine = containing.filter((h) => !isUmbrella(h));
  const siteNames = [...new Set(fine.map(nameOf))];
  const siteLabel = siteNames.length ? siteNames.join(", ") : containing.length ? "도시지역(세분 미확인)" : null;

  // 반경 안 구성비
  const circleArea = Math.PI * radiusM * radiusM;
  const byClass = new Map<string, number>();
  const byRaw = new Map<string, number>();
  const polys: PolygonCandidate[] = [];
  const points: MapCandidate[] = [];
  let clipFailed = 0;
  const umbrellas = hits.filter(isUmbrella).length;
  for (const h of hits.filter((x) => !isUmbrella(x))) {
    const parts = clipToCircle(center, radiusM, h.geometry);
    if (parts === null) { clipFailed++; continue; }
    const a = parts.reduce((s, p) => s + polygonArea(p), 0);
    if (a <= 0) continue;
    byClass.set(cls(h), (byClass.get(cls(h)) ?? 0) + a);
    byRaw.set(nameOf(h), (byRaw.get(nameOf(h)) ?? 0) + a);
    for (const rings of parts) {
      const c = polygonCandidate(h.featureId, `zone:${cls(h)}`, rings, polygonArea(rings), nameOf(h));
      if (c) polys.push(c);
    }
    points.push(candidate({ ...h, geometry: { type: "MultiPolygon", coordinates: parts } }, `zone_center:${cls(h)}`));
  }
  const total = [...byClass.values()].reduce((s, a) => s + a, 0);
  const pct = (a: number) => r1((a / circleArea) * 100);
  const classes = CLASSES.filter((c) => byClass.has(c)).map((c) => [c, byClass.get(c)!] as const);
  const raws = [...byRaw].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, RAW_TOP);
  const overlap = total > circleArea * 1.005;

  const metrics: TileDraft["metrics"] = [
    obs("site_zoning_count", "대지 중심점의 용도지역 지정 수(세분 기준)", fine.length, "건", "a12-site@1:중심점이 든 도형, 우산 도형 제외"),
    ...classes.map(([c, a], i) => obs(`share_class_${i + 1}`, `구성비: ${c}`, pct(a), "%", "a12-share-class@1:교차면적÷반경 원 면적(분류: D08)", Math.round(a), Math.round(circleArea))),
    ...raws.map(([n, a], i) => obs(`share_raw_${i + 1}`, `세분: ${n}`, pct(a), "%", "a12-share-raw@1:교차면적÷반경 원 면적(원천 세분)", Math.round(a), Math.round(circleArea))),
    obs("share_sum", "구성비 합", pct(total), "%", "a12-share-sum@1:100% 초과는 겹친 지정", Math.round(total), Math.round(circleArea)),
    missing("land_price", "대상 필지 개별공시지가", "원/㎡", "a12-land-price@0:공시지가 자료 미적재"),
  ];

  const top = classes.length ? [...classes].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, a]) => `${c} ${pct(a)}%`).join("·") : null;
  const sentence =
    siteLabel === null
      ? `대지 중심점의 용도지역 지정을 도면에서 확인하지 못함${top ? `, 반경 안 구성은 ${top}` : ""} → 도면 밖이거나 미지정일 수 있음 → 토지이용계획확인서로 확인 필요`
      : `대지 중심점은 ${siteLabel}${siteNames.length > 1 ? "(복수 지정)" : ""}${top ? `, 반경 안 구성은 ${top}` : ""} → 지정 현황이며 지구·건축 허용 여부나 지가 수준은 아님 → 공시지가와 개별 규제는 토지이용계획확인서로 확인 필요`;

  // 대지 표지: 중심점에 용도지역명을 붙인 강조점 (대지 요약이 이 라벨을 읽는다)
  const map: MapCandidate[] = [...points];
  if (siteLabel) map.push({ id: 0, f: { layer: "zoning_site", lng: center[0], lat: center[1], highlight: true, label: siteLabel } });

  const missingLayers = LAYERS.filter((l) => !sources.some((s) => s.sourceId === l));
  const limitations: Limitation[] = [
    { kind: "not_provided", note: "개별공시지가는 적재되지 않아 표시하지 않습니다." },
    { kind: "unknown", note: `구성비의 분모는 반경 원 면적입니다(수면·도면 밖·미지정 구간 포함). 지구·지구단위계획은 포함하지 않습니다.` },
    ...(overlap ? [{ kind: "estimated" as const, note: `겹치는 지정 도형이 있어 구성비 합이 ${pct(total)}%로 100%를 넘을 수 있습니다(겹친 면적은 각각 셈).` }] : []),
    ...(umbrella(umbrellas)),
    ...(fine.length > 1 ? [{ kind: "unknown" as const, note: "대지 중심점에 복수의 용도지역 지정이 있어 모두 표시했습니다. 어느 것이 적용되는지 확인이 필요합니다." }] : []),
    ...(clipFailed > 0 ? [{ kind: "partial" as const, note: `도형 오류로 반경 절단이 안 된 ${clipFailed}건은 구성비에서 빠졌습니다.` }] : []),
    ...(missingLayers.length > 0 ? [{ kind: "incomplete" as const, note: `용도지역 레이어 ${missingLayers.length}종(${missingLayers.join(", ")})이 적재되지 않았습니다.` }] : []),
    ...ctx.coverage("reference", LAYERS),
  ];

  return makeTile(ctx, {
    code: "A12",
    status: "partial",
    metrics,
    judgment: { ruleId: "a12-zoning@1", basisMetricIds: ["site_zoning_count"], sentence, level: null, criteria: null },
    sources,
    layers: ["zoning_site", ...CLASSES.flatMap((c) => [`zone:${c}`, `zone_center:${c}`])],
    map,
    polygons: polys,
    limitations,
  });
}

const umbrella = (n: number): Limitation[] => (n > 0 ? [{ kind: "suppressed", note: `세분 없이 “도시지역”으로만 지정된 도형 ${n}건은 다른 지정과 겹쳐 구성비에서 제외했습니다.` }] : []);
