import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import shapefile from "shapefile";

import {
  identifySupportedCrs,
  transformBoundaryFeature,
  validateArchiveMembers,
} from "../lib/server/maintenance/boundary-build.ts";
import { readAcquisitionMetadata } from "../lib/server/maintenance/boundary-acquisition.ts";
export { readAcquisitionMetadata } from "../lib/server/maintenance/boundary-acquisition.ts";
import { writeBoundaryArtifactsAtomically } from "../lib/server/maintenance/artifact-promotion.ts";
export { writeBoundaryArtifactsAtomically } from "../lib/server/maintenance/artifact-promotion.ts";

export function enforceOutputCountGate({ previousCount, nextCount, acceptLargeChange }) {
  if (previousCount === null) return false;
  const ratio = previousCount === 0 ? (nextCount === 0 ? 0 : Number.POSITIVE_INFINITY) : Math.abs(nextCount - previousCount) / previousCount;
  if (ratio > 0.2 && !acceptLargeChange) {
    throw new Error(`Output feature count changed by more than 20% (${previousCount} -> ${nextCount}); review and pass --accept-large-change`);
  }
  return ratio > 0.2 && acceptLargeChange;
}

function parseArguments(argv) {
  const options = { input: "data/maintenance/raw", output: "data/maintenance/processed", acceptLargeChange: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--accept-large-change") options.acceptLargeChange = true;
    if (value === "--input" && argv[index + 1]) options.input = argv[index += 1];
    if (value === "--output" && argv[index + 1]) options.output = argv[index += 1];
  }
  return options;
}

function isBoundaryFeature(value) {
  if (!value || typeof value !== "object" || !value.geometry || !value.properties) return false;
  return value.geometry.type === "Polygon" || value.geometry.type === "MultiPolygon";
}

async function previousOutputCount(outputDirectory) {
  try {
    const parsed = JSON.parse(await readFile(join(outputDirectory, "boundaries.meta.json"), "utf8"));
    return Number.isInteger(parsed.output_feature_count) && parsed.output_feature_count >= 0 ? parsed.output_feature_count : null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function mergeBbox(features) {
  if (features.length === 0) return [0, 0, 0, 0];
  return [
    Math.min(...features.map((feature) => feature.properties.bbox[0])),
    Math.min(...features.map((feature) => feature.properties.bbox[1])),
    Math.max(...features.map((feature) => feature.properties.bbox[2])),
    Math.max(...features.map((feature) => feature.properties.bbox[3])),
  ];
}

async function readArchive(archivePath) {
  const bytes = await readFile(archivePath);
  const archiveSha = createHash("sha256").update(bytes).digest("hex");
  const source = await readAcquisitionMetadata({ archivePath });
  const zip = await JSZip.loadAsync(bytes);
  const memberNames = Object.values(zip.files).filter((member) => !member.dir).map((member) => member.name);
  const layers = validateArchiveMembers(memberNames);
  const features = [];
  const quarantine = [];
  const crsCounts = {};
  let inputCount = 0;
  for (const layer of layers) {
    const prj = await zip.file(layer.prj)?.async("string");
    if (!prj) throw new Error(`Missing PRJ payload for ${layer.basename}`);
    const crs = identifySupportedCrs(prj);
    crsCounts[crs] = (crsCounts[crs] ?? 0) + 1;
    const shp = await zip.file(layer.shp)?.async("uint8array");
    const dbf = await zip.file(layer.dbf)?.async("uint8array");
    if (!shp || !dbf) throw new Error(`Missing SHP/DBF payload for ${layer.basename}`);
    const collection = await shapefile.read(shp, dbf, { encoding: "euc-kr" });
    for (const rawFeature of collection.features) {
      inputCount += 1;
      if (!isBoundaryFeature(rawFeature)) {
        quarantine.push({ archive: basename(archivePath), layer: layer.basename, reason: "unsupported_geometry", raw_properties: rawFeature?.properties ?? {} });
        continue;
      }
      const result = transformBoundaryFeature(rawFeature, crs, source);
      if (result.quarantine) quarantine.push({ archive: basename(archivePath), layer: layer.basename, ...result.quarantine });
      else features.push(result.feature);
    }
  }
  return { archiveSha, source, inputCount, features, quarantine, crsCounts };
}

export async function runBoundaryBuild({ inputDirectory, outputDirectory, acceptLargeChange, transformedAt = new Date().toISOString() }) {
  let entries;
  try {
    entries = await readdir(inputDirectory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("No authorized maintenance SHP archives found");
    }
    throw error;
  }
  const archives = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".zip")).map((entry) => join(inputDirectory, entry.name));
  if (archives.length === 0) throw new Error("No authorized maintenance SHP archives found");
  const results = [];
  for (const archive of archives) results.push(await readArchive(archive));
  const features = results.flatMap((result) => result.features);
  const quarantine = results.flatMap((result) => result.quarantine);
  const crsCounts = {};
  for (const result of results) for (const [crs, count] of Object.entries(result.crsCounts)) crsCounts[crs] = (crsCounts[crs] ?? 0) + count;
  const largeChangeAccepted = enforceOutputCountGate({
    previousCount: await previousOutputCount(outputDirectory),
    nextCount: features.length,
    acceptLargeChange,
  });
  const sourceDates = results.map((result) => result.source.sourceUpdatedAt).filter((value) => typeof value === "string").sort();
  const metadata = {
    schema_version: 1,
    input_sha256: archives.flatMap((archive, index) => [
      { file: basename(archive), sha256: results[index].archiveSha },
      { file: results[index].source.metadataFile, sha256: results[index].source.metadataSha256 },
    ]),
    input_feature_count: results.reduce((sum, result) => sum + result.inputCount, 0),
    output_feature_count: features.length,
    quarantined_feature_count: quarantine.length,
    crs_counts: crsCounts,
    bbox: mergeBbox(features),
    source_updated_at: sourceDates.at(-1) ?? null,
    transformed_at: transformedAt,
    large_change_accepted: largeChangeAccepted,
  };
  await writeBoundaryArtifactsAtomically({
    outputDirectory,
    geojson: { type: "FeatureCollection", features },
    metadata,
    quarantine,
  });
  return metadata;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const metadata = await runBoundaryBuild({
    inputDirectory: resolve(options.input),
    outputDirectory: resolve(options.output),
    acceptLargeChange: options.acceptLargeChange,
  });
  console.log(`Built ${metadata.output_feature_count} maintenance boundaries; quarantined ${metadata.quarantined_feature_count}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
