import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { validate } from "./validate-planned-rail-registry.mjs";

const DEFAULT_REGISTRY_PATH = resolve("data/rail/planned-registry.json");
const DEFAULT_PUBLIC_PATH = resolve("public/data/rail/planned.json");
const SEGMENT_GEOMETRIES = new Map([
  [
    "seoul-line-9-phase-4-segment-1",
    {
      coordinates: [
        [127.1501853, 37.5326446],
        [127.1504601, 37.5333571],
        [127.1522267, 37.5376326],
        [127.1526385, 37.5385997],
        [127.1533114, 37.5401675],
        [127.1545195, 37.5432549],
        [127.1556152, 37.5454893],
        [127.1558605, 37.5464123],
        [127.1559719, 37.5487445],
        [127.1564127, 37.5552005],
        [127.1566737, 37.5613473],
        [127.156841, 37.5618887],
        [127.1571488, 37.5622808],
        [127.1576073, 37.5625682],
        [127.1580665, 37.5627752],
        [127.1585607, 37.5629167],
        [127.1592123, 37.5630054],
        [127.1622599, 37.5628635],
        [127.1644376, 37.5627009],
        [127.1673781, 37.5624993],
        [127.1693147, 37.5622842],
      ],
      geometrySourceLabel: "OpenStreetMap 공사 선형 보조",
      sourceType: "approximation",
      confidenceLabel: "medium",
    },
  ],
]);

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof Error) throw new Error(`${label} is not valid JSON: ${error.message}`);
    throw new Error(`${label} is not valid JSON`);
  }
}

function parseArgs(args) {
  const paths = { registry: DEFAULT_REGISTRY_PATH, publicData: DEFAULT_PUBLIC_PATH };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--registry" || argument === "--public" || argument === "--public-data") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a file path`);
      index += 1;
      if (argument === "--registry") paths.registry = resolve(value);
      else paths.publicData = resolve(value);
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  return paths;
}

function projectPublishedCandidate(candidate) {
  const segment = candidate.segments[0];
  const segmentGeometry = SEGMENT_GEOMETRIES.get(segment.segmentId);
  if (!segmentGeometry) throw new Error(`published segment is missing public geometry: ${segment.segmentId}`);
  const geometryEvidence = candidate.geometryEvidence[0];
  return {
    projectId: candidate.projectId,
    lineName: `${candidate.lineName} (개략)`,
    lifecycleStatus: candidate.lifecycleStatus,
    statusEvidence: candidate.statusEvidence,
    geometryEvidence: candidate.geometryEvidence,
    reviewStatus: candidate.reviewStatus,
    nextReviewAt: candidate.nextReviewAt,
    segments: candidate.segments,
    geometry: { type: "LineString", coordinates: segmentGeometry.coordinates },
    stations: [],
    sourceUrl: candidate.sourceUrl,
    geometrySourceUrl: geometryEvidence?.url,
    geometrySourceLabel: segmentGeometry.geometrySourceLabel,
    sourceType: segmentGeometry.sourceType,
    confidenceLabel: segmentGeometry.confidenceLabel,
    lastVerifiedAt: geometryEvidence?.retrievedAt,
  };
}

function main() {
  const paths = parseArgs(process.argv.slice(2));
  const registry = readJson(paths.registry, "registry");
  const publicData = registry.candidates
    .filter((candidate) => candidate.collectionStatus === "published")
    .map(projectPublishedCandidate);
  const result = validate(registry, publicData, paths);
  if (result.errors.length > 0) {
    console.error("planned-rail-public-data: generation failed");
    result.errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }
  const output = `${JSON.stringify(publicData, null, 2)}\n`;
  if (!existsSync(paths.publicData) || readFileSync(paths.publicData, "utf8") !== output) {
    writeFileSync(paths.publicData, output, "utf8");
  }
  console.log(`planned-rail-public-data: published=${result.counts.published} projects=${publicData.map((project) => project.projectId).join(",")}`);
}

try {
  main();
} catch (error) {
  if (error instanceof Error) console.error(`planned-rail-public-data: generation failed: ${error.message}`);
  else console.error("planned-rail-public-data: generation failed");
  process.exitCode = 1;
}
