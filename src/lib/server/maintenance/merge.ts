import { multiPolygon, pointOnFeature, polygon } from "@turf/turf";

import type { MaintenanceCatalogProject, MaintenanceProject } from "../../types";
import type { MaintenanceBoundaryFeature } from "./boundary-store";
import type {
  MaintenanceFieldProvenance,
  MaintenanceMergeDiagnostic,
  MaintenanceMergeInput,
  MergedMaintenanceResult,
  SelectedMaintenanceRegion,
} from "./merge-contracts";
import {
  comparisonText,
  groupMaintenanceRecords,
  matchBoundary,
  mergeRecordFields,
  type MergedRecordFields,
  type RecordGroup,
} from "./merge-records";

export type {
  MaintenanceFieldProvenance,
  MaintenanceMergeDiagnostic,
  MaintenanceMergeInput,
  MergedMaintenanceResult,
  RegionalMaintenanceRecord,
  SelectedMaintenanceRegion,
} from "./merge-contracts";

function optional<T>(value: T | undefined, key: string): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

function representative(boundary: MaintenanceBoundaryFeature): readonly [number, number] {
  const spatialFeature = boundary.geometry.type === "Polygon"
    ? polygon(boundary.geometry.coordinates.map((ring) => ring.map(([lng, lat]) => [lng, lat])))
    : multiPolygon(boundary.geometry.coordinates.map((part) =>
      part.map((ring) => ring.map(([lng, lat]) => [lng, lat]))));
  const [lng, lat] = pointOnFeature(spatialFeature).geometry.coordinates;
  return [lat, lng];
}

function boundaryType(boundary: MaintenanceBoundaryFeature): string {
  switch (boundary.properties.source_layer) {
    case "UD602": return "정비구역";
    case "UD501": return "정비예정구역";
  }
}

function boundaryFields(boundary: MaintenanceBoundaryFeature): Pick<MaintenanceProject,
  "boundary" | "boundary_status" | "boundary_source_url" | "boundary_source_id"
  | "boundary_retrieved_at" | "boundary_original_crs"> {
  return {
    boundary: boundary.geometry,
    boundary_status: "confirmed",
    boundary_source_url: boundary.properties.source_url,
    boundary_source_id: boundary.properties.source_feature_id,
    boundary_retrieved_at: boundary.properties.retrieved_at,
    boundary_original_crs: boundary.properties.original_crs,
  };
}

function provenance(fields: MergedRecordFields): Readonly<Record<string, MaintenanceFieldProvenance>> {
  const result: Record<string, MaintenanceFieldProvenance> = {};
  const selections = {
    implementer: fields.implementer,
    planned_households: fields.plannedHouseholds,
    floor_area_ratio: fields.floorAreaRatio,
    building_coverage_ratio: fields.buildingCoverageRatio,
    designation_date: fields.designationDate,
    land_use_zone: fields.landUseZone,
    management_agency: fields.managementAgency,
    contractor: fields.contractor,
    architect: fields.architect,
    union_members: fields.unionMembers,
    area_sqm: fields.area,
  };
  for (const [key, selection] of Object.entries(selections)) {
    if (selection.provenance) result[key] = selection.provenance;
  }
  return result;
}

function matchedProject(group: RecordGroup, boundary: MaintenanceBoundaryFeature): {
  readonly project: MaintenanceProject;
  readonly field_provenance: Readonly<Record<string, MaintenanceFieldProvenance>>;
} {
  const fields = mergeRecordFields(group);
  const [lat, lng] = representative(boundary);
  const primary = fields.primary;
  const project: MaintenanceProject = {
    id: `maintenance-${boundary.properties.source_feature_id}`,
    name: primary.name, lat, lng, category: "maintenance", type: primary.type, stage: primary.stage,
    address: `${primary.sido} ${primary.sigungu}`.trim(),
    area_sqm: fields.area.value ?? boundary.properties.area_sqm ?? 0,
    source: primary.source,
    ...(primary.source_updated_at ? { source_updated_at: primary.source_updated_at } : {}),
    ...boundaryFields(boundary),
    ...optional(fields.implementer.value, "implementer"),
    ...optional(fields.plannedHouseholds.value, "planned_households"),
    ...optional(fields.floorAreaRatio.value, "floor_area_ratio"),
    ...optional(fields.buildingCoverageRatio.value, "building_coverage_ratio"),
    ...optional(fields.designationDate.value, "designation_date"),
    ...optional(fields.landUseZone.value, "land_use_zone"),
    ...optional(fields.managementAgency.value, "management_agency"),
    ...optional(fields.contractor.value, "contractor"),
    ...optional(fields.architect.value, "architect"),
    ...optional(fields.unionMembers.value, "union_members"),
  };
  return { project, field_provenance: provenance(fields) };
}

