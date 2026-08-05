import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_REGISTRY_PATH = resolve("data/rail/planned-registry.json");
const DEFAULT_PUBLIC_PATH = resolve("public/data/rail/planned.json");
const LIFECYCLE_STATUSES = new Set(["under_construction", "approved", "proposed", "design"]);
const COLLECTION_STATUSES = new Set(["published", "withheld", "deferred"]);
const COLLECTION_PRIORITIES = new Set(["high", "normal", "deferred"]);
const GEOMETRY_STATES = new Set(["resolved", "withheld", "deferred"]);
const REVIEW_STATUSES = new Set(["reviewed", "pending", "deferred"]);
const SEGMENT_LIFECYCLES = new Set(["operating", "under_construction", "planned", "proposed"]);
const OPERATING_OVERLAPS = new Set(["none", "partial", "full"]);
const EVIDENCE_FIELDS = ["url", "publisher", "retrievedAt", "pageOrSection", "crs", "extractionMethod"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function validateHttpUrl(value, label, errors) {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${label} must be a non-empty URL`);
    return;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") errors.push(`${label} must use http or https`);
  } catch {
    errors.push(`${label} is not a valid URL`);
  }
}

function validatePublicCoordinate(value, label, errors) {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))) {
    errors.push(`${label} must be a [longitude, latitude] coordinate`);
    return;
  }
  const [lng, lat] = value;
  if (lng < -180 || lng > 180) errors.push(`${label} has longitude outside [-180, 180]`);
  if (lat < -90 || lat > 90) errors.push(`${label} has latitude outside [-90, 90]`);
}

function validatePublicGeometry(value, label, errors) {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  const coordinateLines = value.type === "LineString"
    ? [value.coordinates]
    : value.type === "MultiLineString"
      ? value.coordinates
      : null;
  if (!coordinateLines || !Array.isArray(coordinateLines) || coordinateLines.length === 0) {
    errors.push(`${label} must be a LineString or MultiLineString with at least one line`);
    return;
  }
  coordinateLines.forEach((line, lineIndex) => {
    if (!Array.isArray(line) || line.length < 2) {
      errors.push(`${label}${value.type === "MultiLineString" ? `[${lineIndex}]` : ""} must contain at least two coordinates`);
      return;
    }
    line.forEach((coordinate, coordinateIndex) => {
      const coordinateLabel = value.type === "MultiLineString"
        ? `${label}[${lineIndex}][${coordinateIndex}]`
        : `${label}[${coordinateIndex}]`;
      validatePublicCoordinate(coordinate, coordinateLabel, errors);
    });
  });
}

function validatePublicProjection(project, index, errors) {
  const label = `public[${index}]`;
  if (typeof project.lineName !== "string" || project.lineName.length === 0) errors.push(`${label}.lineName must be a non-empty string`);
  if (!Array.isArray(project.stations)) errors.push(`${label}.stations must be an array`);
  else if (project.stations.length !== 0) errors.push(`${label}.stations must be empty to preserve operational station isolation`);
  if (Object.hasOwn(project, "routes")) errors.push(`${label}.routes is not allowed; planned data must not contain operational routes`);
  validatePublicGeometry(project.geometry, `${label}.geometry.coordinates`, errors);
  validateHttpUrl(project.sourceUrl, `${label}.sourceUrl`, errors);
  if (project.geometrySourceUrl !== undefined) validateHttpUrl(project.geometrySourceUrl, `${label}.geometrySourceUrl`, errors);
}

function validateEvidence(value, label, allowEmpty, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return;
  }
  if (!allowEmpty && value.length === 0) errors.push(`${label} must contain evidence`);
  value.forEach((evidence, index) => {
    const evidenceLabel = `${label}[${index}]`;
    if (!isRecord(evidence)) {
      errors.push(`${evidenceLabel} must be an object`);
      return;
    }
    EVIDENCE_FIELDS.forEach((field) => {
      if (typeof evidence[field] !== "string" || evidence[field].length === 0) errors.push(`${evidenceLabel} is missing ${field}`);
    });
    if (typeof evidence.url === "string") {
      try {
        const url = new URL(evidence.url);
        if (url.protocol !== "http:" && url.protocol !== "https:") errors.push(`${evidenceLabel}.url must use http or https`);
      } catch {
        errors.push(`${evidenceLabel}.url is not a valid URL`);
      }
    }
    if (evidence.retrievedAt !== undefined && !isDate(evidence.retrievedAt)) errors.push(`${evidenceLabel}.retrievedAt must be an ISO date`);
    if (evidence.publishedAt !== undefined && !isDate(evidence.publishedAt)) errors.push(`${evidenceLabel}.publishedAt must be an ISO date`);
    if (evidence.sha256 !== undefined && (typeof evidence.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(evidence.sha256))) {
      errors.push(`${evidenceLabel}.sha256 must be a 64-character hexadecimal digest`);
    }
  });
}

function validateSegments(value, label, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${label} must contain at least one segment`);
    return;
  }
  const segmentIds = new Set();
  value.forEach((segment, index) => {
    const segmentLabel = `${label}[${index}]`;
    if (!isRecord(segment)) {
      errors.push(`${segmentLabel} must be an object`);
      return;
    }
    if (typeof segment.segmentId !== "string" || segment.segmentId.length === 0) errors.push(`${segmentLabel} is missing segmentId`);
    if (typeof segment.segmentId === "string" && segmentIds.has(segment.segmentId)) errors.push(`duplicate segmentId: ${segment.segmentId}`);
    if (typeof segment.segmentId === "string") segmentIds.add(segment.segmentId);
    if (!SEGMENT_LIFECYCLES.has(segment.lifecycle)) errors.push(`${segmentLabel} has an invalid lifecycle`);
    if (!OPERATING_OVERLAPS.has(segment.operatingOverlap)) errors.push(`${segmentLabel} has an invalid operatingOverlap`);
    if (segment.operatingOverlap === "full" && segment.lifecycle !== "operating") errors.push(`${segmentLabel} has operating overlap but is not lifecycle=operating`);
    if (segment.lifecycle === "operating" && segment.operatingOverlap === "none") errors.push(`${segmentLabel} operating lifecycle must declare overlap`);
  });
}

