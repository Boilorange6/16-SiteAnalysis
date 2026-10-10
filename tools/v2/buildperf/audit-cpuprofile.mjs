import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node audit-cpuprofile.mjs <cpuprofile>");
  process.exit(2);
}
const profile = JSON.parse(readFileSync(path, "utf8"));
const nodes = new Map((profile.nodes ?? []).map((node) => [node.id, node.callFrame ?? {}]));
const byFrame = new Map();
const byUrl = new Map();
const samples = profile.samples ?? [];
const deltas = profile.timeDeltas ?? [];
for (let i = 0; i < samples.length; i += 1) {
  const frame = nodes.get(samples[i]) ?? {};
  // V8 CPU profile timeDeltas are microseconds, while the report uses ms.
  const ms = Number(deltas[i] ?? profile.samplingInterval ?? 0) / 1000;
  const url = String(frame.url ?? "<native>");
  const line = Number(frame.lineNumber ?? -1) + 1;
  const key = `${frame.functionName ?? "<anonymous>"} @ ${url}:${line}`;
  byFrame.set(key, (byFrame.get(key) ?? 0) + ms);
  byUrl.set(url, (byUrl.get(url) ?? 0) + ms);
}
const top = (map, limit = 30) => {
  const total = [...map.values()].reduce((a, b) => a + b, 0);
  return [...map.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, limit)
  .map(([label, ms]) => ({ label, ms: Number(ms.toFixed(1)), pct: Number((100 * ms / total).toFixed(1)) }));
};
const nonIdle = (label) => !/^\((idle|program)\)/.test(label);
console.log(JSON.stringify({
  path,
  sampleCount: samples.length,
  totalSampleMs: Number(deltas.reduce((a, b) => a + Number(b ?? 0), 0) / 1000).toFixed(1),
  topFrames: top(byFrame),
  topNonIdleFrames: top(new Map([...byFrame].filter(([label]) => nonIdle(label))), 20),
  topUrls: top(byUrl, 20),
}, null, 2));
