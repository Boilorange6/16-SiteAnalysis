import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { toLngLat, toUtmk } = await import("../../lib/v2/crs.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { circleRectOverlap } = await import("../../lib/v2/tile/a11/engine.ts");
const { TILES } = await import("../../lib/v2/engine/run.ts");
const a11WithDensity = TILES.find(([code]) => code === "A11")[1];
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { automaticLabelText } = await import("../../lib/v2/ui/map-labels.ts");

const CENTER = [127.1506, 37.6245];
const [cx, cy] = toUtmk(CENTER);
const at = (dx, dy = 0) => toLngLat([cx + dx, cy + dy]);
const radiusM = 1200;
const cellSizeM = 1000;

const dataDir = mkdtempSync(join(tmpdir(), "v2-d27-"));
const versionDir = join(dataDir, "versions", "v1");
mkdirSync(versionDir, { recursive: true });
const referencePath = join(versionDir, "reference.sqlite");
{
  const db = new Database(referencePath);
  initDataFileSchema(db, "reference");
  const releaseId = insertRelease(db, {
    sourceId: "sgis_grid",
    provider: "SGIS",
    sourceUrl: "https://example.invalid/sgis",
    sourceAsOf: "2024",
    fetchedAt: "2026-09-30T00:00:00Z",
    checksum: "d27-test",
    licenseCode: "TEST",
  });
  const addCell = (id, dx, dy, population) => insertFeature(db, {
    stableId: `pop_grid:${id}`,
    kind: "pop_grid",
    sourceKey: id,
    releaseId,
    geometry: { type: "Point", coordinates: at(dx, dy) },
    properties: {
      gridId: id,
      cellSizeM,
      dataYear: "2024",
      population: { total: population === null ? { v: null, s: "suppressed" } : { v: population, s: "observed" } },
    },
  });
  addCell("center", 0, 0, 1000);
  addCell("east", 1000, 0, 30000);
  addCell("north-na", 0, 1000, null);
  db.prepare(`INSERT INTO ingest_run
    (run_id, source_id, started_at, finished_at, status, received_count, accepted_count, rejected_count, release_id, snapshot_json)
    VALUES ('sgis_grid:1', 'sgis_grid', 'a', 'b', 'succeeded', 3, 3, 0, ?, ?)`)
    .run(releaseId, JSON.stringify({ byRegion: { "41": 3 }, byType: {}, fillRates: {}, unlocated: 0 }));
  db.close();
}

const manifest = {
  version: "v1",
  createdAt: "2026-09-30T00:00:00Z",
  files: {
    reference: {
      path: "versions/v1/reference.sqlite",
      sha256: await M.sha256File(referencePath),
      kind: "reference",
      schemaVersion: 2,
    },
  },
};
assert.equal((await M.publishManifest(dataDir, manifest, () => ({ ok: true, failures: [] }))).published, true);

const published = M.readManifest(dataDir);
const ctx = new EngineContext(dataDir, published, "d27-test", {
  address: "테스트",
  center: CENTER,
  radiusM,
  analysisDate: "2026-09-30",
});
const result = a11WithDensity(ctx);
parseTileResult(result);
const metric = (id) => result.metrics.find((m) => m.id === id);
const pct = (part, whole) => Math.round((part / whole) * 1000) / 10;
const close = (actual, expected, tolerance = 1e-6) => assert.ok(
  Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
  `${actual} vs ${expected}`,
);

const rectArea = (dx, dy) => {
  const [x, y] = toUtmk(at(dx, dy));
  return circleRectOverlap(cx, cy, radiusM, x - cellSizeM / 2, y - cellSizeM / 2, x + cellSizeM / 2, y + cellSizeM / 2);
};
const centerArea = rectArea(0, 0);
const eastArea = rectArea(1000, 0);
const northArea = rectArea(0, 1000);
const circleArea = Math.PI * radiusM * radiusM;

assert.equal(result.tileCode, "A11");
assert.equal(result.tileType, "analysis");
assert.equal(result.status, "partial", "비공개 셀이 있으므로 partial");
assert.equal(metric("fill_public_pct").value, pct(centerArea + eastArea, circleArea));
close(metric("fill_public_pct").numerator, centerArea + eastArea);
assert.equal(metric("fill_public_pct").denominator, circleArea);
assert.equal(metric("share_dens_2").value, pct(centerArea, circleArea));
assert.equal(metric("share_dens_5").value, pct(eastArea, circleArea));
assert.equal(metric("back_na_pct").value, pct(northArea, circleArea));
close(metric("share_dens_2").numerator, centerArea);
close(metric("share_dens_5").numerator, eastArea);
close(metric("back_na_pct").numerator, northArea);
assert.equal(metric("share_dens_2").denominator, circleArea);
assert.equal(metric("share_dens_5").denominator, circleArea);
assert.equal(metric("back_na_pct").denominator, circleArea);
for (const id of ["share_dens_0", "share_dens_1", "share_dens_3", "share_dens_4"]) {
  assert.equal(metric(id).value, 0);
  assert.equal(metric(id).numerator, 0);
}

const polygons = result.presentation.polygons ?? [];
assert.equal(polygons.length, 3);
assert.deepEqual(polygons.map((p) => p.layer).sort(), ["pop_dens_2", "pop_dens_5", "pop_grid_na"]);
assert.ok(polygons.every((p) => p.rings[0].length >= 4));
assert.ok(polygons.every((p) => p.label === null && p.name === null && p.labelPriority === 0), "A11/D27 밀도 면은 source-derived name 없이 priority 0");
assert.ok(polygons.every((p) => automaticLabelText(p.layer, "polygon", p) === null), "A11/D27 면에는 자동 라벨 후보가 없다");
assert.deepEqual(Object.fromEntries(polygons.map((p) => [p.layer, p.sublabel])), {
  pop_dens_2: "1,000명",
  pop_dens_5: "30,000명",
  pop_grid_na: null,
}, "관측 인구만 서식된 sublabel을 갖고 비공개 셀은 비워 둔다");
assert.equal(result.presentation.features?.length ?? 0, 0, "A11/D27 결과는 격자 점 없이 면만 낸다");
assert.deepEqual(result.presentation.layers, [
  "pop_dens_0", "pop_dens_1", "pop_dens_2", "pop_dens_3", "pop_dens_4", "pop_dens_5",
  "pop_grid_na",
]);
assert.doesNotMatch(result.judgment.sentence, /공개 격자 면적 채움률/, "흡수 D27 판단 문장을 A11에 중복하지 않는다");
const view = toTileView(result);
assert.equal(view.rows.some((row) => row.label.startsWith("인구밀도 ") && row.value === "0.0%"), false, "0% 밀도 구간은 카드에서 숨긴다");
assert.ok(result.limitations.some((l) => l.note.includes("비밀보호") && l.note.includes("면적비")));
assert.ok(result.limitations.some((l) => l.kind === "suppressed"));
assert.deepEqual(result.provenance.sources.map((s) => s.sourceId), ["sgis_grid"]);
assert.doesNotMatch(JSON.stringify(toTileView(result)), /도보|\d\s*분|종합/);

ctx.close();
console.log("✓ v2 A11/D27 engine tile");
