import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MaintenanceDataValidationError,
  validateArtifactDocuments,
  validateClientSource,
} from "./maintenance-data-validation.mjs";

function parseArguments(argv) {
  const options = {
    rootDirectory: process.cwd(),
    artifactDirectory: "data/maintenance/processed",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--root" && argv[index + 1]) options.rootDirectory = argv[index += 1];
    if (value === "--artifact-directory" && argv[index + 1]) options.artifactDirectory = argv[index += 1];
  }
  return options;
}

async function readJson(path, label) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (cause) {
    throw new MaintenanceDataValidationError("MISSING_ARTIFACT", `${label} is missing: ${path}`, { cause });
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new MaintenanceDataValidationError("MALFORMED_ARTIFACT", `${label} is not valid JSON: ${path}`, { cause });
  }
}

async function listFiles(directory) {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return nested.flat();
}

function gitOutput(rootDirectory, args) {
  return execFileSync("git", ["-C", rootDirectory, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function assertIgnored(rootDirectory, path) {
  try {
    execFileSync("git", ["-C", rootDirectory, "check-ignore", "--quiet", path], { stdio: "ignore" });
  } catch {
    throw new MaintenanceDataValidationError("UNIGNORED_DATA_PATH", `${path} must be ignored by Git`);
  }
}

export function isPublicMaintenanceArtifact(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/").toLowerCase();
  const deployableExtension = /\.(?:geojson|shp|shx|dbf|prj|cpg|zip|json)$/;
  const filename = normalized.split("/").at(-1) ?? normalized;
  return normalized.includes("data/maintenance/")
    || (deployableExtension.test(filename)
      && (
        /(?:boundaries|maintenance)/.test(filename)
        || /^lsmd_cont_ud(?:501|602)(?:[_.-]|$)/.test(filename)
      ));
}

async function validatePublicDirectory(rootDirectory) {
  const publicDirectory = join(rootDirectory, "public");
  const files = await listFiles(publicDirectory);
  const artifact = files.find((path) => isPublicMaintenanceArtifact(relative(publicDirectory, path)));
  if (artifact) {
    throw new MaintenanceDataValidationError("PUBLIC_ARTIFACT", `Maintenance artifact must not exist under public/: ${relative(rootDirectory, artifact)}`);
  }
}

async function validateClientSources(rootDirectory) {
  const secretValues = [process.env.DATA_GO_KR_API_KEY, process.env.SEOUL_OPEN_API_KEY].filter(Boolean);
  const sourceRoots = [
    join(rootDirectory, "src/components"),
    join(rootDirectory, "src/app"),
    join(rootDirectory, "src/lib"),
    join(rootDirectory, "src/providers"),
  ];
  for (const sourceRoot of sourceRoots) {
    for (const path of await listFiles(sourceRoot)) {
      if (![".js", ".jsx", ".mjs", ".ts", ".tsx"].includes(extname(path))) continue;
      const normalized = path.replaceAll("\\", "/");
      if (normalized.includes("/src/app/api/") || normalized.includes("/src/lib/server/")) continue;
      const source = await readFile(path, "utf8");
      const issue = validateClientSource(source, relative(rootDirectory, path), secretValues);
      if (issue) throw issue;
    }
  }
}

export async function validateMaintenanceRelease(request) {
  const rootDirectory = resolve(request.rootDirectory);
  const artifactDirectory = resolve(rootDirectory, request.artifactDirectory);
  const [geojson, metadata, quarantine] = await Promise.all([
    readJson(join(artifactDirectory, "boundaries.geojson"), "Boundary GeoJSON"),
    readJson(join(artifactDirectory, "boundaries.meta.json"), "Boundary metadata"),
    readJson(join(artifactDirectory, "boundaries.quarantine.json"), "Boundary quarantine report"),
  ]);
  const summary = validateArtifactDocuments({ geojson, metadata, quarantine });
  await validatePublicDirectory(rootDirectory);
  assertIgnored(rootDirectory, "data/maintenance/raw/.validation-probe");
  assertIgnored(rootDirectory, "data/maintenance/processed/.validation-probe");
  const tracked = gitOutput(rootDirectory, ["ls-files", "--", "data/maintenance"]).trim();
  if (tracked) throw new MaintenanceDataValidationError("TRACKED_DATA", "data/maintenance must not contain tracked files");
  await validateClientSources(rootDirectory);
  return summary;
}

async function main() {
  const summary = await validateMaintenanceRelease(parseArguments(process.argv.slice(2)));
  console.log(`Maintenance data validation passed: ${summary.outputCount} features, ${summary.quarantineCount} quarantined`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code = error instanceof MaintenanceDataValidationError ? error.code : "UNEXPECTED_ERROR";
    console.error(`Maintenance data validation failed [${code}]: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
