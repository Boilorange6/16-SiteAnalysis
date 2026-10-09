import type { MapCandidate, PolygonCandidate } from "../../engine/tiles/common";
import type { ZoningCollection } from "../../engine/tiles/zoning-shared";

function sourceName(hit: ZoningCollection["hits"][number]): string | null {
  for (const value of [hit.properties.zoningName, hit.name]) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text !== "") return text;
  }
  return null;
}

function percentage(areaM2: number, circleArea: number): string {
  const value = Math.round((areaM2 / circleArea) * 1000) / 10;
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

/** 용도지역 면을 새 name/sublabel/priority 계약으로 변환한다. */
export function zoningPolygons(zoning: ZoningCollection): PolygonCandidate[] {
  const namesByFeatureId = new Map(zoning.hits.map((hit) => [hit.featureId, sourceName(hit)]));
  const siteFeatureIds = new Set(zoning.fine.map((hit) => hit.featureId));
  const groups = new Map<string, Array<{ index: number; polygon: PolygonCandidate; siteRelated: boolean }>>();

  zoning.polys.forEach((polygon, index) => {
    const name = namesByFeatureId.get(polygon.id) ?? null;
    if (name === null) return;
    const group = groups.get(name) ?? [];
    group.push({ index, polygon, siteRelated: siteFeatureIds.has(polygon.id) });
    groups.set(name, group);
  });

  const namedFragment = new Map<string, { index: number; priority: number }>();
  for (const [name, group] of groups) {
    const siteGroup = group.filter((item) => item.siteRelated);
    const candidates = siteGroup.length > 0 ? siteGroup : group;
    const selected = [...candidates].sort((a, b) => b.polygon.areaM2 - a.polygon.areaM2 || a.index - b.index)[0];
    if (selected) namedFragment.set(name, { index: selected.index, priority: selected.siteRelated ? 2 : 1 });
  }

  return zoning.polys
    .map((polygon, index) => {
      const name = namesByFeatureId.get(polygon.id) ?? null;
      const selected = name === null ? undefined : namedFragment.get(name);
      const named = selected?.index === index;
      const siteRelated = siteFeatureIds.has(polygon.id);
      return {
        ...polygon,
        p: {
          ...polygon.p,
          label: null,
          name: named ? name : null,
          sublabel: percentage(polygon.areaM2, zoning.circleArea),
          labelPriority: named ? selected?.priority ?? (siteRelated ? 2 : 1) : 0,
        },
      };
    })
    .sort((a, b) => b.areaM2 - a.areaM2 || a.id - b.id);
}

/** 대지 표식에는 세분 원천명만 싣고, 분류명 fallback은 만들지 않는다. */
export function zoningSiteName(zoning: ZoningCollection): string | null {
  const names = [...new Set(zoning.fine.map(sourceName).filter((name): name is string => name !== null))];
  return names.length > 0 ? names.join(", ") : null;
}

export function zoningSiteCandidate(zoning: ZoningCollection, lng: number, lat: number): MapCandidate | null {
  if (zoning.siteLabel === null) return null;
  return {
    id: 0,
    f: {
      layer: "zoning_site",
      lng,
      lat,
      highlight: true,
      label: null,
      name: zoningSiteName(zoning),
      sublabel: null,
      labelPriority: 2,
    },
  };
}
