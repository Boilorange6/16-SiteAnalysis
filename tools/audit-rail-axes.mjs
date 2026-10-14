import { readFileSync } from "node:fs";

const TARGET_STATIONS = [
  "고속터미널",
  "왕십리",
  "도곡",
  "성신여대입구",
  "대치",
  "김포공항",
  "서울역",
  "신도림",
  "종로3가",
  "잠실",
];
const METERS_PER_LAT = 111_320;

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const baselinePath = arg("baseline");
const candidatePath = arg("candidate");
if (!baselinePath || !candidatePath) {
  console.error("usage: npx tsx tools/audit-rail-axes.mjs --baseline <old.json> --candidate <new.json>");
  process.exit(2);
}

const load = (path) => JSON.parse(readFileSync(path, "utf8"));
const baseline = load(baselinePath);
const candidate = load(candidatePath);
const stationKey = (value) => String(value ?? "")
  .replace(/\([^)]*\)/gu, "")
  .replace(/[\s·・]/gu, "")
  .replace(/역$/u, "")
  .trim();
const distanceM = (a, b) => {
  const lat = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const dx = (a.lng - b.lng) * Math.cos(lat) * METERS_PER_LAT;
  const dy = (a.lat - b.lat) * METERS_PER_LAT;
  return Math.hypot(dx, dy);
};
const stationOf = (snapshot, axis) => {
  const byId = axis.station_osm_id ? snapshot.stations.find((station) => station.osm_id === axis.station_osm_id) : null;
  return byId ?? snapshot.stations.find((station) => stationKey(station.station_name) === stationKey(axis.station_name)) ?? null;
};
const nodeDistance = (snapshot, axis) => {
  const station = stationOf(snapshot, axis);
  return station ? distanceM(station, axis) : null;
};
const lineKey = (axis) => axis.line_ref || axis.line_name || "(미상)";
const groupKey = (axis) => `${stationKey(axis.station_name)}|${axis.line_ref || "(미상)"}`;
const byLine = (axes) => {
  const groups = new Map();
  for (const axis of axes) {
    const key = lineKey(axis);
    const list = groups.get(key) ?? [];
    list.push(axis);
    groups.set(key, list);
  }
  return groups;
};
const fmt = (value) => value === null || value === undefined ? "—" : `${value.toFixed(1)}m`;
const fmtList = (values) => values.length ? values.map(fmt).join(", ") : "—";
const counts = (snapshot) => ({
  stations: snapshot.stations.length,
  entrances: snapshot.entrances.length,
  lines: snapshot.lines.length,
  station_axes: snapshot.station_axes?.length ?? 0,
});

console.log("# A01 station_axes projection audit");
console.log("");
console.log(`- baseline: ${baseline.generated_at ?? "unknown"}`);
console.log(`- candidate: ${candidate.generated_at ?? "unknown"}`);
console.log("");
console.log("## Snapshot counts");
console.log("");
console.log("| item | baseline | candidate | delta |");
console.log("|---|---:|---:|---:|");
for (const key of ["stations", "entrances", "lines", "station_axes"]) {
  const before = counts(baseline)[key];
  const after = counts(candidate)[key];
  console.log(`| ${key} | ${before.toLocaleString()} | ${after.toLocaleString()} | ${(after - before >= 0 ? "+" : "") + (after - before).toLocaleString()} |`);
}

