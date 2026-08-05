import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const { loadRailNetworkSnapshot, queryRailNetwork, toSubwayStations } = await import("../lib/server/rail-network-store.ts");

const readJson = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
const currentPublicPlanned = readJson("public/data/rail/planned.json");
assert.ok(!existsSync(resolve("public/data/rail/planned-candidates.json")), "candidate registry must not remain public");

const canonicalRegistryPath = resolve("data/rail/planned-registry.json");
assert.ok(existsSync(canonicalRegistryPath), "desired contract requires a non-public canonical registry");
const canonicalRegistry = readJson(canonicalRegistryPath);
const candidates = canonicalRegistry.candidates;
const stableIds = candidates.map((candidate) => candidate.stableId);
const publishedCandidates = candidates.filter((candidate) => candidate.collectionStatus === "published");
const deferredCandidates = candidates.filter((candidate) => candidate.collectionStatus === "deferred");
const activeCandidates = candidates.filter((candidate) => candidate.lifecycleStatus !== "proposed");
const withheldCandidates = activeCandidates.filter((candidate) => candidate.collectionStatus === "withheld");
assert.equal(candidates.length, 44, "canonical registry should contain exactly 44 candidates");
assert.equal(new Set(stableIds).size, 44, "canonical stable IDs should be unique");
assert.ok(candidates.every((candidate) => candidate.stableId === candidate.projectId), "stableId should remain aligned with projectId");
assert.equal(candidates.filter((candidate) => candidate.lifecycleStatus === "under_construction").length, 18);
assert.equal(candidates.filter((candidate) => candidate.lifecycleStatus === "approved").length, 19);
assert.equal(activeCandidates.length, 37, "under-construction and approved candidates should be active");
assert.equal(deferredCandidates.length, 7, "proposed candidates should be deferred");
assert.equal(publishedCandidates.length, 1, "exactly one candidate should be published");
assert.equal(publishedCandidates[0].stableId, "seoul-line-9-phase-4");
assert.ok(deferredCandidates.every((candidate) => candidate.lifecycleStatus === "proposed" && candidate.deferReason), "deferred records should be proposed with a reason");
assert.ok(activeCandidates.every((candidate) => candidate.collectionStatus === "withheld" || candidate.collectionStatus === "published"), "active records should have a terminal collection status");
assert.ok(activeCandidates.every((candidate) => candidate.reviewStatus === "reviewed"), "active records should have terminal review decisions");
assert.ok(withheldCandidates.every((candidate) => typeof candidate.withholdingReason === "string" && candidate.withholdingReason.length > 0), "withheld records should explain why geometry is not published");
assert.equal(currentPublicPlanned.length, 1, "public planned data should contain only the registered published record");
assert.deepEqual(
  currentPublicPlanned.map((project) => project.projectId),
  publishedCandidates.map((candidate) => candidate.projectId),
  "public planned IDs should equal the canonical published IDs",
);
assert.equal(currentPublicPlanned[0].projectId, "seoul-line-9-phase-4");
assert.equal(currentPublicPlanned[0].lifecycleStatus, "under_construction");

const generatorPath = resolve("src/scripts/build-planned-rail-public-data.mjs");
const validatorPath = resolve("src/scripts/validate-planned-rail-registry.mjs");
const publicPlannedPath = resolve("public/data/rail/planned.json");
const plannedBeforeMalformedProjection = readFileSync(publicPlannedPath, "utf8");
const tempDirectory = mkdtempSync(join(tmpdir(), "planned-rail-projection-"));

