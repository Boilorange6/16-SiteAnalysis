import type { MaintenanceBoundaryFeature } from "./boundary-store";
import type {
  MaintenanceFieldProvenance,
  MaintenanceMergeRecord,
} from "./merge-contracts";

export type RecordGroup = {
  readonly records: readonly MaintenanceMergeRecord[];
  readonly ids: ReadonlySet<string>;
  readonly key: string;
  readonly nameKey: string;
};

export type CompatibilityReason = "admin_mismatch" | "area_mismatch" | "date_mismatch";

export type BoundaryMatch =
  | { readonly kind: "matched"; readonly groupIndex: number }
  | { readonly kind: "unmatched"; readonly reason?: CompatibilityReason | "ambiguous"; readonly attributeId?: string };

type CompatibilityFailure = {
  readonly reason: CompatibilityReason;
  readonly attributeId: string;
};

type BoundaryCandidates = {
  readonly compatibleGroupIndexes: readonly number[];
  readonly failure?: CompatibilityFailure;
};

type FieldSelection<T> = {
  readonly value?: T;
  readonly provenance?: MaintenanceFieldProvenance;
};

export type MergedRecordFields = {
  readonly primary: MaintenanceMergeRecord;
  readonly implementer: FieldSelection<string>;
  readonly plannedHouseholds: FieldSelection<number>;
  readonly floorAreaRatio: FieldSelection<number>;
  readonly buildingCoverageRatio: FieldSelection<number>;
  readonly designationDate: FieldSelection<string>;
  readonly landUseZone: FieldSelection<string>;
  readonly managementAgency: FieldSelection<string>;
  readonly contractor: FieldSelection<string>;
  readonly architect: FieldSelection<string>;
  readonly unionMembers: FieldSelection<number>;
  readonly area: FieldSelection<number>;
};

export function comparisonText(value: string): string {
  return value.normalize("NFKC").trim().replaceAll(/\s+/g, " ").replaceAll(/[^\p{L}\p{N}]/gu, "");
}

function nameText(value: string): string {
  return comparisonText(value).replace(/(?:정비구역|재개발구역|재건축구역)$/u, "");
}

function recordKey(record: MaintenanceMergeRecord): string {
  return `${comparisonText(record.sido)}|${comparisonText(record.sigungu)}|${nameText(record.name)}`;
}

function officialIds(record: MaintenanceMergeRecord): ReadonlySet<string> {
  const values = [record.source_record_id, ...(record.source === "seoul_open_data" || record.source === "busan_data_go_kr"
    ? record.official_ids ?? [] : [])];
  return new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean));
}

