// 리팩터 동등성 게이트: golden-engine이 빼는 presentation과, shots가 다루지 않는 컷 화면을 비교한다.
//   npx tsx src/scripts/v2/harness/equivalence.mjs --write <dir> | --check <dir>
// <dir>에 engine-results.json(33타일 결과 전체, 실행 id·소요 제외), cut-views.json(S01·S02·S03·S04·D22 컷 후보별 viewForCut),
// report-plans.json(같은 컷을 보드에 적용했을 때 reportPages와 그 타일의 보고서 조판)을 쓴다/비교한다.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { buildEngineFixture } = await import("../engine-fixture.mjs");
const { loadTileResults, openV2AppDb } = await import("../../../lib/v2/app-db.ts");
const { runAnalysis } = await import("../../../lib/v2/engine/run.ts");
const { runHeavyTiles } = await import("../../../lib/v2/engine/jobs.ts");
const { canonicalJson } = await import("../../../lib/v2/canonical-json.ts");
const V = await import("../../../lib/v2/ui/tile-view.ts");
const C = await import("../../../lib/v2/ui/cut-selection.ts");
const B = await import("../../../lib/v2/ui/board-state.ts");
const R = await import("../../../lib/v2/report/report-plan.ts");

// golden-engine.mjs와 같은 fixture·입력
const OPTIONS = { buildings: true, parcels: true, terrain: true, weather: true, roads: true, landuse: true };
const INPUT = { address: "경기도 남양주시 다산동 100", radiusM: 800, analysisDate: "2026-09-30" };
const CUT_CODES = ["S01", "S02", "S03", "S04", "D22"];

const option = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const writeDir = option("--write");
const checkDir = option("--check");
if (!writeDir === !checkDir) {
  console.error("usage: npx tsx src/scripts/v2/harness/equivalence.mjs --write <dir> | --check <dir>");
  process.exit(2);
}

const dataDir = mkdtempSync(join(tmpdir(), "v2-equivalence-data-"));
const appDir = mkdtempSync(join(tmpdir(), "v2-equivalence-app-"));
const appDb = openV2AppDb(join(appDir, "app.sqlite"));
let results;
let analysisId;
let outcome;
try {
  await buildEngineFixture(dataDir, "refactor-golden", OPTIONS);
  outcome = runAnalysis(appDb, dataDir, INPUT);
  if (!outcome.ok) throw new Error("equivalence fixture analysis failed");
  analysisId = outcome.analysisId;
  runHeavyTiles(appDb, dataDir, analysisId);
  results = loadTileResults(appDb, analysisId);
} finally {
  appDb.close();
  for (const path of [dataDir, appDir]) {
    try { rmSync(path, { recursive: true, force: true }); } catch (error) { console.warn(`temporary fixture cleanup deferred: ${path} (${error?.code ?? error})`); }
  }
}

const scrub = (value) => JSON.parse(JSON.stringify(value).split(analysisId).join("<analysis>"));
const engine = canonicalJson(results
  .map(({ tileId: _tileId, analysisId: _analysisId, elapsedMs: _elapsedMs, ...rest }) => scrub(rest))
  .sort((a, b) => a.tileCode.localeCompare(b.tileCode)));

const withoutFunctions = (value) => JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === "function" ? undefined : v)));
const cuts = {};
for (const r of results.filter((x) => CUT_CODES.includes(x.tileCode)).sort((a, b) => a.tileCode.localeCompare(b.tileCode))) {
  const view = V.toTileView(r, null, null, null);
  cuts[`${r.tileCode}:${r.status}`] = C.cutCandidates(view, null).map((candidate) => {
    const ready = C.cutReady(view, candidate.cut);
    return { cut: candidate.cut, label: candidate.label, disabled: candidate.disabled, ready, owns: C.cutOwnsRaster(view, candidate.cut), note: C.cutNote(candidate.cut), view: ready ? scrub(withoutFunctions(C.viewForCut(view, candidate.cut))) : null };
  });
}
const cutViews = canonicalJson(cuts);

const views = new Map(results.map((r) => [r.tileId, V.toTileView(r, null, null, null)]));
const summary = V.toSummaryView(outcome.summary, results);
const board = B.initBoard(results);
const reports = {};
for (const r of results.filter((x) => CUT_CODES.includes(x.tileCode)).sort((a, b) => a.tileCode.localeCompare(b.tileCode))) {
  for (const candidate of C.cutCandidates(views.get(r.tileId), null)) {
    const next = B.boardReducer(board, { type: "cut", id: r.tileId, cut: candidate.cut });
    const plan = R.buildReportPlan({ summary, views, board: next, analysisDate: INPUT.analysisDate });
    reports[`${r.tileCode}:${C.cutKey(candidate.cut)}`] = { pages: B.reportPages(next), slides: plan.length, plan: scrub(withoutFunctions(plan.filter((p) => p.kind === "tile" && p.code === r.tileCode))) };
  }
}
const reportPlans = canonicalJson(reports);

const files = { "engine-results.json": engine, "cut-views.json": cutViews, "report-plans.json": reportPlans };
if (writeDir) {
  for (const [name, body] of Object.entries(files)) writeFileSync(join(writeDir, name), body);
  console.log(`equivalence: wrote ${Object.keys(files).join(", ")} to ${writeDir}`);
} else {
  const failed = Object.entries(files).filter(([name, body]) => readFileSync(join(checkDir, name), "utf8") !== body).map(([name]) => name);
  if (failed.length > 0) {
    console.error(`equivalence: FAIL (${failed.join(", ")} differ from ${checkDir})`);
    process.exit(1);
  }
  console.log(`equivalence: PASS (engine results incl. presentation + ${Object.values(cuts).reduce((n, list) => n + list.length, 0)} cut views + ${Object.keys(reports).length} cut report plans match ${checkDir})`);
}