console.log("");
console.log("## Target station impact");
console.log("");
console.log("| station | line_ref | axes before→after | center↔node before | center↔node after | judgment |");
console.log("|---|---|---:|---:|---:|---|");
for (const stationName of TARGET_STATIONS) {
  const beforeAxes = baseline.station_axes.filter((axis) => stationKey(axis.station_name) === stationKey(stationName));
  const afterAxes = candidate.station_axes.filter((axis) => stationKey(axis.station_name) === stationKey(stationName));
  const refs = [...new Set([...beforeAxes, ...afterAxes].map(lineKey))].sort((a, b) => a.localeCompare(b, "ko"));
  if (refs.length === 0) {
    console.log(`| ${stationName} | — | 0→0 | — | — | FAIL: no axis |`);
    continue;
  }
  for (const ref of refs) {
    const before = beforeAxes.filter((axis) => lineKey(axis) === ref);
    const after = afterAxes.filter((axis) => lineKey(axis) === ref);
    const beforeDistances = before.map((axis) => nodeDistance(baseline, axis)).filter((value) => value !== null);
    const afterDistances = after.map((axis) => nodeDistance(candidate, axis)).filter((value) => value !== null);
    const pass = after.length > 0 && afterDistances.every((value) => value !== null && Number.isFinite(value));
    console.log(`| ${stationName} | ${ref} | ${before.length}→${after.length} | ${fmtList(beforeDistances)} | ${fmtList(afterDistances)} | ${pass ? "PASS" : "FAIL"} |`);
  }
}

const expressBefore = baseline.station_axes.filter((axis) => stationKey(axis.station_name) === stationKey("고속터미널"));
const expressAfter = candidate.station_axes.filter((axis) => stationKey(axis.station_name) === stationKey("고속터미널"));
const expressThree = expressAfter.find((axis) => axis.line_ref === "3");
console.log("");
if (expressThree) {
  const separation = (ref) => {
    const axis = expressAfter.find((candidateAxis) => candidateAxis.line_ref === ref);
    return axis ? distanceM(expressThree, axis) : null;
  };
  console.log(`- 고속터미널 7·9호선 중심과 3호선 중심: 7호선 ${fmt(separation("7"))}, 9호선 ${fmt(separation("9"))} — ${separation("7") >= 80 && separation("9") >= 80 ? "PASS" : "FAIL"}.`);
  console.log(`- 고속터미널 전체 축 개수: ${expressBefore.length}→${expressAfter.length}.`);
}

const baselineGroups = new Map();
for (const axis of baseline.station_axes) {
  const list = baselineGroups.get(groupKey(axis)) ?? [];
  list.push(axis);
  baselineGroups.set(groupKey(axis), list);
}
const moved = new Map();
for (const axis of candidate.station_axes) {
  const old = baselineGroups.get(groupKey(axis)) ?? [];
  if (old.length === 0) continue;
  const nearest = Math.min(...old.map((previous) => distanceM(previous, axis)));
  if (nearest < 100) continue;
  const key = groupKey(axis);
  const current = moved.get(key) ?? { station: axis.station_name, line_ref: axis.line_ref || "(미상)", before: old.length, after: 0, max: 0 };
  current.after += 1;
  current.max = Math.max(current.max, nearest);
  moved.set(key, current);
}

console.log("");
console.log("## Axes moved at least 100m");
console.log("");
console.log("| rank | station | line_ref | axes before→after | max center movement |");
console.log("|---:|---|---|---:|---:|");
const movedRows = [...moved.values()].sort((a, b) => b.max - a.max || a.station.localeCompare(b.station, "ko") || a.line_ref.localeCompare(b.line_ref)).slice(0, 30);
for (const [index, row] of movedRows.entries()) {
  console.log(`| ${index + 1} | ${row.station} | ${row.line_ref} | ${row.before}→${row.after} | ${fmt(row.max)} |`);
}
if (movedRows.length === 0) console.log("| — | — | — | — | none |");

const anomalies = candidate.station_axes
  .map((axis) => ({ axis, distance: nodeDistance(candidate, axis) }))
  .filter(({ distance }) => distance !== null && distance > 400)
  .sort((a, b) => b.distance - a.distance);
console.log("");
console.log("## Projection anomalies (>400m)");
console.log("");
if (anomalies.length === 0) {
  console.log("none");
} else {
  for (const { axis, distance } of anomalies) console.log(`- ${axis.station_name} / ${axis.line_ref || axis.line_name}: ${fmt(distance)}; center=${axis.lat},${axis.lng}`);
}

console.log("");
console.log(`- axis groups with movement ≥100m: ${moved.size}`);
console.log(`- raw candidate line groups: ${byLine(candidate.station_axes).size}`);
