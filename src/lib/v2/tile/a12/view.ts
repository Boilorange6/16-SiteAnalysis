import type { TileResult } from "../../tile-result";
import { layerStyle } from "../../ui/map-layers";
import { metricNumber, percentText, radiusLabel } from "../key-figure";
import type { KeyFigure, TileClientModule } from "../types";

const SPLIT_PREFIX = "세분: ";
const MAX_PARTS = 5;
const OTHER_COLOR = "#B9BDC6";

const ZONE_CLASSES = ["주거", "상업", "공업", "녹지", "관리", "농림", "자연환경보전"] as const;

/**
 * 세분 이름의 색. 지도가 그 이름의 면을 그린 레이어(`zone:<분류>`)가 있으면 그 스타일을 그대로 쓰고,
 * 면이 지도에 없으면(상한으로 잘림) 이름에서 분류를 읽어 같은 레이어 스타일을 쓴다.
 */
function zoneColor(name: string, polygons: TileResult["presentation"]["polygons"]): string {
  const layer = polygons?.find((polygon) => polygon.name === name && polygon.layer.startsWith("zone:"))?.layer;
  return layerStyle(layer ?? `zone:${ZONE_CLASSES.find((cls) => name.includes(cls)) ?? "기타"}`).color;
}

function a12KeyFigure(result: TileResult): KeyFigure | null {
  const siteFeature = result.presentation.features?.find((feature) => feature.layer === "zoning_site");
  const siteName = siteFeature?.name ?? siteFeature?.label;
  if (!siteName) return null;
  const siteNames = siteName.split(", ");
  const split = result.metrics
    .filter((metric) => metric.id.startsWith("share_raw_") && metric.label.startsWith(SPLIT_PREFIX) && metric.value !== null)
    .map((metric) => ({ label: metric.label.slice(SPLIT_PREFIX.length), share: metric.value as number }))
    .sort((a, b) => b.share - a.share);
  // 대지 항목은 작아도 남기고, 나머지 자리를 큰 순서로 채운다.
  const site = split.filter((part) => siteNames.includes(part.label));
  const kept = new Set([...site, ...split.filter((part) => !site.includes(part))].slice(0, MAX_PARTS));
  const rest = split.filter((part) => !kept.has(part)).reduce((sum, part) => sum + part.share, 0);
  const parts: NonNullable<KeyFigure["parts"]> = [
    ...split.filter((part) => kept.has(part)).map((part) => ({ ...part, color: zoneColor(part.label, result.presentation.polygons), ...(site.includes(part) ? { site: true } : {}) })),
    ...(rest > 0 ? [{ label: "그 밖", share: Math.round(rest * 10) / 10, color: OTHER_COLOR }] : []),
  ];
  const radius = radiusLabel(result.conditions.radiusM);
  const sameShare = site.length > 0 ? Math.round(site.reduce((sum, part) => sum + part.share, 0) * 10) / 10 : null;
  const residential = metricNumber(result, "share_class_1");
  const stats: KeyFigure["stats"] = [];
  if (sameShare !== null) stats.push({ value: percentText(sameShare), label: `반경 ${radius} 중 같은 용도지역` });
  if (residential !== null) stats.push({ value: percentText(residential), label: `반경 ${radius} 중 주거지역` });
  return { question: "대지 용도지역", answer: { value: siteName, kind: "name" }, stats, ...(parts.length > 0 ? { parts } : {}) };
}

export const a12ClientModule = {
  code: "A12",
  headline: { ids: ["share_class_1", "site_zoning_count"] },
  parameterBadges: [
    { metricId: "site_zoning_count", prefix: "중심점 지정", note: "대지 중심점이 들어간 용도지역 도형 수입니다. 지정의 적합성 판정이 아닙니다." },
  ],
  headlineFor: (result, helpers) => {
    const site = result.presentation.features?.find((feature) => feature.layer === "zoning_site");
    const zoning = site?.name ?? site?.label;
    const selected = zoning ? null : helpers.policyMetric();
    if (zoning) return { headline: { value: zoning, label: "대지 중심점 용도지역" }, metricId: "site_zoning_label" };
    if (!selected) return null;
    const row = helpers.metricRow(selected);
    return { headline: { value: row.value, label: row.label, aux: row.aux, tag: row.tag }, metricId: selected.id };
  },
  keyFigureFor: a12KeyFigure,
  layers: {
    // 기본 토지와 용도지역은 같은 지도 내용이므로 단일 선택지를 노출하지 않는다.
    options: [{ id: "all", label: "기본 토지" }],
  },
} satisfies TileClientModule;
