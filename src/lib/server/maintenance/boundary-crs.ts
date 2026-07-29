export type SupportedCrs = "EPSG:5186" | "EPSG:2097" | "EPSG:5174";

export const PROJ4_DEFINITIONS = {
  "EPSG:5186": "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs",
  "EPSG:2097": "+proj=tmerc +lat_0=38 +lon_0=127.002890277778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +towgs84=-146.43,507.89,681.46 +units=m +no_defs",
  "EPSG:5174": "+proj=tmerc +lat_0=38 +lon_0=127.002890277778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +towgs84=-146.43,507.89,681.46 +units=m +no_defs",
} as const satisfies Readonly<Record<SupportedCrs, string>>;

export class UnsupportedCrsError extends Error {
  readonly name = "UnsupportedCrsError";
  constructor() {
    super("Unsupported CRS: only verified EPSG:5186, EPSG:2097, and EPSG:5174 definitions are accepted");
  }
}

type CrsDefinition = {
  readonly crs: SupportedCrs;
  readonly titleSignatures: readonly string[];
  readonly datumSignatures: readonly string[];
  readonly spheroidSignatures: readonly string[];
  readonly semiMajor: number;
  readonly inverseFlattening: number;
  readonly centralMeridian: number;
  readonly falseNorthing: number;
};

const DEFINITIONS: readonly CrsDefinition[] = [
  {
    crs: "EPSG:5186",
    titleSignatures: ["KGD2002 CENTRAL BELT 2010", "KOREA 2000 CENTRAL BELT 2010"],
    datumSignatures: ["KOREAN GEODETIC DATUM 2002", "KOREA 2000", "GEOCENTRIC DATUM OF KOREA"],
    spheroidSignatures: ["GRS 1980", "GRS80"],
    semiMajor: 6378137,
    inverseFlattening: 298.257222101,
    centralMeridian: 127,
    falseNorthing: 600000,
  },
  {
    crs: "EPSG:2097",
    titleSignatures: ["KOREAN 1985 CENTRAL BELT", "KOREA 1985 CENTRAL BELT"],
    datumSignatures: ["KOREAN DATUM 1985", "KOREAN 1985", "KOREA 1985"],
    spheroidSignatures: ["BESSEL 1841", "BESSEL"],
    semiMajor: 6377397.155,
    inverseFlattening: 299.1528128,
    centralMeridian: 127.002890277778,
    falseNorthing: 500000,
  },
  {
    crs: "EPSG:5174",
    titleSignatures: ["KOREAN 1985 / MODIFIED CENTRAL BELT"],
    datumSignatures: ["KOREAN DATUM 1985", "KOREAN 1985", "KOREA 1985"],
    spheroidSignatures: ["BESSEL 1841", "BESSEL"],
    semiMajor: 6377397.155,
    inverseFlattening: 299.1528128,
    centralMeridian: 127.002890277778,
    falseNorthing: 500000,
  },
] as const;

function numericParameter(wkt: string, names: readonly string[]): number | null {
  for (const name of names) {
    const match = wkt.match(new RegExp(`PARAMETER\\s*\\[\\s*"${name}"\\s*,\\s*([-+0-9.eE]+)`));
    if (match?.[1]) return Number(match[1]);
  }
  return null;
}

function closeTo(actual: number | null, expected: number, tolerance: number): boolean {
  return actual !== null && Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
}

function hasMetreProjectedUnit(wkt: string): boolean {
  const matches = [...wkt.matchAll(/(?:^|[^A-Z])(LENGTHUNIT|UNIT)\s*\[\s*"([^"]+)"\s*,\s*([-+0-9.eE]+)/g)];
  const projected = matches.at(-1);
  const name = projected?.[2] ?? "";
  return (name === "METRE" || name === "METER") && closeTo(Number(projected?.[3]), 1, 0.000000001);
}

function matchesDefinition(wkt: string, definition: CrsDefinition): boolean {
  const authority = wkt.includes(`AUTHORITY["EPSG","${definition.crs.slice(5)}"]`)
    || wkt.includes(`ID["EPSG",${definition.crs.slice(5)}]`);
  const titled = definition.titleSignatures.some((signature) => wkt.includes(signature));
  const datum = wkt.match(/DATUM\s*\[\s*"([^"]+)"/)?.[1] ?? "";
  const spheroid = wkt.match(/(?:SPHEROID|ELLIPSOID)\s*\[\s*"([^"]+)"\s*,\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)/);
  if ((!authority && !titled) || !wkt.includes("TRANSVERSE MERCATOR") || !definition.datumSignatures.some((value) => datum.includes(value))) return false;
  if (!spheroid || !definition.spheroidSignatures.some((value) => spheroid[1]?.includes(value))) return false;
  return hasMetreProjectedUnit(wkt)
    && closeTo(Number(spheroid[2]), definition.semiMajor, 0.001)
    && closeTo(Number(spheroid[3]), definition.inverseFlattening, 0.0000001)
    && closeTo(numericParameter(wkt, ["LATITUDE OF ORIGIN", "LATITUDE OF NATURAL ORIGIN"]), 38, 0.0000001)
    && closeTo(numericParameter(wkt, ["CENTRAL MERIDIAN", "LONGITUDE OF NATURAL ORIGIN"]), definition.centralMeridian, 0.0000001)
    && closeTo(numericParameter(wkt, ["SCALE FACTOR", "SCALE FACTOR AT NATURAL ORIGIN"]), 1, 0.000000001)
    && closeTo(numericParameter(wkt, ["FALSE EASTING"]), 200000, 0.001)
    && closeTo(numericParameter(wkt, ["FALSE NORTHING"]), definition.falseNorthing, 0.001);
}

export function identifySupportedCrs(input: string): SupportedCrs {
  const normalized = input.trim().toUpperCase().replaceAll("_", " ").replaceAll(/\s+/g, " ");
  if (/^EPSG\s*:\s*5186$/.test(normalized)) return "EPSG:5186";
  if (/^EPSG\s*:\s*2097$/.test(normalized)) return "EPSG:2097";
  if (/^EPSG\s*:\s*5174$/.test(normalized)) return "EPSG:5174";
  const definition = DEFINITIONS.find((candidate) => matchesDefinition(normalized, candidate));
  if (definition) return definition.crs;
  throw new UnsupportedCrsError();
}
