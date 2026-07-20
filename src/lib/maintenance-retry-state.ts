import type { MaintenanceCatalogProject, MaintenanceProject, Poi, RegionData, SourceStatus } from "./types";

export interface MaintenanceRetryResult {
  readonly pois: readonly Poi[];
  readonly status: SourceStatus;
  readonly allSources?: readonly SourceStatus[];
  readonly maintenanceCatalog: readonly MaintenanceCatalogProject[];
}

export function applyMaintenanceRetryResult(
  regionData: RegionData,
  retry: MaintenanceRetryResult,
): RegionData {
  const sourceStatuses = [
    ...regionData.sourceStatuses.filter(({ source }) => {
      switch (source) {
        case "maintenance":
        case "maintenance_attributes":
        case "maintenance_boundaries":
        case "maintenance_seoul":
        case "maintenance_busan":
          return false;
        case "osm":
        case "park":
        case "residential":
        case "planned-residential":
        case "subway-routes":
        case "rail-network":
          return true;
      }
    }),
    ...(retry.allSources ?? [retry.status]),
  ];

  return {
    ...regionData,
    maintenanceProjects: retry.pois.filter((poi): poi is MaintenanceProject => poi.category === "maintenance"),
    maintenanceCatalog: retry.maintenanceCatalog,
    sourceStatuses,
  };
}
