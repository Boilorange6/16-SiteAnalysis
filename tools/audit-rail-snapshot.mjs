import { readFileSync } from "node:fs";
import Database from "better-sqlite3";

const { canonicalRailLineLabel, publicRailLine } = await import("../src/lib/v2/tile/rail-presentation.ts");
const { initDataFileSchema } = await import("../src/lib/v2/data/schema.ts");
const { insertRelease } = await import("../src/lib/v2/ingest/build.ts");
const { buildOsmSubway, legalCodeFromCore } = await import("../src/lib/v2/ingest/sources/rail.ts");

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const baselinePath = arg("--baseline");
const candidatePath = arg("--candidate");
const corePath = arg("--core");
if (!baselinePath || !candidatePath || !corePath) {
  console.error("usage: npx tsx tools/audit-rail-snapshot.mjs --baseline <old.json> --candidate <new.json> --core <core.sqlite>");
  process.exit(2);
}

const load = (path) => JSON.parse(readFileSync(path, "utf8"));
const baseline = load(baselinePath);
const candidate = load(candidatePath);
const lineKey = (line) => `${String(line.line_ref ?? "")}|${String(line.line_name ?? "")}`;
const publicLabelSet = (snapshot) => new Set(
  snapshot.lines
    .filter((line) => publicRailLine(line.line_ref ?? null, line.line_name ?? null))
    .map((line) => canonicalRailLineLabel(line.line_ref, line.line_name)),
);
const setDifference = (left, right) => [...left].filter((value) => !right.has(value)).sort((a, b) => a.localeCompare(b, "ko"));
const snapshotSummary = (snapshot) => ({
  stations: snapshot.stations.length,
  entrances: snapshot.entrances.length,
  lines: snapshot.lines.length,
  station_axes: snapshot.station_axes?.length ?? 0,
  raw_line_keys: new Set(snapshot.lines.map(lineKey)).size,
  public_line_labels: [...publicLabelSet(snapshot)].sort((a, b) => a.localeCompare(b, "ko")),
});

async function ingest(snapshot, core, label) {
  const db = new Database(":memory:");
  initDataFileSchema(db, "reference");
  const releaseId = insertRelease(db, {
    sourceId: "osm_subway",
    provider: "OSM",
    sourceUrl: "https://overpass-api.de/",
    sourceAsOf: snapshot.generated_at?.slice(0, 10) ?? null,
    fetchedAt: "2026-10-14T12:00:00Z",
    checksum: label,
    licenseCode: "ODbL-1.0",
  });
  const stats = await buildOsmSubway(db, snapshot, releaseId, legalCodeFromCore(core));
  const byRegion = Object.fromEntries(stats.map((stat) => [stat.sourceId, stat.byRegion]));
  const counts = Object.fromEntries(stats.map((stat) => [stat.sourceId, { read: stat.received, accepted: stat.accepted, rejected: stat.rejected }]));
  db.close();
  return { counts, byRegion };
}

const core = new Database(corePath, { readonly: true });
const baselineIngest = await ingest(baseline, core, "baseline");
const candidateIngest = await ingest(candidate, core, "candidate");
const baselineLabels = publicLabelSet(baseline);
const candidateLabels = publicLabelSet(candidate);
console.log(JSON.stringify({
  baseline: snapshotSummary(baseline),
  candidate: snapshotSummary(candidate),
  delta: {
    stations: candidate.stations.length - baseline.stations.length,
    entrances: candidate.entrances.length - baseline.entrances.length,
    lines: candidate.lines.length - baseline.lines.length,
    station_axes: (candidate.station_axes?.length ?? 0) - (baseline.station_axes?.length ?? 0),
  },
  normalizedPublicLineKeys: {
    baseline: baselineLabels.size,
    candidate: candidateLabels.size,
    lost: setDifference(baselineLabels, candidateLabels),
    added: setDifference(candidateLabels, baselineLabels),
  },
  ingest: { baseline: baselineIngest, candidate: candidateIngest },
}, null, 2));
core.close();
