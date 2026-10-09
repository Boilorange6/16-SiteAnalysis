import type { TileClientModule } from "../types";

const filterTransitLayers = (layerId: string, layer: string): boolean => layerId === "transit" ? layer.startsWith("rail_") : layerId === "bus" ? layer.startsWith("bus_") : true;

export const a01ClientModule = {
  code: "A01",
  headline: { ids: ["nearest_rail_m", "nearest_bus_m"] },
  mapNotesFor: (result) => result.metrics.some((metric) => metric.id === "nearest_rail_m" && metric.status === "missing")
    ? ["철도 자료를 확인하지 못해 버스정류장만 표시"]
    : [],
  layers: {
    options: [{ id: "all", label: "전체" }, { id: "transit", label: "철도" }, { id: "bus", label: "버스" }],
    filter: (model, layerId) => {
      if (!model || layerId === "all") return model;
      if (layerId !== "transit" && layerId !== "bus") return undefined;
      const matches = (layer: string) => filterTransitLayers(layerId, layer);
      const features = model.features.filter((feature) => matches(feature.layer));
      const polygons = (model.polygons ?? []).filter((polygon) => matches(polygon.layer));
      const lines = (model.lines ?? []).filter((line) => matches(line.layer));
      return {
        ...model,
        features,
        total: features.length,
        ...(model.polygons ? { polygons, polygonsTotal: polygons.length } : {}),
        ...(model.lines ? { lines, linesTotal: lines.length } : {}),
      };
    },
  },
} satisfies TileClientModule;
