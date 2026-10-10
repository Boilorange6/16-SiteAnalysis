/**
 * reference 빌드의 단계별 재개: 어느 단계에서 죽어도(예외, 단계 중간 포함) --resume 결과가 중단 없는 빌드와 같아야 한다.
 * 합성 원천 — 점 CSV, 파일(파트) 여러 개인 용도지역(지정ID가 파일을 넘어 겹침), 시도별 공시지가(PNU 중복), 멱등 연결 단계.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import Database from "better-sqlite3";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildAndPublish, buildResumableSteps, insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildPointSource, STORE_SPEC } = await import("../../lib/v2/ingest/sources/points.ts");
const { buildZoning, seedZoningSeen } = await import("../../lib/v2/ingest/sources/zoning.ts");
const { buildLandPrice } = await import("../../lib/v2/ingest/sources/land-price.ts");

const rel = (sourceId) => ({ sourceId, provider: "fixture", sourceUrl: "https://example.invalid", sourceAsOf: "2026-10-01", fetchedAt: "2026-10-01T00:00:00Z", checksum: `fx-${sourceId}`, licenseCode: "TEST" });
async function* iter(list) {
  for (const x of list) yield x;
}

const storeRows = Array.from({ length: 12 }, (_, i) => ({
  properties: { 상가업소번호: `S${i % 10}`, 상호명: `가게${i}`, 경도: String(127.0 + i * 0.001), 위도: "37.5", 시도코드: "11", 상권업종대분류명: "음식", 법정동코드: "1168010100" },
}));
const square = (x, y) => ({ type: "Polygon", coordinates: [[[x, y], [x + 0.001, y], [x + 0.001, y + 0.001], [x, y + 0.001], [x, y]]] });
const zrow = (id, x, name) => ({ properties: { A1: id, A3: "20260101", A4: "11680", A5: "UQA110", A6: name, A7: "20200101" }, geometry: square(x, 37.4) });
// 같은 지정ID(Z1, Z2)가 다른 파트·다른 레이어에도 나온다 → stable id에 #순번
const zoningParts = {
  "zoning/urban_1.shp": ["urban", [zrow("Z1", 127.01, "제1종일반주거지역"), zrow("Z2", 127.02, "상업지역"), zrow("Z1", 127.03, "제1종일반주거지역")]],
  "zoning/urban_2.shp": ["urban", [zrow("Z1", 127.04, "제2종일반주거지역"), zrow("Z3", 127.05, "공업지역"), { properties: { A1: "bad" }, geometry: null }]],
  "zoning/management_1.shp": ["management", [zrow("Z2", 127.06, "계획관리지역"), zrow("Z4", 127.07, "생산관리지역")]],
};
const priceRows = {
  "land_price/11.csv": [["1168010100100010000", 2025, 1000], ["1168010100100020000", 2025, 2000]],
  "land_price/26.csv": [["1168010100100010000", 2025, 9999], ["2611010100100010000", 2025, 3000], ["bad", 2025, 1]],
};
const price = (p, y, v) => ({ properties: { 고유번호: p, 기준연도: String(y), 기준월: "01", 공시지가: String(v), 표준지여부: "N", 법정동명: "x" } });

/** failAt: { step: 단계 경로, when: "mid" | "after" } — mid는 행을 넣은 뒤, after는 run이 끝난 직후(커밋 전)에 던진다 */
function makePlan(dataDir, version, options = {}) {
  let db_;
  const seenMaps = new WeakMap();
  const seen = () => seenMaps.get(db_) ?? (seenMaps.set(db_, seedZoningSeen(db_)), seenMaps.get(db_));
  const fail = (path, when) => {
    if (options.failAt?.step === path && options.failAt.when === when) throw new Error(`simulated kill at ${path}/${when}`);
  };
  const steps = [];
  const add = (path, size, slot, run, extra = {}) => steps.push({ file: { path, size, mtimeMs: 1_700_000_000_000 + size, rows: 0 }, slot, run: async (prior) => {
    const list = await run(prior);
    fail(path, "after");
    return list;
  }, ...extra });
  add("store/s.csv", 11, 0, async () => {
    const stats = await buildPointSource(db_, STORE_SPEC, iter(storeRows), insertRelease(db_, rel("store")));
    fail("store/s.csv", "mid");
    return [stats];
  });
  for (const [path, [layer, rows]] of Object.entries(zoningParts)) {
    add(path, 100 + path.length, layer === "urban" ? 11 : 12, async () => {
      const releaseId = insertRelease(db_, rel(`zoning_${layer}`));
      const half = iter(rows.slice(0, 1));
      const listA = await buildZoning(db_, [{ layer, releaseId, records: half }], seen());
      fail(path, "mid");
      // 한 호출에 파일 전체를 넣은 것과 같아야 하므로 나머지는 이어서 같은 seen으로
      const listB = await buildZoning(db_, [{ layer, releaseId, records: iter(rows.slice(1)) }], seen());
      listA[0].merge(listB[0]);
      return listA;
    });
  }
  for (const [path, list] of Object.entries(priceRows)) {
    add(path, 300 + path.length, 20, async () => {
      const releaseId = insertRelease(db_, rel("land_price"));
      return [await buildLandPrice(db_, iter(list.map(([p, y, v]) => price(p, y, v))), releaseId, [path.slice(-6, -4)], null)];
    });
  }
  add("link", 0, 21, async (prior) => {
    const z = prior.filter((s) => s.sourceId.startsWith("zoning_"));
    db_.prepare("UPDATE source_release SET coverage_json = ? WHERE source_id LIKE 'zoning_%'").run(JSON.stringify({ total: z.reduce((n, s) => n + s.accepted, 0) }));
    return [];
  }, { atomic: false });
  const spec = { sourceId: "reference", parameters: JSON.stringify({ fixture: "ref-v1", paths: steps.map((s) => s.file.path) }), files: steps.map((s) => s.file) };
  return {
    dataDir,
    version,
    builders: { reference: async (db) => { db_ = db; return buildResumableSteps(db, spec, steps); } },
    progress: { reference: spec },
    resume: options.resume === true,
  };
}

