import type {
  MaintenanceCatalogProject,
  MaintenanceProject,
  MaintenanceSource,
} from "../../types";
import type { MaintenanceBoundaryFeature } from "./boundary-store";
import type { MaintenanceAttributeRecord } from "./national-provider-normalization";

export type RegionalMaintenanceRecord = Omit<MaintenanceAttributeRecord, "source"> & {
  readonly source: "seoul_open_data" | "busan_data_go_kr";
  readonly official_ids?: readonly string[];
  readonly address?: string;
  readonly notice_code?: string;
  readonly notice_url?: string;
  readonly contractor?: string;
  readonly architect?: string;
  readonly union_members?: number;
};

export type MaintenanceMergeRecord = MaintenanceAttributeRecord | RegionalMaintenanceRecord;

export interface SelectedMaintenanceRegion {
  readonly sido: string;
  readonly sigungu: string;
}

export interface MaintenanceFieldProvenance {
  readonly source: MaintenanceSource;
  readonly source_record_id: string;
  readonly source_updated_at?: string;
}

export type MaintenanceMergeDiagnostic = {
  readonly attribute_id?: string;
  readonly boundary_id?: string;
  readonly reason:
    | "ambiguous"
    | "admin_mismatch"
    | "area_mismatch"
    | "date_mismatch"
    | "unnamed_boundary";
};

export interface MergedMaintenanceResult {
  readonly projects: readonly MaintenanceProject[];
  readonly catalog: readonly MaintenanceCatalogProject[];
  readonly internalProjects: readonly {
    readonly project: MaintenanceProject;
    readonly field_provenance: Readonly<Record<string, MaintenanceFieldProvenance>>;
  }[];
  readonly diagnostics: readonly MaintenanceMergeDiagnostic[];
}

export interface MaintenanceMergeInput {
  readonly attributes: readonly MaintenanceAttributeRecord[];
  readonly boundaries: readonly MaintenanceBoundaryFeature[];
  readonly regional: readonly RegionalMaintenanceRecord[];
  readonly selectedRegions: readonly SelectedMaintenanceRegion[];
}