function readJson(path, label) {
  const raw = readFileSync(path, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`${label} is not valid JSON: ${error.message}`);
    }
    throw new Error(`${label} is not valid JSON`);
  }
}

function parseArgs(args) {
  const paths = { registry: DEFAULT_REGISTRY_PATH, publicData: DEFAULT_PUBLIC_PATH };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") {
      return { ...paths, help: true };
    }
    if (argument === "--registry" || argument === "--public" || argument === "--public-data") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a file path`);
      }
      index += 1;
      if (argument === "--registry") paths.registry = resolve(value);
      else paths.publicData = resolve(value);
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  return { ...paths, help: false };
}

export function validate(registry, publicData, paths) {
  const errors = [];
  const candidates = isRecord(registry) && Array.isArray(registry.candidates) ? registry.candidates : null;
  if (!candidates) {
    return { errors: ["canonical registry must contain a candidates array"], counts: null };
  }

  const projectIds = new Set();
  const stableIds = new Set();
  const candidatesById = new Map();
  const validCandidates = [];

  candidates.forEach((candidate, index) => {
    if (!isRecord(candidate)) {
      errors.push(`candidate[${index}] must be an object`);
      return;
    }
    const projectId = typeof candidate.projectId === "string" && candidate.projectId.length > 0 ? candidate.projectId : null;
    const stableId = typeof candidate.stableId === "string" && candidate.stableId.length > 0 ? candidate.stableId : null;
    if (!projectId) errors.push(`candidate[${index}] is missing a stable projectId`);
    if (!stableId) errors.push(`candidate[${index}] is missing stableId`);
    if (projectId && projectIds.has(projectId)) errors.push(`duplicate ID: ${projectId}`);
    if (stableId && stableIds.has(stableId)) errors.push(`duplicate stableId: ${stableId}`);
    if (projectId) projectIds.add(projectId);
    if (stableId) stableIds.add(stableId);
    if (projectId && stableId && projectId !== stableId) errors.push(`stale stable ID: ${projectId} does not match ${stableId}`);

    const lifecycleStatus = candidate.lifecycleStatus;
    const collectionStatus = candidate.collectionStatus;
    const collectionPriority = candidate.collectionPriority;
    if (!LIFECYCLE_STATUSES.has(lifecycleStatus)) errors.push(`invalid lifecycleStatus for ${projectId || `candidate[${index}]`}`);
    if (!COLLECTION_STATUSES.has(collectionStatus)) errors.push(`invalid collectionStatus for ${projectId || `candidate[${index}]`}`);
    if (!COLLECTION_PRIORITIES.has(collectionPriority)) errors.push(`invalid collectionPriority for ${projectId || `candidate[${index}]`}`);
    if (collectionStatus === "deferred" && lifecycleStatus !== "proposed") errors.push(`only proposed records may be deferred: ${projectId || `candidate[${index}]`}`);
    if (lifecycleStatus === "proposed" && collectionStatus !== "deferred") errors.push(`proposed record is not deferred: ${projectId || `candidate[${index}]`}`);
    if (collectionStatus === "deferred" && (typeof candidate.deferReason !== "string" || candidate.deferReason.length === 0)) {
      errors.push(`deferred record is missing deferReason: ${projectId || `candidate[${index}]`}`);
    }
    if (collectionStatus !== "deferred" && candidate.deferReason !== null) {
      errors.push(`active or published record must have deferReason=null: ${projectId || `candidate[${index}]`}`);
    }

    const candidateLabel = projectId || `candidate[${index}]`;
    validateEvidence(candidate.statusEvidence, `statusEvidence for ${candidateLabel}`, false, errors);
    validateEvidence(candidate.geometryEvidence, `geometryEvidence for ${candidateLabel}`, true, errors);
    if (!GEOMETRY_STATES.has(candidate.geometryState)) errors.push(`invalid geometryState for ${candidateLabel}`);
    if (!REVIEW_STATUSES.has(candidate.reviewStatus)) errors.push(`invalid reviewStatus for ${candidateLabel}`);
    if (!isDate(candidate.nextReviewAt)) errors.push(`invalid nextReviewAt for ${candidateLabel}`);
    validateSegments(candidate.segments, `segments for ${candidateLabel}`, errors);
    if (collectionStatus === "published" && candidate.geometryState !== "resolved") errors.push(`published record must have resolved geometry: ${candidateLabel}`);
    if (collectionStatus === "withheld" && candidate.geometryState !== "withheld") errors.push(`withheld record must have withheld geometry: ${candidateLabel}`);
    if (collectionStatus === "deferred" && candidate.geometryState !== "deferred") errors.push(`deferred record must have deferred geometry: ${candidateLabel}`);
    if (candidate.geometryState === "resolved" && (!Array.isArray(candidate.geometryEvidence) || candidate.geometryEvidence.length === 0)) {
      errors.push(`resolved geometry is missing geometryEvidence: ${candidateLabel}`);
    }
    if (candidate.geometryState !== "resolved" && Array.isArray(candidate.geometryEvidence) && candidate.geometryEvidence.length > 0) {
      errors.push(`unresolved geometry must not contain resolved geometryEvidence: ${candidateLabel}`);
    }
    if (lifecycleStatus !== "proposed" && collectionStatus !== "published" && collectionStatus !== "withheld") {
      errors.push(`active candidate must have a terminal collectionStatus: ${candidateLabel}`);
    }

    if (projectId) {
      candidatesById.set(projectId, candidate);
      validCandidates.push(candidate);
    }
  });

  const lifecycleCounts = {
    underConstruction: validCandidates.filter((candidate) => candidate.lifecycleStatus === "under_construction").length,
    approved: validCandidates.filter((candidate) => candidate.lifecycleStatus === "approved").length,
    proposed: validCandidates.filter((candidate) => candidate.lifecycleStatus === "proposed").length,
  };
  const activeCandidates = validCandidates.filter((candidate) => candidate.lifecycleStatus !== "proposed");
  const deferredCandidates = validCandidates.filter((candidate) => candidate.collectionStatus === "deferred");
  const publishedCandidates = validCandidates.filter((candidate) => candidate.collectionStatus === "published");
  if (candidates.length !== 44) errors.push(`stale registry state: total=${candidates.length}, expected 44`);
  if (lifecycleCounts.underConstruction !== 18) errors.push(`stale registry state: under_construction=${lifecycleCounts.underConstruction}, expected 18`);
  if (lifecycleCounts.approved !== 19) errors.push(`stale registry state: approved=${lifecycleCounts.approved}, expected 19`);
  if (lifecycleCounts.proposed !== 7) errors.push(`stale registry state: proposed=${lifecycleCounts.proposed}, expected 7`);
  if (activeCandidates.length !== 37) errors.push(`stale registry state: active=${activeCandidates.length}, expected 37`);
  if (deferredCandidates.length !== 7) errors.push(`stale registry state: deferred=${deferredCandidates.length}, expected 7`);
  if (publishedCandidates.length !== 1) errors.push(`stale registry state: published=${publishedCandidates.length}, expected 1`);
  if (publishedCandidates.some((candidate) => candidate.lifecycleStatus === "proposed")) errors.push("proposed published record is not allowed");
  if (!publishedCandidates.some((candidate) => candidate.projectId === "seoul-line-9-phase-4")) errors.push("seoul-line-9-phase-4 must be published");

  if (!Array.isArray(publicData)) {
    errors.push("public planned data must be an array");
  } else {
    const publicIds = new Set();
    publicData.forEach((project, index) => {
      if (!isRecord(project)) {
        errors.push(`public[${index}] must be an object`);
        return;
      }
      const projectId = typeof project.projectId === "string" && project.projectId.length > 0 ? project.projectId : null;
      if (!projectId) {
        errors.push(`public[${index}] is missing projectId`);
        return;
      }
      if (publicIds.has(projectId)) errors.push(`duplicate public ID: ${projectId}`);
      publicIds.add(projectId);
      const candidate = candidatesById.get(projectId);
      if (!candidate) {
        errors.push(`unregistered public ID: ${projectId}`);
        return;
      }
      if (candidate.collectionStatus !== "published") errors.push(`stale registry/public state: ${projectId} is public but registry status is ${candidate.collectionStatus}`);
      if (project.lifecycleStatus !== candidate.lifecycleStatus) errors.push(`stale registry/public state: ${projectId} lifecycle differs between registry and public data`);
      if (project.lifecycleStatus === "proposed") errors.push(`proposed published record is not allowed: ${projectId}`);
      validatePublicProjection(project, index, errors);
    });
    publishedCandidates.forEach((candidate) => {
      if (!publicIds.has(candidate.projectId)) errors.push(`stale registry/public state: published ID is missing from public data: ${candidate.projectId}`);
    });
    publicIds.forEach((projectId) => {
      if (!publishedCandidates.some((candidate) => candidate.projectId === projectId) && candidatesById.has(projectId)) {
        errors.push(`stale registry/public state: public ID is not in the published registry projection: ${projectId}`);
      }
    });
  }

  const legacyPublicRegistryPath = join(dirname(paths.publicData), "planned-candidates.json");
  if (existsSync(legacyPublicRegistryPath)) errors.push("stale registry/public state: planned-candidates.json remains public");

  return {
    errors,
    counts: {
      total: candidates.length,
      active: activeCandidates.length,
      deferred: deferredCandidates.length,
      published: publishedCandidates.length,
    },
  };
}

function main() {
  const paths = parseArgs(process.argv.slice(2));
  if (paths.help) {
    console.log("Usage: node src/scripts/validate-planned-rail-registry.mjs [--registry PATH] [--public PATH]");
    return;
  }
  const registry = readJson(paths.registry, "registry");
  const publicData = readJson(paths.publicData, "public planned data");
  const result = validate(registry, publicData, paths);
  if (result.errors.length > 0) {
    console.error("planned-rail-registry: validation failed");
    result.errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }
  console.log(`planned-rail-registry: total=${result.counts.total} active=${result.counts.active} deferred=${result.counts.deferred} published=${result.counts.published}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    if (error instanceof Error) console.error(`planned-rail-registry: validation failed: ${error.message}`);
    else console.error("planned-rail-registry: validation failed");
    process.exitCode = 1;
  }
}