function overlaps(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

function calendarDate(value: string | undefined): string | undefined {
  const match = /^(\d{4})[-./]?(\d{2})[-./]?(\d{2})/.exec(value?.trim() ?? "");
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

function stale(record: Pick<MaintenanceMergeRecord, "designation_date" | "source_updated_at">): boolean {
  const designation = calendarDate(record.designation_date);
  const updated = calendarDate(record.source_updated_at);
  return designation !== undefined && updated !== undefined && updated < designation;
}

function pairCompatibility(
  left: Pick<MaintenanceMergeRecord, "sido" | "sigungu" | "area_sqm" | "designation_date" | "source_updated_at">,
  right: Pick<MaintenanceMergeRecord, "sido" | "sigungu" | "area_sqm" | "designation_date" | "source_updated_at">,
): CompatibilityReason | undefined {
  if (comparisonText(left.sido) !== comparisonText(right.sido)
    || comparisonText(left.sigungu) !== comparisonText(right.sigungu)) return "admin_mismatch";
  if (left.area_sqm !== undefined && right.area_sqm !== undefined) {
    const maximum = Math.max(Math.abs(left.area_sqm), Math.abs(right.area_sqm));
    if (maximum > 0 && Math.abs(left.area_sqm - right.area_sqm) / maximum > 0.05) return "area_mismatch";
  }
  const leftDate = calendarDate(left.designation_date);
  const rightDate = calendarDate(right.designation_date);
  if (stale(left) || stale(right) || (leftDate !== undefined && rightDate !== undefined && leftDate !== rightDate)) {
    return "date_mismatch";
  }
  return undefined;
}

export function groupMaintenanceRecords(records: readonly MaintenanceMergeRecord[]): readonly RecordGroup[] {
  const sourceKeyCounts = new Map<string, number>();
  for (const record of records) {
    const key = `${record.source}|${recordKey(record)}`;
    sourceKeyCounts.set(key, (sourceKeyCounts.get(key) ?? 0) + 1);
  }
  const groups: { records: MaintenanceMergeRecord[]; ids: Set<string>; key: string; nameKey: string }[] = [];
  for (const record of records) {
    const ids = officialIds(record);
    const key = recordKey(record);
    const uniqueWithinSource = sourceKeyCounts.get(`${record.source}|${key}`) === 1;
    const existing = groups.find((group) => {
      const exactId = overlaps(group.ids, ids);
      const uniqueName = uniqueWithinSource && group.key === key
        && group.records.every((candidate) => sourceKeyCounts.get(`${candidate.source}|${key}`) === 1);
      return (exactId || uniqueName)
        && group.records.every((candidate) => pairCompatibility(candidate, record) === undefined);
    });
    if (existing) {
      existing.records.push(record);
      for (const id of ids) existing.ids.add(id);
    } else {
      groups.push({ records: [record], ids: new Set(ids), key, nameKey: nameText(record.name) });
    }
  }
  return groups;
}

function boundaryIds(boundary: MaintenanceBoundaryFeature): ReadonlySet<string> {
  return new Set([boundary.properties.source_feature_id, ...boundary.properties.notice_ids]
    .map((value) => value.trim().toUpperCase()).filter(Boolean));
}

function boundaryCompatibility(group: RecordGroup, boundary: MaintenanceBoundaryFeature): CompatibilityFailure | undefined {
  const spatial = {
    sido: boundary.properties.sido ?? "", sigungu: boundary.properties.sigungu ?? "",
    area_sqm: boundary.properties.area_sqm, designation_date: boundary.properties.designation_date,
    source_updated_at: boundary.properties.source_updated_at,
  };
  for (const record of group.records) {
    const reason = pairCompatibility(record, spatial);
    if (reason) return { reason, attributeId: record.source_record_id };
  }
  return undefined;
}

function boundaryCandidates(
  boundary: MaintenanceBoundaryFeature,
  groups: readonly RecordGroup[],
): BoundaryCandidates {
  const ids = boundaryIds(boundary);
  const exact = groups.map((group, groupIndex) => ({ group, groupIndex })).filter(({ group }) => overlaps(group.ids, ids));
  const normalizedName = nameText(boundary.properties.name ?? "");
  const normalizedKey = `${comparisonText(boundary.properties.sido ?? "")}|${comparisonText(boundary.properties.sigungu ?? "")}|${normalizedName}`;
  const sameName = groups.map((group, groupIndex) => ({ group, groupIndex })).filter(({ group }) => group.nameKey === normalizedName);
  const sameAdmin = sameName.filter(({ group }) => group.key === normalizedKey);
  const structural = exact.length > 0 ? exact : sameAdmin;
  const compatibleGroupIndexes: number[] = [];
  let failure: CompatibilityFailure | undefined;
  for (const candidate of structural) {
    const candidateFailure = boundaryCompatibility(candidate.group, boundary);
    if (candidateFailure) {
      failure ??= candidateFailure;
    } else {
      compatibleGroupIndexes.push(candidate.groupIndex);
    }
  }
  if (structural.length === 0 && sameName.length > 0) {
    const record = sameName[0]?.group.records[0];
    if (record) failure = { reason: "admin_mismatch", attributeId: record.source_record_id };
  }
  return { compatibleGroupIndexes, ...(failure ? { failure } : {}) };
}

export function matchBoundaries(
  boundaries: readonly MaintenanceBoundaryFeature[],
  groups: readonly RecordGroup[],
): readonly BoundaryMatch[] {
  const candidates = boundaries.map((boundary) => boundaryCandidates(boundary, groups));
  const groupDegrees = new Map<number, number>();
  for (const candidate of candidates) {
    for (const groupIndex of candidate.compatibleGroupIndexes) {
      groupDegrees.set(groupIndex, (groupDegrees.get(groupIndex) ?? 0) + 1);
    }
  }
  return candidates.map((candidate) => {
    if (candidate.compatibleGroupIndexes.length > 1) return { kind: "unmatched", reason: "ambiguous" };
    const groupIndex = candidate.compatibleGroupIndexes[0];
    if (groupIndex === undefined) {
      return candidate.failure
        ? { kind: "unmatched", reason: candidate.failure.reason, attributeId: candidate.failure.attributeId }
        : { kind: "unmatched" };
    }
    if (groupDegrees.get(groupIndex) !== 1) return { kind: "unmatched", reason: "ambiguous" };
    return { kind: "matched", groupIndex };
  });
}

const SOURCE_PRIORITY = { molit_integrated: 0, public_standard: 1, busan_data_go_kr: 2, seoul_open_data: 2 } as const;

function selectField<T>(records: readonly MaintenanceMergeRecord[], read: (record: MaintenanceMergeRecord) => T | undefined): FieldSelection<T> {
  const selected = records.toSorted((left, right) => SOURCE_PRIORITY[right.source] - SOURCE_PRIORITY[left.source])
    .find((record) => read(record) !== undefined);
  if (!selected) return {};
  const value = read(selected);
  if (value === undefined) return {};
  return { value, provenance: {
    source: selected.source, source_record_id: selected.source_record_id,
    ...(selected.source_updated_at ? { source_updated_at: selected.source_updated_at } : {}),
  } };
}

export function mergeRecordFields(group: RecordGroup): MergedRecordFields {
  const sorted = group.records.toSorted((left, right) => SOURCE_PRIORITY[right.source] - SOURCE_PRIORITY[left.source]);
  const primary = sorted[0] ?? group.records[0];
  if (!primary) throw new Error("Maintenance record group cannot be empty");
  return {
    primary,
    implementer: selectField(sorted, ({ implementer }) => implementer),
    plannedHouseholds: selectField(sorted, ({ planned_households }) => planned_households),
    floorAreaRatio: selectField(sorted, ({ floor_area_ratio }) => floor_area_ratio),
    buildingCoverageRatio: selectField(sorted, ({ building_coverage_ratio }) => building_coverage_ratio),
    designationDate: selectField(sorted, ({ designation_date }) => designation_date),
    landUseZone: selectField(sorted, ({ land_use_zone }) => land_use_zone),
    managementAgency: selectField(sorted, ({ management_agency }) => management_agency),
    contractor: selectField(sorted, (record) => "contractor" in record ? record.contractor : undefined),
    architect: selectField(sorted, (record) => "architect" in record ? record.architect : undefined),
    unionMembers: selectField(sorted, (record) => "union_members" in record ? record.union_members : undefined),
    area: selectField(sorted, ({ area_sqm }) => area_sqm),
  };
}
