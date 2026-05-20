import type { Poi, PoiCategory } from "./types";

export interface ProjectedPoi {
  readonly poi: Poi;
  readonly x: number;
  readonly y: number;
}

export interface PoiCluster {
  readonly lat: number;
  readonly lng: number;
  readonly x: number;
  readonly y: number;
  readonly items: readonly Poi[];
  readonly category: PoiCategory | "mixed";
}

interface MutablePoiCluster {
  items: Poi[];
  x: number;
  y: number;
  lat: number;
  lng: number;
  categoryCounts: Record<PoiCategory, number>;
}

export const DEFAULT_CLUSTER_DISTANCE_PX = 42;

function createCategoryCounts(): Record<PoiCategory, number> {
  return {
    subway: 0,
    school: 0,
    park: 0,
    mountain: 0,
    apartment: 0,
    officetel: 0,
    residential: 0,
    maintenance: 0,
  };
}

function getClusterCategory(categoryCounts: Record<PoiCategory, number>): PoiCategory | "mixed" {
  const activeCategories = (Object.entries(categoryCounts) as [PoiCategory, number][])
    .filter(([, count]) => count > 0)
    .map(([category]) => category);

  return activeCategories.length === 1 ? activeCategories[0] : "mixed";
}

export function clusterPois(
  projectedPois: readonly ProjectedPoi[],
  distancePx = DEFAULT_CLUSTER_DISTANCE_PX
): readonly PoiCluster[] {
  const sortedPois = [...projectedPois]
    .filter(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))
    .sort((left, right) => left.y - right.y || left.x - right.x);

  const clusters: MutablePoiCluster[] = [];
  const maxDistanceSquared = distancePx * distancePx;

  sortedPois.forEach(({ poi, x, y }) => {
    let nearestClusterIndex = -1;
    let nearestDistanceSquared = Number.POSITIVE_INFINITY;

    clusters.forEach((cluster, index) => {
      const dx = cluster.x - x;
      const dy = cluster.y - y;
      const distanceSquared = dx * dx + dy * dy;

      if (distanceSquared <= maxDistanceSquared && distanceSquared < nearestDistanceSquared) {
        nearestClusterIndex = index;
        nearestDistanceSquared = distanceSquared;
      }
    });

    if (nearestClusterIndex === -1) {
      const categoryCounts = createCategoryCounts();
      categoryCounts[poi.category] = 1;
      clusters.push({
        items: [poi],
        x,
        y,
        lat: poi.lat,
        lng: poi.lng,
        categoryCounts,
      });
      return;
    }

    const clusterToUpdate = clusters[nearestClusterIndex];
    const nextCount = clusterToUpdate.items.length + 1;
    clusterToUpdate.items = [...clusterToUpdate.items, poi];
    clusterToUpdate.x = (clusterToUpdate.x * (nextCount - 1) + x) / nextCount;
    clusterToUpdate.y = (clusterToUpdate.y * (nextCount - 1) + y) / nextCount;
    clusterToUpdate.lat = (clusterToUpdate.lat * (nextCount - 1) + poi.lat) / nextCount;
    clusterToUpdate.lng = (clusterToUpdate.lng * (nextCount - 1) + poi.lng) / nextCount;
    clusterToUpdate.categoryCounts[poi.category] += 1;
  });

  return clusters.map((cluster) => ({
    lat: cluster.lat,
    lng: cluster.lng,
    x: cluster.x,
    y: cluster.y,
    items: cluster.items,
    category: getClusterCategory(cluster.categoryCounts),
  }));
}