function unmatchedBoundary(boundary: MaintenanceBoundaryFeature): MaintenanceProject {
  const [lat, lng] = representative(boundary);
  return {
    id: `maintenance-spatial-${boundary.properties.source_feature_id}`,
    name: boundary.properties.name ?? "미확인", lat, lng, category: "maintenance",
    type: boundaryType(boundary), stage: "미확인",
    address: `${boundary.properties.sido ?? ""} ${boundary.properties.sigungu ?? ""}`.trim(),
    area_sqm: boundary.properties.area_sqm ?? 0,
    source: "molit_spatial",
    ...boundaryFields(boundary),
    boundary_status: "unmatched",
    ...(boundary.properties.source_updated_at ? { source_updated_at: boundary.properties.source_updated_at } : {}),
    ...(boundary.properties.designation_date ? { designation_date: boundary.properties.designation_date } : {}),
  };
}

function selected(group: RecordGroup, regions: readonly SelectedMaintenanceRegion[]): boolean {
  return group.records.some((record) => regions.some((region) =>
    comparisonText(region.sido) === comparisonText(record.sido)
    && comparisonText(region.sigungu) === comparisonText(record.sigungu)));
}

function catalogProject(group: RecordGroup): MaintenanceCatalogProject {
  const fields = mergeRecordFields(group);
  const primary = fields.primary;
  return {
    id: `maintenance-catalog-${primary.source}-${primary.source_record_id}`,
    name: primary.name, sido: primary.sido, sigungu: primary.sigungu,
    type: primary.type, stage: primary.stage, source: primary.source, spatial_status: "not_located",
    ...(primary.source_updated_at ? { source_updated_at: primary.source_updated_at } : {}),
    ...optional(fields.implementer.value, "implementer"),
    ...optional(fields.plannedHouseholds.value, "planned_households"),
    ...optional(fields.area.value, "area_sqm"),
    ...optional(fields.designationDate.value, "designation_date"),
    ...optional(fields.managementAgency.value, "management_agency"),
  };
}

export function mergeMaintenanceData(input: MaintenanceMergeInput): MergedMaintenanceResult {
  const groups = groupMaintenanceRecords([...input.attributes, ...input.regional]);
  const matchedGroups = new Set<number>();
  const projects: MaintenanceProject[] = [];
  const internalProjects: { project: MaintenanceProject; field_provenance: Readonly<Record<string, MaintenanceFieldProvenance>> }[] = [];
  const diagnostics: MaintenanceMergeDiagnostic[] = [];

  for (const boundary of input.boundaries) {
    if (!boundary.properties.name?.trim()) {
      diagnostics.push({ boundary_id: boundary.properties.source_feature_id, reason: "unnamed_boundary" });
      continue;
    }
    const match = matchBoundary(boundary, input.boundaries, groups);
    if (match.kind === "matched") {
      const group = groups[match.groupIndex];
      if (!group) continue;
      const merged = matchedProject(group, boundary);
      projects.push(merged.project);
      internalProjects.push(merged);
      matchedGroups.add(match.groupIndex);
      continue;
    }
    projects.push(unmatchedBoundary(boundary));
    if (match.reason) diagnostics.push({
      boundary_id: boundary.properties.source_feature_id,
      ...(match.attributeId ? { attribute_id: match.attributeId } : {}),
      reason: match.reason,
    });
  }

  const catalog = groups.flatMap((group, groupIndex) =>
    matchedGroups.has(groupIndex) || !selected(group, input.selectedRegions) ? [] : [catalogProject(group)]);
  return { projects, catalog, internalProjects, diagnostics };
}
