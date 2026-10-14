import assert from "node:assert/strict";
import { readFileSync, rmSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const { canonicalRailLineLabel, publicRailLine } = await import("../../lib/v2/tile/rail-presentation.ts");

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const fixturePath = join(here, "fixtures", "osm-subway-axis-elements.json");
const fixtureText = readFileSync(fixturePath, "utf8");
const elements = JSON.parse(fixtureText);
const cacheBoxes = ["capital-west", "capital-east", "south-west", "south-midwest", "south-mideast", "south-east"];
const station = { lat: 37.5, lng: 127.1 };
const nearStopIds = [7702001, 7702002];
const farStopIds = [7702003, 7702004];
const METERS_PER_LAT = 111_320;

function point(node) {
  return { lat: Number(node.lat), lng: Number(node.lon ?? node.lng) };
}

function distanceM(a, b) {
  const scale = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180) * METERS_PER_LAT;
  return Math.hypot((a.lng - b.lng) * scale, (a.lat - b.lat) * METERS_PER_LAT);
}

function segmentDistanceM(target, segment) {
  const [start, end] = segment;
  const scale = Math.cos(target.lat * Math.PI / 180) * METERS_PER_LAT;
  const sx = start.lng * scale;
  const sy = start.lat * METERS_PER_LAT;
  const ex = end.lng * scale;
  const ey = end.lat * METERS_PER_LAT;
  const px = target.lng * scale;
  const py = target.lat * METERS_PER_LAT;
  const dx = ex - sx;
  const dy = ey - sy;
  const denominator = dx * dx + dy * dy;
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / denominator));
  return Math.hypot(px - (sx + dx * t), py - (sy + dy * t));
}

function segmentOf(relation) {
  const member = relation.members.find((item) => item.type === "way");
  assert.ok(member?.geometry?.length >= 2, `relation/${relation.id} has a track geometry`);
  return member.geometry.map((item) => ({ lat: Number(item.lat), lng: Number(item.lon) }));
}

function undirectedAngleDeg(left, right) {
  const vector = (segment) => {
    const [start, end] = segment;
    const scale = Math.cos(((start.lat + end.lat) / 2) * Math.PI / 180) * METERS_PER_LAT;
    return { x: (end.lng - start.lng) * scale, y: (end.lat - start.lat) * METERS_PER_LAT };
  };
  const a = vector(left);
  const b = vector(right);
  const angle = Math.abs(Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x)) * 180 / Math.PI;
  const normalized = angle % 180;
  return Math.min(normalized, 180 - normalized);
}

function averagePoint(points) {
  return {
    lat: points.reduce((sum, item) => sum + item.lat, 0) / points.length,
    lng: points.reduce((sum, item) => sum + item.lng, 0) / points.length,
  };
}

const relationElements = elements.filter((element) => element.type === "relation");
const nodeById = new Map(elements.filter((element) => element.type === "node").map((element) => [element.id, element]));
const stopFor = (relation) => nodeById.get(relation.members.find((item) => item.type === "node")?.ref);
const relationSegments = relationElements.map(segmentOf);
const nearStops = nearStopIds.map((id) => point(nodeById.get(id)));
const farStops = farStopIds.map((id) => point(nodeById.get(id)));

assert.equal(relationElements.length, 4);
for (const relation of relationElements) {
  const lineName = relation.tags["name:ko"] ?? relation.tags.name;
  assert.equal(canonicalRailLineLabel(relation.tags.ref, lineName), "7호선", `relation/${relation.id} canonical label`);
  assert.equal(publicRailLine(relation.tags.ref, lineName), true, `relation/${relation.id} is public`);
  const stop = stopFor(relation);
  assert.equal(stop.tags.public_transport, "stop_position");
  assert.equal(stop.tags.name, "샘플역");
}

assert.ok(distanceM(station, nearStops[0]) >= 135 && distanceM(station, nearStops[0]) <= 145, "near track is about 140m from station node");
assert.ok(relationSegments.every((segment, index) => segmentDistanceM(point(nodeById.get(nearStopIds.concat(farStopIds)[index])), segment) < 0.01), "each stop_position is on its relation track");
assert.ok(distanceM(nearStops[0], nearStops[1]) < 30, "direction-specific near stops are within 30m");
assert.ok(undirectedAngleDeg(relationSegments[0], relationSegments[1]) < 15, "direction-specific near tracks are within 15 degrees");
assert.ok(distanceM(farStops[0], farStops[1]) < 30, "direction-specific far stops are within 30m");
assert.ok(undirectedAngleDeg(relationSegments[2], relationSegments[3]) < 15, "direction-specific far tracks are within 15 degrees");
assert.ok(distanceM(nearStops[0], farStops[0]) >= 30, "separate platform centers are at least 30m apart");

const cacheDir = mkdtempSync(join(tmpdir(), "v2-osm-subway-axis-"));
const outputPath = join(cacheDir, "snapshot.json");
try {
  for (const box of cacheBoxes) writeFileSync(join(cacheDir, `${box}.json`), fixtureText, "utf8");

  const runner = resolve(repoRoot, "node_modules/tsx/dist/cli.mjs");
  const generator = resolve(repoRoot, "src/scripts/v2/build-osm-subway-snapshot.mjs");
  const result = spawnSync(process.execPath, [
    runner,
    generator,
    "--cache-dir", cacheDir,
    "--output", outputPath,
    "--generated-at", "2026-10-14T00:00:00.000Z",
  ], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(result.status, 0, [
    `snapshot generator exited with ${result.status ?? "unknown"}`,
    result.stdout,
    result.stderr,
  ].filter(Boolean).join("\n"));

  const snapshot = JSON.parse(readFileSync(outputPath, "utf8"));
  const axes = snapshot.station_axes.filter((axis) => axis.station_name === "샘플역" && axis.line_ref === "7");
  const expectedClusters = [averagePoint(nearStops), averagePoint(farStops)];
  const issues = [];
  if (axes.length !== 2) issues.push(`expected 2 merged station_axes, got ${axes.length}`);

  const axisCenters = axes.map((axis) => ({ lat: Number(axis.lat), lng: Number(axis.lng) }));
  if (axisCenters.some((center) => !Number.isFinite(center.lat) || !Number.isFinite(center.lng))) {
    issues.push(`axis centers are not finite: ${JSON.stringify(axes)}`);
  } else {
    for (const center of axisCenters) {
      if (distanceM(center, station) < 120) issues.push(`axis center stayed near station node: ${JSON.stringify(center)}`);
      if (Math.min(...relationSegments.map((segment) => segmentDistanceM(center, segment))) > 10) {
        issues.push(`axis center is not on a fixture track: ${JSON.stringify(center)}`);
      }
    }
    if (axisCenters.length === 2 && distanceM(axisCenters[0], axisCenters[1]) < 30) {
      issues.push(`distinct platform axes collapsed below 30m: ${JSON.stringify(axisCenters)}`);
    }
    for (const expected of expectedClusters) {
      const matches = axisCenters.filter((center) => distanceM(center, expected) < 20);
      if (matches.length !== 1) issues.push(`expected one axis near ${JSON.stringify(expected)}, got ${matches.length}: ${JSON.stringify(axisCenters)}`);
    }
  }

  assert.deepEqual(issues, [], issues.join("\n"));
  console.log("✓ v2 OSM subway snapshot: track-centered station_axes + 30m/15deg merge");
} finally {
  rmSync(cacheDir, { recursive: true, force: true });
}
