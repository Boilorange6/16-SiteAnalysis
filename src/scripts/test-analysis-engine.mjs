import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const root = process.cwd();
const require = createRequire(import.meta.url);
const cache = new Map();

function resolveModule(specifier, fromFile) {
  if (specifier.startsWith(".")) {
    const base = resolve(dirname(fromFile), specifier);
    for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}.js`, base]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return specifier;
}

function loadTs(filePath) {
  const absolute = resolve(root, filePath);
  if (cache.has(absolute)) return cache.get(absolute).exports;

  const source = readFileSync(absolute, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: absolute,
  }).outputText;

  const module = { exports: {} };
  cache.set(absolute, module);
  const localRequire = (specifier) => {
    const resolved = resolveModule(specifier, absolute);
    if (resolved === specifier) return require(specifier);
    return loadTs(resolved);
  };
  new Function("require", "module", "exports", output)(localRequire, module, module.exports);
  return module.exports;
}

const {
  buildInsightOverlays,
  computeAnalysisScores,
  generateAnalysisNarrative,
  getSummaryLines,
} = loadTs("src/lib/analysis-engine.ts");

const config = {
  centerName: "테스트 입지",
  centerLat: 37.5,
  centerLng: 127,
  radiusKm: 2,
};

const pois = [
  { id: "s1", name: "테스트역", lat: 37.501, lng: 127.001, category: "subway", line: "2호선", lineColor: "#00A84D" },
  { id: "s2", name: "보조역", lat: 37.506, lng: 127.006, category: "subway", line: "신분당", lineColor: "#D4003B" },
  { id: "school1", name: "테스트초", lat: 37.503, lng: 127.001, category: "school", level: "elementary" },
  { id: "park1", name: "중앙공원", lat: 37.502, lng: 127.002, category: "park", area_sqm: 15000, type: "근린공원", access_distance_m: 260, quality: "neighborhood" },
  {
    id: "apt1",
    name: "테스트아파트",
    lat: 37.504,
    lng: 127.003,
    category: "apartment",
    units: 820,
    parking_count: 900,
    sale_date: "2025-03",
    distance_m: 420,
    status: "planned",
    source: "applyhome",
  },
  {
    id: "dev1",
    name: "정비구역",
    lat: 37.507,
    lng: 127.002,
    category: "maintenance",
    type: "재개발",
    stage: "사업시행인가",
    address: "서울시",
    area_sqm: 62000,
    source: "seoul_open_data",
    boundary_status: "confirmed",
  },
];

const scores = computeAnalysisScores(config, pois);
assert.equal(scores.items.length, 5);
assert.ok(scores.total > 35, `expected meaningful score, received ${scores.total}`);
assert.match(scores.headline, /경쟁력|보완/);

const overlays = buildInsightOverlays(config, pois);
assert.equal(overlays.length, 4);
assert.ok(overlays.every((overlay) => overlay.radiusM > 0 && overlay.color.startsWith("#")));

const narrative = generateAnalysisNarrative(config, pois);
assert.match(narrative.summary, /테스트 입지/);
assert.ok(narrative.bullets.length >= 5);
assert.ok(narrative.nextActions.length >= 3);

const summaryLines = getSummaryLines(config, pois);
assert.ok(summaryLines.length >= 5 && summaryLines.length <= 6);
assert.match(summaryLines[0], /100점/);

console.log("analysis-engine smoke tests passed");
