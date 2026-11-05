import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const JSZip = (await import("jszip")).default;
const { buildEngineFixture } = await import("./engine-fixture.mjs");
const { BASE_X, BASE_Y, buildFixture } = await import("./topo-fixture.mjs");
const A = await import("../../lib/v2/app-db.ts");
const { toLngLat } = await import("../../lib/v2/crs.ts");
const { postAnalysis, getAnalysisRefreshSummary, refreshAnalysis } = await import("../../lib/v2/engine/api.ts");
const { runAnalysis } = await import("../../lib/v2/engine/run.ts");
const { runHeavyTiles } = await import("../../lib/v2/engine/jobs.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { putTopoUpload } = await import("../../lib/v2/topo/upload.ts");

const BASELINE_KEYS = {
  A01: "301ab8d3ea2f985e1502827834ab5da9dabb73752c0f2fd41d740cbd40870b18",
  A02: "b7374ae6f8c8035baff702496ee80bdf087106fce992743ec250d10161aa89f9", // 2026-11-04 A02 리비전 +koies-r1(학구도 원천 교체)
  A03: "b8468e662c21268c3faa85c6d1d01b0711d57e9eb6c907759396eb70daecc3d7",
  A04: "c02c6f8b7e3ef3d7960cc94355523008eca43829bbcd3dc004c5d9941ae1c907",
  A05: "d958fa00b1976ca516cb85d056a4cfd86f15f8d016b846498a4e7ee4535c47fc",
  A06: "302cce27d86824d047eda3edb839791ddb9dea100b0dfa40d582c8ccc72f0876",
  A07: "9efeef2208dcb5aa06e15e277728e0ff95e500a33ae5893e06a0153e545f1b2d",
  A08: "e7a320a860f60d84556fe27e0f103ddcdd8da5516af4efae26e02bd01648b454",
  A09: "4fdf5b1365a09284200e76c9dc41df37fbd4211c9a1dacde2ce51867fa259623",
  A10: "46298070d30cb5ab5975dee4e4621a2bf3e4a9daaddc3900fa3cbb196bfdb2c8",
  A11: "172a9364db9a8802dd4d38a664b130bd759cf8bc85a81facbdc6d003b7b75466",
  A12: "f4d579b2dfdacf0c008ed2dee3c5da11124829c2f39f48fce595e8c9453bb007",
  D01: "14be004589a3975e4f773178dea6a3b2d58736b4d66f67869efce9512fe29718",
  D02: "8d252172a287ea82aad052be2996c43d4eb431ffa74cbe10f7e8edc39014a756",
  D03: "f1b026e8eecd229ccb05e2606e6951331d14bb074e4a90b7b0183fc1539f4c87", // labels-r1 revision (P1 Task 6)
  D04: "08cc78cc78bebd2c14f557b1b408dac6171785a0264405764b92c9cbb1d85a81", // labels-r1 revision (P1 Task 6)
  D05: "1b126299a95d793a6bd2cb5109264ffc2d2811f69505ce06d809182c82cb170d", // labels-r1 revision (P1 Task 6)
  D10: "accd0932fd47f58cdc93fecdabe37e26ac54057f4ef6a43ad07867fbc006c4c0", // no-osm-green-r1 revision; all other keys unchanged
  D11: "b3d78af1175555b02ad9e1324c5f7ca342a1188d809bc1ce25a9bea12a126434",
  D12: "d19702a8b482ba43c7a5192828c14369a4ec12160ae977570b9836cc33a34a90",
  D13: "c9130bb0863ccc2259da68cebd2d4259b5e6cf8193138dac7211f43aead646c3",
  D15: "149f433cafd9b94f80138d7c22928b54cc35b1dec8c2932c53988e80df3adeea",
  D16: "0f3eded77ef4a84b987c04f4305c786bb5d389fe354a05a2a4e65ccdbd4c1e0c",
  D17: "704f9e3d41f6aec2d788556f6c87960ef72993216099eaf473a738ac8dab8f04",
  D18: "3ff4b09ecfb23067c068d4995716a62581ceda4bbe54085391f3d8c8841b07ef",
  D19: "a59401deb071f2ef2c61310747a0db63b3fd94ee3f71cf2afeb3aa78210dc6aa",
  D22: "8502f46014e687f81f091b3d65eb00de8d5e5e37746dee97bbebc1470e5220fc",
  D28: "0146f77d69ae0a41630a0a792bd61990fe2c9d40d20c0f317ef3f7b10972f88f",
  D29: "582940c6f77d48a5505e6dc964ac5c1468ad9cabac973f746b0fb7546ec0986a",
  S01: "843c6285e7a7e135e584d700188fbaef61ded451cc7caba495e25335897a4132",
  S02: "a8dad76c921e34af321015097e7ffc6a2560e4201f54dedd51907784d07777bb",
  S03: "17ee6e2927e0948e795a52773a04645deeb3ccc38feb0199ddc78c01d8c572b9",
  S04: "c40151bc0a440fa0048cf72b2795d8e93630b72c7ebd9e179228a0592ca86945", // bldgmask-r1 revision
};

async function fixtureZip() {
  const root = mkdtempSync(join(tmpdir(), "v2-topo-run-fixture-"));
  try {
    buildFixture(root);
    const zip = new JSZip();
    for (const name of readdirSync(root)) zip.file(name, readFileSync(join(root, name)));
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function tileKeys(db, analysisId) {
  const rows = db.prepare("SELECT tile_code, cache_key FROM tile_result WHERE analysis_id = ? ORDER BY tile_code").all(analysisId);
  return Object.fromEntries(rows.map((row) => [row.tile_code, row.cache_key]));
}

const root = mkdtempSync(join(tmpdir(), "v2-topo-run-"));
const dataDir = join(root, "data");
const appDb = A.openV2AppDb(join(root, "app.sqlite"));
const center = toLngLat([BASE_X, BASE_Y]);
const input = { address: "경기도 남양주시 다산동 100", radiusM: 800, analysisDate: "2026-09-30" };
const centerInput = { center, radiusM: 800, analysisDate: "2026-09-30" };
const observedContexts = [];
const originalClose = EngineContext.prototype.close;
EngineContext.prototype.close = function patchedClose() {
  observedContexts.push({
    topo: this.topo ? {
      sha256: this.topo.sha256,
      roadHits: this.topo.hits(["topo_road"], 800).length,
      coversCenter: this.topo.covers(BASE_X, BASE_Y),
      coversOutside: this.topo.covers(BASE_X + 1000, BASE_Y + 1000),
      hasDem: this.topo.dem !== null,
    } : null,
  });
  return originalClose.call(this);
};

try {
  await buildEngineFixture(dataDir, "baseline");

  const baseline = runAnalysis(appDb, dataDir, input);
  assert.equal(baseline.ok, true);
  assert.deepEqual(tileKeys(appDb, baseline.analysisId), BASELINE_KEYS, "topo 없는 33개 cache_key는 Task 3 전과 바이트 동일");
  assert.equal(A.getAnalysisRun(appDb, baseline.analysisId).parameters.topo, undefined);

  const noTopoAtFixtureCenter = runAnalysis(appDb, dataDir, centerInput);
  assert.equal(noTopoAtFixtureCenter.ok, true);
  const noTopoKeys = tileKeys(appDb, noTopoAtFixtureCenter.analysisId);

  const upload = await putTopoUpload(appDb, join(root, "upload-data"), await fixtureZip(), 17);
  assert.equal(upload.status, 201);
  const topoId = upload.body.topoId;
  const topoRow = appDb.prepare("SELECT sha256 FROM topo_upload WHERE topo_id = ?").get(topoId);
  const topoSha256 = topoRow.sha256;

  const topoReply = postAnalysis(appDb, dataDir, { ...centerInput, topoId }, 17);
  assert.equal(topoReply.status, 202);
  const topoAnalysisId = topoReply.body.analysisId;
  const topoRun = A.getAnalysisRun(appDb, topoAnalysisId);
  assert.equal(topoRun.userId, "17", "numeric userId는 analysis_run에 문자열로 저장되지만 owner lookup과 일치");
  assert.equal(topoRun.parameters.topo.sha256, topoSha256);
  assert.deepEqual(topoRun.parameters.topo, { id: topoId, sha256: topoSha256 });
  const topoKeys = tileKeys(appDb, topoAnalysisId);
  assert.notEqual(topoKeys.D17, noTopoKeys.D17, "영향 타일 D17은 topo 해시로 키가 분리됨");
  assert.equal(topoKeys.A03, noTopoKeys.A03, "비영향 타일 A03은 topo 없이 만든 키와 동일");

  const topoContext = observedContexts.at(-1).topo;
  assert.deepEqual(topoContext, {
    sha256: topoSha256,
    roadHits: 1,
    coversCenter: true,
    coversOutside: false,
    hasDem: true,
  }, "EngineContext가 topo handle의 feature/범위/DEM을 연다");

  const fresh = getAnalysisRefreshSummary(appDb, topoAnalysisId, dataDir);
  assert.ok(fresh);
  assert.equal(fresh.state, "running", "heavy tile이 남아 있는 topo 분석은 refresh running");
  assert.ok(!fresh.tiles.some((tile) => tile.reason === "cache_key_mismatch"), JSON.stringify(fresh.tiles));

  runHeavyTiles(appDb, dataDir, topoAnalysisId);
  const workerContext = observedContexts.at(-1).topo;
  assert.ok(workerContext);
  assert.equal(workerContext.sha256, topoSha256, "job worker context가 같은 topo를 엶");

  const afterWorker = getAnalysisRefreshSummary(appDb, topoAnalysisId, dataDir);
  assert.equal(afterWorker.state, "fresh", JSON.stringify(afterWorker));
  assert.ok(!afterWorker.tiles.some((tile) => tile.reason === "cache_key_mismatch"), JSON.stringify(afterWorker.tiles));

  appDb.prepare("UPDATE analysis_run SET engine_version = ? WHERE analysis_id = ?").run("task3-before-refresh", topoAnalysisId);
  const refreshReply = refreshAnalysis(appDb, dataDir, topoAnalysisId, 17);
  assert.equal(refreshReply.status, 202);
  assert.ok(refreshReply.body.queued.length > 0);
  runHeavyTiles(appDb, dataDir, topoAnalysisId);
  const refreshWorkerContext = observedContexts.at(-1).topo;
  assert.ok(refreshWorkerContext);
  assert.equal(refreshWorkerContext.sha256, topoSha256, "refresh worker context가 같은 topo를 엶");
  assert.equal(getAnalysisRefreshSummary(appDb, topoAnalysisId, dataDir).state, "fresh");

  const outside = postAnalysis(appDb, dataDir, { ...centerInput, center: toLngLat([BASE_X + 10000, BASE_Y + 10000]), topoId }, 17);
  assert.deepEqual(outside, { status: 422, body: { error: "topo_outside" } });

  const foreign = postAnalysis(appDb, dataDir, { ...centerInput, topoId }, 18);
  assert.deepEqual(foreign, { status: 404, body: { error: "topo_not_found" } });
} finally {
  EngineContext.prototype.close = originalClose;
  appDb.close();
}

console.log("✓ v2 topo run");