try {
  const generatedPublicPath = join(tempDirectory, "generated-planned.json");
  const generatedProjection = spawnSync(process.execPath, [generatorPath, "--registry", canonicalRegistryPath, "--public", generatedPublicPath], {
    cwd: resolve(),
    encoding: "utf8",
  });

  assert.equal(generatedProjection.status, 0, "generator must build the published Line 9 projection");
  const generatedPublic = readJson(generatedPublicPath);
  assert.deepEqual(generatedPublic.map((project) => project.projectId), ["seoul-line-9-phase-4"]);
  const generatedLine9 = generatedPublic[0];
  assert.ok(generatedLine9, "generated Line 9 record must exist");
  assert.deepEqual(generatedLine9.statusEvidence, publishedCandidates[0].statusEvidence);
  assert.deepEqual(generatedLine9.geometryEvidence, publishedCandidates[0].geometryEvidence);
  assert.equal(generatedLine9.reviewStatus, publishedCandidates[0].reviewStatus);
  assert.equal(generatedLine9.nextReviewAt, publishedCandidates[0].nextReviewAt);
  assert.deepEqual(generatedLine9.segments, publishedCandidates[0].segments);
  const generatedSnapshot = loadRailNetworkSnapshot(resolve("public/data/osm-subway.json"), generatedPublicPath);
  const loadedLine9 = generatedSnapshot.plannedProjects.find((project) => project.projectId === "seoul-line-9-phase-4");
  assert.ok(loadedLine9, "loader must parse the generated Line 9 record");
  assert.deepEqual(loadedLine9.statusEvidence, publishedCandidates[0].statusEvidence);
  assert.deepEqual(loadedLine9.geometryEvidence, publishedCandidates[0].geometryEvidence);
  assert.equal(loadedLine9.reviewStatus, publishedCandidates[0].reviewStatus);
  assert.equal(loadedLine9.nextReviewAt, publishedCandidates[0].nextReviewAt);
  assert.deepEqual(loadedLine9.segments, publishedCandidates[0].segments);
  const generatedValidation = spawnSync(process.execPath, [validatorPath, "--registry", canonicalRegistryPath, "--public", generatedPublicPath], {
    cwd: resolve(),
    encoding: "utf8",
  });
  assert.equal(generatedValidation.status, 0, "generated projection must pass registry validation");

  const malformedRegistry = structuredClone(canonicalRegistry);
  const malformedLine9 = malformedRegistry.candidates.find((candidate) => candidate.projectId === "seoul-line-9-phase-4");
  assert.ok(malformedLine9, "fixture must contain the published Line 9 record");
  malformedLine9.geometryEvidence = [];
  malformedLine9.segments[0].operatingOverlap = "full";
  const malformedRegistryPath = join(tempDirectory, "malformed-registry.json");
  writeFileSync(malformedRegistryPath, `${JSON.stringify(malformedRegistry, null, 2)}\n`, "utf8");

  const malformedProjection = spawnSync(process.execPath, [generatorPath, "--registry", malformedRegistryPath, "--public", publicPlannedPath], {
    cwd: resolve(),
    encoding: "utf8",
  });

  assert.equal(malformedProjection.status, 1, "generator must reject incomplete evidence and invalid operating overlap");
  assert.match(malformedProjection.stderr, /resolved geometry is missing geometryEvidence: seoul-line-9-phase-4/);
  assert.match(malformedProjection.stderr, /has operating overlap but is not lifecycle=operating/);
  assert.equal(readFileSync(publicPlannedPath, "utf8"), plannedBeforeMalformedProjection, "invalid input must not modify the public projection");
} finally {
  rmSync(tempDirectory, { recursive: true, force: true });
}

const snapshot = loadRailNetworkSnapshot();
assert.equal(snapshot.snapshotVersion, "2026-05-26-osm-migration-v1");
assert.ok(snapshot.stations.length > 0, "snapshot should include stations");
assert.ok(snapshot.lines.length > 0, "snapshot should include lines");
assert.equal(snapshot.source.source, "rail-network");

const seoul = queryRailNetwork(snapshot, { lat: 37.5665, lng: 126.978, radiusM: 3000 });
assert.ok(seoul.stations.length > 0, "Seoul query should return stations");
assert.ok(seoul.stations.every((station) => Math.hypot(station.lat - 37.5665, station.lng - 126.978) < 0.1));
assert.ok(seoul.mapData.stations.length > 0, "map response should share the filtered station set");

const stations = toSubwayStations(seoul);
assert.ok(stations.every((station) => station.category === "subway"));
assert.ok(stations.every((station) => station.line !== "미확인"), "matched stations should retain line membership");
assert.ok(stations.some((station) => (station.lineNames?.length ?? 0) > 1), "transfer memberships should be preserved");

const gaepo = queryRailNetwork(snapshot, { lat: 37.481215, lng: 127.052733, radiusM: 3000 });
const wiryeGwacheon = gaepo.plannedProjects.find((project) => project.projectId === "wirye-gwacheon-gangnam-branch-approx-2025");
assert.equal(wiryeGwacheon, undefined, "proposed Wirye–Gwacheon geometry must remain outside the public planned surface");

const line9Extension = queryRailNetwork(snapshot, { lat: 37.5487, lng: 127.156, radiusM: 1000 }).plannedProjects
  .find((project) => project.projectId === "seoul-line-9-phase-4");
assert.ok(line9Extension, "Line 9 phase 4 construction alignment should be discoverable near the official construction corridor");
assert.equal(line9Extension.sourceType, "approximation");
assert.equal(line9Extension.confidenceLabel, "medium");
assert.equal(line9Extension.geometrySourceUrl, "https://www.openstreetmap.org/way/898334529");
assert.equal(line9Extension.stations.length, 0, "unconfirmed stations must not be represented as stations");

console.log("rail-network-store: all tests passed");
