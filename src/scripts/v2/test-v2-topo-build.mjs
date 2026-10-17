import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import Database from "better-sqlite3";

const { buildTopoDb, TopoError } = await import("../../lib/v2/topo/build.ts");
const { TOPO_UPLOAD_KEEP } = await import("../../lib/v2/topo/layers.ts");
const { queryFeaturesInRadius } = await import("../../lib/v2/data/features.ts");
const { toLngLat } = await import("../../lib/v2/crs.ts");
import { BASE_X, BASE_Y, PRJ_5187, buildFixture } from "./topo-fixture.mjs";

async function runFixtureChecks() {
  const root = mkdtempSync(join(tmpdir(), "v2-topo-build-"));
  try {
    const srcDir = join(root, "src");
    const outPath = join(root, "topo.sqlite");
    buildFixture(srcDir);
    const summary = await buildTopoDb(srcDir, outPath, { releaseId: "ngii_topo@test" });
    assert.equal(summary.counts.topo_contour, 2);
    assert.equal(summary.counts.topo_road, 1);
    assert.equal(summary.counts.topo_building, 1);
    assert.equal(summary.crs, "EPSG:5179");
    assert.equal(summary.coverageWgs84.length, 5);
    assert.ok(summary.demCells > 0);
    assert.equal(summary.buildingFloorsOnePct, 100);

    const db = new Database(outPath, { readonly: true });
    try {
      const center = toLngLat([BASE_X, BASE_Y]);
      const roads = queryFeaturesInRadius(db, center, 500, ["topo_road"]);
      assert.equal(roads.length, 1);
      assert.equal(roads[0].properties.widthM, 6);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM topo_dem").get().n, 1);
      assert.equal(db.prepare("SELECT provider, source_as_of FROM source_release WHERE source_id = 'ngii_topo'").get().provider, "국토지리정보원");
    } finally {
      db.close();
    }

    const emptyDir = join(root, "empty");
    mkdirSync(emptyDir);
    await assert.rejects(() => buildTopoDb(emptyDir, join(root, "empty.sqlite"), { releaseId: "ngii_topo@empty" }), (error) => error instanceof TopoError && error.code === "topo_not_topo");

    const badDir = join(root, "bad-crs");
    buildFixture(badDir, PRJ_5187);
    await assert.rejects(() => buildTopoDb(badDir, join(root, "bad.sqlite"), { releaseId: "ngii_topo@bad" }), (error) => error instanceof TopoError && error.code === "topo_crs");
    console.log("✓ v2 topo build fixture");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function runSampleCheck() {
  const zipPath = process.env.TOPO_SAMPLE_ZIP;
  if (!zipPath) {
    console.log("skip TOPO_SAMPLE_ZIP (not set)");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "v2-topo-sample-"));
  try {
    const srcDir = join(root, "src");
    mkdirSync(srcDir);
    try {
      // tar lists/extracts only the five-file groups we keep, so a large archive is not
      // materialized in JSZip's in-memory object graph during this bounded smoke check.
      const names = execFileSync("tar", ["-tf", zipPath], { encoding: "utf8" })
        .split(/\r?\n/)
        .map((name) => name.trim())
        .filter((name) => name !== "" && TOPO_UPLOAD_KEEP(name));
      if (names.length === 0) throw new Error("archive has no kept topo entries");
      execFileSync("tar", ["-xf", zipPath, "-C", srcDir, "--", ...names], { stdio: "pipe" });
      for (const name of names) {
        const extracted = join(srcDir, ...name.split(/[\\/]/));
        const flattened = join(srcDir, basename(name));
        if (existsSync(extracted) && extracted !== flattened) copyFileSync(extracted, flattened);
      }
    } catch (error) {
      console.log(`sample zip extraction skipped: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const started = performance.now();
    const summary = await buildTopoDb(srcDir, join(root, "sample.sqlite"), { releaseId: "ngii_topo@sample" });
    const wallMs = performance.now() - started;
    assert.equal(summary.counts.topo_building, 15145);
    assert.equal(summary.counts.topo_contour, 1386);
    console.log(`sample counts ${JSON.stringify(summary.counts)} demCells=${summary.demCells} buildTopoDbMs=${wallMs.toFixed(1)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

await runFixtureChecks();
await runSampleCheck();
