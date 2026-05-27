import type { Poi } from "./types";

export interface PoiClusterInput {
  readonly poi: Poi;
  readonly x: number;
  readonly y: number;
}

export interface PoiCluster {
  readonly items: readonly Poi[];
  readonly lat: number;
  readonly lng: number;
}

const DEFAULT_CLUSTER_RADIUS_PX = 42;

export function clusterPois(
  points: readonly PoiClusterInput[],
  radiusPx = DEFAULT_CLUSTER_RADIUS_PX
): PoiCluster[] {
  const clusters: Array<{
    items: Poi[];
    lat: number;
    lng: number;
    x: number;
    y: number;
  }> = [];

  const radiusSq = radiusPx * radiusPx;

  points.forEach((point) => {
    const cluster = clusters.find((candidate) => {
      const dx = candidate.x - point.x;
      const dy = candidate.y - point.y;
      return dx * dx + dy * dy <= radiusSq;
    });

    if (!cluster) {
      clusters.push({
        items: [point.poi],
        lat: point.poi.lat,
        lng: point.poi.lng,
        x: point.x,
        y: point.y,
      });
      return;
    }

    const nextCount = cluster.items.length + 1;
    cluster.items.push(point.poi);
    cluster.lat = (cluster.lat * (nextCount - 1) + point.poi.lat) / nextCount;
    cluster.lng = (cluster.lng * (nextCount - 1) + point.poi.lng) / nextCount;
    cluster.x = (cluster.x * (nextCount - 1) + point.x) / nextCount;
    cluster.y = (cluster.y * (nextCount - 1) + point.y) / nextCount;
  });

  return clusters.map(({ items, lat, lng }) => ({ items, lat, lng }));
}