const q = (db, sql) => db.prepare(sql).all();
function snapshot(dataDir, version) {
  const db = new Database(join(dataDir, "versions", version, "reference.sqlite"), { readonly: true });
  try {
    return {
      feature: q(db, "SELECT feature_id, stable_id, kind, source_key, release_id, geom_json, name, legal_code, properties_json FROM feature ORDER BY feature_id"),
      rtree: q(db, "SELECT feature_id, min_x, max_x, min_y, max_y FROM feature_rtree ORDER BY feature_id"),
      release: q(db, "SELECT * FROM source_release ORDER BY release_id"),
      run: q(db, "SELECT run_id, source_id, expected_count, received_count, accepted_count, rejected_count, release_id, snapshot_json FROM ingest_run ORDER BY run_id"),
      price: q(db, "SELECT * FROM land_price ORDER BY pnu"),
    };
  } finally {
    db.close();
  }
}
const statsOf = (outcome) => Object.fromEntries(Object.entries(outcome.stats).map(([k, list]) => [k, list.map((s) => ({ id: s.sourceId, r: s.received, a: s.accepted, x: s.rejected, u: s.unlocated, region: s.byRegion, type: s.byType, exp: s.expectedRegions }))]));

const dirs = [];
const tmp = () => (dirs.push(mkdtempSync(join(tmpdir(), "v2-ref-resume-"))), dirs.at(-1));
try {
  const baseDir = tmp();
  const baseline = await buildAndPublish(makePlan(baseDir, "v"));
  const expected = snapshot(baseDir, "v");
  const expectedStats = statsOf(baseline);
  assert.ok(expected.feature.some((f) => f.stable_id === "zoning:Z1#2"), "fixture must exercise cross-file stable-id counters");
  assert.equal(expected.price.length, 3, "duplicate PNU across sido files is rejected");
  assert.ok(existsSync(join(baseDir, "versions", "v", "build.log")), "version dir build.log must exist");
  assert.match(readFileSync(join(baseDir, "versions", "v", "build.log"), "utf8"), /step 1\/\d+ store\/s\.csv done rows=12 rows\/s=/);

  const paths = ["store/s.csv", ...Object.keys(zoningParts), ...Object.keys(priceRows), "link"];
  let cases = 0;
  for (const step of paths) {
    for (const when of ["mid", "after"]) {
      if (when === "mid" && !(step.startsWith("store") || step.startsWith("zoning"))) continue;
      const dir = tmp();
      await assert.rejects(buildAndPublish(makePlan(dir, "v", { failAt: { step, when } })), /simulated kill/);
      const partial = new Database(join(dir, "versions", "v", "reference.sqlite"), { readonly: true });
      const done = partial.prepare("SELECT COUNT(*) FROM build_progress").pluck().get();
      partial.close();
      assert.equal(done, paths.indexOf(step), `${step}/${when}: only the steps before the failure are committed`);
      const resumed = await buildAndPublish(makePlan(dir, "v", { resume: true }));
      assert.deepEqual(snapshot(dir, "v"), expected, `${step}/${when}: resumed db differs from uninterrupted`);
      assert.deepEqual(statsOf(resumed), expectedStats, `${step}/${when}: resumed stats differ`);
      cases++;
    }
  }
  // 두 번 연속 죽어도 이어진다
  const twice = tmp();
  await assert.rejects(buildAndPublish(makePlan(twice, "v", { failAt: { step: "zoning/urban_2.shp", when: "mid" } })), /simulated kill/);
  await assert.rejects(buildAndPublish(makePlan(twice, "v", { resume: true, failAt: { step: "land_price/11.csv", when: "after" } })), /simulated kill/);
  await buildAndPublish(makePlan(twice, "v", { resume: true }));
  assert.deepEqual(snapshot(twice, "v"), expected, "double interruption");
  console.log(`✓ v2 reference resume (${cases + 1} interruption cases)`);
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
