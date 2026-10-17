import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const JSZip = (await import("jszip")).default;
const { openV2AppDb } = await import("../../lib/v2/app-db.ts");
const {
  MAX_TOPO_UPLOAD_BYTES,
  openTopoForUser,
  putTopoUpload,
} = await import("../../lib/v2/topo/upload.ts");
const { buildFixture } = await import("./topo-fixture.mjs");

async function fixtureZip() {
  const root = mkdtempSync(join(tmpdir(), "v2-topo-api-fixture-"));
  try {
    buildFixture(root);
    const zip = new JSZip();
    for (const name of readdirSync(root)) {
      zip.file(name, readFileSync(join(root, name)));
    }
    return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function namedZip(name, content = Buffer.from("bad")) {
  const zip = new JSZip();
  zip.file(name, content);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function topoSqliteFiles(root) {
  const dir = join(root, "topo");
  try {
    return readdirSync(dir).filter((name) => name.endsWith(".sqlite"));
  } catch {
    return [];
  }
}

const root = mkdtempSync(join(tmpdir(), "v2-topo-api-"));
const appDb = openV2AppDb(join(root, "app.sqlite"));
const dataDir = join(root, "unrelated", "data");
const body = await fixtureZip();

try {
  const first = await putTopoUpload(appDb, dataDir, body, "user-1");
  assert.equal(first.status, 201);
  assert.ok(first.body.topoId);
  assert.equal(first.body.summary.counts.topo_road, 1);

  const topoId = first.body.topoId;
  const opened = openTopoForUser(appDb, topoId, "user-1");
  assert.ok(opened);
  assert.equal(opened.summary.counts.topo_road, 1);
  assert.equal(typeof opened.sha256, "string");
  assert.equal(typeof opened.uploadedAt, "string");
  opened.db.close();

  const duplicate = await putTopoUpload(appDb, dataDir, body, "user-1");
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.topoId, topoId);
  assert.equal(topoSqliteFiles(root).length, 1);

  const concurrent = await Promise.all([
    putTopoUpload(appDb, dataDir, body, "user-2"),
    putTopoUpload(appDb, dataDir, body, "user-2"),
  ]);
  assert.equal(concurrent[0].status, 201);
  assert.equal(concurrent[1].status, 200);
  assert.equal(concurrent[0].body.topoId, concurrent[1].body.topoId);
  assert.equal(topoSqliteFiles(root).length, 2);

  const secondAppDb = openV2AppDb(join(root, "app.sqlite"));
  try {
    const separateConnections = await Promise.all([
      putTopoUpload(appDb, dataDir, body, "user-3"),
      putTopoUpload(secondAppDb, dataDir, body, "user-3"),
    ]);
    assert.deepEqual(separateConnections.map((result) => result.status).sort(), [200, 201]);
    assert.equal(separateConnections[0].body.topoId, separateConnections[1].body.topoId);
    assert.equal(topoSqliteFiles(root).length, 3);
  } finally {
    secondAppDb.close();
  }

  assert.equal(openTopoForUser(appDb, topoId, "other-user"), null);

  const tooLarge = await putTopoUpload(appDb, dataDir, Buffer.alloc(MAX_TOPO_UPLOAD_BYTES + 1), "user-1");
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.body.error, "topo_too_large");

  for (const name of ["../x.shp", "a/b.shp"]) {
    const badPath = await putTopoUpload(appDb, dataDir, await namedZip(name), "user-1");
    assert.equal(badPath.status, 400);
    assert.equal(badPath.body.error, "topo_bad_zip");
  }

  const noLayers = await putTopoUpload(appDb, dataDir, await namedZip("readme.txt", Buffer.from("not a topo")), "user-1");
  assert.equal(noLayers.status, 400);
  assert.equal(noLayers.body.error, "topo_not_topo");

  console.log("✓ v2 topo upload API");
} finally {
  appDb.close();
  rmSync(root, { recursive: true, force: true });
}
