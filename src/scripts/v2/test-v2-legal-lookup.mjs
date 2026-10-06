/** 빠른 법정코드 조회가 기준 구현(queryFeaturesInRadius + turf)과 모든 점에서 같은 값을 주는지 — 경계·구멍·섬·겹침 근처 점으로. */
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { toLngLat, toUtmk } = await import("../../lib/v2/crs.ts");
const { legalCodeFromCore, legalCodeFromCoreSlow } = await import("../../lib/v2/ingest/sources/rail.ts");

const [ox, oy] = toUtmk([127.0, 37.5]);
const ring = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([x, y]) => [...toLngLat([ox + x, oy + y])]);
const db = new Database(":memory:");
initDataFileSchema(db, "core");
const releaseId = insertRelease(db, { sourceId: "legal_areas", provider: "t", sourceUrl: "u", sourceAsOf: "2026-01-01", fetchedAt: "2026-01-01T00:00:00Z", checksum: "x", licenseCode: "T" });
const add = (code, geometry) => insertFeature(db, { stableId: `legal_sigungu:${code}`, kind: "legal_sigungu", sourceKey: code, releaseId, geometry, legalCode: code, properties: {} });
add("1111000000", { type: "Polygon", coordinates: [ring(0, 0, 5000, 5000)] });
add("2222000000", { type: "Polygon", coordinates: [ring(5000, 0, 9000, 5000)] }); // 이웃(경계 공유)
add("3333000000", { type: "Polygon", coordinates: [ring(0, 6000, 6000, 12000), ring(2000, 8000, 3000, 9000).reverse()] }); // 구멍
add("4444000000", { type: "MultiPolygon", coordinates: [[ring(10000, 0, 12000, 2000)], [ring(10500, 5000, 10520, 5020)]] }); // 섬(원보다 작음)
add("5555000000", { type: "Polygon", coordinates: [ring(1000, 1000, 4000, 4000)] }); // 1111 위에 겹침

let seed = 7;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const fast = legalCodeFromCore(db);
const slow = legalCodeFromCoreSlow(db);
let hits = 0;
const codes = new Set();
for (let i = 0; i < 4000; i++) {
  // 경계선 위·근처(±80 m)와 전체 범위의 점을 섞는다
  const edge = [0, 1000, 2000, 3000, 4000, 5000, 6000, 8000, 9000, 10000, 10500, 12000][Math.floor(rnd() * 12)];
  const [x, y] = i % 2 === 0 ? [edge + (rnd() - 0.5) * 160, rnd() * 12000] : [rnd() * 13000 - 500, edge + (rnd() - 0.5) * 160];
  const [lng, lat] = toLngLat([ox + x, oy + y]);
  const a = fast(lng, lat);
  assert.equal(a, slow(lng, lat), `mismatch at ${x.toFixed(2)},${y.toFixed(2)}`);
  if (a) hits++;
  codes.add(a);
}
assert.ok(hits > 1000 && codes.size >= 4, `fixture should hit several areas (hits=${hits}, codes=${[...codes]})`);
assert.equal(legalCodeFromCore(null)(127, 37.5), null);
console.log(`✓ v2 legal lookup equals reference implementation (${hits} hits, ${codes.size} distinct)`);
