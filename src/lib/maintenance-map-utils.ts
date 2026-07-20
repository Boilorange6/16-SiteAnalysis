import type { MaintenanceBoundary } from "./types";

export function boundaryToLeafletLatLngs(
  boundary: MaintenanceBoundary,
): [number, number][][] | [number, number][][][] {
  switch (boundary.type) {
    case "Polygon":
      return boundary.coordinates.map((ring) => ring.map(([lng, lat]): [number, number] => [lat, lng]));
    case "MultiPolygon":
      return boundary.coordinates.map((polygon) =>
        polygon.map((ring) => ring.map(([lng, lat]): [number, number] => [lat, lng]))
      );
    default: {
      const unexpectedBoundary: never = boundary;
      throw new Error(`Unsupported maintenance boundary: ${unexpectedBoundary}`);
    }
  }
}
