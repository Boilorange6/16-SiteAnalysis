export type SourceCheck = {
  status: "ok" | "mismatch" | "unknown";
  missingFromCatalog: string[];
  unusedInCatalog: string[];
};

export const CONDITIONAL_SOURCE_IDS: ReadonlySet<string> = new Set([
  "ngii_topo",
  "gis_bldg",
  "building_juso",
  "browser_lbm",
  "fallback_d2q9",
]);

export function compareTileSources(declared: readonly string[], actual: readonly string[] | null): SourceCheck {
  if (actual === null) return { status: "unknown", missingFromCatalog: [], unusedInCatalog: [] };
  const actualSet = new Set(actual);
  const declaredSet = new Set(declared);
  const missingFromCatalog = [...actualSet].filter((sourceId) => !declaredSet.has(sourceId));
  const unusedInCatalog = [...declaredSet].filter((sourceId) => !actualSet.has(sourceId) && !CONDITIONAL_SOURCE_IDS.has(sourceId));
  return {
    status: missingFromCatalog.length === 0 && unusedInCatalog.length === 0 ? "ok" : "mismatch",
    missingFromCatalog,
    unusedInCatalog,
  };
}

function dateFor(value: string): Date | null {
  let date: Date;
  if (/^\d{4}$/.test(value)) {
    date = new Date(Date.UTC(Number(value), 11, 31));
  } else if (/^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split("-").map(Number);
    if (month < 1 || month > 12) return null;
    date = new Date(Date.UTC(year, month, 0));
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  } else {
    return null;
  }
  return Number.isNaN(date.getTime()) ? null : date;
}

export function ageDays(asOf: string | null, today: string): number | null {
  if (!asOf) return null;
  const from = dateFor(asOf);
  const to = dateFor(today);
  if (!from || !to) return null;
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}
