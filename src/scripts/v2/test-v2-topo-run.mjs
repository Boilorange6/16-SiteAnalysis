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
  A01: "8da02e9296fedefbbbfcd32022538de34782e306c04abb3443fc0f37b8efe2c4",
  A02: "830f1efdc6cd071302449efafdc4eaf10e90ab40423aa457a0884c059a759e2a",
  A03: "13cb2d824cd17487aeb15b072bb9af0cb3a8e15d469a90a518d6664649fc0153",
  A04: "88a9102e9741b316ade54b9e05d0aac71b964740fd3a8914cdb68052ff777eff",
  A05: "120816095dd06da62187b8a3097a2490d41c5d7565b78a2aadec77bd678f0dba",
  A06: "a16ed96ec5877a6109036fe8e99c03677d98f418ab39cfc5e10e1afa5344f543",
  A07: "44cc0a2dd15a9662ba96574970669bd531c39624602750a2724d52e65ed31a43",
  A08: "17f0776bf14a311c0707d43b4b74e0e1ef02681466ebbb67b3c50526771966e9",
  A09: "b6418b7a537ae7049de70f9cd8e14d08c8eb993b94f45874322d4a3329ca38ce",
  A10: "46298070d30cb5ab5975dee4e4621a2bf3e4a9daaddc3900fa3cbb196bfdb2c8",
  A11: "172a9364db9a8802dd4d38a664b130bd759cf8bc85a81facbdc6d003b7b75466",
  A12: "cf3f30571d4eddb9e559fbcf8c55545eec07ec949843a62f81602c0c3605fd26",
  D01: "14be004589a3975e4f773178dea6a3b2d58736b4d66f67869efce9512fe29718",
  D02: "8d252172a287ea82aad052be2996c43d4eb431ffa74cbe10f7e8edc39014a756",
  D03: "7788e980d91d7f450093a49cc2f4362ef626c1be22f65ca87ef9be087cc1a8ea",
  D04: "386e4fc83af7ec7d3fb2f9a85b7e8031a3a2dbe03c6ad54231a5a249a1fb8803",
  D05: "f78fec43d17769fc523ec7d4c3a36b08d274b61041ca8641a99986b44fc47da5",
  D10: "62559d0c3eeda5323664c5c6d75f0b20818bfa643048f040740c85910ea71305",
  D11: "b3d78af1175555b02ad9e1324c5f7ca342a1188d809bc1ce25a9bea12a126434",
  D12: "556032a98f5a865cd91a53274e88b99c93df22a2ff91d882b814b8b57a1b5384",
  D13: "c0e01fef262dc8180d063bcdf01b0069304a7a8f45af57548f2f5d1fb67d6383",
  D15: "444e82da6a03f5f3dcd126add109194cb82816f40ab0ddeed6858b56d2bd27bb",
  D16: "0f3eded77ef4a84b987c04f4305c786bb5d389fe354a05a2a4e65ccdbd4c1e0c",
  D17: "704f9e3d41f6aec2d788556f6c87960ef72993216099eaf473a738ac8dab8f04",
  D18: "3ff4b09ecfb23067c068d4995716a62581ceda4bbe54085391f3d8c8841b07ef",
  D19: "a59401deb071f2ef2c61310747a0db63b3fd94ee3f71cf2afeb3aa78210dc6aa",
  D22: "8502f46014e687f81f091b3d65eb00de8d5e5e37746dee97bbebc1470e5220fc",
  D28: "0146f77d69ae0a41630a0a792bd61990fe2c9d40d20c0f317ef3f7b10972f88f",
  D29: "582940c6f77d48a5505e6dc964ac5c1468ad9cabac973f746b0fb7546ec0986a",
  S01: "843c6285e7a7e135e584d700188fbaef61ded451cc7caba495e25335897a4132",
  S02: "8326f3a2ff7456165846f2bb5109f6eab2af533bcd91bf10ed837e7c6c00c030",
  S03: "17ee6e2927e0948e795a52773a04645deeb3ccc38feb0199ddc78c01d8c572b9",
  S04: "7c73184f3f75380c72386ee881a88eac50f570fc3b5c4b68941cc035eca341f5",
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
